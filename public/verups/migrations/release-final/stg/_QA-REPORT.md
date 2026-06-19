# STG release docs — adversarial QA report

**Scope.** Adversarial QA of the 5 named STG release docs for the verup→point migration into point-stg `471112755246`, verified against the canonical spine `apply-order-CANONICAL.md` (tip `release/verup 21c92487`, live STG plan run `20260618T052659Z__stg__stg__d06d8cd2`).

**Verdict: FAIL.** One of the 5 named docs — `APPLY-COMMANDS-STG.md` — **does not exist**, and the folder `README.md` misdirected the apply target to the sunset account `520411743393`/`bs-point-stg`. The 4 docs that do exist (`apply-order-CANONICAL.md`, `RELEASE-VERUP.md`, `apply-checklist.md`, `MANUAL-RUNBOOK.md`) are spine-consistent and clean: identical row sets, identical plan counts, identical snapshot/risk totals, the 3 code defects surfaced as blocking gates, the EKS 21+21b split and 1.31 pin honored everywhere, account-pure (0 leaks), and bastion `--profile`-free.

**Inline fixes applied: 3** (all in `README.md` — the only file with legitimate edits; the 4 reviewed docs required no inline changes).

---

## Check-by-check status

| # | Check | Status | Notes |
|---|-------|--------|-------|
| — | **All 5 named docs present** | **FAIL** | `APPLY-COMMANDS-STG.md` is absent (see Finding 1). |
| 1 | Account purity (no stray 905/520/bs-point-dev/dev.backseat) | **PASS** (4 reviewed docs) / **FAIL→FIXED** (README) | 0 hits in the 4 reviewed docs. `README.md` carried 3 stray `520411743393`/`bs-point-stg` apply-target references → fixed inline. |
| 2 | Cross-ref consistency (row set + plan counts match spine across all 4 derivatives) | **FAIL** | Row set + counts are identical across the **3 present** derivatives, but the **4th derivative (`APPLY-COMMANDS-STG.md`) is missing**, so "matches across all 4" cannot hold. RELEASE-VERUP.md:11 dangling-references it. |
| 3 | 3 code defects as blocking gates in apply-checklist | **PASS** | G-code-1 (eks `cluster_node_ami_type`), G-code-2 (iam viewer data-source), G-code-3 (frontend-customer ACM `types` filter) all present, each marked blocking with fix + verify + STOP. |
| 4 | No DEV cruft (Round-2/3, supersede, Path A, v8, historical) | **PASS** | 0 hits on every enumerated token across all 4 docs. (`Path B` advisory note below — not a violation.) |
| 5 | Bastion model (`--profile`-free apply; local read-only = `point-operator-stg`; no `bs-point-stg`/520) | **PASS** | 0 `--profile bs-point-stg` / `--profile 520...` anywhere. All `bs-point-stg` substrings in the 4 docs are resource names (`s3-access-logs.bs-point-stg`, etc.) or the explicit "never use bs-point-stg" warning. |
| 6 | EKS 2-stage split (21 + 21b) and 1.31 pin (not 1.34) | **PASS** | 21+21b rows in CANONICAL/RELEASE/checklist; MANUAL describes the Stage-1/Stage-2 separate-window split in prose. 1.31 pin dominant in every doc; all `1.34` mentions are the legitimate ladder target (rows 22-24). |

---

## Findings (with file:line)

### Finding 1 — CRITICAL (blocking): `APPLY-COMMANDS-STG.md` does not exist
- The folder contains only `apply-order-CANONICAL.md`, `RELEASE-VERUP.md`, `apply-checklist.md`, `MANUAL-RUNBOOK.md` (+ `README.md`, `STG-HANDOFF.md`, `DEV-APPLY-ANALYSIS.md`). The paste-in command derivative is genuinely absent — not merely renamed. The `MANUAL-RUNBOOK.md` carries *some* inline commands (STEP 0, the security_group 3-step swap, a few `aws s3api put-bucket-acl` pre-strips) but **not** the full per-row paste-in set the DEV counterpart (`../dev/APPLY-COMMANDS-DEV.md`) provides.
- **Dangling cross-ref**: `RELEASE-VERUP.md:11` lists it as a companion doc — `\`APPLY-COMMANDS-STG.md\` (paste-in commands)` — which now points at a non-existent file. `README.md` (pre-fix) also listed it as a target.
- **Not fixed inline** (out of QA scope): authoring a full per-row paste-in command doc is a build task, not a surgical fix, and would itself require QA. **Recommendation to caller:** build `APPLY-COMMANDS-STG.md` from the spine (mirror `../dev/APPLY-COMMANDS-DEV.md`, `--profile`-free, `--region` explicit) before the release is considered complete. The `RELEASE-VERUP.md:11` reference was left in place (deleting it would mask the gap); `README.md` now flags it as `⚠ NOT YET BUILT`.

