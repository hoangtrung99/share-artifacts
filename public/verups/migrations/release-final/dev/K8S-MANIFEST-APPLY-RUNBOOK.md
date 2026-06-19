# K8s manifest apply runbook — point dev / point stg

Manual, ordered list of every Kubernetes manifest / Helm release that must be
applied when bringing a `point` EKS cluster up through the 1.31 → 1.34 upgrade
ladder, with the exact command and the stage at which it runs. This is the
hand-run alternative to `k8s-manifests/bin/k8s_apply.sh` — same coverage, but
split into the two stages the migration actually needs and corrected where the
script is stale (see §8).

All paths are relative to the `bs-point-infra` repo root. Run every `kubectl` /
`helm` command from there. The bastion's kubeconfig context already targets the
`point` cluster, so **do not pass `--context`**.

---

## 0. Scope & assumptions

- **In scope:** `point` clusters in `bs-point-infra/k8s-manifests` — overlays
  `point/dev` (account `905418018638`) and `point/stg` (account `520411743393`).
- **Out of scope:** `dev-ex` / `stg-ex` (those live in `bs-exchange-infra` and
  have their own `k8s-manifests` tree + apply path). Do not mix the two repos.
- The runbook spans the full version ladder. The cluster-services layer is
  applied **once** at 1.31; one item (cluster-autoscaler) **recurs at every
  rung** — see §5.
- AWS reads only (`describe-*` / `get-*` / `list-*`); never `terraform apply`
  from here; the per-rung `terraform apply` of the `eks` component is a
  prerequisite, performed outside this runbook.

---

## 1. Add-on ownership — managed (terraform) vs self-managed (kubectl/helm)

The word "add-on" is overloaded. Only the **self-managed** ones are in this
runbook. The **managed** ones arrive with `terraform apply` of the `eks`
component and must **not** be `kubectl apply`-ed by hand.

| Add-on | Owner | How it is installed | In this runbook? |
| --- | --- | --- | --- |
| `vpc-cni` | EKS managed add-on | `terraform apply` (eks component) | No |
| `coredns` | EKS managed add-on | `terraform apply` (eks component) | No |
| `kube-proxy` | EKS managed add-on | `terraform apply` (eks component) | No |
| `aws-secrets-store-csi-driver-provider` (+ base `secrets-store-csi-driver`) | EKS managed add-on | `terraform apply` (eks component) → runs in ns `aws-secrets-manager` | No |
| aws-load-balancer-controller | self-managed (Helm) | `helm upgrade` chart 3.1.0 | **Yes — §4 step 4** |
| cluster-autoscaler | self-managed | `kubectl apply` | **Yes — §4 step 5 + §5 recurring** |
| metrics-server | self-managed | `kubectl apply` | **Yes — §4 step 6** |
| cloudwatch-agent | self-managed | `kubectl apply` | **Yes — §4 step 7** |
| fluent-bit | self-managed | `kubectl apply` | **Yes — §4 step 8** |

> If you are looking for a `kubectl apply` to bump `vpc-cni`/`coredns`/`kube-proxy`/
> the secrets-store CSI driver, there isn't one — change the version in the
> `eks` component tfvars and `terraform apply`.

---

## 2. Current state on point dev (verified 2026-06-15, account 905418018638)

This table exists so you do not re-run work that is already healthy. Re-applying
is idempotent, but knowing what is already done tells you where to focus.

