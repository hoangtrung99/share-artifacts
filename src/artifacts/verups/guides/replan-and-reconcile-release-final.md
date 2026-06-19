# Re-plan all components → reconcile `release-final/` — workflow runbook

A repeatable two-phase workflow: (1) re-plan **every** in-scope `bs-point-infra release/verup` target against live point-dev, then (2) surgically refresh the consolidated evaluation docs under `docs/migrations/release-final/` so their risk levels, plan counts, gates, and SHA match the fresh plans — **without** discarding the hand-curated corrections those docs exist to hold.

This is plan-only / read-only end to end. It never runs `terraform apply` or any AWS write.

---

## When to run

- `release/verup` HEAD advanced (new component merged, a component refactored) and the `release-final/` numbers/gates are now stale.
- The last full re-plan is more than ~2–3 weeks old, or only a partial subset was re-planned.
- Before a go/no-go review, to confirm every row is backed by a HEAD plan rather than a stale one.

Reference baseline: the 2026-06-08 run re-planned 49 targets at HEAD `46fb02e0` (40 components + 4 infra + 5 k8s) — its outputs are the worked example throughout.

---

## Phase 1 — Re-plan all targets

Driver: the `verup-to-point-plan` skill. It *is* the orchestrator — it fans out one `terraform-plan-evaluator` subagent per target with the read-only safety contract, builds per-component context first, and aggregates. Do **not** re-implement planning by hand or in a generic agent harness; that bypasses the account guard, the per-session worktree, and the context enrichment.

1. **Pre-flight, by hand, before invoking the skill:**
   - Account guard: `aws sts get-caller-identity --profile point-operator-dev` must return account `905418018638`. If the SSO session is stale, the user runs `aws sso login --profile point-operator-dev` (interactive — agents cannot).
   - Fetch the branch: `git -C bs-point-infra fetch origin release/verup` and note the HEAD SHA — this is the SHA every downstream doc must cite.
2. **Invoke the skill for the full scope** (env=dev, all sections + infra + k8s):
   - `/verup-to-point-plan --dev --all-sections --concurrency 8` and additionally cover the `infra` and `k8s` categories (the default no-flag invocation already includes all three categories; `--all-sections` covers the 30 section-components, but the ~9 non-section components — `s3-*`, `ec2-cd-runner/-data-transfer/-proxy`, `waf-athena`, plus any newly-merged component — must be globbed from `terraform/components/` so nothing is missed).
   - Phase 0 of the skill refreshes the component-context manifest; if Jira fetch is flaky, it proceeds with `CONTEXT_FRESHNESS=partial` (the plan numbers do not depend on the manifest).
3. **Classify every failure** (this is the part that makes the re-plan *accurate*, not just fresh). point-dev is brownfield and all cross-component coupling is via AWS **data-source lookups by tag/name**, not `terraform_remote_state`. So a downstream `terraform plan` fails at refresh whenever an upstream migration resource has not been applied yet. Tag each result:
   - **(A) blocked-on-upstream** — fails only because an earlier apply-order row has not run. Expected; not a defect. Name the precise upstream (e.g. `point-app-irsa-role`, `cd-runner-sg`, the `alert-lambda-event-notification` SNS topic, the VPC secondary-CIDR subnets).
   - **(B) genuine defect** — order-independent code/config error (a missing module version pin, syntax, wrong arg). These are the real apply-blockers to fix in source.
   - **(C) verify-only no-op** — `0/0/0` or disabled-by-flag; excluded from the apply ladder.

   Feed each agent a short `DEPENDENCY_CONTEXT` (upstream prereqs + apply-order row, sourced from `docs/migrations/verup-to-point/W5-DEPENDENCY-MAP.md` and `docs/migrations/release-final/apply-order-CANONICAL.md`) so it classifies A/B/C itself instead of reporting an ambiguous "broken".
