# stg/ — STG release docs (built · plan-run 2026-06-18)

**STG phase · apply target `471112755246` (point-stg) · not yet applied.** Apply runs on the STG bastion via its instance role (`--profile`-free; `--env stg` selects tfvars + S3 backend). Read-only after-checks from a workstation use `point-operator-stg`. **Never `bs-point-stg` / `520411743393`** — that is the verup-STG *source* account being sunset; the migration never applies into it.

These are the STG equivalents of the [`../dev/`](../dev/) release docs, built from a **live STG `terraform plan`** (run `20260618T052659Z__stg__stg__d06d8cd2`, 46 targets vs account 471 at `release/verup` tip `21c92487`) reconciled against the DEV apply evidence. Plan numbers are a **forecast** — STG is un-applied, so many rows are *blocked-on-upstream* and firm up as the spine runs.

## What to read

| # | File | What it is |
|---|------|------------|
| 1 | [`apply-order-CANONICAL.md`](apply-order-CANONICAL.md) | **The spine / source of truth** — canonical apply order (rows 0..39b, eks split 21+21b), per-row STG gates + plan counts, **§Code fixes** (3 defects), §Open questions, §STG plan snapshot. |
| 2 | [`RELEASE-VERUP.md`](RELEASE-VERUP.md) | Per-row release-judgment table (what changes + after-check + risk + window), derived from the spine. |
| 3 | [`apply-checklist.md`](apply-checklist.md) | Go/no-go gates (G-series, incl. the 3 code fixes) + open questions + per-component cards. |
| 4 | [`APPLY-COMMANDS-STG.md`](APPLY-COMMANDS-STG.md) | The concise copy-paste command runbook — one block per row, in execution order (`export AWS_PROFILE=point-operator-stg` for local read-only; `../../terraform.sh --env stg …`). |
| 5 | [`MANUAL-RUNBOOK.md`](MANUAL-RUNBOOK.md) | The trimmed operator prose runbook (guard → pre-flight → per-phase apply → EKS climax → recovery). No DEV-era commentary. |
| — | [`apply-order-CANONICAL.md`] §Code fixes · [`_QA-REPORT.md`](_QA-REPORT.md) | The 3 code defects + the adversarial QA record. |
| — | [`STG-HANDOFF.md`](STG-HANDOFF.md) · [`DEV-APPLY-ANALYSIS.md`](DEV-APPLY-ANALYSIS.md) | Build spec + the 38-log DEV-apply evidence base (manual-intervention catalog). |

**Start at #1 (spine) or #2 (release table); execute via #4 (commands) or #5 (prose); #3 is the go/no-go behind both.**

## Before STG apply — 3 code fixes + open questions (do NOT apply until resolved)

- **3 code fixes** (`release/verup` regressions at tip `21c92487`, see spine §Code fixes): eks `cluster_node_ami_type` dead variable (row 21); iam `data.aws_iam_policy.viewer` greenfield lookup (row 1); frontend-customer ACM data-source ambiguity → add `types=["IMPORTED"]` (row 38).
- **Open questions for the operator** (spine §Open questions): vpc_peering wallet pcx (NotFound in 471); the 2 vpc route losses (peering + Ponta) on az2/az4; HULFT `172.19.0.0/16` drain; infra/audit `211` config trust.
- **Resolved by the live plan** (contra earlier drafts): **glue-etl is NOT permanently blocked** — the `100.64.0.0/16` pool it needs is enabled (`secondary_cidr.tf`); it is only *blocked-on-upstream* until vpc #8 applies those subnets. **frontend-admin is NOT cert-blocked** — STG host `bo-stg.backseat-service.com` (single label) is covered by the `*.backseat-service.com` cert.

## Notes

- The big destructive windows are unchanged from DEV: elasticache #17 (data wipe), redshift #18 (KMS + reboot), aurora #19 (port 3306→13306 + secret rotate), and the EKS auth flip (#21/#21b, now **split into two windows** for STG). CTO/DBA/analytics sign-offs apply.
- Confluence publish is gated — do not publish from this folder without explicit instruction.