| Item | Live state | Target | Action |
| --- | --- | --- | --- |
| vpc-cni / coredns / kube-proxy | ACTIVE, 1.31-correct versions | terraform | done (terraform) |
| secrets-store CSI (base + AWS provider) | 5/5 + 5/5 Running in ns `aws-secrets-manager`; CSIDriver `secrets-store.csi.k8s.io` registered | terraform | done (terraform) |
| cluster-autoscaler | **v1.31.5, 0 restarts, Running** | v1.31.5 + `AWS_REGION` | **done** |
| metrics-server | **v0.8.1** | v0.8.1 | **done** |
| cloudwatch-agent | **5/5 Running**, IRSA role attached, `RUN_WITH_IRSA=True` | — | **done** |
| fluent-bit | **5/5 Running** (node-role, hostNetwork) | 3.2.5 | **done** |
| aws-load-balancer-controller | **chart 1.4.4 / image v2.4.3** (2022) | chart 3.1.0 / image v3.1.0 | **PENDING — §4 step 4** |
| rbac (clusterroles + `admin-cluster-admin` → Group `admin`) | present | — | done (re-apply idempotent) |
| aws-auth ConfigMap | worker + custodian roles + `bs-developer` present | — | vestigial once auth-mode = API |
| namespace PSA labels (`default`) | **not set** | `restricted`/`baseline` per manifest | PENDING — §6 |
| network policies (`default`) | **none** | base ×3 + per-env ×2 | PENDING — §6 |
| SecretProviderClass (`default`) | **none** | from `point/base` | PENDING — §6 |
| point-app-sa (`default`; from file `point-app-service-account.yaml`) | **NotFound** | IRSA SA | PENDING — §6 |
| app deployments (admin/api/app/mmh/worker) | 0/0, dormant 600+ days | kustomize overlays | PENDING — §6 |
| point-ingress | exists, ALB provisioned, class via legacy annotation | annotation (dev) / IngressClass (stg) | present |

**Net:** the cluster-services layer (§4) is already healthy on point dev **except
the ALB controller upgrade**. The app layer (§6) is not deployed yet — that is by
design (it lands after the version ladder reaches 1.34).

---

## 3. Apply order at a glance

```
terraform apply  eks  @ eks/1.31  (Stage 1: module v21 + auth-mode dual)   ── outside this runbook
        │
        ▼
┌─ STAGE A — cluster services (§4) ──────── once, right after the 1.31 node roll
│   IP tuning → rbac → aws-auth → ALB controller (SA → CRDs → helm v3.1.0)
│   → cluster-autoscaler → metrics-server → cwagent → fluent-bit → verify
│
├─ RECURRING (§5) ── after EACH ladder rung's terraform apply (1.31-api,1.32,1.33,1.34)
│   re-apply cluster-autoscaler.yaml so its image tracks the cluster minor
│
└─ STAGE B — app layer (§6) ─────────────── once, after the ladder reaches 1.34
    PSA → default-SA → network policies → SecretProviderClass
    → point-app-SA → kustomize apps → ingress-class (stg only) → ingress
```

---

## 4. STAGE A — cluster services (run once, after the 1.31 Stage-1 terraform apply)

`<env>` = `dev` or `stg`.

### 4.1 CNI IP tuning (optional)

Raises warm-IP headroom. Patches the `aws-node` DaemonSet → triggers a CNI
rollout, so run it during the maintenance window, not casually. Live point dev is
`WARM_IP_TARGET=1`; the historical script value is `2`. Skip if you do not want
the rollout.

```bash
kubectl set env ds aws-node -n kube-system WARM_IP_TARGET=2
kubectl set env ds aws-node -n kube-system MINIMUM_IP_TARGET=1
```

### 4.2 RBAC (cluster roles + admin binding) — before aws-auth

```bash
kubectl apply -f rbac/
```

Installs `clusterrole-cicd|operator|viewer` and `clusterrolebinding-admin`
(binds Group `admin` → `cluster-admin`). Apply before aws-auth so the role
mappings have something to bind to.

### 4.3 aws-auth ConfigMap

```bash
kubectl apply -f k8s-manifests/point/<env>/aws-auth-cm.yaml
```

> Once the cluster's authentication mode is flipped to API-only, aws-auth is
> ignored for authorization (access entries govern). Re-applying it is harmless;
> it is kept for the dual-mode window.

### 4.4 aws-load-balancer-controller — upgrade v2.4.3 → v3.1.0

