# STG environment-side blockers — live-verified against point-stg (471112755246)

**Question answered.** "Are there blockers coming from the point-stg *environment* itself?" — i.e. live state in the apply target account `471112755246` that conflicts with what the migrated `release/verup` code assumes. Yes — six, classified below. All checks were read-only via `point-operator-stg`, `ap-northeast-1`, on 2026-06-18 against source tip `origin/release/verup`; the destroy/replace verdicts (B3/B4) are taken from the **actual STG plan output**, not inferred.

**At a glance**: 🔴 **B1** wallet-peering ID absent (apply fails) · 🔴 **B2** regional ALB cert absent (k8s cutover) · 🟣 **B3** ElastiCache **REPLACE** (plan-confirmed, the one true destructive CRIT) · 🟠 **B4** Aurora port reboot in-place (disruptive, no data loss) · 🟠 **B5** vpc apply drops Ponta/peering routes · 🔴 **B6** EKS 1.31→1.34 skip-version rejected + auth flip.

Live anchors verified this run:
- Account `471112755246` (`bs-operator`).
- VPC `vpc-08888557d0bd0cead`, primary `10.51.187.0/24` (**single /24, no secondary `100.64.0.0/16` yet**).
- EKS cluster `point` ACTIVE, **version 1.31**, **authenticationMode CONFIG_MAP**, platform `eks.61`.
- Aurora `point` (`point-1`/`point-2`) aurora-mysql `8.0.mysql_aurora.3.04.0`, **Port 3306**, no RDS proxy.
- ElastiCache replication group `point` (`point-001`/`point-002`) redis `6.2.6`, `cache.m5.large`, **TransitEncryptionEnabled=false, AuthTokenEnabled=false**.
- ec2-hulft `i-042325ebdb8991aa9` **running**, `10.51.187.138`, `c5.xlarge`, `ami-079afcf5cd43a7b5d`.

Severity legend: 🔴 hard block (apply fails) · 🟣 CRIT destructive (apply succeeds but destroys/disrupts) · 🟠 route/state loss or cutover risk (operator-must-preserve).

---

## 🔴 B1 — `vpc_peering` accepter targets a `from_wallet` peering ID absent in 471 (apply-time, cross-account)
- **Code**: `terraform/components/vpc_peering/tfvars/stg.tfvars:5` → `peer_requester_peering_connection_id = "pcx-0c3d285e426241d9b"`, consumed in `vpc_peering/peer.tf` by an `aws_vpc_peering_connection_accepter` — the STG side **accepts** a peering the *wallet* account requests (plan tags it `Name = "from_wallet_stg"`).
- **Plan vs live**: the STG plan **passes** (`Plan: 3 to add` — an accepter does not validate the ID at plan time). But live `describe-vpc-peering-connections` in 471 returns **only** `pcx-0ce5c02bb35a7bd32` (the verup-STG peering, `471 ⇄ 520`, `172.19/16`). `pcx-0c3d285e426241d9b` is **absent in every state** → **apply fails** accepting a non-existent connection.
- **Why stale**: the peering ID is allocated by the *requester* (the wallet account). `pcx-0c3d285e426241d9b` is a leftover from another environment; the wallet→point-STG peering has not been requested into 471 yet (or will get a different ID).
- **Fix (cross-account coordination)**: the wallet account **requests** the peering into 471 first; take the **real** `pcx-…` it produces, set it in `stg.tfvars`, then apply the accepter. **Do not substitute `pcx-0ce5c02bb35a7bd32`** — that is the verup-STG peering, a different connection.

## 🔴 B2 — ALB ingress needs a regional `*.backseat-service.com` cert that is absent (k8s cutover prereq)
- **Code**: `k8s-manifests/point/stg/ingress.yaml` TLS host `*.backseat-service.com`, **no `certificate-arn` annotation** → AWS LB Controller must discover a matching cert in-region by SNI.
- **Live `ap-northeast-1` ACM**: the only cert is `stg.backseat-service.com` (SAN `*.stg.backseat-service.com`), **EXPIRED** (NotAfter 2025-12-27), AMAZON_ISSUED, `InUseBy: []`. A `*.stg.` cert cannot match the `*.backseat-service.com` host, and it is expired regardless.
- **Impact**: the ALB HTTPS:443 listener has no usable cert → ingress reconcile fails when the migrated workloads + ingress are applied. This is the **regional** analogue of the CloudFront (us-east-1) cert blockers — a distinct, additional cert.
- **Fix**: before the k8s ingress apply, import/issue a valid regional `*.backseat-service.com` (or apex-covering) cert in `471/ap-northeast-1`; or pin `alb.ingress.kubernetes.io/certificate-arn` to a known-good cert.

