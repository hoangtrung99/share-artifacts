# release/verup apply-checklist — AWS-CLI verification report (DEV, 2026-06-08)

**Subject**: `apply-checklist-DRAFT.md` (v10, DEV-only) — every baseline/after-check/gate claim cross-checked against live AWS and against the code at the apply ref.
**Account verified**: `905418018638` (dev) via profile `point-operator-dev`, region `ap-northeast-1` (CloudFront/ACM in `us-east-1`). Account guard passed in all 5 domains.
**Code refs**: checklist pins fresh-plan SHA `46fb02e0`; live `release/verup` tip is `022f2ea4` (the SHA that would actually be applied). Both were read where they diverge.
**Method**: 5 parallel domain agents (Connectivity, Compute/EKS, Stateful, Security/WAF/Edge, Foundation/Governance), each running read-only `aws … describe/get/list` + `git show`/`git diff` against the two refs.

## Executive summary

**90 claims** were checked across the five domains. Outcome: **70 CONFIRMED**, **9 STALE-OR-WRONG**, **5 UNVERIFIABLE** (cross-account / cross-env), **6 NOT-YET-APPLIED** (after-checks that are expected to fail pre-apply and are not defects).

The headline **genuine-defect count is 7**, where a *genuine defect* means **wrong NOW at the apply ref `022f2ea4` and requiring a new fix action** (this is deliberately tighter than the 9 STALE-OR-WRONG count). The 7 split into:

