# STG apply-readiness summary — per-component verdict

**Environment**: point-stg `471112755246` · **Branch**: `release/verup` tip `b829c472` (eks evaluated on the `eks/1.31` ladder branch) · **As of**: 2026-06-18

A component is **✅ apply-OK** when its plan matches what the code change intends, has no defect, no destructive surprise, no out-of-band prerequisite, and no open decision — i.e. it applies correctly once its turn comes in the spine order (ordinary upstream ordering is NOT a demerit). Anything needing a human gate is flagged.

**Legend** — Status: ✅ apply-OK · ⚠️ OK-but-gated (needs window / sign-off / pre-check / out-of-band prereq) · ⛔ blocked (must fix first). Plan freshness: 🆕 re-planned this session (b829c472 / eks@1.31) · 🗂 prior plan still valid (code unchanged since `21c92487`) · ⏳ forecast / blocked-on-upstream.

**Counts**: ✅ 21 · ⚠️ 24 · ⛔ 2 (of 47 spine rows; eks split into 21 + 21b). *(eks moved ⛔→⚠️ on 2026-06-18 after the `eks/1.31` auth-staging fix — see the eks rows.)*

---

## Per-component table (spine order)

| # | Component | Status | Plan freshness | Plan (+/~/−/⟳) | What must be true for ✅ |
|---|-----------|:------:|:--------------:|----------------|--------------------------|
| 0 | init/acm | ✅ | 🗂 | −3 | Destroys the deposed EXPIRED ALB cert + 2 dangling CNAMEs; cert-creation flags `false`; apex CNAME retained. Clean. |
| 0b | init/eip | ✅ | 🗂 | +2 | Creates the 2 missing NAT EIPs (`-az2`/`-az4`). **Apply before #8.** |
| 1 | infra/iam | ⛔ | 🆕 | +15 then exit 1 | **PR #105 (data-source→resource ref) OPEN.** `custodian-ViewerRolePolicy` absent in 471 → `no matching IAM Policy found`. Merge #105 (or bootstrap the policy out-of-band). Import only the 3 live roles (Admin/CICD/Operator); ViewerRole + all policies are greenfield. |
| 1a | ec2-bastion | ⚠️ | ⏳ | forecast | Depends on iam #1 (blocked). user_data-reboot trap mitigation + manual `growpart`/`resize2fs`. |
| 1b | eice | ⚠️ | ⏳ | +7 | Depends on #1/#8/#10; bastion `sshd` must be up (DEV's was disabled → EICE-SSH RST). |
| 2 | infra/audit | ⚠️ | 🗂 | +12/~7/−2 | Apply verup delta with `-target`; **DEFER `module.config`** until the `211125716602` Config-aggregator trust is confirmed. |
| 3 | infra/ebs-security | ✅ | 🗂 | +2 | EBS default encryption. Clean. |
| 4 | ecr | ✅ | 🗂 | +5 | Repo policies; ordering on iam #1. |
| 5 | sns-alert | ✅ | 🗂 | ~1 | Verify the sns-to-slack lambda zip. |
| 6 | notification-global | ✅ | 🗂 | 0/0/0 | Already converged. |
| 7 | notification | ✅ | 🗂 | +1 | Apply after #12b (ordering). |
| 8 | vpc | ⚠️ | 🆕 | +39/~3/−1 (blocked) | **init/eip #0b first** (plan exit 1 on missing az2/az4 EIPs). Decide the 2 unmanaged route losses (`10.50.0.121/32→VGW` Ponta, `172.19/16→pcx` verup-stg). Apply from laptop/CI, not bastion. maint window. |
| 9 | vpc_peering | ⛔ | 🗂 | +3 (apply fails) | **B1**: hardcoded `pcx-0c3d285e426241d9b` (`from_wallet_stg`) NotFound in 471. Wallet account must request the peering first; put the real pcx in `stg.tfvars`. |
| 10 | security_group | ⚠️ | 🆕 | +16/~2/−5/⟳7 | 3-step `alb-sg`→`alb-https-sg` controller swap; `3306→13306` flip (same window as Aurora #19); hulft `172.19/16` drain decision; **B2** regional ALB cert import before the ingress step. maint window. |
| 11 | endpoints | ⚠️ | 🆕 | +5/~10 | Correct (no destroy/replace), but the 10 policy tightenings flip `Principal:*`→role-ARN allowlists — **audit live callers first** or an active caller is denied. |
| 12 | secrets_manager | ✅ | 🗂 | 0/0/0 | Already converged. App must carry the CSI secrets bridge before pods consume. |
| 12b | event-notification | ✅ | 🗂 | 0/0/0 | STG already has the topic + lambda + secret. |
| 13 | waf-maintenance | ✅ | 🗂 | ~2 | Verify the env-specific IP set. |
| 14 | waf-admin | ✅ | 🗂 | +2/~3 | Be on `release/verup` (PAT pull); never copy DEV IPs — cross-check STG NAT/bastion egress. |
| 15 | waf-athena | ✅ | 🗂 | +3 | Account literal 471 in the Glue table location. Empty until waf-customer #39 lands the log source. |
| 16 | s3-maintenance | ⚠️ | 🗂 | +2/−1 | Pre-strip any public-read ACL (`put-bucket-acl --acl private`) to avoid the `InvalidBucketAclWithObjectOwnership` half-fail. |
| 17 | elasticache | ⚠️ | 🆕 | +3/0/0/⟳2 | **CRITICAL — REPLACE** (at-rest+transit+kms flip on redis 6.2.6). `snapshot_retention_limit=0` → cache data loss. maint window + ops sign-off; app must run Redis TLS. |
| 18 | redshift | ⚠️ | 🆕 | +2/~4 | KMS owned→CMK + `require_ssl` reboot + public→private subnet swap; multi-step (first apply fails `InvalidClusterState`). maint + CTO/analytics sign-off; **before glue-etl**. |
| 19 | aurora | ⚠️ | 🆕 | +2/~4/−1/⟳1 | **CRITICAL (judgment)** — cluster updated **in-place** (no data loss); port `3306→13306` reboot + both instances resize `r6g.xlarge→4xlarge` (`apply_immediately`); only `secret_version` replaced. maint + CTO/DBA; couple with SG #10. |
| 20 | aurora validate_password | ⚠️ | n/a | bastion scripts | Rotate password BEFORE install; chained to #19's window. |
| 20b | glue-etl | ⚠️ | ⏳ | +44 (forecast) | Blocked-on-upstream: vpc #8 secondary CIDR `100.64.0.0/16`. Sequence well after redshift `available`. |
| 21 | eks Stage-1 | ⚠️ | 🆕 | +35/~13/−18/⟳5 (eks/1.31 @ 4cb8fa7b) | **Auth-staging fixed (2026-06-18)**: now additive `CONFIG_MAP→API_AND_CONFIG_MAP` (aws-auth stays honored → no lockout this stage). VPC/subnet/SG/OIDC + all manifest IDs (LBC `vpcId`, IRSA SA ARNs, ECR) audited correct + account-pure. Gated by apply-time prereqs: **access entries need iam #1 (`custodian-ViewerRole`) + #32 (`point-cd-runner-role`) — both NoSuchEntity live now → apply eks AFTER iam #1 + #32 or `InvalidParameterException`**; **5 node-group ForceNew** (pod drain); **7 IRSA detaches** from `eks-worker-role` (workloads on IRSA SAs first); `endpoint_public→false` (private reachability). PR #104 cleared; guardduty/secrets-csi = create. |
| 21b | eks Stage-2 (→API) | ⚠️ | 🗂 | (one-way flip) | The one-way `API_AND_CONFIG_MAP→API` on the `eks/1.31-api` branch — **this** is where `aws-auth` stops being honored. Gate: enumerate every live `aws-auth` principal into `eks_access_entries` BEFORE this flip, or lockout. Separate window after #21 parity-wait. |
| 22 | eks 1.31→1.32 | ⚠️ | ⏳ | forecast | One-minor hop after #21b; re-replaces node groups. weeknight. |
| 23 | eks 1.32→1.33 | ⚠️ | ⏳ | forecast | One-minor hop. weeknight. |
| 24 | eks 1.33→1.34 | ⚠️ | ⏳ | forecast | One-minor hop; 5 node groups replaced create-before-destroy. weeknight. |
| 25 | k8s-manifests | ⚠️ | ⏳ | api +34/~7; others ~1 | Expect CrashLoop on first apply until app image + stateful cutover ready → keep replicas 0. **B2** regional cert for the `*.backseat-service.com` ingress. CoreDNS Ponta check. |
| 26 | s3-chart-snapshot | ✅ | ⏳ | forecast | Ordering on eks `point-app-irsa-role` (#24). |
| 27 | s3-csv-export | ✅ | 🗂 | +4 | Ordering on IRSA (#24). |
| 28 | s3-csv-export-admin | ✅ | 🗂 | +4 | Ordering on IRSA (#24). |
| 29 | s3-kyc | ⚠️ | 🗂 | +1/−2 | Live PII bucket; pre-strip non-`private` ACL (ownership conflict). Ordering on IRSA. |
| 30 | s3-year-report | ⚠️ | 🗂 | +4 (partial) | `terraform import aws_s3_bucket.this` FIRST (bucket pre-exists) else `BucketAlreadyOwnedByYou`. |
| 30b | s3-refinitiv-migration | ✅ | ⏳ | forecast | Re-plan once #24 IRSA materializes. |
| 32 | ec2-cd-runner | ✅ | 🗂 | +4 | Must precede eks #21 (creates `point-cd-runner-role`). Ordering on #10. |
| 33 | ec2-proxy | ✅ | 🆕 | +5 (forecast) | `.96` pin merged (#107) + accepted at plan-time. Blocked-on-upstream `proxy-sg` from #10 only — clean `+5` LOW once #10 applies. |
| 34 | ec2-data-transfer | ✅ | ⏳ | +4 (forecast) | Ordering on ec2-proxy #33; AMI confirmed public/available. |
| 35 | cloudwatch_metrics | ✅ | 🗂 | +2/~33/−2 | Apply immediately before #36 (orphan-metric window). |
| 36 | cloudwatch_alarm | ✅ | 🗂 | +2/~11/−2 | Verify no alarm references old `okcoinOrderbookGetter*`. |
| 37 | frontend-admin | ⚠️ | 🗂 | +3/~4/−1 | Live CloudFront in-place + S3 OAC migration; **DO-NOT-TOUCH** the STG manual proxy/OAuth. Cert NOT a blocker (covered by `d836a32c`). ALB HTTPS:443 live (#10) first. |
| 38 | frontend-customer | ⚠️ | 🆕 | +10/~6/−2 | PR #106 cleared (ACM→1 cert `d836a32c`); `−2` = non-stateful ACL only; manual proxy/OAuth NOT destroyed. HIGH: live CloudFront in-place + ALB origin http→https needs HTTPS:443 listener (#10). |
| 39 | waf-customer | ⚠️ | 🗂 | +20/~2/−1 | Pre-stage untaint-recovery (`country_restrict`+`core_rule_set`+`rate_limit_count`); re-detect preflight Case. maint window. |
| 39b | waf-maintenance-lambda | ⚠️ | 🗂 | ~7 | Chain in the same window as #39; confirm STG schedule-enabled flag. |

---

## The 2 ⛔ blockers (must clear before a clean apply)

1. **iam #1** — merge **PR #105** (or bootstrap `custodian-ViewerRolePolicy` out-of-band). Then import only the 3 live roles; ViewerRole + all policies are greenfield. Everything downstream of iam (ec2-bastion, eice, ecr, …) clears to ✅/⚠️ once iam is green.
2. **vpc_peering #9 (B1)** — the wallet account must **request** the `from_wallet_stg` peering into 471; capture the AWS-assigned `pcx-…`; update `stg.tfvars`. The current hardcoded ID does not exist.

> **Resolved 2026-06-18**: eks auth-staging was the 3rd blocker — fixed. The `eks/1.31` branch now does the additive `CONFIG_MAP→API_AND_CONFIG_MAP` (Stage-1, no lockout), with the one-way `→API` deferred to Stage-2 (`#21b`). eks is now ⚠️ gated (node-group drain + IRSA wiring), not ⛔.

## Out-of-band prerequisites that gate the ⚠️ window items (not code, but required)
- **B2 — regional ALB cert**: import a valid `*.backseat-service.com` cert into `471/ap-northeast-1` (only an EXPIRED `*.stg.` cert exists) before the k8s ingress / ALB swap (#10, #25).
- **Stateful sign-offs**: elasticache (ops, cache wipe) · aurora (CTO+DBA) · redshift (CTO+analytics) — each in a maintenance window.
- **vpc route decision** (B5): re-add or sunset `10.50.0.121/32→VGW` + `172.19/16→pcx` on the new az2/az4 route tables.
- **211 Config trust** (audit #2): confirm `cm-config-role-all-regions` before converging `module.config`.

## Freshness note
🆕 rows were re-planned this session against `b829c472` (eks on `eks/1.31` @ `43729121`) — see `REPLAN-CORE-SYNTHESIS.md`. 🗂 rows carry the prior `21c92487` plan, still valid because `git diff 21c92487..b829c472` touched only 3 files (the 3 merged PRs). ⏳ rows are forecast/blocked-on-upstream and firm up as their upstream applies. Re-plan any 🗂/⏳ row immediately before its window if live state may have drifted.