## 🟣 B3 — ElastiCache replication group is REPLACED (plan-confirmed destroy/recreate)
- **Plan (ground truth)**: `aws_elasticache_replication_group.point` **must be replaced** — `Plan: 5 to add, 0 to change, 2 to destroy`. Three attributes each force the replacement: `at_rest_encryption_enabled false → true`, `transit_encryption_enabled false → true`, and a new `kms_key_id (known after apply)`. The Redis secret version is also replaced.
- **Live**: redis `6.2.6`, both encryption flags currently `false`.
- **Why unavoidable in-place**: at-rest encryption can **never** be toggled on an existing cluster (any engine version); in-transit toggling in place needs Redis OSS **≥ 7.0.5** and `6.2.6` is below that — so either flag alone forces a destroy/recreate → cache flush, brief outage, new endpoint. The component also flips the app's `SPRING_DATA_REDIS_SSL` to `"true"`.
- **Fix (DBA/infra decision)**: accept the replace in a maintenance window (cache is rebuildable), or upgrade engine + redesign to shrink the window; coordinate the cutover with the app's Redis-SSL flag flip. This is the plan's confirmed CRIT.

## 🟠 B4 — Aurora port flip 3306 → 13306 is an in-place reboot (disruptive, NOT destructive — DBA-gated)
- **Plan (ground truth)**: `module.rds_aurora.aws_rds_cluster.this[0]` and both instances are **updated in-place**; the global cluster is updated in-place; only `aws_secretsmanager_secret_version.this` is replaced (`Plan: 2 to add, 4 to change, 1 to destroy` — the lone destroy is the **secret version, not the cluster**). **No data loss.**
- **Live**: cluster `point` answers on **3306**, no RDS proxy; code (`aurora/tfvars/stg.tfvars port = 13306`), NetworkPolicy egress, SG and app all target **13306**.
- **Impact**: the in-place `modify-db-cluster` port change reboots the cluster (brief outage). Until it flips, the app + NetworkPolicy + SG (all on 13306) cannot reach a DB still serving 3306 → the **skew window** is the real risk, not data loss. HIGH/coordination — gated behind the DBA Aurora-cutover sign-off.
- **Fix**: sequence the port modify with the app rollout so "what the app dials" and "what the DB listens on" flip together; schedule the reboot in a window.

## 🟠 B5 — vpc apply drops the Ponta `/32 → VGW` and verup-STG `/16 → peering` routes
- **Live private RT `rtb-0241362c6cf0dbaa2`** (subnets `subnet-010dd0d8b76212d7b`, `subnet-0c15db36f557670be`, `subnet-005d982175e7f1416`) carries **unmanaged** routes:
  - `10.50.0.121/32 → vgw-0c33e00d8d13702e0` (Ponta HULFT far-end; the /32 beats the managed `10.50.0.0/16 → NAT`).
  - `172.19.0.0/16 → pcx-0ce5c02bb35a7bd32` (verup-STG).
- The public RT `rtb-044e51b3d013e94e4` additionally routes `10.48/10.50/10.52.0.0/16 → vgw-0c33e00d8d13702e0`.
- The migrated vpc per-AZ RT defines only `10.50.0.0/16 → NAT` (no /32, no peering route) → on RT replacement those two routes are **lost**: HULFT→Ponta `10.50.0.121` flips VGW→NAT, and verup-STG `172.19/16` becomes unreachable from these subnets.
- **Fix**: before/after vpc apply, re-add `10.50.0.121/32 → VGW` and `172.19.0.0/16 → pcx-0ce5c02bb35a7bd32` on the new RTs, OR confirm the `/16 → NAT` path reaches the Ponta far-end, OR confirm the VGW/peering legs are being sunset.

