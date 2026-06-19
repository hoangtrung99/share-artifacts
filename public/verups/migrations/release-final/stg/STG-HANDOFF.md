# STG handoff — building the release/verup apply table for point STG

**Purpose.** This is the handoff for producing a `RELEASE-VERUP.md`-style apply table (+ `APPLY-COMMANDS-DEV.md` / `MANUAL-RUNBOOK.md` equivalents) for **point STG**, reusing the work already done for **point DEV** (account `905418018638`). It captures (1) the method used to build the DEV table, (2) every DEV→STG delta that is already known, and (3) the open items that must be confirmed against live STG before the STG table is trustworthy.

> **Scope note.** The DEV docs in this folder are the finished product for `--env dev` (point-dev `905418018638`). STG is a *separate apply* with a smaller VPC, a different account, multi-NAT, and a handful of STG-only resources. Do **not** copy the DEV table and only swap the account — the deltas below change order-relevant facts (IP headroom, NAT EIP count, the glue-etl secondary-CIDR dependency, the EKS window split, the WAF rule count).

---

## 1. Target identity (confirm first)

| Field | DEV (done) | STG (to build) | Source / note |
|---|---|---|---|
| Apply command | `../../terraform.sh --env dev …` | `../../terraform.sh --env stg …` | `terraform.sh` does NOT pin a profile — credential is ambient (bastion instance role); `--env` selects only the tfvars var-file + state backend |
| Account | `905418018638` (point-dev) | **`471112755246`** (point-stg) | DEV applied to a *point* account; the migration targets point. The STG **bastion** is in `471112755246`, so `--env stg` applies there. Read-only after-checks use profile `point-operator-stg` (→ `471112755246`). ⚠ `520411743393` is the **verup-stg source** (sunset) — the migration never applies there. |
| Region | `ap-northeast-1` (CloudFront/ACM/WAF-CLOUDFRONT `us-east-1`) | same | unchanged |
| Profile in commands | none (runs via SSM on point-bastion, instance role) | none (same) | keep commands `--profile`-free; STG bastion has its own instance role |
| State backend | `tfstate.bs-point-dev` | the STG state bucket the wrapper selects for `--env stg` (in `471112755246`) | account-guard: `init` must print `Backend: s3`, never `local` |

> ✅ **Account RESOLVED — apply target is `471112755246` (point-stg).** Evidence: the project banner ("Phase 4 STG apply … point-STG account `471112755246` … has not started"); DEV applied to point-dev `905418018638` and the migration targets *point*; the plan skill `env-registry.yaml` maps `stg → point-operator-stg / 471112755246`; `terraform.sh` pins no profile (the STG **bastion** instance role in `471` provides the credential, `--env` only selects tfvars + state backend). `520411743393` (`bs-point-stg`) is the **verup-stg source** account being sunset — never an apply target. Use `point-operator-stg` (→ `471`) read-only for after-checks, exactly as DEV used `point-operator-dev`. Confirm once on the STG bastion: `aws sts get-caller-identity` → `471112755246`. (See `DEV-APPLY-ANALYSIS.md §0`.)

---

## 2. DEV→STG deltas (known, from `release/verup` tip `d0625eca` stg.tfvars + the DEV docs' "STG (out of dev scope)" callouts)

