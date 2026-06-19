# K8s Operations Guide — EKS Cluster Point

Hướng dẫn chi tiết xem log, debug, troubleshooting, và quản lý pods trên EKS cluster.
Viết cho người mới bắt đầu — mọi câu lệnh đều có giải thích.

**Cluster**: `point`
**Ngày cập nhật**: 2026-03-12

---

## Mục lục

- [0. Giải thích cú pháp (cho người mới)](#0-giải-thích-cú-pháp-cho-người-mới)
  - [0.1. Cấu trúc chung của kubectl](#01-cấu-trúc-chung-của-kubectl)
  - [0.2. Các flags thường gặp](#02-các-flags-thường-gặp)
  - [0.3. Pipe và grep](#03-pipe-và-grep)
  - [0.4. Viết tắt trong kubectl](#04-viết-tắt-trong-kubectl)
- [Kết nối tới Cluster (Setup kubectl)](#kết-nối-tới-cluster-setup-kubectl)
  - [Prerequisites](#prerequisites)
  - [AWS Profiles & Cluster Endpoints](#aws-profiles--cluster-endpoints)
  - [Setup DEV cluster](#setup-dev-cluster)
  - [Setup STG cluster (qua SSM tunnel)](#setup-stg-cluster-qua-ssm-tunnel)
  - [Switch context giữa DEV và STG](#switch-context-giữa-dev-và-stg)
  - [Verify connection](#verify-connection)
  - [Troubleshooting kết nối](#troubleshooting-kết-nối)
- [1. Tổng quan Workloads trên Cluster](#1-tổng-quan-workloads-trên-cluster)
- [2. Quản lý Pods](#2-quản-lý-pods)
  - [2.1. Kiểm tra trạng thái pods](#21-kiểm-tra-trạng-thái-pods)
  - [2.2. Scale deployments](#22-scale-deployments)
  - [2.3. Restart pods](#23-restart-pods)
  - [2.4. Delete pods](#24-delete-pods)
  - [2.5. Cordon / Drain nodes](#25-cordon--drain-nodes)
- [3. Xem Logs](#3-xem-logs)
  - [3.1. Log cơ bản](#31-log-cơ-bản)
  - [3.2. Log tất cả 5 workloads](#32-log-tất-cả-5-workloads)
  - [3.3. Lọc log theo pattern](#33-lọc-log-theo-pattern)
  - [3.4. Log theo thời gian](#34-log-theo-thời-gian)
  - [3.5. Log container trước đó (sau restart/crash)](#35-log-container-trước-đó-sau-restartcrash)
  - [3.6. Giới hạn số dòng / Lưu ra file](#36-giới-hạn-số-dòng--lưu-ra-file)
- [4. Log chi tiết từng Component](#4-log-chi-tiết-từng-component)
  - [4.1. CloudWatch Agent](#41-cloudwatch-agent)
  - [4.2. Fluent Bit](#42-fluent-bit)
  - [4.3. Application Workloads (5 apps)](#43-application-workloads-5-apps)
  - [4.4. NFS Provisioner](#44-nfs-provisioner)
  - [4.5. AWS Load Balancer Controller](#45-aws-load-balancer-controller)
  - [4.6. AWS VPC CNI (aws-node)](#46-aws-vpc-cni-aws-node)
  - [4.7. Cluster Autoscaler](#47-cluster-autoscaler)
  - [4.8. CoreDNS](#48-coredns)
  - [4.9. kube-proxy](#49-kube-proxy)
  - [4.10. Metrics Server](#410-metrics-server)
  - [4.11. GuardDuty Agent](#411-guardduty-agent)
- [5. Exec vào Pod](#5-exec-vào-pod)
- [6. Debug IRSA / AWS Credentials](#6-debug-irsa--aws-credentials)
- [7. Events & Resource Status](#7-events--resource-status)
- [8. Deployment & Rollout](#8-deployment--rollout)
- [9. Networking Debug](#9-networking-debug)
- [10. Scan toàn Cluster](#10-scan-toàn-cluster)
  - [10.1. Health check toàn cluster](#101-health-check-toàn-cluster)
  - [10.2. Scan errors toàn cluster](#102-scan-errors-toàn-cluster)
  - [10.3. Kiểm tra credential errors toàn cluster](#103-kiểm-tra-credential-errors-toàn-cluster)
  - [10.4. Script kiểm tra nhanh (health + errors)](#104-script-kiểm-tra-nhanh-health--errors)
- [11. Bảng tham chiếu nhanh](#11-bảng-tham-chiếu-nhanh)
- [12. Tips](#12-tips)

---

## 0. Giải thích cú pháp (cho người mới)

### 0.1. Cấu trúc chung của kubectl

```
kubectl <hành-động> <loại-resource>/<tên-resource> -n <namespace> [flags]
```

| Thành phần | Ý nghĩa | Ví dụ |
|------------|---------|-------|
| `kubectl` | CLI tool để giao tiếp với Kubernetes cluster | |
| `<hành-động>` | Hành động cần thực hiện | `get`, `logs`, `describe`, `delete`, `exec`, `scale` |
| `<loại-resource>` | Loại tài nguyên Kubernetes | `pod`, `deployment` (hoặc `deploy`), `daemonset` (hoặc `ds`), `service` (hoặc `svc`) |
| `/<tên-resource>` | Tên cụ thể của resource | `/point-api-deployment` |
| `-n <namespace>` | Namespace chứa resource. Nếu bỏ qua → dùng namespace `default` | `-n kube-system`, `-n amazon-cloudwatch` |
| `[flags]` | Tùy chọn thêm | `--since=5m`, `--tail=100`, `-f` |

**Ví dụ phân tích:**
```bash
kubectl logs deploy/point-api-deployment -n default --since=5m
#       │     │                           │          │
#       │     │                           │          └─ chỉ lấy log 5 phút gần nhất
#       │     │                           └─ trong namespace "default"
#       │     └─ deployment tên "point-api-deployment"
#       └─ xem log
```

### 0.2. Các flags thường gặp

| Flag | Dạng đầy đủ | Ý nghĩa | Ví dụ |
|------|-------------|---------|-------|
| `-n` | `--namespace` | Chỉ định namespace | `-n kube-system` |
| `-f` | `--follow` | Theo dõi log realtime (giống `tail -f`). Nhấn `Ctrl+C` để thoát | `kubectl logs deploy/x -f` |
| `-c` | `--container` | Chọn container cụ thể (khi pod có nhiều containers) | `-c aws-node` |
| `-l` | `--selector` | Lọc theo label | `-l app=point-api` |
| `-A` | `--all-namespaces` | Tìm trên tất cả namespaces | `kubectl get pods -A` |
| `-o` | `--output` | Định dạng output | `-o wide`, `-o yaml`, `-o json` |
| `-it` | `-i` + `-t` | `-i` = interactive (giữ stdin mở), `-t` = tạo terminal (TTY). Dùng khi exec vào pod | `kubectl exec -it pod -- /bin/sh` |
| `--` | | Phân tách flags kubectl với command chạy trong pod | `kubectl exec pod -- ls -la` |
| `--tail=N` | | Chỉ lấy N dòng cuối (tránh log quá dài) | `--tail=100` |
| `--since=T` | | Chỉ lấy log trong khoảng thời gian T gần nhất | `--since=5m`, `--since=1h` |
| `--previous` | | Xem log của container trước đó (đã crash/restart) | `kubectl logs pod --previous` |
| `--prefix` | | Thêm tên pod vào đầu mỗi dòng log (hữu ích khi xem log nhiều pods) | `kubectl logs -l app=x --prefix` |
| `--all-containers` | | Xem log của tất cả containers trong pod | `kubectl logs pod --all-containers` |
| `--no-headers` | | Bỏ dòng tiêu đề trong output (tiện cho scripting) | `kubectl get pods --no-headers` |
| `--field-selector` | | Lọc theo trường metadata/status | `--field-selector=status.phase!=Running` |
| `--replicas=N` | | Số bản sao mong muốn (dùng với `scale`) | `--replicas=0` (tắt), `--replicas=2` (bật) |
| `--grace-period=N` | | Thời gian chờ (giây) trước khi force kill | `--grace-period=0` |
| `--force` | | Ép buộc thực hiện (dùng với delete) | `kubectl delete pod x --force` |
| `--ignore-daemonsets` | | Bỏ qua DaemonSet pods khi drain node | dùng với `kubectl drain` |
| `--delete-emptydir-data` | | Cho phép xóa emptyDir data khi drain | dùng với `kubectl drain` |

### 0.3. Pipe và grep

Trong terminal Linux/macOS, bạn có thể **nối** output của lệnh này làm input cho lệnh khác bằng ký tự `|` (pipe).

```bash
kubectl logs deploy/point-api-deployment --since=5m 2>&1 | grep -ciE "error|fail"
#                                         │          │     │         │
#                                         │          │     │         └─ pattern tìm kiếm
#                                         │          │     └─ lọc text
#                                         │          └─ pipe: truyền output sang lệnh tiếp theo
#                                         └─ redirect stderr vào stdout (giải thích bên dưới)
```

#### `2>&1` là gì?

Mỗi chương trình có 2 luồng output:
- **stdout** (file descriptor `1`): Output bình thường (log)
- **stderr** (file descriptor `2`): Thông báo lỗi của chính kubectl (ví dụ: "pod not found")

`2>&1` nghĩa là: **gộp stderr vào stdout**, để `grep` có thể lọc được CẢ HAI luồng.

```
Không có 2>&1:     stdout ──→ grep ──→ kết quả
                   stderr ──→ (hiện trực tiếp, grep không thấy)

Có 2>&1:           stdout ─┐
                            ├──→ grep ──→ kết quả
                   stderr ─┘
```

#### Các flags của `grep`

| Flag | Ý nghĩa | Ví dụ |
|------|---------|-------|
| `-i` | **Case insensitive** — không phân biệt HOA/thường. `error` match cả `Error`, `ERROR` | `grep -i "error"` |
| `-E` | **Extended regex** — cho phép dùng `\|` thành `|` để viết "hoặc" dễ hơn | `grep -E "error|fail"` |
| `-c` | **Count** — chỉ đếm số dòng match, không hiện nội dung | `grep -c "error"` → `5` |
| `-v` | **Invert** — hiện các dòng KHÔNG match | `grep -v "debug"` |
| `-iE` | Kết hợp `-i` + `-E`: tìm không phân biệt hoa/thường, dùng regex mở rộng | `grep -iE "error|fail|warn"` |
| `-ciE` | Kết hợp `-c` + `-i` + `-E`: **đếm** số dòng match (case insensitive, extended regex) | `grep -ciE "error|fail"` → `12` |

**Ví dụ cụ thể:**
```bash
# grep -iE "error|fail"
# → Tìm dòng chứa "error" HOẶC "fail" (không phân biệt hoa/thường)
# → Match: "Error occurred", "FAILED to connect", "connection failure"

# grep -ciE "error|fail"
# → Giống trên nhưng chỉ in ra CON SỐ (bao nhiêu dòng match)
# → Output: 7

# grep -v "ec2metadata"
# → Loại bỏ các dòng chứa "ec2metadata" (lỗi đã biết, không quan trọng)
```

#### `| head -20` và `| tail -5`

| Lệnh | Ý nghĩa |
|-------|---------|
| `| head -20` | Chỉ lấy 20 dòng đầu tiên từ output |
| `| tail -5` | Chỉ lấy 5 dòng cuối cùng từ output |
| `| tail -20` | Chỉ lấy 20 dòng cuối cùng từ output |
| `| wc -l` | Đếm số dòng (**w**ord **c**ount, flag `-l` = lines) |
| `| tr -d ' '` | Xóa spaces thừa (**tr**anslate, `-d` = delete) |

#### `|| true` là gì?

```bash
grep -c "error" || true
```

`||` nghĩa là "nếu lệnh trước thất bại thì chạy lệnh sau". `grep` trả về exit code khác 0 khi không tìm thấy gì → script sẽ dừng nếu chạy trong `set -e`. Thêm `|| true` để script luôn tiếp tục chạy dù grep không match gì.

#### `\|` vs `|` trong grep

| Cú pháp | Ngữ cảnh | Ý nghĩa |
|---------|---------|---------|
| `\|` | Trong `grep` (không có `-E`) | "HOẶC" trong regex. Ví dụ: `grep "error\|fail"` |
| `|` | Trong `grep -E` (extended regex) | "HOẶC" trong regex. Ví dụ: `grep -E "error|fail"` |
| `|` | Ngoài grep, trong shell | **Pipe** — nối output. Ví dụ: `kubectl logs x | grep error` |

**Mẹo**: Dùng `grep -E` (hoặc `grep -iE`) cho dễ đọc — không cần escape `\|`.

### 0.4. Viết tắt trong kubectl

| Đầy đủ | Viết tắt | Ví dụ |
|--------|----------|-------|
| `deployment` | `deploy` | `kubectl get deploy` |
| `daemonset` | `ds` | `kubectl logs ds/cloudwatch-agent` |
| `service` | `svc` | `kubectl get svc` |
| `namespace` | `ns` | `kubectl get ns` |
| `pod` | `po` | `kubectl get po` |
| `replicaset` | `rs` | `kubectl get rs` |
| `configmap` | `cm` | `kubectl get cm` |
| `persistentvolumeclaim` | `pvc` | `kubectl get pvc` |
| `--all-namespaces` | `-A` | `kubectl get pods -A` |

---

## Kết nối tới Cluster (Setup kubectl)

Trước khi chạy bất kỳ lệnh `kubectl` nào, máy local phải có:
1. AWS credentials hợp lệ (qua profile)
2. kubeconfig context đúng cho cluster muốn truy cập
3. Đường mạng tới EKS API endpoint

EKS cluster `point` có 2 chế độ endpoint khác nhau giữa DEV và STG — cách kết nối **không giống nhau**.

### Prerequisites

| Tool | Phiên bản tối thiểu | Cài bằng |
|------|---------------------|----------|
| `aws` (AWS CLI v2) | 2.15+ | `brew install awscli` |
| `kubectl` | 1.30+ (sát với phiên bản cluster) | `brew install kubectl` hoặc `asdf` |
| `session-manager-plugin` | mới nhất — bắt buộc cho **STG** (SSM tunnel) | `brew install --cask session-manager-plugin` |

Kiểm tra nhanh:
```bash
aws --version
kubectl version --client
session-manager-plugin --version 2>/dev/null && echo OK || echo "MISSING — cần cài cho STG"
```

AWS profiles cho verup phải đã được cấu hình (xem `aws configure list-profiles`):

| Profile | Account | Mục đích |
|---------|---------|----------|
| `bs-point-dev` | `845131030484` | DEV — read-only IAM `bs-operator` |
| `bs-point-stg` | `520411743393` | STG — read-only IAM `bs-operator` |

> **Account-guard rule** (theo CLAUDE.md): trước mọi lệnh `aws ...` chạy `aws sts get-caller-identity --profile <p>` để xác nhận đúng account.

### AWS Profiles & Cluster Endpoints

| Env | Cluster | Account | Profile | `endpointPublicAccess` | `endpointPrivateAccess` | Cách kết nối |
|-----|---------|---------|---------|------------------------|--------------------------|---------------|
| **DEV** | `point` | `845131030484` | `bs-point-dev` | **`true`** | `true` | Trực tiếp qua public endpoint, **không cần tunnel** |
| **STG** | `point` | `520411743393` | `bs-point-stg` | **`false`** | `true` | **Bắt buộc** SSM port-forward qua bastion |

Endpoint URL có dạng `https://<HASH>.<RAND>.ap-northeast-1.eks.amazonaws.com` và **có thể đổi** nếu cluster được recreate. Luôn lấy động bằng:
```bash
aws eks describe-cluster --profile <profile> --region ap-northeast-1 --name point \
  --query 'cluster.endpoint' --output text
```

Bastion EC2 (dùng cho STG SSM tunnel hoặc khi cần debug từ trong VPC):

| Env | Bastion Name | Instance ID | Private IP |
|-----|--------------|-------------|------------|
| DEV | `point-bastion` | `i-023b995b76ce7b9ad` | `172.18.21.50` |
| STG | `point-bastion` | `i-04b3b9b2d3a78514f` | `172.19.21.50` |

### Setup DEV cluster

DEV có public endpoint nên chỉ cần một lệnh:

```bash
# 1. Xác nhận đúng account DEV
aws sts get-caller-identity --profile bs-point-dev
# → Expect: { "Account": "845131030484", ... }

# 2. Cập nhật kubeconfig cho DEV
aws eks update-kubeconfig \
  --profile bs-point-dev \
  --region ap-northeast-1 \
  --name point
# → Tạo/cập nhật context: arn:aws:eks:ap-northeast-1:845131030484:cluster/point

# 3. Verify
kubectl config current-context
kubectl get nodes
```

`aws eks update-kubeconfig` tự động:
- Lấy CA cert của cluster và nhúng vào kubeconfig
- Tạo entry `users` dùng `aws eks get-token` (IAM auth)
- Set context name = ARN cluster (tránh trùng giữa DEV và STG)

### Setup STG cluster (qua SSM tunnel)

STG **không có public endpoint** — máy local không reach được private IPs `172.19.21.x` / `172.19.22.x` trong VPC STG. Phải tunnel qua bastion bằng SSM port-forward.

**Bước 1** — Tạo kubeconfig context cho STG (làm 1 lần):
```bash
# Xác nhận đúng account STG
aws sts get-caller-identity --profile bs-point-stg
# → Expect: { "Account": "520411743393", ... }

# Lấy endpoint hostname động (sẽ dùng làm tls-server-name)
STG_EKS_HOST=$(aws eks describe-cluster \
  --profile bs-point-stg --region ap-northeast-1 --name point \
  --query 'cluster.endpoint' --output text | sed 's|https://||')
echo "STG endpoint host: $STG_EKS_HOST"

# Tạo cluster entry với CA cert + tls-server-name
kubectl config set-cluster point-stg-tunnel \
  --server=https://localhost:6443 \
  --tls-server-name="$STG_EKS_HOST" \
  --certificate-authority=<(aws eks describe-cluster \
    --profile bs-point-stg --region ap-northeast-1 --name point \
    --query 'cluster.certificateAuthority.data' --output text | base64 -d) \
  --embed-certs=true

# Tạo user entry dùng aws eks get-token với profile STG
kubectl config set-credentials point-stg-user \
  --exec-command=aws \
  --exec-api-version=client.authentication.k8s.io/v1beta1 \
  --exec-arg=--region,--exec-arg=ap-northeast-1 \
  --exec-arg=eks,--exec-arg=get-token \
  --exec-arg=--cluster-name,--exec-arg=point \
  --exec-arg=--output,--exec-arg=json \
  --exec-arg=--profile,--exec-arg=bs-point-stg

# Tạo context kết hợp
kubectl config set-context point-stg-tunnel \
  --cluster=point-stg-tunnel \
  --user=point-stg-user
```

> Tham số `--tls-server-name` cho phép kubectl verify TLS bằng hostname EKS gốc trong khi thực tế kết nối tới `localhost:6443` — **không** dùng `--insecure-skip-tls-verify`.

**Bước 2** — Mở SSM tunnel (mỗi lần làm việc, giữ chạy nền trong terminal riêng):
```bash
aws ssm start-session \
  --profile bs-point-stg \
  --region ap-northeast-1 \
  --target i-04b3b9b2d3a78514f \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters host="$STG_EKS_HOST",portNumber="443",localPortNumber="6443"
```

Khi thấy `Waiting for connections...` là tunnel sẵn sàng. Để dừng: `Ctrl+C`.

**Bước 3** — Switch context và verify (terminal khác):
```bash
kubectl config use-context point-stg-tunnel
kubectl get nodes
```

### Switch context giữa DEV và STG

Liệt kê context hiện có:
```bash
kubectl config get-contexts
```

| Context | Trỏ tới | Yêu cầu |
|---------|---------|---------|
| `arn:aws:eks:ap-northeast-1:845131030484:cluster/point` | DEV | Chỉ cần internet |
| `point-stg-tunnel` | STG (qua tunnel) | Phải có SSM session đang chạy |

Đổi context:
```bash
# Sang DEV
kubectl config use-context arn:aws:eks:ap-northeast-1:845131030484:cluster/point

# Sang STG (đảm bảo tunnel đã chạy)
kubectl config use-context point-stg-tunnel
```

> Mẹo: cài `kubectx` (`brew install kubectx`) để switch nhanh: `kubectx <tab-completion>`.

### Verify connection

```bash
# 1. Context hiện tại
kubectl config current-context

# 2. Nodes (lệnh đơn giản nhất, độ trễ thấp)
kubectl get nodes

# 3. Pods toàn cluster
kubectl get pods -A

# 4. Server version (xác nhận đúng cluster version)
kubectl version --short
```

Output kỳ vọng (DEV ví dụ):
```
ip-172-18-21-160.ap-northeast-1.compute.internal   Ready   <none>   5d   v1.34.6-eks-bbe087e
ip-172-18-21-5.ap-northeast-1.compute.internal     Ready   <none>   5d   v1.34.6-eks-bbe087e
...
```

Nếu thấy IP nodes thuộc range `172.18.x.x` → đang ở **DEV** (VPC `172.18.0.0/16`).
Nếu thấy IP nodes thuộc range `172.19.x.x` → đang ở **STG** (VPC `172.19.0.0/16`).

### Troubleshooting kết nối

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|-------------|------------------------|------------|
| `dial tcp 172.19.x.x:443: i/o timeout` | Đang dùng context STG nhưng **chưa mở SSM tunnel** (hoặc tunnel đã đóng) | Mở lại tunnel ở [Setup STG](#setup-stg-cluster-qua-ssm-tunnel) bước 2; hoặc switch sang DEV |
| `dial tcp 172.18.x.x:443: i/o timeout` từ context DEV | Hostname EKS đã đổi (cluster recreated) hoặc DNS cache cũ | Chạy lại `aws eks update-kubeconfig --profile bs-point-dev ... --name point` |
| `error: You must be logged in to the server (Unauthorized)` | Token `aws eks get-token` lỗi (sai profile, credentials hết hạn) | `aws sts get-caller-identity --profile <p>` để check; refresh credentials |
| `error: You must be logged in to the server (the server has asked for the client to provide credentials)` | IAM identity chưa được map trong EKS access entries / aws-auth ConfigMap | Liên hệ admin EKS để add access entry cho IAM principal |
| `tls: failed to verify certificate: x509: certificate is valid for ..., not localhost` | Thiếu `tls-server-name` trong cluster entry STG | Recreate context theo [Setup STG](#setup-stg-cluster-qua-ssm-tunnel) bước 1 |
| `SessionManagerPlugin is not found` | Thiếu plugin SSM | `brew install --cask session-manager-plugin` |
| `An error occurred (TargetNotConnected)` khi `aws ssm start-session` | SSM Agent trên bastion offline (instance stopped / role IAM thiếu) | `aws ec2 describe-instance-status --profile bs-point-stg --instance-ids i-04b3b9b2d3a78514f` để check; báo infra team nếu instance down |
| `bind: address already in use` (port 6443) | Port 6443 đã bị process khác chiếm | Chọn port khác (vd. `localPortNumber="16443"`) và update cluster entry tương ứng |

**Quy trình debug nhanh khi `kubectl` timeout**:
```bash
# 1. Xác định context đang dùng
kubectl config current-context

# 2. Xem server URL
kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'; echo

# 3. Test reachability (DEV) — dùng nslookup + nc
EP=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' | sed 's|https://||')
nslookup "$EP"
nc -vz "$EP" 443

# 4. Nếu STG: kiểm tra tunnel
lsof -i :6443                       # xem có process nào đang listen không
nc -vz localhost 6443               # tunnel có nhận connection không
```

---

## 1. Tổng quan Workloads trên Cluster

| # | Component | Namespace | Loại | Vai trò |
|---|-----------|-----------|------|---------|
| 1 | [CloudWatch Agent](#41-cloudwatch-agent) | `amazon-cloudwatch` | DaemonSet | Thu thập Container Insights metrics |
| 2 | [Fluent Bit](#42-fluent-bit) | `amazon-cloudwatch` | DaemonSet | Thu thập và đẩy container logs lên CloudWatch Logs |
| 3 | [Application Workloads](#43-application-workloads-5-apps) | `default` | Deployment | Ứng dụng chính (admin, api, app, mmh, worker) |
| 4 | [NFS Provisioner](#44-nfs-provisioner) | `default` | Deployment | Cung cấp PersistentVolume động qua NFS |
| 5 | [AWS Load Balancer Controller](#45-aws-load-balancer-controller) | `kube-system` | Deployment | Quản lý ALB/NLB cho Ingress và Service |
| 6 | [AWS VPC CNI (aws-node)](#46-aws-vpc-cni-aws-node) | `kube-system` | DaemonSet | Gán ENI/IP cho pods, quản lý pod networking |
| 7 | [Cluster Autoscaler](#47-cluster-autoscaler) | `kube-system` | Deployment | Tự động scale số nodes theo workload |
| 8 | [CoreDNS](#48-coredns) | `kube-system` | Deployment | DNS nội bộ cluster |
| 9 | [kube-proxy](#49-kube-proxy) | `kube-system` | DaemonSet | Quản lý iptables/IPVS rules cho Service networking |
| 10 | [Metrics Server](#410-metrics-server) | `kube-system` | Deployment | Cung cấp resource metrics cho HPA và `kubectl top` |
| 11 | [GuardDuty Agent](#411-guardduty-agent) | `amazon-guardduty` | DaemonSet | Runtime threat detection (security monitoring) |

**DaemonSet vs Deployment:**
- **DaemonSet**: Tự động chạy 1 pod trên MỖI node. Dùng cho agents (monitoring, logging, networking).
- **Deployment**: Chạy N replicas (pods) trên cluster, K8s tự chọn node. Dùng cho applications.

---

## 2. Quản lý Pods

### 2.1. Kiểm tra trạng thái pods

```bash
# ── Xem pods trong namespace default ──
# (Ứng dụng chính nằm ở namespace default, nên -n default có thể bỏ qua)
kubectl get pods -n default

# ── Filter theo tên (chỉ hiện pods có chữ "point") ──
kubectl get pods -n default | grep point

# ── Xem chi tiết 1 pod (events, conditions, node IP, ...) ──
# Thay <pod-name> bằng tên pod thực tế, ví dụ: point-api-deployment-6fccf9989d-dt6nt
kubectl describe pod <pod-name> -n default

# ── Xem chi tiết tất cả 5 workload deployments ──
kubectl describe deploy point-admin-deployment -n default
kubectl describe deploy point-api-deployment -n default
kubectl describe deploy point-app-deployment -n default
kubectl describe deploy point-mmh-deployment -n default
kubectl describe deploy point-worker-deployment -n default

# ── Pods KHÔNG ở trạng thái Running (phát hiện pod lỗi) ──
# --field-selector: lọc theo trường status
kubectl get pods -n default --field-selector=status.phase!=Running

# ── Xem pods trên TẤT CẢ namespaces ──
# -A = --all-namespaces
kubectl get pods -A

# ── Pods có restart > 0 (phát hiện pod hay crash) ──
# --no-headers: bỏ dòng tiêu đề
# | awk '$5 > 0': cột thứ 5 là RESTARTS, lọc > 0
kubectl get pods -A --no-headers | awk '$5 > 0 {print $0}'

# ── Xem CPU/Memory đang dùng (cần metrics-server đang chạy) ──
kubectl top pods -n default
kubectl top nodes

# ── Xem thông tin nodes ──
# -o wide: hiện thêm IP, OS, kernel, container runtime
kubectl get nodes -o wide
kubectl describe node <node-name>
```

### 2.2. Scale deployments

"Scale" = thay đổi số lượng pod replicas. `--replicas=0` = tắt hết pods, `--replicas=2` = bật 2 pods.

```bash
# ══════════════════════════════════════════════════════════
#  TẮT HẾT PODS (scale về 0)
# ══════════════════════════════════════════════════════════

# Tắt TẤT CẢ deployments trong namespace default (bao gồm cả NFS provisioner)
kubectl -n default scale deploy --all --replicas=0

# Tắt từng workload riêng lẻ:
kubectl -n default scale deploy/point-admin-deployment --replicas=0
kubectl -n default scale deploy/point-api-deployment --replicas=0
kubectl -n default scale deploy/point-app-deployment --replicas=0
kubectl -n default scale deploy/point-mmh-deployment --replicas=0
kubectl -n default scale deploy/point-worker-deployment --replicas=0

# ══════════════════════════════════════════════════════════
#  BẬT LẠI PODS (scale về 2)
# ══════════════════════════════════════════════════════════

# Bật TẤT CẢ deployments trong namespace default
kubectl -n default scale deploy --all --replicas=2

# Bật từng workload riêng lẻ:
kubectl -n default scale deploy/point-admin-deployment --replicas=2
kubectl -n default scale deploy/point-api-deployment --replicas=2
kubectl -n default scale deploy/point-app-deployment --replicas=2
kubectl -n default scale deploy/point-mmh-deployment --replicas=2
kubectl -n default scale deploy/point-worker-deployment --replicas=2

# ══════════════════════════════════════════════════════════
#  SCALE NÂNG CAO
# ══════════════════════════════════════════════════════════

# Scale nhiều deployments cùng lúc (liệt kê tên)
kubectl -n default scale deploy/point-api-deployment deploy/point-app-deployment --replicas=2

# Scale theo label selector (-l = --selector)
# Chỉ scale deployments có label app=point-api
kubectl -n default scale deploy -l app=point-api --replicas=1

# Scale infra (CẨN THẬN — ảnh hưởng cluster)
kubectl -n kube-system scale deploy --all --replicas=0

# ══════════════════════════════════════════════════════════
#  XEM SỐ REPLICAS HIỆN TẠI
# ══════════════════════════════════════════════════════════

# -o custom-columns: hiện cột tùy chỉnh từ JSON spec
#   .spec.replicas = số mong muốn
#   .status.readyReplicas = số đang chạy sẵn sàng
kubectl -n default get deploy -o custom-columns="NAME:.metadata.name,REPLICAS:.spec.replicas,READY:.status.readyReplicas"
```

### 2.3. Restart pods

```bash
# ══════════════════════════════════════════════════════════
#  ROLLING RESTART (không downtime — tạo pod mới trước, terminate cũ sau)
# ══════════════════════════════════════════════════════════

# Restart 1 deployment
kubectl -n default rollout restart deploy/point-admin-deployment
kubectl -n default rollout restart deploy/point-api-deployment
kubectl -n default rollout restart deploy/point-app-deployment
kubectl -n default rollout restart deploy/point-mmh-deployment
kubectl -n default rollout restart deploy/point-worker-deployment

# Restart TẤT CẢ deployments trong namespace default
kubectl -n default rollout restart deploy

# ══════════════════════════════════════════════════════════
#  RESTART 1 POD CỤ THỂ (delete → Deployment tự tạo lại)
# ══════════════════════════════════════════════════════════

# Thay <pod-name> bằng tên pod thực tế (lấy từ kubectl get pods)
kubectl delete pod <pod-name> -n default

# Force restart (alternative — set annotation, Deployment detect thay đổi → recreate)
kubectl -n default patch deploy point-api-deployment \
  -p '{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}}}}}'
# Giải thích: patch thay đổi annotation trên pod template → K8s thấy template thay đổi → rolling update
```

### 2.4. Delete pods

```bash
# Delete 1 pod (Deployment sẽ tự tạo pod mới thay thế)
kubectl delete pod <pod-name> -n default

# Delete pod NGAY LẬP TỨC (không chờ graceful shutdown 30s mặc định)
# --grace-period=0: không chờ, --force: ép buộc
kubectl delete pod <pod-name> -n default --grace-period=0 --force

# Delete tất cả pods trong namespace (Deployments sẽ tạo lại)
kubectl delete pods --all -n default

# Delete pods theo label (ví dụ: tất cả pods của point-api)
kubectl delete pods -l app=point-api -n default
kubectl delete pods -l app=point-admin -n default
kubectl delete pods -l app=point-app -n default
kubectl delete pods -l app=point-mmh -n default
kubectl delete pods -l app=point-worker -n default

# Delete pods đang bị Evicted (bị đuổi khỏi node do thiếu resource)
# | grep Evicted: lọc chỉ pods Evicted
# | awk '{print $1}': lấy cột đầu tiên (tên pod)
# | xargs: truyền tên pod làm argument cho kubectl delete
kubectl get pods -n default --field-selector=status.phase=Failed | grep Evicted | awk '{print $1}' | xargs kubectl delete pod -n default
```

### 2.5. Cordon / Drain nodes

Dùng khi cần bảo trì node (cập nhật OS, thay hardware, ...).

```bash
# CORDON: đánh dấu node "không nhận pod mới nữa"
# Pods hiện tại VẪN CHẠY, chỉ pods mới sẽ không được schedule lên node này
kubectl cordon <node-name>

# UNCORDON: gỡ đánh dấu, cho phép node nhận pod mới trở lại
kubectl uncordon <node-name>

# DRAIN: di chuyển TẤT CẢ pods khỏi node (evict)
# --ignore-daemonsets: bỏ qua DaemonSet pods (chúng luôn chạy trên mỗi node)
# --delete-emptydir-data: cho phép xóa data trong emptyDir volumes
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data

# Xem trạng thái schedulable của các nodes
kubectl get nodes -o custom-columns="NAME:.metadata.name,STATUS:.status.conditions[-1].type,SCHEDULABLE:.spec.unschedulable"
# SCHEDULABLE=<none> → node bình thường, SCHEDULABLE=true → node bị cordon
```

---

## 3. Xem Logs

### 3.1. Log cơ bản

```bash
# ── Cấu trúc chung ──
kubectl logs <resource> -n <namespace> [flags]

# ── Ví dụ: log 100 dòng cuối của point-api ──
# --tail=100: chỉ lấy 100 dòng cuối (tránh log quá dài chờ lâu)
kubectl logs deploy/point-api-deployment --tail=100

# ── Follow log realtime (giống tail -f) ──
# -f = --follow: log sẽ chạy liên tục, hiện log mới khi có. Nhấn Ctrl+C để thoát
kubectl logs deploy/point-api-deployment -f

# ── Log từ container cụ thể (pod có nhiều containers) ──
# -c aws-node: chọn container tên "aws-node" (bỏ qua containers khác trong cùng pod)
kubectl logs <pod-name> -n kube-system -c aws-node --tail=100

# ── Log tất cả containers trong pod ──
kubectl logs <pod-name> -n kube-system --all-containers

# ── Log tất cả replicas cùng lúc (dùng label selector) ──
# -l app=point-api: tìm tất cả pods có label app=point-api
# --prefix: thêm tên pod vào đầu mỗi dòng (biết dòng nào từ pod nào)
kubectl logs -l app=point-api --prefix --tail=50
```

### 3.2. Log tất cả 5 workloads

Copy-paste trực tiếp — không cần thay thế gì:

```bash
# ══════════════════════════════════════════════════════════
#  XEM LOG 5 PHÚT GẦN NHẤT
# ══════════════════════════════════════════════════════════

kubectl logs deploy/point-admin-deployment --since=5m
kubectl logs deploy/point-api-deployment --since=5m
kubectl logs deploy/point-app-deployment --since=5m
kubectl logs deploy/point-mmh-deployment --since=5m
kubectl logs deploy/point-worker-deployment --since=5m

# ══════════════════════════════════════════════════════════
#  FOLLOW LOG REALTIME (Ctrl+C để thoát)
# ══════════════════════════════════════════════════════════

kubectl logs deploy/point-admin-deployment -f
kubectl logs deploy/point-api-deployment -f
kubectl logs deploy/point-app-deployment -f
kubectl logs deploy/point-mmh-deployment -f
kubectl logs deploy/point-worker-deployment -f

# ══════════════════════════════════════════════════════════
#  LOG TẤT CẢ REPLICAS (2 pods mỗi deployment, có prefix tên pod)
# ══════════════════════════════════════════════════════════

kubectl logs -l app=point-admin --prefix --since=5m
kubectl logs -l app=point-api --prefix --since=5m
kubectl logs -l app=point-app --prefix --since=5m
kubectl logs -l app=point-mmh --prefix --since=5m
kubectl logs -l app=point-worker --prefix --since=5m

# ══════════════════════════════════════════════════════════
#  ĐẾM LỖI TRÊN TẤT CẢ 5 WORKLOADS (chạy 1 lần)
# ══════════════════════════════════════════════════════════
# Java/Spring Boot log level: ERROR, WARN (viết HOA)
# 2>&1: gộp stderr vào stdout để grep lọc được cả hai

kubectl logs deploy/point-admin-deployment --since=5m 2>&1 | grep -c "ERROR"
kubectl logs deploy/point-api-deployment --since=5m 2>&1 | grep -c "ERROR"
kubectl logs deploy/point-app-deployment --since=5m 2>&1 | grep -c "ERROR"
kubectl logs deploy/point-mmh-deployment --since=5m 2>&1 | grep -c "ERROR"
kubectl logs deploy/point-worker-deployment --since=5m 2>&1 | grep -c "ERROR"

# ══════════════════════════════════════════════════════════
#  XEM CHI TIẾT DÒNG LỖI (20 dòng đầu tiên)
# ══════════════════════════════════════════════════════════

kubectl logs deploy/point-admin-deployment --since=5m 2>&1 | grep "ERROR\|WARN" | head -20
kubectl logs deploy/point-api-deployment --since=5m 2>&1 | grep "ERROR\|WARN" | head -20
kubectl logs deploy/point-app-deployment --since=5m 2>&1 | grep "ERROR\|WARN" | head -20
kubectl logs deploy/point-mmh-deployment --since=5m 2>&1 | grep "ERROR\|WARN" | head -20
kubectl logs deploy/point-worker-deployment --since=5m 2>&1 | grep "ERROR\|WARN" | head -20

# ══════════════════════════════════════════════════════════
#  SCAN LỖI TẤT CẢ 5 WORKLOADS CÙNG LÚC (script)
# ══════════════════════════════════════════════════════════
# for ... do ... done: vòng lặp chạy qua 5 tên deployment
for d in point-admin point-api point-app point-mmh point-worker; do
  echo "=== ${d}-deployment ==="
  kubectl logs deploy/${d}-deployment --since=5m 2>&1 | grep -i "error\|exception" | tail -5
done
```

### 3.3. Lọc log theo pattern

```bash
# ── Tìm error/exception ──
# -i: case insensitive (match Error, ERROR, error)
# \|: "hoặc" trong grep (không có -E)
kubectl logs deploy/point-api-deployment --tail=500 | grep -i "error\|exception\|fatal"

# ── Tìm credential/permission issues ──
kubectl logs deploy/point-api-deployment --tail=500 | grep -i "credential\|unauthorized\|forbidden\|access.denied"

# ── Tìm connection issues ──
kubectl logs deploy/point-api-deployment --tail=500 | grep -i "connection refused\|timeout\|unreachable"

# ── Tìm OOM / memory issues ──
kubectl logs deploy/point-api-deployment --tail=500 | grep -i "out.of.memory\|oom\|heap"
```

**Copy-paste cho tất cả 5 workloads** (ví dụ: tìm error):
```bash
kubectl logs deploy/point-admin-deployment --tail=500 | grep -i "error\|exception\|fatal"
kubectl logs deploy/point-api-deployment --tail=500 | grep -i "error\|exception\|fatal"
kubectl logs deploy/point-app-deployment --tail=500 | grep -i "error\|exception\|fatal"
kubectl logs deploy/point-mmh-deployment --tail=500 | grep -i "error\|exception\|fatal"
kubectl logs deploy/point-worker-deployment --tail=500 | grep -i "error\|exception\|fatal"
```

### 3.4. Log theo thời gian

```bash
# Log 5 phút gần nhất
kubectl logs deploy/point-api-deployment --since=5m

# Log 30 phút gần nhất
kubectl logs deploy/point-api-deployment --since=30m

# Log 1 giờ gần nhất
kubectl logs deploy/point-api-deployment --since=1h

# Log 2 giờ gần nhất
kubectl logs deploy/point-api-deployment --since=2h

# Log từ timestamp cụ thể (RFC3339 format: YYYY-MM-DDTHH:MM:SSZ)
# Z = UTC timezone
kubectl logs deploy/point-api-deployment --since-time="2026-03-09T04:00:00Z"
```

### 3.5. Log container trước đó (sau restart/crash)

```bash
# --previous: xem log của container lần chạy TRƯỚC ĐÓ
# CHỈ hoạt động khi container trong CÙNG pod đã restart
# KHÔNG hoạt động khi Deployment tạo pod MỚI (rolling update)
kubectl logs <pod-name> --previous

# Copy-paste cho 5 workloads:
kubectl logs deploy/point-admin-deployment --previous
kubectl logs deploy/point-api-deployment --previous
kubectl logs deploy/point-app-deployment --previous
kubectl logs deploy/point-mmh-deployment --previous
kubectl logs deploy/point-worker-deployment --previous

# Kiểm tra số lần restart (biết container có restart không)
# -o custom-columns: hiện cột tùy chỉnh
kubectl get pods -n default -o custom-columns="NAME:.metadata.name,RESTARTS:.status.containerStatuses[0].restartCount"
```

### 3.6. Giới hạn số dòng / Lưu ra file

```bash
# 100 dòng cuối
kubectl logs deploy/point-api-deployment --tail=100

# 50 dòng cuối + follow realtime
kubectl logs deploy/point-api-deployment --tail=50 -f

# Lưu log ra file (> = redirect output vào file, ghi đè nếu file đã có)
kubectl logs deploy/point-api-deployment --since=1h > /tmp/point-api-logs.txt

# Lưu log tất cả replicas với prefix tên pod
kubectl logs -l app=point-api --prefix --since=1h > /tmp/point-api-all-pods.txt

# Lưu log tất cả 5 workloads ra 5 file riêng:
kubectl logs deploy/point-admin-deployment --since=1h > /tmp/point-admin-logs.txt
kubectl logs deploy/point-api-deployment --since=1h > /tmp/point-api-logs.txt
kubectl logs deploy/point-app-deployment --since=1h > /tmp/point-app-logs.txt
kubectl logs deploy/point-mmh-deployment --since=1h > /tmp/point-mmh-logs.txt
kubectl logs deploy/point-worker-deployment --since=1h > /tmp/point-worker-logs.txt
```

---

## 4. Log chi tiết từng Component

### 4.1. CloudWatch Agent

- **Loại**: DaemonSet (chạy trên mỗi node)
- **Namespace**: `amazon-cloudwatch`
- **Label**: `name=cloudwatch-agent`
- **Vai trò**: Thu thập Container Insights metrics → gửi lên CloudWatch

```bash
# ── Xem log ──
kubectl logs ds/cloudwatch-agent -n amazon-cloudwatch --since=5m
kubectl logs -l name=cloudwatch-agent -n amazon-cloudwatch --prefix --since=10m
kubectl logs ds/cloudwatch-agent -n amazon-cloudwatch -f
kubectl logs ds/cloudwatch-agent -n amazon-cloudwatch --previous

# ── Đếm tổng số lỗi ──
# 'E!' là prefix lỗi riêng của CloudWatch Agent
kubectl logs ds/cloudwatch-agent -n amazon-cloudwatch --since=5m 2>&1 | grep -ciE 'E!|error|fail'

# ── Xem chi tiết dòng lỗi ──
kubectl logs ds/cloudwatch-agent -n amazon-cloudwatch --since=5m 2>&1 | grep -iE 'E!|error|fail'

# ── Loại trừ lỗi đã biết (false positive) ──
# grep -v: loại bỏ dòng match
# ec2metadata, imds: lỗi do IMDS hop limit, không ảnh hưởng
# tls-ca.crt, observability-agent-cert: lỗi cert không ảnh hưởng
# crio, docker: container runtime noise
kubectl logs ds/cloudwatch-agent -n amazon-cloudwatch --since=5m 2>&1 \
  | grep -iE 'E!|error|fail' \
  | grep -v "ec2metadata\|ec2 metadata\|imds\|tls-ca.crt\|observability-agent-cert\|crio\|docker\|DCGMExporter\|169.254"

# ── Lỗi cụ thể ──
kubectl logs ds/cloudwatch-agent -n amazon-cloudwatch --since=5m 2>&1 | grep -c "SharedCredsLoad"
kubectl logs ds/cloudwatch-agent -n amazon-cloudwatch 2>&1 | grep -c "forbidden"
kubectl logs ds/cloudwatch-agent -n amazon-cloudwatch --since=5m 2>&1 | grep -c "rejected_items"

# ── Kiểm tra IRSA (IAM Roles for Service Accounts) ──
# -o jsonpath: trích xuất field cụ thể từ JSON output
kubectl get pod -n amazon-cloudwatch -l name=cloudwatch-agent \
  -o jsonpath='{range .items[0].spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}' \
  | grep -E "RUN_WITH_IRSA|AWS_"
# Expected output:
#   RUN_WITH_IRSA=True
#   AWS_ROLE_ARN=arn:aws:iam::{ACCOUNT_ID}:role/point-cloudwatch-agent-irsa-role
#   AWS_WEB_IDENTITY_TOKEN_FILE=/var/run/secrets/eks.amazonaws.com/serviceaccount/token
```

---

### 4.2. Fluent Bit

- **Loại**: DaemonSet (chạy trên mỗi node)
- **Namespace**: `amazon-cloudwatch`
- **Label**: `k8s-app=fluent-bit`
- **Vai trò**: Thu thập container logs từ node → đẩy lên CloudWatch Logs

```bash
# ── Xem log ──
kubectl logs ds/fluent-bit -n amazon-cloudwatch --since=5m
kubectl logs -l k8s-app=fluent-bit -n amazon-cloudwatch --prefix
kubectl logs ds/fluent-bit -n amazon-cloudwatch -f
kubectl logs ds/fluent-bit -n amazon-cloudwatch --previous

# ── Kiểm tra lỗi ──
kubectl logs ds/fluent-bit -n amazon-cloudwatch --since=5m 2>&1 | grep -ciE "error|fail|warn"
kubectl logs ds/fluent-bit -n amazon-cloudwatch --since=5m 2>&1 | grep -iE "error|fail|warn"

# ── Lỗi credential (Fluent Bit dùng IMDS qua hostNetwork, không dùng IRSA) ──
kubectl logs ds/fluent-bit -n amazon-cloudwatch --since=5m 2>&1 | grep -ciE "credential|forbidden|unauthorized"

# ── Kiểm tra output plugin (gửi log lên CloudWatch thành công?) ──
kubectl logs ds/fluent-bit -n amazon-cloudwatch --since=5m 2>&1 | grep -iE "output|cloudwatch"
```

---

### 4.3. Application Workloads (5 apps)

- **Loại**: Deployment (2 replicas mỗi app)
- **Namespace**: `default`
- **Deployments**:
  1. `point-admin-deployment` — Admin panel
  2. `point-api-deployment` — API server
  3. `point-app-deployment` — Main application
  4. `point-mmh-deployment` — MMH service
  5. `point-worker-deployment` — Background workers

> **Quan trọng**: Apps dùng Java/Kotlin (Spring Boot) → log level viết HOA: `ERROR`, `WARN`, `INFO`.
> Khác với infra components dùng `error`, `fail` (viết thường).

```bash
# ══════════════════════════════════════════════════════════
#  XEM LOG
# ══════════════════════════════════════════════════════════

# Log 5 phút gần nhất (mỗi lệnh = 1 pod đại diện của deployment)
kubectl logs deploy/point-admin-deployment --since=5m
kubectl logs deploy/point-api-deployment --since=5m
kubectl logs deploy/point-app-deployment --since=5m
kubectl logs deploy/point-mmh-deployment --since=5m
kubectl logs deploy/point-worker-deployment --since=5m

# Log tất cả replicas (2 pods) với prefix tên pod
kubectl logs -l app=point-admin --prefix --since=5m
kubectl logs -l app=point-api --prefix --since=5m
kubectl logs -l app=point-app --prefix --since=5m
kubectl logs -l app=point-mmh --prefix --since=5m
kubectl logs -l app=point-worker --prefix --since=5m

# Follow log realtime
kubectl logs deploy/point-admin-deployment -f
kubectl logs deploy/point-api-deployment -f
kubectl logs deploy/point-app-deployment -f
kubectl logs deploy/point-mmh-deployment -f
kubectl logs deploy/point-worker-deployment -f

# Log container trước đó (nếu pod restart)
kubectl logs deploy/point-admin-deployment --previous
kubectl logs deploy/point-api-deployment --previous
kubectl logs deploy/point-app-deployment --previous
kubectl logs deploy/point-mmh-deployment --previous
kubectl logs deploy/point-worker-deployment --previous

# ══════════════════════════════════════════════════════════
#  KIỂM TRA LỖI
# ══════════════════════════════════════════════════════════

# Đếm ERROR + WARN (viết HOA — Java log format)
kubectl logs deploy/point-admin-deployment --since=5m 2>&1 | grep -c "ERROR\|WARN"
kubectl logs deploy/point-api-deployment --since=5m 2>&1 | grep -c "ERROR\|WARN"
kubectl logs deploy/point-app-deployment --since=5m 2>&1 | grep -c "ERROR\|WARN"
kubectl logs deploy/point-mmh-deployment --since=5m 2>&1 | grep -c "ERROR\|WARN"
kubectl logs deploy/point-worker-deployment --since=5m 2>&1 | grep -c "ERROR\|WARN"

# Xem chi tiết dòng lỗi (20 dòng đầu)
kubectl logs deploy/point-admin-deployment --since=5m 2>&1 | grep "ERROR\|WARN" | head -20
kubectl logs deploy/point-api-deployment --since=5m 2>&1 | grep "ERROR\|WARN" | head -20
kubectl logs deploy/point-app-deployment --since=5m 2>&1 | grep "ERROR\|WARN" | head -20
kubectl logs deploy/point-mmh-deployment --since=5m 2>&1 | grep "ERROR\|WARN" | head -20
kubectl logs deploy/point-worker-deployment --since=5m 2>&1 | grep "ERROR\|WARN" | head -20

# Lỗi credential
kubectl logs deploy/point-admin-deployment --since=5m 2>&1 | grep -ciE "SharedCredsLoad|credential|forbidden"
kubectl logs deploy/point-api-deployment --since=5m 2>&1 | grep -ciE "SharedCredsLoad|credential|forbidden"
kubectl logs deploy/point-app-deployment --since=5m 2>&1 | grep -ciE "SharedCredsLoad|credential|forbidden"
kubectl logs deploy/point-mmh-deployment --since=5m 2>&1 | grep -ciE "SharedCredsLoad|credential|forbidden"
kubectl logs deploy/point-worker-deployment --since=5m 2>&1 | grep -ciE "SharedCredsLoad|credential|forbidden"

# Script scan tất cả cùng lúc:
for d in point-admin point-api point-app point-mmh point-worker; do
  echo "=== ${d}-deployment ==="
  kubectl logs deploy/${d}-deployment --since=5m 2>&1 | grep -i "error\|exception" | tail -5
done

# ══════════════════════════════════════════════════════════
#  KIỂM TRA IRSA
# ══════════════════════════════════════════════════════════

# Xem AWS env vars trong pod (kiểm tra IRSA có được mount không)
# tr ' ' '\n': thay space bằng newline (mỗi env var 1 dòng)
kubectl get pod -l app=point-admin -o jsonpath='{.items[0].spec.containers[0].env[*].name}' | tr ' ' '\n' | grep AWS
kubectl get pod -l app=point-api -o jsonpath='{.items[0].spec.containers[0].env[*].name}' | tr ' ' '\n' | grep AWS
kubectl get pod -l app=point-app -o jsonpath='{.items[0].spec.containers[0].env[*].name}' | tr ' ' '\n' | grep AWS
kubectl get pod -l app=point-mmh -o jsonpath='{.items[0].spec.containers[0].env[*].name}' | tr ' ' '\n' | grep AWS
kubectl get pod -l app=point-worker -o jsonpath='{.items[0].spec.containers[0].env[*].name}' | tr ' ' '\n' | grep AWS

# Xem ServiceAccount annotations (IRSA role ARN)
kubectl get sa -n default -o custom-columns="NAME:.metadata.name,IRSA:.metadata.annotations.eks\.amazonaws\.com/role-arn"
```

---

### 4.4. NFS Provisioner

- **Loại**: Deployment (1 replica)
- **Namespace**: `default`
- **Vai trò**: Cung cấp PersistentVolume động qua NFS server

```bash
kubectl logs deploy/nfs-subdir-external-provisioner --since=5m
kubectl logs deploy/nfs-subdir-external-provisioner -f
kubectl logs deploy/nfs-subdir-external-provisioner --since=10m 2>&1 | grep -iE "error|fail|timeout"
```

---

### 4.5. AWS Load Balancer Controller

- **Loại**: Deployment (2 replicas)
- **Namespace**: `kube-system`
- **Label**: `app.kubernetes.io/name=aws-load-balancer-controller`
- **Vai trò**: Tạo/quản lý ALB (Application Load Balancer) và NLB cho Ingress và Service

```bash
# ── Xem log ──
kubectl logs deploy/aws-load-balancer-controller -n kube-system --since=5m
kubectl logs -l app.kubernetes.io/name=aws-load-balancer-controller -n kube-system --prefix
kubectl logs deploy/aws-load-balancer-controller -n kube-system -f

# ── Kiểm tra lỗi ──
kubectl logs deploy/aws-load-balancer-controller -n kube-system --since=5m 2>&1 | grep -ciE "error|fail|warn"
kubectl logs deploy/aws-load-balancer-controller -n kube-system --since=5m 2>&1 | grep -iE "error|fail|warn" | head -20

# ── Lỗi credential / IRSA ──
kubectl logs deploy/aws-load-balancer-controller -n kube-system --since=5m 2>&1 | grep -ciE "credential|forbidden|unauthorized"

# ── Lỗi Ingress/TargetGroup (ALB không tạo được) ──
kubectl logs deploy/aws-load-balancer-controller -n kube-system --since=5m 2>&1 | grep -iE "ingress|targetgroup" | grep -iE "error|fail" | head -10
```

---

### 4.6. AWS VPC CNI (aws-node)

- **Loại**: DaemonSet (2 containers: `aws-node` + `aws-eks-nodeagent`)
- **Namespace**: `kube-system`
- **Label**: `k8s-app=aws-node`
- **Vai trò**: Gán ENI/IP cho pods, quản lý pod networking trên VPC

```bash
# ── Log container aws-node (VPC CNI chính — gán IP cho pods) ──
kubectl logs ds/aws-node -n kube-system -c aws-node --since=5m

# ── Log container aws-eks-nodeagent (network policy agent) ──
kubectl logs ds/aws-node -n kube-system -c aws-eks-nodeagent --since=5m

# ── Log tất cả containers trong pod ──
kubectl logs ds/aws-node -n kube-system --all-containers --since=5m

# ── Log tất cả pods (trên tất cả nodes) ──
kubectl logs -l k8s-app=aws-node -n kube-system --prefix --all-containers --since=5m

# ── Kiểm tra lỗi ──
kubectl logs ds/aws-node -n kube-system -c aws-node --since=5m 2>&1 | grep -ciE "error|fail|warn"
kubectl logs ds/aws-node -n kube-system -c aws-node --since=5m 2>&1 | grep -iE "error|fail|warn" | head -20

# ── Lỗi ENI/IP allocation (pod không lấy được IP) ──
kubectl logs ds/aws-node -n kube-system -c aws-node --since=5m 2>&1 | grep -iE "eni|ipassign" | grep -iE "error|fail"

# ── Lỗi credential ──
kubectl logs ds/aws-node -n kube-system -c aws-node --since=5m 2>&1 | grep -ciE "credential|unauthorized"
```

---

### 4.7. Cluster Autoscaler

- **Loại**: Deployment (1 replica)
- **Namespace**: `kube-system`
- **Vai trò**: Tự động tăng/giảm số nodes theo workload demand

```bash
kubectl logs deploy/cluster-autoscaler -n kube-system --since=5m
kubectl logs deploy/cluster-autoscaler -n kube-system -f

# ── Kiểm tra lỗi ──
# QUAN TRỌNG: Cluster Autoscaler dùng "klog" format:
#   I0309 = Info (ngày 03/09), W0309 = Warn, E0309 = Error
# KHÔNG dùng grep "error|fail" vì ASG names chứa "failure-domain" → false positive
# ^E[0-9]: dòng bắt đầu bằng E + số = Error level
kubectl logs deploy/cluster-autoscaler -n kube-system --since=5m 2>&1 | grep "^E[0-9]\|^W[0-9]" | head -20

# Đếm error lines
kubectl logs deploy/cluster-autoscaler -n kube-system --since=5m 2>&1 | grep -c "^E[0-9]"

# ── Xem scale events (node thêm/bớt) ──
kubectl logs deploy/cluster-autoscaler -n kube-system --since=10m 2>&1 | grep -iE "scale up\|scale down\|unschedulable"
```

---

### 4.8. CoreDNS

- **Loại**: Deployment (2 replicas)
- **Namespace**: `kube-system`
- **Label**: `k8s-app=kube-dns`
- **Vai trò**: DNS server nội bộ cluster — resolve service names thành ClusterIP

```bash
kubectl logs deploy/coredns -n kube-system --since=5m
kubectl logs -l k8s-app=kube-dns -n kube-system --prefix --since=5m

# ── Kiểm tra lỗi ──
kubectl logs -l k8s-app=kube-dns -n kube-system --since=5m 2>&1 | grep -ciE "error|fail|warn"

# ── Lỗi DNS resolution (service không resolve được) ──
kubectl logs -l k8s-app=kube-dns -n kube-system --since=5m 2>&1 | grep -iE "servfail|refused|timeout"
```

---

### 4.9. kube-proxy

- **Loại**: DaemonSet (chạy trên mỗi node)
- **Namespace**: `kube-system`
- **Label**: `k8s-app=kube-proxy`
- **Vai trò**: Quản lý iptables/IPVS rules cho Service networking (route traffic tới pods)

```bash
kubectl logs ds/kube-proxy -n kube-system --since=5m
kubectl logs -l k8s-app=kube-proxy -n kube-system --prefix --since=5m

# ── Kiểm tra lỗi (klog format — giống Cluster Autoscaler) ──
kubectl logs ds/kube-proxy -n kube-system --since=5m 2>&1 | grep "^E[0-9]\|^W[0-9]" | head -20
kubectl logs ds/kube-proxy -n kube-system --since=5m 2>&1 | grep -c "^E[0-9]"

# ── Lỗi iptables/IPVS (Service không route được traffic) ──
kubectl logs ds/kube-proxy -n kube-system --since=5m 2>&1 | grep -iE "iptables|ipvs" | grep -iE "error|fail"
```

---

### 4.10. Metrics Server

- **Loại**: Deployment (1 replica)
- **Namespace**: `kube-system`
- **Vai trò**: Thu thập CPU/Memory metrics → cung cấp cho HPA (auto-scaling) và `kubectl top`

```bash
kubectl logs deploy/metrics-server -n kube-system --since=5m

# ── Kiểm tra lỗi ──
kubectl logs deploy/metrics-server -n kube-system --since=5m 2>&1 | grep -ciE "error|fail|warn"
kubectl logs deploy/metrics-server -n kube-system --since=5m 2>&1 | grep -iE "error|fail|warn" | head -20

# ── Lỗi scrape metrics từ kubelet (kubectl top không hoạt động) ──
kubectl logs deploy/metrics-server -n kube-system --since=5m 2>&1 | grep -iE "scraping\|kubelet" | grep -iE "error|fail|timeout"
```

---

### 4.11. GuardDuty Agent

- **Loại**: DaemonSet (chạy trên mỗi node)
- **Namespace**: `amazon-guardduty`
- **Vai trò**: Runtime threat detection — phát hiện hành vi bất thường trên container/host

```bash
kubectl logs ds/aws-guardduty-agent -n amazon-guardduty --since=5m
kubectl logs -l app=aws-guardduty-agent -n amazon-guardduty --prefix --since=5m

# ── Kiểm tra lỗi ──
kubectl logs ds/aws-guardduty-agent -n amazon-guardduty --since=5m 2>&1 | grep -ciE "error|fail|warn"
kubectl logs ds/aws-guardduty-agent -n amazon-guardduty --since=5m 2>&1 | grep -iE "error|fail|warn" | head -20
kubectl logs ds/aws-guardduty-agent -n amazon-guardduty --since=5m 2>&1 | grep -ciE "credential|unauthorized"
```

---

## 5. Exec vào Pod

"Exec" = chạy command bên trong container đang chạy. Giống SSH vào server.

```bash
# ══════════════════════════════════════════════════════════
#  MỞ SHELL TRONG POD
# ══════════════════════════════════════════════════════════

# -i: interactive (giữ stdin mở — để bạn gõ lệnh)
# -t: allocate TTY (terminal) — để hiện prompt $
# --: phân tách flags kubectl với command chạy trong pod
# /bin/sh: chạy shell (hầu hết containers không có bash, dùng sh)

# Exec vào deployment (kubectl tự chọn 1 pod)
kubectl exec -it deploy/point-admin-deployment -- /bin/sh
kubectl exec -it deploy/point-api-deployment -- /bin/sh
kubectl exec -it deploy/point-app-deployment -- /bin/sh
kubectl exec -it deploy/point-mmh-deployment -- /bin/sh
kubectl exec -it deploy/point-worker-deployment -- /bin/sh

# Exec vào pod cụ thể (tên pod lấy từ kubectl get pods)
kubectl exec -it <pod-name> -n default -- /bin/sh

# ══════════════════════════════════════════════════════════
#  CHẠY 1 COMMAND (không cần mở shell)
# ══════════════════════════════════════════════════════════

# Check env vars (tìm biến AWS)
kubectl exec deploy/point-admin-deployment -- env | grep AWS
kubectl exec deploy/point-api-deployment -- env | grep AWS
kubectl exec deploy/point-app-deployment -- env | grep AWS
kubectl exec deploy/point-mmh-deployment -- env | grep AWS
kubectl exec deploy/point-worker-deployment -- env | grep AWS

# Xem env vars từ bên ngoài (không cần exec vào pod)
kubectl set env deploy/point-admin-deployment --list
kubectl set env deploy/point-api-deployment --list
kubectl set env deploy/point-app-deployment --list
kubectl set env deploy/point-mmh-deployment --list
kubectl set env deploy/point-worker-deployment --list

# ══════════════════════════════════════════════════════════
#  CHECK NETWORK / DNS / FILESYSTEM (từ bên trong pod)
# ══════════════════════════════════════════════════════════

# Check network connectivity
kubectl exec deploy/point-api-deployment -- curl -s --connect-timeout 5 <url>

# Check DNS resolution
kubectl exec deploy/point-api-deployment -- nslookup <hostname>

# Check file system
kubectl exec deploy/point-api-deployment -- ls -la /path/to/check
```

---

## 6. Debug IRSA / AWS Credentials

IRSA = IAM Roles for Service Accounts. Cho phép pods assume IAM role mà không cần access keys.

```bash
# ══════════════════════════════════════════════════════════
#  KIỂM TRA IRSA TOKEN TRONG POD
# ══════════════════════════════════════════════════════════

# Kiểm tra token file có được mount không
kubectl exec deploy/point-admin-deployment -- ls -la /var/run/secrets/eks.amazonaws.com/serviceaccount/token
kubectl exec deploy/point-api-deployment -- ls -la /var/run/secrets/eks.amazonaws.com/serviceaccount/token
kubectl exec deploy/point-app-deployment -- ls -la /var/run/secrets/eks.amazonaws.com/serviceaccount/token
kubectl exec deploy/point-mmh-deployment -- ls -la /var/run/secrets/eks.amazonaws.com/serviceaccount/token
kubectl exec deploy/point-worker-deployment -- ls -la /var/run/secrets/eks.amazonaws.com/serviceaccount/token

# Kiểm tra env var IRSA
kubectl exec deploy/point-admin-deployment -- env | grep AWS_WEB_IDENTITY_TOKEN_FILE
kubectl exec deploy/point-api-deployment -- env | grep AWS_WEB_IDENTITY_TOKEN_FILE
kubectl exec deploy/point-app-deployment -- env | grep AWS_WEB_IDENTITY_TOKEN_FILE
kubectl exec deploy/point-mmh-deployment -- env | grep AWS_WEB_IDENTITY_TOKEN_FILE
kubectl exec deploy/point-worker-deployment -- env | grep AWS_WEB_IDENTITY_TOKEN_FILE

# ══════════════════════════════════════════════════════════
#  KIỂM TRA SERVICE ACCOUNT
# ══════════════════════════════════════════════════════════

# Xem ServiceAccount annotations (có IRSA role ARN không?)
# -o jsonpath: trích xuất field cụ thể từ JSON
kubectl get sa <sa-name> -n <namespace> -o jsonpath='{.metadata.annotations}' && echo

# Xem tất cả ServiceAccounts trong namespace default
kubectl get sa -n default -o custom-columns="NAME:.metadata.name,IRSA:.metadata.annotations.eks\.amazonaws\.com/role-arn"

# ══════════════════════════════════════════════════════════
#  KIỂM TRA IMDS (Instance Metadata Service)
# ══════════════════════════════════════════════════════════

# Expected: timeout nếu hop_limit=1 (bảo mật đúng — pods không access được IMDS)
kubectl exec deploy/point-api-deployment -- curl -s --connect-timeout 2 http://169.254.169.254/latest/meta-data/ || echo "IMDS blocked"

# ══════════════════════════════════════════════════════════
#  KIỂM TRA IAM ROLE (chạy trên bastion/local, KHÔNG trong pod)
# ══════════════════════════════════════════════════════════

# Xem policies gắn vào role
aws iam list-attached-role-policies --role-name <role-name> --query 'AttachedPolicies[*].PolicyName' --output table

# Simulate xem role có quyền thực hiện action không
aws iam simulate-principal-policy --policy-source-arn "arn:aws:iam::<account-id>:role/<role-name>" --action-names "<action>" --output json
```

---

## 7. Events & Resource Status

Events = nhật ký sự kiện trong K8s (pod created, image pulled, OOM killed, ...).

```bash
# Events gần nhất trong namespace (sorted by time)
# --sort-by: sắp xếp theo field JSON
# | tail -30: chỉ lấy 30 dòng cuối (mới nhất)
kubectl get events -n default --sort-by='.lastTimestamp' | tail -30

# Events của 1 pod cụ thể (nằm cuối output của describe)
# grep -A 20: hiện 20 dòng SAU dòng match "Events:"
kubectl describe pod <pod-name> -n default | grep -A 20 "Events:"

# Events toàn cluster (tất cả namespaces)
kubectl get events -A --sort-by='.lastTimestamp' | tail -20

# Xem resource usage
kubectl top pods -n default
kubectl top nodes
```

---

## 8. Deployment & Rollout

```bash
# ══════════════════════════════════════════════════════════
#  XEM TRẠNG THÁI ROLLOUT (deployment có đang update không?)
# ══════════════════════════════════════════════════════════

kubectl rollout status deploy/point-admin-deployment
kubectl rollout status deploy/point-api-deployment
kubectl rollout status deploy/point-app-deployment
kubectl rollout status deploy/point-mmh-deployment
kubectl rollout status deploy/point-worker-deployment

# ══════════════════════════════════════════════════════════
#  XEM LỊCH SỬ ROLLOUT (các version đã deploy)
# ══════════════════════════════════════════════════════════

kubectl rollout history deploy/point-admin-deployment
kubectl rollout history deploy/point-api-deployment
kubectl rollout history deploy/point-app-deployment
kubectl rollout history deploy/point-mmh-deployment
kubectl rollout history deploy/point-worker-deployment

# ══════════════════════════════════════════════════════════
#  ROLLING RESTART (zero-downtime)
# ══════════════════════════════════════════════════════════

kubectl rollout restart deploy/point-admin-deployment
kubectl rollout restart deploy/point-api-deployment
kubectl rollout restart deploy/point-app-deployment
kubectl rollout restart deploy/point-mmh-deployment
kubectl rollout restart deploy/point-worker-deployment

# ══════════════════════════════════════════════════════════
#  ROLLBACK VỀ VERSION TRƯỚC
# ══════════════════════════════════════════════════════════

kubectl rollout undo deploy/point-admin-deployment
kubectl rollout undo deploy/point-api-deployment
kubectl rollout undo deploy/point-app-deployment
kubectl rollout undo deploy/point-mmh-deployment
kubectl rollout undo deploy/point-worker-deployment

# ══════════════════════════════════════════════════════════
#  XEM DOCKER IMAGE HIỆN TẠI
# ══════════════════════════════════════════════════════════
# -o jsonpath: trích xuất field cụ thể từ JSON spec
kubectl get deploy/point-admin-deployment -o jsonpath='{.spec.template.spec.containers[0].image}' && echo
kubectl get deploy/point-api-deployment -o jsonpath='{.spec.template.spec.containers[0].image}' && echo
kubectl get deploy/point-app-deployment -o jsonpath='{.spec.template.spec.containers[0].image}' && echo
kubectl get deploy/point-mmh-deployment -o jsonpath='{.spec.template.spec.containers[0].image}' && echo
kubectl get deploy/point-worker-deployment -o jsonpath='{.spec.template.spec.containers[0].image}' && echo

# ══════════════════════════════════════════════════════════
#  SECRETS
# ══════════════════════════════════════════════════════════

# Liệt kê secrets
kubectl get secret -n default

# Decode secret (base64 → plaintext)
# python3 -c: chạy Python inline
# base64.b64decode: giải mã base64
kubectl get secret <secret-name> -n default -o jsonpath='{.data}' | python3 -c "import sys,json,base64; d=json.load(sys.stdin); [print(f'{k}: {base64.b64decode(v).decode()}') for k,v in d.items()]"
```

---

## 9. Networking Debug

```bash
# ── Service endpoints (IP:port mà Service route traffic tới) ──
kubectl get svc -n default
kubectl get endpoints -n default

# ── Ingress (route HTTP traffic từ ALB vào Services) ──
kubectl get ingress -n default
kubectl describe ingress <ingress-name> -n default

# ── Port-forward (map port local → pod, để test từ máy mình) ──
# Ví dụ: localhost:8080 → pod port 8080
kubectl port-forward deploy/point-api-deployment 8080:8080
# Sau đó mở browser: http://localhost:8080
# Nhấn Ctrl+C để thoát
```

---

## 10. Scan toàn Cluster

### 10.1. Health check toàn cluster

```bash
# Pods không Running (phát hiện pod lỗi)
kubectl get pods -A --field-selector=status.phase!=Running --no-headers

# Pods có restart > 0 (phát hiện pod hay crash)
# awk '$5 > 0': cột 5 = RESTARTS, lọc > 0
kubectl get pods -A --no-headers | awk '$5 > 0 {print $0}'

# Events gần đây (scheduling, image pull, OOM, ...)
kubectl get events -A --sort-by='.lastTimestamp' | tail -20
```

### 10.2. Scan errors toàn cluster

```bash
echo "=== ERROR SCAN (last 5m) ==="
echo ""

echo "--- DaemonSets ---"
# CW Agent: dùng 'E!' vì log có nhiều noise
# wc -l: đếm số dòng | tr -d ' ': xóa spaces thừa
count=$(kubectl logs ds/cloudwatch-agent -n amazon-cloudwatch --since=5m 2>&1 \
  | grep 'E!' | grep -v "ec2metadata\|ec2 metadata\|169.254" | wc -l | tr -d ' ')
echo "  cloudwatch-agent: ${count} errors (excl. ec2metadata)"

count=$(kubectl logs ds/fluent-bit -n amazon-cloudwatch --since=5m 2>&1 \
  | grep -ciE "error|fail" || true)
echo "  fluent-bit: ${count} errors"

count=$(kubectl logs ds/aws-node -n kube-system -c aws-node --since=5m 2>&1 \
  | grep -ciE "error|fail" || true)
echo "  aws-node: ${count} errors"

# kube-proxy: dùng klog format (^E[0-9] = Error level)
count=$(kubectl logs ds/kube-proxy -n kube-system --since=5m 2>&1 \
  | grep -c "^E[0-9]" || true)
echo "  kube-proxy: ${count} errors"

echo ""
echo "--- Application Workloads (Java — grep ERROR/WARN) ---"
# for ... do ... done: vòng lặp qua 5 tên
# ${deploy}: biến shell, sẽ được thay bằng point-admin, point-api, ...
for deploy in point-admin point-api point-app point-mmh point-worker; do
  errors=$(kubectl logs deploy/${deploy}-deployment --since=5m 2>&1 \
    | grep -c '"level":"ERROR"' || true)
  warns=$(kubectl logs deploy/${deploy}-deployment --since=5m 2>&1 \
    | grep -c '"level":"WARN"' || true)
  echo "  ${deploy}: ${errors} ERROR, ${warns} WARN"
done

echo ""
echo "--- Infra Deployments ---"
count=$(kubectl logs deploy/aws-load-balancer-controller -n kube-system --since=5m 2>&1 \
  | grep -ciE "error|fail" || true)
echo "  alb-controller: ${count} errors"

count=$(kubectl logs deploy/cluster-autoscaler -n kube-system --since=5m 2>&1 \
  | grep -c "^E[0-9]" || true)
echo "  cluster-autoscaler: ${count} errors"

count=$(kubectl logs deploy/coredns -n kube-system --since=5m 2>&1 \
  | grep -ciE "error|fail" || true)
echo "  coredns: ${count} errors"

count=$(kubectl logs deploy/metrics-server -n kube-system --since=5m 2>&1 \
  | grep -ciE "error|fail" || true)
echo "  metrics-server: ${count} errors"
```

> **Lưu ý về log format** (quan trọng khi grep):
> | Component | Log format | Cách grep đúng |
> |-----------|-----------|----------------|
> | Java apps (point-*) | JSON, `"level":"ERROR"` | `grep '"level":"ERROR"'` |
> | klog apps (cluster-autoscaler, kube-proxy) | `E0309`, `W0309` prefix | `grep "^E[0-9]"` |
> | CW Agent | `E!` prefix | `grep 'E!'` |
> | Các component khác | Text thường | `grep -iE "error\|fail"` |

### 10.3. Kiểm tra credential errors toàn cluster

```bash
echo "=== CREDENTIAL CHECK ==="

# Infra components
# cut -d: -f1: cắt chuỗi theo dấu ":", lấy phần thứ 1
for item in "ds/cloudwatch-agent:-n amazon-cloudwatch" "ds/fluent-bit:-n amazon-cloudwatch" "deploy/aws-load-balancer-controller:-n kube-system" "ds/aws-node:-n kube-system -c aws-node"; do
  resource=$(echo $item | cut -d: -f1)
  flags=$(echo $item | cut -d: -f2)
  name=$(echo $resource | cut -d/ -f2)
  count=$(kubectl logs $resource $flags --since=5m 2>&1 \
    | grep -ciE "SharedCredsLoad|credential.*error|forbidden|unauthorized" || true)
  echo "  ${name}: ${count}"
done

# Application workloads
for deploy in point-admin point-api point-app point-mmh point-worker; do
  count=$(kubectl logs deploy/${deploy}-deployment --since=5m 2>&1 \
    | grep -ciE "SharedCredsLoad|credential.*error|forbidden" || true)
  echo "  ${deploy}: ${count}"
done
```

### 10.4. Script kiểm tra nhanh (health + errors)

```bash
echo "=== CLUSTER HEALTH CHECK ==="
echo ""

echo "--- Pods Status ---"
total=$(kubectl get pods -A --no-headers | wc -l)
running=$(kubectl get pods -A --field-selector=status.phase=Running --no-headers | wc -l)
echo "Total: ${total}, Running: ${running}, Not Running: $((total - running))"
echo ""

echo "--- DaemonSets ---"
for item in "amazon-cloudwatch:cloudwatch-agent" "amazon-cloudwatch:fluent-bit" "kube-system:kube-proxy" "kube-system:aws-node" "amazon-guardduty:aws-guardduty-agent"; do
  ns=$(echo $item | cut -d: -f1)
  name=$(echo $item | cut -d: -f2)
  status=$(kubectl get ds/$name -n $ns --no-headers 2>/dev/null | awk '{print "desired="$2" ready="$4}')
  echo "  ${name} (${ns}): ${status}"
done
echo ""

echo "--- Deployments ---"
for item in "default:point-admin-deployment" "default:point-api-deployment" "default:point-app-deployment" "default:point-mmh-deployment" "default:point-worker-deployment" "default:nfs-subdir-external-provisioner" "kube-system:aws-load-balancer-controller" "kube-system:cluster-autoscaler" "kube-system:coredns" "kube-system:metrics-server"; do
  ns=$(echo $item | cut -d: -f1)
  name=$(echo $item | cut -d: -f2)
  status=$(kubectl get deploy/$name -n $ns --no-headers 2>/dev/null | awk '{print "ready="$2" available="$4}')
  echo "  ${name} (${ns}): ${status}"
done
echo ""

echo "--- Pods với restart > 0 ---"
kubectl get pods -A --no-headers | awk '$5 > 0 {print "  "$1, $2, "restarts="$5}'
result=$?
if [ $result -eq 0 ]; then echo "  (none)"; fi
```

---

## 11. Bảng tham chiếu nhanh

### DaemonSets (chạy trên mỗi node)

| Component | Namespace | Câu lệnh log nhanh |
|-----------|-----------|---------------------|
| CloudWatch Agent | `amazon-cloudwatch` | `kubectl logs ds/cloudwatch-agent -n amazon-cloudwatch --since=5m` |
| Fluent Bit | `amazon-cloudwatch` | `kubectl logs ds/fluent-bit -n amazon-cloudwatch --since=5m` |
| GuardDuty Agent | `amazon-guardduty` | `kubectl logs ds/aws-guardduty-agent -n amazon-guardduty --since=5m` |
| VPC CNI (aws-node) | `kube-system` | `kubectl logs ds/aws-node -n kube-system -c aws-node --since=5m` |
| kube-proxy | `kube-system` | `kubectl logs ds/kube-proxy -n kube-system --since=5m` |

### Deployments

| Component | Namespace | Câu lệnh log nhanh |
|-----------|-----------|---------------------|
| point-admin | `default` | `kubectl logs deploy/point-admin-deployment --since=5m` |
| point-api | `default` | `kubectl logs deploy/point-api-deployment --since=5m` |
| point-app | `default` | `kubectl logs deploy/point-app-deployment --since=5m` |
| point-mmh | `default` | `kubectl logs deploy/point-mmh-deployment --since=5m` |
| point-worker | `default` | `kubectl logs deploy/point-worker-deployment --since=5m` |
| NFS Provisioner | `default` | `kubectl logs deploy/nfs-subdir-external-provisioner --since=5m` |
| ALB Controller | `kube-system` | `kubectl logs deploy/aws-load-balancer-controller -n kube-system --since=5m` |
| Cluster Autoscaler | `kube-system` | `kubectl logs deploy/cluster-autoscaler -n kube-system --since=5m` |
| CoreDNS | `kube-system` | `kubectl logs deploy/coredns -n kube-system --since=5m` |
| Metrics Server | `kube-system` | `kubectl logs deploy/metrics-server -n kube-system --since=5m` |

> **Viết tắt**: `ds/` = `daemonset/`, `deploy/` = `deployment/`. Cả hai đều hợp lệ.
>
> **Multi-container pods**: `aws-node` có 2 containers (`aws-node` + `aws-eks-nodeagent`). Dùng `-c <container>` để chọn, hoặc `--all-containers` để xem tất cả.

---

## 12. Tips

| Vấn đề | Cách xử lý |
|--------|-----------|
| **Pod bị CrashLoopBackOff** | `kubectl logs <pod> --previous` → xem log container trước khi crash |
| **Pod bị Pending** | `kubectl describe pod <pod>` → xem Events. Thường do thiếu CPU/Memory hoặc node không đủ |
| **ImagePullBackOff** | Check ECR permissions, image tag có tồn tại không |
| **Pod Running nhưng app lỗi** | `kubectl logs` + `kubectl exec` để debug |
| **Xem log nhiều pods cùng lúc** | Dùng label selector: `kubectl logs -l app=point-app --prefix --tail=50` |
| **Tắt hết pods để maintenance** | `kubectl -n default scale deploy --all --replicas=0` → bật lại: `--replicas=2` |
| **Restart không downtime** | `kubectl rollout restart deploy/<name>` → tạo pod mới trước, terminate cũ sau |
| **Node cần maintenance** | `kubectl drain <node> --ignore-daemonsets --delete-emptydir-data` |
| **Xem pod nào trên node nào** | `kubectl get pods -o wide` (cột NODE) |
| **Kiểm tra nhanh cluster** | Copy-paste [script section 10.4](#104-script-kiểm-tra-nhanh-health--errors) |