This is a **v2 → v3 major upgrade** and the one place the old script ships a
wrong command. Order matters: SA must exist before Helm (`serviceAccount.create:
false` in the values), and **CRDs must be applied by hand from chart 3.1.0** —
`helm upgrade` never touches CRDs, and chart 3.1.0 adds two CRDs that a 1.31
cluster does not yet have (`albtargetcontrolconfigs.elbv2.k8s.aws`,
`globalaccelerators.aga.k8s.aws`). Applying the old `v0.0.226` CRD set would
leave the v3 controller unable to reconcile.

```bash
# (a) ServiceAccount (pre-created, carries the IRSA role annotation)
kubectl apply -f k8s-manifests/point/<env>/aws-load-balancer-controller-service-account.yaml

# (b) CRDs — pulled from the SAME chart version we are about to install
helm repo add eks https://aws.github.io/eks-charts
helm repo update eks
helm pull eks/aws-load-balancer-controller --version 3.1.0 --untar -d /tmp/alb-v3
kubectl apply -f /tmp/alb-v3/aws-load-balancer-controller/crds/crds.yaml

# (c) controller (chart 3.1.0 → image v3.1.0; values pin region/vpcId, IRSA SA,
#     enableServiceMutatorWebhook=false to keep v2-compatible behavior)
helm upgrade -i aws-load-balancer-controller eks/aws-load-balancer-controller \
  --version 3.1.0 \
  --values k8s-manifests/point/<env>/aws-load-balancer-controller.yaml \
  -n kube-system
```

Verify before moving on (gate G-ALB, §7).

### 4.5 cluster-autoscaler (+ self-evict guard)

```bash
kubectl apply -f k8s-manifests/point/<env>/kube-system/cluster-autoscaler.yaml
kubectl annotate --overwrite -n kube-system deployment.apps/cluster-autoscaler \
  cluster-autoscaler.kubernetes.io/safe-to-evict="false"
```

The manifest pins the image to the cluster minor (**v1.31.5** on the eks/1.31
branch) and sets `AWS_REGION=ap-northeast-1`. Both are required: worker nodes
under module v21 enforce IMDSv2 with hop limit 1, which blocks a non-hostNetwork
pod from the metadata service — without an explicit region the autoscaler fails
SDK init with `MissingRegion` and CrashLoops. **This is the fix that took the
autoscaler from CrashLoop to 0 restarts.**

### 4.6 metrics-server

```bash
kubectl apply -f k8s-manifests/point/<env>/kube-system/metrics-server.yaml
```

Pinned v0.8.1 (the 0.6.x line predates 1.31). Apply once at 1.31 — uniform
across the whole ladder.

### 4.7 cloudwatch-agent

```bash
kubectl apply -f k8s-manifests/point/<env>/amazon-cloudwatch/cwagent.yaml
```

The manifest sets `agent.region` + `RUN_WITH_IRSA=True` and annotates the
`cloudwatch-agent` SA with its IRSA role — the same IMDS-hop-1 reason as the
autoscaler. Apply once at 1.31.

### 4.8 fluent-bit

```bash
kubectl apply -f k8s-manifests/point/<env>/amazon-cloudwatch/fluent-bit.yaml
```

Image 3.2.5, node-role + hostNetwork (so it is immune to the IMDS-hop issue).
Apply once at 1.31.

### 4.9 Verify Stage A

```bash
kubectl -n kube-system rollout status deploy/aws-load-balancer-controller --timeout=180s
kubectl -n kube-system rollout status deploy/cluster-autoscaler --timeout=180s
kubectl -n kube-system rollout status deploy/metrics-server --timeout=180s
kubectl -n amazon-cloudwatch rollout status ds/cloudwatch-agent --timeout=180s
kubectl -n amazon-cloudwatch rollout status ds/fluent-bit --timeout=180s
kubectl -n kube-system get pods -l app=cluster-autoscaler   # restarts must stay 0
```

---

## 5. RECURRING — after each ladder rung's terraform apply

