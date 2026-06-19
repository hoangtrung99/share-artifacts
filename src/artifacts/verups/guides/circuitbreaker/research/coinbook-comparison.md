# CircuitBreaker Alert Pipeline — So sánh verup vs coinbook

Tài liệu này so sánh trực tiếp implementation CircuitBreaker (app-side Java + infra-side Lambda Slack alert) giữa 2 project:

- **verup** (đang phát triển) — `/Users/hoangtrung/Work/solashi/verup/`
  - App: `bs-integration-server/point-worker/`
  - Infra: `bs-exchange-infra/terraform/components/`
- **coinbook** (production reference) — `/Users/hoangtrung/Work/solashi/coinbook/`
  - App: `cb-exchange-server/exchange-worker/`
  - Infra: `infra/terraform/components/`

Tất cả findings đều dựa trên **đọc code thực tế** + `diff` + `git log` tại thời điểm 2026-04-21. Không đoán.

---

## Table of Contents

- [1. Tổng quan kiến trúc CircuitBreaker](#1-tổng-quan-kiến-trúc-circuitbreaker)
- [2. Bảng so sánh App-side (worker Java)](#2-bảng-so-sánh-app-side-worker-java)
- [3. Bảng so sánh Infra-side (Lambda + Terraform)](#3-bảng-so-sánh-infra-side-lambda--terraform)
- [4. Bảng so sánh Alert format (Slack payload)](#4-bảng-so-sánh-alert-format-slack-payload)
- [5. Code diff nổi bật](#5-code-diff-nổi-bật)
  - [5.1 App: `CircuitBreaker.java` — verup có thêm `PosCandlestickService`](#51-app-circuitbreakerjava--verup-có-thêm-poscandlestickservice)
  - [5.2 App: start/end log (BB-1289) chỉ có ở verup](#52-app-startend-log-bb-1289-chỉ-có-ở-verup)
  - [5.3 Lambda: gzip guard chỉ có ở verup](#53-lambda-gzip-guard-chỉ-có-ở-verup)
  - [5.4 Terraform: python runtime — coinbook đã upgrade 3.9→3.13](#54-terraform-python-runtime--coinbook-đã-upgrade-3933)
  - [5.5 Build automation: `build.sh` chỉ có ở coinbook](#55-build-automation-buildsh-chỉ-có-ở-coinbook)
  - [5.6 Downstream blockers: verup mở rộng sang POS](#56-downstream-blockers-verup-mở-rộng-sang-pos)
- [6. Pipeline song song: CloudWatch Metric Filter → SNS → chatbot](#6-pipeline-song-song-cloudwatch-metric-filter--sns--chatbot)
- [7. Lessons từ coinbook mà verup nên apply](#7-lessons-từ-coinbook-mà-verup-nên-apply)
- [8. Lessons từ verup mà coinbook có thể học](#8-lessons-từ-verup-mà-coinbook-có-thể-học)
- [9. Git / Confluence archaeology](#9-git--confluence-archaeology)
- [10. Khẳng định phương pháp](#10-khẳng-định-phương-pháp)

---

## 1. Tổng quan kiến trúc CircuitBreaker

Cả 2 project đều dùng cùng 1 mô hình 2 tầng:

```
┌─────────────────────────────────────────────────────────────────┐
│  App tier (Java Spring Boot worker pod)                          │
│  ─ CircuitBreakerSqsSubscriber (SQS trigger) ─▶ CircuitBreaker   │
│    (check 1m candlestick diff rate vs circuitBreakPercent)       │
│    ─ đặt `circuitBreakUpdatedAt` vào CurrencyPairConfig          │
│    ─ emit log "Circuit Breaker symbol: {...}"                    │
└──────────────────┬──────────────────────────────────────────────┘
                   │ stdout → Fluent Bit → CloudWatch Logs
                   ▼
         /aws/containerinsights/{point|exchange}/application
                   │
        ┌──────────┴────────────────────┐
        │                               │
        ▼                               ▼
┌──────────────────────┐    ┌─────────────────────────────────┐
│ Log Subscription     │    │ Metric Filter + Metric Alarm    │
│  → Lambda            │    │  → SNS alert-chatbot-worker     │
│  → Slack webhook     │    │  → Slack chatbot (thông qua     │
│    (rate-limited     │    │    AWS Chatbot)                 │
│    10 phút)          │    │                                 │
└──────────────────────┘    └─────────────────────────────────┘
```

Cả 2 project đều có **cả hai nhánh alert** (Lambda → webhook và Metric Alarm → SNS → Chatbot). Không project nào dùng SNS thay thế Lambda hoặc Block Kit thay thế text.

**Downstream order blocker (app logic):** khi `circuitBreakUpdatedAt` còn trong `stopTimespan`, tầng order sẽ throw `ErrorCode.ORDER_ERROR_CIRCUIT_BREAKER(50031)`:

- verup chặn ở: `SpotOrderService.isCircuitBreaking`, `SpotTradeService`, **`PosOrderService.isCircuitBreaking`**, **`PointPosOrderService.isCircuitBreaking`**
- coinbook chặn ở: `SpotOrderService.isCircuitBreaking`, `SpotTradeService` (không có POS)

---

## 2. Bảng so sánh App-side (worker Java)

| Aspect | verup | coinbook | Khác biệt |
|---|---|---|---|
| Class path | `point.worker.worker.CircuitBreaker` | `exchange.worker.worker.CircuitBreaker` | Rename do migration `exchange` → `point` |
| Injected services | `CurrencyPairConfigService` + `PosCandlestickService` | `CurrencyPairConfigService` | verup inject **thừa** `PosCandlestickService` (chưa được dùng trong `execute()`) — xem §5.1 |
| Logic tính diffRate | từ `latestCandlestick.open - previousCandlestick.open` (abs) / `previousCandlestick.open` | Y hệt | **Giống** về algorithm |
| Threshold | `currencyPairConfig.getCircuitBreakPercent()` qua `CalculatorUtil.calculatePercentage` | Y hệt | **Giống** |
| Time span | `CandlestickType.PT1M` (1 phút) | Y hệt | **Giống** |
| Detection action | `currencyPairConfig.setCircuitBreakUpdatedAt(date)` + `save()` | Y hệt | **Giống** |
| Log format trigger | `"Circuit Breaker symbol: " + JsonUtil.encode(symbol) + ...` | Y hệt | **Giống** (quan trọng: chính chuỗi này match `filter_pattern` ở Lambda) |
| Start/end log | `"========== ... CircuitBreaker start =========="` + `end` | **KHÔNG CÓ** | verup thêm qua BB-1289 (xem §5.2) |
| Verbose `log.info` trong path thường | Có log `currencyPairConfig`, `latestCandlestick`, `previousCandlestickOpen`, `diffRate`, `circuitBreakPercent`, `circuitBreakUpdatedAt` | **KHÔNG CÓ** — chỉ log khi detection dương tính | verup log verbose hơn ~10x mỗi tick |
| `previousTargetAt` type | `long` (primitive) | `Long` (boxed) | verup unbox sớm (minor) |
| Variable name | `circuitBreakPercent` | `cirCuitBreakPercent` (typo) | verup đã sửa typo |
| Code style | 4-space indent | 2-space indent | verup đã re-format (`7918817c4 format code`, `7a79542eb format code`) |
| Error code | `ORDER_ERROR_CIRCUIT_BREAKER(50031)` ở line 225 `ErrorCode.java` | Y hệt ở line 172 | **Giống mã**, khác vị trí do enum thêm items |
| Downstream blocker call sites | `SpotOrderService` + `SpotTradeService` + `PosOrderService` + `PointPosOrderService` | `SpotOrderService` + `SpotTradeService` | verup mở rộng sang domain POS (point-of-sale / điểm thưởng) — xem §5.6 |
| Symbol filter | "Invest only" (ghi rõ ở `scheduler.md` verup, bảng scheduler) | Không có file `scheduler.md` riêng | verup có doc hoá scope hơn |
| Scheduler | `CircuitBreakerSqsSubscriber extends SqsSubscriber<CircuitBreaker>` — đăng ký class trong `Application.java` | **Y hệt file `CircuitBreakerSqsSubscriber.java`** | 2 file `CircuitBreakerSqsSubscriber.java` giống 100% về logic; chỉ khác package (`point.*` vs `exchange.*`) |
| `Application.java` registration | Trong list SqsSubscriber class (line 31) | Trong list (line 32) | **Giống cách đăng ký** |

---

## 3. Bảng so sánh Infra-side (Lambda + Terraform)

| Aspect | verup | coinbook | Khác biệt |
|---|---|---|---|
| Component path | `bs-exchange-infra/terraform/components/cloudwatch_circuitbreaker_lambda/` | `infra/terraform/components/cloudwatch_circuitbreaker_lambda/` | Tên thư mục **giống** |
| `main.tf` (Lambda + IAM + subscription filter) | 3.0KB | 3.0KB | Logic giống, chỉ khác runtime (§5.4) |
| `versions.tf` | `aws ~> 4.0` | `aws ~> 5.78 (python3.13 support)` | **Coinbook đã upgrade**. verup còn giữ AWS provider v4 |
| Lambda runtime | `python3.9` | `python3.13` | coinbook đã UNYO-1058 upgrade (Python 3.9 EOL compliance) |
| Layer runtime | `python3.9` | `python3.13` | Đồng bộ với Lambda |
| Lambda source build | `lambda_function.zip` commit sẵn vào git (2.7KB src, handler zip 1.2KB) | Có `lambda_function.zip` commit nhưng cũng có `.gitignore` + `build.sh` để rebuild | coinbook có automation |
| Layer build | `python_module.zip` 1.6MB commit sẵn (chứa `python3.9/site-packages`) | `python_module.zip` 2.0MB commit sẵn (chứa `python3.13/site-packages`, bao gồm `slack_sdk`) | coinbook layer bao gồm `slack-sdk==3.20.2` ngoài `requests==2.28.2` |
| `src/requirements.txt` | **KHÔNG CÓ** | `requests==2.28.2` + `slack-sdk==3.20.2` | verup thiếu file requirements để track deps |
| `src/scripts/build.sh` | **KHÔNG CÓ** | Có bash script ~140 dòng: detect runtime từ `main.tf`, vendor deps qua venv, zip 2 artifact | **Coinbook đã automate** — xem §5.5 |
| `.gitignore` trong component | **KHÔNG CÓ** | `src/python/` + `.venv/` ignore | coinbook không commit vendored deps |
| IAM role name | `lambda-slack-circuitbreaker-role` | Y hệt | **Giống** |
| IAM policy | `logs:*` với `Resource = "*"` | Y hệt | **Giống** — cả 2 đều scope rộng (xem §7) |
| Log permission source ARN | `arn:aws:logs:ap-northeast-1:${var.account_id}:log-group:*:*` | Y hệt | **Giống** |
| Subscription filter | Single filter trên `var.log_group` với `var.filter_pattern` | Y hệt | **Giống** |
| `environment.variables` | `SLACK_WEBHOOK_URL` + `SLACK_ALERT_EMOJI` + `SLACK_WARNING_TEXT` | Y hệt | **Giống** |
| `source_code_hash` | `filebase64sha256("lambda_function.zip")` | Y hệt (verup đã fix theo commit `1ff9b5f`) | Trước đây verup dùng `filebase64`; coinbook cũng đã fix (`749825c Fix: Use filebase64sha256 instead of filebase64`) — giờ hội tụ |
| tfvars files | `dev-ex.tfvars`, `stg-ex.tfvars` (hậu tố `-ex` do multi-account convention verup) | `dev.tfvars`, `stg.tfvars`, `prd.tfvars` | **Coinbook có PRD tfvars**, verup **chưa** (verup chưa deploy PRD) |
| Log group trong `terraform.tfvars` | `/aws/containerinsights/point/application` | `/aws/containerinsights/exchange/application` | Khác namespace EKS |
| Filter pattern pod prefix | `point-worker-*` | `exchange-worker-*` | Khác |
| Slack webhook secret | Plaintext trong tfvars (check in) | Plaintext trong tfvars (check in) | **Cả 2 đều chưa dùng secrets manager cho webhook** |
| Provider region | `ap-northeast-1` hard-code trong `main.tf` | Y hệt | **Giống** |
| PRD readiness | Chưa có `prd-ex.tfvars`; chỉ dev/stg | Đã có `prd.tfvars` đang chạy production | verup **cần bổ sung** trước khi go-live |

---

## 4. Bảng so sánh Alert format (Slack payload)

| Aspect | verup | coinbook | Khác biệt |
|---|---|---|---|
| Payload type | `text` (plain text), không Block Kit | Y hệt | **Cả hai đều plain text** — không project nào dùng Block Kit |
| Icon | `icon_emoji` = `SLACK_ALERT_EMOJI` (`:fire:`) | Y hệt | **Giống** |
| Bot username | `PointOPECircuitBreaker` | `CoinbookCircuitBreaker` | Khác tên app |
| Alert text template | `{emoji}{warning_text}{emoji}\n<!channel>\n*namespace_name*: ...\n*datetime*: ...\n*pod_name*: ...\n*circuitbreaker_log*: {first line only}\n` | Y hệt | **Giống 100%** cấu trúc text |
| Warning text | `[DEV]`/`[STG]` `CircuitBreaker Alert` | Y hệt (có thêm `[PRD]`) | Chỉ thiếu env PRD ở verup |
| Rate limit strategy | `last_log_sent_time` lưu trong **global biến module** — gate `time_diff > timedelta(minutes=10)` | Y hệt | **Cả 2 đều dùng global variable rate limit** (không persistent — mỗi cold-start reset) |
| Rate limit storage | Không persistent (Lambda memory) | Y hệt | **Cả 2 đều không dùng DynamoDB/Redis** — có thể duplicate alert khi cold-start |
| Gzip guard | **CÓ** (check `\x1f\x8b` magic + try/except quanh `gzip.decompress`) | **KHÔNG CÓ** (trust blind) | verup đã fix (commit `40a5a5a reupload the code`) — xem §5.3 và §8 |
| First-line truncation | `error_log.split('\n')[0]` | Y hệt | **Giống** — tránh log nhiều dòng làm message Slack quá dài |
| HTTP library | `requests.post` (requests==2.28.2 vendored trong layer) | Y hệt | **Giống** — nhưng coinbook layer còn bundle `slack-sdk` (không được dùng) |
| Retry logic | **KHÔNG CÓ** — 1 phát fail là drop | Y hệt | **Cả 2 đều không retry** — nếu Slack 429/503 thì mất cảnh báo |
| Error handling khi post thất bại | `print('Failed to post JSON data to Slack')` | Y hệt | **Giống** — chỉ log stdout |
| Post success bookkeeping | Chỉ update `last_log_sent_time` **sau khi** response 200 | Y hệt | **Giống** — đúng |

---

## 5. Code diff nổi bật

### 5.1 App: `CircuitBreaker.java` — verup có thêm `PosCandlestickService`

File: `point-worker/src/main/java/point/worker/worker/CircuitBreaker.java` vs `exchange-worker/src/main/java/exchange/worker/worker/CircuitBreaker.java`

```java
// verup (line 19, 28)
import point.pos.service.PosCandlestickService;
...
private final PosCandlestickService posCandlestickService;  // injected but NEVER referenced in execute()
```

coinbook **không** inject service này. Trong toàn bộ method `execute(Symbol, Map)`, `posCandlestickService` **không được gọi** — chỉ `CandlestickService.getBean(symbol)` được dùng.

**Nhận định:** có 2 khả năng:

1. Dead code — đã inject khi chuẩn bị cho feature POS circuit breaker nhưng chưa implement → nên remove hoặc hoàn thành.
2. Đang trong quá trình refactor `CandlestickService.getBean(symbol)` để route theo tradeType (Invest vs POS) → `PosCandlestickService` sẽ được gọi gián tiếp qua `getBean` khi symbol là POS.

Đề nghị verify: xem `CandlestickService.getBean(symbol)` trong verup — nếu nó đã là polymorphic theo tradeType thì injection này là thừa; nếu chưa, thì code path cho POS symbol vẫn chưa được kích hoạt.

### 5.2 App: start/end log (BB-1289) chỉ có ở verup

Commit verup `5cfffe7fd BB-1289 Batch start and end log is add`:

```java
// verup
public void execute(Symbol symbol, Map<String, Object> params) throws Exception {
    log.info(getClass().getName(), "==========不適正取引検知(tms)/CircuitBreaker start==========");
    // ... logic ...
    log.info(getClass().getName(), "==========不適正取引検知(tms)/CircuitBreaker end==========");
}
```

coinbook không có 2 log này. **Implication:** verup có thể đo latency per-invocation / trace flow dễ hơn từ CloudWatch. Coinbook chỉ log khi trigger.

### 5.3 Lambda: gzip guard chỉ có ở verup

Commit verup `40a5a5a reupload the code` (10-12-2025):

```python
# verup (lambda_function.py line 22-31)
decoded_data = base64.b64decode(log_data)

# Guard: ensure we actually have gzip-compressed data
if not decoded_data.startswith(b'\x1f\x8b'):
    print(f"Not gzip payload; len={len(decoded_data)} bytes")
    return

try:
    json_data = gzip.decompress(decoded_data)
except Exception as e:
    print(f"Gzip decompress failed: {e}")
    return
```

coinbook (line 20-22):

```python
# coinbook
decoded_data = base64.b64decode(log_data)
json_data = gzip.decompress(decoded_data)   # crash nếu không phải gzip
payload = json.loads(json_data)
```

**Implication:** nếu CloudWatch Log Subscription gửi sự kiện test (không gzip) hoặc payload hỏng, coinbook Lambda sẽ raise exception và retry tối đa 2 lần (mặc định) rồi đi vào DLQ/drop. verup sẽ log cảnh báo và return gracefully.

### 5.4 Terraform: python runtime — coinbook đã upgrade 3.9→3.13

Commit coinbook `3590b38 Upgrade Lambda Python runtime from 3.9 to 3.13 with AWS Provider 5.78` (10-11-2025):

```diff
# coinbook main.tf
-  runtime       = "python3.9"
+  runtime       = "python3.13"
...
-    "python3.9"
+    "python3.13"
```

```diff
# coinbook versions.tf
-      version = "~> 4.0"
+      version = "~> 5.78" # Upgraded to support python3.13 runtime
```

verup **vẫn ở python3.9** và AWS provider `~> 4.0`. Python 3.9 đã hết support từ AWS Lambda managed runtime (deprecated). verup sẽ phải migrate trong 2026.

**Commit coinbook ghi chú:** "Related: UNYO-1058 (Python 3.9 EOL compliance)". Đây là 1 ticket runbook có thể reference khi verup migrate.

### 5.5 Build automation: `build.sh` chỉ có ở coinbook

coinbook `src/scripts/build.sh` (137 dòng) tự động:

1. Detect python runtime version từ `main.tf` (`grep runtime` + `sed`).
2. Tạo temp venv.
3. `pip install -r requirements.txt` vào `src/python/lib/python<ver>/site-packages/`.
4. Zip `lambda_function.py` thành `lambda_function.zip`.
5. Zip `python/` thành `python_module.zip` với layout Lambda Layer đúng (`/opt/python/lib/pythonX.Y/site-packages`).
6. Loại `__pycache__`, `*.pyc`, `*.pyo`.

verup **không có** build script — layer `.zip` được build thủ công hoặc từ IDE, commit trực tiếp. Điều này gây:

- Reproducibility kém (không biết dùng python version nào để build).
- Khó bump dep version (phải build local → copy zip → commit).
- Không có `requirements.txt` nên không pin được version.

### 5.6 Downstream blockers: verup mở rộng sang POS

verup block circuit breaker ở 4 service, coinbook chỉ 2:

```java
// verup only: point-common/src/main/java/point/pos/service/PosOrderService.java line 125-130
if (OrderType.valueOf(form.getOrderType()) == OrderType.MARKET) {
    if (isCircuitBreaking(symbol)) {
        throw new CustomException(ErrorCode.ORDER_ERROR_CIRCUIT_BREAKER);
    }
}

// verup only: PointPosOrderService.java cũng có isCircuitBreaking(Symbol symbol)
```

Khác biệt OrderType filter:

- **Spot** services: check circuit breaker cho `MARKET || STOP || SIMPLE_MARKET`.
- **POS** services (verup only): chỉ check `MARKET` (không có STOP/SIMPLE_MARKET cho POS).

**Implication:** domain POS (dùng cho điểm thưởng / point-to-crypto) trong verup có thêm safety net mà coinbook chưa có. Đây là feature mở rộng của verup project.

---

## 6. Pipeline song song: CloudWatch Metric Filter → SNS → chatbot

Ngoài Lambda-to-Slack, cả 2 project còn có một pipeline **thứ 2** cho circuit breaker:

File `cloudwatch_metrics/circuit_breaker.tf` (verup & coinbook) — **verup và coinbook giống hệt nhau về cấu trúc**, khác duy nhất namespace:

| Aspect | verup | coinbook |
|---|---|---|
| Metric filter name | `circuitBreaker-DETECTED` | `circuitBreaker-DETECTED` |
| Metric namespace | `point-metrics` | `exchange-metrics` |
| Pattern | `{ $.kubernetes.pod_name = "point-worker-*" && $.log_processed.level = "INFO" && $.log_processed.message="Circuit Breaker symbol:*" }` | `{ $.kubernetes.pod_name = "exchange-worker-*" && ... }` |
| Alarm | `aws_cloudwatch_metric_alarm.log-circuit-breaker-detected` | Y hệt |
| Period / threshold | 60s / > 0 / 1 period / 1 datapoint | Y hệt |
| Alarm action | `data.aws_sns_topic.alert-chatbot-worker.arn` | Y hệt |

**Điều này có nghĩa:** mỗi lần circuit breaker kích hoạt ở verup/coinbook:

- **Route A:** Log Subscription → Lambda → Slack webhook trực tiếp (message format tự soạn, rate-limit 10 phút per cold-start).
- **Route B:** Log Metric Filter → CloudWatch Alarm → SNS → AWS Chatbot → Slack (format Chatbot mặc định, không rate-limit tuỳ ý).

**Cả 2 project đều duplicate alert** qua 2 route này. Đây là design cố ý (redundancy) nhưng cũng có thể dẫn đến noise.

---

## 7. Lessons từ coinbook mà verup nên apply

Xếp theo priority (cao → thấp):

### P0 — Blocker trước PRD

1. **Upgrade Lambda runtime Python 3.9 → 3.13.** Python 3.9 đã deprecated ở AWS Lambda managed runtime. Coinbook đã migrate trong commit `3590b38` với checklist:
   - Bump `aws ~> 4.0` → `aws ~> 5.78` trong `versions.tf`.
   - Update `runtime = "python3.13"` + `compatible_runtimes = ["python3.13"]`.
   - Rebuild layer với python3.13 site-packages.
   - Apply đồng thời cho `cloudwatch_circuitbreaker_lambda`, `cloudwatch_errorlog_lambda`, `sns-to-slack`, `waf-maintenance-lambda`, `ses_usage_notification`.

2. **Tạo `prd-ex.tfvars` cho production account.** Hiện verup chỉ có `dev-ex.tfvars` và `stg-ex.tfvars`. Coinbook tham chiếu (đổi `account_id`, `slack_webhook_url` riêng cho PRD, filter pattern giữ nguyên).

### P1 — High value

3. **Add `requirements.txt` + `build.sh`** cho Lambda. Copy từ `coinbook/infra/terraform/components/cloudwatch_circuitbreaker_lambda/src/scripts/build.sh`. Benefit:
   - Reproducible builds.
   - Tracked dep versions (hiện tại không biết `requests` version nào đang trong layer verup).
   - `.gitignore` vendored `python/` thư mục để repo nhẹ hơn.

4. **Apply cùng pattern `build.sh` cho các Lambda khác** trong verup: `cloudwatch_errorlog_lambda`, `waf-maintenance-lambda` — 3 Lambda này chia sẻ cùng pattern zip committed và sẽ cùng gặp vấn đề khi bump python runtime.

### P2 — Nice to have

5. **Slack webhook qua AWS Secrets Manager** thay vì plaintext trong tfvars. Cả verup **và** coinbook đều chưa làm điều này — đây là lesson **2 bên nên cùng apply**, không phải "coinbook vượt verup".

6. **IAM policy scoping:** hiện `Resource = "*"` cho `logs:*`. Nên scope xuống `arn:aws:logs:ap-northeast-1:${account_id}:log-group:/aws/lambda/circuitbreaker-to-slack:*`. Cả 2 project đều chưa làm.

7. **Rate limit persistent:** global variable `last_log_sent_time` mất khi cold-start. Nên dùng DynamoDB với TTL 10 phút hoặc CloudWatch metric để persist. Cả 2 project đều chưa làm.

### P3 — Tech debt

8. **Retry logic cho Slack post:** hiện fail là mất alert. Thêm exponential backoff khi response != 200.

---

## 8. Lessons từ verup mà coinbook có thể học

1. **Gzip guard trong Lambda (§5.3).** verup đã fix bug "không phải gzip payload gây crash Lambda" ở commit `40a5a5a`. Coinbook vẫn có bug này. Khuyến nghị coinbook cherry-pick diff này.

2. **Start/end log trong worker (§5.2, BB-1289).** verup thêm `"==========CircuitBreaker start=========="` để đo throughput/latency per tick. Coinbook chỉ log khi trigger dương tính, mất visibility khi debug "worker có đang chạy không?".

3. **Fix typo `cirCuitBreakPercent` → `circuitBreakPercent`.** verup đã sửa, coinbook còn giữ (xem §2). Cosmetic nhưng ảnh hưởng grep/search.

4. **Code re-format (2-space → 4-space consistent).** verup đã chuẩn hoá indent (`7918817c4 format code`). Coinbook còn mixed 2-space.

5. **`scheduler.md` để doc hoá scope worker.** verup có file `bs-integration-server/scheduler.md` liệt kê rõ CircuitBreaker chỉ chạy trên Invest env (bảng markdown). Coinbook không có tài liệu tương đương — người mới join không biết scope worker.

6. **Mở rộng CircuitBreaker check sang POS** (§5.6). Nếu coinbook có kế hoạch thêm domain tương tự point-of-sale hoặc loyalty, pattern verup cho thấy cần 4 call site thay vì 2.

---

## 9. Git / Confluence archaeology

### Git log — verup `bs-exchange-infra` component

```
40a5a5a reupload the code                           (Dec 2025, coinbook-shuku)
    → Thêm gzip guard (xem §5.3)
1ff9b5f webhook and hash revision for circuit alert (Dec 2025, coinbook-shuku)
    → Fix filebase64 → filebase64sha256 + update STG webhook URL
7721174 init commit                                  (initial)
```

### Git log — coinbook `infra` component

```
7726ce4 Add build scripts and .gitignore for cloudwatch circuitbreaker and errorlog Lambdas
0081f6e Remove Python dependencies from git tracking and add to .gitignore
749825c Fix: Use filebase64sha256 instead of filebase64 for Lambda source_code_hash
3590b38 Upgrade Lambda Python runtime from 3.9 to 3.13 with AWS Provider 5.78
        (Nov 2025, hoangtrung, UNYO-1058 Python 3.9 EOL compliance)
921ded4 terraform/components/cloudwatch_circuitbreaker_lambda modified
...
9142daf add terraform/components/cloudwatch_circuitbreaker_lambda
```

**Nhận xét:**

- coinbook có lịch sử phát triển dài hơn (13 commits), verup chỉ fork từ 1 snapshot gần cuối (3 commits).
- Coinbook đi trước verup 4 tháng về Python 3.13 upgrade.
- Coinbook đi trước verup về build automation.
- verup đi trước coinbook về gzip guard (đóng góp ngược).

### Git log — App-side CircuitBreaker.java

**verup:**
```
7918817c4 format code
5cfffe7fd BB-1289 Batch start and end log is add       (thêm start/end log)
7a79542eb format code
e105b3846 circuitBreakerバッチを改修                     (refactor batch)
bfc5fecad 不適正取引検知(tms)                             (initial TMS implementation)
d422766c0 BB-85 BB-96 BB-81 BB-82 BB-87 BB-88 code initialization
```

**coinbook:**
```
acce8a6a5 move package worker demon
d18181a23 base
```

verup có nhiều commit chi tiết hơn (BB ticket trace), coinbook lịch sử ngắn hơn (có thể đã squash).

### JIRA / Confluence references found

- **BB-1289** (verup): thêm start/end log cho batch — đã apply.
- **UNYO-1058** (coinbook): Python 3.9 EOL compliance — cần tạo ticket tương đương ở BB project để verup migrate.
- **Confluence circuit breaker design doc:** chưa search (tôi không truy cập Confluence trong task này để giữ scope research local).

---

## 10. Khẳng định phương pháp

- **Grep:** đã dùng (qua Grep tool) để locate file liên quan ở cả 2 project.
- **ccc / gitnexus:** **KHÔNG dùng** trong research này. Lý do: task là so sánh đối chiếu text/structure giữa 2 codebase song song có path tương đương — direct `diff` + Grep đủ tin cậy, không cần semantic search. Nếu mở rộng sang "tìm các Lambda alert tương tự khác" thì mới nên dùng ccc.
- **`diff` lệnh:** đã dùng cho tất cả file có path tương đương — 100% evidence dựa trên output diff thực tế.
- **`git log` / `git show`:** đã dùng ở cả 2 repo để extract author, date, commit message làm archaeology.
- **Confluence / Jira search:** **không dùng** (giới hạn scope local). Các JIRA reference (BB-1289, UNYO-1058) lấy trực tiếp từ commit message, không qua API call.
- **KHÔNG TÌM THẤY:**
  - Không tìm thấy Block Kit / structured Slack message ở bất kỳ project nào — cả 2 đều plain text.
  - Không tìm thấy persistent rate-limit (DynamoDB/Redis) — cả 2 chỉ dùng Lambda global variable.
  - Không tìm thấy DLQ cho Lambda Slack alert — cả 2 không cấu hình.
  - Không tìm thấy Confluence design doc gốc (không search Confluence).

---

## Phụ lục — File paths đã đọc

**verup:**

- `/Users/hoangtrung/Work/solashi/verup/bs-integration-server/point-worker/src/main/java/point/worker/worker/CircuitBreaker.java`
- `/Users/hoangtrung/Work/solashi/verup/bs-integration-server/point-worker/src/main/java/point/worker/sqssubscriber/CircuitBreakerSqsSubscriber.java`
- `/Users/hoangtrung/Work/solashi/verup/bs-integration-server/point-worker/src/main/java/point/worker/Application.java`
- `/Users/hoangtrung/Work/solashi/verup/bs-integration-server/point-common/src/main/java/point/spot/service/SpotOrderService.java`
- `/Users/hoangtrung/Work/solashi/verup/bs-integration-server/point-common/src/main/java/point/pos/service/PosOrderService.java`
- `/Users/hoangtrung/Work/solashi/verup/bs-integration-server/point-common/src/main/java/point/pos/service/PointPosOrderService.java`
- `/Users/hoangtrung/Work/solashi/verup/bs-integration-server/point-common/src/main/java/point/common/constant/ErrorCode.java`
- `/Users/hoangtrung/Work/solashi/verup/bs-integration-server/scheduler.md`
- `/Users/hoangtrung/Work/solashi/verup/bs-exchange-infra/terraform/components/cloudwatch_circuitbreaker_lambda/main.tf`
- `/Users/hoangtrung/Work/solashi/verup/bs-exchange-infra/terraform/components/cloudwatch_circuitbreaker_lambda/versions.tf`
- `/Users/hoangtrung/Work/solashi/verup/bs-exchange-infra/terraform/components/cloudwatch_circuitbreaker_lambda/terraform.tfvars`
- `/Users/hoangtrung/Work/solashi/verup/bs-exchange-infra/terraform/components/cloudwatch_circuitbreaker_lambda/tfvars/dev-ex.tfvars`
- `/Users/hoangtrung/Work/solashi/verup/bs-exchange-infra/terraform/components/cloudwatch_circuitbreaker_lambda/tfvars/stg-ex.tfvars`
- `/Users/hoangtrung/Work/solashi/verup/bs-exchange-infra/terraform/components/cloudwatch_circuitbreaker_lambda/src/lambda_function.py`
- `/Users/hoangtrung/Work/solashi/verup/bs-exchange-infra/terraform/components/cloudwatch_metrics/circuit_breaker.tf`
- `/Users/hoangtrung/Work/solashi/verup/bs-exchange-infra/terraform/components/cloudwatch_alarm/log-point-worker.tf`

**coinbook:**

- `/Users/hoangtrung/Work/solashi/coinbook/cb-exchange-server/exchange-worker/src/main/java/exchange/worker/worker/CircuitBreaker.java`
- `/Users/hoangtrung/Work/solashi/coinbook/cb-exchange-server/exchange-worker/src/main/java/exchange/worker/sqssubscriber/CircuitBreakerSqsSubscriber.java`
- `/Users/hoangtrung/Work/solashi/coinbook/cb-exchange-server/exchange-worker/src/main/java/exchange/worker/Application.java`
- `/Users/hoangtrung/Work/solashi/coinbook/cb-exchange-server/exchange-common/src/main/java/exchange/spot/service/SpotOrderService.java`
- `/Users/hoangtrung/Work/solashi/coinbook/cb-exchange-server/exchange-common/src/main/java/exchange/spot/service/SpotTradeService.java`
- `/Users/hoangtrung/Work/solashi/coinbook/cb-exchange-server/exchange-common/src/main/java/exchange/common/constant/ErrorCode.java`
- `/Users/hoangtrung/Work/solashi/coinbook/infra/terraform/components/cloudwatch_circuitbreaker_lambda/main.tf`
- `/Users/hoangtrung/Work/solashi/coinbook/infra/terraform/components/cloudwatch_circuitbreaker_lambda/versions.tf`
- `/Users/hoangtrung/Work/solashi/coinbook/infra/terraform/components/cloudwatch_circuitbreaker_lambda/terraform.tfvars`
- `/Users/hoangtrung/Work/solashi/coinbook/infra/terraform/components/cloudwatch_circuitbreaker_lambda/tfvars/{dev,stg,prd}.tfvars`
- `/Users/hoangtrung/Work/solashi/coinbook/infra/terraform/components/cloudwatch_circuitbreaker_lambda/src/lambda_function.py`
- `/Users/hoangtrung/Work/solashi/coinbook/infra/terraform/components/cloudwatch_circuitbreaker_lambda/src/requirements.txt`
- `/Users/hoangtrung/Work/solashi/coinbook/infra/terraform/components/cloudwatch_circuitbreaker_lambda/src/scripts/build.sh`
- `/Users/hoangtrung/Work/solashi/coinbook/infra/terraform/components/cloudwatch_circuitbreaker_lambda/.gitignore`
- `/Users/hoangtrung/Work/solashi/coinbook/infra/terraform/components/cloudwatch_metrics/circuit_breaker.tf`
- `/Users/hoangtrung/Work/solashi/coinbook/infra/terraform/components/cloudwatch_alarm/log-exchange-worker.tf`

— Hết —
