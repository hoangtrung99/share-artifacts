# Incident Report — `eks/1.31` apply failures on point-dev (2026-06-12)

**Environment**: point dev (account `905418018638`), cluster `point`, region `ap-northeast-1`
**Branch applied**: `eks/1.31` @ `3ec84a5e` — *module terraform-aws-eks v17 → v21 + auth Stage 1 (`CONFIG_MAP` → `API_AND_CONFIG_MAP`) at cluster version 1.31*
**Impact**: zero workload downtime (the old nodes kept serving throughout). Two apply attempts failed at the node roll; cluster-level changes (auth mode, access entries, IAM restructuring, 1.31 baseline) landed. The bastion lost `kubectl` access for ~2 hours (recovered).

---

## 1. Executive summary

Three independent failures occurred, at three different layers:

| # | Symptom | Layer | Root cause |
|---|---------|-------|------------|
| 1 | `ResourceInUseException` (409) creating the `bs-developer` access entry | Terraform state | Entry existed on the cluster since 2024-10-08, never in state → Terraform tried to create a duplicate |
| 2 | `NodeCreationFailure` on all 5 node groups, **both apply attempts** | EKS / CNI / IAM | **CNI IAM deadlock**: the apply detached `AmazonEKS_CNI_Policy` from the node role, while the vpc-cni IRSA wiring (the replacement permission path) is ordered AFTER the node roll by module v21 → every new node booted with a permissionless CNI and never became Ready |
| 3 | `kubectl` Forbidden from the bastion | Kubernetes RBAC | The new STANDARD access entry for `point-bastion-role` overrode its `aws-auth` mapping, but the `admin` group's ClusterRoleBinding was not yet applied to the cluster |

All three root causes are **CloudTrail/API-record confirmed — no remaining speculation** (see the evidence chain in §3.2, items 7–8).

## 2. Detailed timeline (all times UTC; JST = UTC+9)

### Apply attempt #1 — bundled v21 + auth switch + node roll (~09:35–10:01 UTC)

| Time (UTC) | Event | Evidence |
|---|---|---|
| ~09:35 | `terraform apply` starts on branch `eks/1.31`. Early in the graph: cluster `authentication_mode` flips to `API_AND_CONFIG_MAP`; **the `AmazonEKS_CNI_Policy` attachment on `eks-worker-role` is destroyed** (the branch intentionally moves CNI permissions to the IRSA role `point-vpc-cni-aws-node`); STANDARD access entries are created (bastion at 09:56:32) | apply log; `aws iam list-attached-role-policies --role-name eks-worker-role` afterwards returns only `CloudWatchAgentServerPolicy`, `AmazonEC2ContainerRegistryReadOnly`, `AmazonEKSWorkerNodePolicy` — no CNI policy |
| 09:52:08 | EKS auto-creates the `EC2_LINUX` access entry for `eks-worker-role` (`kubernetesGroups: ["system:nodes"]`) during the node-group update | `aws eks describe-access-entry ... role/eks-worker-role` → `createdAt: 2026-06-12T09:52:08Z` |
| 09:58:25 | The node-group update launches one new instance per group (api group: `i-0640b19837242bb8a`), targeting AMI `1.31.14-20260529` + launch template **v5** | ASG activity: `Launching a new EC2 instance: i-0640b19837242bb8a` at `09:58:25Z` |
| 09:58–10:15 | New nodes boot, **register with the API server, but stay NotReady**: their `aws-node` (CNI) pods crash because ipamd has no EC2 permissions (node role lost the CNI policy; the `aws-node` ServiceAccount has no IRSA annotation yet) | see §3.2 evidence chain |
| ~10:01 | The EKS health window (~15 min per node group) expires → each version update is marked `Failed` → Terraform reports `NodeCreationFailure: new nodes are not joining` ×5, plus the 409 on `bs-developer` (6 errors total, 26 min) | apply #1 error output |
| 10:15:36 | EKS rolls back; the ASG terminates the never-Ready new instance (`i-0640b19837242bb8a`) and keeps the old June-10 node | ASG activity: `Terminating EC2 instance: i-0640b19837242bb8a`, cause `desired capacity from 2 to 1` |

**Post-state of attempt #1**: node groups report `ACTIVE` on `1.31.14-20260512` — this is the **pre-existing June-10 fleet restored by rollback**, not newly joined nodes (ASG history: the NEW instance was terminated each time).

### Between attempts (~10:20–10:40 UTC)

