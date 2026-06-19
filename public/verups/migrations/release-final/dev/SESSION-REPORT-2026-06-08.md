# Session report — apply-checklist verification & fixes (2026-06-08)

**Scope.** Review the apply-blocking blocks in `apply-checklist-DRAFT.md`, verify every falsifiable claim against live AWS with read-only CLI, fix the issues found, and reconcile the master apply-order docs.
**Target.** point DEV `905418018638` (profile `point-operator-dev`, region `ap-northeast-1`; CloudFront/ACM in `us-east-1`). STG `471112755246` checked where cross-env contrast mattered.
**Apply branch.** `release/verup` on `bs-point-infra` — tip moved `46fb02e0` → `022f2ea4` → **`6672bbb6`** (the G14 fix committed + pushed this session).

---

## 1. Executive summary

| Area | Outcome |
|---|---|
| AWS-CLI verification of the checklist | 90 claims across 5 domains: **70 CONFIRMED / 9 STALE-OR-WRONG / 5 UNVERIFIABLE / 6 NOT-YET-APPLIED** |
| Genuine code blocker fixed | **G14** (security_group `terraform init` failure) — pinned the module, plan-verified, **committed + pushed** |
| Checklist corrections | **15 doc-corrections** applied to `apply-checklist-DRAFT.md` |
| G13 / event-notification | Re-classified as **point-native DEV gap** (STG already converged); added as a real master-table row `#12b` |
| Stale-pin artefacts | **G9/G10 confirmed already fixed** at the apply tip (`022f2ea4`) — only "stale" vs the older pinned SHA |

Full evidence: `apply-checklist-AWS-VERIFICATION-20260608.md` (per-domain claim tables).

---

## 2. AWS-CLI verification

A 5-domain read-only sweep (Connectivity, Compute/EKS, Stateful, Security/WAF/Edge, Foundation/Governance) cross-checked each checklist claim against live AWS and against the code at the apply ref. Two safeguards prevented false positives:

- **Temporal classification** — each claim tagged `baseline` (state now → verified live), `after-check` (state after the row applies → not run-and-expect-pass), or `reasoning-only` (no describe call can falsify). This kept 6 legitimate post-apply checks from reading as failures.
- **Supersession-aware** — verified the **post-correction** claim (gates + Round-2/Round-3 tables), not the stale original card text.

### Genuine defects surfaced (firsthand-verified)

| Gate | Component | Finding | Disposition |
|---|---|---|---|
| **G14** | security_group | `terraform init` fails: 7 unpinned `terraform-aws-modules/security-group/aws` blocks resolve to v6.0.0 (needs `aws >= 6.29`) vs the component's `aws ~> 4.0` pin | **FIXED this session** (see §3.1) |
| **G6** | frontend-admin | No ISSUED ACM cert in us-east-1 covers the level-3 alias `bo.dev.backseat-service.com` (only a level-2 wildcard exists) | Open — cert-ops (import) |
| **G11** | k8s ingress | Zero regional ACM certs in ap-northeast-1; `ingress.yaml` has no `certificate-arn` | Open — cert-ops |
| **G12** | k8s aws-auth-cm | `aws-auth-cm.yaml:35` userarn still `bs-operator` (NoSuchEntity) at the tip | No action (decided — MED, not a lockout; `mapRoles` cover admin) |

### Operator-misleading checklist errors (now corrected)

- **Secrets count** — DEV already has **17** `point/*` secrets (16 component-managed + 1 unmanaged `point/exc`) → **18** after apply, not the "17" the card claimed (would trigger a false STOP).
- **redshift-point SNS sink** — live DEV routes to `alert-lambda-infra`; HEAD `notification/redshift.tf:3` re-points it to `alert-lambda-event-notification` → an in-place MODIFY the card mislabelled as "no apply impact" and would have false-HALTed.
- **`point-bk` cluster** — does not exist in DEV (only `point`); the card's justification was wrong.

### Stale-pin artefacts (NOT live defects)

