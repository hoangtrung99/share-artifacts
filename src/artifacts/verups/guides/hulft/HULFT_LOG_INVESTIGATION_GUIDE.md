# Hướng dẫn điều tra HULFT Logs trên CloudWatch

## Tổng quan

Hệ thống Ponta Grant Point sử dụng **HULFT** để truyền file batch với Ponta (Loyalty Marketing).
Có 2 worker liên quan:

| Worker | Chức năng | Schedule (ước tính) |
|--------|-----------|---------------------|
| `PontaGrantPointHulftUpload` | Tạo file gửi yêu cầu cấp điểm Ponta | ~15:00 UTC (00:00 JST) |
| `PontaGrantPointHulftParse` | Đọc file kết quả trả về từ Ponta | ~01:05 UTC (10:05 JST) |

### File paths trên pod

| Loại | Path | Tên file |
|------|------|----------|
| File gửi (上り) | `/nfs/hulft/snddata/` | `LPFT0007_106242_000010` |
| File nhận (下り) | `/nfs/hulft/rcvdata/` | `LPFT0008_000010_106242` |

### Thông tin CloudWatch

| Env | AWS Account | Log Group | Profile (CLI) |
|-----|-------------|-----------|---------------|
| DEV | `845131030484` | `/aws/containerinsights/point/application` | `bs-point-dev` |
| STG | `520411743393` | `/aws/containerinsights/point/application` | `bs-point-stg` |

---

## Kiến thức nền: HULFT, NFS và Kubernetes Storage

### HULFT là gì?

**HULFT** (Huge fiLe Transfer) là phần mềm truyền file enterprise phổ biến tại Nhật Bản, đặc biệt trong ngành tài chính và loyalty.
Thay vì gọi API real-time, các giao dịch được gom lại thành file batch rồi truyền qua HULFT. Đây là pattern chuẩn B2B tại Nhật.

Trong dự án Point, luồng HULFT hoạt động như sau:

```
Point System                              Ponta (Loyalty Marketing)
┌──────────────────┐                     ┌──────────────────┐
│ Upload worker    │                     │                  │
│ tạo file batch   │──── HULFT ────────►│ Xử lý cấp điểm  │
│ (gửi yêu cầu    │     truyền file     │                  │
│  cấp điểm Ponta) │                     │                  │
│                  │                     │                  │
│ Parse worker     │◄─── HULFT ─────────│ Trả kết quả      │
│ đọc kết quả      │     truyền file     │ (thành công/lỗi) │
└──────────────────┘                     └──────────────────┘
```

File batch dùng format **fixed-width** (mỗi dòng 426 bytes), encoding **Shift_JIS**, gồm header + body (N records) + footer.

### NFS là gì?

**NFS** (Network File System) là giao thức chia sẻ file qua mạng. Nhiều máy (hoặc nhiều pod) có thể mount cùng một thư mục NFS và đọc/ghi file giống như ổ đĩa local.

Trong dự án Point:
- **NFS Server** (`10.51.187.138`) nằm ở **Peer VPC** (account `471112755246`) — đây là phía HULFT/Ponta infrastructure
- **Point worker pod** mount NFS share vào path `/nfs/hulft/`
- Worker ghi file gửi vào `snddata/`, HULFT daemon phía peer pick up file rồi truyền đến Ponta
- Ponta xử lý xong, HULFT daemon drop file kết quả vào `rcvdata/`, worker đọc và parse

```
Peer VPC (10.51.1.0/24)              Point STG VPC (172.19.0.0/16)
┌───────────────────────┐            ┌───────────────────────────────┐
│ NFS Server            │            │ point-worker pod              │
│ 10.51.187.138         │◄──NFS────►│   /nfs/hulft/                 │
│ /mnt/hulft/tmp/       │  (NFS v4) │     ├─ snddata/ (ghi file)   │
│   ├─ snddata/         │            │     ├─ rcvdata/ (đọc file)   │
│   ├─ rcvdata/         │            │     └─ log/                  │
│   └─ log/             │            │                               │
│                       │            │                               │
│ HULFT Daemon          │            │                               │
│ (truyền file ↔ Ponta) │            │                               │
└───────────────────────┘            └───────────────────────────────┘
         ↕ VPC Peering (pcx-0ce5c02bb35a7bd32 / to_point_stg)
```

