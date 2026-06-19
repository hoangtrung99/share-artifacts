# APPLY-COMMANDS-STG (Part 1: Bootstrap → Secrets/WAF)

Copy-paste apply runbook for the verup → point migration into **point-stg `471112755246`**. Paste-in-order companion to `apply-order-CANONICAL.md` (per-row detail). Every actionable row is one fenced block: `cd` → `init`/`plan`/`apply` via the wrapper → expected STG plan → any pre-flight + the read-only after-check. Where a row **cannot** be pasted blind, it leads with a `⚠ BLOCKED` or `# Pre-req` line — read it first.

This is **Part 1** (Bootstrap → Foundation → Connectivity → Secrets/WAF). Stateful, EKS, frontend, and the WAF tail are in Part 2.

## Environment Info

| Item | Value |
|---|---|
| Target account | `471112755246` (point stg) |
| Region | `ap-northeast-1` (CloudFront / ACM / WAF-CLOUDFRONT in `us-east-1`) |
| Branch / plan tip | `release/verup` `21c92487`. Run all commands from the working-tree root. |
| Windows | All JST. |

### Execution model

- **Apply runs ON THE STG BASTION via its instance role** → commands are **`--profile`-free**. The `--env stg` flag selects the tfvars file + S3 state backend only; it does **not** select the AWS credential.
- **Local read-only plan / after-check** (from a workstation): `export AWS_REGION=ap-northeast-1; export AWS_PROFILE=point-operator-stg`. `terraform.sh` prints a benign `Unknown AWS_PROFILE` warning but does **not** abort; the AWS provider/CLI consume `AWS_PROFILE` natively. Never use `bs-point-stg` (that profile points at the verup-STG **source** account being sunset — a different account from the migration target `471112755246`; the migration never applies into it).
- **One exception to the bastion-only model: `vpc` (row 8)** — apply it from a laptop/CI with a **write credential** (NOT the read-only `point-operator-stg`), because the NACL change can mid-apply lock out the bastion. Every other Part-1 row applies from the bastion.

### STEP 0 — Account guard (run before EVERY component apply)

The worst outcome is applying into the wrong account. Confirm the identity, then confirm terraform uses the S3 backend (not a stale `local`).

```bash
# 1. Confirm the account
aws sts get-caller-identity --query Account --output text   # MUST print 471112755246

# 2. Confirm terraform uses the S3 backend, NOT local
../../terraform.sh --env stg init 2>&1 | grep -E 'Backend:'  # MUST print "Backend: s3"
```

**STOP** if the account is not `471112755246`, or if the backend prints `local`. Re-run this guard before each block below.

### STEP 0b — Stale state-lock recovery (if a prior apply was killed)

If a previous apply was interrupted (SIGKILL / OOM / network drop — most likely during a long EKS node roll), the S3/DynamoDB state lock stays held and the next command fails `Error acquiring the state lock`. Recover **only after confirming no terraform process is still running** against that state:

```bash
# The LOCK_ID is printed in the "Error acquiring the state lock" message.
../../terraform.sh --env stg force-unlock <LOCK_ID>
```

(DEV hit exactly this on the interrupted `-target` EKS apply.)

---

## 1. Bootstrap + Foundation (daytime)

```bash
# Row 0 — init/acm — STG plan -3 (sweep stale ALB cert) · LOW · daytime
# enable_certificate_for_cloudfront / _for_alb both = false (count=0). Apply DESTROYS the deposed
# EXPIRED AMAZON_ISSUED ALB cert b1d8ee2d (ap-northeast-1, not_after 2025-12-26) + 2 dangling
# stg.backseat-service.com validation CNAMEs. The 2 primary certs (ALB 839f5c5a, CF 21a34371) were
# already deleted out-of-band. KEEP false; do NOT re-enable. This does NOT touch the us-east-1 certs
# (does not clear the frontend-customer ambiguity — that is a Part 2 row).
# PRE-CHECK: the deposed cert must NOT be on any ALB listener; the [0] apex backseat-service.com CNAME
# is retained (may be shared by another active cert).
aws elbv2 describe-listeners --region ap-northeast-1 --load-balancer-arn <point-alb-arn> --query "Listeners[].Certificates[].CertificateArn" --output text | grep b1d8ee2d   # expect: NO match (deposed cert not on a listener) before apply
cd terraform/init/acm
../../terraform.sh --env stg init
../../terraform.sh --env stg plan      # Expect: 0 add / 0 change / 3 destroy (deposed cert b1d8ee2d + 2 stg.backseat-service.com validation CNAMEs). If 0/0/0 -> cert not in state; use aws acm delete-certificate instead.
../../terraform.sh --env stg apply
# After:
aws acm list-certificates --region ap-northeast-1 --query "CertificateSummaryList[].[DomainName,Status,Type]" --output text   # expect: deposed b1d8ee2d ALB cert GONE; the apex backseat-service.com CNAME-backed entry may remain
```

```bash
# Row 0b — init/eip — STG plan +2 (creates nat2 + nat3) · LOW · daytime  →  HARD PREREQ of vpc #8
# NOT verify-only on STG (single_nat_gateway=false -> 3 EIPs). nat1 = point-nat-apne1-az1
# (eipalloc-035c41eee4835b087) already exists / in state; plan CREATES the 2 missing EIPs
# point-nat-apne1-az2 + point-nat-apne1-az4 (both confirmed ABSENT in 471).
# Apply BEFORE vpc — vpc data-sources all 3 EIPs by name and plan_failed without nat2/nat3.
cd terraform/init/eip
../../terraform.sh --env stg init
../../terraform.sh --env stg plan      # Expect: 2 add / 0 change / 0 destroy (point-nat-apne1-az2 + point-nat-apne1-az4)
../../terraform.sh --env stg apply
# After:
aws ec2 describe-addresses --region ap-northeast-1 --filters "Name=tag:Name,Values=point-nat-apne1-az1,point-nat-apne1-az2,point-nat-apne1-az4" --query "Addresses[].[Tags[?Key=='Name']|[0].Value,AllocationId]" --output table   # expect all 3 named EIPs present
```

```bash
# Row 1 — infra/iam — STG plan +16 (forecast; partial +15 exit 1) · HIGH · daytime
# ⚠ BLOCKED until the iam viewer data-source CODE FIX is merged into release/verup — do not run until the gate clears.
#   CODE FIX (apply-order-CANONICAL.md §Code fixes #2): role-OperatorRole.tf:48 data.aws_iam_policy.viewer[0]
#   looks up custodian-ViewerRolePolicy which does NOT exist on greenfield 471 -> plan exit 1 after 15 partial adds.
#   Fix: replace data.aws_iam_policy.viewer[0].arn with aws_iam_policy.ViewerRole[0].arn (role-OperatorRole.tf:123)
#   and remove the data "aws_iam_policy" "viewer" block (lines 48-51). Re-plan -> +16 exit 2.
# After the fix, the DEV import pattern applies: enumerate custodian-* roles/policies and import any pre-existing
# ones FIRST (else EntityAlreadyExists). custodian-AdministratorRole is the breakglass role — import in the exact
# order below to avoid lockout. Trust principal 590183696697 (bs-custodian) is intentional. Verify user/cicd exists in 471.
cd terraform/infra/iam
../../terraform.sh --env stg init
# Enumerate what pre-exists in 471 first:
aws iam list-roles --query "Roles[?starts_with(RoleName,'custodian-')].RoleName" --output text
# Import any pre-existing custodian roles (0-indexed) + the 2 policies, in EXACT order:
../../terraform.sh --env stg import 'aws_iam_role.AdministratorRole[0]' custodian-AdministratorRole
../../terraform.sh --env stg import 'aws_iam_role.CICDRole[0]'          custodian-CICDRole
../../terraform.sh --env stg import 'aws_iam_role.OperatorRole[0]'      custodian-OperatorRole
../../terraform.sh --env stg import 'aws_iam_role.ViewerRole[0]'        custodian-ViewerRole
../../terraform.sh --env stg import 'aws_iam_policy.ViewerRole[0]'      arn:aws:iam::471112755246:policy/custodian-ViewerRolePolicy
../../terraform.sh --env stg import aws_iam_policy.ssm_policy           arn:aws:iam::471112755246:policy/ssm_policy
../../terraform.sh --env stg plan      # Expect (post-fix): +16 exit 2 with in-place trust rewrites on any imported roles -> DIFF each trust + sign off before apply
../../terraform.sh --env stg apply
# After:
aws iam list-roles --query "Roles[?contains(RoleName,'custodian')].RoleName" --output text   # expect the 4 TF-managed roles (AdministratorRole/CICDRole/OperatorRole/ViewerRole) + any pre-existing unmanaged ones
```

```bash
# Row 1a — ec2-bastion — STG plan (forecast; blocked on #1) · UNKNOWN · daytime
# Pre-req: infra/iam #1 applied — data.aws_iam_policy.administrator[0] looks up custodian-AdministratorRolePolicy,
#   which is NotFound in 471 until iam #1 lands (plan_failed = blocked-on-upstream, not a defect).
# Replicate the DEV user_data-reboot mitigation: edit to ignore user_data OR accept a windowed reboot; the `moved`
# block MUST be in release/verup so no spurious recreate. TF resizes the EBS volume but NOT the OS filesystem.
cd terraform/components/ec2-bastion
../../terraform.sh --env stg init
../../terraform.sh --env stg plan   # Re-plan after iam #1; expect the bastion instance + profile (greenfield) or a verify-only no-change if already up
../../terraform.sh --env stg apply
# After:
aws ssm describe-instance-information --query "InstanceInformationList[?contains(Name,'bastion')].{Id:InstanceId,Ping:PingStatus}" --output table   # instance running, SSM reachable
# After (if the root volume grew): SSM into the bastion and expand the filesystem by hand —
#   lsblk; sudo growpart /dev/nvme0n1 1; sudo resize2fs /dev/nvme0n1p1; df -h /
```

