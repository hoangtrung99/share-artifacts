# Hướng dẫn: Thêm biến môi trường vào dự án Spring Boot (Point)

## Mục tiêu

Hướng dẫn cách thêm biến môi trường mới (ví dụ: GeoIP) vào hệ thống, từ AWS Secrets Manager đến K8s và YAML config.

## Ví dụ cụ thể

```yaml
geoip:
  api-url: https://api.ipgeolocation.io/v2/ipgeo
  api-key: your-api-key-here
  api-security-url: https://api.ipgeolocation.io/v3/security
```

---

## FAQ: Property name có chứa dấu `-` (hyphen) được không?

**Có, hoàn toàn được.** Spring Boot hỗ trợ **Relaxed Binding**:

| Dạng viết | Ví dụ | Dùng ở đâu |
|-----------|-------|-------------|
| Kebab-case (có `-`) | `api-key` | YAML files (convention chuẩn) |
| Underscore uppercase | `GEOIP_API_KEY` | Environment variables |

Mapping tự động:
```
YAML:     geoip.api-key
Env var:  GEOIP_API_KEY (dùng để override)
```

**Lưu ý**: Environment variable (biến môi trường OS) **không hỗ trợ dấu `-`**. Tên biến môi trường chỉ dùng được `A-Z`, `0-9`, `_`. Nhưng Spring Boot tự xử lý mapping, nên bạn vẫn viết hyphen trong YAML bình thường.

---

## Cách thêm biến vào secret `point/base` (Cách phổ biến nhất)

### Data Flow tổng quan

```
AWS Secrets Manager          rehearsal_secrets.sh          K8s Secret            Pod
┌──────────────────┐        ┌───────────────────┐       ┌──────────────┐     ┌────────────┐
│ point/base (JSON)│──GET──→│ Fetch all secrets │──────→│ point-secrets│────→│ Env vars   │
│ point/SPRING_*   │        │ Backup current    │       │ (Opaque)     │     │ trong Pod  │
│ point/exc        │        │ Diff & preview    │       └──────────────┘     └─────┬──────┘
│ {                │        │ Confirm → Apply   │                                  │
│  "KEY": "val"    │        └───────────────────┘                       Spring Relaxed Binding
│ }                │                                                              │
└──────────────────┘                                                     ┌────────▼────────┐
                                                                         │  application.yaml │
                                                                         │  ${ENV_VAR}       │
                                                                         └─────────────────┘
```

### `point/base` là gì?

- Là một **AWS Secrets Manager secret** chứa **JSON object** với ~40+ key-value pairs
- Mỗi key trong JSON sẽ trở thành **một env var riêng** trong Pod
- Dùng cho các credentials không thuộc DB/Redis (SES, JWT, Fireblocks, API keys, v.v.)
- **Tất cả keys** được inject vào Pod qua `envFrom.secretRef` — KHÔNG cần sửa deployment YAML
- Script `rehearsal_secrets.sh` fetch **nhiều secrets cùng lúc** (`base`, `SPRING_DATA_REDIS`, `SPRING_DATASOURCE_MASTER`, `SPRING_DATASOURCE_HISTORICAL`, `exc`) rồi merge tất cả vào K8s Secret `point-secrets`

### Các bước thêm biến mới vào `point/base`

#### Bước 1: Thêm key vào JSON trong AWS Secrets Manager

**Qua AWS Console:**
1. Vào AWS Secrets Manager → Tìm secret `point/base`
2. Click "Retrieve secret value" → "Edit"
3. Thêm key mới vào JSON:

```json
{
  "AWS_SES_HOST": "email-smtp.ap-northeast-1.amazonaws.com",
  "JWT_SECRET": "a973f725e...",
  "...": "... (40+ keys hiện có)",
  "GEOIP_API_KEY": "your-api-key-here",
  "GEOIP_API_URL": "https://api.ipgeolocation.io/v2/ipgeo",
  "GEOIP_API_SECURITY_URL": "https://api.ipgeolocation.io/v3/security"
}
```

**Qua AWS CLI:**
```bash
# 1. Lấy JSON hiện tại
CURRENT=$(aws secretsmanager get-secret-value \
  --secret-id "point/base" \
  --region ap-northeast-1 \
  --query SecretString --output text)

# 2. Thêm key mới bằng jq
UPDATED=$(echo "$CURRENT" | jq '. + {
  "GEOIP_API_KEY": "your-api-key-here",
  "GEOIP_API_URL": "https://api.ipgeolocation.io/v2/ipgeo",
  "GEOIP_API_SECURITY_URL": "https://api.ipgeolocation.io/v3/security"
}')

# 3. Cập nhật secret
aws secretsmanager put-secret-value \
  --secret-id "point/base" \
  --region ap-northeast-1 \
  --secret-string "$UPDATED"
```

> **Lưu ý**: Làm cho TỪNG môi trường (DEV, STG). Mỗi AWS account có secret `point/base` riêng.

#### Bước 2: Chạy `rehearsal_secrets.sh` để đồng bộ AWS SM → K8s Secret

**File**: `bs-exchange-infra/k8s-manifests/bin/rehearsal_secrets.sh`

