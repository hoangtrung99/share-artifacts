# EKS Version Upgrade Runbook

## 1. Overview

### Purpose

This document is a **generic, version-agnostic** runbook template for performing Amazon EKS minor version upgrades. It uses placeholders that should be replaced with actual values for each upgrade cycle.

### Placeholders

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `{SOURCE_VERSION}` | Current EKS cluster version | `1.30` |
| `{TARGET_VERSION}` | Target EKS cluster version | `1.31` |
| `{CLUSTER_NAME}` | EKS cluster name | `point` |
| `{ENV}` | Terraform environment identifier | `dev-ex`, `stg-ex`, `prd-ex` |
| `{NEW_VPC_CNI_VERSION}` | Target VPC CNI addon version | `v1.21.1-eksbuild.3` |
| `{NEW_KUBE_PROXY_VERSION}` | Target kube-proxy addon version | `v1.30.14-eksbuild.20` |
| `{NEW_COREDNS_VERSION}` | Target CoreDNS addon version | `v1.11.4-eksbuild.28` |
| `{PREVIOUS_VERSION}` | Previous addon version (for rollback) | varies |
| `{PREVIOUS_CA_VERSION}` | Previous Cluster Autoscaler version | `1.28.7` |

### Prerequisites Checklist

Before starting, confirm every item:

| # | Prerequisite | Verified |
|---|-------------|----------|
| 1 | AWS CLI v2 installed and configured | [ ] |
| 2 | `kubectl` installed (compatible with `{TARGET_VERSION}`) | [ ] |
| 3 | `terraform` installed (version matching project) | [ ] |
| 4 | AWS IAM permissions: EKS, EC2, IAM, CloudWatch access | [ ] |
| 5 | `kubeconfig` updated for target cluster | [ ] |
| 6 | Maintenance window scheduled and communicated | [ ] |
| 7 | Stakeholders notified (PM, QA, Ops) | [ ] |
| 8 | Jira ticket created (BB-XXXX) and linked | [ ] |
| 9 | Pre-upgrade investigation completed (Section 2) | [ ] |
| 10 | Terraform state is clean (`no changes` on current state) | [ ] |
| 11 | Backup of current addon configurations taken | [ ] |
| 12 | CloudWatch dashboards open for monitoring | [ ] |
| 13 | Slack alert channels accessible | [ ] |
| 14 | Rollback plan reviewed and understood | [ ] |
| 15 | Previous environment upgrade completed (DEV before STG, STG before PRD) | [ ] |

### Risk Assessment Matrix

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Addon config overwritten during upgrade | HIGH | MEDIUM | Snapshot configs before upgrade (Section 4.3), use `resolve_conflicts = PRESERVE` in Terraform |
| Node group rolling update causes temporary capacity reduction | MEDIUM | HIGH | Scale down application pods first, monitor node count during rollout |
| Deprecated API usage causes workload failure | HIGH | LOW | Run deprecated API check pre-upgrade (Section 2.1), review K8s release notes |
| Cluster Autoscaler incompatible with new version | MEDIUM | MEDIUM | Verify CA version matrix (Section 2.4), update CA image in same change window |

### Upgrade Order

```
DEV  -->  STG  -->  [Verify Gate]  -->  PRD
 |         |              |
 v         v              v
Verify   Verify    PM + Dept Review
                   Release Judgment
```

EKS cluster version upgrades are **non-reversible**. Once upgraded, you cannot downgrade. This is why the DEV -> STG -> Gate -> PRD order is critical.

---

## 2. Pre-Upgrade Investigation

### 2.1 K8s Release Notes Review

**Where to find:**

- Official releases: https://kubernetes.io/releases/
- Changelog: https://github.com/kubernetes/kubernetes/blob/master/CHANGES/CHANGELOG-{TARGET_VERSION}.md
- EKS-specific notes: https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html

**What to check:**

- Removed APIs (will break workloads immediately)
- Deprecated APIs (will break in future versions)
- Behavioral changes in core components (kubelet, kube-apiserver, kube-scheduler)
- Feature gate changes (alpha/beta/GA promotions)
- Storage, networking, or RBAC changes

**How to check deprecated APIs in cluster:**

```bash
# Check if any deprecated APIs are being requested
kubectl get --raw /metrics 2>/dev/null | grep apiserver_requested_deprecated_apis

# Alternative: check API versions available
kubectl api-versions | sort

# Check for removed API versions in manifests
kubectl get apiservices | grep -v Available
```

