# verup → point STG — Manual apply runbook

**Target:** `bs-point-infra` `release/verup` tip `21c92487` → point **STG** account `471112755246`, region `ap-northeast-1` (CloudFront / ACM / WAF-CLOUDFRONT in `us-east-1`). All windows JST.

This is the operator's top-to-bottom procedure for the STG apply: read it in order and execute. It is the human-step layer on top of the per-row detail in `apply-order-CANONICAL.md` (the 0..39b spine) and the go/no-go gates in `apply-checklist.md` — those remain the reference for per-row counts and gates; this runbook adds the cross-cutting safety discipline, the manual interventions inline at each step, and the EKS climax sequencing.

Apply runs **on the STG bastion via its instance role** — commands are `--profile`-free; `--env stg` selects only the tfvars var-file + the S3 state backend. All terraform runs use `../../terraform.sh --env stg <init|plan|apply>` from the component directory — never raw `terraform apply --tfvar`. A read-only after-check or plan from a workstation prepends `export AWS_PROFILE=point-operator-stg` (the wrapper does not recognise that name but the AWS provider/CLI consume `AWS_PROFILE` natively).

---

## STEP 0 — Identity & backend guard (run before EVERY component apply)

```bash
# 1. Confirm the account
aws sts get-caller-identity --query Account --output text   # MUST print 471112755246

# 2. Confirm terraform will use the S3 backend (NOT local)
../../terraform.sh --env stg init 2>&1 | grep -E 'Backend:'  # MUST print "Backend: s3", never "local"
```

If `init` ever prints `Backend: local`, **STOP**: a stale `backend.tf` or `tmp/stg/<component>` from a prior killed run is poisoning the backend — clean it and re-init. A local-backend apply runs against empty state and mass-creates resources into whatever credential the bastion holds. The implicit account guard is that the `--env stg` state bucket is owned by `471112755246`, so a wrong-credential remote `init` fails — but that guard disappears if terraform falls back to a local backend, which is why this check is per-component, not once.

> Never apply with `point-operator-stg` against the **verup-stg source account being sunset** — the migration never applies into it. The bastion instance role in `471112755246` is the only apply credential.

---

## CODE FIXES — merge these into `release/verup` BEFORE the relevant windows

Three genuine code defects block the STG apply at tip `21c92487` (none blocked DEV). Fix all three first; full detail in `apply-order-CANONICAL.md` §Code fixes.

1. **eks `cluster_node_ami_type` dead variable** (eks rows). `variables.tf:55` declares it `required` in the `eks` object but it is never referenced and is absent from `stg.tfvars` → `terraform plan` errors `attribute "cluster_node_ami_type" is required`. **Fix:** make it `optional(string, "")` or remove it. Do NOT add it to tfvars (the field is unused).
2. **iam `data.aws_iam_policy.viewer` greenfield lookup** (infra/iam). `role-OperatorRole.tf:48` resolves `custodian-ViewerRolePolicy` from live AWS at plan time, which does not exist on greenfield `471` → plan exit 1. **Fix:** replace `data.aws_iam_policy.viewer[0].arn` with `aws_iam_policy.ViewerRole[0].arn` and delete the `data "aws_iam_policy" "viewer"` block. Re-plan → expect `+16` exit 2.
3. **frontend-customer ACM data-source ambiguity** (frontend-customer). `data.tf:1` queries us-east-1 for `*.backseat-service.com` with `statuses=["ISSUED"]` and **no `types` filter** → matches 2 ISSUED certs (AMAZON_ISSUED `3ecd4e08` not-in-use + IMPORTED `d836a32c` in-use) → exit 1. **Fix:** add `types=["IMPORTED"]` to deterministically select the in-use cert. (init/acm does not resolve this — it only touches ap-northeast-1 ALB certs.)

---

## PRE-FLIGHT — external/human-blocked prerequisites (clear BEFORE opening any window)

These have lead time and cannot be resolved by terraform alone. Detail + per-row gates in `apply-checklist.md`.