### Kubernetes Storage: PV, PVC và StorageClass

Kubernetes không để pod mount storage trực tiếp. Thay vào đó, dùng 3 lớp trừu tượng:

#### PersistentVolume (PV) — "Ổ đĩa"

PV khai báo **một ổ storage tồn tại** (NFS share, EBS volume, EFS...). Đây là tài nguyên **cluster-level**, do admin tạo.

Trong dự án Point, file `aws-nfs-pv.yaml` khai báo:

```yaml
kind: PersistentVolume
metadata:
  name: nfs-hulft-pv
spec:
  capacity:
    storage: 30Gi                        # Dung lượng
  accessModes:
    - ReadWriteMany                      # Nhiều pod đọc/ghi cùng lúc
  persistentVolumeReclaimPolicy: Retain  # Giữ data khi PVC bị xóa (quan trọng!)
  storageClassName: manual               # ← Tạo thủ công, không qua provisioner
  nfs:
    server: 10.51.187.138               # NFS server IP (Peer VPC)
    path: /mnt/hulft/tmp                 # Thư mục trên NFS server
```

#### PersistentVolumeClaim (PVC) — "Đơn xin sử dụng ổ đĩa"

PVC là yêu cầu từ phía ứng dụng: "tôi cần X GB storage, loại Y". K8s tự tìm PV phù hợp để bind.

File `aws-nfs-pvc.yaml`:

```yaml
kind: PersistentVolumeClaim
metadata:
  name: nfs-hulft-pvc
spec:
  accessModes:
    - ReadWriteMany
  storageClassName: manual    # Match với PV ở trên
  resources:
    requests:
      storage: 30Gi           # Match với PV capacity
```

#### Deployment — Mount vào Pod

File `worker/deployment.yaml` reference PVC:

```yaml
# Trong container spec:
volumeMounts:
  - name: nfs-storage
    mountPath: /nfs/hulft        # Path trong container
# Trong pod spec:
volumes:
  - name: nfs-storage
    persistentVolumeClaim:
      claimName: nfs-hulft-pvc   # Reference PVC
```

#### Mối quan hệ 3 lớp

```
aws-nfs-pv.yaml          aws-nfs-pvc.yaml         worker/deployment.yaml
┌──────────────┐         ┌──────────────┐         ┌──────────────────────┐
│ PV           │  bind   │ PVC          │  mount  │ Pod                  │
│ nfs-hulft-pv │◄───────►│ nfs-hulft-pvc│◄────────│   mountPath:         │
│              │         │              │         │   /nfs/hulft         │
│ storageClass:│         │ storageClass:│         │                      │
│   manual     │         │   manual     │         │ Upload ghi snddata/  │
│              │         │              │         │ Parse đọc rcvdata/   │
└──────────────┘         └──────────────┘         └──────────────────────┘
  "Ổ đĩa tồn tại"        "Tôi cần ổ đĩa"         "Mount vào container"
  (admin tạo)             (app yêu cầu)            (pod sử dụng)
```

Tại sao tách thành 3 lớp?
- **Separation of concerns**: Admin biết infra (IP, path) → tạo PV. Developer chỉ cần biết "tôi cần 30Gi ReadWriteMany" → tạo PVC. Pod chỉ cần biết mount path.
- **Portability**: Khi chuyển env (STG → PRD), chỉ cần thay PV (trỏ đến NFS server khác), PVC và Deployment giữ nguyên.

### Static Provisioning vs Dynamic Provisioning

Có 2 cách tạo PV trong Kubernetes:

#### Static Provisioning (đang dùng cho HULFT)

Admin **tạo PV bằng tay** trước, khai báo rõ NFS server IP, path. PVC bind với PV có sẵn.

```
Admin tạo PV ──→ PVC bind ──→ Pod mount
  (aws-nfs-pv.yaml)
  storageClassName: manual
```

