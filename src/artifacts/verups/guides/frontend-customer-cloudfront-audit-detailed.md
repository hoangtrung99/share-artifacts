# Audit Report: `frontend-customer` CloudFront Distribution

## 1. Tổng quan

| Thuộc tính | Giá trị |
|------------|---------|
| **Terraform component** | `bs-exchange-infra/terraform/components/frontend-customer/` |
| **Resource chính** | `aws_cloudfront_distribution.this` |
| **Domain (DEV)** | `dev-ex.backseat-service.com` |
| **Domain (STG)** | `stg-ex.backseat-service.com` |
| **ACM Certificate** | `*.backseat-service.com` |
| **WAF WebACL** | `point-cloudfront-customer` (us-east-1, CLOUDFRONT scope) |
| **Lambda@Edge** | `subdirectory-index` (Node.js 18.x) |
| **Default root object** | `index.html` |
| **IPv6** | Disabled |
| **Price class** | `PriceClass_All` |

**Evidence:**
- `bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf:6`
- `bs-exchange-infra/terraform/components/frontend-customer/tfvars/dev-ex.tfvars:3-4`
- `bs-exchange-infra/terraform/components/frontend-customer/tfvars/stg-ex.tfvars:3-4`
- `bs-exchange-infra/terraform/components/frontend-customer/terraform.tfvars:11`

---

## 2. Origins (6 origins)

| STT | origin_id | Type | Nguồn (Terraform) | Tên thực tế (DEV) | Tên thực tế (STG) |
|-----|-----------|------|-------------------|-------------------|-------------------|
| 1 | `s3_origin` | S3 | `aws_s3_bucket.this` | `point.bs-point-dev-ex` | `point.bs-point-stg-ex` |
| 2 | `s3_choice_origin` | S3 | `aws_s3_bucket.choice` | `choice.bs-point-dev-ex` | `choice.bs-point-stg-ex` |
| 3 | `s3_exchange_origin` | S3 | `aws_s3_bucket.exchange` | `exchange.bs-point-dev-ex` | `exchange.bs-point-stg-ex` |
| 4 | `s3_doc_origin` | S3 | `aws_s3_bucket.doc` | `doc.bs-point-dev-ex` | `doc.bs-point-stg-ex` |
| 5 | `alb_origin` | ALB | `data.aws_lb.point-alb` | `point-alb` (account `845131030484`) | `point-alb` (account `520411743393`) |
| 6 | `s3_maintenance_origin` | S3 | `data.aws_s3_bucket.maintenance` | `maintenance.bs-point-dev-ex` | `maintenance.bs-point-stg-ex` |

**Evidence:**
- `bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf:23-80`
- `bs-exchange-infra/terraform/components/frontend-customer/tfvars/dev-ex.tfvars:7-29`
- `bs-exchange-infra/terraform/components/frontend-customer/tfvars/stg-ex.tfvars:7-29`

**Chi tiết cấu hình origin:**

### 2.1. S3 Origins (5 origins)
- Tất cả S3 origins đều dùng chung **một** `aws_cloudfront_origin_access_identity.this`.
- `s3_origin_config.origin_access_identity` trỏ đến `aws_cloudfront_origin_access_identity.this.cloudfront_access_identity_path`.
- Origin `s3_maintenance_origin` có `origin_path = ""` (explicit empty string).

**Evidence:** `bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf:27-29`, `:36-38`, `:45-47`, `:54-56`, `:77-79`

### 2.2. ALB Origin (1 origin)
- `domain_name` = `data.aws_lb.point-alb.dns_name`
- `custom_origin_config`:
  - `http_port = 80`, `https_port = 443`
  - `origin_protocol_policy = "https-only"`
  - `origin_ssl_protocols = ["TLSv1.2"]`
  - `origin_read_timeout = var.point_alb_timeout` (default 30, override 60 trong tfvars)

**Evidence:** `bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf:59-70`

---

## 3. Cache Behaviors (8 behaviors, first-match order)