### 2.2 Addon Compatibility Matrix

> **Decision: Always use the latest compatible version** for each addon when upgrading.
> The latest version includes security patches, bug fixes, and is best tested against the target K8s version.
> Use the commands below to determine the exact latest version for `{TARGET_VERSION}`.

**Find latest compatible versions for target K8s version:**

```bash
# Get the LATEST compatible version for each addon (first result = latest)
for addon in kube-proxy coredns vpc-cni aws-ebs-csi-driver; do
  echo "=== $addon ==="
  aws eks describe-addon-versions --addon-name $addon --kubernetes-version {TARGET_VERSION} \
    --query 'addons[0].addonVersions[0].addonVersion' --output text
done
```

**Find top 3 compatible versions with default marker (for reference):**

```bash
for addon in kube-proxy coredns vpc-cni aws-ebs-csi-driver; do
  echo "=== $addon ==="
  aws eks describe-addon-versions --addon-name $addon --kubernetes-version {TARGET_VERSION} \
    --query 'addons[0].addonVersions[:3].{version:addonVersion,default:compatibilities[0].defaultVersion}' \
    --output table
done
```

**Current verup addon versions (as of 2026-03):**

| Addon | Current Version | Variable in `terraform.tfvars` | Notes |
|-------|----------------|-------------------------------|-------|
| vpc-cni | `v1.21.1-eksbuild.3` | `addon_vpc_cni_version` | Manages pod networking |
| kube-proxy | `v1.30.14-eksbuild.20` | `addon_kube_proxy_version` | Network proxy on each node |
| coredns | `v1.11.4-eksbuild.28` | `addon_coredns_version` | Cluster DNS |
| aws-ebs-csi-driver | `v1.55.0-eksbuild.2` | `addon_csi_version` | EBS volume provisioning |

### 2.3 Terraform Module Compatibility

**Check terraform-aws-modules/eks/aws changelog:**

- GitHub releases: https://github.com/terraform-aws-modules/terraform-aws-eks/releases
- Current verup module version: `~> 21.1.0`
- Verify the module version supports `{TARGET_VERSION}` as a valid `cluster_version` value

**AWS provider compatibility:**

```bash
# Check current provider version (from repo root)
cd bs-exchange-infra/terraform/components/eks
terraform providers
```

- Verify the AWS provider version supports EKS `{TARGET_VERSION}`
- Check: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/eks_cluster

### 2.4 Cluster Autoscaler Version Mapping

**Official compatibility matrix:**
https://github.com/kubernetes/autoscaler/tree/master/cluster-autoscaler#releases

**Rule:** Cluster Autoscaler minor version **must match** K8s minor version.

| K8s Version | Required CA Version | Image Tag |
|-------------|-------------------|-----------|
| 1.29 | v1.29.x | `registry.k8s.io/autoscaling/cluster-autoscaler:v1.29.x` |
| 1.30 | v1.30.x | `registry.k8s.io/autoscaling/cluster-autoscaler:v1.30.x` |
| 1.31 | v1.31.x | `registry.k8s.io/autoscaling/cluster-autoscaler:v1.31.x` |

**Current verup CA version:** `v1.28.7`

> **NOTE:** The current CA version (v1.28.7) is already behind for K8s 1.30. It needs to be updated to v1.30.x as part of the upgrade. When upgrading to `{TARGET_VERSION}`, update CA to `v{TARGET_VERSION}.x` (latest patch).

**Find latest CA release for target version:**

```bash
# Check GitHub releases
# https://github.com/kubernetes/autoscaler/releases?q=cluster-autoscaler-1.{TARGET_MINOR}
```

### 2.5 Breaking Changes Assessment

Document all breaking changes and their impact:

| Feature / Change | Impact | Action Required | Status |
|-----------------|--------|-----------------|--------|
| (Example) API `flowcontrol.apiserver.k8s.io/v1beta2` removed | Workloads using this API will fail | Update manifests to use `v1` | [ ] |
| (Example) `--feature-gates` default changes | May affect pod scheduling behavior | Review pod scheduling configuration | [ ] |
| (Example) CSI driver version requirement change | Storage operations may fail | Update CSI driver if applicable | [ ] |
| (Fill per upgrade) | | | [ ] |

### 2.6 Config Safety Check (Addon Custom Configs)

Custom addon configurations can be **overwritten** during upgrades. This check identifies which addons have custom configs that need protection.

**Check for custom configuration on each addon:**

