# Risk assessment — `eks` component, branch `eks/1.31`, env `dev`

| | |
|---|---|
| Plan snapshot | `plan-output.txt` (re-run 2026-06-10T06:53Z, identical to first run) |
| Branch / commit | `eks/1.31` @ `ba83cb3a` (`feat(eks): module v17→v21 + auth stage 1 (API_AND_CONFIG_MAP) at cluster 1.31`) |
| Account / profile | `905418018638` / `point-operator-dev` (verified `sts get-caller-identity`) |
| Plan summary | **28 add / 18 change / 13 destroy** |
| Live cluster | `point`, version 1.31, auth `CONFIG_MAP`, nodes `1.31.14-20260512` |

## Verdict

**❌ NOT safe to apply right now — one hard blocker.**
**✅ Safe-for-DEV after the blocker + 1 pre-apply gate are cleared**, with the understanding that this apply **rolls all 5 node fleets** and **cuts pod AWS access over from node-role to IRSA in the same run** (minutes-level app disruption expected; acceptable in DEV).

No stateful resource (cluster, node group, log group) is destroyed or replaced. All 13 destroys are IAM policy attachments / 2 obsolete IAM policies.

---

## BLOCKER

### B1 — `point-cd-runner-role` does not exist (apply WILL fail)

Verified live 2026-06-10: `aws iam get-role --role-name point-cd-runner-role` → `NoSuchEntity`.
The plan creates `module.eks.aws_eks_access_entry.this["cd_runner"]` with `principal_arn = arn:aws:iam::905418018638:role/point-cd-runner-role`. EKS validates the principal exists → this resource errors mid-apply, leaving a **partial apply** (IAM detaches and the auth-mode flip may already be committed).

**Required first:** apply the `ec2-cd-runner` component (creates `point-cd-runner-role`). Do not work around by deleting the entry from tfvars.

## HIGH

### H1 — Full rolling replacement of all 5 node groups

Two independent triggers in this plan:
1. **New launch template version** for every group: `http_tokens = required` (IMDSv2 enforce) + `http_put_response_hop_limit 2 → 1`.
2. **AMI release bump** `1.31.14-20260512 → 1.31.14-20260529` (module resolves the SSM `recommended` pointer at plan time — it can advance again before apply since the plan was not saved with `-out`).

Consequence: every pod is rescheduled (node-group rolling update, default maxUnavailable=1 per group, single-AZ-sized groups desired=1 → each app has a brief reschedule gap). DEV downtime is acceptable, but schedule accordingly.

### H2 — Pod AWS-access cutover: node-role IMDS → IRSA, in one apply

Detached from `eks-worker-role`: `AmazonS3FullAccess`, `AmazonSQSFullAccess`, `AmazonSNSFullAccess`, `AmazonSESFullAccess`, `AmazonKinesisFullAccess`, `AmazonEKSClusterAutoscalerPolicy` (all verified currently attached live). Replaced by new IRSA roles: `point-app-irsa-role` (+7 attachments + Athena/Glue inline policy), `point-cluster-autoscaler-irsa-role`, `point-cloudwatch-agent-irsa-role`. Additionally `hop_limit=1` on the new nodes blocks pod IMDS access entirely (pods on the pod network are 2 hops away), so there is **no fallback** to the node role for app pods after the roll.

Mitigations already in place (verified in repo):
- `k8s-manifests/point/base/deployment.yaml` → `serviceAccountName: point-app-sa`
- `k8s-manifests/point/dev/point-app-service-account.yaml` → annotated `arn:aws:iam::905418018638:role/point-app-irsa-role` (role name is fixed, ARN deterministic — annotation valid before the role exists)
- `cluster-autoscaler` / `cloudwatch-agent` SAs annotated with the matching new role names
- `fluent-bit` stays on node role: `CloudWatchAgentServerPolicy` is **not** detached, and fluent-bit is hostNetwork (1 IMDS hop → unaffected by `hop_limit=1`)

**Pre-apply GATE (mandatory):** confirm the annotated ServiceAccounts exist **in the live cluster** (manifests in git ≠ applied): `kubectl get sa point-app-sa -o yaml | grep role-arn`, same for `cluster-autoscaler` (kube-system) and `cloudwatch-agent` (amazon-cloudwatch). If missing → `kubectl apply` them BEFORE terraform apply, so pods recreated by the node roll mount the IRSA token immediately.

Expected transient: between IAM detach and pod rescheduling, old pods (still on old nodes with hop_limit=2) lose S3/SQS/SES/SNS/Kinesis permissions → API errors for a few minutes until the roll completes. Unavoidable with a single apply; acceptable in DEV.