| STT | Path Pattern | Origin | Allowed Methods | Cached Methods | Query String | Cookies | Headers | TTL (min/default/max) | Lambda@Edge | Response Headers Policy |
|-----|-------------|--------|-----------------|----------------|--------------|---------|---------|----------------------|-------------|------------------------|
| 0 | `*` (default) | `s3_origin` | GET, HEAD, OPTIONS | GET, HEAD | `false` | forward = `none` | — | 0 / 86400 / 31536000 | `subdirectory-index` (origin-request) | `static_html_header` |
| 1 | `/farm-game/*` | `s3_choice_origin` | GET, HEAD, OPTIONS | GET, HEAD | `false` | forward = `none` | — | 0 / 86400 / 31536000 | `subdirectory-index` (origin-request) | `static_html_header` |
| 2 | `/exchange/*` | `s3_exchange_origin` | GET, HEAD, OPTIONS | GET, HEAD | `false` | forward = `none` | — | 0 / 86400 / 31536000 | `subdirectory-index` (origin-request) | `static_html_header` |
| 3 | `/maintenance/*` | `s3_maintenance_origin` | GET, HEAD | GET, HEAD | `false` | forward = `none` | — | 0 / 86400 / 31536000 | `subdirectory-index` (origin-request) | `static_html_header` |
| 4 | `/doc/*` | `s3_doc_origin` | GET, HEAD | GET, HEAD | `false` | forward = `none` | — | 0 / 86400 / 31536000 | **None** | `static_html_header` |
| 5 | `/app/*` | `alb_origin` | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE | GET, HEAD | `true` | whitelist: `_atnct`, `adm_adtr_xuid` | `Host`, `user-agent` | 0 / 86400 / 31536000 | None | `server_header` |
| 6 | `/api/*` | `alb_origin` | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE | GET, HEAD | `true` | forward = `none` | `Host` | 0 / 86400 / 31536000 | None | `server_header` |
| 7 | `/websocket` | `alb_origin` | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE | GET, HEAD | — | — | — | 0 / — / — | None | `server_header` |

**Evidence:** `bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf:82-293`

### 3.1. Chú ý về `/websocket` behavior
- Đây là **exact match** (`/websocket`), không phải prefix.
- Không dùng `forwarded_values` mà dùng **managed cache policy**:
  - `cache_policy_id = data.aws_cloudfront_cache_policy.CachingDisabled.id`
  - `origin_request_policy_id = aws_cloudfront_origin_request_policy.websocket.id`
- WebSocket origin request policy whitelist các header:
  - `Host`, `Sec-WebSocket-Key`, `Sec-WebSocket-Version`, `Sec-WebSocket-Protocol`, `Sec-WebSocket-Accept`

**Evidence:** `bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf:279-293`, `cloudfront_policy.tf:57-73`

### 3.2. Cookie whitelist trên `/app/*`
- Comment trong code: `Stateless JWT backend — only affiliate tracking cookies needed for registration.`
- Whitelist: `["_atnct", "adm_adtr_xuid"]`
- Khi thêm affiliate mới vào bảng `affiliate_info`, cần cập nhật whitelist này.

**Evidence:** `bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf:238-241`

### 3.3. Comment về `/api/*` cookies
- Comment: `point-api uses header-based API key auth, no cookies needed.`

**Evidence:** `bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf:265-268`

---

## 4. Custom Error Responses

| Error Code | Response Code | Response Page Path | Error Caching Min TTL |
|------------|---------------|--------------------|----------------------|
| 403 | 404 | `/html/404/` | 10 |
| 404 | 404 | `/html/404/` | 10 |

**Evidence:** `bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf:305-317`

---

## 5. Logging Configuration

- `include_cookies = true`
- Log bucket (DEV): `logs.bs-point-dev-ex`
- Log bucket (STG): `logs.bs-point-stg-ex`
- Prefix: từ `var.cloudfront_logging_prefix`

**Evidence:** `bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf:319-323`

---

## 6. Lambda@Edge: `subdirectory-index`

### 6.1. Source Code

File: `bs-exchange-infra/terraform/components/frontend-customer/lambda_function.zip` (extracted)

```javascript
'use strict';
exports.handler = (event, context, callback) => {
    let request = event.Records[0].cf.request;
    const olduri = request.uri;
    const newuri = olduri.replace(/\/$/, '\/index.html');
    request.uri = newuri;
    return callback(null, request);
};
```

**Hành vi:** Rewrite URI kết thúc bằng `/` thành `/index.html`. Không xử lý các trường hợp khác.

### 6.2. Terraform Resource

```hcl
resource "aws_lambda_function" "this" {
  provider      = aws.us
  function_name = "subdirectory-index"
  role          = aws_iam_role.this.arn
  filename      = "lambda_function.zip"
  runtime       = "nodejs18.x"
  handler       = "index.handler"
  publish       = true
}
```

### 6.3. IAM Role

```hcl
resource "aws_iam_role" "this" {
  name = "lambda-subdirectory-index-role"
  managed_policy_arns = ["arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"]
  assume_role_policy  = ... # Lambda + EdgeLambda
}
```