```bash
for addon in kube-proxy coredns vpc-cni; do
  echo "=== $addon ==="
  aws eks describe-addon --cluster-name {CLUSTER_NAME} --addon-name $addon \
    --query 'addon.configurationValues' --output text
done
```

**Interpretation:**

- If output is `None`: No custom config. Safe to upgrade with `OVERWRITE`.
- If output is NOT `None`: Custom config exists. **RISK of overwrite during upgrade.**

**Terraform resolve_conflicts setting:**

Check the current setting in Terraform:

```hcl
# In main.tf or eks module configuration
resolve_conflicts_on_update = "OVERWRITE"  # DANGER: will reset custom config
resolve_conflicts_on_update = "PRESERVE"   # SAFE: keeps custom config
```

**VPC CNI special considerations:**

VPC CNI often has custom environment variables. Check:

```bash
kubectl get daemonset aws-node -n kube-system \
  -o jsonpath='{.spec.template.spec.containers[0].env}' | python3 -m json.tool
```

Look for custom settings like:
- `WARM_IP_TARGET`
- `MINIMUM_IP_TARGET`
- `ENABLE_NETWORK_POLICY`
- `ENABLE_PREFIX_DELEGATION`

If these are set, ensure `resolve_conflicts = PRESERVE` or re-apply after upgrade.

---

## 3. Code Changes

### 3.1 Terraform tfvars Changes

All version variables are in a single shared file (not per-env):

**File: `bs-exchange-infra/terraform/components/eks/terraform.tfvars`**

```diff
  # --- EKS cluster version ---
  # Line 6:
- cluster_version      = "1.30"
+ cluster_version      = "{TARGET_VERSION}"

  # Line 7:
- cluster_node_version = "1.30"
+ cluster_node_version = "{TARGET_VERSION}"

  # --- Addon versions (use latest from step 2.2) ---
  # Line 14:
- addon_vpc_cni_version    = "v1.21.1-eksbuild.3"
+ addon_vpc_cni_version    = "{NEW_VPC_CNI_VERSION}"

  # Line 16:
- addon_kube_proxy_version = "v1.30.14-eksbuild.20"
+ addon_kube_proxy_version = "{NEW_KUBE_PROXY_VERSION}"

  # Line 18:
- addon_coredns_version    = "v1.11.4-eksbuild.28"
+ addon_coredns_version    = "{NEW_COREDNS_VERSION}"

  # Line 19:
- addon_csi_version        = "v1.55.0-eksbuild.2"
+ addon_csi_version        = "{NEW_CSI_VERSION}"
```

> **Example (1.30 -> 1.31):**
> ```hcl
> cluster_version          = "1.31"
> cluster_node_version     = "1.31"
> addon_vpc_cni_version    = "v1.22.0-eksbuild.1"    # latest for 1.31
> addon_kube_proxy_version = "v1.31.4-eksbuild.10"   # latest for 1.31
> addon_coredns_version    = "v1.11.6-eksbuild.1"    # latest for 1.31
> addon_csi_version        = "v1.56.0-eksbuild.1"    # latest for 1.31
> ```
> *(Version numbers above are examples only -- always run the commands in Section 2.2 to get actual latest versions.)*

**No per-env tfvars changes needed.** The EKS version and addon versions are defined in the shared `terraform.tfvars`, not in `dev-ex.tfvars` or `stg-ex.tfvars`. Per-env files only contain node group sizing and access configuration.

### 3.2 Cluster Autoscaler Image Update

Update the CA image in **each environment's manifest file**:

**File: `bs-exchange-infra/k8s-manifests/point/dev-ex/kube-system/cluster-autoscaler.yaml`** (line 153)

```diff
  containers:
    - name: cluster-autoscaler
-     image: registry.k8s.io/autoscaling/cluster-autoscaler:v1.28.7
+     image: registry.k8s.io/autoscaling/cluster-autoscaler:v{TARGET_VERSION}.x
```

**File: `bs-exchange-infra/k8s-manifests/point/stg-ex/kube-system/cluster-autoscaler.yaml`** (line 153)

```diff
  containers:
    - name: cluster-autoscaler
-     image: registry.k8s.io/autoscaling/cluster-autoscaler:v1.28.7
+     image: registry.k8s.io/autoscaling/cluster-autoscaler:v{TARGET_VERSION}.x
```