- **4 infra/ops blockers (broken at the tip that will be applied)** — `G14` (security_group `terraform init` fails → row #10 cannot even plan), `G6-COVERAGE` + `G11` (no ISSUED ACM cert covers `bo.dev.backseat-service.com`, and zero regional ACM certs exist for the ALB ingress host), and `G12` (a dead `bs-operator` userarn in `aws-auth-cm.yaml`).
- **3 operator-misleading checklist errors (cause a wrong action at apply time)** — `R12-SECRETS-COUNT` (after-check expects 17, live+apply yields 18 → false STOP), `Row#7-redshift-point-sns` (checklist says the `redshift-point` subscription "refreshes unchanged"; in fact the apply will MODIFY its SNS sink → false HALT), and `G6-PLAN-BLOCKER-DRIFT` (the cert failure moved from plan-time to apply-time after a tfvar change).

**Critical synthesis insight**: of the 9 STALE-OR-WRONG findings, **3 (`G9`, `G10`, `DRIFT-plan-pin-stale`) describe code that is ALREADY FIXED at the tip** — commit `022f2ea4` ("fix(k8s): correct ALB controller vpcId and rbac apply path") repaired both the ALB-controller `vpcId` (legacy `0e139c5a` → correct `0f49bf74`) and the `k8s_apply.sh` rbac path (`$APP_DIR/rbac/` → `rbac/`). These are **stale-SHA-pin artifacts, not live defects** — the checklist merely pins `46fb02e0`, which predates the fix. The remaining 3 STALE entries (`Row10-card-body-row13`, `R19-POINTBK-CLUSTER`, `Row#7-depends-on-numbering`) are cosmetic. A large block of HIGH-severity rows (`G1`, `R3-EKS-01`, `OPUS-GATE-A` ×4, `G7` ×2, `G13`) are **CONFIRMED-accurate gates** — they describe real apply risks that the checklist already captures correctly; they are operator procedure, not artifact defects.

The single most important genuine defect is **`G14`**: it is the earliest, purely in-repo, unambiguous apply-stopper.

---

## Top issues to fix (ranked)

Union of every STALE-OR-WRONG (9) and every HIGH-severity item (13), deduped on `G6-PLAN-BLOCKER-DRIFT` (which is both) → **21 unique rows**. Sorted by severity (HIGH→LOW), then `fix_target` in apply-blocking order (`infra-code-fix` → `procedure-change` → `doc-correction` → `none`).

| id | component | classification | what's wrong (observed vs claimed) | fix_target | proposed fix | severity |
|----|-----------|----------------|------------------------------------|------------|--------------|----------|
| G14-sg-module-unpinned-init-fail | security_group (#10) | CONFIRMED | `terraform init` FAILS at HEAD: 7 unpinned `terraform-aws-modules/security-group/aws` blocks (eks.tf:2,78 / mysql.tf:2,33 / redis.tf:2 / redshift.tf:4,59) resolve to v6.0.0 (needs aws ≥6.29) vs versions.tf pin `aws ~> 4.0`. Observed: init-output.txt:30 `no available releases match … ~> 4.0, >= 6.29.0`. Plan never runs → row #10 blocked. | infra-code-fix | Pin `version = "~> 5.3"` in all 7 module blocks (5.3.x requires only aws ≥3.29, intersects `~> 4.0`; 6.0.0 requires ≥6.29). Re-run `init && plan` to confirm +/~/- before the SG window. | HIGH |
| G6-COVERAGE-BLOCKER | frontend-admin (#37) | CONFIRMED | Whatever cert resolves must cover alias `bo.dev.backseat-service.com`; `07c7a840` (`*.backseat-service.com`, ISSUED/IMPORTED) does NOT (a level-2 wildcard covers only one label). No ISSUED cert covering `*.dev.backseat-service.com` or `bo.dev.backseat-service.com` exists in us-east-1 (only EXPIRED `cb4bfaf0` had `*.dev.*` coverage). | infra-code-fix | Import an ISSUED+IMPORTED cert covering `*.dev.backseat-service.com` (or exact `bo.dev.backseat-service.com`) into us-east-1 before apply. Cert-ops action outside the apply ladder; pre-apply blocker. | HIGH |
| G1-eks-ladder-branches | eks (#21-24) | CONFIRMED | Ladder/bridge branches `eks/1.32`, `eks/1.33`, `eks/1.34`, `eks/auth-mode-bridge` do NOT exist; only `feat/migrate-eks-dev` (single 1.31→1.34 jump + direct CONFIG_MAP→API). dev.tfvars pins cluster_version=1.34. | procedure-change | Create the 4 per-version/bridge branches (each pinning cluster_version + node_version + node-group suffix to one minor) before any eks apply. Never apply `feat/migrate-eks-dev` HEAD directly. Gate body accurate. | HIGH |
| G13-NOTIF-topic-absent | notification (#7) | CONFIRMED | `alert-lambda-event-notification` SNS topic does NOT exist in 905418018638 → fresh `notification` plan fails at refresh. (`alert-lambda-infra` does exist.) | procedure-change | Apply `secrets_manager` → `event-notification` (Group C) → `notification` before Row #7, per R3-NOTIF-01 chain. Gate accurate. | HIGH |
| G7-R3-AUDIT-01-config-role | infra/audit (#2) | CONFIRMED | `bs-aws-config-role` EXISTS and is NOT dormant (RoleLastUsed=2026-06-08T11:04:29Z; **re-checked 2026-06-09 → RoleLastUsed=2026-06-09**, both recorders still on it, recording=SUCCESS); both Config recorders (ap-ne-1 + us-east-1) currently use it. Destroying it after a cross-account role switch is HIGH risk. | procedure-change | Verify the 211125716602 cross-account role trust BEFORE apply; defer via `-target` (the 9 modules except `module.config`) until G7/Gate1 clears. **Targeted plan VERIFIED 2026-06-09 @ `d0625eca`: config-excluded = `+11/~3/-0`, 0 destroy, no `211` ref, MED** (`../../plans/dev/infra/audit-no-config/`). Config end-state (revert-to-local vs converge-to-211) is an OPEN engineer decision — `../../verup-to-point/audit-config-drift-analysis.md`. Gate accurate. | HIGH |
| G7-crossaccount-role-trust | infra/audit (#2) | UNVERIFIABLE | Both recorders flip role_arn to `arn:aws:iam::211125716602:role/cm-config-role-all-regions` (point-prd); that role+trust must exist and allow `config.amazonaws.com` from 905418018638. Not inspectable from dev profile. | procedure-change | Operator confirms `cm-config-role-all-regions` exists in 211125716602 with the right trust, from a profile holding that account, before apply. After-check #3a is correctly NOT-YET-APPLIED. | HIGH |
| OPUS-GATE-A-Admin-trust | infra/iam | CONFIRMED | Live `custodian-AdministratorRole` trusts `590183696997:root` + `728927523062:root` (SourceIp 0.0.0.0/0, MFA); HEAD tfvars `accept_user_arns=['905418018638']` + 2 Cloudflare /32s would silently DROP both cross-account roots and narrow SourceIp. AdministratorAccess attached; plan never detaches. | procedure-change | Diff each role's live trust vs HEAD; get sign-off on dropped principals + SourceIp narrowing + retained AdministratorAccess before apply. Gate accurate. | HIGH |
| OPUS-GATE-A-Operator-trust | infra/iam | CONFIRMED | Live `custodian-OperatorRole` trusts `590183696997:root` (+905…), SourceIp 0.0.0.0/0; HEAD drops 590183696997 and narrows SourceIp. AdministratorAccess attached. | procedure-change | Same sign-off; confirms the 590183696997-on-Operator drop. | HIGH |
| OPUS-GATE-A-Viewer-trust | infra/iam | CONFIRMED | Live `custodian-ViewerRole` trusts `728927523062:root` (+905…), SourceIp = NINE /32s; HEAD drops 728927523062 and narrows 9 IPs → 2 Cloudflare /32s. (More IPs at risk than gate's "0.0.0.0/0" implies for this role.) | procedure-change | Capture the 9-IP detail in sign-off alongside the dropped principal. | HIGH |
| OPUS-GATE-A-CICD-trust | infra/iam | CONFIRMED | Live `custodian-CICDRole` trusts `user/bs-cicd-test` AND `user/cicd`; HEAD `accept_user_arns=[…user/cicd]` drops `bs-cicd-test`. AdministratorAccess attached. | procedure-change | Note `bs-cicd-test` drop; `user/cicd` kept; AdministratorAccess retained as gate states. | HIGH |
| R3-EKS-01-authmode-API | eks (#21-24) | CONFIRMED | dev.tfvars hardcodes `authentication_mode = "API"` (both refs) + `enable_cluster_creator_admin_permissions=false`; live cluster is CONFIG_MAP; no bridge branch (G1). A single apply IS a direct CONFIG_MAP→API flip, which AWS rejects (and risks total admin lockout given `point-cd-runner-role` NoSuchEntity). | procedure-change | Enforce staged auth-bridge (CONFIG_MAP→API_AND_CONFIG_MAP→API) via the G1 bridge branch; never apply the API-pinned HEAD directly. Pairs with G1. | HIGH |
| G6-PLAN-BLOCKER-DRIFT | frontend-admin (#37) | STALE-OR-WRONG | Claimed: plan exits 1 because `module-for-cloudfront/data.tf` filters `domain=dev.backseat-service.com` → 0 matches. Observed DRIFT 46fb02e0→022f2ea4: `frontend-admin/tfvars/dev.tfvars cloudfront_certificate` changed `dev.backseat-service.com` → `*.backseat-service.com`. At tip the data source RESOLVES to `07c7a840`, plan SUCCEEDS at that line; the failure moved to APPLY (CloudFront rejects, cert doesn't cover `bo.dev`). | doc-correction | Re-word G6/Row #37 facet (a): at HEAD the wildcard resolves so plan succeeds; failure is now an APPLY-time CloudFront alias-coverage rejection. Keep facet (b) as the live HIGH blocker (see G6-COVERAGE). Note the pinned-SHA divergence. | HIGH |
| G11-ACM-REGIONAL | k8s ingress | CONFIRMED | `aws acm list-certificates --region ap-northeast-1` returns `[]` (zero regional certs of any status); `ingress.yaml` has no `certificate-arn` → ALB listener creation would fail. | none (cert-ops) | No doc change. Owner action: issue/import a regional ACM cert or add `certificate-arn` to `ingress.yaml` before the SG-swap window. Same class of action as G6-COVERAGE. | HIGH |
| DRIFT-plan-pin-stale | (cross-cutting) | STALE-OR-WRONG | Checklist pins code/plan at `46fb02e0` and derives per-row +N/~N/-N from it; live tip is `022f2ea4`, ahead by the commit that fixed two apply-blocking k8s gates (G9 vpcId, G10 rbac). The pinned-SHA plan predates real fixes. | doc-correction | Re-pin to the apply ref `022f2ea4` (or chosen apply SHA); re-run k8s `kubectl diff` + any plans whose code changed between the two SHAs before trusting per-row counts. At minimum annotate G9/G10 as fixed-after-pin. | MED |
| G10-k8s-apply-rbac-path | k8s-manifests | STALE-OR-WRONG | `k8s_apply.sh:81` = `kubectl apply -f $APP_DIR/rbac/` (= `point/dev/rbac/`, ABSENT) @ 46fb02e0 (real defect) BUT = `kubectl apply -f rbac/` @ tip `022f2ea4` (CORRECT; `k8s-manifests/rbac/clusterrolebinding-admin.yaml` name=`admin-cluster-admin` exists). Fixed by `022f2ea4`. | doc-correction | Mark G10 RESOLVED at tip — no infra fix needed. Re-pin SHA so an operator does not run the broken `$APP_DIR/rbac/` form. After-check `kubectl get clusterrolebinding admin-cluster-admin` is valid. | MED |
| G9-alb-controller-vpcid | k8s-manifests | STALE-OR-WRONG | `aws-load-balancer-controller.yaml:140` `vpcId` = legacy-`vpc-0e139c5a0789db4c0` @ 46fb02e0 (real defect) BUT = `vpc-0f49bf7456fa50d08` (correct target, matches live cluster) @ tip `022f2ea4`. Fixed by `022f2ea4`. | doc-correction | Mark G9 RESOLVED — code already correct at the tip that will be applied. Re-pin SHA so operators don't re-introduce the wrong vpcId from the stale pin. | MED |
| R12-SECRETS-COUNT | secrets_manager (#12) | STALE-OR-WRONG | Claimed: 16 `point/*` pre-existing, total 17 after apply. Observed: `point/*` = **17 NOW** (16 component-managed + 1 unmanaged `point/exc` not in `secrets_manager_keys`); `event-notification-to-slack` genuinely absent. After apply → **18**, not 17. The `length(SecretList)` after-check counts `point/exc` (filter is by `point/` prefix). | doc-correction | Fix baseline to "17 exist now (16 managed + 1 unmanaged `point/exc`)"; after-checks must read "18 after apply (17 pre-existing + 1 new)". Keep "+1 add" and "16 component-managed refresh clean" as-is. | MED |
| Row#7-redshift-point-sns-mismatch | notification (#7) | STALE-OR-WRONG | Claimed: `redshift-point` routes to `alert-lambda-event-notification` and pre-existing subs "refresh unchanged" (HALT on any change). Observed: live `redshift-point` routes to `alert-lambda-infra`; HEAD `notification/redshift.tf:3` manages it to `alert-lambda-event-notification` → apply WILL MODIFY its sink. The "unchanged" wording + L362 HALT will trigger a false HALT. | doc-correction | Correct L350/L355/L411: `redshift-point` CURRENTLY routes to `alert-lambda-infra`; HEAD re-points it → plan shows in-place MODIFY of `aws_redshift_event_subscription.this` (sns_topic_arn). Exempt this expected re-route from the L362 HALT. Makes `event-notification` a hard prerequisite for `redshift-point` too. | MED |
| R19-POINTBK-CLUSTER | aurora (#19) | STALE-OR-WRONG | L933 comment justifies not-wildcarding by "a separate `point-bk` cluster also exists". Observed: only ONE Aurora cluster `['point']`; `point-bk` → DBClusterNotFoundFault. | doc-correction | Remove/correct the parenthetical at L933. Targeting `--db-cluster-identifier point` stays correct; the stated reason is false for dev (cluster may exist in another account/env, not checkable here). | LOW |
| Row#7-depends-on-numbering | notification (#7) | STALE-OR-WRONG | Card body L365 says "AFTER sns-alert (#8)"; apply-order table lists sns-alert as row #5 and notification depends on 5. Leftover v8 numbering (L409 self-labels "local v8 #8"). Dependency is correct; only the row number is stale. | doc-correction | Change L365 "(#8)" → "(#5)". | LOW |
| Row10-card-body-row13-numbering | security_group (#10) | STALE-OR-WRONG | Card title (L484) and order-table call it row #10, but the manual body (L490) opens "ROW #13 security_group" and references "v8 row #13". Leftover v8 numbering. | doc-correction | Replace "ROW #13" with "Row #10" in the card body (keep "v8 row #13" only where explicitly describing the old numbering). Cosmetic. | LOW |

---

## Fix plan by owner

Built from `fix_target` across all 90 claims (broader than the top table).

### (a) infra-code-fix — bs-point-infra code that MUST change before apply

1. **G14 (HIGH) — `terraform/components/security_group/`**: pin `version = "~> 5.3"` on all 7 `terraform-aws-modules/security-group/aws` module blocks (`eks.tf:2,78`, `mysql.tf:2,33`, `redis.tf:2`, `redshift.tf:4,59`). Without this, `terraform init` fails and row #10 (the CRITICAL alb-sg 3-phase swap) cannot plan or apply. Re-run `init && plan` afterward to re-establish the per-row +/~/- counts. **This is the #1 blocker.**
2. **G6-COVERAGE (HIGH) — ACM (us-east-1), cert-ops**: import an ISSUED+IMPORTED cert covering `*.dev.backseat-service.com` (or exact `bo.dev.backseat-service.com`) before the frontend-admin apply. Not a `.tf` edit but a required pre-apply repo/cert prerequisite. **Pair with G11.**
3. **G11 (HIGH) — ACM (ap-northeast-1) + `ingress.yaml`, cert-ops** *(orphan: HIGH but no `fix_target` in the raw findings; action is identical to G6-COVERAGE)*: issue/import a regional ACM cert covering the ALB ingress host, or add `certificate-arn` to `ingress.yaml`. Zero regional certs exist today. Do before the SG-swap window.
4. **G12 (MED) — `k8s-manifests/point/dev/aws-auth-cm.yaml:35`**: change `userarn` from `…:user/bs-operator` (NoSuchEntity in dev) to `…:user/bs-developer`, or drop the `mapUsers` block entirely (mapRoles already grant cluster-admin via `custodian-AdministratorRole` + `point-bastion-role`). Non-blocking (a non-existent user in mapUsers is a dead entry; once EKS flips to API auth the ConfigMap is ignored) but a real wrong value at the tip.

### (b) procedure-change — apply steps / order that must be enforced

1. **G1 + R3-EKS-01 (HIGH) — eks**: create the 4 per-version/bridge branches and apply the staged auth-bridge (CONFIG_MAP → API_AND_CONFIG_MAP → API). Never apply `feat/migrate-eks-dev` / the API-pinned HEAD directly. Primary HIGH apply-blocker pair.
2. **G13-NOTIF-topic-absent (HIGH) — notification ordering**: apply `secrets_manager` → `event-notification` (Group C) → `notification` so `alert-lambda-event-notification` exists before Row #7 (it is now a prerequisite for `redshift-point` too — see Row#7 doc-correction).
3. **G7 + G7-crossaccount (HIGH) — infra/audit**: confirm `cm-config-role-all-regions` exists in 211125716602 with `config.amazonaws.com` trust from 905418018638 (from a profile holding that account) BEFORE apply; use the Scope-option deferral (`-target` the 9 modules except `module.config`) until that gate clears. The config-excluded targeted plan is VERIFIED 2026-06-09 `+11/~3/-0` (0 destroy, no `211` ref, MED). Keep Config recording ON across the swap. Config end-state is an OPEN A-vs-B decision (`../../verup-to-point/audit-config-drift-analysis.md`).
4. **OPUS-GATE-A ×4 (HIGH) — infra/iam**: before importing the custodian roles, diff each role's live trust vs HEAD and obtain sign-off on the dropped cross-account principals (590183696997 on Admin+Operator; 728927523062 on Admin+Viewer; `bs-cicd-test` on CICD) and the SourceIp narrowing (notably Viewer's 9 → 2 /32s). Confirm AdministratorAccess stays attached where expected.
5. **R2-EKS-IAM-01 (MED) — eks**: keep the manual gate verifying the v17→v21 module re-attaches the 5 destroyed IAM policy attachments among the +34 adds, and that `AWSServiceRoleForElasticLoadBalancing` exists. Module version premise (`~> 21.1.0`) confirmed.
6. **R3-K8S-CSI-01 (MED) — app image**: keep the manual gate verifying the deployed `bs-integration-server :latest` image contains the `SecretsEnvironmentPostProcessor` CSI bridge before applying the CSI-migrated deployments. UNVERIFIABLE from this account (infra side already confirmed: addon `aws-secrets-store-csi-driver-provider` v3.0.0-eksbuild.1).

### (c) doc-correction — stale checklist lines to edit (line number + replacement)

These edit `apply-checklist-DRAFT.md` only (the checklist itself; this report does not modify it). Replacement text below is literal.

1. **L350** — strike "pre-existing CloudWatch event rules + RDS/Redshift subscriptions refresh unchanged" → replace with: *"pre-existing CloudWatch event rules + Aurora subscriptions refresh unchanged; the pre-existing `redshift-point` subscription is RE-POINTED from `alert-lambda-infra` to `alert-lambda-event-notification` by this apply (expected in-place MODIFY of its `sns_topic_arn`)."*
2. **L355** — "Also 'alert-lambda-event-notification' must exist (used by the pre-existing redshift-point subscription)." → *"Also 'alert-lambda-event-notification' must exist: this apply re-points the pre-existing `redshift-point` subscription to it (it currently routes to `alert-lambda-infra`), so the topic is a hard prerequisite."*
3. **L362** — the `HALT … if plan shows any destroy/replace on the pre-existing … RDS/Redshift subscriptions` instruction must explicitly EXEMPT the expected in-place MODIFY of `aws_redshift_event_subscription.this` (`redshift-point`, sns sink change). Add: *"Exception: an in-place MODIFY (not destroy/replace) of `redshift-point`'s `sns_topic_arn` from alert-lambda-infra → alert-lambda-event-notification is EXPECTED — do NOT HALT on it."*
4. **L411** — the "Minor (no apply impact)" note has the direction backwards. Replace the claim that `redshift-point` "routes to alert-lambda-event-notification" with: *"`redshift-point` CURRENTLY routes to `alert-lambda-infra` (live-verified); this apply re-points it to `alert-lambda-event-notification`. This IS an apply change (in-place MODIFY), not a no-op."*
5. **L365** — "must run AFTER sns-alert (#8)" → "must run AFTER sns-alert (#5)".
6. **L652** — "total point/* = 17." → "total point/* = 18 (17 pre-existing [16 component-managed + 1 unmanaged `point/exc`] + 1 new)."
7. **L672** — "Expect 17 point/* secrets total after apply (16 pre-existing + 1 new)." → "Expect 18 point/* secrets total after apply (17 pre-existing [16 managed + unmanaged `point/exc`] + 1 new)."
8. **L689-L691** — CLI comment "Confirm total point/* count = 17 (16 pre-existing + 1 new)" and "# Expect: 17" → "…count = 18 (17 pre-existing + 1 new)" and "# Expect: 18".
9. **L933** — "(target the cluster by id; do NOT wildcard — a separate `point-bk` cluster also exists)" → "(target the cluster by id `point`; `point-bk` does NOT exist in dev — only the single `point` cluster is present)."
10. **L441** — "(live 227-249, …)" → "(live 223-249, …)" (free-IP lower bound; ≥7 conclusion unaffected).
11. **L490** — "ROW #13 security_group (CRITICAL …" → "Row #10 — security_group (CRITICAL …" (and similar "ROW #13"/"v8 row #13" body references → "Row #10", keeping "v8 row #13" only where explicitly narrating old numbering).
12. **L262-L263** — the STOP gate "expect EXACTLY: 5 to import, 6 to add, 5 to change, 2 to destroy" / "STOP if plan deviates from 5/6/5/2" should also accept the R3-AUDIT-01 phrasing: add "(equivalently `+11 add [= 5 import + 6 add] / ~5 change / -2 destroy`)" so an operator does not false-STOP when the plan reports 11 adds.
13. **G2 / Row-card Step 0(a) (L39 / L1129)** — optionally annotate as RESOLVED: `eks/tfvars/dev.tfvars named_user` is already `bs-developer` at both refs (Bug B fixed); these lines still describe it as un-fixed but are superseded by R3-EKS-01 (L92). Not a new defect.
14. **G9 / G10 / DRIFT-plan-pin (L51 / L52 / L4)** — mark G9 and G10 RESOLVED at the tip (`022f2ea4`) and re-pin the working-branch SHA from `46fb02e0` to `022f2ea4` (or annotate that the fix landed after the pin). No infra-code-fix needed for these three.
15. **R2-AURORA-01 / R3-WAF-CUST-01 (L906 / Row #39 body L824-841)** — consistency tidy: ensure the aurora card "expected plan" line carries the R2 wording ("1 destroy = secret_version replace, NOT cluster destroy"); prune the stale "pr-84 UNMERGED / Path A-vs-B decision-gate" prose in the waf-customer card (G5/R3-WAF-CUST-01 already resolve to Path B). No code change.

---

## Unverifiable (needs cross-account / cross-env access)

| id | what is needed | account / env | who can check |
|----|----------------|---------------|---------------|
| legacy-845-ids-cross-account | Confirm the v8 hardcoded ids (`vpc-0e139c5a0789db4c0` / `igw-01e61f53a0a31f519` / `nat-00352c4048b1c9674` / `pcx-0b25431ee2b97d2ac`) belong to legacy-dev. Target-account ids confirmed distinct & correct. | 845131030484 (legacy-dev) | An operator with a legacy-dev profile. Low priority — the wrong-account callout is reasonable. |
| R19-KMS-845-USAGE | Confirm no live resource in 845 still depends on KMS key `4f29061e` before the policy drops that account. Key policy currently grants `845…root` + `905…root`. | 845131030484 (legacy-dev) | Operator with legacy-dev profile, out-of-band, before apply. |
| G7-crossaccount-role-trust | Confirm `cm-config-role-all-regions` exists in point-prd with `config.amazonaws.com` trust from 905418018638 (recorders flip role_arn to it). | 211125716602 (point-prd) | Operator with a point-prd profile. **HIGH — blocks the audit role swap.** |
| STG-WEBACL-BC4CA936 | Confirm the stg customer WebACL id `bc4ca936` used to derive `priority-targets-stg.json`. | 471112755246 / 520411743393 (stg) | Operator with `point-operator-stg`. Out of scope for the dev audit. |
| WAF-CUST-PLAN-NUMBERS | Confirm the waf-customer Path B plan magnitudes (`+18/~2/-1`). Code corroborates the maintenance split (-1 legacy RG, +2 exchange/point RGs). | dev (terraform plan) | Operator runs `terraform plan` at HEAD (read-only audit cannot run plan). |

---

## Confirmed-accurate (no action) — CONFIRMED ∧ fix_target=none

These were validated against live AWS / code and need no change. (CONFIRMED gates that still need an operator procedure — G1, R3-EKS-01, OPUS-GATE-A, G7, G13 — are NOT listed here; they live in the top table / fix plan.)

- **Connectivity**: G4 (alb-sg `sg-005b8b9b2e2cb718e` attached to exactly 3 live ALB ENIs → 3-phase swap justified); VPC topology target ids (`vpc-0f49bf7456fa50d08` / `igw-029a72e3cc300249f` / `nat-0a54b505d27c22527`); default NACL `acl-039dac97f13fa7e3c` (6 assoc); 6 subnets present; office CIDRs; no live peering (peer_enabled=false); mysql-sg on 3306 + 3 legacy CIDR rules; eks-worker-sg 8080/80 from alb-sg; vpc-endpoints-sg has only 443 (no 587 yet); all cited SG ids resolve, greenfield SGs absent; 10/15 endpoints exist + 5 new absent; 6 endpoint ids resolve; endpoints has ZERO `aws_iam_role` data sources (fail-soft refuted); email-smtp/sts policy exceptions code-accurate.
- **Compute/EKS**: G2 (named_user already `bs-developer`); G3 (no eks↔cd-runner cycle); R2-EKS-EVID-01 (public module `terraform-aws-modules/eks/aws ~> 21.1.0`); live cluster v1.31 / CONFIG_MAP / ACTIVE on correct VPC; pre-apply nodegroups (`…-20260505` + `worker-20260505-2`) + addons (coredns/kube-proxy/vpc-cni only); Row #32 cd-runner prereqs (cd-runner-sg absent, point-cd-runner-role NoSuchEntity, subnet `subnet-0743df36e105ab5cc`).
- **Stateful**: R12-PLAN-PLUS1 (`event-notification-to-slack` is the only managed add); R12-SNS-TO-SLACK; aurora baseline (available, 3306, exports=[error,slowquery], engine 3.04.0, AMU=false); aurora KMS policy (key `4f29061e` lists both 845+905 roots → drop-845 delta real); redshift baseline (Encrypted=true on `9a03243f`=aws/redshift, require_ssl static, param group `point-redshift-1-0-custom-params`, no Osaka); alias/point-redshift + alias/elasticache-redis pre-guards both `[]`; elasticache baseline (AtRest/Transit=false, endpoint `point.9srtan`, members 001/002); R19-MASTER-USER-VERSION discriminator (`77512B7B…`); G8 single-window scale logic; R18 disable-dance + reboot premises corroborated by static require_ssl + aws-managed key.
- **Security/WAF/Edge**: G6-ACM-INVENTORY (exactly 3 us-east-1 certs, none covers bo.dev); dev customer WebACL `30988cab` with exactly 7 legacy V4 rules; admin WebACL `point-cloudfront-admin` CLOUDFRONT-scoped (v8 REGIONAL/point-admin query correctly flagged wrong); both distros (`E1BIDPQ5G0BYCB` customer, `E3ETPFX8HYQZPU` admin serving EXPIRED `2f009235`); waf-logs bucket healthy + s3-access-logs 404; R3-WAF-CUST-01 (pr-84 merged, provider `~>6.40`, split RGs + preflight present → Path B); priority-targets counts (dev=11, stg=13).
- **Foundation/Governance**: G13 topic-exists (`alert-lambda-infra`); aurora subs route to alert-lambda-infra unchanged; no `notification-aurora-events` rule (real rules = securityhub/certificate/ssm-StartSession/ecr-PutImage); GuardDuty detector `66c92b03…`; s3-access-logs absent; waf-logs Object Lock COMPLIANCE 30d + versioning Enabled; /aws/ssm retention=30; Config recording ON both regions; SecurityHub `hub/default` + CloudTrail management-events healthy; notification-global 4 us-east-1 rules; sns-alert 8 chatbot topics; ecr 5 point-* repos; SHA-drift domain paths byte-identical between 46fb02e0 and tip.

---

## Per-domain detail

### CONNECTIVITY (vpc, vpc_peering, security_group, endpoints) — 17 claims

| id | classification | observed_value | proposed_fix |
|----|----------------|----------------|--------------|
| G4-alb-sg-exists-attached | CONFIRMED | `sg-005b8b9b2e2cb718e` (alb-sg) is point-alb's ONLY SG, attached to 3 in-use ELB ENIs (`eni-052ebcd23d2583b54`, `eni-07d395fe2a7cb0c98`, `eni-0c9e1e4fbf4c0f255`); ALB ARN `…/app/point-alb/0b046b6abb5dc34b`. | No action — 3-phase swap correct. |
| G14-sg-module-unpinned-init-fail | CONFIRMED | init-output.txt:30 `no available releases … ~> 4.0, >= 6.29.0`; 7 unpinned module blocks → v6.0.0; versions.tf pins aws `~> 4.0` (identical both refs). | Pin `version = "~> 5.3"` in all 7 blocks; re-init/plan. |
| Row8-vpc-topology-target-ids | CONFIRMED | `vpc-0f49bf7456fa50d08` available 172.18.0.0/16; `igw-029a72e3cc300249f` attached; `nat-0a54b505d27c22527` available. | No action. |
| Row8-default-nacl-6-assoc | CONFIRMED | `acl-039dac97f13fa7e3c` IsDefault, 6 assoc, 6 entries; only NACL in VPC pre-apply. | No action; "3 NACLs total" is a valid NOT-YET-APPLIED check. |
| Row8-6-subnets-free-ips | CONFIRMED | All 6 ids/CIDRs match; free-IP range 223-249 (NOT 227-249). | Doc: L441 "227-249" → "223-249". |
| Row8-office-cidrs | CONFIRMED | `office_access_cidrs = ["104.30.164.185/32","104.30.177.101/32"]`. | No action. |
| Row9-vpc-peering-none-live | CONFIRMED | 0 peering connections region-wide; `peer_enabled=false`. | No action. |
| Row10-mysql-sg-3306-baseline | CONFIRMED | `sg-007ebd984a0ba881c` all rules on 3306 (none on 13306); CIDRs 45.78.58.128/32, 57.181.130.9/32, 3.115.64.50/32 present. | No action; 13306 after-check NOT-YET-APPLIED. |
| Row10-eks-worker-sg-8080-from-albsg | CONFIRMED | `sg-0fa392415cbbf5b23` has 8080 AND 80 from `sg-005b8b9b2e2cb718e` (alb-sg). | No action. |
| Row10-vpc-endpoints-sg-no-587-yet | CONFIRMED | `sg-0cfb59a0a9621aa8b` has exactly one rule, 443 from 172.18.0.0/16; no 587. | No action; 587 added by apply. |
| Row10-cited-sg-ids-resolve | CONFIRMED | All pre-existing ids resolve; alb-https-sg/cd-runner-sg/proxy-sg absent (greenfield). | No action. |
| Row10-card-body-row13-numbering | STALE-OR-WRONG | Card title/order say row #10; body (L490) says "ROW #13"/"v8 row #13". | Doc: "ROW #13" → "Row #10" in body. |
| Row11-endpoints-5new-10existing | CONFIRMED | Exactly 10 endpoints present (s3, ecr.dkr, ec2, sqs, sns, logs, ssm, secretsmanager, ec2messages, ssmmessages); 5 new (ecr.api, email-smtp, kms, monitoring, sts) absent. | No action. |
| Row11-cited-endpoint-ids-resolve | CONFIRMED | 6 ids resolve (secretsmanager `vpce-07426b0e5996bc32e`, ssm `vpce-0b42df9143232888c`, ec2 `vpce-0c4d1570b2d3b692f`, logs `vpce-073ae71bcc4091587`, ecr `vpce-099cf3461282f1e4d`=ecr.dkr, s3 `vpce-0cec0ac8e18e83881`). | No action. |
| Row11-no-iam-role-data-sources-failsoft-refuted | CONFIRMED | Zero `data "aws_iam_role"` across endpoints/*.tf; ARNs are string interpolation. | No action. |
| Row11-email-smtp-sts-policy-exceptions | CONFIRMED | main.tf:191 SES SMTP no custom policy; sts policy Principal AWS `*` + StringEquals aws:PrincipalAccount=905418018638. | No action. |
| legacy-845-ids-cross-account | UNVERIFIABLE | Cannot describe 845 from dev profile; target-account ids verified distinct/correct. | No action (out of scope). |

### COMPUTE/EKS — 14 claims

| id | classification | observed_value | proposed_fix |
|----|----------------|----------------|--------------|
| G1-eks-ladder-branches | CONFIRMED | Only `feat/migrate-eks-dev` exists; no `eks/1.3[234]` or `auth-mode-bridge`; dev.tfvars pins 1.34. | Create 4 bridge branches; never apply HEAD directly. |
| G2-R3EKS01-named-user | CONFIRMED | `named_user = "bs-developer"` at both refs; bs-developer EXISTS, bs-operator NoSuchEntity. | Doc only: annotate G2/L1129 RESOLVED (Bug B already fixed). |
| G3-no-eks-cdrunner-cycle | CONFIRMED | ec2-cd-runner/data.tf has no `aws_eks_*` data source; only vpc/subnet/sg.cd_runner/ssm/caller. | No action; apply ec2-cd-runner before eks bridge. |
| G9-alb-controller-vpcid | STALE-OR-WRONG | `vpcId` = legacy `0e139c5a` @46fb02e0 BUT correct `0f49bf74` @tip `022f2ea4`. Fixed by 022f2ea4. | Doc: mark RESOLVED; re-pin SHA. |
| G10-k8s-apply-rbac-path | STALE-OR-WRONG | `k8s_apply.sh:81` = `$APP_DIR/rbac/` (absent) @46fb02e0 BUT `rbac/` (exists) @tip. Fixed by 022f2ea4. | Doc: mark RESOLVED; re-pin SHA. |
| DRIFT-plan-pin-stale | STALE-OR-WRONG | tip `022f2ea4` ahead of pinned `46fb02e0` by the commit fixing G9+G10; per-row counts derive from stale plan. | Doc: re-pin to apply ref; re-run k8s diff + changed-code plans. |
| G12-aws-auth-cm-userarn | CONFIRMED | `aws-auth-cm.yaml:35` userarn = `…:user/bs-operator` (NoSuchEntity) at BOTH refs; mapRoles already grant admin. | Code: L35 → user/bs-developer, or drop mapUsers. MED (not a lockout). |
| R3-EKS-01-authmode-API | CONFIRMED | dev.tfvars `authentication_mode="API"`; main.tf `enable_cluster_creator_admin_permissions=false`; live=CONFIG_MAP; no bridge. | Procedure: staged auth-bridge via G1 branch. |
| R2-EKS-IAM-01-module-v21 | CONFIRMED | main.tf module `~> 21.1.0` (v17→v21). 5 destroyed attachments / +34 adds are plan-evidence (not live-falsifiable). | Procedure: keep re-attach verification gate. |
| R2-EKS-EVID-01-module-pointer | CONFIRMED | Public `terraform-aws-modules/eks/aws ~> 21.1.0`; no local module. | No action. |
| R3-K8S-CSI-01-csi-addon | CONFIRMED | Infra side: addon_create_secrets_csi=true, v3.0.0-eksbuild.1; live addons coredns/kube-proxy/vpc-cni only. App-image bridge UNVERIFIABLE here. | Procedure: keep app-image bridge gate. |
| EKS-baseline-version-authmode | CONFIRMED | describe-cluster: v1.31, CONFIG_MAP, ACTIVE, vpc `0f49bf74`, pub endpoint true. | No action; task hint "API_AND_CONFIG_MAP now" was wrong. |
| EKS-baseline-nodegroups-addons | CONFIRMED | Nodegroups admin/api/app/mmh-20260505 + worker-20260505-2; addons coredns/kube-proxy/vpc-cni. | No action. |
| Row32-cdrunner-prereqs | CONFIRMED | cd-runner-sg absent; point-cd-runner-role NoSuchEntity; subnet `subnet-0743df36e105ab5cc` = point-private 172.18.21.0/24, AZ apne1-1c, vpc `0f49bf74`. | No action. |

### STATEFUL (secrets_manager, elasticache, redshift, aurora, validate_password) — 17 claims

| id | classification | observed_value | proposed_fix |
|----|----------------|----------------|--------------|
| R12-SECRETS-COUNT | STALE-OR-WRONG | `point/*` = 17 NOW (16 managed + unmanaged `point/exc`); after apply → 18, not 17. | Doc: fix L652/L672/L689-691 to 18. |
| R12-PLAN-PLUS1 | CONFIRMED | `event-notification-to-slack` absent; 16 managed secrets exist → +1 only. | No action. |
| R12-SNS-TO-SLACK | CONFIRMED | `point/lambda/sns-to-slack` present; event-notification absent → two lambda rows after apply. | No action. |
| R19-POINTBK-CLUSTER | STALE-OR-WRONG | Only `['point']` cluster; `point-bk` → DBClusterNotFoundFault. | Doc: remove/correct L933 parenthetical. |
| R19-AURORA-BASELINE | CONFIRMED | Status available, Port 3306, exports=[error,slowquery], engine 3.04.0, point-1/2 AMU=false. | No action; 13306/audit/AMU=true are after-checks. |
| R19-AURORA-KMS-POLICY | CONFIRMED | Key `4f29061e` policy lists 845…root + 905…root; alias/point-aurora absent. | No action; 845-usage sub-check cross-account. |
| R19-KMS-845-USAGE | UNVERIFIABLE | Cannot enumerate 845 resource usage from dev. | Operator verifies 845-side out-of-band. |
| R18-REDSHIFT-BASELINE | CONFIRMED | available, Encrypted=true KmsKeyId `9a03243f`=aws/redshift, require_ssl=false static, param group point-redshift-1-0-custom-params, no apne3 secondary. | No action. |
| R18-KMS-POINT-REDSHIFT | CONFIRMED | `alias/point-redshift` returns []. | No action. |
| R17-ELASTICACHE-BASELINE | CONFIRMED | AtRest/Transit=false, KMSKeyId null, endpoint `point.9srtan…:6379`, members point-001/002. | No action. |
| R17-KMS-ELASTICACHE-REDIS | CONFIRMED | `alias/elasticache-redis` returns []. | No action. |
| R17-ENGINELOG-GROUP | NOT-YET-APPLIED | `/aws/elasticache/point/engine-log` returns [] pre-apply. | No action; created by apply. |
| R19-MASTER-USER-VERSION | CONFIRMED | AWSCURRENT = `77512B7B-D1DB-420C-9662-72721AEB7DE3` (after-check discriminator). | No action. |
| R20-VALIDATE-PASSWORD | CONFIRMED | No row card; manual bastion SQL via `aurora-install-validate-password.sh`; engine 8.0.mysql_aurora.3.04.0. | Doc: add one-line note that #20 is a manual bastion SQL step, verified via `SHOW VARIABLES LIKE validate_password%`. |
| G8-R2STATE-SINGLE-WINDOW | CONFIRMED | Window box captures once + scales to 0; per-row re-capture/restore removed; all-zeros footgun reasoning sound. | No action. |
| R2-AURORA-01-PLANLABEL | CONFIRMED | `+2 ~4 (1 destroy)`; the 1 destroy = secret_version REPLACE (port re-version), not cluster destroy. | Doc: ensure L906 card carries R2 wording inline. |
| R18-REDSHIFT-DISABLE-DANCE | CONFIRMED | require_ssl ApplyType=static + KmsKeyId aws/redshift corroborate disable-dance + explicit reboot. | No action. |

### SECURITY/WAF/EDGE — 18 claims

| id | classification | observed_value | proposed_fix |
|----|----------------|----------------|--------------|
| G6-ACM-INVENTORY | CONFIRMED | Exactly 3 us-east-1 certs: `cb4bfaf0` dev.backseat-service.com/EXPIRED/AMAZON; `2f009235` *.backseat-service.com/EXPIRED/IMPORTED; `07c7a840` *.backseat-service.com/ISSUED/IMPORTED. None covers bo.dev. | No action. |
| G6-PLAN-BLOCKER-DRIFT | STALE-OR-WRONG | tfvar `cloudfront_certificate` changed `dev.backseat-service.com`→`*.backseat-service.com` (46fb02e0→tip); data source now RESOLVES to `07c7a840`, plan succeeds; failure moved to APPLY. | Doc: re-word facet (a) plan→apply; keep facet (b). |
| G6-COVERAGE-BLOCKER | CONFIRMED | `07c7a840` = *.backseat-service.com does NOT cover level-3 `bo.dev.backseat-service.com`; no covering ISSUED cert exists. | Code/cert-ops: import *.dev.backseat-service.com (or exact bo.dev) ISSUED+IMPORTED cert. |
| G11-ACM-REGIONAL | CONFIRMED | ap-northeast-1 list-certificates = [] (zero regional certs); ingress.yaml has no certificate-arn. | Cert-ops: issue/import regional cert or add certificate-arn. |
| WAF-CUST-WEBACL-ID | CONFIRMED | `point-cloudfront-customer` Id `30988cab-1da0-4623-b71b-a33bb9e17ab0`, attached to `E1BIDPQ5G0BYCB`. | No action. |
| WAF-CUST-7-LEGACY-RULES | CONFIRMED | Exactly 7 rules (block_exepct_allow_ipv4, country_restrict, core_rule_set, known_bad_inputs, rate_limit_count, rate_limit, allow_all_ipv4). | No action. |
| WAF-ADMIN-CLOUDFRONT-EXISTS | CONFIRMED | `point-cloudfront-admin` Id `93e7a6f0-8c4a-4162-afec-67b76f34b523` CLOUDFRONT-scoped, attached to `E3ETPFX8HYQZPU`; v8 REGIONAL/point-admin query is wrong. | No action; use --scope CLOUDFRONT --region us-east-1. |
| WAF-ADMIN-IPSET-AFTERCHECK | NOT-YET-APPLIED | IP set `33026e8a` has 29 addresses; all 5 named AWS-range removal targets present; 8 new office IPs absent. 29-25+8=12 consistent. | No action. |
| WAF-ADMIN-RATELIMIT-RG-AFTERCHECK | NOT-YET-APPLIED | Only customer maintenance + rate-limit RGs exist; no `point-cloudfront-admin-*` RGs yet. | No action. |
| WAF-ADMIN-LOGGING-7FIELDS | NOT-YET-APPLIED | Admin logging Dest=`aws-waf-logs-bs-point-dev`, Redacted=null; code has 7 redacted_fields. | No action. |
| WAF-CUST-LOGGING-10FIELDS | NOT-YET-APPLIED | Customer logging enabled, Redacted=null; code has 10 redacted_fields. | No action. |
| WAFLOGS-BUCKET-AND-ACCESSLOGS-ABSENT | CONFIRMED | `aws-waf-logs-bs-point-dev` head-bucket exit 0 + AWSLogDeliveryWrite policy; `s3-access-logs.bs-point-dev` 404. | No action. |
| R3-WAF-CUST-01-MERGE | CONFIRMED | pr-84 `e394685c` merged (`3f9eb122`); provider `~>6.40`; split RGs + preflight-renumber.sh + priority-targets present → Path B. | Doc: prune stale Path A/B decision prose in Row #39 body. |
| PRIORITY-TARGETS-COUNTS | CONFIRMED | dev JSON 11 keys; stg JSON 13 (adds ip_reputation_list_count:6 + anonymous_ip_list_count:7); no account key. | No action. |
| WAF-CUST-PLAN-NUMBERS | UNVERIFIABLE | Cannot run plan; code corroborates -1 legacy maintenance RG / +2 exchange+point RGs. | Operator runs plan at HEAD. |
| FRONTEND-CUST-CERT-DISTRO | CONFIRMED | `E1BIDPQ5G0BYCB` alias dev.backseat-service.com, cert `07c7a840`, WebACL `30988cab`, Deployed; in-place UPDATE. | No action. |
| FRONTEND-ADMIN-DISTRO-EXPIRED-CERT | CONFIRMED | `E3ETPFX8HYQZPU` alias bo.dev.backseat-service.com, cert `2f009235` (EXPIRED), Deployed. | No action. |
| STG-WEBACL-BC4CA936 | UNVERIFIABLE | stg in 471112755246/520411743393; cannot list from dev. | Verify from operator-stg. |

### FOUNDATION/GOVERNANCE — 24 claims

| id | classification | observed_value | proposed_fix |
|----|----------------|----------------|--------------|
| G13-NOTIF-topic-exists | CONFIRMED | `alert-lambda-infra` present. | No action. |
| G13-NOTIF-topic-absent | CONFIRMED | No `alert-lambda-event-notification` topic (160+ topics listed). | Procedure: apply secrets_manager → event-notification → notification first. |
| Row#7-redshift-point-sns-mismatch | STALE-OR-WRONG | Live `redshift-point` routes to `alert-lambda-infra`; HEAD redshift.tf:3 sets event-notification → apply MODIFIES the sink. | Doc: fix L350/L355/L411, exempt from L362 HALT. |
| Row#7-aurora-subs-unchanged | CONFIRMED | aurora-point-cluster + aurora-point-instance active, route alert-lambda-infra. | No action. |
| Row#7-new-snapshot-subs | NOT-YET-APPLIED | aurora-point-cluster-snapshot + redshift-point-snapshot absent (created by apply). | No action. |
| Row#7-no-aurora-events-rule | CONFIRMED | Rules = certificate, ecr-PutImage, securityhub, ssm-StartSession; no notification-aurora-events. | No action. |
| Row#7-depends-on-numbering | STALE-OR-WRONG | L365 "AFTER sns-alert (#8)"; table has sns-alert #5. | Doc: L365 "(#8)" → "(#5)". |
| OPUS-GATE-A-Admin-trust | CONFIRMED | Trust = 590183696997 + 728927523062 roots, SourceIp 0.0.0.0/0; HEAD drops both + narrows; AdministratorAccess attached. | Procedure: diff + sign-off before import. |
| OPUS-GATE-A-Operator-trust | CONFIRMED | Trust = 905 + 590183696997; HEAD drops 590183696997; AdministratorAccess attached. | Procedure: sign-off. |
| OPUS-GATE-A-Viewer-trust | CONFIRMED | Trust = 728927523062 + 905, SourceIp 9 /32s; HEAD drops 728927523062, narrows 9→2. | Procedure: capture 9-IP detail in sign-off. |
| OPUS-GATE-A-CICD-trust | CONFIRMED | Trust = user/bs-cicd-test + user/cicd; HEAD drops bs-cicd-test; AdministratorAccess attached. | Procedure: sign-off; user/cicd kept. |
| Row#2-guardduty-detector | CONFIRMED | DetectorId `66c92b03e51d67d20a54fd6245b8e91d`. | No action. |
| Row#2-s3-access-logs-absent | CONFIRMED | head-bucket 404. | No action. |
| Row#2-waflogs-objectlock-versioning | CONFIRMED | Object Lock COMPLIANCE 30; Versioning Enabled. | No action. |
| Row#2-ssm-retention-baseline | CONFIRMED | /aws/ssm retentionInDays=30. | No action; →90 after-check valid. |
| G7-R3-AUDIT-01-config-role | CONFIRMED | `bs-aws-config-role` RoleLastUsed 2026-06-08T11:04:29Z; both recorders use it; recording=true. | Procedure: verify cross-account trust + deferral. |
| G7-crossaccount-role-trust | UNVERIFIABLE | 211125716602 not held by dev profile. | Procedure: operator confirms cm-config-role-all-regions trust. |
| Row#2-config-recording-on | CONFIRMED | recording=true both ap-ne-1 + us-east-1. | No action. |
| Row#2-securityhub-cloudtrail-healthy | CONFIRMED | hub/default (SubscribedAt 2024-10-04); CloudTrail management-events IsLogging=True. | No action. |
| Row#2-plan-count-vs-R3 | CONFIRMED | Card "5/6/5/2 STOP" reconciles with R3 "+11/~5/-2" (+11 = 5 import + 6 add). | Doc: L262-263 accept the +11 phrasing. |
| Row#6-notification-global-rules | CONFIRMED | us-east-1: notification-certificate/-health/-signin/-sts-AssumeRole all present. | No action (optional region-attribution note in Row#7 #4). |
| Row#5-sns-alert-topics | CONFIRMED | alert-lambda-infra + 8 alert-chatbot-* topics live. | No action. |
| Row#4-ecr-repos | CONFIRMED | point-app/worker/admin/mmh/api (5) exist; tfvars defines same 5 → in-place reconcile. | No action. |
| SHA-drift-domain-paths | CONFIRMED | `git diff --stat 46fb02e0 release/verup` empty for all 6 governance paths → byte-identical. | No action. |

---

## Note on NOT-YET-APPLIED after-checks

All numbers/states in the per-row "After-check (2) CLI" blocks that are classified **NOT-YET-APPLIED** (6 items: `R17-ENGINELOG-GROUP`, `WAF-ADMIN-IPSET-AFTERCHECK`, `WAF-ADMIN-RATELIMIT-RG-AFTERCHECK`, `WAF-ADMIN-LOGGING-7FIELDS`, `WAF-CUST-LOGGING-10FIELDS`, `Row#7-new-snapshot-subs`) are **expected to fail pre-apply** — the resources/configurations they assert are created or changed by the apply itself. These are well-formed post-apply gates, not defects. Many CONFIRMED-baseline rows also embed a NOT-YET-APPLIED forward assertion (e.g. the Aurora 3306→13306 flip, Redshift `require_ssl` false→true, the +5 new endpoints, the EKS access-entry after-checks) — those forward halves are likewise expected to be empty/absent until the corresponding apply runs.