**Evidence:**
- `bs-exchange-infra/terraform/components/frontend-customer/lambda.tf:1-16`
- `bs-exchange-infra/terraform/components/frontend-customer/iam_role.tf:1-22`

### 6.4. Các cache behaviors gắn Lambda
Lambda được gắn vào **4 behaviors** sau (event_type = `origin-request`, include_body = `false`):
1. Default `*`
2. `/farm-game/*`
3. `/exchange/*`
4. `/maintenance/*`

**Behavior `/doc/*` KHÔNG có Lambda@Edge.**

**Evidence:**
- `cloudfront.tf:102-106` (default) — Có Lambda
- `cloudfront.tf:132-136` (`/farm-game/*`) — Có Lambda
- `cloudfront.tf:162-166` (`/exchange/*`) — Có Lambda
- `cloudfront.tf:192-196` (`/maintenance/*`) — Có Lambda
- `cloudfront.tf:201-223` (`/doc/*`) — **KHÔNG có Lambda**

---

## 7. S3 Buckets Chi Tiết — Với Evidence Mục Đích Cụ Thể

### 7.1. `point.bs-point-{env}-ex` — Main Point Customer SPA

| Thuộc tính | Giá trị |
|------------|---------|
| **Terraform resource** | `aws_s3_bucket.this` |
| **DEV** | `point.bs-point-dev-ex` |
| **STG** | `point.bs-point-stg-ex` |
| **ACL** | Không có (BucketOwnerEnforced) |
| **Public Access Block** | Block tất cả |
| **Versioning** | Enabled |
| **Bucket Policy** | Allow CloudFront OAI GetObject + Deny Put/Delete trừ admin/bastion/cicd |

**Mục đích (Evidence từ code):**
- Đây là origin mặc định (`default_cache_behavior` với `target_origin_id = "s3_origin"`).
- `bs-point-front` deploy trực tiếp đến bucket này.

**Evidence deploy:**
```bash
# bs-point-front/deploy/env/dev
DEPLOY_AWS_S3_BUCKET=point.bs-point-dev-ex
DEPLOY_AWS_CLOUDFRONT_DISTRIBUTION_ID=E1K6SY01O8V7JV

# bs-point-front/deploy/env/stg
DEPLOY_AWS_S3_BUCKET=point.bs-point-stg-ex
DEPLOY_AWS_CLOUDFRONT_DISTRIBUTION_ID=E2C1CVQWGCIC1T
```

**Evidence path mapping:**
- `bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf:82-109` (default behavior → `s3_origin`)
- `docs/sprints/sprint-23/maintenance-split/INVESTIGATION.md:96`: `| / (default) | Point main customer site | point.bs-point-stg-ex | Primary product |`

---

### 7.2. `choice.bs-point-{env}-ex` — Ponta Bitcoin 牧場 (Farm Game)

| Thuộc tính | Giá trị |
|------------|---------|
| **Terraform resource** | `aws_s3_bucket.choice` |
| **DEV** | `choice.bs-point-dev-ex` |
| **STG** | `choice.bs-point-stg-ex` |
| **ACL** | Không có (BucketOwnerEnforced) |
| **Public Access Block** | Block tất cả |
| **Versioning** | Enabled |
| **Bucket Policy** | Giống pattern `s3.tf` (Allow OAI + Deny Put/Delete) |

**Mục đích (Evidence từ code):**
- Phục vụ path `/farm-game/*` trên CloudFront.
- `bs-game-front` deploy trực tiếp đến bucket này.

**Evidence deploy:**
```bash
# bs-game-front/deploy/env/dev
DEPLOY_AWS_S3_BUCKET=choice.bs-point-dev-ex
DEPLOY_AWS_CLOUDFRONT_DISTRIBUTION_ID=E1K6SY01O8V7JV

# bs-game-front/deploy/env/stg
DEPLOY_AWS_S3_BUCKET=choice.bs-point-stg-ex
DEPLOY_AWS_CLOUDFRONT_DISTRIBUTION_ID=E2C1CVQWGCIC1T
```

**Evidence path mapping:**
- `bs-game-front/frontend/next.config.ts`: `basePath: "/farm-game"`, `assetPrefix: "/farm-game"`
- `bs-game-front/frontend/package.json`: `"postbuild": "mkdir -p farm-game && mv -v out/* farm-game/"`
- `bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf:111-139` (`/farm-game/*` → `s3_choice_origin`)
- `docs/sprints/sprint-23/maintenance-split/INVESTIGATION.md:98`: `| /farm-game/* | Ponta Bitcoin 牧場 (gaming) | choice.bs-point-stg-ex | Distinct branding |`

---

