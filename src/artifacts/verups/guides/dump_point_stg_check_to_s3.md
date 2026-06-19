# Dump `point_stg_check` (bỏ 4 bảng lớn) → S3

> **Ngày tạo**: 2026-04-17
> **Bối cảnh**: Dump toàn bộ `point_stg_check` **trừ 4 bảng lớn nhất**, gzip, upload lên `s3://infra-bucket-stg-ex/tmp-transfer/`, sau đó tải về máy local.
> **Chạy từ**: bastion STG (`point-bastion`, `172.19.21.50`) — vào qua **SSM Session Manager trên AWS Console** (EC2 → Instance → Connect → Session Manager). Bastion dùng instance IAM role → không cần AWS profile.
> **Tham chiếu**: `docs/guides/connect-memo.txt` §15.2, §16.2.
>
> **Quan trọng**: `point_stg_check` **KHÔNG phải default DB** của secret `point/aurora/viewer_user`. Theo memo §15 note: "viewer_user chỉ thấy `point` và `information_schema`. Với DB khác → dùng `master_user`". Tài liệu này dùng **`master_user`**.
>
> **Shell trên SSM Console**: mặc định là `sh` (dash) với user `ssm-user`. Bắt buộc `sudo bash` ngay bước đầu để có bash + có quyền `apt-get`.

---

## 4 bảng loại bỏ

| # | Table | Size on-disk |
| - | ----- | -----------: |
| 1 | `asset_summary` | 21.50 GB |
| 2 | `exchange_and_invest_asset_summary` | 6.59 GB |
| 3 | `asset_summary_bak` | 3.09 GB |
| 4 | `pos_candlestick` | 1.54 GB |

Kỳ vọng dump còn lại: **~4.0 GB on-disk** → SQL dump raw **~2.5-3 GB** → gzip **~400-700 MB**.

---

## Phần A — Setup trên bastion (lần đầu)

Trên AWS Console: EC2 → chọn instance `point-bastion` → `Connect` → tab `Session Manager` → `Connect`.

Sau khi vào terminal web (prompt `sh-5.x$` hoặc `-sh-$`):

```bash
# Switch sang bash + sudo (SSM mặc định là sh, user ssm-user)
sudo bash

# Cài tools cần thiết (pv cho progress bar, pigz cho gzip song song 2 vCPU)
apt-get update -y && apt-get install -y pv pigz tmux jq

# Tạo workdir
mkdir -p /tmp/stg-dump && cd /tmp/stg-dump

# Verify
df -h /tmp                              # free ≥ 5 GB
which mysqldump pigz pv tmux jq aws
```

**Nếu `apt-get install` fail** (không có internet qua Squid proxy, v.v.): xem **Phần E-alt** dùng `gzip` sẵn có.

---

## Phần C — Test connection (verify secret + privilege)

```bash
# Test master_user có đọc được point_stg_check không
SECRET=$(aws secretsmanager get-secret-value \
  --secret-id point/aurora/master_user \
  --query SecretString --output text) && \
mysql \
  -h "$(echo $SECRET | jq -r .host)" \
  -P "$(echo $SECRET | jq -r .port)" \
  -u "$(echo $SECRET | jq -r .username)" \
  -p"$(echo $SECRET | jq -r .password)" \
  point_stg_check \
  -e "SELECT NOW() AS now_utc, @@version AS version, @@hostname AS host, USER() AS whoami, DATABASE() AS db;"
```

Kỳ vọng: `db = point_stg_check`, version `8.0.x`, `whoami` có username master.

---

## Phần D — Verify size trước khi dump