```bash
cd bs-exchange-infra/k8s-manifests/bin

# Xem danh sách keys sẽ được fetch (dry-run, không apply)
./rehearsal_secrets.sh --list

# Chạy thật — script sẽ hỏi xác nhận trước khi apply
./rehearsal_secrets.sh

# Chỉ định environment (local sẽ tạo file local.env thay vì K8s secret)
./rehearsal_secrets.sh --env local
```

Script `rehearsal_secrets.sh` thực hiện:
1. **Validate** AWS credentials
2. **Fetch** tất cả secrets (`base`, `SPRING_DATA_REDIS`, `SPRING_DATASOURCE_MASTER`, `SPRING_DATASOURCE_HISTORICAL`, `exc`) từ AWS Secrets Manager
3. **Backup** K8s Secret hiện tại vào `.secret-backups/` (giữ tối đa 10 bản)
4. **So sánh** (diff) keys Added/Changed/Deleted giữa secret cũ và mới
5. **Hỏi xác nhận** (`Apply changes? (y/N)`) trước khi apply
6. **Apply** K8s Secret `point-secrets` với tất cả keys

**Output mẫu khi có key mới:**
```
fetching secrets from AWS Secrets Manager
fetch: point/base
  keys: AWS_SES_HOST JWT_SECRET ... GEOIP_API_KEY GEOIP_API_URL GEOIP_API_SECURITY_URL
fetch: point/SPRING_DATA_REDIS
  keys: host port
...

comparing with existing secret
  Added keys:
    + GEOIP_API_KEY
    + GEOIP_API_URL
    + GEOIP_API_SECURITY_URL

Preview complete.
Apply changes to Kubernetes secret 'point-secrets'? (y/N): y

applying secret to Kubernetes
done.
```

#### Bước 3: Restart Pods để nhận env vars mới

```bash
# Restart deployment để pods mới đọc secret mới
kubectl rollout restart deployment/point-api-deployment
kubectl rollout restart deployment/point-worker-deployment
# ... (các deployment cần dùng biến mới)
```

#### Bước 4: Thêm vào application.yaml cho local dev

Vì local dev không có K8s Secret, thêm default values vào YAML:

```yaml
# application.yaml (dùng cho local development)
geoip:
  api-url: ${GEOIP_API_URL:https://api.ipgeolocation.io/v2/ipgeo}
  api-key: ${GEOIP_API_KEY:dev-placeholder-key}
  api-security-url: ${GEOIP_API_SECURITY_URL:https://api.ipgeolocation.io/v3/security}
```

Pattern `${ENV_VAR:default}` nghĩa là: dùng env var nếu có, nếu không thì dùng default.

### Quy tắc đặt tên key trong `point/base`

| Quy tắc | Ví dụ đúng | Ví dụ sai |
|----------|-----------|-----------|
| UPPERCASE + UNDERSCORE | `GEOIP_API_KEY` | `geoip-api-key` |
| Prefix theo service | `GEOIP_API_KEY` | `API_KEY` (quá chung) |
| Không dùng dấu `-` | `GEOIP_API_URL` | `GEOIP_API-URL` |
| Không dùng dấu `.` | `GEOIP_API_KEY` | `GEOIP.API.KEY` |

> **Quan trọng**: Key trong JSON phải dùng `UPPERCASE_UNDERSCORE` vì nó trở thành env var trực tiếp.
> Env var ở OS level chỉ hỗ trợ `A-Z`, `0-9`, `_`.

### Tổng hợp: Thêm vào `point/base` cần sửa gì?

| # | Vị trí | Hành động | Cần sửa code? |
|---|--------|-----------|---------------|
| 1 | AWS Secrets Manager `point/base` | Thêm key-value vào JSON | Không (AWS Console/CLI) |
| 2 | `rehearsal_secrets.sh` | Chạy lại để sync K8s Secret | Không cần sửa script |
| 3 | K8s Pods | Restart để nhận env vars mới | Không cần sửa YAML |
| 4 | `application.yaml` | Thêm default values cho local dev | ✅ Sửa |

**Ưu điểm so với tạo secret mới**: Không cần sửa Terraform, không cần sửa K8s deployment YAML, không cần tạo secret mới.

### Tham khảo: Các chế độ của `rehearsal_secrets.sh`

| Lệnh | Tác dụng |
|-------|----------|
| `./rehearsal_secrets.sh --list` | Chỉ liệt kê keys, không apply |
| `./rehearsal_secrets.sh` | Fetch → Backup → Diff → Confirm → Apply K8s Secret |
| `./rehearsal_secrets.sh --env local` | Tạo file `local.env` (cho local dev, không cần K8s) |

---

## Cách thêm biến bằng tạo secret mới (Khi cần tách riêng)

### Bước 1: Thêm config vào `application.yaml`

**File**: `bs-integration-server/{module}/src/main/resources/application.yaml`

Chọn module phù hợp (`point-api`, `point-worker`, `point-admin`, `point-mmh`).