### Finding 2 — CRITICAL→FIXED: `README.md` misdirected the apply target to the sunset account
- `README.md:3` (pre-fix): "apply target `520411743393` (profile `bs-point-stg`) · not started" — directly contradicts the spine, which makes `471112755246` the STG apply target and `520411743393`/`bs-point-stg` the verup-STG **source** account to never apply into.
- `README.md:24` (pre-fix): instructed `aws sts get-caller-identity --profile bs-point-stg` → expect `520411743393`, and called `471112755246` "only the read-only audit profile" — inverted from the spine.
- `README.md:28` (pre-fix): "Validate read-only ... against `520411743393`".
- **Fixed inline** (3 edits): apply target corrected to `471112755246` (point-stg) with the bastion `--profile`-free model + `point-operator-stg` read-only note + the explicit "never apply into bs-point-stg/520 (sunset)" warning, matching the spine's phrasing. The remaining `520411743393` mentions in README are now intentional sunset-account warnings (allowed source-vs-target contrast).

### Finding 3 — MED→FIXED: `README.md` status tables were stale
- The "Files here now" / "Target file set" tables listed `RELEASE-VERUP.md`, `MANUAL-RUNBOOK.md`, `apply-order-CANONICAL.md`, `apply-checklist` as "☐ to build" and the phase as "not started" — false (3 of 4 derivatives are built and in use).
- **Fixed inline**: merged into a single accurate status table (✅ built for the 3 derivatives + spine, ✅ reference for STG-HANDOFF/DEV-APPLY-ANALYSIS, ⚠ NOT YET BUILT for APPLY-COMMANDS-STG). The residual "How to build" steps (plan-regeneration narrative) were left as-is per scope — recommend the caller refresh or retire that section now that the docs exist.

### Advisory (no fix) — "Path B" codename
- `apply-order-CANONICAL.md:59`, `RELEASE-VERUP.md:79`, `apply-checklist.md:397`, `MANUAL-RUNBOOK.md:114` use "Path B" alongside the real config name `priority-targets-stg.json` (13-rule waf-customer set). This is a codename house-style disfavors, **but** it originates in the spine and is consistent across all docs, so per "take values from the spine" it is conformant. Flagged advisory only — not changed.

---

## Cross-ref evidence (verified)

- **Row set (identical across all 3 present derivatives):** `0, 0b, 1, 1a, 1b, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12b, 13, 14, 15, 16, 17, 18, 19, 20, 20b, 21, 21b, 22, 23, 24, 25, 26, 27, 28, 29, 30, 30b, 32, 33, 34, 35, 36, 37, 38, 39, 39b`.
- **Plan counts match the spine** on every destructive/numeric row checked: vpc `+39/~3/-1`, security_group `+23/~2/-5/⟳7`, infra/audit `+12/~7/-2`, elasticache `+3/⟳2`, aurora `+2/~4/-1/⟳1`, frontend-customer `+10/~5/-2`, waf-customer `+20/~2/-1`, cloudwatch_metrics `+2/~33/-2`, cloudwatch_alarm `+2/~11/-2`, frontend-admin `+3/~4/-1`, k8s api `+34/~7`, endpoints `+5/~10`, glue-etl `+44`.
- **Snapshot table identical** (spine ↔ RELEASE-VERUP): Success-no-change 3 / with-change 28 / plan_failed 15 = 46; Risk CRITICAL 2 / HIGH 7 / MED 17 / LOW 15 / UNKNOWN 5 = 46.
- **3 code defects** consistent across spine §Code fixes, RELEASE-VERUP §Code fixes, apply-checklist G-code-1/2/3, MANUAL CODE FIXES section.
- **EKS:** 21 (Stage-1 CONFIG_MAP→API_AND_CONFIG_MAP) and 21b (Stage-2 →API) as separate rows/windows in all docs; 1.31 pin with the 1.31→1.34 ladder as rows 22-24; the "STOP if plan shows 1.31→1.34" guard present.

---

## Account-purity grep result for THIS report

`_QA-REPORT.md` contains `905418018638` 0 times and `520411743393`/`bs-point-stg` several times — **all are intentional citations** of the README defect and the sunset-source warning being documented here. **The 4 reviewed release docs contain 0 occurrences** of `905418018638` / `520411743393` / `bs-point-dev` / `dev.backseat`; `README.md` post-fix contains `520411743393` only in the explicit "never apply into the sunset account" warnings.
