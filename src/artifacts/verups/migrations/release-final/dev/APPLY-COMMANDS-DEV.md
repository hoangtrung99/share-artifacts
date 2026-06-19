# verup → point DEV — Apply command runbook (copy-paste)

Concise, paste-in-order companion to `MANUAL-RUNBOOK.md` (prose) and `apply-order-CANONICAL.md` (per-row detail). Every actionable row is one block: `cd` → `init`/`plan`/`apply` via the wrapper → expected plan → 1-line gate + after-check. Where a row **cannot** be pasted blind, it leads with a **Blocked-until / Pre-req / STOP** line — read it first.

## Environment Info

| Item | Value |
|---|---|
| Target account | `905418018638` (point dev) |
| Region | `ap-northeast-1` (CloudFront / ACM in `us-east-1`) |
| Branch | `release/verup` — operator checkout is at `d0625eca` (plans below were captured at `46fb02e0`; `module.audit` is byte-identical between the two). Run all commands from this working-tree root. |
| Write credentials | An operator-supplied **write-capable** profile that assumes `custodian-AdministratorRole` (carries `AdministratorAccess`). `point-operator-dev` is **READ-ONLY** — use it only for after-checks, never for `apply`. Do **not** apply with `custodian-DeveloperRole`/`ViewerRole`. |
| Terraform wrapper | `terraform/terraform.sh`. Always `../../terraform.sh --env dev <init\|plan\|apply>` from the component dir. Never raw `terraform apply --tfvar`. The wrapper auto-inits with `--upgrade` only when `TF_DATA_DIR` is absent — pass `init --upgrade` explicitly for the provider-changed components (`vpc`, `security_group` after its pin, `eks`). |
| Windows | All JST. |

Set the write profile once before starting (`export AWS_PROFILE=<write-profile>` / SSO session); all commands below are bare (no `--profile`) so a copied block runs against whatever profile is active — re-run STEP 0 before each component so a stale session can never apply into the wrong account.

## STEP 0 — Identity & backend guard (run before EVERY component apply)

The worst outcome is applying into the **wrong account**: legacy-dev `845131030484` shares CIDR `172.18.0.0/16` with the target, so a wrong-profile apply looks plausible.

```bash
# 1. Confirm the account
aws sts get-caller-identity --query Account --output text   # MUST print 905418018638

# 2. Confirm terraform uses the S3 backend, NOT local
../../terraform.sh --env dev init 2>&1 | grep -E 'Backend:'  # MUST print "Backend: s3"
```

**STOP** if the account is not `905418018638`, or if the backend prints `local` — a stale `backend.tf` / `terraform/tmp/dev/<component>` from a killed run is poisoning the backend. Clean it (`find terraform/components terraform/infra -name backend.tf` → remove stale; `rm -rf terraform/tmp/dev/<component>`) and re-init before doing anything else. A local-backend apply runs against empty state and mass-creates resources.

## PRE-FLIGHT — external/human-blocked prerequisites (clear BEFORE opening any window)

These have lead time and cannot be resolved by terraform alone. None of the sequence below completes until each is satisfied.

