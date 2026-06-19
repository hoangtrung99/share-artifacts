# Maintenance Mode — Impact on /api/* Endpoints

> **Scope**: `bs-exchange-infra` (verup/exchange), `bs-point-infra` (point), `coinbook/infra` (exchange).  
> **Code evidence**: `waf-maintenance-lambda/`, `waf-customer/module-waf/rulegroup-maintenance.tf`.  
> **Last reviewed**: 2026-05-13

---

## Table of Contents

1. [Architecture — WAF-Level, Not Application-Level](#1-architecture--waf-level-not-application-level)
2. [How Maintenance Mode Is Toggled](#2-how-maintenance-mode-is-toggled)
3. [WAF Rule Group — 6-Rule Evaluation Order](#3-waf-rule-group--6-rule-evaluation-order)
4. [Impact on /api/* During Maintenance](#4-impact-on-api-during-maintenance)
5. [Response Bodies Returned to Callers](#5-response-bodies-returned-to-callers)
6. [Scheduled Maintenance — Daily and Weekly](#6-scheduled-maintenance--daily-and-weekly)
7. [IP Allowlist — Bypassing Maintenance](#7-ip-allowlist--bypassing-maintenance)
8. [Key Clarification: /api/v1/auth/login Does Not Exist](#8-key-clarification-apiv1authlogin-does-not-exist)

---

## 1. Architecture — WAF-Level, Not Application-Level

Maintenance mode is enforced entirely at the **AWS WAF (CloudFront scope)** layer.
The Spring Boot pods (`point-api`, `point-app`) are **completely unaware** of maintenance state.
WAF blocks the request before it reaches CloudFront origin, so no application log is generated
for blocked requests.

```
Browser / API client
        │
        ▼
 CloudFront CDN
        │
 ┌──────▼──────────────────────────────────────┐
 │  WAF WebACL: point-cloudfront-customer       │
 │  (scope: CLOUDFRONT, us-east-1)              │
 │                                              │
 │  [ maintenance rule group — when ON ]        │
 │    P1  pass /maintenance/*        → ALLOW    │
 │    P2  /app/v1/game/home/*        → BLOCK    │
 │    P3  /admin/*                   → BLOCK    │
 │    P4  /api/*              ←──────→ BLOCK ◄──┤── this document
 │    P5  /app/*                     → BLOCK    │
 │    P6  (catch-all)                → BLOCK    │
 └──────────────────────────────────────────────┘
        │  (only if NOT blocked)
        ▼
      ALB → EKS Ingress → point-api / point-app pods
```

**Source file**:
`bs-exchange-infra/terraform/components/waf-customer/module-waf/rulegroup-maintenance.tf`

---

## 2. How Maintenance Mode Is Toggled

The `waf-maintenance-lambda` component controls maintenance state by **injecting or removing
a rule group reference** from the WebACL. The rule group itself always exists in AWS — it is
the reference inside the WebACL that is added/removed.

**Lambda entry point**:
`bs-exchange-infra/terraform/components/waf-maintenance-lambda/src/app.py`

```python
# app.py:10 — target WebACL
webacl_name = 'point-cloudfront-customer'

# app.py:13 — must use us-east-1 for CLOUDFRONT scope
waf_region = 'us-east-1'

# app.py:22 — the rule group name to inject
rule_group_name = 'point-cloudfront-customer-maintenance-rulegroup'

# app.py:25 — injected after this existing rule
target_rule = 'country_restrict'
```

**Toggle logic** (`app.py:67–105`):

```python
def lambda_handler(event, context):
    maintenance_mode = event['maintenance']   # "start" or "end"

    if maintenance_mode == 'start':
        enable_waf_maintenance(...)   # adds rule group reference to WebACL
    elif maintenance_mode == 'end':
        disable_waf_maintenance(...)  # removes rule group reference from WebACL
```

**enable_waf_maintenance** (`app.py:159–248`):
Reads current WebACL rules, appends the maintenance rule group reference immediately after
`country_restrict`, renumbers all rule priorities, and calls `UpdateWebACL`. If the maintenance
rule is already present, returns `already started` without modifying the WebACL (idempotent).

**disable_waf_maintenance** (`app.py:251–322`):
Reads current WebACL rules, removes any rule whose name is in `add_rule_names` (`["maintenance"]`),
and calls `UpdateWebACL`. If not found, returns `already ended` (idempotent).

**Rule group reference payload**
(`bs-exchange-infra/terraform/components/waf-maintenance-lambda/src/rules/maintenance.json`):

```json
{
  "Name": "maintenance",
  "Priority": 6,
  "Statement": {
    "RuleGroupReferenceStatement": {
      "ARN": "__RULE_GROUP_ARN__"
    }
  },
  "OverrideAction": { "None": {} },
  "VisibilityConfig": {
    "SampledRequestsEnabled": false,
    "CloudWatchMetricsEnabled": false,
    "MetricName": "maintenance"
  }
}
```

The `__RULE_GROUP_ARN__` placeholder is replaced at runtime with the actual ARN of
`point-cloudfront-customer-maintenance-rulegroup` via `utils.get_waf_rule_group_arn()`.

---

## 3. WAF Rule Group — 6-Rule Evaluation Order

**Source**: `bs-exchange-infra/terraform/components/waf-customer/module-waf/rulegroup-maintenance.tf`

WAF evaluates rules in **ascending priority order** and stops at the first matching rule with
a terminating action (allow or block).

```hcl
resource "aws_wafv2_rule_group" "maintenance" {
  name     = "${var.webacl_name}-maintenance-rulegroup"
  scope    = "CLOUDFRONT"
  capacity = 15
  ...
}
```

| Priority | Rule name | Match condition | Action |
|:---:|---|---|---|
| 1 | `pass_maintenance_access` | URI `STARTS_WITH /maintenance/` | **Allow** |
| 2 | `maintenance_mode_for_path_ponta` | URI `STARTS_WITH /app/v1/game/home/` **AND** IP NOT in allowlist | Block 503 + HTML |
| 3 | `maintenance_mode_for_path_admin` | URI `STARTS_WITH /admin/` **AND** IP NOT in allowlist | Block 503 + JSON |
| **4** | **`maintenance_mode_for_path_api`** | **URI `STARTS_WITH /api/` AND IP NOT in allowlist** | **Block 503 + JSON** |
| 5 | `maintenance_mode_for_path_app` | URI `STARTS_WITH /app/` **AND** IP NOT in allowlist | Block 503 + JSON |
| 6 | `maintenance_mode_for_html` | IP NOT in allowlist (catch-all) | Block 503 + HTML |

**Priority 1 (allow /maintenance/*)** is evaluated first, so the maintenance HTML page itself
remains accessible to end users during a maintenance window.

**Rule 4 source** (`rulegroup-maintenance.tf:151–197`):

```hcl
rule {
  name     = "maintenance_mode_for_path_api"
  priority = 4

  action {
    block {
      custom_response {
        response_code            = 503
        custom_response_body_key = "maintenance_json"
      }
    }
  }

  statement {
    and_statement {
      statement {
        not_statement {
          statement {
            ip_set_reference_statement {
              arn = data.aws_wafv2_ip_set.maintenance_ips.arn
            }
          }
        }
      }
      statement {
        byte_match_statement {
          positional_constraint = "STARTS_WITH"
          search_string         = "/api/"
          field_to_match { uri_path {} }
          text_transformation { priority = 0; type = "NONE" }
        }
      }
    }
  }
  ...
}
```

---

## 4. Impact on /api/* During Maintenance

### Rule evaluation for any /api/* request

```
Request: GET /api/v1/orderbook?symbolId=1
                        │
        ┌───────────────▼────────────────────────────┐
        │ Maintenance rule group (when ON)            │
        │                                             │
        │ P1: /maintenance/*  ? NO → continue        │
        │ P2: /app/v1/game/*  ? NO → continue        │
        │ P3: /admin/*        ? NO → continue        │
        │ P4: /api/*          ? YES                  │
        │     IP in allowlist ? NO                   │
        │     → BLOCK 503 + {"code": 10005}          │
        └─────────────────────────────────────────────┘
           Request never reaches point-api pod.
           No Spring Boot log generated.
```

### Behaviour matrix

| Maintenance state | Client IP | Request | Result |
|---|---|---|---|
| **OFF** | any | `GET /api/v1/ticker` | WAF passes → ALB → `point-api` → 200 OK + JSON |
| **OFF** | any | `POST /api/v1/spot/order` | WAF passes → ALB → `point-api` → 200 / 4xx depending on auth |
| **ON** | **not** in `maintenance_ips` | **any** `/api/*` | **WAF blocks: HTTP 503 + `{"code": 10005}`** |
| **ON** | **in** `maintenance_ips` | any `/api/*` | P4 AND condition false → falls to P5, P6 (neither matches `/api/`) → WAF passes → `point-api` responds normally |

### Which /api/* endpoints are affected

All paths matching `STARTS_WITH /api/` are blocked without exception:

| Endpoint | Auth required | Blocked during maintenance? |
|---|:---:|:---:|
| `GET /api/v1/ticker` | No (public) | **Yes** |
| `GET /api/v1/orderbook` | No (public) | **Yes** |
| `GET /api/v1/candlestick` | No (public) | **Yes** |
| `GET /api/v1/trades` | No (public) | **Yes** |
| `GET /api/v1/symbol` | No (public) | **Yes** |
| `GET /api/v1/asset` | Yes (HMAC) | **Yes** |
| `GET/POST/DELETE /api/v1/spot/order` | Yes (HMAC) | **Yes** |
| `GET /api/v1/spot/trade` | Yes (HMAC) | **Yes** |
| `POST /api/v1/gmo-callback` | No (webhook) | **Yes** |
| `POST /api/v1/bpo-callback` | No (webhook) | **Yes** |
| `POST /api/v1/transactions-callback` | Yes (HMAC) | **Yes** |
| `GET /api/healthcheck` | No | **Yes** |

> **Webhook implication**: 3rd-party webhooks (`/api/v1/gmo-callback`, `/api/v1/bpo-callback`,
> `/api/v1/transactions-callback`) are also blocked during maintenance. Partner systems
> (GMO Aozora Bank, BPO eKYC) will receive `503` and must retry after maintenance ends.
> Ensure partner retry logic handles `503` gracefully and does not drop events.

---

## 5. Response Bodies Returned to Callers

**Custom response bodies** are declared in the rule group resource
(`rulegroup-maintenance.tf:6–24`):

```hcl
# For /api/*, /admin/*
custom_response_body {
  key          = "maintenance_json"
  content      = "{\"code\": 10005}"
  content_type = "APPLICATION_JSON"
}

# For /app/v1/game/home/*, catch-all HTML paths
custom_response_body {
  key          = "maintenance_html"
  content      = <<-EOT
  <html>
  <body>
  <script>
  location.href = "/maintenance/";
  </script>
  </body>
  </html>
  EOT
  content_type = "TEXT_HTML"
}
```

**What an API client receives** when maintenance is ON and IP is not in the allowlist:

```
HTTP/1.1 503 Service Unavailable
Content-Type: application/json

{"code": 10005}
```

> Code `10005` is the agreed maintenance signal between WAF and frontend/API clients.
> API clients must handle this code specifically — the Spring Boot application never
> produces this code; it is generated solely by WAF.

**What a browser user receives** when hitting `/app/*` or any non-matched path:

```
HTTP/1.1 503 Service Unavailable
Content-Type: text/html

<html><body><script>location.href = "/maintenance/";</script></body></html>
```

---

## 6. Scheduled Maintenance — Daily and Weekly

Maintenance windows can be triggered automatically by **Amazon EventBridge (CloudWatch Events)**
rules that invoke the `waf-maintenance-lambda` on a cron schedule.

**Source files** (identical structure across all repos):

```
terraform/components/waf-maintenance-lambda/
├── eventbridge_daily.tf    ← daily_start + daily_end rules
├── eventbridge_weekly.tf   ← weekly_start + weekly_end rules
└── tfvars/{env}.tfvars     ← enabled flag + cron expressions per env
```

**Terraform resource pattern** (`eventbridge_daily.tf:1–50`):

```hcl
# Creates EventBridge rule → Lambda target → Lambda permission
# for both "start" and "end" events

resource "aws_cloudwatch_event_rule" "maintenance_daily_start" {
  name                = "maintenance_daily_start"
  schedule_expression = var.maintenance_daily_start   # cron(...)
  is_enabled          = var.maintenance_daily_enabled  # true/false
}

resource "aws_cloudwatch_event_target" "maintenance_daily_start" {
  rule  = aws_cloudwatch_event_rule.maintenance_daily_start.name
  arn   = aws_lambda_function.this.arn
  input = <<EOF
{ "maintenance": "start" }
EOF
}
```

### Schedule configuration across all repos and environments

All cron expressions use **UTC**. JST = UTC + 9 hours.

#### coinbook/infra (exchange — `/Users/hoangtrung/Work/solashi/coinbook/infra`)

| Env | Daily | Daily window (JST) | Weekly | Weekly window (JST) |
|---|:---:|---|:---:|---|
| `dev` | ❌ false | 14:55 → 15:00 | ❌ false | Sat 07:00 → 09:00 |
| `stg` | ✅ **true** | **14:55 → 15:00** | ✅ **true** | Sat 07:00 → 09:00 |
| `prd` | ✅ **true** | **23:55 → 00:00** | ✅ **true** | Sat 07:00 → 09:00 |

Tfvars source: `coinbook/infra/terraform/components/waf-maintenance-lambda/tfvars/`

#### bs-point-infra (point)

| Env | Daily | Daily window (JST) | Weekly | Weekly window (JST) |
|---|:---:|---|:---:|---|
| `dev` / `dev2` / `dev3` | ❌ false | 14:55 → 15:00 | ❌ false | Sat 07:00 → 09:00 |
| `stg` | ✅ **true** | **23:55 → 00:00** | ✅ **true** | Sat 07:00 → 09:00 |
| `prd` | ✅ **true** | **23:55 → 00:00** | ✅ **true** | Sat 07:00 → 09:00 |

Tfvars source: `bs-point-infra/terraform/components/waf-maintenance-lambda/tfvars/`

#### bs-exchange-infra (verup)

| Env | Daily | Daily window (JST) | Weekly | Weekly window (JST) |
|---|:---:|---|:---:|---|
| `dev-ex` | ❌ false | 14:55 → 15:00 | ❌ false | Sat 07:00 → 09:00 |
| `stg-ex` | ❌ false | 23:55 → 00:00 ⚠️ | ❌ false | Sat 07:00 → 09:00 |

Tfvars source: `bs-exchange-infra/terraform/components/waf-maintenance-lambda/tfvars/`

> ⚠️ **Known comment bug in `stg-ex.tfvars`**: The comment reads `毎日 14:55-15:00 (JST)` but
> the actual cron `cron(55 14 * * ? *)` resolves to **23:55 JST**, not 14:55 JST. This is a
> copy-paste error from `dev-ex.tfvars`. Fix the comment before enabling this schedule to avoid
> on-call confusion.

### Cron expressions reference

| Cron (UTC) | JST equivalent | Used in |
|---|---|---|
| `cron(55 5 * * ? *)` | 14:55 JST every day | dev envs (all repos), coinbook stg |
| `cron(00 6 * * ? *)` | 15:00 JST every day | dev envs (all repos), coinbook stg |
| `cron(55 14 * * ? *)` | **23:55 JST** every day | point stg/prd, verup stg-ex, coinbook prd |
| `cron(00 15 * * ? *)` | **00:00 JST** next day | point stg/prd, verup stg-ex, coinbook prd |
| `cron(00 22 ? * 6 *)` | **Sat 07:00 JST** (Fri 22:00 UTC) | all envs (weekly start) |
| `cron(00 0 ? * 7 *)` | **Sat 09:00 JST** (Sat 00:00 UTC) | all envs (weekly end) |

> **AWS day-of-week encoding**: In EventBridge cron, `6` = Friday and `7` = Saturday
> (SUN=1, MON=2, ..., FRI=6, SAT=7).  
> `cron(00 22 ? * 6 *)` = Friday 22:00 UTC = Saturday 07:00 JST ✓  
> `cron(00 0 ? * 7 *)` = Saturday 00:00 UTC = Saturday 09:00 JST ✓

### Maintenance windows at a glance

```
JST timeline (00:00 → 24:00)
                                                     23:55  00:00
 14:55 15:00                                           │──5min──│  Daily (stg/prd live systems)
   │──5min──│  Daily (coinbook stg only)
                                            Sat
   00:00          07:00         09:00      24:00
     │─────────────│───2 hours───│           │         Weekly (all live systems)
```

---

## 7. IP Allowlist — Bypassing Maintenance

The IP allowlist (`maintenance_ips`) is an `aws_wafv2_ip_set` managed by the `waf-maintenance`
component. IPs in this set bypass all block rules (P2–P6) because each rule includes:

```hcl
statement {
  not_statement {
    statement {
      ip_set_reference_statement {
        arn = data.aws_wafv2_ip_set.maintenance_ips.arn
      }
    }
  }
}
```

**When `AND(NOT(IPset), STARTS_WITH /api/)` is evaluated:**

- IP **not** in allowlist → `NOT(IPset)` = true → AND = true → **block**
- IP **in** allowlist → `NOT(IPset)` = false → AND = false → rule does **not** match → fall through to next rule

Since rules P5 and P6 also carry the same `NOT(IPset)` condition, an allowlisted IP passes
through all six rules without being blocked, and the request reaches the `point-api` pod normally.

**Practical use**: office IPs and operator IPs are added to `maintenance_ips` so that engineers
can verify deployments and smoke-test the system while maintenance is active for end users.

> **Before enabling maintenance**: always verify that the `maintenance_ips` IP set contains
> current office/operator IPs. Run `aws sts get-caller-identity` with the correct profile first
> to confirm you are operating against the intended account.

---

## 8. Key Clarification: /api/v1/auth/login Does Not Exist

A common assumption is that `/api/v1/auth/login` is the login endpoint. This path does **not
exist** in `point-api`.

The `/api/*` namespace uses **stateless HMAC authentication** (no session, no login flow).
Callers authenticate every request by attaching three headers:

| Header | Content |
|---|---|
| `API-KEY` | Public key identifying the `ApiInfo` record |
| `NONCE` | Monotonically increasing integer (Unix timestamp ms) |
| `SIGNATURE` | `HMAC-SHA256(secret, nonce + seed)` where seed = URI+query for GET/DELETE, request body for POST/PUT |

Validated by `HandlerInterceptorImpl` before each controller method executes
(`bs-exchange-infra`→`bs-integration-server/point-api/src/main/java/point/api/config/HandlerInterceptorImpl.java`).

**Actual login endpoints** are in `point-app` (under `/app/*`), not `point-api`:

| Audience | Login endpoint |
|---|---|
| Exchange UI users | `POST /app/exchange/v1/user/login[/otpauth]` |
| Point / Invest UI users | `POST /app/v1/user/login[/otpauth]` |
| Ponta (Game / Operate) | `GET /app/v1/operate/user/ponta-login` (OAuth redirect) |

**What happens when maintenance is ON and a client calls `/api/v1/auth/login`:**

Even though this endpoint does not exist at the Spring Boot level, WAF evaluates the URI
`/api/v1/auth/login` and matches rule P4 (`STARTS_WITH /api/`). The response is:

```
HTTP/1.1 503 Service Unavailable
Content-Type: application/json

{"code": 10005}
```

The request never reaches the backend, so no 404 is generated. The 503 response is
indistinguishable from any other `/api/*` maintenance block.