### 7.3. `exchange.bs-point-{env}-ex` — Exchange Product SPA

| Thuộc tính | Giá trị |
|------------|---------|
| **Terraform resource** | `aws_s3_bucket.exchange` |
| **DEV** | `exchange.bs-point-dev-ex` |
| **STG** | `exchange.bs-point-stg-ex` |
| **ACL** | Không có (BucketOwnerEnforced) |
| **Public Access Block** | Block tất cả |
| **Versioning** | Enabled |
| **Bucket Policy** | Giống pattern `s3.tf` (Allow OAI + Deny Put/Delete) |

**Mục đích (Evidence từ code):**
- Phục vụ path `/exchange/*` trên CloudFront.
- `bs-exchange-front` deploy đến bucket này, subdirectory `/exchange/`.

**Evidence deploy:**
```bash
# bs-exchange-front/deploy/env/dev
DEPLOY_AWS_S3_BUCKET=exchange.bs-point-dev-ex/exchange/
DEPLOY_AWS_CLOUDFRONT_DISTRIBUTION_ID=E1K6SY01O8V7JV

# bs-exchange-front/deploy/env/stg
DEPLOY_AWS_S3_BUCKET=exchange.bs-point-stg-ex/exchange/
DEPLOY_AWS_CLOUDFRONT_DISTRIBUTION_ID=E2C1CVQWGCIC1T
```

**Evidence path mapping:**
- `bs-exchange-front/next.config.js`: `basePath: '/exchange'`
- `bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf:141-169` (`/exchange/*` → `s3_exchange_origin`)
- `docs/sprints/sprint-23/maintenance-split/INVESTIGATION.md:97`: `| /exchange/* | Exchange product | exchange.bs-point-stg-ex | Has its own design language |`

---

### 7.4. `doc.bs-point-{env}-ex` — Static Documents Bucket (NOT Swagger/OpenAPI)

| Thuộc tính | Giá trị |
|------------|---------|
| **Terraform resource** | `aws_s3_bucket.doc` |
| **DEV** | `doc.bs-point-dev-ex` |
| **STG** | `doc.bs-point-stg-ex` |
| **ACL** | Không có (BucketOwnerEnforced) |
| **Public Access Block** | Block tất cả |
| **Versioning** | Enabled |
| **Lifecycle** | Noncurrent version expiration sau 30 ngày (enabled) |
| **Replication** | Disabled (backup_enabled = false) |
| **Bucket Policy** | Allow OAI + Deny Put/Delete (bao gồm cả `doc_replication` role nếu enabled) |

**Mục đích: Lưu trữ tài liệu tĩnh (static documents). KHÔNG PHẢI Swagger/OpenAPI.**

**Bác bỏ claim "Swagger / OpenAPI":**

Claim trong `docs/sprints/sprint-23/maintenance-split/EXECUTIVE_RISK_SUMMARY.md:39` nói `/doc/*` "hosting Swagger / OpenAPI documentation" là **không chính xác**. Evidence sau chứng minh Swagger được serve động qua ALB, không phải từ S3 `doc` bucket:

1. **Backend serve Swagger động qua ALB tại `/app/swagger-ui.html`:**
   - `bs-integration-server/point-app/src/main/resources/application.yaml:323-332`:
     ```yaml
     springdoc:
       swagger-ui:
         path: /app/swagger-ui.html
         enabled: true
       api-docs:
         path: /app/v3/api-docs
         enabled: true
     ```
   - `bs-integration-server/point-app/src/main/java/point/app/config/WebSecurityConfig.java` whitelist: `/app/swagger-ui.html`, `/app/swagger-ui/**`, `/app/v3/api-docs`, `/app/v3/api-docs/**`
   - `docs/guides/api-system-architecture.en.md:713`: `point-app` exposes Swagger UI at `/app/swagger-ui.html` (whitelisted, public).

2. **Reference architecture (bs-point-infra) cũng route Swagger paths đến ALB:**
   - `bs-point-infra/terraform/components/frontend-customer/cloudfront.tf:326-426`: Tất cả swagger paths (`/swagger-ui.html`, `/webjars/*`, `/swagger-resources/*`) đều có `target_origin_id = "alb_origin"`, không phải S3.

3. **Không có build/deploy script nào đẩy swagger static HTML lên `doc.bs-point-*`** trong toàn bộ codebase.

**Mô tả chính xác từ investigation:**
- `docs/sprints/sprint-23/maintenance-split/INVESTIGATION.md:99`: `| /doc/* | Documentation | doc.bs-point-stg-ex | Static docs |`

