# K8s Manifests Bin Scripts

Tài liệu mô tả 4 shell scripts trong `bs-exchange-infra/k8s-manifests/bin/`.

## Tổng quan

| Script | Mục đích | Gọi bởi | CI/CD |
|--------|----------|---------|-------|
| `k8s_apply.sh` | Deploy toàn bộ K8s stack | Manual (runbook) | Không |
| `fetch_credentials.sh` | Sync secrets AWS → K8s | `k8s_apply.sh`, `apply_secrets.sh`, manual | Không |
| `apply_secrets.sh` | Wrapper chỉ update secrets | Manual | Không |
| `rehearsal_secrets.sh` | Preview + apply secrets (safe) | Manual | Không |

Tất cả đều là **manual runbook tools**, chạy từ máy operator trong VPC hoặc qua VPN.

## Quan hệ giữa các scripts

```
k8s_apply.sh (full deploy)
├── aws eks update-kubeconfig
├── kubectl set env (IP config)
├── kubectl apply aws-auth-cm.yaml
├── AWS Load Balancer Controller (CRDs + SA + Helm)
├── NFS provisioner (stg, stg-ex, prd only)
├── CoreDNS config (stg, stg-ex only)
├── Helm: aws-load-balancer-controller
├── Cluster Autoscaler
├── Metrics Server
├── CloudWatch agent
├── Fluent Bit
├── fetch_credentials.sh ──→ AWS Secrets Manager → K8s Secret
└── kubectl kustomize (admin, api, app, mmh, worker) + ingress

apply_secrets.sh (secrets-only shortcut)
├── aws eks update-kubeconfig
└── fetch_credentials.sh ──→ AWS Secrets Manager → K8s Secret

rehearsal_secrets.sh (safe preview + apply)
├── aws sts get-caller-identity (validate credentials)
├── AWS Secrets Manager → fetch & preview
├── --list mode (list keys only, no apply)
├── backup existing secret (.secret-backups/)
├── diff: Added / Changed / Deleted keys
├── confirm prompt (y/N)
└── kubectl apply secret
```

## Chi tiết từng script

### 1. `k8s_apply.sh`

**Mục đích**: Deploy/reconcile toàn bộ Kubernetes infrastructure + applications.

**Cách dùng**:
```bash
cd k8s-manifests/bin
./k8s_apply.sh --env <env>
# env: dev3, dev2, dev, stg2, stg, stg-ex, prd
```

**Luồng thực thi**:
1. Xác định môi trường từ `--env` hoặc `AWS_PROFILE`/`AWS_VAULT`
2. `aws eks update-kubeconfig --name point`
3. Cấu hình IP: `WARM_IP_TARGET=2`, `MINIMUM_IP_TARGET=1`
4. Apply `aws-auth-cm.yaml` (IAM → K8s RBAC mapping)
5. Apply AWS Load Balancer Controller CRDs + ServiceAccount
6. Apply NFS provisioner (chỉ stg, stg-ex, prd)
7. Apply CoreDNS custom config (chỉ stg, stg-ex)
8. Helm install/upgrade `aws-load-balancer-controller` (version 1.4.4)
9. Apply Cluster Autoscaler
10. Apply Metrics Server
11. Apply CloudWatch agent (namespace, serviceaccount, configmap, daemonset)
12. Apply Fluent Bit (cluster-info, daemonset)
13. Gọi `bin/fetch_credentials.sh` — sync secrets
14. Apply applications qua kustomize: admin, api, app, mmh, worker
15. Apply ingress-class + ingress

**Lưu ý**:
- Hardcode `EKS_CLUSTER_NAME=point`, `K8S_NAMESPACE=default`
- Dùng `wget` tải CRDs từ GitHub (cần internet access)
- Helm chart cho LB controller cần thời gian để sẵn sàng trước khi ingress tham chiếu được

---

### 2. `fetch_credentials.sh`

**Mục đích**: Fetch secrets từ AWS Secrets Manager và tạo K8s Secret `point-secrets`.

**Cách dùng**:
```bash
# Standalone
bin/fetch_credentials.sh [env]
# env: local, cxr-dev, dev, stg2, stg, prd

# Tạo local.env cho development
bin/fetch_credentials.sh local
```

**Secrets được fetch**:

| Secret ID | Mô tả |
|-----------|-------|
| `point/base` | Base configuration |
| `point/SPRING_DATA_REDIS` | Redis connection |
| `point/SPRING_DATASOURCE_MASTER` | Aurora MySQL master |
| `point/SPRING_DATASOURCE_HISTORICAL` | Redshift connection |
| `point/exc` | Exchange-specific config |

Khi `ENV=local`, fetch thêm `point/aws-credentials` thay cho 4 secrets cuối.

**Luồng thực thi**:
1. Xác định môi trường
2. `aws eks update-kubeconfig`
3. Detect base64 command (macOS vs Linux)
4. Fetch từng secret, parse JSON keys
5. Skip keys chứa `-` (hyphen)
6. Nếu `local` → export ra `local.env`
7. Nếu remote → tạo K8s Secret YAML và `kubectl apply`

**Lưu ý**:
- Không có backup trước khi overwrite
- Không có diff/preview
- Không có confirmation prompt
- Được gọi bởi cả `k8s_apply.sh` và `apply_secrets.sh`

---

### 3. `apply_secrets.sh`

**Mục đích**: Wrapper nhẹ để chỉ update K8s secrets mà không deploy lại toàn bộ stack.

**Cách dùng**:
```bash
cd k8s-manifests/bin
./apply_secrets.sh --env <env>
# env: dev3, dev2, dev, stg2, stg, stg-ex, prd
```

**Luồng thực thi**:
1. Parse `--env` argument
2. `aws eks update-kubeconfig --name point`
3. Gọi `bin/fetch_credentials.sh`

Về cơ bản là shortcut cho "update kubeconfig + fetch credentials".

---

### 4. `rehearsal_secrets.sh`

**Mục đích**: Phiên bản an toàn của secrets update với preview, backup, diff, và confirmation.

**Cách dùng**:
```bash
cd k8s-manifests/bin

# Preview + apply
./rehearsal_secrets.sh --env <env>

# Chỉ list keys (dry-run)
./rehearsal_secrets.sh --env <env> --list
```

**Safety features** (khác biệt so với `fetch_credentials.sh`):

| Feature | `fetch_credentials.sh` | `rehearsal_secrets.sh` |
|---------|----------------------|----------------------|
| Validate AWS credentials | Không | `aws sts get-caller-identity` |
| Backup secret hiện tại | Không | `.secret-backups/` (giữ tối đa 10) |
| Diff Added/Changed/Deleted | Không | Có |
| Confirmation prompt | Không | `(y/N)` |
| List-only mode | Không | `--list` flag |
| Error handling | `set -e` | `set -euo pipefail` |

**Luồng thực thi**:
1. Parse args (`--env`, `--list`)
2. Validate AWS credentials (`aws sts get-caller-identity`)
3. Detect base64 command
4. Fetch tất cả secrets từ AWS Secrets Manager
5. Nếu `--list` → hiển thị danh sách keys rồi exit
6. Backup secret hiện tại vào `.secret-backups/`
7. So sánh keys hiện tại vs mới: Added (+), Changed (~), Deleted (-)
8. Hiển thị "Preview complete" và hỏi confirm `(y/N)`
9. Nếu `y` → `kubectl apply` secret mới
10. Nếu `local` → export ra `local.env`

**Được tạo từ**: BB-1461

## Hardcoded values chung

Tất cả scripts đều hardcode:
- `EKS_CLUSTER_NAME=point`
- `K8S_NAMESPACE=default`
- `K8S_SECRET_NAME=point-secrets`
- `AWS_REGION=ap-northeast-1`

## Khi nào dùng script nào?

| Tình huống | Script |
|------------|--------|
| Deploy toàn bộ môi trường từ đầu | `k8s_apply.sh` |
| Update secrets sau khi thay đổi trên AWS Secrets Manager | `apply_secrets.sh` hoặc `rehearsal_secrets.sh` |
| Kiểm tra secrets sẽ thay đổi gì trước khi apply | `rehearsal_secrets.sh --list` hoặc `rehearsal_secrets.sh` (có diff) |
| Tạo `local.env` cho development | `fetch_credentials.sh local` |
| Reconcile lại toàn bộ K8s resources | `k8s_apply.sh` |