4. **Opus second-opinion** on any target the evaluators flag `NEEDS_OPUS_REVIEW` (stateful destroy/replace, one-way changes, cross-account references, ambiguous risk, newly-refactored components). The skill's Phase 3.5 spawns `evaluation-opus-reviewer`; let it append `## Opus second opinion` and revise `plan-meta.json` risk levels before aggregating.
5. **Aggregate** (skill Phase 4) → `docs/migrations/plans/dev/SUMMARY.md` + `LAST_RUN.md` + `runs/<session>.{md,json}`.
6. **Cross-component impact** (skill Phase 4.5) → one analyzer per section → `docs/migrations/plans/dev/cross-component-impact-<section>.md` (deploy order + intra-section cross-impact).
7. **Cleanup** (skill Phase 5): restore the original kubectl context; `git worktree remove --force` the per-session plan worktree **only after** the Phase 4.5 analyzers finish (they read source from it).

Output of Phase 1: a complete, freshly-classified `docs/migrations/plans/dev/` tree at the new HEAD SHA.

---

## Phase 2 — Reconcile `release-final/` (surgical)

The six docs under `docs/migrations/release-final/` are **hand-curated**: corrected apply order, wrong-account IDs replaced, brownfield framing, the EKS auth/ladder sequencing, the WAF/geo invariant. A full regenerate would wipe exactly those corrections. So update only the plan-derived facts and **add**, never overwrite, a dated delta block.

Edit map:

| Doc | What to change |
|-----|----------------|
| `README.md` | The `release/verup @ <SHA>` line; add a one-paragraph "Round-N full re-plan" note with the fresh aggregate counts + a pointer to `../plans/dev/SUMMARY.md` and the run file. |
| `apply-checklist-DRAFT.md` | Header `fresh-plan SHA` line; insert a `## §Round-N` block (new apply-blocking gates, corrections to existing G-gates, the A/B/C key, the expected-cold-plan-fail inventory, any new components). Leave the curated G1–G13 and per-row cards in place — the delta block supersedes where they conflict. |
| `apply-order-CANONICAL.md` | Header SHA pointer; append a `## Round-N corrections` section (per-row plan-number/risk moves, new components not yet slotted, any row that gained a hard blocker). |
| `RELEASE-VERUP.md`, `RELEASE-VERUP-full-module.md` | A short `⚠ Round-N re-plan` banner under the first heading pointing at the two delta sections above. These are Confluence-mirror variants — do not rewrite their tables. |
| `MANUAL-RUNBOOK.md` | Header SHA; a `⚠ Round-N` banner listing only the execution-affecting deltas (e.g. an init blocker, a changed apply procedure, a new sign-off gate). |

Rules:
- Quote the fresh numbers (`+add/~change/-destroy/⟳replace`, risk level) verbatim from `plan-meta.json` / `SUMMARY.md`.
- Carry a `plan_failed` (A)-classified target into the docs as **blocked-on-upstream**, not "go" and not "broken".
- A `(B)` genuine defect is a real new apply-blocking gate — add it, with the fix.
- Keep apply-only warnings and gates in the docs (these are in-repo runbooks, not a shared deliverable), but never paste secrets or live credentials.

---

## Guardrails (carried from the 2026-06-08 run)

- The plan worktree is per-session under `.worktrees/plan-release-verup-<session>/`; never share it across concurrent runs and never hard-code its path.
- `terraform.sh --env dev` (not `dev-ex`) for point; the shell may carry a stale `AWS_PROFILE=bs-point-dev` (legacy account `845131030484`) — force `point-operator-dev` or init fails on the state bucket.
- Cross-account ARNs that look foreign are sometimes intentional: the Config aggregator role in account `211125716602` (point prd) is referenced by design from `infra/audit`; verify trust live rather than flagging it as a leak.
- k8s overlays diff alarmingly against an un-bootstrapped cluster (the Secrets Store CSI stack is provisioned by an EKS addon + `k8s-manifests/bin/k8s_apply.sh` ordering, not by the overlay) — that is (A) apply-order, not a manifest defect.