**Kết luận:**
- `doc.bs-point-{env}-ex` là một **generic static documents bucket** — có thể dùng cho legal docs, user guides, release notes, hoặc các tài liệu tĩnh khác.
- Nội dung cụ thể hiện tại **không xác định được từ code/build evidence** (không có frontend repo hoặc deploy script tương ứng).
- Đặc điểm khác biệt so với các S3 origin khác: behavior `/doc/*` **KHÔNG gắn Lambda@Edge `subdirectory-index`**, cho thấy nội dung có thể là files tĩnh đơn lẻ không cần rewrite `/` → `/index.html`.

**Evidence:**
- `bs-exchange-infra/terraform/components/frontend-customer/s3-doc.tf`
- `bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf:201-223` (`/doc/*` → `s3_doc_origin`, **no Lambda@Edge**)
- `bs-point-infra/terraform/components/frontend-customer/cloudfront.tf:326-426` (swagger paths → `alb_origin`)

---

### 7.5. `maintenance.bs-point-{env}-ex` — Maintenance Page Bucket

| Thuộc tính | Giá trị |
|------------|---------|
| **Terraform resource** | `data.aws_s3_bucket.maintenance` (lookup, không tạo) |
| **DEV** | `maintenance.bs-point-dev-ex` |
| **STG** | `maintenance.bs-point-stg-ex` |
| **Bucket tạo bởi component** | `s3-maintenance` |
| **Bucket Policy apply bởi** | `frontend-customer/s3-maintenance.tf` |
| **Public Access Block** | Managed by `s3-maintenance` component |
| **Versioning** | Managed by `s3-maintenance` component |

**Mục đích (Evidence từ code):**
- Phục vụ path `/maintenance/*` trên CloudFront.
- Chứa static HTML pages hiển thị khi hệ thống ở maintenance mode.
- **Không có frontend repo nào deploy trực tiếp đến bucket này qua CI/CD.** Nội dung được quản lý thủ công hoặc qua `s3-maintenance` component.

**Evidence nội dung:**
- `ex_static/exchange/maintenance/index.html` — BACKSEAT brand maintenance page
- `ex_static/game/maintenance/index.html` — Ponta 牧場 brand maintenance page
- `ex_static/point/maintenance/index.html` — BACKSEAT responsive maintenance page

**Evidence path mapping:**
- `bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf:171-199` (`/maintenance/*` → `s3_maintenance_origin`)
- `bs-exchange-infra/terraform/components/frontend-customer/s3-maintenance.tf`

---

### 7.6. `logs.bs-point-{env}-ex` (Log bucket)

| Thuộc tính | Giá trị |
|------------|---------|
| **Terraform resource** | `data.aws_s3_bucket.log` (lookup, không tạo) |
| **DEV** | `logs.bs-point-dev-ex` |
| **STG** | `logs.bs-point-stg-ex` |

**Evidence:** `bs-exchange-infra/terraform/components/frontend-customer/data.tf:13-15`

---

## 8. Response Headers Policies

### 8.1. `static_html_header`
**Dùng cho:** Tất cả S3-origin behaviors (default, `/farm-game/*`, `/exchange/*`, `/maintenance/*`, `/doc/*`)

Security headers:
- `X-Content-Type-Options: nosniff` (override)
- `X-Frame-Options: SAMEORIGIN` (override)
- `X-XSS-Protection: 1; mode=block` (override)
- `Strict-Transport-Security: max-age=63072000; preload` (override, **không** includeSubDomains)

Custom header:
- `Server: Z`

**Evidence:** `bs-exchange-infra/terraform/components/frontend-customer/cloudfront_policy.tf:5-36`

### 8.2. `server_header`
**Dùng cho:** ALB-origin behaviors (`/app/*`, `/api/*`, `/websocket`)

Security headers:
- `X-Content-Type-Options: nosniff` (override)

Custom header:
- `Server: Z`

**Evidence:** `bs-exchange-infra/terraform/components/frontend-customer/cloudfront_policy.tf:38-55`

---

## 9. WAF Integration

| Thuộc tính | Giá trị |
|------------|---------|
| **WebACL Name** | `point-cloudfront-customer` |
| **Scope** | CLOUDFRONT |
| **Region** | us-east-1 |
| **Geo restriction** | Không có ở CloudFront level (`restriction_type = "none"`) |
| **Geo blocking** | Xử lý bởi WAF rule `country_restrict` (whitelist JP, CN, HK, US trên DEV/STG) |

**Lý do không dùng CloudFront geo restriction:** Comment trong code nói rõ — để đảm bảo mọi request bị block đều được log vào WAF logs.