1. **Notification chain** — DEV (905418018638) is missing the `alert-lambda-event-notification` SNS topic, its Slack-forwarder Lambda, and the secret `point/lambda/event-notification-to-slack` (STG already has all three). `notification` reads that topic via a data source, so a cold plan fails at refresh (`NoSuchEntity`). Apply order is **`secrets_manager` → `event-notification` → `notification`**, and `event-notification` needs the secret container first. Populate the Slack-webhook secret value (`put-secret-value`) before the Lambda is relied on at runtime.
2. **VPC peering id** — `vpc_peering` is accepter-only and references a hardcoded `pcx-…` that is absent in this account. Have wallet-stg (`845131030484`) send the peering request to `vpc-0f49bf7456fa50d08`, capture the AWS-assigned `pcx`, update `vpc_peering/tfvars/dev.tfvars`, then apply. After-check by tag/CIDR, never the old hardcoded id.
3. **CloudFront ACM cert (import-only)** — no existing cert covers the level-3 alias `bo.dev.backseat-service.com`. Manually `aws acm import-certificate` an ISSUED cert covering `*.dev.backseat-service.com` (or exactly `bo.dev`) into **us-east-1**, then set `cloudfront_certificate` for `frontend-admin`. `init/acm` keeps `enable_certificate_for_cloudfront = false` (do **not** re-enable; apply it to DESTROY the stale `cb4bfaf0` cert — see the init/acm step). `frontend-admin`'s data source filters `types=["IMPORTED"]`, so no `data.tf` change is needed. Same us-east-1 housekeeping pass: delete the EXPIRED certs `cb4bfaf0` (AMAZON_ISSUED) + `2f009235` (IMPORTED); **keep `07c7a840`** (`*.backseat-service.com`, ISSUED, IMPORTED — `frontend-customer` uses it). ACM refuses to delete a cert attached to a live distribution → verify-not-in-use first.
4. **EKS version-ladder branches** — the cluster is live at **v1.31**; the upgrade must step one minor at a time (the module passes the version straight to the API, which rejects multi-minor jumps). Branches `eks/1.32`, `eks/1.33`, `eks/1.34` and `eks/auth-mode-bridge` **exist on origin — created and pushed 2026-06-10** (each = exactly 1 commit on top of `release/verup` `376dc7be` pinning that rung's versions; apply one rung + soak, then the next). Longest-lead item; start first.
5. **K8s-manifest source fixes** (before the SG-swap and auth-flip windows):
   - `k8s-manifests/point/dev/aws-load-balancer-controller.yaml` `vpcId` → `vpc-0f49bf7456fa50d08` (regressed to the wrong-account VPC).
   - `k8s-manifests/bin/k8s_apply.sh` → fix the applied path from `point/dev/rbac/` (does not exist) to `rbac/`, else (under `set -e`) the rollout aborts and the `admin`→cluster-admin binding never lands → **API-mode admin lockout**.
   - `k8s-manifests/point/dev/ingress.yaml` HTTPS:443 listener needs an ISSUED **regional ap-northeast-1** ACM cert (distinct from the us-east-1 CloudFront cert), else listener creation fails and the controller-driven SG swap never reconciles.
   - `k8s-manifests/point/dev/aws-auth-cm.yaml` userarn → `bs-developer` (regressed to `bs-operator`, which does not exist in dev).
6. **EKS access-entry user** — verify `eks/tfvars/dev.tfvars` `named_user = bs-developer` (fixed in HEAD; `bs-operator` is an stg-only user absent in dev — would fail the apply and feed the auth-flip lockout).
7. **waf-customer is Path B** (maintenance-split merged) — provider `~>6.40`, split rule groups, `scripts/preflight-renumber.sh` **required** (a plain apply fails `WAFInvalidParameterException` on duplicate priorities). Stage `priority-targets-dev.json` (point-dev = 11 rules). Apply `waf-maintenance-lambda` in the same window.
8. **Re-plan the 6 destructive/foundational components on apply day** (`vpc`, `eks`, `aurora`, `elasticache`, `redshift`, `security_group`) — they have no committed lockfile, so the captured plans are not guaranteed reproducible. Re-plan against the real backend, **diff against the captured plan, and human-review any new destroy/replace before applying.** `vpc` pins the aws provider unbounded (`>= 5.46.0`) so its apply-day `init` pulls a major-6 provider — re-plan and confirm no unexpected diff.

## Execution order (the spine — including the two deferrals that cross nominal phases)

Re-run STEP 0 before each component. Default rollback for a *killed* (not failed-plan) apply: `terraform force-unlock <LOCK_ID>` → re-plan → re-apply (terraform is idempotent); per-component exceptions are called out inline.

1. **Bootstrap + Foundation** (daytime): `init/acm` (apply: destroy the stale cert) · `init/eip` (verify-only) · `infra/iam` · **`ec2-bastion`** · **`eice`** (front-loaded — brownfield rehearsal: vpc / `bastion-sg` / bastion already exist) · `infra/audit` · `infra/ebs-security` · `ecr` · `sns-alert` · `notification-global`.
2. **Connectivity** (daytime; `security_group` = maint window): `vpc` · `vpc_peering` · `security_group` · **`ec2-cd-runner`** (deferred-forward: it only needs `security_group`, and the EKS auth-bridge later consumes its role — run it here, **before** the EKS block) · `endpoints`.
3. **Secrets, notification chain, WAF** (daytime): `secrets_manager` · `event-notification` · **`notification`** (deferred from its nominal Foundation slot to here — it cannot plan until `secrets_manager`+`event-notification` land) · `waf-maintenance` · `waf-admin` · `waf-athena` · `s3-maintenance`.
4. **Stateful** (maintenance windows — real downtime; one replica-capture + scale-to-0 at window start, one restore at the end, covering elasticache+redshift+aurora together): `elasticache` · `redshift` · `aurora` · `aurora validate_password` · then `glue-etl` (daytime, **after** the stateful window closes — additive, not inside the downtime).
5. **EKS block** (the climax — see the dedicated block in §5): merged 2-stage auth flip + module v21 at live 1.31 (`eks/1.31` → prove-gate → `eks/1.31-api`) **FIRST**, then version ladder `eks 1.31→1.32→1.33→1.34` (one minor per branch, runs under final `API` mode). (`ec2-cd-runner` was already applied in step 2.)
6. **Post-EKS** (daytime; `waf-customer` tail = maint window): `k8s-manifests` → 6 S3 buckets (`s3-chart-snapshot`, `s3-csv-export`, `s3-csv-export-admin`, `s3-kyc`, `s3-year-report`, `s3-refinitiv-migration`) → `ec2-proxy` · `ec2-data-transfer` → `cloudwatch_metrics` → `cloudwatch_alarm` → `frontend-customer` **before** `frontend-admin` → `waf-customer` → `waf-maintenance-lambda` (chained to waf-customer, same window).

---

## 1. Bootstrap + Foundation (daytime)

### init/acm — LOW · daytime
**APPLY (destroy the stale cert):** commit `7cd80a95` flipped `enable_certificate_for_cloudfront = true → false` (`enable_certificate_for_alb` stays `false`). `module.for_cloudfront` is `count = var.enable_certificate_for_cloudfront ? 1 : 0`, so the AMAZON_ISSUED cert `cb4bfaf0` created earlier under `=true` (now EXPIRED) plans a DESTROY — apply it. Keep `false`; do NOT re-enable. `2f009235` (IMPORTED, EXPIRED) is NOT init/acm-managed → delete it manually. Keep `07c7a840` (frontend-customer uses it).
```bash
cd terraform/init/acm
../../terraform.sh --env dev init
../../terraform.sh --env dev plan      # Expect: 1 to destroy = module.for_cloudfront[0].aws_acm_certificate (cb4bfaf0) + its DNS-validation records. If 0/0/0 -> cert not in this state; skip to the manual delete.
../../terraform.sh --env dev apply
# Manual delete of the EXPIRED IMPORTED 2f009235 (not init/acm-managed). Resolve full ARNs (8-char prefixes are not delete-able ids); ACM refuses to delete a cert in use by a live distribution -> verify-not-in-use first.
aws acm list-certificates --region us-east-1 --query "CertificateSummaryList[].[CertificateArn,DomainName,Status,Type]" --output text
aws acm delete-certificate --region us-east-1 --certificate-arn <expired-2f009235-arn>
```
**After:** `aws acm list-certificates --region us-east-1 --query "CertificateSummaryList[].[DomainName,Status,Type]" --output text`  (expect: cb4bfaf0 + 2f009235 GONE; only 07c7a840 ISSUED IMPORTED remains, plus any newly-imported *.dev cert)

### init/eip — LOW · daytime
**Pre-req in state:** `aws_eip.nat1` (`point-nat-apne1-az1`, `eipalloc-0ff90c1a7eb7da6f6`) already in `dev/eip.tfstate`; this is the NAT EIP that vpc data-sources by name.
**STOP:** Verify-only in dev. Expect `0/0/0` and SKIP apply. If plan shows `+ aws_eip.nat1` (create) → do NOT apply (a duplicate `point-nat-apne1-az1` breaks vpc's by-name lookup); instead `../../terraform.sh --env dev import aws_eip.nat1 eipalloc-0ff90c1a7eb7da6f6` then re-plan to `0/0/0`.
```bash
cd terraform/init/eip
../../terraform.sh --env dev init
../../terraform.sh --env dev plan      # Expected: 0 add / 0 change / 0 destroy -> SKIP apply
# (no apply)
```
**After:** `aws ec2 describe-addresses --region ap-northeast-1 --filters Name=tag:Name,Values=point-nat-apne1-az1 --query "Addresses[].[AllocationId,PublicIp,NetworkInterfaceId]" --output text`  (expect: eipalloc-0ff90c1a7eb7da6f6 18.179.98.160 <nat-gw-eni>)

### infra/iam — HIGH · daytime
**STOP — OPUS-GATE-A (two parts):** The 4 custodian roles already exist with LIVE trust policies that DIFFER from HEAD, so (a) `terraform import` the 6 pre-existing resources FIRST in the exact order below (else apply fails `EntityAlreadyExists`); (b) after import, the apply silently REWRITES those trust policies — it drops cross-account assume principals (root `590183696997`, `728927523062`), drops `user/bs-cicd-test` (CICD), and narrows `SourceIp`. Diff each role's live trust vs HEAD and get explicit sign-off on every dropped principal BEFORE apply. Sequence the actual trust-narrowing AFTER the eks `→API` flip — `custodian-AdministratorRole` is the eks break-glass; narrowing it now can sever it.
Imports the 4 custodian roles + custodian-ViewerRolePolicy + ssm_policy, then applies (plan `+16`; 6 of the 16 already exist and are adopted by the imports).
```bash
cd terraform/infra/iam
../../terraform.sh --env dev init
../../terraform.sh --env dev import 'aws_iam_role.AdministratorRole[0]' custodian-AdministratorRole
../../terraform.sh --env dev import 'aws_iam_role.CICDRole[0]'          custodian-CICDRole
../../terraform.sh --env dev import 'aws_iam_role.OperatorRole[0]'      custodian-OperatorRole
../../terraform.sh --env dev import 'aws_iam_role.ViewerRole[0]'        custodian-ViewerRole
../../terraform.sh --env dev import 'aws_iam_policy.ViewerRole[0]'      arn:aws:iam::905418018638:policy/custodian-ViewerRolePolicy
../../terraform.sh --env dev import aws_iam_policy.ssm_policy           arn:aws:iam::905418018638:policy/ssm_policy
../../terraform.sh --env dev plan      # Expected: ~10 create + in-place trust-policy rewrites on the 4 imported roles -> DIFF each trust + sign off before apply
../../terraform.sh --env dev apply
```
**After:** `aws iam list-roles --query "Roles[?contains(RoleName,'custodian')].RoleName" --output text`  (expect 6: the 4 TF-managed AdministratorRole/CICDRole/OperatorRole/ViewerRole + pre-existing unmanaged DeveloperRole/OperatorViewerRole)

### ec2-bastion — LOW · daytime
**Front-loaded (brownfield rehearsal order):** vpc + security_group (`bastion-sg`) + the bastion already exist in point-dev, so the bastion is verified/re-applied early here (right after infra/iam) to enable EICE + bastion access for the rest of the run. A greenfield apply would need vpc + security_group first.
**Pre-req in state:** the 6 custodian roles are imported by infra/iam (section 1) — verify present, do NOT re-import here.
Brings up the bastion instance with profile `point-bastion-role`.
```bash
cd terraform/components/ec2-bastion
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: No changes (applied 2026-06-11 — role/profile/instance i-03a7a4aeec795d170 in state; plan is verify-only)
../../terraform.sh --env dev apply
```
**After:** `aws ssm describe-instance-information --query "InstanceInformationList[?contains(Name,'bastion')].{Id:InstanceId,Ping:PingStatus}" --output table` (instance running, SSM reachable)

**After (root volume 16→30GB):** the EBS volume is resized by the apply but the OS partition/filesystem does NOT auto-grow — `df -h /` still shows 16G. SSM into the bastion and expand:
```bash
lsblk                                   # confirm root disk is nvme0n1 with partition nvme0n1p1 (use xvda/xvda1 if shown instead)
sudo growpart /dev/nvme0n1 1            # grow partition 1 to fill the resized volume
sudo resize2fs /dev/nvme0n1p1           # grow the ext4 filesystem online (no reboot)
df -h /                                 # expect Size ≈ 29G
```

### eice — LOW · daytime
**Pre-req in state:** infra/iam custodian roles (section 1), vpc (`point-private-subnet-apne1-az1`), security_group `bastion-sg` (`old_bastion_enabled=true`), ec2-bastion running.
**Pre-req on the bastion:** `sshd` must be up — the EICE only relays to port 22, it is **not** an SSH server. user_data already enables it; verify via Session Manager: `sudo systemctl status ssh --no-pager` and `sudo sshd -T | grep -E '^(pubkeyauthentication|passwordauthentication)'` (expect `pubkeyauthentication yes` / `passwordauthentication no`). Each operator must also have their key in the bastion's `authorized_keys` (manual — no `key_name`). Full step: `../eice-bastion-runbook.md`.
New greenfield component — off-network SSH fallback to the bastion via an EC2 Instance Connect Endpoint.
```bash
cd terraform/components/eice
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected (greenfield): all-add, 0 destroy/replace — eice SG + egress rule + bastion-ingress rule + endpoint + IAM policy + 2 role attachments (custodian-Operator/Administrator). If "Bastion security group 'bastion-sg' was not found" → apply security_group first.
../../terraform.sh --env dev apply
```
**After:** `aws ec2 describe-instance-connect-endpoints --profile point-operator-dev --region ap-northeast-1 --query "InstanceConnectEndpoints[?contains(Tags[?Key=='Name'].Value | [0],'bastion-eice')].{Id:InstanceConnectEndpointId,State:State}" --output table` (State `create-complete`); `aws iam list-attached-role-policies --profile point-operator-dev --role-name custodian-OperatorRole --query "AttachedPolicies[?PolicyName=='eice-bastion-operator']" --output text` (policy attached). Operator tunnel (needs `OpenTunnel` → use a profile assuming `custodian-OperatorRole`/`custodian-AdministratorRole`, NOT the read-only `point-operator-dev`): `aws ec2-instance-connect open-tunnel --instance-id i-03a7a4aeec795d170 --remote-port 22 --local-port 2222 --region ap-northeast-1 --profile <operator-role-profile>` then SSH to `localhost:2222`.

### infra/audit — HIGH · daytime
**STOP:** Run the verup-delta with `-target` and DEFER `module.config`. A full (untargeted) apply destroys the live same-account `bs-aws-config-role` (sole working Config credential, `RoleLastUsed` recent) and switches both recorders to the cross-account `211125716602` role — that is an OPEN engineer decision, do NOT paste-run the full apply. `s3-waf-logging` lock_enabled=true / retention 30 are ALREADY set in dev.tfvars — confirm, do NOT edit. Confirm `aws-waf-logs.bs-point-dev` is NOT in REPLACE (the import blocks adopt it).
Creates `s3-access-logs.bs-point-dev` (hard prereq for the 5 S3 + 3 WAF rows) plus the other verup-delta modules; the 5 aws-waf-logs adoptions are auto `import{}` blocks resolved during apply (no manual `terraform import`).
```bash
cd terraform/infra/audit
../../terraform.sh --env dev init
../../terraform.sh --env dev plan \
  -target=module.s3-audit-logs -target=module.s3-audit-logs-receiver -target=module.s3-config \
  -target=module.cloudtrail -target=module.guardduty -target=module.securityhub -target=module.ssm \
  -target=module.s3-access-logs -target=module.s3-waf-logging -target=aws_guardduty_detector.this
# Expected: +11 / ~3 / -0 (+5 import), 0 destroy, NO 211125716602 reference; plus 1 moved record (aws_guardduty_detector.this -> module.guardduty[0]) which is NOT a change. STOP if it deviates or shows ANY S3 bucket destroy.
../../terraform.sh --env dev apply \
  -target=module.s3-audit-logs -target=module.s3-audit-logs-receiver -target=module.s3-config \
  -target=module.cloudtrail -target=module.guardduty -target=module.securityhub -target=module.ssm \
  -target=module.s3-access-logs -target=module.s3-waf-logging -target=aws_guardduty_detector.this
```
**After:** `aws s3api head-bucket --bucket s3-access-logs.bs-point-dev` (then `aws configservice describe-configuration-recorder-status --query "ConfigurationRecordersStatus[].[name,recording]" --output text` — both recorders still recording=true on bs-aws-config-role, unchanged)

### infra/ebs-security — LOW · daytime
Additive — enables EBS encryption-by-default.
```bash
cd terraform/infra/ebs-security
../../terraform.sh --env dev init
../../terraform.sh --env dev plan      # Expected: additive creates/changes, 0 destroy/replace
../../terraform.sh --env dev apply
```
**After:** `aws ec2 get-ebs-encryption-by-default --region ap-northeast-1 --query EbsEncryptionByDefault --output text`  (expect: True)

### ecr — LOW · daytime
Additive — creates the ECR repos; `AllowCICDPushPull` is inert until `eks-worker-role` exists (safe).
```bash
cd terraform/components/ecr
../../terraform.sh --env dev init
../../terraform.sh --env dev plan      # Expected: No changes (5 repository policies applied after the 2026-06-08 capture; live-verified 2026-06-11)
../../terraform.sh --env dev apply
```
**After:** `aws ecr describe-repositories --region ap-northeast-1 --query "repositories[].repositoryName" --output text`

### sns-alert — LOW · daytime
**Pre-req in state:** confirm `lambda_function.zip` is a known-good sns-to-slack build before apply.
Additive — creates the alert SNS topics + sns-to-slack lambda.
```bash
cd terraform/components/sns-alert
../../terraform.sh --env dev init
../../terraform.sh --env dev plan      # Expected: additive creates, 0 destroy/replace
../../terraform.sh --env dev apply
```
**After:** `aws sns list-topics --region ap-northeast-1 --query "Topics[?contains(TopicArn,'alert-lambda')].TopicArn" --output text`

### notification-global — LOW · daytime
**STOP:** Operator must accept the broadened all-region AWS Health alerts before apply.
Additive — global (us-east-1) AWS Health / sign-in / STS notification wiring.
```bash
cd terraform/components/notification-global
../../terraform.sh --env dev init
../../terraform.sh --env dev plan      # Expected: additive creates, 0 destroy/replace
../../terraform.sh --env dev apply
```
**After:** `aws health describe-event-types --region us-east-1 --max-results 1 >/dev/null && echo health-api-reachable`

---

## 2. Connectivity (daytime; security_group = maintenance window)

### vpc — HIGH · daytime
**Pre-req in state:** NAT EIP `point-nat-apne1-az1` (`eipalloc-0ff90c1a7eb7da6f6`) from init/eip — vpc data-sources it by name.
✅ **OK to apply from the SSM point-bastion — lockout-safe** (re-assessed against code + live): the bastion is in a PRIVATE subnet (172.18.21.x, no public IP, SSM-accessed); on apply its subnet moves to the new private NACL, which allows ALL intra-VPC (172.18.0.0/16) + ephemeral 1024-65535 + outbound-all = exactly the SSM path. New NACLs get their rules BEFORE any subnet associates (`depends_on`) and the default NACL flips to deny-all LAST — no deny-window. Re-plan/diff first (aws `>=5.46.0` unbounded → provider 6.x on apply day). No bastion SSH sessions open during apply.
**STOP:** re-plan and diff vs the captured `+33/~0/-1` first (no committed lockfile); the single destroy MUST be `module.vpc.aws_default_network_acl.this[0]` (a state-record migration only — AWS does not delete the default NACL acl-039dac97f13fa7e3c). If `terraform state list | grep default_network_acl` does not show that record, do NOT apply.
Adopts standalone NACLs (1 public + 1 private dedicated NACL, 6+3 subnet associations, 14 NACL rules) AND adds the secondary CIDR 100.64.0.0/16 (1 cidr association + 3 private subnets 100.64.{21,22,24}.0/24 + 3 route table associations) for managed-service ENIs; existing VPC/subnets/IGW/NAT untouched.
```bash
cd terraform/components/vpc
../../terraform.sh --env dev init --upgrade
../../terraform.sh --env dev plan            # Expected: +33/~0/-1 (the -1 = aws_default_network_acl.this[0] STATE migration, NOT a delete; +33 = 21 NACL adopt + 12 secondary-CIDR 100.64.0.0/16 adds)
../../terraform.sh --env dev apply
```
**After:** `aws ec2 describe-network-acls --region ap-northeast-1 --filters Name=vpc-id,Values=vpc-0f49bf7456fa50d08 --query 'NetworkAcls[].{Id:NetworkAclId,Default:IsDefault,Assoc:length(Associations),Entries:length(Entries)}' --output table` (expect 3 NACLs; default acl-039dac97f13fa7e3c still present)

### vpc_peering — HIGH · daytime (blocked on requester)
**Blocked-until:** the real `pcx` is captured. The hardcoded `pcx-0b25431ee2b97d2ac` is ABSENT in 905418018638 → a cold apply fails `InvalidVpcPeeringConnectionID.NotFound`. wallet-stg (845131030484) must send the peering request to `vpc-0f49bf7456fa50d08`; capture the AWS-assigned pcx and write it into `tfvars/dev.tfvars` BEFORE applying.
Accepter-only apply: accepts the peering connection and mutates 2 EKS-tagged route tables (private `rtb-01cd8a94ccb541553`, public `rtb-04c2378d5accace0e`).
```bash
cd terraform/components/vpc_peering
# First: update tfvars/dev.tfvars with the AWS-assigned pcx from wallet-stg's request (NOT the hardcoded one)
../../terraform.sh --env dev init
../../terraform.sh --env dev plan            # Expected: +3 (do not run until the live pcx is in tfvars)
../../terraform.sh --env dev apply
```
**After:** `aws ec2 describe-vpc-peering-connections --region ap-northeast-1 --filters Name=accepter-vpc-info.vpc-id,Values=vpc-0f49bf7456fa50d08 --query 'VpcPeeringConnections[].{Id:VpcPeeringConnectionId,Status:Status.Code}' --output table` (match by tag/CIDR, not a hardcoded pcx)

### security_group — CRITICAL · maintenance window
**Resolved (G14):** SG modules are pinned `~> 5.3` (commit 6672bbb6) in all 7 `terraform-aws-modules/security-group/aws` blocks (eks.tf/mysql.tf/redis.tf/redshift.tf) → `terraform init` succeeds; the earlier v6.0.0 init-fail is resolved. Still run `init --upgrade` for this provider-changed component.
**STOP:** controller-driven 3-step ALB SG swap — do NOT run a single full apply. A direct destroy of `alb-sg` (`sg-005b8b9b2e2cb718e`) hits DependencyViolation on 3 live ALB ENIs; `alb-https-sg` does not exist until step 1 creates it.
**Couple with aurora:** the mysql-sg `3306→13306` rule edits land in THIS same window. Pods are kept at 0 for the WHOLE migration (scaled to 0 at migration start, restored only after all components are applied) — no per-component scale steps here.
Swaps ALB HTTP:80/alb-sg → HTTPS:443/alb-https-sg, repoints eks-worker(8080)/mysql ingress, adds cd-runner-sg/proxy-sg + vpc-endpoints-sg port 587, drops legacy CIDR allowlists.
```bash
cd terraform/components/security_group
../../terraform.sh --env dev init --upgrade
../../terraform.sh --env dev plan            # Expected: +17/~1/-14 (7 replace; matches captured plan-output, re-verified live on bastion 2026-06-11); port-8080 ALB->EKS rule preserved (repointed), only port-80 path destroyed

# (Pods already at 0 — scaled to 0 at migration start, restored only after ALL components are applied. No per-component scale here.)

# STEP 1 — targeted apply: create alb-https-sg only (do NOT full-apply yet)
../../terraform.sh --env dev apply -target=aws_security_group.alb_https -target=aws_security_group_rule.cloudfront_to_alb_https -target=aws_security_group_rule.old_bastion_to_alb

# STEP 2 — controller-driven cutover via edited ingress.yaml (annotation security-groups: alb-https-sg, listen-ports HTTPS:443).
#   Gate: kubectl diff -> dry-run=server -> apply -> verify. Do NOT aws elbv2 set-security-groups unless the controller fails to reconcile in ~60s.
kubectl diff -f ../../../k8s-manifests/point/dev/ingress.yaml
kubectl apply -f ../../../k8s-manifests/point/dev/ingress.yaml --dry-run=server
kubectl apply -f ../../../k8s-manifests/point/dev/ingress.yaml
#   verify the controller moved the ALB off alb-sg before STEP 3:
aws elbv2 describe-load-balancers --region ap-northeast-1 --query "LoadBalancers[?LoadBalancerName=='point-alb'].SecurityGroups" --output json   # must NOT contain sg-005b8b9b2e2cb718e

# STEP 3 — full apply: removes the now-detached alb-sg + obsolete rules, flips mysql to 13306, adds 587/cd-runner/proxy
../../terraform.sh --env dev apply
```
**After:** `aws elbv2 describe-load-balancers --region ap-northeast-1 --query "LoadBalancers[?LoadBalancerName=='point-alb'].SecurityGroups" --output json` (must show alb-https-sg, NOT sg-005b8b9b2e2cb718e)

### ec2-cd-runner — MED · daytime
**Pre-req in state:** security_group applied with `cd_runner_enabled=true` so `cd-runner-sg` exists (the plan reads `data.aws_security_group.cd_runner` by tag `Name=cd-runner-sg`; absent → "no matching EC2 Security Group found"). Apply RIGHT AFTER security_group — it depends ONLY on security_group, NOT eks.
Greenfield +5: creates the CD-runner EC2 (t3.micro, private subnet, SSM-managed) + `point-cd-runner-role`/instance-profile (clean create, no import) which the EKS auth-bridge later consumes → must run before the EKS block.
```bash
cd terraform/components/ec2-cd-runner
../../terraform.sh --env dev init
../../terraform.sh --env dev plan            # Expected: +5/~0/-0 (4 IAM + 1 EC2; a +4-only plan_failed means cd-runner-sg is still missing)
../../terraform.sh --env dev apply
```
**After:** `aws ec2 describe-instances --region ap-northeast-1 --filters Name=tag:Name,Values=point-cd-runner Name=instance-state-name,Values=running --query 'Reservations[].Instances[].{Id:InstanceId,Type:InstanceType,Prof:IamInstanceProfile.Arn,SGs:SecurityGroups[].GroupName}' --output table` (expect t3.micro, profile point-cd-runner-profile, SG cd-runner-sg)

### endpoints — MED · daytime
**Pre-req in state:** security_group's new 587 ingress on `vpc-endpoints-sg` for the email-smtp endpoint path — endpoints applies clean WITHOUT it, but the SMTP path stays dead until security_group lands.
Creates 5 new interface endpoints (ecr.api, email-smtp on 587, kms, monitoring, sts) + tightens 10 existing endpoint policies to named-role ArnEquals; no destroy/replace. The 6 not-yet-created IRSA/role principals cause ZERO apply errors (ARNs are string-interpolated, evaluated at request time).
```bash
cd terraform/components/endpoints
../../terraform.sh --env dev init
../../terraform.sh --env dev plan            # Expected: +5/~10/-0 (0 destroy/replace)
../../terraform.sh --env dev apply
```
**After:** `aws ec2 describe-vpc-endpoints --region ap-northeast-1 --filters Name=vpc-id,Values=vpc-0f49bf7456fa50d08 --query 'VpcEndpoints[].{Svc:ServiceName,State:State}' --output table` (expect the 5 new endpoints Available)

---

## 3. Secrets, notification chain, WAF (daytime)

### secrets_manager — MED · daytime
Creates exactly one NEW empty secret container `point/lambda/event-notification-to-slack`; the other 16 `point/*` secrets already exist and refresh clean. Apps consume new secrets via the CSI mount `/mnt/secrets-store/`.

```bash
cd terraform/components/secrets_manager
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: 1 to add, 0 to change, 0 to destroy (the add = aws_secretsmanager_secret.secrets["lambda/event-notification-to-slack"]); STOP if >1 add or any change/destroy/replace
../../terraform.sh --env dev apply
```
Then populate the placeholder (operator write action — the Slack-webhook value; empty container is enough to mark this row done, value only needed before event-notification's Lambda runs):
```bash
aws secretsmanager put-secret-value --secret-id point/lambda/event-notification-to-slack --secret-string '<slack-webhook-json>' --region ap-northeast-1
```
**After:** `aws secretsmanager list-secrets --region ap-northeast-1 --query "SecretList[?Name=='point/lambda/event-notification-to-slack'].Name" --output text`

### event-notification — LOW · daytime
**Pre-req in state:** secrets_manager (its Lambda submodule reads `point/lambda/event-notification-to-slack` via `data.aws_secretsmanager_secret` for the IAM policy — a cold plan before that secret exists fails at refresh).
Creates the SNS topic `alert-lambda-event-notification` + the SNS→Slack forwarder Lambda. Point-native dev gap (STG already has topic+Lambda+secret; DEV is missing all three) — this converges DEV to STG and unblocks notification. Component uses a flat `terraform.tfvars` (no `tfvars/dev.tfvars`); `--env dev` still resolves the dev state key.

```bash
cd terraform/components/event-notification
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Re-plan at HEAD (was blocked-on-upstream until secrets_manager); expect a clean all-add (SNS topic alert-lambda-event-notification + the event-notification-to-slack Lambda), 0 destroy/replace
../../terraform.sh --env dev apply
```
Populate the Slack-webhook secret value separately (operator write; empty container is enough for apply, only matters at Lambda runtime).
**After:** `aws sns list-topics --region ap-northeast-1 --query "Topics[?contains(TopicArn, 'alert-lambda-event-notification')]" --output text`

### notification — HIGH · daytime
**Pre-req in state:** secrets_manager + event-notification (reads the `alert-lambda-event-notification` topic via a data source; a cold plan before that topic exists fails `NoSuchEntity`).
Deferred here from its nominal Foundation slot. Adds 2 snapshot event subscriptions (Aurora + Redshift cluster-snapshot) and re-points the existing `redshift-point` subscription sink from `alert-lambda-infra` to `alert-lambda-event-notification`. Re-plan at HEAD (captured plan is stale). Component has no env-specific tfvars; `--env dev` uses common config + dev state key.

```bash
cd terraform/components/notification
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: 2 to add (aurora-point-cluster-snapshot + redshift-point-snapshot) + 1 to change (in-place re-point of redshift-point sns_topic_arn alert-lambda-infra -> alert-lambda-event-notification — do NOT halt on this), 0 to destroy; STOP on any UNEXPECTED destroy/replace of existing CloudWatch rules or RDS/Redshift subscriptions
../../terraform.sh --env dev apply
```
**After:** `aws rds describe-event-subscriptions --region ap-northeast-1 --query "EventSubscriptionsList[?CustSubscriptionId=='aurora-point-cluster-snapshot'].Status" --output text`

### waf-maintenance — LOW · daytime
Additive WAF maintenance ACL/IP-set update; verify the stale `104.28.236.107/32` entry is removed and no ALB WAF ACL relies on the now-empty `for_alb_ipv4` set.

```bash
cd terraform/components/waf-maintenance
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: additive in-place ACL/IP-set update, 0 destroy/replace
../../terraform.sh --env dev apply
```
**After:** `aws wafv2 list-ip-sets --scope CLOUDFRONT --region us-east-1` then `aws wafv2 get-ip-set --scope CLOUDFRONT --region us-east-1 --name <maintenance-ipset> --id <id>` — confirm `104.28.236.107/32` is absent.

### waf-admin — HIGH · daytime
**Pre-req in state:** infra/audit (Foundation Gate A — `aws-waf-logs.bs-point-dev` settled, not in REPLACE).
**STOP:** before apply, cross-check the 25 removed IPs against ec2-cd-runner / NAT GW / bastion egress (highest-risk delta) — do not strip an in-use egress IP.
Updates the standalone admin web ACL + IP set: adds 8 new office IPs, removes 25 legacy IPs.

```bash
cd terraform/components/waf-admin
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: 2 to add, 3 to change, 0 to destroy, 0 to replace; confirm aws-waf-logs.bs-point-dev NOT in REPLACE
../../terraform.sh --env dev apply
```
**After:** `aws wafv2 get-ip-set --scope CLOUDFRONT --region us-east-1 --name point-cloudfront-admin-allow-ipv4 --id 33026e8a-3830-4f5f-a9cc-ffc71fac325b --query 'IPSet.Addresses'` — confirm the 8 new IPs present and the 25 removed IPs absent. Functional check (after frontend-admin exists): allowlisted-IP `curl` admin → 200.

### waf-athena — LOW · daytime
**Pre-req in state:** infra/audit (Foundation Gate A).
Creates the Athena workgroup + Glue DB + Glue table over the WAF log bucket (read-only on the bucket); queries stay empty until waf-customer lands the CloudFront log source.

```bash
cd terraform/components/waf-athena
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: 3 to add, 0 to change, 0 to destroy (athena workgroup waf-logs-dev + glue DB waf_logs_dev + glue table waf_customer_access_logs); confirm aws-waf-logs.bs-point-dev NOT in REPLACE
../../terraform.sh --env dev apply
```
**After:** `aws athena get-work-group --region ap-northeast-1 --work-group waf-logs-dev --query 'WorkGroup.State' --output text` (expect ENABLED); Glue table `waf_customer_access_logs` queryable, 0 rows expected until waf-customer.

### s3-maintenance — LOW · daytime
Additive; creates/updates the per-brand maintenance S3 bucket(s).

```bash
cd terraform/components/s3-maintenance
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: additive, 0 destroy/replace
../../terraform.sh --env dev apply
```
**After:** `aws s3api get-public-access-block --bucket <s3-maintenance-bucket> --query 'PublicAccessBlockConfiguration'` — confirm all 4 blocks (BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy, RestrictPublicBuckets) are true.

---

## 4. Stateful (maintenance windows — real downtime) + glue-etl (daytime after)

> Run elasticache + redshift + aurora + aurora-validate_password as ONE Sunday-night block. Do the replica capture + scale-to-0 **once** at the start and the restore **once** at the end — never per-row. `glue-etl` is daytime, AFTER the window closes (additive, NOT inside downtime).

### Window open — capture replicas + scale all deploys to 0 (run ONCE)
Snapshot the live replica counts to `/tmp/replicas.txt`, sanity-check they are NON-ZERO, then scale every deployment to 0. Do NOT re-capture later in the window (a second capture after something already scaled to 0 records all-zeros, and the end-of-window restore would bring the namespace back up to 0).

```bash
kubectl get deploy -n default -o jsonpath='{range .items[*]}{.metadata.name}={.spec.replicas}{"\n"}{end}' > /tmp/replicas.txt
cat /tmp/replicas.txt        # sanity: api/admin/app/mmh/worker counts must be NON-ZERO
kubectl scale deployment --all -n default --replicas=0
kubectl get pods -n default  # wait until: No resources found
```

### elasticache — CRITICAL · maint window (Sun 23:30-Mon 00:00)
Recreates the `point` Redis replication group with at-rest + in-transit encryption (3 immutable attrs → forced REPLACE), attaches a new CMK, adds the engine-log group, and rewrites `point/SPRING_DATA_REDIS` with the new TLS endpoint. ~15-20 min downtime; cache data wiped (acceptable in dev).
**STOP:** the running pod image must already have Redis SSL (`spring.redis.ssl=true`, Lettuce `useSsl().disablePeerVerification()` + Redisson `rediss://`) — verify by live pod image DIGEST/label (tag is `:latest`), else the TLS-only cluster is unreachable and stays down past the window.
**STOP:** `aws kms list-aliases --region ap-northeast-1 | grep elasticache-redis` must be EMPTY (alias is created by this apply; if it already exists → `AlreadyExistsException`).

```bash
cd terraform/components/elasticache
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: 5 to add, 0 to change, 2 to destroy (replace pair). No lockfile — diff vs any captured plan, human-review any NEW destroy/replace before apply.
../../terraform.sh --env dev apply
```
**After:** `aws elasticache describe-replication-groups --replication-group-id point --region ap-northeast-1 --query 'ReplicationGroups[0].{AtRest:AtRestEncryptionEnabled,Transit:TransitEncryptionEnabled,Status:Status,Endpoint:NodeGroups[0].PrimaryEndpoint.Address}'` — expect AtRest=true, Transit=true, Status=available, NEW endpoint hostname.

### redshift — CRITICAL · maint window (Mon 00:00-01:00)
Re-keys the live `point` cluster from the AWS-managed default key to a customer-managed CMK (`alias/point-redshift`) and flips `require_ssl` false→true. The KMS swap is NOT supported in-place: disable encryption → terraform apply (CMK + SSL) → explicit reboot. ~30-60 min downtime. App JDBC must use `ssl=true`. CTO + analytics sign-off.
**STOP:** confirm the cluster is still on the AWS-managed key first — `KmsKeyId` should be `.../key/9a03243f-a2dc-4e04-ac66-c8ad1a9580c9`. The explicit `reboot-cluster` is mandatory: `require_ssl` is a static parameter and stays `pending-reboot` (SSL NOT enforced) without it.
**Pre-checks (before disabling encryption):** cross-region snapshot copy must be DISABLED, and check whether a `point` cluster exists in the secondary region — if it does, every Step 1/3 cluster operation below must be run for BOTH regions:
```bash
aws redshift describe-clusters --region ap-northeast-1 --cluster-identifier point --query 'Clusters[0].ClusterSnapshotCopyStatus'   # expect: null (if set, disable snapshot copy first)
aws redshift describe-clusters --region ap-northeast-3 --cluster-identifier point --query 'Clusters[0].{Status:ClusterStatus,Encrypted:Encrypted}' 2>&1   # "ClusterNotFound" = single-region; anything else = secondary EXISTS
```

**Step 0 — manual snapshot (console):** before any cluster mutation, take a manual snapshot from the AWS console (Redshift → Clusters → `point` → Actions → Create snapshot, name e.g. `point-pre-cmk-<date>`) and wait until it shows **Status = Available** with size > 0. This is the rollback point — restore via restore-from-cluster-snapshot if anything goes wrong. Do NOT proceed until the snapshot is Available.

```bash
cd terraform/components/redshift
# Step 1 — disable encryption to ENABLE the AWS-managed -> CMK swap (cluster is already Encrypted:true).
# NOTE: this migrates the data to a NEW cluster behind the scenes — ClusterCreateTime resets and the
# console "Total used storage" panel can show 0 bytes for a while (metric lag on the new cluster).
# That is EXPECTED, not data loss — confirm data via CloudWatch TotalTableCount, not the console panel.
aws redshift modify-cluster --region ap-northeast-1 --cluster-identifier point --no-encrypted
# Step 1b — ONLY if the pre-check found a secondary-region cluster: disable encryption there too
# (the key swap must be applied consistently in both regions before terraform):
#   aws redshift modify-cluster --region ap-northeast-3 --cluster-identifier point --no-encrypted
#   aws redshift wait cluster-available --region ap-northeast-3 --cluster-identifier point
aws redshift wait cluster-available --region ap-northeast-1 --cluster-identifier point
aws redshift describe-clusters --region ap-northeast-1 --cluster-identifier point --query 'Clusters[0].[ClusterStatus,Encrypted]'   # MUST be ["available", false] before terraform
# Data sanity — table count must be unchanged through the migration:
aws cloudwatch get-metric-statistics --region ap-northeast-1 --namespace AWS/Redshift --metric-name TotalTableCount --dimensions Name=ClusterIdentifier,Value=point --start-time $(date -u -v-30M +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -d '-30 min' +%Y-%m-%dT%H:%M:%S) --end-time $(date -u +%Y-%m-%dT%H:%M:%S) --period 300 --statistics Average --query 'sort_by(Datapoints,&Timestamp)[].[Timestamp,Average]' --output text
# Step 2 — terraform (CMK + alias/point-redshift + require_ssl=true, apply_immediately; covers BOTH regions if secondary exists):
../../terraform.sh --env dev init -upgrade   # -upgrade REQUIRED: the committed lockfile pins aws provider 4.67.0 but the redshift module 6.2.0 constraint is ~> 5.0, >= 5.45.0 — plain init fails. The "changes to .terraform.lock.hcl" message is expected (provider moves to 5.x).
../../terraform.sh --env dev plan
# Expected: 2 to add, 3 to change, 0 to destroy —
#   add:    KMS key + alias/point-redshift
#   change: cluster (encrypted=true + kms_key_id + apply_immediately + preferred_maintenance_window),
#           parameter group (require_ssl false->true), snapshot schedule (cron definition)
# The "Objects have changed outside of Terraform" drift note showing encrypted true->false is
# EXPECTED — it records the Step 1 manual disable. STOP only on any destroy/replace.
# Redshift accepts only ONE cluster modification at a time — a single full apply races the
# param-group/snapshot-schedule modifies against the cluster re-encrypt and fails with
# InvalidClusterState "concurrent operation" (observed on dev 2026-06-12). Apply in 2 phases:
# Phase A — everything EXCEPT the cluster modify (KMS key + alias, param group, snapshot schedule).
# The "-target ... Resource targeting is in effect" warning from terraform is expected here:
../../terraform.sh --env dev apply -target=aws_kms_key.redshift -target=aws_kms_alias.redshift -target='module.redshift[0].aws_redshift_parameter_group.this' -target=aws_redshift_snapshot_schedule.default
aws redshift wait cluster-available --region ap-northeast-1 --cluster-identifier point
# Phase B — full apply: only the cluster modify remains.
../../terraform.sh --env dev plan   # expect EXACTLY: 0 to add, 1 to change, 0 to destroy (cluster only: encrypted false->true + kms_key_id + preferred_maintenance_window)
../../terraform.sh --env dev apply  # starts the CMK re-encrypt = background cluster migration (~10-25 min; console storage may again briefly show 0 bytes)
aws redshift wait cluster-available --region ap-northeast-1 --cluster-identifier point
../../terraform.sh --env dev plan   # state-sync check: expect "No changes."
# Step 3 — EXPLICIT reboot (require_ssl is a static param — does not take effect until reboot):
aws redshift reboot-cluster --region ap-northeast-1 --cluster-identifier point
aws redshift wait cluster-available --region ap-northeast-1 --cluster-identifier point
# Step 3b — ONLY if a secondary-region cluster exists: reboot it too so its require_ssl leaves pending-reboot:
#   aws redshift reboot-cluster --region ap-northeast-3 --cluster-identifier point
#   aws redshift wait cluster-available --region ap-northeast-3 --cluster-identifier point
# Step 4 — refresh the historical JDBC URL with ssl=true (REQUIRED: after require_ssl=true, pods restarting
# with the old non-SSL URL get rejected). The script sources init.sh by RELATIVE path — run from inside the dir:
cd ../../tool/db-user-manager
bash redshift-refresh-spring-boot-secret.sh
aws secretsmanager get-secret-value --secret-id point/SPRING_DATASOURCE_HISTORICAL --query SecretString --output text | jq -r '.SPRING_DATASOURCE_HISTORICAL_URL'   # expect: ...?ssl=true&sslmode=verify-ca
```
**After:** `aws redshift describe-clusters --region ap-northeast-1 --cluster-identifier point --query 'Clusters[0].{Status:ClusterStatus,KmsKeyId:KmsKeyId}'` — KmsKeyId must resolve to `alias/point-redshift` CMK and NOT `9a03243f-...` (repeat for ap-northeast-3 if a secondary cluster exists); `aws redshift describe-cluster-parameters --region ap-northeast-1 --parameter-group-name point-redshift-1-0-custom-params --query "Parameters[?ParameterName=='require_ssl'].ParameterValue"` = true; key rotation on the CMK: `aws kms get-key-rotation-status --region ap-northeast-1 --key-id $(aws kms list-aliases --region ap-northeast-1 --query "Aliases[?AliasName=='alias/point-redshift'].TargetKeyId" --output text)` → `KeyRotationEnabled: true`. After the window-close replica restore: scan pod logs for `connection requires ssl|ssl_error|HikariPool.*historical` (expect none) and, from the bastion via psql as master, `SELECT recordtime, username, sslversion, sslcipher FROM stl_connection_log WHERE recordtime >= dateadd(hour,-1,getdate()) AND event='authenticated' ORDER BY recordtime DESC LIMIT 10;` — every row shows non-empty `sslversion`/`sslcipher`.

### aurora — CRITICAL · maint window (Sun 23:00-Mon 00:30)
In-place port flip 3306→13306 (cluster reboot, ~5-15 min) + KMS alias add + secret_version replace (port-driven re-version, the master password is unchanged). Cluster `point` already exists and is in state — this is NOT a greenfield create. CTO + DBA sign-off.
**Pre-req in state:** the mysql-sg (`sg-007ebd984a0ba881c`) must already allow inbound 13306 (from security_group, SAME window) or pods get a connectivity blackout after the reboot.
**STOP:** if the plan shows the cluster being CREATED or DESTROYED → halt. The single destroy in the summary is the `aws_secretsmanager_secret_version` REPLACE (port re-version), not the cluster.

```bash
cd terraform/components/aurora
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: 2 to add, 4 to change, 1 to destroy (the 1 destroy = secret_version REPLACE for the port re-version). No lockfile — diff vs captured plan, human-review before apply.
../../terraform.sh --env dev apply
```
After apply, run the port-sync scripts from the bastion (they SYNC the new port into the 4 Aurora user secrets + the Spring Boot JDBC URL — they do NOT bootstrap users; the secrets already exist) BEFORE the window-end restore:
```bash
bash terraform/tool/db-user-manager/aurora-update-port-in-secrets.sh
bash terraform/tool/db-user-manager/aurora-update-spring-boot-secret.sh
```
**After:** `aws rds describe-db-clusters --region ap-northeast-1 --db-cluster-identifier point --query 'DBClusters[0].{Status:Status,Port:Port,Audit:EnabledCloudwatchLogsExports}'` — expect Status=available, Port=13306, Audit contains "audit".

#### aurora validate_password — MED · same window (chained to aurora)
Rotate the existing DB passwords FIRST (NOT skippable here: the cluster/users/secrets pre-exist, current-password compliance is unverified, and the plugin never re-checks existing passwords), then install the `validate_password` plugin via the bastion script (Aurora MySQL 3.x param group is `IsModifiable:false`, so INSTALL PLUGIN is the only path). No init/plan/apply. Run AFTER the aurora port-sync scripts so the rotation scripts read the new port (13306) from the secrets. Pods pick up the rotated secrets at the window-close replica restore (CSI re-reads on pod start) — no separate rolling restart needed while replicas are 0; if pods are running, `kubectl rollout restart` of the 5 point deployments.
```bash
# The rotate/install scripts `source init.sh` by RELATIVE path — they MUST be run from
# inside terraform/tool/db-user-manager. Running via full path from the repo root fails
# with "init.sh: No such file or directory".
cd terraform/tool/db-user-manager
# Step 1 — rotate master (prompts for the CURRENT master password; fetch it first):
aws secretsmanager get-secret-value --secret-id point/aurora/master_user --query SecretString --output text | jq -r .password
bash aurora-update-master-password.sh   # rotates master + updates point/aurora/master_user
# Step 2 — rotate the 4 service users (prompts for the NEW master password; re-fetch with the same command):
bash aurora-update-passwords.sh         # rotates point/point_viewer/editor/viewer + refreshes point/SPRING_DATASOURCE_MASTER
# Step 3 — install plugin (asserts ACTIVE, fails loudly otherwise):
bash aurora-install-validate-password.sh
```
Then verify (all via master from the bastion): `plugin_status = ACTIVE` (+ `plugin_type = VALIDATE PASSWORD`); `SHOW VARIABLES LIKE 'validate_password%'` returns exactly 7 rows (policy=MEDIUM, length=8, mixed_case_count=1, number_count=1, special_char_count=1, check_user_name=ON, dictionary_file=empty); 4 negative tests each returning `ERROR 1819 (HY000)` — too short (`'short'`), no special char (`'NoSpecialChar123'`), no digit (`'NoDigitChar#@%'`), password=username; 1 positive test (`'Strong#Pass1234'`) accepted; then `DROP USER IF EXISTS` cleanup for all test users. Rotation evidence: `password_last_changed` = today for the 5 users (`master`,`point`,`point_viewer`,`editor`,`viewer`) and all 5 secret passwords length=20 with a special char. Capture terminal output as the evidence log. Rollback if needed: `aurora-uninstall-validate-password.sh`.

### Window close — restore replicas (run ONCE)
After ALL stateful applies + secret syncs (Redis TLS endpoint, Aurora port into the user secrets + JDBC URL, Redshift historical JDBC URL with `ssl=true`) are done, restore from the file captured at window open. This re-reads the new port/endpoint into the pods via the CSI driver on pod start.

```bash
while IFS='=' read -r d n; do kubectl scale deployment "$d" -n default --replicas="$n"; done < /tmp/replicas.txt
kubectl get deploy -n default   # all desired = ready, no CrashLoopBackOff
```

### glue-etl — MED · daytime (AFTER the stateful window closes — additive, NOT inside downtime)
**Blocked-until:** ~~vpc secondary-CIDR `100.64.0.0/16` subnets~~ ✅ CLEARED 2026-06-11 (vpc applied — subnets exist, the `data.tf:32` subnet postcondition now passes). Remaining prereqs: aurora on 13306 + redshift up + security_group `mysql-sg` + secret `point/aurora/viewer_service`. NOT EKS (Glue serverless).
Creates the S3 staging/meta buckets + Glue jobs + glue SG + daily trigger (Aurora→S3→Redshift ETL). It also MODIFIES the redshift cluster (S3 event-integration + IAM) → re-plan after redshift is up and confirm no redshift disruption.
**⚠ Trigger created DEACTIVATED by default** (`triggers.tf` sets `start_on_creation = false`): the apply creates `aurora-to-s3-trigger` in state `CREATED` — the daily schedule does NOT fire until manually activated. Activate only after the team confirms the ETL should start running: `aws glue start-trigger --region ap-northeast-1 --name aurora-to-s3-trigger`.

```bash
cd terraform/components/glue-etl
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: +55/~0/-0 (re-verified live 2026-06-11 after vpc secondary-CIDR applied — data.tf subnet postcondition passes; +11 vs the old partial capture = glue connection, jobs 01-05, trigger, event rules/targets)
../../terraform.sh --env dev apply
```
**After:** `aws glue get-jobs --region ap-northeast-1 --query 'Jobs[].Name'` lists the batch jobs; the trigger + EventBridge failure rule + redshift S3 event integration exist (daily trigger `cron(5 15 * * ? *)` = 00:05 JST). Trigger state right after apply is `CREATED` (NOT `ACTIVATED` — `start_on_creation = false`): `aws glue get-trigger --region ap-northeast-1 --name aurora-to-s3-trigger --query 'Trigger.State'` → `"CREATED"`. The ETL only starts firing after the manual `aws glue start-trigger` step above (re-check → `"ACTIVATED"`).

---

## 5. EKS block (the climax — three interleaved changes, two points of no return)

The single `eks` component (`terraform/components/eks`) carries three distinct changes. Do NOT collapse them into one "apply eks". The order is fixed (re-arranged 2026-06-12): **ec2-cd-runner (already applied in section 2) → sub-block A0 = `eks/1.31`/PR #99 (module v21 + auth Stage 1 dual-mode at live 1.31) + dual-mode prove-gate + Stage 2 final flip `→API` from `eks/1.31-api` (`468f10f`) in the SAME window, BEFORE the ladder → version ladder (runs entirely under final `API` mode).** `release/verup` HEAD already pins `API` (`cfe1c56c`) — no PR #98 merge after the flip; `eks/auth-mode-bridge` is superseded. `point-cd-runner-role` already exists (created by ec2-cd-runner in section 2), so the API-mode access entry resolves. The module upgrade is a *hard* point of no return (v17→v21 module upgrade replaces all 5 node groups and drops 4 cluster-role policy attachments); the auth-mode `→API` flip is the *absolute* point of no return (AWS rejects `API→CONFIG_MAP`; with no implicit creator fallback, a botched flip = total admin lockout). Apply-day discipline for this component: it has NO committed lockfile, so before EACH apply, re-plan against the live backend and human-review any new destroy/replace.

### eks — module v21 + auth-mode flip 2-stage @ 1.31 (sub-block A0 — MERGED with the old sub-block B, 2026-06-12) — CRITICAL · runs FIRST in the EKS block, BEFORE the ladder
**🟡 STATUS 2026-06-12: the bundled Stage-1 apply ran on DEV and FAILED at the node roll** — cluster-level changes landed (`1.31`/`API_AND_CONFIG_MAP`, access entries, IAM restructuring) but **no new node ever joined**; EKS rolled all 5 node groups back to the June-10 nodes (`1.31.14-20260512`). Root cause (CloudTrail-confirmed, 100%): **CNI IAM deadlock** — worker role lost `AmazonEKS_CNI_Policy` while the vpc-cni IRSA wiring waits behind the node roll in module v21; CloudTrail records 48×+19× `ec2:DescribeNetworkInterfaces → Client.UnauthorizedOperation` from the failed instances (both attempts), and the same records exonerate the LT-v5 IMDS options and the new AMI. ⚠ The surviving OLD fleet is degraded too: 16× `ec2:AssignPrivateIpAddresses → UnauthorizedOperation` — new-pod IP assignment will fail once the warm pool is exhausted, so the IRSA wiring step is URGENT. **All DEV repair steps live in `INCIDENT-EKS-131-APPLY-DEV-20260612.md` (Runbook A) — do not improvise from this section.** The sequence below is for a FRESH env (STG/PRD).

**CANONICAL Stage-1 sequence for a FRESH apply (STG, future PRD) — verified against module v21 source + empirical DEV plans 2026-06-12:**
```bash
# Step 0 — account guard + branch + tfvars version gate
aws sts get-caller-identity        # confirm the expected account before anything else
cd terraform/components/eks
git checkout eks/1.31              # (or the STG equivalent branch)
# GATE (STG): tfvars/<env>.tfvars must pin cluster_version / cluster_node_version to the STAGE value 1.31,
# NOT the final 1.34. A 1.31 -> 1.34 jump is rejected by EKS (one minor per upgrade) and is done later via
# the version ladder. A plan that shows "cluster_version 1.31 -> 1.34" = STOP and fix the tfvars.
# (vpc-cni v1.21.1-eksbuild.7 is valid on EKS 1.31, so the addon version need not change.)
../../terraform.sh --env <env> init --upgrade

# Step 1 — enumerate live access entries; import every collision the component declares.
# Skipping this guarantees a 409 ResourceInUseException (on DEV: user/bs-developer existed since cluster creation).
aws eks list-access-entries --cluster-name point --region ap-northeast-1
# for each principal that BOTH already exists live AND is declared in locals.eks_access_entries:
../../terraform.sh --env <env> import 'module.eks.aws_eks_access_entry.this["<key>"]' point:<principal-arn>

# Step 2 — apply RBAC bindings FIRST, while admin access still works via aws-auth.
# The moment a STANDARD access entry is created it overrides that principal's aws-auth mapping;
# without the group binding the principal is locked out (this is exactly what hit the DEV bastion).
kubectl apply -f k8s-manifests/rbac/
kubectl get clusterrolebinding admin-cluster-admin    # must exist before proceeding

# Step 3 — create the CNI IRSA role FIRST (targeted apply; scope verified clean on DEV 2026-06-12:
# these are root-level resources whose only deps are data sources — NO node group is dragged in).
# Pre-req: the cluster's OIDC provider must already exist (it does on dev/stg — IRSA is in use).
../../terraform.sh --env <env> apply -target=aws_iam_role.vpc_cni_aws_node -target=aws_iam_role_policy_attachment.vpc_cni_aws_node

# Step 4 — full plan + apply, with before_compute = true + the moved block in the code (PRIMARY method).
# WHY this is the fix: in module v21, aws_eks_addon.this depends_on the node-group modules (verified in
# source), so by default the addon update is ordered AFTER the node roll — but new nodes need the wired
# CNI to become Ready (DEV root cause: AmazonEKS_CNI_Policy detached from the worker role + IRSA not yet
# wired → permissionless ipamd CrashLoops :50051 → nodes never Ready). before_compute = true moves the
# addon to aws_eks_addon.before_compute (no node-group depends_on), so the IRSA role is wired WITHOUT
# waiting for the node roll; the moved block keeps it an in-place update (not a destroy that, with
# preserve = false, would delete the live CNI). Plan-verified read-only on DEV + STG.
# Review gates (anything else = STOP):
#   addon vpc-cni: "will be updated in-place" + "(moved from …aws_eks_addon.this[\"vpc-cni\"])" +
#     service_account_role_arn set (existing-role env → concrete ARN; fresh env → known after apply)
#   node groups: ~ in-place (moves.tf preserves addresses), NOT -/+ replace
#     (STG caveat: if node_group_name is pinned to the ladder target …-1-34-… while the live names are
#      …-20260508, the plan shows replace ×5 — AWS-valid and before_compute keeps the new nodes' CNI
#      working, but it is a full node-group churn; pin node_group_name to the live names for an in-place
#      roll. Decide before applying.)
#   destroys ONLY AmazonEKSServicePolicy + AmazonEKSVPCResourceController
#     (pre-check the latter is unused: kubectl get securitygrouppolicies.vpcresources.k8s.aws -A -> empty)
../../terraform.sh --env <env> plan
../../terraform.sh --env <env> apply   # node roll ~15-20 min per group
kubectl get sa aws-node -n kube-system -o jsonpath='{.metadata.annotations}'   # role-arn .../point-vpc-cni-aws-node
kubectl rollout status ds/aws-node -n kube-system && kubectl get pods -n kube-system -l k8s-app=aws-node   # 2/2 Running

# Strict-ordering variant (optional) — wire the addon fully before any node rolls. Both are pure
# Terraform (state mv is state-only, not an AWS write); use when you want a hard "addon first" guarantee.
# NOTE: the state-mv source below assumes the addon is already at aws_eks_addon.this (a cluster already
# on the v21 module, e.g. DEV). On a still-v17 cluster (STG today) the addon is at aws_eks_addon.vpc_cni[0]
# and the in-code moved chain in Step 4 relocates it automatically — no manual state mv needed there.
#   terraform state mv 'module.eks.aws_eks_addon.this["vpc-cni"]' 'module.eks.aws_eks_addon.before_compute["vpc-cni"]'
#   ../../terraform.sh --env <env> apply -target='module.eks.aws_eks_addon.before_compute["vpc-cni"]'   # role only, no node roll
#   ../../terraform.sh --env <env> apply                                                                 # then rolls nodes onto a ready CNI
# FALLBACK (no code change) — wire the addon out-of-band via the EKS API, then run the full apply.
# A -target on aws_eks_addon.this does NOT isolate it (its depends_on drags the node groups in):
#   aws eks update-addon --cluster-name point --addon-name vpc-cni --service-account-role-arn arn:aws:iam::<account>:role/point-vpc-cni-aws-node --resolve-conflicts OVERWRITE --configuration-values '{"enableNetworkPolicy":"true"}' --region ap-northeast-1
# emergency CNI fallback if rolled aws-node pods crash on IRSA:
#   aws iam attach-role-policy --role-name eks-worker-role --policy-arn arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy

# Step 5 — post-verify
aws eks describe-cluster --name point --region ap-northeast-1 --query 'cluster.[version,accessConfig.authenticationMode]' --output text   # 1.31  API_AND_CONFIG_MAP
# for each of the 5 node groups (admin/api/app/worker/mmh):
aws eks describe-nodegroup --cluster-name point --nodegroup-name <node-group-name> --query 'nodegroup.{status:status,rel:releaseVersion,health:health}' --region ap-northeast-1
kubectl get nodes -o wide && kubectl get pods -A | grep -v Running | head
kubectl auth can-i '*' '*'   # expect yes — every mapped principal keeps access
```
**Stop conditions:** Step 4 plan shows the vpc-cni addon as `-/+` replace or destroy (the `moved` block is missing — STOP, do not apply: with `preserve = false` a destroy deletes the live CNI), any destroy beyond the 2 policy attachments, or an UNINTENDED node-group `-/+` replace → STOP. Apply hits `NodeCreationFailure` → check `kubectl get pods -n kube-system -l k8s-app=aws-node` on the new node before anything else.
**Code fix is the PRIMARY method (plan-verified read-only on DEV + STG):** `before_compute = true` on the vpc-cni addon moves it to `aws_eks_addon.before_compute` (module v21 source: no `depends_on` the node groups), so the IRSA role wires without waiting for the node roll — the structural fix for the deadlock. It needs the `moved` block (`aws_eks_addon.this["vpc-cni"]` → `aws_eks_addon.before_compute["vpc-cni"]`), else Terraform plans destroy+create and the `preserve = false` destroy deletes the live CNI. Caveat: `before_compute` adds no reverse edge, so the addon update and node roll run in parallel — in practice the addon (~15s) wins vs node bootstrap (minutes), and the node-group health window (~15 min) absorbs any transient flake; for a hard "addon first" guarantee use the strict-ordering variant (state mv + `-target`) in Step 4. The out-of-band `aws eks update-addon` is the FALLBACK for when the code cannot be changed.
**Pre-req:** ec2-cd-runner applied (`point-cd-runner-role` exists — the `cd_runner` access entry is created by this apply). ✅ Verified live 2026-06-12: entry exists.
**Pre-step (any env): enumerate + import pre-existing access entries** — `aws eks list-access-entries --cluster-name point --region ap-northeast-1`; for each principal the component declares that already exists, `../../terraform.sh --env <env> import 'module.eks.aws_eks_access_entry.this["<key>"]' point:<principal-arn>` (on DEV: `named_user` ↔ `user/bs-developer`). Skipping this guarantees a 409 `ResourceInUseException`.
**Pre-step (any env): apply RBAC bindings BEFORE the apply that creates STANDARD access entries** — `kubectl apply -f k8s-manifests/rbac/` while admin access still works via aws-auth. Creating an entry instantly overrides that principal's aws-auth mapping; without the group binding it is locked out (this is exactly what hit the bastion on DEV).
**STOP — point of no return (hard):** the v17→v21 module upgrade DROPS 4 cluster-role policy attachments: `AmazonEKSServicePolicy` (deprecated), `AmazonEKSVPCResourceController`, plus custom `point-deny-log-group` and `point-elb-sl-role-creation`; only `AmazonEKSClusterPolicy` is preserved. GATE: before applying, confirm those 4 drops are safe for this cluster's features (e.g. VPCResourceController not required — SecurityGroupsForPods). The CNI policy intentionally moves to a dedicated IRSA role `vpc_cni_aws_node`. Review the plan for node-group replacement behavior under v21 (live names are kept to minimize it; the deliberate rename-roll happens at the 1.34 hop).
Stage 1 applies `eks/1.31` (`3ec84a5e`, PR #99): module v17→v21 + `authentication_mode CONFIG_MAP→API_AND_CONFIG_MAP` (dual mode) at the live version — no version change. During the dual window, PROVE an API-mode admin call (the only safe rehearsal), then Stage 2 applies `eks/1.31-api` (`468f10f` = `eks/1.31` + a single dev.tfvars line `authentication_mode = "API"`) in the SAME window.
**STOP — point of no return (absolute, Stage 2):** AWS REJECTS a direct CONFIG_MAP→API flip and allows no downgrade from `API`; `enable_cluster_creator_admin_permissions=false` → a botched flip locks out every admin. Before Stage 2: (1) `kubectl get clusterrolebinding admin-cluster-admin` returns the binding; (2) `named_user = bs-developer` + aws-auth userarn `bs-developer` (both committed); (3) API-mode admin proven in the dual window; (4) escape hatch confirmed (`custodian-AdministratorRole` holds `eks:CreateAccessEntry` + can bind `AmazonEKSClusterAdminPolicy`).
```bash
# DUAL-MODE PROVE-GATE (mandatory after Stage 1 / before Stage 2):
kubectl get clusterrolebinding admin-cluster-admin && kubectl auth can-i '*' '*'
kubectl get cm aws-auth -n kube-system
# ---- Step 6b: refresh the 4 kubectl-managed add-ons while still at eks/1.31, BEFORE the Stage-2 flip ----
# The v21 node roll put nodes on IMDSv2 hop-limit-1, so region-less workloads CrashLoop
# (cluster-autoscaler MissingRegion; cloudwatch-agent onPrem). Get the cluster fully green
# BEFORE the point-of-no-return flip. metrics-server is also version-bumped (live v0.6.3 -> v0.8.1).
# These manifests now carry AWS_REGION (autoscaler) and agent.region + RUN_WITH_IRSA (cwagent).
kubectl apply -f k8s-manifests/point/dev/kube-system/cluster-autoscaler.yaml   # v1.31.5 + AWS_REGION (image per branch)
kubectl apply -f k8s-manifests/point/dev/kube-system/metrics-server.yaml       # v0.8.1 (1.31+; live was v0.6.3)
kubectl apply -f k8s-manifests/point/dev/amazon-cloudwatch/cwagent.yaml        # region in ConfigMap + RUN_WITH_IRSA
kubectl apply -f k8s-manifests/point/dev/amazon-cloudwatch/fluent-bit.yaml     # 3.2.5 (node-role, hostNetwork, IMDS-immune)
kubectl -n kube-system rollout status deploy/cluster-autoscaler && kubectl -n kube-system rollout status deploy/metrics-server && kubectl -n amazon-cloudwatch rollout status ds/cloudwatch-agent && kubectl -n amazon-cloudwatch rollout status ds/fluent-bit   # all Running, no CrashLoop/MissingRegion
# ---- Stage 2 (same window): final flip -> API ----
git checkout eks/1.31-api   # 468f10f: eks/1.31 + authentication_mode = "API" (do NOT use eks/auth-mode-bridge — it pins 1.34)
../../terraform.sh --env dev plan    # Expected: ONLY accessConfig.authenticationMode API_AND_CONFIG_MAP -> API
../../terraform.sh --env dev apply
```
**After:** `aws eks describe-cluster --name point --region ap-northeast-1 --query 'cluster.[version,accessConfig.authenticationMode]' --output text` (after Stage 1: `1.31	API_AND_CONFIG_MAP`; after Stage 2: `1.31	API`); `aws eks list-access-entries --cluster-name point --region ap-northeast-1 --query 'length(accessEntries)' --output text` → `9` (verified live 2026-06-12: 7 declared + auto `AWSServiceRoleForAmazonEKS` + auto `eks-worker-role` EC2_LINUX); re-confirm `kubectl auth can-i '*' '*'` → `yes` after Stage 2 (access entries now solely govern access).


### eks — version ladder 1.31 → 1.32 → 1.33 → 1.34 (sub-block A) — CRITICAL · weeknight 23:00 (one minor per branch)
**Blocked-until:** branches `eks/1.32`, `eks/1.33`, `eks/1.34` exist — **created and pushed 2026-06-10**, each a small pinned delta on top of `release/verup` `376dc7be` (`eks/1.32` = dev.tfvars pinned to 1.32 with live node-group/addon pins; `eks/1.33` = identical except `cluster_version = "1.33"`; `eks/1.34` = HEAD's 1.34 pins; **all three pin `authentication_mode = "API"` (re-pinned — verified 2026-06-12)** — the FULL 2-stage flip completes at sub-block A0 BEFORE the ladder, and EKS allows no auth-mode downgrade, so never re-introduce `API_AND_CONFIG_MAP`/`CONFIG_MAP` here). Access entries are created at the #19b Stage-1 apply and stay no-op through the ladder (main.tf retains a defensive `access_entries = {}` gate that only activates under CONFIG_MAP). Each branch = its own pinned `cluster_version` + `cluster_node_version` + node-group name suffix; a bare `cluster_version` bump is INSUFFICIENT (a 1.34-named node group cannot be created on a sub-1.34 control plane, and HEAD's single config pins everything to 1.34 → a rejected 1.31→1.34 jump).
**STOP — node-fleet roll at the 1.34 hop:** the v17→v21 module upgrade (and its policy-drop gate) already ran at sub-block A0. The 1.34 hop REPLACES all 5 node groups via the `-1-34-20260428` rename (create-before-destroy node-fleet roll — plan a window); the 1.32/1.33 hops keep nodes at live 1.31 pins.
This steps the control plane one minor at a time; AWS rejects multi-minor jumps. No downtime per hop. Module-upgrade blast-radius reference (single-component HEAD plan, which also bundles the auth flip): `+34/~13/-18/⟳5` — do NOT expect this number per hop.

Run the cycle below ONCE per minor, in order `eks/1.32` → `eks/1.33` → `eks/1.34` (substitute the branch each time; upgrade `kubectl` before the 1.34 hop):
```bash
cd terraform/components/eks
git checkout eks/1.32
../../terraform.sh --env dev init --upgrade
../../terraform.sh --env dev plan   # Expected: version steps exactly ONE minor (1.31->1.32); module passes the version straight through, no auto-stepping. Re-diff vs captured plan; human-review any NEW destroy/replace (no committed lockfile).
../../terraform.sh --env dev apply
aws eks update-kubeconfig --name point --region ap-northeast-1
# upgrade the 5 managed node groups to this minor, then soak (no CrashLoopBackOff) before the next hop
```
**After:** `aws eks describe-cluster --name point --region ap-northeast-1 --query 'cluster.{version:version,status:status}' --output json`  (per-rung: 1.32, then 1.33, then 1.34; status ACTIVE)

---

## 6. Post-EKS: k8s manifests, S3, EC2, CloudWatch, frontends, waf-customer tail (daytime; waf-customer = maint window)

### k8s-manifests — MED (HIGH for mmh) · daytime
**Pre-req in state:** EKS control plane + all 5 node groups at 1.34 (section 5 ladder complete); the `point-app-irsa-role` IAM role is created by the eks apply — but the k8s objects below (PSA labels, default-SA, network policies, SecretProviderClass, point-app ServiceAccount, ingress) are NOT terraform-managed; they are applied here via kubectl, mirroring `k8s_apply.sh`. Full standalone version (managed-vs-self-managed table, current-state, gates): `docs/migrations/release-final/dev/K8S-MANIFEST-APPLY-RUNBOOK.md` (STAGE B).
**STOP:** before the deployments, verify the deployed admin/mmh `:latest` image (pull policy `Always`) contains the app-side CSI bridge (`SecretsEnvironmentPostProcessor` reading `/mnt/secrets-store/`). If absent, the pods migrate to CSI Secrets Store and lose secret access.
NOT terraform. Order mirrors `k8s_apply.sh`, with the ALB v3 upgrade merged in FIRST: aws-load-balancer-controller v2→v3 → RBAC → PSA labels → default-SA → network policies → SecretProviderClass → point-app ServiceAccount → 5 deployments → ingress. Run `kubectl diff` BEFORE every `kubectl apply`. **ALB timing**: the v2→v3 upgrade ran at 1.31 in earlier drafts; merged here it runs at 1.34 right before the app deploys — the old v2.4.3 controller idles over the dormant ALB through the ladder (apps 0/0, low risk). The deployments cut over from env-injected secrets to the CSI Secrets Store mount.
```bash
cd k8s-manifests   # run `kubectl diff` BEFORE every `kubectl apply`; apply only after reviewing the diff
# 0) aws-load-balancer-controller v2->v3 upgrade (major; helm upgrade never touches CRDs, chart 3.x adds 2 CRDs -> apply chart-3.1.0 CRDs FIRST)
kubectl diff -f point/dev/aws-load-balancer-controller-service-account.yaml ; kubectl apply -f point/dev/aws-load-balancer-controller-service-account.yaml
helm repo add eks https://aws.github.io/eks-charts ; helm repo update eks
helm pull eks/aws-load-balancer-controller --version 3.1.0 --untar -d /tmp/alb-v3
kubectl diff -f /tmp/alb-v3/aws-load-balancer-controller/crds/crds.yaml ; kubectl apply -f /tmp/alb-v3/aws-load-balancer-controller/crds/crds.yaml
helm upgrade -i aws-load-balancer-controller eks/aws-load-balancer-controller --version 3.1.0 --values point/dev/aws-load-balancer-controller.yaml -n kube-system
kubectl -n kube-system rollout status deploy/aws-load-balancer-controller
# 1) RBAC (admin->cluster-admin binding; idempotent — already landed as the pre-flip gate)
kubectl diff -f rbac/
kubectl apply -f rbac/
# 2) Pod Security Admission namespace labels
kubectl diff -f point/base/namespace-psa.yaml
kubectl apply -f point/base/namespace-psa.yaml
# 3) default ServiceAccount (disable token automount)
kubectl diff -f point/dev/default-service-account.yaml
kubectl apply -f point/dev/default-service-account.yaml
# 4) Network policies — 3 base (default-deny/allow-dns/allow-internal) + 2 per-env (ingress-vpc/egress-vpc)
kubectl diff -f point/base/networkpolicy-default-deny.yaml -f point/base/networkpolicy-allow-dns.yaml -f point/base/networkpolicy-allow-internal.yaml -f point/dev/networkpolicy-allow-ingress-vpc.yaml -f point/dev/networkpolicy-allow-egress-vpc.yaml
kubectl apply -f point/base/networkpolicy-default-deny.yaml -f point/base/networkpolicy-allow-dns.yaml -f point/base/networkpolicy-allow-internal.yaml -f point/dev/networkpolicy-allow-ingress-vpc.yaml -f point/dev/networkpolicy-allow-egress-vpc.yaml
# 5) SecretProviderClass (before the deployments)
kubectl diff -f point/base/secret-provider-class.yaml
kubectl apply -f point/base/secret-provider-class.yaml
# 6) point-app ServiceAccount (k8s SA; the IRSA role point-app-irsa-role is terraform-created)
kubectl diff -f point/dev/point-app-service-account.yaml
kubectl apply -f point/dev/point-app-service-account.yaml
# 7) Deployments — diff + apply EACH overlay ONE AT A TIME (no loop); soak each before the next
#    'kubectl apply -k' uses kubectl's bundled Kustomize (v5.5.0 in kubectl 1.32) — verified to render these overlays'
#    'labels: includeTemplates' + 'patches:' (need kubectl >=1.27, satisfied by the ladder's kubectl upgrades; no standalone kustomize required)
kubectl diff -k point/dev/app    -n default ; kubectl apply --dry-run=server -k point/dev/app    -n default ; kubectl apply -k point/dev/app    -n default
kubectl diff -k point/dev/api    -n default ; kubectl apply --dry-run=server -k point/dev/api    -n default ; kubectl apply -k point/dev/api    -n default
kubectl diff -k point/dev/admin  -n default ; kubectl apply --dry-run=server -k point/dev/admin  -n default ; kubectl apply -k point/dev/admin  -n default
kubectl diff -k point/dev/worker -n default ; kubectl apply --dry-run=server -k point/dev/worker -n default ; kubectl apply -k point/dev/worker -n default
kubectl diff -k point/dev/mmh    -n default ; kubectl apply --dry-run=server -k point/dev/mmh    -n default ; kubectl apply -k point/dev/mmh    -n default
# 8) IngressClass — stg/prd ONLY (dev uses the legacy kubernetes.io/ingress.class annotation; no file in point/dev)
#    (stg) kubectl diff -f point/stg/ingress-class.yaml -n default ; kubectl apply -f point/stg/ingress-class.yaml -n default
# 9) Ingress (idempotent — first applied at the security_group SG-swap step)
kubectl diff -f point/dev/ingress.yaml -n default ; kubectl apply -f point/dev/ingress.yaml -n default
```
**After — verify EVERY layer:**
- **ALB**: `kubectl -n kube-system get deploy aws-load-balancer-controller -o jsonpath='{.spec.template.spec.containers[0].image}'` → `public.ecr.aws/eks/aws-load-balancer-controller:v3.1.0`; `kubectl get crd | grep elbv2.k8s.aws` → includes `albtargetcontrolconfigs` + `globalaccelerators`; `kubectl -n kube-system logs deploy/aws-load-balancer-controller --tail=50` → no CRD/RBAC/reconcile errors.
- **RBAC**: `kubectl get clusterrolebinding admin-cluster-admin` → present.
- **PSA**: `kubectl get ns default -o yaml | grep pod-security` → `enforce` label present.
- **default-SA**: `kubectl get sa default -n default -o yaml | grep automountServiceAccountToken` → `false`.
- **NetworkPolicy**: `kubectl get networkpolicy -n default` → 5 (default-deny, allow-dns, allow-internal, allow-ingress-vpc, allow-egress-vpc).
- **SecretProviderClass**: `kubectl get secretproviderclass -n default` → present.
- **point-app-SA**: `kubectl describe sa point-app-sa -n default | grep -i role-arn` → the `point-app-irsa-role` ARN. (Resource name is `point-app-sa`, NOT the file name `point-app-service-account`.)
- **Deployments**: `kubectl get deploy -n default point-app-deployment point-api-deployment point-admin-deployment point-worker-deployment point-mmh-deployment` → each READY = desired; `kubectl get pods -A | grep -iE 'CrashLoopBackOff|Error'` → empty; spot-check each pod's startup log (`SecretsEnvironmentPostProcessor` reading `/mnt/secrets-store/`, Redis SSL connect, JDBC connect).
- **Ingress**: `kubectl get ingress point-ingress -n default` → ADDRESS = the `point-alb` DNS (controller reconciles it).
- **CoreDNS (Ponta, Risk #2)**: `kubectl -n kube-system get cm coredns -o jsonpath='{.data.Corefile}'` → UNCHANGED vs the pre-apply capture; the app layer does not touch CoreDNS. dev runs the stock EKS default — the Ponta `hosts` block is stg/prd-only (applied via `aws-coredns-cm.yaml`).

### s3-chart-snapshot — LOW · daytime
**Pre-req in state:** eks `point-app-irsa-role` (section 5) + infra/audit `s3-access-logs.bs-point-dev`.
Absent live -> clean create of the chart-snapshot bucket (IRSA-scoped policy, access logging).
```bash
cd terraform/components/s3-chart-snapshot
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: clean create, 0 destroy/replace (number not in source — confirm at plan)
../../terraform.sh --env dev apply
```
**After:** `aws s3api head-bucket --bucket chart-snapshot.bs-point-dev`

### s3-csv-export — LOW · daytime
**Pre-req in state:** eks `point-app-irsa-role` + infra/audit `s3-access-logs.bs-point-dev`.
Absent live -> clean create of the app CSV export bucket.
```bash
cd terraform/components/s3-csv-export
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: clean create, 0 destroy/replace (number not in source — confirm at plan)
../../terraform.sh --env dev apply
```
**After:** `aws s3api head-bucket --bucket csv-export.bs-point-app-dev`

### s3-csv-export-admin — LOW · daytime
**Pre-req in state:** eks `point-app-irsa-role` + infra/audit `s3-access-logs.bs-point-dev`.
Absent live -> clean create of the admin CSV export bucket.
```bash
cd terraform/components/s3-csv-export-admin
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: clean create, 0 destroy/replace (number not in source — confirm at plan)
../../terraform.sh --env dev apply
```
**After:** `aws s3api head-bucket --bucket csv-export.bs-point-admin-dev`

### s3-kyc — MED · daytime
**Pre-req in state:** eks `point-app-irsa-role` + infra/audit `s3-access-logs.bs-point-dev`.
**STOP:** plan must show 0 destroy / 0 replace — the KYC bucket holds PII and is referenced by live app config; any destructive change means re-verify before proceeding.
Absent live -> clean create of the KYC bucket.
```bash
cd terraform/components/s3-kyc
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: clean create only, 0 destroy/replace (confirm at plan)
../../terraform.sh --env dev apply
```
**After:** `aws s3api head-bucket --bucket kyc.bs-point-dev`

### s3-year-report — MED · daytime
**Pre-req in state:** eks `point-app-irsa-role` + infra/audit `s3-access-logs.bs-point-dev`.
**STOP:** the bucket `year-report.bs-point-dev` already exists live but the component was never applied — import it FIRST, then re-plan and adopt any sub-resource the existing bucket carries (versioning / SSE / lifecycle / public-access-block / logging) before apply. The KMS alias is absent live and is created fresh. Plan must not destroy bucket data.
```bash
cd terraform/components/s3-year-report
../../terraform.sh --env dev init
../../terraform.sh --env dev import aws_s3_bucket.this year-report.bs-point-dev
../../terraform.sh --env dev plan   # re-plan: import/accept versioning/SSE/lifecycle/PAB/logging sub-resources; KMS alias created fresh; confirm 0 destroy of bucket data
../../terraform.sh --env dev apply
```
**After:** `aws s3api get-bucket-lifecycle-configuration --bucket year-report.bs-point-dev` (lifecycle retained)

### s3-refinitiv-migration — LOW/UNKNOWN · daytime
**Blocked-until:** eks materializes `point-app-irsa-role` — a cold plan fails `NoSuchEntity` on that role; re-plan after eks (section 5), risk UNKNOWN until then.
**Pre-req in state:** eks `point-app-irsa-role` + infra/audit `s3-access-logs.bs-point-dev`.
Brand-new component, no plan baseline. Bucket absent live -> clean create; confirm the exact bucket name at plan.
```bash
cd terraform/components/s3-refinitiv-migration
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # re-plan once IRSA exists; expect clean create (no baseline — risk UNKNOWN); confirm bucket name refinitiv-migration.bs-point-dev
../../terraform.sh --env dev apply
```
**After:** `aws s3api head-bucket --bucket refinitiv-migration.bs-point-dev`

### ec2-proxy — LOW · daytime
**Pre-req in state:** ec2-bastion up (`proxy_enabled=true`).
Brings up the Squid forward proxy.
```bash
cd terraform/components/ec2-proxy
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: 5 to add, 0 to change, 0 to destroy (re-verified live 2026-06-11 after security_group applied — proxy-sg gate lifted; adds = IAM role/profile/policy/attachment + aws_instance t3.small AL2023)
../../terraform.sh --env dev apply
```
**After:** from the bastion, `curl -so /dev/null -w '%{http_code}\n' -x http://<proxy-ip>:3128 https://www.google.com` returns 200.

### ec2-data-transfer — LOW · daytime
**Pre-req in state:** the IAM role/profile already exists in state (not a collision — no import).
Brings up the data-transfer instance (AMI `ami-03598bf9d15814511`, bastion SG SSH path).
```bash
cd terraform/components/ec2-data-transfer
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: all-add, 0 destroy/replace; full count only known after ec2-proxy applied (plan reads the bastion-proxy instance — re-plan 2026-06-11 still partial +3 IAM before that data source resolves)
../../terraform.sh --env dev apply
```
**After:** `aws ec2 describe-instances --filters Name=tag:Name,Values=*data-transfer* Name=instance-state-name,Values=running --query "Reservations[].Instances[].InstanceId" --output text`

### cloudwatch_metrics — LOW · daytime
**STOP:** apply IMMEDIATELY before cloudwatch_alarm to avoid an orphan-metric window.
Updates metric filters; the legacy `okcoinOrderbookGetter` metric is decommissioned and `amberOrderbookGetter` takes over.
```bash
cd terraform/components/cloudwatch_metrics
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: 2 to add, 33 to change, 2 to destroy (re-verified live 2026-06-11 — okcoin→amber metric-filter rename + pattern updates)
../../terraform.sh --env dev apply
```
**After:** `aws cloudwatch list-metrics --namespace point-metrics --query "Metrics[?MetricName=='okcoinOrderbookGetter']"` returns `[]` (decommissioned).

### cloudwatch_alarm — LOW · daytime
**Pre-req in state:** cloudwatch_metrics applied (immediately prior).
**STOP:** verify no alarm definition references the old `okcoinOrderbookGetter` metrics before apply.
Creates/updates the alarms keyed on the new metric set.
```bash
cd terraform/components/cloudwatch_alarm
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: 3 to add, 11 to change, 2 to destroy (re-verified live 2026-06-11 — alarms re-keyed to the amber metric set)
../../terraform.sh --env dev apply
```
**After:** `aws cloudwatch describe-alarms --query "MetricAlarms[?MetricName=='okcoinOrderbookGetter'].AlarmName"` returns `[]`; new alarms transition INSUFFICIENT_DATA -> OK.

### cloudwatch_circuitbreaker_lambda — LOW · daytime
**Not in the canonical apply ladder** (held out pending SES); included for completeness — re-plan before applying.
**Pre-req in state:** the CloudWatch Logs group `/aws/containerinsights/point/application` exists (it is the metric-filter source).
**Blocked-until (SES email path only):** the circuit-breaker notifier's **email** path sends via SES — the sender identity must be verified and the account out of the SES sandbox for email to deliver. The Slack-webhook path (`slack_webhook_url` in `tfvars/dev.tfvars`) works without SES, so the component applies; only SES email delivery is gated.
Creates the metric filter on the worker `Circuit Breaker symbol:*` logs + the `point-circuitbreaker` Lambda (+ its `python_module.zip` deps layer) + the `circuitbreaker-cron` EventBridge rule. Artifacts are pre-built committed zips — rebuild only if the Lambda source/deps changed.
```bash
cd terraform/components/cloudwatch_circuitbreaker_lambda
bash src/build.sh                      # rebuild lambda_function.zip + python_module.zip ONLY if source/deps changed (committed zips already exist)
../../terraform.sh --env dev init
../../terraform.sh --env dev plan      # Expected: clean create (confirm at plan — not in the canonical ladder; verify 0 destroy/replace)
../../terraform.sh --env dev apply
```
**After:** `aws lambda get-function --function-name point-circuitbreaker --query 'Configuration.State' --output text` (Active); `aws events describe-rule --name circuitbreaker-cron --query State --output text` (ENABLED).

### frontend-customer — HIGH · daytime
**Pre-req in state:** ALB `point-alb` must have a live HTTPS:443 listener (security_group cutover, section 5); `exchange.bs-point-dev` bucket must NOT pre-exist outside state (else `AlreadyOwnedByYou`).
**STOP:** apply BEFORE frontend-admin (admin reads the `static_html_header` + `server_header` response-headers policies this component creates). This flips `geo_restriction blacklist->none` — the WAF `country_restrict` rule is the only backstop and MUST stay continuously live across the flip. `country_restrict` is already live in dev; in a fresh env, apply waf-customer first.
In-place reconfiguration of the existing customer CloudFront distribution (TLS 2019->2021, ALB origin http->https-only, geo->none, /app/* + /api/* cookie whitelisting, Lambda@Edge `subdirectory-index:4`, new `s3_exchange_origin` + `exchange.bs-point-dev` bucket).
**Provider pinned `~> 6.14.1` — `init -upgrade` required (frontend-customer only):** `versions.tf` moved `aws ~> 4.0` (verup) → `~> 6.14.1` (point), the only frontend row on provider v6 (frontend-admin stays `~> 4.0`). The pin is `~> 6.14.1` (not bare `~> 6.x`) on purpose: provider 6.14.0 has the `Missing Resource Identity After Update` regression (hashicorp/terraform-provider-aws#44366/#44376) that aborts the `aws_s3_bucket_policy` updates *after* they already land on AWS; fixed in 6.14.1. `init -upgrade` re-locks the provider (a stale lock pinning 6.14.0 or a 4.x/5.x provider fails the constraint). Commit the regenerated `.terraform.lock.hcl` so stg/prd resolve the same fixed provider — do NOT normalize back to plain `init`.
**STOP — one-time ACL reset before apply (buckets that carried `public-read`: `choice`, `point`):** destroying `aws_s3_bucket_acl` is a no-op (does NOT reset the live ACL), so the old `public-read` grant lingers and `aws_s3_bucket_ownership_controls.{choice,this}` (BucketOwnerEnforced) fails `InvalidBucketAclWithObjectOwnership` even though `get-bucket-acl` shows owner-only. AWS prerequisite: reset the bucket ACL to the default private ACL first (allowed under `BlockPublicAcls=true`; CloudFront keeps serving via the OAI bucket policy, not the ACL).
```bash
cd terraform/components/frontend-customer
../../terraform.sh --env dev init -upgrade   # provider ~> 4.0 (verup) -> ~> 6.14.1 (point); -upgrade re-locks (skips the broken 6.14.0)
../../terraform.sh --env dev plan   # Expected: +10/~6/-2 (the 2 destroys are S3 ACL sub-resources only; 6th in-place change = aws_s3_bucket_policy.maintenance from the maintenance-split commit e394685c — the older 21a4f4b6 plan read ~5)
# ONE-TIME pre-step before apply — reset stale public-read ACL on the two buckets that had it:
aws s3api put-bucket-acl --bucket choice.bs-point-dev --acl private
aws s3api put-bucket-acl --bucket point.bs-point-dev  --acl private
../../terraform.sh --env dev apply
```
**After:** `aws cloudfront get-distribution --id E1BIDPQ5G0BYCB --region us-east-1 --query 'Distribution.{Status:Status,MinTLS:DistributionConfig.ViewerCertificate.MinimumProtocolVersion,Geo:DistributionConfig.Restrictions.GeoRestriction.RestrictionType}'` (Status=Deployed, MinTLS=TLSv1.2_2021, Geo=none); `curl -sI https://dev.backseat-service.com | head -1` -> 200.
**Verify behavior precedence order** (`/maintenance/*` MUST precede `/exchange/*`):
```bash
aws cloudfront get-distribution --id E1BIDPQ5G0BYCB --region us-east-1 \
  --query 'Distribution.DistributionConfig.CacheBehaviors.Items[].{Path:PathPattern,Origin:TargetOriginId}' --output table
# Expected order: /farm-game/* , /exchange/maintenance/* , /point/maintenance/* , /maintenance/* , /exchange/* , /doc/* , /app/* , /api/* , /websocket
# Default (*) -> s3_origin (separate: DefaultCacheBehavior.TargetOriginId)
```

### frontend-admin — CRITICAL · daytime
**Blocked-until:** a us-east-1 ISSUED cert covering `*.dev.backseat-service.com` (or exactly `bo.dev.backseat-service.com`) is imported and `cloudfront_certificate` is set. The cert is import-only (`aws acm import-certificate`; init/acm cert creation stays DISABLED). Until it lands, `terraform plan` exits 1 (`module-for-cloudfront/data.tf` filter `IMPORTED`/`ISSUED` finds 0 matches).
**Pre-req in state:** frontend-customer applied (response-headers policies present); WAF `point-cloudfront-admin` exists in us-east-1.
Switches the back-office CloudFront distribution from S3-website origin to OAC + REST S3 origin and removes the legacy static-website config.
```bash
cd terraform/components/frontend-admin
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: ~3 add (s3 ownership_controls + versioning + admin OAC), 1 destroy (s3 website_configuration), in-place CloudFront -> OAC origin + new cert, 1 state-move via moved.tf (no infra change). Must exit 0 — exits 1 until the cert is imported.
../../terraform.sh --env dev apply
```
**After:** `aws cloudfront get-distribution --id E3ETPFX8HYQZPU --region us-east-1 --query 'Distribution.Status'` (Deployed); `curl -sI https://bo.dev.backseat-service.com | head -1` -> 200 with valid TLS.

### waf-customer — CRITICAL · maint window (Sun 22:00-23:00, dedicated)
**STOP:** a plain `terraform apply` fails `WAFInvalidParameterException` on duplicate priorities — the atomic renumber is mandatory (Path B only: provider `~>6.40` + split `maintenance_exchange`/`maintenance_point` rule groups). Do NOT use the historical Path A.
**Pre-req in state:** infra/audit applied (`aws-waf-logs-bs-point-dev` exists, not in REPLACE); frontend-customer applied. Post the customer maintenance banner >=6h before; only customer-facing interruption. CloudFront-scoped -> us-east-1.
Applies the customer WebACL `point-cloudfront-customer` with the per-brand maintenance split + PII log-field redaction.
```bash
cd terraform/components/waf-customer
../../terraform.sh --env dev init
# (1) ONLY if maintenance is currently ON via the legacy Lambda: operator targeted-creates the two split rule groups + stages /exchange/maintenance/* and /point/maintenance/* content, waits CloudFront Deployed:
#     ../../terraform.sh --env dev apply -target='module.for_cloudfront.aws_wafv2_rule_group.maintenance_exchange' -target='module.for_cloudfront.aws_wafv2_rule_group.maintenance_point'
# (2) Renumber dry-run (READ-ONLY) — review the printed priority diff:
./scripts/preflight-renumber.sh --expected-account 905418018638 --targets ./scripts/priority-targets-dev.json
# (3) OPERATOR WRITE — re-run with --commit (atomic UpdateWebACL, optimistic-lock retry; not an AI-assistant action):
#     ./scripts/preflight-renumber.sh --expected-account 905418018638 --targets ./scripts/priority-targets-dev.json --commit
../../terraform.sh --env dev plan   # Expected: +18/~2/-1
../../terraform.sh --env dev apply
```
**After:** `ACL_ID=$(aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1 --query "WebACLs[?Name=='point-cloudfront-customer'].Id | [0]" --output text) && aws wafv2 get-web-acl --scope CLOUDFRONT --region us-east-1 --name point-cloudfront-customer --id "$ACL_ID" --query "WebACL.Rules[].{P:Priority,N:Name}" --output table` (country_restrict present; priorities 1 & 2 reserved for the maintenance split).

### waf-maintenance-lambda — MED · maint window (chained to waf-customer)
**Pre-req in state:** waf-customer applied first (functional — the split rule groups must exist); vpc subnets + security_group `lambda-maintenance-sg`.
**STOP:** apply in the SAME window immediately after waf-customer so the old single-brand Lambda is never live against the new split WebACL layout (transient-toggle gap).
Deploys the split-brand maintenance controller Lambda that attaches/detaches `maintenance-exchange` / `maintenance-point` on the customer WebACL (reserved priority slots 1 & 2), plus its EventBridge cron. Dev schedules are DISABLED -> manual toggle only.
```bash
cd terraform/components/waf-maintenance-lambda
../../terraform.sh --env dev init
../../terraform.sh --env dev plan   # Expected: +0/~9/-0 (new split-brand Lambda code + 4 EventBridge cron + 4 targets)
../../terraform.sh --env dev apply
```
**After:** `aws events list-rules --query "Rules[?contains(Name,'maintenance')].{Name:Name,State:State}" --output table` (cron rules present, dev State=DISABLED).

---

## Recovery primitives (apply to any step)

- **Killed apply** (SIGKILL / OOM / network): the wrapper's signal trap misses SIGKILL → the DynamoDB lock (`point_tfstate_lock`) stays held → next apply fails `Error acquiring the state lock`. Run `terraform force-unlock <LOCK_ID>` (id is in the error), then re-plan + re-apply.
- **Corrupted / half-written state**: the state bucket `tfstate.bs-point-dev` has versioning → restore the pre-apply version (`aws s3api list-object-versions --bucket tfstate.bs-point-dev --prefix dev/<component>.tfstate` → `get-object --version-id <last-good>` → copy back). Last resort.
- **`AlreadyExists` on a `+ create`**: a resource exists live but isn't in state (pre-existing, or an orphan from a killed apply). Recover with `terraform import <address> <id>`, then re-plan. Most exposed: S3 buckets (global names), immutable-named CloudWatch metric filters/alarms, security groups.
- **Backend fell back to local**: see STEP 0 — clean the stale `backend.tf` / `terraform/tmp/dev/<component>` and re-init against the remote backend before anything else.

## Final verify (after the full sequence)

1. Every after-check uses **tag/name/CIDR**, never a hardcoded id (the old `vpc-0e139c5a…` / `pcx-…` ids are wrong-account).
2. All 5 k8s deployments Running, no CrashLoopBackOff; CoreDNS Corefile intact.
3. EKS in `API` auth mode **and** an admin can still operate (proven during the dual-mode window).
4. Stateful: elasticache available + SSL; redshift available + `require_ssl` + CMK; aurora on `13306` with pods reconnected.
5. Frontends: both distributions Deployed with valid TLS; WAF `country_restrict` live.

## App-side coordination gates (confirm at the window, not assumed)

- The running pod image must already contain: **Redis TLS** (`spring.redis.ssl=true`, before elasticache), **Aurora port 13306** (before/at aurora), and **CSI Secrets Store** consumption (`/mnt/secrets-store/`). Verify the live deployment image SHA at the window.
- After aurora's port flip, **rollout-restart** the DB-consuming deployments to pick up the new port from the refreshed secret.