1. **The 3 code fixes above are merged** into `release/verup` and re-planned green for eks / infra/iam / frontend-customer.
2. **VPC peering pcx (vpc_peering row).** The hardcoded `pcx-0c3d285e426241d9b` is NotFound in `471`. The wallet account must send a fresh peering request to `vpc-08888557d0bd0cead`; capture the AWS-assigned `pcx`, update `stg.tfvars`, then apply. The existing `pcx-0ce5c02bb35a7bd32` (to the verup-stg source) is a different link and not reusable. **Open: confirm STG peers at all** (`peer_requester_vpc_cidr` was empty in earlier tfvars).
3. **The 2 VPC route losses on the az2/az4 RT migration (vpc row).** When the az2/az4 subnets move to new per-AZ route tables, two unmanaged routes on `rtb-0241362c6cf0dbaa2` are lost: `172.19.0.0/16 → pcx-0ce5c02bb35a7bd32` (verup-stg peering) and `10.50.0.121/32 → vgw-0c33e00d8d13702e0` (Ponta far-end host route). Re-add post-apply, enable `peer_enabled` in tfvars, or confirm both are sunset (insufficient evidence they are).
4. **HULFT `172.19.0.0/16` drain (security_group row).** hulft-sg removes the `172.19.0.0/16` ingress, an active verup-stg cross-account path for HULFT/Ponta batch. Confirm the consumer is drained, or keep the CIDR via tfvars until verup decommission.
5. **iam custodian pre-existence (infra/iam).** Enumerate `custodian-*` roles/policies in `471` before apply (`list-roles | startswith("custodian-")`). If any exist, import all of them in order — `custodian-AdministratorRole` is breakglass, import in exact order to avoid lockout. Confirm `user/cicd` exists (CICDRole trust). Trust principal `590183696997` (bs-custodian) is intentional.
6. **EKS version-ladder branches exist.** The cluster is live at **1.31**; the upgrade steps one minor at a time. Branches `eks/1.32`, `eks/1.33`, `eks/1.34` exist on origin, each a small pinned delta. The applies are the longest-lead schedule item — start them first.
7. **Branch hygiene + GitHub PAT.** On the bastion be on `release/verup`, **pulled**, before any apply (`git pull` needs a PAT — password auth is rejected). A stale branch silently wastes applies.

---

## APPLY SEQUENCE

Follow `apply-order-CANONICAL.md` (rows 0..39b). Re-run STEP 0 before each component. The default rollback for a **killed** (not failed-plan) apply is `terraform force-unlock <LOCK_ID>` → re-plan → re-apply (terraform is idempotent on re-run); component-specific exceptions are called out inline.

### Phase A0 — Bootstrap (daytime)

- **init/acm** — **APPLY to sweep a stale ALB cert.** `enable_certificate_for_cloudfront`/`_for_alb` both `false` (count=0). Plan destroys the deposed EXPIRED AMAZON_ISSUED ALB cert `b1d8ee2d` (ap-northeast-1) + 2 dangling `stg.backseat-service.com` validation CNAMEs (`-3`). **Pre-check:** the deposed cert is NOT on any ALB listener (`describe-listeners | grep b1d8ee2d`); the apex `backseat-service.com` CNAME is retained. ⚠ This does **not** touch the us-east-1 certs and does **not** clear the frontend-customer ACM defect.
- **init/eip** — **NOT verify-only on STG** (`single_nat_gateway=false` → 3 EIPs). `point-nat-apne1-az1` (`eipalloc-035c41eee4835b087`) already exists/in state; the plan **creates the 2 missing EIPs** `point-nat-apne1-az2` + `point-nat-apne1-az4` (both confirmed absent in `471`). **Apply BEFORE vpc** — vpc data-sources all 3 by name and plan_fails without nat2/nat3. After: `describe-addresses` shows all 3 named EIPs. ⚠ If a duplicate-named EIP is created, vpc's by-name lookup goes ambiguous — `import` instead.

### Phase A — Foundation (daytime)

