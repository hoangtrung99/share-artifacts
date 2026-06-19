# STG interdependency audit — cross-layer hardcoded-value couplings

**Purpose.** Systematic hunt (4-dimension parallel audit, 2026-06-18) for the class of bug where a value hardcoded in one layer (k8s manifest / NetworkPolicy / tfvars) MUST match a value provisioned in another layer (Terraform resource / live AWS), and the STG value is wrong, stale, missing, or unbacked. Triggered by the ec2-proxy ↔ NetworkPolicy `.96` finding. Source tip `origin/release/verup` `21c92487`; live checks via `point-operator-stg` (471112755246).

Verdict legend: 🔴 bug/blocker · 🟠 risk/ambiguous-needs-intent · 🟢 verified-consistent · ℹ️ note.

> **Live verification (2026-06-18).** The environment-side findings here were re-checked against live `471112755246` and consolidated, with two additional hard blocks newly confirmed (vpc_peering hardcoded `pcx-0c3d285e426241d9b` is NotFound in 471; Aurora live port is 3306 vs code 13306), in **`STG-ENV-BLOCKERS.md`** (B1–B6). F2 (regional ALB cert) and F3 (Ponta `/32`→VGW + verup-STG `/16`→peering route loss) are LIVE-CONFIRMED there. Use that file as the apply-gate list; this file remains the cross-layer method reference.

---

## 🔴 / 🟠 Findings (actionable)

### F1 🟠 — The "STG workload proxy" `10.51.187.96:3128` ≠ the `ec2-proxy` (bastion proxy). DESIGN-INTENT REQUIRED.
- `networkpolicy-allow-egress-vpc.yaml:60-66` adds a STG-NEW egress rule **"Ponta proxy used by STG workloads" → `10.51.187.96/32:3128`** (DEV has no such rule).
- The only `:3128` proxy in the migrated Terraform is **`ec2-proxy`** — but it is explicitly the **bastion** proxy: SG (`security_group/ec2_proxy.tf`) is described "Squid proxy **for bastion egress**", admits 3128 **only from the bastion SG** (no EKS-worker-SG ingress), gated on `old_bastion_enabled`, and its `proxy_private_ip` is unset (DHCP).
- ⟹ Pods cannot reach `ec2-proxy` on 3128 (SG blocks them), and nothing in the migrated code provisions a **workload** proxy at `.96`. So `.96` is one of: (A) `ec2-proxy` repurposed for workloads — then it needs **both** a `.96` IP pin **and** a worker-SG→3128 ingress rule; (B) a separate workload proxy not yet in the migrated code (gap); (C) an external/Ponta-managed proxy.
- **Impact on PR #107**: that PR pinned `ec2-proxy.proxy_private_ip = 10.51.187.96` on the assumption `.96` = ec2-proxy. Evidence says ec2-proxy is the *bastion* proxy, so that pin is likely wrong (and insufficient — the SG still blocks pods). **PR #107 is on hold pending the intent decision.** If ec2-proxy is intended to stay bastion-only, it should instead take a high free az1 IP for the bastion's stable `<ip>:3128` config (e.g. `.120`), and the `.96` workload-proxy is a separate open item.
- **Discriminating step**: ask the network owner what backs `10.51.187.96:3128` for workloads; or inspect a running reference env for what holds `.96`. Do NOT open the proxy SG to pods without that intent (security).

### F2 🔴 — ALB ingress needs a regional ACM cert for `*.backseat-service.com` that does not exist in STG.
- `ingress.yaml:26-27` TLS host `*.backseat-service.com`; the AWS LB controller discovers a matching **ap-northeast-1** ACM cert by SNI.
- No migrated component creates it: `init/acm/tfvars/stg.tfvars` has `enable_certificate_for_alb = false` (+ `_cloudfront = false`) and is scoped to `*.stg.backseat-service.com` (a `*.stg.` cert cannot match a `*.` host).
- **Live (471 / ap-northeast-1)**: the ONLY ACM cert is `stg.backseat-service.com` (+ SAN `*.stg.backseat-service.com`), **EXPIRED** (NotAfter 2025-12-27), `InUseBy: []`.
- ⟹ The STG ALB HTTPS:443 listener would have no usable cert → ingress reconcile fails. **Apply-time prereq**: import/provision a valid regional `*.backseat-service.com` (or apex-covering) cert in 471/ap-northeast-1 before the k8s ingress / ALB cutover. This is the **regional** (ALB) analogue of the us-east-1 (CloudFront) cert blockers G6/G11 — a distinct, additional cert.

### F3 🟠 — Ponta `10.50.0.121/32 → VGW` host route is lost on HULFT's az2 subnet during vpc apply.
- HULFT EC2 (`10.51.187.138`) is in `point-private-subnet-apne1-az2` — one of the az2/az4 subnets whose RT association vpc #8 switches to a new per-AZ RT.
- Live `rtb-0241362c6cf0dbaa2` carries an **unmanaged** `10.50.0.121/32 → vgw-0c33e00d8d13702e0` override (longest-prefix wins over the managed `10.50.0.0/16 → NAT`). The new per-AZ RT only has the `/16 → NAT` route → HULFT→Ponta peer `10.50.0.121` flips **VGW → NAT**.
- `10.50.0.121` = `ec2-hulft` `ponta_hulft_ip` (the HULFT batch far-end). The CoreDNS Ponta hosts `10.50.0.114` / `10.50.2.25` are **NOT** at risk (no /32 override; they already ride `/16 → NAT`).
- The parallel `172.19.0.0/16 → pcx-0ce5c02bb35a7bd32` (verup-STG) route on the same RT faces the same loss.
- **Action**: before vpc #8, decide — re-add the `/32 → VGW` (and `/16 → pcx`) routes on the new az2/az4 RTs post-apply, OR confirm the `/16 → NAT` path reaches the Ponta far-end, OR confirm Ponta-via-VGW is sunset. (Operator-must-preserve; not auto-break. vpc Gate 3 = insufficient evidence.)

