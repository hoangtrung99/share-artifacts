# Hướng dẫn Biến Môi Trường & Công cụ Infrastructure - Verup Project

> Tài liệu tổng hợp toàn bộ biến môi trường (environment variables) được sử dụng trong server (`bs-integration-server`) và infra (`bs-exchange-infra`), kèm hướng dẫn sử dụng tất cả scripts/tools.
>
> Cập nhật: 2026-03-12

---

## Mục lục

- [Phần A: Biến Môi Trường](#phần-a-biến-môi-trường)
  - [I. Server Project (bs-integration-server)](#i-server-project-bs-integration-server)
    - [1. Database — Aurora MySQL (Master)](#1-database--aurora-mysql-master)
    - [2. Database — Redshift (Historical)](#2-database--redshift-historical)
    - [3. Redis (Cache & Session)](#3-redis-cache--session)
    - [4. AWS Services](#4-aws-services)
    - [5. JWT & Authentication](#5-jwt--authentication)
    - [6. External Service Integrations](#6-external-service-integrations)
    - [7. Application Config](#7-application-config)
    - [8. Monitoring & Metrics](#8-monitoring--metrics)
    - [9. Trading — Amber / OKCoin](#9-trading--amber--okcoin)
    - [10. Các config khác](#10-các-config-khác)
  - [II. Infra Project (bs-exchange-infra/k8s-manifests)](#ii-infra-project-bs-exchange-infrak8s-manifests)
    - [1. Deployment ENV vars](#1-deployment-env-vars)
    - [2. K8s Secrets (point-secrets)](#2-k8s-secrets-point-secrets)
    - [3. CloudWatch Agent](#3-cloudwatch-agent)
    - [4. Fluent Bit (Log Shipping)](#4-fluent-bit-log-shipping)
    - [5. AWS Load Balancer Controller](#5-aws-load-balancer-controller)
  - [III. Luồng quản lý Secrets](#iii-luồng-quản-lý-secrets)
- [Phần B: Công cụ & Scripts](#phần-b-công-cụ--scripts)
  - [I. K8s Manifests Scripts](#i-k8s-manifests-scripts)
    - [1. k8s_apply.sh — Triển khai toàn bộ K8s](#1-k8s_applysh--triển-khai-toàn-bộ-k8s)
    - [2. fetch_credentials.sh — Đồng bộ Secrets](#2-fetch_credentialssh--đồng-bộ-secrets)
    - [3. apply_secrets.sh — Wrapper cho fetch_credentials](#3-apply_secretssh--wrapper-cho-fetch_credentials)
    - [4. rehearsal_secrets.sh](#4-rehearsal_secretssh)
  - [II. Terraform Scripts](#ii-terraform-scripts)
    - [1. terraform.sh — Wrapper chính](#1-terraformsh--wrapper-chính)
    - [2. execute.sh — Multi-component executor](#2-executesh--multi-component-executor)
  - [III. Database User Management](#iii-database-user-management)
    - [1. Aurora Scripts](#1-aurora-scripts)
    - [2. Redshift Scripts](#2-redshift-scripts)
    - [3. Shared Libraries](#3-shared-libraries)
  - [IV. Lambda Build Scripts](#iv-lambda-build-scripts)
  - [V. EC2 User Data Scripts](#v-ec2-user-data-scripts)
  - [VI. Bash Utility Library](#vi-bash-utility-library)
- [Phần C: Lưu ý Bảo mật](#phần-c-lưu-ý-bảo-mật)

---

# Phần A: Biến Môi Trường

## I. Server Project (`bs-integration-server`)

Server gồm 5 module Spring Boot: `point-api`, `point-admin`, `point-app`, `point-worker`, `point-mmh`.
Cấu hình theo profile: `application.yaml` (base) + `application-{dev,stg,prd}.yaml` (override theo môi trường).

### 1. Database — Aurora MySQL (Master)

Database chính chứa toàn bộ dữ liệu nghiệp vụ (user, transaction, order...).

| Biến | Giá trị | Mục đích |
|------|---------|----------|
| `SPRING_DATASOURCE_MASTER_URL` | AWS Secrets Manager | JDBC connection string tới Aurora MySQL |
| `SPRING_DATASOURCE_MASTER_USERNAME` | AWS Secrets Manager | Username kết nối DB |
| `SPRING_DATASOURCE_MASTER_PASSWORD` | AWS Secrets Manager | Password kết nối DB |
| `spring.datasource.master.driver-class-name` | `org.mariadb.jdbc.Driver` | JDBC driver (dùng MariaDB driver cho Aurora MySQL) |
| `spring.datasource.master.maximum-pool-size` | `66` (base), `150` (dev/stg) | Số connection tối đa trong HikariCP pool |
| `spring.datasource.master.minimum-idle` | `10` | Số connection idle tối thiểu giữ sẵn |
| `spring.datasource.master.max-lifetime` | `600000` (10 phút) | Thời gian sống tối đa của 1 connection |
| `spring.datasource.master.idle-timeout` | `500000` (~8 phút) | Timeout cho connection idle |
| `spring.datasource.master.leak-detection-threshold` | `5000` (5 giây) | Ngưỡng phát hiện connection bị leak (không trả về pool) |

**Connection string format (local dev):**
```
jdbc:mysql://localhost:3308/point?zeroDateTimeBehavior=convertToNull&allowPublicKeyRetrieval=true
```

### 2. Database — Redshift (Historical)

Lưu trữ dữ liệu lịch sử (archived data) cho báo cáo và phân tích. Dùng driver PostgreSQL-compatible.

| Biến | Giá trị | Mục đích |
|------|---------|----------|
| `SPRING_DATASOURCE_HISTORICAL_URL` | AWS Secrets Manager | JDBC connection string tới Redshift |
| `SPRING_DATASOURCE_HISTORICAL_USERNAME` | AWS Secrets Manager | Username Redshift |
| `SPRING_DATASOURCE_HISTORICAL_PASSWORD` | AWS Secrets Manager | Password Redshift |
| `spring.datasource.historical.driver-class-name` | `com.amazon.redshift.jdbc42.Driver` | JDBC driver cho Redshift |
| `spring.datasource.historical.maximum-pool-size` | `66` (base), `150` (dev/stg) | Số connection tối đa |

**Connection string format (local dev):**
```
jdbc:postgresql://localhost:5439/point
```

### 3. Redis (Cache & Session)

Dùng cho cache dữ liệu (giá, ticker), session user, và PubSub cho WebSocket real-time.

| Biến | Giá trị | Mục đích |
|------|---------|----------|
| `SPRING_DATA_REDIS_HOST` | AWS Secrets Manager | ElastiCache Redis endpoint |
| `SPRING_DATA_REDIS_PORT` | `6379` | Port Redis chuẩn |
| `spring.session.store-type` | `redis` (app/admin) / `none` (api/worker) | Loại session store — app và admin dùng Redis session, api/worker không cần |
| `exchange-websocket.redis-pubsub-cache.enabled` | `true` | Bật cache qua Redis PubSub |
| `exchange-websocket.redis-pubsub-cache.expire-in-minutes` | `5` | Thời gian hết hạn cache PubSub |

### 4. AWS Services

| Biến | Giá trị | Mục đích |
|------|---------|----------|
| `cloud.aws.region.static` | `ap-northeast-1` | AWS Region (Tokyo) |
| `cloud.aws.credentials.use-default-aws-credentials-chain` | `false` | Không dùng default credential chain — dùng instance profile hoặc env var |
| `aws.s3.kyc-bucket.name` | `kyc.bs-point-{env}-ex` | S3 bucket lưu trữ tài liệu KYC (xác minh danh tính) |
| `aws.s3.year-report-bucket.name` | `year-report.bs-point-{env}-ex` | S3 bucket lưu báo cáo năm (thuế, giao dịch) |
| `AWS_SES_HOST` | `email-smtp.ap-northeast-1.amazonaws.com` | SMTP host cho SES — gửi email transactional |
| `AWS_SES_PORT` | `587` | SMTP TLS port |
| `AWS_SES_USERNAME` | AWS Secrets Manager | SMTP credentials |
| `AWS_SES_PASSWORD` | AWS Secrets Manager | SMTP credentials |
| `AWS_CREDENTIALS_SALT` | AWS Secrets Manager | Salt dùng mã hoá credentials nội bộ |

### 5. JWT & Authentication

Chỉ áp dụng cho `point-app` (customer-facing).

| Biến | Giá trị | Mục đích |
|------|---------|----------|
| `jwt.issuer` | `bs-point-server` | Tên issuer ghi trong JWT token |
| `jwt.secret` | `0123456789` (dev) / Secrets Manager (stg/prd) | Khoá bí mật ký JWT |
| `jwt.token-ttl` | `7600` giây (~2 giờ) | Thời gian sống access token |
| `jwt.refresh-token-ttl` | `604800` giây (7 ngày) | Thời gian sống refresh token |
| `jwt.cache-token-ttl` | `604800` giây (7 ngày) | TTL cache token trong Redis |
| `point-common.account-lock.max-attempt` | `5` | Khoá tài khoản sau N lần login sai |
| `point-common.account-lock.expire-seconds` | `0` | Thời gian khoá (0 = vĩnh viễn cho đến khi admin mở) |
| `customer.forgot-password.token.forgot-effective-time` | `600000` ms (10 phút) | Link reset password hết hạn |
| `customer.login-password.token.effective-time` | `86400000` ms (24 giờ) | Token xác nhận tạo tài khoản hết hạn |
| `customer.register.enabled` | `true` | Bật/tắt đăng ký tài khoản mới |
| `customer.fiat-withdrawal.user-daily-withdrawal-limit` | `30000000` | Giới hạn rút tiền fiat/ngày (JPY) |
| `spring.recaptcha.secret-key` | hardcoded | Google reCAPTCHA v3 chống bot |

### 6. External Service Integrations

Các dịch vụ bên thứ 3 tích hợp vào hệ thống.

| Service | Biến chính | Mục đích |
|---------|-----------|----------|
| **GMO Aozora Bank** | `gmo.client-id`, `gmo.secret`, `gmo.stg-base-endpoint` | Tích hợp ngân hàng — nạp/rút JPY qua API ngân hàng |
| **Ponta** | `ponta.partner-number`, `ponta.keystore-password`, `ponta.login-url` | Chương trình loyalty point — tích điểm Ponta cho customer |
| **Refinitiv World-Check** | `refinitiv.api-key`, `refinitiv.secret-key`, `refinitiv.group-id` | AML/KYC screening — kiểm tra danh sách cấm vận, PEP |
| **EKYC (NextWay)** | `ekyc.secret`, `ekyc.token`, `ekyc.api-auth-key` | Xác minh danh tính điện tử (chụp CCCD/hộ chiếu) |
| **Chainalysis** | `chainalysis.token`, `chainalysis.alert-level-limit` | Giám sát blockchain — phát hiện giao dịch crypto đáng ngờ |
| **Sygna Hub** | `sygna.account`, `sygna.credential`, `sygna.hub-base-url` | Travel Rule compliance — tuân thủ quy định chuyển tiền crypto quốc tế |
| **Fireblocks** | `fireblocks.apiKey`, `fireblocks.secretKey`, `fireblocks.publicKey` | Quản lý ví custodian (hot/cold wallet) — tất cả qua Secrets Manager |
| **Wallet Gateway** | `wallet.client-id`, `wallet.apiKey`, `wallet.base-url` | Gateway nội bộ quản lý ví crypto user |
| **OKCoin** | `dealing.okcoin.apiKey`, `dealing.okcoin.secret` | Liquidity provider — thực hiện giao dịch cover trên sàn |
| **Amber (WhaleFin)** | `point-pos.best-price.amber.access-key/secret` | RFQ (Request for Quote) và spot order với liquidity provider |
| **SMS (CPAAS)** | `sms.host`, `sms.token` | Gửi SMS xác thực OTP |

**Lưu ý về Fireblocks Asset IDs theo môi trường:**
- **Dev/Stg (testnet):** `ADA_TEST`, `BTC_TEST`, `ETH_TEST5`, `XRP_TEST`, `NIDT_B75VRLGX_0A1F`
- **Prd (mainnet):** `ADA`, `BTC`, `ETH`, `XRP`, `NIDT`

### 7. Application Config

| Biến | Giá trị | Mục đích |
|------|---------|----------|
| `server.port` | `8080` | Port chính của application |
| `management.port` | `8082` | Port cho health check / Spring Actuator endpoint |
| `ENVIRONMENT` (Docker) | `dev` / `stg` / `prd` | Biến Docker truyền vào, kích hoạt Spring profile tương ứng |
| `spring.config.environment` | `dev` / `stg` / `prd` | Tên môi trường trong config |
| `async.core-pool-size` | `60` (api/admin/app), `85` (worker) | Kích thước thread pool cho async task |
| `point-app.allowed-origin` | Domain theo env | CORS whitelist — domain nào được gọi API |
| `point-app.debug-response` | `true` (dev), `false` (stg/prd) | Trả thêm debug info trong response (chỉ dev) |
| `point-app.security.enable-invest-login-whitelist` | `true` | Bật whitelist IP cho login đầu tư |
| `spring.jpa.hibernate.ddl-auto` | `validate` (local), `none` (dev/stg/prd) | DDL strategy — `none` = không tự động tạo/sửa schema |
| `swagger.enabled` | `true` (dev), `false` (prd) | Bật/tắt Swagger UI |
| `spring.servlet.multipart.max-file-size` | `16MB` | Giới hạn upload file |
| `spring.servlet.multipart.max-request-size` | `17MB` | Giới hạn tổng kích thước request |

**`spring.config.domain` — Định danh môi trường (KHÔNG phải endpoint URL):**

Giá trị `domain` trong `spring.config` chủ yếu dùng làm label cho MFA TOTP URI (Google Authenticator). Đây KHÔNG phải domain endpoint thực tế của service.

| Module | DEV | STG | PRD |
|--------|-----|-----|-----|
| point-api | `api.dev.cxr-inc.com` | `api.stg.cxr-inc.com` | `backseat-service.com` |
| point-admin | `admin.dev.cxr-inc.com` | `admin.stg.cxr-inc.com` | `backseat-service.com` |
| point-app | `dev.backseat-service.com` | `stg.backseat-service.com` | `backseat-service.com` |
| point-worker | `worker.dev.cxr-inc.com` | `worker.stg.cxr-inc.com` | `backseat-service.com` |
| point-mmh | `worker.dev.cxr-inc.com` | `worker.stg.cxr-inc.com` | `backseat-service.com` |

**Các domain thực tế dùng cho CORS, redirect, email link:**

| Config Key | Mục đích | Ví dụ DEV |
|------------|----------|-----------|
| `point-app.allowed-origin` | CORS whitelist | `https://dev-ex.backseat-service.com` |
| `point-app.email.account-created.base-url` | Link trong email đăng ký | `https://dev-ex.backseat-service.com/farm-game/farm/...` |
| `point-app.email.forgot-password.base-url` | Link reset password | `https://dev-ex.backseat-service.com/signIn/reset/...` |
| `ponta.login-success-url` | OAuth callback URL | `https://dev-ex.backseat-service.com/oauth/callback/` |
| `point-admin.host` | Admin panel base URL | `https://admin.dev.cxr-inc.com` |

### 8. Monitoring & Metrics

| Biến | Giá trị | Mục đích |
|------|---------|----------|
| `management.metrics.export.cloudwatch.enabled` | `false` (default) | Bật/tắt push metrics lên CloudWatch |
| `management.metrics.export.cloudwatch.namespace` | `point-api` / `point-worker` ... | Namespace CloudWatch cho từng module |
| `management.metrics.export.cloudwatch.step` | `1m` | Interval push metrics |
| `management.metrics.web.server.request.metric-name` | `http.server.requests` | Tên metric cho HTTP request |
| Prometheus | Enabled (dev/stg) | Endpoint `/actuator/prometheus` cho scraping |

**Logging:**
| Config | Local | Dev/Stg/Prd | Mục đích |
|--------|-------|-------------|----------|
| Console appender | `CONSOLE_DEFAULT` | `CONSOLE_JSON` | Local dùng text, server dùng JSON (cho Fluent Bit parse) |
| `show-sql` | `true` | `false` | Log SQL query — chỉ bật local để debug |
| Hikari pool log | off | `DEBUG` | Log chi tiết connection pool ở server |

### 9. Trading — Amber / OKCoin

Cấu hình liquidity provider cho hệ thống POS (Point of Sale) trading.

| Biến | DEV | STG | PRD | Mục đích |
|------|-----|-----|-----|----------|
| `point-pos.best-price.amber.api-host` | `https://aws-private-alpha.whalefin.com` | Giống DEV | `https://be.whalefin.com` | Endpoint RFQ API |
| `point-pos.best-price.amber.access-key` | Hardcoded | Hardcoded | Secrets Manager | API key cho RFQ |
| `point-pos.base-trade.amber.api-host` | `https://aws-private-alpha.whalefin.com` | Giống DEV | `https://be.whalefin.com` | Endpoint Spot Order API |
| `point-pos.base-trade.coinbook.api-host` | `http://point-api-service.default.svc.cluster.local:8080` | Giống | Giống | Internal K8s service cho giao dịch nội bộ |

### 10. Các config khác

| Biến | Giá trị | Mục đích |
|------|---------|----------|
| `point-common.sns.expired_minute` | `60` | SMS OTP code hết hạn sau 60 phút |
| `ponta.otp-ttl` | `5` phút | Ponta OTP hết hạn |
| `ponta.transfer-fee` | `0.01` | Phí chuyển điểm Ponta |
| `data-request.max-size` | `500` | Giới hạn data request |
| `csv-download.max-records` | `5000` | Giới hạn records khi export CSV |
| `vote-reward.expire-unit` / `expire-date` | `YEAR` / `1` | Vote reward hết hạn sau 1 năm |
| `server.servlet.session.timeout` | `1d` | Session timeout 1 ngày |
| `server.servlet.session.cookie.max-age` | `7d` | Cookie sống 7 ngày |
| `exchange-websocket.subscription-limit-per-session` | `100` | Giới hạn WebSocket subscription/session |
| `hulft.snddata` / `hulft.rcvdata` | `/nfs/hulft/snddata` / `/nfs/hulft/rcvdata/` | Đường dẫn NFS cho HULFT file transfer (Ponta) |

---

## II. Infra Project (`bs-exchange-infra/k8s-manifests`)

Sử dụng **Kustomize** với base + overlay pattern:
- `point/base/` — template chung cho tất cả service
- `point/{dev-ex,stg-ex}/` — override theo từng môi trường

### 1. Deployment ENV vars

Được set trực tiếp trong deployment YAML của từng môi trường.

| Biến | DEV (`dev-ex`) | STG (`stg-ex`) | Mục đích |
|------|----------------|----------------|----------|
| `SPRING_PROFILES_ACTIVE` | `"dev"` | `"stg"` | Kích hoạt Spring profile tương ứng |
| `JAVA_TOOL_OPTIONS` | `-XX:MaxDirectMemorySize=100M -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=8000` | `-XX:MaxDirectMemorySize=500M` | **DEV**: bật remote debug trên port 8000, memory 100M. **STG**: tắt debug, memory 500M cho production-like load |

**Giải thích `JAVA_TOOL_OPTIONS`:**
- `-XX:MaxDirectMemorySize=100M/500M`: Giới hạn bộ nhớ direct (off-heap) mà JVM có thể allocate. STG cần nhiều hơn vì traffic gần production.
- `-agentlib:jdwp=...address=8000`: Bật Java Debug Wire Protocol — cho phép attach IDE debugger từ xa. **Chỉ dùng ở DEV**.

### 2. K8s Secrets (`point-secrets`)

Tất cả deployment đều inject secrets qua:
```yaml
envFrom:
  - secretRef:
      name: point-secrets
```

Các key trong Secret này (lấy từ AWS Secrets Manager):

| Key | Mục đích |
|-----|----------|
| `SPRING_DATA_REDIS_HOST` | Redis hostname |
| `SPRING_DATA_REDIS_PORT` | Redis port |
| `SPRING_DATASOURCE_MASTER_URL` | Aurora MySQL connection string |
| `SPRING_DATASOURCE_MASTER_USERNAME` | Aurora username |
| `SPRING_DATASOURCE_MASTER_PASSWORD` | Aurora password |
| `SPRING_DATASOURCE_HISTORICAL_URL` | Redshift connection string |
| `SPRING_DATASOURCE_HISTORICAL_USERNAME` | Redshift username |
| `SPRING_DATASOURCE_HISTORICAL_PASSWORD` | Redshift password |
| `AWS_SES_HOST` | SES SMTP host |
| `AWS_SES_PORT` | SES SMTP port |
| `AWS_SES_USERNAME` | SES SMTP username |
| `AWS_SES_PASSWORD` | SES SMTP password |
| `AWS_CREDENTIALS_SALT` | Salt mã hoá |
| `FIREBLOCKS_APIKEY` | Fireblocks API key |
| `FIREBLOCKS_PUBLICKEY` | Fireblocks public key |
| `FIREBLOCKS_SECRETKEY` | Fireblocks secret key |

### 3. CloudWatch Agent

DaemonSet chạy trên mọi node, thu thập metrics hệ thống.

| Biến | Source | Giá trị | Mục đích |
|------|--------|---------|----------|
| `HOST_IP` | `fieldRef: status.hostIP` | (dynamic) | IP của node — dùng tag metrics |
| `HOST_NAME` | `fieldRef: spec.nodeName` | (dynamic) | Tên node |
| `K8S_NAMESPACE` | `fieldRef: metadata.namespace` | (dynamic) | Namespace hiện tại |
| `CI_VERSION` | Direct | `"k8s/1.3.7"` | Version tag của CloudWatch agent |
| `RUN_WITH_IRSA` | Direct | `"True"` | Dùng IAM Role for Service Account thay vì hardcode credentials |

### 4. Fluent Bit (Log Shipping)

DaemonSet ship container logs từ tất cả pod lên CloudWatch Logs.

| Biến | Source | Giá trị | Mục đích |
|------|--------|---------|----------|
| `AWS_REGION` | ConfigMap | `ap-northeast-1` | Region gửi logs |
| `CLUSTER_NAME` | ConfigMap | `point` | Tên cluster — dùng trong log group name |
| `HTTP_SERVER` | ConfigMap | `On` | Expose metrics endpoint của Fluent Bit |
| `HTTP_PORT` | ConfigMap | `2020` | Port metrics endpoint |
| `READ_FROM_HEAD` | ConfigMap | `Off` | Không đọc log từ đầu file |
| `READ_FROM_TAIL` | ConfigMap | `On` | Chỉ đọc log mới — tránh replay log cũ khi restart |
| `HOST_NAME` | `fieldRef: spec.nodeName` | (dynamic) | Prefix cho CloudWatch log stream |
| `HOSTNAME` | `fieldRef: metadata.name` | (dynamic) | Pod name |
| `CI_VERSION` | Direct | `"k8s/1.3.16"` | Version tag Fluent Bit |

### 5. AWS Load Balancer Controller

Helm chart values — không dùng env vars trực tiếp nhưng config quan trọng:

| Config | DEV | STG | Mục đích |
|--------|-----|-----|----------|
| `clusterName` | `point` | `point` | Tên EKS cluster |
| `region` | `ap-northeast-1` | `ap-northeast-1` | AWS region |
| `vpcId` | `vpc-0e139c5a0789db4c0` | (from tfvars) | VPC để provision ALB |
| `replicaCount` | `2` | `2` | Số replica controller pod |
| `image.tag` | `v3.1.0` | `v3.1.0` | Version controller |

---

## III. Luồng quản lý Secrets

```
AWS Secrets Manager
    |
    | (1) fetch_credentials.sh pull secrets
    v
K8s Secret "point-secrets"
    |
    | (2) envFrom: secretRef inject vào Pod
    v
Pod environment variables
    |
    | (3) Spring Boot auto-binding ${SPRING_*}
    v
application.yaml sử dụng giá trị
```

**Secrets paths trong AWS Secrets Manager:**
| Path | Nội dung |
|------|----------|
| `point/base` | Config chung (SES, credentials salt...) |
| `point/SPRING_DATA_REDIS` | Redis host/port |
| `point/SPRING_DATASOURCE_MASTER` | Aurora MySQL connection |
| `point/SPRING_DATASOURCE_HISTORICAL` | Redshift connection |
| `point/exc` | Fireblocks và các service credentials khác |
| `point/aws-credentials` | AWS credentials (chỉ dùng cho local dev) |

---

# Phần B: Công cụ & Scripts

## I. K8s Manifests Scripts

Nằm tại: `bs-exchange-infra/k8s-manifests/bin/`

### 1. `k8s_apply.sh` — Triển khai toàn bộ K8s

**Đường dẫn:** `k8s-manifests/bin/k8s_apply.sh`

**Mục đích:** Script chính để triển khai toàn bộ Kubernetes manifests lên EKS cluster. Thực hiện tuần tự tất cả các bước cần thiết.

**Cú pháp:**
```bash
./k8s_apply.sh --env <env>
```

**Tham số:**
| Tham số | Giá trị | Bắt buộc | Mô tả |
|---------|---------|----------|-------|
| `--env` | `dev`, `dev-ex`, `stg`, `stg-ex`, `prd` | Không (detect từ AWS profile) | Chỉ định môi trường target |

**Các bước thực hiện (theo thứ tự):**

| # | Bước | Mô tả |
|---|------|-------|
| 1 | Update kubeconfig | Kết nối tới EKS cluster `point` |
| 2 | VPC CNI tuning | Set `WARM_IP_TARGET=2`, `MINIMUM_IP_TARGET=1` trên `aws-node` DaemonSet |
| 3 | RBAC | Apply ClusterRole và RoleBinding |
| 4 | aws-auth ConfigMap | Map IAM roles/users → K8s permissions |
| 5 | ALB Controller CRDs | Download và apply Custom Resource Definitions |
| 6 | ALB Controller (Helm) | Install/upgrade AWS Load Balancer Controller chart |
| 7 | NFS Provisioner | Cấu hình NFS mount cho HULFT file transfer (STG/PRD only) |
| 8 | CoreDNS | Apply CoreDNS config (STG only) |
| 9 | Cluster Autoscaler | Apply autoscaler config |
| 10 | Metrics Server | Apply metrics server cho HPA |
| 11 | CloudWatch + Fluent Bit | Apply observability stack |
| 12 | Pod Security | Apply PSA labels |
| 13 | NetworkPolicy | Apply network rules |
| 14 | Secrets | Gọi `fetch_credentials.sh` để đồng bộ secrets |
| 15 | Kustomize deployments | Apply ingress + 5 deployments (admin, api, app, mmh, worker) |

**NFS Config theo môi trường:**
| Env | NFS Server |
|-----|-----------|
| STG | `10.51.187.138:/mnt/hulft/tmp` |
| PRD | `10.51.188.138:/mnt/hulft/tmp` |

**Dependencies:** `aws` CLI, `kubectl`, `helm`, `wget`, `kustomize`

**Ví dụ:**
```bash
# Deploy toàn bộ lên STG
./k8s_apply.sh --env stg-ex

# Deploy lên DEV (auto-detect từ AWS_PROFILE)
export AWS_PROFILE=bs-point-dev-ex
./k8s_apply.sh
```

---

### 2. `fetch_credentials.sh` — Đồng bộ Secrets

**Đường dẫn:** `k8s-manifests/bin/fetch_credentials.sh`

**Mục đích:** Lấy secrets từ AWS Secrets Manager, so sánh với K8s Secret hiện tại, và apply nếu có thay đổi.

**Cú pháp:**
```bash
./fetch_credentials.sh [--env <env>] [--list]
```

**Tham số:**
| Tham số | Mô tả |
|---------|-------|
| `--env <env>` | Chỉ định môi trường (`dev`, `stg`, `prd`, `local`) |
| `--list` | Chỉ liệt kê secret keys (dry-run, không apply) |

**Hành vi theo môi trường:**
| Mode | Output | Mô tả |
|------|--------|-------|
| `local` | File `local.env` | Tạo file env cho development local — lấy từ `base` + `aws-credentials` |
| `default` | K8s Secret `point-secrets` | Tạo/update Opaque Secret — lấy từ `base`, `SPRING_DATA_REDIS`, `SPRING_DATASOURCE_MASTER`, `SPRING_DATASOURCE_HISTORICAL`, `exc` |

**Tính năng đặc biệt:**
- **Backup tự động:** Lưu secret hiện tại vào `.secret-backups/` trước khi thay đổi (giữ 10 bản gần nhất)
- **Diff chi tiết:** Hiển thị keys được thêm/sửa/xoá trước khi apply
- **Xác nhận:** Hỏi user trước khi apply thay đổi

**Dependencies:** `aws` CLI, `kubectl`, `jq`

**Ví dụ:**
```bash
# Xem những key nào sẽ được fetch
./fetch_credentials.sh --list

# Đồng bộ secrets cho STG
./fetch_credentials.sh --env stg

# Tạo file local.env cho dev local
./fetch_credentials.sh --env local
```

---

### 3. `apply_secrets.sh` — Wrapper cho fetch_credentials

**Đường dẫn:** `k8s-manifests/bin/apply_secrets.sh`

**Mục đích:** Wrapper đơn giản: update kubeconfig rồi gọi `fetch_credentials.sh`.

**Cú pháp:**
```bash
./apply_secrets.sh [--env <env>]
```

**Tham số:**
| Tham số | Giá trị | Mô tả |
|---------|---------|-------|
| `--env` | `dev`, `dev2`, `dev3`, `stg`, `stg2`, `stg-ex`, `prd` | Chỉ định môi trường |

**Ví dụ:**
```bash
./apply_secrets.sh --env stg-ex
```

---

### 4. `rehearsal_secrets.sh`

**Đường dẫn:** `k8s-manifests/bin/rehearsal_secrets.sh`

**Mục đích:** Phiên bản tương tự `fetch_credentials.sh` — dùng cho rehearsal (diễn tập) trước khi apply thật.

---

## II. Terraform Scripts

### 1. `terraform.sh` — Wrapper chính

**Đường dẫn:** `bs-exchange-infra/terraform/terraform.sh`

**Mục đích:** Wrapper quản lý Terraform backend configuration và môi trường. **Bắt buộc dùng script này thay vì chạy `terraform` trực tiếp.**

**Cú pháp:**
```bash
# Chạy từ thư mục component
cd terraform/components/<component>
../../terraform.sh [options] <terraform-command>
```

**Tham số:**
| Tham số | Mô tả |
|---------|-------|
| `--env <env>` | Chỉ định môi trường (override AWS_PROFILE/AWS_VAULT) |
| `--clean` | Xoá thư mục terraform working (`tmp/<ENV>/<COMPONENT>`) |
| `--local` | Dùng local backend thay vì S3 |
| `-v` | Verbose output |
| `-h`, `--help` | Hiển thị help |

**Auto-detect môi trường:**
| AWS_PROFILE pattern | Môi trường |
|---------------------|------------|
| `bs-point-dev*` | `dev` |
| `bs-point-stg*` | `stg` |
| `bs-point-prd*` | `prd` |
| `bs-point-cxr-dev*` | `cxr-dev` |

**Backend S3:**
- Bucket: `tfstate.bs-point-<ENV>` (ví dụ: `tfstate.bs-point-dev-ex`)
- State key: `<COMPONENT>/terraform.tfstate`

**Tính năng đặc biệt:**
- Tự động `terraform init` khi chưa init
- Quản lý lifecycle `backend.tf` (copy vào → chạy → cleanup)
- Lưu config backend vào `.cxr_config`
- Trap Ctrl+C để cleanup `backend.tf`
- Hiển thị thời gian thực thi

**Ví dụ:**
```bash
# Init và plan cho VPC ở STG
cd terraform/components/vpc
../../terraform.sh --env stg-ex init
../../terraform.sh --env stg-ex plan

# Apply EKS ở DEV
cd terraform/components/eks
../../terraform.sh --env dev-ex apply

# Xoá cache terraform cho một component
../../terraform.sh --clean
```

**Dependencies:** `terraform`, `bash-functions.sh`

---

### 2. `execute.sh` — Multi-component executor

**Đường dẫn:** `bs-exchange-infra/terraform/tool/execute_targets/execute.sh`

**Mục đích:** Chạy terraform command lên nhiều components cùng lúc theo thứ tự định nghĩa trong file targets.

**Cú pháp:**
```bash
./execute.sh [options] <terraform-command>
```

**Tham số:**
| Tham số | Mô tả |
|---------|-------|
| `--env <env>` | Chỉ định môi trường |
| `-f <file>` | File chứa danh sách components (default: `targets.txt`) |
| `-v` | Verbose output |
| `-y` | Auto-approve (không hỏi xác nhận) |

**Format file targets (`targets.txt`):**
```
# Dòng bắt đầu bằng # là comment
vpc
eks
ec2-bastion
sns-alert
```

**Hành vi theo command:**
| Command | Thứ tự | Song song? |
|---------|--------|-----------|
| `init`, `get` | Theo file | Song song (có log riêng) |
| `plan`, `apply` | Theo file | Tuần tự |
| `destroy` | **Ngược** lại | Tuần tự |

**Ví dụ:**
```bash
# Plan tất cả components trong targets.txt
./execute.sh --env stg plan

# Apply với file targets tuỳ chỉnh, auto-approve
./execute.sh -y -f stg-targets.txt --env stg-ex apply

# Destroy theo thứ tự ngược
./execute.sh --env dev-ex destroy
```

**Dependencies:** `terraform`, `bash-functions.sh`

---

## III. Database User Management

Nằm tại: `bs-exchange-infra/terraform/tool/db-user-manager/`

Bộ scripts quản lý user accounts cho Aurora MySQL và Redshift, đồng bộ credentials vào AWS Secrets Manager.

### 1. Aurora Scripts

| Script | Mục đích | Cú pháp |
|--------|----------|---------|
| `aurora-create-users.sh` | Tạo 4 user accounts mới (editor_service, viewer_service, editor_user, viewer_user) + update 5 secrets | `AURORA_HOST=<host> ./aurora-create-users.sh` |
| `aurora-drop-users.sh` | Xoá 4 user accounts | `AURORA_HOST=<host> ./aurora-drop-users.sh` |
| `aurora-update-master-password.sh` | Rotate password master user | `AURORA_HOST=<host> ./aurora-update-master-password.sh` |
| `aurora-update-passwords.sh` | Rotate password 4 application users | `AURORA_HOST=<host> ./aurora-update-passwords.sh` |

**User roles và permissions:**
| User | Secret Path | Quyền |
|------|-------------|-------|
| `master` | `point/aurora/master_user` | Full admin |
| `point` (editor_service) | `point/aurora/editor_service` | SELECT, INSERT, UPDATE, DELETE trên `point.*` |
| `point_viewer` (viewer_service) | `point/aurora/viewer_service` | SELECT trên `point.*` |
| `editor` | `point/aurora/editor_user` | ALL trên `point.*` |
| `viewer` | `point/aurora/viewer_user` | SELECT trên `point.*` |

**Spring Boot secret:** `point/SPRING_DATASOURCE_MASTER` — chứa connection string format:
```
jdbc:mariadb:aurora//<HOST>:3306/<DBNAME>?zeroDateTimeBehavior=convertToNull
```

### 2. Redshift Scripts

| Script | Mục đích | Cú pháp |
|--------|----------|---------|
| `redshift-create-users.sh` | Tạo 4 user accounts cho Redshift | `REDSHIFT_HOST=<host> ./redshift-create-users.sh` |
| `redshift-update-master-password.sh` | Rotate password master | `REDSHIFT_HOST=<host> ./redshift-update-master-password.sh` |
| `redshift-update-passwords.sh` | Rotate password 4 application users | `REDSHIFT_HOST=<host> ./redshift-update-passwords.sh` |

**Spring Boot secret:** `point/SPRING_DATASOURCE_HISTORICAL` — chứa connection string format:
```
jdbc:redshift://<HOST>:5439/<DBNAME>
```

### 3. Shared Libraries

| File | Mục đích |
|------|----------|
| `init.sh` | Hàm chung: `generate_password()` (tạo password 16 ký tự), `update-secret-value()` (update AWS Secrets Manager) |
| `init-aurora.sh` | Config Aurora: định nghĩa user roles, secret paths, hàm `aurora-update-secret-value()` và `update-spring-boot-secret()` |
| `init-redshift.sh` | Config Redshift: tương tự `init-aurora.sh` nhưng cho Redshift (port 5439, driver redshift) |

**Cách sử dụng libraries:**
```bash
# Các script aurora-*.sh và redshift-*.sh đều source:
source ./init.sh
source ./init-aurora.sh   # hoặc init-redshift.sh
```

---

## IV. Lambda Build Scripts

Scripts đóng gói Lambda function thành ZIP để deploy qua Terraform.

| Script | Lambda | Ngôn ngữ | Mục đích |
|--------|--------|----------|----------|
| `terraform/components/sns-alert/sns-to-slack/build.sh` | SNS to Slack | Python | Đóng gói `app.py`, `app_util.py`, `slack_message.py` — forward SNS alerts tới Slack |
| `terraform/components/sns-alert/sns-to-slack/clean.sh` | SNS to Slack | Python | Xoá `__pycache__` và `.pytest_cache` |
| `terraform/components/waf-maintenance-lambda/src/scripts/build.sh` | WAF Maintenance | Python | Đóng gói `app.py`, `utils.py`, `rules/` — tự động bật/tắt WAF maintenance mode |
| `terraform/components/frontend-customer/src/build.sh` | Frontend | JavaScript | Đóng gói `index.js` — Lambda@Edge cho frontend |

**Cách sử dụng chung:**
```bash
cd <lambda-source-dir>
./build.sh               # Tạo ../lambda_function.zip
```

**Makefile (WAF Maintenance):**
```bash
cd terraform/components/waf-maintenance-lambda/src
make build                # Đóng gói lambda
make maintenance-start    # Test local với event start
make maintenance-end      # Test local với event end
make clean                # Xoá cache
```

---

## V. EC2 User Data Scripts

Scripts cloud-init chạy khi EC2 instance khởi tạo lần đầu (thông qua Terraform `user_data`).

### 1. Bastion Host (`ec2-bastion/user_data.sh`)

**Mục đích:** Cài đặt tools cho bastion host (jump server) để truy cập hạ tầng nội bộ.

**Tools cài đặt:**
| Tool | Version | Mục đích |
|------|---------|----------|
| `kubectl` | v1.28.15 | Quản lý K8s cluster |
| `helm` | v3.16.1 | Quản lý Helm charts |
| `aws` CLI | v2 (latest) | Tương tác AWS |
| `terraform` | latest | Quản lý infrastructure |
| `jq` | latest | Parse JSON |
| `redis-tools` | latest | Debug Redis |
| `mariadb-client` | latest | Debug Aurora MySQL |
| `postgresql-12` | v12 | Debug Redshift |
| `shfmt` | latest | Format shell scripts |

### 2. Data Transfer (`ec2-data-transfer/user_data.sh`)

**Mục đích:** Instance cho data migration/transfer tasks.

**OS:** Amazon Linux 2023

**Tools cài đặt:**
| Tool | Mục đích |
|------|----------|
| OpenJDK 17 (Corretto) | Chạy Java tools |
| PostgreSQL 15 client | Kết nối Redshift |
| MariaDB 10.5 client | Kết nối Aurora |
| AWS CLI v2 | Tương tác AWS |
| Git, jq, perl | Utility |

### 3. HULFT Server (`ec2-hulft/user_data.sh`)

**Mục đích:** Instance chạy HULFT file transfer system — trao đổi file với Ponta (loyalty program).

**OS:** RHEL 8

**Các bước setup:**
1. Đăng ký RHEL subscription
2. Cài đặt AWS CLI, SSM Agent
3. Mount NFS volume (`/dev/nvme1n1` → `/mnt/hulft`)
4. Export NFS share cho K8s pods
5. Cài HULFT v8.5.2
6. Tạo systemd service `hulft` và `watch_snddata`
7. Set ngôn ngữ hệ thống sang Japanese

**Biến Terraform truyền vào:**
| Biến | Mục đích |
|------|----------|
| `${hostname}` | Hostname instance |
| `${ponta_hulft_ip}` | IP HULFT server Ponta |
| `${ponta_hulft_hostname}` | Hostname HULFT Ponta |
| `${hulft_serial}` | License serial |
| `${hulft_productkey}` | License product key |
| `${ponta_hulft_snd001_name/id}` | Send definition 1 |
| `${ponta_hulft_snd002_name/id}` | Send definition 2 |

**File monitor:** `watch_snddata` service dùng `inotifywait` để tự động gửi file khi có thay đổi trong `/mnt/hulft/tmp/snddata/`.

---

## VI. Bash Utility Library

**Đường dẫn:** `bs-exchange-infra/lib/bash-functions.sh`

**Mục đích:** Thư viện hàm dùng chung cho tất cả scripts.

| Hàm | Mô tả | Ví dụ |
|-----|-------|-------|
| `get_target_env()` | Detect môi trường từ `AWS_PROFILE` hoặc `AWS_VAULT` | `ENV=$(get_target_env)` → trả về `dev`, `stg`, `prd`... |
| `echo_label()` | In text màu cyan (label format) | `echo_label "Processing: "` |
| `seconds_to_minsec()` | Chuyển giây → "X min Y sec" | `seconds_to_minsec 305` → `"5 min 5 sec"` |

**Mapping AWS Profile → Env:**
| Pattern | Kết quả |
|---------|---------|
| `bs-point-dev2*` | `dev2` |
| `bs-point-dev3*` | `dev3` |
| `bs-point-dev*` | `dev` |
| `bs-point-stg-ex*` | `stg-ex` |
| `bs-point-stg*` | `stg` |
| `bs-point-prd*` | `prd` |

---

# Phần C: Lưu ý Bảo mật

### Credentials bị hardcode trong source code

Các API key/secret sau **đang nằm trực tiếp** trong `application-{dev,stg}.yaml`:

| Service | File | Rủi ro |
|---------|------|--------|
| AWS SES | `application.yaml` | SMTP credentials hardcoded |
| GMO Aozora | `application-dev.yaml` | Client ID + Secret |
| OKCoin | `application-dev.yaml` | API Key + Secret + Passphrase |
| Refinitiv | `application-dev.yaml` | API Key + Secret Key |
| EKYC | `application-dev.yaml` | Secret + Token + Auth Key |
| Chainalysis | `application-dev.yaml` | Bearer Token |
| Sygna | `application-dev.yaml` | Account + Credential |
| Wallet Gateway | `application-dev.yaml` | Client Secret + API Key |
| reCAPTCHA | `application-dev.yaml` | Secret Key |

**Khuyến nghị:** Migrate tất cả sang AWS Secrets Manager trước khi deploy PRD. Nhiều giá trị PRD đã chuyển sang Secrets Manager (Fireblocks, Amber, JWT) nhưng dev/stg vẫn hardcode.

### Remote Debug ở DEV

`JAVA_TOOL_OPTIONS` ở DEV bật JDWP trên port 8000. **Không bao giờ** được bật ở PRD vì cho phép attach debugger từ xa, có thể đọc memory, modify runtime.

### Local dev credentials trong repo

`application-local.yaml` chứa DB password, Redis host cho local development. Cân nhắc:
- Dùng `.env` file (gitignored) thay vì commit vào repo
- Hoặc dùng `fetch_credentials.sh --env local` để tạo `local.env`