**Evidence:**
- `bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf:295-302`
- `bs-exchange-infra/terraform/components/frontend-customer/data.tf:25-29`
- `bs-exchange-infra/terraform/components/waf-customer/module-waf/acl.tf`

---

## 10. DNS và Certificate

### 10.1. Route53 Record
```hcl
resource "aws_route53_record" "this" {
  zone_id = data.aws_route53_zone.this[0].zone_id
  name    = var.cloudfront_domain
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}
```

### 10.2. ACM Certificate
```hcl
data "aws_acm_certificate" "this" {
  provider = aws.us
  domain   = "*.backseat-service.com"
  statuses = ["ISSUED"]
}
```

**Evidence:**
- `bs-exchange-infra/terraform/components/frontend-customer/route53.tf`
- `bs-exchange-infra/terraform/components/frontend-customer/data.tf:1-5`

---

## 11. Mapping: Frontend Repo -> S3 Bucket -> CloudFront Path

| CloudFront Path | S3 Bucket | Frontend Repo | Framework | Base Path |
|-----------------|-----------|---------------|-----------|-----------|
| `*` (default) | `point.bs-point-{env}-ex` | `bs-point-front` | Next.js | `/` (không set basePath) |
| `/farm-game/*` | `choice.bs-point-{env}-ex` | `bs-game-front` | Next.js | `/farm-game` |
| `/exchange/*` | `exchange.bs-point-{env}-ex` | `bs-exchange-front` | Next.js 12 | `/exchange` |
| `/maintenance/*` | `maintenance.bs-point-{env}-ex` | Không có CI/CD auto-deploy | Static HTML | — |
| `/doc/*` | `doc.bs-point-{env}-ex` | Không tìm thấy repo/deploy script | Static documents (generic) | — |

**Evidence chi tiết:**

### 11.1. `bs-point-front` → `point.bs-point-{env}-ex`
- `bs-point-front/deploy/env/dev`: `DEPLOY_AWS_S3_BUCKET=point.bs-point-dev-ex`
- `bs-point-front/deploy/env/stg`: `DEPLOY_AWS_S3_BUCKET=point.bs-point-stg-ex`
- `bs-point-front/next.config.js`: Không có `basePath` (default `/`)

### 11.2. `bs-game-front` → `choice.bs-point-{env}-ex`
- `bs-game-front/deploy/env/dev`: `DEPLOY_AWS_S3_BUCKET=choice.bs-point-dev-ex`
- `bs-game-front/deploy/env/stg`: `DEPLOY_AWS_S3_BUCKET=choice.bs-point-stg-ex`
- `bs-game-front/frontend/next.config.ts`: `basePath: "/farm-game"`, `assetPrefix: "/farm-game"`
- `bs-game-front/frontend/package.json`: `"postbuild": "mkdir -p farm-game && mv -v out/* farm-game/"`

### 11.3. `bs-exchange-front` → `exchange.bs-point-{env}-ex`
- `bs-exchange-front/deploy/env/dev`: `DEPLOY_AWS_S3_BUCKET=exchange.bs-point-dev-ex/exchange/`
- `bs-exchange-front/deploy/env/stg`: `DEPLOY_AWS_S3_BUCKET=exchange.bs-point-stg-ex/exchange/`
- `bs-exchange-front/next.config.js`: `basePath: '/exchange'`

### 11.4. `bs-admin-front` — **KHÔNG thuộc `frontend-customer`**
- `bs-admin-front` deploy đến bucket riêng: `admin.bs-point-dev-ex` / `admin.bs-point-stg-ex`
- CloudFront distribution ID riêng: `E3LZQ1PTPQC053` (dev), `E2DK8XRG9W1KY4` (stg)
- Domain riêng: `bo-dev-ex.backseat-service.com`, `bo-stg-ex.backseat-service.com`
- **Không nằm trong `frontend-customer` component.**

**Evidence:**
- `bs-admin-front/deploy/env/dev`
- `bs-admin-front/deploy/env/stg`

---

## 12. Mapping: Backend -> ALB -> CloudFront Path

### 12.1. Ingress Kubernetes
File: `bs-exchange-infra/k8s-manifests/point/dev-ex/ingress.yaml` (và tương tự cho STG)

```yaml
spec:
  tls:
    - hosts:
        - "*.backseat-service.com"
  rules:
    - http:
        paths:
          - path: /admin
            backend: point-admin-service:8080
          - path: /api
            backend: point-api-service:8080
          - path: /app
            backend: point-app-service:8080
          - path: /websocket
            pathType: Exact
            backend: point-app-service:8080
```