```bash
SECRET=$(aws secretsmanager get-secret-value \
  --secret-id point/aurora/master_user \
  --query SecretString --output text) && \
mysql \
  -h "$(echo $SECRET | jq -r .host)" \
  -P "$(echo $SECRET | jq -r .port)" \
  -u "$(echo $SECRET | jq -r .username)" \
  -p"$(echo $SECRET | jq -r .password)" \
  point_stg_check -t <<'SQL'
SELECT
  COUNT(*)                                                  AS kept_tables,
  ROUND(SUM(data_length)/1024/1024/1024, 2)                 AS on_disk_data_gb,
  ROUND(SUM(index_length)/1024/1024/1024, 2)                AS on_disk_index_gb,
  ROUND(SUM(data_length + index_length)/1024/1024/1024, 2)  AS on_disk_total_gb,
  ROUND(SUM(data_length)/1024/1024/1024, 2)                 AS est_raw_dump_gb
FROM information_schema.tables
WHERE table_schema = 'point_stg_check'
  AND table_name NOT IN (
    'asset_summary',
    'exchange_and_invest_asset_summary',
    'asset_summary_bak',
    'pos_candlestick'
  );
SQL
```

Kỳ vọng: `kept_tables ≈ 206`, `on_disk_total_gb ≈ 4.0-4.2`.

---

## Phần E — Dump + gzip + upload S3 (all-in-one, trong tmux)

> **Lưu ý**:
> - **BỎ** `--set-gtid-purged=OFF` vì bastion dùng `mariadb-client` (MariaDB 10.3.x), không support flag MySQL-only này.
> - **BẮT BUỘC** `bash` + `set -o pipefail` để catch lỗi mysqldump trong pipe (nếu không, gzip empty stream return 0 → upload file rỗng lên S3).
> - Check `$?` + file size sau dump trước khi upload.

```bash
tmux new -s stg-dump
bash                 # đảm bảo bash (không phải dash/sh)
set -o pipefail
cd /tmp/stg-dump

SECRET=$(aws secretsmanager get-secret-value \
  --secret-id point/aurora/master_user \
  --query SecretString --output text) && \
OUTFILE="point_stg_check_$(date -u +%Y%m%dT%H%M%SZ).sql.gz" && \
S3_DEST="s3://infra-bucket-stg-ex/tmp-transfer/${OUTFILE}" && \
mysqldump \
  --single-transaction \
  --quick \
  --hex-blob \
  --skip-lock-tables \
  --no-tablespaces \
  --default-character-set=utf8mb4 \
  --routines --triggers --events \
  --ignore-table=point_stg_check.asset_summary \
  --ignore-table=point_stg_check.exchange_and_invest_asset_summary \
  --ignore-table=point_stg_check.asset_summary_bak \
  --ignore-table=point_stg_check.pos_candlestick \
  -h "$(echo $SECRET | jq -r .host)" \
  -P "$(echo $SECRET | jq -r .port)" \
  -u "$(echo $SECRET | jq -r .username)" \
  -p"$(echo $SECRET | jq -r .password)" \
  point_stg_check \
  2> "${OUTFILE}.err" \
  | pv -b -r -t \
  | pigz -6 -p 2 \
  > "$OUTFILE"

RC=$?
SIZE=$(stat -c%s "$OUTFILE" 2>/dev/null || echo 0)
echo "==> mysqldump exit=$RC, gzip_size=${SIZE} bytes"

if [ "$RC" -ne 0 ] || [ "$SIZE" -lt 10000000 ]; then
  echo "==> FAIL — dump không hợp lệ"
  tail -30 "${OUTFILE}.err"
else
  md5sum "$OUTFILE" | tee "${OUTFILE}.md5" && \
  aws s3 cp "$OUTFILE" "$S3_DEST" --region ap-northeast-1 --storage-class STANDARD_IA && \
  aws s3 cp "${OUTFILE}.md5" "${S3_DEST}.md5" --region ap-northeast-1 && \
  echo "==> Uploaded: $S3_DEST"
fi
```

- **Detach tmux**: `Ctrl-b` → `d` (dump vẫn chạy, tab trình duyệt có thể đóng).
- **Reattach** (mở SSM session mới): `sudo bash && tmux attach -t stg-dump`.
- **Thời gian dự kiến**: 10-20 phút trên `t2.medium`.

> **Lưu ý cho SSM Console**: nếu không dùng `tmux`, khi tab browser đóng hoặc session timeout (~20 phút idle) → dump bị kill. **Bắt buộc dùng tmux** cho dump > 5 phút.