### F4 🟠 — `eks` access-entry `group_users` is overridden (not merged) by stg.tfvars → admin `bs-developer` dropped.
- `eks_access_entries` is set in BOTH `terraform.tfvars` and `tfvars/stg.tfvars`. Terraform replaces object variables wholesale across var-files (no deep merge), so the effective STG `group_users = {viewer: ["bs-operator"]}` — the shared `admin: ["bs-developer"]` is dropped.
- ⟹ In STG, only `bs-operator` (viewer) gets an access entry; `bs-developer` (admin) does not. The eks evaluation assumed both users active. **Verify intent before the API-mode flip** (#21b): who is the admin principal in STG? If `bs-developer` should have admin in STG, add it to the stg.tfvars `group_users`.

### F5 ℹ️🟠 — `ec2-hulft` is a live, load-bearing STG dependency, excluded from the apply set (correctly) but must be documented.
- The HULFT EC2 (`i-042325ebdb8991aa9`, `10.51.187.138`) is **already running** in 471. It backs: `aws-nfs-pv.yaml` (`nfs-hulft-pv` server `.138`), `k8s_apply.sh --set nfs.server`, and the `point-worker` pod NFS mount `/nfs/hulft`; plus Ponta IF-007/008.
- Its only STG terraform change is a `user_data` regression (cron-vs-inotifywait) on the running instance → applying it is undesirable. **Keep it out of the apply set, but treat HULFT as a required live dependency** (worker NFS mount + Ponta), not "out of scope". Do not let its IP `.138` be taken by anything else.

---

## ℹ️ Notes (verified, low/no action)

- **N1** — WhaleFin PrivateLink: a vpc apply (`whalefin_enabled=true`) creates an endpoint to external service `vpce-svc-00a0e0c495bfbaf62` (WhaleFin account `933277528084`, `AcceptanceRequired=true`); STG domain `aws-private-alpha.whalefin.com`. Operator-gated on WhaleFin-side acceptance. Not a leak.
- **N2** — Hardcoded EKS-ALB target-group ARNs in `cloudwatch_alarm/stg.tfvars` (3) + `frontend-customer/stg.tfvars` (1) all resolve live in 471, but the hashes are **mutable** (change if the ALB/Ingress is recreated) — re-verify before those applies.
- **N3** — `module.config` cross-account `211125716602` is intentional (point-prd aggregator) → DEFER with `-target` (already in spine row 2). Custodian trust `590183696997` is correct in both tfvars and the spine.

## 🟢 Verified consistent (the bulk — no action)
- **Account purity**: every ARN/registry/IRSA in the STG manifests is `471112755246`; zero `905`/`520`/`845` leak.
- **IRSA / aws-auth / ECR creators**: every role/repo/SG referenced by a manifest has a Terraform creator (`point-app-irsa-role`, `point-cloudwatch-agent-irsa-role`, `point-cluster-autoscaler-irsa-role`, `point-aws-load-balancer-controller`, `eks-worker-role`, custodian roles, `point-bastion-role`, 5 ECR repos, `alb-https-sg`). The eks-created ones are blocked only by the eks dead-var (PR #104) + iam greenfield (PR #105), not missing.
- **NetworkPolicy ports**: Aurora `13306` (correctly the flipped port — no stale `3306`), Redis `6379`, Redshift `5439`, HTTPS `443`, SES `587`, ingress `8080/8082` — all match the SG rules + service/container ports.
- **NFS PV `.138`** = `ec2-hulft` `hulft_private_ip` (match). **CoreDNS Ponta `.114`/`.25`** routable via `vpc/ponta.tf` `10.50.0.0/16 → NAT`.
- **AMIs**: ec2-hulft `ami-079afcf5cd43a7b5d` (Owner 471, running), ec2-data-transfer `ami-03598bf9d15814511` (public) — both resolve.

---

## Excluded-component reconciliation (stg.tfvars present, not in the 46-target plan)
| component | verdict |
|---|---|
| ec2-hulft | IN scope, live dependency (F5) — keep out of apply (user_data regression) but document |
| waf-maintenance | **already IN the spine (row 13)** — not actually excluded |
| waf-admin-private | defer-with-verify (`enable_waf=true`, expect 0/0/0 vs live) |
| cloudwatch_loggroup / _errorlog_lambda / _circuitbreaker_lambda | already converged in 471 → verify 0/0/0, no apply |
| cloudwatch_to_s3 | `cloudwatch_to_s3_enabled=false` → genuinely out-of-scope (dormant) |
| schedule-costsaver-lambda | dormant feature; function NOT present in 471 → a pending `+N` create if enabled, not a no-op |

---

## Method (for the PRD audit later)
The bug class = a hardcoded **value** (IP/CIDR/port/ARN/account/hostname/resource-id) in layer X that must equal a **provisioned** value in layer Y. Hunt it by: (1) grep all manifests + tfvars for IPs / account-ids / `arn:` / `pcx-|ami-|sg-|subnet-|vpce-|eipalloc-`; (2) for each, find the layer-Y resource it must match; (3) verify match against code + live; (4) classify match/mismatch/missing/unbacked/external. Re-run this for PRD before the PRD release doc.