```bash
# Row 1b — eice — STG plan +7 (greenfield all-add) · LOW · daytime
# Pre-req: infra/iam #1, vpc #8, security_group #10 (bastion-sg). Functional pre-req: STG bastion sshd ENABLED
#   (DEV's was found disabled -> EICE-SSH RST; EICE only relays TCP 22, it is not an SSH server).
# Leaf — gates nothing. Endpoint create ~3.5-4 min. If plan errors "bastion-sg not found" -> apply security_group #10 first.
cd terraform/components/eice
../../terraform.sh --env stg init
../../terraform.sh --env stg plan   # Expect (greenfield): +7/0/0 — eice SG + egress rule + bastion-ingress rule + endpoint + IAM policy + 2 role attachments
../../terraform.sh --env stg apply
# After:
aws ec2 describe-instance-connect-endpoints --region ap-northeast-1 --query "InstanceConnectEndpoints[?contains(Tags[?Key=='Name'].Value | [0],'bastion-eice')].{Id:InstanceConnectEndpointId,State:State}" --output table   # State create-complete
# Verify the bastion sshd is up (via Session Manager): sudo systemctl status ssh --no-pager
```

```bash
# Row 2 — infra/audit — STG plan +12/~7/-2 (+5 import) · HIGH · daytime
# Pre-req: infra/iam #1.
# STOP — run the verup-delta with -target and DEFER module.config. A full untargeted apply switches the recorder
#   role_arn to 211125716602:cm-config-role-all-regions (point-native drift; trust on 211 unverifiable from
#   point-operator-stg) and destroys the live same-account config role. Apply the delta WITHOUT module.config.
# Creates s3-access-logs.bs-point-stg (HARD PREREQ for the S3 + WAF rows) + 6 GuardDuty detector features
#   (RUNTIME_MONITORING: EKS_ADDON_MANAGEMENT DISABLED per BB-1899) + imports the 5 aws-waf-logs-bs-point-stg
#   sub-resources (auto import{} blocks). Confirm the WAF object-lock lock_retention_days=1 /
#   athena_results_expiration_days=30 is intentional (not a value transposition).
cd terraform/infra/audit
../../terraform.sh --env stg init
../../terraform.sh --env stg plan \
  -target=module.s3-audit-logs -target=module.s3-audit-logs-receiver -target=module.s3-config \
  -target=module.cloudtrail -target=module.guardduty -target=module.securityhub -target=module.ssm \
  -target=module.s3-access-logs -target=module.s3-waf-logging -target=aws_guardduty_detector.this
# Expect: ~ +12 / ~7 / -2 (with +5 import), NO 211125716602 reference. STOP if it shows any other S3 bucket destroy.
../../terraform.sh --env stg apply \
  -target=module.s3-audit-logs -target=module.s3-audit-logs-receiver -target=module.s3-config \
  -target=module.cloudtrail -target=module.guardduty -target=module.securityhub -target=module.ssm \
  -target=module.s3-access-logs -target=module.s3-waf-logging -target=aws_guardduty_detector.this
# After:
aws s3api head-bucket --bucket s3-access-logs.bs-point-stg   # exit 0 = bucket exists
```

```bash
# Row 3 — infra/ebs-security — STG plan +2 · LOW · daytime
# Additive — enables EBS encryption-by-default.
cd terraform/infra/ebs-security
../../terraform.sh --env stg init
../../terraform.sh --env stg plan      # Expect: additive creates/changes, 0 destroy/replace
../../terraform.sh --env stg apply
# After:
aws ec2 get-ebs-encryption-by-default --region ap-northeast-1 --query EbsEncryptionByDefault --output text   # expect: True
```

```bash
# Row 4 — ecr — STG plan +5 · LOW · daytime
# Pre-req: infra/iam #1. Repos must pre-exist. AllowCICDPushPull is inert until eks-worker-role exists (safe).
# Account literal 471 in the repo-policy principals.
cd terraform/components/ecr
../../terraform.sh --env stg init
../../terraform.sh --env stg plan      # Expect: +5 repository policies (0 destroy/replace)
../../terraform.sh --env stg apply
# After:
aws ecr describe-repositories --region ap-northeast-1 --query "repositories[].repositoryName" --output text
```

```bash
# Row 5 — sns-alert — STG plan ~1 · LOW · daytime
# Verify lambda_function.zip is a known-good sns-to-slack build before apply.
cd terraform/components/sns-alert
../../terraform.sh --env stg init
../../terraform.sh --env stg plan      # Expect: ~1 (sns-to-slack lambda update), 0 destroy/replace
../../terraform.sh --env stg apply
# After:
aws sns list-topics --region ap-northeast-1 --query "Topics[?contains(TopicArn,'alert-lambda')].TopicArn" --output text
```

```bash
# Row 6 — notification-global — STG plan 0/0/0 (already converged) · LOW · daytime
# Pre-req: sns-alert #5. Already converged in 471 -> no-change. Operator accepts broadened all-region Health alerts.
cd terraform/components/notification-global
../../terraform.sh --env stg init
../../terraform.sh --env stg plan      # Expect: No changes (0/0/0)
../../terraform.sh --env stg apply
# After:
aws health describe-event-types --region us-east-1 --max-results 1 >/dev/null && echo health-api-reachable
```

```bash
# Row 7 — notification — STG plan +1 · LOW · daytime  (DEFERRED past #12b despite nominal position)
# Pre-req: sns-alert #5, secrets_manager #12, event-notification #12b. STG 471 already has the
#   alert-lambda-event-notification topic+lambda live (event-notification #12b is no-change), so the data-source
#   chain is satisfied and the plan is a clean +1. (The Aurora event subscription lands later with aurora.)
cd terraform/components/notification
../../terraform.sh --env stg init
../../terraform.sh --env stg plan   # Expect: +1 (snapshot event subscription), 0 destroy; STOP on any UNEXPECTED destroy/replace
../../terraform.sh --env stg apply
# After:
aws rds describe-event-subscriptions --region ap-northeast-1 --query "EventSubscriptionsList[].CustSubscriptionId" --output text
```

---

## 2. Connectivity (daytime; security_group = maintenance window)

```bash
# Row 8 — vpc — STG plan +39/~3/-1 (forecast; blocked on #0b) · HIGH · maintenance window
# ⚠ BLOCKED until init/eip #0b applied (the 2 EIPs nat2/nat3 must exist) — at tip the plan FAILS on
#   data.aws_eip.nat2/nat3 NotFound. After the EIPs exist the plan firms up to +39/~3/-1.
# ⚠ APPLY FROM LAPTOP/CI, NOT THE BASTION — the NACL change can mid-apply lock out the bastion. The laptop needs a
#   WRITE credential (not the read-only point-operator-stg). This is the ONE Part-1 exception to the bastion model.
# The -1 is the default-NACL STATE migration (physical acl-0a9983286ac6c8cf1 RETAINED, not deleted). NACLs replace
#   on all 9 subnets (6 primary + 3 secondary-CIDR 100.64.x). /24 primary CIDR 10.51.187.0/24 -> verify >=7 free IPs/subnet.
# ⚠ 2 UNMANAGED routes on rtb-0241362c6cf0dbaa2 will be LOST when az2/az4 subnets move to new per-AZ RTs:
#   (a) 172.19.0.0/16 -> pcx-0ce5c02bb35a7bd32 (verup-STG peering)
#   (b) 10.50.0.121/32 -> vgw-0c33e00d8d13702e0 (Ponta far-end host route)
#   Operator must re-add or confirm sunset BEFORE the window.
cd terraform/components/vpc
../../terraform.sh --env stg init --upgrade
../../terraform.sh --env stg plan            # Expect (after #0b): +39/~3/-1 (the -1 = aws_default_network_acl.this[0] STATE migration, NOT a delete). Re-plan/diff first — STOP if the -1 is anything other than the default-NACL record.
../../terraform.sh --env stg apply           # FROM LAPTOP/CI with a write credential
# After:
aws ec2 describe-network-acls --region ap-northeast-1 --filters Name=vpc-id,Values=vpc-08888557d0bd0cead --query 'NetworkAcls[].{Id:NetworkAclId,Default:IsDefault,Assoc:length(Associations),Entries:length(Entries)}' --output table   # expect 3 NACLs; default acl-0a9983286ac6c8cf1 still present
```