---

## Phần E-alt — Fallback dùng `gzip` sẵn có (không cần cài pv/pigz)

Dùng khi `apt-get install` không chạy được (không có internet, proxy fail, …). Cài sẵn trong mọi Ubuntu.

```bash
bash
set -o pipefail
cd /tmp/stg-dump 2>/dev/null || { mkdir -p /tmp/stg-dump && cd /tmp/stg-dump; }

SECRET=$(aws secretsmanager get-secret-value \
  --secret-id point/aurora/master_user \
  --query SecretString --output text) && \
OUTFILE="point_stg_check_$(date -u +%Y%m%dT%H%M%SZ).sql.gz" && \
S3_DEST="s3://infra-bucket-stg-ex/tmp-transfer/${OUTFILE}" && \
mysqldump \
  --single-transaction \
  --quick \
  --hex-blob \
  --skip-lock-tables \
  --no-tablespaces \
  --default-character-set=utf8mb4 \
  --routines --triggers --events \
  --ignore-table=point_stg_check.asset_summary \
  --ignore-table=point_stg_check.exchange_and_invest_asset_summary \
  --ignore-table=point_stg_check.asset_summary_bak \
  --ignore-table=point_stg_check.pos_candlestick \
  -h "$(echo $SECRET | jq -r .host)" \
  -P "$(echo $SECRET | jq -r .port)" \
  -u "$(echo $SECRET | jq -r .username)" \
  -p"$(echo $SECRET | jq -r .password)" \
  point_stg_check \
  2> "${OUTFILE}.err" \
  | gzip -6 \
  > "$OUTFILE"

RC=$?
SIZE=$(stat -c%s "$OUTFILE" 2>/dev/null || echo 0)
if [ "$RC" -ne 0 ] || [ "$SIZE" -lt 10000000 ]; then
  echo "==> FAIL (exit=$RC, size=$SIZE)"
  tail -30 "${OUTFILE}.err"
else
  md5sum "$OUTFILE" | tee "${OUTFILE}.md5" && \
  aws s3 cp "$OUTFILE" "$S3_DEST" --region ap-northeast-1 --storage-class STANDARD_IA && \
  aws s3 cp "${OUTFILE}.md5" "${S3_DEST}.md5" --region ap-northeast-1 && \
  echo "==> Uploaded: $S3_DEST"
fi
```

Khác biệt so với Phần E:
- Bỏ `pv` (progress bar) — không còn nhìn thấy tốc độ.
- `gzip -6` thay `pigz -6 -p 2` — single-thread → chậm hơn ~1.5-2x trên 2 vCPU.
- **Thời gian dự kiến**: 15-25 phút.
- Vẫn chạy được trong `tmux` bình thường (nếu đã cài).

Xem error log sau khi xong:

```bash
tail -30 "${OUTFILE}.err"
```

---

## Phần F — Verify dump integrity (trên bastion trước khi xoá)

```bash
# Test gzip không corrupt
gunzip -t "$OUTFILE" && echo "gzip OK"

# Peek header
zcat "$OUTFILE" | head -30

# Đếm số CREATE TABLE (kỳ vọng ~206)
zgrep -c '^CREATE TABLE' "$OUTFILE"

# Check dump kết thúc sạch
zcat "$OUTFILE" | tail -5   # phải có "-- Dump completed on ..."
```

---

## Phần G — Download về máy local

### Cách 1 (khuyến nghị): S3 trực tiếp

```bash
# Trên máy local (không phải bastion)
OUTFILE="<điền tên file đúng từ output Phần E>"

aws s3 cp "s3://infra-bucket-stg-ex/tmp-transfer/${OUTFILE}" . \
  --profile cb-exchange-stg --region ap-northeast-1

aws s3 cp "s3://infra-bucket-stg-ex/tmp-transfer/${OUTFILE}.md5" . \
  --profile cb-exchange-stg --region ap-northeast-1

# Verify md5 match
md5sum -c "${OUTFILE}.md5"
```