```yaml
# Thêm vào cuối file hoặc vị trí phù hợp
geoip:
  api-url: https://api.ipgeolocation.io/v2/ipgeo
  api-key: ${GEOIP_API_KEY:default-dev-key}    # Sensitive → dùng env var
  api-security-url: https://api.ipgeolocation.io/v3/security
```

**Pattern hay dùng trong dự án**:
- Giá trị **không nhạy cảm** (URL, port): viết thẳng trong YAML
- Giá trị **nhạy cảm** (API key, password): dùng placeholder `${ENV_VAR}` hoặc AWS Secrets Manager

Nếu cần config khác nhau theo môi trường, thêm vào file profile tương ứng:
- `application-dev.yaml` — cho DEV
- `application-stg.yaml` — cho STG
- `application-prd.yaml` — cho PRD

### Bước 2: Quản lý giá trị nhạy cảm (API Key)

Có 2 cách (chọn 1):

#### Cách A: Dùng AWS Secrets Manager (pattern hiện tại của dự án)

1. **Thêm secret key vào Terraform**:

   **File**: `bs-exchange-infra/terraform/components/secrets_manager/locals.tf`

   ```terraform
   locals {
     secrets_manager_keys = [
       "base",
       "SPRING_DATA_REDIS",
       "SPRING_DATASOURCE_MASTER",
       "SPRING_DATASOURCE_HISTORICAL",
       # ... keys hiện tại ...
       "GEOIP",                        # ← Thêm dòng này
     ]
   }
   ```

   Điều này tạo secret: `point/GEOIP` trong AWS Secrets Manager.

2. **Chạy Terraform plan** (để review, KHÔNG tự apply):
   ```bash
   cd bs-exchange-infra/terraform/components/secrets_manager
   ../../terraform.sh --env dev-ex plan
   ```

3. **Set giá trị secret** trong AWS Console hoặc CLI:
   ```json
   {
     "api-key": "your-api-key-here"
   }
   ```

4. **Trong YAML**, để trống giá trị nhạy cảm (Spring Cloud AWS sẽ tự load):
   ```yaml
   geoip:
     api-url: https://api.ipgeolocation.io/v2/ipgeo
     api-key:    # loaded from AWS Secrets Manager
     api-security-url: https://api.ipgeolocation.io/v3/security
   ```

#### Cách B: Dùng K8s Environment Variable (đơn giản hơn)

1. **Trong YAML**, dùng placeholder:
   ```yaml
   geoip:
     api-key: ${GEOIP_API_KEY}
   ```

2. **Thêm env var vào K8s deployment**:

   **File**: `bs-exchange-infra/k8s-manifests/point/{env}/api/deployment.yaml`

   ```yaml
   env:
     - name: SPRING_PROFILES_ACTIVE
       value: "dev"
     - name: JAVA_TOOL_OPTIONS
       value: -XX:MaxDirectMemorySize=500M
     - name: GEOIP_API_KEY                    # ← Thêm
       valueFrom:
         secretKeyRef:
           name: point-geoip-secret           # K8s secret name
           key: api-key
   ```

3. **Tạo K8s secret**:
   ```bash
   kubectl create secret generic point-geoip-secret \
     --from-literal=api-key=your-api-key-here
   ```

### Bước 3: Override bằng Environment Variable (khi cần)

Spring Boot cho phép override bất kỳ property nào bằng env var:

| YAML Property | Environment Variable tương ứng |
|---------------|-------------------------------|
| `geoip.api-url` | `GEOIP_API_URL` |
| `geoip.api-key` | `GEOIP_API_KEY` |
| `geoip.api-security-url` | `GEOIP_API_SECURITY_URL` |

**Quy tắc chuyển đổi**:
1. Bỏ dấu `.` → thay bằng `_`
2. Bỏ dấu `-` → nối liền hoặc thay bằng `_`
3. Viết HOA toàn bộ

### Tổng hợp: Những file cần sửa

| # | File | Hành động | Bắt buộc? |
|---|------|-----------|-----------|
| 1 | `bs-integration-server/{module}/src/main/resources/application.yaml` | Thêm block `geoip:` | ✅ Có |
| 2 | `bs-integration-server/{module}/src/main/resources/application-{env}.yaml` | Thêm config theo môi trường (nếu cần khác nhau) | ⚡ Tùy |
| 3 | `bs-exchange-infra/terraform/components/secrets_manager/locals.tf` | Thêm secret key | ⚡ Nếu dùng AWS Secrets Manager |
| 4 | `bs-exchange-infra/k8s-manifests/point/{env}/api/deployment.yaml` | Thêm env var | ⚡ Nếu dùng K8s env var |

---

## Lưu ý quan trọng

1. **API Key là sensitive data** — KHÔNG commit giá trị thật vào git. Dùng AWS Secrets Manager hoặc K8s Secrets.
2. **Dự án chưa có PRD** — chỉ cần config cho DEV và STG. Nhưng nên chuẩn bị sẵn `application-prd.yaml` entry.
3. **Test local** — có thể set env var trước khi chạy app:
   ```bash
   export GEOIP_API_KEY=your-api-key-here
   ./gradlew :point-api:bootRun
   ```
4. **Spring Boot version 2.5.7** — Relaxed Binding hoạt động đầy đủ với version này.