```bash
# Row 9 — vpc_peering — STG plan +3 (forecast; apply FAILS on missing pcx) · HIGH · daytime
# ⚠ BLOCKED until the wallet account sends a fresh peering request and the real pcx is in stg.tfvars — do not run.
#   Pre-step (wallet request): plan is clean +3 (accepter + 2 routes for 192.168.0.0/16) but APPLY FAILS —
#   pcx-0c3d285e426241d9b (tag from_wallet_stg) is NotFound in 471 -> InvalidVpcPeeringConnectionID.NotFound.
#   The existing pcx-0ce5c02bb35a7bd32 (to verup-STG) is the WRONG link (point-stg is requester there; CIDR/counterparty differ).
#   Have the wallet account send a fresh peering request to point-stg vpc-08888557d0bd0cead, capture the AWS-assigned
#   pcx, then update tfvars/stg.tfvars with it BEFORE applying. OPEN: confirm STG peers at all (peer_requester_vpc_cidr was empty).
cd terraform/components/vpc_peering
# First: update tfvars/stg.tfvars with the AWS-assigned pcx from the wallet request (NOT the hardcoded one).
../../terraform.sh --env stg init
../../terraform.sh --env stg plan            # Expect: +3 (do NOT apply until the live pcx is in tfvars)
../../terraform.sh --env stg apply
# After:
aws ec2 describe-vpc-peering-connections --region ap-northeast-1 --filters Name=accepter-vpc-info.vpc-id,Values=vpc-08888557d0bd0cead --query 'VpcPeeringConnections[].{Id:VpcPeeringConnectionId,Status:Status.Code}' --output table   # match by tag/CIDR, never the hardcoded pcx
```

```bash
# Row 10 — security_group — STG plan +23/~2/-5/⟳7 · HIGH · maintenance window
# Pre-req: vpc #8; EKS cluster running with a live ALB.
# STOP — controller-driven 3-step ALB SG swap. Do NOT run one full apply: a direct destroy of alb-sg
#   (sg-0d6ee86d12b188ab0) hits DependencyViolation on the live ALB ENIs; alb-https-sg does not exist until step 1.
# MySQL/Redis/Redshift rules flip to port 13306 + Dalian 45.78.58.128/32 -> 100.64.0.0/16.
# hulft-sg REMOVES 172.19.0.0/16 (active verup-STG peering path for HULFT/Ponta IF-007/008) — confirm the consumer is
#   drained, or keep the CIDR via tfvars until verup decommission. Couple with aurora #19 in the SAME window.
cd terraform/components/security_group
../../terraform.sh --env stg init --upgrade
../../terraform.sh --env stg plan            # Expect: +23/~2/-5/⟳7. Re-plan/diff vs canonical first (no committed lockfile).

# MANDATORY PRE-CHECK (DEV §4 item 1): the ALB-controller webhook must have endpoints. A rogue
#   app.kubernetes.io/component selector key (>1yr-old out-of-band manifest) gives the webhook 0 endpoints -> the
#   controller-driven cutover silently fails. Inspect the selector and pre-patch the rogue key if present:
kubectl -n kube-system get svc aws-load-balancer-webhook-service -o jsonpath='{.spec.selector}'   # expect ONLY app.kubernetes.io/{name,instance} — NO app.kubernetes.io/component
# If the rogue key is present, remove it BEFORE step 2:
kubectl -n kube-system patch svc aws-load-balancer-webhook-service --type=json -p='[{"op":"remove","path":"/spec/selector/app.kubernetes.io~1component"}]'

# STEP 1 — targeted apply: create alb-https-sg ONLY (do NOT full-apply yet)
../../terraform.sh --env stg apply -target=aws_security_group.alb_https -target=aws_security_group_rule.cloudfront_to_alb_https -target=aws_security_group_rule.old_bastion_to_alb

# STEP 2 — controller-driven cutover via edited ingress.yaml (annotation security-groups: alb-https-sg, HTTPS:443).
#   Gate: kubectl diff -> dry-run=server -> apply -> verify. Do NOT aws elbv2 set-security-groups unless the controller fails to reconcile in ~60s.
kubectl diff -f ../../../k8s-manifests/point/stg/ingress.yaml
kubectl apply -f ../../../k8s-manifests/point/stg/ingress.yaml --dry-run=server
kubectl apply -f ../../../k8s-manifests/point/stg/ingress.yaml
#   verify the controller moved the ALB off alb-sg BEFORE step 3:
aws elbv2 describe-load-balancers --region ap-northeast-1 --query "LoadBalancers[?LoadBalancerName=='point-alb'].SecurityGroups" --output json   # must NOT contain sg-0d6ee86d12b188ab0

# STEP 3 — full apply: drops the now-detached alb-sg + obsolete rules, flips mysql to 13306, adds 587/cd-runner/proxy
../../terraform.sh --env stg apply
# After:
aws elbv2 describe-load-balancers --region ap-northeast-1 --query "LoadBalancers[?LoadBalancerName=='point-alb'].SecurityGroups" --output json   # must show alb-https-sg, NOT sg-0d6ee86d12b188ab0
```

```bash
# Row 11 — endpoints — STG plan +5/~10 · MED · daytime
# Pre-req: vpc #8, security_group #10. 5 new interface endpoints (ecr.api, email-smtp 587, kms, monitoring, sts)
#   + 10 in-place policy tightenings; 0 destroy/replace. Missing IAM roles cause 0 errors (ARNs string-interpolated).
#   The email-smtp 587 path stays dead until SG #10 lands the 587 ingress on vpc-endpoints-sg. Account 471 literal in every endpoint policy + sts aws:PrincipalAccount.
cd terraform/components/endpoints
../../terraform.sh --env stg init
../../terraform.sh --env stg plan            # Expect: +5/~10/-0 (0 destroy/replace)
../../terraform.sh --env stg apply
# After:
aws ec2 describe-vpc-endpoints --region ap-northeast-1 --filters Name=vpc-id,Values=vpc-08888557d0bd0cead --query 'VpcEndpoints[].{Svc:ServiceName,State:State}' --output table   # expect the 5 new endpoints Available
```

```bash
# Row 32 — ec2-cd-runner — STG plan +4 (forecast; blocked on SG #10) · LOW · daytime
# Pre-req: infra/iam #1, security_group #10 with cd_runner_enabled=true (the plan reads
#   data.aws_security_group.cd_runner by tag Name=cd-runner-sg). SG #10 precedes this row, so cd-runner-sg will exist.
# 4 IAM resources plan cleanly (no destroys/replaces); aws_instance.cd_runner stays un-planned until the SG exists.
# Creates point-cd-runner-role (clean create, no import) which the eks auth-bridge (Part 2) consumes -> this MUST precede the EKS block.
cd terraform/components/ec2-cd-runner
../../terraform.sh --env stg init
../../terraform.sh --env stg plan            # Expect: +5/0/0 (4 IAM + 1 EC2). A +4-only plan_failed means cd-runner-sg is still missing -> apply SG #10 first.
../../terraform.sh --env stg apply
# After:
aws ec2 describe-instances --region ap-northeast-1 --filters Name=tag:Name,Values=point-cd-runner Name=instance-state-name,Values=running --query 'Reservations[].Instances[].{Id:InstanceId,Type:InstanceType,SGs:SecurityGroups[].GroupName}' --output table   # expect t3.micro, SG cd-runner-sg
```

---

## 3. Secrets, notification chain, WAF (daytime)

```bash
# Row 12 — secrets_manager — STG plan 0/0/0 (already converged) · LOW · daytime
# Already converged in 471 -> no-change at tip. If a FRESH plan shows a NEW secret container, put-secret-value the
# placeholder. App must port SecretsEnvironmentPostProcessor (CSI /mnt/secrets-store/) before pods consume new secrets.
cd terraform/components/secrets_manager
../../terraform.sh --env stg init
../../terraform.sh --env stg plan   # Expect: No changes (0/0/0). STOP if any add/change/destroy/replace appears unexpectedly.
../../terraform.sh --env stg apply
# If (and only if) a new empty secret was added, populate the placeholder:
#   aws secretsmanager put-secret-value --secret-id <secret-id> --secret-string '<value-json>' --region ap-northeast-1
# After:
aws secretsmanager list-secrets --region ap-northeast-1 --query "length(SecretList)" --output text
```

```bash
# Row 12b — event-notification — STG plan 0/0/0 (no-change) · LOW · daytime
# Pre-req: secrets_manager #12. STG 471 ALREADY has the SNS topic alert-lambda-event-notification + the to-slack
#   lambda + the secret live (unlike DEV, which had to create all three). Satisfies the notification #7 chain.
cd terraform/components/event-notification
../../terraform.sh --env stg init
../../terraform.sh --env stg plan   # Expect: No changes (0/0/0). STOP if it plans to CREATE the topic/lambda (means STG drifted).
../../terraform.sh --env stg apply
# After:
aws sns list-topics --region ap-northeast-1 --query "Topics[?contains(TopicArn,'alert-lambda-event-notification')]" --output text   # expect the topic present
```

```bash
# Row 13 — waf-maintenance — STG plan ~2 · LOW · daytime
# Additive in-place WAF maintenance ACL/IP-set update. Verify the env-specific (STG) IP set.
cd terraform/components/waf-maintenance
../../terraform.sh --env stg init
../../terraform.sh --env stg plan   # Expect: ~2 in-place, 0 destroy/replace
../../terraform.sh --env stg apply
# After:
aws wafv2 list-ip-sets --scope CLOUDFRONT --region us-east-1 --query "IPSets[?contains(Name,'maintenance')].[Name,Id]" --output text   # then get-ip-set to confirm the STG IP set content
```