`G9` (ALB-controller vpcId) and `G10` (`k8s_apply.sh` rbac path) were **already fixed in code** at the apply tip `022f2ea4` (commit "fix(k8s): correct ALB controller vpcId and rbac apply path"). They read as "stale" only because the checklist pinned the older `46fb02e0`.

---

## 3. Fixes applied

### 3.1 G14 — security_group module version pin (CODE — committed + pushed)

- Pinned `version = "~> 5.3"` on all 7 `terraform-aws-modules/security-group/aws` module blocks (`eks.tf` ×2, `mysql.tf` ×2, `redis.tf` ×1, `redshift.tf` ×2) + `terraform fmt`.
- **Empirically verified the failure and the fix**: a fresh `terraform init` on the *unpinned* config fails identically on **both** point and verup today (latest published module = v6.0.0, needs `aws >= 6.29`, conflicts with `aws ~> 4.0`); with the pin, `init` resolves module `5.3.1` + `aws 4.67.0`.
- **`terraform plan` (real backend, read-only) verified clean**: `17 to add, 1 to change, 14 to destroy` — only `aws_security_group_rule` churn (port flips 3306→13306 / 5439→6379 / 80→443, secondary-CIDR rules) plus the 3 greenfield SGs (`alb-https`, `cd-runner`, `proxy`); **no existing security group destroyed/replaced, no stateful/compute resource touched**.
- **Committed `6672bbb6` + pushed** to `release/verup` (worktree `work-bs-point-rehearsal`). Conventional Commits, no ticket ID, no AI footer.

### 3.2 Checklist doc-corrections (15) — `apply-checklist-DRAFT.md` (uncommitted)

- Row #7 notification: redshift-point re-point wording, plan count (`0 change` → `1 change`), HALT exemption for the expected MODIFY, `#8` → `#5`, "no apply impact" direction fix.
- Row #12 secrets_manager: `17` → `18` (3 locations).
- Row #19 aurora: removed the false `point-bk` claim; clarified the `1 destroy` = secret_version REPLACE.
- Header / gates: G9/G10/G2 marked RESOLVED-at-tip, SHA-advanced note, `+11` plan-count equivalence, ROW #13 → #10, robustified the free-IP wording, waf-customer Path-B banner.

### 3.3 event-notification master-table row + G13 reframe (LOCAL — uncommitted)

The `event-notification` component was missing as a row from **every** master apply-order table (local CANONICAL, local DRAFT, local mirror, live Confluence v5).