Only **cluster-autoscaler** recurs. Its image must equal the cluster minor at
every rung, or it runs with a multi-minor skew. metrics-server / cwagent /
fluent-bit are uniform and do **not** need re-applying per rung.

The matching manifest is already committed on each branch, so the loop is:

```bash
# for each rung after the corresponding `terraform apply` of the eks component:
git checkout <branch>          # eks/1.31-api → eks/1.32 → eks/1.33 → eks/1.34
# ... terraform apply eks (outside this runbook) ...
kubectl apply -f k8s-manifests/point/<env>/kube-system/cluster-autoscaler.yaml
kubectl -n kube-system rollout status deploy/cluster-autoscaler --timeout=180s
```

| Branch / cluster minor | cluster-autoscaler image |
| --- | --- |
| eks/1.31, eks/1.31-api (1.31) | v1.31.5 |
| eks/1.32 (1.32) | v1.32.7 |
| eks/1.33 (1.33) | v1.33.4 |
| eks/1.34, release/verup (1.34) | v1.34.3 |

---

## 6. STAGE B — app layer (run once, after the ladder reaches 1.34)

These resources gate the application pods. Keep them out of Stage A — the app
deployments are dormant until this stage.

**Precondition (gate G-CSI, §7):** the base secrets-store CSI driver must be
running, or every SecretProviderClass mount fails. On point dev it is present in
ns `aws-secrets-manager` (installed by the managed add-on). One-line check:

```bash
kubectl get ds -A | grep -i secrets-store     # expect base driver + AWS provider Running
```

### 6.1 Pod Security Admission labels

```bash
kubectl apply -f k8s-manifests/point/base/namespace-psa.yaml
```

### 6.2 default ServiceAccount (disable token automount)

```bash
kubectl apply -f k8s-manifests/point/<env>/default-service-account.yaml
```

### 6.3 Network policies (3 base + 2 per-env)

```bash
kubectl apply \
  -f k8s-manifests/point/base/networkpolicy-default-deny.yaml \
  -f k8s-manifests/point/base/networkpolicy-allow-dns.yaml \
  -f k8s-manifests/point/base/networkpolicy-allow-internal.yaml \
  -f k8s-manifests/point/<env>/networkpolicy-allow-ingress-vpc.yaml \
  -f k8s-manifests/point/<env>/networkpolicy-allow-egress-vpc.yaml
```

### 6.4 SecretProviderClass

```bash
kubectl apply -f k8s-manifests/point/base/secret-provider-class.yaml
```

### 6.5 point-app ServiceAccount (IRSA for the apps)

```bash
kubectl apply -f k8s-manifests/point/<env>/point-app-service-account.yaml
```

> **Resource name ≠ file name.** The file is `point-app-service-account.yaml`, but the
> ServiceAccount it creates is named **`point-app-sa`** (`metadata.name`). `kubectl apply`
> reports `serviceaccount/point-app-sa created`. Check it by the *resource* name, not the
> file name (`describe sa point-app-service-account` returns `NotFound`):
>
> ```bash
> kubectl describe sa point-app-sa -n default | grep -i role-arn   # -> arn:aws:iam::<acct>:role/point-app-irsa-role
> ```

### 6.6 Application deployments (kustomize overlays)

`kubectl apply -k` uses kubectl's bundled Kustomize (v5.5.0 in kubectl 1.32), which renders
these overlays' `labels: includeTemplates` + `patches:` correctly (needs kubectl >= 1.27,
satisfied by the ladder's kubectl upgrades). No standalone `kustomize` binary is required —
it is not installed on the bastion, so `kustomize build` would fail with `command not found`.
Diff + apply EACH overlay ONE AT A TIME (no loop); soak each before the next.