### Cách 2: List bucket để confirm tên file

```bash
aws s3 ls s3://infra-bucket-stg-ex/tmp-transfer/ \
  --profile cb-exchange-stg --region ap-northeast-1 --human-readable
```

---

## Phần H — Cleanup (quan trọng vì là bucket `tmp-transfer`)

```bash
# Trên bastion: xoá file local
rm -f /tmp/stg-dump/*.sql.gz /tmp/stg-dump/*.sql.gz.md5 /tmp/stg-dump/*.err
tmux kill-session -t stg-dump 2>/dev/null
exit   # thoát sudo
exit   # thoát SSM

# Trên máy local: sau khi verify dump chạy tốt, XOÁ file S3
OUTFILE="<tên file>"
aws s3 rm "s3://infra-bucket-stg-ex/tmp-transfer/${OUTFILE}" \
  --profile cb-exchange-stg --region ap-northeast-1
aws s3 rm "s3://infra-bucket-stg-ex/tmp-transfer/${OUTFILE}.md5" \
  --profile cb-exchange-stg --region ap-northeast-1
```

---

## Troubleshooting

| Lỗi | Nguyên nhân | Xử lý |
| --- | ----------- | ----- |
| `Access denied; you need ... PROCESS privilege` | Thiếu `--no-tablespaces` (đã có trong lệnh) hoặc user không có quyền | Đã có `--no-tablespaces`. Nếu vẫn fail → DBA cấp `PROCESS` cho master_user |
| `Unknown database 'point_stg_check'` | User không thấy DB này | master_user phải thấy. Nếu không, confirm với DBA hoặc thử `SHOW DATABASES` |
| `mysqldump: Got error: 2013: Lost connection` | Network drop giữa chừng | Thêm `--max-allowed-packet=1G` vào lệnh mysqldump; rerun |
| S3 upload fail `AccessDenied` | Bastion IAM thiếu `s3:PutObject` trên bucket | Dùng `aws s3api get-bucket-policy` để check; xin DBA/SRE bổ sung |
| `tmux: command not found` | Chưa cài ở Phần A | `sudo apt-get install -y tmux` |
| Dump quá chậm (>30 phút) | CPU credits t2 cạn | Đổi `pigz -6` thành `pigz -1` (nén ít, nhanh hơn) hoặc tạm tăng instance type |
| `pv: not found` / `pigz: not found` | Lệnh ban đầu chưa `sudo bash` + `apt-get install` | Chạy Phần A trước, hoặc dùng **Phần E-alt** (gzip sẵn có) |
| `-sh: ...: not found` (prompt `-sh` thay vì `$`) | Shell SSM mặc định là dash, chưa `sudo bash` | Chạy `sudo bash` đầu session để chuyển sang bash |
| `mysqldump: unknown variable 'set-gtid-purged=OFF'` | Bastion dùng `mariadb-client` (MariaDB 10.3.x), không support flag MySQL-only | **Bỏ** flag `--set-gtid-purged=OFF` khỏi lệnh (tài liệu đã sửa). MariaDB mysqldump default không emit GTID → restore an toàn |
| File `.sql.gz` chỉ ~20 bytes | mysqldump fail → stdout rỗng → gzip nén empty stream thành 20 bytes + return 0 → chain `&&` vẫn upload | Thêm `set -o pipefail` + check `$?` và `stat -c%s` sau dump trước khi upload (tài liệu đã có). Xoá file rỗng trên S3 bằng `aws s3 rm` |

---

## Notes

- **Không commit credentials** vào git — tài liệu này không chứa credential, chỉ chứa pattern lệnh.
- **Xoá S3 ngay** sau khi tải xong vì `tmp-transfer/` là bucket tạm.
- File output đã bao gồm **timestamp UTC ISO-8601** (`YYYYMMDDTHHMMSSZ`) để không bị trùng khi chạy lại trong ngày.
- Dump **bao gồm** schema + data + routines (2 procedures) + triggers + events + views.