> **Example (upgrading to 1.31):**
> ```yaml
> image: registry.k8s.io/autoscaling/cluster-autoscaler:v1.31.1
> ```
> Find latest patch: https://github.com/kubernetes/autoscaler/releases?q=cluster-autoscaler-1.{TARGET_MINOR}
>
> To find the latest matching patch faster from the CLI:
> ```bash
> gh api repos/kubernetes/autoscaler/releases \
>   --jq '[.[] | select(.tag_name | startswith("cluster-autoscaler-1.30")) | {tag: .tag_name, date: .published_at}]'
> ```
> Replace `1.30` with the target Kubernetes minor version and pick the newest release date from the output.

> **WARNING:** Current CA version `v1.28.7` is already mismatched with EKS `1.30`.
> The CA minor version MUST match the K8s minor version. This should be corrected regardless of whether a cluster upgrade is performed.

### 3.3 Files NOT Changed (and Why)

| File | Reason Not Changed |
|------|--------------------|
| `main.tf` (line 126: `kubernetes_version = var.eks.cluster_version`) | Already references variable; no structural change needed |
| `variables.tf` | Variable definitions are version-agnostic |
| `dev-ex.tfvars`, `stg-ex.tfvars` | Only contain node group sizing and access config, not versions |
| IRSA roles / policies | IAM roles for service accounts are version-independent |
| Security groups | Network rules do not change between minor K8s versions |
| `k8s_apply.sh` | Deployment order and script logic remain unchanged |
| ALB Controller manifests | AWS Load Balancer Controller is independently versioned |
| Fluent Bit / CloudWatch Agent | Logging agents are independently versioned |

---

## 4. Deployment Procedure

### 4.1 Environment Reference

| Property | DEV | STG | PRD |
|----------|-----|-----|-----|
| AWS Account | 845131030484 | 520411743393 | TBD |
| Cluster Name | point | point | point |
| Terraform Env | dev-ex | stg-ex | prd-ex |
| Terraform Path | `bs-exchange-infra/terraform/components/eks` | same | same |
| K8s Manifests | `k8s-manifests/point/dev-ex/` | `k8s-manifests/point/stg-ex/` | `k8s-manifests/point/prd-ex/` |
| Node Groups | 5 (t3.medium / c6i.xlarge) | 5 (r5.xlarge / c6i.2xlarge) | TBD |
| Est. Duration | 30-45 min | 45-60 min | 40-60 min |
| Region | ap-northeast-1 | ap-northeast-1 | ap-northeast-1 |

### 4.2 Pre-checks

Run these commands before starting the upgrade:

```bash
# 1. Verify AWS account
aws sts get-caller-identity

# 2. Cluster version
aws eks describe-cluster --name {CLUSTER_NAME} --query 'cluster.version' --output text
# Expected: {SOURCE_VERSION}

# 3. Node versions
kubectl get nodes -o wide

# 4. Addon versions
for addon in kube-proxy coredns vpc-cni; do
  echo "=== $addon ==="
  aws eks describe-addon --cluster-name {CLUSTER_NAME} --addon-name $addon \
    --query 'addon.{version:addonVersion,status:status}' --output table
done

# 5. Cluster Autoscaler version
kubectl get deployment cluster-autoscaler -n kube-system \
  -o jsonpath='{.spec.template.spec.containers[0].image}' && echo

# 6. Non-Running pods (investigate any before proceeding)
kubectl get pods --all-namespaces | grep -v Running | grep -v Completed

# 7. Node health
kubectl get nodes
kubectl top nodes

# 8. Deprecated API check
kubectl get --raw /metrics 2>/dev/null | grep apiserver_requested_deprecated_apis || echo "No deprecated APIs in use"
```

**STOP if:**
- Any nodes are `NotReady`
- Critical pods are in `CrashLoopBackOff`
- Deprecated APIs are actively in use that will be removed in `{TARGET_VERSION}`

### 4.3 Snapshot Addon Configs

Take a full snapshot of current addon configurations before any changes:

```bash
SNAPSHOT_DIR="/tmp/eks-addon-snapshot-$(date +%Y%m%d-%H%M)"
mkdir -p $SNAPSHOT_DIR

# CoreDNS ConfigMap
kubectl get configmap coredns -n kube-system -o yaml > $SNAPSHOT_DIR/coredns-configmap.yaml

# kube-proxy ConfigMap
kubectl get configmap kube-proxy-config -n kube-system -o yaml > $SNAPSHOT_DIR/kube-proxy-config.yaml 2>/dev/null \
  || kubectl get configmap kube-proxy -n kube-system -o yaml > $SNAPSHOT_DIR/kube-proxy-config.yaml 2>/dev/null

# VPC CNI environment variables
kubectl get daemonset aws-node -n kube-system -o jsonpath='{.spec.template.spec.containers[0].env}' \
  | python3 -m json.tool > $SNAPSHOT_DIR/vpc-cni-env.json 2>/dev/null

# Addon configuration values from EKS API
for addon in kube-proxy coredns vpc-cni; do
  aws eks describe-addon --cluster-name {CLUSTER_NAME} --addon-name $addon \
    --query 'addon.configurationValues' --output text > $SNAPSHOT_DIR/${addon}-addon-config.txt 2>/dev/null
done

echo "Snapshot saved to $SNAPSHOT_DIR"
ls -la $SNAPSHOT_DIR/
```

Save `$SNAPSHOT_DIR` path for post-upgrade comparison in Section 4.8.

### 4.4 Scale Down Services

Scale down all application deployments to avoid disruption during the node rolling update:

```bash
# Scale down all application deployments
kubectl scale deployment point-admin-deployment --replicas=0
kubectl scale deployment point-api-deployment --replicas=0
kubectl scale deployment point-app-deployment --replicas=0
kubectl scale deployment point-mmh-deployment --replicas=0
kubectl scale deployment point-worker-deployment --replicas=0

# Verify all pods terminated
kubectl get pods -n default

# STOP if pods are still running after 2 minutes
```

Wait until all application pods in the `default` namespace have terminated before proceeding.

### 4.5 Terraform Plan + Apply

```bash
# From repo root
cd bs-exchange-infra/terraform/components/eks

# Init
terraform init -var-file=tfvars/{ENV}.tfvars

# Plan — review carefully
terraform plan -var-file=tfvars/{ENV}.tfvars
```

**Expected plan output:**

```
~ aws_eks_cluster.this (kubernetes_version: "{SOURCE_VERSION}" -> "{TARGET_VERSION}")
~ aws_eks_node_group x 5 (version changes)
~ aws_eks_addon.kube_proxy (addon_version change)
~ aws_eks_addon.coredns (addon_version change)
~ aws_eks_addon.vpc_cni (addon_version change)
```

**RED FLAGS in plan (STOP if seen):**

- Any resource with `# forces replacement` (destroy + recreate) -- this means the resource will be destroyed and recreated, causing downtime
- Security group changes not expected
- IAM role/policy changes not expected
- Node group `force_update_version` set unexpectedly
- Any `destroy` actions on critical resources (cluster, node groups, addons)

```bash
# Apply (ONLY after plan review and approval)
terraform apply -var-file=tfvars/{ENV}.tfvars
```

**Monitor node rolling update in a separate terminal:**

```bash
# Watch nodes being replaced
kubectl get nodes -w

# Watch node group update status
watch -n 10 'kubectl get nodes -o wide'
```

The rolling update will:
1. Launch new nodes with the target version
2. Cordon and drain old nodes
3. Terminate old nodes

This process takes 20-40 minutes depending on the number of node groups.

### 4.6 Update Cluster Autoscaler

After the cluster and node groups have been upgraded:

```bash
# Diff check — see what will change
kubectl diff -f k8s-manifests/point/{ENV}/kube-system/cluster-autoscaler.yaml

# Dry-run — validate the manifest
kubectl apply -f k8s-manifests/point/{ENV}/kube-system/cluster-autoscaler.yaml --dry-run=server

# Apply
kubectl apply -f k8s-manifests/point/{ENV}/kube-system/cluster-autoscaler.yaml

# Verify rollout
kubectl rollout status deployment/cluster-autoscaler -n kube-system --timeout=120s

# Verify pod is running
kubectl get pods -n kube-system -l app=cluster-autoscaler

# Check for errors in logs
kubectl logs -l app=cluster-autoscaler -n kube-system --tail=50 | grep -E '^E[0-9]|error|Error'
```

### 4.7 Scale Up Services

Scale application deployments back up:

```bash
# DEV (1 replica each):
kubectl scale deployment point-admin-deployment --replicas=1
kubectl scale deployment point-api-deployment --replicas=1
kubectl scale deployment point-app-deployment --replicas=1
kubectl scale deployment point-mmh-deployment --replicas=1
kubectl scale deployment point-worker-deployment --replicas=1

# STG (adjust replicas as needed, example with 2):
# kubectl scale deployment point-admin-deployment --replicas=2
# kubectl scale deployment point-api-deployment --replicas=2
# kubectl scale deployment point-app-deployment --replicas=2
# kubectl scale deployment point-mmh-deployment --replicas=2
# kubectl scale deployment point-worker-deployment --replicas=2

# PRD (adjust replicas per production requirements):
# kubectl scale deployment point-admin-deployment --replicas=TBD
# kubectl scale deployment point-api-deployment --replicas=TBD
# kubectl scale deployment point-app-deployment --replicas=TBD
# kubectl scale deployment point-mmh-deployment --replicas=TBD
# kubectl scale deployment point-worker-deployment --replicas=TBD

# Wait for pods to be Ready
kubectl get pods -n default -w
```

Wait until all pods show `Running` and `READY` status before proceeding to verification.

### 4.8 Post-Upgrade Verification

Run the full verification suite:

```bash
# 1. Cluster version
aws eks describe-cluster --name {CLUSTER_NAME} --query 'cluster.version' --output text
# Expected: {TARGET_VERSION}

# 2. Node versions (all should show v{TARGET_VERSION}.x)
kubectl get nodes -o wide

# 3. Addon status (all should be ACTIVE)
for addon in kube-proxy coredns vpc-cni; do
  echo "=== $addon ==="
  aws eks describe-addon --cluster-name {CLUSTER_NAME} --addon-name $addon \
    --query 'addon.{version:addonVersion,status:status}' --output table
done

# 4. Config diff — detect if upgrade OVERWROTE custom configs
kubectl get configmap coredns -n kube-system -o yaml > /tmp/coredns-after.yaml
diff $SNAPSHOT_DIR/coredns-configmap.yaml /tmp/coredns-after.yaml || echo "!! CoreDNS config changed!"

kubectl get daemonset aws-node -n kube-system -o jsonpath='{.spec.template.spec.containers[0].env}' \
  | python3 -m json.tool > /tmp/vpc-cni-env-after.json 2>/dev/null
diff $SNAPSHOT_DIR/vpc-cni-env.json /tmp/vpc-cni-env-after.json || echo "!! VPC CNI env vars changed!"

# 5. All pods healthy (should show no non-Running/non-Completed pods)
kubectl get pods --all-namespaces | grep -v Running | grep -v Completed

# 6. kube-system components
kubectl get pods -n kube-system

# 7. Metrics Server (HPA dependency)
kubectl top nodes

# 8. DNS resolution test
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -- nslookup kubernetes.default

# 9. Application logs check
for deploy in point-admin point-api point-app point-mmh point-worker; do
  echo "=== ${deploy} ==="
  kubectl logs deployment/${deploy}-deployment --tail=20 2>/dev/null | grep -i error || echo "OK"
done
```

**If config diff shows unexpected changes:**
1. Restore from snapshot: `kubectl apply -f $SNAPSHOT_DIR/coredns-configmap.yaml`
2. Investigate why `resolve_conflicts` did not preserve the config
3. Re-apply VPC CNI env vars if overwritten

### 4.9 Functional Tests

Complete this checklist for each environment:

```
- [ ] Application endpoints responding (health check URLs)
- [ ] Database connectivity (check application startup logs for successful DB connection)
- [ ] Redis connectivity (check for connection errors in logs)
- [ ] SQS message processing (verify worker logs show message consumption)
- [ ] Cluster Autoscaler: scale test (increase replicas beyond current node capacity, verify new node is provisioned)
- [ ] ALB Controller: verify ingress resources still routing traffic correctly
- [ ] CloudWatch Agent: confirm metrics appearing in CloudWatch console
- [ ] Fluent Bit: confirm logs appearing in CloudWatch Logs log groups
- [ ] HPA: verify Horizontal Pod Autoscaler is receiving metrics (kubectl get hpa)
- [ ] PodDisruptionBudget: verify PDBs are not violated (kubectl get pdb --all-namespaces)
```

### 4.10 Per-Environment Quick Reference

**DEV Commands:**

