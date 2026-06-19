# Debug Guide — Glue ETL & Redshift COPY JOB

Hướng dẫn debug pipeline `Aurora → S3 (Parquet) → Redshift` do Terraform component `bs-exchange-infra/terraform/components/glue-etl/` quản lý.

Tất cả SQL queries và column names trong tài liệu này đã được **verify từ AWS docs chính thức** (xem mục [Sources](#sources) ở cuối).

---

## 1. Pipeline tổng quan

```
┌──────────┐   Glue Job     ┌──────────────────┐   S3 Event    ┌───────────────┐   AUTO COPY   ┌──────────────┐
│  Aurora  │ ─────────────► │  S3 staging      │ ────────────► │  Redshift S3  │ ────────────► │  Redshift    │
│  (MySQL) │   daily 02:00  │  (Parquet)       │  Integration  │  Event Intg   │   per object  │  target tbl  │
└──────────┘      JST       │  SSE-KMS         │               │               │               │  public.glue_*│
                            └──────────────────┘               └───────────────┘               └──────────────┘
       (1)                          (2)                              (3)                             (4)
```

Thành phần chính (tên Terraform resource):

| # | Component | Resource |
|---|---|---|
| 1 | Glue Job | `aws_glue_job.table` (per table) |
| 2 | S3 staging bucket | `aws_s3_bucket.staging` |
| 3 | S3 Event Integration | `aws_redshift_integration.s3_event` |
| 4 | COPY JOB | `aws_redshiftdata_statement.copy_job` (per table) |

---

## 2. Quick diagnosis — kẹt ở bước nào?

Chạy lần lượt 3 check dưới để khoanh vùng:

### Check A — Glue Job đã chạy chưa?

```bash
aws glue get-job-runs \
  --job-name "aurora-to-s3-user-dev-ex" \
  --region ap-northeast-1 \
  --max-results 5 \
  --query 'JobRuns[].[Id,JobRunState,StartedOn,CompletedOn,ErrorMessage]' \
  --output table
```

- `JobRunState = SUCCEEDED` → **sang Check B**
- `FAILED` / `TIMEOUT` / `STOPPED` → xem [§4 Glue Job errors](#4-glue-job-errors)

### Check B — Có Parquet trong S3 không?

```bash
aws s3 ls "s3://aurora-to-redshift-staging-bs-point-dev-ex/data/user/" \
  --recursive --region ap-northeast-1 \
  | tail -20
```

- Có file `.parquet` → **sang Check C**
- Rỗng → Glue job báo SUCCEEDED nhưng không ghi gì — xem CloudWatch logs của Glue (§4).

### Check C — Redshift đã COPY chưa?

```sql
SELECT start_time, status, error_count, source_file_count, loaded_rows
FROM   sys_load_history
WHERE  copy_job_id = (SELECT job_id FROM sys_copy_job WHERE job_name = 'user_copy_job')
ORDER BY start_time DESC
LIMIT 5;
```

- Có row `status = 'completed'` với `loaded_rows > 0` → ✅ Pipeline OK
- Có row `status = 'aborted' / 'failed'` → xem [§5 COPY JOB errors](#5-copy-job-errors)
- Rỗng → COPY JOB chưa fire — xem [§6 S3 Event Integration](#6-s3-event-integration-không-fire)

---

## 3. Xem các job đang có / chi tiết 1 job

Phần này trả lời: "có những job nào?" và "config/trạng thái của 1 job cụ thể ra sao?" — thường dùng trước khi debug, hoặc khi cần audit pipeline.

### 3.1 Glue Jobs (AWS CLI)

**List tất cả Glue Job của pipeline này:**

```bash
aws glue list-jobs \
  --region ap-northeast-1 \
  --query "JobNames[?starts_with(@, 'aurora-to-s3-')]" \
  --output table
```

**Xem config của 1 Glue Job:**

```bash
aws glue get-job \
  --job-name "aurora-to-s3-user-dev-ex" \
  --region ap-northeast-1 \
  --query 'Job.{Name:Name,Role:Role,WorkerType:WorkerType,NumberOfWorkers:NumberOfWorkers,Timeout:Timeout,MaxRetries:MaxRetries,BookmarkOption:DefaultArguments."--job-bookmark-option",ScriptLocation:Command.ScriptLocation,GlueVersion:GlueVersion}' \
  --output table
```

**List các lần run gần đây của 1 job:**

```bash
aws glue get-job-runs \
  --job-name "aurora-to-s3-user-dev-ex" \
  --region ap-northeast-1 --max-results 10 \
  --query 'JobRuns[].[Id,JobRunState,StartedOn,CompletedOn,ExecutionTime,ErrorMessage]' \
  --output table
```

`JobRunState` có thể là: `STARTING` / `RUNNING` / `STOPPING` / `STOPPED` / `SUCCEEDED` / `FAILED` / `TIMEOUT` / `ERROR`.

**Xem chi tiết 1 run (argument + connection + bookmark stats):**

```bash
aws glue get-job-run \
  --job-name "aurora-to-s3-user-dev-ex" \
  --run-id "jr_xxxxxxxxxxxx" \
  --region ap-northeast-1
```

**List Glue Triggers (cron schedule 02:00 JST):**

```bash
aws glue list-triggers \
  --region ap-northeast-1 \
  --query "TriggerNames[?contains(@, 'aurora-to-s3')]" \
  --output table

aws glue get-trigger \
  --name "aurora-to-s3-daily-dev-ex" \
  --region ap-northeast-1
```

### 3.2 Redshift COPY JOBs (SQL)

**List tất cả COPY JOB — built-in statement:**

```sql
COPY JOB LIST;
```

**List qua `SYS_COPY_JOB` (chi tiết hơn, lọc được):**

```sql
SELECT job_id,
       job_name,
       is_auto,
       on_error_suspend,
       TRIM(data_source) AS data_source,
       TRIM(iam_role)    AS iam_role,
       job_create_time
FROM   sys_copy_job
ORDER BY job_create_time DESC;
```

**Xem config của 1 COPY JOB — built-in statement:**

```sql
COPY JOB SHOW user_copy_job;
```

**Hoặc qua system view (có full `copy_query`, dễ copy-paste):**

```sql
SELECT job_id, job_name, job_owner, table_id,
       TRIM(data_source) AS data_source,
       TRIM(iam_role)    AS iam_role,
       TRIM(copy_query)  AS copy_query,
       is_auto, on_error_suspend, job_create_time
FROM   sys_copy_job
WHERE  job_name = 'user_copy_job';
```

**Map COPY JOB → Redshift target table (join qua `table_id`):**

```sql
SELECT cj.job_name,
       TRIM(ns.nspname) || '.' || TRIM(c.relname) AS target_table,
       cj.is_auto,
       cj.job_create_time
FROM   sys_copy_job cj
JOIN   pg_class     c  ON c.oid = cj.table_id
JOIN   pg_namespace ns ON ns.oid = c.relnamespace
ORDER BY cj.job_create_time DESC;
```

**Summary nhanh trạng thái ingest của 1 job:**

```sql
-- Đếm file theo status (P=Pending / I=Ingested / E=Error / U=Unknown)
SELECT status, COUNT(*) AS file_count
FROM   sys_copy_job_detail
WHERE  job_id = (SELECT job_id FROM sys_copy_job WHERE job_name = 'user_copy_job')
GROUP BY status;

-- 10 lần load gần nhất
SELECT start_time, end_time, status,
       source_file_count, loaded_rows, error_count
FROM   sys_load_history
WHERE  copy_job_id = (SELECT job_id FROM sys_copy_job WHERE job_name = 'user_copy_job')
ORDER BY start_time DESC
LIMIT 10;
```

### 3.3 S3 Event Integrations (AWS CLI)

**List tất cả integration:**

```bash
aws redshift describe-integrations --region ap-northeast-1 \
  --query 'Integrations[].[IntegrationName,Status,SourceArn,TargetArn]' \
  --output table
```

**Xem chi tiết 1 integration:**

```bash
aws redshift describe-integrations --region ap-northeast-1 --output json \
  | jq '.Integrations[] | select(.IntegrationName=="glue-etl-s3-event-dev-ex")'
```

### 3.4 Notes về visibility

- `SYS_COPY_JOB` visible cho mọi user; `SYS_COPY_JOB_DETAIL` và `SYS_COPY_JOB_INFO` chỉ superuser hoặc owner xem được đầy đủ — xem [§5.1](#51-check-user-đang-là-superuser).
- `COPY JOB LIST` / `COPY JOB SHOW` chỉ list job mà user hiện tại được phép thấy (theo privilege trên target table).

---

## 4. Glue Job errors

### 4.1 Xem log Glue Job

```bash
# Lấy JobRunId mới nhất
RUN_ID=$(aws glue get-job-runs \
  --job-name "aurora-to-s3-user-dev-ex" \
  --region ap-northeast-1 --max-results 1 \
  --query 'JobRuns[0].Id' --output text)

# Log group cho Glue: /aws-glue/jobs/error + /aws-glue/jobs/output
aws logs tail "/aws-glue/jobs/error" \
  --log-stream-names "$RUN_ID" \
  --region ap-northeast-1 --since 1h

aws logs tail "/aws-glue/jobs/output" \
  --log-stream-names "$RUN_ID" \
  --region ap-northeast-1 --since 1h
```

### 4.2 Common Glue errors

| Symptom | Root cause | Fix |
|---|---|---|
| `Communications link failure` / `Connection refused` | Aurora SG không allow inbound từ Glue ENI | Check `aws_security_group_rule` cho port 13306 từ Glue SG |
| `Access denied` trên Secrets Manager | Glue role thiếu `secretsmanager:GetSecretValue` | Xem `iam.tf` → `aws_iam_role.glue_service` |
| `Table 'xxx' doesn't exist` | Bảng Aurora chưa có / sai database | Verify `aurora_database` trong tfvars; check `SHOW TABLES` trong Aurora |
| `Your connection attempt failed ... VPC` | Glue Connection không attach ENI đúng subnet/SG | Check `aws_glue_connection.aurora` → `physical_connection_requirements` |
| `java.sql.SQLException: Column 'updated_at' not found` | Bảng Aurora không có `updated_at` nhưng script set `jobBookmarkKeys: ["updated_at"]` | Đổi bookmark key, hoặc disable bookmark cho bảng đó qua `bookmark_mode_per_table` |

### 4.3 Re-run Glue Job thủ công

```bash
aws glue start-job-run \
  --job-name "aurora-to-s3-user-dev-ex" \
  --region ap-northeast-1
```

---

## 5. COPY JOB errors

### 5.1 Check user đang là superuser

Bắt buộc trước khi query STL views — **regular user chỉ thấy row của chính họ**, nên nếu đang chạy với user không phải `master` thì các query lỗi sẽ rỗng mặc dù lỗi vẫn xảy ra.

```sql
SELECT current_user, usesuper
FROM   pg_user
WHERE  usename = current_user;
```

Nếu `usesuper = false` → relogin với user `master` rồi chạy tiếp.

### 5.2 Xem event log của COPY JOB

Đây là **nơi đầu tiên phải xem** khi debug:

```sql
SELECT record_time, message
FROM   sys_copy_job_info
WHERE  job_id = (SELECT job_id FROM sys_copy_job WHERE job_name = 'user_copy_job')
ORDER BY record_time DESC
LIMIT 20;
```

Message thường thấy:
- `Job xxx failed to ingest N files from S3` → COPY đã chạy nhưng lỗi → xem §5.3
- `Error: Check 'stl_load_errors' system table for details` → có lỗi data-level
- Rỗng hoàn toàn → COPY chưa fire — xem [§6](#6-s3-event-integration-không-fire)

### 5.3 Xem chi tiết lỗi — `SYS_LOAD_ERROR_DETAIL`

`SYS_LOAD_ERROR_DETAIL` **không có cột `copy_job_id`**, phải join qua `query_id`:

```sql
SELECT start_time, query_id,
       TRIM(file_name)     AS file_name,
       line_number,
       TRIM(column_name)   AS column_name,
       TRIM(column_type)   AS column_type,
       TRIM(column_length) AS column_length,
       error_code,
       TRIM(error_message) AS error_message
FROM   sys_load_error_detail
WHERE  query_id IN (
  SELECT query_id FROM sys_load_history
  WHERE  copy_job_id = (SELECT job_id FROM sys_copy_job WHERE job_name = 'user_copy_job')
)
ORDER BY start_time DESC
LIMIT 30;
```

### 5.4 Xem từng file đang ở trạng thái nào

```sql
SELECT TRIM(file_location) AS bucket,
       TRIM(file_name)     AS key,
       status,  -- P=Pending, I=Ingested, E=Error, U=Unknown
       enqueue_time, modification_time, file_size
FROM   sys_copy_job_detail
WHERE  job_id = (SELECT job_id FROM sys_copy_job WHERE job_name = 'user_copy_job')
ORDER BY enqueue_time DESC NULLS LAST
LIMIT 50;
```

### 5.5 Common COPY errors — tra cứu theo `error_code`

#### Error 15007 — Unmatched number of columns

```
Spectrum Scan Error. Unmatched number of columns between table and file.
Table columns: 29, Data columns: 30
```

**Nguyên nhân**: Schema Parquet (= schema Aurora) khác schema Redshift target table.

**Quan trọng**: COPY Parquet match **by position**, không phải by name. Nên dù số cột đúng mà thứ tự lệch → data sẽ vào sai cột mà COPY vẫn "thành công".

**Fix** — có 3 hướng:

**Option A (khuyến nghị)** — Re-create Redshift table match đúng schema Aurora:

```bash
# 1. Dump schema Parquet
aws s3 cp \
  "s3://aurora-to-redshift-staging-bs-point-dev-ex/data/user/year=2026/month=04/day=23/part-00000-xxx.snappy.parquet" \
  ./sample.parquet --region ap-northeast-1

python3 -c "
import pyarrow.parquet as pq
s = pq.read_schema('sample.parquet')
for i, f in enumerate(s):
    print(f'{i+1:3d}  {f.name:40s} {f.type}')
"
```

```sql
-- 2. So với schema Redshift
SELECT ordinal_position, column_name, data_type, character_maximum_length
FROM   information_schema.columns
WHERE  table_schema = 'public' AND table_name = 'glue_user'
ORDER BY ordinal_position;

-- 3. DROP + CREATE lại với thứ tự đúng từ Parquet schema
DROP TABLE public.glue_user;
CREATE TABLE public.glue_user (
  -- copy đủ cột theo thứ tự Parquet
  ...
);
```

**Option B** — Drop cột thừa trong Glue script `scripts/aurora_to_s3.py`:

```python
from awsglue.transforms import DropFields
# ...
dyf_output = DropFields.apply(dyf_source, paths=["<ten_cot_thua>"])
```

Sau đó `terraform apply` — `source_hash = filemd5(...)` sẽ auto re-upload script.

**Option C (KHÔNG khuyến nghị)** — `ALTER TABLE ADD COLUMN` chỉ thêm cột vào cuối bảng, không chèn được ở vị trí giữa → vẫn mismatch nếu cột thừa không ở cuối Parquet.

#### Bảng lỗi thường gặp khác

| `error_code` | `error_message` pattern | Root cause | Fix |
|---|---|---|---|
| `1202`–`1216` | String length exceeds DDL length | VARCHAR target quá ngắn | `ALTER TABLE ... ALTER COLUMN ... TYPE VARCHAR(N)` |
| `1204` | Invalid date format | Timestamp Parquet (INT96 legacy) khác Redshift | Thêm `FORMAT AS PARQUET` (đã có); đảm bảo Glue ghi `TIMESTAMP_MILLIS`/`MICROS` |
| `15001` | Spectrum scan error (generic) | Corrupt Parquet hoặc schema evolution | Kiểm tra file Parquet qua `parquet-tools meta` |
| `15002` | S3ServiceException: Access Denied | IAM role thiếu `s3:GetObject` hoặc `kms:Decrypt` | Xem §5.6 |
| `15007` | Unmatched number of columns | Schema mismatch (số cột) | Xem case trên |
| `15009` | Inconsistent Parquet schema | Glue ghi files với schema khác nhau (evolution) | Invalidate bookmark + re-run full; hoặc dùng `useGlueParquetWriter` |
| `15011` | Mismatched column types | Kiểu cột Parquet ≠ Redshift (e.g. BIGINT vs INTEGER) | Sync DDL hoặc CAST trong Glue |

### 5.6 Access Denied errors (S3 / KMS)

Nếu `stl_load_errors` và `sys_load_error_detail` rỗng nhưng `sys_copy_job_info` báo failed → thường là lỗi cấp dưới (S3/KMS) trước khi parser chạy:

```sql
-- Xem query-level errors
SELECT starttime, userid, query, TRIM(errormsg) AS errormsg
FROM   stl_query_errors
WHERE  starttime > DATEADD(hour, -2, GETDATE())
ORDER BY starttime DESC
LIMIT 20;
```

Kiểm tra IAM role attach vào cluster:

```bash
aws redshift describe-clusters \
  --cluster-identifier point \
  --region ap-northeast-1 \
  --query 'Clusters[0].IamRoles[].IamRoleArn' --output table
```

Kiểm tra role có permission KMS `Decrypt` không:

```bash
aws iam list-role-policies --role-name redshift-s3-copy-role-dev-ex
aws iam list-attached-role-policies --role-name redshift-s3-copy-role-dev-ex
```

### 5.7 Manual trigger COPY JOB

Khi AUTO ON thì **không thể** `COPY JOB RUN` trực tiếp — runtime báo:
```
ERROR:  Cannot run COPY job xxx manually while auto copy is enabled.
        Disable auto copy if you need to run this job manually.
```

Quy trình đúng:

```sql
-- 1. Tắt AUTO
COPY JOB ALTER user_copy_job AUTO OFF;

-- 2. Chạy thủ công (sẽ load tất cả files trong prefix chưa load)
COPY JOB RUN user_copy_job;

-- 3. Check kết quả
SELECT start_time, status, source_file_count, loaded_rows, error_count
FROM   sys_load_history
WHERE  copy_job_id = (SELECT job_id FROM sys_copy_job WHERE job_name = 'user_copy_job')
ORDER BY start_time DESC LIMIT 3;

-- 4. Bật lại AUTO
COPY JOB ALTER user_copy_job AUTO ON;
```

### 5.8 Retry các file đã fail

AUTO COPY **không tự retry** file đã ở `status = 'E'`. Sau khi fix nguyên nhân:

```sql
-- List files bị error
SELECT TRIM(file_name) AS file, enqueue_time
FROM   sys_copy_job_detail
WHERE  job_id = (SELECT job_id FROM sys_copy_job WHERE job_name = 'user_copy_job')
  AND  status = 'E';

-- Chạy lại manual (như §5.7) → COPY sẽ xử lý lại toàn bộ prefix
```

---

## 6. S3 Event Integration không fire

Triệu chứng: có Parquet trong S3, nhưng `sys_copy_job_detail` rỗng (không có row nào dù status P/I/E).

### 6.1 Check Integration status

```bash
aws redshift describe-integrations --region ap-northeast-1 --output json \
  | jq '.Integrations[] | select(.IntegrationName=="glue-etl-s3-event-dev-ex") | {IntegrationName, Status, Errors}'
```

**Status values**:
- `active` → OK
- `creating` → đang tạo, đợi
- `failed` / `needs_attention` → xem `.Errors[]`
- `syncing` → đang đồng bộ lại state, đợi
- `inactive` → cluster paused hoặc permissions bị revoke

### 6.2 Check bucket notification config

Integration phải inject EventBridge notification vào bucket. Check:

```bash
aws s3api get-bucket-notification-configuration \
  --bucket aurora-to-redshift-staging-bs-point-dev-ex \
  --region ap-northeast-1
```

Phải có `EventBridgeConfiguration: {}` (Redshift Integration enable bucket-level EventBridge).

### 6.3 Check Redshift Resource Policy

Namespace phải cho phép `redshift:AuthorizeInboundIntegration` từ bucket:

```bash
aws redshift get-resource-policy \
  --resource-arn "$(aws redshift describe-clusters --cluster-identifier point --region ap-northeast-1 --query 'Clusters[0].ClusterNamespaceArn' --output text)" \
  --region ap-northeast-1 \
  --query 'ResourcePolicy.Policy' --output text | jq .
```

### 6.4 Check COPY JOB còn tồn tại và AUTO ON

```sql
SELECT job_name, is_auto, on_error_suspend, TRIM(data_source) AS src
FROM   sys_copy_job
WHERE  job_name = 'user_copy_job';
```

Nếu `is_auto = f` → ALTER lại ON.

### 6.5 Re-create Integration nếu status `failed`

Qua Terraform:

```bash
cd bs-exchange-infra/terraform/components/glue-etl
../../terraform.sh --env dev-ex taint aws_redshift_integration.s3_event[0]
../../terraform.sh --env dev-ex apply
```

---

## 7. Cheatsheet — System views

| View | Filter | Dùng cho |
|---|---|---|
| `sys_copy_job` | `job_name`, `job_id` | Info config COPY JOB (AUTO, IAM role, source) |
| `sys_copy_job_detail` | `job_id` | Từng file: status P/I/E/U |
| `sys_copy_job_info` | `job_id` | Log messages (errors, events) |
| `sys_load_history` | `copy_job_id`, `query_id` | Từng lần load: status, rows, bytes |
| `sys_load_error_detail` | `query_id` *(không có `copy_job_id`)* | Chi tiết error per row/column |
| `stl_load_errors` | `copy_job_id`, `query` | Row-level errors (legacy, vẫn dùng được) |
| `stl_query_errors` | `starttime`, `query` | Query-level errors (S3/KMS access denied) |
| `stl_error` | `recordtime` | Internal engine errors (không chứa S3/KMS) |

### Column gotchas

- `sys_load_history`: dùng `source_file_count` và `loaded_rows`, **không phải** `file_count` / `record_count`.
- `sys_load_error_detail`: lọc qua `query_id`, **không** có `copy_job_id`.
- `stl_load_errors` + STL views: **regular user chỉ thấy row của mình** — cần superuser hoặc chính owner để debug COPY JOB.

---

## 8. Thông tin nhanh — component `glue-etl` này

| Thứ | Giá trị (dev-ex) |
|---|---|
| S3 bucket | `aurora-to-redshift-staging-bs-point-dev-ex` |
| S3 prefix per table | `data/<table>/year=YYYY/month=MM/day=DD/` |
| KMS alias | `alias/aurora-to-redshift-staging-dev-ex` |
| Redshift cluster | `point` |
| Redshift DB / schema | `point` / `public` |
| Redshift table prefix | `glue_` (Aurora `user` → Redshift `public.glue_user`) |
| Glue Job name | `aurora-to-s3-<table>-dev-ex` |
| COPY JOB name | `<table>_copy_job` |
| S3 Event Integration | `glue-etl-s3-event-dev-ex` |
| IAM role (Glue) | `glue-service-role-dev-ex` *(xem `iam.tf`)* |
| IAM role (Redshift COPY) | `redshift-s3-copy-role-dev-ex` |
| Daily trigger (UTC) | `cron(0 17 * * ? *)` = 02:00 JST |

---

## 9. Known issues

### 9.1 Terraform state drift sau ~24h cho `aws_redshiftdata_statement`

Provider lưu statement ID, Redshift Data API hết hạn statement sau ~24h → `terraform plan/refresh` lỗi `ValidationException: Could not retrieve the query result`.

**Fix**: `terraform apply -replace='null_resource.drop_copy_job_before_change["<table>"]'` — replace triggers propagate qua `replace_triggered_by`.

Chi tiết: xem comment trong `terraform/components/glue-etl/redshift_copy_job.tf:72-88`.

### 9.2 AUTO COPY dừng sau ~50 lần load (repost)

Issue đã biết từ AWS: [Redshift auto copy job stops working after about 50th load](https://repost.aws/questions/QU-hGBigD2QOGkWbqqAmpSXQ/redshift-auto-copy-job-stops-working-after-about-50th-load). Workaround: DROP + CREATE lại COPY JOB (qua `terraform apply -replace=...` như §9.1).

### 9.3 Parquet schema evolution khi Aurora ALTER TABLE

Nếu Aurora thêm/sửa cột, Parquet mới sẽ khác schema cũ → COPY JOB sẽ fail với Error 15007 hoặc 15009.

**Phòng tránh**:
1. Khi chuẩn bị ALTER TABLE Aurora → pause Glue trigger, drain staging, recreate Redshift target, resume.
2. Hoặc dùng `useGlueParquetWriter: "true"` trong Glue script để stable schema (đổi lại tốc độ ghi chậm hơn).

---

## Sources

AWS Redshift official docs (verified 2026-04-23):

- [SYS_LOAD_HISTORY](https://docs.aws.amazon.com/redshift/latest/dg/SYS_LOAD_HISTORY.html)
- [SYS_LOAD_ERROR_DETAIL](https://docs.aws.amazon.com/redshift/latest/dg/SYS_LOAD_ERROR_DETAIL.html)
- [SYS_COPY_JOB](https://docs.aws.amazon.com/redshift/latest/dg/SYS_COPY_JOB.html)
- [SYS_COPY_JOB_DETAIL](https://docs.aws.amazon.com/redshift/latest/dg/SYS_COPY_JOB_DETAIL.html)
- [SYS_COPY_JOB_INFO](https://docs.aws.amazon.com/redshift/latest/dg/SYS_COPY_JOB_INFO.html)
- [STL_LOAD_ERRORS (visibility rules)](https://docs.aws.amazon.com/redshift/latest/dg/r_STL_LOAD_ERRORS.html)
- [STL_ERROR](https://docs.aws.amazon.com/redshift/latest/dg/r_STL_ERROR.html)
- [COPY JOB syntax](https://docs.aws.amazon.com/redshift/latest/dg/r_COPY-JOB.html)
- [Troubleshooting S3 event integration and COPY JOB errors](https://docs.aws.amazon.com/redshift/latest/dg/s3-integration-troubleshooting.html)
- [Create an S3 event integration](https://docs.aws.amazon.com/redshift/latest/dg/loading-data-copy-job.html)
- [Load Error Reference (error codes)](https://docs.aws.amazon.com/redshift/latest/dg/r_Load_Error_Reference.html)

Terraform source code:
- `bs-exchange-infra/terraform/components/glue-etl/` (provider version pins: `versions.tf`)