**Ưu điểm:** Kiểm soát chặt, biết chính xác storage nằm đâu.
**Nhược điểm:** Mỗi lần cần volume mới phải tạo PV thủ công.

#### Dynamic Provisioning (nfs-subdir-external-provisioner)

Provisioner **tự động tạo PV** khi có PVC mới. Admin chỉ cần deploy provisioner và khai báo StorageClass.

```
PVC được tạo ──→ Provisioner thấy ──→ Tự động tạo PV ──→ Bind ──→ Pod mount
  storageClassName: nfs-client
```

**Ưu điểm:** Không cần tạo PV thủ công, tự scale.
**Nhược điểm:** Ít kiểm soát hơn, phụ thuộc vào provisioner pod.

### Pod `nfs-subdir-external-provisioner` — Có cần không?

`nfs-subdir-external-provisioner` là open-source controller ([github.com/kubernetes-sigs/nfs-subdir-external-provisioner](https://github.com/kubernetes-sigs/nfs-subdir-external-provisioner)). Nó watch PVC có `storageClassName: nfs-client` rồi tự tạo thư mục con trên NFS server và bind PV.

**Trên STG cluster hiện tại:**

| Kiểm tra | Kết quả |
|---|---|
| StorageClass `nfs-client` tồn tại? | Có (provisioner đã đăng ký) |
| Có PVC nào dùng `nfs-client`? | **Không** — chỉ có `nfs-hulft-pvc` dùng `manual` |
| HULFT volume có dùng provisioner? | **Không** — dùng static PV |

**Kết luận (đã xác nhận bởi Reishi-san + script kiểm tra):**

- Pod `nfs-subdir-external-provisioner` **KHÔNG được sử dụng** bởi HULFT volume
- Không có PVC nào trên cluster dùng dynamic provisioning
- Pod này có thể xóa an toàn nếu không có kế hoạch dùng dynamic NFS trong tương lai
- HULFT volume hoạt động hoàn toàn bằng static PV/PVC (`storageClassName: manual`)

### So sánh DEV vs STG

| | DEV | STG |
|---|---|---|
| `aws-nfs-pv.yaml` | Không có | Có (trỏ đến `10.51.187.138`) |
| `aws-nfs-pvc.yaml` | Không có | Có |
| Volume mount trong deployment | Không có | Có (`/nfs/hulft`) |
| NFS provisioner pod | Không có | Có (nhưng không dùng) |
| VPC Peering đến HULFT | Không có | Có (`pcx-0ce5c02bb35a7bd32`) |
| Kết quả ghi file | `Read-only file system` | `File written successfully` |
| Kết quả đọc file | `File does not exist` | Đọc được (487KB response) |

DEV không có NFS infrastructure → worker chạy nhưng fail gracefully. Đây là bình thường vì DEV không kết nối với Ponta.

---

## Phần 1: Điều tra bằng CloudWatch Console

### 1.1 Truy cập CloudWatch Logs Insights

1. Đăng nhập AWS Console đúng account (DEV hoặc STG)
2. Chọn region **Tokyo (ap-northeast-1)**
3. Tìm dịch vụ **CloudWatch** → sidebar trái chọn **Logs** → **Logs Insights**
4. Ở dropdown **Select log group(s)**, chọn:
   ```
   /aws/containerinsights/point/application
   ```
5. Chọn khoảng thời gian ở góc trên phải (ví dụ: "Last 7 days" hoặc custom range)
6. Nhập query vào ô editor → nhấn **Run query**

### 1.2 Các query hữu ích

#### Query 1: Xem toàn bộ log Upload (gửi file)

```
fields @timestamp, @message
| filter @message like /pontaGrantPointHulftUpload/
  and @message not like /subscribe/
| sort @timestamp desc
| limit 100
```

**Mục đích:** Xem tất cả log liên quan đến worker Upload, loại bỏ log subscribe SQS (chỉ là log đăng ký queue, không phải thực thi).

#### Query 2: Xem toàn bộ log Parse (nhận file)

```
fields @timestamp, @message
| filter @message like /pontaGrantPointHulftParse/
  and @message not like /subscribe/
| sort @timestamp desc
| limit 100
```

#### Query 3: Xem nội dung file đã gửi đi

```
fields @timestamp, @message
| filter @message like /hulft File content/
| sort @timestamp desc
| limit 20
```

**Mục đích:** Worker Upload log toàn bộ nội dung file sau khi ghi xong. Nếu có kết quả → file đã được tạo thành công.

#### Query 4: Xem kết quả parse từng record (file nhận về)

```
fields @timestamp, @message
| filter @message like /Hulft data/
| sort @timestamp desc
| limit 50
```

**Mục đích:** Worker Parse log từng record đã parse dưới dạng JSON. Bao gồm trạng thái xử lý (thành công/thất bại) cho mỗi giao dịch.

#### Query 5: Theo dõi 1 session Upload đầy đủ (header → body → footer)

```
fields @timestamp, @message
| filter @message like /pontaGrantPointHulftUpload/
  and @message not like /subscribe/
| filter @message like /Start|header_length|tradeNumber|requestData|footer_length|hulft File content|Failed|error/
| sort @timestamp asc
| limit 100
```

#### Query 6: Theo dõi 1 session Parse đầy đủ

```
fields @timestamp, @message
| filter @message like /pontaGrantPointHulftParse/
  and @message not like /subscribe/
| filter @message like /rcvdata Start|File exists|header:|detail:|Hulft data|Completed|Failed|error/
| sort @timestamp asc
| limit 100
```

#### Query 7: Chỉ xem lỗi HULFT

```
fields @timestamp, @message
| filter @message like /pontaGrantPointHulft/
| filter @message like /error|ERROR|failed|FAILED|exception/
| sort @timestamp desc
| limit 50
```

#### Query 8: Xem kết quả thành công/thất bại của từng giao dịch

```
fields @timestamp, @message
| filter @message like /transferOperationToPonta/
| sort @timestamp desc
| limit 50
```

**Mục đích:** Sau khi Parse xong, service cập nhật trạng thái giao dịch. Keyword:
- `transferOperationToPontaSuccess` → giao dịch thành công (batch only, type B)
- `transferOperationToPontaSuccess_m` → giao dịch thành công (real + batch matched, type M)
- `transferOperationToPontaFailed` → giao dịch thất bại

### 1.3 Đọc kết quả trên Console

Kết quả hiển thị dưới dạng bảng. Click vào mỗi row để mở chi tiết. Cấu trúc log:

```json
{
  "time": "2026-04-07T20:32:19.481Z",
  "log_processed": {
    "@timestamp": "2026-04-07T20:32:19.481Z",
    "message": "nội dung log chính ở đây",
    "logger_name": "point.worker.worker.PontaGrantPointHulftUpload",
    "level": "INFO",
    "worker": "pontaGrantPointHulftUpload",
    "workerSession": "dev-pontaGrantPointHulftUpload-1775593939479"
  },
  "kubernetes": {
    "pod_name": "point-worker-deployment-xxx",
    "namespace_name": "default"
  }
}
```

**Các field quan trọng:**
- `log_processed.message` — nội dung log chính
- `log_processed.worker` — tên worker
- `log_processed.workerSession` — session ID (dùng để group logs cùng 1 lần chạy)
- `log_processed.level` — mức log (INFO / ERROR / WARN)

### 1.4 Tips sử dụng Console

- **Export kết quả**: Nhấn nút **Export results** → chọn CSV hoặc clipboard
- **Save query**: Nhấn **Save** để lưu query hay dùng, đặt tên ví dụ "HULFT Upload Logs"
- **Time range**: Dùng **Custom** time range khi biết chính xác thời điểm cần tra
- **Visualize**: Tab **Visualization** hiển thị biểu đồ số lượng log theo thời gian — hữu ích để xem pattern chạy schedule

---

## Phần 2: Điều tra bằng AWS CLI

### 2.1 Cú pháp chung

```bash
# Bước 1: Gửi query
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time <epoch_start> \
  --end-time <epoch_end> \
  --query-string '<query>' \
  --profile <profile> \
  --region ap-northeast-1 \
  --output text --query 'queryId')

# Bước 2: Đợi query xong rồi lấy kết quả
sleep 10
aws logs get-query-results --query-id "$QUERY_ID" \
  --profile <profile> \
  --region ap-northeast-1
```

**Tính epoch time:**

| Mục đích | macOS | Linux (bastion) |
|----------|-------|-----------------|
| 7 ngày trước | `date -v-7d +%s` | `date -d "7 days ago" +%s` |
| 30 ngày trước | `date -v-30d +%s` | `date -d "30 days ago" +%s` |
| Hiện tại | `date +%s` | `date +%s` |
| Thời điểm cụ thể | `date -j -f "%Y-%m-%dT%H:%M:%S" "2026-04-07T00:00:00" +%s` | `date -d "2026-04-07T00:00:00" +%s` |

**Lưu ý khi chạy trên bastion (SSM):**
- **KHÔNG cần `--profile`** — instance đã có IAM role, bỏ `--profile` đi
- Dùng cú pháp `date -d` thay vì `date -v`
- **KHÔNG dùng inline Python multi-line** — SSM terminal thêm space đầu dòng gây `IndentationError`. Dùng script file thay thế (xem mục 2.2)

### 2.2 Parser kết quả

Có 2 cách parse kết quả CloudWatch. Dùng cách phù hợp với môi trường.

#### Cách A: jq (khuyến nghị cho bastion/SSM)

`jq` không bị lỗi indentation trên SSM. Dùng lệnh sau sau mỗi `start-query`:

```bash
aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output json \
  | jq -r '.status as $s | .statistics.recordsMatched as $m | "Status: \($s)\nMatched: \($m)", (.results[] | .[1].value | fromjson | .log | fromjson | "\(.["@timestamp"])  [\(.level)]  \(.message)")'
```

Nếu bastion chưa có `jq`, cài bằng: `sudo yum install -y jq` (Amazon Linux) hoặc `sudo apt install -y jq` (Ubuntu).

#### Cách B: Python script file (thay thế nếu không có jq)

Tạo script 1 lần:

```bash
cat > /tmp/parse_cw.py << 'PYEOF'
import sys, json
resp = json.load(sys.stdin)
print('Status:', resp.get('status'))
print('Matched:', resp.get('statistics',{}).get('recordsMatched'))
print('---')
for row in resp.get('results', []):
    for field in row:
        if field['field'] == '@message':
            try:
                outer = json.loads(field['value'])
                inner = json.loads(outer.get('log','{}'))
                ts = inner.get('@timestamp','?')
                msg = inner.get('message','?')
                lvl = inner.get('level','?')
                print(f'{ts}  [{lvl}]  {msg[:250]}')
            except:
                print(field['value'][:250])
PYEOF
```

Dùng lại cho mọi query:

```bash
aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output json \
  | jq -r '.status as $s | .statistics.recordsMatched as $m | "Status: \($s)\nMatched: \($m)", (.results[] | .[1].value | fromjson | .log | fromjson | "\(.["@timestamp"])  [\(.level)]  \(.message)")'
```

**Lưu ý:** KHÔNG dùng inline `python3 -c "..."` multi-line trên SSM — terminal sẽ thêm space gây `IndentationError`.

### 2.3 Các lệnh sẵn dùng

Có 2 biến thể cho mỗi lệnh: **macOS (local)** và **Linux (bastion/SSM)**.
Sự khác biệt chỉ ở `date` syntax và `--profile`.

#### Upload worker — 7 ngày gần đây

**macOS (local):** thay `$PROFILE` bằng `bs-point-dev` hoặc `bs-point-stg`

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -v-7d +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /pontaGrantPointHulftUpload/ and @message not like /subscribe/ | sort @timestamp desc | limit 50' \
  --profile $PROFILE \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"
```

**Linux (bastion/SSM):** không cần `--profile`

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -d "7 days ago" +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /pontaGrantPointHulftUpload/ and @message not like /subscribe/ | sort @timestamp desc | limit 50' \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"
```

**Lấy kết quả (chung cho cả 2):**

```bash
sleep 10
aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output json \
  | jq -r '.status as $s | .statistics.recordsMatched as $m | "Status: \($s)\nMatched: \($m)", (.results[] | .[1].value | fromjson | .log | fromjson | "\(.["@timestamp"])  [\(.level)]  \(.message)")'
```

Trên macOS nếu chưa tạo `/tmp/parse_cw.py`, thêm `--profile $PROFILE` và pipe qua inline python:

```bash
aws logs get-query-results --query-id "$QUERY_ID" --profile $PROFILE --region ap-northeast-1 --output json | python3 -c "
import sys, json
resp = json.load(sys.stdin)
print('Status:', resp.get('status'))
print('Matched:', resp.get('statistics',{}).get('recordsMatched'))
for row in resp.get('results', []):
    for field in row:
        if field['field'] == '@message':
            try:
                outer = json.loads(field['value'])
                inner = json.loads(outer.get('log','{}'))
                print(inner.get('@timestamp','?') + '  [' + inner.get('level','?') + ']  ' + inner.get('message','?')[:250])
            except:
                print(field['value'][:250])
"
```

#### Parse worker — 7 ngày gần đây

**macOS (local):**

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -v-7d +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /pontaGrantPointHulftParse/ and @message not like /subscribe/ | sort @timestamp desc | limit 50' \
  --profile $PROFILE \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"
```

**Linux (bastion/SSM):**

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -d "7 days ago" +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /pontaGrantPointHulftParse/ and @message not like /subscribe/ | sort @timestamp desc | limit 50' \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"
```

**Lấy kết quả:** (giống Upload — dùng `parse_cw.py` hoặc inline python)

```bash
sleep 10
aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output json \
  | jq -r '.status as $s | .statistics.recordsMatched as $m | "Status: \($s)\nMatched: \($m)", (.results[] | .[1].value | fromjson | .log | fromjson | "\(.["@timestamp"])  [\(.level)]  \(.message)")'
```

#### Nội dung file đã gửi — 30 ngày

**macOS (local):**

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -v-30d +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /hulft File content/ | sort @timestamp desc | limit 10' \
  --profile $PROFILE \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"
```

**Linux (bastion/SSM):**

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -d "30 days ago" +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /hulft File content/ | sort @timestamp desc | limit 10' \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"
```

**Lấy kết quả:**

```bash
sleep 15
aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output json \
  | jq -r '.status as $s | .statistics.recordsMatched as $m | "Status: \($s)\nMatched: \($m)", (.results[] | .[1].value | fromjson | .log | fromjson | "\(.["@timestamp"])  [\(.level)]  \(.message)")'
```

#### Chỉ xem lỗi HULFT

**macOS (local):**

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -v-7d +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /pontaGrantPointHulft/ | filter @message like /error|ERROR|failed|FAILED|exception/ | sort @timestamp desc | limit 50' \
  --profile $PROFILE \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"
```

**Linux (bastion/SSM):**

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -d "7 days ago" +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /pontaGrantPointHulft/ | filter @message like /error|ERROR|failed|FAILED|exception/ | sort @timestamp desc | limit 50' \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"
```

**Lấy kết quả:**

```bash
sleep 10
aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output json \
  | jq -r '.status as $s | .statistics.recordsMatched as $m | "Status: \($s)\nMatched: \($m)", (.results[] | .[1].value | fromjson | .log | fromjson | "\(.["@timestamp"])  [\(.level)]  \(.message)")'
```

### 2.4 Xử lý khi query chưa xong

Nếu `Status: Running`, đợi thêm rồi lấy lại kết quả:

```bash
# Kiểm tra status
aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output text --query 'status'

# Nếu vẫn Running, đợi thêm rồi lấy kết quả
sleep 10
aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output json \
  | jq -r '.status as $s | .statistics.recordsMatched as $m | "Status: \($s)\nMatched: \($m)", (.results[] | .[1].value | fromjson | .log | fromjson | "\(.["@timestamp"])  [\(.level)]  \(.message)")'
```

Thời gian scan phụ thuộc vào lượng log — range 7 ngày thường mất 5-10 giây, 30-90 ngày có thể mất 15-30 giây.

Trên macOS thêm `--profile $PROFILE` vào mỗi lệnh `aws`.

---

## Phần 3: Checklist điều tra

### Khi Upload không hoạt động

1. [ ] Kiểm tra worker có chạy không → Query 1 (xem có log `Start`)
2. [ ] Kiểm tra NFS mount → Tìm log `Failed to prepare file directory`
3. [ ] Kiểm tra task trước đó → Tìm log `Previous task not completed successfully`
4. [ ] Kiểm tra có data cần gửi không → Tìm log `Failed to fetch transfer list`
5. [ ] Kiểm tra file content → Query 3 (nếu có = ghi file thành công)

### Khi Parse không hoạt động

1. [ ] Kiểm tra worker có chạy không → Query 2 (xem có log `rcvdata Start`)
2. [ ] Kiểm tra file tồn tại → Tìm log `File exists: true/false`
3. [ ] Kiểm tra task status → Tìm log `status is null` hoặc `content is null`
4. [ ] Kiểm tra kết quả parse → Query 4 (xem `Hulft data`)
5. [ ] Kiểm tra xử lý thành công/thất bại → Query 8

### Các lỗi thường gặp

| Log message | Nguyên nhân | Hành động |
|-------------|-------------|-----------|
| `Read-only file system` | NFS mount chưa sẵn sàng hoặc read-only | Kiểm tra NFS PV/PVC trên K8s |
| `File does not exist in path` | Chưa có file kết quả từ Ponta | Kiểm tra HULFT daemon và kết nối với Ponta |
| `Previous task not completed successfully` | Task trước bị FAILED/PENDING | Kiểm tra bảng `ponta_hulft_task_status` trong DB |
| `Failed to fetch transfer list` | Không có giao dịch chờ gửi | Kiểm tra bảng `point_transfer` — có record nào PENDING không |
| `Error occurred while parsing the file` | File kết quả bị lỗi format | Xem chi tiết error message, kiểm tra file content |

---

## Phần 4: Tham khảo nhanh

### Keyword quan trọng để tìm kiếm

| Keyword | Xuất hiện khi |
|---------|---------------|
| `----------------- Start ----------------` | Upload worker bắt đầu |
| `-----------------Hulft rcvdata Start` | Parse worker bắt đầu |
| `hulft File content` | Nội dung file gửi (toàn bộ) |
| `header_length` | Header đã ghi, kèm độ dài |
| `footer_length` | Footer đã ghi, kèm độ dài |
| `tradeNumber` | Mã giao dịch trong body |
| `requestData_content` | Độ dài mỗi record body |
| `Hulft data` | Kết quả parse từng record (JSON) |
| `Hulft Completed` | Parse hoàn tất |
| `transferOperationToPontaSuccess` | Giao dịch thành công |
| `transferOperationToPontaFailed` | Giao dịch thất bại |

### Cấu trúc file HULFT (fixed-width, Shift_JIS)

```
[Header]  IF_ID + "00101" + YYYYMMDD + HHMMSS + record_count(12) + padding  (426 bytes + \n)
[Body]    Mỗi record 1 dòng: ngày, giờ, FROM_CODE, memberId, tradeNumber, amount
[Footer]  IF_ID + "00103" + YYYYMMDD + HHMMSS + padding                     (426 bytes + \n)
```

### Source code tham khảo

| File | Mô tả |
|------|-------|
| `point-worker/.../worker/PontaGrantPointHulftUpload.java` | Worker tạo file gửi |
| `point-worker/.../worker/PontaGrantPointHulftParse.java` | Worker đọc file kết quả |
| `point-worker/.../sqssubscriber/PontaGrantPointUploadSqsSubscriber.java` | SQS trigger cho Upload |
| `point-worker/.../sqssubscriber/PontaGrantPointHulftParseSqsSubscriber.java` | SQS trigger cho Parse |
| `point-worker/src/main/resources/application.yaml` (dòng 196-200) | Config HULFT paths |
| `point-common/.../entity/PontaHulftTaskStatus.java` | Entity quản lý trạng thái task |
| `point-common/.../service/PontaHufltTaskStatusService.java` | Service quản lý task status |