## 🔴 B6 — EKS targets 1.34 against a live 1.31 cluster (skip-version upgrade is rejected) + CONFIG_MAP→API flip lockout
- **Live**: cluster `point` ACTIVE, version **1.31**, `authenticationMode=CONFIG_MAP`.
- **Code**: `eks/tfvars/stg.tfvars` → `cluster_version = "1.34"`, `cluster_node_version = "1.34"` (+ 1.34-era addon versions: vpc-cni `v1.21.1`, kube-proxy `v1.34.6`, coredns `v1.13.2`, …).
- **Hard block (version ladder)**: EKS does **not** allow skipping minor versions — the cluster must climb `1.31 → 1.32 → 1.33 → 1.34` one minor at a time (control plane then nodes each step). A single apply jumping 1.31→1.34 is rejected by the API. This is the EKS-ladder track: run the 3 sequential upgrades **before** applying the 1.34 tfvars wholesale.
- **Cutover risk (auth)**: the migrated access-entry blocks are no-op while CONFIG_MAP; the CONFIG_MAP→API flip drops the current `aws-auth` admin principal — pre-stage access entries + RBAC for cicd/admin/operator/viewer and keep an escape-hatch cluster-admin role, or you lock yourself out.

---

## Not blockers (verified) / lower-priority
- **CloudFront cert is fine.** `us-east-1` has `*.backseat-service.com` **ISSUED, IMPORTED** (`d836a32c`, exp 2026-10-29) in use by 2 distributions (`E16LHOS2AUK5I2`, `E1VP7LQFILGZGL`), plus a second **ISSUED, AMAZON_ISSUED** (`3ecd4e08`). The frontend ACM data source matches **both** ISSUED certs → the `types=["IMPORTED"]` filter is required and correct (narrows to the in-use `d836a32c`).
- **ec2-hulft is a live dependency, not a block** — keep it out of the apply set (its only STG diff is a `user_data` regression) and do not let `10.51.187.138` be reassigned. It backs the worker NFS mount + Ponta IF.
- **VPC IP headroom**: the target VPC is a single `/24` (`10.51.187.0/24`) with no secondary `100.64.0.0/16`. glue-etl and any secondary-pool consumer stay blocked-on-upstream until vpc provisions subnets/secondary CIDR; subnet headroom is tight.
- **F1 proxy `10.51.187.96:3128`** — still an open design-intent question (nothing live backs `.96`; the `ec2-proxy` SG admits 3128 from the bastion only). PR pinning `.96` remains on hold pending the network owner's intent. See `INTERDEPENDENCY-AUDIT.md` F1.
- **Cross-account acceptances**: WhaleFin PrivateLink (`vpce-svc-00a0e0c495bfbaf62`, conditional on `whalefin_enabled`) needs WhaleFin-side acceptance; the `module.config` aggregator trust to `211125716602` is deferred with `-target`.

## Not checked — "six blocks" is NOT exhaustive (read-only limits)
These were out of read-only reach and could surface *additional* blocks at apply time:
- **SCP / Organization policy denies** — cannot be enumerated from a member account; an explicit org-level deny only shows when the apply call is made.
- **STG bastion instance-role create-permission** — read-only can't prove the role can actually `Create*`/`Modify*` each resource; a permission gap surfaces only on apply. Run a dry-run / `-target` smoke apply on one foundation component first.
- **Service quotas** (NAT GW / EIP / VPC / EKS nodegroup) — not queried. Note the VPC already runs 2 NAT GWs (`nat-05a44f3f65aafb7f8`, `nat-0a1fa6c0b5e644a2f`); a `/24` VPC has limited subnet headroom.

## How these were checked (for the PRD pass)
Each finding pairs a **code value** (`*.tf` / `*.tfvars` / k8s manifest on `release/verup`) with a **live value** in the apply account (ACM, EC2 route tables / peering / instances, EKS, RDS, ElastiCache), then classifies: missing (B1/B2), destructive (B3/B4), or lost-on-replace (B5/B6). Re-run the same pairing against the PRD account before the PRD release doc.
