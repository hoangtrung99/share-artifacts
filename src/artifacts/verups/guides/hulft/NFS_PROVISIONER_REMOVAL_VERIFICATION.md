# NFS Provisioner Removal — App-side Verification Guide

## Bối cảnh

Pod `nfs-subdir-external-provisioner` trên STG cluster **KHÔNG được sử dụng** bởi HULFT volume.
HULFT dùng static PV/PVC (`storageClassName: manual`), không qua dynamic provisioning.

**Xác nhận bởi:**
- Script diagnostic `check_hulft_nfs.sh` (2026-04-09): 0 PVC dùng `nfs-client`
- Reishi Shuku-san: "the volume mounted by worker is manual created one... I strongly suspect the dynamic provisioner is not been used"
- `kubectl get pvc --all-namespaces`: chỉ có `nfs-hulft-pvc` (class: `manual`)

## Tại sao NFS quan trọng với app?

NFS là cầu nối duy nhất cho batch point transfer giữa Point app và Ponta:

```
User yêu cầu chuyển điểm sang Ponta
  │
  ▼
① API tạo PointTransfer (PROCESSING, uploadStatus=PENDING)
   Lock số dư user (amount + fee)
  │
  ▼
② Upload worker (00:00 JST) → ghi file vào /nfs/hulft/snddata/
  │
  ▼
③ HULFT truyền file → Ponta xử lý → trả kết quả về /nfs/hulft/rcvdata/
  │
  ▼
④ Parse worker (10:05 JST) → đọc file kết quả
   ├─ Thành công → status=COMPLETED, trừ số dư user
   └─ Thất bại → status=FAILED, ghi error code
```

**Nếu NFS mount mất**: giao dịch stuck ở PROCESSING, tiền user bị lock vĩnh viễn.

**Nếu chỉ xóa provisioner pod**: KHÔNG ảnh hưởng. PV/PVC đã Bound, NFS mount hoạt động trực tiếp giữa kubelet và NFS server, không qua provisioner.

---

## Verification Plan

### Trước khi xóa provisioner

#### Check 1: Xác nhận không có PVC dùng dynamic provisioning

```bash
kubectl get pvc --all-namespaces -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name} class={.spec.storageClassName}{"\n"}{end}'
```

**Expected:** Chỉ có `default/nfs-hulft-pvc class=manual`. Không có PVC nào dùng `nfs-client`.

#### Check 2: Xác nhận PV là static (không do provisioner tạo)

```bash
kubectl get pv nfs-hulft-pv -o jsonpath='{.metadata.annotations}'
```

**Expected:** Không có annotation `pv.kubernetes.io/provisioned-by`. Nếu có = PV do provisioner tạo, KHÔNG nên xóa.

#### Check 3: Xác nhận PV/PVC Bound

```bash
kubectl get pv nfs-hulft-pv -o jsonpath='PV status: {.status.phase}{"\n"}'
kubectl get pvc nfs-hulft-pvc -o jsonpath='PVC status: {.status.phase}{"\n"}'
```

**Expected:** Cả hai đều `Bound`.

#### Check 4: Ghi lại baseline — snapshot trạng thái hiện tại

```bash
echo "=== BASELINE SNAPSHOT ==="
echo "Date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo ""
echo "--- PV/PVC ---"
kubectl get pv,pvc
echo ""
echo "--- StorageClass ---"
kubectl get storageclass
echo ""
echo "--- NFS mount in worker ---"
kubectl exec $(kubectl get pods -o name | grep point-worker | head -1 | sed 's|pod/||') -- cat /proc/mounts | grep nfs
echo ""
echo "--- HULFT files ---"
kubectl exec $(kubectl get pods -o name | grep point-worker | head -1 | sed 's|pod/||') -- ls -la /nfs/hulft/snddata/ /nfs/hulft/rcvdata/
echo ""
echo "--- Write test ---"
kubectl exec $(kubectl get pods -o name | grep point-worker | head -1 | sed 's|pod/||') -- sh -c 'echo test > /nfs/hulft/.verify_test && rm /nfs/hulft/.verify_test && echo "Write: OK"'
```

Lưu output này để so sánh sau khi xóa provisioner.

### Xóa provisioner

**Timing khuyến nghị:** Sau khi Upload worker chạy xong (sau 00:30 JST), trước Parse worker chạy (trước 10:00 JST). Như vậy có 1 cycle đầy đủ để verify.

```bash
# Xóa provisioner deployment
helm uninstall nfs-subdir-external-provisioner

# Xóa StorageClass thừa (optional, để dọn sạch)
kubectl delete storageclass nfs-client
```

### Sau khi xóa — Kiểm tra infra (ngay lập tức)

#### Check 5: PV/PVC vẫn Bound

```bash
kubectl get pv nfs-hulft-pv -o jsonpath='PV status: {.status.phase}{"\n"}'
kubectl get pvc nfs-hulft-pvc -o jsonpath='PVC status: {.status.phase}{"\n"}'
```

**Expected:** Vẫn `Bound`. Nếu không → rollback ngay.

#### Check 6: NFS mount vẫn hoạt động trong worker pod

```bash
WORKER=$(kubectl get pods -o name | grep point-worker | head -1 | sed 's|pod/||')

# Kiểm tra mount
kubectl exec $WORKER -- cat /proc/mounts | grep nfs

# Kiểm tra đọc
kubectl exec $WORKER -- ls -la /nfs/hulft/snddata/

# Kiểm tra ghi
kubectl exec $WORKER -- sh -c 'echo test > /nfs/hulft/.verify_test && rm /nfs/hulft/.verify_test && echo "Write: OK"'
```

**Expected:** Giống baseline. Nếu khác → rollback ngay.

### Sau khi xóa — Kiểm tra app (đợi worker chạy)