### 12.2. CloudFront -> ALB mapping
| CloudFront Path | K8s Service | Backend Module | Ghi chú |
|-----------------|-------------|----------------|---------|
| `/app/*` | `point-app-service` | `point-app` | Forward cookies `_atnct`, `adm_adtr_xuid` |
| `/api/*` | `point-api-service` | `point-api` | Header-based API key auth, no cookies |
| `/websocket` | `point-app-service` | `point-app` | Exact match, WebSocket |

### 12.3. Swagger/OpenAPI (Backend)
- **Path thực tế:** `/app/swagger-ui.html` và `/app/v3/api-docs`
- **Serve bởi:** `point-app` module qua ALB (dynamic, không phải S3 static)
- **Framework:** springdoc-openapi-ui 1.7.0
- **Config:** `bs-integration-server/point-app/src/main/resources/application.yaml:323-332`

**Evidence:** `bs-exchange-infra/k8s-manifests/point/dev-ex/ingress.yaml`

---

## 13. Cross-Component Dependencies

### 13.1. frontend-customer PHỤ THUỘC vào:
| Dependency | Mechanism | File |
|------------|-----------|------|
| `waf-customer` component | `data.aws_wafv2_web_acl.this` | `data.tf:25-29` |
| `s3-maintenance` component | `data.aws_s3_bucket.maintenance` | `data.tf:21-23` |
| ALB `point-alb` | `data.aws_lb.point-alb` | `data.tf:17-19` |
| Log bucket | `data.aws_s3_bucket.log` | `data.tf:13-15` |
| ACM Certificate | `data.aws_acm_certificate.this` | `data.tf:1-5` |
| IAM Roles | `data.aws_iam_role.custodian_admin`, `bastion`, `cicd` | `data.tf:39-50` |

### 13.2. Các component PHỤ THUỘC vào frontend-customer:
| Dependent | Dependency | File |
|-----------|------------|------|
| `frontend-admin` | Response headers policies `static_html_header`, `server_header` | `frontend-admin/module-for-cloudfront/data.tf` |

**Chú ý quan trọng:** `frontend-admin` lookup policies bằng tên. Comment trong `frontend-admin/cloudfront.tf`: "レスポンスヘッダーポリシーは顧客画面で設定されたものを使用する。このディレクトリで terraform apply する前に顧客画面を先に apply する必要がある。"

**Evidence:**
- `bs-exchange-infra/terraform/components/frontend-admin/module-for-cloudfront/data.tf`
- `bs-exchange-infra/terraform/components/frontend-admin/module-for-cloudfront/cloudfront.tf`

---

## 14. Environment Matrix

| Variable | DEV-EX | STG-EX | Source File |
|----------|--------|--------|-------------|
| `cloudfront_domain` | `dev-ex.backseat-service.com` | `stg-ex.backseat-service.com` | `tfvars/dev-ex.tfvars`, `tfvars/stg-ex.tfvars` |
| `cloudfront_certificate` | `*.backseat-service.com` | `*.backseat-service.com` | `tfvars/dev-ex.tfvars`, `tfvars/stg-ex.tfvars` |
| `cloudfront_logging_bucket` | `logs.bs-point-dev-ex` | `logs.bs-point-stg-ex` | `tfvars/dev-ex.tfvars`, `tfvars/stg-ex.tfvars` |
| `point_alb` | `point-alb` | `point-alb` | `terraform.tfvars` |
| `point_alb_timeout` | `60` | `60` | `tfvars/dev-ex.tfvars`, `tfvars/stg-ex.tfvars` |
| `s3_maintenance_bucket` | `maintenance.bs-point-dev-ex` | `maintenance.bs-point-stg-ex` | `tfvars/dev-ex.tfvars`, `tfvars/stg-ex.tfvars` |
| `s3_bucket` | `point.bs-point-dev-ex` | `point.bs-point-stg-ex` | `tfvars/dev-ex.tfvars`, `tfvars/stg-ex.tfvars` |
| `s3_choice_bucket` | `choice.bs-point-dev-ex` | `choice.bs-point-stg-ex` | `tfvars/dev-ex.tfvars`, `tfvars/stg-ex.tfvars` |
| `s3_exchange_bucket` | `exchange.bs-point-dev-ex` | `exchange.bs-point-stg-ex` | `tfvars/dev-ex.tfvars`, `tfvars/stg-ex.tfvars` |
| `s3_doc_bucket` | `doc.bs-point-dev-ex` | `doc.bs-point-stg-ex` | `tfvars/dev-ex.tfvars`, `tfvars/stg-ex.tfvars` |
| `app_tg_arn` | `arn:aws:elasticloadbalancing:ap-northeast-1:845131030484:targetgroup/k8s-default-pointapp-00690797ce/4a7a0b77c8b3a8b5` | `arn:aws:elasticloadbalancing:ap-northeast-1:520411743393:targetgroup/k8s-default-pointapp-c3b3c249b9/04276831369259da` | `tfvars/dev-ex.tfvars`, `tfvars/stg-ex.tfvars` |
| `waf_webacl_name` | `point-cloudfront-customer` | `point-cloudfront-customer` | `terraform.tfvars` |
| `create_route53_record` | `true` | `true` | `tfvars/dev-ex.tfvars`, `tfvars/stg-ex.tfvars` |
| `route53_domain` | `dev-ex.backseat-service.com` | `stg-ex.backseat-service.com` | `tfvars/dev-ex.tfvars`, `tfvars/stg-ex.tfvars` |
| `s3_doc_expiration_enabled` | `true` | `true` | `tfvars/dev-ex.tfvars`, `tfvars/stg-ex.tfvars` |
| `s3_doc_expiration_days` | `30` | `30` | `tfvars/dev-ex.tfvars`, `tfvars/stg-ex.tfvars` |
| `s3_doc_backup_enabled` | `false` | `false` | `tfvars/dev-ex.tfvars`, `tfvars/stg-ex.tfvars` |
| `s3_doc_backup_region` | `ap-northeast-3` | `ap-northeast-3` | `tfvars/dev-ex.tfvars`, `tfvars/stg-ex.tfvars` |