- **infra/iam** — after the code fix #2, **import any pre-existing custodian roles/policies first** (pre-flight #5), in exact order, AdministratorRole last-safe — then apply (`+16`). The import pass can silently rewrite role trust policies; diff and sign off before applying.
- **infra/audit** — apply the verup delta with `-target` and **DEFER `module.config`**: a full apply flips both Config recorders to the cross-account `211125716602:cm-config-role-all-regions` role and destroys the local `bs-aws-config-role` (still the sole live Config credential) — the `211` trust is unverifiable from `point-operator-stg`, so it stays an open engineer decision. Creates `s3-access-logs.bs-point-stg` (hard prereq for the S3 + WAF rows) + 6 GuardDuty detector features. ⚠ Confirm the WAF object-lock `lock_retention_days=1` is intentional. *Rollback:* if config was applied and breaks, re-create the local role and re-point the recorders.
- **infra/ebs-security**, **ecr**, **sns-alert**, **notification-global** — additive; apply in order. `notification-global` is already converged in `471` (no-change). Verify `sns-alert`'s `lambda_function.zip` is a known-good sns-to-slack build.
- **event-notification** + **notification** — both are clean on STG (unlike DEV). `471` already has the `alert-lambda-event-notification` topic + the to-slack lambda + secret live, so `event-notification` is **no-change** and the `notification` chain is satisfied → `notification` is a clean `+1` (Aurora event subscription lands with aurora). Apply `notification` after secrets_manager / event-notification in position.

### Phase B — Connectivity (daytime, except security_group)