```bash
# Row 14 — waf-admin — STG plan +2/~3 (IP-set rotation) · MED · daytime
# Pre-req: infra/audit #2 (aws-waf-logs.bs-point-stg settled, NOT in REPLACE).
# BRANCH HYGIENE (DEV §4 item 9): on the bastion, be on release/verup and PULLED before apply (git pull needs a PAT).
# STG allow-ipv4 DIFFERS — never copy DEV IPs; cross-check removed IPs vs STG NAT/bastion egress.
cd terraform/components/waf-admin
../../terraform.sh --env stg init
../../terraform.sh --env stg plan   # Expect: +2/~3/0; confirm aws-waf-logs.bs-point-stg NOT in REPLACE
../../terraform.sh --env stg apply
# After (resolve the IP-set id by name, do not hardcode):
IPSET=$(aws wafv2 list-ip-sets --scope CLOUDFRONT --region us-east-1 --query "IPSets[?contains(Name,'admin-allow-ipv4')].Id | [0]" --output text) && aws wafv2 get-ip-set --scope CLOUDFRONT --region us-east-1 --name $(aws wafv2 list-ip-sets --scope CLOUDFRONT --region us-east-1 --query "IPSets[?contains(Name,'admin-allow-ipv4')].Name | [0]" --output text) --id "$IPSET" --query 'IPSet.Addresses'   # confirm new IPs present, removed IPs absent
```

```bash
# Row 15 — waf-athena — STG plan +3 · LOW · daytime
# Pre-req: infra/audit #2. Creates Athena workgroup + Glue DB + Glue table over the WAF log bucket (provider v6.50).
# Verify aws-waf-logs.bs-point-stg NOT in REPLACE. Empty until waf-customer (Part 2) lands the CloudFront log source.
# Account 471 literal in the Glue table location.
cd terraform/components/waf-athena
../../terraform.sh --env stg init
../../terraform.sh --env stg plan   # Expect: +3 (athena workgroup waf-logs-stg + glue DB waf_logs_stg + glue table waf_customer_access_logs)
../../terraform.sh --env stg apply
# After:
aws athena list-work-groups --region ap-northeast-1 --query "WorkGroups[?contains(Name,'waf-logs')].[Name,State]" --output text   # expect ENABLED
```

```bash
# Row 16 — s3-maintenance — STG plan +2/-1 · MED · daytime
# Additive (per-brand maintenance bucket). ⚠ If maintenance.bs-point-stg has a public-read ACL, pre-strip it FIRST to
#   avoid the DEV InvalidBucketAclWithObjectOwnership half-fail (DEV §4 item 2):
aws s3api get-bucket-acl --bucket maintenance.bs-point-stg --query "Grants[?Grantee.URI!=null].Grantee.URI" --output text   # if it lists AllUsers/AuthenticatedUsers -> pre-strip:
aws s3api put-bucket-acl --bucket maintenance.bs-point-stg --acl private   # only if a public-read ACL was found above
cd terraform/components/s3-maintenance
../../terraform.sh --env stg init
../../terraform.sh --env stg plan   # Expect: +2/~0/-1, 0 replace
../../terraform.sh --env stg apply
# After:
aws s3api get-public-access-block --bucket maintenance.bs-point-stg --query 'PublicAccessBlockConfiguration'   # all 4 blocks true
```

---

*Part 1 ends here (Bootstrap → Secrets/WAF). Stateful (elasticache/redshift/aurora), EKS, frontend, and the WAF tail (waf-customer / waf-maintenance-lambda) are in Part 2.*


## Part 2: Stateful → EKS → Post-EKS

> Continues `APPLY-COMMANDS-STG.md` Part 1 (which carries the full account/backend guard + STEP 0). Apply runs on the **STG bastion via its instance role** — bare commands, **no `--profile`**; `--env stg` selects only the tfvars + S3 state backend (account stays `471112755246`). Read-only after-checks from a workstation: `export AWS_PROFILE=point-operator-stg`. Re-run STEP 0 (`aws sts get-caller-identity` → `471112755246`; backend = s3) before EVERY component. After-checks resolve by **name/tag/CIDR, never a hardcoded id** (DEV ids are wrong-account). All windows JST.

---

### Row 17 — elasticache — CRITICAL · `+3/⟳2` · maint window — DESTRUCTIVE DATA WIPE

```bash
# Row 17 — elasticache — +3/⟳2 (replication group REPLACED) — maint window
# CRITICAL: immutable at_rest/transit false->true + CMK add => the `point` Redis group is REPLACED.
#   snapshot_retention_limit=0 -> NO backup to restore from. ~12 min downtime (DEV: destroy 4m24s + create 6m57s).
#   Primary endpoint hostname CHANGES -> point/SPRING_DATA_REDIS secret_version replaced -> pods must restart.
# SIGN-OFF: CTO + ops must approve the cache wipe before this window.
# STOP 1: the running pod image must already speak Redis TLS (SPRING_DATA_REDIS_SSL=true). Verify the live pod
#         image DIGEST/label first (tag is :latest); a TLS-only cluster is unreachable to a non-TLS client.
# STOP 2: `aws kms list-aliases --region ap-northeast-1 | grep elasticache-redis` MUST be empty
#         (the alias is created by this apply; if it already exists -> AlreadyExistsException).

# Pre-flight: scale app deploys to 0 (no pods talking to the cache mid-replace).
kubectl get deploy -n default -o jsonpath='{range .items[*]}{.metadata.name}={.spec.replicas}{"\n"}{end}' > /tmp/replicas.txt
cat /tmp/replicas.txt                 # sanity: api/admin/app/worker/mmh counts must be NON-ZERO
kubectl scale deployment --all -n default --replicas=0
kubectl get pods -n default           # wait until: No resources found

cd terraform/components/elasticache
../../terraform.sh --env stg init
../../terraform.sh --env stg plan      # Expect: +3 / 0 change / 2 destroy-replace (NEW KMS key + alias + engine-log group; rg replaced). No lockfile -> diff vs the captured plan, human-review any NEW destroy/replace.
../../terraform.sh --env stg apply

# Post: restart pods so they re-read the NEW TLS endpoint from the rotated secret (CSI re-reads on pod start).
while IFS='=' read -r d n; do kubectl scale deployment "$d" -n default --replicas="$n"; done < /tmp/replicas.txt

# After-check:
aws elasticache describe-replication-groups --replication-group-id point --region ap-northeast-1 \
  --query 'ReplicationGroups[0].{AtRest:AtRestEncryptionEnabled,Transit:TransitEncryptionEnabled,Status:Status,Endpoint:NodeGroups[0].PrimaryEndpoint.Address}'
# expect AtRest=true, Transit=true, Status=available, NEW endpoint hostname.
```

---

### Row 18 — redshift — HIGH · `+2/~4` · maint window — KMS dance + reboot (~30-60 min)

```bash
# Row 18 — redshift — +2/~4 (CMK re-key + require_ssl + subnet-group swap) — maint window
# HIGH: kms_key_id AWS-owned -> new CMK. The in-place key switch is AWS-REJECTED, so:
#   modify-cluster --no-encrypted -> wait available -> apply (CMK, ~9.5 min encrypt) -> reboot (require_ssl false->true) -> wait.
#   Also swaps the subnet-group to the new STG private subnets. App JDBC must use ssl=true.
# SIGN-OFF: CTO + analytics. Cluster must settle `available` BEFORE glue-etl #20b.
# STOP: confirm the cluster is still on the AWS-owned/default key before disabling encryption. The explicit
#       reboot is MANDATORY — require_ssl is a static param and stays pending-reboot (SSL NOT enforced) without it.

cd terraform/components/redshift
# Step 0 — manual snapshot (console: Redshift -> point -> Actions -> Create snapshot). Wait Status=Available, size>0. Rollback point.

# Step 1 — disable encryption to enable the AWS-owned -> CMK swap:
aws redshift modify-cluster --region ap-northeast-1 --cluster-identifier point --no-encrypted
aws redshift wait cluster-available --region ap-northeast-1 --cluster-identifier point
aws redshift describe-clusters --region ap-northeast-1 --cluster-identifier point --query 'Clusters[0].[ClusterStatus,Encrypted]'   # MUST be ["available", false] before terraform

# Step 2 — terraform (init -upgrade REQUIRED: redshift module pulls aws v5; plain init fails the lockfile pin):
../../terraform.sh --env stg init -upgrade
../../terraform.sh --env stg plan       # Expect: +2 / ~4 / 0 destroy (add: CMK + alias/point-redshift; change: cluster encrypted+kms_key_id+apply_immediately, param group require_ssl false->true, snapshot schedule, subnet group). The drift note encrypted true->false records the Step 1 manual disable -> EXPECTED. STOP on any destroy/replace.
../../terraform.sh --env stg apply      # starts the CMK re-encrypt (~9.5-25 min background migration)
aws redshift wait cluster-available --region ap-northeast-1 --cluster-identifier point

# Step 3 — EXPLICIT reboot (applies require_ssl):
aws redshift reboot-cluster --region ap-northeast-1 --cluster-identifier point
aws redshift wait cluster-available --region ap-northeast-1 --cluster-identifier point

# Step 4 — refresh the historical JDBC URL with ssl=true, from a FRESH checkout (script sources init.sh by RELATIVE path):
cd ../../tool/db-user-manager
bash redshift-refresh-spring-boot-secret.sh
aws secretsmanager get-secret-value --secret-id point/SPRING_DATASOURCE_HISTORICAL --query SecretString --output text | jq -r '.SPRING_DATASOURCE_HISTORICAL_URL'   # expect ...?ssl=true&sslmode=verify-ca

# After-check:
aws redshift describe-clusters --region ap-northeast-1 --cluster-identifier point --query 'Clusters[0].{Status:ClusterStatus,KmsKeyId:KmsKeyId}'   # KmsKeyId resolves to the alias/point-redshift CMK (NOT the old AWS-owned key)
aws redshift describe-cluster-parameters --region ap-northeast-1 --parameter-group-name point-redshift-1-0-custom-params --query "Parameters[?ParameterName=='require_ssl'].ParameterValue"   # = true
```

