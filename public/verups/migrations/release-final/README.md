# release-final — verup → point release docs (DEV done · STG next)

**Local only. Do NOT publish to Confluence.** Consolidated final release documents for the verup → point migration, split by environment:

- **[`dev/`](dev/)** — the **DEV** finished product (apply complete 2026-06-18, point-dev `905418018638`). Execution-ordered release tables, the operator runbook, gate checklists, the EKS apply-incident record, and the K8s manifest apply runbook.
- **[`stg/`](stg/)** — the **STG** phase (apply target `471112755246` point-stg, not yet applied). Release tables **built 2026-06-18** from a live STG `terraform plan` (46 targets vs account 471 at tip `21c92487`); 3 code fixes + a set of operator open questions gate the apply. ⚠ `520411743393` is the verup-STG *source* (sunset) — never an apply target.

> Apply model = import/adopt existing brownfield resources. Region `ap-northeast-1` (CloudFront/ACM/WAF-CLOUDFRONT `us-east-1`). Maintenance windows JST. Two points of no return: the EKS auth flip `CONFIG_MAP→API` (absolute) and the EKS module v17→v21 upgrade (hard).

---

## dev/ — what to read (DEV, complete)

| # | Document | What it is |
|---|----------|------------|
| 1 | [`dev/RELEASE-VERUP.md`](dev/RELEASE-VERUP.md) | The release doc, re-sorted to true execution order + renumbered, all columns corrected/validated. The parent-page variant (39 rows). |
| 2 | [`dev/MANUAL-RUNBOOK.md`](dev/MANUAL-RUNBOOK.md) | The operator runbook — top-to-bottom apply procedure (guard → pre-flight → apply with import/gate/rollback inline → EKS climax → recovery). |
| 2b | [`dev/APPLY-COMMANDS-DEV.md`](dev/APPLY-COMMANDS-DEV.md) | The concise copy-paste command runbook (every component as one block, in execution order). |
| 3 | [`dev/apply-order-CANONICAL.md`](dev/apply-order-CANONICAL.md) | The corrected 39-row apply order (the spine) + per-row depends_on/gates/risk/window. |
| 4 | [`dev/apply-checklist-DRAFT.md`](dev/apply-checklist-DRAFT.md) | The go/no-go gate checklist (G1–G13 + per-component evaluation cards). |
| 5 | [`dev/RELEASE-VERUP-full-module.md`](dev/RELEASE-VERUP-full-module.md) | The full-module variant (49 rows) + corrections appendix. |
| — | [`dev/K8S-MANIFEST-APPLY-RUNBOOK.md`](dev/K8S-MANIFEST-APPLY-RUNBOOK.md) | The K8s manifest apply runbook. |
| — | [`dev/INCIDENT-EKS-131-APPLY-DEV-20260612.md`](dev/INCIDENT-EKS-131-APPLY-DEV-20260612.md) | The EKS 1.31 apply incident record (root cause + recovery runbooks; `.html` / `.vi.html` renders alongside). |
| — | `dev/apply-checklist-AWS-VERIFICATION-20260608.md` · `dev/REMAINING-BLOCKERS-INVESTIGATION-2026-06-09.md` · `dev/SESSION-REPORT-2026-06-08.md` · `dev/after-check-rewrite-manifest.json` · `dev/plan-snapshots/` | Supporting evidence / session artifacts. |

**Start at #1 for the release table; execute #2 (prose) or #2b (commands) for the apply.** #3/#4 are the per-row + gate references behind both.

## stg/ — built (apply pending the 3 code fixes + open questions)

| # | Document | What it is |
|---|----------|------------|
| 1 | [`stg/apply-order-CANONICAL.md`](stg/apply-order-CANONICAL.md) | **The STG spine / source of truth** — canonical order (rows 0..39b, eks split 21+21b), per-row STG gates + live-plan counts, §Code fixes (3 defects), §Open questions, §plan snapshot. |
| 2 | [`stg/RELEASE-VERUP.md`](stg/RELEASE-VERUP.md) | The per-row release-judgment table (STG values, forecast plan column). |
| 2b | [`stg/APPLY-COMMANDS-STG.md`](stg/APPLY-COMMANDS-STG.md) | The concise copy-paste command runbook (47 blocks in execution order, `--env stg`). |
| 3 | [`stg/apply-checklist.md`](stg/apply-checklist.md) | Go/no-go gates (incl. the 3 code fixes) + per-component cards. |
| 4 | [`stg/MANUAL-RUNBOOK.md`](stg/MANUAL-RUNBOOK.md) | The trimmed operator prose runbook (no DEV-era commentary). |
| — | [`stg/DEV-APPLY-ANALYSIS.md`](stg/DEV-APPLY-ANALYSIS.md) · [`stg/STG-HANDOFF.md`](stg/STG-HANDOFF.md) · [`stg/_QA-REPORT.md`](stg/_QA-REPORT.md) | The 38-log DEV-apply evidence base, the build spec, and the adversarial QA record. |

**Built from the live STG plan; numbers are a forecast (STG un-applied → many rows blocked-on-upstream).** See also [`../reference/STG-README.md`](../reference/STG-README.md) — the STG front door.

## Notes

- **Brownfield**: Aurora / Redshift / ElastiCache / EKS (v1.31) / VPC already exist + are terraform-managed. Any "greenfield / first-create / EKS 1.30" framing is stale.
- **Confluence publish is gated** (not automatic): if/when asked, apply the reviewed deltas onto a freshly re-fetched **live HTML** copy of the page — never overwrite wholesale with HTML converted from this markdown (lossy: drops inline comments, `ac:*` macros, attachments).
- The deep working area + machine plan captures remain under [`../roadmaps/dev/LATEST/`](../roadmaps/dev/LATEST/) and [`../plans/dev/`](../plans/dev/); cross-references inside the `dev/` docs to deep evidence files resolve there.