- **vpc** — `+39/~3/-1` once the 2 EIPs exist (the `-1` is the default-NACL **state migration**; the physical `acl-0a9983286ac6c8cf1` is retained). NACLs replace on all 9 subnets (6 primary + 3 secondary-CIDR `100.64.x`). **Apply from laptop/CI, NOT the bastion** — a NACL change risks a mid-apply lockout. **/24 CIDR `10.51.187.0/24`** → verify ≥7 free IPs/subnet (Risk #1 is acute on a /24; do not reuse DEV subnet numbers). Remember the 2 route losses from pre-flight #3 — re-add or confirm sunset post-apply.
- **vpc_peering** — only after the real `pcx` is captured (pre-flight #2). Plan is clean `+3` but apply fails on the missing hardcoded pcx until the tfvar is updated.
- **security_group** — **CRITICAL, maintenance window**, coupled with aurora (same window for the mysql-sg port flip). `+23/~2/-5/⟳7`. **3-step controller-driven ALB SG swap:**
  - **MANDATORY pre-check first:** `kubectl -n kube-system get svc aws-load-balancer-webhook-service -o jsonpath='{.spec.selector}'` — if it carries a rogue `app.kubernetes.io/component` selector key (a >1yr out-of-band manifest left this on DEV → webhook 0 endpoints → SG swap never reconciled), `kubectl patch` it out before proceeding.
  1. `../../terraform.sh --env stg apply -target=aws_security_group.alb_https` (create `alb-https-sg`).
  2. `kubectl apply -f k8s-manifests/.../ingress.yaml` so aws-load-balancer-controller re-attaches the ALB and detaches `alb-sg`. Do NOT `aws elbv2 set-security-groups` unless the controller fails to reconcile within ~60s (fallback only).
  3. Full apply removes the now-detached `alb-sg` (`sg-0d6ee86d12b188ab0`). A direct destroy → `DependencyViolation`.
  - MySQL/Redis/Redshift rules flip to **port 13306** + Dalian `45.78.58.128/32` → `100.64.0.0/16`. **hulft-sg removes `172.19.0.0/16`** (pre-flight #4 — confirm the consumer is drained).
  - *Rollback per interruption point:* (a) died after step 1 → just run step 2, do NOT run the full apply (it would hit `DependencyViolation`). (b) died mid step 2 → diagnose the controller, retry `kubectl apply`, or fall back to `set-security-groups`. (c) died during the worker-sg port-8080 rule replace → re-authorize the 8080 ingress then re-apply. (d) died at the `alb-sg` destroy with `DependencyViolation` → confirm the ALB is on `alb-https-sg`, wait ~60s for ENI detach, delete the SG, re-apply.
- **endpoints** — `+5/~10` clean (5 new incl. `email-smtp` 587, kms, sts, monitoring, ecr.api). The email-smtp 587 path stays dead until security_group lands the 587 ingress on `vpc-endpoints-sg` (the endpoint applies fine without it).

### Phase C — Secrets & WAF (daytime)

- **secrets_manager** — already converged in `471` (no-change). If a fresh plan shows a NEW secret, `put-secret-value` the placeholder. The app must port `SecretsEnvironmentPostProcessor` (CSI `/mnt/secrets-store/`) before pods consume new secrets.
- **waf-maintenance**, **waf-admin**, **waf-athena** — apply in order. waf-admin: STG `allow-ipv4` differs from DEV — **never copy DEV IPs**; cross-check removed IPs vs STG NAT/bastion egress. waf-athena: confirm `aws-waf-logs.bs-point-stg` is not in REPLACE (it stays empty until waf-customer lands the CloudFront log source).
- **s3-maintenance** — `+2/-1`. ⚠ If `maintenance.bs-point-stg` has a public-read ACL → pre-strip `aws s3api put-bucket-acl --bucket maintenance.bs-point-stg --acl private` BEFORE the BucketOwnerEnforced ownership-controls apply, else it half-fails `InvalidBucketAclWithObjectOwnership`.

### Phase D — Stateful (maintenance windows — real downtime; do ONE replica-capture + scale-to-0 at window start and ONE restore at the end, covering elasticache + redshift + aurora together — never per-row). CTO/ops sign-off on each.

- **elasticache** — **CRITICAL, destructive data wipe, ~12 min downtime.** `+3/⟳2`: the replication group is REPLACED (immutable `at_rest`/`transit` encryption false→true + CMK add) and `snapshot_retention_limit=0` means no backup to restore from. New KMS key + alias + engine-log group. The primary endpoint hostname changes → secret_version replace → restart pods; the app must run Redis TLS (`SPRING_DATA_REDIS_SSL=true`). *Rollback:* if killed mid-destroy the group is gone — re-apply recreates it (empty).
- **redshift** — **HIGH, ~30-60 min downtime.** `+2/~4`: the `kms_key_id` AWS-owned → new CMK switch is AWS-rejected in-place → run `modify-cluster --no-encrypted` → wait → apply with `-var apply_immediately=true` (~9.5 min encrypt) → `reboot-cluster` for `require_ssl false→true`. Also swaps the subnet-group to the new STG private subnets. The aws-v5 `init -upgrade` is already pinned — confirm at `init`, no re-pin needed. After: re-run `redshift-refresh-spring-boot-secret.sh` **from a FRESH checkout** (URL gets `?ssl=true&sslmode=verify-ca`). Must settle `available` before glue-etl. *Rollback:* re-encryption is a long server-side op — if interrupted, wait for `available`, `refresh`, re-apply.
- **aurora** — **CRITICAL, port flip + secret rotate.** `+2/~4/-1/⟳1`: port `3306→13306` (~3 min reboot); both instances resize `db.r6g.xlarge → db.r6g.4xlarge` (`apply_immediately=true` → no healthy standby mid-apply); master-password `secret_version` replace; `deletion_protection false→true`; new `alias/point-aurora`. The STG KMS policy is already clean (no foreign root, unlike DEV — no policy edit needed). The aurora SG must already allow inbound **13306** (security_group, same window). Post-apply: `aurora-update-port-in-secrets.sh` + `aurora-update-spring-boot-secret.sh` (URL @13306, FRESH checkout), then **rollout-restart** the DB-consuming deployments. *Rollback:* flip the port back (another reboot) + restart pods.
- **aurora validate_password** — same window, chained to aurora. INSTALL PLUGIN via `aurora-install-validate-password.sh` from the bastion. **Rotate the password BEFORE install** (a stale password gets `Access denied`). Verify plugin ACTIVE + 4 negative / 1 positive tests. State-less (not in TF).
- **glue-etl** — **daytime, AFTER the stateful window closes** (additive, NOT inside the downtime window). `+44` all-add (Glue jobs batches `01`–`05`, own S3 staging/meta buckets, glue SG, redshift S3 event-integration). NOT blocked on STG: the `100.64.0.0/16` secondary-CIDR pool glue-etl reads is enabled in `vpc/stg.tfvars`, so its `data.tf` subnet postcondition clears once vpc applies. Sequence well AFTER redshift is `available` post-reboot (a mid-modify redshift causes `InvalidClusterState`/`IntegrationConflict` re-applies). Daily trigger `start_on_creation=false` → manual `start-trigger` post-apply.

### Phase E — EKS — see the dedicated section below.

### Phase F — Post-EKS: K8s manifests, S3, EC2, CloudWatch, Frontends (daytime)

The dependency-late EC2 rows live here (they are numbered `1a/1b/33/34` in the spine but depend on vpc / security_group / eks):

- **k8s-manifests** — `kubectl apply -k` rbac → app → api → admin → worker → mmh after the ladder reaches 1.34. api is `+34/~7`; admin/app/worker/mmh `~1` each. **Expect CrashLoop on first apply** until the app image (CSI `SecretsEnvironmentPostProcessor` bridge) + the stateful cutover are ready → keep replicas=0, bring them up after cutover. This is not a failure. Check the CoreDNS Corefile port (Ponta, Risk #2).
- **6 S3 components** (`s3-chart-snapshot`, `s3-csv-export`, `s3-csv-export-admin`, `s3-kyc`, `s3-year-report`, `s3-refinitiv-migration`) — each needs `point-app-irsa-role` (from eks) + `s3-access-logs.bs-point-stg` (from infra/audit), so they plan_fail until EKS materializes IRSA. After IRSA, re-plan each.
  - **s3-year-report:** the bucket `year-report.bs-point-stg` pre-exists in `471` → `terraform import aws_s3_bucket.this year-report.bs-point-stg` FIRST, then apply (else `BucketAlreadyOwnedByYou`).
  - **s3-kyc:** if the live PII bucket `kyc.bs-point-stg` carries a non-`private` ACL → pre-strip `put-bucket-acl --acl private` (ownership conflict like s3-maintenance).
- **ec2-bastion** — applies `0/1/0` (root vol bump) only after **deciding the user_data-reboot trap upfront**: edit to ignore user_data (the `moved` block must be in `release/verup` so no spurious recreate) or accept a windowed reboot. After any root-vol bump, grow the FS by hand: manual `growpart` + `resize2fs` (TF resizes the EBS volume, not the filesystem). Blocked on infra/iam.
- **eice** — `+7` greenfield (leaf, gates nothing). ~4 min endpoint create. EICE only relays TCP 22 → verify the STG bastion `sshd` is enabled (DEV's was found disabled → EICE-SSH RST).
- **ec2-cd-runner** — runs in the EKS block ordering (see below); creates `point-cd-runner-role` which the eks auth-bridge consumes → it MUST precede the eks apply. Blocked on `cd-runner-sg` (security_group, `cd_runner_enabled=true`).
- **ec2-proxy** — `+4` IAM + `+1` EC2 greenfield. The **STG fixed-IP tfvar** (`proxy_private_ip`) must be in the STG `10.51.187.0/24` subnet (a TODO in `stg.tfvars`), NOT a `172.18.x` value. Blocked on `proxy-sg` (security_group). Post-apply bastion manual: SSM-agent snap→deb + `/etc/profile.d/squid-proxy.sh`. Precede ec2-data-transfer.
- **ec2-data-transfer** — `+4` greenfield. AMI `ami-03598bf9d15814511` is **confirmed public/available in `471`** (`describe-images`: owner `137112412989`, Public) — no STG AMI swap needed. Data-sources ec2-proxy by name (apply proxy first).
- **cloudwatch_metrics** then **cloudwatch_alarm** — apply metrics immediately before alarm to avoid an orphan-metric window. metrics `+2/~33/-2` (destroy `okcoinOrderbookGetter`, add `amberOrderbookGetter`); alarms `+2/~11/-2`. Verify no alarm references the old `okcoinOrderbookGetter*` metrics; alarm names are `[stg]` via env tfvar.
- **frontend-customer** BEFORE **frontend-admin** (admin reads response-headers policies that customer creates).
  - **frontend-customer** — after code fix #3 (the `types=["IMPORTED"]` ACM filter), `+10/~5/-2` (the `-2` = S3 ACL sub-resources). Provider is already v6.14.1 — confirm at `init` (the DEV 6.14.0 "Missing Resource Identity" bug is already fixed in the pin). **Pre-strip public-read ACLs** on `choice.bs-point-stg` + `point.bs-point-stg` (`put-bucket-acl --acl private` — destroying `aws_s3_bucket_acl` does not reset the live ACL, so `BucketOwnerEnforced` would fail `InvalidBucketAclWithObjectOwnership`). `exchange.bs-point-stg` must not pre-exist outside state. ALB HTTPS:443 live first. **Do NOT clobber the STG manual proxy/OAuth resources** (Risk #3, STG-only).
  - **frontend-admin** — `+3/~4/-1` (S3 OAC migration + in-place CloudFront on the live distro `E16LHOS2AUK5I2`, ~1-5 min propagation + ALB origin http→https). **Cert is NOT a blocker on STG:** the host `bo-stg.backseat-service.com` (single label) is covered by the imported `*.backseat-service.com` cert `d836a32c` (ISSUED, in use) — no cert pre-flight is needed. Gate: the `point-alb` HTTPS:443 listener live (security_group). `create_route53_record=false`. **DO NOT TOUCH the STG manual proxy/OAuth.**
- **waf-customer** then **waf-maintenance-lambda** — deferred tail, their own continuous window (the only customer-facing maintenance interruption; banner ≥6h before). CloudFront-scoped → us-east-1.
  - **waf-customer** — Path B (`priority-targets-stg.json`, **13 rules**, `enabled_managed_ip_rules=true` adds ip_reputation + anonymous_ip). WebACL `bc4ca936` (us-east-1, already exists). Destroys the monolithic `maintenance` rule group → split into `maintenance_exchange` + `maintenance_point`. Procedure: (1) `scripts/preflight-renumber.sh --detect` to **re-detect the preflight Case** (may differ from DEV's Case 3); (2) operator re-runs with `--commit` (atomic UpdateWebACL — a WRITE, operator-only); (3) `terraform plan` (expect `+20/~2/-1`) + `apply`. **Pre-stage the untaint-recovery:** the apply may hit `Provider produced inconsistent result` on `country_restrict` + `core_rule_set` + `rate_limit_count` → **apply → `untaint` those 3 → re-apply** (`untaint` only works AFTER the failed apply — before, the instances don't exist). The `country_restrict` rule must stay continuously live across the geo flip.
  - **waf-maintenance-lambda** — `~7` (split-brand Lambda code + cron rewrites). **Chain in the SAME window as waf-customer** (after the preflight + waf-customer apply) so the old single-brand Lambda is never live against the new split WebACL. Confirm the STG schedule-enabled flag (DEV had it disabled). Needs `lambda-maintenance-sg` (security_group).

---

## EKS BLOCK — the highest-risk step (handle with the most care)

The single `eks` component carries three changes; sequence them deliberately. STG order: **ec2-cd-runner → pin 1.31 → IRSA-first → Stage-1 → (separate window) Stage-2 → ladder 1.31→1.34.** Unlike DEV (which ran both auth stages in one window), STG splits Stage-1 and Stage-2 into separate parity-wait windows.

**1. ec2-cd-runner first.** It depends only on `security_group` (for `cd-runner-sg`), not on eks. It creates `point-cd-runner-role` (clean create, no import) which the API-mode access entry references → apply it right after security_group, before the eks apply.

**2. Pin the cluster version to 1.31 and fix the dead variable.** Live STG is **1.31**; `stg.tfvars cluster_version` / `cluster_node_version` currently read `1.34` — **a plan showing 1.31 → 1.34 = STOP.** Pin both to `1.31` and apply the code fix #1 (`cluster_node_ami_type`) before planning.

**3. IRSA-first + CNI deadlock fix (point of no return — hard).** `-target` create the `point-vpc-cni-aws-node` IRSA role + attachment **first** (it is absent at STG; root-level, won't drag node groups). `before_compute=true` + the `moved` block MUST be in code — without them the v21 module orders the vpc-cni IRSA after the node roll, the node role loses `AmazonEKS_CNI_Policy`, nodes never join, and the apply rolls back (the DEV incident). The module upgrade also replaces all 5 node groups (a full node-fleet roll — plan a window) and drops 4 cluster-role policy attachments (`AmazonEKSServicePolicy` deprecated + `AmazonEKSVPCResourceController` + the two custom `point-deny-log-group` / `point-elb-sl-role-creation`). **GATE:** confirm those 4 drops are safe for this cluster's features before applying. *Rollback:* forward-only — `force-unlock` and re-run.

**4. RBAC bindings live BEFORE the flip.** `kubectl apply -f k8s-manifests/rbac/` (repo-root path) so the `admin`→cluster-admin ClusterRoleBinding is live on the cluster. `kubectl get clusterrolebinding admin-cluster-admin` must return the binding. Confirm `named_user` in `stg.tfvars` is a live STG IAM user. STG is **CONFIG_MAP with 0 access entries** → the 409 import-collision DEV hit likely will NOT fire (nothing to duplicate), but still run the enumerate-and-import guard.

**5. Stage-1 (`CONFIG_MAP → API_AND_CONFIG_MAP`).** Apply with both modes active and **prove an API-mode admin call works** in this dual window (e.g. an API-authenticated identity can `kubectl auth can-i '*' '*'`). Verify aws-auth still works. This dual-mode window is the only safe rehearsal.

**6. Stage-2 (`API_AND_CONFIG_MAP → API`) — SEPARATE window, after a parity-wait.** This is the **absolute point of no return**: AWS rejects `API → CONFIG_MAP`, and every admin principal maps to the k8s group `admin`, useless unless the `admin`→cluster-admin binding from step 4 is live. With no implicit creator fallback, the only recovery from a botched flip is the AWS-API escape hatch — a principal holding `eks:CreateAccessEntry` + `eks:AssociateAccessPolicy` binds the managed `AmazonEKSClusterAdminPolicy`. Confirm that principal exists before flipping. `tfvars authentication_mode = "API"` is the Stage-2 end-state. Never go directly `CONFIG_MAP → API`.

**7. Version ladder 1.31 → 1.34** — one minor per branch, entirely under `API` mode (zero auth churn). `git checkout eks/1.32` → plan must show ONLY 1.31→1.32 → apply → update-kubeconfig → upgrade node groups → soak → `eks/1.33` → `eks/1.34` (upgrade kubectl for the skew). No downtime. Node groups replace create-before-destroy after the control plane reaches each minor.

---

## RECOVERY PRIMITIVES (apply to any step)

- **Killed apply (SIGKILL / OOM / network):** the wrapper's signal trap does not cover SIGKILL → the state lock stays held and the next apply fails `Error acquiring the state lock`. Run `terraform force-unlock <LOCK_ID>` (id is in the error), then re-plan + re-apply.
- **Corrupted / half-written state:** the `--env stg` state bucket has versioning enabled → restore the pre-apply version via `s3api list-object-versions` → `get-object --version-id <last-good>` → copy back. Last resort.
- **`AlreadyExists` on a `+ create`:** a resource exists live but isn't in this component's state → `terraform import <address> <id>`, then re-plan. Most exposed: S3 buckets (global names), immutable-named CloudWatch log metric filters / alarms, security groups.
- **Backend fell back to local:** see STEP 0 — clean the stale `backend.tf` / `tmp/stg/<component>` and re-init with the remote backend before doing anything else.

---

## App-side coordination gates (confirm at the window, not assumed)

- The running pod image must already contain: **Redis TLS** (`SPRING_DATA_REDIS_SSL=true`, before elasticache), **Aurora port 13306** (before/at aurora), and **CSI Secrets Store** consumption (`SecretsEnvironmentPostProcessor` reading `/mnt/secrets-store/`). Verify the live deployment image SHA at the window — do not assume.
- After aurora's port flip, **rollout-restart** the DB-consuming deployments to pick up the new port from the refreshed secret.

---

## Verification (after the full sequence)

1. Every after-check uses tag/name/CIDR, never a hardcoded id.
2. All 5 k8s deployments Running, no CrashLoopBackOff; CoreDNS Corefile intact.
3. EKS in `API` auth mode AND an admin can still operate (proven during the dual-mode window).
4. Stateful: elasticache available + TLS, redshift available + `require_ssl` + CMK, aurora on 13306 with pods reconnected.
5. Frontends: both distributions Deployed with valid TLS; `country_restrict` live; STG manual proxy/OAuth untouched.