---

### Row 19 — aurora — CRITICAL · `+2/~4/-1/⟳1` · maint window — port flip + secret rotate

```bash
# Row 19 — aurora — +2/~4/-1/⟳1 — maint window (couple SG #10 same window)
# CRITICAL: port 3306->13306 (~3 min reboot); both instances resize db.r6g.xlarge -> db.r6g.4xlarge
#   (apply_immediately=true -> no healthy standby mid-apply); master-password secret_version REPLACE;
#   deletion_protection false->true; new alias/point-aurora. STG KMS policy already clean (no foreign root).
# SIGN-OFF: CTO + DBA.
# Pre-req in state: mysql-sg must already allow inbound 13306 (security_group #10, SAME window) or pods blackout after reboot.
# STOP: the single destroy is the aws_secretsmanager_secret_version REPLACE (port re-version), NOT the cluster.
#       If the plan shows the cluster CREATED or DESTROYED -> halt.

# Pre-flight: deploys already at 0 (scaled at the elasticache window open). If not: kubectl scale deployment --all -n default --replicas=0

cd terraform/components/aurora
../../terraform.sh --env stg init
../../terraform.sh --env stg plan       # Expect: +2 / ~4 / 1 destroy (= secret_version REPLACE) / 1 replace. No lockfile -> diff vs captured plan, human-review before apply.
../../terraform.sh --env stg apply

# Post: sync the new port (13306) into the 4 Aurora user secrets + the Spring Boot JDBC URL, from the bastion, FRESH checkout:
cd ../../tool/db-user-manager
bash aurora-update-port-in-secrets.sh
bash aurora-update-spring-boot-secret.sh

# After-check:
aws rds describe-db-clusters --region ap-northeast-1 --db-cluster-identifier point --query 'DBClusters[0].{Status:Status,Port:Port,Audit:EnabledCloudwatchLogsExports}'   # expect Status=available, Port=13306
```

---

### Row 20 — aurora validate_password — MED · bastion scripts · same window as #19

```bash
# Row 20 — aurora validate_password — state-less bastion scripts (not in TF) — chained to #19
# Install the validate_password plugin via INSTALL PLUGIN (Aurora MySQL 3.x param group IsModifiable:false -> only path).
# ROTATE PASSWORD BEFORE INSTALL: DEV's first install attempt got `Access denied` using the OLD password.
# Run AFTER the aurora port-sync scripts so the rotation reads the new port (13306) from the secrets.
# The scripts `source init.sh` by RELATIVE path -> MUST run from inside terraform/tool/db-user-manager.
cd terraform/tool/db-user-manager

# Step 1 — rotate master (prompts for the CURRENT master password; fetch it first):
aws secretsmanager get-secret-value --secret-id point/aurora/master_user --query SecretString --output text | jq -r .password
bash aurora-update-master-password.sh   # rotates master + updates point/aurora/master_user

# Step 2 — rotate the 4 service users (prompts for the NEW master password):
bash aurora-update-passwords.sh         # rotates the user secrets + refreshes point/SPRING_DATASOURCE_MASTER

# Step 3 — install the plugin (asserts ACTIVE, fails loudly otherwise):
bash aurora-install-validate-password.sh

# After-check (all via master from the bastion): plugin_status=ACTIVE (+ plugin_type=VALIDATE PASSWORD);
#   `SHOW VARIABLES LIKE 'validate_password%'` returns 7 rows (policy=MEDIUM, length=8, mixed_case=1, number=1, special=1, check_user_name=ON);
#   4 negative tests each ERROR 1819 (HY000) — too short / no special / no digit / password=username; 1 positive ('Strong#Pass1234') accepted;
#   then DROP USER cleanup for all test users. Rollback if needed: aurora-uninstall-validate-password.sh
```

---

### Row 20b — glue-etl — MED · `+44` (forecast) · daytime (AFTER the stateful window closes)

```bash
# Row 20b — glue-etl — +44 all-add (forecast) — daytime, additive (NOT inside the downtime window)
# ⚠ BLOCKED until vpc #8 applies the 100.64.0.0/16 secondary-CIDR subnets.
#   plan_failed at tip: postcondition data.aws_subnets.secondary_cidr is empty until those subnets exist.
#   The pool IS enabled in vpc/stg.tfvars -> this clears automatically once vpc #8 applies. All other data sources resolve live in 471.
# Sequence WELL AFTER redshift #18 is `available` post-reboot (DEV hit the redshift-active race -> 3 applies).
# NOT EKS (Glue serverless). It also MODIFIES the redshift cluster (S3 event-integration + IAM) -> confirm no redshift disruption at plan.
cd terraform/components/glue-etl
../../terraform.sh --env stg init
../../terraform.sh --env stg plan       # Expect (after vpc + redshift available): +44 all-add (Glue jobs batches 01-05, own S3 staging/meta buckets, glue SG, redshift S3 event-integration). Confirm the secondary-CIDR postcondition passes.
../../terraform.sh --env stg apply

# Post: the daily trigger is created DEACTIVATED (start_on_creation=false). Activate ONLY after the team confirms the ETL should run:
aws glue start-trigger --region ap-northeast-1 --name aurora-to-s3-trigger

# After-check:
aws glue get-jobs --region ap-northeast-1 --query 'Jobs[].Name'                                   # lists the batch jobs 01-05
aws glue get-trigger --region ap-northeast-1 --name aurora-to-s3-trigger --query 'Trigger.State'  # "ACTIVATED" after start-trigger (was "CREATED" right after apply)
```

---

### Row 21 — eks Stage-1 (CONFIG_MAP → API_AND_CONFIG_MAP) — CRITICAL · maint window — runs FIRST in the EKS block

```bash
# Row 21 — eks Stage-1: module v17->v21 + auth CONFIG_MAP -> API_AND_CONFIG_MAP @ live 1.31 — maint window
# ⚠ CODE FIX FIRST (blocks plan): variables.tf:55 declares `cluster_node_ami_type` as a REQUIRED field in the
#   eks object, never referenced, absent from stg.tfvars -> plan errors `attribute "cluster_node_ami_type" is required`.
#   Fix in release/verup: make it optional(string, "") or remove it. Do NOT add it to tfvars (unused). Re-plan after.
# Pre-req: ec2-cd-runner (Part 1, row 32) applied -> point-cd-runner-role exists (the cd_runner access entry resolves).
# POINTS OF NO RETURN: v17->v21 drops 4 cluster-role policy attachments (AmazonEKSServicePolicy,
#   AmazonEKSVPCResourceController, point-deny-log-group, point-elb-sl-role-creation); CNI policy moves to a
#   dedicated IRSA role. GATE: confirm those drops are safe (VPCResourceController unused: `kubectl get
#   securitygrouppolicies.vpcresources.k8s.aws -A` -> empty).

cd terraform/components/eks

# Step 0 — branch + HARD version gate. STG live is 1.31; tfvars currently reads 1.34.
aws sts get-caller-identity            # confirm 471112755246 before anything else
git checkout eks/1.31                  # the STG Stage-1 branch
# GATE: stg.tfvars cluster_version / cluster_node_version MUST be pinned to 1.31. A plan showing
#       "cluster_version 1.31 -> 1.34" = STOP and fix the tfvars (the 1.34 jump is done later via the ladder).
../../terraform.sh --env stg init --upgrade

# Step 1 — enumerate live access entries; import every collision the component declares (STG is CONFIG_MAP with 0
#   entries -> the 409 likely won't fire, but still guard). For each principal that EXISTS live AND is declared:
aws eks list-access-entries --cluster-name point --region ap-northeast-1
# ../../terraform.sh --env stg import 'module.eks.aws_eks_access_entry.this["<key>"]' point:<principal-arn>

# Step 2 — apply RBAC bindings FIRST, while admin still works via aws-auth (a STANDARD access entry instantly
#   overrides that principal's aws-auth mapping -> without the binding it is locked out). Repo-root path:
kubectl apply -f k8s-manifests/rbac/
kubectl get clusterrolebinding admin-cluster-admin                 # must exist before proceeding

# Step 3 — create the CNI IRSA role FIRST (targeted; root-level, drags NO node group). point-vpc-cni-aws-node is absent at STG.
../../terraform.sh --env stg apply -target=aws_iam_role.vpc_cni_aws_node -target=aws_iam_role_policy_attachment.vpc_cni_aws_node

# Step 4 — full plan + apply, with before_compute=true + the `moved` block IN CODE (CNI-deadlock fix).
#   Review gates (anything else = STOP): vpc-cni addon "updated in-place" + "(moved from ...aws_eks_addon.this[\"vpc-cni\"])";
#   node groups ~ in-place (NOT -/+ replace); destroys ONLY AmazonEKSServicePolicy + AmazonEKSVPCResourceController.
#   STOP if the vpc-cni addon shows -/+ replace/destroy (moved block missing -> preserve=false would delete the live CNI).
../../terraform.sh --env stg plan
../../terraform.sh --env stg apply      # node roll ~15-20 min per group
kubectl get sa aws-node -n kube-system -o jsonpath='{.metadata.annotations}'   # role-arn .../point-vpc-cni-aws-node
kubectl rollout status ds/aws-node -n kube-system && kubectl get pods -n kube-system -l k8s-app=aws-node   # 2/2 Running