| Area | DEV | STG | Impact on the table |
|---|---|---|---|
| **VPC CIDR** | `172.18.0.0/16` (/16, ~big) | **`10.51.187.0/24`** (vpc/stg.tfvars) — a **/24** | **Risk #1 (IP shortage) is acute** — a /24 has far fewer free IPs/subnet. The vpc + security_group after-checks MUST verify ≥7 free IPs/subnet against the real /24 subnet sizes (not the DEV 223-249 numbers). Re-derive subnet CIDRs from `vpc/stg.tfvars`. |
| **NAT / EIP** | `single_nat_gateway = true` → 1 EIP (`point-nat-apne1-az1`) | `single_nat_gateway = false` → **3 EIPs** (`point-nat-apne1-az1/-az2/-az4`), eip/stg.tfvars | `#0b init/eip` is NOT verify-only-1-EIP on STG — it manages 3 EIPs (`aws_eip.nat1/2/3`). Confirm all 3 exist (already-applied?) or are created. `vpc` data-sources all 3 by name. |
| **VPC secondary CIDR** | secondary `100.64.0.0/16` subnets present (glue-etl prereq) | `secondary_enabled = false`, `secondary_vpc_cidr = ""` (vpc/stg.tfvars) | **glue-etl's `data.tf` secondary-subnet postcondition cannot be satisfied on STG as-is.** Either secondary CIDR must be enabled for STG, or glue-etl is out-of-scope on STG. Resolve before slotting glue-etl. |
| **office_access_cidrs** | 2 IPs (`104.30.164.185/32`, `104.30.177.101/32`) | `office_access_cidrs = []` (empty) | vpc/security_group after-checks that assert office CIDRs differ; STG may gate office access differently. |
| **VPC peering** | accepter-only, `pcx` from a wallet-stg request | `peer_requester_vpc_cidr = ""` (empty) | the peering row's pre-step (capture the AWS-assigned `pcx`) is STG-specific; confirm whether STG peers at all. |
| **EKS auth-mode bridge** | DEV: Stage 1 (`CONFIG_MAP→API_AND_CONFIG_MAP`) + Stage 2 (`→API`) **same window, merged into the pre-ladder v21 step** (branches `eks/1.31` → `eks/1.31-api`) | **STG/PRD: Stage 1 + Stage 2 are SEPARATE rows, weeks apart** (parity-wait) | split the single DEV auth-bridge row into two rows in the STG table. Same gates (cd-runner role, RBAC binding, `named_user=bs-developer`, escape-hatch) apply to each stage. |
| **waf-customer (Path B)** | `priority-targets-dev.json` = **11 rules** (`is_public=false`, `enabled_managed_ip_rules=false`) | `priority-targets-stg.json` = **13 rules** (DEV set + `ip_reputation_list_count:6` + `anonymous_ip_list_count:7`; `enabled_managed_ip_rules=true`) | plan magnitudes differ; preflight-renumber runs with `--profile point-operator-stg --expected-account 471112755246` per the script, but the apply is `--env stg`. STG customer WebACL id = **`bc4ca936`** (vs DEV `30988cab`). |
| **Frontend (customer) STG-only resources** | n/a | STG has **manually-created proxy + OAuth resources** (Confluence Risk #3) | **Do NOT touch / destroy** the manual STG proxy + OAuth frontend resources. The frontend-customer apply must be reviewed to not clobber them. This is a STG-specific gate absent on DEV. |
| **Cert domains** | `dev.backseat-service.com` zone (905-owned); frontend-admin alias `bo.dev.backseat-service.com`; customer alias `dev.backseat-service.com` | STG zone + aliases differ (`stg.…` / `bo.stg.…` — confirm from frontend tfvars) | re-derive every ACM/CloudFront after-check host + the import-only cert coverage gate from STG's `zone_name`/`certificate_name`/aliases. The distro IDs (DEV `E1BIDPQ5G0BYCB` / `E3ETPFX8HYQZPU`) are DEV-only — look up STG's. |
| **init/acm cert** | tfvar flipped `true→false`; apply DESTROYS the stale AMAZON_ISSUED cert | stg.tfvars also flipped `true→false` (commit `7cd80a95` touched dev/prd/stg) | same logic: STG init/acm apply destroys the STG-side stale cert IF it was applied under `=true`. Re-derive the STG cert ARNs (do not reuse DEV's `cb4bfaf0`/`07c7a840`). |

---

## 3. What carries over UNCHANGED (reuse directly)

- **Execution order + gate logic** — the whole spine is the same: Bootstrap (init/acm apply-destroy, init/eip) → Foundation (iam, audit, ebs, ecr, sns-alert, notification-global) → Connectivity (vpc, vpc_peering, security_group, **ec2-cd-runner**, endpoints) → Secrets/WAF (secrets_manager, event-notification, notification, waf-*, s3-maintenance) → Stateful (elasticache, redshift, aurora, validate-pw, glue-etl) → EKS (**version ladder THEN auth-bridge**) → Post-EKS (k8s, S3×N, ec2-*, cloudwatch, frontend-customer→admin, waf-customer→maintenance-lambda).
- **The dropped/no-op rows** — blank, waf-customer duplicate, obsolete eks 1.30→1.31, endpoints re-apply: drop them on STG too.
- **The resolved gates** (verified at `d0625eca`, account-agnostic code): G14 (security_group SG modules pinned `~>5.3`), G12/Bug B (aws-auth + eks `named_user = bs-developer`), G9/G10 (ALB-controller vpcId / k8s_apply.sh rbac path) — all fixed in code, apply to STG identically.
- **The still-open gate *classes*** (re-verify the STG values): G1/R3-EKS-01 (eks staged ladder/bridge — STG splits the bridge), G6/G11 (certs — STG hosts), G7/OPUS-GATE-A (iam custodian trust + audit `211` config-role — confirm STG trust), R2-PEER-01 (STG peering), G8 (STG stateful window).
- **Command shape** — `--profile`-free, `--region` explicit, `--query` + expected output, DB checks as Secrets Manager + jq one-liners (`point/aurora/viewer_user` etc. — same secret IDs, STG account). after-check is the canonical column; the `apply command` column carries the paste-in `§N` blocks.

---

## 4. How the DEV table was built (the method to repeat for STG)

1. **Order spec** = the true gate-driven execution order (Bootstrap→Foundation→Connectivity→Secrets/WAF→Stateful→EKS→Post-EKS), resolving the documented `⚠ ORDER` exceptions physically (ec2-cd-runner before EKS; auth-bridge after the ladder; notification after event-notification; frontend-customer before admin; waf-customer deferred tail). Renumber monotonically `0,0b,1..N`.
2. **Gate truth** = read the actual code at the apply tip (here `d0625eca`, worktree-checked) — never trust commit titles or current tfvar values alone. A `count = var.x ? 1 : 0` resource whose tfvar flipped `true→false` is a **destroy**, not a no-op (the init/acm lesson).
3. **Commands** = full runnable, `--profile`-free (SSM bastion), `--region` explicit, `--query` + expected output. **Validate read-only** by running every `describe/get/list` with the read-only profile (`bs-point-stg` for STG) — this proves syntax + JMESPath + resource-name; post-apply gates returning empty/NotFound is expected, not a bug.
4. **after-check is the canonical column**; when it disagreed with the `apply command` "After:" line, resolve to the verified-correct value and sync both.
5. **Apply mechanically + verify**: drop dead rows, reorder by component, renumber, then remap **every** inline `#N` cross-ref in one collision-safe pass (skip PR#/`Risk #N`/`memo #N`; expand ranges; cross-file refs → component name). Guard with **content-preservation** (strip the `#` column + all `#`-tokens → the rest must be byte-identical) + an **adjacency check** (`<component> #N` must match) + column-count + row-count. Fix pre-existing ref typos at the source first.

---

## 5. Build checklist for the STG table

- [ ] `aws sts get-caller-identity --profile bs-point-stg` → confirm `520411743393` (the apply target).
- [ ] Re-derive VPC/subnet CIDRs + free-IP after-checks from `vpc/stg.tfvars` (`10.51.187.0/24`) — Risk #1 is acute.
- [ ] `#0b init/eip`: confirm the 3 STG NAT EIPs (`nat1/2/3`) state — applied already or to-create.
- [ ] Decide glue-etl on STG (secondary CIDR is disabled) — enable secondary or mark glue-etl out-of-scope.
- [ ] Split the EKS auth-bridge into Stage 1 + Stage 2 rows (separate windows).
- [ ] Pull STG cert ARNs, CloudFront distro IDs, customer WebACL `bc4ca936`, and the 13-rule waf priority targets.
- [ ] Flag the STG-only manual proxy/OAuth frontend resources as DO-NOT-TOUCH (Risk #3).
- [ ] Re-validate every after-check read-only against `520411743393`.
- [ ] Confirm the `211125716602` config-role trust + IAM custodian trust for STG (G7/OPUS-GATE-A) before infra/audit + infra/iam.

---

*Companion docs (now in `../dev/`, DEV finished product, execution-ordered): `RELEASE-VERUP.md` (parent variant), `RELEASE-VERUP-full-module.md` (full list), `APPLY-COMMANDS-DEV.md` (paste-in), `MANUAL-RUNBOOK.md` (operator prose), `apply-order-CANONICAL.md` (reference order + per-row gates), `apply-checklist-DRAFT.md` (go/no-go gates). Refs: BB-1529 (EKS/verup priority), BB-1562 (vpc/eip), BB-1556 (security_group/aurora), BB-1473 (cert/frontend-admin), BB-1901 (peering/HULFT).*
