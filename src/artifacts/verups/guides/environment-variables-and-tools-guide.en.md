# Environment Variables & Infrastructure Tools Guide - Verup Project

> Comprehensive documentation of all environment variables used in the server (`bs-integration-server`) and infra (`bs-exchange-infra`), along with usage guides for all scripts/tools.
>
> Updated: 2026-03-12

---

## Table of Contents

- [Part A: Environment Variable Mapping Mechanism](#part-a-environment-variable-mapping-mechanism)
  - [0. How Spring Boot resolves environment variables](#0-how-spring-boot-resolves-environment-variables)
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
    - [10. Other configs](#10-other-configs)
  - [II. Infra Project (bs-exchange-infra/k8s-manifests)](#ii-infra-project-bs-exchange-infrak8s-manifests)
    - [1. Deployment ENV vars](#1-deployment-env-vars)
    - [2. K8s Secrets (point-secrets)](#2-k8s-secrets-point-secrets)
    - [3. CloudWatch Agent](#3-cloudwatch-agent)
    - [4. Fluent Bit (Log Shipping)](#4-fluent-bit-log-shipping)
    - [5. AWS Load Balancer Controller](#5-aws-load-balancer-controller)
  - [III. Secrets Management Flow (End-to-End)](#iii-secrets-management-flow-end-to-end)
  - [IV. Summary Table: Variable → YAML → Java Class → Where Used](#iv-summary-table-variable--yaml--java-class--where-used)
- [Part B: Tools & Scripts](#part-b-tools--scripts)
  - [I. K8s Manifests Scripts](#i-k8s-manifests-scripts)
    - [1. k8s_apply.sh — Full K8s Deployment](#1-k8s_applysh--full-k8s-deployment)
    - [2. fetch_credentials.sh — Sync Secrets](#2-fetch_credentialssh--sync-secrets)
    - [3. apply_secrets.sh — Wrapper for fetch_credentials](#3-apply_secretssh--wrapper-for-fetch_credentials)
    - [4. rehearsal_secrets.sh](#4-rehearsal_secretssh)
  - [II. Terraform Scripts](#ii-terraform-scripts)
    - [1. terraform.sh — Main Wrapper](#1-terraformsh--main-wrapper)
    - [2. execute.sh — Multi-component executor](#2-executesh--multi-component-executor)
  - [III. Database User Management](#iii-database-user-management)
    - [1. Aurora Scripts](#1-aurora-scripts)
    - [2. Redshift Scripts](#2-redshift-scripts)
    - [3. Shared Libraries](#3-shared-libraries)
  - [IV. Lambda Build Scripts](#iv-lambda-build-scripts)
  - [V. EC2 User Data Scripts](#v-ec2-user-data-scripts)
  - [VI. Bash Utility Library](#vi-bash-utility-library)
- [Part C: Security Notes](#part-c-security-notes)

---

# Part A: Environment Variable Mapping Mechanism

## 0. How Spring Boot resolves environment variables

Before diving into the details of each variable, it is important to understand the **conversion mechanism** from OS environment variables to config properties in Spring Boot.

### Conversion Rules (Relaxed Binding)

Spring Boot automatically maps env var → YAML property using the following rules:

```
OS Environment Variable:    SPRING_DATASOURCE_MASTER_URL
                               ↓ (lowercase + underscore → dot)
YAML Property Key:          spring.datasource.master.url
                               ↓ (@ConfigurationProperties prefix binding)
Java Field:                 url  (in a class with @ConfigurationProperties(prefix="spring.datasource.master"))
```

**Concrete example:**
```
Env var:  SPRING_DATASOURCE_MASTER_URL=jdbc:mariadb:aurora//host:3306/point
                    ↓
YAML:     spring.datasource.master.url: jdbc:mariadb:aurora//host:3306/point
                    ↓
Java:     MasterDataSourceConfig.url = "jdbc:mariadb:aurora//host:3306/point"
```

### Priority Order (from highest → lowest)

1. **OS Environment Variable** (e.g.: `SPRING_DATASOURCE_MASTER_URL`) — highest priority
2. **application-{profile}.yaml** (e.g.: `application-stg.yaml`) — overrides base
3. **application.yaml** — base/default config
4. **@Value default** in Java code (e.g.: `@Value("${jwt.secret:default}")`)

Since env vars have the highest priority, when K8s injects `SPRING_DATASOURCE_MASTER_URL` from a Secret, it will **override** any value in the YAML file.

### How variables are injected into Pods

```
                     Kubernetes Deployment YAML
                     ┌───────────────────────────────────┐
                     │ env:                               │
                     │   - name: SPRING_PROFILES_ACTIVE   │◄── Hardcoded in YAML
                     │     value: "stg"                   │
                     │ envFrom:                           │
                     │   - secretRef:                     │◄── Inject ALL keys from Secret
                     │       name: point-secrets          │    as env vars
                     └───────────────────────────────────┘
                                    ↓
                     ┌───────────────────────────────────┐
                     │ Pod Environment (example):        │
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
                     │ 1. Read SPRING_PROFILES_ACTIVE=stg│
                     │ 2. Load application.yaml (base)   │
                     │ 3. Load application-stg.yaml      │
                     │ 4. Env vars override YAML values  │
                     │ 5. Bind to @ConfigurationProps    │
                     └───────────────────────────────────┘
```

### `SPRING_PROFILES_ACTIVE` and `JAVA_TOOL_OPTIONS`

These two special variables **do not map to YAML** — JVM/Spring reads them directly:

| Variable | Read by | Mechanism |
|----------|---------|-----------|
| `SPRING_PROFILES_ACTIVE` | Spring Framework | Spring Boot auto-detects, determines which `application-{profile}.yaml` to load |
| `JAVA_TOOL_OPTIONS` | JVM (before Spring starts) | JVM reads this variable and applies it as command-line flags. Used to set memory, GC, debug agent |

**In the Dockerfile**, `SPRING_PROFILES_ACTIVE` can also be passed via entrypoint:
```dockerfile
# point-api/Dockerfile
ENV ENVIRONMENT $ENVIRONMENT
ENTRYPOINT ["sh", "-c", "java -jar /app/point-api.jar --spring.profiles.active=$ENVIRONMENT"]
```

However, when running on K8s, the `SPRING_PROFILES_ACTIVE` env var in the deployment YAML will **override** the value from the Dockerfile.

---

## I. Server Project (`bs-integration-server`)

The server consists of 5 Spring Boot modules: `point-api`, `point-admin`, `point-app`, `point-worker`, `point-mmh`.
Configuration uses profiles: `application.yaml` (base) + `application-{dev,stg,prd}.yaml` (per-environment override).

### 1. Database — Aurora MySQL (Master)

The main database storing all business data (user, transaction, order...).

| Environment Variable (K8s Secret) | YAML Property | Value | Purpose |
|------|---------|----------|----------|
| `SPRING_DATASOURCE_MASTER_URL` | `spring.datasource.master.url` | AWS Secrets Manager | JDBC connection string to Aurora MySQL |
| `SPRING_DATASOURCE_MASTER_USERNAME` | `spring.datasource.master.username` | AWS Secrets Manager | DB connection username |
| `SPRING_DATASOURCE_MASTER_PASSWORD` | `spring.datasource.master.password` | AWS Secrets Manager | DB connection password |

| YAML-only Property (not via env var) | Value | Purpose |
|------|---------|----------|
| `spring.datasource.master.driver-class-name` | `org.mariadb.jdbc.Driver` | JDBC driver (uses MariaDB driver for Aurora MySQL) |
| `spring.datasource.master.maximum-pool-size` | `66` (base), `150` (dev/stg) | Maximum connections in HikariCP pool |
| `spring.datasource.master.minimum-idle` | `10` | Minimum idle connections kept ready |
| `spring.datasource.master.max-lifetime` | `600000` (10 minutes) | Maximum lifetime of a single connection |
| `spring.datasource.master.idle-timeout` | `500000` (~8 minutes) | Timeout for idle connections |
| `spring.datasource.master.leak-detection-threshold` | `5000` (5 seconds) | Threshold for detecting leaked connections (not returned to pool) |

**Mapping to Java code:**

```
SPRING_DATASOURCE_MASTER_URL
    ↓ (Spring Relaxed Binding)
spring.datasource.master.url
    ↓ (@ConfigurationProperties prefix = "spring.datasource.master")
MasterDataSourceConfig extends AbstractDataSourceConfig
    ↓ (field: url, username, password)
Bean: masterDataSource (HikariDataSource)
    ↓ (injected into)
Bean: masterEntityManagerFactory (JPA EntityManagerFactory)
Bean: masterTransactionManager
Bean: masterJdbcTemplate
    ↓ (used by)
All Repositories in point.common.repos, point.pos.repos, point.operate.repos, point.spot.repos
```

**Related code files:**

| File | Line | Role |
|------|------|---------|
| `point-common/.../config/AbstractDataSourceConfig.java` | L24-30 | Base class — declares fields `url`, `username`, `password` with `@Getter/@Setter` |
| `point-common/.../config/AbstractDataSourceConfig.java` | L51-80 | Method `dataSource()` — creates `HikariDataSource` from fields |
| `point-common/.../config/MasterDataSourceConfig.java` | L20-25 | `@ConfigurationProperties(prefix = "spring.datasource.master")` — binds YAML to fields |
| `point-common/.../config/MasterDataSourceConfig.java` | L33-35 | `@Bean("masterDataSource")` — creates HikariDataSource bean |
| `point-common/.../config/MasterDataSourceConfig.java` | L38-47 | `@Bean("masterEntityManagerFactory")` — creates JPA EntityManagerFactory |
| `point-common/.../config/MasterDataSourceConfig.java` | L49-54 | `@Bean("masterTransactionManager")` — manages transactions |
| `point-common/.../config/MasterDataSourceConfig.java` | L57-59 | `@Bean` JdbcTemplate — raw JDBC access |

**Actual usage flow:**
1. Spring Boot starts → reads env var `SPRING_DATASOURCE_MASTER_URL` → binds to `MasterDataSourceConfig.url`
2. `MasterDataSourceConfig` creates `HikariDataSource` bean with URL/username/password
3. `masterEntityManagerFactory` uses this DataSource to create JPA EntityManager
4. All `@Repository` classes (e.g.: `CustomerRepository`, `OrderRepository`) scanned in package `point.common.entity` use this EntityManager
5. Business logic in `@Service` classes autowires Repository → queries/updates database

**Connection string format (local dev):**
```
jdbc:mysql://localhost:3308/point?zeroDateTimeBehavior=convertToNull&allowPublicKeyRetrieval=true
```

---

### 2. Database — Redshift (Historical)

Stores historical data (archived data) for reporting and analysis. Uses a PostgreSQL-compatible driver.

| Environment Variable (K8s Secret) | YAML Property | Value | Purpose |
|------|---------|----------|----------|
| `SPRING_DATASOURCE_HISTORICAL_URL` | `spring.datasource.historical.url` | AWS Secrets Manager | JDBC connection string to Redshift |
| `SPRING_DATASOURCE_HISTORICAL_USERNAME` | `spring.datasource.historical.username` | AWS Secrets Manager | Redshift username |
| `SPRING_DATASOURCE_HISTORICAL_PASSWORD` | `spring.datasource.historical.password` | AWS Secrets Manager | Redshift password |

| YAML-only Property | Value | Purpose |
|------|---------|----------|
| `spring.datasource.historical.driver-class-name` | `com.amazon.redshift.jdbc42.Driver` | JDBC driver for Redshift |
| `spring.datasource.historical.hibernate-dialect` | `org.hibernate.dialect.PostgreSQL82Dialect` | Hibernate SQL dialect |
| `spring.datasource.historical.maximum-pool-size` | `66` (base), `150` (dev/stg) | Maximum connections |

**Mapping to Java code:**

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
    ↓ (used by)
Repositories in point.admin.entity (read-only, historical data)
```

**Related code files:**

| File | Line | Role |
|------|------|---------|
| `point-common/.../config/HistoricalDataSourceConfig.java` | L34 | `@ConfigurationProperties(prefix = "spring.datasource.historical")` |
| `point-common/.../config/HistoricalDataSourceConfig.java` | L47-50 | `@Bean("historicalDataSource")` |
| `point-common/.../config/HistoricalDataSourceConfig.java` | L52-61 | `@Bean("historicalEntityManagerFactory")` |
| `point-common/.../config/HistoricalDataSourceConfig.java` | L78-82 | `@Bean("historicalJdbcTemplate")` |

**Note on Multi-DataSource:** The project uses 2 DataSources in parallel (Master + Historical). Spring Boot only supports 1 by default, so `@Primary` is needed on master and `@Qualifier` when injecting historical. Repository package scans are separated so each DataSource only manages its own entities.

**Connection string format (local dev):**
```
jdbc:postgresql://localhost:5439/point
```

---

### 3. Redis (Cache & Session)

Used for data caching (price, ticker), user sessions, distributed locks, and PubSub for real-time WebSocket.

| Environment Variable (K8s Secret) | YAML Property | Value | Purpose |
|------|---------|----------|----------|
| `SPRING_DATA_REDIS_HOST` | `spring.data.redis.host` | AWS Secrets Manager | ElastiCache Redis endpoint |
| `SPRING_DATA_REDIS_PORT` | `spring.data.redis.port` | `6379` | Standard Redis port |

| YAML-only Property | Value | Purpose |
|------|---------|----------|
| `spring.session.store-type` | `redis` (app/admin) / `none` (api/worker) | Session store type — app and admin use Redis sessions, api/worker don't need them |
| `exchange-websocket.redis-pubsub-cache.enabled` | `true` | Enable cache via Redis PubSub |
| `exchange-websocket.redis-pubsub-cache.expire-in-minutes` | `5` | PubSub cache expiration time |

**Mapping to Java code:**

```
SPRING_DATA_REDIS_HOST + SPRING_DATA_REDIS_PORT
    ↓
spring.data.redis.host / spring.data.redis.port
    ↓ (@ConfigurationProperties prefix = "spring.data.redis")
CacheConfig (fields: host, port, maxTotal, maxIdle, minIdle)
    ↓ creates these beans:
    ├── LettuceConnectionFactory    ← Redis connection (new RedisStandaloneConfiguration(host, port))
    ├── RedisTemplate<String, E>    ← general key-value operations
    ├── RedisTemplate<String, BigDecimal>  ← crypto price cache
    ├── RedisTemplate<String, Date>        ← timestamp cache
    ├── CacheManager                ← Spring @Cacheable integration
    └── RedissonClient              ← distributed lock (redis://{host}:{port})
```

**Related code files:**

| File | Line | Role |
|------|------|---------|
| `point-common/.../config/CacheConfig.java` | L38 | `@ConfigurationProperties(prefix = "spring.data.redis")` |
| `point-common/.../config/CacheConfig.java` | L52-54 | Fields: `host`, `port`, `maxTotal`, `maxIdle`, `minIdle` |
| `point-common/.../config/CacheConfig.java` | L79-86 | `LettuceConnectionFactory` — creates Redis connection |
| `point-common/.../config/CacheConfig.java` | L89-93 | `RedisTemplate<String, E>` — general template |
| `point-common/.../config/CacheConfig.java` | L96-101 | `RedisTemplate<String, BigDecimal>` — for crypto prices |
| `point-common/.../config/CacheConfig.java` | L68-76 | `CacheManager` — manages cache regions |
| `point-common/.../config/CacheConfig.java` | L152-162 | `RedissonClient` — for distributed locks |
| `point-common/.../component/CustomRedisTemplate.java` | — | Utility wrapper for RedisTemplate |
| `point-app/.../config/websocket/RedisSubscriberConfig.java` | — | PubSub subscriber for real-time WebSocket |

**Where Redis is actually used:**
- **Session:** `point-app` and `point-admin` use `spring.session.store-type=redis` → user sessions stored in Redis instead of memory
- **Cache:** `@Cacheable` annotation on service methods caches Symbol, SystemConfig, WorkerMaster, LoginAttempt
- **Lock:** `point-worker` uses `RedissonClient` to lock worker tasks, preventing 2 pods from running the same job
- **PubSub:** `point-app` subscribes to Redis channels to receive ticker/orderbook updates, pushes via WebSocket to clients

---

### 4. AWS Services

| Environment Variable (K8s Secret) | YAML Property | Value | Purpose |
|------|---------|----------|----------|
| `AWS_SES_HOST` | `aws.ses.host` | `email-smtp.ap-northeast-1.amazonaws.com` | SMTP host for SES |
| `AWS_SES_PORT` | `aws.ses.port` | `587` | SMTP TLS port |
| `AWS_SES_USERNAME` | `aws.ses.username` | AWS Secrets Manager | SMTP credentials |
| `AWS_SES_PASSWORD` | `aws.ses.password` | AWS Secrets Manager | SMTP credentials |
| `AWS_CREDENTIALS_SALT` | `aws.credentials.salt` | AWS Secrets Manager | Salt used for internal credential encryption |

| YAML-only Property | Value | Purpose |
|------|---------|----------|
| `cloud.aws.region.static` | `ap-northeast-1` | AWS Region (Tokyo) |
| `cloud.aws.credentials.use-default-aws-credentials-chain` | `false` | Don't use default credential chain — uses instance profile or env var |
| `aws.s3.kyc-bucket.name` | `kyc.bs-point-{env}-ex` | S3 bucket for storing KYC documents (identity verification) |
| `aws.s3.year-report-bucket.name` | `year-report.bs-point-{env}-ex` | S3 bucket for annual reports (tax, transactions) |

**Mapping AWS SES to Java code:**

```
AWS_SES_HOST / AWS_SES_PORT / AWS_SES_USERNAME / AWS_SES_PASSWORD
    ↓
aws.ses.host / aws.ses.port / aws.ses.username / aws.ses.password
    ↓ (@ConfigurationProperties prefix = "aws.ses")
SesConfig (fields: host, port, username, password)
    ↓ (autowired by)
SesManager.sendWithoutThread()
    ↓ (uses)
    ├── awsSesConfig.getHost()      → SMTP server address
    ├── awsSesConfig.getPort()      → SMTP port
    ├── awsSesConfig.getUsername()   → SMTP auth username
    └── awsSesConfig.getPassword()  → SMTP auth password
    ↓ (called by)
Sending emails: registration, password reset, transaction confirmation, notifications...
```

**Related code files:**

| File | Line | Role |
|------|------|---------|
| `point-common/.../config/SesConfig.java` | L9 | `@ConfigurationProperties(prefix = "aws.ses")` |
| `point-common/.../config/SesConfig.java` | L12-18 | Fields: `host`, `username`, `password`, `port` |
| `point-common/.../component/SesManager.java` | L30 | Autowired `SesConfig awsSesConfig` |
| `point-common/.../component/SesManager.java` | L57-76 | `sendWithoutThread()` — connects to SMTP and sends email |

**Email sending flow:**
1. A service (e.g.: `CustomerService.register()`) calls `SesManager.send(to, subject, body)`
2. `SesManager` reads config from `SesConfig` (injected from env var)
3. Creates SMTP connection to `email-smtp.ap-northeast-1.amazonaws.com:587`
4. Authenticates with SES username/password
5. Sends email via SMTP TLS

---

### 5. JWT & Authentication

Only applies to `point-app` (customer-facing). `point-admin` uses session-based auth, `point-api` uses API key.

| Variable | YAML Property | Value | Purpose |
|------|---------|----------|----------|
| (YAML only) | `jwt.issuer` | `bs-point-server` | Issuer name written in JWT token |
| (YAML / Secrets Manager PRD) | `jwt.secret` | `0123456789` (dev) / Secrets Manager (stg/prd) | Secret key for signing JWT |
| (YAML only) | `jwt.token-ttl` | `7600` seconds (~2 hours) | Access token lifetime |
| (YAML only) | `jwt.refresh-token-ttl` | `604800` seconds (7 days) | Refresh token lifetime |
| (YAML only) | `jwt.cache-token-ttl` | `604800` seconds (7 days) | Token cache TTL in Redis |

**Mapping to Java code:**

```
jwt.secret / jwt.issuer / jwt.token-ttl / jwt.refresh-token-ttl
    ↓ (@Value annotation — NOT using @ConfigurationProperties)
JwtManager (point-app module)
    ├── @Value("${jwt.secret}") String secret
    ├── @Value("${jwt.issuer:cb-exchange-server}") String issuer
    ├── @Value("${jwt.token-ttl:7600}") int tokenTtl
    ├── @Value("${jwt.cache-token-ttl:604800}") int cacheTokenTtl
    └── @Value("${jwt.refresh-token-ttl:604800}") int refreshTokenTtl
    ↓
JwtManager.createTokenPair()
    → Algorithm.HMAC256(secret) ← signs JWT with HMAC-SHA256
    → JWT.create().withIssuer(issuer).withExpiresAt(now + tokenTtl)
    ↓ (used by)
ExchangeJwtAuthenticationProcessingFilter
    → Filter on every HTTP request, verifies JWT token
```

**Related code files:**

| File | Line | Role |
|------|------|---------|
| `point-app/.../component/jwt/JwtManager.java` | L53-66 | `@Value` annotations bind JWT config |
| `point-app/.../component/jwt/JwtManager.java` | L76-114 | `createTokenPair()` — creates JWT + refresh token |
| `point-app/.../component/jwt/JwtTokenUtil.java` | — | Utility for parsing/validating JWT |
| `point-app/.../component/jwt/exchange/ExchangeJwtAuthenticationProcessingFilter.java` | — | Request filter that verifies JWT on every API call |

**Note:** JWT config uses `@Value` instead of `@ConfigurationProperties`. This means:
- No automatic prefix binding
- If the env var is `JWT_SECRET`, Spring maps it to `jwt.secret` → works as expected
- The default value after `:` in `@Value("${jwt.issuer:cb-exchange-server}")` is only used when the property doesn't exist

**Related configs (also using `@Value`):**

| Variable | Value | Purpose |
|------|---------|----------|
| `point-common.account-lock.max-attempt` | `5` | Lock account after N failed login attempts |
| `point-common.account-lock.expire-seconds` | `0` | Lock duration (0 = permanent until admin unlocks) |
| `customer.forgot-password.token.forgot-effective-time` | `600000` ms (10 minutes) | Password reset link expiration |
| `customer.login-password.token.effective-time` | `86400000` ms (24 hours) | Account creation confirmation token expiration |
| `customer.register.enabled` | `true` | Enable/disable new account registration |
| `customer.fiat-withdrawal.user-daily-withdrawal-limit` | `30000000` | Daily fiat withdrawal limit (JPY) |
| `spring.recaptcha.secret-key` | hardcoded | Google reCAPTCHA v3 bot protection |

---

### 6. External Service Integrations

Third-party services integrated into the system. Each service has its own `@ConfigurationProperties` class.

| Service | Config Class | Prefix | Key Variables | Purpose |
|---------|-------------|--------|-----------|----------|
| **GMO Aozora Bank** | `GmoConfig` | `gmo` | `gmo.client-id`, `gmo.secret` | Bank integration — deposit/withdraw JPY via bank API |
| **Ponta** | `PontaConfig` | `ponta` | `ponta.partner-number`, `ponta.keystore-password` | Loyalty point program — accumulate Ponta points for customers |
| **Refinitiv World-Check** | (config in YAML) | `refinitiv` | `refinitiv.api-key`, `refinitiv.secret-key` | AML/KYC screening — check sanctions lists, PEP |
| **EKYC (NextWay)** | (config in YAML) | `ekyc` | `ekyc.secret`, `ekyc.token` | Electronic identity verification (ID card/passport scanning) |
| **Chainalysis** | `ChainalysisConfig` | `chainalysis` | `chainalysis.token` | Blockchain monitoring — detect suspicious crypto transactions |
| **Sygna Hub** | `SygnaHubConfig` | `sygna` | `sygna.account`, `sygna.credential` | Travel Rule compliance — comply with international crypto transfer regulations |
| **Fireblocks** | `FireblocksConfig` | `fireblocks` | `fireblocks.apiKey`, `fireblocks.secretKey`, `fireblocks.publicKey` | Custodian wallet management (hot/cold wallet) — via Secrets Manager |
| **Wallet Gateway** | `WalletConfig` | `wallet` | `wallet.client-id`, `wallet.apiKey` | Internal gateway for managing user crypto wallets |
| **Amber (WhaleFin)** | `AmberConfig` | `point-pos.best-price.amber` | `access-key`, `access-secret` | RFQ and spot orders with liquidity provider |
| **OKCoin** | (config in YAML) | `dealing.okcoin` | `apiKey`, `secret` | Liquidity provider — cover trades on exchange |
| **SMS (CPAAS)** | (config in YAML) | `sms` | `sms.host`, `sms.token` | Send OTP verification SMS |

**Detailed example: Fireblocks**

```
FIREBLOCKS_APIKEY / FIREBLOCKS_SECRETKEY / FIREBLOCKS_PUBLICKEY  (from K8s Secret)
    ↓ (Spring Relaxed Binding)
fireblocks.apiKey / fireblocks.secretKey / fireblocks.publicKey
    ↓ (@ConfigurationProperties prefix = "fireblocks")
FireblocksConfig (fields: apiKey, secretKey, publicKey, legalVaultAccountId, assetId.*)
    ↓ (autowired by)
FireblocksManager
    ├── createVaultAccount()    → create new custodian wallet
    ├── createAddress()         → create crypto receiving address
    └── createWhitelist()       → whitelist withdrawal address
    ↓ (called by)
    ├── AddressMaker (point-worker)         → worker creates deposit addresses for users
    └── CreateWhitelistMaker (point-worker) → worker whitelists withdrawal addresses
```

**Fireblocks related code files:**

| File | Role |
|------|---------|
| `point-common/.../config/FireblocksConfig.java` | `@ConfigurationProperties(prefix = "fireblocks")` — binds config |
| `point-common/.../component/FireblocksManager.java` | Creates Fireblocks SDK client, calls API |
| `point-worker/.../worker/AddressMaker.java` | Worker uses `FireblocksManager` to create addresses |
| `point-worker/.../worker/CreateWhitelistMaker.java` | Worker uses `FireblocksManager` to whitelist |

**Note on Fireblocks Asset IDs per environment:**
- **Dev/Stg (testnet):** `ADA_TEST`, `BTC_TEST`, `ETH_TEST5`, `XRP_TEST`, `NIDT_B75VRLGX_0A1F`
- **Prd (mainnet):** `ADA`, `BTC`, `ETH`, `XRP`, `NIDT`

---

### 7. Application Config

| Variable | YAML Property | Value | Config Class | Purpose |
|------|---------|----------|-------------|----------|
| `ENVIRONMENT` (Docker) | — | `dev` / `stg` / `prd` | — | Docker variable passed to entrypoint, activates Spring profile |
| `SPRING_PROFILES_ACTIVE` (K8s) | — | `dev` / `stg` / `prd` | — | Override env var on K8s, Spring reads directly |
| — | `server.port` | `8080` | Spring Boot auto | Main application port |
| — | `management.port` | `8082` | Spring Boot auto | Port for health check / Spring Actuator endpoint |
| — | `spring.config.environment` | `dev`/`stg`/`prd` | `SpringConfig` (`spring.config`) | Environment name in config, used by code logic |
| — | `async.core-pool-size` | `60` (api/admin/app), `85` (worker) | `AsyncConfig` (`async`) | Thread pool size for `@Async` tasks |
| — | `point-app.allowed-origin` | Domain per env | (point-app config) | CORS whitelist — which domains can call the API |
| — | `point-app.debug-response` | `true` (dev), `false` (stg/prd) | (point-app config) | Include extra debug info in error responses |
| — | `spring.jpa.hibernate.ddl-auto` | `validate` (local), `none` (dev/stg/prd) | Spring Boot auto | DDL strategy — `none` = don't auto-create/modify schema |
| — | `swagger.enabled` | `true` (dev), `false` (prd) | (swagger config) | Enable/disable Swagger UI |
| — | `spring.servlet.multipart.max-file-size` | `16MB` | Spring Boot auto | File upload size limit |

**`spring.config.domain` — Environment identifier (NOT an endpoint URL):**

`spring.config` binds to the `SpringConfig` class (`point-common/.../config/SpringConfig.java`) with 2 fields:
- `domain`: Primarily used as a label for MFA TOTP URI (Google Authenticator), e.g.: `otpauth://totp/api.dev.cxr-inc.com:user@email.com?secret=...`
- `environment`: Enum (`dev`/`stg`/`prd`) — used extensively (21+ locations) to switch logic per environment (SQS queue names, security config, API endpoint selection...)

| Module | DEV | STG | PRD | Used in |
|--------|-----|-----|-----|---------|
| point-api | `api.dev.cxr-inc.com` | `api.stg.cxr-inc.com` | `backseat-service.com` | MFA TOTP label |
| point-admin | `admin.dev.cxr-inc.com` | `admin.stg.cxr-inc.com` | `backseat-service.com` | MFA TOTP label |
| point-app | `dev.backseat-service.com` | `stg.backseat-service.com` | `backseat-service.com` | MFA TOTP label |
| point-worker | `worker.dev.cxr-inc.com` | `worker.stg.cxr-inc.com` | `backseat-service.com` | (domain not used) |
| point-mmh | `worker.dev.cxr-inc.com` | `worker.stg.cxr-inc.com` | `backseat-service.com` | (domain not used) |

**Note:** These are NOT actual service endpoint domains. Domains used for CORS, redirect URLs, and email links are in separate config keys:

| Config Key | Purpose | DEV Example |
|------------|---------|-------------|
| `point-app.allowed-origin` | CORS whitelist | `https://dev-ex.backseat-service.com` |
| `coin.cus.host` | Internal API host | `https://dev.backseat-service.com` |
| `point-app.email.account-created.base-url` | Registration email link | `https://dev-ex.backseat-service.com/farm-game/farm/?isInvesting=true&cid={0}&token={1}&exp={2}` |
| `point-app.email.forgot-password.base-url` | Password reset link | `https://dev-ex.backseat-service.com/signIn/reset/?cid={0}&token={1}&exp={2}` |
| `ponta.login-success-url` | OAuth callback URL | `https://dev-ex.backseat-service.com/oauth/callback/` |
| `ponta.game-home-url` | Game home redirect | `https://dev-ex.backseat-service.com/farm-game/` |
| `point-admin.host` | Admin panel base URL | `https://admin.dev.cxr-inc.com` |
| `point-admin.mail-address` | Admin email sender | `no-reply@dev.cxr-inc.com` |

---

### 8. Monitoring & Metrics

| Variable | Value | Purpose |
|------|---------|----------|
| `management.metrics.export.cloudwatch.enabled` | `false` (default) | Enable/disable pushing metrics to CloudWatch |
| `management.metrics.export.cloudwatch.namespace` | `point-api` / `point-worker` ... | CloudWatch namespace per module |
| `management.metrics.export.cloudwatch.step` | `1m` | Metrics push interval |
| `management.metrics.web.server.request.metric-name` | `http.server.requests` | Metric name for HTTP requests |
| Prometheus | Enabled (dev/stg) | Endpoint `/actuator/prometheus` for scraping |

**Logging config:**

| Config | Local | Dev/Stg/Prd | Purpose |
|--------|-------|-------------|----------|
| Console appender | `CONSOLE_DEFAULT` | `CONSOLE_JSON` | Local uses readable text, server uses JSON for Fluent Bit parsing |
| `show-sql` | `true` | `false` | Log SQL queries — only enabled locally for debugging |
| Hikari pool log | off | `DEBUG` | Detailed connection pool logging on server |
| `common.log.outputRequestDetails` | `true` (api/admin/app) | `true` | Log request details (bound via `LogConfig` class) |

---

### 9. Trading — Amber / OKCoin

Configuration for liquidity providers in the POS (Point of Sale) trading system.

| Variable | DEV | STG | PRD | Purpose |
|------|-----|-----|-----|----------|
| `point-pos.best-price.amber.api-host` | `https://aws-private-alpha.whalefin.com` | Same as DEV | `https://be.whalefin.com` | RFQ API endpoint |
| `point-pos.best-price.amber.access-key` | Hardcoded | Hardcoded | Secrets Manager | API key for RFQ |
| `point-pos.base-trade.amber.api-host` | `https://aws-private-alpha.whalefin.com` | Same as DEV | `https://be.whalefin.com` | Spot Order API endpoint |
| `point-pos.base-trade.coinbook.api-host` | `http://point-api-service.default.svc.cluster.local:8080` | Same | Same | Internal K8s service for internal trades |

**Note on `point-api-service.default.svc.cluster.local`:** This is Kubernetes internal DNS. The `point-api` service is exposed via a K8s Service object, and other modules (worker, mmh) call the internal API via this DNS instead of the external domain.

---

### 10. Other configs

| Variable | Value | Purpose |
|------|---------|----------|
| `point-common.sns.expired_minute` | `60` | SMS OTP code expires after 60 minutes |
| `ponta.otp-ttl` | `5` minutes | Ponta OTP expiration |
| `ponta.transfer-fee` | `0.01` | Ponta point transfer fee |
| `data-request.max-size` | `500` | Data request limit |
| `csv-download.max-records` | `5000` | Record limit when exporting CSV |
| `vote-reward.expire-unit` / `expire-date` | `YEAR` / `1` | Vote reward expires after 1 year |
| `server.servlet.session.timeout` | `1d` | Session timeout 1 day |
| `server.servlet.session.cookie.max-age` | `7d` | Cookie lifetime 7 days |
| `exchange-websocket.subscription-limit-per-session` | `100` | WebSocket subscription limit per session |
| `hulft.snddata` / `hulft.rcvdata` | `/nfs/hulft/snddata` / `/nfs/hulft/rcvdata/` | NFS paths for HULFT file transfer (Ponta) |

---

## II. Infra Project (`bs-exchange-infra/k8s-manifests`)

Uses **Kustomize** with a base + overlay pattern:
- `point/base/` — shared template for all services
- `point/{dev-ex,stg-ex}/` — per-environment overrides

### 1. Deployment ENV vars

Set directly in each environment's deployment YAML.

| Variable | DEV (`dev-ex`) | STG (`stg-ex`) | Purpose |
|------|----------------|----------------|----------|
| `SPRING_PROFILES_ACTIVE` | `"dev"` | `"stg"` | Activates the corresponding Spring profile |
| `JAVA_TOOL_OPTIONS` | `-XX:MaxDirectMemorySize=100M -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=8000` | `-XX:MaxDirectMemorySize=500M` | **DEV**: enables remote debug on port 8000, memory 100M. **STG**: debug disabled, memory 500M for production-like load |

**Detailed `JAVA_TOOL_OPTIONS` explanation:**
- `-XX:MaxDirectMemorySize=100M/500M`: Limits direct (off-heap) memory that the JVM can allocate. Netty (used by Lettuce Redis client) allocates direct buffers here. STG needs more due to near-production traffic.
- `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=8000`: Enables Java Debug Wire Protocol:
  - `transport=dt_socket`: Uses TCP socket
  - `server=y`: Pod acts as debug server (IDE connects to it)
  - `suspend=n`: Don't wait for debugger to attach before starting app
  - `address=8000`: Listens on port 8000
  - **Only used in DEV** — allows `kubectl port-forward` then attaching IntelliJ/Eclipse debugger

### 2. K8s Secrets (`point-secrets`)

All deployments inject secrets via:
```yaml
envFrom:
  - secretRef:
      name: point-secrets
```

`envFrom: secretRef` takes **all key-value pairs** from K8s Secret `point-secrets` and injects them as env vars. For example, if the Secret contains `SPRING_DATASOURCE_MASTER_URL: abc`, the Pod will have env var `SPRING_DATASOURCE_MASTER_URL=abc`.

Keys in this Secret (fetched from AWS Secrets Manager):

| Key | Corresponding YAML Property | Receiving Config Class | Purpose |
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
| `AWS_CREDENTIALS_SALT` | `aws.credentials.salt` | (security components) | Encryption salt |
| `FIREBLOCKS_APIKEY` | `fireblocks.apiKey` | `FireblocksConfig` | Fireblocks API key |
| `FIREBLOCKS_PUBLICKEY` | `fireblocks.publicKey` | `FireblocksConfig` | Fireblocks public key |
| `FIREBLOCKS_SECRETKEY` | `fireblocks.secretKey` | `FireblocksConfig` | Fireblocks secret key |

### 3. CloudWatch Agent

DaemonSet running on every node, collecting system metrics (CPU, memory, disk, network).

| Variable | Source | Value | Purpose |
|------|--------|---------|----------|
| `HOST_IP` | `fieldRef: status.hostIP` | (dynamic) | Node IP — used to tag metrics by node |
| `HOST_NAME` | `fieldRef: spec.nodeName` | (dynamic) | Node name — dimension in CloudWatch metrics |
| `K8S_NAMESPACE` | `fieldRef: metadata.namespace` | (dynamic) | Current namespace — filter metrics by namespace |
| `CI_VERSION` | Direct | `"k8s/1.3.7"` | Version tag — tracking which CloudWatch agent version is running |
| `RUN_WITH_IRSA` | Direct | `"True"` | Use IAM Role for Service Account — no need to hardcode AWS credentials in Pod |

**Note on `fieldRef`:** Kubernetes automatically injects Pod/Node metadata into env vars. `status.hostIP` is the actual IP of the EC2 node running the Pod, `spec.nodeName` is the EC2 hostname.

### 4. Fluent Bit (Log Shipping)

DaemonSet that ships container logs from all pods to CloudWatch Logs.

| Variable | Source | Value | Purpose |
|------|--------|---------|----------|
| `AWS_REGION` | ConfigMap `fluent-bit-cluster-info` | `ap-northeast-1` | Region to send logs — CloudWatch Logs region |
| `CLUSTER_NAME` | ConfigMap | `point` | Cluster name — used in log group name: `/aws/containerinsights/point/application` |
| `HTTP_SERVER` | ConfigMap | `On` | Expose Fluent Bit metrics endpoint (health check) |
| `HTTP_PORT` | ConfigMap | `2020` | Metrics endpoint port — used for liveness probe |
| `READ_FROM_HEAD` | ConfigMap | `Off` | Don't read logs from the beginning of the file on startup |
| `READ_FROM_TAIL` | ConfigMap | `On` | Only read new logs — avoids replaying all old logs when Fluent Bit restarts |
| `HOST_NAME` | `fieldRef: spec.nodeName` | (dynamic) | Prefix for CloudWatch log stream — helps identify which node logs come from |
| `HOSTNAME` | `fieldRef: metadata.name` | (dynamic) | Fluent Bit Pod name — used for self-monitoring |
| `CI_VERSION` | Direct | `"k8s/1.3.16"` | Fluent Bit version tag |

**Log flow:** Container stdout/stderr → Fluent Bit (reads from `/var/log/containers/*.log`) → CloudWatch Logs

### 5. AWS Load Balancer Controller

Helm chart values — doesn't use env vars directly but contains important config:

| Config | DEV | STG | Purpose |
|--------|-----|-----|----------|
| `clusterName` | `point` | `point` | EKS cluster name — controller uses this to discover resources |
| `region` | `ap-northeast-1` | `ap-northeast-1` | AWS region — where ALB/NLB are created |
| `vpcId` | `vpc-0e139c5a0789db4c0` | (from tfvars) | VPC for provisioning ALB — controller needs the VPC to find subnets |
| `replicaCount` | `2` | `2` | Number of controller pod replicas — HA for the controller |
| `image.tag` | `v3.1.0` | `v3.1.0` | Controller version — affects feature support |

---

## III. Secrets Management Flow (End-to-End)

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
                       │     - Pull all secrets
                       │     - Merge into 1 flat key-value map
                       │     - Diff with current secret
                       │     - Backup old version
                       │     - Confirm before applying
                       ↓
┌──────────────────────────────────────────────────────────────────────┐
│ 2. K8s Secret "point-secrets" (namespace: default)                   │
│    ├── SPRING_DATA_REDIS_HOST=...                                    │
│    ├── SPRING_DATASOURCE_MASTER_URL=...                              │
│    ├── FIREBLOCKS_APIKEY=...                                         │
│    └── ... (all keys merged from 5 secret paths)                     │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
                       │ (2) envFrom: secretRef: point-secrets
                       │     (in deployment.yaml)
                       ↓
┌──────────────────────────────────────────────────────────────────────┐
│ 3. Pod Environment Variables                                         │
│    All keys in Secret → env vars in container                        │
│    E.g.: SPRING_DATASOURCE_MASTER_URL=jdbc:mariadb:aurora//host:3306/db│
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
                       │ (4) Beans use config
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

## IV. Summary Table: Variable → YAML → Java Class → Where Used

| Env Var (K8s Secret) | YAML Property | Java Config Class | Bean Created | Used By |
|---|---|---|---|---|
| `SPRING_DATASOURCE_MASTER_URL` | `spring.datasource.master.url` | `MasterDataSourceConfig` | `masterDataSource`, `masterEntityManagerFactory`, `masterJdbcTemplate` | All Repositories (CRUD user, order, transaction) |
| `SPRING_DATASOURCE_MASTER_USERNAME` | `spring.datasource.master.username` | `MasterDataSourceConfig` | (same as above) | (same as above) |
| `SPRING_DATASOURCE_MASTER_PASSWORD` | `spring.datasource.master.password` | `MasterDataSourceConfig` | (same as above) | (same as above) |
| `SPRING_DATASOURCE_HISTORICAL_URL` | `spring.datasource.historical.url` | `HistoricalDataSourceConfig` | `historicalDataSource`, `historicalEntityManagerFactory`, `historicalJdbcTemplate` | Admin report queries, data archival |
| `SPRING_DATASOURCE_HISTORICAL_USERNAME` | `spring.datasource.historical.username` | `HistoricalDataSourceConfig` | (same as above) | (same as above) |
| `SPRING_DATASOURCE_HISTORICAL_PASSWORD` | `spring.datasource.historical.password` | `HistoricalDataSourceConfig` | (same as above) | (same as above) |
| `SPRING_DATA_REDIS_HOST` | `spring.data.redis.host` | `CacheConfig` | `LettuceConnectionFactory`, `RedisTemplate`, `RedissonClient`, `CacheManager` | Session, cache, lock, PubSub WebSocket |
| `SPRING_DATA_REDIS_PORT` | `spring.data.redis.port` | `CacheConfig` | (same as above) | (same as above) |
| `AWS_SES_HOST` | `aws.ses.host` | `SesConfig` | (config bean) | `SesManager.sendWithoutThread()` → sends email |
| `AWS_SES_PORT` | `aws.ses.port` | `SesConfig` | (config bean) | (same as above) |
| `AWS_SES_USERNAME` | `aws.ses.username` | `SesConfig` | (config bean) | (same as above) |
| `AWS_SES_PASSWORD` | `aws.ses.password` | `SesConfig` | (config bean) | (same as above) |
| `AWS_CREDENTIALS_SALT` | `aws.credentials.salt` | (security) | — | Internal credential encryption/decryption |
| `FIREBLOCKS_APIKEY` | `fireblocks.apiKey` | `FireblocksConfig` | (config bean) | `FireblocksManager` → `AddressMaker`, `CreateWhitelistMaker` (workers) |
| `FIREBLOCKS_SECRETKEY` | `fireblocks.secretKey` | `FireblocksConfig` | (config bean) | (same as above) |
| `FIREBLOCKS_PUBLICKEY` | `fireblocks.publicKey` | `FireblocksConfig` | (config bean) | (same as above) |

**All Config classes are located at:** `point-common/src/main/java/point/common/config/`

---

# Part B: Tools & Scripts

## I. K8s Manifests Scripts

Located at: `bs-exchange-infra/k8s-manifests/bin/`

### 1. `k8s_apply.sh` — Full K8s Deployment

**Path:** `k8s-manifests/bin/k8s_apply.sh`

**Purpose:** The main script for deploying all Kubernetes manifests to the EKS cluster. Executes all necessary steps sequentially — from updating kubeconfig, installing controllers, to deploying the application.

**Syntax:**
```bash
cd bs-exchange-infra/k8s-manifests/bin/
./k8s_apply.sh --env <env>
```

**Parameters:**
| Parameter | Values | Required | Description |
|---------|---------|----------|-------|
| `--env` | `dev`, `dev-ex`, `stg`, `stg-ex`, `prd` | No (detected from AWS profile) | Specifies the target environment |

**Execution steps (in order):**

| # | Step | Description | Why it's needed |
|---|------|-------|-----------------|
| 1 | Update kubeconfig | `aws eks update-kubeconfig --name point` | Fetch credentials to connect to EKS cluster |
| 2 | VPC CNI tuning | Set `WARM_IP_TARGET=2`, `MINIMUM_IP_TARGET=1` on `aws-node` DaemonSet | Optimize IP allocation — keep 2 warm IPs ready, reduce Pod startup time |
| 3 | RBAC | Apply ClusterRole and RoleBinding | Assign permissions to service accounts |
| 4 | aws-auth ConfigMap | Map IAM roles/users → K8s permissions | Allow IAM users to manage the cluster |
| 5 | ALB Controller CRDs | Download and apply Custom Resource Definitions | CRDs must exist before installing the controller |
| 6 | ALB Controller (Helm) | `helm upgrade --install` AWS Load Balancer Controller | Manage ALB/NLB from K8s Ingress resources |
| 7 | NFS Provisioner | Helm install `nfs-subdir-external-provisioner` | Mount NFS share for HULFT file transfer (STG/PRD only) |
| 8 | CoreDNS | Apply CoreDNS configmap override | Custom DNS resolution (STG only) |
| 9 | Cluster Autoscaler | Apply autoscaler manifest | Automatically scale node group based on demand |
| 10 | Metrics Server | Apply metrics-server | Provide metrics for HPA (Horizontal Pod Autoscaler) |
| 11 | CloudWatch + Fluent Bit | Apply DaemonSets | Collect metrics (CW Agent) and ship logs (Fluent Bit) |
| 12 | Pod Security | Apply PSA namespace labels | Enforce security standards for pods |
| 13 | NetworkPolicy | Apply network rules | Restrict traffic between pods |
| 14 | Secrets | Call `fetch_credentials.sh` | Sync secrets from AWS Secrets Manager → K8s Secret |
| 15 | Kustomize deployments | `kustomize build | kubectl apply` for 5 services | Deploy admin, api, app, mmh, worker + ingress |

**NFS Config per environment:**
| Env | NFS Server | Purpose |
|-----|-----------|----------|
| STG | `10.51.187.138:/mnt/hulft/tmp` | HULFT file transfer with Ponta (staging) |
| PRD | `10.51.188.138:/mnt/hulft/tmp` | HULFT file transfer with Ponta (production) |

**Dependencies:** `aws` CLI, `kubectl`, `helm`, `wget`, `kustomize`

**Examples:**
```bash
# Deploy everything to STG
./k8s_apply.sh --env stg-ex

# Deploy to DEV (auto-detect from AWS_PROFILE)
export AWS_PROFILE=bs-point-dev-ex
./k8s_apply.sh
```

**Usage notes:**
- The script runs **all steps sequentially**. If you only want to update deployments (step 15), you still have to wait for previous steps. Consider running `kustomize build | kubectl apply` directly if you only need to redeploy the app.
- If ALB Controller CRDs download fails (network issue), the entire script will stop.
- The script prefers the standalone `kustomize` command. If not available, it falls back to `kubectl kustomize`.

---

### 2. `fetch_credentials.sh` — Sync Secrets

**Path:** `k8s-manifests/bin/fetch_credentials.sh`

**Purpose:** Fetches secrets from AWS Secrets Manager, compares with the current K8s Secret, and applies if there are changes. This is the **safest** script for updating credentials because it includes backup + diff + confirm.

**Syntax:**
```bash
./fetch_credentials.sh [--env <env>] [--list]
```

**Parameters:**
| Parameter | Description |
|---------|-------|
| `--env <env>` | Specifies the environment (`dev`, `stg`, `prd`, `local`) |
| `--list` | Only list secret keys that would be fetched (dry-run, does not apply) |

**Behavior per environment:**
| Mode | Output | Secrets fetched | Description |
|------|--------|----------------|-------|
| `local` | File `local.env` | `base`, `aws-credentials` | Creates env file for local Spring Boot run |
| `default` | K8s Secret `point-secrets` | `base`, `SPRING_DATA_REDIS`, `SPRING_DATASOURCE_MASTER`, `SPRING_DATASOURCE_HISTORICAL`, `exc` | Creates/updates K8s Opaque Secret |

**Detailed execution flow:**
1. Validate AWS credentials (check `aws sts get-caller-identity`)
2. Fetch secrets from AWS Secrets Manager (5 secret paths → merge into 1 map)
3. Filter out keys containing hyphens (internal convention)
4. Backup current K8s Secret to `.secret-backups/` (keeps 10 most recent)
5. Compare new vs old — display details:
   - Newly added keys (added)
   - Changed keys (changed)
   - Deleted keys (deleted)
6. Ask for user confirmation (`Apply changes? [y/N]`)
7. If approved → `kubectl apply` the new Secret

**Dependencies:** `aws` CLI, `kubectl`, `jq`

**Examples:**
```bash
# See which keys will be fetched (no changes made)
./fetch_credentials.sh --list

# Sync secrets for STG
./fetch_credentials.sh --env stg

# Create local.env file for local dev
./fetch_credentials.sh --env local
# → Result: local.env file containing key=value, used with IntelliJ EnvFile plugin
```

**After updating secrets:** Running Pods **do not automatically** pick up new secrets. You need to restart deployments:
```bash
kubectl rollout restart deployment/point-api-deployment
kubectl rollout restart deployment/point-worker-deployment
# ... (all 5 deployments)
```

---

### 3. `apply_secrets.sh` — Wrapper for fetch_credentials

**Path:** `k8s-manifests/bin/apply_secrets.sh`

**Purpose:** Simple wrapper: (1) update kubeconfig, (2) call `fetch_credentials.sh`. Used when not yet connected to the cluster.

**Syntax:**
```bash
./apply_secrets.sh [--env <env>]
```

**Parameters:**
| Parameter | Values | Description |
|---------|---------|-------|
| `--env` | `dev`, `dev2`, `dev3`, `stg`, `stg2`, `stg-ex`, `prd` | Specifies the environment |

**Difference from `fetch_credentials.sh`:** This script adds an `aws eks update-kubeconfig` step before fetching. Used when kubectl is not yet configured for the target cluster.

**Example:**
```bash
# From a local machine not yet connected to the cluster
./apply_secrets.sh --env stg-ex
```

---

### 4. `rehearsal_secrets.sh`

**Path:** `k8s-manifests/bin/rehearsal_secrets.sh`

**Purpose:** A version similar to `fetch_credentials.sh` — used for rehearsal (dry run practice) before applying for real. Same backup/diff/confirm logic.

---

## II. Terraform Scripts

### 1. `terraform.sh` — Main Wrapper

**Path:** `bs-exchange-infra/terraform/terraform.sh`

**Purpose:** Wrapper managing Terraform backend configuration and environments. **Mandatory to use this script instead of running `terraform` directly** — because it manages S3 backend state per environment.

**Syntax:**
```bash
# Run from the component directory
cd terraform/components/<component>
../../terraform.sh [options] <terraform-command>
```

**Parameters:**
| Parameter | Description |
|---------|-------|
| `--env <env>` | Specifies the environment (overrides AWS_PROFILE/AWS_VAULT detection) |
| `--clean` | Delete terraform working directory (`tmp/<ENV>/<COMPONENT>`) — used when state is corrupt |
| `--local` | Use local backend instead of S3 — used for testing/experiments |
| `-v` | Verbose output — shows full terraform output |
| `-h`, `--help` | Display help |

**Auto-detect environment (from AWS_PROFILE or AWS_VAULT):**
| AWS_PROFILE pattern | Detected environment |
|---------------------|---------------------|
| `bs-point-dev*` | `dev` |
| `bs-point-stg*` | `stg` |
| `bs-point-prd*` | `prd` |
| `bs-point-cxr-dev*` | `cxr-dev` |

**Backend S3 config:**
- Bucket: `tfstate.bs-point-<ENV>` (e.g.: `tfstate.bs-point-dev-ex`)
- State key: `<COMPONENT>/terraform.tfstate`
- Region: `ap-northeast-1`

**Execution flow:**
1. Detect environment from `--env` or AWS_PROFILE
2. Copy `backend.tf` from `tf-backend/` into the component directory
3. If init needed → automatically run `terraform init` with S3 backend
4. Run terraform command (plan/apply/destroy/...)
5. Cleanup `backend.tf`
6. Display elapsed time

**Special features:**
- Automatic `terraform init` when not yet initialized (`AUTO_TERRAFORM_INIT=1`)
- Saves backend config to `.cxr_config` — remembers backend settings between runs
- Traps Ctrl+C (SIGINT/SIGTERM) to cleanup `backend.tf` — prevents leftover files
- Measures and displays execution time

**Examples:**
```bash
# Init and plan for VPC in STG
cd terraform/components/vpc
../../terraform.sh --env stg-ex init
../../terraform.sh --env stg-ex plan

# Apply EKS in DEV (auto-detect env from AWS_PROFILE)
export AWS_PROFILE=bs-point-dev-ex
cd terraform/components/eks
../../terraform.sh apply

# Clear terraform cache for a component (when state is corrupt)
../../terraform.sh --clean

# Use local backend for testing
../../terraform.sh --local init
```

**Dependencies:** `terraform`, `lib/bash-functions.sh`

---

### 2. `execute.sh` — Multi-component executor

**Path:** `bs-exchange-infra/terraform/tool/execute_targets/execute.sh`

**Purpose:** Run a terraform command across multiple components at once in the order defined in a targets file. Useful when you need to init/plan/apply the entire infrastructure.

**Syntax:**
```bash
cd terraform/tool/execute_targets/
./execute.sh [options] <terraform-command>
```

**Parameters:**
| Parameter | Description |
|---------|-------|
| `--env <env>` | Specifies the environment |
| `-f <file>` | File containing the list of components (default: `targets.txt`) |
| `-v` | Verbose output |
| `-y` | Auto-approve (no confirmation prompt) — used in CI/CD |

**Targets file format (`targets.txt`):**
```
# Lines starting with # are comments, will be ignored
vpc
eks
ec2-bastion
sns-alert
```

**Behavior per command:**
| Command | Execution order | Parallel? | Reason |
|---------|-----------------|-----------|-------|
| `init`, `get` | Per file | Parallel (1 log per component) | Init has no dependency between components |
| `plan`, `apply` | Per file (top → bottom) | Sequential | Apply needs to follow dependency order (VPC before EKS) |
| `destroy` | **Reversed** (bottom → top) | Sequential | Destroy in reverse — EKS before VPC (delete dependent resources first) |

**Examples:**
```bash
# Init all components in parallel
./execute.sh --env stg init

# Plan sequentially
./execute.sh --env stg plan

# Apply with custom targets file, auto-approve
./execute.sh -y -f stg-targets.txt --env stg-ex apply

# Destroy in reverse order (be careful!)
./execute.sh --env dev-ex destroy
```

**Sample output:**
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

Located at: `bs-exchange-infra/terraform/tool/db-user-manager/`

A set of scripts for managing user accounts for Aurora MySQL and Redshift, syncing credentials to AWS Secrets Manager. Designed following the **principle of least privilege** — each user only has the permissions they need.

### 1. Aurora Scripts

| Script | Purpose | Syntax |
|--------|----------|---------|
| `aurora-create-users.sh` | Create 4 user accounts + update 5 secrets in AWS SM | `AURORA_HOST=<host> ./aurora-create-users.sh` |
| `aurora-drop-users.sh` | Drop 4 user accounts | `AURORA_HOST=<host> ./aurora-drop-users.sh` |
| `aurora-update-master-password.sh` | Rotate master user password | `AURORA_HOST=<host> ./aurora-update-master-password.sh` |
| `aurora-update-passwords.sh` | Rotate passwords for 4 application users | `AURORA_HOST=<host> ./aurora-update-passwords.sh` |

**User roles and permissions (least privilege):**
| User | Secret Path | SQL Permissions | Used By |
|------|-------------|-----------|----------|
| `master` | `point/aurora/master_user` | Full admin | DBA, migration |
| `point` (editor_service) | `point/aurora/editor_service` | SELECT, INSERT, UPDATE, DELETE on `point.*` | Application service (read/write) — this is the main user for `SPRING_DATASOURCE_MASTER` |
| `point_viewer` (viewer_service) | `point/aurora/viewer_service` | SELECT on `point.*` | Application service (read-only) |
| `editor` | `point/aurora/editor_user` | ALL on `point.*` | Admin user (can ALTER, DROP) |
| `viewer` | `point/aurora/viewer_user` | SELECT on `point.*` | Admin user read-only |

**Execution flow for `aurora-create-users.sh`:**
1. Source `init.sh` and `init-aurora.sh` (load utility functions)
2. Auto-generate random 16-character password for each user
3. Prompt for master password (input)
4. Connect to MySQL and run CREATE USER + GRANT for 4 users
5. Update 5 secrets in AWS Secrets Manager (4 user secrets + 1 Spring Boot secret)
6. Spring Boot secret contains: URL + username `point` + password (for application use)

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

**Usage examples:**
```bash
# SSH into bastion first
ssh bastion

# Set Aurora host (get from RDS console or secrets)
export AURORA_HOST=point-cluster.cluster-abc123.ap-northeast-1.rds.amazonaws.com

# Create users for the first time
cd terraform/tool/db-user-manager
./aurora-create-users.sh
# → Enter master password when prompted
# → 4 users created + 5 secrets updated

# Rotate passwords (should be done periodically)
./aurora-update-passwords.sh
# → Enter master password
# → 4 passwords rotated + secrets updated
# → NEED to restart application pods after rotation!
```

### 2. Redshift Scripts

| Script | Purpose | Syntax |
|--------|----------|---------|
| `redshift-create-users.sh` | Create 4 user accounts for Redshift | `REDSHIFT_HOST=<host> ./redshift-create-users.sh` |
| `redshift-update-master-password.sh` | Rotate master password | `REDSHIFT_HOST=<host> ./redshift-update-master-password.sh` |
| `redshift-update-passwords.sh` | Rotate passwords for 4 application users | `REDSHIFT_HOST=<host> ./redshift-update-passwords.sh` |

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

**Important note after password rotation:**
1. Secrets in AWS Secrets Manager have been updated
2. But K8s Secret `point-secrets` has **not** been updated — you need to run `fetch_credentials.sh`
3. After K8s Secret is updated, Pods **still haven't** picked up the new values — you need `kubectl rollout restart`

```bash
# After rotating DB passwords:
cd k8s-manifests/bin
./fetch_credentials.sh --env stg          # (1) Sync secrets
kubectl rollout restart deployment -l app=point  # (2) Restart pods
```

### 3. Shared Libraries

| File | Purpose |
|------|----------|
| `init.sh` | Common functions: `generate_password()` (creates 16-character alphanumeric password), `update-secret-value()` (updates AWS Secrets Manager) |
| `init-aurora.sh` | Aurora config: defines user roles, secret paths, functions `aurora-update-secret-value()` and `update-spring-boot-secret()` |
| `init-redshift.sh` | Redshift config: same as `init-aurora.sh` but for Redshift (port 5439, redshift driver) |

**`generate_password()` function:**
```bash
# Creates a 16-character password from [a-zA-Z0-9]
cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | head -c 16
```

**`update-secret-value()` function:**
```bash
# Updates AWS Secrets Manager with JSON format
update-secret-value ENGINE HOST PORT DBNAME SECRET_ID USERNAME PASSWORD
# → aws secretsmanager put-secret-value --secret-id SECRET_ID --secret-string '{...}'
```

**How to use the libraries:**
```bash
# All aurora-*.sh and redshift-*.sh scripts source:
source ./init.sh
source ./init-aurora.sh   # or init-redshift.sh
```

---

## IV. Lambda Build Scripts

Scripts that package Lambda functions into ZIP files for deployment via Terraform.

| Script | Lambda | Language | Files Packaged | Purpose |
|--------|--------|----------|----------------|----------|
| `terraform/components/sns-alert/sns-to-slack/build.sh` | SNS to Slack | Python | `app.py`, `app_util.py`, `slack_message.py` | Forward SNS alerts (CloudWatch alarm, error) to Slack channel |
| `terraform/components/sns-alert/sns-to-slack/clean.sh` | SNS to Slack | Python | — | Delete `__pycache__` and `.pytest_cache` |
| `terraform/components/waf-maintenance-lambda/src/scripts/build.sh` | WAF Maintenance | Python | `app.py`, `utils.py`, `rules/` | Automatically enable/disable WAF maintenance mode (block traffic) |
| `terraform/components/frontend-customer/src/build.sh` | Frontend | JavaScript | `index.js` | Lambda@Edge for CloudFront — URL rewrite, header manipulation |

**General usage:**
```bash
cd <lambda-source-dir>
./build.sh               # Creates ../lambda_function.zip
# → Terraform will reference this zip file when deploying the lambda
```

**Makefile (WAF Maintenance) — for local testing:**
```bash
cd terraform/components/waf-maintenance-lambda/src
make build                # Package lambda
make maintenance-start    # Test locally with event maintenance-start.json
make maintenance-end      # Test locally with event maintenance-end.json
make clean                # Delete cache

# Requires: pip install python-lambda-local
```

---

## V. EC2 User Data Scripts

Cloud-init scripts that run **once** when the EC2 instance is first launched (Terraform passes them via the `user_data` field).

### 1. Bastion Host (`ec2-bastion/user_data.sh`)

**Purpose:** Install tools on the bastion host (jump server) for accessing internal infrastructure.

**Tools installed:**
| Tool | Version | Purpose |
|------|---------|----------|
| `kubectl` | v1.28.15 | Manage K8s cluster from bastion |
| `helm` | v3.16.1 | Manage Helm charts |
| `aws` CLI | v2 (latest) | Interact with AWS API |
| `terraform` | latest | Manage infrastructure (when running from bastion) |
| `jq` | latest | Parse JSON output from AWS/kubectl |
| `redis-tools` | latest | Debug Redis: `redis-cli -h <host> PING` |
| `mariadb-client` | latest | Debug Aurora: `mysql -h <host> -u <user> -p` |
| `postgresql-12` | v12 | Debug Redshift: `psql -h <host> -U <user> -d <db>` |
| `shfmt` | latest | Format shell scripts |

### 2. Data Transfer (`ec2-data-transfer/user_data.sh`)

**Purpose:** Instance for data migration/transfer tasks — runs Java tools, queries DB.

**OS:** Amazon Linux 2023

**Tools installed:**
| Tool | Purpose |
|------|----------|
| OpenJDK 17 (Corretto) | Run Java migration tools |
| PostgreSQL 15 client | Connect to Redshift |
| MariaDB 10.5 client | Connect to Aurora |
| AWS CLI v2 | Interact with AWS |
| Git, jq, perl | Utility tools |

### 3. HULFT Server (`ec2-hulft/user_data.sh`)

**Purpose:** Instance running HULFT file transfer system — exchanges files with Ponta (loyalty program).

**OS:** RHEL 8 (required by HULFT)

**Setup steps:**
1. Register RHEL subscription + enable repos
2. Install AWS CLI, SSM Agent
3. Mount EBS volume (`/dev/nvme1n1`) → format ext4 → mount `/mnt/hulft`
4. Export NFS share → K8s pods mount via NFS provisioner
5. Download and install HULFT v8.5.2 from S3
6. Create systemd service `hulft` (send/receive/observe daemons)
7. Create systemd service `watch_snddata` (file monitor)
8. Set system language to Japanese (required by HULFT)

**Terraform template variables passed in:**
| Variable | Purpose |
|------|----------|
| `${hostname}` | Instance hostname |
| `${ponta_hulft_ip}` | IP of the Ponta-side HULFT server |
| `${ponta_hulft_hostname}` | Ponta HULFT hostname |
| `${hulft_serial}` | HULFT license serial |
| `${hulft_productkey}` | HULFT license product key |
| `${ponta_hulft_snd001_name/id}` | Send definition 1 (file type to send) |
| `${ponta_hulft_snd002_name/id}` | Send definition 2 |

**File monitor (`watch_snddata`):** Uses `inotifywait` to watch `/mnt/hulft/tmp/snddata/`. When a new file appears → automatically triggers HULFT send → sends the file to the Ponta server. Includes a lock mechanism to prevent duplicate sends.

---

## VI. Bash Utility Library

**Path:** `bs-exchange-infra/lib/bash-functions.sh`

**Purpose:** Shared function library used by `terraform.sh`, `execute.sh`, and other scripts.

| Function | Description | Input | Output | Example |
|-----|-------|-------|--------|-------|
| `get_target_env()` | Detect environment from `AWS_PROFILE` or `AWS_VAULT` | Env vars | Sets variable `env` | `source bash-functions.sh && get_target_env && echo $env` → `stg-ex` |
| `echo_label()` | Print text in cyan (label format, no newline) | String | Stdout (cyan) | `echo_label "Status: " && echo "OK"` |
| `seconds_to_minsec()` | Convert seconds → human-readable | Seconds (int) | String | `seconds_to_minsec 305` → `"5 min 5 sec"` |

**AWS Profile → Env mapping (check order, specific patterns first):**
| Pattern | Result |
|---------|---------|
| `bs-point-dev2*` | `dev2` |
| `bs-point-dev3*` | `dev3` |
| `bs-point-dev*` | `dev` |
| `bs-point-stg-ex*` | `stg-ex` |
| `bs-point-stg*` | `stg` |
| `bs-point-prd*` | `prd` |

**Note:** Specific patterns (`dev2`, `stg-ex`) are checked before general patterns (`dev`, `stg`) to avoid incorrect matches.

---

# Part C: Security Notes

### 1. Credentials hardcoded in source code

The following API keys/secrets are **directly embedded** in `application-{dev,stg}.yaml`:

| Service | File | Risk |
|---------|------|--------|
| AWS SES | `application.yaml` | SMTP credentials hardcoded — if the repo leaks, an attacker could send spoofed emails |
| GMO Aozora | `application-dev.yaml` | Client ID + Secret — access to bank API |
| OKCoin | `application-dev.yaml` | API Key + Secret + Passphrase — trading on the exchange |
| Refinitiv | `application-dev.yaml` | API Key + Secret Key — access to AML screening |
| EKYC | `application-dev.yaml` | Secret + Token + Auth Key — access to KYC service |
| Chainalysis | `application-dev.yaml` | Bearer Token — access to blockchain monitoring |
| Sygna | `application-dev.yaml` | Account + Credential — Travel Rule service |
| Wallet Gateway | `application-dev.yaml` | Client Secret + API Key — crypto wallet management |
| reCAPTCHA | `application-dev.yaml` | Secret Key — bypass CAPTCHA protection |

**Recommendation:** Migrate everything to AWS Secrets Manager before deploying to PRD. Many PRD values have already been moved to Secrets Manager (Fireblocks, Amber, JWT) but dev/stg are still hardcoded.

### 2. Remote Debug in DEV

`JAVA_TOOL_OPTIONS` in DEV enables JDWP on port 8000. This must **never** be enabled in PRD because:
- It allows remote debugger attachment
- The entire heap memory can be read (including passwords, tokens)
- Runtime behavior can be modified (changing running code logic)
- Combined with `kubectl port-forward` = full access to the JVM

### 3. Local dev credentials in repo

`application-local.yaml` contains DB passwords, Redis host for local development. Recommendations:
- Use `fetch_credentials.sh --env local` to create a `local.env` file (gitignored)
- Configure IntelliJ/IDE to read `local.env` instead of committing credentials to repo
- Or use Spring `@PropertySource` to load from a file outside the classpath

### 4. After password rotation

Complete flow when rotating DB/service credentials:
```bash
# 1. Rotate password in DB
./aurora-update-passwords.sh

# 2. Sync secrets from AWS SM → K8s Secret
cd k8s-manifests/bin && ./fetch_credentials.sh --env <env>

# 3. Restart pods to pick up new secrets
kubectl rollout restart deployment -l app=point

# 4. Verify pods are healthy
kubectl get pods -l app=point
```
If steps 2-3 are skipped, the application will use the **old password** → connection refused → downtime.