- The 409 was fixed by importing the pre-existing entry: `terraform import 'module.eks.aws_eks_access_entry.this["named_user"]' point:arn:aws:iam::905418018638:user/bs-developer` — import succeeded.
- The bastion's `kubectl` was found **Forbidden** (failure #3) — later recovered via `aws eks associate-access-policy ... AmazonEKSClusterAdminPolicy` + `kubectl apply -f k8s-manifests/rbac/`.

### Apply attempt #2 — retry of the node roll (~10:45–11:05 UTC)

| Time (UTC) | Event | Evidence |
|---|---|---|
| 10:45:34 | The retry apply rolls the node groups again (AMI `-20260529`, LT v5). One new instance per group launches (api: `i-0408441335e0214cf`) | ASG activity: `Launching ... i-0408441335e0214cf` at `10:45:34Z` |
| 10:45:53 | The new node **authenticates to the API server successfully** — 8 seconds after launch — and keeps doing so at 10:53:00 and 10:59:59 | control-plane authenticator log: `arn=arn:aws:sts::905418018638:assumed-role/eks-worker-role/i-0408441335e0214cf ... path=/authenticate` (3 entries). **This kills any authentication-based theory.** |
| 10:46–11:00 | All 5 new nodes' `aws-node` pods fail readiness/liveness probes continuously, then CrashLoop | cluster events, §3.2 item 3 |
| ~11:05 | The health window expires → `NodeCreationFailure` ×5 again (apply duration 20 min 22 s) | apply #2 error output |
| 11:02:55 | Rollback: the ASG terminates `i-0408441335e0214cf`; the new node objects (`ip-172-18-21-153`, `ip-172-18-21-217`, `ip-172-18-22-130`, `ip-172-18-22-171`, `ip-172-18-24-247`) are deleted ("does not exist in the cloud provider") | ASG activity + cluster events |
| 11:18:48 | A follow-up **targeted** apply (`-target` on the vpc-cni addon — which would NOT have worked, see §3.2 item 6) is started, then interrupted → a **stale state lock** `243ab085-ebfa-a044-8a39-60a2e01faaae` is left on `dev/eks.tfstate` | DynamoDB lock info shown by the next plan's error |

## 3. Root causes, each with its evidence

### 3.1 Failure 1 — 409 on the `bs-developer` access entry

**Cause**: out-of-band resource vs. Terraform state. The entry was created **2024-10-08** (cluster bring-up era) and never imported. The v21 `access_entries` block declares it, so Terraform issued `CreateAccessEntry`; AWS correctly rejected the duplicate.

**Evidence**: `aws eks describe-access-entry --cluster-name point --principal-arn arn:aws:iam::905418018638:user/bs-developer` → `createdAt: 2024-10-08T18:45:56`, `type: STANDARD`, `kubernetesGroups: []` (≈2 years before the apply).

**Fix**: `terraform import` (done 2026-06-12). The follow-up plan diff `kubernetes_groups [] → ["admin"]` is expected — the code declares the group.

### 3.2 Failure 2 — `NodeCreationFailure` ×5 on both attempts: the CNI IAM deadlock

**Cause — the deadlock cycle:**

```
new nodes need a working CNI (aws-node Ready) to become Ready
  → the CNI's EC2 permissions moved from the node role to IRSA (point-vpc-cni-aws-node)
    → the IRSA wiring is performed by the vpc-cni ADDON update (service_account_role_arn)
      → module v21 orders addon updates AFTER the node groups
        (module source: aws_eks_addon.this has depends_on = [module.eks_managed_node_group, ...])
        → the addon update never runs, because the node groups fail first
          → back to the top. Retrying the same apply can NEVER succeed.
```

**Evidence chain (each link verified live on 2026-06-12):**