| Step | Command |
|------|---------|
| Set context | `aws eks update-kubeconfig --name point --region ap-northeast-1` |
| Terraform init | `cd bs-exchange-infra/terraform/components/eks && terraform init -var-file=tfvars/dev-ex.tfvars` |
| Terraform plan | `terraform plan -var-file=tfvars/dev-ex.tfvars` |
| Terraform apply | `terraform apply -var-file=tfvars/dev-ex.tfvars` |
| CA manifest | `k8s-manifests/point/dev-ex/kube-system/cluster-autoscaler.yaml` |
| Scale down | `kubectl scale deployment point-admin-deployment point-api-deployment point-app-deployment point-mmh-deployment point-worker-deployment --replicas=0` |
| Scale up | `kubectl scale deployment point-admin-deployment point-api-deployment point-app-deployment point-mmh-deployment point-worker-deployment --replicas=1` |
| Watch nodes | `kubectl get nodes -w` |

**STG Commands:**

| Step | Command |
|------|---------|
| Set context | `aws eks update-kubeconfig --name point --region ap-northeast-1` |
| Terraform init | `cd bs-exchange-infra/terraform/components/eks && terraform init -var-file=tfvars/stg-ex.tfvars` |
| Terraform plan | `terraform plan -var-file=tfvars/stg-ex.tfvars` |
| Terraform apply | `terraform apply -var-file=tfvars/stg-ex.tfvars` |
| CA manifest | `k8s-manifests/point/stg-ex/kube-system/cluster-autoscaler.yaml` |
| Scale down | `kubectl scale deployment point-admin-deployment point-api-deployment point-app-deployment point-mmh-deployment point-worker-deployment --replicas=0` |
| Scale up | `kubectl scale deployment point-admin-deployment point-api-deployment point-app-deployment point-mmh-deployment point-worker-deployment --replicas=2` |
| Watch nodes | `kubectl get nodes -w` |

**PRD Commands:**

| Step | Command |
|------|---------|
| Set context | `aws eks update-kubeconfig --name point --region ap-northeast-1` |
| Terraform init | `cd bs-exchange-infra/terraform/components/eks && terraform init -var-file=tfvars/prd-ex.tfvars` |
| Terraform plan | `terraform plan -var-file=tfvars/prd-ex.tfvars` |
| Terraform apply | `terraform apply -var-file=tfvars/prd-ex.tfvars` |
| CA manifest | `k8s-manifests/point/prd-ex/kube-system/cluster-autoscaler.yaml` |
| Scale down | `kubectl scale deployment point-admin-deployment point-api-deployment point-app-deployment point-mmh-deployment point-worker-deployment --replicas=0` |
| Scale up | `kubectl scale deployment point-admin-deployment point-api-deployment point-app-deployment point-mmh-deployment point-worker-deployment --replicas=TBD` |
| Watch nodes | `kubectl get nodes -w` |

---

## 5. Verify Gate

This gate must be passed before proceeding from STG to PRD.

| Step | Item | Responsible | Status |
|------|------|-------------|--------|
| 1 | DEV upgrade completed + evidence collected | Engineer | [ ] |
| 2 | STG upgrade completed + evidence collected | Engineer | [ ] |
| 3 | Functional test passed (STG) | Engineer + QA | [ ] |
| 4 | PM review of upgrade results | PM | [ ] |
| 5 | Department review | Department lead | [ ] |
| 6 | Release judgment meeting | All stakeholders | [ ] |

### Evidence Requirements

The following evidence must be collected and attached to the Jira ticket:

- **Screenshots of `kubectl get nodes`** (before and after upgrade, showing version change)
- **Addon version verification output** (output of addon status commands showing new versions and ACTIVE status)
- **Config diff output** (diff results confirming no unexpected configuration changes)
- **Application functional test results** (checklist from Section 4.9 with all items checked)
- **CloudWatch logs screenshot** (showing no errors in a 30-minute window post-upgrade)
- **Cluster Autoscaler logs** (showing no errors, successful scaling operations)
- **`kubectl get pods --all-namespaces`** output (all pods Running/Completed)

---

## 6. Rollback Procedures

### 6.1 Cluster Version (NON-REVERSIBLE)

**EKS cluster version CANNOT be downgraded.** Once the control plane is upgraded to `{TARGET_VERSION}`, it cannot be rolled back to `{SOURCE_VERSION}`.

If critical issues are found after upgrade:
1. **Fix forward:** Identify and resolve the issue on the upgraded cluster
2. **Recreate cluster:** As a last resort, create a new cluster at `{SOURCE_VERSION}` and migrate workloads

This is why the **DEV -> STG -> Verify Gate -> PRD** order is critical. Issues should be caught and resolved before reaching production.

### 6.2 Addon Rollback

Individual addons can be rolled back to previous versions:

```bash
# Roll back a specific addon
aws eks update-addon --cluster-name {CLUSTER_NAME} \
  --addon-name {ADDON_NAME} \
  --addon-version {PREVIOUS_VERSION} \
  --resolve-conflicts OVERWRITE

# Example: roll back kube-proxy
aws eks update-addon --cluster-name {CLUSTER_NAME} \
  --addon-name kube-proxy \
  --addon-version {PREVIOUS_VERSION} \
  --resolve-conflicts OVERWRITE

# Monitor rollback status
aws eks describe-addon --cluster-name {CLUSTER_NAME} --addon-name {ADDON_NAME} \
  --query 'addon.{version:addonVersion,status:status}' --output table
```

### 6.3 Cluster Autoscaler Emergency Rollback

If the new CA version causes issues, roll back the image immediately:

```bash
# Roll back CA image to previous version
kubectl set image deployment/cluster-autoscaler \
  cluster-autoscaler=registry.k8s.io/autoscaling/cluster-autoscaler:v{PREVIOUS_CA_VERSION} \
  -n kube-system

# Wait for rollout to complete
kubectl rollout status deployment/cluster-autoscaler -n kube-system

# Verify the rollback
kubectl get deployment cluster-autoscaler -n kube-system \
  -o jsonpath='{.spec.template.spec.containers[0].image}' && echo

# Check logs for errors
kubectl logs -l app=cluster-autoscaler -n kube-system --tail=50 | grep -E '^E[0-9]|error|Error'
```

### 6.4 Application Troubleshooting

Common post-upgrade issues and how to diagnose them:

**ImagePullBackOff:**
```bash
kubectl describe pod {POD_NAME}
# Check: image name, registry credentials, network connectivity to registry
```

**CrashLoopBackOff:**
```bash
kubectl logs {POD_NAME} --previous
# Check: application startup errors, dependency connectivity (DB, Redis, SQS)
```

**CreateContainerConfigError:**
```bash
kubectl describe pod {POD_NAME}
# Check: ConfigMap/Secret references, volume mounts
```

**Pod stuck in Pending:**
```bash
kubectl describe pod {POD_NAME}
# Check: node resources (CPU/memory), node selectors, tolerations, PVC binding
kubectl get events --sort-by='.lastTimestamp' -n default
```

**Service connectivity issues:**
```bash
# Test DNS resolution
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -- nslookup {SERVICE_NAME}

# Test service endpoint
kubectl get endpoints {SERVICE_NAME}
```

---

## Appendix

### A. Addon Version Lookup Commands

```bash
# Find latest compatible version for target K8s version
aws eks describe-addon-versions --addon-name {ADDON} --kubernetes-version {TARGET_VERSION} \
  --query 'addons[0].addonVersions[:3].{version:addonVersion,default:compatibilities[0].defaultVersion}' \
  --output table

# Find ALL compatible versions
aws eks describe-addon-versions --addon-name {ADDON} --kubernetes-version {TARGET_VERSION} \
  --query 'addons[0].addonVersions[].addonVersion' --output table

# Check which K8s versions an addon version supports
aws eks describe-addon-versions --addon-name {ADDON} \
  --query 'addons[0].addonVersions[?addonVersion==`{ADDON_VERSION}`].compatibilities[0].clusterVersion' \
  --output text
```

### B. Useful kubectl Commands

```bash
# Cluster info
kubectl cluster-info
kubectl get componentstatuses
kubectl api-versions

# Events (sorted by time, across all namespaces)
kubectl get events --sort-by='.lastTimestamp' -A

# Resource usage
kubectl top nodes
kubectl top pods --all-namespaces --sort-by=memory

# Node details
kubectl describe nodes | grep -A 5 "Conditions:"
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.conditions[-1].type}{"\t"}{.status.conditions[-1].status}{"\n"}{end}'

# Pod distribution across nodes
kubectl get pods -o wide --all-namespaces | awk '{print $8}' | sort | uniq -c | sort -rn

# Check PodDisruptionBudgets
kubectl get pdb --all-namespaces

# Check HPA status
kubectl get hpa --all-namespaces

# Check resource quotas
kubectl get resourcequota --all-namespaces
```

### C. AWS Account Quick Reference

| Environment | Account ID | Assumed Role | Region |
|-------------|-----------|-------------|--------|
| DEV | 845131030484 | (per IAM setup) | ap-northeast-1 |
| STG | 520411743393 | (per IAM setup) | ap-northeast-1 |
| PRD | TBD | TBD | ap-northeast-1 |