#### Check 7: Upload worker vẫn ghi file thành công

**Khi nào check:** Sau 00:00 JST (15:00 UTC) ngày tiếp theo.

**CloudWatch Logs Insights** (log group: `/aws/containerinsights/point/application`):

```
fields @timestamp, @message
| filter @message like /pontaGrantPointHulftUpload/ and @message not like /subscribe/
| sort @timestamp desc
| limit 20
```

**Hoặc trên bastion (jq):**

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -d "1 day ago" +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /pontaGrantPointHulftUpload/ and @message not like /subscribe/ | sort @timestamp desc | limit 20' \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"

sleep 10

aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output json \
  | jq -r '.status as $s | .statistics.recordsMatched as $m | "Status: \($s)\nMatched: \($m)", (.results[] | .[1].value | fromjson | .log | fromjson | "\(.["@timestamp"])  [\(.level)]  \(.message)")'
```

**Expected:**

| Log message | Ý nghĩa |
|-------------|---------|
| `----------------- Start ----------------` | Worker bắt đầu |
| `header_length:427` | Header đã ghi |
| `File written successfully` | File ghi thành công |
| `hulft File content: ...` | Nội dung file đã ghi |
| `end` | Worker kết thúc bình thường |

**Red flags (cần rollback):**

| Log message | Ý nghĩa |
|-------------|---------|
| `Read-only file system` | NFS mount mất |
| `Failed to prepare file` | Không tạo được thư mục |
| Không có log nào | Worker không chạy |

#### Check 8: Parse worker vẫn đọc file và xử lý kết quả

**Khi nào check:** Sau 10:05 JST (01:05 UTC).

```
fields @timestamp, @message
| filter @message like /pontaGrantPointHulftParse/ and @message not like /subscribe/
| sort @timestamp desc
| limit 20
```

**Expected:**

| Log message | Ý nghĩa |
|-------------|---------|
| `-----------------Hulft rcvdata Start` | Parse bắt đầu |
| `File exists: true` | File kết quả từ Ponta tồn tại |
| `Hulft data: {...}` | Đang parse từng record |
| `-----------------Hulft Completed` | Parse hoàn tất |

#### Check 9: Giao dịch hoàn thành end-to-end (critical check)

```
fields @timestamp, @message
| filter @message like /transferOperationToPonta/
| sort @timestamp desc
| limit 20
```

**Expected:** Thấy `transferOperationToPontaSuccess` hoặc `transferOperationToPontaSuccess_m` → giao dịch chuyển điểm Ponta vẫn xử lý thành công.

**Đây là check quan trọng nhất** — nếu Parse xử lý kết quả thành công → toàn bộ chain NFS mount → file I/O → business logic đều hoạt động.

#### Check 10: DB — không có giao dịch stuck

```sql
-- Giao dịch stuck (PROCESSING > 2 ngày)
SELECT count(*) as stuck_count
FROM point_transfer
WHERE status = 'PROCESSING'
  AND upload_status IN ('PENDING', 'PROCESSING')
  AND request_time < NOW() - INTERVAL 2 DAY;
```

**Expected:** `0` — không có giao dịch stuck.

```sql
-- Task status mới nhất
SELECT id, task_name, parsing_status, parsing_start_time, parsing_end_time, error_message
FROM point_hulft_task_status
ORDER BY id DESC
LIMIT 5;
```

**Expected:** Record mới nhất có `parsing_status = SUCCESS`.

---

## Rollback

Nếu bất kỳ check nào fail:

```bash
# Cài lại provisioner
helm repo add nfs-subdir-external-provisioner https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner
helm upgrade --install nfs-subdir-external-provisioner nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \
  --set nfs.server="10.51.187.138" \
  --set nfs.path="/mnt/hulft/tmp"
```

Tuy nhiên, nếu PV/PVC vẫn Bound (Check 5) và NFS mount vẫn hoạt động (Check 6) → rollback **không cần thiết** vì provisioner không liên quan đến static PV.

---

## Cleanup sau khi verify thành công

Sau khi tất cả check pass (ít nhất 1 cycle Upload + Parse hoàn thành):

### 1. Xóa StorageClass thừa

```bash
kubectl delete storageclass nfs-client
```

### 2. Cập nhật script `k8s_apply.sh`

Xóa đoạn `helm install nfs-subdir-external-provisioner` trong `k8s-manifests/bin/k8s_apply.sh` để lần deploy sau không cài lại provisioner.

### 3. Cập nhật tài liệu

Ghi lại trong tài liệu rằng provisioner đã bị xóa, ngày xóa, và kết quả verification.

---

## Tóm tắt nhanh

| Bước | Thời điểm | Hành động | Expected |
|------|-----------|-----------|----------|
| Pre-check 1-4 | Trước khi xóa | Xác nhận PV static, PVC Bound, 0 dynamic PVC | Tất cả pass |
| Xóa provisioner | Sau 00:30 JST | `helm uninstall` | Pod removed |
| Post-check 5-6 | Ngay sau xóa | PV/PVC Bound, NFS mount OK | Giống baseline |
| **App check 7** | **Sau 00:00 JST** | CloudWatch: Upload log | `File written successfully` |
| **App check 8** | **Sau 10:05 JST** | CloudWatch: Parse log | `Hulft Completed` |
| **App check 9** | **Sau 10:05 JST** | CloudWatch: transfer result | `transferOperationToPontaSuccess` |
| App check 10 | Bất kỳ lúc nào | DB query stuck transfers | 0 stuck |
| Cleanup | Sau verify OK | Xóa StorageClass, update script | Clean state |

**Critical path**: Check 9 là đủ — nếu `transferOperationToPontaSuccess` xuất hiện sau khi xóa provisioner → ứng dụng hoạt động hoàn toàn bình thường.
