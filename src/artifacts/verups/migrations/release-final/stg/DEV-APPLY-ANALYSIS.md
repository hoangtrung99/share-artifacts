# DEV apply analysis → STG preparation (evidence base)

**Purpose.** Distil what the **DEV apply actually did** (from the 38 apply logs in `../../migrate-apply-log/dev/` + the EKS incident report) into the facts that the STG release docs must encode. This is the evidence layer beneath `STG-HANDOFF.md`; every STG checklist item / manual-runbook step traces to a row here. Source order matches the canonical spine in `../dev/apply-order-CANONICAL.md`.

> Scope: point STG. Apply runs on the **STG bastion via its instance role** (no `--profile`). Read-only after-checks use profile `point-operator-stg`. Region `ap-northeast-1` (CloudFront/ACM/WAF-CLOUDFRONT `us-east-1`).

---

## 0. Account target — RESOLVED (high confidence)

| | DEV (done) | STG (next) |
|---|---|---|
| Apply target account | `905418018638` (point-dev) | **`471112755246` (point-stg)** |
| Read-only after-check profile | `point-operator-dev` | **`point-operator-stg`** |
| Apply credential | STG/DEV **bastion instance role** (no `--profile`); `--env` selects tfvars + state backend only | same |

**Why 471, not 520.** The migration is verup → **point**; DEV applied to a *point* account (`905`, point-dev). The apply executes on the bastion via its instance role — `--env` selects the tfvars file + S3 state backend, it does **not** select the AWS credential. The STG bastion lives in **point-stg `471112755246`**, so `--env stg` applies there. Live `sts get-caller-identity`: `point-operator-stg → 471112755246`, `bs-point-stg → 520411743393`. `520` is the **verup-stg source** account (being sunset) — the migration never applies into it. The plan skill `env-registry.yaml` already encodes `stg → point-operator-stg / 471112755246`, matching this.

