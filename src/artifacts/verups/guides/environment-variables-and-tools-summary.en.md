# Environment Variables & Infrastructure Tools Guide - Verup Project

> A comprehensive document covering all environment variables used in the server (`bs-integration-server`) and infra (`bs-exchange-infra`), along with usage guides for all scripts/tools.
>
> Updated: 2026-03-12

---

## Table of Contents

- [Part A: Environment Variables](#part-a-environment-variables)
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
    - [10. Other Configs](#10-other-configs)
  - [II. Infra Project (bs-exchange-infra/k8s-manifests)](#ii-infra-project-bs-exchange-infrak8s-manifests)
    - [1. Deployment ENV vars](#1-deployment-env-vars)
    - [2. K8s Secrets (point-secrets)](#2-k8s-secrets-point-secrets)
    - [3. CloudWatch Agent](#3-cloudwatch-agent)
    - [4. Fluent Bit (Log Shipping)](#4-fluent-bit-log-shipping)
    - [5. AWS Load Balancer Controller](#5-aws-load-balancer-controller)
  - [III. Secrets Management Flow](#iii-secrets-management-flow)
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

# Part A: Environment Variables

## I. Server Project (`bs-integration-server`)

The server consists of 5 Spring Boot modules: `point-api`, `point-admin`, `point-app`, `point-worker`, `point-mmh`.
Configuration is profile-based: `application.yaml` (base) + `application-{dev,stg,prd}.yaml` (environment-specific overrides).

### 1. Database — Aurora MySQL (Master)

The primary database storing all business data (users, transactions, orders, etc.).

| Variable | Value | Purpose |
|----------|-------|---------|
| `SPRING_DATASOURCE_MASTER_URL` | AWS Secrets Manager | JDBC connection string to Aurora MySQL |
| `SPRING_DATASOURCE_MASTER_USERNAME` | AWS Secrets Manager | DB connection username |
| `SPRING_DATASOURCE_MASTER_PASSWORD` | AWS Secrets Manager | DB connection password |
| `spring.datasource.master.driver-class-name` | `org.mariadb.jdbc.Driver` | JDBC driver (uses MariaDB driver for Aurora MySQL) |
| `spring.datasource.master.maximum-pool-size` | `66` (base), `150` (dev/stg) | Maximum connections in HikariCP pool |
| `spring.datasource.master.minimum-idle` | `10` | Minimum idle connections kept ready |
| `spring.datasource.master.max-lifetime` | `600000` (10 minutes) | Maximum lifetime of a single connection |
| `spring.datasource.master.idle-timeout` | `500000` (~8 minutes) | Timeout for idle connections |
| `spring.datasource.master.leak-detection-threshold` | `5000` (5 seconds) | Threshold for detecting leaked connections (not returned to pool) |

**Connection string format (local dev):**
```
jdbc:mysql://localhost:3308/point?zeroDateTimeBehavior=convertToNull&allowPublicKeyRetrieval=true
```

### 2. Database — Redshift (Historical)

Stores historical data (archived data) for reporting and analytics. Uses a PostgreSQL-compatible driver.

| Variable | Value | Purpose |
|----------|-------|---------|
| `SPRING_DATASOURCE_HISTORICAL_URL` | AWS Secrets Manager | JDBC connection string to Redshift |
| `SPRING_DATASOURCE_HISTORICAL_USERNAME` | AWS Secrets Manager | Redshift username |
| `SPRING_DATASOURCE_HISTORICAL_PASSWORD` | AWS Secrets Manager | Redshift password |
| `spring.datasource.historical.driver-class-name` | `com.amazon.redshift.jdbc42.Driver` | JDBC driver for Redshift |
| `spring.datasource.historical.maximum-pool-size` | `66` (base), `150` (dev/stg) | Maximum connections |

**Connection string format (local dev):**
```
jdbc:postgresql://localhost:5439/point
```

### 3. Redis (Cache & Session)

Used for data caching (prices, tickers), user sessions, and PubSub for real-time WebSocket communication.

| Variable | Value | Purpose |
|----------|-------|---------|
| `SPRING_DATA_REDIS_HOST` | AWS Secrets Manager | ElastiCache Redis endpoint |
| `SPRING_DATA_REDIS_PORT` | `6379` | Standard Redis port |
| `spring.session.store-type` | `redis` (app/admin) / `none` (api/worker) | Session store type — app and admin use Redis sessions, api/worker do not need them |
| `exchange-websocket.redis-pubsub-cache.enabled` | `true` | Enable caching via Redis PubSub |
| `exchange-websocket.redis-pubsub-cache.expire-in-minutes` | `5` | PubSub cache expiration time |

### 4. AWS Services

| Variable | Value | Purpose |
|----------|-------|---------|
| `cloud.aws.region.static` | `ap-northeast-1` | AWS Region (Tokyo) |
| `cloud.aws.credentials.use-default-aws-credentials-chain` | `false` | Do not use default credential chain — use instance profile or env vars instead |
| `aws.s3.kyc-bucket.name` | `kyc.bs-point-{env}-ex` | S3 bucket for storing KYC documents (identity verification) |
| `aws.s3.year-report-bucket.name` | `year-report.bs-point-{env}-ex` | S3 bucket for annual reports (tax, transactions) |
| `AWS_SES_HOST` | `email-smtp.ap-northeast-1.amazonaws.com` | SMTP host for SES — sending transactional emails |
| `AWS_SES_PORT` | `587` | SMTP TLS port |
| `AWS_SES_USERNAME` | AWS Secrets Manager | SMTP credentials |
| `AWS_SES_PASSWORD` | AWS Secrets Manager | SMTP credentials |
| `AWS_CREDENTIALS_SALT` | AWS Secrets Manager | Salt used for internal credential encryption |

### 5. JWT & Authentication

Only applies to `point-app` (customer-facing).

| Variable | Value | Purpose |
|----------|-------|---------|
| `jwt.issuer` | `bs-point-server` | Issuer name written in the JWT token |
| `jwt.secret` | `0123456789` (dev) / Secrets Manager (stg/prd) | Secret key for signing JWT |
| `jwt.token-ttl` | `7600` seconds (~2 hours) | Access token lifetime |
| `jwt.refresh-token-ttl` | `604800` seconds (7 days) | Refresh token lifetime |
| `jwt.cache-token-ttl` | `604800` seconds (7 days) | Token cache TTL in Redis |
| `point-common.account-lock.max-attempt` | `5` | Lock account after N failed login attempts |
| `point-common.account-lock.expire-seconds` | `0` | Lock duration (0 = permanent until admin unlocks) |
| `customer.forgot-password.token.forgot-effective-time` | `600000` ms (10 minutes) | Password reset link expiration |
| `customer.login-password.token.effective-time` | `86400000` ms (24 hours) | Account creation confirmation token expiration |
| `customer.register.enabled` | `true` | Enable/disable new account registration |
| `customer.fiat-withdrawal.user-daily-withdrawal-limit` | `30000000` | Daily fiat withdrawal limit (JPY) |
| `spring.recaptcha.secret-key` | hardcoded | Google reCAPTCHA v3 for bot protection |

### 6. External Service Integrations

Third-party services integrated into the system.

| Service | Main Variables | Purpose |
|---------|---------------|---------|
| **GMO Aozora Bank** | `gmo.client-id`, `gmo.secret`, `gmo.stg-base-endpoint` | Banking integration — JPY deposit/withdrawal via bank API |
| **Ponta** | `ponta.partner-number`, `ponta.keystore-password`, `ponta.login-url` | Loyalty point program — accumulate Ponta points for customers |
| **Refinitiv World-Check** | `refinitiv.api-key`, `refinitiv.secret-key`, `refinitiv.group-id` | AML/KYC screening — check sanctions lists, PEP status |
| **EKYC (NextWay)** | `ekyc.secret`, `ekyc.token`, `ekyc.api-auth-key` | Electronic identity verification (ID card/passport photo capture) |
| **Chainalysis** | `chainalysis.token`, `chainalysis.alert-level-limit` | Blockchain monitoring — detect suspicious crypto transactions |
| **Sygna Hub** | `sygna.account`, `sygna.credential`, `sygna.hub-base-url` | Travel Rule compliance — comply with international crypto transfer regulations |
| **Fireblocks** | `fireblocks.apiKey`, `fireblocks.secretKey`, `fireblocks.publicKey` | Custodian wallet management (hot/cold wallet) — all via Secrets Manager |
| **Wallet Gateway** | `wallet.client-id`, `wallet.apiKey`, `wallet.base-url` | Internal gateway for managing user crypto wallets |
| **OKCoin** | `dealing.okcoin.apiKey`, `dealing.okcoin.secret` | Liquidity provider — execute cover trades on exchange |
| **Amber (WhaleFin)** | `point-pos.best-price.amber.access-key/secret` | RFQ (Request for Quote) and spot orders with liquidity provider |
| **SMS (CPAAS)** | `sms.host`, `sms.token` | Send OTP verification SMS |

**Note on Fireblocks Asset IDs by environment:**
- **Dev/Stg (testnet):** `ADA_TEST`, `BTC_TEST`, `ETH_TEST5`, `XRP_TEST`, `NIDT_B75VRLGX_0A1F`
- **Prd (mainnet):** `ADA`, `BTC`, `ETH`, `XRP`, `NIDT`

### 7. Application Config

| Variable | Value | Purpose |
|----------|-------|---------|
| `server.port` | `8080` | Main application port |
| `management.port` | `8082` | Port for health check / Spring Actuator endpoints |
| `ENVIRONMENT` (Docker) | `dev` / `stg` / `prd` | Docker variable passed in, activates the corresponding Spring profile |
| `spring.config.environment` | `dev` / `stg` / `prd` | Environment name in config |
| `async.core-pool-size` | `60` (api/admin/app), `85` (worker) | Thread pool size for async tasks |
| `point-app.allowed-origin` | Domain per env | CORS whitelist — which domains are allowed to call the API |
| `point-app.debug-response` | `true` (dev), `false` (stg/prd) | Include extra debug info in responses (dev only) |
| `point-app.security.enable-invest-login-whitelist` | `true` | Enable IP whitelist for investment login |
| `spring.jpa.hibernate.ddl-auto` | `validate` (local), `none` (dev/stg/prd) | DDL strategy — `none` = do not auto-create/modify schema |
| `swagger.enabled` | `true` (dev), `false` (prd) | Enable/disable Swagger UI |
| `spring.servlet.multipart.max-file-size` | `16MB` | File upload size limit |
| `spring.servlet.multipart.max-request-size` | `17MB` | Total request size limit |

**`spring.config.domain` — Environment identifier (NOT an endpoint URL):**

The `domain` value in `spring.config` is primarily used as a label for MFA TOTP URI (Google Authenticator). These are NOT actual service endpoint domains.

| Module | DEV | STG | PRD |
|--------|-----|-----|-----|
| point-api | `api.dev.cxr-inc.com` | `api.stg.cxr-inc.com` | `backseat-service.com` |
| point-admin | `admin.dev.cxr-inc.com` | `admin.stg.cxr-inc.com` | `backseat-service.com` |
| point-app | `dev.backseat-service.com` | `stg.backseat-service.com` | `backseat-service.com` |
| point-worker | `worker.dev.cxr-inc.com` | `worker.stg.cxr-inc.com` | `backseat-service.com` |
| point-mmh | `worker.dev.cxr-inc.com` | `worker.stg.cxr-inc.com` | `backseat-service.com` |

**Actual domains used for CORS, redirects, and email links:**

| Config Key | Purpose | DEV Example |
|------------|---------|-------------|
| `point-app.allowed-origin` | CORS whitelist | `https://dev-ex.backseat-service.com` |
| `point-app.email.account-created.base-url` | Registration email link | `https://dev-ex.backseat-service.com/farm-game/farm/...` |
| `point-app.email.forgot-password.base-url` | Password reset link | `https://dev-ex.backseat-service.com/signIn/reset/...` |
| `ponta.login-success-url` | OAuth callback URL | `https://dev-ex.backseat-service.com/oauth/callback/` |
| `point-admin.host` | Admin panel base URL | `https://admin.dev.cxr-inc.com` |

### 8. Monitoring & Metrics

| Variable | Value | Purpose |
|----------|-------|---------|
| `management.metrics.export.cloudwatch.enabled` | `false` (default) | Enable/disable pushing metrics to CloudWatch |
| `management.metrics.export.cloudwatch.namespace` | `point-api` / `point-worker` ... | CloudWatch namespace for each module |
| `management.metrics.export.cloudwatch.step` | `1m` | Metrics push interval |
| `management.metrics.web.server.request.metric-name` | `http.server.requests` | Metric name for HTTP requests |
| Prometheus | Enabled (dev/stg) | Endpoint `/actuator/prometheus` for scraping |

**Logging:**
| Config | Local | Dev/Stg/Prd | Purpose |
|--------|-------|-------------|---------|
| Console appender | `CONSOLE_DEFAULT` | `CONSOLE_JSON` | Local uses text, server uses JSON (for Fluent Bit parsing) |
| `show-sql` | `true` | `false` | Log SQL queries — only enabled locally for debugging |
| Hikari pool log | off | `DEBUG` | Detailed connection pool logging on server |

### 9. Trading — Amber / OKCoin

Liquidity provider configuration for the POS (Point of Sale) trading system.

| Variable | DEV | STG | PRD | Purpose |
|----------|-----|-----|-----|---------|
| `point-pos.best-price.amber.api-host` | `https://aws-private-alpha.whalefin.com` | Same as DEV | `https://be.whalefin.com` | RFQ API endpoint |
| `point-pos.best-price.amber.access-key` | Hardcoded | Hardcoded | Secrets Manager | API key for RFQ |
| `point-pos.base-trade.amber.api-host` | `https://aws-private-alpha.whalefin.com` | Same as DEV | `https://be.whalefin.com` | Spot Order API endpoint |
| `point-pos.base-trade.coinbook.api-host` | `http://point-api-service.default.svc.cluster.local:8080` | Same | Same | Internal K8s service for internal trades |

### 10. Other Configs

| Variable | Value | Purpose |
|----------|-------|---------|
| `point-common.sns.expired_minute` | `60` | SMS OTP code expires after 60 minutes |
| `ponta.otp-ttl` | `5` minutes | Ponta OTP expiration |
| `ponta.transfer-fee` | `0.01` | Ponta point transfer fee |
| `data-request.max-size` | `500` | Data request limit |
| `csv-download.max-records` | `5000` | Record limit when exporting CSV |
| `vote-reward.expire-unit` / `expire-date` | `YEAR` / `1` | Vote reward expires after 1 year |
| `server.servlet.session.timeout` | `1d` | Session timeout of 1 day |
| `server.servlet.session.cookie.max-age` | `7d` | Cookie lifetime of 7 days |
| `exchange-websocket.subscription-limit-per-session` | `100` | WebSocket subscription limit per session |
| `hulft.snddata` / `hulft.rcvdata` | `/nfs/hulft/snddata` / `/nfs/hulft/rcvdata/` | NFS paths for HULFT file transfer (Ponta) |

---

## II. Infra Project (`bs-exchange-infra/k8s-manifests`)

Uses **Kustomize** with a base + overlay pattern:
- `point/base/` — shared template for all services
- `point/{dev-ex,stg-ex}/` — environment-specific overrides

### 1. Deployment ENV vars

Set directly in the deployment YAML for each environment.

| Variable | DEV (`dev-ex`) | STG (`stg-ex`) | Purpose |
|----------|----------------|----------------|---------|
| `SPRING_PROFILES_ACTIVE` | `"dev"` | `"stg"` | Activate the corresponding Spring profile |
| `JAVA_TOOL_OPTIONS` | `-XX:MaxDirectMemorySize=100M -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=8000` | `-XX:MaxDirectMemorySize=500M` | **DEV**: enable remote debug on port 8000, memory 100M. **STG**: disable debug, memory 500M for production-like load |

**`JAVA_TOOL_OPTIONS` explained:**
- `-XX:MaxDirectMemorySize=100M/500M`: Limits direct (off-heap) memory the JVM can allocate. STG needs more due to near-production traffic.
- `-agentlib:jdwp=...address=8000`: Enables Java Debug Wire Protocol — allows attaching a remote IDE debugger. **Only used in DEV**.

### 2. K8s Secrets (`point-secrets`)

All deployments inject secrets via:
```yaml
envFrom:
  - secretRef:
      name: point-secrets
```

Keys in this Secret (sourced from AWS Secrets Manager):

| Key | Purpose |
|-----|---------|
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
| `AWS_CREDENTIALS_SALT` | Encryption salt |
| `FIREBLOCKS_APIKEY` | Fireblocks API key |
| `FIREBLOCKS_PUBLICKEY` | Fireblocks public key |
| `FIREBLOCKS_SECRETKEY` | Fireblocks secret key |

### 3. CloudWatch Agent

DaemonSet running on every node, collecting system metrics.

| Variable | Source | Value | Purpose |
|----------|--------|-------|---------|
| `HOST_IP` | `fieldRef: status.hostIP` | (dynamic) | Node IP — used for metrics tagging |
| `HOST_NAME` | `fieldRef: spec.nodeName` | (dynamic) | Node name |
| `K8S_NAMESPACE` | `fieldRef: metadata.namespace` | (dynamic) | Current namespace |
| `CI_VERSION` | Direct | `"k8s/1.3.7"` | CloudWatch agent version tag |
| `RUN_WITH_IRSA` | Direct | `"True"` | Use IAM Role for Service Account instead of hardcoded credentials |

### 4. Fluent Bit (Log Shipping)

DaemonSet shipping container logs from all pods to CloudWatch Logs.

| Variable | Source | Value | Purpose |
|----------|--------|-------|---------|
| `AWS_REGION` | ConfigMap | `ap-northeast-1` | Region for log delivery |
| `CLUSTER_NAME` | ConfigMap | `point` | Cluster name — used in log group name |
| `HTTP_SERVER` | ConfigMap | `On` | Expose Fluent Bit metrics endpoint |
| `HTTP_PORT` | ConfigMap | `2020` | Metrics endpoint port |
| `READ_FROM_HEAD` | ConfigMap | `Off` | Do not read logs from the beginning of file |
| `READ_FROM_TAIL` | ConfigMap | `On` | Only read new logs — prevents replaying old logs on restart |
| `HOST_NAME` | `fieldRef: spec.nodeName` | (dynamic) | Prefix for CloudWatch log stream |
| `HOSTNAME` | `fieldRef: metadata.name` | (dynamic) | Pod name |
| `CI_VERSION` | Direct | `"k8s/1.3.16"` | Fluent Bit version tag |

### 5. AWS Load Balancer Controller

Helm chart values — does not use env vars directly but contains important config:

| Config | DEV | STG | Purpose |
|--------|-----|-----|---------|
| `clusterName` | `point` | `point` | EKS cluster name |
| `region` | `ap-northeast-1` | `ap-northeast-1` | AWS region |
| `vpcId` | `vpc-0e139c5a0789db4c0` | (from tfvars) | VPC for provisioning ALB |
| `replicaCount` | `2` | `2` | Number of controller pod replicas |
| `image.tag` | `v3.1.0` | `v3.1.0` | Controller version |

---

## III. Secrets Management Flow

```
AWS Secrets Manager
    |
    | (1) fetch_credentials.sh pulls secrets
    v
K8s Secret "point-secrets"
    |
    | (2) envFrom: secretRef injects into Pod
    v
Pod environment variables
    |
    | (3) Spring Boot auto-binding ${SPRING_*}
    v
application.yaml consumes the values
```

**Secrets paths in AWS Secrets Manager:**
| Path | Contents |
|------|----------|
| `point/base` | Shared config (SES, credentials salt, etc.) |
| `point/SPRING_DATA_REDIS` | Redis host/port |
| `point/SPRING_DATASOURCE_MASTER` | Aurora MySQL connection |
| `point/SPRING_DATASOURCE_HISTORICAL` | Redshift connection |
| `point/exc` | Fireblocks and other service credentials |
| `point/aws-credentials` | AWS credentials (only used for local dev) |

---

# Part B: Tools & Scripts

## I. K8s Manifests Scripts

Located at: `bs-exchange-infra/k8s-manifests/bin/`

### 1. `k8s_apply.sh` — Full K8s Deployment

**Path:** `k8s-manifests/bin/k8s_apply.sh`

**Purpose:** The main script for deploying all Kubernetes manifests to the EKS cluster. Executes all necessary steps sequentially.

**Syntax:**
```bash
./k8s_apply.sh --env <env>
```

**Parameters:**
| Parameter | Value | Required | Description |
|-----------|-------|----------|-------------|
| `--env` | `dev`, `dev-ex`, `stg`, `stg-ex`, `prd` | No (auto-detected from AWS profile) | Specify the target environment |

**Execution steps (in order):**

| # | Step | Description |
|---|------|-------------|
| 1 | Update kubeconfig | Connect to EKS cluster `point` |
| 2 | VPC CNI tuning | Set `WARM_IP_TARGET=2`, `MINIMUM_IP_TARGET=1` on `aws-node` DaemonSet |
| 3 | RBAC | Apply ClusterRole and RoleBinding |
| 4 | aws-auth ConfigMap | Map IAM roles/users to K8s permissions |
| 5 | ALB Controller CRDs | Download and apply Custom Resource Definitions |
| 6 | ALB Controller (Helm) | Install/upgrade AWS Load Balancer Controller chart |
| 7 | NFS Provisioner | Configure NFS mount for HULFT file transfer (STG/PRD only) |
| 8 | CoreDNS | Apply CoreDNS config (STG only) |
| 9 | Cluster Autoscaler | Apply autoscaler config |
| 10 | Metrics Server | Apply metrics server for HPA |
| 11 | CloudWatch + Fluent Bit | Apply observability stack |
| 12 | Pod Security | Apply PSA labels |
| 13 | NetworkPolicy | Apply network rules |
| 14 | Secrets | Call `fetch_credentials.sh` to sync secrets |
| 15 | Kustomize deployments | Apply ingress + 5 deployments (admin, api, app, mmh, worker) |

**NFS Config by environment:**
| Env | NFS Server |
|-----|-----------|
| STG | `10.51.187.138:/mnt/hulft/tmp` |
| PRD | `10.51.188.138:/mnt/hulft/tmp` |

**Dependencies:** `aws` CLI, `kubectl`, `helm`, `wget`, `kustomize`

**Examples:**
```bash
# Deploy everything to STG
./k8s_apply.sh --env stg-ex

# Deploy to DEV (auto-detect from AWS_PROFILE)
export AWS_PROFILE=bs-point-dev-ex
./k8s_apply.sh
```

---

### 2. `fetch_credentials.sh` — Sync Secrets

**Path:** `k8s-manifests/bin/fetch_credentials.sh`

**Purpose:** Fetch secrets from AWS Secrets Manager, compare with the current K8s Secret, and apply if there are changes.

**Syntax:**
```bash
./fetch_credentials.sh [--env <env>] [--list]
```

**Parameters:**
| Parameter | Description |
|-----------|-------------|
| `--env <env>` | Specify environment (`dev`, `stg`, `prd`, `local`) |
| `--list` | Only list secret keys (dry-run, does not apply) |

**Behavior by environment:**
| Mode | Output | Description |
|------|--------|-------------|
| `local` | File `local.env` | Create env file for local development — fetched from `base` + `aws-credentials` |
| `default` | K8s Secret `point-secrets` | Create/update Opaque Secret — fetched from `base`, `SPRING_DATA_REDIS`, `SPRING_DATASOURCE_MASTER`, `SPRING_DATASOURCE_HISTORICAL`, `exc` |

**Special features:**
- **Automatic backup:** Saves the current secret to `.secret-backups/` before making changes (keeps the 10 most recent backups)
- **Detailed diff:** Displays added/modified/removed keys before applying
- **Confirmation:** Prompts the user before applying changes

**Dependencies:** `aws` CLI, `kubectl`, `jq`

**Examples:**
```bash
# View which keys will be fetched
./fetch_credentials.sh --list

# Sync secrets for STG
./fetch_credentials.sh --env stg

# Create local.env file for local dev
./fetch_credentials.sh --env local
```

---

### 3. `apply_secrets.sh` — Wrapper for fetch_credentials

**Path:** `k8s-manifests/bin/apply_secrets.sh`

**Purpose:** Simple wrapper: updates kubeconfig then calls `fetch_credentials.sh`.

**Syntax:**
```bash
./apply_secrets.sh [--env <env>]
```

**Parameters:**
| Parameter | Value | Description |
|-----------|-------|-------------|
| `--env` | `dev`, `dev2`, `dev3`, `stg`, `stg2`, `stg-ex`, `prd` | Specify environment |

**Example:**
```bash
./apply_secrets.sh --env stg-ex
```

---

### 4. `rehearsal_secrets.sh`

**Path:** `k8s-manifests/bin/rehearsal_secrets.sh`

**Purpose:** A version similar to `fetch_credentials.sh` — used for rehearsal (dry run) before the actual apply.

---

## II. Terraform Scripts

### 1. `terraform.sh` — Main Wrapper

**Path:** `bs-exchange-infra/terraform/terraform.sh`

**Purpose:** Wrapper that manages Terraform backend configuration and environments. **This script must be used instead of running `terraform` directly.**

**Syntax:**
```bash
# Run from the component directory
cd terraform/components/<component>
../../terraform.sh [options] <terraform-command>
```

**Parameters:**
| Parameter | Description |
|-----------|-------------|
| `--env <env>` | Specify environment (overrides AWS_PROFILE/AWS_VAULT) |
| `--clean` | Delete the terraform working directory (`tmp/<ENV>/<COMPONENT>`) |
| `--local` | Use local backend instead of S3 |
| `-v` | Verbose output |
| `-h`, `--help` | Show help |

**Auto-detect environment:**
| AWS_PROFILE pattern | Environment |
|---------------------|------------|
| `bs-point-dev*` | `dev` |
| `bs-point-stg*` | `stg` |
| `bs-point-prd*` | `prd` |
| `bs-point-cxr-dev*` | `cxr-dev` |

**Backend S3:**
- Bucket: `tfstate.bs-point-<ENV>` (e.g., `tfstate.bs-point-dev-ex`)
- State key: `<COMPONENT>/terraform.tfstate`

**Special features:**
- Auto-runs `terraform init` when not yet initialized
- Manages `backend.tf` lifecycle (copy in, run, cleanup)
- Saves backend config to `.cxr_config`
- Traps Ctrl+C for `backend.tf` cleanup
- Displays execution time

**Examples:**
```bash
# Init and plan for VPC in STG
cd terraform/components/vpc
../../terraform.sh --env stg-ex init
../../terraform.sh --env stg-ex plan

# Apply EKS in DEV
cd terraform/components/eks
../../terraform.sh --env dev-ex apply

# Clear terraform cache for a component
../../terraform.sh --clean
```

**Dependencies:** `terraform`, `bash-functions.sh`

---

### 2. `execute.sh` — Multi-component executor

**Path:** `bs-exchange-infra/terraform/tool/execute_targets/execute.sh`

**Purpose:** Run a terraform command across multiple components simultaneously in the order defined in a targets file.

**Syntax:**
```bash
./execute.sh [options] <terraform-command>
```

**Parameters:**
| Parameter | Description |
|-----------|-------------|
| `--env <env>` | Specify environment |
| `-f <file>` | File containing the list of components (default: `targets.txt`) |
| `-v` | Verbose output |
| `-y` | Auto-approve (no confirmation prompt) |

**Targets file format (`targets.txt`):**
```
# Lines starting with # are comments
vpc
eks
ec2-bastion
sns-alert
```

**Behavior by command:**
| Command | Order | Parallel? |
|---------|-------|-----------|
| `init`, `get` | As listed in file | Parallel (with separate logs) |
| `plan`, `apply` | As listed in file | Sequential |
| `destroy` | **Reversed** | Sequential |

**Examples:**
```bash
# Plan all components in targets.txt
./execute.sh --env stg plan

# Apply with a custom targets file, auto-approve
./execute.sh -y -f stg-targets.txt --env stg-ex apply

# Destroy in reverse order
./execute.sh --env dev-ex destroy
```

**Dependencies:** `terraform`, `bash-functions.sh`

---

## III. Database User Management

Located at: `bs-exchange-infra/terraform/tool/db-user-manager/`

A set of scripts for managing user accounts in Aurora MySQL and Redshift, syncing credentials to AWS Secrets Manager.

### 1. Aurora Scripts

| Script | Purpose | Syntax |
|--------|---------|--------|
| `aurora-create-users.sh` | Create 4 new user accounts (editor_service, viewer_service, editor_user, viewer_user) + update 5 secrets | `AURORA_HOST=<host> ./aurora-create-users.sh` |
| `aurora-drop-users.sh` | Drop 4 user accounts | `AURORA_HOST=<host> ./aurora-drop-users.sh` |
| `aurora-update-master-password.sh` | Rotate the master user password | `AURORA_HOST=<host> ./aurora-update-master-password.sh` |
| `aurora-update-passwords.sh` | Rotate passwords for the 4 application users | `AURORA_HOST=<host> ./aurora-update-passwords.sh` |

**User roles and permissions:**
| User | Secret Path | Permissions |
|------|-------------|-------------|
| `master` | `point/aurora/master_user` | Full admin |
| `point` (editor_service) | `point/aurora/editor_service` | SELECT, INSERT, UPDATE, DELETE on `point.*` |
| `point_viewer` (viewer_service) | `point/aurora/viewer_service` | SELECT on `point.*` |
| `editor` | `point/aurora/editor_user` | ALL on `point.*` |
| `viewer` | `point/aurora/viewer_user` | SELECT on `point.*` |

**Spring Boot secret:** `point/SPRING_DATASOURCE_MASTER` — contains connection string format:
```
jdbc:mariadb:aurora//<HOST>:3306/<DBNAME>?zeroDateTimeBehavior=convertToNull
```

### 2. Redshift Scripts

| Script | Purpose | Syntax |
|--------|---------|--------|
| `redshift-create-users.sh` | Create 4 user accounts for Redshift | `REDSHIFT_HOST=<host> ./redshift-create-users.sh` |
| `redshift-update-master-password.sh` | Rotate the master password | `REDSHIFT_HOST=<host> ./redshift-update-master-password.sh` |
| `redshift-update-passwords.sh` | Rotate passwords for the 4 application users | `REDSHIFT_HOST=<host> ./redshift-update-passwords.sh` |

**Spring Boot secret:** `point/SPRING_DATASOURCE_HISTORICAL` — contains connection string format:
```
jdbc:redshift://<HOST>:5439/<DBNAME>
```

### 3. Shared Libraries

| File | Purpose |
|------|---------|
| `init.sh` | Common functions: `generate_password()` (generates 16-character password), `update-secret-value()` (updates AWS Secrets Manager) |
| `init-aurora.sh` | Aurora config: defines user roles, secret paths, functions `aurora-update-secret-value()` and `update-spring-boot-secret()` |
| `init-redshift.sh` | Redshift config: similar to `init-aurora.sh` but for Redshift (port 5439, redshift driver) |

**How to use the libraries:**
```bash
# All aurora-*.sh and redshift-*.sh scripts source:
source ./init.sh
source ./init-aurora.sh   # or init-redshift.sh
```

---

## IV. Lambda Build Scripts

Scripts for packaging Lambda functions into ZIP files for deployment via Terraform.

| Script | Lambda | Language | Purpose |
|--------|--------|----------|---------|
| `terraform/components/sns-alert/sns-to-slack/build.sh` | SNS to Slack | Python | Package `app.py`, `app_util.py`, `slack_message.py` — forward SNS alerts to Slack |
| `terraform/components/sns-alert/sns-to-slack/clean.sh` | SNS to Slack | Python | Delete `__pycache__` and `.pytest_cache` |
| `terraform/components/waf-maintenance-lambda/src/scripts/build.sh` | WAF Maintenance | Python | Package `app.py`, `utils.py`, `rules/` — automatically toggle WAF maintenance mode |
| `terraform/components/frontend-customer/src/build.sh` | Frontend | JavaScript | Package `index.js` — Lambda@Edge for frontend |

**General usage:**
```bash
cd <lambda-source-dir>
./build.sh               # Creates ../lambda_function.zip
```

**Makefile (WAF Maintenance):**
```bash
cd terraform/components/waf-maintenance-lambda/src
make build                # Package lambda
make maintenance-start    # Test locally with start event
make maintenance-end      # Test locally with end event
make clean                # Delete cache
```

---

## V. EC2 User Data Scripts

Cloud-init scripts that run when an EC2 instance is first initialized (via Terraform `user_data`).

### 1. Bastion Host (`ec2-bastion/user_data.sh`)

**Purpose:** Install tools on the bastion host (jump server) for accessing internal infrastructure.

**Tools installed:**
| Tool | Version | Purpose |
|------|---------|---------|
| `kubectl` | v1.28.15 | Manage K8s cluster |
| `helm` | v3.16.1 | Manage Helm charts |
| `aws` CLI | v2 (latest) | Interact with AWS |
| `terraform` | latest | Manage infrastructure |
| `jq` | latest | Parse JSON |
| `redis-tools` | latest | Debug Redis |
| `mariadb-client` | latest | Debug Aurora MySQL |
| `postgresql-12` | v12 | Debug Redshift |
| `shfmt` | latest | Format shell scripts |

### 2. Data Transfer (`ec2-data-transfer/user_data.sh`)

**Purpose:** Instance for data migration/transfer tasks.

**OS:** Amazon Linux 2023

**Tools installed:**
| Tool | Purpose |
|------|---------|
| OpenJDK 17 (Corretto) | Run Java tools |
| PostgreSQL 15 client | Connect to Redshift |
| MariaDB 10.5 client | Connect to Aurora |
| AWS CLI v2 | Interact with AWS |
| Git, jq, perl | Utilities |

### 3. HULFT Server (`ec2-hulft/user_data.sh`)

**Purpose:** Instance running the HULFT file transfer system — exchanging files with Ponta (loyalty program).

**OS:** RHEL 8

**Setup steps:**
1. Register RHEL subscription
2. Install AWS CLI, SSM Agent
3. Mount NFS volume (`/dev/nvme1n1` -> `/mnt/hulft`)
4. Export NFS share for K8s pods
5. Install HULFT v8.5.2
6. Create systemd services `hulft` and `watch_snddata`
7. Set system locale to Japanese

**Terraform variables passed in:**
| Variable | Purpose |
|----------|---------|
| `${hostname}` | Instance hostname |
| `${ponta_hulft_ip}` | Ponta HULFT server IP |
| `${ponta_hulft_hostname}` | Ponta HULFT hostname |
| `${hulft_serial}` | License serial |
| `${hulft_productkey}` | License product key |
| `${ponta_hulft_snd001_name/id}` | Send definition 1 |
| `${ponta_hulft_snd002_name/id}` | Send definition 2 |

**File monitor:** The `watch_snddata` service uses `inotifywait` to automatically send files when changes are detected in `/mnt/hulft/tmp/snddata/`.

---

## VI. Bash Utility Library

**Path:** `bs-exchange-infra/lib/bash-functions.sh`

**Purpose:** Shared function library used by all scripts.

| Function | Description | Example |
|----------|-------------|---------|
| `get_target_env()` | Detect environment from `AWS_PROFILE` or `AWS_VAULT` | `ENV=$(get_target_env)` -> returns `dev`, `stg`, `prd`, etc. |
| `echo_label()` | Print text in cyan (label format) | `echo_label "Processing: "` |
| `seconds_to_minsec()` | Convert seconds to "X min Y sec" | `seconds_to_minsec 305` -> `"5 min 5 sec"` |

**AWS Profile to Env mapping:**
| Pattern | Result |
|---------|--------|
| `bs-point-dev2*` | `dev2` |
| `bs-point-dev3*` | `dev3` |
| `bs-point-dev*` | `dev` |
| `bs-point-stg-ex*` | `stg-ex` |
| `bs-point-stg*` | `stg` |
| `bs-point-prd*` | `prd` |

---

# Part C: Security Notes

### Credentials Hardcoded in Source Code

The following API keys/secrets are **currently present directly** in `application-{dev,stg}.yaml`:

| Service | File | Risk |
|---------|------|------|
| AWS SES | `application.yaml` | SMTP credentials hardcoded |
| GMO Aozora | `application-dev.yaml` | Client ID + Secret |
| OKCoin | `application-dev.yaml` | API Key + Secret + Passphrase |
| Refinitiv | `application-dev.yaml` | API Key + Secret Key |
| EKYC | `application-dev.yaml` | Secret + Token + Auth Key |
| Chainalysis | `application-dev.yaml` | Bearer Token |
| Sygna | `application-dev.yaml` | Account + Credential |
| Wallet Gateway | `application-dev.yaml` | Client Secret + API Key |
| reCAPTCHA | `application-dev.yaml` | Secret Key |

**Recommendation:** Migrate all secrets to AWS Secrets Manager before deploying to PRD. Many PRD values have already been moved to Secrets Manager (Fireblocks, Amber, JWT), but dev/stg still have them hardcoded.

### Remote Debug in DEV

`JAVA_TOOL_OPTIONS` in DEV enables JDWP on port 8000. This must **never** be enabled in PRD as it allows remote debugger attachment, which can read memory and modify runtime behavior.

### Local Dev Credentials in Repo

`application-local.yaml` contains DB passwords and Redis host for local development. Consider:
- Using a `.env` file (gitignored) instead of committing to the repo
- Or using `fetch_credentials.sh --env local` to generate a `local.env` file