---

## 15. Maintenance Mode Context

Maintenance mode hiện tại (trên nhánh `main`):
- WAF rule group: `point-cloudfront-customer-maintenance-rulegroup` (capacity 15, 6 rules)
- Lambda toggle: `waf-maintenance-lambda` inject/remove rule group khỏi WebACL
- Maintenance S3 origin phục vụ HTML page tại `/maintenance/*`
- Sprint-23 đang implement **independent per-brand toggle** (split exchange vs point) trên branch `feat/maintenance-split`

**Evidence:**
- `docs/guides/maintenance-mode-api-impact.en.md`
- `docs/sprints/sprint-23/maintenance-split/CODE_WALKTHROUGH.md`
- `bs-exchange-infra/terraform/components/waf-customer/module-waf/rulegroup-maintenance.tf`

---

## 16. Ghi chú về Security

1. **Bucket policies** đều có `DenyPutDeleteUnlessAdminBastionCicd` statement — deny tất cả Put/Delete actions trừ khi principal là một trong 3 IAM roles: `custodian-AdministratorRole`, `point-bastion-role`, `custodian-CICDRole`.
2. **S3 Object Ownership** = `BucketOwnerEnforced` (ACLs disabled) trên tất cả buckets được tạo bởi component này.
3. **Public Access Block** = block all trên tất cả buckets.
4. **CloudFront OAI** dùng chung cho tất cả S3 origins (trừ log bucket).

---

## 17. Discrepancies Đã Phát Hiện

### 17.1. `/doc/*` bucket purpose — Claim "Swagger / OpenAPI" là không chính xác
- **Claim sai:** `EXECUTIVE_RISK_SUMMARY.md:39` và `CODE_WALKTHROUGH_EN.html` nói `doc.bs-point-*` "hosting Swagger / OpenAPI documentation".
- **Evidence bác bỏ:**
  - Backend `point-app` serve Swagger động qua ALB tại `/app/swagger-ui.html` (`application.yaml:323-332`, `WebSecurityConfig.java` whitelist).
  - Reference architecture `bs-point-infra` cũng route tất cả swagger paths (`/swagger-ui.html`, `/webjars/*`, `/swagger-resources/*`) đến `alb_origin`, không phải S3 (`cloudfront.tf:326-426`).
  - Không có build/deploy script nào trong codebase đẩy swagger static files lên `doc` bucket.
- **Kết luận đúng:** `doc.bs-point-*` là một **generic static documents bucket** (legal docs, user guides, release notes, v.v.). Mục đích chính xác chưa xác định được từ code/build evidence. `INVESTIGATION.md:99` mô tả đúng hơn: `Documentation | Static docs`.

### 17.2. Lambda@Edge không gắn vào `/doc/*`
- `/doc/*` là S3 origin duy nhất **không có** Lambda `subdirectory-index`. Request `/doc/` (trailing slash) sẽ không được rewrite thành `/doc/index.html`.

---

*Document generated from direct file reads and codebase analysis. All claims are backed by specific file paths and line references. Discrepancies are explicitly noted where evidence contradicts documentation.*