```bash
kubectl diff -k k8s-manifests/point/<env>/app    -n default ; kubectl apply --dry-run=server -k k8s-manifests/point/<env>/app    -n default ; kubectl apply -k k8s-manifests/point/<env>/app    -n default
kubectl diff -k k8s-manifests/point/<env>/api    -n default ; kubectl apply --dry-run=server -k k8s-manifests/point/<env>/api    -n default ; kubectl apply -k k8s-manifests/point/<env>/api    -n default
kubectl diff -k k8s-manifests/point/<env>/admin  -n default ; kubectl apply --dry-run=server -k k8s-manifests/point/<env>/admin  -n default ; kubectl apply -k k8s-manifests/point/<env>/admin  -n default
kubectl diff -k k8s-manifests/point/<env>/worker -n default ; kubectl apply --dry-run=server -k k8s-manifests/point/<env>/worker -n default ; kubectl apply -k k8s-manifests/point/<env>/worker -n default
kubectl diff -k k8s-manifests/point/<env>/mmh    -n default ; kubectl apply --dry-run=server -k k8s-manifests/point/<env>/mmh    -n default ; kubectl apply -k k8s-manifests/point/<env>/mmh    -n default
```

### 6.7 IngressClass — **stg only** (dev skips by design)

`point/dev` has no `ingress-class.yaml`: the dev ingress selects the controller
via the legacy `kubernetes.io/ingress.class: alb` annotation, which the v3
controller still honors (the values leave `disableIngressClassAnnotation`
unset). This is intentional, not a missing file. stg/prd define an IngressClass
resource instead:

```bash
# stg / prd only:
kubectl apply -f k8s-manifests/point/<env>/ingress-class.yaml -n default
```

### 6.8 Ingress

```bash
kubectl apply -f k8s-manifests/point/<env>/ingress.yaml -n default
```

### 6.9 Per-env extras (stg / prd — NOT dev)

dev runs neither of these: it has no `aws-coredns-cm.yaml` and no `aws-nfs-*.yaml`.
Both are HULFT / Ponta integration plumbing that only stg and prd carry.

#### 6.9.1 CoreDNS custom ConfigMap — Ponta static `hosts`

stg/prd override the **managed** CoreDNS ConfigMap to add a `hosts` plugin block
that pins the Ponta (Loyalty Marketing, `*.loyalty.co.jp`) endpoints to their
on-prem IPs. The block sits before `forward` and ends with `fallthrough`, so any
non-matching query still falls through to `kubernetes` / `forward`. **Dropping
`fallthrough` would NXDOMAIN every other name and break cluster DNS.**

```bash
# stg / prd — apply the env's OWN file (the hosts entries differ per env):
kubectl apply -f k8s-manifests/point/<env>/aws-coredns-cm.yaml
```

The two envs are **not** interchangeable — the live Corefile must match the env's
own file. dev has no override and runs the stock default:

| Env | `hosts` entries that MUST be present | Source |
| --- | --- | --- |
| stg | `10.50.0.114 onlinest01.lp.loyalty.co.jp` · `10.50.2.25 onlineit102.lw.loyalty.co.jp` | `point/stg/aws-coredns-cm.yaml` |
| prd | `10.50.0.14 onlinesx01.lp.loyalty.co.jp` · `10.50.1.24 onlinesx02.lw.loyalty.co.jp` | `point/prd/aws-coredns-cm.yaml` |
| dev | none — stock EKS default Corefile (no `hosts` block) | (no file) |

After-check (stg/prd) — the live Corefile must contain the env's `hosts` block;
verify against the env file, not a generic "unchanged" baseline:

```bash
kubectl -n kube-system get cm coredns -o jsonpath='{.data.Corefile}'   # must include the env's hosts entries above
```

> ⚠ **CoreDNS is a managed add-on.** A `terraform apply` of the `eks` component
> can re-assert the default ConfigMap and silently drop this `hosts` block.
> Re-apply `aws-coredns-cm.yaml` (and re-verify) after any eks-component apply on
> stg/prd. The `k8s_apply.sh` script applies it for **stg only** — see §8.5.

#### 6.9.2 HULFT NFS provisioner + PV/PVC

