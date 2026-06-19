# Remaining blockers — investigation & remediation playbook (2026-06-09)

**Scope.** The actionable OPEN-blocker subset for the verup→point DEV migration: dependency-ordered, with owners, lead-times, and go/no-go. This is NOT a re-derivation of the full plan — for the complete row order see `apply-order-CANONICAL.md`, for the per-row cards/corrections see `apply-checklist-DRAFT.md`, for the 2026-06-08 AWS-CLI sweep see `apply-checklist-AWS-VERIFICATION-20260608.md` and `SESSION-REPORT-2026-06-08.md`.
**Branch / target.** Apply branch `release/verup` @ tip `6672bbb6` (`bs-point-infra`). Target point DEV `905418018638` (profile `point-operator-dev`, region `ap-northeast-1`; CloudFront/ACM in `us-east-1`). STG `471112755246` checked only where cross-env contrast mattered. All re-checks below were run read-only against live AWS on 2026-06-09.

---

## 1. Executive summary

**10 OPEN blockers**, by type:

| Type | Count | Gates |
|---|---|---|
| external-leadtime (cannot self-serve; another team/account must act) | 1 | R2-PEER-01 |
| cross-account-blind (verification impossible from dev/stg) | 1 | G7 |
| team-controlled (no external lead time; sign-off or sequencing inside 905) | 6 | G1, R3-EKS-01, OPUS-GATE-A, G6, G11, G8 |
| code-fixable (config already correct; pure apply-ordering / one-line edit) | 2 | G4, G13 |

Plus **G12** — PROCEDURE-ONLY hygiene, non-blocking (dead `bs-operator` ref in `aws-auth-cm.yaml`; admin is fully covered by `mapRoles`). Listed in §5 for completeness but does NOT count toward the 10.