- Added as **row `#12b`** (after secrets_manager #12) in `apply-order-CANONICAL.md` (now 43 rows) and `apply-checklist-DRAFT.md`, with a defer-note on notification #7.
- Gate **G13 re-classified as point-native DEV drift** — see §4.
- **Confluence page 1854668802 (v5) was NOT updated** (kept local at the operator's request); a row `#15.1` draft is prepared for a later sync (Confluence numbering differs: secrets_manager=#15, notification=#10).

---

## 4. G13 / event-notification — point-native, not a verup change

Established by `git diff main...release/verup` (empty for `notification/{data,redshift}.tf`) and a live dev/stg comparison:

| | DEV `905418018638` | STG `471112755246` |
|---|---|---|
| SNS topic `alert-lambda-event-notification` | absent | present (+ Slack-forward Lambda subscription) |
| Secret `point/lambda/event-notification-to-slack` | absent | present |
| `redshift-point` subscription sink | `alert-lambda-infra` (old) | `alert-lambda-event-notification` (point's intended state) |

**Interpretation.** The data source and the redshift-point re-point live in point's own `main` (not introduced by the verup migration). STG already has the full stack applied; DEV never did. So G13 is a **DEV-only convergence gap**, resolved by applying the chain **secrets_manager #12 → event-notification #12b → notification #7** (the `event-notification` Lambda's `data.aws_secretsmanager_secret` is the hard plan-time dependency on secrets_manager). STG checklists are exempt.

A scan of all `data "aws_sns_topic"` lookups confirmed **`alert-lambda-event-notification` is the only dev-missing topic** of this class (8× `alert-chatbot-*` + `alert-lambda-infra` all present).

---

## 5. Gate status after this session

| Gate | Status |
|---|---|
| G9, G10, G2 | ✅ already fixed at the apply tip (doc annotated) |
| **G14** | ✅ fixed + plan-verified + pushed (`6672bbb6`) |
| G12 | ⏸ no action (decided — MED, non-lockout) |
| G13 | 🔁 point-native DEV gap — apply event-notification #12b chain (DEV only) |
| **G1 / R3-EKS-01** | 🔴 open — create the 4 EKS ladder/bridge branches; staged auth-bridge |
| **G6 / G11** | 🔴 open — import/issue ACM certs (us-east-1 level-3 + ap-northeast-1 regional) |
| **G7 + cross-account** | 🔴 open — verify `cm-config-role-all-regions` trust in `211125716602` |
| **OPUS-GATE-A** | 🔴 open — diff custodian-role trust + sign-off before iam import |
| vpc_peering | 🔴 open — peering request from the 845 account; capture the real `pcx` |
| G4, stateful window | 🟡 procedure — G4 now unblocked by G14; execute in maintenance window |

---

## 6. Artifacts produced / updated

- `apply-checklist-AWS-VERIFICATION-20260608.md` — full 90-claim verification + fix plan (new).
- `apply-checklist-DRAFT.md` — 15 doc-corrections + event-notification #12b + G13 reframe (uncommitted).
- `apply-order-CANONICAL.md` — event-notification #12b, notification #7 defer-note, 43-row count (uncommitted).
- `bs-point-infra` `release/verup` — G14 module-pin commit `6672bbb6` (pushed).
- Project memory — apply-blocker gate status refreshed for 2026-06-08.

---

## 7. Apply-readiness verdict & next steps

**Not yet fully apply-ready.** The hard technical blocker (G14 init failure) is cleared, so `security_group` and the early rows can init/plan. But the apply ladder still has CRITICAL/HIGH gates that require human, cross-account, or cert-ops action and cannot be fixed in code:

1. Create the EKS ladder/bridge branches (G1/R3-EKS-01).
2. Import the ACM certs (G6 us-east-1 level-3, G11 ap-northeast-1 regional).
3. Verify the cross-account Config role trust in `211125716602` (G7).
4. Diff + sign off the custodian-role trust changes (OPUS-GATE-A).
5. Apply the `secrets_manager → event-notification → notification` chain in DEV (G13).
6. Re-plan each component on the apply day (no committed lock files on the 6 core components).

Early daytime low-risk rows with no open gate may be applied in order after a fresh per-component plan; the CRITICAL rows each await their gate above.

---

## Addendum — 2026-06-09 follow-up (infra/audit / G7)

*(Added 2026-06-09; the 2026-06-08 body above is unchanged.)*

- **infra/audit (#2) re-planned standalone** @ `release/verup` HEAD `d0625eca` (`module.audit` byte-identical vs `46fb02e0`). Full plan numbers stable: `+11/~5/-2` (+5 import), risk HIGH; G7 cross-account concern unchanged. Live recorders both regions still on `905418018638:role/bs-aws-config-role`, `recording=SUCCESS`, `RoleLastUsed=2026-06-09`.
- **Config-excluded targeted plan VERIFIED** (9 modules via `-target`, exclude `module.config`): `+11/~3/-0` (+5 import), **0 destroy, no `211125716602` reference, MED** — proves the `-2 destroy` + recorder `role_arn` switch are fully isolated to `module.config`, so the defer-config apply path is safe. Evidence: `../../plans/dev/infra/audit-no-config/`.
- **G7 remains open** (line 103/126 above still accurate): the `211` role trust is still unverifiable from dev/stg. New: the config end-state is now framed as an **OPEN engineer decision** — Option A (revert to same-account local role) vs Option B (converge to `211`), both blocked on that same trust verification. Full code-vs-live analysis: `../../verup-to-point/audit-config-drift-analysis.md`.
