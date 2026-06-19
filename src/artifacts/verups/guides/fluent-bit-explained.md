# Fluent Bit trong dự án Verup (BSE-CB)

## Tổng quan

Fluent Bit là một **log processor/forwarder** siêu nhẹ, được deploy dưới dạng **DaemonSet** trên mỗi EKS node trong namespace `amazon-cloudwatch`. Nhiệm vụ chính: thu thập **tất cả log** từ node và container, làm giàu metadata, rồi đẩy lên **CloudWatch Logs**.

## Fluent Bit vs CloudWatch Agent — Phân chia nhiệm vụ

Trong dự án này, **cả hai đều chạy song song** trên cùng namespace `amazon-cloudwatch`, nhưng làm việc hoàn toàn khác nhau:

| Tiêu chí | Fluent Bit | CloudWatch Agent |
|----------|-----------|-----------------|
| **Nhiệm vụ** | Thu thập và forward **logs** | Thu thập **metrics** (CPU, memory, network) |
| **Output** | CloudWatch **Logs** | CloudWatch **Metrics** |
| **Dữ liệu** | Container logs, systemd journal, OS logs | Kubernetes resource metrics |
| **Image** | `aws-for-fluent-bit:stable` | `cloudwatch-agent:1.300061.0b1289` |
| **Tài nguyên** | CPU 500m, Memory 100-200Mi | Tương đương |
| **Cơ chế** | Tail files + systemd input | Kubernetes metrics API |

**Tóm lại**: Fluent Bit = **mắt đọc log**, CloudWatch Agent = **mắt đọc metrics**. Không thay thế nhau.

## Kiến trúc hoạt động

### 1. Thu thập (Input)

Fluent Bit đọc log từ **3 nguồn chính**, chia thành 3 pipeline riêng biệt:

#### Pipeline Application (`application-log.conf`)
- **Nguồn**: `/var/log/containers/*.log` — tất cả container logs
- **Loại trừ**: `fluent-bit*`, `cloudwatch-agent*`, `aws-node*`, `kube-proxy*` (có pipeline riêng)
- **Buffer**: 50MB, lưu filesystem (chống mất log khi restart)
- **State DB**: `flb_container.db` (SQLite — ghi nhớ vị trí đọc cuối cùng)

#### Pipeline Dataplane (`dataplane-log.conf`)
- **Nguồn 1**: Systemd journal — `docker.service`, `containerd.service`, `kubelet.service`
- **Nguồn 2**: Container logs của `aws-node*`, `kube-proxy*` (CNI và network proxy)
- **Mục đích**: Theo dõi sức khỏe hạ tầng Kubernetes

#### Pipeline Host (`host-log.conf`)
- **Nguồn**: `/var/log/dmesg` (kernel), `/var/log/messages` (syslog), `/var/log/secure` (auth)
- **Mục đích**: Giám sát OS-level — kernel panic, SSH login, security events

### 2. Xử lý (Filter)

- **Kubernetes metadata enrichment**: Gắn thêm pod name, namespace, container name vào mỗi log entry
- **JSON merge**: Parse JSON trong log message, merge vào field `log_processed`
- **AWS IMDSv2 metadata**: Gắn thêm EC2 instance info (cho dataplane & host logs)
- **Field normalization**: Rename systemd fields (`_HOSTNAME` → `hostname`, `MESSAGE` → `message`)

### 3. Đẩy ra (Output)

Tất cả đều đổ về **CloudWatch Logs** với 3 log groups:

| Log Group | Nội dung | Log Stream |
|-----------|---------|------------|
| `/aws/containerinsights/point/application` | App container logs | `{hostname}-` prefix |
| `/aws/containerinsights/point/dataplane` | Kubelet, CNI, kube-proxy | `{hostname}-` prefix |
| `/aws/containerinsights/point/host` | OS logs (dmesg, syslog, auth) | `{hostname}.` prefix |

- `auto_create_group: true` — tự tạo log group nếu chưa có
- `Flush: 5` giây — batch gửi mỗi 5 giây
- `Grace: 30` giây — thời gian chờ flush hết trước khi shutdown

## IAM & Security

### Hiện tại (main branch)
- `CloudWatchAgentServerPolicy` gắn trực tiếp vào **worker node role**
- **Vấn đề**: Mọi pod trên node đều có quyền ghi CloudWatch (quá rộng)

### Đang migrate (BB-1733)
- Chuyển sang **IRSA** (IAM Roles for Service Accounts)
- IAM role `point-fluent-bit-irsa-role` chỉ trust `serviceaccount:amazon-cloudwatch:fluent-bit`
- **Lợi ích**: Least privilege — chỉ Fluent Bit pod mới có quyền ghi log

## Cấu hình quan trọng

```
Cluster name:  point
Region:        ap-northeast-1
Metrics HTTP:  port 2020 (health check & Prometheus scrape)
hostNetwork:   true (cần để đọc node-level logs)
Read mode:     tail (đọc từ cuối file, không replay lịch sử)
```

## Environments

| Env | Manifest path | IRSA Account |
|-----|--------------|--------------|
| dev-ex | `k8s-manifests/point/dev-ex/amazon-cloudwatch/fluent-bit.yaml` | `845131030484` |
| stg-ex | `k8s-manifests/point/stg-ex/amazon-cloudwatch/fluent-bit.yaml` | `520411743393` |

## Tại sao dùng Fluent Bit thay vì CloudWatch Agent cho logs?

1. **Nhẹ hơn nhiều** — Fluent Bit viết bằng C, memory footprint ~15MB vs CloudWatch Agent ~200MB+
2. **Linh hoạt hơn** — hỗ trợ 70+ input/output plugins, dễ mở rộng sang S3, Elasticsearch, Datadog...
3. **Multiline parsing** — xử lý Java stack traces, Docker JSON logs tốt hơn
4. **AWS Container Insights tiêu chuẩn** — đây là stack logging chính thức AWS khuyến nghị cho EKS
5. **Kubernetes-native** — tự động enrich metadata từ Kubernetes API

## Luồng dữ liệu tổng quan

```
┌─────────────────────────────────────────────────────────┐
│                    EKS Node                              │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ point-api│  │point-app │  │ point-   │  ... pods     │
│  │          │  │          │  │ worker   │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │              │              │                    │
│       ▼              ▼              ▼                    │
│  /var/log/containers/*.log                               │
│       │                                                  │
│  ┌────┴──────────────────────────────────┐              │
│  │         Fluent Bit DaemonSet          │              │
│  │  ┌─────────┐ ┌────────┐ ┌─────────┐  │              │
│  │  │  Tail   │ │Systemd │ │  Tail   │  │              │
│  │  │(app log)│ │(journal)│ │(OS log) │  │              │
│  │  └────┬────┘ └───┬────┘ └────┬────┘  │              │
│  │       │          │           │        │              │
│  │  ┌────▼──────────▼───────────▼────┐   │              │
│  │  │  Filters: K8s metadata, AWS,   │   │              │
│  │  │  JSON parse, field normalize   │   │              │
│  │  └────────────────┬───────────────┘   │              │
│  └───────────────────┼───────────────────┘              │
│                      │                                   │
└──────────────────────┼───────────────────────────────────┘
                       │
                       ▼
              CloudWatch Logs
    ┌──────────────────────────────────┐
    │ /aws/containerinsights/point/    │
    │   ├── application                │
    │   ├── dataplane                  │
    │   └── host                       │
    └──────────────────────────────────┘
```