stg/prd mount a shared NFS export (`/mnt/hulft/tmp`) for HULFT file-transfer
working files, via the `nfs-subdir-external-provisioner` Helm chart plus a static
PV/PVC pair (`nfs-hulft-pv` / `nfs-hulft-pvc`; `ReadWriteMany`, reclaim `Retain`,
`storageClassName: manual`). The NFS server IP and the capacity differ per env:

| Env | NFS server | Path | PV/PVC capacity |
| --- | --- | --- | --- |
| stg | `10.51.187.138` | `/mnt/hulft/tmp` | `30Gi` |
| prd | `10.51.188.138` | `/mnt/hulft/tmp` | `50Gi` |
| dev | — | — | none (no NFS files) |

```bash
# stg / prd only — set --set nfs.server to the env's IP (see table above):
helm repo add nfs-subdir-external-provisioner https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner/
helm repo update nfs-subdir-external-provisioner
helm upgrade --install nfs-subdir-external-provisioner \
  nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \
  --set nfs.server="<env NFS server IP>" \
  --set nfs.path="/mnt/hulft/tmp"
kubectl apply -f k8s-manifests/point/<env>/aws-nfs-pv.yaml
kubectl apply -f k8s-manifests/point/<env>/aws-nfs-pvc.yaml
```

After-check (stg/prd):

```bash
kubectl get pv nfs-hulft-pv ; kubectl get pvc nfs-hulft-pvc -n default   # PVC Bound to the PV
kubectl -n default get pods -l app=nfs-subdir-external-provisioner       # provisioner pod Running
```

> The PV's `nfs.server` (in `aws-nfs-pv.yaml`) and the Helm `--set nfs.server`
> must point at the **same** env IP. They are two independent declarations of the
> same target — a mismatch leaves the PVC `Pending` (provisioner) or mounts fail
> (static PV).

---

## 7. Gates

**G-ALB — after the v3 controller upgrade (§4.4):**

```bash
kubectl -n kube-system logs deploy/aws-load-balancer-controller --tail=50   # no CRD/RBAC errors
kubectl get ingress point-ingress -n default                                # ADDRESS still the same ALB
kubectl get crd | grep elbv2.k8s.aws                                        # 3 CRDs incl. albtargetcontrolconfigs
```

Confirm the controller still manages `point-ingress` and the existing ALB /
listeners / target groups are intact. Higher stakes on stg/prd later — the dev
apps are dormant, so a brief reconcile blip there is acceptable.

**G-CSI — before Stage B (§6):** base CSI driver DaemonSet Running (see §6
precondition).

---

## 8. Corrections vs `k8s-manifests/bin/k8s_apply.sh`

If you ever fall back to the script, these are the points where it diverges from
this runbook:

1. **ALB CRD source (significant).** The script applies CRDs from the hardcoded
   `ALB_EKS_CHART_RELEASE=v0.0.226` (`stable/` layout, v2-era). For controller
   v3.1.0 that ships an incomplete CRD set — pull CRDs from chart 3.1.0 instead
   (§4.4b).
2. **`ingress-class.yaml` on dev (script aborts).** Script line ~204 runs
   `kubectl apply -f point/dev/ingress-class.yaml` unconditionally; that file does
   not exist for dev, and with `set -e` the whole script aborts there. This
   runbook makes IngressClass stg/prd-only (§6.7).
3. **cluster-autoscaler is recurring.** The script applies it once; across the
   ladder it must be re-applied per rung so the image tracks the cluster minor
   (§5).
4. **Stage split.** The script applies cluster services and app layer in one
   pass. The migration needs them split — services at 1.31, apps after 1.34.
5. **CoreDNS ConfigMap on prd (script gap).** The script applies
   `aws-coredns-cm.yaml` only under `if [ $ENV = stg ]` — **prd is not covered**,
   even though `point/prd/aws-coredns-cm.yaml` exists with its own Ponta `hosts`
   block. On prd, apply it by hand (§6.9.1) or the cluster runs the stock default
   Corefile and loses Ponta name resolution. NFS, by contrast, is gated
   `if stg … elif prd …`, so both envs are covered there.