1. **The CNI policy is gone from the node role**: `aws iam list-attached-role-policies --role-name eks-worker-role` → `["CloudWatchAgentServerPolicy", "AmazonEC2ContainerRegistryReadOnly", "AmazonEKSWorkerNodePolicy"]`. The branch's `worker-role-attach.tf` deliberately drops the `AmazonEKS_CNI_Policy` attachment (CNI is designed to use IRSA from this branch onward).
2. **The IRSA role exists and is correct, but is wired to nothing**: `aws iam get-role --role-name point-vpc-cni-aws-node` shows a correct OIDC trust (`:sub = system:serviceaccount:kube-system:aws-node`, `:aud = sts.amazonaws.com`) and `AmazonEKS_CNI_Policy` attached. But `aws eks describe-addon --addon-name vpc-cni` → `serviceAccountRoleArn: null`, and `kubectl get sa aws-node -n kube-system` shows **no** `eks.amazonaws.com/role-arn` annotation. Therefore `aws-node` pods still sign their EC2 calls with the now-permissionless node role.
3. **The new nodes' CNI pods crashed exactly as the deadlock predicts**: cluster events 10:46–11:00 UTC show the 5 `aws-node` pods on the 5 new nodes (`aws-node-z29pg`, `-8rg9s`, `-qjth8`, `-f6lq7`, `-7hnbd`) failing readiness AND liveness probes with `timeout: failed to connect service ":50051" within 5s` (ipamd's gRPC endpoint never came up), followed by `Back-off restarting failed container`. Without a running ipamd, kubelet reports the node `NotReady` ("CNI plugin not initialized").
4. **Authentication was NOT the problem**: the authenticator log (§2, attempt #2) proves the new node authenticated to the API server 8 seconds after launch and continuously thereafter — while its CNI was crash-looping.
5. **Why the old fleet survives**: the running `aws-node` pods started 2–23 days earlier, while the node role still carried the CNI policy; a warm ipamd only needs EC2 calls when attaching new ENIs/IPs. `kubectl get pods -n kube-system -l k8s-app=aws-node` → all 2/2 Running on the old nodes.
6. **The module ordering is by design, and `-target` cannot fix it**: terraform-aws-eks v21.1.0 source (`main.tf`) — `aws_eks_addon.this` carries `depends_on = [module.fargate_profile, module.eks_managed_node_group, module.self_managed_node_group]`. Because `-target` always includes the target's dependencies, targeting the addon **drags the node groups in**: verified empirically on DEV — the targeted plan rendered 6 changes (5 node groups + the addon) and would have failed identically. (The module offers a separate `aws_eks_addon.before_compute` resource without that `depends_on` — see §4.3.)
7. **CloudTrail — the denial itself, on record (closes the case)**: `aws cloudtrail lookup-events` for the failed instances returns the exact denied calls, signed by ipamd's SDK:
   - Attempt #2 instance `i-0408441335e0214cf` (10:45–11:05 UTC): **48× `ec2:DescribeNetworkInterfaces` → `Client.UnauthorizedOperation`**, errorMessage `User: arn:aws:sts::905418018638:assumed-role/eks-worker-role/i-0408441335e0214cf is not authorized to perform: ec2:DescribeNetworkInterfaces`, userAgent `aws-sdk-go-v2/...` (the VPC CNI is Go; `DescribeNetworkInterfaces` is ipamd's startup call).
   - Attempt #1 instance `i-0640b19837242bb8a` (09:58–10:16 UTC): **19× the same denial** — both attempts failed for the identical, recorded reason.
8. **Both confounders are excluded by the same records**: (a) launch template v5's IMDS hardening (`HttpTokens: required`, `HopLimit 1`) did NOT break the host — the same instances successfully called `sts:GetCallerIdentity` (credentials can only come from IMDS) and authenticated to the API server; (b) the `-20260529` AMI is exonerated — ipamd booted, reached the EC2 API endpoint over the network, and was rejected purely on **authorization**. The failure is IAM, full stop.


**Why the error looks like a timeout**: the 15–20 minutes is EKS's per-node-group health window. The timeout is the *messenger*; the *message* is "new nodes never became Ready" — and under this deadlock they never could, no matter how many retries.

**Confidence: 100% — the previously inferred link is now directly proven.** The only inferred step ("ipamd failed because its EC2 calls were AccessDenied") is confirmed by CloudTrail (evidence item 7), and both confounders (launch template v5 IMDS options, the `-20260529` AMI) are excluded by direct records (evidence item 8). No remaining speculation.

**⚠ Latent risk discovered during verification — the OLD fleet is degraded RIGHT NOW**: CloudTrail for the surviving June-10 node `i-00b3389c5d1abcfe0` (09:00–12:30 UTC window) shows **16× `ec2:AssignPrivateIpAddresses` → `Client.UnauthorizedOperation`**. The warm ipamd serves already-attached IPs, but it can no longer EXPAND the IP pool — on the current DEV fleet, scheduling enough new pods to exhaust the warm IP pool will fail with CNI "failed to assign an IP address to container" errors. This makes the IRSA wiring (Runbook A step A1) **urgent**, not merely a prerequisite for the node roll.

### 3.3 Failure 3 — bastion `kubectl` Forbidden (RBAC lockout)

**Cause**: in `API_AND_CONFIG_MAP` mode, an access entry **takes precedence over** that principal's `aws-auth` ConfigMap mapping from the moment it is created. The apply created a STANDARD entry for `point-bastion-role` → Kubernetes group `admin` (09:56:32 UTC), but the matching ClusterRoleBinding (`k8s-manifests/rbac/clusterrolebinding-admin.yaml`, group `admin` → `cluster-admin`) had not been applied to the cluster. The bastion instantly went from aws-auth-based admin to "authenticated, zero RBAC". The same held for every other mapped principal (`bs-developer`, operator/viewer/cicd groups).

**Evidence**: `kubectl get nodes` → `Error from server (Forbidden): ... assumed-role/point-bastion-role ... cannot list resource "nodes"`, while `aws eks describe-access-entry ... point-bastion-role` shows `kubernetesGroups: ["admin"]` and the binding was absent from the cluster.

**Fix (executed)**: `aws eks associate-access-policy --cluster-name point --principal-arn arn:aws:iam::905418018638:role/point-bastion-role --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy --access-scope type=cluster` (an EKS-managed policy bypasses in-cluster RBAC) → `kubectl apply -f k8s-manifests/rbac/` → group-based access restored. The associated policy can be removed afterwards (`disassociate-access-policy`) once `kubectl auth can-i '*' '*'` returns `yes`.

## 4. Solutions

The permanent fix is a **Terraform-native code change** — `before_compute = true` on the `vpc-cni` add-on plus a `moved` block — that removes the deadlock at its source. The out-of-band `aws eks update-addon` call is kept only as a **fallback** for when the code change cannot be made. Both the change and the resulting plans were verified with read-only `terraform plan` against the live DEV and STG clusters.

### 4.1 The code change — primary fix

In `main.tf` `local.cluster_addons`, the `vpc-cni` entry gets `before_compute = true`:

```hcl
"vpc-cni" = {
  addon_version  = var.eks.addon_vpc_cni_version
  before_compute = true                          # provision the CNI before the node groups
  preserve       = false
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  service_account_role_arn    = aws_iam_role.vpc_cni_aws_node.arn
  configuration_values        = jsonencode({ enableNetworkPolicy = "true" })
}
```

and a `moved` block relocates the add-on's existing state entry — without it Terraform plans a destroy+create, and with `preserve = false` that destroy deletes the live CNI (cluster-wide pod-network outage):

```hcl
moved {
  from = module.eks.aws_eks_addon.this["vpc-cni"]
  to   = module.eks.aws_eks_addon.before_compute["vpc-cni"]
}
```

**Why it works** (verified against terraform-aws-modules/eks v21.1.0 source): the module declares two add-on resources selected by the `before_compute` flag. `aws_eks_addon.this` carries `depends_on = [module.eks_managed_node_group, …]` (applied *after* the node groups — the source of the deadlock); `aws_eks_addon.before_compute` has no such dependency. The flag moves the add-on to the dependency-free resource, so the IRSA role is wired to the `aws-node` ServiceAccount independently of the node roll.

**Plan-verified (read-only, both clusters):**

- **DEV** (already on the v21 module): `Plan: 0 to add, 0 to destroy`; the add-on shows `will be updated in-place` + `(moved from …this["vpc-cni"])` + `+ service_account_role_arn = …/point-vpc-cni-aws-node`. No CNI destroy; the node groups stay an in-place roll.
- **STG** (still on the legacy v17 module): the move chains across the v17→v21 relocation (`aws_eks_addon.vpc_cni[0]` → `…this["vpc-cni"]` → `…before_compute["vpc-cni"]`) and still resolves to a single in-place update — no CNI destroy.

**Caveat — parallel ordering.** `before_compute` removes the add-on→node-group dependency but adds no reverse edge, so the add-on update and the node roll run in parallel. In practice the add-on update finishes in ~15 s while new nodes take minutes to bootstrap, so the ServiceAccount is annotated before any new node needs it, and the node-group health window (~15 min) absorbs any transient CNI flake. For an absolute "add-on first, then nodes" guarantee, split it into two Terraform steps (strict-ordering variant in §4.2).

### 4.2 DEV — finish the apply from the current state

Current DEV state: cluster 1.31 + `API_AND_CONFIG_MAP`; `named_user` imported; node groups ACTIVE on the June-10 fleet (`1.31.14-20260512`); bastion kubectl restored; RBAC bindings applied; vpc-cni add-on **not yet IRSA-wired** (`serviceAccountRoleArn: null`); a stale state lock is present.

With `before_compute = true` + the `moved` block in the code (§4.1), a single apply finishes the job: it relocates the add-on in state, wires the IRSA role (the `before_compute` add-on is not gated on the node roll), then rolls the node groups onto a working CNI.

```bash
# D0 — clear the stale state lock from the interrupted targeted apply
#      (confirm no terraform process is running first: ps aux | grep terraform)
../../terraform.sh --env dev force-unlock <LOCK_ID>

# D1 — plan, and gate it. EXPECTED diff (anything beyond this = STOP):
#   add-on vpc-cni: "will be updated in-place" + "(moved from …this[\"vpc-cni\"])" + service_account_role_arn added
#   ~ access entry named_user: kubernetes_groups [] -> ["admin"]
#   ~ 5 node groups: launch_template 4->5, release -20260512 -> -20260529 (in-place rolling, ~15-20 min each)
#   ~ add-ons coredns/kube-proxy: metadata only
#   - 2 destroys only: AmazonEKSServicePolicy, AmazonEKSVPCResourceController
#   0 add / 0 replace
../../terraform.sh --env dev plan
../../terraform.sh --env dev apply

# D2 — post-verify (repeat describe-nodegroup for all 5: admin/api/app/worker/mmh)
kubectl get sa aws-node -n kube-system -o jsonpath='{.metadata.annotations}'   # role-arn .../point-vpc-cni-aws-node
kubectl rollout status ds/aws-node -n kube-system
kubectl get pods -n kube-system -l k8s-app=aws-node    # 2/2 Running, no new restarts
aws eks describe-nodegroup --cluster-name point --nodegroup-name node-group-point-api-20260505 --query 'nodegroup.{status:status,rel:releaseVersion,health:health}' --region ap-northeast-1
kubectl get nodes -o wide && kubectl get pods -A | grep -v Running | head
kubectl auth can-i '*' '*'            # expect yes
```

**Strict-ordering variant (optional).** To guarantee the add-on is fully wired before any node rolls, relocate the state out-of-band and target only the add-on first. Both commands are pure Terraform — neither mutates an AWS resource:

```bash
terraform state mv 'module.eks.aws_eks_addon.this["vpc-cni"]' 'module.eks.aws_eks_addon.before_compute["vpc-cni"]'
../../terraform.sh --env dev apply -target='module.eks.aws_eks_addon.before_compute["vpc-cni"]'   # wires role only, no node roll
../../terraform.sh --env dev apply                                                                 # then rolls nodes onto a ready CNI
```

**Fallback — no code change.** If the `before_compute` change cannot be made, wire the add-on out-of-band via the EKS API, then apply:

```bash
aws eks update-addon --cluster-name point --addon-name vpc-cni --service-account-role-arn arn:aws:iam::905418018638:role/point-vpc-cni-aws-node --resolve-conflicts OVERWRITE --configuration-values '{"enableNetworkPolicy":"true"}' --region ap-northeast-1
# repeat until status=ACTIVE + irsa set, then: ../../terraform.sh --env dev apply
```

A `-target` on `aws_eks_addon.this` does **not** isolate the add-on — that resource `depends_on` the node groups, so targeting it drags them in (§3.2 item 6). That is why the fallback uses an out-of-band API call, and the strict variant uses `before_compute` (which has no such dependency). Emergency CNI fallback if rolled `aws-node` pods crash on IRSA: `aws iam attach-role-policy --role-name eks-worker-role --policy-arn arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy`. If an apply hits `NodeCreationFailure` again, do NOT re-apply: inspect `kubectl get pods -n kube-system -l k8s-app=aws-node -o wide` for the new node's pod — its state pinpoints the failing layer.

### 4.3 STG/PRD — fresh apply sequence

STG currently sits at the pre-migration baseline: cluster 1.31, `CONFIG_MAP`, legacy v17 module, vpc-cni add-on without IRSA. Applying the `eks/1.31` stage performs the full v17→v21 migration + auth Stage 1 + CNI IRSA in one go. This ordering avoids all three failures with `before_compute = true` + the `moved` block in the code.

- **Step 0 — account guard + branch + init + tfvars gate.** Confirm the account ID (`aws sts get-caller-identity`), the `eks/1.31` branch, run `terraform init`. **Gate:** `tfvars/stg.tfvars` must pin `cluster_version` / `cluster_node_version` to the stage value `1.31`, NOT the final `1.34`. A `1.31 → 1.34` jump is rejected by EKS (one minor version per upgrade) and must be done later via the version ladder; a plan that shows `cluster_version 1.31 -> 1.34` is the signal to STOP and correct the tfvars. (vpc-cni `v1.21.1-eksbuild.7` is valid on EKS 1.31, so the add-on version need not change.)
- **Step 1 — list + import out-of-band access-entry collisions**: `aws eks list-access-entries` and `terraform import` any entry that exists on the cluster but is absent from state (prevents the 409).
- **Step 2 — apply the in-cluster RBAC bindings FIRST**: `kubectl apply -f k8s-manifests/rbac/` before any STANDARD access entry is created, so principals you depend on (bastion, developer, operator) do not lose access the instant their entry lands (prevents the kubectl lockout).
- **Step 3 — create the CNI IRSA role via a targeted apply** scoped ONLY to `aws_iam_role.vpc_cni_aws_node` and its policy attachment. These are root-level resources, so `-target` does not drag the node groups in (verified).
- **Step 4 — single full `plan` + `apply`.** With `before_compute = true` + the `moved` block, the add-on (now `aws_eks_addon.before_compute`) wires the IRSA role without waiting for the node roll, so the deadlock cannot form. **Plan gate:**
  - add-on `before_compute["vpc-cni"]` updated in-place, `(moved from aws_eks_addon.vpc_cni[0])`, `service_account_role_arn` set;
  - auth `CONFIG_MAP -> API_AND_CONFIG_MAP`;
  - cluster version stays `1.31` (no `-> 1.34`);
  - node groups: with `node_group_name` pinned to the ladder target (`…-1-34-…`) while the live names are `…-20260508`, the plan shows **replace ×5**. This is AWS-valid and succeeds (the new nodes get a working CNI via `before_compute`), but it is a full node-group churn — accept it only if naming the node groups for the ladder target now (so the later 1.31→1.34 ladder is an in-place version bump, not another replace) is intended. For an in-place roll instead, pin `node_group_name` to the live `…-20260508` values. Decide before applying.
- **Step 5 — post-verify**: all 5 node groups ACTIVE on the target release, `aws-node` pods Running, `kubectl auth can-i '*' '*'` returns `yes`.

**Fallback — no code change.** If `before_compute` is not in the code, wire the add-on out-of-band between Step 3 and Step 4 — `aws eks update-addon --addon-name vpc-cni --service-account-role-arn <point-vpc-cni-aws-node ARN> --resolve-conflicts OVERWRITE` — then run the full apply.

Do NOT use a `-target` auth-mode flip on its own, and do NOT manually pre-create the `EC2_LINUX` node-role access entry — EKS creates that entry itself during the node-group update.

## 5. Lessons learned

- **A timeout is a messenger, not a cause.** `NodeCreationFailure` after ~15–20 min means "nodes never became Ready inside the health window" — diagnose the readiness path (CNI first), don't retry blind.
- **Never move a permission path and roll its consumers in one apply** when the IaC graph orders the new path's wiring *after* the consumers (module v21 applies add-ons after node groups). Wire first, roll second — and prefer fixing the ordering in code (`before_compute = true` reshapes the dependency graph) over patching it at apply time.
- **`-target` includes dependencies.** It narrows scope *downward* along the graph; it cannot reverse an ordering edge. The structural fix is to change the dependency edge in code (`before_compute`); an out-of-band API call (then letting Terraform converge) is the fallback escape when the code cannot be changed.
- **A `moved` block makes a same-module resource relabel safe.** Switching `before_compute` relocates the add-on (`aws_eks_addon.this` → `aws_eks_addon.before_compute`); a root-level `moved` block keeps it an in-place update instead of a destroy+create that, with `preserve = false`, would delete the live CNI.
- **Verify rollback states before concluding.** "ACTIVE + healthy" after a failed node-group update usually means "the old fleet is back", not "the change worked". Check ASG scaling activities and node ages.
- **Access entries instantly override aws-auth** — apply the in-cluster RBAC bindings *before* creating STANDARD entries for principals you depend on.
- **Enumerate and import out-of-band resources** (`aws eks list-access-entries`) before declaring them in Terraform.