# After-check (Stage-1 end state):
aws eks describe-cluster --name point --region ap-northeast-1 --query 'cluster.[version,accessConfig.authenticationMode]' --output text   # expect: 1.31  API_AND_CONFIG_MAP
kubectl get cm aws-auth -n kube-system   # aws-auth still present and working (dual mode)
kubectl auth can-i '*' '*'               # expect yes — every mapped principal keeps access
```

---

### Row 21b — eks Stage-2 (API_AND_CONFIG_MAP → API) — CRITICAL · SEPARATE maint window (parity-wait after #21)

```bash
# Row 21b — eks Stage-2: API_AND_CONFIG_MAP -> API — SEPARATE window (STG/PRD parity-wait after #21)
# ABSOLUTE POINT OF NO RETURN: AWS REJECTS API->CONFIG_MAP and allows no downgrade from API.
#   enable_cluster_creator_admin_permissions=false -> a botched flip = total admin lockout.
# PRE-FLIP GATES (all must hold): (1) kubectl get clusterrolebinding admin-cluster-admin -> present;
#   (2) named_user = a live STG user + aws-auth userarn match; (3) API-mode admin proven in the dual window;
#   (4) escape hatch confirmed: custodian-AdministratorRole holds eks:CreateAccessEntry + can bind AmazonEKSClusterAdminPolicy.

cd terraform/components/eks

# Prove-gate (re-confirm at the start of this window):
kubectl get clusterrolebinding admin-cluster-admin && kubectl auth can-i '*' '*'

git checkout eks/1.31-api               # eks/1.31 + a single stg.tfvars line authentication_mode = "API" (the Stage-2 end-state)
../../terraform.sh --env stg init --upgrade
../../terraform.sh --env stg plan       # Expect: ONLY accessConfig.authenticationMode API_AND_CONFIG_MAP -> API (0 add / 1 change / 0 destroy)
../../terraform.sh --env stg apply

# After-check:
aws eks describe-cluster --name point --region ap-northeast-1 --query 'cluster.[version,accessConfig.authenticationMode]' --output text   # expect: 1.31  API
kubectl auth can-i '*' '*'               # expect yes — access entries now solely govern access

# RECOVERY if the API flip locks out kubectl (no RBAC binding took / named_user mismatch):
#   bind the EKS-managed admin policy out-of-band (bypasses in-cluster RBAC), then re-apply RBAC.
#   This is exactly what recovered the DEV bastion lockout.
aws eks associate-access-policy --cluster-name point --region ap-northeast-1 \
  --principal-arn arn:aws:iam::471112755246:role/custodian-AdministratorRole \
  --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy \
  --access-scope type=cluster
kubectl apply -f k8s-manifests/rbac/     # from repo root; recreates admin-cluster-admin + cicd/operator/viewer bindings
kubectl auth can-i '*' '*'               # must return yes before proceeding
```

---

### Row 22 — eks 1.31 → 1.32 — CRITICAL · weeknight — one-minor ladder hop

```bash
# Row 22 — eks 1.31 -> 1.32 — one-minor ladder hop (runs under final API mode) — weeknight
# Each branch pins its own cluster_version + cluster_node_version + node-group name suffix; a bare version bump is INSUFFICIENT.
# All ladder branches pin authentication_mode="API" (the flip completed at #21b; EKS allows no auth downgrade — never re-introduce CONFIG_MAP here).
cd terraform/components/eks
git checkout eks/1.32
../../terraform.sh --env stg init --upgrade
../../terraform.sh --env stg plan       # Expect: version steps exactly ONE minor (1.31 -> 1.32). Re-diff; human-review any NEW destroy/replace (no committed lockfile).
../../terraform.sh --env stg apply
aws eks update-kubeconfig --name point --region ap-northeast-1
# upgrade the 5 managed node groups to this minor, then soak (no CrashLoopBackOff) before the next hop.

# After-check:
aws eks describe-cluster --name point --region ap-northeast-1 --query 'cluster.{version:version,status:status}' --output json   # expect 1.32 / ACTIVE
```

---

### Row 23 — eks 1.32 → 1.33 — CRITICAL · weeknight — one-minor ladder hop

```bash
# Row 23 — eks 1.32 -> 1.33 — one-minor ladder hop — weeknight (no downtime)
cd terraform/components/eks
git checkout eks/1.33
../../terraform.sh --env stg init --upgrade
../../terraform.sh --env stg plan       # Expect: version steps exactly ONE minor (1.32 -> 1.33). Re-diff; human-review any NEW destroy/replace.
../../terraform.sh --env stg apply
aws eks update-kubeconfig --name point --region ap-northeast-1
# upgrade the 5 node groups to this minor, then soak before the next hop.

# After-check:
aws eks describe-cluster --name point --region ap-northeast-1 --query 'cluster.{version:version,status:status}' --output json   # expect 1.33 / ACTIVE
```

---

### Row 24 — eks 1.33 → 1.34 — CRITICAL · weeknight — final hop (upgrade kubectl)

```bash
# Row 24 — eks 1.33 -> 1.34 — final one-minor hop — weeknight (no downtime)
# Upgrade kubectl before this hop (skew). The 1.34 hop REPLACES all 5 node groups via the ...-1-34-... rename
#   (create-before-destroy fleet roll) — plan the window. The eks #24 apply materializes point-app-irsa-role,
#   which the S3 rows (#26-30b) are blocked on.
cd terraform/components/eks
git checkout eks/1.34
../../terraform.sh --env stg init --upgrade
../../terraform.sh --env stg plan       # Expect: version steps exactly ONE minor (1.33 -> 1.34) + the 5 node-group rename-roll. Re-diff; human-review.
../../terraform.sh --env stg apply
aws eks update-kubeconfig --name point --region ap-northeast-1

# After-check:
aws eks describe-cluster --name point --region ap-northeast-1 --query 'cluster.{version:version,status:status}' --output json   # expect 1.34 / ACTIVE
aws iam get-role --role-name point-app-irsa-role --query 'Role.RoleName' --output text   # materialized -> unblocks S3 rows #26-30b
```

---

### Row 25 — k8s-manifests (api/admin/app/worker/mmh) — MED · daytime

```bash
# Row 25 — k8s-manifests — api +34/~7; admin/app/worker/mmh ~1 each — daytime
# NOT terraform (kubectl). Pre-req: EKS control plane + 5 node groups at 1.34 (ladder complete). point-app-irsa-role
#   is terraform-created (eks #24); the k8s objects below are applied here via kubectl (mirrors k8s_apply.sh).
# Expect CrashLoop on first apply until the app image (CSI SecretsEnvironmentPostProcessor bridge) + stateful
#   cutover are ready -> keep replicas=0, bring up after cutover. NOT a failure.
# STOP: verify the deployed admin/mmh :latest image (pull Always) contains the CSI bridge before bringing pods up.
# Run `kubectl diff` BEFORE every `kubectl apply`; apply only after reviewing the diff.
cd k8s-manifests

# RBAC (idempotent — already landed as the pre-flip gate at #21)
kubectl diff -f rbac/ ; kubectl apply -f rbac/
# CoreDNS Ponta hosts block (STG/PRD-only — DEV runs the stock EKS default; Risk #2):
kubectl diff -f point/stg/aws-coredns-cm.yaml ; kubectl apply -f point/stg/aws-coredns-cm.yaml
# PSA labels / default-SA / network policies / SecretProviderClass / point-app SA:
kubectl diff -f point/base/namespace-psa.yaml ; kubectl apply -f point/base/namespace-psa.yaml
kubectl diff -f point/stg/default-service-account.yaml ; kubectl apply -f point/stg/default-service-account.yaml
kubectl diff -f point/base/networkpolicy-default-deny.yaml -f point/base/networkpolicy-allow-dns.yaml -f point/base/networkpolicy-allow-internal.yaml -f point/stg/networkpolicy-allow-ingress-vpc.yaml -f point/stg/networkpolicy-allow-egress-vpc.yaml ; kubectl apply -f point/base/networkpolicy-default-deny.yaml -f point/base/networkpolicy-allow-dns.yaml -f point/base/networkpolicy-allow-internal.yaml -f point/stg/networkpolicy-allow-ingress-vpc.yaml -f point/stg/networkpolicy-allow-egress-vpc.yaml
kubectl diff -f point/base/secret-provider-class.yaml ; kubectl apply -f point/base/secret-provider-class.yaml
kubectl diff -f point/stg/point-app-service-account.yaml ; kubectl apply -f point/stg/point-app-service-account.yaml
# Deployments — diff + apply EACH overlay ONE AT A TIME (no loop); soak each before the next:
kubectl diff -k point/stg/app    -n default ; kubectl apply --dry-run=server -k point/stg/app    -n default ; kubectl apply -k point/stg/app    -n default
kubectl diff -k point/stg/api    -n default ; kubectl apply --dry-run=server -k point/stg/api    -n default ; kubectl apply -k point/stg/api    -n default
kubectl diff -k point/stg/admin  -n default ; kubectl apply --dry-run=server -k point/stg/admin  -n default ; kubectl apply -k point/stg/admin  -n default
kubectl diff -k point/stg/worker -n default ; kubectl apply --dry-run=server -k point/stg/worker -n default ; kubectl apply -k point/stg/worker -n default
kubectl diff -k point/stg/mmh    -n default ; kubectl apply --dry-run=server -k point/stg/mmh    -n default ; kubectl apply -k point/stg/mmh    -n default
# IngressClass (STG-only — DEV uses the legacy annotation, no file in point/dev):
kubectl diff -f point/stg/ingress-class.yaml -n default ; kubectl apply -f point/stg/ingress-class.yaml -n default
# Ingress (idempotent — first applied at the security_group SG-swap step):
kubectl diff -f point/stg/ingress.yaml -n default ; kubectl apply -f point/stg/ingress.yaml -n default

