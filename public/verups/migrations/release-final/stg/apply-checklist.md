# release/verup → point STG — apply checklist (go/no-go gates)

Go/no-go gate checklist for the verup → point migration apply into **point-stg `471112755246`**. It is the gate layer on top of the canonical spine (`apply-order-CANONICAL.md`) — the spine owns the exact apply order, per-row plan counts, and risk; this file owns the **cross-cutting gates** that must be green and the **per-component go/no-go cards**.

- **Account**: `471112755246` (point-stg). Confirm once on the bastion (see **G-acct**).
- **How apply runs**: on the **STG bastion via its instance role** → all apply/after-check commands are **`--profile`-free**; `--env stg` selects the tfvars var-file + S3 state backend only. Terraform always via the wrapper: from `terraform/components/<c>/` (or `terraform/infra/<c>/`), run `../../terraform.sh --env stg init|plan|apply`. Never raw `terraform apply --tfvar`.
- **Local read-only re-plan / after-check** (engineer workstation, not the bastion): prepend `export AWS_PROFILE=point-operator-stg`, then the same `../../terraform.sh --env stg plan`. The wrapper does not recognise the profile *name*, but the AWS provider/CLI consume `AWS_PROFILE` natively. Never use `bs-point-stg` — that is the verup-STG source account being sunset; the migration never applies into it.
- **Region**: `ap-northeast-1`. CloudFront / ACM / WAF-CLOUDFRONT live in **`us-east-1`** — switch region for those checks. All windows **JST**.
- **Plan tip**: `release/verup` `21c92487`.

**Gate model.** Every gate below has a concrete check + a pass criterion. A gate is one of:

- **CODE** — a code defect that fails `terraform plan` at this tip. Three exist (G-code-1/2/3); each is a hard blocker for its component and must be fixed in `release/verup` and re-planned green before that component's window.
- **PREREQ** — an ordering/state prerequisite (an upstream apply, an import, an out-of-band resource). Most `plan_failed` rows in the spine are blocked-on-upstream and clear automatically as the spine runs; PREREQ gates are the ones that need an explicit operator action.
- **SIGN-OFF** — a human decision (CTO/DBA/analytics/ops) required before a destructive stateful row.

**Rule: all gates that a component lists must be green before that component's window opens.** The per-component cards (bottom) name the gate(s) each row depends on.

**Environment-side block coverage (`STG-ENV-BLOCKERS.md` B1–B6 → gate).** Every live-environment block found against `471112755246` maps to a gate here:

| Block | What | Gate / card |
|-------|------|-------------|
| **B1** | wallet-peering ID `pcx-0c3d285e426241d9b` absent (apply fails) | **G-peer** (#9) + Open question #1 |
| **B2** | regional ALB cert `*.backseat-service.com` absent (only EXPIRED `*.stg.`) | **G-alb-cert** (NEW) → #10 ingress / #25 |
| **B3** | ElastiCache replication group REPLACED (encryption flip) | **#17** + **G-stateful-signoff** — handled in the maint window |
| **B4** | Aurora port `3306→13306` in-place reboot (no data loss) | **#19** + **G-stateful-signoff** — handled in the maint window |
| **B5** | vpc apply drops Ponta `/32→VGW` + verup-STG `/16→peering` routes | **G-vpc-routes** (#8) + Open question #2 — **pending operator review** |
| **B6** | EKS targets 1.34 vs live 1.31 (skip-version) + CONFIG_MAP→API flip | **G-eks-ver** + **G-eks-prereq** (#21/#21b) + ladder #22–#24 |

---

## Pre-apply gates (G-series)

### G-acct — account guard (all rows)

- **Check** (on the STG bastion): `aws sts get-caller-identity`
- **Pass**: `Account` = `471112755246`. (No `--profile` on the bastion — credential is the instance role.) For a local read-only after-check: `aws sts get-caller-identity --profile point-operator-stg` → `471112755246`.
- **STOP if**: any other account is returned. Mixing accounts is the most common foot-gun.

### G-code-1 — eks `cluster_node_ami_type` dead variable (blocks #21)

A genuine code defect — `eks` plan exits 1 at this tip (a regression introduced after the DEV apply).

- **Defect**: `variables.tf:55` declares `cluster_node_ami_type = string` as a **required** field in the `eks` object, but it is never referenced in any `.tf` file and is absent from `stg.tfvars` → `terraform plan` errors `attribute "cluster_node_ami_type" is required`.
- **Fix** (in `release/verup`, before #21's window): make it `optional(string, "")` or remove the declaration. Do **not** add it to `stg.tfvars` — the field is unused.
- **Verify**: re-plan and confirm the `attribute "cluster_node_ami_type" is required` error is gone.
  ```
  export AWS_PROFILE=point-operator-stg   # local read-only re-plan only
  cd terraform/components/eks && ../../terraform.sh --env stg plan
  ```
- **Pass**: plan reaches exit 2 (a plan, not an error). **STOP** #21 until green.

### G-code-2 — iam `data.aws_iam_policy.viewer` greenfield lookup (blocks #1)

`infra/iam` plan exits 1 after 15 partial adds at this tip.

- **Defect**: `role-OperatorRole.tf:48` resolves `data.aws_iam_policy.viewer[0]` → `custodian-ViewerRolePolicy` from live AWS at plan time. That policy is **created by this same config** (`aws_iam_policy.ViewerRole` in `role-ViewerRole.tf`) — a circular dependency that only resolves if a copy already exists in the account.
- **Evidence — why DEV passed but STG fails (PR #105 IS necessary)**: at DEV the data source resolved because `custodian-ViewerRolePolicy` **pre-existed** in `905` (bs-custodian pre-bootstrap) → DEV first plan was clean `+16`, then import-first. On `471` that policy does **not** exist (`get-policy … custodian-ViewerRolePolicy` → `NoSuchEntity`; zero local `custodian-*` policies), so the **actual STG plan failed**: `data.aws_iam_policy.viewer[0]` hung ~2 min then `Error: no matching IAM Policy found` after `Plan: 15 to add`. The DEV success does not transfer — it depended on a precondition absent in `471`.
- **Fix** (PR — in `release/verup`, before #1's window): replace `data.aws_iam_policy.viewer[0].arn` with `aws_iam_policy.ViewerRole[0].arn` and remove the `data "aws_iam_policy" "viewer"` block. Verified safe: STG tfvars has `OperatorRole-enabled=true` **and** `ViewerRole-enabled=true`, so `aws_iam_policy.ViewerRole[0]` is a valid index; `terraform validate` passes. (Alternative — bootstrap the policy out-of-band like DEV — is fragile/circular; the resource ref is the correct fix.)
- **Verify**: `cd terraform/infra/iam && ../../terraform.sh --env stg plan` (prepend `export AWS_PROFILE=point-operator-stg` for a local read-only run).
- **Pass**: plan reaches exit 2 (no `no matching IAM Policy found`), `+16`. **STOP** #1 until green. (This gate also gates the iam import step — see **G-iam-import**.)

### G-code-3 — frontend-customer ACM ambiguity + STG manual-resource guard (blocks #38)

`frontend-customer` plan exits 1 at this tip on an ambiguous ACM data-source, **and** STG has manually-created frontend resources that must not be destroyed.

- **Defect**: `data.tf:1` queries us-east-1 for `*.backseat-service.com` with `statuses=["ISSUED"]` and **no `types` filter** → matches **2 ISSUED** certs: AMAZON_ISSUED `3ecd4e08` (InUse:false) + IMPORTED `d836a32c` (InUse:true) → exit 1.
- **Fix** (in `release/verup`, before #38's window): add `types=["IMPORTED"]` to `data.tf` to deterministically select the in-use cert. Do **not** use `most_recent` (renewal-order-dependent). `init/acm` #0 does not resolve this — it only touches ap-northeast-1 ALB certs.
- **Verify**: `cd terraform/components/frontend-customer && ../../terraform.sh --env stg plan` (prepend `export AWS_PROFILE=point-operator-stg` locally).
- **Pass**: data-source resolves exactly 1 cert (`d836a32c`); plan reaches `+10/~5/-2` (the `-2` = S3 ACL sub-resources, non-stateful). Provider is already v6.14.1 (no provider-bug blocker).
- **DO-NOT-TOUCH (STG-only)**: STG customer-frontend carries **manually-created proxy + OAuth resources** (a verup-STG bridge that does not exist in code). The frontend-customer apply must **not** clobber or destroy them — review the plan and confirm no destroy/replace lands on those resources before applying. **STOP** if the plan touches the manual proxy/OAuth resources.

### G-alb-cert — regional ALB cert import (`STG-ENV-BLOCKERS.md` B2; blocks #10 ingress / #25)

The STG ALB serves `*.backseat-service.com` (`k8s-manifests/point/stg/ingress.yaml` TLS host, **no `certificate-arn` annotation** → the ALB controller discovers a regional cert by SNI). `init/acm` #0 has `enable_certificate_for_alb=false` and **destroys** the deposed EXPIRED regional cert `b1d8ee2d` — Terraform does **not** create a replacement (certs are import-only). This is the **ap-northeast-1 (ALB)** analogue of the **us-east-1 (CloudFront)** cert handled by G-code-3 — a distinct, additional cert.

- **Live (`471` / ap-northeast-1)**: the only ACM cert is `stg.backseat-service.com` (+SAN `*.stg.backseat-service.com`), **EXPIRED** (NotAfter 2025-12-27), `InUseBy:[]`. A `*.stg.` cert cannot match the `*.backseat-service.com` host, and it is expired regardless → no usable regional cert.
- **Pre-step**: import a valid regional `*.backseat-service.com` (or apex-covering) cert into `471/ap-northeast-1` per the documented ACM cert-import procedure in the release runbook, **before** the ingress is applied (the ingress apply happens inside #10 step 2, and again at #25). Either rely on SNI discovery, or pin `alb.ingress.kubernetes.io/certificate-arn` to the imported ARN.
- **Check**: `aws acm list-certificates --region ap-northeast-1` shows an **ISSUED** `*.backseat-service.com` (or matching host) cert; `aws elbv2 describe-listeners` on `point-alb` HTTPS:443 references it.
- **Pass**: a valid regional cert exists and is selectable by the ingress host **before** #10's ingress step.
- **STOP if**: no valid regional cert when the ingress applies → the ALB HTTPS:443 listener reconcile fails. (Independent of G-code-3, which only resolves the us-east-1 CloudFront cert ambiguity.)

### G-eks-ver — EKS version pin to 1.31 (#21)

- **Check**: `eks/stg.tfvars` `cluster_version` and `cluster_node_version`.
- **Pass**: both = `1.31` (live STG cluster is 1.31; the ladder to 1.34 is rows #22–#24, one minor at a time). The tfvars currently reads `1.34`.
- **STOP if**: a plan shows `1.31 → 1.34` (a 3-minor direct jump — AWS rejects it). Pin to `1.31` first; climb the ladder via the per-version branches.

### G-eks-prereq — EKS bootstrap prerequisites (#21 / #21b)

All must be in place before the auth-mode flip, or the cluster deadlocks/locks out:

- **CNI IRSA**: `point-vpc-cni-aws-node` IRSA is absent on greenfield STG → `-target` create the IRSA role + attachment **first** (root-level target; won't drag node groups). Check: `aws iam get-role --role-name point-vpc-cni-aws-node` returns NoSuchEntity before, exists after the targeted create.
- **CNI deadlock fix in code**: `before_compute = true` on the vpc-cni addon + the `moved` block MUST be present in `release/verup` (the DEV incident: v21 ordered vpc-cni IRSA after the node roll → nodes never joined). Confirm both are in code before applying.
- **RBAC bindings**: `kubectl apply -f k8s-manifests/rbac/` (repo-root path) BEFORE the flip → the `admin`→cluster-admin binding must be live on the cluster, or API-mode lockout. Check: `kubectl get clusterrolebinding admin-cluster-admin`.
- **named_user is a live STG user**: verify the `eks_access_entries` `named_user` maps to an IAM user that exists in `471` (not a leaked DEV-era name). STG is CONFIG_MAP with **0 access entries** → the 409 import-collision likely won't fire, but still enumerate-and-import.

### G-eip — init/eip 3 EIPs before vpc (#0b → #8)

STG is multi-NAT (`single_nat_gateway=false`) → 3 EIPs, not 1.

- **Check** (before #8): `aws ec2 describe-addresses --filters "Name=tag:Name,Values=point-nat-apne1-az1,point-nat-apne1-az2,point-nat-apne1-az4" --region ap-northeast-1`
- **Pass**: all 3 named EIPs exist. `nat1` (`point-nat-apne1-az1` / `eipalloc-035c41eee4835b087`) already exists/in state; init/eip #0b **creates** the 2 missing (`-az2` + `-az4`). Apply #0b before #8 — `vpc` data-sources all 3 by name and plan_failed without `nat2`/`nat3`.
- **STOP if**: fewer than 3 after #0b applies — vpc #8 will fail at `data.aws_eip.nat2/nat3 NotFound`.

### G-vpc-ip — /24 free-IP headroom (#8)

STG VPC CIDR is `10.51.187.0/24` — a /24 (Risk #1, IP shortage, is acute). NACLs replace on all 9 subnets.

- **Check** (before/after #8, per subnet): `aws ec2 describe-subnets --filters "Name=vpc-id,Values=vpc-08888557d0bd0cead" --query 'Subnets[].{id:SubnetId,free:AvailableIpAddressCount}' --region ap-northeast-1`
- **Pass**: **≥7 free IPs per subnet** (ALB needs ≥8 free or it can go down). Do not reuse DEV's 223–249 numbers — the /24 subnets are far smaller.
- **STOP if**: any subnet has <7 free before the ALB-bearing apply.

### G-vpc-routes — 2 unmanaged route losses on #8 (`STG-ENV-BLOCKERS.md` B5; operator decision — PENDING REVIEW)

When az2/az4 subnets move to new per-AZ route tables, two **unmanaged** routes on `rtb-0241362c6cf0dbaa2` are lost and not reproduced:

1. `172.19.0.0/16 → pcx-0ce5c02bb35a7bd32` (verup-STG peering)
2. `10.50.0.121/32 → vgw-0c33e00d8d13702e0` (Ponta far-end host route)

- **Decision required** (see **Open questions**): re-add post-apply, enable `peer_enabled` in tfvars, or confirm both are sunset. Insufficient evidence they are sunset.
- **STOP if**: this is unresolved — losing an active Ponta/peering route silently breaks cross-account batch.

### G-hulft — hulft-sg 172.19/16 drain (#10)

security_group #10 removes the `172.19.0.0/16` ingress from `hulft-sg` — an **active** verup-STG cross-account path for HULFT/Ponta batch.

- **Decision required** (see **Open questions**): confirm the consumer is drained, or keep the CIDR via tfvars until verup decommission.
- **STOP if**: the consumer is still live and the CIDR is being removed.

### G-peer — vpc_peering wallet pcx pre-step (#9)

The plan is clean `+3` but the **apply fails**: hardcoded `pcx-0c3d285e426241d9b` (tag `from_wallet_stg`) is NotFound in `471`.

- **Pre-step**: the wallet account must send a fresh peering request to point-stg `vpc-08888557d0bd0cead` → capture the AWS-assigned pcx → update `stg.tfvars`. The existing `pcx-0ce5c02bb35a7bd32` (to verup-STG) is a different link (point-stg is the requester there) and is **not** reusable.
- **Check**: `aws ec2 describe-vpc-peering-connections --filters "Name=tag:Name,Values=from_wallet_stg" --region ap-northeast-1` returns the new pcx.
- **STOP if**: the pcx in `stg.tfvars` is NotFound — apply will throw `InvalidVpcPeeringConnectionID.NotFound`. **OPEN**: confirm STG peers to a wallet account at all (see Open questions).

### G-stateful-signoff — destructive stateful sign-offs (#17 / #18 / #19)

The three stateful rows are destructive and run in one maintenance block (single scale-to-0 at window start, single restore at window end — not per row). Each needs an explicit sign-off:

- **#17 elasticache** — CRITICAL: replication group **REPLACED** (immutable encryption flip + CMK); `snapshot_retention_limit=0` → **no backup to restore** → data wipe. ~12 min downtime; primary endpoint hostname changes (secret rotate + pod restart). **Ops sign-off on the cache wipe.** App must run Redis TLS (`SPRING_DATA_REDIS_SSL=true`).
- **#18 redshift** — HIGH: KMS dance (AWS-owned → CMK via `modify-cluster --no-encrypted` → wait → apply → ~9.5 min encrypt → `reboot-cluster` for `require_ssl`), ~30–60 min; subnet-group swap. **CTO + analytics sign-off.** Must settle `available` before glue-etl #20b.
- **#19 aurora** — CRITICAL: port `3306→13306` (~3 min reboot); both instances resize `db.r6g.xlarge→db.r6g.4xlarge` (`apply_immediately=true`, no healthy standby mid-apply); master-password secret rotate; `deletion_protection false→true`. **CTO + DBA sign-off.** Couple with SG #10 same window.
- **STOP if**: any of the three sign-offs is missing when its window opens.

### G-audit-config — infra/audit module.config DEFER (#2)

infra/audit plan bundles a point-native drift the verup migration does not introduce: `-2` destroy (`bs-aws-config-role` + attachment) + the recorder `role_arn` switch to `arn:aws:iam::211112…:role/cm-config-role-all-regions` (account `211125716602`).

- **Action**: apply the verup delta with `-target` (s3-access-logs, guardduty, waf-logs imports, log-retention bumps); **DEFER `module.config`** behind its own gate. The `211` trust is unverifiable from `point-operator-stg`.
- **Pass**: confirm `211125716602:cm-config-role-all-regions` exists and trusts `config.amazonaws.com` from `471` **before** converging config in a separate step (see Open questions). Also confirm the WAF object-lock `lock_retention_days=1` is intentional, not a transposition.
- **STOP if**: config is applied blind without the cross-account trust verified — Config recording can break.

### G-iam-import — custodian roles import-first (#1)

After **G-code-2** is fixed, follow the import-first pattern. **The STG import set differs from DEV — verified live against `471`:**

- **Live `471` state (2026-06-18)**: existing custodian **roles** = `custodian-AdministratorRole`, `custodian-CICDRole`, `custodian-OperatorRole`, **`custodian-OperatorViewerRole`**. Local custodian **policies** = **none** (and no `ssm_policy`).
- **Import exactly these 3 roles** (in order, breakglass first): `aws_iam_role.AdministratorRole[0]` ← `custodian-AdministratorRole`; `aws_iam_role.CICDRole[0]` ← `custodian-CICDRole`; `aws_iam_role.OperatorRole[0]` ← `custodian-OperatorRole`.
- **Do NOT import** `aws_iam_role.ViewerRole[0]` — the config creates `custodian-ViewerRole` (`ViewerRole-name`), but `471` only has `custodian-OperatorViewerRole` (a **different, unmanaged** role). The existing one is an orphan; leave it. ViewerRole is a **greenfield create**.
- **Import 0 policies** — unlike DEV (which imported `custodian-ViewerRolePolicy` + `ssm_policy`), neither exists in `471` → all policies (ViewerRolePolicy, ssm_policy, etc.) are **greenfield creates**. (This is also why G-code-2's data source fails here but not at DEV.)
- **Also confirm**: `user/cicd` exists in `471` (CICDRole trust). Trust principal `590183696997` (bs-custodian) is intentional.
- **STOP if**: an existing role (Admin/CICD/Operator) is not imported → `EntityAlreadyExists` mid-apply; or someone tries to import the non-existent ViewerRole/policies (will fail NoSuchEntity).

### G-waf-untaint — waf-customer untaint-recovery pre-stage (#39)

waf-customer (provider v6, CloudFront-scoped, us-east-1) can throw `Provider produced inconsistent result` mid-apply.

- **Pre-stage** the recovery: the DEV apply hit it on `country_restrict` + `core_rule_set` + `rate_limit_count` → the fix is **apply → `untaint` those 3 → re-apply**. `untaint` only works **after** the failed apply (the resource instance does not exist before).
- **Also pre-step**: re-detect the preflight Case (`scripts/preflight-renumber.sh --detect`) — STG may differ from DEV's Case 3; run the atomic renumber before apply to avoid `WAFInvalidParameterException`.
- **Pass**: the untaint-recovery steps are written into the window runbook before the window opens; banner posted ≥6h ahead.

---

## Open questions for the operator (decide before the relevant window)

These are human-decision items with insufficient evidence to resolve from the plan alone. Each blocks its row's go/no-go.

1. **VPC peering — does point-stg peer to a wallet account at all, and on what timeline?** (G-peer / #9). The hardcoded `pcx-0c3d285e426241d9b` is NotFound in `471`; a fresh wallet-side request to `vpc-08888557d0bd0cead` is required, then capture the AWS-assigned pcx and update `stg.tfvars`. `peer_requester_vpc_cidr` was empty in earlier tfvars — confirm STG peers before slotting #9.
2. **The 2 VPC route losses** (G-vpc-routes / #8). `172.19.0.0/16 → pcx-0ce5c02bb35a7bd32` (verup-STG peering) and `10.50.0.121/32 → vgw-0c33e00d8d13702e0` (Ponta far-end host route) are unmanaged and will not be reproduced on az2/az4 RT migration. Re-add post-apply, enable `peer_enabled` in tfvars, or confirm both are sunset.
3. **HULFT `172.19.0.0/16` drain** (G-hulft / #10). hulft-sg removes the ingress, an active verup-STG path for HULFT/Ponta batch. Confirm the consumer is drained, or keep the CIDR via tfvars until verup decommission.
4. **infra/audit `module.config` 211 trust** (G-audit-config / #2). The `211125716602:cm-config-role-all-regions` trust is unverifiable from `point-operator-stg` — get the account owner to confirm the role exists and trusts `config.amazonaws.com` from `471` before converging config.

> The spine's other two open items — the frontend-customer cert (`types=["IMPORTED"]`) and the iam custodian pre-existence — are covered by **G-code-3** and **G-iam-import** respectively; act on those gates.

---

## Per-component go/no-go cards

One card per canonical row (order + counts from the spine). `(forecast)` plan numbers are blocked-on-upstream and firm up as the upstream applies. **Window**: daytime unless marked maint.

### #0 — init/acm
- **Gates**: G-acct.
- **Plan**: `-3` (destroys the deposed EXPIRED ALB cert `b1d8ee2d` + 2 dangling validation CNAMEs; both cert-creation flags `false`).
- **STOP**: deposed cert `b1d8ee2d` still on any ALB listener (`describe-listeners | grep b1d8ee2d`); the apex `backseat-service.com` CNAME `[0]` must be retained. Does NOT touch us-east-1 certs — does not clear #38's ambiguity.

### #0b — init/eip
- **Gates**: G-acct, G-eip.
- **Plan**: `+2` (creates the 2 missing EIPs `-az2` + `-az4`; `-az1` already in state).
- **STOP**: fewer than 3 named EIPs after apply — vpc #8 fails. Apply BEFORE #8.

### #1 — infra/iam
- **Gates**: G-acct, **G-code-2** (blocking — plan exits 1 until fixed), G-iam-import.
- **Plan**: `+16` (forecast; partial `+15` exit 1 before the fix).
- **STOP**: G-code-2 not fixed; or a pre-existing custodian role not imported in order (AdministratorRole lockout).

### #1a — ec2-bastion
- **Gates**: G-acct; depends on #1, #8, #10.
- **Plan**: forecast (blocked on #1 — `custodian-AdministratorRolePolicy` NotFound until iam applies).
- **STOP**: replicate the user_data-reboot trap mitigation (edit to ignore user_data or accept a windowed reboot; `moved` block must be in `release/verup`); manual `growpart`+`resize2fs` after any root-vol bump.

### #1b — eice
- **Gates**: G-acct; depends on #1, #8, #10; functional: bastion sshd up (#1a).
- **Plan**: `+7` greenfield all-add. ~3.5–4 min endpoint create.
- **STOP**: STG bastion `sshd` disabled (DEV's was found disabled → EICE-SSH RST) — EICE only relays TCP 22. If `bastion-sg not found`, apply #10 first.

### #2 — infra/audit
- **Gates**: G-acct, **G-audit-config** (DEFER module.config); depends on #1.
- **Plan**: `+12/~7/-2` (+5 import). Creates `s3-access-logs.bs-point-stg` (hard prereq for the S3 + WAF rows) + GuardDuty features + waf-logs imports.
- **STOP**: applying `module.config` before the `211` trust is verified; or the WAF object-lock retention values are unintended.

### #3 — infra/ebs-security
- **Gates**: G-acct.
- **Plan**: `+2`. After-check `get-ebs-encryption-by-default=true`.
- **STOP**: none material.

### #4 — ecr
- **Gates**: G-acct; depends on #1.
- **Plan**: `+5` repo policies (repos must pre-exist). Account literal `471` in principals.
- **STOP**: repos absent. `AllowCICDPushPull` is inert until `eks-worker-role` exists (expected).

### #5 — sns-alert
- **Gates**: G-acct.
- **Plan**: `~1`.
- **STOP**: `lambda_function.zip` is not a known-good sns-to-slack build.

### #6 — notification-global
- **Gates**: G-acct; depends on #5.
- **Plan**: `0/0/0` (already converged). Operator accepts broadened all-region Health alerts.
- **STOP**: none.

### #7 — notification
- **Gates**: G-acct; depends on #5, #12, #12b. **DEFER past #12b** despite position.
- **Plan**: `+1` clean (STG already has the alert-lambda topic + lambda live; the #12b chain is satisfied).
- **STOP**: run after #12b. Aurora event subscription lands with aurora (#19).

### #8 — vpc
- **Gates**: G-acct, G-eip (the 2 EIPs), **G-vpc-ip** (/24 ≥7 free), **G-vpc-routes** (2 route losses). **maint window.**
- **Plan**: `+39/~3/-1` (forecast; blocked on #0b EIPs). The `-1` is the default-NACL **state migration** (physical `acl-0a9983286ac6c8cf1` retained). NACLs replace on all 9 subnets.
- **STOP**: <7 free IPs/subnet; the 2 unmanaged routes unresolved. **Apply from laptop/CI, NOT the bastion** (NACL change → mid-apply lockout risk).

### #9 — vpc_peering
- **Gates**: G-acct, **G-peer** (wallet pcx pre-step); depends on #8.
- **Plan**: `+3` clean (accepter + 2 routes for `192.168.0.0/16`) **but apply FAILS** until the pcx exists.
- **STOP**: `pcx-0c3d285e426241d9b` (or the new wallet pcx) NotFound in `471`. OPEN: confirm STG peers at all.

### #10 — security_group
- **Gates**: G-acct, **G-hulft** (172.19/16 drain), **G-alb-cert** (regional cert before the step-2 `kubectl apply ingress.yaml`); depends on #8; eks-running ALB. **maint window.**
- **Plan**: `+23/~2/-5/⟳7`. **3-step controller-driven swap**: (1) `-target` create `alb-https-sg`; (2) `kubectl apply ingress.yaml` (ALB controller re-attaches → detaches `alb-sg`); (3) full apply drops `alb-sg` (`sg-0d6ee86d12b188ab0`). Direct destroy → DependencyViolation.
- **STOP**: **MANDATORY pre-check** — `kubectl -n kube-system get svc aws-load-balancer-webhook-service -o jsonpath='{.spec.selector}'`; pre-patch the rogue `app.kubernetes.io/component` key if present (0-endpoints incident). MySQL/Redis/Redshift rules flip to port **13306** + Dalian `45.78.58.128/32` → `100.64.0.0/16`. Couple with aurora #19 same window.

### #11 — endpoints
- **Gates**: G-acct; depends on #8, #10.
- **Plan**: `+5/~10` clean (5 new endpoints incl email-smtp 587, kms, monitoring, sts, ecr.api; 10 policy tightenings). Account `471` literal in every policy.
- **STOP**: email-smtp 587 path stays dead until #10 lands the 587 ingress (expected, not a failure).

### #12 — secrets_manager
- **Gates**: G-acct.
- **Plan**: `0/0/0` (already converged). If a fresh plan shows a NEW secret, `put-secret-value` the placeholder.
- **STOP**: app must port `SecretsEnvironmentPostProcessor` (CSI `/mnt/secrets-store/`) before pods consume new secrets.

### #12b — event-notification
- **Gates**: G-acct; depends on #12.
- **Plan**: `0/0/0` — STG `471` already has SNS topic `alert-lambda-event-notification` + the to-slack lambda + secret live (unlike DEV, which had to create them). Satisfies the #7 chain.
- **STOP**: none.

### #13 — waf-maintenance
- **Gates**: G-acct.
- **Plan**: `~2` in-place.
- **STOP**: verify the env-specific IP set.

### #14 — waf-admin
- **Gates**: G-acct; depends on #2.
- **Plan**: `+2/~3` IP-set rotation.
- **STOP**: be on `release/verup`, pulled (`git pull` needs a PAT), before apply. STG `allow-ipv4` differs — never copy DEV IPs; cross-check removed IPs vs STG NAT/bastion egress.

### #15 — waf-athena
- **Gates**: G-acct; depends on #2.
- **Plan**: `+3` (workgroup+db+table, provider v6.50). Account `471` literal in the Glue table location.
- **STOP**: verify `aws-waf-logs.bs-point-stg` not in REPLACE. Empty until waf-customer #39 lands the log source (expected).

### #16 — s3-maintenance
- **Gates**: G-acct.
- **Plan**: `+2/-1`.
- **STOP**: if `maintenance.bs-point-stg` has a public-read ACL → pre-strip `aws s3api put-bucket-acl --acl private` to avoid the `InvalidBucketAclWithObjectOwnership` half-fail.

### #17 — elasticache
- **Gates**: G-acct, **G-stateful-signoff** (ops, cache wipe); depends on #10. **CRITICAL · maint window.**
- **Plan**: `+3/⟳2` — replication group REPLACED (immutable encryption flip + CMK); `snapshot_retention_limit=0` → no backup → **data wipe**. ~12 min downtime; primary endpoint hostname changes.
- **STOP**: no ops sign-off; app not on Redis TLS. Scale deploys to 0; rotate secret + restart pods after.

### #18 — redshift
- **Gates**: G-acct, **G-stateful-signoff** (CTO + analytics); same window as #17/#19. **HIGH · maint window.**
- **Plan**: `+2/~4` — `kms_key_id` AWS-owned → new CMK via the disable-dance (`modify-cluster --no-encrypted` → wait → apply → ~9.5 min encrypt → `reboot-cluster` for `require_ssl false→true`); subnet-group swap. `init -upgrade` to aws v5 already done.
- **STOP**: no CTO/analytics sign-off. After: re-run `redshift-refresh-spring-boot-secret.sh` from a FRESH checkout (URL gets `?ssl=true&sslmode=verify-ca`). Must settle `available` before glue-etl #20b.

### #19 — aurora
- **Gates**: G-acct, **G-stateful-signoff** (CTO + DBA); couple with #10. **CRITICAL · maint window.**
- **Plan**: `+2/~4/-1/⟳1` — port `3306→13306` (~3 min reboot); both instances resize `db.r6g.xlarge→db.r6g.4xlarge` (`apply_immediately=true`, no healthy standby mid-apply); master-password secret_version replace; `deletion_protection false→true`; new `alias/point-aurora`. STG KMS policy already clean.
- **STOP**: no CTO/DBA sign-off. Scale deploys to 0. Post-apply: `aurora-update-port-in-secrets.sh` + `aurora-update-spring-boot-secret.sh` (URL @13306, FRESH checkout).

### #20 — aurora validate_password
- **Gates**: G-acct; depends on #19; same window (chained). State-less (not in TF).
- **Plan**: n/a (bastion scripts). INSTALL PLUGIN via `aurora-install-validate-password.sh`.
- **STOP**: **rotate password BEFORE install** (DEV first attempt got `Access denied` on the old password). Verify plugin ACTIVE + 4 negative / 1 positive tests.

### #20b — glue-etl
- **Gates**: G-acct; depends on #8, #10, #12, #18, #19 (NOT EKS — Glue serverless).
- **Plan**: `+44` all-add (forecast; blocked on vpc #8 secondary-CIDR `100.64.0.0/16` subnets — the pool IS enabled in `vpc/stg.tfvars`, so this clears once #8 applies). NOT permanently blocked.
- **STOP**: sequence well AFTER redshift `available` post-reboot (else the redshift-active race → multiple applies). Daily trigger `start_on_creation=false` → manual `start-trigger` post-apply.

### #21 — eks (Stage-1: CONFIG_MAP→API_AND_CONFIG_MAP)
- **Gates**: G-acct, **G-code-1** (blocking — plan exits 1 until fixed), **G-eks-ver** (pin 1.31), **G-eks-prereq** (CNI IRSA + before_compute/moved + RBAC + named_user); depends on #32 (ec2-cd-runner first). **CRITICAL · maint window.**
- **Plan**: forecast (blocked on G-code-1).
- **STOP**: G-code-1 not fixed; tfvars shows `1.34`; CNI IRSA not `-target`-created first; RBAC binding not live. **Stage-1 only** here (`→API_AND_CONFIG_MAP`; verify aws-auth still works).

### #21b — eks (Stage-2: API_AND_CONFIG_MAP→API)
- **Gates**: G-acct, G-eks-prereq (RBAC bindings live); depends on #21. **CRITICAL · maint window (parity-wait after #21).**
- **Plan**: forecast (follows #21). The one-way `→API` flip. **Separate row, separate window** (STG/PRD parity-wait — unlike DEV, which ran both stages in one window).
- **STOP**: RBAC bindings (`admin`→cluster-admin) not live on the cluster → API-mode lockout. tfvars `authentication_mode = "API"` is the Stage-2 end-state.

### #22 — eks (1.31→1.32)
- **Gates**: G-acct; depends on #21b. **CRITICAL · weeknight.**
- **Plan**: forecast (one-minor hop). `git checkout eks/1.32`; plan must show ONLY 1.31→1.32; apply; upgrade node groups. No downtime.
- **STOP**: plan shows more than the one-minor bump.

### #23 — eks (1.32→1.33)
- **Gates**: G-acct; depends on #22. **CRITICAL · weeknight.**
- **Plan**: forecast (one-minor hop). No downtime.
- **STOP**: plan shows more than the one-minor bump.

### #24 — eks (1.33→1.34)
- **Gates**: G-acct; depends on #23. **CRITICAL · weeknight.**
- **Plan**: forecast (one-minor hop). Upgrade kubectl; 5 node groups replaced create-before-destroy after control plane reaches 1.34. No downtime.
- **STOP**: plan shows more than the one-minor bump.

### #25 — k8s-manifests (api/admin/app/worker/mmh)
- **Gates**: G-acct, **G-alb-cert** (ingress.yaml `*.backseat-service.com` regional cert); depends on #24.
- **Plan**: api `+34/~7`; admin/app/worker/mmh `~1` each. `kubectl apply -k` rbac→app→api→admin→worker→mmh.
- **STOP**: expect **CrashLoop on first apply** until the app image (CSI `SecretsEnvironmentPostProcessor` bridge) + stateful cutover are ready → keep replicas=0, bring up after cutover (NOT a failure). CoreDNS Corefile port check (Ponta, Risk #2).

### #26 — s3-chart-snapshot
- **Gates**: G-acct; depends on #2 + eks `point-app-irsa-role` (#24).
- **Plan**: forecast (blocked on `point-app-irsa-role` NoSuchEntity until #24). Then additive.
- **STOP**: verify `s3-access-logs.bs-point-stg` exists (from #2).

### #27 — s3-csv-export
- **Gates**: G-acct; depends on #2 + IRSA (#24).
- **Plan**: `+4` (forecast; blocked on IRSA, 0 destroy/replace greenfield).
- **STOP**: apply after eks IRSA.

### #28 — s3-csv-export-admin
- **Gates**: G-acct; depends on #2 + IRSA (#24).
- **Plan**: `+4` (forecast; blocked on IRSA, greenfield).
- **STOP**: apply after eks IRSA.

### #29 — s3-kyc
- **Gates**: G-acct; depends on #2 + IRSA (#24).
- **Plan**: `+1/-2` (forecast; blocked on IRSA — 2 non-critical destroys on the live PII bucket `kyc.bs-point-stg`).
- **STOP**: if a non-`private` ACL → pre-strip (ownership conflict like #16). Re-plan after IRSA.

### #30 — s3-year-report
- **Gates**: G-acct; depends on #2 + IRSA (#24).
- **Plan**: `+4` partial (forecast; import + IRSA). Bucket `year-report.bs-point-stg` **pre-exists in `471`** (`head-bucket` 200).
- **STOP**: `terraform import aws_s3_bucket.this` FIRST, then apply after IRSA (else `BucketAlreadyOwnedByYou`).

### #30b — s3-refinitiv-migration
- **Gates**: G-acct; depends on #2 + IRSA (#24).
- **Plan**: forecast (blocked on IRSA; no plan baseline yet).
- **STOP**: re-plan once #24 materializes IRSA, then apply with the S3 data buckets.

### #32 — ec2-cd-runner
- **Gates**: G-acct; depends on #1, #10 (NOT #24). **MUST precede #21** (creates `point-cd-runner-role` the eks auth-bridge consumes).
- **Plan**: `+4` (forecast; blocked on `cd-runner-sg` from #10). `aws_instance.cd_runner` un-planned until the SG exists; 4 IAM resources plan cleanly.
- **STOP**: applied after #21 (would deadlock the bridge).

### #33 — ec2-proxy
- **Gates**: G-acct; depends on #1a.
- **Plan**: `+4` IAM + `+1` EC2 (forecast; blocked on `proxy-sg` from #10).
- **STOP**: **STG fixed-IP tfvar** (`proxy_private_ip`) must be in the STG `10.51.187.0/24` subnet (a TODO in `stg.tfvars`), NOT 172.18.x. Post-apply bastion manual: SSM-agent snap→deb + `/etc/profile.d/squid-proxy.sh`. Precede ec2-data-transfer.

### #34 — ec2-data-transfer
- **Gates**: G-acct; depends on #10, #24; functional: ec2-proxy #33 first.
- **Plan**: `+4` (forecast; blocked on ec2-proxy squid data source). AMI `ami-03598bf9d15814511` CONFIRMED public/available in `471` — no AMI swap needed.
- **STOP**: ec2-proxy #33 not applied (squid data source).

### #35 — cloudwatch_metrics
- **Gates**: G-acct; depends on #24, #25.
- **Plan**: `+2/~33/-2` — destroys `okcoinOrderbookGetter`, adds `amberOrderbookGetter`. Alarm names `[stg]` via env tfvar.
- **STOP**: apply immediately before #36 to avoid the orphan-metric alarm window.

### #36 — cloudwatch_alarm
- **Gates**: G-acct; depends on #35.
- **Plan**: `+2/~11/-2`.
- **STOP**: verify no alarm references old `okcoinOrderbookGetter*` metrics. After: new alarms INSUFFICIENT_DATA→OK.

### #37 — frontend-admin
- **Gates**: G-acct; depends on #10 + #38 (apply customer first).
- **Plan**: `+3/~4/-1` clean — S3 OAC migration (website-config destroyed, bucket retained) + in-place CloudFront on live distro `E16LHOS2AUK5I2` + ALB origin http→https.
- **STOP**: **Cert is NOT a blocker on STG** — host `bo-stg.backseat-service.com` (single label) is covered by the IMPORTED `*.backseat-service.com` cert `d836a32c` (ISSUED, InUse). Gate: ALB `point-alb` HTTPS:443 listener live (#10). `create_route53_record=false`. **STG manual proxy/OAuth = DO NOT TOUCH.**

### #38 — frontend-customer
- **Gates**: G-acct, **G-code-3** (blocking — ACM ambiguity + DO-NOT-TOUCH manual proxy/OAuth); depends on #10. Apply customer→admin.
- **Plan**: `+10/~5/-2` partial (forecast; ACM gate — the `-2` = S3 ACL sub-resources, non-stateful). Provider already v6.14.1.
- **STOP**: G-code-3 not fixed (matches 2 certs); pre-strip public-read ACLs on `choice`/`point.bs-point-stg`; `exchange.bs-point-stg` must not pre-exist outside state; ALB HTTPS:443 live first. **Do not clobber STG manual proxy/OAuth.**

### #39 — waf-customer
- **Gates**: G-acct, **G-waf-untaint** (pre-stage); depends on #2 (after #38). **HIGH · maint window (deferred tail).**
- **Plan**: `+20/~2/-1` — Path B (`priority-targets-stg.json`, **13 rules**, `enabled_managed_ip_rules=true`). WebACL `bc4ca936` (us-east-1). Destroys the monolithic `maintenance` rule group → split into `maintenance_exchange` + `maintenance_point`.
- **STOP**: re-detect the preflight Case; pre-stage the untaint-recovery (`country_restrict`+`core_rule_set`+`rate_limit_count`); `country_restrict` continuity invariant across the geo flip. CloudFront-scoped → us-east-1. Banner ≥6h before; dedicated window.

### #39b — waf-maintenance-lambda
- **Gates**: G-acct; depends on #8, #10; functional: #39 first. **maint window (chained to #39).**
- **Plan**: `~7` (split-brand Lambda code + cron rewrites).
- **STOP**: chain in the SAME window as #39 (after preflight + waf-customer apply) to avoid the single-brand-vs-split-WebACL gap. Confirm the STG schedule-enabled flag (DEV had it disabled). Needs `lambda-maintenance-sg` (#10).