> **Correction needed:** `STG-HANDOFF.md §1` currently states the apply target is `520411743393 / bs-point-stg`. That is wrong and must be fixed to `471112755246` before the STG docs are trusted. (The misleading `terraform.sh` comment `stg … bs-point-stg` is a laptop-profile-name artifact: DEV's own comment said `dev … bs-point-dev` = `845`, yet DEV applied to `905` via the bastion role.) **Confirm once on the STG bastion: `aws sts get-caller-identity` → `471112755246`.**

---

## 1. DEV→STG structural deltas (from `release/verup` tip `caa99802` stg.tfvars + live)

| Area | DEV | STG | Consequence for the table |
|---|---|---|---|
| VPC CIDR | `172.18.0.0/16` | **`10.51.187.0/24`** | **Risk #1 (IP shortage) acute** — re-derive subnet CIDRs + free-IP after-checks from the /24; do not reuse DEV's 223-249 numbers. |
| NAT / EIP | `single_nat_gateway=true` → 1 EIP | `single_nat_gateway=false` → **3 EIPs** (`nat1/2/3` = `point-nat-apne1-az1/-az2/-az4`) | `#0b init/eip` is **NOT verify-only-1-EIP** on STG; it manages 3 EIPs. Confirm all 3 exist or are created; `vpc` data-sources all 3 by name (a duplicate-name allocation breaks the lookup → import instead). |
| Secondary CIDR (the `100.64.0.0/16` managed-ENI pool, glue-etl prereq) | present | **PRESENT** — `secondary_cidr.tf`: `secondary_cidr_block="100.64.0.0/16"`, `secondary_cidr_private_subnets=["100.64.21.0/24","100.64.22.0/24","100.64.24.0/24"]` | **glue-etl is likely NOT blocked at STG** — the 100.64 pool glue-etl needs is enabled. ⚠ `STG-HANDOFF.md §2` says "secondary-CIDR DISABLED → glue-etl blocked" — that conflates two different mechanisms: `secondary.tf`/`secondary_vpc_cidr` IS disabled (`secondary_enabled=false`), but `secondary_cidr.tf`/`secondary_cidr_block` (what glue-etl reads) is enabled. **Resolve by reading glue-etl `data.tf` against the STG plan** — do not assume blocked. |
| office_access_cidrs | 2 IPs | `[]` (empty) | STG gates office access differently; vpc/SG/iam after-checks that assert office CIDRs must use the STG (empty) set. |
| VPC peering | accepter-only, `pcx` from a wallet-stg request | `peer_requester_vpc_cidr=""` (empty) | Confirm whether STG peers at all; the DEV peering pre-step (capture AWS-assigned `pcx`) may be N/A. |
| EKS auth-mode bridge | DEV: Stage 1 + Stage 2 **same window**, merged into pre-ladder v21 step | STG/PRD: Stage 1 + Stage 2 are **SEPARATE rows, parity-wait apart** | Split the single DEV auth-bridge row into two STG rows. Same gates apply to each stage. |
| EKS version | DEV ladder 1.31→1.34 done | STG **must START at 1.31** (live), ladder later | HARD GATE: `stg.tfvars cluster_version`/`cluster_node_version` MUST be `1.31`. A plan showing `1.31 → 1.34` = STOP. |
| EKS access entries | DEV had pre-existing (409 on import) | STG in **CONFIG_MAP, 0 access entries** | The 409 import-collision likely will NOT fire at STG (nothing to duplicate); still run the enumerate-and-import guard. The flip is exactly when RBAC bindings become load-bearing — apply them first. |
| CNI IRSA role `point-vpc-cni-aws-node` | pre-existed at DEV since 2024 | likely **absent at STG** | `-target` create the IRSA role + attachment **first** (root-level; won't drag node groups). |
| waf-customer rules | `priority-targets-dev.json` (Case 3, plan `+16/~2/-1`) | `priority-targets-stg.json` = **13 rules** (`enabled_managed_ip_rules=true`, +ip_reputation +anonymous_ip) | bigger plan; customer WebACL id = **`bc4ca936`** (DEV `30988cab`). Re-detect the preflight Case (may differ from DEV's Case 3). |
| Frontend STG-only | n/a | **manual proxy + OAuth resources** (Risk #3) | **DO NOT TOUCH / destroy** them; review the frontend-customer plan to confirm it does not clobber them. |
| Cert domains | `dev.backseat-service.com`; admin `bo.dev.…`; customer `dev.…` | `stg.…` / `bo.stg.…` (confirm from frontend tfvars) | Re-derive every ACM/CloudFront after-check host; distro IDs (DEV `E1BIDPQ5G0BYCB` customer / `E3ETPFX8HYQZPU` admin) are DEV-only. |
| init/acm cert | flip `true→false` destroyed the stale AMAZON_ISSUED cert | stg.tfvars also flipped `true→false` | STG init/acm apply destroys the STG-side stale cert (if it was created under `=true`). Re-derive STG cert ARNs; do NOT reuse DEV `cb4bfaf0`/`07c7a840`. |

---

## 2. Per-component DEV outcome → STG action (38 logs)

Legend: ✅ clean · ⚠ applied-with-manual-step · 🔧 multi-apply/incident-then-recovered.

| # | Component | DEV outcome | What DEV actually needed (beyond a single `apply`) | STG must do |
|---|---|---|---|
| 0 | init/acm | ⚠ destructive | `0/0/2` — destroyed EXPIRED AMAZON_ISSUED cert `cb4bfaf0` + its R53 validation record | Re-plan first (if cert not in STG state → `0/0/0`, use `aws acm delete-certificate` instead). STG zone/cert ARNs differ. |
| 0b | init/eip | ✅ verify-only (1 EIP) | `No changes` (single NAT) | **NOT verify-only** — 3 EIPs (multi-NAT). Expect creates/imports; confirm 3 named EIPs before vpc. |
| 1 | infra/iam | ⚠ 6 imports + 2-pass | `import` 4 custodian roles (`[0]`-indexed) + 2 policies, then apply; 2nd pass flipped trust principal → `590183696997` | Same 6 imports (custodian-AdministratorRole lockout risk → exact order). Verify STG CICD `named_user` exists. Account literal `905→471`. |
| 2 | infra/audit | ⚠ 5 imports, `module.config` DEFERRED | `-target` all modules **except `module.config`** (211 cross-account drift = OPEN Option A vs B); 5 waf-logs sub-resources imported | Same DEFER strategy (same 211 drift on 471). Creates `s3-access-logs.bs-point-stg` (hard prereq for S3+WAF rows). |
| 3 | infra/ebs-security | ✅ | `+2` (encryption-by-default + snapshot block) | Trivial; may be `0/0/0` if already on. |
| 4 | ecr | ✅ | `+5` repo policies (repos pre-existed) | Repos must pre-exist; depends on iam #1. Account literal in principals. |
| 5/6 | sns-alert / notification-global | (not in DEV log set) | — | Apply per canonical; operator accepts broadened Health alerts. |
| 7 | notification | (deferred past #12b) | runs AFTER secrets_manager #12 + event-notification #12b | `alert-lambda-event-notification` must exist first; STG already converged in some respects — re-plan at tip. |
| 8 | vpc | ✅ | `+33/~0/-1` (the -1 is default-NACL **state migration**, not a delete); `init --upgrade` → vpc module 6.6.1 / aws 6.50.0 | /24 → verify ≥7 free IPs/subnet (Risk #1). Multi-NAT consumes 3 EIPs. If re-plan shows NEW subnet/route destroys → run from laptop/CI, not bastion. |
| 9 | vpc_peering | (blocked on requester in DEV) | accepter-only; needs the AWS-assigned `pcx` | Confirm STG peers at all (`peer_requester_vpc_cidr=""`). |
| 10 | security_group | 🔧 3-step swap + **webhook incident** | (1) `-target` create `alb-https-sg`; (2) `kubectl apply ingress.yaml` (controller re-attaches ALB, detaches `alb-sg`); (3) full apply removes `alb-sg`. **BLOCKER hit:** ALB-controller webhook had 0 endpoints (rogue `app.kubernetes.io/component` selector key from a >1yr-old out-of-band manifest) → `kubectl patch svc … remove …/component` to fix. Never `aws elbv2 set-security-groups`. | **MANDATORY STG pre-check:** `kubectl -n kube-system get svc aws-load-balancer-webhook-service -o jsonpath='{.spec.selector}'` — if it carries the rogue key, pre-patch before STEP 2. Same 3-step swap; couple with aurora 3306→13306 same window. |
| 11 | endpoints | ✅ | `+5/~10/-0` (5 new incl `email-smtp` 587, kms, sts, monitoring, ecr.api; 10 policy tightenings). Missing IAM roles → 0 errors (ARNs evaluated at request time) | email-smtp 587 needs SG #10's 587 ingress rule (path dead until then). Account literal in every endpoint policy + sts `aws:PrincipalAccount`. |
| 12 | secrets_manager | (per canonical) | identify the 1 NEW secret, `put-secret-value` placeholder | App must port `SecretsEnvironmentPostProcessor` (CSI) before pods consume. |
| 12b | event-notification | (point-native gap) | creates `alert-lambda-event-notification` SNS + lambda; needs secret first | STG `471` already has topic+lambda+secret? Re-verify; converge if missing. |
| 13 | waf-maintenance | (per canonical) | verify IP removed | env-specific IP set. |
| 14 | waf-admin | ⚠ branch-desync (3 applies) | IP-set rotation (25 removed/8 added); operator was on the wrong branch → wasted 2 applies; `git pull` needed a PAT (password auth rejected) | **Branch hygiene:** be on `release/verup` + pulled before apply. STG `allow-ipv4` differs — never copy DEV IPs; cross-check removed IPs vs STG NAT/bastion egress. |
| 15 | waf-athena | ✅ | `+3` (workgroup+db+table); provider v6.50 | empty until waf-customer lands logs. Account literal in Glue table location. |
| 16 | s3-maintenance | 🔧 ACL conflict | apply half-failed `InvalidBucketAclWithObjectOwnership` → `aws s3api put-bucket-acl --acl private` → re-apply | If STG `maintenance.bs-point-stg` has a public-read ACL → pre-strip with `put-bucket-acl --acl private`. |
| 17 | elasticache | ⚠ destructive **data wipe** | replace (immutable encryption attrs) — destroy 4m24s + create 6m57s (~12 min); endpoint hostname changed (`master.` prefix) | **STG cache WILL be wiped.** Scale app deploys to 0; app must run Redis SSL + re-read new endpoint from rotated secret. |
| 18 | redshift | 🔧 KMS dance + reboot | **`init -upgrade` to aws 5 mandatory**; `modify-cluster --no-encrypted` → wait → apply (CMK, ~9.5min encrypt) → reboot (require_ssl) → **re-run `redshift-refresh-spring-boot-secret.sh` from a FRESH checkout** so URL gets `?ssl=true&sslmode=verify-ca`; transient `InvalidClusterState` recovered with `wait cluster-available` | Same true→false→true(CMK) + reboot; ~30-60 min. CTO + analytics sign-off. |
| 19 | aurora | ⚠ port flip + secret rotate | `+2/~4/-0/⟳1`: port `3306→13306` (~3min reboot) + KMS policy drops a cross-account root + master-password secret_version replace. Post-apply: `aurora-update-port-in-secrets.sh` + `aurora-update-spring-boot-secret.sh` (mariadb URL @13306) | Same destructive steps; drop the STG-side foreign root from the KMS policy. CTO + DBA sign-off. Couple SG #10 in same window. |
| 20 | aurora validate_password | ⚠ ordering gotcha | bastion scripts; **first plugin-install attempt got `Access denied` (used old password)** → rotate-before-install, use NEW password → ACTIVE + 4 neg/1 pos tests | Re-run the 3-script sequence (state-less, not in TF); same window as #19; rotation must precede install. |
| 20b | glue-etl | 🔧 redshift-active race (3 applies) | `+55` all-add; **the 100.64 secondary-CIDR data source RESOLVED in DEV**; 2 applies failed on `InvalidClusterState`/`IntegrationConflict` (redshift mid-modify) → settle → 3rd apply; trigger manually `start-trigger` (code `start_on_creation=false`) | **Verify glue-etl `data.tf` against STG plan** (the 100.64 pool is enabled at STG — likely NOT blocked, contra STG-HANDOFF). Sequence well AFTER redshift `available` post-reboot or expect 2-3 re-applies. Batches `01`–`05`. |
| 21 | eks (auth bridge) | 🔧 **INCIDENT — CNI IAM deadlock** | 2 failed bundled attempts: 409 import (`user/bs-developer`) + **CNI deadlock** (node role lost `AmazonEKS_CNI_Policy`; v21 ordered vpc-cni IRSA after node roll → nodes never joined → rollback). **FIX (verified): `before_compute=true` on vpc-cni addon + `moved` block** → single apply wires IRSA in parallel. RBAC binding `admin-cluster-admin` + `rbac/` path fix BEFORE flip. Stage-2 `→API` clean (`0/1/0`) | Pin 1.31; `-target` create `point-vpc-cni-aws-node` IRSA first; `kubectl apply -f k8s-manifests/rbac/` (repo root) before flip; verify `named_user` = live STG user (NOT a leaked one); `before_compute`+`moved` MUST be in code; **split Stage-1/Stage-2 into two STG rows**. Decide node-group naming (replace ×5 vs in-place vs live `…-20260508`). |
| 22-24 | eks ladder 1.31→1.34 | ✅ no downtime | each one-minor bump clean; node groups replace if `node_group_name` changes; upgrade kubectl (skew) | reproducible if auth-bridge (with `before_compute`) lands first. |
| 25 | k8s-manifests | ⚠ expected CrashLoop | 5 deploys `configured` but CrashLooped until app image (CSI bridge) + stateful/secrets cutover ready → scaled to 0, came up after cutover | Expect CrashLoop on first apply; keep replicas=0; bring up after stateful cutover. Not a row-25 failure. |
| 26-30 | s3 data buckets | ✅ (kyc 2-destroy clean) | all `applied_clean`; need `point-app-irsa-role` (EKS #24) + `s3-access-logs` first | s3-year-report (#30): canonical says import-first — DEV applied clean without; **check STG bucket pre-existence**, import if present. s3-kyc: if non-`private` ACL → ownership conflict like #16. |
| 30b | s3-refinitiv-migration | ✅ | `+9` greenfield (IRSA already existed by then) | after STG IRSA exists. |
| 32 | ec2-cd-runner | ✅ | `+5`; `point-cd-runner-role` clean create (no import); MUST precede eks #21 | needs `cd-runner-sg` (SG #10, `cd_runner_enabled=true`) first. EKS policy ARN account literal. |
| 33 | ec2-proxy | ⚠ bastion manual | `+5`; **fixed private IP `172.18.21.146`** (tfvar); manual SSM-agent snap→deb + `/etc/profile.d/squid-proxy.sh` on bastion | STG fixed-IP tfvar must be in the STG /24 subnet, not 172.18.x. Repeat bastion proxy-env steps if egress-via-proxy wanted. Precede ec2-data-transfer. |
| 34 | ec2-data-transfer | ✅ | `+4`; **hardcoded AMI `ami-03598bf9d15814511`** (region/account-private); old provider chain (module 3.6.0 / aws v4.67) | **Validate/replace the AMI for STG** — a literal AMI may not exist in 471. data-sources ec2-proxy by name (apply proxy first). |
| 1a | ec2-bastion | ⚠ user_data reboot trap | applied `0/1/0` (root vol 16→30) only after **editing code to ignore user_data** (avoid reboot) + a `moved` block; manual `growpart`+`resize2fs` after (TF resizes EBS, not the FS) | Decide upfront: ignore user_data or accept reboot in a window. Grow FS by hand after a volume bump. Confirm the `moved` block is in `release/verup` so no spurious recreate. |
| 1b | eice | ✅ (slow ~4min) | `+7`; endpoint create ~3.5min; EICE only relays TCP 22 (bastion `sshd` must be up) | budget ~4-5 min; verify STG bastion `sshd` enabled (DEV's was found disabled → EICE-SSH RST). |
| 35/36 | cloudwatch_metrics / _alarm | ⚠ worker rename destroys | metrics `+2/~33/-2` (destroy `okcoinOrderbookGetter`, add `amberOrderbookGetter`); alarms `+3/~11/-2`; metrics-before-alarms to avoid orphan-metric window | same rename; alarm names `[dev]`→`[stg]` via env tfvar. |
| 37 | frontend-admin | ⚠ **cert blocker (DEV)** | applied clean ONLY because the cert was switched out-of-band to `07c7a840` first; level-3 alias `bo.dev.backseat-service.com`; R3-FE-ORDER (customer BEFORE admin) | **CORRECTED by live STG plan (2026-06-18): frontend-admin is NOT cert-blocked on STG.** The STG admin host is `bo-stg.backseat-service.com` (single label, hyphenated — NOT level-3 `bo.stg.…`) → it IS covered by the IMPORTED `*.backseat-service.com` cert `d836a32c`; STG plan = clean `+3/~4/-1` MED (success_with_changes). The level-3 cert concern applied only to DEV's `bo.dev.…`. The real STG cert gate is **frontend-customer's ACM ambiguity** (2 ISSUED certs → add `types=["IMPORTED"]`, see `apply-order-CANONICAL.md` §Code fixes). Apply frontend-customer first (R3-FE-ORDER). |
| 38 | frontend-customer | 🔧 provider bug + ACL | 3 applies: aws **6.14.0 "Missing Resource Identity" provider bug** → `git pull` + `init -upgrade` to **6.14.1**; `InvalidBucketAclWithObjectOwnership` on 2 buckets → `put-bucket-acl --acl private` → clean | Ensure provider **≥6.14.1**; pre-strip public-read ACLs on STG customer buckets; `exchange.bs-point-stg` must not pre-exist outside state; ALB HTTPS:443 live first; **do not clobber STG manual proxy/OAuth**. Level-2 wildcard covers `stg.…` (customer OK, unlike admin). |
| 39 | waf-customer | 🔧 **provider-inconsistent incident** | Path B (`preflight-renumber.sh --commit`, Case 3, `+16/~2/-1`); apply hit **`Provider produced inconsistent result`** on `country_restrict`+`core_rule_set`+`rate_limit_count` (provider v6.50) → **apply → `untaint` those 3 → re-apply** (`untaint` fails if run BEFORE the first apply) | Path B with `priority-targets-stg.json` (13 rules), WebACL `bc4ca936`; re-detect Case; **pre-stage the untaint-recovery**; `country_restrict` continuity invariant; maintenance state preserved; us-east-1. |
| 39b | waf-maintenance-lambda | ✅ | `+0/~9/-0` (cron rewrites + split-brand Lambda hash); chain in the SAME window as #39 (after preflight + waf-customer apply) to avoid the single-brand-vs-split gap | confirm STG schedule-enabled flag (DEV disabled); needs SG #10 `lambda-maintenance-sg`. |

---

## 3. Provider version is per-component (run `init -upgrade` per component)

| Provider resolved in DEV | Components |
|---|---|
| aws **v4.67** | iam, aurora, elasticache, cloudwatch_metrics/alarm, waf-admin, ec2-data-transfer (module 3.6.0 chain) |
| aws **v5.76** | waf-maintenance-lambda |
| aws **v5.100** | ebs-security, audit, **redshift (needs `init -upgrade`)** |
| aws **v6.14.1** | frontend-customer (≥6.14.1 fixes "Missing Resource Identity") |
| aws **v6.50** | vpc, ec2-cd-runner, waf-athena, **waf-customer (the "inconsistent result" class)**, glue-etl |

The v6 components are the ones that threw the `Provider produced inconsistent result` class — pre-stage the apply→untaint→re-apply recovery for waf-customer.

---

## 4. Manual-intervention catalog (NOT in the canonical rows — must be in the STG manual/checklist)

1. **ALB-controller webhook 0-endpoints** (security_group #10) — pre-check the `aws-load-balancer-webhook-service` selector; pre-patch the rogue `…/component` key.
2. **`InvalidBucketAclWithObjectOwnership`** (s3-maintenance #16, frontend-customer #38) — `aws s3api put-bucket-acl --bucket <b> --acl private` before the BucketOwnerEnforced ownership-controls apply.
3. **`Provider produced inconsistent result`** (waf-customer #39) — apply → `untaint` country_restrict/core_rule_set/rate_limit_count → re-apply (untaint only AFTER the failed apply).
4. **`init -upgrade` mandatory** for redshift (aws 4→5) and frontend-customer (→6.14.1).
5. **Re-run db scripts from a FRESH checkout** — redshift spring-boot secret SSL-URL (`?ssl=true&sslmode=verify-ca`); aurora port + spring-boot URL; rotate-before-validate-password (NEW password).
6. **EKS CNI deadlock fix** — `before_compute=true` + `moved` block must be in code; `-target` create `point-vpc-cni-aws-node`; RBAC bindings via `rbac/` path before the flip; enumerate+import access-entry collisions.
7. **ec2-bastion user_data reboot trap** + manual `growpart`/`resize2fs`.
8. **ec2-proxy bastion env** — SSM-agent snap→deb + `/etc/profile.d/squid-proxy.sh`.
9. **Branch hygiene + GitHub PAT** — on the bastion be on `release/verup`, pulled, before apply (waf-admin lost 2 applies to a stale branch; `git pull` needs a PAT).
10. **Redshift-active gates glue-etl** — sequence glue-etl after redshift settles or expect 2-3 re-applies.

---

## 5. Genuine STG-only decisions to settle before/at plan time

- [ ] **Account guard on the STG bastion** → `aws sts get-caller-identity` = `471112755246`. Fix `STG-HANDOFF.md §1` (520 → 471).
- [ ] **glue-etl** — read its `data.tf` against the STG plan; the 100.64 secondary-CIDR pool is enabled (`secondary_cidr.tf`) so it is likely applyable. Confirm, don't assume blocked.
- [ ] **EKS auth bridge split** into Stage-1 + Stage-2 rows (separate windows); pin 1.31; create the CNI IRSA role first.
- [ ] **VPC /24** — re-derive subnet CIDRs + ≥7-free-IP after-checks; 3 NAT EIPs.
- [ ] **Frontend-admin cert** — provision an ISSUED us-east-1 cert covering `bo.stg.backseat-service.com` (needs `*.stg.…` or exact host) BEFORE the apply.
- [ ] **STG-only manual proxy + OAuth** frontend resources = DO NOT TOUCH; review the frontend-customer plan.
- [ ] **ec2-proxy fixed IP** + **ec2-data-transfer AMI** — re-derive for the STG VPC/account.
- [ ] **module.config 211 cross-account drift** — same OPEN Option A vs B; DEFER with `-target` as DEV did.
- [ ] **waf IP allowlists** — env-specific; never copy DEV IPs; cross-check removed NAT-range IPs vs STG egress.

---

## 6. Next steps (the build flow)

1. **Plan STG** — `/verup-to-point-plan --stg` (env=stg → `point-operator-stg`/`471`, read-only; spawns `terraform-plan-evaluator` per target; writes `../../plans/stg/`). Re-runs Phase 0 context bootstrap automatically.
2. **Evaluate** — reconcile the fresh STG plan against this analysis + the STG deltas (§1) + per-component gates (§2); resolve the §5 decisions from real plan output (esp. glue-etl, EKS version, account).
3. **Build `stg/` release docs** mirroring `../dev/`: `RELEASE-VERUP.md` (canonical-ordered, STG values), `apply-checklist`, `APPLY-COMMANDS-STG.md`, and a **trimmed** `MANUAL-RUNBOOK.md` (concise; no DEV-era commentary — only the STG procedure + the §4 manual-intervention catalog inline).
