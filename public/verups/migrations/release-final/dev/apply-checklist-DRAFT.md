# release/verup — apply checklist DRAFT v10 (DEV only) — CONSOLE-FIRST · ROUND-2 VERIFIED

**Goal**: migrate verup infra to `point` env DEV (rehearsal) with **zero apply errors**. STG/PRD checklists derive from this post-rehearsal.
**Working branch**: [`release/verup`](https://github.com/backseat-inc/bs-point-infra/tree/release/verup) on `bs-point-infra` — fresh-plan SHA `46fb02e0db0be5b3b523cfc7ac0313dd91d73b4e` (**Round-3 re-planned 2026-06-08, full 49-target scope**; supersedes the 2026-05-29 `21a4f4b6` partial 7-component re-plan and the 2026-05-07 `8eadab15` plan). See the **§Round-3** delta block immediately below before trusting any per-row number in this file. ⚠ **Apply tip has advanced**: live `release/verup` tip is now `6672bbb6` (re-verified 2026-06-09), **3 commits ahead of the pinned `46fb02e0`**: `2780b4be` (CF-admin cert var → G6 plan-unblock only, see snapshot), `022f2ea4` (k8s vpcId+rbac → **G9 + G10** RESOLVED), `6672bbb6` (SG module pin → **G14** RESOLVED). Per-row +N/~N/-N counts below were derived at `46fb02e0`; re-run `terraform plan` / `kubectl diff` for any component whose code changed between the two SHAs before trusting its counts. The **G14** SG-module-pin fix (`version = "~> 5.3"`) is now **COMMITTED** at `6672bbb6` (all 4 blocks `eks.tf`/`mysql.tf`/`redis.tf`/`redshift.tf` pinned — no longer worktree-staged; `terraform init` clean). ⚠ **An operator applying the pinned `46fb02e0` still hits G9/G10/G14** — re-checkout tip `6672bbb6` (or cherry-pick the 3 commits) before apply. **See the §Gate status snapshot (re-verified 2026-06-09) at the top of the APPLY-BLOCKING GATES section below.**
**AWS account (dev)**: `905418018638` — profile `point-operator-dev`, region `ap-northeast-1` (CloudFront/ACM in `us-east-1`).
**Timezone**: all maintenance windows in **JST (Asia/Tokyo, UTC+9)**.
**Evidence base (2026-05-29)**: `ground-truth/GROUND-TRUTH.md` (live inventory), `ground-truth/FRESH-PLAN-FINDINGS.md` (fresh `terraform plan` of 7 critical components + opus review), `apply-order-CANONICAL.md` (reconciled 39-row order), `apply-readiness-CODE-REVIEW.md` (60 verified findings), `ground-truth/workflow-output/console-blocks-FULL.md` (per-row console blocks).
**Round-2 verification (2026-05-30)**: `review-round2/CONSOLIDATED-REVIEW.md` + `review-round2/round2-findings.json` — 6 fresh plans @ `21a4f4b6` (secrets_manager, vpc_peering, ec2-cd-runner, frontend-customer, waf-customer, infra/iam) + 14-dimension PR#74 code review + per-component manual-step verification + live AWS checks. Round-2 added gates **G9-G13** (k8s code regressions R2-K8S-01..04 + notification SNS-topic blocker R2-NOTIF-01), corrected **G3** (no eks↔cd-runner cycle) and **G5** (waf-customer Path A is plan-verified, not blocked), and the per-row corrections table above. **Plan-evidence gate:** only `endpoints`, `secrets_manager`, `waf-customer` (Path A) are 100%-plan-verified apply-clean; the rest are conditional/human-blocked/reasoned-only — see `review-round2/CONSOLIDATED-REVIEW.md` §3.

> **What v9 fixes (why this revision exists)** — v8 had three classes of apply-breaking error, all now corrected from fresh evidence:
> 1. **Wrong-account resource IDs** — v8 after-checks hardcoded `vpc-0e139c5a0789db4c0` / `igw-01e61f53a0a31f519` / `nat-00352c4048b1c9674` / `pcx-0b25431ee2b97d2ac` from **845131030484 (legacy-dev)**. The TARGET is **905418018638** → `vpc-0f49bf7456fa50d08` / `igw-029a72e3cc300249f` / `nat-0a54b505d27c22527`, and **no VPC peering exists yet**. Every such after-check failed as written.
> 2. **Stale "greenfield" assumptions** — aurora cluster + redshift cluster + elasticache group + EKS (already v1.31) + VPC topology **already exist** in the target. v8's "verify greenfield → `DBClusterNotFoundFault`" inverts the go/no-go gate. The real deltas are in-place/replace, not create.
> 3. **CLI-only verification** — v8 after-checks were CLI one-liners with unresolved `<placeholder>`s. **v9 makes the AWS Console click-path the PRIMARY verification (per the operator's #1 priority), with a read-only account-guarded CLI as the secondary.**

---

## Confluence-sourced content (verbatim — DO NOT MODIFY)

> Reproduced from Confluence page 1851981830. Operational mitigations live in the apply table below, NOT inside this block.

```
Risks / points to be careful about:
1. IP address shortage — ALB can go down if the subnet has fewer than 8 available IP addresses. Point stg/prd have significantly smaller CIDR.
2. Ponta connection check — existing resources should be kept intact (VGW routing, CoreDNS config, etc.).
3. Frontend resources — STG customer-frontend has manually-created resources that must remain (proxy for verup stg, OAuth). PRD does not have this setup.
4. WAF deployment impact — WAF (customer) deployment will lead to maintenance termination/interruption. Align operationally.
5. Restriction for prd access (IAM) — confirm ESS IP addresses in advance.
```

---

## ⛔ APPLY-BLOCKING GATES — clear ALL of these BEFORE starting the apply ladder

These are the issues that would otherwise fail `terraform apply` or cause an outage (full detail + evidence in `apply-readiness-CODE-REVIEW.md`). Console-priority check noted for each.

### §Gate status snapshot — re-verified 2026-06-09 against live `release/verup` tip `6672bbb6`

> Re-checked every gate against the **live tip `6672bbb6`** (3 commits past the pinned `46fb02e0`: `2780b4be` CF-admin cert var · `022f2ea4` k8s vpcId+rbac · `6672bbb6` SG module pin) + live AWS in dev `905418018638`.
> **SHA caveat (this file's recurring rot):** a gate marked RESOLVED `@6672bbb6` is fixed **only at the live tip** — an operator who applies the pinned `46fb02e0` still hits **G9/G10/G14**. Re-checkout the tip (or cherry-pick the 3 commits) before apply. The detailed gate cards below still carry the full evidence; this snapshot only carries the *current verdict*.

| Gate | Status | Verdict @ tip `6672bbb6` (evidence) |
|---|---|---|
| **G1** | ◐ branch-half DONE (2026-06-10) | Ladder branches `eks/1.31` `1.32` `1.33` `1.34` `auth-mode-bridge` **created and pushed 2026-06-10** (small pinned deltas on `release/verup` `376dc7be`); the staged applies remain. since `376dc7be` HEAD `eks/tfvars/dev.tfvars` pins `cluster_version=1.34` + `authentication_mode="API_AND_CONFIG_MAP"` (= Stage 1) → applying HEAD before the cluster is at 1.34 still attempts a direct 1.31→1.34 jump — climb via the ladder branches; HEAD eks apply = Stage 1 only at 1.34; Stage 2 `API` = `eks/auth-mode-bridge` (PR #98). |
| **G2** | ✅ RESOLVED `@46fb02e0` | `eks/tfvars/dev.tfvars` → `eks_access_entries.user_names.named_user = "bs-developer"` (stg `bs-operator` leak gone). Already fixed at the pin. |
| **G3** | ✅ VERIFIED — no code fix needed | `ec2-cd-runner/data.tf` has **zero** EKS data sources (only vpc/subnet/`cd_runner_sg`/ssm/caller) → no eks↔cd-runner cycle. Pure ordering rule: ec2-cd-runner after security_group #10, before eks bridge #21. |
| **G4** | ⛔ OPEN — procedure (not code) | 3-phase ALB-SG cutover; not code-fixable. Now **reachable** because G14 unblocked `terraform init`. |
| **G5** | ↦ SUPERSEDED → Path B is in code | `waf-customer/versions.tf` provider `~> 6.40` + split `rulegroup-maintenance-{exchange,point}.tf` + `scripts/preflight-renumber.sh` + `priority-targets-{dev,stg,prd}.json` all present. The Path-B preflight-renumber procedure is mandatory at apply. |
| **G6** | ⛔ OPEN — partial | Plan-blocking 0-match data source fixed by `2780b4be` (`cloudfront_certificate` → `*.backseat-service.com`, which resolves the us-east-1 ISSUED/IMPORTED cert). **Apply-blocking REMAINS:** CloudFront alias `route53_record = bo.dev.backseat-service.com` (level-3) is **NOT** covered by `*.backseat-service.com` (level-2) → `InvalidViewerCertificate` at apply. The only cert covering it (`*.dev.backseat-service.com`) is **EXPIRED**. Need an ISSUED cert covering `bo.dev.backseat-service.com` (or `*.dev.backseat-service.com`) in us-east-1. ⚠ `2780b4be` makes the plan green but leaves the apply red — do NOT read it as resolved. **Filter constraint:** the data source is `types=["IMPORTED"]`, so a DNS-validated renewal of the expired `*.dev.backseat-service.com` AMAZON_ISSUED cert would NOT match — either **import** an ISSUED level-3-covering cert, or widen the filter to accept `AMAZON_ISSUED`. |
| **G7** | ⛔ OPEN — human / cross-account | Config recorders flip to `arn:aws:iam::211125716602:role/cm-config-role-all-regions`; trust unverifiable from the dev profile, and live `bs-aws-config-role` `RoleLastUsed=2026-06-08` (sole working Config credential). Needs account-owner sign-off (R3-AUDIT-01). |
| **G8** | ✅ ADDRESSED — procedure | Single scale-to-0 / restore window box defined (see §Stateful). Per-row re-capture footguns (R2-STATE-01/02) must still be honored in the cards. |
| **G9** | ✅ RESOLVED `@022f2ea4` | `point/dev/aws-load-balancer-controller.yaml:140` → `vpcId: vpc-0f49bf7456fa50d08` (target). **Unfixed at the pinned `46fb02e0`.** |
| **G10** | ✅ RESOLVED `@022f2ea4` | `bin/k8s_apply.sh:81` → `kubectl apply -f rbac/`. **Unfixed at the pinned `46fb02e0`.** |
| **G11** | ⛔ OPEN | point dev `905418018638` has **0 ACM certs in ap-northeast-1** (live 2026-06-09). Ingress relies on auto-discovery of `*.backseat-service.com`; that cert exists only in 905 **us-east-1** (regional — not usable by the ap-northeast-1 ALB; IMPORTED → not exportable cross-region). **Import the PEM into ACM ap-northeast-1 / 905 before the row-#10 SG window** (mirrors 845/520). PEM source is offline (not in repo / Secrets Manager / SSM). |
| **G12** | ⛔ OPEN | `point/dev/aws-auth-cm.yaml:35` still `userarn: …:user/bs-operator` + `username: bs-operator`; `bs-operator` = **NoSuchEntity in 905** (live), only `bs-developer` exists. Fix L35 → `bs-developer` or drop `mapUsers` (mapRoles already cover admin). |
| **G13** | ⛔ OPEN — point-native dev gap | Live 905 ap-northeast-1 SNS = only `alert-lambda-infra`; `alert-lambda-event-notification` absent → `notification` plan fails at refresh. Apply `event-notification` (#12b) before `notification` (#7). |
| **G14** | ✅ RESOLVED `@6672bbb6` | All 4 SG module blocks (`eks.tf`/`mysql.tf`/`redis.tf`/`redshift.tf`) now `version = "~> 5.3"` (commit `6672bbb6`). **Unfixed at the pinned `46fb02e0`** — apply at tip or cherry-pick. The `init` version conflict is gone, which also makes G4 reachable. |
| **OPUS-GATE-A** | ⛔ OPEN — human sign-off | ✱**REFINED 2026-06-09: FAIL-CLOSED today (no `import{}`/`moved{}` in iam → naive apply fails at `EntityAlreadyExists`); silent-rewrite is a FUTURE trigger only.** iam custodian-role trust-policy silent-rewrite risk stands; diff each live trust vs HEAD `iam` + sign-off on dropped cross-account principals (root `590183696997`, not `…996997`) / `bs-cicd-test` / `SourceIp` narrowing before apply. **Sequence the custodian-trust narrowing AFTER the EKS `→API` flip** — it can sever the EKS break-glass (escape-hatch = `custodian-AdministratorRole`). |

**Tally @ `6672bbb6`:** ✅ resolved/addressed = G2, G3, G8, G9, G10, G14 (+ G5 superseded→Path-B-in-code) · ⛔ still open = **G1, G4, G6, G7, G11, G12, G13, OPUS-GATE-A**. The 3 code-fix RESOLVEDs (G9/G10/G14) and partial G6-plan-unblock all live **past the pinned SHA** — the pin must advance to `6672bbb6`.

---

### Full gate detail (G1–G8 — evidence cards; snapshot above is the authoritative current verdict)

| Gate | Component | What's wrong | Fix before apply | Owner |
|---|---|---|---|---|
| **G1** ◐ branch-half DONE 2026-06-10 | eks | The ladder/bridge branches `eks/1.32`, `eks/1.33`, `eks/1.34`, `eks/auth-mode-bridge` **were created and pushed 2026-06-10** (each a small pinned delta on top of `release/verup` `376dc7be`; the ladder rungs hold `API_AND_CONFIG_MAP` — Stage 1 is applied before the ladder by `eks/1.31`; the `access_entries = {}` gate only activates under CONFIG_MAP). `release/verup` HEAD (`376dc7be`) still pins a single **1.31→1.34** jump (AWS rejects) but now holds `authentication_mode = API_AND_CONFIG_MAP` (= Stage 1, a legal transition; the `API` flip moved to `eks/auth-mode-bridge`/PR #98). | **Apply the rungs branch-by-branch** (`eks/1.32` → `eks/1.33` → `eks/1.34` → `eks/auth-mode-bridge`); the staged applies remain. Never apply HEAD directly. | trung/shuku |
| **G2** ✅RESOLVED @46fb02e0 | eks (Bug B) | ✅ **RESOLVED — live-verified 2026-06-09 @ tip `6672bbb6` (already fixed at the pinned `46fb02e0`)**: `eks/tfvars/dev.tfvars` now sets `eks_access_entries.user_names.named_user = "bs-developer"` (the stg `bs-operator` leak is gone). _Original defect:_ `eks/tfvars/dev.tfvars:76 named_user = "bs-operator"` — a **stg user leaked into dev**. `bs-operator` is `NoSuchEntity` in 905418018638; dev user is `bs-developer`. With `enable_cluster_creator_admin_permissions=false`, flipping to API auth **locks out all admins**. | Change `named_user` → `bs-developer`; verify ≥1 access entry maps to real cluster-admin (kubectl from bastion while still `API_AND_CONFIG_MAP`) BEFORE the `→API` flip. | trung |
| **G3** ✱R2-corrected | eks (Bug A) / ec2-cd-runner | EKS API-mode access entry references `point-cd-runner-role`, created by ec2-cd-runner #32. **R2 (fresh plan @ 21a4f4b6) REFUTES the cycle**: ec2-cd-runner's `data.tf` has ZERO EKS data sources — it plan-fails ONLY at `data.aws_security_group.cd_runner` (`cd-runner-sg`, created by security_group #10). There is NO plan-time eks↔cd-runner cycle; the only edge is `ec2-cd-runner BEFORE eks`. | **Apply ec2-cd-runner (#32) right after security_group (#10), BEFORE the eks auth-mode bridge (#21).** It creates `point-cd-runner-role` cleanly (currently `NoSuchEntity` → no import needed). The corrected EKS sequence is **ec2-cd-runner → version ladder (#22-24) → auth-bridge (#21) LAST**. Delete the old "import the role / don't reorder" advice. | trung |
| **G4** | security_group | `alb-sg` (sg-005b8b9b2e2cb718e) is destroyed while attached to **3 live ALB ENIs** → `DependencyViolation`, apply fails mid-way. | Three-phase apply (see row card): targeted-create `alb-https-sg` → `kubectl apply ingress.yaml` (controller swaps ALB) → full apply. NOT `aws elbv2 set-security-groups`. | trung |
| **G5** ✱R3-SUPERSEDED (pr-84 MERGED → Path B active) | waf-customer | **⚠ The branch decision is now RESOLVED: pr-84 (maintenance-split, BB-2102/2125) is MERGED into release/verup (user-confirmed 2026-06-08; commit `e394685c`).** HEAD is now provider `~>6.40` + **split rule groups** `maintenance_exchange`/`maintenance_point` + `scripts/preflight-renumber.sh` PRESENT. Fresh plan = **`+18/~2/-1`** (the old "Path A `+5/~4`" is dead). _Original R2 text (kept for history): "HEAD = provider ~4.0 + rule-group, preflight-renumber.sh absent, Path A clean."_ | **Use Path B (the only path now).** Follow the 4-step procedure in the per-row card "Row #39 — waf-customer" below: (1) targeted-create `maintenance_exchange` + `maintenance_point`; (2) ensure frontend-customer applied (static maintenance content staged); (3) `preflight-renumber.sh --profile point-operator-dev --expected-account 905418018638 --targets ./scripts/priority-targets-dev.json` (dry-run → `--commit`) — atomic renumber prevents `WAFInvalidParameterException`; (4) `plan`/`apply`. `priority-targets-{dev,stg}.json` are **VERIFIED correct for BOTH point envs** (2026-06-08, derived from `rules.tf` × tfvars, compared to live WebACLs dev `30988cab` / stg `bc4ca936`): point-dev = 11 rules (`enabled_managed_ip_rules=false`), point-stg = 13 rules (adds `ip_reputation_list_count:6` + `anonymous_ip_list_count:7`). The JSON has no account field → README account labels (`845…`/`520…`) are cosmetic; layout account-agnostic. Live WebACLs hold only the 7 legacy V4 rules (renumber-FROM); the rest are created by apply. Validate allow_ipv4 rotation first. | trung + team |
| **G6** ⛔OPEN (partial) @6672bbb6 | frontend-admin | ⚠ **RE-VERIFIED 2026-06-09 @ tip `6672bbb6`: still OPEN (apply-blocking).** Commit `2780b4be` set `cloudfront_certificate = "*.backseat-service.com"` → the `data.aws_acm_certificate` (us-east-1, ISSUED+IMPORTED) now resolves, so the **plan-exit-1 is gone**. BUT the CloudFront alias is `route53_record = "bo.dev.backseat-service.com"` (level-3) and `*.backseat-service.com` (level-2) does **not** cover it → CloudFront throws `InvalidViewerCertificate` **at apply**. The only cert covering `bo.dev.backseat-service.com` (`*.dev.backseat-service.com`, AMAZON_ISSUED) is **EXPIRED**. So `2780b4be` turned a plan failure into an apply failure — NOT a fix. _Original (still-valid) finding:_ **Plan exits 1** (plan-verified 2026-05-29 @ 21a4f4b6): `module-for-cloudfront/data.tf` filters ACM by `domain=dev.backseat-service.com` + `types=[IMPORTED]` + `statuses=[ISSUED]` → 0 matches → `no ACM Certificate matching domain`. The CloudFront alias is `bo.dev.backseat-service.com` (`route53_record`, a **level-3** host). The 3 certs in us-east-1 — `cb4bfaf0` (`dev.backseat-service.com`, EXPIRED, AMAZON_ISSUED), `2f009235` (`*.backseat-service.com`, EXPIRED, IMPORTED), `07c7a840` (`*.backseat-service.com`, ISSUED, IMPORTED) — **none covers `bo.dev.backseat-service.com`** (a level-2 wildcard matches only one label). v8 "domain TBD / admin.dev" is spurious. | **Two-level fix.** (1) The plan-blocking cause is the data-source filter resolving 0 certs. (2) But the proper fix is NOT just repointing the filter at `*.backseat-service.com` — that level-2 wildcard does **not** cover the level-3 alias, so CloudFront would reject the cert at apply (every alias must be covered). **Import an ISSUED cert covering `*.dev.backseat-service.com` (or exact `bo.dev.backseat-service.com`) into us-east-1, then set `cloudfront_certificate` to resolve it.** Re-importing `cb4bfaf0` does not help (wrong coverage + type). Drop the admin.dev domain-change steps. | trung |
| **G7** | infra/audit | **Plan-verified 2026-05-29 @ 21a4f4b6**: plan SUCCEEDS (`5 to import, 6 to add, 5 to change, 2 to destroy` — v8's "plan_failed" refuted). Both Config recorders (ap-northeast-1 + us-east-1) flip `role_arn` to a **cross-account** role `arn:aws:iam::211125716602:role/cm-config-role-all-regions` (point prd) and the apply **destroys** the local `bs-aws-config-role`. Cannot be verified from the dev profile; if the cross-account role/trust is missing, Config recording breaks. | Confirm with the account owner that `cm-config-role-all-regions` exists in 211125716602 and its trust allows `config.amazonaws.com` from 905418018638, **before** apply. | trung |
| **G8** | stateful (aurora/elasticache/redshift) | v8 has each stateful row **independently** scale-to-0 and restore from its own `/tmp/replicas.txt`. If aurora scales to 0 first, elasticache then captures replicas (all **0**) → restores to 0 → **whole namespace left down**. | **ONE** replica capture at window start (before the first scale-to-0), **ONE** restore at window end. See the Stateful-window box below. | trung |

### ⛔ Round-2 gates (2026-05-30 — added from the round-2 PR#74 code review + 6 fresh plans; all verified against HEAD code + live AWS)

| Gate | Component | What's wrong | Fix before apply | Owner |
|---|---|---|---|---|
| **G9** ✅R3-RESOLVED | k8s-manifests (PR#74 code bug R2-K8S-01) | ✅ **RESOLVED at apply tip `022f2ea4`** (live-verified 2026-06-08; fixed by commit "fix(k8s): correct ALB controller vpcId and rbac apply path" — STALE only because this checklist pins the older `46fb02e0`). Original defect: `point/dev/aws-load-balancer-controller.yaml:140` — helm `vpcId` **REGRESSED base→HEAD** to wrong-account `vpc-0e139c5a0789db4c0` (legacy-dev 845131030484). Target is `vpc-0f49bf7456fa50d08`. The ALB controller would manage the wrong VPC → the row-#10 controller-driven SG swap cannot reconcile. | **Revert L140 to `vpc-0f49bf7456fa50d08` in bs-point-infra source** before the SG-swap window. Gate: controller logs show the target VPC after helm upgrade. | shuku/trung |
| **G10** ✅R3-RESOLVED | k8s-manifests (R2-K8S-02) | ✅ **RESOLVED at apply tip `022f2ea4`** (live-verified 2026-06-08; same fix commit — `bin/k8s_apply.sh:81` now runs `kubectl apply -f rbac/`; STALE only vs the pinned `46fb02e0`). Original defect: `bin/k8s_apply.sh:81` runs `kubectl apply -f point/dev/rbac/` (`APP_DIR=point/$ENV`) but rbac lives at `k8s-manifests/rbac/` — `point/dev/rbac/` does NOT exist. Under `set -e` (line 17) the whole rollout **aborts**, so the `admin`→cluster-admin ClusterRoleBinding never lands → **API-mode admin lockout** when EKS flips to API auth (#21). | **Fix L81 to `kubectl apply -f rbac/`** (or create `point/dev/rbac/`). Verify `kubectl get clusterrolebinding admin-cluster-admin` exists BEFORE the `→API` flip. | shuku |
| **G11** ⛔OPEN @6672bbb6 | k8s-manifests + ACM ap-northeast-1 (R2-K8S-03) | ⛔ **CONFIRMED OPEN — deep-verified live 2026-06-09.** `point/dev/ingress.yaml` (release/verup) sets `listen-ports:[{"HTTPS":443}]` + `security-groups: alb-https-sg` + `ssl-policy` + `spec.tls.hosts: ["*.backseat-service.com"]`, with **no `certificate-arn`** annotation → the ALB controller uses **auto cert-discovery** (matches the `spec.tls.hosts` host against same-region ACM; confirmed against the official `cert_discovery.md`). **Live `aws acm list-certificates` in 905 `ap-northeast-1` = EMPTY (0 certs).** So discovery finds nothing → the HTTPS:443 listener cannot be created → the controller never re-attaches the ALB to `alb-https-sg` → row-#10 swap stalls (DependencyViolation never clears). The `*.backseat-service.com` cert DOES exist in 905 but in **us-east-1** (ISSUED/IMPORTED, exp 2026-10-29) — **regional ACM cannot be used by an ap-northeast-1 ALB**, and an IMPORTED cert is **not exportable** cross-region. verup dev-ex (845) + stg-ex (520) run this exact ingress and work because each has the cert imported in ap-northeast-1. Distinct from the us-east-1/CloudFront cert gates (G6). | **Pre-flight (daytime, BEFORE the row-#10 SG window): import the `*.backseat-service.com` PEM into ACM `ap-northeast-1` / 905** (mirrors 845/520) — `aws acm import-certificate --region ap-northeast-1 …` (operator-run; PEM is offline — not in repo / Secrets Manager / SSM in 905). No ingress change needed (keep auto-discovery, parity with verup). Optionally pin an explicit ap-northeast-1 `certificate-arn` for determinism. Then verify the 443 listener is created + ALB re-attached to `alb-https-sg`. ⚠ Cert hạn 2026-10-29, manual import, no auto-renew (acm_expiration EventBridge alert exists). | trung |
| **G12** ⛔OPEN @6672bbb6 | k8s-manifests (R2-K8S-04) | ⛔ **STILL OPEN — live-verified 2026-06-09 @ tip `6672bbb6`**: `point/dev/aws-auth-cm.yaml:35-36` still `userarn: arn:aws:iam::905418018638:user/bs-operator` + `username: bs-operator`, and `aws iam get-user bs-operator` in 905 returns **NoSuchEntity** (only `bs-developer` exists). The userarn **REGRESSED base→HEAD** `bs-developer`→`bs-operator` (NoSuchEntity in dev) — a SECOND admin-leak beyond `eks/dev.tfvars:76` (G2, now resolved). | **Fix L35 userarn → `user/bs-developer`** (or drop `mapUsers`; `mapRoles` already cover admin via custodian-AdministratorRole + point-bastion-role). Track with G2 as one "purge bs-operator" pre-flight. | trung |
| **G13** ⛔OPEN @6672bbb6 ✱point-native | notification (R2-NOTIF-01) | ⛔ **STILL OPEN — live-verified 2026-06-09**: `aws sns list-topics` in 905 ap-northeast-1 returns only `alert-lambda-infra`; `alert-lambda-event-notification` is still **absent** → `notification` plan fails at refresh. Fix unchanged (apply `event-notification` #12b first). ✱**This is POINT-NATIVE dev drift, NOT a verup change** (live-verified 2026-06-08: `git diff main...release/verup` is EMPTY for `notification/{data,redshift}.tf` — the data source has lived in point's own `main` for a while; **STG `471112755246` already has `alert-lambda-event-notification` + the Slack Lambda + the secret**, only **DEV `905418018638` is missing all three**). `notification/data.tf:19` + `redshift.tf:3` read `data.aws_sns_topic.alert-lambda-event-notification` (it looks "NEW at HEAD" only relative to the stale 8eadab base plan). **Live `sns list-topics` in 905418018638 shows only `alert-lambda-infra`; `alert-lambda-event-notification` does NOT exist** → a fresh DEV plan fails at refresh (`NoSuchEntity`). | **Create the topic by applying the `event-notification` component (now master-table row #12b, after secrets_manager #12) BEFORE row #7** — this converges DEV to STG's existing state. Chain: secrets_manager #12 → event-notification #12b → notification #7. Then re-plan notification. (STG checklist: G13 does NOT apply — already converged.) | trung |

> **Reasoned-only tail (honest scope, NOT a guarantee).** `notification`, `waf-admin`, `waf-athena` rest on a STALE 2026-05-07 plan; even where the code is byte-identical to HEAD, a stale plan cannot rule out `AlreadyExists` on greenfield Glue / rule-group resources. **Re-plan these at `21a4f4b6` before apply.** `redshift` is reasoned-only on the AWS-managed→CMK disable-dance (the in-place plan reading is plan-optimistic; first-hand verup evidence says the direct swap fails — keep the disable-dance + a named pre-snapshot). `eks` (multi-week ladder branches not yet authored), `frontend-admin` (cert issuance), `vpc_peering` (wallet-stg request) and `ec2-proxy` (STG-only IP) are human-blocked — see the residual-risks list.

### Round-2 per-row corrections (apply these to the cards below before running them)

| id | sev | row / line | correction |
|---|---|---|---|
| **R2-STATE-01** | HIGH | per-row scale loops at **L416/L423** (security_group), **L833** (aurora scale-0), **L905-906/L913** (elasticache capture+scale-0/restore), **L978/L986** (redshift) — line refs verified 2026-05-30 | The Gate-G8 single-window box (capture L99 / restore L108) only half-fixed MWC-02: these **per-row capture+restore loops are still live**. The footgun: elasticache **L905** and redshift **L978** RE-CAPTURE (`> /tmp/replicas.txt`) AFTER aurora **L833** already scaled deployments to 0 → they capture all-zeros → restore to 0 → namespace stays down. **Fix: in the per-row blocks, do NOT re-capture (`> /tmp/replicas.txt`) and do NOT restore — rely solely on the single window-box capture (L99) + end restore (L108). Add an abort-if-any-zero guard to the L108 restore.** (Inline warnings added at L905/L978.) |
| **R2-STATE-02** | MED | aurora row, **Gate 6 (L836)** | `kubectl scale deployment --all -n default --replicas=1` restores ALL deployments to 1 — silently downscaling any that ran >1, and re-scaling mid-window before redshift/elasticache. **Remove this per-row scale-up; rely on the G8 end-of-window restore from `/tmp/replicas.txt`.** (Inline warning added at L836.) |
| **R2-AURORA-01** | MED | aurora card "expected plan" line | Relabel to **"Plan: 2 to add, 4 to change, 1 to destroy"** — the 1 destroy is the `aws_secretsmanager_secret_version` REPLACE (password-version rotation), NOT a cluster destroy. The "+2 ~4 ⟳1 / NO destroy" label is wrong. |
| **R2-KMS-01** | MED | aurora + redshift cards | Add a symmetric AlreadyExists pre-guard for the NEW aliases: `aws kms list-aliases --query "Aliases[?AliasName=='alias/point-aurora']"` (expect `[]`) and the analogous `alias/point-redshift`. If non-empty → STOP and reconcile. |
| **R2-EKS-EVID-01** | MED | eks card evidence pointer | The "no auto-stepping" evidence cites a non-existent verup LOCAL module (`modules/eks/main.tf:43`). Conclusion HOLDS; fix the pointer to "public module `terraform-aws-modules/eks/aws ~>21.1`, `kubernetes_version=var.eks.cluster_version`; plan-output.txt:881 shows 1.31→1.34 in-place". |
| **R2-EKS-IAM-01** | HIGH | eks card (module v17→v21) — **PLAN-VERIFIED** | The EKS module `v17.24→v21.1` jump destroys 5 IAM policy attachments on the cluster/worker roles — confirmed in `plans/dev/components/eks/plan-output.txt:998-1024,536`: `cluster_AmazonEKSServicePolicy`, `cluster_AmazonEKSVPCResourceControllerPolicy`, `cluster_deny_log_group`, `cluster_elb_sl_role_creation`, `worker_amazon_eks_cni_policy` all "will be destroyed". **Before the auth flip, confirm v21 RE-ATTACHES equivalents among the +34 adds** (else latent permission regression): re-attach VPCResourceController if any `SecurityGroupPolicy` CRD is in use; verify `AWSServiceRoleForElasticLoadBalancing` exists; note the `deny-log-group` guardrail change. |

---

## §Round-3 — full re-plan deltas (2026-06-08 @ `46fb02e0`)

> **Why this section exists.** Rounds 1–2 were planned at `8eadab15` (2026-05-07) and `21a4f4b6` (2026-05-29, only 7 components). Round-3 re-planned **all 49 default-scope targets** (40 components + 4 infra + 5 k8s) at HEAD `46fb02e0` with per-component dependency classification and Opus second-opinions on 11 targets, **plus the 3 Group C components** (event-notification, schedule-costsaver-lambda, s3-waf-logging) as an addendum — 52 targets total (see R3-GROUPC-01). The gates above (G1–G13) still hold except where a row below supersedes them. **Read these deltas first — several change the go/no-go.** Evidence: `../../../plans/dev/SUMMARY.md`, `../../../plans/dev/runs/20260608T042526Z__dev__dev-all-sections-concurr__cc630276.md`, per-component `../../../plans/dev/<cat>/<name>/evaluation.md` (Opus sections appended).
>
> **Dependency-classification key** used in Round-3 (point-dev is brownfield; all cross-component coupling is via AWS data-source lookups by tag/name, NOT `terraform_remote_state` — so a downstream `terraform plan` FAILS at refresh when an upstream migration resource has not been applied yet):
> - **(A) blocked-on-upstream** — plan fails ONLY because an upstream resource from an earlier apply-order row is absent. **Expected** in a cold brownfield plan; resolves once the upstream applies. NOT a code defect.
> - **(B) genuine defect** — order-independent code/config error (version pin, syntax, wrong arg).
> - **(C) verify-only no-op** — 0/0/0 or disabled-by-flag; excluded from the apply ladder.

### ⛔ NEW Round-3 apply-blocking gates

| Gate | Component | What's wrong | Fix before apply | Owner |
|---|---|---|---|---|
| **G14** ✅RESOLVED @6672bbb6 | security_group | ✅ **RESOLVED — live-verified 2026-06-09**: commit `6672bbb6 fix(security_group): pin terraform-aws-modules/security-group to ~> 5.3` pinned all 4 module blocks (`eks.tf`/`mysql.tf`/`redis.tf`/`redshift.tf` → `version = "~> 5.3"`); `terraform init` resolves clean. **Still unfixed at the pinned `46fb02e0`** — advance the pin to `6672bbb6` or cherry-pick. _Original defect:_ **`terraform init` FAILS at HEAD** (`init-output.txt:30`: "no available releases match the given constraints ~> 4.0, >= 6.29.0"). The SG module blocks in `eks.tf:2`, `mysql.tf:2`, `redis.tf:2`, `redshift.tf:4` have **no version pin** → resolve to `terraform-aws-modules/security-group/aws 6.0.0`, which requires `aws >= 6.29`, conflicting with the component's `versions.tf:5` pin `~> 4.0`. Plan never runs → row #10 (the CRITICAL ALB-SG cutover) **cannot init**. This is a (B) genuine defect, NOT order-dependent. (The `21a4f4b6` plan planned clean at +17/~1/-14 (7 replace; re-verified live 2026-06-11); the most likely cause is `terraform-aws-modules/security-group` **v6.0.0 being published to the registry** between 2026-05-29 and 2026-06-08 — an unpinned block resolves to the latest release at init time — rather than a source change in `release/verup`. Either way the fix is the same: pin the module.) | **Pin the SG module version** in the four module blocks (e.g. `version = "~> 5.3"`, the last `aws ~> 4`/`~> 5`-compatible line) OR bump `versions.tf` to `aws >= 6.29` AND reconcile every other v4-pinned resource. Re-run `terraform init && plan` to confirm the +/~/− set before the SG window. **Until fixed, G4's 3-phase ALB swap is unreachable.** | trung-shuku |
| **OPUS-GATE-A** | infra/iam (row 1) | ⚠ **REFINED 2026-06-09 @ tip `6672bbb6`: iam is FAIL-CLOSED today** — ZERO `import{}`/`moved{}` blocks in `terraform/infra/iam` (grep-confirmed), so a naive `terraform apply` fails closed at `EntityAlreadyExists`; the silent trust-rewrite is a FUTURE trigger only (activates if someone adds an import block / runs `terraform import` on `custodian-*`). Corrections: only **3 of 4** roles retain managed `AdministratorAccess` (ViewerRole has ZERO managed policies); the dropped cross-acct root is **`590183696997`** (not `590183996997`). See `REMAINING-BLOCKERS-INVESTIGATION-2026-06-09.md` OPUS-GATE-A card. _Original (2026-06-08):_ The 6-resource import runbook (G-level row 1) prevents `EntityAlreadyExists` but does **NOT** prevent a **silent trust-policy rewrite**: the 4 custodian roles already exist in 905418018638 with trust policies that DIFFER from HEAD code. Import-then-apply would silently drop cross-account assume principals (`728927523062` on Admin+Viewer, `590183696997` on Admin+Operator), drop `user/bs-cicd-test` (CICD), and narrow `SourceIp` to two Cloudflare /32s. `EntityAlreadyExists` fails closed; a trust rewrite succeeds and silently changes who can assume admin — strictly worse, and it gates ec2-bastion/ec2-cd-runner/eks-auth-bridge downstream. (Live-verified 2026-06-08.) | **Diff each pre-existing role's live trust policy vs HEAD `iam` code BEFORE apply; get explicit sign-off on every dropped principal + the SourceIp narrowing.** Roles also retain AWS-managed `AdministratorAccess` (Operator/Admin/CICD) that the plan never detaches — decide intent. | trung |

### Round-3 corrections to existing gates / rows (supersede where they conflict)

| id | row / gate | Round-3 correction (evidence) |
|---|---|---|
| **R3-EKS-01** | eks (rows 21–24, G1/G2/G3) | **Risk confirmed CRITICAL** (Opus-revised HIGH→CRITICAL). The single-component HEAD plan hardcodes `authentication_mode = "API"` (`eks/tfvars/dev.tfvars`) → would attempt a **DIRECT CONFIG_MAP→API** flip, which AWS rejects (`Unsupported authentication mode update`) AND, with `enable_cluster_creator_admin_permissions=false` + `point-cd-runner-role`=NoSuchEntity, risks total admin lockout. G1's staged ladder branches + G2 Bug-B remain mandatory. **Good news: Bug B (G2) is already FIXED in HEAD code** (`named_user = bs-developer`, live-verified). Fresh plan `+34/~13/-18/⟳5`. |
| **R3-WAF-CUST-01** | waf-customer (row 39, G5) | **Apply-order row 39 + G5 are STALE.** HEAD migrated **provider v4 → v6.40, inline rules → separate `aws_wafv2_rule_group`** (intervening commit `e394685c feat(maintenance-split)` = the pr-84 that G5 warned "do NOT let merge before apply" — it MERGED). Fresh plan is **`+18/~2/-1`** (was "Path A v4 `+5/~4/-0`"); `aws_wafv2_rule_group.maintenance` is DESTROYED and split into `maintenance_exchange` + `maintenance_point`. **Path B is now the only path**; `preflight-renumber.sh` is REQUIRED to avoid a mid-apply `WAFInvalidParameterException` (duplicate priorities). Risk MED→**HIGH**. waf-maintenance-lambda ARN refs are SAFE (resolved by name at runtime, not stored). |
| **R3-AUDIT-01** | infra/audit (row 2, G7) | Plan now SUCCEEDS at HEAD (`+11/~5/-2`, was earlier "plan_failed"). G7's cross-account-Config concern stands **and is sharpened**: `bs-aws-config-role` is **NOT dormant** — live `get-role` shows `RoleLastUsed = 2026-06-08` (it is the sole working Config credential right now), so destroying it after the recorders switch to `arn:aws:iam::211125716602:role/cm-config-role-all-regions` is HIGH-risk. Confirm the cross-account role's trust (`config.amazonaws.com` from 905418018638) is live BEFORE apply, then post-apply re-check both recorders are still `recording=SUCCESS`. |
| **R3-K8S-CSI-01** | k8s-manifests (row 25) | The per-target `kubectl diff` showed admin/api/app/worker/mmh migrating `envFrom point-secrets` → CSI secrets-store with the CSI driver / `point-app-sa` / `SecretProviderClass` **absent** on the live cluster. **Opus confirms this is (A) blocked-on-upstream, NOT a defect**: the CSI stack IS provisioned in release/verup (EKS addon `aws-secrets-store-csi-driver-provider`, `eks/main.tf:107-114` + `dev.tfvars:73-74`; SA/SPC/IRSA) and sequenced ahead by `k8s-manifests/bin/k8s_apply.sh`. The diff was misleading (overlay vs un-bootstrapped cluster). **NEW hard gate (admin/mmh, HIGH):** because pods run `:latest` with `imagePullPolicy: Always`, verify the deployed image actually contains the app-side `SecretsEnvironmentPostProcessor` CSI bridge (exists in code but on feature branches) BEFORE applying — else pods lose all secret access. |
| **R3-NEW-COMP-01** | (NEW rows — now slotted in the master table) | **Two components appeared since PR #89 merged** and are now plannable. They are **merged into the master apply table** in `apply-order-CANONICAL.md` — glue-etl at row `#20b`, s3-refinitiv-migration at `#30b`, waf-maintenance-lambda at `#39b` (*that file's* numbering, distinct from this checklist's scheme). `s3-refinitiv-migration` (#30b) is still plan-blocked on `point-app-irsa-role` — re-plan once IRSA exists. **`glue-etl`** (BB-1917 Aurora→S3→Redshift ETL): **insert after redshift (#16)**; depends on vpc **secondary CIDR `100.64.0.0/16`** (#6) + security_group `mysql-sg` (#7) + secrets_manager `point/aurora/viewer_service` (#9) + aurora **port 13306** (#13) + redshift (#16) — **NOT EKS**. Fresh plan `+44` all-add then plan_failed **(A) blocked on secondary-CIDR subnets** (`data.tf:32` postcondition empty) → clears once vpc (#6) applies its secondary-CIDR subnets. It also **modifies the redshift cluster** (S3 event-integration + IAM) → re-plan after redshift, confirm no redshift disruption. MED, daytime, additive. Apply: `cd terraform/components/glue-etl && ../../terraform.sh --env dev plan && ../../terraform.sh --env dev apply`. **`s3-refinitiv-migration`**: insert with the S3 data buckets (after eks IRSA #28-32 + infra/audit #2); plan_failed (A) blocked on `point-app-irsa-role`; LOW, daytime. |
| **R3-NOTIF-01** | notification (row 7, G13) | **Re-confirmed at HEAD** (G13 still valid): plan_failed (A) at `data.aws_sns_topic.alert-lambda-event-notification` (absent in 905418018638). **Round-3 planned `event-notification` directly** (Group C) and verified it DOES create `alert-lambda-event-notification` (`event-notification/plan-output.txt:43`) — BUT `event-notification` is itself plan_failed (A) blocked on `secrets_manager` (it reads `point/lambda/event-notification-to-slack`, `plan-output.txt:62`). So the true prerequisite chain is **`secrets_manager` (#12) → `event-notification` (Group C) → `notification` (#7)** — apply secrets_manager and event-notification, in that order, before row #7. |
| **R3-GROUPC-01** | Group C (re-planned in Round-3) | The 3 Group C components were re-planned this round: **`event-notification`** = (A) blocked on secrets_manager, creates the topic notification needs (see R3-NOTIF-01); **`schedule-costsaver-lambda`** = clean `+0/~3/-0` LOW (EventBridge re-enable + schedule fix + lambda code; reads `lambda-costsaver-sg` + bastion — apply after security_group #10 + ec2-bastion #31); **`s3-waf-logging`** = **path_missing** — it was relocated into `terraform/infra/audit/s3-waf-logging/` (PR #63), so it is no longer a standalone component and is owned by the infra/audit apply (#2). The live `aws-waf-logs-bs-point-dev` bucket is healthy (Object Lock COMPLIANCE, 30-day retention). |
| **R3-WAFMLAMBDA-01** | waf-maintenance-lambda (**NEW row #39b** — was listed verify-only) | **The split-maintenance feature REQUIRES `waf-maintenance-lambda`** — it is the controller that toggles per-brand maintenance by attaching/detaching the `maintenance-exchange` + `maintenance-point` rule groups on the `point-cloudfront-customer` WebACL (filling the reserved priority slots 1 & 2 at runtime; README + `src/rules/maintenance-{exchange,point}.json`). **It is NO LONGER verify-only**: after the merge the fresh plan is **`+0/~9/-0`** (Lambda `source_code_hash` = new split-brand code + 4 EventBridge cron + 4 targets). Terraform deps = vpc subnets (#6) + security_group `lambda-maintenance-sg` (#7); **functional order = apply immediately after waf-customer #39, in the same window (#39b)** so the WebACL split layout exists and the old single-brand Lambda is never live against the new layout (avoids the transient toggle gap in the Row #39 card "Case 3"). Dev EventBridge schedules are DISABLED (`maintenance_daily/weekly_enabled=false`) → manual/on-demand toggle only. Apply: `cd terraform/components/waf-maintenance-lambda && ../../terraform.sh --env dev plan && ../../terraform.sh --env dev apply`. |

### Round-3 expected-cold-plan-fail inventory (all (A) blocked-on-upstream — NOT defects, NOT blockers to fix in code)

These 11 `plan_failed` targets are dependency-ordering artifacts of planning a brownfield account before the apply ladder runs; each clears once its named upstream applies (do NOT treat as broken):

| target | blocked on (upstream / apply-order row) |
|---|---|
| ec2-bastion | `infra/iam` custodian roles (row 1) + security_group (row 10) |
| ec2-cd-runner | security_group `cd-runner-sg` (row 10) — confirmed NO eks data-source cycle |
| ec2-proxy | security_group `proxy-sg` (row 10) |
| ec2-data-transfer | ec2-proxy squid instance (row 33) + security_group |
| frontend-admin | ACM cert `bo.dev.backseat-service.com` issuance in us-east-1 (G6, human-blocked) |
| notification | `alert-lambda-event-notification` SNS topic (event-notification component, G13) |
| event-notification (Group C) | `secrets_manager` secret `point/lambda/event-notification-to-slack` (#12) — itself the upstream of `notification` |
| s3-kyc / s3-chart-snapshot / s3-csv-export / s3-csv-export-admin / s3-year-report | `point-app-irsa-role` (eks, row ~24) + `infra/audit` s3-access-logs bucket (row 2) |
| glue-etl | VPC secondary CIDR `100.64.0.0/16` subnets (+ aurora/redshift) |
| s3-refinitiv-migration | `point-app-irsa-role` (eks) |

> **Out-of-scope (not a blocker):** `ec2-hulft` plan_failed by design (`hulft_enabled=false` → 12 required vars intentionally absent; stg-only, excluded from the dev rehearsal).

---

## Apply scope — "apply only the changes from release/verup" (verup-delta vs point-native drift)

> **Interpretation (assumption surfaced — correct before executing).** "Apply only the changes from release/verup" is read here as: **converge point dev to the migration delta `git diff main...release/verup`** — the resources release/verup actually adds/modifies on top of the point baseline. It does NOT mean "also reconcile point's own un-applied drift in the same window." Where a per-component plan bundles a destroy/change that release/verup does **not** introduce, that item is **deferred behind its own gate** — not applied blindly alongside the verup work, and not skipped forever (see below).

**Why this matters.** point dev is brownfield and `release/verup` is **149 commits ahead of `main`** (point baseline), touching ~all 40 components + infra. A per-component `terraform plan` reconciles **live state → committed code**, so each plan can bundle two different things:

1. **verup-delta** — resources release/verup adds/changes vs the point baseline. These appear in `git diff main...release/verup -- terraform/<path>`. This is what "apply only release/verup changes" means.
2. **point-native drift** — live resources that point's **own** committed code (already in `main`) dropped or changed but never applied to dev. These are **byte-identical between `main` and `release/verup`** → NOT a verup change; they ride along only because terraform reconciles the whole component to code.

**There is no terraform "apply only the diff" mode.** `terraform apply` of a component reconciles the entire component, not "the lines release/verup changed." To honor the scope, do it per component:

- **Identify**: a destroy/change is **point-native drift** if its defining file is NOT in `git diff main...release/verup -- terraform/<path>`; otherwise it is **verup-origin**.
- **Apply** the verup-origin resources. When a component bundles a risky drift item, use `-target=<module|resource>` to apply only the verup-origin pieces (esp. those that unblock downstream), e.g. `../../terraform.sh --env dev apply -target=module.s3-access-logs` (`terraform.sh` forwards trailing args to `terraform` — `terraform.sh:256` `terraform $*`).
- **Defer** the point-native drift behind its gate, then converge it in a separate gated step — it is still point's intended end-state (point's committed code wants it), so leaving it un-applied is permanent drift, not a fix.

**Verified example — Row #2 `infra/audit`.** The plan's `-2 destroy` (`bs-aws-config-role` + its policy attachment) and the `~2` recorder `role_arn` switch to the cross-account `arn:aws:iam::211125716602:role/cm-config-role-all-regions` are **point-native drift**: `config/iam.tf` (role commented out) and `config/main.tf` (cross-account `role_arn`) are **byte-identical in `main` and `release/verup`** — release/verup does not touch them. The live `bs-aws-config-role` exists only because point applied an older version of its own code once (created 2024-10-07) and never re-applied after commenting it out (live `RoleLastUsed = 2026-06-08`, still the sole working Config credential). The **verup-delta** in infra/audit is everything else: `module.s3-access-logs` (the new bucket — hard prereq for 5 S3 + 3 WAF rows), `module.s3-waf-logging` (import/relocation), `module.guardduty` (new detector features), and the CloudTrail/SSM log-retention bumps — all of which appear in the diff. **Procedure: apply the verup-delta with `-target` to unblock downstream, and defer `module.config` behind G7/Gate 1** (cross-account trust verified live) — see the Row #2 card.

---

## Pre-flight (read once before row #1)

1. **Branch**: `cd bs-point-infra && git checkout release/verup && git pull --ff-only`. (For EKS rows, check out the per-version ladder branch — see Gate G1.)
2. **Account guard (MANDATORY)**: `aws sts get-caller-identity --profile point-operator-dev` → must return `Account: 905418018638`. **Console equivalent**: top-right account menu shows `905418018638` and you are signed in as IAM user `bs-developer`.
3. **Tooling**: `terraform --version` ≥ 1.6 ; `kubectl version --client` ; `jq --version` ; `aws --version`.
4. **Apply runner**: from `bs-point-infra/terraform/components/<component>/` (or `terraform/infra/<m>/`), always invoke **`../../terraform.sh --env dev plan|apply`** — note **`--env dev`, NOT `dev-ex`** (`-ex` is the verup/`bs-exchange-infra` convention and is wrong here).
5. **Run location**: ✅ **the SSM point-bastion is OK for ALL components, including `vpc`, `security_group`, `eks`** (re-assessed 2026-06-10 vs code @ `d0625eca` + live; the old outside-VPC rule is RETIRED). Why per component: `vpc` — the bastion is private/SSM (subnet 172.18.21.0/24, no public IP) and nacl.tf has no transient window (rules before association, atomic swap, private NACL = intra-VPC + ephemeral = the SSM path, default-deny last); `security_group` — the plan never touches the bastion's own SG or its egress (it adds `old_bastion_to_alb` ON alb-https-sg; the alb/mysql/587 changes are off the SSM path); `eks` — terraform talks only to the AWS API, and dev.tfvars keeps `cluster_endpoint_public_access=true` alongside `private_access=true` (no private-only window). ❌ NOT OK only if a re-plan deviates (e.g. new destroys on NACLs/subnets/routes or on the bastion SG) → fall back to laptop/CI. (BB-1562 STG SSH incident = public-subnet SSH bastion era; does not apply to the SSM path.)
6. **Console access**: open the AWS Console as IAM user `bs-developer` in `905418018638`. **Every after-check below leads with a Console click-path; the CLI one-liner is the fallback.** Switch the Console region to `us-east-1` (N. Virginia) for CloudFront / global WAF / ACM checks.
7. **READ-ONLY discipline**: after-checks are `describe-*`/`get-*`/`list-*` only. The EKS pod has **no aws/redis-cli/curl** — never `kubectl exec … aws …`; run CLI from bastion or local.

---

## Coordination with app (from Confluence + PR #74)

- **CI/CD**: provide env resource values (CloudFront distribution IDs, S3 bucket names) to app in advance; create CI/CD secrets if they don't reuse the existing repo.
- **EventBridge**: after **infra/iam** applied, app starts EventBridge work; **stop necessary EventBridge rules + scale all backend pods to 0 before the real release** (prevents unexpected data manipulation / pod restart mid-deploy).
- **Data migration**: after **infra/iam**, app starts DMS prep (console, admin role); after **ec2-data-transfer**, notify app to test migration shell scripts.
- **App-side code ports** (must be in the running pod image BEFORE the matching infra apply): `secrets_manager` → `SecretsEnvironmentPostProcessor` CSI mount (BB-1574, PR #1666/#1702); `elasticache` → Redis SSL `spring.redis.ssl=true` (BB-1461, PR #1366); `ec2-cd-runner`+`eks` → CI/CD via SSM + `HOME=/root` (BB-1514, PR #1384/#1393); cross-account STS (BB-1527, PR #1324).

---

## Stateful maintenance window — single scale-to-0 / restore (fixes Gate G8)

> Run aurora (#19) + aurora-validate_password (#20) + elasticache (#17) + redshift (#18) as ONE Sunday-night block. Do the replica capture + scale-down ONCE at the start and the restore ONCE at the end — NOT per row.

```
# ~22:55 JST — ONCE, before any stateful apply:
kubectl get deploy -n default -o jsonpath='{range .items[*]}{.metadata.name}={.spec.replicas}{"\n"}{end}' > /tmp/replicas.txt
cat /tmp/replicas.txt   # sanity: counts must be NON-ZERO (api/admin/app/mmh/worker)
kubectl scale deployment --all -n default --replicas=0
kubectl get pods -n default   # wait: No resources found

# ... run security_group :443 cutover (#10) + elasticache (#17) + redshift (#18) + aurora (#19) + validate_password (#20) ...
# After each: propagate new endpoints/port into the K8s secrets (point/SPRING_DATA_REDIS new endpoint+SSL; point/aurora/* + SPRING_DATASOURCE_MASTER new port via db-user-manager scripts) BEFORE restoring pods.

# Window end — ONCE, after all stateful applies + secret syncs:
while IFS='=' read -r d n; do kubectl scale deployment "$d" -n default --replicas="$n"; done < /tmp/replicas.txt
kubectl get deploy -n default   # all desired = ready, no CrashLoopBackOff
```

---

## Canonical apply order (39-row spine + `#0` init/acm + `#0b` init/eip bootstrap · single linear order · reconciled 2026-05-29)

Source: `apply-order-CANONICAL.md`. Risk + window per row. **trung** = your rows. Detailed console-first cards for the trung rows follow in the next section.

| # | component | assignee | depends on | risk | window |
|---|---|---|---|---|---|
| 0 | init/acm | **trung** | — (no apply; cert housekeeping) | LOW | daytime · cert creation DISABLED — CloudFront cert import-only (see card "Row #0") |
| 0b | init/eip | **trung** | — → prereq of vpc #8 | LOW | daytime · VERIFY-ONLY (already applied in dev — see card "Row #0b") |
| 1 | infra/iam | shuku | — | MED | daytime |
| 2 | infra/audit | **trung** | 1 | HIGH | daytime · ⚠ G7 |
| 3 | infra/ebs-security | shuku | — | LOW | daytime |
| 4 | ecr | shuku | 1 | LOW | daytime |
| 5 | sns-alert | shuku | — | LOW | daytime |
| 6 | notification-global | shuku | 5 | LOW | daytime |
| 7 | notification | **trung** | 5, 12, 12b | LOW | daytime · ⚠ DEFER past #12b (event-notification chain; point-native — re-points redshift-point sink) |
| 8 | vpc | **trung** | — | HIGH | daytime · run OUTSIDE VPC |
| 9 | vpc_peering | **trung** | 8 | MED | daytime |
| 10 | security_group | **trung**-shuku | 8 | CRITICAL | maint · ⚠ G4 · 3-phase |
| 11 | endpoints | **trung** | 8,10 | MED | daytime · single apply (no re-apply) |
| 12 | secrets_manager | **trung** | — | MED | daytime |
| 12b | event-notification | **trung** | 12 | LOW | daytime · NEW ROW · point-native dev gap (R3-NOTIF-01) — creates `alert-lambda-event-notification` + Slack Lambda; stg has it, dev missing; unblocks #7 |
| 13 | waf-maintenance | shuku | — | LOW | daytime |
| 14 | waf-admin | **trung** | 2 | HIGH | daytime |
| 15 | waf-athena | **trung** | 2 | LOW | daytime |
| 16 | s3-maintenance | shuku | — | LOW | daytime |
| 17 | elasticache | **trung** | 10 | CRITICAL | maint (Sun 23:30) · DOWNTIME ~15-20m |
| 18 | redshift | **trung** | — | CRITICAL | maint (Mon 00:00) · DOWNTIME ~30-60m |
| 19 | aurora | **trung** | 10 (mysql-sg) | CRITICAL | maint (Sun 23:00) |
| 20 | aurora validate_password | **trung** | 19 | MED | maint (chained to 19) |
| 21 | eks (auth-mode bridge) | **trung** | **import `point-cd-runner-role` first** (see ⚠) | CRITICAL | maint · ⚠ G2,G3 · 2 stages · ⚠ RE-ARRANGED 2026-06-12: merged with the v21/Stage-1 step, runs BEFORE the version ladder (Stage 2 branch `eks/1.31-api` `468f10f`; `release/verup` HEAD already pins `API` `cfe1c56c`) |
| 22 | eks (1.31→1.32) | shuku | 21 | CRITICAL | weeknight 23:00 · ⚠ G1 |
| 23 | eks (1.32→1.33) | shuku | 22 | CRITICAL | weeknight 23:00 |
| 24 | eks (1.33→1.34) | shuku | 23 | CRITICAL | weeknight 23:00 |
| 25 | k8s-manifests (api/admin/app/worker/mmh) | shuku-trung | 24 | MED (HIGH mmh) | daytime |
| 26 | s3-chart-snapshot | shuku | 2, irsa(24) | LOW | daytime |
| 27 | s3-csv-export | shuku | 2, irsa(24) | LOW | daytime |
| 28 | s3-csv-export-admin | shuku | 2, irsa(24) | LOW | daytime |
| 29 | s3-kyc | shuku | 2, irsa(24) | MED | daytime |
| 30 | s3-year-report | shuku | 2, irsa(24) | MED | daytime · import first |
| 31 | ec2-bastion | shuku | 1,10,24 | LOW | daytime |
| 32 | ec2-cd-runner | **trung** | 1,10,24 | MED | daytime · creates point-cd-runner-role (G3) |
| 33 | ec2-proxy | shuku | 31 | LOW | daytime |
| 34 | ec2-data-transfer | shuku | 10,24 | LOW | daytime |
| 35 | cloudwatch_metrics | shuku | 24,25 | LOW | daytime |
| 36 | cloudwatch_alarm | shuku | 35 | LOW | daytime |
| 37 | frontend-admin | **trung** | 10 | CRITICAL | daytime · ⚠ G6 cert |
| 38 | frontend-customer | **trung** | 10,24 | HIGH | daytime · co-time origin flip w/ #10 |
| 39 | waf-customer | **trung** | 2,38 | CRITICAL | maint (Sun 22:00, deferred tail) · ⚠ G5 |

**Verify-only / no-op rows** (run a fresh `terraform plan`; skip apply if still 0/0/0): `infra/tf-backend`, `cloudwatch_loggroup`, `cloudwatch_to_s3`, `waf-admin-private`, `cloudwatch_errorlog_lambda`, ~~`waf-maintenance-lambda`~~ **(⚠ §Round-3 / R3-WAFMLAMBDA-01: `waf-maintenance-lambda` is NO LONGER verify-only — fresh plan `+0/~9/-0` split-brand code; apply as NEW row #39b after waf-customer #39)**.
**Out of scope**: `ec2-hulft` (stg-only).

### Removed / changed vs v8
- **Dropped `eks 1.30→1.31`** — live cluster is already v1.31. Remaining ladder = auth-bridge + 1.31→1.32→1.33→1.34 (3 hops).
- **Removed `endpoints (re-apply)`** — fresh plan proved endpoints has no IAM data-source lookups; the 6 not-yet-created roles cause zero apply errors; the policies activate as roles land. The second apply was busy-work.
- **Deduped `waf-customer`** to a single deferred-tail row (Confluence listed it at #13 AND #39). See Gate G5 for the unresolved branch decision.
- **aurora**: killed the greenfield/`DBClusterNotFoundFault` after-check (cluster exists + in state); bootstrap is via `terraform/tool/db-user-manager/*.sh` (no `sql/bootstrap-users.sql`).
- **redshift**: re-scoped — `encrypted` is already `true`; the disable→enable dance is for the AWS-managed→CMK KMS swap, plus an explicit `reboot-cluster` is required for `require_ssl` (static param).
- **All wrong-account hardcoded IDs replaced** with target-account values or tag/name lookups.

---

## Per-row CONSOLE-FIRST verification cards (trung-assigned rows)

> Each card: **Manual** (corrected apply steps) · **After-check ① Console** (PRIMARY click-path) · **After-check ② CLI** (read-only fallback, account-guarded) · **Issues fixed vs v8**. Cards below are generated verbatim from the per-component evidence agents (2026-05-29). shuku-assigned rows use the canonical table above + the standard `terraform plan/apply` + console check for their service.


---

### Row #0 — `init/acm`  (cert creation DISABLED — CloudFront cert is import-only)

Row #0 — init/acm (LOW; **NOT a `terraform apply` step**). init/acm Terraform cert creation is **DISABLED** in dev — `init/acm/tfvars/dev.tfvars` has `enable_certificate_for_cloudfront = false` + `enable_certificate_for_alb = false` (commit `7cd80a95`) → it creates nothing. The CloudFront cert for `frontend-admin` (Row #37 / G6) is supplied **by manual import**, not by Terraform.

**Why import-only (and do NOT enable init/acm)**:
- `frontend-admin`'s `module-for-cloudfront/data.tf` filters `domain = var.cloudfront_certificate` (= `*.backseat-service.com`) + `statuses=["ISSUED"]` + `types=["IMPORTED"]`. An **IMPORTED** cert is the natural fit → **no `data.tf` change is needed**.
- Enabling init/acm would create an **AMAZON_ISSUED** (DNS-validated) cert, which that `types=["IMPORTED"]` data source could **not** consume — so it would be wasted. That same mismatch is why the AMAZON_ISSUED `cb4bfaf0` is being cleaned up below.

**Manual (operator — AWS console/CLI, NOT Terraform)**:
1. **Import** an ISSUED cert covering `*.dev.backseat-service.com` (covers the level-3 alias `bo.dev.backseat-service.com`) into **us-east-1** (`aws acm import-certificate`), then set `frontend-admin`'s `cloudfront_certificate` to it (the G6 / PRE-FLIGHT #3 step — the level-3 coverage gate still applies).
2. **Clean up** the stale us-east-1 certs so only valid IMPORTED remain:
   - delete `cb4bfaf0` — `dev.backseat-service.com`, **AMAZON_ISSUED**, **EXPIRED**
   - delete `2f009235` — `*.backseat-service.com`, IMPORTED, **EXPIRED**
   - **keep `07c7a840`** — `*.backseat-service.com`, **ISSUED**, IMPORTED (`frontend-customer` uses it)
   - ⚠ ACM refuses to delete a cert attached to a live CloudFront distribution → verify-not-in-use first. Deleting `cb4bfaf0` is **plan-neutral** for `frontend-admin` (it never matched the `domain=*.backseat-service.com` + IMPORTED filter).

**After-check ② CLI** (account-guarded, read-only):
```bash
aws sts get-caller-identity --profile point-operator-dev --query Account --output text   # MUST print 905418018638
aws acm list-certificates --profile point-operator-dev --region us-east-1 \
  --query "CertificateSummaryList[].[DomainName,Status,Type]" --output text
# expect: only IMPORTED certs — 07c7a840 (*.backseat-service.com, ISSUED) + the imported *.dev.backseat-service.com (ISSUED); the two EXPIRED gone.
```

**Do NOT** enable `enable_certificate_for_cloudfront` / `enable_certificate_for_alb` in `init/acm` (Terraform-managed AMAZON_ISSUED certs are not the chosen strategy). `for_alb` would also not help the ap-northeast-1 ALB cert gap (G11) — its level-3 cert can't satisfy the ingress's level-2 `*.backseat-service.com` auto-discovery (still a manual PEM import).

**Issues fixed vs v8**: N/A — new row.

### Row #0b — `init/eip`  (NEW — verify-only bootstrap; hard prereq of vpc #8)

Row #0b — init/eip (LOW; **VERIFY-ONLY in dev — already applied; hard prerequisite of `vpc` #8**). `vpc` (#8) data-sources the NAT-gateway Elastic IPs by name (`vpc/data.tf` `data.aws_eip.nat1/2/3` ← `var.nat_eip_name1/2/3` = `point-nat-apne1-az1 / -az2 / -az4`) and feeds them into `external_nat_ip_ids`, so they must exist before `vpc` plans.

**Live + state evidence (2026-06-09, account 905418018638):**
- `dev/eip.tfstate` (bucket `tfstate.bs-point-dev`, serial 1, tf 1.9.7) manages exactly **one** resource — `aws_eip.nat1` = `eipalloc-0ff90c1a7eb7da6f6` / `18.179.98.160` / Name `point-nat-apne1-az1`.
- Live `describe-addresses` confirms that EIP exists and is associated to a NAT-GW ENI. State == live → no drift.
- dev `single_nat_gateway = true` ⇒ only `nat1` is in scope (the `nat2`/`nat3` `count` is 0 in dev), consistent with the 1-resource state.

**Manual**:
1. `cd terraform/init/eip && ../../terraform.sh --env dev plan` → **expect `0 add / 0 change / 0 destroy`. Skip apply.**
2. ⚠ **If the plan shows `+ aws_eip.nat1` (create) instead of 0/0/0 → STOP, do NOT apply.** Allocating a second EIP with the same `point-nat-apne1-az1` Name tag makes `vpc`'s by-name `data.aws_eip.nat1` lookup ambiguous (`multiple EIPs matched`). Recover by importing the existing allocation: `../../terraform.sh --env dev import aws_eip.nat1 eipalloc-0ff90c1a7eb7da6f6`, then re-plan to 0/0/0.

**After-check ② CLI** (account-guarded, read-only):
```bash
aws sts get-caller-identity --profile point-operator-dev --query Account --output text   # 905418018638
aws ec2 describe-addresses --profile point-operator-dev --region ap-northeast-1 \
  --filters Name=tag:Name,Values=point-nat-apne1-az1 \
  --query "Addresses[].[AllocationId,PublicIp,NetworkInterfaceId]" --output text
# expect: eipalloc-0ff90c1a7eb7da6f6  18.179.98.160  <nat-gw-eni>
```

**STG note (out of this dev checklist's scope)**: stg `single_nat_gateway = false` (fixed by commit `d0625eca` on `release/verup`) → init/eip manages 3 EIPs (nat1/2/3) to match `vpc/stg`. That belongs to the STG apply sequence, not this dev order.

**Issues fixed vs v8**: N/A — new row. `init/eip` was never tracked as an apply step in any prior apply-order doc.

### Row #2 — `infra/audit`  ⚠ v8 inaccurate

**Intent**: Apply the audit/governance stack (CloudTrail, AWS Config recorders, GuardDuty, SecurityHub, SSM logging, and 5 audit S3 buckets) in point dev 905418018638; on this run it creates the new s3-access-logs bucket, imports the existing aws-waf-logs bucket, swaps both Config recorders to the cross-account aggregator role, and destroys the now-orphaned local bs-aws-config-role.

**Manual (corrected apply steps)**:

PREREQ (gated, operator must confirm BEFORE apply — the one real blocker): both Config recorders flip role_arn to the cross-account aggregator role arn:aws:iam::211125716602:role/cm-config-role-all-regions (point prd 211125716602), and the apply DESTROYS the local arn:aws:iam::905418018638:role/bs-aws-config-role + its policy attachment. Confirm with the account owner that (a) cm-config-role-all-regions EXISTS in 211125716602, and (b) its trust policy allows config.amazonaws.com in 905418018638 to assume it. This cannot be verified from the dev profile (no access to 211125716602). If the recorder update is rejected, Config recording can break and the rollback (re-create bs-aws-config-role) is non-trivial.

APPLY STEPS (corrected):
1. git: cd bs-point-infra && git checkout release/verup && git pull --ff-only (audit dir on release/verup is byte-identical to the planned checkout — delta below is valid).
2. Account guard: aws sts get-caller-identity --profile point-operator-dev  -> 905418018638.
3. cd terraform/infra/audit. Do NOT edit dev.tfvars: s3-waf-logging_lock_enabled=true and s3-waf-logging_lock_retention_days=30 (Foundation Gate A) are ALREADY set; the v8 'edit dev.tfvars to set...' step is stale — skip it.
4. ../../terraform.sh --env dev init (if .terraform missing).
5. ../../terraform.sh --env dev plan  -> expect EXACTLY: 5 to import, 6 to add, 5 to change, 2 to destroy. (The v8 'currently plan_failed' note is STALE — plan succeeds. NB: R3-AUDIT-01 renders this same plan as `+11/~5/-2` where +11 = 5 import + 6 add — do NOT false-STOP if the summary line reads "11 to add".) Breakdown: IMPORT = the 5 existing aws-waf-logs-bs-point-dev resources via imports.tf (bucket, acl, lifecycle, object-lock, public-access-block) — these are import{} blocks resolved during apply, NOT manual `terraform import`, and NOT a REPLACE; the v8 'confirm aws-waf-logs NOT in REPLACE schedule' wording is satisfied automatically. ADD(6) = new s3-access-logs.bs-point-dev (bucket+lifecycle+ownership+policy+public-access = 5) + waf-logs versioning. CHANGE(5) = cloudtrail log group in-place, waf-logs lifecycle (+athena-results-cleanup), /aws/ssm retention 30->90, both Config recorders role_arn swap. DESTROY(2) = bs-aws-config-role + its policy attachment.
6. STOP if plan deviates from 5/6/5/2 or shows any S3 bucket DESTROY (the 4 pre-existing buckets audit-logs / audit-logs-receiver / config / aws-waf-logs are already in state and must NOT be destroyed).
7. ../../terraform.sh --env dev apply.
8. Run the Console PRIMARY after-checks (esp. #3: confirm Config Recording is still ON in BOTH ap-northeast-1 and us-east-1 with the cross-account role).
NOTE on dependencies/downstream: this component is the prereq for waf-admin, waf-athena, waf-customer and the 5 S3-app components. No app coordination or maintenance window needed for audit itself (no downtime).

**Scope option — apply only the release/verup-delta now, defer the Config drift (RECOMMENDED until G7/Gate 1 clears):**
The `-2 destroy` (`bs-aws-config-role` + attachment) and the `~2` recorder `role_arn` switch are **point-native drift, NOT a release/verup change** (`config/iam.tf` + `config/main.tf` are byte-identical in `main` and `release/verup`; the live role exists only from an old point apply and is `RoleLastUsed = 2026-06-08`, still the sole working Config credential). To create the downstream prereq WITHOUT touching live Config recording:
1. **VERIFIED targeted plan (config excluded, 2026-06-09 @ `d0625eca`, session `…__infra-audit-no-config-ta__07426f5c`, evidence `../../plans/dev/infra/audit-no-config/`):** planning the 9 verup-delta modules (everything EXCEPT `module.config`) yields **`+11 / ~3 / -0` (+5 import) — 0 destroy, NO `211125716602` reference, risk MED** (contrast the full audit plan `+11/~5/-2` HIGH — the `-2 destroy` + the 2 recorder `role_arn` switches are fully isolated to `module.config`). Terraform v1.9.7 has no `-exclude`, so list all 9 module targets explicitly + the moved-from root address `aws_guardduty_detector.this` (required by the GuardDuty `moved` block added in `c9a491a3` — omitting it fails with `Moved resource instances excluded by targeting`):
   ```
   ../../terraform.sh --env dev plan \
     -target=module.s3-audit-logs -target=module.s3-audit-logs-receiver -target=module.s3-config \
     -target=module.cloudtrail -target=module.guardduty -target=module.securityhub -target=module.ssm \
     -target=module.s3-access-logs -target=module.s3-waf-logging -target=aws_guardduty_detector.this
   ```
   Re-run with `apply` (same target set) once the plan is verified. At minimum `-target=module.s3-access-logs` creates `s3-access-logs.bs-point-dev` (the hard prereq for waf-admin/athena/customer + the 5 S3-app rows). `module.config` is NOT targeted → recorders keep the live local role and `bs-aws-config-role` is NOT destroyed.
2. After-check (Console/CLI): Config recording still ON in BOTH ap-northeast-1 + us-east-1 on `bs-aws-config-role` (unchanged).
3. AFTER G7/Gate 1 clears, the `module.config` end-state is an **OPEN engineer decision — do not auto-settle on the cross-account model.** Two options, both currently blocked on the same unverified fact (does the `211125716602` role trust `config.amazonaws.com` for `905418018638`? — AWS Config recorder roles are effectively same-account, so this is not guaranteed):
   - **Option B (converge to `211`):** once the `211` role trust is verified live from a profile with access to that account, run the FULL `../../terraform.sh --env dev apply` (no `-target`) to converge `module.config`, then re-check both recorders `recording=SUCCESS` on the new cross-account role (Opus Gate 3).
   - **Option A (reconcile to same-account local role):** un-comment `config/iam.tf` + set the recorder `iam_role_arn = aws_iam_role.this.arn` + `terraform import` the live `bs-aws-config-role` — this eliminates BOTH the `-2 destroy` and the role switch, keeping Config on a same-account role.
   Decide per the full code-vs-live analysis: `../../verup-to-point/audit-config-drift-analysis.md §5` (re-confirmed by the 2026-06-09 standalone re-plan @ `d0625eca`).
Run the full single-shot apply (no split) ONLY if Gate 1 is already cleared.

**After-check ① CONSOLE (primary)**:

PRIMARY after-check (AWS Console, signed in as IAM user bs-developer in account 905418018638, region ap-northeast-1 unless noted):

1) NEW access-logs bucket created — Console → S3 → Buckets → select "s3-access-logs.bs-point-dev" (did NOT exist before this apply). 
   - Management tab → Lifecycle rules → rule "expire-access-logs" = Enabled, Expiration = 90 days (applies to all objects).
   - Permissions tab → "Block public access (bucket settings)" = all 4 ON. 
   - Permissions tab → Object Ownership = "Bucket owner enforced (ACLs disabled)".
   - Permissions tab → Bucket policy → statement Sid "AllowS3ServerAccessLogging" granting s3:PutObject to service principal logging.s3.amazonaws.com.

2) WAF-logs bucket imported + hardened — Console → S3 → Buckets → select "aws-waf-logs-bs-point-dev".
   - Properties tab → Object Lock = Enabled, default retention mode = Compliance, retention = 30 days (Foundation Gate A).
   - Properties tab → Bucket Versioning = Enabled.
   - Management tab → Lifecycle rules → now contains rule "athena-results-cleanup" (prefix athena-results/, Expiration 7 days) in addition to the existing noncurrent-version rule (30 days).

3) Config recorder role swap landed WITHOUT breaking recording (this is the highest-risk change) — Console → AWS Config → Settings (recorder name "default").
   - "Recording is on" (status still ENABLED — confirm Config did NOT stop).
   - IAM role used by Config now shows "cm-config-role-all-regions" with ARN arn:aws:iam::211125716602:role/cm-config-role-all-regions (was arn:aws:iam::905418018638:role/bs-aws-config-role).
   - Repeat in region us-east-1 (top-right region switcher → N. Virginia) → AWS Config → Settings: same recorder "default", same cross-account role, Recording on.

4) Local Config role destroyed — Console → IAM → Roles → search "bs-aws-config-role" → expect NO results (the local role and its policy attachment were destroyed this apply).

5) SSM log retention bumped — Console → CloudWatch → Log groups → "/aws/ssm" → Retention = 90 days (was 30).

6) Unchanged governance services still healthy — Console → GuardDuty → Settings shows detector enabled (detector 66c92b03e51d67d20a54fd6245b8e91d); Console → Security Hub shows the account hub enabled; Console → CloudTrail → Trails shows "management-events" Logging = On. (No change expected for these — confirm they were not disrupted.)

**After-check ② CLI (read-only fallback)**:

```bash
SECONDARY (read-only CLI fallback; real IDs resolved; account-guarded). Profile point-operator-dev, region ap-northeast-1 (item 3b in us-east-1):

# 0) Account guard (MANDATORY)
aws sts get-caller-identity --profile point-operator-dev --query Account --output text   # expect 905418018638

# 1) new access-logs bucket exists + hardened
aws s3api head-bucket --bucket s3-access-logs.bs-point-dev --profile point-operator-dev   # expect exit 0 (was 404 pre-apply)
aws s3api get-bucket-lifecycle-configuration --bucket s3-access-logs.bs-point-dev --profile point-operator-dev --query "Rules[?ID=='expire-access-logs'].[Status,Expiration.Days]" --output text   # expect: Enabled  90
aws s3api get-public-access-block --bucket s3-access-logs.bs-point-dev --profile point-operator-dev --query PublicAccessBlockConfiguration --output json   # expect all 4 true
aws s3api get-bucket-policy --bucket s3-access-logs.bs-point-dev --profile point-operator-dev --query Policy --output text   # expect Sid AllowS3ServerAccessLogging, Principal logging.s3.amazonaws.com

# 2) waf-logs bucket object-lock + versioning + lifecycle
aws s3api get-object-lock-configuration --bucket aws-waf-logs-bs-point-dev --profile point-operator-dev --query "ObjectLockConfiguration.Rule.DefaultRetention.[Mode,Days]" --output text   # expect: COMPLIANCE  30
aws s3api get-bucket-versioning --bucket aws-waf-logs-bs-point-dev --profile point-operator-dev --query Status --output text   # expect: Enabled
aws s3api get-bucket-lifecycle-configuration --bucket aws-waf-logs-bs-point-dev --profile point-operator-dev --query "Rules[].ID" --output text   # expect to include athena-results-cleanup

# 3a) Config recorder role + still recording (ap-northeast-1)
aws configservice describe-configuration-recorders --profile point-operator-dev --region ap-northeast-1 --query "ConfigurationRecorders[0].roleARN" --output text   # expect arn:aws:iam::211125716602:role/cm-config-role-all-regions
aws configservice describe-configuration-recorder-status --profile point-operator-dev --region ap-northeast-1 --query "ConfigurationRecordersStatus[0].recording" --output text   # expect true
# 3b) same in us-east-1
aws configservice describe-configuration-recorders --profile point-operator-dev --region us-east-1 --query "ConfigurationRecorders[0].roleARN" --output text   # expect arn:aws:iam::211125716602:role/cm-config-role-all-regions

# 4) local config role gone
aws iam get-role --role-name bs-aws-config-role --profile point-operator-dev 2>&1 | grep -q NoSuchEntity && echo DESTROYED-OK   # pre-apply it existed: arn:aws:iam::905418018638:role/bs-aws-config-role

# 5) SSM log retention
aws logs describe-log-groups --log-group-name-prefix /aws/ssm --profile point-operator-dev --region ap-northeast-1 --query "logGroups[?logGroupName=='/aws/ssm'].retentionInDays" --output text   # expect 90

# 6) untouched services healthy
aws guardduty list-detectors --profile point-operator-dev --region ap-northeast-1 --query "DetectorIds[0]" --output text   # expect 66c92b03e51d67d20a54fd6245b8e91d
aws cloudtrail get-trail-status --name management-events --profile point-operator-dev --region ap-northeast-1 --query IsLogging --output text   # expect True
```

**Read-only safe**: true · **Account-guarded**: true

**Issues fixed vs v8**:
- APPLY-GATED (cross-account role): both Config recorders (ap-northeast-1 + us-east-1) change role_arn from arn:aws:iam::905418018638:role/bs-aws-config-role to arn:aws:iam::211125716602:role/cm-config-role-all-regions, a role in point prd 211125716602 that CANNOT be verified from the dev profile. An AWS Config configuration recorder's service role normally must be in the same account; if 211125716602's cm-config-role-all-regions does not exist or its trust policy does not allow config.amazonaws.com in 905418018638, the recorder update is rejected and Config recording can break. Operator MUST confirm role existence + trust before apply.
- DESTRUCTIVE (governance role removal): the apply destroys aws_iam_role.this (bs-aws-config-role, currently arn:aws:iam::905418018638:role/bs-aws-config-role and in active use by both live recorders) plus its policy attachment. Terraform should update the recorders to the new role before destroying the old one, but if the recorder update fails (see above), Config could be left without a usable role. Rollback requires re-creating bs-aws-config-role.
- STALE v8 row content: (a) manual step to edit dev.tfvars for lock_enabled/lock_retention_days is unnecessary — already true/30 in tfvars; (b) 'currently plan_failed' is wrong — fresh plan succeeds (5 import/6 add/5 change/2 destroy); (c) after-check 'get-bucket-policy aws-waf-logs-bs-point-dev returns policy unchanged' is invalid — the s3-waf-logging module manages no bucket policy. These will mislead the operator if not corrected.
- After-check target correction: the only NEW S3 bucket this apply creates is s3-access-logs.bs-point-dev (confirmed 404 pre-apply). The v8 after-check correctly targets get-bucket-policy on it, but must also verify lifecycle (90d), public-access-block (4x true), and ownership=BucketOwnerEnforced. The aws-waf-logs after-check must shift to object-lock (COMPLIANCE 30d) + versioning Enabled + lifecycle athena-results-cleanup.


---

### Row #7 — `notification`  ⚠ v8 inaccurate

**Intent**: Port verup-canonical snapshot event subscriptions to point-dev: adds 1 Aurora db-cluster-snapshot subscription + 1 Redshift cluster-snapshot subscription, both routing to the alert-lambda-infra SNS topic; pre-existing CloudWatch event rules + Aurora subscriptions refresh unchanged; the pre-existing `redshift-point` subscription is RE-POINTED from `alert-lambda-infra` to `alert-lambda-event-notification` by this apply (expected in-place MODIFY of its `sns_topic_arn` — live-verified 2026-06-08).

**Manual (corrected apply steps)**:

Pre-apply gates (all confirmed satisfied during the 2026-05-07 plan refresh, re-confirm on a fresh plan):
- SNS topic 'alert-lambda-infra' exists in 905418018638 (resolved during plan refresh) -> the snapshot subscriptions need it as sink. Also 'alert-lambda-event-notification' must exist: this apply re-points the pre-existing `redshift-point` subscription to it (it currently routes to `alert-lambda-infra`, live-verified 2026-06-08), so the topic is a hard prerequisite — created by the `event-notification` component (see G13 / R3-NOTIF-01), NOT yet present in dev.
- Aurora cluster 'point' exists and is available (GROUND-TRUTH: cluster 'point' available + 'point-bk' available). data.aws_rds_cluster.this resolved id=point.
- Redshift cluster 'point' exists and is available (GROUND-TRUTH: cluster 'point' available, Encrypted:true). data.aws_redshift_cluster.this resolved id=point.

Apply steps:
1. cd bs-point-infra/terraform/components/notification
2. ../../terraform.sh --env dev init   (if .terraform.lock.hcl missing)
3. ../../terraform.sh --env dev plan    -> confirm '2 to add' (aws_db_event_subscription.cluster_snapshot = aurora-point-cluster-snapshot + aws_redshift_event_subscription.snapshot = redshift-point-snapshot) PLUS '1 to change' = the EXPECTED in-place re-point of aws_redshift_event_subscription.this (redshift-point) sns_topic_arn from alert-lambda-infra -> alert-lambda-event-notification; confirm '0 to destroy'. HALT only on an UNEXPECTED destroy/replace of the pre-existing CloudWatch rules or RDS/Redshift subscriptions. EXCEPTION: the in-place MODIFY of redshift-point's sns_topic_arn is EXPECTED (live-verified 2026-06-08) — do NOT HALT on it. (NB: this plan cannot run until alert-lambda-event-notification exists — see the prerequisite chain in the pre-apply gates above.)
4. ../../terraform.sh --env dev apply

No maintenance window, no downtime, no pod-scaling, no app-side coordination. Pure additive. Can run daytime. Order constraint: must run AFTER sns-alert (#5) so 'alert-lambda-infra' exists, AND after `event-notification` (Group C) so 'alert-lambda-event-notification' exists (the redshift-point re-point + redshift-point-snapshot both need it); the data sources require Aurora+Redshift clusters present (already true in dev).

**After-check ① CONSOLE (primary)**:

PRIMARY after-check verifies the 2 NEW resources the plan creates (NOT the stale "notification-aurora-events" EventBridge rule, which does not exist in this component).

(1) Aurora snapshot subscription (RDS):
Console (region ap-northeast-1, account 905418018638 as IAM user bs-developer) -> RDS -> left nav "Event subscriptions" -> select subscription "aurora-point-cluster-snapshot" -> verify: Source type = "DB cluster snapshots" (source_type=db-cluster-snapshot); Target (SNS topic) = "alert-lambda-infra"; Status = Active; Enabled = Yes. (Also pre-existing: "aurora-point-cluster", "aurora-point-instance" remain present/unchanged.)

(2) Redshift snapshot subscription:
Console -> Amazon Redshift -> left nav "Events" -> "Event subscriptions" tab -> select "redshift-point-snapshot" -> verify: Source type = "Cluster snapshot" (source_type=cluster-snapshot); Categories = Management, Monitoring; Severity = INFO; SNS topic = "alert-lambda-infra"; Status = Active. (Also pre-existing: "redshift-point" remains present/unchanged.)

(3) SNS sink sanity (the routing target):
Console -> Amazon SNS -> Topics -> "alert-lambda-infra" -> Subscriptions tab shows a Lambda subscription (Confirmed). This confirms the snapshot events have somewhere to land.

(4) Pre-existing CloudWatch rules (NOT created here, just confirm intact):
Console -> Amazon EventBridge -> Rules (event bus "default", region ap-northeast-1) -> the rules "notification-securityhub", "notification-certificate", "notification-ssm-StartSession", "notification-ecr-PutImage" are present and Enabled. These are the REAL rule names (there is no rule named "notification-aurora-events").

**After-check ② CLI (read-only fallback)**:

```bash
# Account guard FIRST
aws sts get-caller-identity --profile point-operator-dev   # expect Account=905418018638

# (1) Aurora snapshot subscription exists + routes to alert-lambda-infra
aws rds describe-event-subscriptions --profile point-operator-dev --region ap-northeast-1 --subscription-name aurora-point-cluster-snapshot --query 'EventSubscriptionsList[0].{name:CustSubscriptionId,src:SourceType,sns:SnsTopicArn,status:Status,enabled:Enabled}'
# expect: src=db-cluster-snapshot, sns=arn:aws:sns:ap-northeast-1:905418018638:alert-lambda-infra, status=active, enabled=true

# (2) Redshift snapshot subscription exists
aws redshift describe-event-subscriptions --profile point-operator-dev --region ap-northeast-1 --subscription-name redshift-point-snapshot --query 'EventSubscriptionsList[0].{name:CustSubscriptionId,src:SourceType,cats:EventCategoriesList,sev:Severity,sns:SnsTopicArn,status:Status}'
# expect: src=cluster-snapshot, cats=[management,monitoring], sev=INFO, sns=...:alert-lambda-infra, status=active

# (3) SNS sink target exists
aws sns get-topic-attributes --profile point-operator-dev --region ap-northeast-1 --topic-arn arn:aws:sns:ap-northeast-1:905418018638:alert-lambda-infra --query 'Attributes.TopicArn'

# (4) Pre-existing EventBridge rules intact (real names)
aws events list-rules --profile point-operator-dev --region ap-northeast-1 --query "Rules[?starts_with(Name,'notification-')].Name"
# expect: notification-securityhub, notification-certificate, notification-ssm-StartSession, notification-ecr-PutImage (NO notification-aurora-events)
```

**Read-only safe**: true · **Account-guarded**: true

**Issues fixed vs v8**:
- BLOCKING (correctness of after-check): The documented after-check 'EventBridge rule notification-aurora-events exists' (Confluence v62 #6 AND local v8 #10) is wrong on two counts — (1) no rule named notification-aurora-events exists in this component; the real rules are notification-securityhub/-certificate/-ssm-StartSession/-ecr-PutImage and they pre-exist (not created by this apply); (2) the apply creates 0 EventBridge rules and 2 event SUBSCRIPTIONS (RDS db-cluster-snapshot + Redshift cluster-snapshot). The after-check must verify aurora-point-cluster-snapshot (RDS Event subscriptions) and redshift-point-snapshot (Redshift event subscriptions), not an EventBridge rule.
- Pre-apply ordering gate not stated in v8 row: this row consumes the alert-lambda-infra SNS topic via data source. That topic is created by sns-alert (local v8 #8). notification MUST apply after sns-alert or the plan fails at refresh (data.aws_sns_topic.alert-lambda-infra would not resolve). Confluence note 'SNS topic-only; Aurora subscription at #21' is misleading framing.
- Both data clusters (Aurora 'point', Redshift 'point') are read-only data sources, not managed here — they already exist in dev (GROUND-TRUTH state-drift table), so the 'greenfield' concern that plagues the aurora/redshift rows does NOT apply to notification. No action needed, but do not copy aurora's stale 'DBClusterNotFoundFault' check here.
- CORRECTED (this APPLY HAS impact — was mislabeled "no apply impact"): the EXISTING redshift-point subscription CURRENTLY routes to alert-lambda-infra (live-verified 2026-06-08), and HEAD `notification/redshift.tf:3` re-points it to alert-lambda-event-notification -> the apply performs an in-place MODIFY of `aws_redshift_event_subscription.this`. The NEW redshift-point-snapshot routes to alert-lambda-infra. So BOTH topics must exist, and alert-lambda-event-notification (absent in dev) is a hard prerequisite for redshift-point too — not just the snapshot subs. Exempt the redshift-point sink MODIFY from the plan-step HALT (see step 3).


---

### Row #8 — `vpc`  ⚠ v8 inaccurate

**Intent**: Apply the standalone NACL adoption for VPC point (vpc-0f49bf7456fa50d08): creates 1 dedicated public NACL + 1 dedicated private NACL + 6 subnet associations + 14 NACL rules, and migrates the existing default NACL (acl-039dac97f13fa7e3c) from module-managed count to a standalone aws_default_network_acl resource. Fresh plan = +21 / ~0 / -1; the single destroy is a Terraform state-record migration (AWS NACL object is NOT deleted). VPC/subnets/IGW/NAT all pre-exist and are untouched.

**Manual (corrected apply steps)**:

PRE-APPLY GATES (from fresh eval 2026-05-29, plan +21/~0/-1, NO drift vs 2026-05-07):
1. Account guard: aws sts get-caller-identity --profile point-operator-dev MUST return 905418018638.
2. ✅ SUPERSEDED (re-assessed 2026-06-10 vs nacl.tf @ d0625eca + live) — bastion-apply is OK. The old gate assumed a public-subnet SSH bastion; the actual point-bastion (i-03a7a4aeec795d170) is in PRIVATE subnet subnet-0743df36e105ab5cc (172.18.21.0/24, no public IP, SSM-accessed), and the code has NO transient window: NACL rules land before any subnet association (depends_on), the swap is atomic, the new private NACL allows all intra-VPC + ephemeral (= the SSM path), and the default NACL flips deny-all LAST. ❌ NOT OK only if the re-plan deviates from +21/~0/-1 (new NACL/subnet/route destroys) → then run from laptop/CI with break-glass. (The BB-1562 STG SSH-lockout incident predates this setup and does not apply to the SSM path.)
3. Verify office SSH CIDRs current: tfvars office_access_cidrs = [104.30.164.185/32, 104.30.177.101/32] — these become public-NACL inbound rules 120/121. Confirm still valid before apply.
4. Confirm module NACL state record present: from terraform/components/vpc run terraform state list | grep default_network_acl — must show module.vpc.aws_default_network_acl.this[0]. If absent, re-plan (the 1 destroy behavior will differ).
5. No active bastion SSH sessions to public-subnet hosts during apply.

APPLY: cd terraform/components/vpc && ../../terraform.sh --env dev plan (confirm exactly +21 ~0 -1; the 1 destroy is module.vpc.aws_default_network_acl.this[0] / acl-039dac97f13fa7e3c — a STATE migration, the AWS NACL is re-adopted by aws_default_network_acl.default, NOT deleted) && ../../terraform.sh --env dev apply.

POST-APPLY: run the Console-primary NACL checks above (3 NACLs, rules, 6 associations). No bootstrap / no re-apply step needed for vpc.

**After-check ① CONSOLE (primary)**:

PRIMARY = AWS Console click-paths (account 905418018638 / point dev, IAM user bs-developer, region ap-northeast-1).

A) VPC topology unchanged (sanity — these must still exist and be untouched):
1. Console → VPC → Your VPCs → select "point" (vpc-0f49bf7456fa50d08) → Details → State = Available; IPv4 CIDR = 172.18.0.0/16.
2. Console → VPC → Internet gateways → igw-029a72e3cc300249f → State = Attached (to vpc-0f49bf7456fa50d08).
3. Console → VPC → NAT gateways → nat-0a54b505d27c22527 → State = Available (single NAT in dev).
4. Console → VPC → Subnets → filter by VPC = vpc-0f49bf7456fa50d08 → confirm all 6 present with "Available IPv4 addresses" ≥ 7 each (live ~223-249 free per subnet at 2026-06-08 — well above the 7 minimum, so passes Confluence Risk #1 comfortably; note free-IP counts are dynamic, the ≥7 conclusion is what matters):
   public: subnet-06c22e5d585523494 (172.18.11.0/24), subnet-034a76e5a1013f933 (172.18.12.0/24), subnet-0d1a35fe4f2b2278d (172.18.14.0/24);
   private: subnet-0743df36e105ab5cc (172.18.21.0/24), subnet-096db15e5e8372518 (172.18.22.0/24), subnet-00722216df32a8e26 (172.18.24.0/24).

B) THE ACTUAL DELTA — Network ACLs (this is what the apply changes; the existing row #11 after-check MISSES this entirely):
5. Console → VPC → Network ACLs → filter "VPC = vpc-0f49bf7456fa50d08" → expect 3 NACLs total:
   (i) the default NACL acl-039dac97f13fa7e3c (now tagged/owned as standalone aws_default_network_acl.default — Console will still show it as the VPC default; confirm it is NOT deleted and still associated where the module left it);
   (ii) a new dedicated PUBLIC NACL — Inbound rules tab shows: rule 100 ALLOW TCP 443 from 0.0.0.0/0; rule 110 ALLOW TCP 80 from 0.0.0.0/0; rule 120 ALLOW TCP 22 from 104.30.164.185/32; rule 121 ALLOW TCP 22 from 104.30.177.101/32; rule 200 ALLOW ALL from 172.18.0.0/16; rule 300 ALLOW TCP 1024-65535; rule 310 ALLOW UDP 1024-65535. Outbound: rule 100 ALLOW ALL to 0.0.0.0/0. Subnet associations tab = the 3 public subnets above.
   (iii) a new dedicated PRIVATE NACL — Inbound: rule 100 ALLOW ALL from 172.18.0.0/16; rule 200 ALLOW TCP 1024-65535; rule 210 ALLOW UDP 1024-65535. Outbound: rule 100 ALLOW ALL to 0.0.0.0/0. Subnet associations tab = the 3 private subnets above.
6. Console → VPC → Subnets → for each of the 6 subnets → Network ACL field on the detail pane shows the new public/private NACL (not the old default) for that subnet — confirms the 6 associations landed.
NOTE: there is NO VPC peering NACL rule in dev (peer_enabled=false in tfvars) — do not look for peer rules.

**After-check ② CLI (read-only fallback)**:

```bash
SECONDARY (read-only, account-guarded — resolved IDs, no placeholders):
aws sts get-caller-identity --profile point-operator-dev   # MUST return Account 905418018638 before anything

# VPC/IGW/NAT still available
aws ec2 describe-vpcs --profile point-operator-dev --region ap-northeast-1 --vpc-ids vpc-0f49bf7456fa50d08 --query 'Vpcs[0].State'
aws ec2 describe-internet-gateways --profile point-operator-dev --region ap-northeast-1 --internet-gateway-ids igw-029a72e3cc300249f --query 'InternetGateways[0].Attachments[0].State'
aws ec2 describe-nat-gateways --profile point-operator-dev --region ap-northeast-1 --nat-gateway-ids nat-0a54b505d27c22527 --query 'NatGateways[0].State'

# >=7 free IPs per subnet (Confluence Risk #1)
aws ec2 describe-subnets --profile point-operator-dev --region ap-northeast-1 --filters Name=vpc-id,Values=vpc-0f49bf7456fa50d08 --query 'Subnets[].{Subnet:SubnetId,Free:AvailableIpAddressCount}' --output table

# THE ACTUAL DELTA — expect 3 NACLs; default acl-039dac97f13fa7e3c must still be present (not deleted)
aws ec2 describe-network-acls --profile point-operator-dev --region ap-northeast-1 --filters Name=vpc-id,Values=vpc-0f49bf7456fa50d08 --query 'NetworkAcls[].{Id:NetworkAclId,Default:IsDefault,Assoc:length(Associations),Entries:length(Entries)}' --output table
aws ec2 describe-network-acls --profile point-operator-dev --region ap-northeast-1 --network-acl-ids acl-039dac97f13fa7e3c --query 'NetworkAcls[0].NetworkAclId'   # confirms default NACL NOT deleted
```

**Read-only safe**: true · **Account-guarded**: true

**Issues fixed vs v8**:
- WRONG-ACCOUNT IDs (apply-blocking for the after-check, not the apply): row #11 hardcodes vpc-0e139c5a0789db4c0 / igw-01e61f53a0a31f519 / nat-00352c4048b1c9674 — all from legacy-dev 845131030484. These do NOT exist in target 905418018638; the after-check FAILS as written. Replace with vpc-0f49bf7456fa50d08 / igw-029a72e3cc300249f / nat-0a54b505d27c22527, or (better) use tag/name-based lookups.
- WRONG VERIFICATION TARGET: the row #11 after-check validates VPC/subnet/IGW/NAT availability — but this apply does NOT touch any of those. The real delta is 3 NACLs + 6 subnet associations + 14 NACL rules. A green VPC/subnet/IGW/NAT check is a false-positive; the after-check must instead confirm the 2 new dedicated NACLs (public rules 100/110/120/121/200/300/310, private rules 100/200/210), their 6 subnet associations, and that default NACL acl-039dac97f13fa7e3c was NOT deleted.
- BASTION LOCKOUT — ✅ SUPERSEDED (re-assessed 2026-06-10): bastion-apply is OK. The claim assumed a public-subnet SSH bastion and a "transient window"; the live point-bastion is private/SSM (subnet-0743df36e105ab5cc, 172.18.21.0/24, no public IP) and nacl.tf has no window by construction (rules before association, atomic swap, private NACL = intra-VPC + ephemeral = the SSM path, default-deny last). The BB-1562 STG SSH incident predates this setup. The enforced gate is now the re-plan/diff: ❌ do NOT apply from inside if the plan deviates from +21/~0/-1.
- The '1 destroy' must be understood as a Terraform STATE migration (module.vpc.aws_default_network_acl.this[0] → aws_default_network_acl.default, same acl-039dac97f13fa7e3c). If an operator panics and aborts on seeing '1 to destroy', they break the run. Plan must be read as +21/~0/-1 = safe. Gate 4 (terraform state list | grep default_network_acl present) protects against a divergent destroy.
- Confluence v62 numbers this row #7 while local v8 numbers it #11 — reconcile to one canonical order before sharing (does not affect apply correctness, but cross-refs will mislead).


---

### Row #10 — `security_group`  ⚠ v8 inaccurate

**Intent**: Migrate the ALB frontend from HTTP:80/alb-sg to HTTPS:443/alb-https-sg (controller-driven SG swap), repoint EKS-worker/mysql ingress to the new SG and Aurora port 13306, add proxy/cd-runner SGs, and remove legacy CIDR allowlists — without triggering a DependencyViolation on the live ALB.

**Manual (corrected apply steps)**:

Row #10 — security_group (CRITICAL — largest connectivity blast radius; coupled to ingress cutover + Aurora port flip). ⚠ APPLY-BLOCKED until G14 is fixed (the 7 unpinned `terraform-aws-modules/security-group/aws` blocks make `terraform init` fail — fix applied in worktree `work-bs-point-rehearsal`, pending apply). (v8 numbered this row #13.) v8's manual steps are WRONG: v8 says 'edit ingress.yaml -> kubectl apply -> then terraform plan/apply' as a single pass, but alb-https-sg does NOT exist until THIS component's apply creates it (GROUND-TRUTH: 'alb-https-sg does NOT exist yet -> created by security_group apply'). A kubectl apply that references security-groups: alb-https-sg before it exists fails to reconcile (controller can't find the SG by name), the ALB stays on alb-sg, and the full apply then dies with DependencyViolation on the alb-sg destroy (3 live ALB ENIs). Terraform must run TWICE. Correct sequence:

PRE-STEP a (pods at 0 — global, NOT per-component): pods are scaled to 0 once at migration start and restored only after ALL components are applied — no capture/scale/restore steps inside this row. Just confirm `kubectl get pods -n default` returns 'No resources found' before proceeding (pod-path rule replaces — eks-worker 8080, mysql 13306 — then have zero impact).
PRE-STEP b (Aurora coupling — do NOT use sonnet's wrong 'verify Aurora already 13306' gate; live Aurora is STILL 3306): pods stay at 0 through this SG change and the Aurora 3306->13306 flip (both happen before the end-of-migration scale-up). Bastion DB sessions on 3306 break during the window — reconnect on 13306.

STEP 1 (terraform apply #1 — TARGETED, creates alb-https-sg): cd terraform/components/security_group && ../../terraform.sh --env dev init && ../../terraform.sh --env dev plan ; then targeted apply to create alb-https-sg + its ingress only: ../../terraform.sh --env dev apply -target=aws_security_group.alb_https -target=aws_security_group_rule.cloudfront_to_alb_https -target=aws_security_group_rule.old_bastion_to_alb (verify the wrapper passes -target through; if not, use a tfplan-targeted run). DO NOT run the full apply yet.
STEP 2 (controller-driven swap — NOT manual elbv2): kubectl apply -f bs-point-infra/k8s-manifests/point/dev/ingress.yaml -> aws-load-balancer-controller (v3.1.0) flips listener to HTTPS:443 and reassociates point-alb to alb-https-sg per annotations security-groups: alb-https-sg + listen-ports: [{"HTTPS":443}]. Do NOT use aws elbv2 set-security-groups as the primary mechanism (creates out-of-band drift the controller reconciles away; emergency fallback only).
STEP 3 (verify cutover): aws elbv2 describe-load-balancers ... point-alb SecurityGroups MUST no longer contain sg-005b8b9b2e2cb718e (Console: EC2 -> Load Balancers -> point-alb -> Security tab = alb-https-sg).
STEP 4 (terraform apply #2 — FULL): ../../terraform.sh --env dev apply -> destroys alb-sg + obsolete rules (now detached, no DependencyViolation), removes legacy Dalian/bastion CIDR allowlists, adds cd-runner-sg/proxy-sg + bastion egress rules + vpc-endpoints-sg port 587.
POST-STEP: none here — pods are restored once at end-of-migration (after ALL components are applied and the Aurora port is 13306), not per-component.

Fresh plan: +14 ~1 -14 (4 replace), ZERO drift vs 2026-05-07. port 8080 ALB->EKS is PRESERVED (rule index[3] repointed alb-sg->alb-https-sg; only the port-80 path index[4] is destroyed).

**After-check ① CONSOLE (primary)**:

PRIMARY after-check — AWS Console (sign in as IAM user bs-developer in account 905418018638, region ap-northeast-1):

1. THE definitive swap check — Console → EC2 → Load Balancers → select "point-alb" → Security tab → "Security groups" field = "alb-https-sg" (NOT sg-005b8b9b2e2cb718e / alb-sg). This is the field whose value clears the DependencyViolation; if it still shows alb-sg, the controller cutover did not happen and the full terraform apply will fail.

2. Console → EC2 → Load Balancers → point-alb → Listeners tab → exactly one listener "HTTPS : 443" present; no "HTTP : 80" listener remaining.

3. Console → EC2 → Network & Security → Security Groups → filter by name "alb-sg": search for sg-005b8b9b2e2cb718e returns NO result (destroyed). Then filter "alb-https-sg", "cd-runner-sg", "proxy-sg": all three exist (alb-https-sg is greenfield, resolve its new sg-id here after apply). Filter "eks-cluster-sg-point-106845584" (sg-0299063a444e39478), "mysql-sg" (sg-007ebd984a0ba881c), "redis-sg" (sg-00c758d79f960edd6), "redshift-sg" (sg-078d4587a562734bf): all still present.

4. Console → EC2 → Security Groups → select "eks-worker-sg" (sg-0fa392415cbbf5b23) → Inbound rules tab → a TCP 8080 rule with Source = alb-https-sg (the repointed rule, was alb-sg), and NO TCP 80 rule from any ALB SG remaining.

5. Console → EC2 → Security Groups → select "mysql-sg" (sg-007ebd984a0ba881c) → Inbound rules → MySQL ingress is on port 13306 (NOT 3306); the legacy CIDR allowlist rules (Dalian 45.78.58.128/32, bs-dev-ec2-k8s 3.115.64.50/32, bs-dev-ec2-bastion 57.181.130.9/32) on port 3306 are GONE.

6. Console → EC2 → Security Groups → select "vpc-endpoints-sg" (sg-0cfb59a0a9621aa8b) → Inbound rules → new TCP 587 (SMTP/SES) rule with Source 172.18.0.0/16 present alongside the 443 CIDR rule.

7. Console → EKS → Clusters → point → Resources → (or Networking) confirm pods restored: after scaling deployments back from 0, Console → EKS → point → Resources → Workloads shows the api/admin/app/worker/mmh deployments back at their captured replica counts (data-path SG changes only safe to verify with pods up AFTER Aurora port 13306 is in effect).

**After-check ② CLI (read-only fallback)**:

```bash
SECONDARY (read-only fallback, account-guarded):

# Account guard (run first; MUST return 905418018638)
aws sts get-caller-identity --profile point-operator-dev

# 1. ALB SecurityGroups swapped to alb-https-sg (the DependencyViolation-clearing check) — must NOT contain sg-005b8b9b2e2cb718e
aws elbv2 describe-load-balancers --profile point-operator-dev --region ap-northeast-1 --query "LoadBalancers[?LoadBalancerName=='point-alb'].SecurityGroups" --output json

# 2. Listener flipped to HTTPS:443, no HTTP:80
aws elbv2 describe-listeners --profile point-operator-dev --region ap-northeast-1 --load-balancer-arn arn:aws:elasticloadbalancing:ap-northeast-1:905418018638:loadbalancer/app/point-alb/0b046b6abb5dc34b --query "Listeners[].{Proto:Protocol,Port:Port}" --output table

# 3. alb-sg destroyed (expect empty), alb-https-sg created (capture new sg-id)
aws ec2 describe-security-groups --profile point-operator-dev --region ap-northeast-1 --filters Name=group-name,Values=alb-sg --query "SecurityGroups[].GroupId" --output json
aws ec2 describe-security-groups --profile point-operator-dev --region ap-northeast-1 --filters Name=group-name,Values=alb-https-sg --query "SecurityGroups[].GroupId" --output json

# 4. eks-worker-sg 8080 ingress repointed to alb-https-sg, no port 80
aws ec2 describe-security-group-rules --profile point-operator-dev --region ap-northeast-1 --filters Name=group-id,Values=sg-0fa392415cbbf5b23 --query "SecurityGroupRules[?!IsEgress && (FromPort==\`8080\` || FromPort==\`80\`)].{Id:SecurityGroupRuleId,From:FromPort,Src:ReferencedGroupInfo.GroupId}" --output table

# 5. mysql-sg on 13306, legacy CIDR rules removed (expect no 3306 / no 45.78.58.128/32)
aws ec2 describe-security-group-rules --profile point-operator-dev --region ap-northeast-1 --filters Name=group-id,Values=sg-007ebd984a0ba881c --query "SecurityGroupRules[?!IsEgress].{Id:SecurityGroupRuleId,From:FromPort,Cidr:CidrIpv4,Src:ReferencedGroupInfo.GroupId}" --output table

# 6. vpc-endpoints-sg gained port 587
aws ec2 describe-security-group-rules --profile point-operator-dev --region ap-northeast-1 --filters Name=group-id,Values=sg-0cfb59a0a9621aa8b --query "SecurityGroupRules[?!IsEgress && FromPort==\`587\`]" --output json

# 7. pod readiness after restore (kubectl get only — pod has NO aws cli; never kubectl exec aws)
kubectl get deploy -n default
kubectl get ingress point-ingress -n default -o jsonpath='{.metadata.annotations.alb\.ingress\.kubernetes\.io/listen-ports}{"\n"}{.metadata.annotations.alb\.ingress\.kubernetes\.io/security-groups}{"\n"}'
```

**Read-only safe**: true · **Account-guarded**: true

**Issues fixed vs v8**:
- APPLY-BLOCKING (CRITICAL): v8 row #13 step order is broken. It edits ingress.yaml + kubectl apply BEFORE the security_group apply that creates alb-https-sg. The SG does not exist live yet (GROUND-TRUTH line 40), so the controller cannot reconcile security-groups: alb-https-sg, the ALB stays on alb-sg, and the subsequent full terraform apply fails with DependencyViolation deleting alb-sg (3 live ALB ENIs). Terraform must run twice: targeted apply to create alb-https-sg FIRST, then kubectl apply for the controller cutover, then full apply.
- DependencyViolation is REAL and CONFIRMED: point-alb has sg-005b8b9b2e2cb718e (alb-sg) as its ONLY security group + only an HTTP:80 listener; alb-sg is ManagedLBSecurityGroup (controller-managed). revoke_rules_on_delete is false and is NOT a workaround (it revokes the SG's own rules, not the ENI attachment).
- v8 after-check uses placeholder <point-alb-arn> (unresolved) and is listener-only — it misses the actual swap-completion condition (ALB SecurityGroups = alb-https-sg). The listener flip alone does not prove the SG detached from alb-sg.
- MISSING pre-step in v8: scale-to-0 (kubectl scale deployment --all -n default --replicas=0 after capturing replicas) is required before SG rule replaces (eks-worker 8080, mysql 13306) per BB-1556; v8 row #13 omits it.
- WRONG Aurora gate carried by sonnet: 'verify Aurora already 13306 before apply' contradicts BB-1556 ordering and live state (Aurora is STILL on 3306, verified 2026-05-29). Correct gate: keep pods at 0 through the SG change AND flip Aurora port before scaling pods back up (or apply Aurora port first). Applying mysql 13306 rules and scaling pods up before Aurora flips breaks MySQL connectivity.
- Cross-component coupling: this row CANNOT be applied in isolation — the ALB SG lifecycle is coupled to the k8s ingress cutover and the mysql 3306->13306 rules are coupled to the aurora component's port flip. Coordinate with frontend-customer (CloudFront origin HTTP->HTTPS) in the same window.
- TOOLING UNVERIFIED: whether the project wrapper ../../terraform.sh --env dev apply passes -target flags through is not confirmed. Verify before STEP 1; the intent (create alb-https-sg before the kubectl cutover) holds regardless of the exact -target plumbing.
- MEDIUM (inferred, not live-verified): 'live ingress not yet cut over' and 'controller reconciles SG association' are inferred from ALB primary state (HTTP:80 + single alb-sg) + the v3.1.0 annotation semantics. Recommend human-run kubectl get ingress point-ingress -n default -o yaml before executing the cutover.


---

### Row #11 — `endpoints`  ⚠ v8 inaccurate

**Intent**: Apply VPC Interface/Gateway endpoints: create 5 NEW interface endpoints (ecr.api, email-smtp, kms, monitoring, sts) and tighten 10 EXISTING endpoint policies from open Principal:"*" to named-role ArnEquals(aws:PrincipalArn) conditions. No destroy/replace.

**Manual (corrected apply steps)**:

PRE-FLIGHT: cd bs-point-infra/terraform/components/endpoints; aws sts get-caller-identity --profile point-operator-dev (expect 905418018638); ../../terraform.sh --env dev init (NOTE: point side uses '--env dev', NOT 'dev-ex' which is the bs-exchange-infra convention). APPLY: ../../terraform.sh --env dev plan (expect +5 ~10 -0 -- 5 new interface endpoints, 10 in-place policy tightenings, ZERO destroy/replace); ../../terraform.sh --env dev apply. NO PRE-STEP, NO IMPORT, NO POST-STEP needed. CORRECTIONS to the v8/Confluence row: (1) DELETE the phrase '(6 EKS-IRSA + 2 EC2 IRSA mappings will fail-soft until #27-31/#38-41 -- re-applied at #42)'. The fresh plan (2026-05-29, SHA 21a4f4b6) REFUTES fail-soft: data.tf has ZERO aws_iam_role data sources, locals.tf:11 builds ARNs by pure string interpolation, policies.tf uses Principal:* + request-time ArnEquals -- missing roles cause ZERO apply errors. (2) The re-apply at row #42/#34 ('endpoints (re-apply)') is UNNECESSARY -- the component applies once cleanly; endpoint policies are static and already contain the ArnEquals condition, so they auto-enforce once the referenced roles land. No second plan/apply will show drift attributable to roles appearing. (3) The after-check hardcodes the WRONG-account VPC id vpc-0e139c5a0789db4c0 (that is the 845131030484 legacy-dev VPC); the target VPC is vpc-0f49bf7456fa50d08. (4) Strengthen the after-check from 'shows S3 gateway, ECR, CloudWatch Logs etc.' (existence-only -- passes on pre-apply state) to verify the POLICY TIGHTENING (ArnEquals condition on the 10 existing endpoints) + the 5 NEW endpoints Available. OPERATIONAL note (not a blocker): 6 IRSA/role principals (point-app-irsa-role, point-vpc-cni-aws-node, point-cluster-autoscaler-irsa-role, point-cloudwatch-agent-irsa-role, point-cd-runner-role, bastion-proxy-role) do not yet exist; workloads using them get temporary 403s through these endpoints by design until eks/ec2-data-transfer/security_group land. Email-smtp data-plane (port 587) ingress on vpc-endpoints-sg is added by security_group (#13) -- not required for THIS apply to succeed.

**After-check ① CONSOLE (primary)**:

PRIMARY after-check — must verify the POLICY TIGHTENING (the apply's actual effect), not just endpoint existence (10 of 15 endpoints already existed before this apply, so an existence-only check passes on the pre-apply state and verifies nothing).

A) POLICY TIGHTENING on existing endpoints (the discriminating check):
Console → VPC → left-nav "Endpoints" → filter "VPC ID = vpc-0f49bf7456fa50d08" → select endpoint with Name tag "secretsmanager" (vpce-07426b0e5996bc32e) → "Policy" tab → JSON shows a statement Sid "AllowSecretsPrincipals" with Condition block "ArnEquals": { "aws:PrincipalArn": [ ...point-app-irsa-role / bastion-proxy-role / point-cd-runner-role ... ] } — NOT a bare "Principal":"*" with no condition.
Repeat the Policy-tab spot-check on at least these to confirm each group tightened:
- "ssm" (vpce-0b42df9143232888c) → Sid "AllowSSMPrincipals" (6-role ArnEquals)
- "ec2" (vpce-0c4d1570b2d3b692f) → Sid "AllowComputePrincipals" (11-role ArnEquals)
- "logs" (vpce-073ae71bcc4091587) → Sid "AllowObservabilityPrincipals" (10-role ArnEquals)
- "ecr" (vpce-099cf3461282f1e4d, service ecr.dkr) → Sid "AllowContainerPrincipals" (4-role ArnEquals)
- "s3" (vpce-0cec0ac8e18e83881, Gateway) → Policy "Version" = "2012-10-17" (was 2008-10-17) + an "AllowStoragePrincipals" condition + an "AllowPublicRead" statement.

B) 5 NEW endpoints present + healthy:
Console → VPC → "Endpoints" → filter "VPC ID = vpc-0f49bf7456fa50d08" → confirm 5 rows by Name tag exist with Status = "Available":
- "ecr-api" (service com.amazonaws.ap-northeast-1.ecr.api, Interface)
- "email-smtp" (com.amazonaws.ap-northeast-1.email-smtp, Interface)
- "kms" (com.amazonaws.ap-northeast-1.kms, Interface)
- "monitoring" (com.amazonaws.ap-northeast-1.monitoring, Interface)
- "sts" (com.amazonaws.ap-northeast-1.sts, Interface)
For each, "Subnets" tab shows the 3 private subnets (subnet-0743df36e105ab5cc, subnet-096db15e5e8372518, subnet-00722216df32a8e26) and "Security groups" tab shows sg-0cfb59a0a9621aa8b (vpc-endpoints-sg).

C) Two INTENTIONAL exceptions — operator must NOT false-flag these as "tightening failed":
- "email-smtp" Policy tab is empty / full-access default — SES SMTP does not support custom endpoint policies (AWS limitation, main.tf:191). Open policy here is EXPECTED.
- "sts" Policy tab shows "Principal":"*" with Condition "StringEquals":{"aws:PrincipalAccount":"905418018638"} (account-scoped, NOT a role list). EXPECTED for IRSA AssumeRoleWithWebIdentity token exchange.

After-check passes when: (A) the sampled existing endpoints show ArnEquals-conditioned policies, (B) all 5 new endpoints are Available with the correct SG + 3 private subnets, (C) email-smtp/sts exceptions are recognized as intentional.

**After-check ② CLI (read-only fallback)**:

```bash
# 1) Account guard FIRST (expect Account=905418018638)
aws sts get-caller-identity --profile point-operator-dev
# 2) List all endpoints in target VPC + their Name tag + State (5 new must appear Available)
aws ec2 describe-vpc-endpoints --profile point-operator-dev --region ap-northeast-1 --filters Name=vpc-id,Values=vpc-0f49bf7456fa50d08 --query 'VpcEndpoints[].{Name:Tags[?Key==`Name`]|[0].Value,Svc:ServiceName,State:State,Id:VpcEndpointId}' --output table
# 3) Verify policy TIGHTENING on secretsmanager endpoint — output must contain ArnEquals/aws:PrincipalArn (NOT bare open policy)
aws ec2 describe-vpc-endpoints --profile point-operator-dev --region ap-northeast-1 --vpc-endpoint-ids vpce-07426b0e5996bc32e --query 'VpcEndpoints[0].PolicyDocument' --output text | python3 -c 'import sys,json; d=json.loads(sys.stdin.read()); print([ (s.get("Sid"), list((s.get("Condition") or {}).keys())) for s in d["Statement"] ])'
# 4) Same tightening proof for ssm / ec2 / logs / ecr.dkr / s3 (loop, expect ArnEquals condition on each except none on email-smtp)
for id in vpce-0b42df9143232888c vpce-0c4d1570b2d3b692f vpce-073ae71bcc4091587 vpce-099cf3461282f1e4d vpce-0cec0ac8e18e83881; do echo "== $id =="; aws ec2 describe-vpc-endpoints --profile point-operator-dev --region ap-northeast-1 --vpc-endpoint-ids "$id" --query 'VpcEndpoints[0].PolicyDocument' --output text; done
```

**Read-only safe**: true · **Account-guarded**: true

**Issues fixed vs v8**:
- NONE apply-blocking: fresh plan is +5 ~10 -0 with zero destroy/replace; plan exit 2, apply succeeds in any order. Listed below are correctness defects in the existing row, not apply blockers.
- CORRECTNESS (stale after-check ID): v8 row #14 after-check hardcodes vpc-0e139c5a0789db4c0 which is the WRONG account (845131030484 legacy-dev). Target is vpc-0f49bf7456fa50d08. The after-check as written FAILS / returns the wrong VPC's endpoints.
- CORRECTNESS (refuted hypothesis in manual step): the 'fail-soft until #27-31/#38-41' wording is false. Component has no aws_iam_role data sources; ARNs are string-interpolated; missing roles never error at plan or apply.
- CORRECTNESS (unnecessary step): row #42/#34 'endpoints (re-apply)' should be removed. Policies already contain the ArnEquals condition after the single apply; a re-apply shows no role-driven drift. Re-apply wastes a maintenance slot and implies a dependency that does not exist.
- CORRECTNESS (non-discriminating after-check): the v8 check 'shows S3 gateway, ECR, CloudWatch Logs etc.' is existence-only and would PASS against the pre-apply state (10 of 15 endpoints pre-exist). It must instead assert the policy tightening (ArnEquals condition) on the 10 existing endpoints + presence of the 5 new endpoints.
- OPERATIONAL (not a blocker): 6 referenced IRSA/roles do not exist yet (point-app-irsa-role, point-vpc-cni-aws-node, point-cluster-autoscaler-irsa-role, point-cloudwatch-agent-irsa-role, point-cd-runner-role, bastion-proxy-role) -> workloads using them get temporary 403s through these endpoints by design until eks / ec2-data-transfer / security_group land.
- OPERATIONAL (not a blocker): email-smtp data-plane (TCP 587) ingress on vpc-endpoints-sg sg-0cfb59a0a9621aa8b is provisioned by the security_group component (#13), not by endpoints. The email-smtp endpoint still creates successfully without it; only SES SMTP traffic is gated until #13 applies.
- VERIFICATION GOTCHA: do NOT false-flag email-smtp (no custom policy -- AWS limitation, intentional open default) or sts (Principal:* + aws:PrincipalAccount=905418018638 account scope -- intentional for IRSA) as 'tightening failed'.
- ENV-FLAG: use '../../terraform.sh --env dev' on the bs-point-infra (point) side. The global '--env dev-ex' convention belongs to bs-exchange-infra (verup) and is wrong for this checklist.


---

### Row #12 — `secrets_manager`  ⚠ v8 inaccurate

**Intent**: Apply the secrets_manager Terraform component in point dev (905418018638): plan is +1/~0/-0 — creates exactly one new EMPTY secret container point/lambda/event-notification-to-slack; the other 16 point/* secrets already exist and refresh clean. Code-IDENTICAL port (point locals.tf is 1 key ahead of verup). Apply FIRST among core-infra; IAM-free; LOW risk; no downtime.

**Manual (corrected apply steps)**:

CORRECTED MANUAL APPLY (secrets_manager, point dev 905418018638):

Pre-step:
1. Account guard: `aws sts get-caller-identity --profile point-operator-dev` must return Account 905418018638 / user bs-developer.
2. cd bs-point-infra/terraform/components/secrets_manager && ../../terraform.sh --env dev init (if .terraform.lock.hcl missing).

Apply:
3. ../../terraform.sh --env dev plan  -> MUST show EXACTLY '1 to add, 0 to change, 0 to destroy' and the single add is aws_secretsmanager_secret.secrets["lambda/event-notification-to-slack"] (name point/lambda/event-notification-to-slack). If plan shows >1 add, any change/destroy/replace, or refresh errors on the 16 existing secrets -> STOP (state drift; the other 16 point/* secrets already exist live).
4. ../../terraform.sh --env dev apply.

Post-apply (do NOT block this row on it):
5. The new secret is an EMPTY container (Terraform sets no value; recovery_window_in_days=0). Populating it with `aws secretsmanager put-secret-value` is a WRITE op and is NOT required to mark this row done. It is only needed BEFORE the separate `event-notification` Lambda component is applied (that Lambda reads point/lambda/event-notification-to-slack at runtime per event-notification/terraform.tfvars lambda_secret_name). Defer the put-secret-value to the event-notification apply step; in the dev rehearsal an empty container is the expected end state for THIS row. (When the value IS populated, that write must be done by the operator, not by an AI assistant per READ-ONLY policy — provide it as a manual operator instruction only.)

After-check (read-only): list-secrets by name confirms point/lambda/event-notification-to-slack exists and total point/* = 18 (17 pre-existing [16 component-managed + 1 unmanaged `point/exc` not in secrets_manager_keys] + 1 new — live-verified 2026-06-08).

**After-check ① CONSOLE (primary)**:

PRIMARY (AWS Console click-path, signed in as IAM user bs-developer in account 905418018638, region ap-northeast-1 / Tokyo):

1. Confirm account: top-right account menu shows 905418018638 and you are signed in as bs-developer. If it shows 845131030484 (legacy-dev) STOP — wrong account.

2. Verify the NEW secret was created:
   Console -> Secrets Manager -> left nav "Secrets" -> in the search box type: point/lambda/event-notification-to-slack
   -> Expect EXACTLY ONE matching row named "point/lambda/event-notification-to-slack".
   -> Click it. On the secret detail page:
      - "Secret name" = point/lambda/event-notification-to-slack
      - "Encryption key" = aws/secretsmanager (default) — Terraform sets no custom KMS key
      - "Tags" tab: no value-of-secret is set by Terraform (this is an empty container). Under "Secret value" -> "Retrieve secret value": for the dev rehearsal it is EXPECTED to be empty / "There is no value" until the populate step is done before the event-notification Lambda is applied. Do NOT treat an empty value as a failure of this row.

3. Confirm the sibling lambda secret already exists (sanity that you are looking at the right group, not creating a duplicate):
   Same "Secrets" list -> search "point/lambda/" -> Expect TWO rows: "point/lambda/sns-to-slack" (pre-existing) and "point/lambda/event-notification-to-slack" (newly created this apply).

4. Confirm no destructive change to the 16 existing secrets:
   Console -> Secrets Manager -> Secrets -> search "point/" -> Expect 18 point/* secrets total after apply (17 pre-existing [16 component-managed + 1 unmanaged `point/exc`] + 1 new). None should show "Scheduled for deletion" (the plan had 0 destroy / 0 replace). Spot-check point/SPRING_DATASOURCE_MASTER and point/aurora/master_user still present with their values intact.

There is NO CloudFront/ACM/us-east-1 aspect for this component — it is region ap-northeast-1 only. Greenfield note: the new secret is created-by-name, so verify by NAME (point/lambda/event-notification-to-slack), not by ARN suffix — the 6-char ARN suffix (e.g. -AbCdEf) is generated at create time and is only knowable post-apply.

**After-check ② CLI (read-only fallback)**:

```bash
SECONDARY (read-only CLI fallback, account-guarded). ✅ Run from the SSM point-bastion or laptop/CI — ❌ NOT from a pod (the EKS pod has no aws cli):

# 1) Account guard (MANDATORY)
aws sts get-caller-identity --profile point-operator-dev
# Expect: "Account": "905418018638", Arn ".../user/bs-developer"

# 2) Confirm the NEW secret exists by name (resolves the post-apply ARN suffix for you)
aws secretsmanager list-secrets --profile point-operator-dev --region ap-northeast-1 --filters Key=name,Values=point/lambda/event-notification-to-slack --query 'SecretList[].{Name:Name,ARN:ARN}' --output table
# Expect exactly 1 row: Name=point/lambda/event-notification-to-slack, ARN=arn:aws:secretsmanager:ap-northeast-1:905418018638:secret:point/lambda/event-notification-to-slack-XXXXXX

# 3) Confirm total point/* count = 18 (17 pre-existing [16 managed + unmanaged point/exc] + 1 new), and no scheduled-deletion
aws secretsmanager list-secrets --profile point-operator-dev --region ap-northeast-1 --filters Key=name,Values=point/ --query 'length(SecretList)' --output text
# Expect: 18  (NB: the name-prefix filter counts the unmanaged point/exc too; pre-apply this command returns 17)

# 4) (Optional) Confirm both lambda secrets present
aws secretsmanager list-secrets --profile point-operator-dev --region ap-northeast-1 --filters Key=name,Values=point/lambda/ --query 'SecretList[].Name' --output text
# Expect: point/lambda/sns-to-slack  point/lambda/event-notification-to-slack
```

**Read-only safe**: false · **Account-guarded**: true

**Issues fixed vs v8**:
- v8 row #15 / Confluence #10 fold `aws secretsmanager put-secret-value` (a WRITE op) into the secrets_manager apply. It belongs to the later event-notification Lambda apply, not this row. Mark this row done on the empty container; defer the value population. When populated, it must be an operator action (READ-ONLY policy bars AI from put-secret-value).
- Placeholder `<new-secret-arn>` cannot be pre-resolved: the ARN's 6-char suffix is generated at create time. After-checks MUST key off the secret NAME (point/lambda/event-notification-to-slack), not a hardcoded ARN. (The v8 row's `list-secrets | jq '.SecretList[].Name'` after-check is correct in spirit but should filter by name to avoid scanning all 17.)
- Expected end state must be asserted explicitly: plan is +1/~0/-0 ONLY. If a fresh plan shows the 16 existing point/* secrets as adds/replaces, the component is not bound to live state (state drift) and apply would error 'already exists' — halt and re-plan. GROUND-TRUTH confirms all 16 plus point/aws-credentials already exist live; only point/lambda/event-notification-to-slack is genuinely new.
- Wrong-account risk: the legacy-dev account 845131030484 (CLAUDE.md DEV snapshot) also holds point/* secrets. Console/CLI verification MUST confirm 905418018638 first, or a green after-check could be reading the wrong account's secrets.


---

### Row #14 — `waf-admin`  ⚠ v8 inaccurate

**Intent**: Apply BB-1565 (WAF logging PII redaction) + BB-1566 (rate-limit rule groups) + IP allowlist refresh to the existing CloudFront-scoped admin WAF web ACL `point-cloudfront-admin` (us-east-1). In-place update: +2 rule groups, ~3 changes (web ACL rule reorder, ip_set 25-remove/8-add, logging redacted_fields), 0 destroy/replace — no WAF downtime.

**Manual (corrected apply steps)**:

CORRECTED manual apply steps for row #18 (waf-admin):

PRE-STEPS (verify before apply):
1. Foundation Gate A (row #2 infra/audit) applied — confirm S3 bucket `aws-waf-logs-bs-point-dev` exists and its bucket policy allows WAFv2 log delivery (read-only: `aws s3api get-bucket-policy --bucket aws-waf-logs-bs-point-dev --profile point-operator-dev`). NOTE: the v8 prereq reference to `s3-access-logs.bs-point-dev` is wrong — that bucket does NOT exist in 905418018638; the WAF-logging bucket is `aws-waf-logs-bs-point-dev`.
2. SEC-Q1 IP rotation review: confirm the 25 IPs being REMOVED from `point-cloudfront-admin-allow-ipv4` are not in active use. Five are AWS-range (18.179.98.160/32, 3.114.116.182/32, 3.115.64.50/32, 35.73.119.120/32, 57.181.130.9/32) — cross-check they are not the current NAT GW EIP (52.198.175.250 is the 845131030484 NAT; target 905418018638 NAT = nat-0a54b505d27c22527) or ec2-cd-runner egress before removal.
3. Header-bypass removal review: the old priority-3 `allow_all_ipv4` had an OR-statement with byte_match header `x-servstgdev-controll`; the new priority-5 rule is IP-only. Confirm no CD runner / automation relies on that header.
4. Priority-ordering review: rate_limit_count (prio 3) and rate_limit (prio 4) now evaluate BEFORE allow_all_ipv4 (prio 5) — trusted office IPs are still subject to rate counting/blocking. Confirm intentional.

APPLY:
  cd terraform/components/waf-admin && ../../terraform.sh --env dev plan   # expect: 2 add, 3 change, 0 destroy, 0 replace
  ../../terraform.sh --env dev apply
  (Plan is in-place UpdateWebACL — atomic, no WAF downtime; ACL is NOT greenfield, it already exists with ID 93e7a6f0-8c4a-4162-afec-67b76f34b523.)

AFTER-CHECK: use the console_primary click-path (Global/CloudFront scope) as PRIMARY and the cli_secondary one-liners as fallback. Do NOT use the v8 `list-web-acls --scope REGIONAL` / `point-admin` check (wrong scope + wrong name) and do NOT use `curl https://admin.dev.backseat-service.com` (no distribution exists yet; created by frontend-admin).

**After-check ① CONSOLE (primary)**:

PRIMARY (AWS Console click-path) — this WAF is CLOUDFRONT-scoped, so you MUST set the WAFv2 console scope/region selector to "Global (CloudFront)" / us-east-1, NOT ap-northeast-1:

1) Verify the web ACL + new rule priority order:
   Console → WAF & Shield → top-left scope dropdown = "Global (CloudFront)" → AWS WAF → Web ACLs → confirm `point-cloudfront-admin` is listed (Web ACL ID 93e7a6f0-8c4a-4162-afec-67b76f34b523) → click it → Rules tab → confirm order (top→bottom): priority 3 = rate-limit-count rule-group ref, priority 4 = rate-limit rule-group ref, priority 5 = `allow_all_ipv4` (simple IP-set reference, NOT the old OR/header byte-match), then 6 pass_maintenance_access, 7 maintenance_mode_for_path_admin, 8 maintenance_mode_for_html; managed core_rule_set + known_bad_inputs_rule_set blocks remain.

2) Verify the 2 new rule groups:
   Same console (Global/CloudFront) → AWS WAF → Rule groups → confirm `point-cloudfront-admin-rate-limit-rulegroup` (action BLOCK, capacity 44, 4 rules admin_login/register/password/general) AND `point-cloudfront-admin-rate-limit-count-rulegroup` (action COUNT, same 4 rules).

3) Verify the IP set refresh:
   Same console (Global/CloudFront) → AWS WAF → IP sets → `point-cloudfront-admin-allow-ipv4` (IP set ID 33026e8a-3830-4f5f-a9cc-ffc71fac325b) → IP addresses MUST contain the 8 NEW office IPs (117.4.246.159/32, 118.70.131.154/32, 119.31.155.132/32, 125.103.198.113/32, 14.224.224.49/32, 14.232.214.101/32, 150.249.252.237/32, 59.87.165.2/32) + the 4 unchanged retained entries, and MUST NOT contain the 25 removed legacy IPs (e.g. 18.179.98.160/32, 3.114.116.182/32, 35.73.119.120/32, 57.181.130.9/32, 3.115.64.50/32 AWS-range + 20 office IPs).

4) Verify PII logging redaction (BB-1565):
   On `point-cloudfront-admin` web ACL → Logging and metrics tab → Logging = Enabled, destination S3 bucket `aws-waf-logs-bs-point-dev`, Redacted fields list shows all 7: authorization, cookie, set-cookie, x-api-key, query_string, x-forwarded-for, referer.

NOTE: Do NOT use `curl https://admin.dev.backseat-service.com` at this row — that hostname has NO CloudFront distribution yet (created later by frontend-admin). The WAF ACL exists standalone here; verify via console above, not via the admin URL.

**After-check ② CLI (read-only fallback)**:

```bash
SECONDARY (read-only CLI, account-guarded; CloudFront scope ⇒ us-east-1, NOT ap-northeast-1):
aws sts get-caller-identity --profile point-operator-dev   # expect Account 905418018638
# 1) web ACL exists (CLOUDFRONT scope) — replaces the WRONG `--scope REGIONAL / point-admin` after-check:
aws wafv2 list-web-acls --profile point-operator-dev --scope CLOUDFRONT --region us-east-1 --query "WebACLs[?Name=='point-cloudfront-admin']"
# 2) rule priority order + rate-limit rule-group refs on the ACL:
aws wafv2 get-web-acl --profile point-operator-dev --scope CLOUDFRONT --region us-east-1 --name point-cloudfront-admin --id 93e7a6f0-8c4a-4162-afec-67b76f34b523 --query "WebACL.Rules[].{P:Priority,N:Name}"
# 3) both new rule groups present:
aws wafv2 list-rule-groups --profile point-operator-dev --scope CLOUDFRONT --region us-east-1 --query "RuleGroups[?starts_with(Name,'point-cloudfront-admin-rate-limit')].Name"
# 4) IP set has the 8 new IPs and none of the 25 removed:
aws wafv2 get-ip-set --profile point-operator-dev --scope CLOUDFRONT --region us-east-1 --name point-cloudfront-admin-allow-ipv4 --id 33026e8a-3830-4f5f-a9cc-ffc71fac325b --query "IPSet.Addresses"
# 5) logging enabled + 7 redacted fields:
aws wafv2 get-logging-configuration --profile point-operator-dev --resource-arn arn:aws:wafv2:us-east-1:905418018638:global/webacl/point-cloudfront-admin/93e7a6f0-8c4a-4162-afec-67b76f34b523 --region us-east-1 --query "LoggingConfiguration.{Dest:LogDestinationConfigs,Redacted:RedactedFields}"
```

**Read-only safe**: false · **Account-guarded**: true

**Issues fixed vs v8**:
- WRONG SCOPE/NAME in v8 + Confluence after-check: it uses `aws wafv2 list-web-acls --scope REGIONAL` looking for `point-admin`, but the actual resource is CLOUDFRONT-scoped and named `point-cloudfront-admin` (us-east-1, global/webacl/...). The REGIONAL query returns nothing → false-negative verification. Must query --scope CLOUDFRONT --region us-east-1.
- WRONG after-check `curl -I https://admin.dev.backseat-service.com → 200`: that hostname has NO CloudFront distribution at this row's apply time (created later by frontend-admin, row #45). The waf-admin component manages only the standalone web ACL + ip_set + rule groups + logging — it contains no web_acl_association/distribution resource. The curl check is unrunnable here and must move to a post-frontend-admin smoke test.
- WRONG prereq bucket name: row #2/v8 references `s3-access-logs.bs-point-dev` as a prereq, but that bucket does NOT exist in target account 905418018638. The WAF-logging bucket is `aws-waf-logs-bs-point-dev`.
- STALE greenfield framing: the web ACL (id 93e7a6f0-...) and ip_set (id 33026e8a-...) already exist; the apply is in-place (2 add rule groups, 3 change, 0 destroy, 0 replace) via atomic UpdateWebACL — no greenfield create, no WAF downtime.
- CONNECTIVITY RISK (apply-blocking gate, not a checklist bug): 25 IPs removed from the allowlist incl. 5 AWS-range IPs (18.179.98.160, 3.114.116.182, 3.115.64.50, 35.73.119.120, 57.181.130.9). Must confirm none is a current operator/CD-runner/NAT egress before apply, else admin access is blocked by default-BLOCK. Also the old `x-servstgdev-controll` header bypass is removed — confirm no automation depends on it.


---

### Row #15 — `waf-athena`  ⚠ v8 inaccurate

**Intent**: Greenfield: create the Athena workgroup + Glue catalog database + Glue external table (partition-projection) used to query CloudFront WAF access logs stored in s3://aws-waf-logs-bs-point-dev. 3 pure creates, LOW risk, no downtime, daytime-OK.

**Manual (corrected apply steps)**:

PRE: aws sts get-caller-identity --profile point-operator-dev (expect 905418018638). VERIFY Foundation Gate A — infra/audit (row #2) applied so the WAF-log access/lock policy on aws-waf-logs-bs-point-dev is settled; confirm aws-waf-logs-bs-point-dev is NOT scheduled for REPLACE. (Bucket already EXISTS in 905418018638 — the data.aws_s3_bucket.waf_logs read succeeded at plan time; this component only READS it, never creates/destroys it.) APPLY (daytime OK, no maintenance window, no downtime): cd terraform/components/waf-athena && ../../terraform.sh --env dev plan (expect EXACTLY 3 to add / 0 change / 0 destroy: aws_athena_workgroup.waf_logs=waf-logs-dev, aws_glue_catalog_database.waf_logs=waf_logs_dev, aws_glue_catalog_table.waf_customer_access_logs) && ../../terraform.sh --env dev apply. AFTER-CHECK (replaces the WRONG v8 check): the v8 row uses `aws athena list-named-queries --work-group <wg>` which verifies NOTHING — this component creates zero named queries, so it returns [] regardless of apply success/failure. Instead run the three get-* reads in cli_secondary (workgroup State ENABLED + SSE_S3 + correct output_location; Glue DB waf_logs_dev present; Glue table waf_customer_access_logs with 4 partition keys + projection.enabled=true + correct S3 location). Functional proof = run `SELECT * FROM waf_customer_access_logs LIMIT 10;` in the Athena console under workgroup waf-logs-dev / database waf_logs_dev: query must SUCCEED; 0 rows is EXPECTED and PASSING until waf-customer (row #47) delivers CloudFront WAF logs.

**After-check ① CONSOLE (primary)**:

Account guard first: AWS Console top-right account menu shows 905418018638 (point dev), signed in as IAM user bs-developer. Set the region selector to Asia Pacific (Tokyo) ap-northeast-1 — ALL THREE resources are REGIONAL in Tokyo (the CloudFront WAF source lives in us-east-1, but the Athena/Glue catalog does NOT — do not switch to us-east-1 for this check).

1) Athena workgroup. Console → Athena → (left nav) Administration → Workgroups → select "waf-logs-dev". Verify: Status/State = ENABLED; "Query result location" = s3://aws-waf-logs-bs-point-dev/athena-results/; "Encrypt query results" = ON, type SSE_S3; "Override client-side settings" (enforce_workgroup_configuration) = enabled. Tags tab shows Environment=dev, Purpose=WAF access logs query.

2) Glue database. Console → AWS Glue → Data Catalog → Databases → confirm "waf_logs_dev" is listed (description "Database for WAF access logs").

3) Glue table (the functional proof). Console → AWS Glue → Data Catalog → Databases → waf_logs_dev → "Tables in waf_logs_dev" → select "waf_customer_access_logs". Verify on the table detail page: Classification/serde = JSON (org.openx.data.jsonserde.JsonSerDe); Location = s3://aws-waf-logs-bs-point-dev/AWSLogs/905418018638/WAFLogs/cloudfront/point-cloudfront-customer/; Partitions tab shows 4 partition keys year, month, day, hour (all string); Table properties include projection.enabled=true and storage.location.template ending in /${year}/${month}/${day}/${hour}/.

4) Optional functional (console-only) check — confirm the schema resolves and the table is queryable: Console → Athena → Query editor → Workgroup = waf-logs-dev, Database = waf_logs_dev → run `SELECT * FROM waf_customer_access_logs LIMIT 10;`. EXPECT: query SUCCEEDS (schema resolves) and returns 0 rows until waf-customer (row #47) starts delivering CloudFront WAF logs to the bucket. A successful query returning empty = PASS. (Do not put this SELECT in the read-only CLI block — start-query-execution is not a read-only op.)

**After-check ② CLI (read-only fallback)**:

```bash
aws sts get-caller-identity --profile point-operator-dev   # expect Account=905418018638 (point dev)
aws athena get-work-group --profile point-operator-dev --region ap-northeast-1 --work-group waf-logs-dev --query 'WorkGroup.{State:State,Out:Configuration.ResultConfiguration.OutputLocation,Enc:Configuration.ResultConfiguration.EncryptionConfiguration.EncryptionOption,Enforce:Configuration.EnforceWorkGroupConfiguration}'   # expect State=ENABLED, Out=s3://aws-waf-logs-bs-point-dev/athena-results/, Enc=SSE_S3, Enforce=true
aws glue get-database --profile point-operator-dev --region ap-northeast-1 --name waf_logs_dev --query 'Database.Name'   # expect "waf_logs_dev"
aws glue get-table --profile point-operator-dev --region ap-northeast-1 --database-name waf_logs_dev --name waf_customer_access_logs --query 'Table.{Loc:StorageDescriptor.Location,Keys:PartitionKeys[].Name,Proj:Parameters."projection.enabled"}'   # expect Loc=s3://aws-waf-logs-bs-point-dev/AWSLogs/905418018638/WAFLogs/cloudfront/point-cloudfront-customer/, Keys=[year,month,day,hour], Proj=true
```

**Read-only safe**: false · **Account-guarded**: true

**Issues fixed vs v8**:
- v8 row #19 AFTER-CHECK is invalid: `aws athena list-named-queries --work-group <wg>` verifies nothing (component creates zero named queries → returns [] whether apply succeeded or failed). Must be replaced with get-work-group + get-database + get-table reads (see corrected_manual / cli_secondary).
- Region trap: workgroup + Glue DB/table are REGIONAL in ap-northeast-1 (Tokyo); the CloudFront WAF log SOURCE (point-cloudfront-customer) is us-east-1. The Console region selector must be set to Tokyo for the after-check, or the resources will appear missing.
- NOT apply-blocking (do not mis-flag): the Glue table is partition-projection metadata pointing at an S3 prefix — it applies cleanly even though waf-customer (row #47) and its CloudFront WAF logs do not exist yet. Athena queries return EMPTY (0 rows, query succeeds) until #47 delivers logs. This is a data-availability caveat, not a blocker.
- Sequencing prereq (not a defect): Foundation Gate A = infra/audit (row #2) must be applied first so the access/lock policy on aws-waf-logs-bs-point-dev is settled and the bucket is not scheduled for REPLACE. waf-athena only READS the bucket; it does not modify it.
- Downstream table-name divergence (informational): point uses Glue table name waf_customer_access_logs vs verup's waf_access_logs. If any downstream consumer (AML / BO blocked-requests page) hardcodes waf_access_logs, it must be updated to waf_customer_access_logs. No apply impact.


---

### Row #39 — `waf-customer`  ⚠ v8 inaccurate

**Intent**: Apply the customer-facing CloudFront-scoped WAFv2 WebACL `point-cloudfront-customer` (us-east-1) in point dev 905418018638 — geo/IP allow rules + payment-callback IP-sets + rate-limit rule groups + PII log masking; deploy procedure forks on whether the maintenance-split/V6 migration branch has merged into release/verup.

**Manual (corrected apply steps)**:

> ✅ **DECISION RESOLVED — PATH B IS THE ONLY PATH (do NOT use Path A).** Live-verified 2026-06-08: pr-84 (maintenance-split / V6 provider `~>6.40`) **IS MERGED** into release/verup (commit `e394685c`, merge `3f9eb122`); `scripts/preflight-renumber.sh` + `priority-targets-{dev,stg}.json` + the split `maintenance_exchange`/`maintenance_point` rule groups are PRESENT. Fresh plan = `+18/~2/-1`. The "PRE-STEP decision gate" and "PATH A" prose below are HISTORICAL — they predate the merge (G5 / R3-WAF-CUST-01 supersede them). Skip straight to **PATH B**. Also apply **waf-maintenance-lambda (#39b)** in the same window (R3-WAFMLAMBDA-01).

AUDIT RESULT (HISTORICAL — superseded by the banner above): the local v8 row #47 (simple `terraform.sh --env dev apply`) and the Confluence v62 row #39 (4-step preflight-renumber.sh procedure) describe TWO DIFFERENT branches. Which one is correct depends entirely on the state of `release/verup` (the canonical apply branch) at apply time. Verified facts (2026-05-29): origin/release/verup = provider ~4.0, INLINE rules, NO scripts/preflight-renumber.sh, single legacy rulegroup-maintenance.tf; branch pr-84 (SHA da4ed751, 'port per-brand maintenance feature') = provider ~6.40, separate aws_wafv2_web_acl_rule resources, scripts/preflight-renumber.sh + priority-targets-*.json, split maintenance_exchange/maintenance_point rule groups. pr-84 is UNMERGED into release/verup. GROUND-TRUTH.md line 75 confirms the V6 scripts were NOT on release/verup HEAD. The only fresh plan for waf-customer (2026-05-07, +5/~4/0/0) is the ~4.0 inline-rule plan.

PRE-STEP (decision gate, BLOCKING): determine `cd bs-point-infra && git ls-files terraform/components/waf-customer/scripts/preflight-renumber.sh` on the checked-out release/verup. If absent → Path A. If present (pr-84 merged) → Path B. NEVER mix.

Common pre-checks (both paths): account guard `aws sts get-caller-identity --profile point-operator-dev` returns 905418018638; verify Foundation Gate A (infra/audit applied — aws-waf-logs-bs-point-dev bucket exists and is NOT in REPLACE); verify frontend-customer WebACL name is unchanged (`point-cloudfront-customer`); schedule the JST Sun 22:00-23:00 maintenance window AFTER all other rows verify green (Confluence Risk #4 — customer-facing maintenance interruption); post the customer maintenance banner >=6h before.

PATH A — release/verup as-is (~4.0, inline rules; matches the 2026-05-07 fresh plan; GROUND-TRUTH-sanctioned 'older direct apply'):
  1. cd terraform/components/waf-customer && ../../terraform.sh --env dev init
  2. ../../terraform.sh --env dev plan   # expect ~ +5 ~4 -0 (2 new callback IP sets, 3 new rate-limit rule groups, in-place web_acl reorder + logging redaction)
  3. ../../terraform.sh --env dev apply   # single apply; rules are inline so NO duplicate-priority risk, NO preflight needed
  (do NOT run preflight-renumber.sh on this branch — the script and the V6 separate-resource layout do not exist here.)

PATH B — only after pr-84 (maintenance-split / V6 provider ~6.40) merges into release/verup; a plain `terraform apply` here FAILS with WAFInvalidParameter exception (duplicate priorities) because the provider issues one UpdateWebACL per aws_wafv2_web_acl_rule):
  1. If maintenance mode is currently ON via the legacy single-brand Lambda (Case 3), FIRST targeted-create the two new rule groups: `../../terraform.sh --env dev apply -target='module.for_cloudfront.aws_wafv2_rule_group.maintenance_exchange' -target='module.for_cloudfront.aws_wafv2_rule_group.maintenance_point'`, then apply frontend-customer + s3-maintenance content for /exchange/maintenance/* and /point/maintenance/*, wait CloudFront Deployed, verify those paths return 200. If maintenance is OFF (Case 1) skip this sub-step.
  2. Dry-run the atomic renumber (READ-ONLY): `./scripts/preflight-renumber.sh --profile point-operator-dev --expected-account 905418018638 --targets ./scripts/priority-targets-dev.json` — review the printed diff (managed rules remapped to 0/3/4/5/9/10/11/12/13/14/15; slots 1/2 reserved). priority-targets-dev.json (11 rules) is the correct layout for point dev (is_public=false + enabled_managed_ip_rules=false), even though its README labels the file's account as 845131030484 — the layout is account-agnostic.
  3. Commit the renumber: re-run the same command with `--commit` (submits one atomic UpdateWebACL with optimistic-lock retry; this is a wafv2:UpdateWebACL WRITE and must be operator-executed, not by an AI assistant).
  4. ../../terraform.sh --env dev apply   # destroys the legacy maintenance rule group (now detached), adopts each aws_wafv2_web_acl_rule by name (zero AWS-side rule change), updates logging.
  Watch for 'Provider produced inconsistent result after apply' on core_rule_set / country_restrict (pre-existing ExcludedRules->RuleActionOverrides drift) — recover via untaint + replan + apply per the scripts/README, never destroy (country_restrict has prevent_destroy).

WHY accurate=false: v8 row #47 captures only Path A and does not flag the branch dependency or the V6 path the team now documents in Confluence #39; Confluence #39 captures only Path B and would error against the live ~4.0 release/verup. WHY read_only_ok=false: Confluence #39's procedure includes the wafv2:UpdateWebACL write (preflight `--commit`) and `terraform apply` (write) interleaved as manual steps — these are apply/write operations (not after-checks). All AFTER-CHECKS proposed in console_primary/cli_secondary are read-only (describe/get/list). WHY account_guarded=false in the SOURCE rows: v8 row #47 after-check (`aws wafv2 list-web-acls --scope CLOUDFRONT`) omits `--profile point-operator-dev` and an account guard; Confluence #39 after-check ('check on actual website') is not account-guarded and is currently unsatisfiable (no frontend-customer distribution). The corrected after-check (cli_secondary) adds the mandatory sts get-caller-identity guard for 905418018638 and --profile on every call.

**After-check ① CONSOLE (primary)**:

PRIMARY after-check (works for BOTH branch paths — key on the WebACL NAME, since rule priority numbers differ between the ~4.0 inline branch and the ~6.40 V6 branch):
1. AWS Console (signed in as IAM user bs-developer in account 905418018638) → search "WAF & Shield" → WAF → in the top-left region/scope selector choose "Global (CloudFront)" (this is the us-east-1 scope; CLOUDFRONT WebACLs do NOT appear under ap-northeast-1).
2. Left nav → Web ACLs → confirm a WebACL named exactly `point-cloudfront-customer` is listed (Resource type = CloudFront distributions). Click it.
3. Rules tab → confirm the rule ladder is present. Expected rule NAMES (priority numbers depend on branch):
   - country_restrict (Block) at priority 0
   - block_exepct_allow_ipv4 (Block) — present because is_public=false
   - block_bpo_callback_except_allowed_ips (Block) and block_gmo_callback_except_allowed_ips (Block)
   - core_rule_set (AWS Common, with CrossSiteScripting_BODY / GenericLFI_BODY / GenericRFI_BODY / SizeRestrictions_BODY overridden to Count) and known_bad_inputs_rule_set
   - rate-limit rule-group references: rate_limit, rate_limit_count (Path B adds rate_limit_auth, rate_limit_auth_count)
   - allow_all_ipv4 (Allow) LAST (highest priority number)
   - On the V6/merged path (Path B) ONLY: priorities 1 and 2 are RESERVED (empty unless maintenance is ON, then filled by Lambda with maintenance-exchange / maintenance-point); ip_reputation_list_count / anonymous_ip_list_count are absent in dev (enabled_managed_ip_rules=false).
4. Click each new IP set rule's statement, or go to Left nav → IP sets (Global/CloudFront) → confirm IP sets backing bpo/gmo callbacks exist (the bpo/gmo callback allow IP sets) and the office allow IP set lists the 12 dev allow IPs (Backseat 半蔵門/市ヶ谷/駒込, Cloudflare VPN, Relipa, Solashi).
5. Web ACL → Logging and metrics tab → Logging = Enabled, destination = the S3 log bucket `aws-waf-logs-bs-point-dev`; under Redacted fields confirm the 10 masked fields (authorization, cookie, set-cookie, x-api-key, x-authorization, query_string, api-key, signature, x-forwarded-for, referer) — this proves the BB-1569 PII masking landed.
NOTE: Confluence #39's "check on actual website" / curl of app.dev.backseat-service.com CANNOT pass at this row — per ground-truth there is NO frontend-customer CloudFront distribution in point dev yet (created by the frontend-customer row). Treat the website curl as a DEPENDENT check, contingent on the frontend-customer row; the WebACL Console inspection above is the authoritative after-check for waf-customer.

**After-check ② CLI (read-only fallback)**:

```bash
Account guard FIRST (mandatory): aws sts get-caller-identity --profile point-operator-dev   # expect Account 905418018638

Then (all read-only; CLOUDFRONT scope is always us-east-1):
ACL_ID=$(aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1 --profile point-operator-dev --query "WebACLs[?Name=='point-cloudfront-customer'].Id | [0]" --output text) && \
aws wafv2 get-web-acl --scope CLOUDFRONT --region us-east-1 --profile point-operator-dev --name point-cloudfront-customer --id "$ACL_ID" --query "WebACL.Rules[].{P:Priority,N:Name}" --output table

# Logging config (proves PII redaction landed):
aws wafv2 get-logging-configuration --resource-arn "arn:aws:wafv2:us-east-1:905418018638:global/webacl/point-cloudfront-customer/$ACL_ID" --region us-east-1 --profile point-operator-dev --query "LoggingConfiguration.{Dest:LogDestinationConfigs,Redacted:RedactedFields}"

# Rule groups present (names are env-prefixed with the WebACL name):
aws wafv2 list-rule-groups --scope CLOUDFRONT --region us-east-1 --profile point-operator-dev --query "RuleGroups[].Name" --output text
#   Path A (release/verup ~4.0): expect point-cloudfront-customer-rate-limit{,-count,-auth,-auth-count}-rulegroup + legacy single maintenance rule group
#   Path B (pr-84 ~6.40 merged): ALSO expect point-cloudfront-customer-maintenance-exchange-rulegroup + point-cloudfront-customer-maintenance-point-rulegroup

# WebACL id is NOT in ground-truth — it is resolved at runtime by the list-web-acls call above (do not hardcode).
```

**Read-only safe**: false · **Account-guarded**: false

**Issues fixed vs v8**:
- APPLY-BLOCKING: the procedure depends on which branch is applied, and the merge decision is unresolved. release/verup (canonical apply branch) is provider ~4.0 with INLINE rules and NO preflight script; pr-84 (provider ~6.40, V6 separate-resource + split maintenance rule groups + preflight-renumber.sh, SHA da4ed751) is UNMERGED. Running the v8 simple apply AFTER pr-84 merges -> WAFInvalidParameterException (duplicate priorities, one UpdateWebACL per rule). Running the Confluence #39 preflight procedure against the live ~4.0 branch -> fails (scripts + maintenance_exchange/maintenance_point resources do not exist). Team must decide+confirm the branch state before apply and pick Path A or Path B accordingly.
- Local v8 row #47 is STALE: it encodes only Path A (simple apply matching the 2026-05-07 +5/~4 inline-rule plan) and does NOT mention the V6/maintenance-split migration the team has since documented in Confluence v62 #39 (refs the maintenance-split tickets). GROUND-TRUTH line 75 already flagged the v8/Confluence mismatch.
- Confluence v62 #39 after-check 'check on actual website' (curl of `dev.backseat-service.com`) IS satisfiable — **R2 correction:** the customer CloudFront distribution `E1BIDPQ5G0BYCB` (alias `dev.backseat-service.com`, Status Deployed) ALREADY EXISTS in point dev (`ground-truth/cloudfront.json`); the frontend-customer row is an in-place UPDATE, not a create. So curl the live distribution after apply. (The old "NO distribution yet / unsatisfiable" note was stale-greenfield and is wrong.) The authoritative waf-customer after-check remains the WebACL Console/CLI inspection.
- v8 row #47 after-check `aws wafv2 list-web-acls --scope CLOUDFRONT` is missing `--profile point-operator-dev` and has no account guard — risks running against the wrong account. Corrected after-check prepends `aws sts get-caller-identity --profile point-operator-dev` expecting 905418018638 and adds --profile to every call.
- Path B step 'preflight-renumber.sh --commit' performs a wafv2:UpdateWebACL WRITE and must be executed by the operator, NOT by an AI assistant (READ-ONLY enforcement). The dry-run (no --commit) is read-only and may be used to inspect the diff.
- Path B Case-3 (maintenance currently ON via legacy Lambda): the legacy single-brand maintenance rule must be swapped to the two split-brand rule groups in the SAME atomic UpdateWebACL, and CloudFront /exchange/maintenance/* + /point/maintenance/* paths + S3 content must be staged before --commit or customers hit 404. There is a transient window between the preflight commit and the waf-maintenance-lambda apply where neither old nor new Lambda can reliably toggle maintenance — run preflight + final apply + lambda apply in one window.
- Path B first apply may raise 'Provider produced inconsistent result after apply' on core_rule_set / country_restrict due to pre-existing ExcludedRules->RuleActionOverrides drift surfaced by the provider 6.x create-or-adopt pattern; recover via untaint+replan+apply (country_restrict has lifecycle prevent_destroy, so a destroy path is not available).


---

### Row #19 — `aurora`  ⚠ v8 inaccurate

**Intent**: Apply pending aurora changes to the EXISTING point-dev cluster: flip port 3306→13306 (reboot), add audit log export, enable auto_minor_version_upgrade on both instances, create KMS alias alias/point-aurora, drop legacy-dev account from KMS key policy, and re-version the master_user secret to carry the new port. NOT a greenfield cluster create.

**Manual (corrected apply steps)**:

WHY accurate=false: the v62/v8 row is built on a greenfield assumption that is STALE. Cluster `point` ALREADY exists and is in Terraform state (plan-output.txt:16,31,34-35 refresh without error). So two steps are WRONG: (a) 'verify greenfield: describe-db-clusters returns DBClusterNotFoundFault' — it returns Status=available, the verify as written FAILS; (b) 'POST bootstrap users via sql/bootstrap-users.sql' — there is NO sql/ dir in terraform/components/aurora, and the point/aurora/{master,editor,viewer}_user secrets already exist, so users are NOT bootstrapped here. The real apply is a HIGH-risk in-place port flip + reboot.

CORRECTED APPLY SEQUENCE (point-dev, profile point-operator-dev, account 905418018638; use --env dev, NOT dev-ex — this is the point side):
0. Account guard: aws sts get-caller-identity --profile point-operator-dev → 905418018638. Confirm maintenance window (no background job holds a 3306 connection).
1. PRE — DRIFT CHECK (replaces greenfield verify): confirm cluster `point` exists and is in TF state; run `cd terraform/components/aurora && ../../terraform.sh --env dev plan` and confirm the plan is +2 ~4 ⟳1 (KMS alias add, KMS policy update, secret_version replace, cluster port 3306→13306 + audit log, 2x instance auto_minor_version_upgrade). In terraform's summary line this reads as **`2 to add, 4 to change, 1 to destroy`** (R2-AURORA-01) — the **1 destroy is the `aws_secretsmanager_secret_version` REPLACE** for the port re-version, NOT a cluster destroy. NO create/destroy of the cluster itself. If plan shows the cluster being created/destroyed → STOP.
2. Gate 1 (SG): apply the security_group component so mysql-sg sg-007ebd984a0ba881c ingress allows 13306 (couples to the aurora port flip). If SG still only allows 3306, apps break post-reboot.
3. Gate 2 (NetworkPolicy): apply k8s-manifests/point/dev networkpolicy egress 3306→13306.
4. Gate 3 (Scale down — MANDATORY): kubectl scale deployment --all -n default --replicas=0; wait until no app pods remain. This also covers the secret re-version so no pod reads a transient version.
5. Gate 4 (Apply): `../../terraform.sh --env dev apply` — ✅ from the SSM point-bastion or laptop/CI (terraform talks only to the AWS API; the Aurora reboot does not affect the bastion). ❌ NOT from a pod. The port change reboots the cluster (~5-15 min).
6. Gate 5 (Secrets/JDBC sync — these are WRITE ops, run from bastion via SSM): bash terraform/tool/db-user-manager/aurora-update-port-in-secrets.sh (updates the 4 Aurora user secrets to port 13306) and aurora-update-spring-boot-secret.sh (updates SPRING_DATASOURCE_MASTER JDBC URL). These SYNC the port — they do NOT bootstrap users.
7. Gate 6 (Scale up): **⚠ R2-STATE-02 — DO NOT run `kubectl scale deployment --all --replicas=1` here.** That restores every deployment to 1 (downscaling any that ran >1) AND re-scales mid-window before elasticache/redshift. **In the single-window model (Gate G8) you do NOT restore per-row — restore ONCE at window end from `/tmp/replicas.txt` (box line ~108).** If aurora is the last stateful row in your window, do the file-driven restore here instead: `while IFS='=' read -r d n; do kubectl scale deployment "$d" -n default --replicas="$n"; done < /tmp/replicas.txt`.
8. Gate 7 (Verify): see console_primary 1-6; check pod logs for CannotCreateTransaction|Communications link failure|connect timed out|HikariPool.*Exception (NONE expected). Do NOT kubectl exec aws/mysql in-pod — use bastion for the SELECT 1.
9. Gate 8 (Cross-account KMS INFO): confirm no live resource in 845131030484 still depends on KMS key 4f29061e-... before the policy change removes that account.

**After-check ① CONSOLE (primary)**:

PRIMARY (AWS Console, account 905418018638, region ap-northeast-1) — verify the SIX deltas the fresh plan produces, NOT just "cluster available" (cluster pre-exists, so "available" is true before AND after the reboot and does not prove the apply landed):

1. Port flip (headline discriminator): Console → RDS → Databases → click cluster `point` → tab "Connectivity & security" → field "Port" = 13306 (was 3306). The reboot returns the cluster to "Available"; confirm the PORT actually changed, not just the status.
2. Audit log export: Console → RDS → Databases → `point` → tab "Configuration" → "Published logs / Log exports" list now includes `audit`.
3. Instance auto minor version upgrade: Console → RDS → Databases → expand cluster `point` → click writer instance `point-1` → tab "Maintenance & backups" (or "Configuration") → "Auto minor version upgrade" = Enabled (Yes). Repeat for reader instance `point-2` = Enabled.
4. KMS alias created: Console → KMS (Key Management Service, ap-northeast-1) → Customer managed keys → open key `4f29061e-d310-4ca0-8ed9-c0af8ae18a5e` → tab "Aliases" shows `alias/point-aurora`. On the "Key policy" tab, the policy root principal lists ONLY `arn:aws:iam::905418018638:root` (legacy-dev `845131030484` removed).
5. Secret re-versioned: Console → Secrets Manager → secret `point/aurora/master_user` → tab "Versions" → a new version carries staging label AWSCURRENT with a version id DIFFERENT from `77512B7B-D1DB-420C-9662-72721AEB7DE3`. (Do NOT click "Retrieve secret value" — not needed; the change is the embedded port, not the password.)
6. Functional reachability (from bastion via SSM Session Manager, NOT from the EKS pod — pod has no aws/mysql client): run a mysql one-liner against host port 13306 and expect `SELECT 1` → 1. EKS pods only re-read the secret via the CSI driver after scale-up; verify pod logs show no connection errors instead of running clients in-pod.

**After-check ② CLI (read-only fallback)**:

```bash
SECONDARY (read-only CLI, real IDs resolved). Account guard first:
aws sts get-caller-identity --profile point-operator-dev   # expect {"Account":"905418018638", ...}

# 1. Cluster exists + port flipped to 13306 (target the cluster by id `point`; `point-bk` does NOT exist in dev — only the single `point` cluster is present, live-verified 2026-06-08; do NOT wildcard regardless)
aws rds describe-db-clusters --profile point-operator-dev --region ap-northeast-1 --db-cluster-identifier point --query 'DBClusters[0].{Status:Status,Port:Port,Audit:EnabledCloudwatchLogsExports}'
# expect Status=available, Port=13306, Audit contains "audit"

# 2. Both instances auto_minor_version_upgrade = true
aws rds describe-db-instances --profile point-operator-dev --region ap-northeast-1 --filters Name=db-cluster-id,Values=point --query 'DBInstances[].{Id:DBInstanceIdentifier,AMU:AutoMinorVersionUpgrade}'
# expect point-1 / point-2 both AutoMinorVersionUpgrade=true

# 3. KMS alias alias/point-aurora targets the key, legacy-dev removed from policy
aws kms list-aliases --profile point-operator-dev --region ap-northeast-1 --key-id 4f29061e-d310-4ca0-8ed9-c0af8ae18a5e --query 'Aliases[].AliasName'
# expect contains "alias/point-aurora"
aws kms get-key-policy --profile point-operator-dev --region ap-northeast-1 --key-id 4f29061e-d310-4ca0-8ed9-c0af8ae18a5e --policy-name default --query Policy --output text
# expect root principal = arn:aws:iam::905418018638:root only (NO 845131030484)

# 4. Secret re-versioned (use describe-secret, NOT get-secret-value — keeps it read-only AND avoids disclosing the password)
aws secretsmanager describe-secret --profile point-operator-dev --region ap-northeast-1 --secret-id point/aurora/master_user --query 'VersionIdsToStages'
# expect an AWSCURRENT mapped to a version id != 77512B7B-D1DB-420C-9662-72721AEB7DE3
```

**Read-only safe**: true · **Account-guarded**: true

**Issues fixed vs v8**:
- NOT GREENFIELD: cluster `point` already exists and is in TF state (plan-output.txt:16,31). The v62/v8 after-check 'verify greenfield: describe-db-clusters returns DBClusterNotFoundFault' is WRONG and FAILS as written — it returns Status=available. The fresh plan is +2 ~4 ⟳1 (in-place updates), with NO cluster create/destroy.
- Stale 'available' after-check: because the cluster pre-exists and the port flip merely reboots it, 'Status: available' is true before AND after apply and does NOT prove the apply landed. The verification MUST assert the deltas: Port=13306, audit in log exports, alias/point-aurora present, instances auto_minor_version_upgrade=true, new master_user secret version.
- Wrong post-apply action: row says 'bootstrap users via sql/bootstrap-users.sql' — there is no sql/ dir in the aurora component and the point/aurora/* user secrets already exist. The correct post-apply WRITE step is aurora-update-port-in-secrets.sh + aurora-update-spring-boot-secret.sh from terraform/tool/db-user-manager/ (run from bastion) to sync the new port into the 4 user secrets + SPRING_DATASOURCE_MASTER JDBC URL.
- Overstated password-rotation risk in evaluation.md: the secret_version replace is driven by the embedded PORT change (3306→13306), not a password rotation — random_password.master_password[0] only refreshes (id=none) and is absent from the action list. After-check should use describe-secret (version label), not get-secret-value, and not warn about credential rotation.
- DESTRUCTIVE coupling (HIGH): port 3306→13306 triggers a cluster reboot (~5-15 min). Apply is blocked on (a) security_group raising mysql-sg sg-007ebd984a0ba881c to 13306, (b) K8s NetworkPolicy egress update, (c) scale all deployments to 0. ✅ Apply from the SSM point-bastion or laptop/CI (terraform talks only to the AWS API; the Aurora reboot does not affect the bastion) — ❌ never from an EKS pod. Coordinate with elasticache/redshift in the same maintenance window.
- Env-flag correctness: this is the point side — use `../../terraform.sh --env dev apply` (NOT dev-ex). dev-ex is the verup source account.
- Cross-account KMS cleanup (INFO): the apply removes arn:aws:iam::845131030484:root (legacy-dev) from KMS key 4f29061e-...'s policy. Confirm no live resource in 845131030484 still uses this key before applying.


---

### Row #17 — `elasticache`  

**Intent**: Recreate the `point` Redis replication group with at-rest + in-transit (TLS) encryption enabled (immutable attrs → forced replace), attach a new CMK, add the engine-log CloudWatch log group, and rewrite the point/SPRING_DATA_REDIS secret with the new TLS endpoint. Destructive: ~15-20 min downtime, cache data wiped (acceptable in dev).

**Manual (corrected apply steps)**:

ACCURATE per FRESH-PLAN-FINDINGS line 9 ("Matches checklist; confirm pods scaled to 0"). The v8 row #21 scale-to-0 -> plan/apply (replace) -> restore-replicas sequence is correct and kept. Note: NO separate rehearsal_secrets.sh step is needed — terraform itself rewrites point/SPRING_DATA_REDIS via aws_secretsmanager_secret_version.this (point/elasticache/main.tf:59-68), so pods only need a rollout/CSI re-read after the secret is updated. Verified/clarified sequence:

PRE-APPLY GATES:
1. Account guard: aws sts get-caller-identity --profile point-operator-dev => 905418018638.
2. App TLS code gate: confirm bs-integration-server with Lettuce useSsl().disablePeerVerification() + Redisson rediss:// (PR #1366 / commit 7f57c236d6e9) is the RUNNING pod image. Image tag is :latest, so verify by image DIGEST/label of the live pods, not by tag. If TLS code is NOT live, the recreated TLS-only cluster is unreachable and the app stays down past the window — BLOCK apply.
3. KMS alias pre-check: aws kms list-aliases --profile point-operator-dev --region ap-northeast-1 | grep elasticache-redis  => expect EMPTY (alias is 'will be created'; if it already exists, apply throws AlreadyExistsException).
4. Maintenance window JST Sun 23:30-Mon 00:00 (low traffic): downtime ~15-20 min, ALL active user sessions invalidated (point-app/point-admin store-type: redis), distributed locks re-acquired on reconnect, cache wiped (OK in dev).

PRE-STEP (scale to 0 — single-window model):
# ⚠ R2-STATE-01: DO NOT re-capture here. If you run this AFTER aurora/security_group already scaled to 0, the capture records all-ZEROS and the end-of-window restore brings everything back to 0 → namespace stays down. The ONE capture happened in the window-box (line ~99). Here, ONLY scale down:
kubectl scale deployment --all -n default --replicas=0   # /tmp/replicas.txt already holds the original counts from the window-box capture

APPLY (from terraform/components/elasticache):
../../terraform.sh --env dev plan   # expect 5 to add, 0 to change, 2 to destroy (replace pair). User runs apply (NEVER auto-apply):
../../terraform.sh --env dev apply   # replace forced by at_rest/transit/kms_key_id

POST-APPLY (restore replicas):
while read line; do d=${line%=*}; n=${line#*=}; kubectl scale deployment $d -n default --replicas=$n; done < /tmp/replicas.txt

Note on profile: terraform.sh uses --env dev (point dev = 905418018638); v8 row already correct.

**After-check ① CONSOLE (primary)**:

PRIMARY after-check — AWS Console (account 905418018638, region ap-northeast-1):
1. Console → ElastiCache → "Redis OSS caches" (older UI: "Redis clusters") → select replication group `point`.
   - Details / "Encryption" section: "Encryption at rest" = Enabled, with KMS key = alias `elasticache-redis` (the new CMK created by this apply). "Encryption in-transit" = Enabled.
   - "Number of nodes" = 2 (point-001 primary + point-002 replica), Multi-AZ = Enabled, Automatic failover = Enabled, Engine = Redis 6.2.6.
   - "Primary endpoint" = a NEW hostname `point.<newhash>.ng.0001.apne1.cache.amazonaws.com:6379` — it will NOT be the pre-apply `point.9srtan.ng.0001.apne1.cache.amazonaws.com` (that cluster was destroyed by the replace). Copy this new primary endpoint for step 4 and for the redis-cli secondary check.
   - "Backup" section: snapshot retention = 7 days, snapshot window = 22:00-23:00.
2. Console → CloudWatch → Log groups → confirm `/aws/elasticache/point/engine-log` exists (retention 30 days). The replication group's "Logs" tab should show an engine-log delivery to this group in JSON format.
3. Console → KMS → Customer managed keys → confirm a key with alias `elasticache-redis` exists, Key rotation = Enabled, Status = Enabled.
4. Console → Secrets Manager → select `point/SPRING_DATA_REDIS` → "Retrieve secret value": `SPRING_DATA_REDIS_HOST` = the new primary endpoint from step 1, `SPRING_DATA_REDIS_PORT` = 6379, `SPRING_DATA_REDIS_SSL` = "true".
5. (Functional, after pods scaled back up) Console → CloudWatch → Log groups → EKS application log group → confirm point-app/point-api/point-worker pods reconnected to Redis over TLS with no Lettuce/Redisson connection errors after rollout. Do NOT use kubectl exec ... aws/redis-cli — the pod image has no client tooling.
Anchor on the resource (`point`) + field VALUES above, not exact tab labels — the ElastiCache console relabels tabs periodically.

**After-check ② CLI (read-only fallback)**:

```bash
SECONDARY (read-only, account-guarded). Run from bastion or laptop with profile point-operator-dev:

# 0. Account guard (MANDATORY)
aws sts get-caller-identity --profile point-operator-dev   # expect Account 905418018638

# 1. Encryption flags + NEW endpoint in one read-only call (PRIMARY CLI check)
aws elasticache describe-replication-groups --replication-group-id point --profile point-operator-dev --region ap-northeast-1 --query 'ReplicationGroups[0].{AtRest:AtRestEncryptionEnabled,Transit:TransitEncryptionEnabled,KmsKeyId:KMSKeyId,Status:Status,Endpoint:NodeGroups[0].PrimaryEndpoint}'
#   expect: AtRest=true, Transit=true, Status=available, KmsKeyId=arn of the new CMK, Endpoint.Address = NEW point.<hash>.ng.0001.apne1.cache.amazonaws.com:6379

# 2. CMK + alias present
aws kms list-aliases --profile point-operator-dev --region ap-northeast-1 --query "Aliases[?AliasName=='alias/elasticache-redis']"

# 3. Engine-log group present
aws logs describe-log-groups --log-group-name-prefix /aws/elasticache/point/engine-log --profile point-operator-dev --region ap-northeast-1 --query 'logGroups[0].{name:logGroupName,retention:retentionInDays}'

# 4. Secret refreshed with TLS endpoint (discloses host/port only; SSL flag) — do NOT echo into committed files
aws secretsmanager get-secret-value --secret-id point/SPRING_DATA_REDIS --profile point-operator-dev --region ap-northeast-1 --query SecretString --output text | jq '{host:.SPRING_DATA_REDIS_HOST, port:.SPRING_DATA_REDIS_PORT, ssl:.SPRING_DATA_REDIS_SSL}'
#   expect ssl="true", host=new endpoint, port="6379"

# 5. (Deeper functional check — BASTION ONLY; private subnet + TLS; pod has no redis-cli)
HOST=$(aws elasticache describe-replication-groups --replication-group-id point --profile point-operator-dev --region ap-northeast-1 --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' --output text) && redis-cli --tls -h "$HOST" -p 6379 PING   # expect PONG
```

**Read-only safe**: true · **Account-guarded**: true

**Issues fixed vs v8**:
- APPLY-BLOCKING (pre-apply gate): The recreated cluster has transit_encryption_enabled=true, so it is reachable ONLY over TLS. The bs-integration-server TLS code (Lettuce useSsl().disablePeerVerification() + Redisson rediss://, PR #1366 / commit 7f57c236d6e9) MUST already be running in the point-dev pods before apply. If not, after apply every pod fails to connect to Redis and the app stays down past the maintenance window. Verify by live pod image DIGEST/label, not the :latest tag (pod image tag is :latest per CLAUDE.md, so the commit cannot be confirmed from the tag alone).
- After-check stale ID: the v8 row's `redis-cli --tls -h <host>` and the eval's `point.9srtan...` endpoint are the PRE-APPLY endpoint, which is DESTROYED by the replace. The after-check must read the new primary_endpoint_address post-apply (console or describe-replication-groups), otherwise it connects to dead DNS and fails. Same applies to the `endpoint` output (point.9srtan... -> known after apply).
- Cheap pre-apply check missing in row: `alias/elasticache-redis` is 'will be created'. If it somehow already exists (e.g. a partial prior apply) the apply throws AlreadyExistsException. GROUND-TRUTH does not list it (likely safe), but add `aws kms list-aliases --profile point-operator-dev | grep elasticache-redis` (expect empty) as a one-line pre-check.
- redis-cli PING must run from BASTION ONLY (private subnet + TLS). The EKS pod has no redis-cli/aws cli/curl (CLAUDE.md), so never `kubectl exec ... redis-cli`. Stated in cli_secondary step 5.
- Downtime/data-loss is real and CRITICAL (replace of aws_elasticache_replication_group): ~15-20 min outage, all Redis-backed user sessions invalidated (point-app/point-admin store-type: redis), cache wiped, distributed locks re-acquired on reconnect. Acceptable in dev but the apply MUST be inside the JST Sun 23:30-Mon 00:00 window with pods scaled to 0 first. No automated snapshot exists pre-apply (live snapshot_retention_limit=0 -> 7 only takes effect on the NEW cluster) — irrelevant in dev (cache), but for stg/prd this row needs a manual snapshot gate.
- Coordination dependency: this row is app-team coordinated (Redis SSL BB-1461). The secret rewrite is done by terraform (aws_secretsmanager_secret_version.this), so no rehearsal_secrets.sh is needed — but pods must re-read point/SPRING_DATA_REDIS after restore (CSI refresh / rollout) to pick up the new TLS endpoint.


---

### Row #18 — `redshift`  ⚠ v8 inaccurate

**Intent**: Re-key the live Redshift cluster `point` from the AWS-managed default key (alias/aws/redshift) to a new customer-managed CMK (alias/point-redshift) and flip require_ssl false→true (static param → reboot), via the disable-encryption→apply→reboot sequence. Plan: +2 (KMS key + alias) ~3 (cluster kms_key_id/apply_immediately/maint-window, parameter group require_ssl, snapshot cron) -0. Cluster is NOT greenfield and is already Encrypted:true.

**Manual (corrected apply steps)**:

Maintenance window JST: Mon 00:00-01:00 (DOWNTIME ~30-60 min). All commands --profile point-operator-dev --region ap-northeast-1.

PRE: aws sts get-caller-identity --profile point-operator-dev (expect 905418018638). Confirm cluster `point` is the AWS-managed key first: aws redshift describe-clusters --profile point-operator-dev --cluster-identifier point --query 'Clusters[0].KmsKeyId' should return .../key/9a03243f-a2dc-4e04-ac66-c8ad1a9580c9 (=alias/aws/redshift). Scale pods to 0: kubectl scale deployment --all -n default --replicas=0. **⚠ R2-STATE-01: do NOT re-capture `/tmp/replicas.txt` here** — the single capture already ran in the window-box (line ~99); re-capturing after an earlier stateful row scaled to 0 overwrites the file with all-zeros and the namespace never comes back up. Restore happens ONCE at window end (line ~108), not per-row.

STEP 1 (disable encryption to ENABLE the KMS swap — NOT because Encrypted is false; it is already true): aws redshift modify-cluster --profile point-operator-dev --cluster-identifier point --no-encrypted. Then wait: aws redshift wait cluster-available --profile point-operator-dev --cluster-identifier point. Confirm: aws redshift describe-clusters --profile point-operator-dev --cluster-identifier point --query 'Clusters[0].{Status:ClusterStatus,Encrypted:Encrypted}' returns Status=available, Encrypted=false.

STEP 2 (terraform): cd terraform/components/redshift && ../../terraform.sh --env dev plan (expect +2 ~3 -0: creates aws_kms_key.redshift[0] + aws_kms_alias.redshift[0] alias/point-redshift; sets cluster kms_key_id -> new CMK; require_ssl false->true; snapshot cron; apply_immediately/maint-window) && ../../terraform.sh --env dev apply.

STEP 3 (EXPLICIT reboot — require_ssl is a static parameter, ApplyType=static, BB-1503; the v8 row only says 'wait reboot complete' but never commands a reboot): aws redshift reboot-cluster --profile point-operator-dev --cluster-identifier point. Then aws redshift wait cluster-available --profile point-operator-dev --cluster-identifier point.

STEP 4 (restore pods): while read line; do d=${line%=*}; n=${line#*=}; kubectl scale deployment $d -n default --replicas=$n; done < /tmp/replicas.txt. Verify no SSL errors in pod logs.

AFTER-CHECK (corrected — must be DISCRIMINATING): (a) KmsKeyId now = new CMK behind alias/point-redshift and NOT 9a03243f-...; (b) alias/point-redshift exists with KeyRotationEnabled=true; (c) require_ssl=true on point-redshift-1-0-custom-params AND ParameterApplyStatus=in-sync; (d) psql one-liner via secret point/redshift/viewer_user -c 'show require_ssl' returns on. DO NOT rely on 'Encrypted: true' alone — it was already true pre-apply and is non-discriminating.

**After-check ① CONSOLE (primary)**:

PRIMARY (Console, region ap-northeast-1, logged in as IAM user bs-developer in account 905418018638). The cluster was ALREADY Encrypted:true before this apply, so an "Encrypted = true" check proves nothing. Verify the three things that actually change:

1) KMS key swapped to the new CMK (THE discriminator):
   Console → Amazon Redshift → Clusters → select cluster `point` → Properties tab → "Database configurations" / "Encryption" section → field "AWS KMS key" (or "Encryption key") MUST show `alias/point-redshift` (the new customer-managed CMK). It MUST NOT show `alias/aws/redshift` or key id `9a03243f-a2dc-4e04-ac66-c8ad1a9580c9` (the old AWS-managed default). Cluster Status = Available.

2) New CMK exists with rotation enabled:
   Console → Key Management Service (KMS) → Customer managed keys → find alias `point-redshift` → key detail → "Key rotation" tab shows "Automatically rotate this KMS key" = Enabled; Status = Enabled; Key policy contains a statement allowing service `redshift.amazonaws.com` to use the key.

3) require_ssl flipped on (BB-1503 — completely absent from the v8 after-check):
   Console → Amazon Redshift → Configurations → Parameter groups → select `point-redshift-1-0-custom-params` → Parameters tab → parameter `require_ssl` = `true`. Then confirm it actually took effect: Clusters → `point` → Properties → "Parameter group apply status" / "Cluster parameters" shows status = `in-sync` (NOT `pending-reboot`) — a static parameter only reports in-sync after the post-apply reboot completes.

(Verify exact tab labels against the live console while clicking; field name + expected value are confirmed from the fresh plan.)

**After-check ② CLI (read-only fallback)**:

```bash
SECONDARY (read-only CLI, account-guarded). Run guard first:
aws sts get-caller-identity --profile point-operator-dev   # expect Account 905418018638

# 1. KMS key is the new CMK, not the AWS-managed default (the real discriminator):
aws redshift describe-clusters --profile point-operator-dev --region ap-northeast-1 --cluster-identifier point --query 'Clusters[0].{Status:ClusterStatus,Encrypted:Encrypted,KmsKeyId:KmsKeyId}'
# Encrypted=true; KmsKeyId MUST be the new CMK ARN behind alias/point-redshift, and MUST NOT be arn:aws:kms:ap-northeast-1:905418018638:key/9a03243f-a2dc-4e04-ac66-c8ad1a9580c9

# 2. Confirm KmsKeyId resolves to alias/point-redshift and rotation is on:
aws kms list-aliases --profile point-operator-dev --region ap-northeast-1 --query "Aliases[?AliasName=='alias/point-redshift'].TargetKeyId" --output text
aws kms get-key-rotation-status --profile point-operator-dev --region ap-northeast-1 --key-id alias/point-redshift   # expect KeyRotationEnabled: true

# 3. require_ssl=true on the parameter group and applied (not pending-reboot):
aws redshift describe-cluster-parameters --profile point-operator-dev --region ap-northeast-1 --parameter-group-name point-redshift-1-0-custom-params --query "Parameters[?ParameterName=='require_ssl'].{Value:ParameterValue,Apply:ApplyType}"
aws redshift describe-clusters --profile point-operator-dev --region ap-northeast-1 --cluster-identifier point --query 'Clusters[0].ClusterParameterGroups[0].ParameterApplyStatus'   # expect in-sync after reboot

# 4. SSL enforced end-to-end (project one-liner form, secret-resolved host — no literal endpoint, viewer least-priv):
SECRET=$(aws secretsmanager get-secret-value --profile point-operator-dev --region ap-northeast-1 --secret-id point/redshift/viewer_user --query SecretString --output text) && PGPASSWORD="$(echo "$SECRET" | jq -r '.password')" psql -h "$(echo "$SECRET" | jq -r '.host')" -p 5439 -U "$(echo "$SECRET" | jq -r '.username')" -d "$(echo "$SECRET" | jq -r '.dbname // "point"')" -c "show require_ssl"

# 5. No secondary cluster (secondary_enabled=false / create_secondary_redshift=false):
aws redshift describe-clusters --profile point-operator-dev --region ap-northeast-3 --query 'Clusters[*].ClusterIdentifier'   # expect []
```

**Read-only safe**: true · **Account-guarded**: true

**Issues fixed vs v8**:
- AFTER-CHECK NON-DISCRIMINATING (apply-correctness): v8 row #22 after-check is `describe-clusters ... Encrypted: true`, but the cluster was ALREADY Encrypted:true before apply (GROUND-TRUTH row 49). This check passes even if the AWS-managed->CMK key swap silently failed. Must instead assert KmsKeyId = alias/point-redshift CMK and explicitly NOT alias/aws/redshift (key 9a03243f-a2dc-4e04-ac66-c8ad1a9580c9).
- MISSING require_ssl VERIFICATION: require_ssl false->true (BB-1503) is a primary outcome of this apply but is entirely absent from the v8 after-check. Add: describe-cluster-parameters require_ssl=true AND ParameterApplyStatus=in-sync, plus psql `show require_ssl` = on.
- MISSING EXPLICIT REBOOT (apply-blocking for the require_ssl outcome): require_ssl is a static parameter (ApplyType=static); it does not take effect until reboot. The v8 row says 'wait reboot complete' but never issues `aws redshift reboot-cluster`. Without the explicit reboot, require_ssl stays pending-reboot and SSL is NOT enforced.
- IMPRECISE NOTE FRAMING (not blocking): v8 note says disable->enable is needed 'because in-place toggle has known issues'. Correct reason: the disable step exists to ENABLE the AWS-managed->CMK key swap (direct apply is unsuccessful per BB-1561), not because the cluster was unencrypted. Disable step itself is CORRECT and required.
- PSQL STYLE VIOLATION (style, not blocking): v8 after-check `psql -h <host> -p 5439 -U viewer_user` hardcodes connection params; project mandate (CLAUDE.md) requires the Secrets Manager + jq one-liner via point/redshift/viewer_user. Corrected in cli_secondary.


---

### Row #21-24 — `eks`  ⚠ v8 inaccurate

**Intent**: Upgrade the live EKS cluster `point` (account 905418018638, dev) from v1.31 to v1.34 via a per-minor-version ladder (3 hops: 1.31→1.32→1.33→1.34), flip the cluster authentication mode CONFIG_MAP→API via a mandatory 2-step bridge (CONFIG_MAP→API_AND_CONFIG_MAP→API), and roll-replace all 5 managed node groups (admin/api/app/worker/mmh) onto 1.34 — with create-before-destroy rename so there is no downtime. Covers v8 checklist rows #27-31 and Confluence v62 rows #19-23.

**Manual (corrected apply steps)**:

PREREQUISITE (updated 2026-06-10): the per-version ladder branches NOW EXIST in bs-point-infra — `eks/1.31` (v21 + auth Stage 1 dual-mode at live 1.31), `eks/1.32`, `eks/1.33`, `eks/1.34`, `eks/auth-mode-bridge` were created and pushed 2026-06-10, each a small pinned delta on top of `release/verup` `376dc7be` (`eks/1.32` = 1.32 pins + live node-group/addon pins + `authentication_mode = "CONFIG_MAP"` + the main.tf access-entry gate; `eks/1.33` = identical except cluster_version 1.33; `eks/1.34` = gate + only the dev.tfvars authentication_mode pin to CONFIG_MAP, keeping HEAD's 1.34 pins; `eks/auth-mode-bridge` = single dev.tfvars line API_AND_CONFIG_MAP→API (Stage 2, PR #98; Stage 1 now lives on `release/verup` HEAD `376dc7be`)). The old `feat/migrate-eks-dev` branch is GONE from the remote (only `feat/migrate-eks-noderole-irsa-dev` remains, unrelated to the ladder). ⚠ Still NEVER apply `release/verup` HEAD directly while the cluster is CONFIG_MAP: HEAD pins terraform.tfvars cluster_version=1.34 AND cluster_node_version=1.34 AND node-group name suffix `-1-34-20260428` — i.e. a single 1.31→1.34 jump (AWS API rejects) plus 1.34 node groups on a sub-1.34 control plane (also rejected), plus a direct CONFIG_MAP→API flip. Editing only cluster_version per rung is INSUFFICIENT: the node-group NAME change to `-1-34-20260428` (terraform.tfvars) forces node-group replacement on EVERY rung, and a 1.34 node group cannot be created on a 1.32/1.33 control plane. Each rung therefore carries its own pinned config (cluster_version + cluster_node_version + node-group name) on its branch — use the branches, never HEAD.

CORRECTED SEQUENCE (run as IAM user bs-developer, account 905418018638; account-guard first; ✅ run from the SSM point-bastion or laptop/CI — both endpoint paths stay available: dev.tfvars keeps public_access=true alongside private_access=true):

Step 0 (PRE-APPLY FIXES, before any eks apply):
  (a) ✅ ALREADY FIXED at release/verup (R3-EKS-01, live-verified 2026-06-08 — `terraform/components/eks/tfvars/dev.tfvars` already has `named_user = "bs-developer"`; this is now a no-op, kept for history). [Original Bug B: change `named_user = "bs-operator"` → `named_user = "bs-developer"`.] `bs-operator` is NoSuchEntity in 905418018638 (stg-user leak); the real dev user is `bs-developer`. With `enable_cluster_creator_admin_permissions=false` (main.tf:144), a broken admin principal under API auth is an admin-lockout vector.
  (b) Apply the `ec2-cd-runner` component first so `point-cd-runner-role` exists (NoSuchEntity today) — otherwise the cd_runner access entry errors at apply. (Or import the role.)

Step 1 — VERSION LADDER (control plane only, 3 hops; the 1.30→1.31 row is OBSOLETE — live is already 1.31): for each of 1.32, then 1.33, then 1.34: `cd terraform/components/eks`; `git checkout eks/1.32` (then `eks/1.33`, then `eks/1.34`); `../../terraform.sh --env dev plan` (verify ONLY `aws_eks_cluster.this.version` steps exactly one minor); `../../terraform.sh --env dev apply`; `aws eks update-kubeconfig --name point --profile point-operator-dev`; verify `kubectl version` server = the rung version with no CrashLoopBackOff before proceeding to the next hop.

Step 2 — AUTH-MODE BRIDGE (2 applies, AFTER Step 0 principals are fixed; ⚠ RE-ARRANGED 2026-06-12: runs BEFORE the Step-1 version ladder, in the same window as the `eks/1.31` v21 apply; Stage 1 branch = `eks/1.31`, Stage 2 branch = `eks/1.31-api` `468f10f` — NOT `eks/auth-mode-bridge`, which pins 1.34 and is superseded): Stage 1 apply with `authentication_mode = API_AND_CONFIG_MAP`, verify all access entries resolve AND aws-auth ConfigMap still works in parallel; Stage 2 apply with `authentication_mode = API`. The direct CONFIG_MAP→API flip is empirically rejected by AWS (`Unsupported authentication mode update`, per BB-1515 apply log). v8 row #31 already has this 2-stage flow correct — keep it. (DEV runs both stages same night; STG/PRD split into two windows.)

Step 3 — NODE-GROUP REPLACE (LAST, after control plane = 1.34): on the `eks/1.34` config the node-group rename to `-1-34-20260428` forces create-before-destroy rolling replacement of all 5 groups. Per BB-1515 primary-source apply this is NO downtime (~10-11 min) — the rename is the mitigation, not the hazard. The `min_size=2` bump some notes suggest is OPTIONAL (create-before-destroy needs no headroom in the old group), not a blocker.

After each step run the console after-checks above; the Access-tab lockout check is the highest-value gate.

**After-check ① CONSOLE (primary)**:

PRIMARY after-checks (AWS Console as IAM user bs-developer in account 905418018638, region ap-northeast-1). All EKS-API-backed, so they work even after endpoint_private_access flips to true (a real reason console-first beats kubectl here).

1) LOCKOUT VERIFICATION (lead with this — proves the documented admin-lockout was avoided):
   Console → EKS → Clusters → select cluster `point` → Access tab →
     - "Authentication mode" = `EKS API` (i.e. authenticationMode=API) AFTER auth-bridge Stage 2. During the bridge intermediate step it reads `EKS API and ConfigMap`.
     - "Access entries" list MUST show the named_user entry with IAM principal ARN = `arn:aws:iam::905418018638:user/bs-developer` (NOT `user/bs-operator` — Bug B). Its access policy/group must grant admin.
     - The `cd_runner` access entry principal `arn:aws:iam::905418018638:role/point-cd-runner-role` must RESOLVE (role exists) — it is NoSuchEntity today, so ec2-cd-runner must be applied first.
     - Other entries present: custodian-AdministratorRole, custodian-CICDRole, custodian-OperatorRole, custodian-ViewerRole, point-bastion-role.

2) CONTROL-PLANE VERSION:
   Console → EKS → Clusters → `point` → Overview → "Kubernetes version" = `1.34`, Cluster status = `Active`. (Per-rung gate: after each ladder apply this field steps 1.32, then 1.33, then 1.34 — verify ONE step at a time; never skips a minor.)

3) NODE GROUPS (after the rename/replace runs LAST):
   Console → EKS → Clusters → `point` → Compute tab → Node groups → confirm 5 NEW groups named `node-group-point-admin-1-34-20260428`, `-api-1-34-20260428`, `-app-1-34-20260428`, `-mmh-1-34-20260428`, `-worker-1-34-20260428`, each Status = `Active`, Kubernetes version = `1.34`; the 5 OLD `…-20260505` / `worker-20260505-2` groups are gone. (Pre-replace, the Compute tab shows the 5 old `-20260505` groups at 1.34 control-plane / 1.31 nodes — that's the version-skew window before replacement.)

4) ADD-ONS:
   Console → EKS → Clusters → `point` → Add-ons tab → coredns = `v1.13.2-eksbuild.4`, kube-proxy = `v1.34.6-eksbuild.2`, vpc-cni = `v1.21.1-eksbuild.7`, and a NEW add-on `aws-secrets-store-csi-driver-provider` (v3.0.0-eksbuild.1) present and Active.

5) WORKLOAD HEALTH (kubectl, read-only — supplementary, NOT via `kubectl exec … aws`):
   `kubectl version` → server 1.34; `kubectl get nodes -o wide` → all kubeletVersion v1.34.x; `kubectl get pods -A` → no CrashLoopBackOff after each rung and after node replacement.

**After-check ② CLI (read-only fallback)**:

```bash
All read-only, account-guarded. ✅ Run from the SSM point-bastion (instance role, no --profile) or laptop/CI — these are AWS-API calls (eks describe-*), NOT k8s-endpoint calls, so VPC position is irrelevant; and dev.tfvars keeps cluster_endpoint_public_access=true alongside private_access=true, so there is NO private-only window either way.

# 0) Account guard (MANDATORY)
aws sts get-caller-identity --profile point-operator-dev   # expect Account 905418018638, user/bs-developer

# 1) Version + auth mode + status (cumulative end state = 1.34 / API)
aws eks describe-cluster --name point --profile point-operator-dev --region ap-northeast-1 --query 'cluster.{version:version,authMode:accessConfig.authenticationMode,status:status,pubEndpoint:resourcesVpcConfig.endpointPublicAccess,privEndpoint:resourcesVpcConfig.endpointPrivateAccess}' --output json
# expect after full migration: version="1.34", authMode="API", status="ACTIVE"; per-rung: 1.32 then 1.33 then 1.34; bridge intermediate: authMode="API_AND_CONFIG_MAP"

# 2) Access entries — Bug B + cd_runner lockout check
aws eks list-access-entries --cluster-name point --profile point-operator-dev --region ap-northeast-1 --output json
# expect principal arn:aws:iam::905418018638:user/bs-developer present (NOT user/bs-operator); arn:aws:iam::905418018638:role/point-cd-runner-role present and resolvable
aws iam get-role --role-name point-cd-runner-role --profile point-operator-dev   # must NOT be NoSuchEntity before eks apply
aws iam get-user --user-name bs-developer --profile point-operator-dev           # confirms the corrected dev principal exists (bs-operator is NoSuchEntity)

# 3) Node groups — resolve names live (new names do not exist pre-apply)
aws eks list-nodegroups --cluster-name point --profile point-operator-dev --region ap-northeast-1 --output json
# pre-apply: node-group-point-{admin,api,app,mmh}-20260505 + node-group-point-worker-20260505-2
# post-replace: node-group-point-{admin,api,app,mmh,worker}-1-34-20260428
for ng in $(rtk proxy aws eks list-nodegroups --cluster-name point --profile point-operator-dev --region ap-northeast-1 --query 'nodegroups[]' --output text); do aws eks describe-nodegroup --cluster-name point --nodegroup-name "$ng" --profile point-operator-dev --region ap-northeast-1 --query 'nodegroup.{name:nodegroupName,version:version,status:status}' --output json; done
# expect each version="1.34", status="ACTIVE"

# 4) Add-ons
aws eks list-addons --cluster-name point --profile point-operator-dev --region ap-northeast-1 --output json   # expect aws-secrets-store-csi-driver-provider present
aws eks describe-addon --cluster-name point --addon-name coredns --profile point-operator-dev --region ap-northeast-1 --query 'addon.addonVersion' --output text   # expect v1.13.2-eksbuild.4
```

**Read-only safe**: true · **Account-guarded**: true

**Issues fixed vs v8**:
- RESOLVED 2026-06-10 (was APPLY-BLOCKING): the per-version ladder branches the checklist references (eks/1.31, eks/1.32, eks/1.33, eks/1.34, eks/auth-mode-bridge) now EXIST in bs-point-infra — created and pushed 2026-06-10, each a small pinned delta on top of `release/verup` `376dc7be` with its own pinned config (cluster_version + cluster_node_version + node-group/addon pins; the three ladder rungs hold authentication_mode=API_AND_CONFIG_MAP — dual mode is applied BEFORE the ladder by eks/1.31 (module v21 + auth Stage 1 at live 1.31); a defensive access_entries={} gate remains for CONFIG_MAP only). `release/verup` HEAD still pins cluster_version=1.34 + cluster_node_version=1.34 + node-group suffix -1-34-20260428, i.e. a single 1.31→1.34 jump (AWS rejects: one minor at a time) PLUS 1.34 node groups on a sub-1.34 control plane — apply the branches in order, never HEAD.
- APPLY-BLOCKING (Bug B): tfvars/dev.tfvars:76 named_user = "bs-operator" is a stg→dev copy-paste leak. bs-operator is NoSuchEntity in account 905418018638 (verified live); the real dev user is bs-developer (base terraform.tfvars:51 is correct). With enable_cluster_creator_admin_permissions=false (main.tf:144), the CreateAccessEntry for the missing principal errors at apply AND flipping to API auth with a non-existent admin principal is an admin-lockout vector. Fix to bs-developer BEFORE the auth-mode bridge.
- APPLY-BLOCKING (Bug A): the cd_runner access entry targets arn:aws:iam::905418018638:role/point-cd-runner-role, which is NoSuchEntity today (verified). Apply the ec2-cd-runner component (or import the role) BEFORE eks, or CreateAccessEntry fails.
- ORDERING DISCREPANCY: Confluence v62 places the auth-mode bridge (row #19) BEFORE the version ladder (#20-23); the local v8 checklist places it AFTER (#27→#31). The opus evaluation validates the v8 order (ladder → bridge → node-group replace). Use v8; the auth bridge and node-group replace must both follow the control plane reaching 1.34.
- OBSOLETE ROW: v8 row #27 / Confluence #20 `eks (1.30→1.31)` is dead — live cluster is empirically already at 1.31. Only 3 hops remain (1.31→1.32→1.33→1.34). GROUND-TRUTH.md:51 '(4 jumps)' is an off-by-one — the correct count is 3 sequential minor upgrades.
- STALE downtime framing: the 5 node-group replacements are NOT a silent-downtime hazard. The name change to -1-34-20260428 forces create-before-destroy rolling replacement → no downtime per BB-1515 primary-source apply (~10-11 min). The min_size=2 bump previously suggested is optional, not required. The true constraint is version-skew: node-group replacement must run AFTER the control plane reaches 1.34.
- ✅ SUPERSEDED (re-assessed 2026-06-10 vs eks/tfvars/dev.tfvars @ d0625eca): bastion-apply OK. dev.tfvars sets cluster_endpoint_private_access=true AND cluster_endpoint_public_access=true — there is NO private-only window. Enabling private access ADDS in-VPC reachability; the public endpoint stays. The bastion reaches the cluster via NAT today and via the private endpoint after; laptop/CI keeps working via the public endpoint.


---

### Row #32 — `ec2-cd-runner`  

**Intent**: Greenfield +5 additive apply: creates the CD-runner EC2 host (t3.micro, private subnet, SSM-managed, kubectl auto-installed) plus its IAM role/instance-profile that lets GitHub Actions drive EKS rollouts over SSM (BB-1514). No destroys, no replacements.

**Manual (corrected apply steps)**:

PRE-STEP (prerequisite, by component name not row number — Confluence/v8 numbering is inconsistent: this row is #31 in Confluence-v62, #39 in v8): Verify the security_group component has been applied with cd_runner_enabled=true, so the security group cd-runner-sg EXISTS in account 905418018638. The ec2-cd-runner plan reads data.aws_security_group.cd_runner (data.tf:16, filter tag:Name=cd-runner-sg); if that SG is absent the plan ERRORS with 'no matching EC2 Security Group found' (still absent per ground-truth). Confirm: aws ec2 describe-security-groups --profile point-operator-dev --region ap-northeast-1 --filters Name=tag:Name,Values=cd-runner-sg --query 'SecurityGroups[].GroupId' returns one ID (not []).

APPLY: cd terraform/components/ec2-cd-runner && ../../terraform.sh --env dev init (if needed) && ../../terraform.sh --env dev plan (expect '5 to add, 0 to change, 0 to destroy' = 4 IAM + 1 EC2 once the SG exists; the recorded plan_failed run only reached +4 because the SG was missing) && ../../terraform.sh --env dev apply. Account guard first: aws sts get-caller-identity --profile point-operator-dev = 905418018638.

AMI NOTE: this host uses the SSM-latest AL2023 minimal AMI (/aws/service/ami-amazon-linux-latest/al2023-ami-minimal-kernel-default-x86_64), resolved at apply. Do NOT pin or verify ami-03598bf9d15814511 here — that is ec2-data-transfer's AMI.

EKS ACCESS-ENTRY CAVEAT (cross-row): the eks component declares an access entry for principal point-cd-runner-role (eks/main.tf:59-61, eks/dev.tfvars:64 cd_runner=point-cd-runner-role, kubernetes group 'cicd'). Because the EKS ladder/auth-mode rows apply BEFORE this row, that EKS apply will fail to create the cd_runner access entry until point-cd-runner-role exists. Either land ec2-cd-runner (this row) before the EKS auth-mode-bridge step, or pre-create/import point-cd-runner-role, OR confirm the access entry is reconciled in a post-#39 re-apply of eks. This caveat does NOT block ec2-cd-runner's own apply or boot — user_data.sh only calls 'aws eks describe-cluster' (covered by the inline eks:DescribeCluster policy) and installs the kubectl binary; it never runs kubectl against the cluster at boot, so the instance reaches Running+SSM-Online regardless of the access entry. APP COORDINATION (BB-1514): app team ports CI/CD-via-SSM + HOME=/root kubeconfig fix before the runner is used for rollouts (functional, post-apply — not an apply gate).

AFTER-CHECK: use the console-first block (EC2 Running + t3.micro/private-subnet/no-public-IP/IMDSv2/encrypted-gp3, Security tab IAM Role=point-cd-runner-role + SG=cd-runner-sg; IAM inline policy point-cd-runner-eks-access; SSM Fleet Manager node Online), CLI fallback as written.

**After-check ① CONSOLE (primary)**:

PRIMARY after-check (AWS Console, IAM user bs-developer in account 905418018638, region ap-northeast-1):

1) EC2 instance exists & healthy:
   Console -> EC2 -> Instances -> filter "tag:Name = point-cd-runner" -> exactly one instance, Instance state = Running, Status checks = 2/2 passed.
   - Details tab: Instance type = t3.micro; Subnet = subnet-0743df36e105ab5cc (point-private-subnet-apne1-az1, 172.18.21.0/24); VPC = vpc-0f49bf7456fa50d08; Public IPv4 address = - (none); IMDSv2 = Required ("Metadata accessible = Enabled", "Metadata version = V2 only").
   - Storage tab: Root volume Type = gp3, Encrypted = Yes.
   - Security tab: IAM Role = point-cd-runner-role; Security groups = cd-runner-sg (sg-id resolved post-apply by the security_group component).

2) IAM role + inline policy correct:
   Console -> IAM -> Roles -> point-cd-runner-role -> Trust relationships = Service ec2.amazonaws.com / sts:AssumeRole.
   - Permissions tab: managed policy AmazonSSMManagedInstanceCore attached; inline policy point-cd-runner-eks-access shows Action eks:DescribeCluster on Resource arn:aws:eks:ap-northeast-1:905418018638:cluster/point.
   Console -> IAM -> Roles -> point-cd-runner-role -> use of instance profile point-cd-runner-profile (or EC2 instance Security tab confirms the profile attachment).

3) SSM managed-node Online (runner reachable):
   Console -> Systems Manager -> Fleet Manager (or Node Management -> Session Manager -> Managed nodes) -> node point-cd-runner -> Ping status = Online, Platform = Amazon Linux 2023, SSM Agent version populated.
   (Online confirms the instance booted, the SSM agent installed by user_data.sh started, and the AmazonSSMManagedInstanceCore policy works. Do NOT rely on start-session as a verification — it is interactive, not a read-only check.)

**After-check ② CLI (read-only fallback)**:

```bash
SECONDARY (read-only CLI fallback, account-guarded; ✅ run from the SSM point-bastion — instance role, no --profile — or laptop/CI with profile point-operator-dev):

# 0) Account guard (MANDATORY)
aws sts get-caller-identity --profile point-operator-dev   # expect Account = 905418018638

# 1) EC2 instance running + key attributes (tag-based, no hardcoded instance-id — greenfield)
aws ec2 describe-instances --profile point-operator-dev --region ap-northeast-1 --filters Name=tag:Name,Values=point-cd-runner Name=instance-state-name,Values=running --query 'Reservations[].Instances[].{Id:InstanceId,Type:InstanceType,Subnet:SubnetId,Pub:PublicIpAddress,IMDS:MetadataOptions.HttpTokens,Prof:IamInstanceProfile.Arn,SGs:SecurityGroups[].GroupName}' --output table
#   expect: Type=t3.micro, Subnet=subnet-0743df36e105ab5cc, Pub=None, IMDS=required, Prof ends with instance-profile/point-cd-runner-profile, SGs includes cd-runner-sg

# 2) IAM role + inline eks:DescribeCluster policy
aws iam get-role --profile point-operator-dev --role-name point-cd-runner-role --query 'Role.AssumeRolePolicyDocument' --output json
aws iam list-attached-role-policies --profile point-operator-dev --role-name point-cd-runner-role --query 'AttachedPolicies[].PolicyArn'   # expect arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam get-role-policy --profile point-operator-dev --role-name point-cd-runner-role --policy-name point-cd-runner-eks-access --query 'PolicyDocument.Statement'   # expect eks:DescribeCluster on arn:aws:eks:ap-northeast-1:905418018638:cluster/point

# 3) SSM managed node Online
INST=$(aws ec2 describe-instances --profile point-operator-dev --region ap-northeast-1 --filters Name=tag:Name,Values=point-cd-runner Name=instance-state-name,Values=running --query 'Reservations[0].Instances[0].InstanceId' --output text) && aws ssm describe-instance-information --profile point-operator-dev --region ap-northeast-1 --filters Key=InstanceIds,Values=$INST --query 'InstanceInformationList[].{Id:InstanceId,Ping:PingStatus,Platform:PlatformName,Agent:AgentVersion}' --output table   # expect PingStatus=Online
```

**Read-only safe**: true · **Account-guarded**: true

**Issues fixed vs v8**:
- APPLY-BLOCKING (prerequisite): ec2-cd-runner plan FAILS with 'no matching EC2 Security Group found' (data.tf:16, filter tag:Name=cd-runner-sg) until the security_group component is applied with cd_runner_enabled=true. cd-runner-sg confirmed ABSENT in 905418018638 per ground-truth. The recorded plan_failed run reached only +4 (IAM) before aborting on this data source; full scope is +5 (4 IAM + 1 EC2) once the SG exists.
- CROSS-ROW ORDERING DEFECT (EKS apply may fail): the eks component declares an aws_eks_access_entry for principal point-cd-runner-role (eks/main.tf:59-61, eks/tfvars/dev.tfvars:64). The EKS ladder/auth-mode rows apply BEFORE this ec2-cd-runner row, but point-cd-runner-role does not exist yet (ground-truth: 'Missing... point-cd-runner-role'). AWS validates access-entry principal_arn at apply -> the cd_runner access entry creation fails until the role exists. Resolution: apply ec2-cd-runner before the EKS auth-mode-bridge step, OR pre-create/import point-cd-runner-role, OR confirm the access entry is reconciled in a post-#39 eks re-apply. (This does NOT block ec2-cd-runner's own apply/boot.) Note (2026-06-10): the ladder branches `eks/1.32`/`eks/1.33`/`eks/1.34` gate the module input to `access_entries = {}` while `authentication_mode == "CONFIG_MAP"` (AWS rejects CreateAccessEntry on a CONFIG_MAP cluster), so no rung attempts the cd_runner entry — it first materializes at the `eks/auth-mode-bridge` apply, by which point point-cd-runner-role must exist.
- AMI COPY-PASTE TRAP: do NOT verify ami-03598bf9d15814511 for this row — that is ec2-data-transfer's pinned AMI. ec2-cd-runner uses the SSM-latest AL2023 minimal AMI param (resolved at apply, plan-output.txt:9). Any after-check that pins an AMI ID here is wrong.
- PLACEHOLDER HYGIENE: instance-id, private IP, and cd-runner-sg sg-id are all greenfield (not created yet) and MUST be resolved post-apply by tag — never hardcode. The v8 row's after-check is already tag-based and correct; keep it tag-based.
- ASSIGNEE drift: v8 row #39 shows assignee TBD; Confluence-v62 puts ec2-cd-runner in the trung-assigned set. Fill assignee=trung before apply.


---

### Row #37 — `frontend-admin`  ⚠ v8 inaccurate

**Intent**: Switch the admin/back-office CloudFront distribution (alias bo.dev.backseat-service.com) from S3-website-endpoint origin to OAC + REST S3 origin, enable S3 versioning/BucketOwnerEnforced on admin.bs-point-dev, and destroy the legacy S3 static-website config (BB-1473 OAC redesign). Modifies the EXISTING distribution E3ETPFX8HYQZPU — not greenfield.

**Manual (corrected apply steps)**:

CORRECTED manual apply (local v8 row #45 = Confluence v62 row #37; NOT greenfield — modifies EXISTING distribution E3ETPFX8HYQZPU):

WHAT THE STALE ROW GETS WRONG:
1. 'Domain change required / admin.dev.backseat-service.com not covered, pick admin-dev.backseat-service.com (TBD)' is FALSE. The point dev.tfvars hard-codes route53_record = "bo.dev.backseat-service.com" (NOT admin.dev). That alias already has a live Deployed distribution E3ETPFX8HYQZPU. NO domain decision is required — drop the entire 'domain TBD blocks apply' / admin-dev.backseat-service.com narrative and the 'update tfvars aliases / add new Route 53 record' step.
2. 'use existing wildcard 07c7a840 ARN' is WRONG as a viewer-cert. 07c7a840 SANs = [*.backseat-service.com, backseat-service.com]. An ACM wildcard covers exactly ONE label, so it does NOT cover the level-3 host bo.dev.backseat-service.com. Pointing the distro at it would serve a non-matching SSL cert (browser TLS error). The component does not consume that ARN directly anyway — it resolves the cert via a data source.

THE REAL BLOCKER (two facets, keep separate):
(a) PLAN blocker: module-for-cloudfront/data.tf filters domain="dev.backseat-service.com" (exact) + types=["IMPORTED"] + statuses=["ISSUED"]. The only exact-domain match is cb4bfaf0 (dev.backseat-service.com), which is EXPIRED (2025-12-07) AND Type=AMAZON_ISSUED (not IMPORTED). Plan fails: 'no ACM Certificate matching domain (dev.backseat-service.com)'.
(b) COVERAGE: whatever cert resolves (a) must also cover the alias bo.dev.backseat-service.com (level-3). cb4bfaf0 DOES (SAN *.dev.backseat-service.com) but is expired; 07c7a840 does NOT.
=> Only correct fix (engineer decision, outside agent scope): re-IMPORT a non-expired cert for dev.backseat-service.com whose SANs cover bo.dev.backseat-service.com (e.g. *.dev.backseat-service.com), Type=IMPORTED, into ACM us-east-1, so BOTH the exact-domain + IMPORTED data-source filter (a) and viewer coverage (b) are satisfied. Do NOT prescribe retargeting to the wildcard — it fails coverage (b). (Alternatively the team edits data.tf filters AND the alias cert wiring, but that is a code change, not a checklist apply step.)

LIVE-STATE NOTE: the live distro E3ETPFX8HYQZPU currently serves cert 2f009235 (*.backseat-service.com, EXPIRED 2025-11-07) — already a broken cert independent of this apply.

CORRECTED STEP SEQUENCE:
0. Account guard: aws sts get-caller-identity --profile point-operator-dev = 905418018638.
1. PRE-APPLY GATE (BLOCKING): resolve the ACM cert per above (re-import dev cert covering bo.dev). Verify ISSUED + IMPORTED + future NotAfter (cli_secondary step 4).
2. PRE-APPLY GATE: confirm cloudfront-customer applied first (response_headers_policy static-html-header + server-header must pre-exist) and WAF point-cloudfront-admin exists in us-east-1 (verified present 2026-05-29).
3. PRE-APPLY GATE: confirm the bo.dev S3-website endpoint has no other consumer before the website-config destroy (CloudFront already fronts it).
4. cd terraform/components/frontend-admin && ../../terraform.sh --env dev init; ../../terraform.sh --env dev plan (expect ~3 add: s3 ownership_controls + s3 versioning + admin_s3 OAC; 1 destroy: s3 website_configuration; plus CloudFront distribution in-place change to OAC origin + new cert; 1 state move via moved.tf for OAI E1PAWB88AO28M5 = no infra change). Confirm plan exits 0 (data source resolves) — it currently exits 1.
5. ../../terraform.sh --env dev apply.
6. Run after-checks (console_primary / cli_secondary). The curl TLS check is contingent on the cert gate.

**After-check ① CONSOLE (primary)**:

PRIMARY (AWS Console, IAM user bs-developer in account 905418018638):

1. CloudFront (global console) → Distributions → select the distribution with alias `bo.dev.backseat-service.com` = ID `E3ETPFX8HYQZPU`.
   - General tab → Details: "Last modified" = Deploying then Deployed; Status = Enabled.
   - General tab → Settings → SSL certificate = a NON-expired ISSUED ACM cert (us-east-1) whose name/SAN covers `bo.dev.backseat-service.com` (a level-3 host). It MUST NOT be `2f009235-...` (the *.backseat-service.com cert currently attached, EXPIRED 2025-11-07) and MUST NOT be `07c7a840-...` (*.backseat-service.com — wildcard covers only one label, does NOT cover bo.dev). Expected: the renewed/re-imported `dev.backseat-service.com` cert (SAN `*.dev.backseat-service.com`).
   - Custom SSL minimum protocol = TLSv1.2_2021.

2. Same distribution → Origins tab:
   - Origin `s3_origin` → Origin domain changes FROM `admin.bs-point-dev.s3-website-ap-northeast-1.amazonaws.com` (S3 website endpoint, the pre-apply state) TO the REST endpoint `admin.bs-point-dev.s3.ap-northeast-1.amazonaws.com`; "Origin access" = Origin access control settings, OAC name = `bo-dev-backseat-service-com-oac`.
   - Origin `alb_origin` → domain `point-alb-2057198384.ap-northeast-1.elb.amazonaws.com`, Protocol = HTTPS only.
   - Origin `s3_maintenance_origin` → `maintenance.bs-point-dev.s3...` via Origin Access Identity (OAI) — unchanged.

3. Same distribution → Behaviors tab:
   - Default (`*`) → Origin `s3_origin`, Viewer protocol = Redirect HTTP to HTTPS, Response headers policy = `static-html-header`.
   - `/admin/*` → Origin `alb_origin`, Cache key/Cookies = whitelist `JSESSIONID`, `XSRF-TOKEN`; Response headers policy = `server-header`.
   - `/maintenance/*` → Origin `s3_maintenance_origin`.

4. WAF & Shield (us-east-1 / Global) → Web ACLs → Region = "Global (CloudFront)" → `point-cloudfront-admin` → Associated AWS resources includes distribution `E3ETPFX8HYQZPU`.

5. S3 → Buckets → `admin.bs-point-dev`:
   - Properties tab → Static website hosting = Disabled (this is the `aws_s3_bucket_website_configuration` destroy).
   - Properties tab → Bucket Versioning = Enabled (newly created by this apply).
   - Permissions tab → Object Ownership = "Bucket owner enforced" (ACLs disabled) — newly created by this apply.

NOTE (not a diff): the `moved.tf` state move `module.for_cloudfront[0].aws_cloudfront_origin_access_identity.this` → `module.for_cloudfront.aws_cloudfront_origin_access_identity.this` (existing OAI `E1PAWB88AO28M5`, the maintenance-origin OAI) is a Terraform state-record migration only — no Console-visible infra change.

**After-check ② CLI (read-only fallback)**:

```bash
SECONDARY (read-only CLI, ✅ run from the SSM point-bastion or laptop/CI — ❌ NOT from inside a pod (pods have no AWS CLI); account-guarded):

# 0. Account guard (MANDATORY first)
aws sts get-caller-identity --profile point-operator-dev   # expect Account=905418018638

# 1. Distribution status + cert + OAC + alias (single read)
aws cloudfront get-distribution --id E3ETPFX8HYQZPU --profile point-operator-dev --query 'Distribution.{Status:Status,Alias:DistributionConfig.Aliases.Items[0],Cert:DistributionConfig.ViewerCertificate.ACMCertificateArn,WebACL:DistributionConfig.WebACLId,S3Origin:DistributionConfig.Origins.Items[?Id==`s3_origin`].[DomainName,OriginAccessControlId]}' --output json
#   expect: Status=Deployed; Alias=bo.dev.backseat-service.com; Cert != .../2f009235... and != .../07c7a840...;
#   WebACL=arn:...webacl/point-cloudfront-admin/93e7a6f0-8c4a-4162-afec-67b76f34b523;
#   S3Origin DomainName=admin.bs-point-dev.s3.ap-northeast-1.amazonaws.com (REST, not s3-website-...) with a non-empty OAC id.

# 2. OAC exists by name
aws cloudfront list-origin-access-controls --profile point-operator-dev --query "OriginAccessControlList.Items[?Name=='bo-dev-backseat-service-com-oac']" --output json

# 3. S3 bucket: website config removed + versioning on + ownership enforced
aws s3api get-bucket-website --bucket admin.bs-point-dev --profile point-operator-dev   # expect NoSuchWebsiteConfiguration error after apply
aws s3api get-bucket-versioning --bucket admin.bs-point-dev --profile point-operator-dev --query 'Status'   # expect "Enabled"
aws s3api get-bucket-ownership-controls --bucket admin.bs-point-dev --profile point-operator-dev --query 'OwnershipControls.Rules[0].ObjectOwnership'   # expect "BucketOwnerEnforced"

# 4. Cert resolution (pre-apply gate verification)
aws acm describe-certificate --profile point-operator-dev --region us-east-1 --certificate-arn <ARN-of-renewed-dev-cert> --query 'Certificate.{Status:Status,SANs:SubjectAlternativeNames,Type:Type,NotAfter:NotAfter}' --output json
#   expect Status=ISSUED, Type=IMPORTED, SANs include a pattern covering bo.dev.backseat-service.com (e.g. *.dev.backseat-service.com), NotAfter in the future.

# 5. End-to-end TLS (contingent on cert gate resolved; fails today with expired cert)
curl -I https://bo.dev.backseat-service.com   # expect HTTP/2 200, valid TLS chain (issuer Amazon Trust Services or the imported CA)
```

**Read-only safe**: true · **Account-guarded**: true

**Issues fixed vs v8**:
- APPLY-BLOCKING (plan exits 1): module-for-cloudfront/data.tf data "aws_acm_certificate" "this" filters domain="dev.backseat-service.com" exact + types=["IMPORTED"] + statuses=["ISSUED"]. The only exact-domain match cb4bfaf0 is EXPIRED (2025-12-07) and Type=AMAZON_ISSUED (rejected by the IMPORTED filter). Error: 'no ACM Certificate matching domain (dev.backseat-service.com)'. Must re-import a valid cert before plan can complete.
- CHECKLIST CONTENT WRONG (stale): row #45/#37 says 'domain TBD — admin.dev.backseat-service.com not covered, choose admin-dev.backseat-service.com, update tfvars+Route53'. The configured alias is bo.dev.backseat-service.com (point dev.tfvars route53_record). No domain change/decision is required; the admin.dev framing and the tfvars-alias/new-Route53-record steps are spurious and should be removed.
- CHECKLIST CONTENT WRONG: row prescribes using the wildcard cert 07c7a840 (*.backseat-service.com). Its SANs are [*.backseat-service.com, backseat-service.com] — an ACM wildcard covers only one label, so it does NOT cover the level-3 alias bo.dev.backseat-service.com. Using it would serve a non-matching SSL cert (browser TLS failure). The correct cert must cover bo.dev (e.g. SAN *.dev.backseat-service.com).
- GREENFIELD ASSUMPTION WRONG: this is NOT a new distribution. Live distribution E3ETPFX8HYQZPU (bo.dev.backseat-service.com) is Deployed; the after-check must target E3ETPFX8HYQZPU, not a placeholder <id> resolved post-apply. The apply modifies it in place (S3 origin → OAC, website-config destroy, S3 versioning/ownership add).
- LIVE CERT DEFECT (pre-existing, independent of apply): distribution E3ETPFX8HYQZPU currently serves cert 2f009235 (*.backseat-service.com, EXPIRED 2025-11-07). The admin site already presents an expired/non-matching cert; the cert gate fixes this too but flag it so it is not mistaken for an apply regression.
- ORDERING PREREQ: data sources require (a) cloudfront-customer applied first (response_headers_policy 'static-html-header' + 'server-header' must pre-exist — confirmed by cloudfront.tf comment + evaluation) and (b) WAF point-cloudfront-admin present in us-east-1 (verified present 2026-05-29). Both must hold or plan fails on the data lookups.
- NON-BLOCKING: undeclared variables s3_index_document + s3_error_document set in terraform.tfvars but absent from variables.tf (orphaned from the removed S3-website design). Warning only; recommend cleanup post-apply.


---

### Row #38 — `frontend-customer`  ⚠ v8 inaccurate

**Intent**: In-place reconfiguration of the EXISTING customer CloudFront distribution E1BIDPQ5G0BYCB (alias dev.backseat-service.com): TLS 2019→2021, ALB origin http-only→https-only, geo blacklist→none, cookie whitelisting on /app/* and /api/*, Lambda@Edge swap (subdirectory-index:4 + html-cache-disabled:1), new s3_exchange origin; plus create exchange.bs-point-dev bucket and harden choice/doc/point bucket ownership+policies. NOT a new-distribution create.

**Manual (corrected apply steps)**:

PRE-FLIGHT (read-only, verified live 2026-05-29):
0. Account guard: aws sts get-caller-identity --profile point-operator-dev → 905418018638.
1. ALB HTTPS gate (cross-dep on security_group row #13/#46-SG): the customer distribution flips alb_origin to https-only. Live point-alb currently has ONLY an HTTP:80 listener (verified: arn .../point-alb/0b046b6abb5dc34b → [{Port:80,Protocol:HTTP}]). The security_group cutover (kubectl edit ingress.yaml alb-sg→alb-https-sg, listener HTTP:80→HTTPS:443, kubectl apply) MUST be complete so the ALB serves HTTPS:443 BEFORE — or co-timed with — this apply. Confirm via: aws elbv2 describe-listeners --load-balancer-arn arn:aws:elasticloadbalancing:ap-northeast-1:905418018638:loadbalancer/app/point-alb/0b046b6abb5dc34b --profile point-operator-dev shows Port 443 HTTPS active. If 443 is not yet active, applying this row creates a CloudFront→ALB origin-unreachable (502/503) window.
2. Lambda@Edge gate (verified PRESENT in us-east-1): html-cache-disabled version :1 EXISTS and subdirectory-index version :4 EXISTS. The old subdirectory-index-and-trailing-slash also still exists. No action needed — gate passes.
3. WAF gate (verified): web ACL point-cloudfront-customer is already attached to E1BIDPQ5G0BYCB (arn ...us-east-1...global/webacl/point-cloudfront-customer/30988cab...). Plan keeps it unchanged.
4. Data-source gate (verified): maintenance.bs-point-dev bucket EXISTS (data source resolves).
5. Cert: the distribution already uses the level-2 wildcard *.backseat-service.com (ACM 07c7a840, us-east-1, ISSUED) — this covers the single-label host dev.backseat-service.com. There is NO separate level-3 cert and NO alias/domain change in this plan (Aliases stay [dev.backseat-service.com]). The v8 'app.dev.backseat-service.com + separate level-3 cert' note is FACTUALLY WRONG — do not change the domain or cert.

APPLY:
6. Schedule a maintenance window: CloudFront propagation 5–15 min can cause transient 502/503 on the customer-facing dev.backseat-service.com (PR #52 / eval gate). Co-time with (or immediately after) the security_group ALB :443 cutover to avoid the origin-flip outage window.
7. cd terraform/components/frontend-customer && ../../terraform.sh --env dev init -upgrade (provider pinned aws ~> 4.0 (verup) → ~> 6.14.1 (point) — pinned to skip the 6.14.0 "Missing Resource Identity After Update" regression #44366; frontend-customer only, frontend-admin stays ~> 4.0; -upgrade re-locks, commit the regenerated lock) && ../../terraform.sh --env dev plan (expect +10 ~6 -2 ⟳0: creates exchange bucket + ownership_controls/versioning/policy/BPA; in-place CloudFront E1BIDPQ5G0BYCB; 6 in-place changes = cloudfront_distribution.this + origin_request_policy.websocket + s3_bucket_policy.{choice,doc,maintenance,this}; 2 destroys = aws_s3_bucket_acl.choice + .this, non-stateful sub-resources superseded by ownership_controls). NOTE the ~5→~6 bump: the older 21a4f4b6 plan read ~5; the maintenance-split commit e394685c (right after 21a4f4b6) refactored aws_s3_bucket_policy.maintenance (SID PublicRead→AllowCloudFrontGetObject), adding the 6th in-place change — current tip d0625eca plans +10/~6/-2. Two benign warnings: undeclared var route53_record in tfvars, deprecated managed_policy_arns — both non-blocking. ONE-TIME ACL pre-step before apply (choice/point carried public-read; destroying aws_s3_bucket_acl is a no-op so ownership_controls=BucketOwnerEnforced fails InvalidBucketAclWithObjectOwnership even though get-bucket-acl shows owner-only): aws s3api put-bucket-acl --bucket choice.bs-point-dev --acl private && aws s3api put-bucket-acl --bucket point.bs-point-dev --acl private. Then ../../terraform.sh --env dev apply.

AFTER-CHECK (corrected): use the console_primary delta click-path (TLS 2021, alb_origin https-only, geo none, /app/* + /api/* cookies, s3_exchange_origin, exchange bucket exists) — NOT a bare 'Deployed + 200', which passes pre-apply too. End-to-end curl on https://dev.backseat-service.com (NOT app.dev).

STG/PRD only (out of DEV scope): do NOT touch manually-created proxy/OAuth resources (Confluence Risk #3).

**After-check ① CONSOLE (primary)**:

PRIMARY after-check = verify the plan DELTAS, not just "Deployed" (the distribution was already Deployed and already returns 200 BEFORE apply, so a bare status/curl check does NOT prove the apply landed). Console as IAM user bs-developer in account 905418018638:

1) CloudFront (global console) → Distributions → select distribution ID `E1BIDPQ5G0BYCB` (Alternate domain name = `dev.backseat-service.com`) → General/Settings tab:
   - Status = Deployed; Last modified = today's apply time
   - Supported HTTP versions / Security policy: Minimum TLS = `TLSv1.2_2021` (was TLSv1.2_2019)
   - Custom SSL certificate = `*.backseat-service.com` (ACM cert `07c7a840-1513-47fb-9cea-08a08a38c643`, us-east-1) — SAME wildcard, no level-3 cert
   - AWS WAF = `point-cloudfront-customer` (us-east-1 CLOUDFRONT web ACL)
2) Origins tab → select origin `alb_origin` (point-alb-2057198384.ap-northeast-1.elb.amazonaws.com) → Origin protocol policy = `HTTPS only` (was HTTP only). Confirm a NEW origin `s3_exchange_origin` (exchange.bs-point-dev) is present.
3) Behaviors tab → confirm a NEW behavior `/exchange/*` exists; open behavior `/app/*` → Cookies = Whitelist `[_atnct, adm_adtr_xuid]` (was All); open `/api/*` → Cookies = None (was All); on Default (*) and content behaviors confirm Lambda function associations show `html-cache-disabled:1` (origin-response) and `subdirectory-index:4` (replacing subdirectory-index-and-trailing-slash:2).
4) Restrictions tab → Geographic restrictions = None (was Blacklist CU,IR,KP,SD,SY,VE).
5) S3 console (ap-northeast-1) → confirm bucket `exchange.bs-point-dev` now EXISTS → Properties: Bucket Versioning = Enabled; Permissions: Block all public access = On (all 4), bucket policy grants CloudFront OAI GetObject + DenyPutDelete; on buckets `choice.bs-point-dev` and `point.bs-point-dev` → Permissions → Object Ownership = `Bucket owner enforced` (ACLs disabled).
6) End-to-end: browser GET https://dev.backseat-service.com/ returns 200 over TLS1.2_2021 (issuer Amazon); GET https://dev.backseat-service.com/exchange/ resolves via the new s3_exchange origin.

**After-check ② CLI (read-only fallback)**:

```bash
Account guard FIRST: aws sts get-caller-identity --profile point-operator-dev  # expect Account 905418018638
# Distribution delta (global): aws cloudfront get-distribution --id E1BIDPQ5G0BYCB --profile point-operator-dev --query 'Distribution.{Status:Status,Aliases:DistributionConfig.Aliases.Items,MinTLS:DistributionConfig.ViewerCertificate.MinimumProtocolVersion,Cert:DistributionConfig.ViewerCertificate.ACMCertificateArn,WebACL:DistributionConfig.WebACLId,ALBOrigin:DistributionConfig.Origins.Items[?Id==`alb_origin`].CustomOriginConfig.OriginProtocolPolicy,Geo:DistributionConfig.Restrictions.GeoRestriction.RestrictionType}' --output json
#   expect Status=Deployed, MinTLS=TLSv1.2_2021, ALBOrigin=["https-only"], Geo=none, WebACL ends /point-cloudfront-customer/..., Cert=...07c7a840...
# New exchange origin present: aws cloudfront get-distribution --id E1BIDPQ5G0BYCB --profile point-operator-dev --query 'Distribution.DistributionConfig.Origins.Items[].Id' --output json   # expect s3_exchange_origin
# New S3 bucket created: aws s3api head-bucket --bucket exchange.bs-point-dev --profile point-operator-dev  # now exit 0 (was 404)
# Bucket ownership hardened: aws s3api get-bucket-ownership-controls --bucket choice.bs-point-dev --profile point-operator-dev --query 'OwnershipControls.Rules[0].ObjectOwnership'  # expect "BucketOwnerEnforced"
# Lambda@Edge gates (pre-apply, us-east-1): aws lambda list-versions-by-function --function-name html-cache-disabled --region us-east-1 --profile point-operator-dev --query 'Versions[].Version'  # contains "1"; subdirectory-index contains "4"
# End-to-end: curl -sI https://dev.backseat-service.com | head -1  # HTTP/2 200
```

**Read-only safe**: true · **Account-guarded**: true

**Issues fixed vs v8**:
- v8 row #46 after-check is non-discriminating: 'aws cloudfront get-distribution --id <id> returns Status: Deployed' + 'curl ... 200' both PASS before the apply (distribution E1BIDPQ5G0BYCB is already Deployed and already serves 200). The real verification is the in-place DELTAS (MinTLS 2019→2021, alb_origin http-only→https-only, geo blacklist→none, /app/* + /api/* cookie scoping, new s3_exchange_origin, new exchange.bs-point-dev bucket). Console_primary corrected to land on these.
- WRONG hostname: v8 row #46 says curl app.dev.backseat-service.com. Live distribution alias is dev.backseat-service.com (verified). The wildcard cert *.backseat-service.com covers single-label dev.* but would NOT cover two-label app.dev.* — so the v8 host is both wrong against live state and incompatible with the existing cert. Use dev.backseat-service.com.
- WRONG cert note: v8 says app.dev uses a SEPARATE level-3 ACM cert distinct from the wildcard. Live: the distribution already uses the SAME level-2 wildcard *.backseat-service.com (ACM 07c7a840, us-east-1) and the plan does NOT change the cert or aliases. Drop the separate-level-3-cert instruction.
- CROSS-ROW OUTAGE COUPLING (#13 security_group ↔ this row): live point-alb has ONLY HTTP:80; security_group removes :80 and adds HTTPS:443, while this row flips CloudFront alb_origin to https-only. These two rows sit far apart in the checklist. If security_group completes while this row still has the origin on http-only, CloudFront→ALB:80 fails → 502 until this row applies; conversely if this row applies before the ALB :443 listener is active, the https-only origin is unreachable. The origin flip MUST be co-timed with (or applied immediately after) the security_group :443 listener cutover.
- GROUND-TRUTH line 66 contradiction (documented override): GROUND-TRUTH.md states frontend-customer = app.dev.backseat-service.com with 'NO distribution yet → created by apply'. This is overridden by the fresh plan + live state: the plan modifies E1BIDPQ5G0BYCB IN-PLACE (alias dev.backseat-service.com, Deployed), the +10 'create' list contains NO aws_cloudfront_distribution, and there is no Aliases change. Tiebreaker = fresh plan + live describe; GROUND-TRUTH's own instruction was 'resolve <id> from fresh plan', which is honored here.
- Non-blocking plan warnings to expect (not row-blocking): (1) undeclared variable route53_record in tfvars/dev.tfvars (var present in verup tfvars, removed from variables.tf in the point port); (2) deprecated managed_policy_arns on aws_iam_role.this. Both harmless for this apply; note for future cleanup.

---

## How to use this checklist

1. **Clear ALL open APPLY-BLOCKING GATES first** — see the **§Gate status snapshot** (re-verified 2026-06-09 @ tip `6672bbb6`) at the top of the gates section for the current verdict. As of 2026-06-09 the still-open set is **G1, G4, G6, G7, G11, G12, G13, OPUS-GATE-A** (G2/G3/G8/G9/G10/G14 resolved-or-addressed; G5 superseded → Path B). Several are not code in this repo yet (EKS ladder branches G1; frontend-admin cert coverage G6; ACM ap-northeast-1 import G11) or require cross-account confirmation (G7, OPUS-GATE-A) — treat them as pre-work, not apply rows.
2. **Apply in canonical order** (the 39-row table). For each row, open its CONSOLE-FIRST card (trung rows) or run the standard `../../terraform.sh --env dev plan` (shuku rows), review the plan, apply, then run **After-check ① Console** as the primary gate and **② CLI** as the fallback.
3. **Stateful block** (#17/#18/#19/#20) runs as ONE Sunday-night window with a SINGLE scale-to-0 / restore (Gate G8 box) — never per-row.
4. ✅ **Run location — the SSM point-bastion is OK for all components, including vpc / security_group / eks** (re-assessed 2026-06-10; see pre-flight #5 for the per-component reasoning). ❌ Fall back to laptop/CI only if a re-plan deviates (new NACL/subnet/route/bastion-SG destroys).
5. **Every after-check is read-only + account-guarded.** Never `kubectl exec … aws …` (the pod has no aws/redis-cli/curl). Run DB/redis checks from bastion.
6. On a row failure, halt the wave and re-run `/verup-to-point-plan <component>` to refresh the plan-meta before retrying.

## Changelog
- **2026-06-09 — gate-status re-verification** (@ live `release/verup` tip `6672bbb6`, **3 commits past the pinned `46fb02e0`**): re-checked all 14 gates + OPUS-GATE-A against current code + live AWS in dev `905418018638`; added the **§Gate status snapshot** at the top of the APPLY-BLOCKING GATES section. ✅ RESOLVED: **G2** (`named_user="bs-developer"`, already fixed @`46fb02e0`), **G9/G10** (k8s `vpcId` + rbac apply path @`022f2ea4`), **G14** (SG module pin `~> 5.3` @`6672bbb6` — now COMMITTED, not worktree-staged). ⛔ Reconfirmed OPEN: **G1, G4, G6, G7, G11, G12, G13, OPUS-GATE-A**. Key corrections: **G6** — commit `2780b4be` (cert var → `*.backseat-service.com`) unblocks the *plan* but the alias `bo.dev.backseat-service.com` stays uncovered → **apply** fails `InvalidViewerCertificate` (plan-green/apply-red, NOT resolved); **G11** — dev 905 has **0 ACM certs in ap-northeast-1** (the cert exists only in us-east-1, not usable cross-region) → import the PEM into ap-northeast-1 before the row-#10 SG-swap window. ⚠ **The pin must advance to `6672bbb6`** (or cherry-pick the 3 commits) or G9/G10/G14 reappear at apply.
- **v9** (2026-05-29): Full evidence-based rewrite. Re-planned 7 critical components against live state (SHA `21a4f4b6`), built a ground-truth live inventory of account 905418018638, ran an 8-dimension apply-risk code review (60 findings) + opus second opinions. (a) Replaced all wrong-account hardcoded IDs; (b) corrected stale greenfield assumptions (aurora/redshift/eks/vpc already exist); (c) **made the AWS Console click-path the PRIMARY after-check** for every trung row, CLI secondary; (d) added 8 APPLY-BLOCKING GATES (EKS ladder branches missing, EKS Bug B admin-lockout, SG DependencyViolation, waf-customer branch conflict, frontend-admin expired cert, infra/audit cross-account Config role, single stateful scale-to-0); (e) reconciled the duplicated/drifted numbering into one canonical 39-row order; (f) dropped the obsolete eks 1.30→1.31 row + the unnecessary endpoints re-apply. Source: roadmap session `20260507T175629Z__roadmap__47535aaa` + fresh plans `docs/migrations/plans/dev/`.
- **v8** (2026-05-14): Coordination-with-app section; 47-row single table. (Superseded — contained the wrong-account IDs + greenfield assumptions corrected in v9.)
- v5-v7: single linear table evolution; waf-customer moved to tail.

> **Document status**: DRAFT v9 (2026-05-29). Per-row cards generated from per-component evidence agents over fresh `terraform plan` + live AWS read-only inspection. Target sinks: Confluence page `1851981830` (manual UI update — programmatic markdown push loses inline-comment markers) + full-module mirror `1854668802`. Companion HTML: `apply-checklist-DRAFT.html`.