**Single critical path.** The EKS choreography (`G1` + `R3-EKS-01`, one path, not two): apply `ec2-cd-runner` (#32) → climb the version ladder 1.31→1.32→1.33→1.34 with auth left at `CONFIG_MAP` → pre-apply the RBAC bindings → auth-bridge to `API_AND_CONFIG_MAP` → **manual prove-gate** (confirm API-mode admin works) → flip to `API` LAST. This is the longest internally-sequenced item (1–2 working sessions, with a mandatory human verification gate mid-sequence) and the one with irreversible lockout exposure if done out of order.

**What to request TODAY.** Fire the **845-side VPC-peering request (R2-PEER-01)** — it is the only thing you cannot self-serve and the longest external pole (1–3 business days for cross-account coordination). In the same breath, send the **211-account Config-role trust question (G7)**, request **both ACM certs (G6 us-east-1 + G11 ap-northeast-1)**, and open the **IAM custodian-trust sign-off (OPUS-GATE-A)**. None of these four block on each other; start all of them today.

---

## 2. REQUEST NOW — external lead-time (fire today, longest-pole first)

These are the items whose clock starts the moment you ask. Lead with R2-PEER-01 and G7 (genuine multi-day external poles); the two cert rows self-resolve within the hour but must be **requested** today so the apply isn't waiting on them.

| Item | Who to ask | Exactly what to request | Blocks which row(s) | Lead-time |
|---|---|---|---|---|
| **R2-PEER-01** VPC peering | 845 (`bs-point-dev`) requester operator | Create a peering request from the 845 wallet VPC (CIDR `192.168.0.0/16`) targeting 905 VPC `vpc-0f49bf7456fa50d08`, peer account `905418018638`, region `ap-northeast-1`. Share the AWS-assigned `pcx-` ID back over a secure channel. | `vpc_peering` accepter + its 2 route entries | **1–3 business days** (cross-account coordination). 845 has zero pending requests as of 2026-06-09 — the long-pole has not started. After the pcx is shared, the 905-side edit + apply is <30 min. |
| **G7** Config recorder cross-account role | Owner of point-prd account `211125716602` | Written confirmation that `cm-config-role-all-regions` EXISTS in 211 and its trust allows `config.amazonaws.com` to be used as the recorder role by account `905418018638` in BOTH `ap-northeast-1` AND `us-east-1` (and `ap-northeast-3` if enabled). Ask for the `AssumeRolePolicyDocument` + attached policies. | `audit` → `module.config[0]` (the recorder role_arn flip) | **Days** — gated entirely on the 211 owner's response. Cannot be self-served; no 211 profile exists from dev/stg. |
| **OPUS-GATE-A** IAM custodian-trust sign-off | 905 IAM/security owner | Sign-off on the per-role trust diff (LIVE→HEAD): dropped cross-account roots `728927523062` + `590183696997`, dropped CI user `bs-cicd-test`, and SourceIp narrowing to the 2 Cloudflare /32s `104.30.164.185` + `104.30.177.101`. Confirm operators still reach the custodian roles via those egress IPs. | `infra/iam` custodian role/policy resources | **Same-day to a few days** — depends on sign-off turnaround. Code edit is minutes. |
| **G6** CloudFront cert (us-east-1) | infra/platform team (self-service in 905) | Request a public ACM cert `*.dev.backseat-service.com` in **us-east-1**, DNS validation. Place the validation CNAME in the 905-owned `dev.backseat-service.com` zone. | `frontend-admin` CloudFront cert swap | **<1 hour** (DNS validation 5–30 min; zone is in 905). Request today. |
| **G11** ALB cert (ap-northeast-1) | infra/platform team (self-service in 905) | Request a public ACM cert `*.dev.backseat-service.com` in **ap-northeast-1**, DNS validation. Reuse the same validation CNAME as G6 if ACM issues the same token; else add a second CNAME. | k8s `ingress.yaml` HTTPS:443 listener | **<1 hour** (parallel with G6). Request today. |

> ACM certs are regional — G6 (us-east-1, for CloudFront) and G11 (ap-northeast-1, for the ALB) are **two separate requests** even though the domain is identical. Both validate against the same 905-owned zone, so neither needs cross-account coordination as long as you use `*.dev.backseat-service.com` (NOT the level-2 `*.backseat-service.com`, whose apex zone is not in 905).

---

## 3. Team-controlled blocks (no external lead time; sequencing or sign-off inside 905)

These do not wait on another team's calendar — they wait on us executing in the right order, or on an internal sign-off:

- **EKS choreography (G1 + R3-EKS-01)** — the critical path. Authoring the 4 ladder branches + running the climb + the manual prove-gate. 1–2 working sessions. See the cards in §5.
- **OPUS-GATE-A (IAM)** — already in §2 because it needs an owner sign-off, but the *code* fix (reconcile tfvars or `-target` around the custodian roles) is ours and takes minutes once the sign-off lands.
- **G6 / G11 (certs)** — the cert *request* is in §2 (fire today); the *code* changes (tfvars domain + `data.tf` `types`, ingress annotation) are ours and land in the same PR.
- **G8 (stateful maintenance window)** — purely a scheduling + runbook-discipline gate; coordinate a low-traffic window with the app team. No external dependency.
- **G4 (ALB SG swap)** — runs inside the G8 window; controller-driven, no external dependency.
- **G13 (event-notification chain in DEV)** — DEV-only convergence; all three components apply within 905. The only non-Terraform step is pasting the Slack webhook value into the new secret.

---

## 4. Critical-path dependency note (read before §5)

`G1` and `R3-EKS-01` are **one path**, not two parallel gates. `G1` is the code (the 4 ladder branches + the auth-bridge branch); `R3-EKS-01` is the ordered choreography that wraps it. The hard prerequisite is `ec2-cd-runner` (#32): `point-cd-runner-role` is `NoSuchEntity` until it applies, and the auth-bridge access entries reference that role. Per the Round-2 correction (G3), there is **no eks↔cd-runner plan cycle** — the only edge is `ec2-cd-runner BEFORE eks`. On the FIRST eks apply (the 1.32 rung) the EKS module v17→v21 bump will churn cluster-role policy attachments; eyeball that the plan **re-attaches** (does not permanently drop) `AmazonEKSVPCResourceController` / `AmazonEKSClusterPolicy` / `AmazonEKSServicePolicy` — losing `AmazonEKSVPCResourceController` breaks the VPC CNI / security-group-for-pods controller.

---

## 5. Per-gate remediation cards

### G1 — Version-ladder + auth-mode bridge branches do not exist; tip couples a 3-minor version jump with the auth flip in one apply

- **Status:** OPEN · **Risk:** CRITICAL · **Type:** team-controlled · **Owner:** Platform/Infra
- **Status update (2026-06-10):** the 4 staged branches (`eks/1.32`, `eks/1.33`, `eks/1.34`, `eks/auth-mode-bridge`) were created and pushed — G1's branch-creation half is done; the staged applies remain.
- **Component:** `terraform/components/eks` (module `terraform-aws-modules/eks/aws ~> 21.1.0`) + branches
- **Root cause:** `eks/tfvars/dev.tfvars` at tip hardcodes BOTH `cluster_version="1.34"` / `cluster_node_version="1.34"` (nodegroups `*-1-34-20260428`, addons pinned to 1.34) AND `authentication_mode="API"`. Live cluster is `1.31` / `CONFIG_MAP`. A single apply of tip therefore attempts a 3-minor control-plane jump (rejected by AWS, one minor at a time) AND a direct `CONFIG_MAP`→`API` flip (rejected; must transit `API_AND_CONFIG_MAP`) simultaneously. No incremental branches exist to do this one rung at a time.
- **⚠ CONTRADICTS BASELINE (sharpens it):** the baseline framed tip as a CONFIG_MAP→API flip ONLY. Live tip ALSO already pins version 1.34 + node 1.34 + 1.34 nodegroup/addon names — so tip couples the 3-minor version jump WITH the auth flip in one apply: **strictly worse** than the single-flip framing. The 4-branch ladder is mandatory for the version climb itself, not just for auth.
- **Live re-check 2026-06-09:** cluster `point` = version `1.31`, `authenticationMode=CONFIG_MAP`, status ACTIVE, platform `eks.60`. `git branch -r` shows only `origin/feat/migrate-eks-noderole-irsa-dev` — NO `eks/1.32`, `eks/1.33`, `eks/1.34`, `eks/auth-mode-bridge`. `describe-cluster-versions` (ap-northeast-1): 1.32 (EXTENDED), 1.33/1.34/1.35/1.36 all AVAILABLE — the ladder is buildable; top rung 1.34 is NOT a blocker. 1.31 is in EXTENDED support (end ~2026-11-26) → upgrade urgency is real.
- **Remediation:**
  1. Create 4 sequential branches off `release/verup`, each changing ONLY the version pins (NOT auth), so each rung is a single-minor control-plane + nodegroup upgrade.
  2. `eks/1.32`: set `cluster_version="1.32"` + `cluster_node_version="1.32"`, rename all five `node_group_name` suffixes to `-1-32-<YYYYMMDD>`, bump each addon to a 1.32-compatible build. Keep `authentication_mode="CONFIG_MAP"`.
  3. `eks/1.33`: same with version 1.33, suffix `-1-33-<YYYYMMDD>`, 1.33 addons. Auth stays `CONFIG_MAP`.
  4. `eks/1.34`: version 1.34, suffix `-1-34-<YYYYMMDD>` (matches the tip nodegroup names), addons to the 1.34 builds already in tip (`vpc-cni v1.21.1-eksbuild.7`, `kube-proxy v1.34.6-eksbuild.2`, `coredns v1.13.2-eksbuild.4`, `csi v1.57.1-eksbuild.1`, `secrets-csi v3.0.0-eksbuild.1`). Auth STILL `CONFIG_MAP`.
  5. `eks/auth-mode-bridge` (created AFTER 1.34 is applied and ec2-cd-runner has run): change ONLY `authentication_mode` from `CONFIG_MAP` to `API_AND_CONFIG_MAP`. This is the dual-mode overlap window.
  6. Keep `authentication_mode="API"` (the final flip) OUT of every branch above — it is a separate apply done LAST (see R3-EKS-01).
  7. Each rung MUST get a NEW `node_group_name` suffix — changing `kubernetes_version` on a static-named managed nodegroup forces in-place replacement; a fresh name forces clean create/destroy.
- **After-checks:** `aws eks describe-cluster --name point --query cluster.version` lands 1.32→1.33→1.34 sequentially (never skipping); `list-nodegroups` suffix matches the rung; `describe-cluster --query cluster.accessConfig.authenticationMode` stays `CONFIG_MAP` through 1.34; `git branch -r | grep -iE 'eks/1.3|auth-mode-bridge'` shows all four branches before starting.
- **Can fix in code?** YES — this IS the code fix. Author the 4 branches; never have version≠live AND auth≠live in the same apply.
- **Lead-time:** Team-controlled. Branch authoring ~0.5 day; each minor upgrade ~20–40 min apply + node drain; full ladder realistically 1–2 sessions with verification between rungs. No external lead time.

### R3-EKS-01 — Full ordered EKS choreography + escape-hatch recovery runbook

- **Status:** OPEN · **Risk:** CRITICAL · **Type:** team-controlled · **Owner:** Platform/Infra
- **Component:** `terraform/components/ec2-cd-runner` + `terraform/components/eks` + `k8s-manifests/rbac` + `k8s-manifests/point/dev/aws-auth-cm.yaml`
- **Root cause:** the `→API` flip is irreversible to admins unless (a) access entries map a recovery principal to a working RBAC binding, and (b) the cd_runner access entry's principal (`point-cd-runner-role`) exists. The eks `main.tf` access entries are GROUP-MAPPING only (`enable_cluster_creator_admin_permissions=false`, no managed `AmazonEKSClusterAdminPolicy` association) — so an access entry alone grants ZERO RBAC perms; the admin group needs `k8s-manifests/rbac/clusterrolebinding-admin.yaml` applied and proven. `point-cd-runner-role` is `NoSuchEntity` today, so referencing it before `ec2-cd-runner` runs makes the auth-bridge plan fail.
- **Baseline:** NOT contradicted — confirmed (ec2-cd-runner BEFORE auth-bridge; dual window before final flip; RBAC binding must be proven). Refinement: the version ladder must FULLY complete (1.31→1.34, all CONFIG_MAP) BEFORE the auth-bridge, because tip couples version with auth — choreography is version-first, auth-second, not interleaved.
- **Live re-check 2026-06-09:** `list-access-entries` returns `InvalidRequestException` (cluster in CONFIG_MAP → ZERO access entries exist; the ONLY admin path today is the `aws-auth` ConfigMap `mapRoles`). `point-cd-runner-role` = `NoSuchEntity`. `cd-runner-role.tf` present at tip. `clusterrolebinding-admin.yaml` present (Group `admin` → `cluster-admin`). `point-bastion-role` exists (group admin in both aws-auth and access entries).
- **Remediation (ordered):**
  1. **STEP 0:** Apply `ec2-cd-runner` FIRST → creates `point-cd-runner-role`. Verify `aws iam get-role --role-name point-cd-runner-role` returns a Role (not `NoSuchEntity`) before any auth-bridge apply.
  2. **STEP 1 (version ladder, auth untouched):** apply `eks/1.32`, verify; then `eks/1.33`, verify; then `eks/1.34`, verify. Each rung: `../../terraform.sh --env dev plan|apply` from `terraform/components/eks`. Auth stays `CONFIG_MAP`; admin access remains via aws-auth `mapRoles`. Never skip a minor.
  3. **STEP 2 (pre-stage RBAC while still CONFIG_MAP):** `kubectl apply -f k8s-manifests/rbac/clusterrolebinding-admin.yaml` (and clusterrole-cicd/operator/viewer). Pre-applying makes the binding exist before the auth flip so API-mode access entries inherit it.
  4. **STEP 3 (auth-bridge stage 1 = API_AND_CONFIG_MAP):** apply `eks/auth-mode-bridge`. Materializes access entries (`custodian-AdministratorRole`→admin, `point-bastion-role`→admin, `user/bs-developer`→admin, `custodian-CICDRole`→cicd, `custodian-OperatorRole`→operator, `custodian-ViewerRole`→viewer, `point-cd-runner-role`→cicd). aws-auth ConfigMap STILL active → no lockout window.
  5. **STEP 4 (PROVE API-mode admin BEFORE the final flip):** from a principal that ONLY resolves via an access entry (assume `custodian-AdministratorRole` or `user/bs-developer`): `aws eks update-kubeconfig --name point`; `kubectl auth can-i '*' '*' --all-namespaces` (expect `yes`); `kubectl get nodes`; `kubectl get clusterrolebinding admin-cluster-admin`. If ANY check fails, STOP — do NOT flip to API; fix the access entry / RBAC binding first.
  6. **STEP 5 (final flip = →API, LAST and separate):** only after STEP 4 passes, apply the branch that sets `authentication_mode="API"`. This drops aws-auth as an auth source; from here ONLY access entries + RBAC govern access.
  7. **STEP 6 (post-flip verify):** re-run `kubectl auth can-i '*' '*'` as the access-entry admin; confirm the cd-runner pipeline (cicd group) can deploy.
  8. **ESCAPE-HATCH RECOVERY (if locked out after →API):** from a principal holding `eks:CreateAccessEntry` + `eks:AssociateAccessPolicy` — assume `custodian-AdministratorRole` (or `custodian-CICDRole` / `custodian-OperatorRole`; all three hold `AdministratorAccess` in 905) — run `aws eks create-access-entry --cluster-name point --principal-arn <your-arn>` then `aws eks associate-access-policy --cluster-name point --principal-arn <your-arn> --policy-arn arn:aws:iam::aws:policy/AmazonEKSClusterAdminPolicy --access-scope type=cluster`. Grants cluster-admin via the AWS-managed policy independent of the group-mapping RBAC binding. **OPERATOR-ONLY break-glass — not to be run by the audit.**
  9. **⚠ CROSS-GATE CAUTION (escape-hatch ↔ OPUS-GATE-A):** this break-glass depends on `custodian-AdministratorRole` being assumable. OPUS-GATE-A narrows that role's trust to two Cloudflare /32s AND drops the cross-account roots (`728927523062` / `590183696997`) + SourceIp `0.0.0.0/0`. If applied, break-glass then requires a `905` principal egressing via the Cloudflare IPs. **Do NOT apply the OPUS-GATE-A custodian-trust narrowing until the `→API` flip is proven AND you have confirmed at least one operator can still assume `custodian-AdministratorRole` from a sanctioned egress IP.** Sequence the IAM custodian-trust change AFTER the EKS flip, never before — narrowing it first can sever your own EKS recovery path.
- **After-checks:** `get-role point-cd-runner-role` exists before auth-bridge; `list-access-entries` succeeds once auth≥API_AND_CONFIG_MAP and lists all 7 principals incl `point-cd-runner-role`; `list-associated-access-policies` for `custodian-AdministratorRole` is reachable (escape-hatch principal); `kubectl auth can-i '*' '*'` = yes during the dual window AND after the final flip; `authenticationMode` = `API_AND_CONFIG_MAP` at stage 1, `API` only after the intended final flip.
- **Can fix in code?** PARTIAL. Branch sequencing + pin edits are code (G1). The ORDERING + the manual prove-gate + the break-glass recovery are an operational runbook — the prove-step between dual-mode and final-flip is a human gate by design and cannot live in a single terraform apply.
- **Lead-time:** Team-controlled. `ec2-cd-runner` apply (~10 min) + 3 minor upgrades (each 20–40 min + drain) + auth-bridge apply + manual prove-gate + final flip. 1–2 sessions with a mandatory human prove-gate. No external lead time; escape-hatch is pre-provisioned.

### G12 — `aws-auth-cm.yaml` mapUsers references nonexistent `bs-operator` (hygiene, non-blocking)

- **Status:** PROCEDURE-ONLY · **Risk:** LOW · **Type:** code-fixable · **Owner:** Platform/Infra
- **Component:** `k8s-manifests/point/dev/aws-auth-cm.yaml`
- **Root cause:** `mapUsers` maps `user/bs-operator` → group admin; `bs-operator` is `NoSuchEntity` in 905, so this is a dead reference. NOT an apply-blocker — aws-auth accepts a userarn for a nonexistent user (consumed only at auth time; a nonexistent principal simply never authenticates). Admin is fully covered by `mapRoles` → `custodian-AdministratorRole` + `point-bastion-role` (both exist live).
- **Live re-check 2026-06-09:** `mapUsers` still `user/bs-operator` (unchanged at tip); `bs-operator` = NoSuchEntity; `mapRoles` cover admin via both custodian + bastion roles.
- **Remediation:** (preferred) repoint the userarn to `user/bs-developer` to mirror the eks access-entry `named_user=bs-developer` and remove the dead ref; OR drop the `mapUsers` block entirely (admin fully covered by `mapRoles`). This ConfigMap becomes IRRELEVANT once auth flips to `API` — fix it only for the CONFIG_MAP / API_AND_CONFIG_MAP window; do not block the migration on it. Do NOT recreate an IAM user `bs-operator`.
- **Can fix in code?** YES — one-line edit or delete the block.
- **Lead-time:** None — trivial, non-blocking.

### G6 — CloudFront frontend-admin: no ISSUED cert covers `bo.dev.backseat-service.com`; `data.tf` filter trap

- **Status:** OPEN · **Risk:** HIGH · **Type:** team-controlled (self-service in 905) · **Owner:** infra/platform (905 owns the `dev.backseat-service.com` zone)
- **Component:** `terraform/components/frontend-admin` + `module-for-cloudfront`
- **⚠ BASELINE CORRECTED:** the baseline claimed `module-for-cloudfront/data.tf` filters `domain=dev.backseat-service.com` + IMPORTED + ISSUED → 0 matches → plan exits 1. This is **WRONG**. The filter is var-driven: `dev.tfvars` sets `cloudfront_certificate="*.backseat-service.com"`, so the resolved filter matches `07c7a840` (ISSUED, IMPORTED, valid to 2026-10-29) → **plan does NOT exit 1**. The real blocker is **wildcard-level mismatch**: `*.backseat-service.com` (level-2) cannot cover `bo.dev.backseat-service.com` (level-3). A tip-code apply would swap expired `2f009235` for `07c7a840`, but CloudFront may reject the cert-alias mismatch, or browsers hit a hostname-mismatch TLS error. PLUS a latent trap: `data.tf` `types=["IMPORTED"]` will return 0 matches (plan exits 1) once the replacement DNS-validated (AMAZON_ISSUED) cert exists — so both the domain AND the types must change together.
- **Live re-check 2026-06-09:** us-east-1 ACM unchanged — `cb4bfaf0` EXPIRED AMAZON_ISSUED (SANs include `*.dev.backseat-service.com`, but `RenewalEligibility=INELIGIBLE` → cannot renew/reimport), `2f009235` EXPIRED IMPORTED `*.backseat-service.com`, `07c7a840` ISSUED IMPORTED `*.backseat-service.com`. CloudFront `E3ETPFX8HYQZPU` aliases `[bo.dev.backseat-service.com]`, still serving the EXPIRED `2f009235` (no apply has run). Route53: only `dev.backseat-service.com` (`Z05152021OVITF5CDWTRI`) is in 905; apex `backseat-service.com` is NOT — so `*.dev.backseat-service.com` requests are fully self-service.
- **Remediation:**
  1. Request a public ACM cert in **us-east-1**, `*.dev.backseat-service.com`, DNS validation. Do NOT reuse `cb4bfaf0` (expired, INELIGIBLE).
  2. Place the validation CNAME in the `dev.backseat-service.com` zone (`Z05152021OVITF5CDWTRI`, account 905) — no cross-account coordination. Validation completes in ~5–30 min.
  3. After Status=ISSUED, note the ARN.
  4. Edit `terraform/components/frontend-admin/tfvars/dev.tfvars`: `cloudfront_certificate = "*.dev.backseat-service.com"`.
  5. Edit `terraform/components/frontend-admin/module-for-cloudfront/data.tf`: `types = ["AMAZON_ISSUED"]` (mandatory — the new cert is DNS-validated; leaving IMPORTED returns 0 matches → plan exits 1). Blast radius: `frontend-admin` only — frontend-customer uses its own root cloudfront.tf and does not share this sub-module.
  6. `terraform plan --env dev` from `terraform/components/frontend-admin` → confirm the data source resolves to the new ARN and `viewer_certificate.acm_certificate_arn` will change from `2f009235`.
  7. After review approval, apply. CloudFront propagation ~10–15 min. Verify `curl -vI https://bo.dev.backseat-service.com` — no hostname mismatch, issuer Amazon.
- **After-checks:** `describe-certificate <new-arn>` (us-east-1) → ISSUED / AMAZON_ISSUED / `*.dev.backseat-service.com`; `get-distribution E3ETPFX8HYQZPU` → ACMCertificateArn no longer `2f009235`; `curl -vI https://bo.dev.backseat-service.com` succeeds.
- **Can fix in code?** YES — two changes, sufficient once the ARN is known: tfvars domain + `data.tf` `types`. No blast radius beyond frontend-admin.
- **Lead-time:** DNS validation 5–30 min (self-service, same account) + CloudFront propagation ~15 min. Under 1 hour if requested immediately.

### G11 — ALB ingress (ap-northeast-1): no ISSUED regional cert; missing certificate-arn annotation

- **Status:** OPEN · **Risk:** HIGH · **Type:** team-controlled (self-service in 905) · **Owner:** infra/platform (905 owns the dev zone)
- **Component:** `k8s-manifests/point/dev/ingress.yaml` + ap-northeast-1 ACM
- **Root cause:** ap-northeast-1 ACM has 0 certs. `ingress.yaml` sets `listen-ports=[{HTTPS:443}]` but has NO `alb.ingress.kubernetes.io/certificate-arn` annotation. The Load Balancer Controller cannot create an HTTPS listener without a cert ARN → ALB not created or falls back to HTTP-only, blocking all backend services. `spec.tls.hosts=*.backseat-service.com` is a level-2 wildcard whose apex zone is not in 905 (cross-account-blind path) — so request `*.dev.backseat-service.com` (validates against the 905 zone) and reference it explicitly via the annotation.
- **Baseline:** No contradiction — ap-northeast-1 = 0 certs, no annotation; all spot-checks match.
- **Live re-check 2026-06-09:** ap-northeast-1 ACM `CertificateSummaryList=[]`. `ingress.yaml` at tip: HTTPS:443 present, no certificate-arn annotation, `spec.tls.hosts=[*.backseat-service.com]`. Route53: `dev.backseat-service.com` in 905; apex not present.
- **Remediation:**
  1. Request a public ACM cert in **ap-northeast-1**, `*.dev.backseat-service.com`, DNS validation (regional — must be re-requested per region even though the domain matches G6).
  2. Place the validation CNAME in the `dev.backseat-service.com` zone. If ACM reuses the same token as the G6 request, no extra record is needed; if it's a different token, add a second CNAME.
  3. Wait for Status=ISSUED (5–30 min); note the ap-northeast-1 ARN.
  4. Add to `k8s-manifests/point/dev/ingress.yaml` under `metadata.annotations`, after `ssl-policy`: `alb.ingress.kubernetes.io/certificate-arn: '<ap-northeast-1-cert-arn>'`.
  5. `kubectl apply -f k8s-manifests/point/dev/ingress.yaml` (via CI/CD or a bastion with kubectl). The controller reconciles the HTTPS:443 listener with the cert.
  6. (optional cleanup) change `spec.tls.hosts` `*.backseat-service.com` → `*.dev.backseat-service.com` to match the cert — cosmetic (the controller selects the cert from the annotation, not `tls.hosts`).
  7. (NOT recommended) requesting `*.backseat-service.com` in ap-northeast-1 needs a CNAME in the apex zone (not in 905) → cross-account coordination + external lead-time. Stick with `*.dev.backseat-service.com`.
- **After-checks:** `describe-certificate <new-ap-northeast-1-arn>` → ISSUED / AMAZON_ISSUED / `*.dev.backseat-service.com`; `describe-listeners` on the ALB → one Port=443 Protocol=HTTPS listener with the new cert as default; `kubectl describe ingress point-ingress -n default` → backends Healthy, no controller error events.
- **Can fix in code?** YES — one annotation line; the two G6 `data.tf`/tfvars changes are independent and can ship in the same PR. The cert requests are Console/CLI ops that must complete before the code change applies.
- **Lead-time:** DNS validation 5–30 min (self-service, same zone as G6) + kubectl reconcile ~2–5 min. Under 1 hour if requested in parallel with G6.

### OPUS-GATE-A — iam apply would silently rewrite custodian role trust policies once an import path is added

- **Status:** OPEN · **Risk:** CRITICAL · **Type:** team-controlled · **Owner:** 905 IAM/security owner (who-may-assume-admin sign-off; remediation is code-fixable by the applying engineer)
- **Component:** `terraform/infra/iam`
- **Root cause:** the four custodian roles already exist in 905 with LIVE trust policies that diverge sharply from HEAD. HEAD trust (from `dev.tfvars`): Administrator/Operator/Viewer all `accept_user_arns=['905418018638']` (account-root) + `accept_ips`=2 Cloudflare /32s; CICD `accept_user_arns=['user/cicd']` only.
- **⚠ PARTIAL CONTRADICTION (verified 2026-06-09):** there is **NO `import{}` or `moved{}` block anywhere** in the iam component (`iam/main.tf` is just a provider block; grep of all `iam/*.tf` returns zero). Therefore a naive `terraform apply` of iam tries to CREATE the pre-existing roles and **FAILS CLOSED at `EntityAlreadyExists` — the component is FAIL-SAFE TODAY.** The silent trust-rewrite only activates if someone adds an import block or runs `terraform import` to clear that error; the NEXT apply then silently overwrites trust to HEAD. A trust rewrite succeeds silently (no error) and changes who can assume admin — strictly worse than the fail-closed create. The plan never detaches the AWS-managed `AdministratorAccess` that Admin/CICD/Operator retain. Two further corrections vs baseline: (a) **ViewerRole has ZERO attached managed policies** live — only **3 of 4** roles (Admin/CICD/Operator) retain `AdministratorAccess`, NOT all four (scope: managed attachments; inline not enumerated); (b) exact dropped cross-account roots are `728927523062` and **`590183696997`** (baseline wrote `590183996997` — the live ID is `590183696997`).
- **Live re-check 2026-06-09:** AdministratorRole trust principals = `728927523062:root` + `590183696997:root`, SourceIp `0.0.0.0/0`, MFA, `AdministratorAccess`. OperatorRole = `905418018638:root` + `590183696997:root`, `0.0.0.0/0`, MFA, `AdministratorAccess`. CICDRole = `user/bs-cicd-test` + `user/cicd` (both `sts:AssumeRole`+`sts:TagSession`), no IP condition, `AdministratorAccess`. ViewerRole = `905418018638:root` + `728927523062:root`, SourceIp = NINE /32s, MFA, ZERO managed policies. HEAD = 2 Cloudflare /32s for all three IP-gated roles. iam component has NO import/moved blocks → fail-closed today.
- **Remediation:**
  1. **DO NOT add an import block and DO NOT run `terraform import`** against `custodian-*` until the trust-diff below is signed off — that is what flips the gate from fail-safe to silent-rewrite.
  2. Present the per-role trust diff for sign-off: **[Administrator]** DROP cross-account roots `728927523062` + `590183696997`; ADD `905418018638:root`; SourceIp `0.0.0.0/0` → 2 Cloudflare /32s; AdministratorAccess retained. **[Operator]** DROP `590183696997`; keep `905418018638:root`; SourceIp `0.0.0.0/0` → 2 Cloudflare /32s; AdministratorAccess retained. **[Viewer]** DROP `728927523062`; keep `905418018638:root`; SourceIp NINE /32s → 2 Cloudflare /32s; gains ViewerRolePolicy + SecurityAudit (currently zero managed). **[CICD]** DROP `user/bs-cicd-test`; keep `user/cicd`; no IP condition either side (do NOT claim a CICD IP change); AdministratorAccess retained.
  3. Get explicit sign-off on EVERY dropped principal: cross-account root `728927523062` (loses Admin + Viewer); `590183696997` (loses Admin + Operator); `bs-cicd-test` (loses CICD — confirm it is a retired CI identity and `user/cicd` is the active CI principal).
  4. Get sign-off on the SourceIp narrowing — confirm operators reach the roles via the Cloudflare egress IPs `104.30.164.185` and `104.30.177.101`, or SwitchRole breaks for everyone post-apply.
  5. Resolve the retained-AdministratorAccess intent: HEAD attaches a scoped custom `*RolePolicy` per role but does NOT detach the managed `AdministratorAccess` from Admin/CICD/Operator. Confirm whether it should remain (custom policies are additive) or be detached (separate change).
  6. **CHOOSE ONE:** (OPTION 1, hand-reconcile) edit `dev.tfvars` `accept_user_arns`/`accept_ips` to PRESERVE the live principals + broader SourceIp so the imported trust matches live, then add imports and apply (trust unchanged); OR (OPTION 2, scope-skip — RECOMMENDED for now) `-target` the iam apply to EXCLUDE the four custodian role/policy resources. Given no import block exists, the simplest safe state is: do not import the custodian roles this cycle.
- **After-checks:** `get-role ... --query Role.AssumeRolePolicyDocument` for each custodian role matches the SIGNED-OFF intent; `list-attached-role-policies` matches the AdministratorAccess decision; smoke-test a real SwitchRole from a sanctioned Cloudflare egress IP into `custodian-AdministratorRole` before closing.
- **Can fix in code?** YES — fully code-fixable by the applying engineer (reconcile tfvars OR `-target` around the custodian roles). The blocker is the human who-can-assume-admin sign-off, not a code limitation.
- **Lead-time:** Same-day to a few days, gated on the 905 IAM/security owner's sign-off. Code edit is minutes.

### G7 — audit Config recorder role_arn flips to cross-account `211125716602:role/cm-config-role-all-regions` (point prd) whose trust CANNOT be verified from dev/stg

- **Status:** CROSS-ACCOUNT-BLIND · **Risk:** HIGH · **Type:** cross-account-blind · **Owner:** owner of point-prd account `211125716602`
- **Component:** `terraform/infra/audit` (`module.config` → config → config recorder)
- **Root cause:** `audit/config/main.tf` HARDCODES `iam_role_arn = "arn:aws:iam::211125716602:role/cm-config-role-all-regions"` for ALL THREE regional config sub-modules. An apply of the audit component flips BOTH live recorders (ap-northeast-1 + us-east-1) away from the working local role `905418018638:role/bs-aws-config-role` onto the cross-account 211 role. If 211's role does not trust `config.amazonaws.com` OR is not usable by the 905 recorders, both recorders stop recording. This is POINT-NATIVE DRIFT — `config/main.tf` + `config/iam.tf` are byte-identical between `main` and `release/verup` (not a verup change).
- **⚠ MECHANISM REFINEMENT (not a reversal):** baseline said "the apply DESTROYS the local bs-aws-config-role." Verified: `config/iam.tf` is fully commented out, so `bs-aws-config-role` is NOT Terraform-managed by this component. Whether it is destroyed vs merely orphaned depends on EXISTING terraform state (not visible read-only). The OPERATIONAL RISK is identical either way: the working Config credential stops being the recorder's role, replaced by the unverifiable cross-account ARN.
- **Live re-check 2026-06-09:** both recorders re-read — ap-northeast-1 + us-east-1 recorder `default` roleARN = `905418018638:role/bs-aws-config-role` (NOT yet flipped). `bs-aws-config-role` `RoleLastUsed 2026-06-09T01:58:37Z` (ap-northeast-1) — still actively the recorder credential. The 211 role trust could NOT be inspected — no profile exists for 211 from dev/stg.
- **Remediation:**
  1. Send the exact ask to the 211 owner (see §2 G7 row) — confirm `cm-config-role-all-regions` exists, trusts `config.amazonaws.com`, and is usable by 905 in ap-northeast-1 + us-east-1 (+ ap-northeast-3 if enabled); request the AssumeRolePolicyDocument + attached policies. Apply `module.config` only after written confirmation.
  2. DEFER `module.config` behind G7: apply only the verup-delta of the audit component that does NOT touch the recorder. Scope with `-target` to the safe pieces: `module.s3-access-logs` (new prereq bucket `s3-access-logs.bs-point-dev`), `module.s3-waf-logging` (new + has import blocks for `aws-waf-logs-bs-point-dev`), `module.guardduty` (toggles + detector `moved{}`), retention/expiration bumps on `s3-audit-logs` / `s3-config` / `cloudtrail`. EXCLUDE `module.config[0]` entirely. **VERIFIED 2026-06-09 @ `d0625eca`** (session `…__infra-audit-no-config-ta__07426f5c`, evidence `../../plans/dev/infra/audit-no-config/`): the 9-target plan (everything except `module.config`) = **`+11/~3/-0` (+5 import), 0 destroy, NO `211125716602` reference, risk MED** (vs full audit plan `+11/~5/-2` HIGH) — confirms the `-2 destroy` + recorder `role_arn` switches are fully isolated to `module.config`. Terraform v1.9.7 has no `-exclude`, so list all 9 targets (`s3-audit-logs`, `s3-audit-logs-receiver`, `s3-config`, `cloudtrail`, `guardduty`, `securityhub`, `ssm`, `s3-access-logs`, `s3-waf-logging`).
  3. **Naming trap:** the recorder lives in `module.config[0]` (gated by `var.config_enabled`). Do NOT confuse it with `module.s3-config` (the Config delivery bucket `config.bs-point-dev`) — `module.s3-config` is part of the delta you KEEP; `module.config[0]` is the DEFER item. The `-target` list must name `module.config[0]` as deferred, not s3-config.
  4. Only after the 211 owner confirms, run the deferred `terraform apply -target=module.config[0]` (user-initiated).
- **After-checks:** `describe-configuration-recorder-status` ap-northeast-1 + us-east-1 → `recording=true` AND `lastStatus=SUCCESS`; if the 211 role was wired in, confirm the active roleARN is the 211 ARN AND status is still SUCCESS — if not SUCCESS, ROLL BACK the recorder role_arn to `bs-aws-config-role`; verify `bs-aws-config-role` still exists (get-role) for rollback capability.
- **Can fix in code? OPEN — engineer decision, do NOT auto-resolve.** Two candidate end-states, both blocked on the SAME unverified fact (does `211`'s `cm-config-role-all-regions` trust `config.amazonaws.com` for account `905418018638`?):
  - **Option B — converge to `211` (treat the ARN as intentional point baseline):** keep the cross-account ARN; the 211 owner confirms/adjusts the trust, then apply `module.config`. Preserves the committed point code as-is.
  - **Option A — reconcile to the same-account local role:** un-comment `config/iam.tf` + set the recorder `iam_role_arn = aws_iam_role.this.arn` + `terraform import` the live `bs-aws-config-role`; eliminates BOTH the destroy/orphan and the role switch. Justified if the `211` role turns out NOT to be usable by member-account recorders — AWS Config recorder roles are effectively same-account, `cm-config-role-all-regions` is point-PRD's OWN role, and there is no live Config Aggregator in point-dev (`describe-configuration-aggregators` = `[]`), so the "centralized aggregator" framing is unproven.
  - **Either way, DEFER `module.config` now** — the `-target` apply (remediation step 2) is correct regardless of which end-state wins. Full code-vs-live analysis + both options: `../../verup-to-point/audit-config-drift-analysis.md §5`.
- **Lead-time:** External-account dependent — realistically days, gated on the 211 owner's response. No self-serve path from dev/stg.

### R2-PEER-01 — VPC peering accepter references a non-existent hardcoded pcx

- **Status:** OPEN · **Risk:** HIGH · **Type:** external-leadtime · **Owner:** Platform/Infra (905) + wallet-side operator (845)
- **Component:** `terraform/components/vpc_peering`
- **Root cause:** `tfvars/dev.tfvars:5` hardcodes `peer_requester_peering_connection_id = "pcx-0b25431ee2b97d2ac"`. That pcx does not exist in 905 (`describe-vpc-peering-connections` returned `[]`); 845 has zero pending requests. Applying the accepter now fails immediately — `aws_vpc_peering_connection_accepter` references a pcx AWS cannot resolve. The component is accepter-only; it also appends 2 `aws_route` entries (for_each over route tables tagged `point-private-subnet*` / `point-public-subnet*` → EKS-tagged `rtb-01cd8a94ccb541553` private + `rtb-04c2378d5accace0e` public). Net plan delta: +3 (1 accepter + 2 routes).
- **Baseline:** No contradiction — pcx absent in 905; both sides confirmed empty today.
- **Live re-check 2026-06-09:** `describe-vpc-peering-connections` 905 → `[]`; 845 (`bs-point-dev`) → `[]` (requester has not submitted). No drift.
- **Remediation:**
  1. **STEP 0 (905 pre-flight):** confirm target VPC — `aws ec2 describe-vpcs --filters Name=tag:Name,Values=point` → expect `vpc-0f49bf7456fa50d08` in 905.
  2. **STEP 1 (845 — external long-pole):** in 845, create the peering request targeting the 905 VPC (Requester = wallet VPC CIDR `192.168.0.0/16`, Peer Account = `905418018638`, Peer VPC ID = `vpc-0f49bf7456fa50d08`, region ap-northeast-1). AWS assigns a new pcx; 845 shares it with 905 over a secure channel.
  3. **STEP 2 (905 code):** update `terraform/components/vpc_peering/tfvars/dev.tfvars:5` with the AWS-assigned pcx. Do NOT reuse `pcx-0b25431ee2b97d2ac` — it is dead. (Note: `stg.tfvars` carries a different stale pcx `pcx-0c3d285e426241d9b` — same per-env anti-pattern; replace via the same create-then-accept workflow when doing STG.)
  4. **STEP 3 (905 apply):** from `terraform/components/vpc_peering`, `../../terraform.sh --env dev init && ../../terraform.sh --env dev plan` (point target is `--env dev`, NOT `dev-ex` — that is the bs-exchange-infra env) — confirm +3 (1 accepter + 2 routes). Apply only after a clean plan.
  5. **STEP 4 (after-check, tag/CIDR based):** confirm one active pcx with `accepterVpcInfo.OwnerId=905418018638` + requester CIDR `192.168.0.0/16`; both route tables hold a `192.168.0.0/16` route via the pcx, State=active; CoreDNS + any Ponta VGW routing unaffected (different CIDRs).
- **After-checks:** `describe-vpc-peering-connections --filters status-code=active` → ≥1 active pcx, requester CIDR `192.168.0.0/16`, accepter `905418018638`; `describe-route-tables rtb-01cd8a94ccb541553 rtb-04c2378d5accace0e` → both have the `192.168.0.0/16` route via pcx, State=active; CoreDNS pods Running; data-plane ping/curl from a 905 pod to a `192.168.x.x` endpoint.
- **Can fix in code?** PARTIAL — the 905-side edit (real pcx in `dev.tfvars:5`) is a 1-line change, but the pcx itself must originate from 845. Unblockable in code until STEP 1 completes.
- **Lead-time:** Blocked on 845 creating the request — **1–3 business days** for cross-account coordination. After the pcx is shared, 905 edit + apply is <30 min.

### G4 — ALB SG swap: controller-managed `sg-005b8b9b2e2cb718e` blocks direct destroy + 8080 gap risk

- **Status:** OPEN · **Risk:** HIGH · **Type:** code-fixable · **Owner:** Platform/Infra
- **Component:** `terraform/components/security_group` (alb.tf, eks.tf)
- **Root cause:** `sg-005b8b9b2e2cb718e` (Name=alb-sg) is tagged `ingress.k8s.aws/resource=ManagedLBSecurityGroup` — auto-created by the ALB Ingress Controller, NOT Terraform, attached to 3 live ALB ENIs (`eni-07d...` AZ-d, `eni-052e...` AZ-c, `eni-0c9e...` AZ-a) for `app/point-alb/0b046b6abb5dc34b`. A direct `terraform destroy` returns `DependencyViolation` — only the controller can detach and delete it. The IaC target is `aws_security_group.alb_https` (in alb.tf); the worker SG (eks.tf) already references `aws_security_group.alb_https.id` for the 8080 ingress rule, so the 8080 path is correct in IaC but absent in the live controller-managed SG → drop-window risk if pods are up during the swap.
- **Baseline:** No contradiction — 3 live ALB ENIs confirmed; live SG description matches the controller-managed origin.
- **Live re-check 2026-06-09:** `sg-005b8b9b2e2cb718e` confirmed name=alb-sg, `ManagedLBSecurityGroup` tag, no 8080 inbound (only 80/tcp from bastion SG + CloudFront prefix list); 3 ENIs attached, Status=in-use. (Note: live SG has port-80 inbound only — no 443 inbound rule, while alb.tf defines 443; the controller swap is the only path to close that gap.)
- **Remediation:**
  1. **RECOMMENDED:** run the G4 swap INSIDE the G8 maintenance window (pods at 0) — eliminates the 8080 ALB→pod gap entirely.
  2. **PHASE 1 (Terraform, no live traffic impact):** `terraform plan/apply` for `security_group` → creates `aws_security_group.alb_https` (HTTPS ingress from CloudFront prefix list + bastion; egress 8080 to eks_worker). Live alb-sg untouched. Confirm plan shows only additions, zero destroys.
  3. **PHASE 2 (controller-driven swap):** add annotation `alb.ingress.kubernetes.io/security-groups` pointing to the new alb_https SG ID; `kubectl apply -f ingress.yaml`. The controller attaches the new SG and detaches `sg-005b8b9b2e2cb718e` from all 3 ENIs. Monitor with `describe-network-interfaces --filters group-id=<new_sg_id>`.
  4. **PHASE 3:** once detached (no ENIs), the controller deletes `sg-005b8b9b2e2cb718e` automatically. Terraform state has no reference to it; no `terraform destroy` needed.
  5. **AURORA COUPLING (same window):** the security_group apply also changes `mysql_port` 3306 → 13306 on the mysql SG (`dev.tfvars mysql_port=13306`). Run the full security_group apply to atomically apply the port change; verify Aurora accepts connections on 13306 from the worker SG.
- **After-checks:** `describe-network-interfaces group-id=<new_alb_https_sg>` → 3 ENIs on point-alb; `describe-network-interfaces group-id=sg-005b8b9b2e2cb718e` → 0 ENIs; `curl -I https://<alb-dns>/` from bastion → 200/expected; `describe-security-groups sg-005b8b9b2e2cb718e` → `InvalidGroup.NotFound`; mysql SG ingress on 13306 exists.
- **Can fix in code?** YES — alb.tf already defines `aws_security_group.alb_https`; eks.tf already references it for the 8080 rule. Only additional action: add the `security-groups` annotation to the ingress YAML pointing at the Terraform-managed SG. No further `.tf` changes.
- **Lead-time:** 0 external. Phase 1 runnable immediately; Phase 2 ~5 min controller reconcile. Total 15–30 min inside the G8 window.

### G8 — Stateful maintenance window: single atomic capture/restore for elasticache + redshift + aurora

- **Status:** OPEN · **Risk:** HIGH · **Type:** team-controlled · **Owner:** Platform/Infra
- **Component:** `terraform/components/elasticache`, `redshift`, `aurora` (stateful window orchestration)
- **Root cause:** the maintenance apply for stateful resources requires scaling app pods to 0 to prevent in-flight connection errors during SG/endpoint changes. The anti-pattern is per-row capture (recording replica counts independently per component), which (a) records 0 for anything already at 0 (losing the true desired count) and (b) leaves pods down after the window (restore has no valid count). The correct pattern is ONE atomic capture of ALL deployment replica counts before any scale-to-0, full apply, then ONE atomic restore.
- **Baseline:** No contradiction. (Procedural gate — risk is in execution sequencing, not a specific live resource state.)
- **Live re-check 2026-06-09:** not a live-AWS spot-check gate; architecture confirmed from code review.
- **Remediation:**
  1. **WINDOW START — atomic capture:** `kubectl get deployments -n default -o json | jq '[.items[] | {name: .metadata.name, replicas: .spec.replicas}]' > /tmp/replica-capture.json`. Verify non-zero counts for point-api/admin/app/mmh/worker; if any show 0, investigate first.
  2. **scale all to 0 in ONE op:** `kubectl get deployments -n default -o name | xargs -I{} kubectl scale {} --replicas=0 -n default`. Wait for 0 Running pods.
  3. **WINDOW APPLY:** run `terraform apply` for `security_group` (ALB SG Phase 1 + mysql 13306), `elasticache`, `redshift`, `aurora` in dependency order. Run G4 Phase 2 (`kubectl apply` ingress) during this window while pods are at 0 — eliminates the 8080 gap.
  4. **WINDOW END — atomic restore:** `cat /tmp/replica-capture.json | jq -r '.[] | "kubectl scale deployment/" + .name + " --replicas=" + (.replicas | tostring) + " -n default"' | bash`. Verify deployments return to captured counts.
  5. **health check:** wait for Running, verify app endpoints, check logs for Aurora/ElastiCache/Redshift connection errors.
- **After-checks:** all deployments READY=N/N matching capture; 0 pods in CrashLoopBackOff/Error; `describe-cache-clusters`/`describe-clusters` (redshift)/`describe-db-clusters` (aurora) all `available`; app health endpoint 200 from at least one pod.
- **Can fix in code?** PARTIAL — capture/restore are runbook steps, not Terraform; no `.tf` changes for G8 itself. Enforce the exact kubectl commands as a checklist gate before any stateful apply.
- **Lead-time:** 0 external. Scheduling a low-traffic window with the app team is the only gate. Execution 30–60 min including G4 Phase 2.

> **G4 + G8 MUST share one window.** Order: (1) G8 capture → (2) scale to 0 → (3) G4 Phase 1 (security_group apply: alb_https SG + mysql 13306) → (4) G4 Phase 2 (kubectl apply ingress; controller swaps SG) → (5) apply elasticache/redshift/aurora → (6) G8 restore → (7) health check. R2-PEER-01 has no sequencing dependency on G4/G8 — its +2 route additions are non-disruptive and need no window.

### G13 — Event-notification chain missing in DEV (topic + Lambda + secret)

- **Status:** OPEN · **Risk:** HIGH · **Type:** code-fixable · **Owner:** Platform/Infra
- **Component:** `secrets_manager` → `event-notification` → `notification` (apply-order chain)
- **Root cause:** DEV `905418018638` was never provisioned with the three resources forming the chain: the SNS topic `alert-lambda-event-notification`, the secret `point/lambda/event-notification-to-slack`, and the Slack-forward Lambda `event-notification-to-slack`. STG (471) already has all three (point-native config; `git diff main...release/verup` is EMPTY for `notification/data.tf` + `notification/redshift.tf` — not a verup delta). The DEV Redshift event subscription `redshift-point` currently routes to `alert-lambda-infra`; HEAD re-targets it to `alert-lambda-event-notification` via in-place MODIFY, which fails at plan-refresh until the topic exists. The `event-notification` component fails at plan-time because `event-notification/lambda/data.tf:1` reads the absent secret.
- **Baseline:** No contradiction — all four spot-checks (SNS dev/stg, Secrets dev/stg, Redshift dev) confirm the baseline.
- **Live re-check 2026-06-09:** DEV CONFIRMED ABSENT — `list-topics` returns only `alert-lambda-infra`; `list-secrets` filtered on event-notification → `[]`; `list-functions` filtered → `[]`; `redshift-point` SnsTopicArn = `...:905418018638:alert-lambda-infra`. STG (471) CONFIRMED PRESENT (topic, secret, Lambda; subscription points to `alert-lambda-event-notification`).
- **Remediation (SCOPE: DEV ONLY — STG is already converged; do NOT apply this chain to STG):**
  1. **STEP 1 — secrets_manager (dev):** `cd terraform/components/secrets_manager && ../../terraform.sh --env dev init && plan`. Confirm `aws_secretsmanager_secret.secrets["lambda/event-notification-to-slack"]` is CREATED (key already in `locals.tf`). Apply. Creates the empty secret container.
  2. **STEP 2 — operator populates the webhook:** `aws secretsmanager put-secret-value --secret-id point/lambda/event-notification-to-slack --secret-string '{"SLACK_WEBHOOK_URL":"<actual-webhook-url>"}'`. The empty container is enough for STEP 3 to apply; the value is read only at Lambda runtime. Reuse the STG webhook URL if appropriate.
  3. **STEP 3 — event-notification (dev):** `cd terraform/components/event-notification && ../../terraform.sh --env dev init && plan`. Confirm the SNS topic, Lambda subscription, `aws_lambda_permission.with_sns`, and the Lambda function are all CREATED (the plan-time secret read now resolves). Apply.
  4. **STEP 4 — notification (dev):** `cd terraform/components/notification && ../../terraform.sh --env dev init && plan`. Expect an IN-PLACE MODIFY of `aws_redshift_event_subscription.this` (`redshift-point`): SnsTopicArn `alert-lambda-infra` → `alert-lambda-event-notification`. Do NOT halt on this MODIFY — it is the expected convergence. Apply.
  - **Apply order is strictly sequential** (hard plan-time data-source deps): secrets_manager → event-notification → notification. Do NOT parallelize.
- **After-checks:** `list-topics` shows `alert-lambda-event-notification`; `list-subscriptions-by-topic` → Protocol=lambda → the event-notification-to-slack Lambda; `list-functions` shows the Lambda; `describe-event-subscriptions` `redshift-point` SnsTopicArn = `alert-lambda-event-notification`; `list-secrets` shows `point/lambda/event-notification-to-slack`.
- **Can fix in code?** No code change needed — all config already exists at tip (`secrets_manager/locals.tf` has the key; `event-notification/terraform.tfvars` has `sns-enabled=true` + `lambda_enabled=true`; `notification/*` already references the topic). Pure apply-ordering gap in DEV.
- **Lead-time:** < 1 day — no external approvals; all three components apply within DEV. The only non-Terraform step is populating the webhook value (immediate if the STG URL is reused).

---

## 6. New firsthand findings 2026-06-09

- **EKS escape-hatch recovery principal CONFIRMED live:** `custodian-AdministratorRole`, `custodian-CICDRole`, AND `custodian-OperatorRole` each have AWS-managed `AdministratorAccess` attached (⇒ `eks:CreateAccessEntry` + `eks:AssociateAccessPolicy`). Any of the three can break-glass via create-access-entry + associate `AmazonEKSClusterAdminPolicy` if the →API flip locks out admins. **Primary recovery principal: `custodian-AdministratorRole`.**
- **EKS version availability (ap-northeast-1, `describe-cluster-versions`):** 1.32 (EXTENDED), 1.33 (STANDARD), 1.34 (STANDARD, EoSS 2026-12-02) all AVAILABLE; 1.35 (AWS default) + 1.36 also available. The ladder top rung **1.34 IS buildable — NOT a blocker**. 1.31 is in EXTENDED support (end-of-extended ~2026-11-26, ~5.5 months) → upgrade urgency is real.
- **`list-access-entries` on `point` returns `InvalidRequestException`** because the cluster is in CONFIG_MAP → there are ZERO EKS access entries today. The ONLY current admin path is the aws-auth ConfigMap (`mapRoles`). Concretely confirms the lockout exposure: nothing in the access-entry system protects admins until `API_AND_CONFIG_MAP` is reached and proven.
- **Baseline contradictions (carried into the cards above):**
  - **G6** — plan does NOT exit 1 (var-driven filter matches `07c7a840`); the real blocker is the level-2-wildcard-vs-level-3-host mismatch + the latent `types=[IMPORTED]` trap.
  - **OPUS-GATE-A** — iam is **fail-closed TODAY** (no import/moved block; silent rewrite is a FUTURE trigger only); **ViewerRole has ZERO managed policies** (only 3 of 4 retain AdministratorAccess); corrected dropped root is **`590183696997`** (not `590183996997`).
  - **G1** — tip couples a 3-minor version jump (1.31→1.34) WITH the auth flip in one apply — strictly worse than the baseline's single-flip framing.
  - **G7** — destroy-vs-orphan of `bs-aws-config-role` depends on prior state (not visible read-only); operational risk identical either way.
- **Cross-component nuance:** the EKS module v17→v21 (`~> 21.1.0`) bump will show cluster-role attachment churn on the FIRST eks apply (the 1.32 rung). Whoever applies rung 1 must confirm the plan re-attaches (does not permanently drop) `AmazonEKSVPCResourceController` / `AmazonEKSClusterPolicy` / `AmazonEKSServicePolicy`. Also confirm fluent-bit/cwagent DaemonSets reschedule healthy after each rung's node replacement (shared `eks-worker-role`).

---

## 7. Go/no-go matrix + dependency-ordered clear-before-apply sequence

| Gate | Type | Go condition (must be TRUE before its rows apply) |
|---|---|---|
| R2-PEER-01 | external-leadtime | 845 has shared a live pcx; `dev.tfvars:5` updated to it |
| G7 | cross-account-blind | 211 owner confirmed `cm-config-role-all-regions` trust in writing; until then DEFER `module.config[0]` |
| OPUS-GATE-A | team-controlled | 905 IAM owner signed off the trust diff; until then `-target` around the custodian roles (no import) |
| G6 | team-controlled | us-east-1 `*.dev.backseat-service.com` cert ISSUED; tfvars + `data.tf` types updated |
| G11 | team-controlled | ap-northeast-1 `*.dev.backseat-service.com` cert ISSUED; `certificate-arn` annotation added |
| G1 + R3-EKS-01 | team-controlled | 4 ladder branches authored; `ec2-cd-runner` applied; ladder 1.31→1.34 done (CONFIG_MAP); RBAC pre-applied; auth-bridge proven; →API flip LAST |
| G4 | code-fixable | runs inside the G8 window; annotation added to ingress YAML |
| G8 | team-controlled | low-traffic window scheduled; atomic capture taken before scale-to-0 |
| G13 | code-fixable | apply secrets_manager → event-notification → notification (DEV only), webhook populated |

**Dependency-ordered clear-before-apply sequence:**

1. **TODAY, in parallel (start the clocks):** fire R2-PEER-01 (845 request), G7 (211 trust question), G6 + G11 (both cert requests), OPUS-GATE-A (IAM sign-off). Author the 4 EKS ladder branches (G1).
2. **As cert validations land (<1 hr):** commit the G6 tfvars + `data.tf` change and the G11 ingress annotation (same PR).
3. **EKS critical path (1–2 sessions):** apply `ec2-cd-runner` → ladder 1.32 → 1.33 → 1.34 (all CONFIG_MAP, eyeball the v21 cluster-role re-attach on rung 1) → pre-apply RBAC → auth-bridge (API_AND_CONFIG_MAP) → manual prove-gate → →API flip LAST.
4. **G13 (DEV-only, < 1 day):** secrets_manager → populate webhook → event-notification → notification.
5. **Maintenance window (G8 + G4 together, 30–60 min):** capture → scale 0 → security_group (alb_https + mysql 13306) → kubectl ingress swap → elasticache/redshift/aurora → restore → health check.
6. **When 845 shares the pcx (1–3 business days, independent):** update `dev.tfvars:5` → apply `vpc_peering` (+3, non-disruptive).
7. **audit component:** apply the verup-delta with `-target` EXCLUDING `module.config[0]`; DEFER `module.config[0]` until the 211 owner confirms (G7).
8. **iam component:** `-target` around the custodian roles until OPUS-GATE-A sign-off; never add an import block for `custodian-*` before sign-off. **Sequencing safety:** apply the OPUS-GATE-A custodian-trust narrowing ONLY AFTER the EKS `→API` flip is proven — narrowing `custodian-AdministratorRole` trust before the flip can sever the EKS break-glass recovery path (see R3-EKS-01 escape-hatch, STEP 9 caution).

**Overall go/no-go.** NO-GO until the EKS critical path is proven through the manual prove-gate and the two cert requests are ISSUED. R2-PEER-01 and G7 can trail (their rows are isolated and deferrable), but their requests must already be in flight. OPUS-GATE-A and G7 are hard NO-GO for their specific components until sign-off/confirmation — defer those components rather than block the whole migration.

---

## 8. Already cleared — do not re-chase

- **G2** — EKS access-entry `named_user` fixed to `bs-developer` (was `bs-operator`, NoSuchEntity). Confirmed at tip + live (`bs-developer` exists). Keep it; do NOT regress to `bs-operator`.
- **G3** — Round-2 corrected: there is NO eks↔cd-runner plan cycle; the only edge is `ec2-cd-runner BEFORE eks`. The old "import the role / don't reorder" advice is dead. (Folded into R3-EKS-01.)
- **G5 → Path B** — RESOLVED: pr-84 (maintenance-split) IS MERGED into `release/verup` (commit `e394685c`); provider `~>6.40` + split `maintenance_exchange`/`maintenance_point` rule groups + `scripts/preflight-renumber.sh` present. Path A is dead — use Path B (the 4-step `Row #39 — waf-customer` procedure in `apply-checklist-DRAFT.md`).
- **G9** — ALB-controller `vpcId` already corrected at the apply tip (commit "fix(k8s): correct ALB controller vpcId and rbac apply path"); read as "stale" only against the older pinned SHA.
- **G10** — `k8s_apply.sh` rbac path already corrected at the apply tip (same commit as G9). Not a live defect.
- **G14** — `security_group` module version pin: all 7 `terraform-aws-modules/security-group/aws` blocks carry `version = "~> 5.3"` at tip `6672bbb6` (the `terraform init` failure fix, committed this cycle). Run `init` first to confirm clean resolution before plan/apply.
