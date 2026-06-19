# Hướng dẫn Biến Môi Trường & Công cụ Infrastructure - Verup Project

> Tài liệu tổng hợp toàn bộ biến môi trường (environment variables) được sử dụng trong server (`bs-integration-server`) và infra (`bs-exchange-infra`), kèm hướng dẫn sử dụng tất cả scripts/tools.
>
> Cập nhật: 2026-03-12

---

## Mục lục

- [Phần A: Cơ chế Mapping Biến Môi Trường](#phần-a-cơ-chế-mapping-biến-môi-trường)
  - [0. Cách Spring Boot resolve biến môi trường](#0-cách-spring-boot-resolve-biến-môi-trường)
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
  - [III. Luồng quản lý Secrets (End-to-End)](#iii-luồng-quản-lý-secrets-end-to-end)
  - [IV. Bảng tổng hợp: Biến → YAML → Java Class → Sử dụng ở đâu](#iv-bảng-tổng-hợp-biến--yaml--java-class--sử-dụng-ở-đâu)
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

# Phần A: Cơ chế Mapping Biến Môi Trường

## 0. Cách Spring Boot resolve biến môi trường

Trước khi đi vào chi tiết từng biến, cần hiểu **cơ chế chuyển đổi** từ biến môi trường hệ thống (OS env var) thành config property trong Spring Boot.

### Quy tắc chuyển đổi (Relaxed Binding)

Spring Boot tự động map env var → YAML property theo quy tắc:

```
OS Environment Variable:    SPRING_DATASOURCE_MASTER_URL
                               ↓ (lowercase + underscore → dot)
YAML Property Key:          spring.datasource.master.url
                               ↓ (@ConfigurationProperties prefix binding)
Java Field:                 url  (trong class có @ConfigurationProperties(prefix="spring.datasource.master"))
```

**Ví dụ cụ thể:**
```
Env var:  SPRING_DATASOURCE_MASTER_URL=jdbc:mariadb:aurora//host:3306/point
                    ↓
YAML:     spring.datasource.master.url: jdbc:mariadb:aurora//host:3306/point
                    ↓
Java:     MasterDataSourceConfig.url = "jdbc:mariadb:aurora//host:3306/point"
```

### Thứ tự ưu tiên (từ cao → thấp)

1. **OS Environment Variable** (ví dụ: `SPRING_DATASOURCE_MASTER_URL`) — ưu tiên cao nhất
2. **application-{profile}.yaml** (ví dụ: `application-stg.yaml`) — override base
3. **application.yaml** — config base/default
4. **@Value default** trong code Java (ví dụ: `@Value("${jwt.secret:default}")`)

Vì env var ưu tiên cao nhất, khi K8s inject `SPRING_DATASOURCE_MASTER_URL` từ Secret, nó sẽ **override** bất kỳ giá trị nào trong YAML file.

### Cách biến được inject vào Pod

```
                     Kubernetes Deployment YAML
                     ┌───────────────────────────────────┐
                     │ env:                               │
                     │   - name: SPRING_PROFILES_ACTIVE   │◄── Hardcode trong YAML
                     │     value: "stg"                   │
                     │ envFrom:                           │
                     │   - secretRef:                     │◄── Inject TẤT CẢ keys từ Secret
                     │       name: point-secrets          │    thành env vars
                     └───────────────────────────────────┘
                                    ↓
                     ┌───────────────────────────────────┐
                     │ Pod Environment (ví dụ):          │
                     │                                   │
                     │ SPRING_PROFILES_ACTIVE=stg        │
                     │ SPRING_DATASOURCE_MASTER_URL=...  │
                     │ SPRING_DATASOURCE_MASTER_USERNAME=.│
                     │ SPRING_DATA_REDIS_HOST=...        │
                     │ FIREBLOCKS_APIKEY=...             │
                     │ AWS_SES_HOST=...                  │
                     │ ...                               │
                     └───────────────────────────────────┘
                                    ↓
                     ┌───────────────────────────────────┐
                     │ Spring Boot Startup:               │
                     │                                   │
                     │ 1. Đọc SPRING_PROFILES_ACTIVE=stg │
                     │ 2. Load application.yaml (base)   │
                     │ 3. Load application-stg.yaml      │
                     │ 4. Env vars override YAML values  │
                     │ 5. Bind vào @ConfigurationProps   │
                     └───────────────────────────────────┘
```

### `SPRING_PROFILES_ACTIVE` và `JAVA_TOOL_OPTIONS`

Hai biến đặc biệt này **không mapping vào YAML** mà JVM/Spring đọc trực tiếp:

| Biến | Ai đọc | Cơ chế |
|------|--------|--------|
| `SPRING_PROFILES_ACTIVE` | Spring Framework | Spring Boot auto-detect, quyết định load `application-{profile}.yaml` nào |
| `JAVA_TOOL_OPTIONS` | JVM (trước khi Spring khởi động) | JVM đọc biến này và apply như command-line flags. Dùng để set memory, GC, debug agent |

**Trong Dockerfile**, `SPRING_PROFILES_ACTIVE` cũng có thể được truyền qua entrypoint:
```dockerfile
# point-api/Dockerfile
ENV ENVIRONMENT $ENVIRONMENT
ENTRYPOINT ["sh", "-c", "java -jar /app/point-api.jar --spring.profiles.active=$ENVIRONMENT"]
```

Tuy nhiên khi chạy trên K8s, env var `SPRING_PROFILES_ACTIVE` trong deployment YAML sẽ **override** giá trị từ Dockerfile.

---

## I. Server Project (`bs-integration-server`)

Server gồm 5 module Spring Boot: `point-api`, `point-admin`, `point-app`, `point-worker`, `point-mmh`.
Cấu hình theo profile: `application.yaml` (base) + `application-{dev,stg,prd}.yaml` (override theo môi trường).

### 1. Database — Aurora MySQL (Master)

Database chính chứa toàn bộ dữ liệu nghiệp vụ (user, transaction, order...).

| Biến môi trường (K8s Secret) | YAML Property | Giá trị | Mục đích |
|------|---------|----------|----------|
| `SPRING_DATASOURCE_MASTER_URL` | `spring.datasource.master.url` | AWS Secrets Manager | JDBC connection string tới Aurora MySQL |
| `SPRING_DATASOURCE_MASTER_USERNAME` | `spring.datasource.master.username` | AWS Secrets Manager | Username kết nối DB |
| `SPRING_DATASOURCE_MASTER_PASSWORD` | `spring.datasource.master.password` | AWS Secrets Manager | Password kết nối DB |

| YAML-only Property (không qua env var) | Giá trị | Mục đích |
|------|---------|----------|
| `spring.datasource.master.driver-class-name` | `org.mariadb.jdbc.Driver` | JDBC driver (dùng MariaDB driver cho Aurora MySQL) |
| `spring.datasource.master.maximum-pool-size` | `66` (base), `150` (dev/stg) | Số connection tối đa trong HikariCP pool |
| `spring.datasource.master.minimum-idle` | `10` | Số connection idle tối thiểu giữ sẵn |
| `spring.datasource.master.max-lifetime` | `600000` (10 phút) | Thời gian sống tối đa của 1 connection |
| `spring.datasource.master.idle-timeout` | `500000` (~8 phút) | Timeout cho connection idle |
| `spring.datasource.master.leak-detection-threshold` | `5000` (5 giây) | Ngưỡng phát hiện connection bị leak (không trả về pool) |

**Mapping vào Java code:**

```
SPRING_DATASOURCE_MASTER_URL
    ↓ (Spring Relaxed Binding)
spring.datasource.master.url
    ↓ (@ConfigurationProperties prefix = "spring.datasource.master")
MasterDataSourceConfig extends AbstractDataSourceConfig
    ↓ (field: url, username, password)
Bean: masterDataSource (HikariDataSource)
    ↓ (inject vào)
Bean: masterEntityManagerFactory (JPA EntityManagerFactory)
Bean: masterTransactionManager
Bean: masterJdbcTemplate
    ↓ (dùng bởi)
Tất cả Repository trong point.common.repos, point.pos.repos, point.operate.repos, point.spot.repos
```

**File code liên quan:**

| File | Dòng | Vai trò |
|------|------|---------|
| `point-common/.../config/AbstractDataSourceConfig.java` | L24-30 | Base class — khai báo fields `url`, `username`, `password` với `@Getter/@Setter` |
| `point-common/.../config/AbstractDataSourceConfig.java` | L51-80 | Method `dataSource()` — tạo `HikariDataSource` từ các fields |
| `point-common/.../config/MasterDataSourceConfig.java` | L20-25 | `@ConfigurationProperties(prefix = "spring.datasource.master")` — bind YAML vào fields |
| `point-common/.../config/MasterDataSourceConfig.java` | L33-35 | `@Bean("masterDataSource")` — tạo HikariDataSource bean |
| `point-common/.../config/MasterDataSourceConfig.java` | L38-47 | `@Bean("masterEntityManagerFactory")` — tạo JPA EntityManagerFactory |
| `point-common/.../config/MasterDataSourceConfig.java` | L49-54 | `@Bean("masterTransactionManager")` — quản lý transaction |
| `point-common/.../config/MasterDataSourceConfig.java` | L57-59 | `@Bean` JdbcTemplate — truy cập JDBC thô |

**Luồng sử dụng thực tế:**
1. Spring Boot khởi động → đọc env var `SPRING_DATASOURCE_MASTER_URL` → bind vào `MasterDataSourceConfig.url`
2. `MasterDataSourceConfig` tạo `HikariDataSource` bean với URL/username/password
3. `masterEntityManagerFactory` dùng DataSource này để tạo JPA EntityManager
4. Tất cả `@Repository` class (ví dụ: `CustomerRepository`, `OrderRepository`) được scan trong package `point.common.entity` sẽ dùng EntityManager này
5. Business logic trong `@Service` class autowire Repository → query/update database

**Connection string format (local dev):**
```
jdbc:mysql://localhost:3308/point?zeroDateTimeBehavior=convertToNull&allowPublicKeyRetrieval=true
```

---

### 2. Database — Redshift (Historical)

Lưu trữ dữ liệu lịch sử (archived data) cho báo cáo và phân tích. Dùng driver PostgreSQL-compatible.

| Biến môi trường (K8s Secret) | YAML Property | Giá trị | Mục đích |
|------|---------|----------|----------|
| `SPRING_DATASOURCE_HISTORICAL_URL` | `spring.datasource.historical.url` | AWS Secrets Manager | JDBC connection string tới Redshift |
| `SPRING_DATASOURCE_HISTORICAL_USERNAME` | `spring.datasource.historical.username` | AWS Secrets Manager | Username Redshift |
| `SPRING_DATASOURCE_HISTORICAL_PASSWORD` | `spring.datasource.historical.password` | AWS Secrets Manager | Password Redshift |

| YAML-only Property | Giá trị | Mục đích |
|------|---------|----------|
| `spring.datasource.historical.driver-class-name` | `com.amazon.redshift.jdbc42.Driver` | JDBC driver cho Redshift |
| `spring.datasource.historical.hibernate-dialect` | `org.hibernate.dialect.PostgreSQL82Dialect` | Hibernate SQL dialect |
| `spring.datasource.historical.maximum-pool-size` | `66` (base), `150` (dev/stg) | Số connection tối đa |

**Mapping vào Java code:**

```
SPRING_DATASOURCE_HISTORICAL_URL
    ↓
spring.datasource.historical.url
    ↓ (@ConfigurationProperties prefix = "spring.datasource.historical")
HistoricalDataSourceConfig extends AbstractDataSourceConfig
    ↓
Bean: historicalDataSource (HikariDataSource)
    ↓
Bean: historicalEntityManagerFactory, historicalJpaTransactionManager, historicalJdbcTemplate
    ↓ (dùng bởi)
Repository trong point.admin.entity (read-only, dữ liệu lịch sử)
```

**File code liên quan:**

| File | Dòng | Vai trò |
|------|------|---------|
| `point-common/.../config/HistoricalDataSourceConfig.java` | L34 | `@ConfigurationProperties(prefix = "spring.datasource.historical")` |
| `point-common/.../config/HistoricalDataSourceConfig.java` | L47-50 | `@Bean("historicalDataSource")` |
| `point-common/.../config/HistoricalDataSourceConfig.java` | L52-61 | `@Bean("historicalEntityManagerFactory")` |
| `point-common/.../config/HistoricalDataSourceConfig.java` | L78-82 | `@Bean("historicalJdbcTemplate")` |

**Lưu ý về Multi-DataSource:** Project dùng 2 DataSource song song (Master + Historical). Spring Boot mặc định chỉ hỗ trợ 1, nên cần `@Primary` trên master và `@Qualifier` khi inject historical. Repository package scan được tách biệt để mỗi DataSource chỉ quản lý entity của mình.

**Connection string format (local dev):**
```
jdbc:postgresql://localhost:5439/point
```

---

### 3. Redis (Cache & Session)

Dùng cho cache dữ liệu (giá, ticker), session user, distributed lock, và PubSub cho WebSocket real-time.

| Biến môi trường (K8s Secret) | YAML Property | Giá trị | Mục đích |
|------|---------|----------|----------|
| `SPRING_DATA_REDIS_HOST` | `spring.data.redis.host` | AWS Secrets Manager | ElastiCache Redis endpoint |
| `SPRING_DATA_REDIS_PORT` | `spring.data.redis.port` | `6379` | Port Redis chuẩn |

| YAML-only Property | Giá trị | Mục đích |
|------|---------|----------|
| `spring.session.store-type` | `redis` (app/admin) / `none` (api/worker) | Loại session store — app và admin dùng Redis session, api/worker không cần |
| `exchange-websocket.redis-pubsub-cache.enabled` | `true` | Bật cache qua Redis PubSub |
| `exchange-websocket.redis-pubsub-cache.expire-in-minutes` | `5` | Thời gian hết hạn cache PubSub |

**Mapping vào Java code:**

```
SPRING_DATA_REDIS_HOST + SPRING_DATA_REDIS_PORT
    ↓
spring.data.redis.host / spring.data.redis.port
    ↓ (@ConfigurationProperties prefix = "spring.data.redis")
CacheConfig (fields: host, port, maxTotal, maxIdle, minIdle)
    ↓ tạo ra các beans:
    ├── LettuceConnectionFactory    ← kết nối Redis (new RedisStandaloneConfiguration(host, port))
    ├── RedisTemplate<String, E>    ← thao tác key-value chung
    ├── RedisTemplate<String, BigDecimal>  ← cache giá crypto
    ├── RedisTemplate<String, Date>        ← cache timestamp
    ├── CacheManager                ← Spring @Cacheable integration
    └── RedissonClient              ← distributed lock (redis://{host}:{port})
```

**File code liên quan:**

| File | Dòng | Vai trò |
|------|------|---------|
| `point-common/.../config/CacheConfig.java` | L38 | `@ConfigurationProperties(prefix = "spring.data.redis")` |
| `point-common/.../config/CacheConfig.java` | L52-54 | Fields: `host`, `port`, `maxTotal`, `maxIdle`, `minIdle` |
| `point-common/.../config/CacheConfig.java` | L79-86 | `LettuceConnectionFactory` — tạo kết nối Redis |
| `point-common/.../config/CacheConfig.java` | L89-93 | `RedisTemplate<String, E>` — template chung |
| `point-common/.../config/CacheConfig.java` | L96-101 | `RedisTemplate<String, BigDecimal>` — cho giá crypto |
| `point-common/.../config/CacheConfig.java` | L68-76 | `CacheManager` — quản lý các cache region |
| `point-common/.../config/CacheConfig.java` | L152-162 | `RedissonClient` — cho distributed lock |
| `point-common/.../component/CustomRedisTemplate.java` | — | Wrapper tiện ích cho RedisTemplate |
| `point-app/.../config/websocket/RedisSubscriberConfig.java` | — | PubSub subscriber cho WebSocket real-time |

**Nơi Redis được sử dụng thực tế:**
- **Session:** `point-app` và `point-admin` dùng `spring.session.store-type=redis` → session user lưu trong Redis thay vì memory
- **Cache:** `@Cacheable` annotation trên service methods cache Symbol, SystemConfig, WorkerMaster, LoginAttempt
- **Lock:** `point-worker` dùng `RedissonClient` để lock worker task, tránh 2 pod chạy cùng 1 job
- **PubSub:** `point-app` subscribe Redis channel để nhận ticker/orderbook update, push qua WebSocket tới client

---

### 4. AWS Services

| Biến môi trường (K8s Secret) | YAML Property | Giá trị | Mục đích |
|------|---------|----------|----------|
| `AWS_SES_HOST` | `aws.ses.host` | `email-smtp.ap-northeast-1.amazonaws.com` | SMTP host cho SES |
| `AWS_SES_PORT` | `aws.ses.port` | `587` | SMTP TLS port |
| `AWS_SES_USERNAME` | `aws.ses.username` | AWS Secrets Manager | SMTP credentials |
| `AWS_SES_PASSWORD` | `aws.ses.password` | AWS Secrets Manager | SMTP credentials |
| `AWS_CREDENTIALS_SALT` | `aws.credentials.salt` | AWS Secrets Manager | Salt dùng mã hoá credentials nội bộ |

| YAML-only Property | Giá trị | Mục đích |
|------|---------|----------|
| `cloud.aws.region.static` | `ap-northeast-1` | AWS Region (Tokyo) |
| `cloud.aws.credentials.use-default-aws-credentials-chain` | `false` | Không dùng default credential chain — dùng instance profile hoặc env var |
| `aws.s3.kyc-bucket.name` | `kyc.bs-point-{env}-ex` | S3 bucket lưu trữ tài liệu KYC (xác minh danh tính) |
| `aws.s3.year-report-bucket.name` | `year-report.bs-point-{env}-ex` | S3 bucket lưu báo cáo năm (thuế, giao dịch) |

**Mapping AWS SES vào Java code:**

```
AWS_SES_HOST / AWS_SES_PORT / AWS_SES_USERNAME / AWS_SES_PASSWORD
    ↓
aws.ses.host / aws.ses.port / aws.ses.username / aws.ses.password
    ↓ (@ConfigurationProperties prefix = "aws.ses")
SesConfig (fields: host, port, username, password)
    ↓ (autowired bởi)
SesManager.sendWithoutThread()
    ↓ (sử dụng)
    ├── awsSesConfig.getHost()      → SMTP server address
    ├── awsSesConfig.getPort()      → SMTP port
    ├── awsSesConfig.getUsername()   → SMTP auth username
    └── awsSesConfig.getPassword()  → SMTP auth password
    ↓ (gọi bởi)
Gửi email: đăng ký, reset password, xác nhận giao dịch, thông báo...
```

**File code liên quan:**

| File | Dòng | Vai trò |
|------|------|---------|
| `point-common/.../config/SesConfig.java` | L9 | `@ConfigurationProperties(prefix = "aws.ses")` |
| `point-common/.../config/SesConfig.java` | L12-18 | Fields: `host`, `username`, `password`, `port` |
| `point-common/.../component/SesManager.java` | L30 | Autowired `SesConfig awsSesConfig` |
| `point-common/.../component/SesManager.java` | L57-76 | `sendWithoutThread()` — kết nối SMTP và gửi email |

**Luồng gửi email:**
1. Service (ví dụ: `CustomerService.register()`) gọi `SesManager.send(to, subject, body)`
2. `SesManager` đọc config từ `SesConfig` (được inject từ env var)
3. Tạo SMTP connection tới `email-smtp.ap-northeast-1.amazonaws.com:587`
4. Authenticate bằng SES username/password
5. Gửi email qua SMTP TLS

---

### 5. JWT & Authentication

Chỉ áp dụng cho `point-app` (customer-facing). `point-admin` dùng session-based auth, `point-api` dùng API key.

| Biến | YAML Property | Giá trị | Mục đích |
|------|---------|----------|----------|
| (YAML only) | `jwt.issuer` | `bs-point-server` | Tên issuer ghi trong JWT token |
| (YAML / Secrets Manager PRD) | `jwt.secret` | `0123456789` (dev) / Secrets Manager (stg/prd) | Khoá bí mật ký JWT |
| (YAML only) | `jwt.token-ttl` | `7600` giây (~2 giờ) | Thời gian sống access token |
| (YAML only) | `jwt.refresh-token-ttl` | `604800` giây (7 ngày) | Thời gian sống refresh token |
| (YAML only) | `jwt.cache-token-ttl` | `604800` giây (7 ngày) | TTL cache token trong Redis |

**Mapping vào Java code:**

```
jwt.secret / jwt.issuer / jwt.token-ttl / jwt.refresh-token-ttl
    ↓ (@Value annotation — KHÔNG dùng @ConfigurationProperties)
JwtManager (point-app module)
    ├── @Value("${jwt.secret}") String secret
    ├── @Value("${jwt.issuer:cb-exchange-server}") String issuer
    ├── @Value("${jwt.token-ttl:7600}") int tokenTtl
    ├── @Value("${jwt.cache-token-ttl:604800}") int cacheTokenTtl
    └── @Value("${jwt.refresh-token-ttl:604800}") int refreshTokenTtl
    ↓
JwtManager.createTokenPair()
    → Algorithm.HMAC256(secret) ← ký JWT bằng HMAC-SHA256
    → JWT.create().withIssuer(issuer).withExpiresAt(now + tokenTtl)
    ↓ (dùng bởi)
ExchangeJwtAuthenticationProcessingFilter
    → Filter trên mỗi HTTP request, verify JWT token
```

**File code liên quan:**

| File | Dòng | Vai trò |
|------|------|---------|
| `point-app/.../component/jwt/JwtManager.java` | L53-66 | `@Value` annotations bind JWT config |
| `point-app/.../component/jwt/JwtManager.java` | L76-114 | `createTokenPair()` — tạo JWT + refresh token |
| `point-app/.../component/jwt/JwtTokenUtil.java` | — | Utility parse/validate JWT |
| `point-app/.../component/jwt/exchange/ExchangeJwtAuthenticationProcessingFilter.java` | — | Request filter verify JWT trên mỗi API call |

**Lưu ý:** JWT config dùng `@Value` thay vì `@ConfigurationProperties`. Điều này có nghĩa:
- Không có prefix binding tự động
- Nếu env var là `JWT_SECRET`, Spring sẽ map nó thành `jwt.secret` → hoạt động bình thường
- Default value sau `:` trong `@Value("${jwt.issuer:cb-exchange-server}")` chỉ dùng khi property không tồn tại

**Các config liên quan (cũng dùng `@Value`):**

| Biến | Giá trị | Mục đích |
|------|---------|----------|
| `point-common.account-lock.max-attempt` | `5` | Khoá tài khoản sau N lần login sai |
| `point-common.account-lock.expire-seconds` | `0` | Thời gian khoá (0 = vĩnh viễn cho đến khi admin mở) |
| `customer.forgot-password.token.forgot-effective-time` | `600000` ms (10 phút) | Link reset password hết hạn |
| `customer.login-password.token.effective-time` | `86400000` ms (24 giờ) | Token xác nhận tạo tài khoản hết hạn |
| `customer.register.enabled` | `true` | Bật/tắt đăng ký tài khoản mới |
| `customer.fiat-withdrawal.user-daily-withdrawal-limit` | `30000000` | Giới hạn rút tiền fiat/ngày (JPY) |
| `spring.recaptcha.secret-key` | hardcoded | Google reCAPTCHA v3 chống bot |

---

### 6. External Service Integrations

Các dịch vụ bên thứ 3 tích hợp vào hệ thống. Mỗi service có `@ConfigurationProperties` class riêng.

| Service | Config Class | Prefix | Biến chính | Mục đích |
|---------|-------------|--------|-----------|----------|
| **GMO Aozora Bank** | `GmoConfig` | `gmo` | `gmo.client-id`, `gmo.secret` | Tích hợp ngân hàng — nạp/rút JPY qua API ngân hàng |
| **Ponta** | `PontaConfig` | `ponta` | `ponta.partner-number`, `ponta.keystore-password` | Chương trình loyalty point — tích điểm Ponta cho customer |
| **Refinitiv World-Check** | (config trong YAML) | `refinitiv` | `refinitiv.api-key`, `refinitiv.secret-key` | AML/KYC screening — kiểm tra danh sách cấm vận, PEP |
| **EKYC (NextWay)** | (config trong YAML) | `ekyc` | `ekyc.secret`, `ekyc.token` | Xác minh danh tính điện tử (chụp CCCD/hộ chiếu) |
| **Chainalysis** | `ChainalysisConfig` | `chainalysis` | `chainalysis.token` | Giám sát blockchain — phát hiện giao dịch crypto đáng ngờ |
| **Sygna Hub** | `SygnaHubConfig` | `sygna` | `sygna.account`, `sygna.credential` | Travel Rule compliance — tuân thủ quy định chuyển tiền crypto quốc tế |
| **Fireblocks** | `FireblocksConfig` | `fireblocks` | `fireblocks.apiKey`, `fireblocks.secretKey`, `fireblocks.publicKey` | Quản lý ví custodian (hot/cold wallet) — qua Secrets Manager |
| **Wallet Gateway** | `WalletConfig` | `wallet` | `wallet.client-id`, `wallet.apiKey` | Gateway nội bộ quản lý ví crypto user |
| **Amber (WhaleFin)** | `AmberConfig` | `point-pos.best-price.amber` | `access-key`, `access-secret` | RFQ và spot order với liquidity provider |
| **OKCoin** | (config trong YAML) | `dealing.okcoin` | `apiKey`, `secret` | Liquidity provider — giao dịch cover trên sàn |
| **SMS (CPAAS)** | (config trong YAML) | `sms` | `sms.host`, `sms.token` | Gửi SMS xác thực OTP |

**Ví dụ chi tiết: Fireblocks**

```
FIREBLOCKS_APIKEY / FIREBLOCKS_SECRETKEY / FIREBLOCKS_PUBLICKEY  (từ K8s Secret)
    ↓ (Spring Relaxed Binding)
fireblocks.apiKey / fireblocks.secretKey / fireblocks.publicKey
    ↓ (@ConfigurationProperties prefix = "fireblocks")
FireblocksConfig (fields: apiKey, secretKey, publicKey, legalVaultAccountId, assetId.*)
    ↓ (autowired bởi)
FireblocksManager
    ├── createVaultAccount()    → tạo ví custodian mới
    ├── createAddress()         → tạo địa chỉ nhận crypto
    └── createWhitelist()       → whitelist địa chỉ rút
    ↓ (gọi bởi)
    ├── AddressMaker (point-worker)         → worker tạo địa chỉ deposit cho user
    └── CreateWhitelistMaker (point-worker) → worker whitelist địa chỉ withdrawal
```

**File code liên quan Fireblocks:**

| File | Vai trò |
|------|---------|
| `point-common/.../config/FireblocksConfig.java` | `@ConfigurationProperties(prefix = "fireblocks")` — bind config |
| `point-common/.../component/FireblocksManager.java` | Tạo Fireblocks SDK client, gọi API |
| `point-worker/.../worker/AddressMaker.java` | Worker dùng `FireblocksManager` tạo địa chỉ |
| `point-worker/.../worker/CreateWhitelistMaker.java` | Worker dùng `FireblocksManager` whitelist |

**Lưu ý về Fireblocks Asset IDs theo môi trường:**
- **Dev/Stg (testnet):** `ADA_TEST`, `BTC_TEST`, `ETH_TEST5`, `XRP_TEST`, `NIDT_B75VRLGX_0A1F`
- **Prd (mainnet):** `ADA`, `BTC`, `ETH`, `XRP`, `NIDT`

---

### 7. Application Config

| Biến | YAML Property | Giá trị | Config Class | Mục đích |
|------|---------|----------|-------------|----------|
| `ENVIRONMENT` (Docker) | — | `dev` / `stg` / `prd` | — | Biến Docker truyền vào entrypoint, kích hoạt Spring profile |
| `SPRING_PROFILES_ACTIVE` (K8s) | — | `dev` / `stg` / `prd` | — | Override env var trên K8s, Spring đọc trực tiếp |
| — | `server.port` | `8080` | Spring Boot auto | Port chính của application |
| — | `management.port` | `8082` | Spring Boot auto | Port cho health check / Spring Actuator endpoint |
| — | `spring.config.environment` | `dev`/`stg`/`prd` | `SpringConfig` (`spring.config`) | Tên môi trường trong config, dùng bởi logic code |
| — | `async.core-pool-size` | `60` (api/admin/app), `85` (worker) | `AsyncConfig` (`async`) | Kích thước thread pool cho `@Async` task |
| — | `point-app.allowed-origin` | Domain theo env | (point-app config) | CORS whitelist — domain nào được gọi API |
| — | `point-app.debug-response` | `true` (dev), `false` (stg/prd) | (point-app config) | Trả thêm debug info trong error response |
| — | `spring.jpa.hibernate.ddl-auto` | `validate` (local), `none` (dev/stg/prd) | Spring Boot auto | DDL strategy — `none` = không tự động tạo/sửa schema |
| — | `swagger.enabled` | `true` (dev), `false` (prd) | (swagger config) | Bật/tắt Swagger UI |
| — | `spring.servlet.multipart.max-file-size` | `16MB` | Spring Boot auto | Giới hạn upload file |

**`spring.config.domain` — Định danh môi trường (KHÔNG phải endpoint URL):**

`spring.config` bind vào `SpringConfig` class (`point-common/.../config/SpringConfig.java`) với 2 fields:
- `domain`: Dùng chủ yếu làm label cho MFA TOTP URI (Google Authenticator), ví dụ: `otpauth://totp/api.dev.cxr-inc.com:user@email.com?secret=...`
- `environment`: Enum (`dev`/`stg`/`prd`) — được dùng rộng rãi (21+ chỗ) để switch logic theo môi trường (SQS queue name, security config, API endpoint selection...)

| Module | DEV | STG | PRD | Dùng ở đâu |
|--------|-----|-----|-----|------------|
| point-api | `api.dev.cxr-inc.com` | `api.stg.cxr-inc.com` | `backseat-service.com` | MFA TOTP label |
| point-admin | `admin.dev.cxr-inc.com` | `admin.stg.cxr-inc.com` | `backseat-service.com` | MFA TOTP label |
| point-app | `dev.backseat-service.com` | `stg.backseat-service.com` | `backseat-service.com` | MFA TOTP label |
| point-worker | `worker.dev.cxr-inc.com` | `worker.stg.cxr-inc.com` | `backseat-service.com` | (không dùng domain) |
| point-mmh | `worker.dev.cxr-inc.com` | `worker.stg.cxr-inc.com` | `backseat-service.com` | (không dùng domain) |

**Lưu ý:** Đây KHÔNG phải domain endpoint thực tế. Các domain dùng cho CORS, redirect URL, email link nằm ở config keys riêng:

| Config Key | Mục đích | Ví dụ DEV |
|------------|----------|-----------|
| `point-app.allowed-origin` | CORS whitelist | `https://dev-ex.backseat-service.com` |
| `coin.cus.host` | Internal API host | `https://dev.backseat-service.com` |
| `point-app.email.account-created.base-url` | Link trong email đăng ký | `https://dev-ex.backseat-service.com/farm-game/farm/?isInvesting=true&cid={0}&token={1}&exp={2}` |
| `point-app.email.forgot-password.base-url` | Link reset password | `https://dev-ex.backseat-service.com/signIn/reset/?cid={0}&token={1}&exp={2}` |
| `ponta.login-success-url` | OAuth callback URL | `https://dev-ex.backseat-service.com/oauth/callback/` |
| `ponta.game-home-url` | Game home redirect | `https://dev-ex.backseat-service.com/farm-game/` |
| `point-admin.host` | Admin panel base URL | `https://admin.dev.cxr-inc.com` |
| `point-admin.mail-address` | Admin email sender | `no-reply@dev.cxr-inc.com` |

---

### 8. Monitoring & Metrics

| Biến | Giá trị | Mục đích |
|------|---------|----------|
| `management.metrics.export.cloudwatch.enabled` | `false` (default) | Bật/tắt push metrics lên CloudWatch |
| `management.metrics.export.cloudwatch.namespace` | `point-api` / `point-worker` ... | Namespace CloudWatch cho từng module |
| `management.metrics.export.cloudwatch.step` | `1m` | Interval push metrics |
| `management.metrics.web.server.request.metric-name` | `http.server.requests` | Tên metric cho HTTP request |
| Prometheus | Enabled (dev/stg) | Endpoint `/actuator/prometheus` cho scraping |

**Logging config:**

| Config | Local | Dev/Stg/Prd | Mục đích |
|--------|-------|-------------|----------|
| Console appender | `CONSOLE_DEFAULT` | `CONSOLE_JSON` | Local dùng text đọc dễ, server dùng JSON để Fluent Bit parse |
| `show-sql` | `true` | `false` | Log SQL query — chỉ bật local để debug |
| Hikari pool log | off | `DEBUG` | Log chi tiết connection pool ở server |
| `common.log.outputRequestDetails` | `true` (api/admin/app) | `true` | Log request detail (bind qua `LogConfig` class) |

---

### 9. Trading — Amber / OKCoin

Cấu hình liquidity provider cho hệ thống POS (Point of Sale) trading.

| Biến | DEV | STG | PRD | Mục đích |
|------|-----|-----|-----|----------|
| `point-pos.best-price.amber.api-host` | `https://aws-private-alpha.whalefin.com` | Giống DEV | `https://be.whalefin.com` | Endpoint RFQ API |
| `point-pos.best-price.amber.access-key` | Hardcoded | Hardcoded | Secrets Manager | API key cho RFQ |
| `point-pos.base-trade.amber.api-host` | `https://aws-private-alpha.whalefin.com` | Giống DEV | `https://be.whalefin.com` | Endpoint Spot Order API |
| `point-pos.base-trade.coinbook.api-host` | `http://point-api-service.default.svc.cluster.local:8080` | Giống | Giống | Internal K8s service cho giao dịch nội bộ |

**Lưu ý `point-api-service.default.svc.cluster.local`:** Đây là Kubernetes internal DNS. `point-api` service expose qua K8s Service object, các module khác (worker, mmh) gọi API nội bộ qua DNS này thay vì external domain.

---

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

**Giải thích `JAVA_TOOL_OPTIONS` chi tiết:**
- `-XX:MaxDirectMemorySize=100M/500M`: Giới hạn bộ nhớ direct (off-heap) mà JVM có thể allocate. Netty (dùng bởi Lettuce Redis client) allocate direct buffer ở đây. STG cần nhiều hơn vì traffic gần production.
- `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=8000`: Bật Java Debug Wire Protocol:
  - `transport=dt_socket`: Dùng TCP socket
  - `server=y`: Pod là debug server (IDE connect vào)
  - `suspend=n`: Không chờ debugger attach mới start app
  - `address=8000`: Listen trên port 8000
  - **Chỉ dùng ở DEV** — cho phép `kubectl port-forward` rồi attach IntelliJ/Eclipse debugger

### 2. K8s Secrets (`point-secrets`)

Tất cả deployment đều inject secrets qua:
```yaml
envFrom:
  - secretRef:
      name: point-secrets
```

`envFrom: secretRef` sẽ lấy **tất cả key-value** trong K8s Secret `point-secrets` và inject thành env vars. Ví dụ nếu Secret chứa `SPRING_DATASOURCE_MASTER_URL: abc`, Pod sẽ có env var `SPRING_DATASOURCE_MASTER_URL=abc`.

Các key trong Secret này (lấy từ AWS Secrets Manager):

| Key | YAML Property tương ứng | Config Class nhận | Mục đích |
|-----|------------------------|-------------------|----------|
| `SPRING_DATA_REDIS_HOST` | `spring.data.redis.host` | `CacheConfig` | Redis hostname |
| `SPRING_DATA_REDIS_PORT` | `spring.data.redis.port` | `CacheConfig` | Redis port |
| `SPRING_DATASOURCE_MASTER_URL` | `spring.datasource.master.url` | `MasterDataSourceConfig` | Aurora MySQL connection string |
| `SPRING_DATASOURCE_MASTER_USERNAME` | `spring.datasource.master.username` | `MasterDataSourceConfig` | Aurora username |
| `SPRING_DATASOURCE_MASTER_PASSWORD` | `spring.datasource.master.password` | `MasterDataSourceConfig` | Aurora password |
| `SPRING_DATASOURCE_HISTORICAL_URL` | `spring.datasource.historical.url` | `HistoricalDataSourceConfig` | Redshift connection string |
| `SPRING_DATASOURCE_HISTORICAL_USERNAME` | `spring.datasource.historical.username` | `HistoricalDataSourceConfig` | Redshift username |
| `SPRING_DATASOURCE_HISTORICAL_PASSWORD` | `spring.datasource.historical.password` | `HistoricalDataSourceConfig` | Redshift password |
| `AWS_SES_HOST` | `aws.ses.host` | `SesConfig` | SES SMTP host |
| `AWS_SES_PORT` | `aws.ses.port` | `SesConfig` | SES SMTP port |
| `AWS_SES_USERNAME` | `aws.ses.username` | `SesConfig` | SES SMTP username |
| `AWS_SES_PASSWORD` | `aws.ses.password` | `SesConfig` | SES SMTP password |
| `AWS_CREDENTIALS_SALT` | `aws.credentials.salt` | (security components) | Salt mã hoá |
| `FIREBLOCKS_APIKEY` | `fireblocks.apiKey` | `FireblocksConfig` | Fireblocks API key |
| `FIREBLOCKS_PUBLICKEY` | `fireblocks.publicKey` | `FireblocksConfig` | Fireblocks public key |
| `FIREBLOCKS_SECRETKEY` | `fireblocks.secretKey` | `FireblocksConfig` | Fireblocks secret key |

### 3. CloudWatch Agent

DaemonSet chạy trên mọi node, thu thập metrics hệ thống (CPU, memory, disk, network).

| Biến | Source | Giá trị | Mục đích |
|------|--------|---------|----------|
| `HOST_IP` | `fieldRef: status.hostIP` | (dynamic) | IP của node — dùng tag metrics theo node |
| `HOST_NAME` | `fieldRef: spec.nodeName` | (dynamic) | Tên node — dimension trong CloudWatch metrics |
| `K8S_NAMESPACE` | `fieldRef: metadata.namespace` | (dynamic) | Namespace hiện tại — filter metrics theo namespace |
| `CI_VERSION` | Direct | `"k8s/1.3.7"` | Version tag — tracking CloudWatch agent version đang chạy |
| `RUN_WITH_IRSA` | Direct | `"True"` | Dùng IAM Role for Service Account — không cần hardcode AWS credentials trong Pod |

**Lưu ý `fieldRef`:** Kubernetes tự động inject metadata của Pod/Node vào env var. `status.hostIP` là IP thực của EC2 node chạy Pod, `spec.nodeName` là hostname EC2.

### 4. Fluent Bit (Log Shipping)

DaemonSet ship container logs từ tất cả pod lên CloudWatch Logs.

| Biến | Source | Giá trị | Mục đích |
|------|--------|---------|----------|
| `AWS_REGION` | ConfigMap `fluent-bit-cluster-info` | `ap-northeast-1` | Region gửi logs — CloudWatch Logs region |
| `CLUSTER_NAME` | ConfigMap | `point` | Tên cluster — dùng trong log group name: `/aws/containerinsights/point/application` |
| `HTTP_SERVER` | ConfigMap | `On` | Expose metrics endpoint của Fluent Bit (health check) |
| `HTTP_PORT` | ConfigMap | `2020` | Port metrics endpoint — dùng cho liveness probe |
| `READ_FROM_HEAD` | ConfigMap | `Off` | Không đọc log từ đầu file khi khởi động |
| `READ_FROM_TAIL` | ConfigMap | `On` | Chỉ đọc log mới — tránh replay toàn bộ log cũ khi Fluent Bit restart |
| `HOST_NAME` | `fieldRef: spec.nodeName` | (dynamic) | Prefix cho CloudWatch log stream — giúp identify log đến từ node nào |
| `HOSTNAME` | `fieldRef: metadata.name` | (dynamic) | Pod name của Fluent Bit — dùng cho self-monitoring |
| `CI_VERSION` | Direct | `"k8s/1.3.16"` | Version tag Fluent Bit |

**Luồng log:** Container stdout/stderr → Fluent Bit (đọc từ `/var/log/containers/*.log`) → CloudWatch Logs

### 5. AWS Load Balancer Controller

Helm chart values — không dùng env vars trực tiếp nhưng config quan trọng:

| Config | DEV | STG | Mục đích |
|--------|-----|-----|----------|
| `clusterName` | `point` | `point` | Tên EKS cluster — controller dùng để discover resources |
| `region` | `ap-northeast-1` | `ap-northeast-1` | AWS region — nơi tạo ALB/NLB |
| `vpcId` | `vpc-0e139c5a0789db4c0` | (from tfvars) | VPC để provision ALB — controller cần biết VPC để tìm subnets |
| `replicaCount` | `2` | `2` | Số replica controller pod — HA cho controller |
| `image.tag` | `v3.1.0` | `v3.1.0` | Version controller — ảnh hưởng tới feature support |

---

## III. Luồng quản lý Secrets (End-to-End)

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. AWS Secrets Manager                                               │
│    ├── point/base                    → SES, credentials salt         │
│    ├── point/SPRING_DATA_REDIS       → Redis host/port               │
│    ├── point/SPRING_DATASOURCE_MASTER → Aurora URL/user/pass         │
│    ├── point/SPRING_DATASOURCE_HISTORICAL → Redshift URL/user/pass   │
│    ├── point/exc                     → Fireblocks keys               │
│    └── point/aws-credentials         → AWS creds (local dev only)    │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
                       │ (1) fetch_credentials.sh
                       │     - Pull tất cả secrets
                       │     - Merge thành 1 flat key-value map
                       │     - Diff với secret hiện tại
                       │     - Backup bản cũ
                       │     - Xác nhận trước khi apply
                       ↓
┌──────────────────────────────────────────────────────────────────────┐
│ 2. K8s Secret "point-secrets" (namespace: default)                   │
│    ├── SPRING_DATA_REDIS_HOST=...                                    │
│    ├── SPRING_DATASOURCE_MASTER_URL=...                              │
│    ├── FIREBLOCKS_APIKEY=...                                         │
│    └── ... (tất cả keys merged từ 5 secret paths)                    │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
                       │ (2) envFrom: secretRef: point-secrets
                       │     (trong deployment.yaml)
                       ↓
┌──────────────────────────────────────────────────────────────────────┐
│ 3. Pod Environment Variables                                         │
│    Tất cả keys trong Secret → env vars trong container               │
│    VD: SPRING_DATASOURCE_MASTER_URL=jdbc:mariadb:aurora//host:3306/db│
└──────────────────────┬───────────────────────────────────────────────┘
                       │
                       │ (3) Spring Boot Relaxed Binding
                       │     SPRING_DATASOURCE_MASTER_URL
                       │       → spring.datasource.master.url
                       ↓
┌──────────────────────────────────────────────────────────────────────┐
│ 4. Java @ConfigurationProperties / @Value                            │
│    ├── MasterDataSourceConfig.url    ← spring.datasource.master.url  │
│    ├── CacheConfig.host              ← spring.data.redis.host        │
│    ├── SesConfig.host                ← aws.ses.host                  │
│    ├── FireblocksConfig.apiKey       ← fireblocks.apiKey             │
│    └── JwtManager.secret             ← jwt.secret (@Value)          │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
                       │ (4) Beans sử dụng config
                       ↓
┌──────────────────────────────────────────────────────────────────────┐
│ 5. Business Logic                                                    │
│    ├── Repository → masterDataSource → Aurora MySQL                  │
│    ├── RedisTemplate → LettuceConnectionFactory → Redis              │
│    ├── SesManager → SMTP connection → SES                            │
│    ├── FireblocksManager → Fireblocks SDK → Fireblocks API           │
│    └── JwtManager → JWT create/verify → Customer auth                │
└──────────────────────────────────────────────────────────────────────┘
```

---

## IV. Bảng tổng hợp: Biến → YAML → Java Class → Sử dụng ở đâu

| Env Var (K8s Secret) | YAML Property | Java Config Class | Bean tạo ra | Sử dụng bởi |
|---|---|---|---|---|
| `SPRING_DATASOURCE_MASTER_URL` | `spring.datasource.master.url` | `MasterDataSourceConfig` | `masterDataSource`, `masterEntityManagerFactory`, `masterJdbcTemplate` | Tất cả Repository (CRUD user, order, transaction) |
| `SPRING_DATASOURCE_MASTER_USERNAME` | `spring.datasource.master.username` | `MasterDataSourceConfig` | (cùng trên) | (cùng trên) |
| `SPRING_DATASOURCE_MASTER_PASSWORD` | `spring.datasource.master.password` | `MasterDataSourceConfig` | (cùng trên) | (cùng trên) |
| `SPRING_DATASOURCE_HISTORICAL_URL` | `spring.datasource.historical.url` | `HistoricalDataSourceConfig` | `historicalDataSource`, `historicalEntityManagerFactory`, `historicalJdbcTemplate` | Admin report queries, data archival |
| `SPRING_DATASOURCE_HISTORICAL_USERNAME` | `spring.datasource.historical.username` | `HistoricalDataSourceConfig` | (cùng trên) | (cùng trên) |
| `SPRING_DATASOURCE_HISTORICAL_PASSWORD` | `spring.datasource.historical.password` | `HistoricalDataSourceConfig` | (cùng trên) | (cùng trên) |
| `SPRING_DATA_REDIS_HOST` | `spring.data.redis.host` | `CacheConfig` | `LettuceConnectionFactory`, `RedisTemplate`, `RedissonClient`, `CacheManager` | Session, cache, lock, PubSub WebSocket |
| `SPRING_DATA_REDIS_PORT` | `spring.data.redis.port` | `CacheConfig` | (cùng trên) | (cùng trên) |
| `AWS_SES_HOST` | `aws.ses.host` | `SesConfig` | (config bean) | `SesManager.sendWithoutThread()` → gửi email |
| `AWS_SES_PORT` | `aws.ses.port` | `SesConfig` | (config bean) | (cùng trên) |
| `AWS_SES_USERNAME` | `aws.ses.username` | `SesConfig` | (config bean) | (cùng trên) |
| `AWS_SES_PASSWORD` | `aws.ses.password` | `SesConfig` | (config bean) | (cùng trên) |
| `AWS_CREDENTIALS_SALT` | `aws.credentials.salt` | (security) | — | Mã hoá/giải mã credentials nội bộ |
| `FIREBLOCKS_APIKEY` | `fireblocks.apiKey` | `FireblocksConfig` | (config bean) | `FireblocksManager` → `AddressMaker`, `CreateWhitelistMaker` (workers) |
| `FIREBLOCKS_SECRETKEY` | `fireblocks.secretKey` | `FireblocksConfig` | (config bean) | (cùng trên) |
| `FIREBLOCKS_PUBLICKEY` | `fireblocks.publicKey` | `FireblocksConfig` | (config bean) | (cùng trên) |

**Tất cả Config class nằm tại:** `point-common/src/main/java/point/common/config/`

---

# Phần B: Công cụ & Scripts

## I. K8s Manifests Scripts

Nằm tại: `bs-exchange-infra/k8s-manifests/bin/`

### 1. `k8s_apply.sh` — Triển khai toàn bộ K8s

**Đường dẫn:** `k8s-manifests/bin/k8s_apply.sh`

**Mục đích:** Script chính để triển khai toàn bộ Kubernetes manifests lên EKS cluster. Thực hiện tuần tự tất cả các bước cần thiết — từ update kubeconfig, cài đặt controller, đến deploy application.

**Cú pháp:**
```bash
cd bs-exchange-infra/k8s-manifests/bin/
./k8s_apply.sh --env <env>
```

**Tham số:**
| Tham số | Giá trị | Bắt buộc | Mô tả |
|---------|---------|----------|-------|
| `--env` | `dev`, `dev-ex`, `stg`, `stg-ex`, `prd` | Không (detect từ AWS profile) | Chỉ định môi trường target |

**Các bước thực hiện (theo thứ tự):**

| # | Bước | Mô tả | Lý do cần thiết |
|---|------|-------|-----------------|
| 1 | Update kubeconfig | `aws eks update-kubeconfig --name point` | Lấy credentials kết nối EKS cluster |
| 2 | VPC CNI tuning | Set `WARM_IP_TARGET=2`, `MINIMUM_IP_TARGET=1` trên `aws-node` DaemonSet | Tối ưu IP allocation — giữ 2 IP warm sẵn, giảm thời gian khởi tạo Pod |
| 3 | RBAC | Apply ClusterRole và RoleBinding | Phân quyền cho service accounts |
| 4 | aws-auth ConfigMap | Map IAM roles/users → K8s permissions | Cho phép IAM users quản lý cluster |
| 5 | ALB Controller CRDs | Download và apply Custom Resource Definitions | CRDs phải tồn tại trước khi cài controller |
| 6 | ALB Controller (Helm) | `helm upgrade --install` AWS Load Balancer Controller | Quản lý ALB/NLB từ K8s Ingress resources |
| 7 | NFS Provisioner | Helm install `nfs-subdir-external-provisioner` | Mount NFS share cho HULFT file transfer (STG/PRD only) |
| 8 | CoreDNS | Apply CoreDNS configmap override | Custom DNS resolution (STG only) |
| 9 | Cluster Autoscaler | Apply autoscaler manifest | Tự động scale node group theo demand |
| 10 | Metrics Server | Apply metrics-server | Cung cấp metrics cho HPA (Horizontal Pod Autoscaler) |
| 11 | CloudWatch + Fluent Bit | Apply DaemonSets | Thu thập metrics (CW Agent) và ship logs (Fluent Bit) |
| 12 | Pod Security | Apply PSA namespace labels | Enforce security standards cho pods |
| 13 | NetworkPolicy | Apply network rules | Restrict traffic giữa pods |
| 14 | Secrets | Gọi `fetch_credentials.sh` | Đồng bộ secrets từ AWS Secrets Manager → K8s Secret |
| 15 | Kustomize deployments | `kustomize build | kubectl apply` cho 5 services | Deploy admin, api, app, mmh, worker + ingress |

**NFS Config theo môi trường:**
| Env | NFS Server | Mục đích |
|-----|-----------|----------|
| STG | `10.51.187.138:/mnt/hulft/tmp` | HULFT file transfer với Ponta (staging) |
| PRD | `10.51.188.138:/mnt/hulft/tmp` | HULFT file transfer với Ponta (production) |

**Dependencies:** `aws` CLI, `kubectl`, `helm`, `wget`, `kustomize`

**Ví dụ:**
```bash
# Deploy toàn bộ lên STG
./k8s_apply.sh --env stg-ex

# Deploy lên DEV (auto-detect từ AWS_PROFILE)
export AWS_PROFILE=bs-point-dev-ex
./k8s_apply.sh
```

**Lưu ý khi sử dụng:**
- Script chạy **tất cả bước tuần tự**. Nếu chỉ muốn update deployment (bước 15), vẫn phải chờ các bước trước. Cân nhắc chạy `kustomize build | kubectl apply` trực tiếp nếu chỉ cần deploy lại app.
- Nếu ALB Controller CRDs download fail (network issue), toàn bộ script sẽ dừng.
- Script ưu tiên dùng standalone `kustomize` command. Nếu không có, fallback sang `kubectl kustomize`.

---

### 2. `fetch_credentials.sh` — Đồng bộ Secrets

**Đường dẫn:** `k8s-manifests/bin/fetch_credentials.sh`

**Mục đích:** Lấy secrets từ AWS Secrets Manager, so sánh với K8s Secret hiện tại, và apply nếu có thay đổi. Đây là script **an toàn nhất** để cập nhật credentials vì có backup + diff + confirm.

**Cú pháp:**
```bash
./fetch_credentials.sh [--env <env>] [--list]
```

**Tham số:**
| Tham số | Mô tả |
|---------|-------|
| `--env <env>` | Chỉ định môi trường (`dev`, `stg`, `prd`, `local`) |
| `--list` | Chỉ liệt kê secret keys sẽ được fetch (dry-run, không apply) |

**Hành vi theo môi trường:**
| Mode | Output | Secrets fetched | Mô tả |
|------|--------|----------------|-------|
| `local` | File `local.env` | `base`, `aws-credentials` | Tạo file env cho local Spring Boot run |
| `default` | K8s Secret `point-secrets` | `base`, `SPRING_DATA_REDIS`, `SPRING_DATASOURCE_MASTER`, `SPRING_DATASOURCE_HISTORICAL`, `exc` | Tạo/update K8s Opaque Secret |

**Luồng thực thi chi tiết:**
1. Validate AWS credentials (kiểm tra `aws sts get-caller-identity`)
2. Fetch secrets từ AWS Secrets Manager (5 secret paths → merge thành 1 map)
3. Lọc bỏ keys chứa hyphen (convention nội bộ)
4. Backup K8s Secret hiện tại vào `.secret-backups/` (giữ 10 bản gần nhất)
5. So sánh new vs old — hiển thị chi tiết:
   - Keys mới thêm (added)
   - Keys bị thay đổi (changed)
   - Keys bị xoá (deleted)
6. Hỏi xác nhận user (`Apply changes? [y/N]`)
7. Nếu đồng ý → `kubectl apply` Secret mới

**Dependencies:** `aws` CLI, `kubectl`, `jq`

**Ví dụ:**
```bash
# Xem những key nào sẽ được fetch (không thay đổi gì)
./fetch_credentials.sh --list

# Đồng bộ secrets cho STG
./fetch_credentials.sh --env stg

# Tạo file local.env cho dev local
./fetch_credentials.sh --env local
# → Kết quả: file local.env chứa key=value, dùng cho IntelliJ EnvFile plugin
```

**Sau khi update secrets:** Các Pod đang chạy **không tự động** nhận secrets mới. Cần restart deployment:
```bash
kubectl rollout restart deployment/point-api-deployment
kubectl rollout restart deployment/point-worker-deployment
# ... (tất cả 5 deployments)
```

---

### 3. `apply_secrets.sh` — Wrapper cho fetch_credentials

**Đường dẫn:** `k8s-manifests/bin/apply_secrets.sh`

**Mục đích:** Wrapper đơn giản: (1) update kubeconfig, (2) gọi `fetch_credentials.sh`. Dùng khi chưa connect tới cluster.

**Cú pháp:**
```bash
./apply_secrets.sh [--env <env>]
```

**Tham số:**
| Tham số | Giá trị | Mô tả |
|---------|---------|-------|
| `--env` | `dev`, `dev2`, `dev3`, `stg`, `stg2`, `stg-ex`, `prd` | Chỉ định môi trường |

**Khác biệt so với `fetch_credentials.sh`:** Script này thêm bước `aws eks update-kubeconfig` trước khi fetch. Dùng khi kubectl chưa được config cho cluster target.

**Ví dụ:**
```bash
# Từ máy local chưa connect cluster
./apply_secrets.sh --env stg-ex
```

---

### 4. `rehearsal_secrets.sh`

**Đường dẫn:** `k8s-manifests/bin/rehearsal_secrets.sh`

**Mục đích:** Phiên bản tương tự `fetch_credentials.sh` — dùng cho rehearsal (diễn tập) trước khi apply thật. Cùng logic backup/diff/confirm.

---

## II. Terraform Scripts

### 1. `terraform.sh` — Wrapper chính

**Đường dẫn:** `bs-exchange-infra/terraform/terraform.sh`

**Mục đích:** Wrapper quản lý Terraform backend configuration và môi trường. **Bắt buộc dùng script này thay vì chạy `terraform` trực tiếp** — vì nó quản lý S3 backend state cho từng env.

**Cú pháp:**
```bash
# Chạy từ thư mục component
cd terraform/components/<component>
../../terraform.sh [options] <terraform-command>
```

**Tham số:**
| Tham số | Mô tả |
|---------|-------|
| `--env <env>` | Chỉ định môi trường (override AWS_PROFILE/AWS_VAULT detection) |
| `--clean` | Xoá thư mục terraform working (`tmp/<ENV>/<COMPONENT>`) — dùng khi state bị corrupt |
| `--local` | Dùng local backend thay vì S3 — dùng cho test/experiment |
| `-v` | Verbose output — hiện full terraform output |
| `-h`, `--help` | Hiển thị help |

**Auto-detect môi trường (từ AWS_PROFILE hoặc AWS_VAULT):**
| AWS_PROFILE pattern | Môi trường detected |
|---------------------|---------------------|
| `bs-point-dev*` | `dev` |
| `bs-point-stg*` | `stg` |
| `bs-point-prd*` | `prd` |
| `bs-point-cxr-dev*` | `cxr-dev` |

**Backend S3 config:**
- Bucket: `tfstate.bs-point-<ENV>` (ví dụ: `tfstate.bs-point-dev-ex`)
- State key: `<COMPONENT>/terraform.tfstate`
- Region: `ap-northeast-1`

**Luồng thực thi:**
1. Detect môi trường từ `--env` hoặc AWS_PROFILE
2. Copy `backend.tf` từ `tf-backend/` vào component directory
3. Nếu cần init → tự động chạy `terraform init` với S3 backend
4. Chạy terraform command (plan/apply/destroy/...)
5. Cleanup `backend.tf`
6. Hiển thị elapsed time

**Tính năng đặc biệt:**
- Tự động `terraform init` khi chưa init (`AUTO_TERRAFORM_INIT=1`)
- Lưu config backend vào `.cxr_config` — nhớ backend setting giữa các lần chạy
- Trap Ctrl+C (SIGINT/SIGTERM) để cleanup `backend.tf` — tránh file rác
- Đo và hiển thị thời gian thực thi

**Ví dụ:**
```bash
# Init và plan cho VPC ở STG
cd terraform/components/vpc
../../terraform.sh --env stg-ex init
../../terraform.sh --env stg-ex plan

# Apply EKS ở DEV (auto-detect env từ AWS_PROFILE)
export AWS_PROFILE=bs-point-dev-ex
cd terraform/components/eks
../../terraform.sh apply

# Xoá cache terraform cho một component (khi state bị corrupt)
../../terraform.sh --clean

# Dùng local backend cho test
../../terraform.sh --local init
```

**Dependencies:** `terraform`, `lib/bash-functions.sh`

---

### 2. `execute.sh` — Multi-component executor

**Đường dẫn:** `bs-exchange-infra/terraform/tool/execute_targets/execute.sh`

**Mục đích:** Chạy terraform command lên nhiều components cùng lúc theo thứ tự định nghĩa trong file targets. Hữu ích khi cần init/plan/apply toàn bộ infrastructure.

**Cú pháp:**
```bash
cd terraform/tool/execute_targets/
./execute.sh [options] <terraform-command>
```

**Tham số:**
| Tham số | Mô tả |
|---------|-------|
| `--env <env>` | Chỉ định môi trường |
| `-f <file>` | File chứa danh sách components (default: `targets.txt`) |
| `-v` | Verbose output |
| `-y` | Auto-approve (không hỏi xác nhận) — dùng trong CI/CD |

**Format file targets (`targets.txt`):**
```
# Dòng bắt đầu bằng # là comment, sẽ bị bỏ qua
vpc
eks
ec2-bastion
sns-alert
```

**Hành vi theo command:**
| Command | Thứ tự thực thi | Song song? | Lý do |
|---------|-----------------|-----------|-------|
| `init`, `get` | Theo file | Song song (mỗi component 1 log) | Init không có dependency giữa components |
| `plan`, `apply` | Theo file (trên → dưới) | Tuần tự | Apply cần theo dependency order (VPC trước EKS) |
| `destroy` | **Ngược** (dưới → trên) | Tuần tự | Destroy ngược — EKS trước VPC (xoá resource phụ thuộc trước) |

**Ví dụ:**
```bash
# Init tất cả components song song
./execute.sh --env stg init

# Plan tuần tự
./execute.sh --env stg plan

# Apply với custom targets file, auto-approve
./execute.sh -y -f stg-targets.txt --env stg-ex apply

# Destroy theo thứ tự ngược (cẩn thận!)
./execute.sh --env dev-ex destroy
```

**Output mẫu:**
```
AWS_PROFILE: bs-point-stg-ex
Target environment: stg-ex
Target resources:
  vpc
  eks
  ec2-bastion

Execution command: terraform plan

[vpc] Running terraform plan...
[vpc] Success (45 sec)

[eks] Running terraform plan...
[eks] Success (1 min 23 sec)

Total elapsed time: 2 min 8 sec
```

**Dependencies:** `terraform`, `lib/bash-functions.sh`

---

## III. Database User Management

Nằm tại: `bs-exchange-infra/terraform/tool/db-user-manager/`

Bộ scripts quản lý user accounts cho Aurora MySQL và Redshift, đồng bộ credentials vào AWS Secrets Manager. Thiết kế theo **principle of least privilege** — mỗi user chỉ có quyền cần thiết.

### 1. Aurora Scripts

| Script | Mục đích | Cú pháp |
|--------|----------|---------|
| `aurora-create-users.sh` | Tạo 4 user accounts + update 5 secrets trong AWS SM | `AURORA_HOST=<host> ./aurora-create-users.sh` |
| `aurora-drop-users.sh` | Xoá 4 user accounts | `AURORA_HOST=<host> ./aurora-drop-users.sh` |
| `aurora-update-master-password.sh` | Rotate password master user | `AURORA_HOST=<host> ./aurora-update-master-password.sh` |
| `aurora-update-passwords.sh` | Rotate password 4 application users | `AURORA_HOST=<host> ./aurora-update-passwords.sh` |

**User roles và permissions (least privilege):**
| User | Secret Path | Quyền SQL | Dùng bởi |
|------|-------------|-----------|----------|
| `master` | `point/aurora/master_user` | Full admin | DBA, migration |
| `point` (editor_service) | `point/aurora/editor_service` | SELECT, INSERT, UPDATE, DELETE trên `point.*` | Application service (read/write) — đây là user chính cho `SPRING_DATASOURCE_MASTER` |
| `point_viewer` (viewer_service) | `point/aurora/viewer_service` | SELECT trên `point.*` | Application service (read-only) |
| `editor` | `point/aurora/editor_user` | ALL trên `point.*` | Admin user (có thể ALTER, DROP) |
| `viewer` | `point/aurora/viewer_user` | SELECT trên `point.*` | Admin user read-only |

**Luồng thực thi `aurora-create-users.sh`:**
1. Source `init.sh` và `init-aurora.sh` (load hàm utility)
2. Tự động generate random 16-char password cho mỗi user
3. Hỏi master password (input)
4. Kết nối MySQL và chạy CREATE USER + GRANT cho 4 users
5. Update 5 secrets trong AWS Secrets Manager (4 user secrets + 1 Spring Boot secret)
6. Spring Boot secret chứa: URL + username `point` + password (cho application dùng)

**Spring Boot secret format (`point/SPRING_DATASOURCE_MASTER`):**
```json
{
  "engine": "mariadb",
  "host": "<AURORA_HOST>",
  "port": "3306",
  "dbname": "point",
  "username": "point",
  "password": "<generated_password>",
  "dbClusterIdentifier": "point",
  "url": "jdbc:mariadb:aurora//<HOST>:3306/point?zeroDateTimeBehavior=convertToNull"
}
```

**Ví dụ sử dụng:**
```bash
# SSH vào bastion trước
ssh bastion

# Set Aurora host (lấy từ RDS console hoặc secrets)
export AURORA_HOST=point-cluster.cluster-abc123.ap-northeast-1.rds.amazonaws.com

# Tạo users lần đầu
cd terraform/tool/db-user-manager
./aurora-create-users.sh
# → Nhập master password khi được hỏi
# → 4 users được tạo + 5 secrets được update

# Rotate passwords (nên làm định kỳ)
./aurora-update-passwords.sh
# → Nhập master password
# → 4 passwords được rotate + secrets updated
# → CẦN restart application pods sau khi rotate!
```

### 2. Redshift Scripts

| Script | Mục đích | Cú pháp |
|--------|----------|---------|
| `redshift-create-users.sh` | Tạo 4 user accounts cho Redshift | `REDSHIFT_HOST=<host> ./redshift-create-users.sh` |
| `redshift-update-master-password.sh` | Rotate password master | `REDSHIFT_HOST=<host> ./redshift-update-master-password.sh` |
| `redshift-update-passwords.sh` | Rotate password 4 application users | `REDSHIFT_HOST=<host> ./redshift-update-passwords.sh` |

**Spring Boot secret format (`point/SPRING_DATASOURCE_HISTORICAL`):**
```json
{
  "engine": "redshift",
  "host": "<REDSHIFT_HOST>",
  "port": "5439",
  "dbname": "point",
  "username": "point",
  "password": "<generated_password>",
  "url": "jdbc:redshift://<HOST>:5439/point"
}
```

**Lưu ý quan trọng sau khi rotate password:**
1. Secrets trong AWS Secrets Manager đã updated
2. Nhưng K8s Secret `point-secrets` **chưa** updated — cần chạy `fetch_credentials.sh`
3. Sau khi K8s Secret updated, Pod **vẫn chưa** nhận giá trị mới — cần `kubectl rollout restart`

```bash
# Sau khi rotate DB passwords:
cd k8s-manifests/bin
./fetch_credentials.sh --env stg          # (1) Sync secrets
kubectl rollout restart deployment -l app=point  # (2) Restart pods
```

### 3. Shared Libraries

| File | Mục đích |
|------|----------|
| `init.sh` | Hàm chung: `generate_password()` (tạo password 16 ký tự alphanumeric), `update-secret-value()` (update AWS Secrets Manager) |
| `init-aurora.sh` | Config Aurora: định nghĩa user roles, secret paths, hàm `aurora-update-secret-value()` và `update-spring-boot-secret()` |
| `init-redshift.sh` | Config Redshift: tương tự `init-aurora.sh` nhưng cho Redshift (port 5439, driver redshift) |

**Hàm `generate_password()`:**
```bash
# Tạo password 16 ký tự từ [a-zA-Z0-9]
cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | head -c 16
```

**Hàm `update-secret-value()`:**
```bash
# Update AWS Secrets Manager với JSON format
update-secret-value ENGINE HOST PORT DBNAME SECRET_ID USERNAME PASSWORD
# → aws secretsmanager put-secret-value --secret-id SECRET_ID --secret-string '{...}'
```

**Cách sử dụng libraries:**
```bash
# Các script aurora-*.sh và redshift-*.sh đều source:
source ./init.sh
source ./init-aurora.sh   # hoặc init-redshift.sh
```

---

## IV. Lambda Build Scripts

Scripts đóng gói Lambda function thành ZIP để deploy qua Terraform.

| Script | Lambda | Ngôn ngữ | Files đóng gói | Mục đích |
|--------|--------|----------|----------------|----------|
| `terraform/components/sns-alert/sns-to-slack/build.sh` | SNS to Slack | Python | `app.py`, `app_util.py`, `slack_message.py` | Forward SNS alerts (CloudWatch alarm, error) tới Slack channel |
| `terraform/components/sns-alert/sns-to-slack/clean.sh` | SNS to Slack | Python | — | Xoá `__pycache__` và `.pytest_cache` |
| `terraform/components/waf-maintenance-lambda/src/scripts/build.sh` | WAF Maintenance | Python | `app.py`, `utils.py`, `rules/` | Tự động bật/tắt WAF maintenance mode (block traffic) |
| `terraform/components/frontend-customer/src/build.sh` | Frontend | JavaScript | `index.js` | Lambda@Edge cho CloudFront — URL rewrite, header manipulation |

**Cách sử dụng chung:**
```bash
cd <lambda-source-dir>
./build.sh               # Tạo ../lambda_function.zip
# → Terraform sẽ reference file zip này khi deploy lambda
```

**Makefile (WAF Maintenance) — cho testing local:**
```bash
cd terraform/components/waf-maintenance-lambda/src
make build                # Đóng gói lambda
make maintenance-start    # Test local với event maintenance-start.json
make maintenance-end      # Test local với event maintenance-end.json
make clean                # Xoá cache

# Requires: pip install python-lambda-local
```

---

## V. EC2 User Data Scripts

Scripts cloud-init chạy **một lần duy nhất** khi EC2 instance khởi tạo lần đầu (Terraform truyền qua `user_data` field).

### 1. Bastion Host (`ec2-bastion/user_data.sh`)

**Mục đích:** Cài đặt tools cho bastion host (jump server) để truy cập hạ tầng nội bộ.

**Tools cài đặt:**
| Tool | Version | Mục đích |
|------|---------|----------|
| `kubectl` | v1.28.15 | Quản lý K8s cluster từ bastion |
| `helm` | v3.16.1 | Quản lý Helm charts |
| `aws` CLI | v2 (latest) | Tương tác AWS API |
| `terraform` | latest | Quản lý infrastructure (khi cần chạy từ bastion) |
| `jq` | latest | Parse JSON output từ AWS/kubectl |
| `redis-tools` | latest | Debug Redis: `redis-cli -h <host> PING` |
| `mariadb-client` | latest | Debug Aurora: `mysql -h <host> -u <user> -p` |
| `postgresql-12` | v12 | Debug Redshift: `psql -h <host> -U <user> -d <db>` |
| `shfmt` | latest | Format shell scripts |

### 2. Data Transfer (`ec2-data-transfer/user_data.sh`)

**Mục đích:** Instance cho data migration/transfer tasks — chạy Java tools, query DB.

**OS:** Amazon Linux 2023

**Tools cài đặt:**
| Tool | Mục đích |
|------|----------|
| OpenJDK 17 (Corretto) | Chạy Java migration tools |
| PostgreSQL 15 client | Kết nối Redshift |
| MariaDB 10.5 client | Kết nối Aurora |
| AWS CLI v2 | Tương tác AWS |
| Git, jq, perl | Utility tools |

### 3. HULFT Server (`ec2-hulft/user_data.sh`)

**Mục đích:** Instance chạy HULFT file transfer system — trao đổi file với Ponta (loyalty program).

**OS:** RHEL 8 (yêu cầu của HULFT)

**Các bước setup:**
1. Đăng ký RHEL subscription + enable repos
2. Cài đặt AWS CLI, SSM Agent
3. Mount EBS volume (`/dev/nvme1n1`) → format ext4 → mount `/mnt/hulft`
4. Export NFS share → K8s pods mount qua NFS provisioner
5. Download và cài HULFT v8.5.2 từ S3
6. Tạo systemd service `hulft` (send/receive/observe daemons)
7. Tạo systemd service `watch_snddata` (file monitor)
8. Set ngôn ngữ hệ thống sang Japanese (yêu cầu của HULFT)

**Biến Terraform truyền vào (template variables):**
| Biến | Mục đích |
|------|----------|
| `${hostname}` | Hostname instance |
| `${ponta_hulft_ip}` | IP HULFT server phía Ponta |
| `${ponta_hulft_hostname}` | Hostname HULFT Ponta |
| `${hulft_serial}` | HULFT license serial |
| `${hulft_productkey}` | HULFT license product key |
| `${ponta_hulft_snd001_name/id}` | Send definition 1 (loại file gửi) |
| `${ponta_hulft_snd002_name/id}` | Send definition 2 |

**File monitor (`watch_snddata`):** Dùng `inotifywait` theo dõi `/mnt/hulft/tmp/snddata/`. Khi file mới xuất hiện → tự động trigger HULFT send → gửi file tới Ponta server. Có lock mechanism tránh duplicate send.

---

## VI. Bash Utility Library

**Đường dẫn:** `bs-exchange-infra/lib/bash-functions.sh`

**Mục đích:** Thư viện hàm dùng chung cho `terraform.sh`, `execute.sh`, và các scripts khác.

| Hàm | Mô tả | Input | Output | Ví dụ |
|-----|-------|-------|--------|-------|
| `get_target_env()` | Detect môi trường từ `AWS_PROFILE` hoặc `AWS_VAULT` | Env vars | Set biến `env` | `source bash-functions.sh && get_target_env && echo $env` → `stg-ex` |
| `echo_label()` | In text màu cyan (label format, không xuống dòng) | String | Stdout (cyan) | `echo_label "Status: " && echo "OK"` |
| `seconds_to_minsec()` | Chuyển giây → human-readable | Seconds (int) | String | `seconds_to_minsec 305` → `"5 min 5 sec"` |

**Mapping AWS Profile → Env (thứ tự check, pattern cụ thể trước):**
| Pattern | Kết quả |
|---------|---------|
| `bs-point-dev2*` | `dev2` |
| `bs-point-dev3*` | `dev3` |
| `bs-point-dev*` | `dev` |
| `bs-point-stg-ex*` | `stg-ex` |
| `bs-point-stg*` | `stg` |
| `bs-point-prd*` | `prd` |

**Lưu ý:** Pattern cụ thể (`dev2`, `stg-ex`) được check trước pattern chung (`dev`, `stg`) để tránh match sai.

---

# Phần C: Lưu ý Bảo mật

### 1. Credentials bị hardcode trong source code

Các API key/secret sau **đang nằm trực tiếp** trong `application-{dev,stg}.yaml`:

| Service | File | Rủi ro |
|---------|------|--------|
| AWS SES | `application.yaml` | SMTP credentials hardcoded — nếu repo leak, attacker có thể gửi email giả danh |
| GMO Aozora | `application-dev.yaml` | Client ID + Secret — truy cập bank API |
| OKCoin | `application-dev.yaml` | API Key + Secret + Passphrase — giao dịch trên sàn |
| Refinitiv | `application-dev.yaml` | API Key + Secret Key — truy cập AML screening |
| EKYC | `application-dev.yaml` | Secret + Token + Auth Key — truy cập KYC service |
| Chainalysis | `application-dev.yaml` | Bearer Token — truy cập blockchain monitoring |
| Sygna | `application-dev.yaml` | Account + Credential — Travel Rule service |
| Wallet Gateway | `application-dev.yaml` | Client Secret + API Key — quản lý ví crypto |
| reCAPTCHA | `application-dev.yaml` | Secret Key — bypass CAPTCHA protection |

**Khuyến nghị:** Migrate tất cả sang AWS Secrets Manager trước khi deploy PRD. Nhiều giá trị PRD đã chuyển sang Secrets Manager (Fireblocks, Amber, JWT) nhưng dev/stg vẫn hardcode.

### 2. Remote Debug ở DEV

`JAVA_TOOL_OPTIONS` ở DEV bật JDWP trên port 8000. **Không bao giờ** được bật ở PRD vì:
- Cho phép attach debugger từ xa
- Có thể đọc toàn bộ heap memory (bao gồm passwords, tokens)
- Có thể modify runtime behavior (thay đổi logic code đang chạy)
- Kết hợp với `kubectl port-forward` = full access vào JVM

### 3. Local dev credentials trong repo

`application-local.yaml` chứa DB password, Redis host cho local development. Khuyến nghị:
- Dùng `fetch_credentials.sh --env local` để tạo file `local.env` (gitignored)
- Config IntelliJ/IDE đọc `local.env` thay vì commit credentials vào repo
- Hoặc dùng Spring `@PropertySource` load từ file ngoài classpath

### 4. Sau khi rotate password

Luồng đầy đủ khi rotate DB/service credentials:
```bash
# 1. Rotate password trong DB
./aurora-update-passwords.sh

# 2. Sync secrets từ AWS SM → K8s Secret
cd k8s-manifests/bin && ./fetch_credentials.sh --env <env>

# 3. Restart pods để nhận secret mới
kubectl rollout restart deployment -l app=point

# 4. Verify pods healthy
kubectl get pods -l app=point
```
Nếu bỏ qua bước 2-3, application sẽ dùng **password cũ** → connection refused → downtime.