### H3 — vpc-cni (`aws-node`) moves to IRSA + network policy agent enabled

`AmazonEKS_CNI_Policy` is detached from the node role; the vpc-cni **addon** gains `service_account_role_arn = point-vpc-cni-aws-node` (EKS injects the annotation and restarts aws-node). A short gap between detach and addon update only affects **new** ENI/IP allocation, not existing pod networking. `configuration_values = { enableNetworkPolicy = "true" }` enables the network-policy agent — no `NetworkPolicy` objects exist today, so no traffic is blocked, but verify after apply (`kubectl get networkpolicy -A`). `resolve_conflicts_on_update = OVERWRITE` will wipe any manual `kubectl edit` on the addon-managed resources.

## MEDIUM

### M1 — Auth mode `CONFIG_MAP → API_AND_CONFIG_MAP` is one-way
AWS rejects downgrades. This is Stage 1 by design; `aws-auth` ConfigMap keeps working as fallback through the ladder. **Post-apply prove-gate:** authenticate via an access-entry principal (e.g. `custodian-AdministratorRole`) and run `kubectl auth can-i '*' '*'` before starting the version ladder.

### M2 — Cluster-role policy drops (module v21 behavior)
Destroyed: `AmazonEKSServicePolicy` (obsolete since the cluster-policy consolidation), `AmazonEKSVPCResourceController` (only needed for security-groups-for-pods / Windows — not used by this cluster), `point-deny-log-group` (removing a Deny is harmless; log group already exists and module manages it), `point-elb-sl-role-creation` (the ELB service-linked role already exists). No functional loss expected; this is the previously documented v21 policy-drop gate — sign-off here.

### M3 — ALB controller IAM policy refreshed from upstream v3.1.0 JSON
The policy document is fetched from GitHub at plan time (`data.http`) — content may differ at apply time (re-plan happens anyway). The restructure (AddTags vs Modify* condition swap, +`DescribeListenerAttributes` etc.) matches the official v2.13+ policy and is backward-compatible with older controller versions. Low functional risk; noted because the source is remote.

### M4 — OIDC provider thumbprint recomputed
`thumbprint_list` becomes (known after apply) via `data.tls_certificate`. Metadata-only update on the existing provider; IRSA tokens are unaffected. (EKS OIDC trust no longer depends on thumbprints in practice.)

## LOW

- `endpoint_private_access false → true` — additive; public endpoint stays on, no client breakage; in-VPC kubectl gets private resolution.
- `deletion_protection false → true` — pure safety improvement.
- coredns / kube-proxy / vpc-cni **versions unchanged** (tfvars pins match live); only `preserve`/`resolve_conflicts` attributes and tags change.
- `time_sleep`, `null_resource.validate_cluster_service_cidr`, log-group `Name` tag, cluster `terraform-aws-modules` tag, worker-role `moved` blocks (state-only) — noise.
- Cluster IAM role trust gains `sts:TagSession` — required by v21 conventions, additive.

---

## Rollback notes

| Change | Reversible? |
|---|---|
| Auth mode Stage 1 | ❌ No path back to `CONFIG_MAP`. Forward-only (final flip to `API` later). `aws-auth` remains as fallback while in dual mode. |
| IAM detach/attach, IRSA roles | ✅ Re-attach / destroy roles via revert + apply. |
| Node roll (LT + AMI) | ⚠️ Only by rolling again to a previous LT version/AMI — disruptive but possible. |
| Access entries | ✅ Deletable. |
| endpoint_private_access / deletion_protection | ✅ Toggle back. |

## Pre-apply checklist (condensed)

1. ☐ **B1**: apply `ec2-cd-runner` → `aws iam get-role --role-name point-cd-runner-role` returns the role.
2. ☐ **H2 gate**: live cluster SAs `point-app-sa` / `cluster-autoscaler` / `cloudwatch-agent` exist with the IRSA annotations (kubectl); apply manifests if missing.
3. ☐ Confirm maintenance window for the full node roll (all app pods restart).
4. ☐ Re-run plan immediately before apply (no `-out` was used; SSM AMI pointer and upstream ALB policy JSON may have moved).
5. ☐ Post-apply: IRSA prove (`kubectl exec` into an app pod → check `AWS_WEB_IDENTITY_TOKEN_FILE` env / app S3+SQS calls OK), access-entry prove-gate (M1), `kubectl get networkpolicy -A` empty, nodes `Ready` on `1.31.14-20260529`.