# After-check:
kubectl get deploy -n default point-app-deployment point-api-deployment point-admin-deployment point-worker-deployment point-mmh-deployment   # each READY = desired once brought up after cutover
kubectl get networkpolicy -n default                                          # 5 policies
kubectl -n kube-system get cm coredns -o jsonpath='{.data.Corefile}'          # Ponta hosts block present, port check OK (Risk #2)
kubectl get ingress point-ingress -n default                                  # ADDRESS = the point-alb DNS
```

---

### Row 26 — s3-chart-snapshot — UNKNOWN · daytime — blocked on IRSA

```bash
# Row 26 — s3-chart-snapshot — daytime
# ⚠ BLOCKED until eks #24 materializes point-app-irsa-role (NoSuchEntity until then). Clears once eks #24 applies.
# Pre-req: s3-access-logs.bs-point-stg exists (infra/audit). After-check by name, not a hardcoded id.
cd terraform/components/s3-chart-snapshot
../../terraform.sh --env stg init
../../terraform.sh --env stg plan       # Expect (after IRSA): clean create, 0 destroy/replace. Confirm the bucket name at plan.
../../terraform.sh --env stg apply
# After-check: confirm the chart-snapshot bucket from the plan output, then:
# aws s3api head-bucket --bucket <chart-snapshot bucket from plan>
```

---

### Row 27 — s3-csv-export — LOW · `+4` (forecast) · daytime — blocked on IRSA

```bash
# Row 27 — s3-csv-export — +4 (forecast) — daytime
# ⚠ BLOCKED until eks #24 materializes point-app-irsa-role. Greenfield (partial +4, 0 destroy/replace).
# Pre-req: s3-access-logs.bs-point-stg. After-check by name.
cd terraform/components/s3-csv-export
../../terraform.sh --env stg init
../../terraform.sh --env stg plan       # Expect (after IRSA): +4 clean create, 0 destroy/replace. Confirm the bucket name at plan.
../../terraform.sh --env stg apply
# After-check: aws s3api head-bucket --bucket <csv-export bucket from plan>
```

---

### Row 28 — s3-csv-export-admin — UNKNOWN · `+4` (forecast) · daytime — blocked on IRSA

```bash
# Row 28 — s3-csv-export-admin — +4 (forecast) — daytime
# ⚠ BLOCKED until eks #24 materializes point-app-irsa-role. Greenfield (partial +4).
# Pre-req: s3-access-logs.bs-point-stg. After-check by name.
cd terraform/components/s3-csv-export-admin
../../terraform.sh --env stg init
../../terraform.sh --env stg plan       # Expect (after IRSA): +4 clean create, 0 destroy/replace. Confirm the bucket name at plan.
../../terraform.sh --env stg apply
# After-check: aws s3api head-bucket --bucket <csv-export-admin bucket from plan>
```

---

### Row 29 — s3-kyc — MED · `+1/-2` (forecast) · daytime — blocked on IRSA, PII bucket

```bash
# Row 29 — s3-kyc — +1/-2 (forecast) — daytime
# ⚠ BLOCKED until eks #24 materializes point-app-irsa-role. Partial shows 2 non-critical destroys (bucket_acl +
#   lifecycle_configuration) on the LIVE PII bucket kyc.bs-point-stg; KMS/SSE/policy uncomputed until IRSA + re-plan.
# STOP: this bucket holds PII and is referenced by live app config — re-verify any destructive change before apply.
#   If kyc.bs-point-stg carries a non-`private` ACL -> pre-strip to avoid the BucketOwnerEnforced ownership conflict.
cd terraform/components/s3-kyc
# Pre-step ONLY if a non-private ACL is present:
# aws s3api put-bucket-acl --bucket kyc.bs-point-stg --acl private
../../terraform.sh --env stg init
../../terraform.sh --env stg plan       # Re-plan after IRSA: confirm KMS/SSE/policy computed; the only destroys are bucket_acl + lifecycle_configuration (non-stateful). STOP on any bucket-data destroy.
../../terraform.sh --env stg apply
# After-check:
aws s3api head-bucket --bucket kyc.bs-point-stg
```

---

### Row 30 — s3-year-report — MED · `+4` partial (forecast) · daytime — IMPORT FIRST, then IRSA

```bash
# Row 30 — s3-year-report — +4 partial (forecast) — daytime
# ⚠ BLOCKED until eks #24 materializes point-app-irsa-role.
# The bucket year-report.bs-point-stg PRE-EXISTS in 471 (head-bucket 200) -> `terraform import` the bucket FIRST,
#   else apply fails BucketAlreadyOwnedByYou.
cd terraform/components/s3-year-report
../../terraform.sh --env stg init
../../terraform.sh --env stg import aws_s3_bucket.this year-report.bs-point-stg
../../terraform.sh --env stg plan       # Re-plan after import (+ IRSA): adopt versioning/SSE/lifecycle/PAB/logging sub-resources; KMS alias created fresh; confirm 0 destroy of bucket data.
../../terraform.sh --env stg apply
# After-check:
aws s3api get-bucket-lifecycle-configuration --bucket year-report.bs-point-stg   # lifecycle retained
```

---

### Row 30b — s3-refinitiv-migration — UNKNOWN · daytime — blocked on IRSA (no plan baseline)

```bash
# Row 30b — s3-refinitiv-migration — daytime
# ⚠ BLOCKED until eks #24 materializes point-app-irsa-role. No plan baseline yet (brand-new component).
# Re-plan once IRSA exists; DEV got +9 greenfield. After-check by name (confirm the bucket name at plan).
cd terraform/components/s3-refinitiv-migration
../../terraform.sh --env stg init
../../terraform.sh --env stg plan       # Re-plan after IRSA; expect clean greenfield create (no baseline -> risk UNKNOWN). Confirm the bucket name at plan.
../../terraform.sh --env stg apply
# After-check: aws s3api head-bucket --bucket <refinitiv-migration bucket from plan>
```

---

### Row 33 — ec2-proxy — MED · `+4` + `+1` EC2 (forecast) · daytime — blocked on proxy-sg

```bash
# Row 33 — ec2-proxy — +4 IAM + +1 EC2 greenfield (forecast) — daytime
# ⚠ BLOCKED on security_group #10 (proxy-sg, proxy_enabled=true). plan_failed at tip until the SG exists.
# STG fixed-IP tfvar `proxy_private_ip` MUST be in the STG 10.51.187.0/24 subnet (a TODO in stg.tfvars), NOT 172.18.x.
# Precede ec2-data-transfer #34.
cd terraform/components/ec2-proxy
# First: set proxy_private_ip in tfvars/stg.tfvars to a free address in 10.51.187.0/24.
../../terraform.sh --env stg init
../../terraform.sh --env stg plan       # Expect (after SG #10): +4 IAM (role/profile/policy/attachment) + +1 aws_instance, 0 destroy/replace.
../../terraform.sh --env stg apply
# Post (bastion manual): install the SSM agent (snap -> deb) + drop /etc/profile.d/squid-proxy.sh so egress routes via the proxy.

# After-check (from the bastion):
# curl -so /dev/null -w '%{http_code}\n' -x http://<proxy private ip>:3128 https://www.google.com   # expect 200
```

---

### Row 34 — ec2-data-transfer — LOW · `+4` (forecast) · daytime — blocked on ec2-proxy

```bash
# Row 34 — ec2-data-transfer — +3 IAM + +1 EC2 greenfield (forecast) — daytime
# ⚠ BLOCKED on ec2-proxy #33 (the squid_proxy data source reads the proxy by name -> apply #33 first).
# AMI ami-03598bf9d15814511 is CONFIRMED public/available in 471 (describe-images: OwnerId 137112412989, Public, available)
#   -> NO STG AMI swap needed.
cd terraform/components/ec2-data-transfer
../../terraform.sh --env stg init
../../terraform.sh --env stg plan       # Expect (after ec2-proxy): all-add (+3 IAM + +1 EC2), 0 destroy/replace.
../../terraform.sh --env stg apply
# After-check:
aws ec2 describe-instances --region ap-northeast-1 --filters Name=tag:Name,Values=*data-transfer* Name=instance-state-name,Values=running --query "Reservations[].Instances[].InstanceId" --output text
```

---

### Row 35 — cloudwatch_metrics — MED · `+2/~33/-2` · daytime

```bash
# Row 35 — cloudwatch_metrics — +2/~33/-2 — daytime
# STOP: apply IMMEDIATELY before cloudwatch_alarm #36 to avoid the orphan-metric alarm window.
# Destroys okcoinOrderbookGetter, adds amberOrderbookGetter; 33 in-place. Alarm/metric names carry [stg] via the env tfvar.
cd terraform/components/cloudwatch_metrics
../../terraform.sh --env stg init
../../terraform.sh --env stg plan       # Expect: +2 / ~33 / -2 (okcoin -> amber metric-filter rename + pattern updates).
../../terraform.sh --env stg apply
# After-check:
aws cloudwatch list-metrics --region ap-northeast-1 --namespace point-metrics --query "Metrics[?MetricName=='okcoinOrderbookGetter']"   # returns [] (decommissioned)
```

---

### Row 36 — cloudwatch_alarm — MED · `+2/~11/-2` · daytime

```bash
# Row 36 — cloudwatch_alarm — +2/~11/-2 — daytime
# Pre-req: cloudwatch_metrics #35 applied immediately prior.
# STOP: verify no alarm definition references the old okcoinOrderbookGetter* metrics before apply.
cd terraform/components/cloudwatch_alarm
../../terraform.sh --env stg init
../../terraform.sh --env stg plan       # Expect: +2 / ~11 / -2 (alarms re-keyed to the amber metric set).
../../terraform.sh --env stg apply
# After-check:
aws cloudwatch describe-alarms --region ap-northeast-1 --query "MetricAlarms[?MetricName=='okcoinOrderbookGetter'].AlarmName"   # returns []; new alarms transition INSUFFICIENT_DATA -> OK
```

---

### Row 38 — frontend-customer — MED · `+10/~5/-2` partial (forecast) · daytime — ACM CODE GATE

> Shown in apply order: **customer (#38) → admin (#37)**. frontend-admin reads the response-headers policies this component creates, so customer is applied physically first despite its higher row number.

```bash
# Row 38 — frontend-customer — +10/~5/-2 partial (forecast) — daytime — APPLIED BEFORE #37
# ⚠ CODE FIX FIRST (blocks plan): data.tf:1 queries us-east-1 for *.backseat-service.com with statuses=["ISSUED"]
#   and NO `types` filter -> matches 2 ISSUED certs (AMAZON_ISSUED 3ecd4e08 InUse:false + IMPORTED d836a32c InUse:true)
#   -> exit 1. Fix in release/verup: add `types=["IMPORTED"]` to data.tf (selects the in-use cert deterministically;
#   NOT most_recent). init/acm #0 does NOT clear this (it only touches ap-northeast-1 ALB certs). Provider already v6.14.1.
# Pre-req: ALB point-alb HTTPS:443 listener live (security_group #10). exchange.bs-point-stg must NOT pre-exist outside state.
# STOP: do NOT clobber the STG manual proxy/OAuth frontend resources (review the plan to confirm they are untouched).
# STOP (one-time ACL reset): destroying aws_s3_bucket_acl is a no-op -> a lingering public-read grant makes
#   BucketOwnerEnforced fail InvalidBucketAclWithObjectOwnership. Pre-strip the public-read ACL on choice + point first.
cd terraform/components/frontend-customer
../../terraform.sh --env stg init       # provider already pinned >=6.14.1 (no upgrade needed on STG)
../../terraform.sh --env stg plan       # Expect (after the types fix): +10 / ~5 / -2 (the 2 destroys are S3 ACL sub-resources only, non-stateful).
# ONE-TIME pre-step before apply — reset stale public-read ACL on the two buckets that carried it:
aws s3api put-bucket-acl --bucket choice.bs-point-stg --acl private
aws s3api put-bucket-acl --bucket point.bs-point-stg  --acl private
../../terraform.sh --env stg apply

# After-check (resolve the customer distro by alias, NOT a hardcoded id — DEV ids are wrong-account):
CF_ID=$(aws cloudfront list-distributions --query "DistributionList.Items[?contains(Aliases.Items, 'stg.backseat-service.com')].Id | [0]" --output text)
aws cloudfront get-distribution --id "$CF_ID" --query 'Distribution.{Status:Status,MinTLS:DistributionConfig.ViewerCertificate.MinimumProtocolVersion,Geo:DistributionConfig.Restrictions.GeoRestriction.RestrictionType}'   # Status=Deployed, MinTLS=TLSv1.2_2021, Geo=none
curl -sI https://stg.backseat-service.com | head -1   # -> 200
```

---

### Row 37 — frontend-admin — MED · `+3/~4/-1` · daytime — applied AFTER customer (NOT cert-blocked)

```bash
# Row 37 — frontend-admin — +3/~4/-1 clean — daytime — APPLIED AFTER #38
# S3 OAC migration (website-config destroyed, bucket retained) + in-place CloudFront on the live distro E16LHOS2AUK5I2
#   (~1-5 min propagation) + ALB origin http->https.
# CERT IS NOT A BLOCKER ON STG: the admin host is `bo-stg.backseat-service.com` (single hyphenated label) -> covered
#   by the IMPORTED *.backseat-service.com cert d836a32c (ISSUED, InUse) — confirmed live. (DEV needed a level-3 cert
#   for bo.dev.…; STG's hyphenated host is covered — the DEV cert warning does NOT apply here.)
# Pre-req: frontend-customer #38 applied (response-headers policies present); ALB point-alb HTTPS:443 live (SG #10).
#   create_route53_record=false.
# STOP: the STG manual proxy/OAuth = DO NOT TOUCH.
cd terraform/components/frontend-admin
../../terraform.sh --env stg init
../../terraform.sh --env stg plan       # Expect: +3 / ~4 / -1 (the -1 = S3 website_configuration destroyed; in-place CloudFront -> OAC origin; bucket retained). Must exit 0 (cert is covered).
../../terraform.sh --env stg apply

# After-check:
aws cloudfront get-distribution --id E16LHOS2AUK5I2 --query 'Distribution.Status' --output text   # Deployed
curl -sI https://bo-stg.backseat-service.com | head -1   # -> 200 with valid TLS
```

---

### Row 39 — waf-customer — HIGH · `+20/~2/-1` · maint window (deferred tail)

```bash
# Row 39 — waf-customer — +20/~2/-1 — dedicated maint window (after #38)
# Path B: provider ~>6.x, split maintenance_exchange/maintenance_point rule groups, 13 rules
#   (priority-targets-stg.json, enabled_managed_ip_rules=true adds ip_reputation + anonymous_ip). WebACL bc4ca936 (us-east-1).
# Destroys the monolithic `maintenance` rule group -> split into maintenance_exchange + maintenance_point.
# STOP: a plain apply fails WAFInvalidParameterException on duplicate priorities -> the preflight renumber is MANDATORY.
# country_restrict continuity invariant across the geo flip. CloudFront-scoped -> us-east-1. Post the banner >=6h before.
cd terraform/components/waf-customer
../../terraform.sh --env stg init

# (1) Re-detect the preflight Case (may differ from DEV's Case 3):
./scripts/preflight-renumber.sh --detect

# (2) Renumber dry-run (READ-ONLY) — review the printed priority diff:
./scripts/preflight-renumber.sh --expected-account 471112755246 --targets ./scripts/priority-targets-stg.json

# (3) OPERATOR WRITE — commit the atomic UpdateWebACL renumber (optimistic-lock retry; not an AI-assistant action):
#     ./scripts/preflight-renumber.sh --expected-account 471112755246 --targets ./scripts/priority-targets-stg.json --commit

../../terraform.sh --env stg plan       # Expect: +20 / ~2 / -1
../../terraform.sh --env stg apply
# If apply fails `Provider produced inconsistent result` on country_restrict / core_rule_set / rate_limit_count
#   (provider v6.x class), recover with apply -> untaint those 3 -> re-apply. untaint only works AFTER the failed apply:
#   ../../terraform.sh --env stg untaint 'module.for_cloudfront.aws_wafv2_web_acl_rule.country_restrict'
#   ../../terraform.sh --env stg untaint 'module.for_cloudfront.aws_wafv2_web_acl_rule.core_rule_set'
#   ../../terraform.sh --env stg untaint 'module.for_cloudfront.aws_wafv2_web_acl_rule.rate_limit_count'
#   ../../terraform.sh --env stg apply

# After-check:
ACL_ID=$(aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1 --query "WebACLs[?Name=='point-cloudfront-customer'].Id | [0]" --output text) && aws wafv2 get-web-acl --scope CLOUDFRONT --region us-east-1 --name point-cloudfront-customer --id "$ACL_ID" --query "WebACL.Rules[].{P:Priority,N:Name}" --output table   # country_restrict present; priorities 1 & 2 reserved for the maintenance split
```

---

### Row 39b — waf-maintenance-lambda — LOW · `+0/~7` · maint window (chained to #39, same window)

```bash
# Row 39b — waf-maintenance-lambda — +0/~7 — SAME window as #39, immediately after the waf-customer apply
# Split-brand Lambda code + cron rewrites. Chain in the SAME window (after preflight + waf-customer apply) so the
#   old single-brand Lambda is never live against the new split WebACL layout (transient-toggle gap).
# Pre-req: #39 applied (the split rule groups must exist); security_group #10 lambda-maintenance-sg.
# Confirm the STG schedule-enabled flag (DEV had it disabled).
cd terraform/components/waf-maintenance-lambda
../../terraform.sh --env stg init
../../terraform.sh --env stg plan       # Expect: +0 / ~7 (split-brand Lambda code + EventBridge cron rewrites)
../../terraform.sh --env stg apply
# After-check:
aws events list-rules --region us-east-1 --query "Rules[?contains(Name,'maintenance')].{Name:Name,State:State}" --output table   # cron rules present; confirm the STG State matches the schedule-enabled decision
```
