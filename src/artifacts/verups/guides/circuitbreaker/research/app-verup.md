# CircuitBreaker Alert Pipeline — Nghiên cứu phía APP (verup / bs-integration-server)

> Tài liệu research kỹ thuật chi tiết về CircuitBreaker Alert pipeline trong hệ thống Coinbook verup, dựa trên codebase `bs-integration-server` (nhánh `main`, kiểm tra ngày 2026-04-21).
>
> Phạm vi: **chỉ phía APP** (worker Java trong `bs-integration-server`). Phần AWS infra (SNS/SQS topic, CloudWatch alarm, Slack integration) nằm ngoài phạm vi file này.

---

## Mục lục (Table of Contents)

1. [Bối cảnh alert vừa bắn (STG, ADA_JPY)](#1-bối-cảnh-alert-vừa-bắn-stg-ada_jpy)
2. [Kiến trúc tổng quan — Trigger Chain](#2-kiến-trúc-tổng-quan--trigger-chain)
3. [Cấu hình SQS / SNS / WorkerMaster — Tần suất chạy](#3-cấu-hình-sqs--sns--workermaster--tần-suất-chạy)
4. [Lớp `CircuitBreaker` — Phân tích từng dòng](#4-lớp-circuitbreaker--phân-tích-từng-dòng)
5. [Các thành phần phụ trợ](#5-các-thành-phần-phụ-trợ)
   - 5.1 [`CandlestickType.PT1M`](#51-candlesticktypept1m)
   - 5.2 [`CandlestickService.getBean(symbol)` — polymorphism](#52-candlestickservicegetbeansymbol--polymorphism)
   - 5.3 [`findOneByCondition(..., isAscending)`](#53-findonebycondition-isascending)
   - 5.4 [`CalculatorUtil.divide` & `calculatePercentage`](#54-calculatorutildivide--calculatepercentage)
   - 5.5 [`Candlestick` entity — open/high/low/close/volume/fixed](#55-candlestick-entity--openhighlowclosevolumefixed)
6. [Persist state — `currency_pair_config`](#6-persist-state--currency_pair_config)
7. [Downstream effect — chặn order](#7-downstream-effect--chặn-order)
8. [Map bảng: field DB → behavior code → hiệu ứng business](#8-map-bảng-field-db--behavior-code--hiệu-ứng-business)
9. [Vì sao chỉ chặn MARKET/STOP/SIMPLE_MARKET, không chặn LIMIT?](#9-vì-sao-chỉ-chặn-marketstopsimple_market-không-chặn-limit)
10. [Workers liên quan khác & nền hạ tầng dùng chung](#10-workers-liên-quan-khác--nền-hạ-tầng-dùng-chung)
11. [Sơ đồ execution flow (ASCII)](#11-sơ-đồ-execution-flow-ascii)
12. [Câu hỏi mở (Open questions)](#12-câu-hỏi-mở-open-questions)

---

## 1. Bối cảnh alert vừa bắn (STG, ADA_JPY)

Alert Slack STG vừa nhận:

```
[STG] CircuitBreaker Alert
symbol: ADA_JPY (id=4, tradeType=SPOT)
diffRate=0.5128 > circuitBreakPercent/100=0.5 → trigger
```

Tức là:

- `diffRate` (absolute diff / previous open) = **0.5128 ≈ 51.28%**
- `circuitBreakPercent` trong DB = **50** (tức 50%) → sau `calculatePercentage(50)` = 50/100 = **0.5**
- Điều kiện `diffRate > 0.5` **đúng** → flag CircuitBreaker được bật cho ADA_JPY/SPOT, ghi `circuit_break_updated_at = now()`.

Từ thời điểm đó, `circuitBreakStopTimespan` phút tiếp theo **mọi MARKET/STOP/SIMPLE_MARKET order** cho ADA_JPY/SPOT sẽ bị từ chối với `ORDER_ERROR_CIRCUIT_BREAKER (50031)`.

Log trigger (INFO level, logger `point.worker.worker.CircuitBreaker`) — xem `CircuitBreaker.java:131-149`:

```
Circuit Breaker symbol: {...},
  circuitBreakCheckTimeSpan: {...},
  latestCandlestick: {...},
  previousCandlestick: {...},
  diffRate: 0.5128...,
  cirCuitBreakPercent/100: 0.5,
  circuitBreakStopTimespan: N,
  circuitBreakUpdatedAt: <Date>
```

> Lưu ý: log key `cirCuitBreakPercent/100` có typo trong code (`cirCuit` thiếu một `c`). Đây là format ổn định được bắt bởi alert pipeline phía infra.

---

## 2. Kiến trúc tổng quan — Trigger Chain

Pipeline CircuitBreaker chạy theo mô hình **SNS → SQS → Subscriber → Worker** trên framework Spring Boot + AWS SDK v1.

```
 ┌──────────────────────────┐
 │  SQS Poller loop          │  (SqsManager.subscribe, long-polling 20s)
 │  -> topic <env>-circuitBreaker
 └────────────┬─────────────┘
              │ 1 message mỗi "tick"
              ▼
 ┌──────────────────────────┐
 │ SqsCallback.callback     │  (decode JSON → WorkerForm)
 │ - nếu workerForm.method  │
 │   rỗng: scheduler mode   │
 │   (nạp WorkerMaster,     │
 │    re-publish mỗi        │
 │    intervalMillis)       │
 │ - ngược lại: execute một │
 │   lần (WorkerRunner)     │
 └────────────┬─────────────┘
              │
              ▼
 ┌──────────────────────────┐
 │ Worker.work(workerForm)  │  (acquire Redis lock)
 │ -> CircuitBreaker.execute│
 └────────────┬─────────────┘
              │
              ▼
 ┌──────────────────────────┐
 │ CircuitBreaker.execute    │  (logic ở §4)
 │ - đọc candlestick PT1M    │
 │ - tính diffRate           │
 │ - nếu vượt ngưỡng: cập    │
 │   nhật circuit_break_     │
 │   updated_at & log INFO   │
 └────────────┬─────────────┘
              │
              ▼
 ┌──────────────────────────┐
 │ CloudWatch log group      │  Alert pipeline (ngoài phạm vi file này)
 │ → metric filter → SNS     │
 │ → Slack                   │
 └──────────────────────────┘
```

**Khóa của mô hình**: `CircuitBreaker` worker **không tự lên lịch**. Nó chỉ chạy khi có message SQS rơi vào queue `<env>-circuitBreaker` (tên sinh bởi `SqsBeanName.toQueueName`). Ai đẩy message? Chính `SqsCallback` — xem §3.

File liên quan:
- `bs-integration-server/point-worker/src/main/java/point/worker/worker/CircuitBreaker.java`
- `bs-integration-server/point-worker/src/main/java/point/worker/sqssubscriber/CircuitBreakerSqsSubscriber.java`
- `bs-integration-server/point-worker/src/main/java/point/worker/component/SqsSubscriber.java`
- `bs-integration-server/point-worker/src/main/java/point/worker/component/SqsManager.java`
- `bs-integration-server/point-worker/src/main/java/point/worker/component/SqsCallback.java`
- `bs-integration-server/point-worker/src/main/java/point/worker/component/Worker.java`
- `bs-integration-server/point-worker/src/main/java/point/worker/component/SqsBeanName.java`
- `bs-integration-server/point-worker/src/main/java/point/worker/component/WorkerDaemon.java`
- `bs-integration-server/point-worker/src/main/java/point/worker/Application.java`

---

## 3. Cấu hình SQS / SNS / WorkerMaster — Tần suất chạy

### 3.1 Register subscriber

`Application.java:31` đưa `CircuitBreakerSqsSubscriber.class` vào enum `SubscriberGroup.ALL`. Khi `point-worker` khởi động (hoặc khởi động với argument là tên group), `WorkerDaemon.addSqsSubscriber(clazz)` sẽ `taskExecutor.execute(bean)` để gọi `run()` trong thread pool.

`SqsSubscriber.run()` gọi `sqsManager.subscribe(queueName, 10)` — **vòng `while(true)` long-polling 20s mỗi lần** (`WAIT_TIME_SECONDS=20`, `MAX_NUMBER_OF_MESSAGES=10`; xem `SqsManager.java:34,38`).

Tên queue: từ `SqsBeanName.toQueueName(CircuitBreaker.class)` → `<env>-circuitBreaker` (bean name = lowerCamelCase của class name).

### 3.2 Scheduler mode (ai đẩy message)

Khi message tới lần **đầu tiên** (thường do quá trình bootstrap/trigger thủ công đưa seed message, hoặc chính `SqsCallback` tự re-publish), `SqsCallback.callback` (SqsCallback.java:124-216) sẽ phân biệt 2 nhánh:

1. **`workerForm.method == null`** (seed message) → với từng `WorkerMaster` có `environment=<env>`, `beanName='circuitBreaker'`, `enabled=true`:
   - Tạo `WorkerForm` mới, gán `symbolId` (nếu `workerMaster.currencyPair != null`).
   - Nếu `intervalMillis == null` → `snsManager.publish(queueName, form)` (one-shot).
   - Nếu `intervalMillis != null` → spawn `WorkerMasterRunner` (scheduledExecutor) tự động `snsManager.publish(...)` **mỗi `intervalMillis` ms** trong **vòng 1 phút** (sau 1 phút thread tự shutdown — `SqsCallback.java:65-68`). Sau đó message tiếp theo lại đến và lặp chu trình.

2. **`workerForm.method != null`** → `WorkerRunner` executes `worker.work(workerForm)` **một lần** (thread pool).

### 3.3 Interval thực tế cho `circuitBreaker`

Từ seed DML (`V1.0.2__insert_point_dml.sql:200-201` và `V4.3.3_worker_master_統合.sql:21-22`):

```sql
INSERT INTO worker_master (environment, bean_name, trade_type, currency_pair, interval_millis, enabled, ...)
VALUES ('stg', 'circuitBreaker', 'SPOT', 'ADA_JPY', 1000, true, ...);
VALUES ('stg', 'circuitBreaker', 'SPOT', 'NIDT_JPY', 1000, true, ...);
```

→ `intervalMillis = 1000` ms = **mỗi 1 giây** worker CircuitBreaker chạy lại cho từng `(tradeType, currencyPair)`. DEV cũng set 1000 ms (`V4.3.3_worker_master_統合.sql:21-22`).

### 3.4 Symbol nào được kích hoạt?

Dựa theo `worker_master` DML gốc, chỉ `SPOT/ADA_JPY` và `SPOT/NIDT_JPY` được enable trên DEV/STG. Environment `prd` chưa deploy (per `CLAUDE.md:198` — "Verup (BB) has not yet deployed a PRD environment"). **Dữ liệu `worker_master` là nguồn duy nhất (SSOT) cho danh sách symbol bật CircuitBreaker** — muốn thêm cặp tiền mới thì phải insert row mới.

### 3.5 Invest-only

`scheduler.md:14` (trong repo `bs-integration-server`):

```
| 10 | CircuitBreaker | ☑️ | | (Invest only) |
```

Nghĩa là CircuitBreaker worker chỉ chạy trong môi trường `invest` — về mặt logic nhánh `SubscriberGroup.ALL` đã chứa toàn bộ subscriber; việc `Invest-only` được kiểm soát bằng **row `worker_master`** (chỉ insert row cho `environment=<invest env>`, không insert cho `operate` env).

---

## 4. Lớp `CircuitBreaker` — Phân tích từng dòng

File: `bs-integration-server/point-worker/src/main/java/point/worker/worker/CircuitBreaker.java`.

```java
@RequiredArgsConstructor
@Component
public class CircuitBreaker extends Worker {
    private final CurrencyPairConfigService currencyPairConfigService;
    private final PosCandlestickService posCandlestickService;  // inject nhưng thực tế chưa dùng
    private static final CustomLogger log = new CustomLogger(CircuitBreaker.class.getName());
    ...
}
```

> **Quan sát**: `posCandlestickService` được inject nhưng không được sử dụng trong `execute()` — có thể là dead-code legacy hoặc dự phòng cho pos trade type. Không xóa theo chỉ đạo chung (không scope vào task này).

Ký tên mỗi bước tương ứng với phần code (line references):

### 4.1 Lấy mốc thời gian “phút hiện tại, giây 00” (L32-L36)

```java
Date date = new Date();
long targetAt = CandlestickType.PT1M.getTargetAt(date).getTime();
```

`CandlestickType.PT1M.getTargetAt(date)` = `DateUnit.MINUTE.truncate(date.getTime())` = cắt giây/ms về 0 (xem `DateUnit.java:34-36` và `CandlestickType.java:192-194`). Tức là `targetAt = <phút đang chạy>:00.000`.

### 4.2 Đọc `CurrencyPairConfig` (L37-L40)

```java
CurrencyPairConfig currencyPairConfig =
    currencyPairConfigService.findByCondition(symbol.getTradeType(), symbol.getCurrencyPair());
log.info(...);
```

Query thẳng Aurora (không qua Redis — method `findByCondition(TradeType, CurrencyPair)` ở `CurrencyPairConfigService.java:53-66` dùng `customTransactionManager.find(...)`, không có bước `redisTemplate.getValue`). Log ra JSON toàn bộ config (INFO) — chính là payload dùng để đối chiếu với alert.

### 4.3 Lấy candlestick `PT1M` mới nhất (L42-L51)

```java
Candlestick latestCandlestick =
    CandlestickService.getBean(symbol)
        .findOneByCondition(symbol.getId(), CandlestickType.PT1M, targetAt, null, false);

if (latestCandlestick == null) return;  // không có → skip
log.info("latestCandlestick:" + ...);
```

- `CandlestickService.getBean(symbol)` → lấy bean theo tradeType/currencyPair (§5.2).
- `findOneByCondition(..., dateFrom=targetAt, dateTo=null, isAscending=false)`
  - `dateFrom = targetAt` (phút hiện tại) → `target_at >= now()`-phút
  - `dateTo = null` → không giới hạn trên
  - `isAscending = false` → sort `target_at DESC`, lấy `TOP 1`
  → trả về **candlestick mới nhất (thường chính là phút đang generate, `fixed=false`)**.
- Comment trong code (L47): "生成中(!isFixed)はOK" = candlestick đang được tạo (`fixed=false`) cũng OK.

### 4.4 Đọc `circuitBreakCheckTimespan` (L53-L68)

```java
Long circuitBreakCheckTimeSpan = currencyPairConfig.getCircuitBreakCheckTimespan();
if (circuitBreakCheckTimeSpan == null || circuitBreakCheckTimeSpan < 1) return;

long previousTargetAt = targetAt - DateUnit.MINUTE.getMillis() * circuitBreakCheckTimeSpan;
```

- Đơn vị: **phút** (giá trị số nguyên, gán trực tiếp vào `DateUnit.MINUTE.getMillis() * N`).
- Nếu chưa cấu hình (null) hoặc < 1 → không check (skip).
- `previousTargetAt` = mốc thời gian "N phút trước `targetAt`".

> Comment L62: `DateFormatUtils.format(circuitBreakCheckTimeSpan, ...)`. Lưu ý dùng giá trị `N` (ms trong epoch) chuyển thành date — nhưng về mặt ngữ nghĩa log này chỉ để debug, không ảnh hưởng logic. `N` thực tế là số phút chứ không phải epoch, nên log ra giá trị ngày "1970-01-01 00:0N:00" — khá khó đọc nhưng đúng giá trị pass vào.

### 4.5 Lấy candlestick cũ nhất của cửa sổ N phút (L70-L85)

```java
Candlestick previousCandlestick =
    CandlestickService.getBean(symbol)
        .findOneByCondition(symbol.getId(), CandlestickType.PT1M, previousTargetAt, null, true);

if (previousCandlestick == null) return;
if (previousCandlestick.getOpen().compareTo(BigDecimal.ZERO) == 0) return;
```

- `dateFrom = previousTargetAt`, `dateTo = null`, `isAscending = true` → sort ASC, lấy **candlestick xưa nhất** (gần `previousTargetAt` về phía sau). Đây chính là neo "giá x phút trước".
- Nếu `open == 0` → skip để tránh chia 0 (mẫu số trong tính rate).

**Ý nghĩa business** (comment L122): nếu x phút trước không có giao dịch, `open` của candlestick đó được "kế thừa" từ giá khớp cuối cùng trước đó (logic ở `CandlestickService.updateByPrevious` — khi không có trade trong phút, lấy `previous.close` gán vào 4 giá O/H/L/C và set volume=0). Do đó neo vẫn có giá trị đúng "giá cuối cùng ≤ N phút trước".

### 4.6 Tính `diffRate` (L88-L102)

```java
BigDecimal diffRate = CalculatorUtil.divide(
    latestCandlestick.getOpen()
                     .subtract(previousCandlestick.getOpen())
                     .abs(),
    previousCandlestick.getOpen());
```

- `CalculatorUtil.divide(a, b)` → `a.divide(b, 20, HALF_UP)` — scale 20 số sau dấu phẩy (xem `CalculatorUtil.java:10-12`).
- Công thức: `|openNow − openPrev| / openPrev`.

Với alert ADA_JPY: `diffRate ≈ 0.5128` = biến động tuyệt đối ~51.28% so với giá mở cửa N phút trước.

### 4.7 So với `circuitBreakPercent` (L104-L117)

```java
BigDecimal circuitBreakPercent = currencyPairConfig.getCircuitBreakPercent();
if (circuitBreakPercent == null || circuitBreakPercent.signum() < 1) return;

if (diffRate.compareTo(CalculatorUtil.calculatePercentage(circuitBreakPercent)) > 0) {
    // trigger
}
```

- `circuitBreakPercent` lưu dưới dạng **phần trăm nguyên** (ví dụ `50` = 50%).
- `CalculatorUtil.calculatePercentage(50)` = `50 / 100` = `0.5` (xem `CalculatorUtil.java:33-35`).
- Điều kiện trigger là **strict greater-than** (`>`), không phải `>=`.

### 4.8 Persist state & log (L126-L149)

```java
currencyPairConfig.setCircuitBreakUpdatedAt(date);
currencyPairConfigService.save(currencyPairConfig);

log.info(getClass().getName(),
    "Circuit Breaker symbol: " + JsonUtil.encode(symbol)
    + ", circuitBreakCheckTimeSpan: " + ...
    + ", latestCandlestick: " + ...
    + ", previousCandlestick: " + ...
    + ", diffRate: " + ...
    + ", cirCuitBreakPercent/100: " + ...
    + ", circuitBreakStopTimespan: " + ...
    + ", circuitBreakUpdatedAt: " + ...);
```

- `save(...)` gọi `CurrencyPairConfigService.save` (L185-L189) → update DB + **delete Redis cache** (`redisTemplate.delete(getCacheKey(...))`) để các API call tiếp theo phải đọc lại giá trị mới nhất.
- Log pattern bắt đầu bằng `"Circuit Breaker symbol: "` — **đây chính là dòng log được CloudWatch metric filter phía infra pick up**. Metric filter này sinh SNS alert → Slack.

### 4.9 Flow kết thúc (L152)

Log `==========不適正取引検知(tms)/CircuitBreaker end==========`.

Không có exception handling đặc biệt — bất kỳ exception nào sẽ được `Worker.work(...)` (super) catch ở level `Worker.java:45-66` và log ra ERROR (kèm truncate message > 16k).

---

## 5. Các thành phần phụ trợ

### 5.1 `CandlestickType.PT1M`

File: `bs-integration-server/point-common/src/main/java/point/common/constant/CandlestickType.java`.

Enum đa mục đích biểu diễn **loại đồ thị nến** (OHLC). Tên `PT1M`, `PT5M`, `PT1H`, `P1D`, `P1W`, `P1M` theo chuẩn ISO-8601 duration (PnM = Period n Minutes, PnH = Period n Hours, PnD/PnW/PnM = Period n Days/Weeks/Months). "PT" prefix mang ý `Period Time` (dành cho đơn vị con Ngày: phút/giờ), còn "P" prefix cho đơn vị ≥ Ngày.

- `PT1M`: unit=1 phút, elementType=null (là đơn vị nhỏ nhất), dateUnit=MINUTE.
- `getTargetAt(date)` = `DateUnit.MINUTE.truncate(date.getTime())` = cắt về :00.000 của phút.

### 5.2 `CandlestickService.getBean(symbol)` — polymorphism

File: `bs-integration-server/point-common/src/main/java/point/common/service/CandlestickService.java`.

```java
public static <E extends Candlestick, P extends CandlestickPredicate<E>>
        CandlestickService<E, P> getBean(Symbol symbol) {
    return (CandlestickService<E, P>)
        APPLICATION_CONTEXT.getBean(
            symbol.getTradeType().toLowerCamelCase()
                + "Candlestick"
                + symbol.getCurrencyPair().toUpperCamelCase()
                + "Service");
}
```

Lookup bean theo pattern tên Spring: `<tradeType><CandlestickType><CurrencyPair>Service`. Ví dụ với SPOT/ADA_JPY → bean name `spotCandlestickAdaJpyService` (tức 1 service riêng cho mỗi cặp tiền × tradeType). Phương pháp này cho phép mỗi cặp tiền có 1 bảng candlestick riêng: `<tradeType>_candlestick_<currencyPair>` (xem `Candlestick.getTableName()` L22-L26). Đây là pattern **sharding theo bảng trong cùng schema** — tránh bảng quá lớn, tăng index locality.

### 5.3 `findOneByCondition(..., isAscending)`

File: `CandlestickService.java:229-266` (base class).

Signature:
```java
public E findOneByCondition(
    Long symbolId,
    CandlestickType candlestickType,
    Long dateFrom,
    Long dateTo,
    boolean isAscending)
```

- `dateFrom` / `dateTo`: khoảng thời gian (epoch ms) để filter `target_at`.
  - `dateFrom != null` → `target_at >= dateFrom`.
  - `dateTo != null` → `target_at < dateTo`.
- `isAscending=true` → `ORDER BY target_at ASC` → lấy **cây nến xưa nhất** trong cửa sổ.
- `isAscending=false` → `ORDER BY target_at DESC` → lấy **cây nến mới nhất**.
- Trả về `TOP 1` (single result).

Dùng trong CircuitBreaker:
- **latest**: `(dateFrom=now-phút, dateTo=null, isAscending=false)` → cây nến của phút hiện tại (chưa fixed) hoặc phút vừa chốt.
- **previous**: `(dateFrom=now-phút-Nphút, dateTo=null, isAscending=true)` → cây nến xưa nhất kể từ "N phút trước" trở về phía tương lai. Nếu không có giao dịch chính xác tại phút (now-N), sẽ lấy phút gần đó trước → open của phút đó kế thừa close của trade cuối cùng trước đó.

`PosCandlestickService` override `findOneByCondition` tại `PosCandlestickService.java:338-382` với tham số thêm `boolean isEnable` — nhưng CircuitBreaker không gọi nhánh đó; nó dùng overload `findOneByCondition(..., isAscending)` 5-tham số (L384-L421).

### 5.4 `CalculatorUtil.divide` & `calculatePercentage`

File: `bs-integration-server/point-common/src/main/java/point/common/util/CalculatorUtil.java`.

```java
public static BigDecimal divide(BigDecimal numerator, BigDecimal denominator) {
    return numerator.divide(denominator, 20, RoundingMode.HALF_UP);
}

public static BigDecimal calculatePercentage(BigDecimal percent) {
    return divide(percent, HUNDRED);   // HUNDRED = BigDecimal.valueOf(100)
}
```

- `divide` — chính xác 20 số sau dấu phẩy, HALF_UP (làm tròn 0.5 → 1).
- `calculatePercentage(50)` = 50 / 100 = 0.5 (với 20 chữ số thập phân: `0.50000000000000000000`).

Giá trị 20-digit là đồng bộ với `precision=34, scale=20` của các cột `decimal` trong `currency_pair_config` (xem §6).

### 5.5 `Candlestick` entity — open/high/low/close/volume/fixed

File: `bs-integration-server/point-common/src/main/java/point/common/entity/Candlestick.java`.

Abstract (MappedSuperclass), các subclass cụ thể là `SpotCandlestickAdaJpy`, `PosCandlestickBtcJpy` v.v. (tự sinh từ bean-factory pattern).

Các cột chính:
- `symbol_id`, `candlestick_type` (enum), `target_at` (timestamp(3))
- `open`, `high`, `low`, `close` — `decimal(34,20)`
- `volume` — `decimal(34,20)`
- `fixed` — `bit` (đã đóng nến hay chưa)

Khi `fixed=false` (nến đang generate), `volume` có thể tiếp tục cập nhật. Khi không có giao dịch trong phút, `CandlestickService.updateByPrevious(candlestick, previous)` (L387-L398) gán open=high=low=close = previous.close, volume=0 — giải thích comment L122 của `CircuitBreaker.java`:

> x分前に約定がない場合は、該当の最古の1分足価格はそれ以前の最後に約定した価格を引き継ぐため、x分前より前の最後に約定した価格を基準に検知

> Dịch: "Nếu không có khớp lệnh tại mốc x phút trước, giá candlestick cổ nhất kế thừa giá đã khớp gần nhất trước đó — do vậy detection dùng mức giá khớp cuối cùng trước `x phút` làm mốc."

---

## 6. Persist state — `currency_pair_config`

DDL gốc: `bs-integration-server/docker/flyway-mysql/sql/V1.0.1__create_point_ddl_.sql:275-295`.

Entity: `bs-integration-server/point-common/src/main/java/point/common/entity/CurrencyPairConfig.java`.

### 6.1 Các cột liên quan CircuitBreaker

| Column (DB)                    | Field Java                    | Type             | Null? | Ý nghĩa                                                                                |
|--------------------------------|-------------------------------|------------------|-------|----------------------------------------------------------------------------------------|
| `circuit_break_updated_at`     | `circuitBreakUpdatedAt`       | `TIMESTAMP(3)`   | Yes   | Thời điểm gần nhất CircuitBreaker được **kích hoạt** (ghi bởi `CircuitBreaker.execute`) |
| `circuit_break_percent`        | `circuitBreakPercent`         | `decimal(34,20)` | Yes   | Ngưỡng % biến động để trigger (lưu dạng phần trăm; `calculatePercentage` chia 100)     |
| `circuit_break_check_timespan` | `circuitBreakCheckTimespan`   | `bigint`         | Yes   | Cửa sổ "N phút" để so sánh giá open mới ↔ cũ                                           |
| `circuit_break_stop_timespan`  | `circuitBreakStopTimespan`    | `bigint`         | Yes   | Thời lượng (phút) mà sau khi trigger, Order service tiếp tục cấm MARKET/STOP/SIMPLE_MARKET |

Seed config cho ADA_JPY/NIDT_JPY không có trong DML gốc — giá trị cụ thể được nhập bởi **Admin UI** qua endpoint PUT `/admin/v1/currency-pair-config` (xem §6.3).

### 6.2 Lưu ý về đơn vị

- `circuit_break_percent`: lưu **phần trăm nguyên**. Ví dụ 50 nghĩa là 50%. Code luôn gọi `CalculatorUtil.calculatePercentage(circuitBreakPercent)` = `/100` khi so sánh với `diffRate`.
- `circuit_break_check_timespan` và `circuit_break_stop_timespan`: đơn vị **phút**. Code nhân với `DateUnit.MINUTE.getMillis()` khi dùng.
  - `CircuitBreaker.java:64` — `previousTargetAt = targetAt - MINUTE * checkTimespan`.
  - `SpotOrderService.java:3599` và tương tự — `stopTimespan * MINUTE` so với `now - updatedAt`.

### 6.3 Ai cập nhật các field này?

**Cấu hình (percent/checkTimespan/stopTimespan)**: `point-admin` — `V1CurrencyPairConfigRestController.java:54-100`. Endpoint PUT `/admin/v1/currency-pair-config` với `CurrencyPairConfigUpdateForm`:

```java
@Getter @Setter @Min(0) private BigDecimal circuitBreakPercent;
@Getter @Setter @Min(0) private Long circuitBreakCheckTimespan;
@Getter @Setter @Min(0) private Long circuitBreakStopTimespan;
```

(Xem `CurrencyPairConfigUpdateForm.java:34-38`.)

Validation: `@Min(0)` — không âm; không có `@NotNull` → có thể để null (không check / tắt).

Spring Security: `@PreAuthorize("@auth.check('currency-pair-config')")` — yêu cầu quyền admin.

**Runtime state `circuit_break_updated_at`**: chỉ được ghi bởi `CircuitBreaker.execute` (L129-L130 của worker class). Không có endpoint reset cụ thể — nếu cần "tắt sớm CircuitBreaker" trước khi hết `stopTimespan`, admin phải update trực tiếp field này về null/quá khứ qua DB tool, hoặc update `circuitBreakStopTimespan` về 0.

### 6.4 Cache Redis

`CurrencyPairConfigService.saveCache` viết vào Redis key `currencyPairConfig:<tradeType>:<currencyPair>` (L170-L176). `save(...)` **delete** key này (L185-L189) — lần đọc kế tiếp sẽ reload từ Aurora. Tuy nhiên:

- `CircuitBreaker.execute` dùng `findByCondition(tradeType, currencyPair)` (L37-L39) → **không** đi qua cache, query trực tiếp DB.
- `isCircuitBreaking` (trong OrderServices) dùng `findByCondition(tradeType, currencyPair)` y hệt — cũng **không** đi qua cache.

→ Khi CircuitBreaker trigger, state mới (`circuitBreakUpdatedAt`) lan tức thì tới tất cả OrderService instance **trong round-trip Aurora kế tiếp**, không có race condition theo cache. Tuy nhiên điều này cũng nghĩa là mỗi lần order được gửi thì có 1 SELECT vào `currency_pair_config` — với TPS cao có thể đáng quan tâm (nhưng nằm ngoài scope file này).

---

## 7. Downstream effect — chặn order

Ba method `isCircuitBreaking(Symbol)` giống nhau hoàn toàn về logic, khác nhau chỉ ở class:

| Class                                                  | File:Line           | Gọi ở đâu                                              |
|--------------------------------------------------------|---------------------|--------------------------------------------------------|
| `point.spot.service.SpotOrderService`                  | `:3586-3600`        | `SpotOrderService.order(...)` L3549-L3582              |
| `point.pos.service.PosOrderService`                    | `:2205-2224`        | `PosOrderService.market...` (L126-L130 entry)          |
| `point.pos.service.PointPosOrderService`               | `:2355-2374`        | `PointPosOrderService.market...` (L132-L136 entry)     |

### 7.1 Logic `isCircuitBreaking`

```java
public boolean isCircuitBreaking(Symbol symbol) {
    Long nowLong = new Date().getTime();
    CurrencyPairConfig config =
        currencyPairConfigService.findByCondition(
            symbol.getTradeType(), symbol.getCurrencyPair());
    if (config == null
        || config.getCircuitBreakUpdatedAt() == null
        || config.getCircuitBreakStopTimespan() == null) {
        return false;
    }
    return (nowLong - config.getCircuitBreakUpdatedAt().getTime())
         < config.getCircuitBreakStopTimespan() * DateUnit.MINUTE.getMillis();
}
```

Điều kiện:
- Config tồn tại,
- `circuitBreakUpdatedAt` không null (đã từng trigger),
- `circuitBreakStopTimespan` không null (có cấu hình),
- **và** thời gian trôi qua kể từ lần trigger < `stopTimespan` phút.

Tức là khóa **sliding window** với anchor là `updatedAt`, window size = `stopTimespan` phút. Nếu `CircuitBreaker.execute` lại trigger trong cửa sổ, `updatedAt` được reset → window được **gia hạn**.

### 7.2 Check ở bước order

**Spot** (`SpotOrderService.java:3549-3582`):

```java
public E order(Symbol symbol, User user, SpotOrderForm form, OrderChannel orderChannel)
        throws Exception {
    // サーキットブレーカー検知
    if (OrderType.valueOf(form.getOrderType()) == OrderType.MARKET
            || OrderType.valueOf(form.getOrderType()) == OrderType.STOP
            || OrderType.valueOf(form.getOrderType()) == OrderType.SIMPLE_MARKET) {
        if (isCircuitBreaking(symbol)) {
            throw new CustomException(ErrorCode.ORDER_ERROR_CIRCUIT_BREAKER);
        }
    }
    // ... switch-case OrderType: MARKET, LIMIT, STOP
}
```

**Pos** (`PosOrderService.java:124-136` — entry method):

```java
// サーキットブレーカー検知
if (OrderType.valueOf(form.getOrderType()) == OrderType.MARKET) {
    if (isCircuitBreaking(symbol)) {
        throw new CustomException(ErrorCode.ORDER_ERROR_CIRCUIT_BREAKER);
    }
}
PosOrder posOrder = this.marketOrder(symbol, user, form, orderChannel);
```

**PointPos** (`PointPosOrderService.java:130-136`) — y hệt pos, chỉ chặn MARKET.

### 7.3 Vì sao Spot chặn 3 type mà Pos chỉ chặn MARKET?

- **Spot** có 3 loại order được chặn: `MARKET`, `STOP`, `SIMPLE_MARKET`.
  - `MARKET`: lệnh giá thị trường, khớp ngay — risk cao nếu giá biến động.
  - `STOP`: lệnh stop-loss/stop-buy, khi kích hoạt sẽ biến thành MARKET (thực chất là MARKET có điều kiện) → cũng cần chặn.
  - `SIMPLE_MARKET`: loại "販売所" (sàn giao dịch đơn giản, mua/bán trực tiếp với nhà cái theo spread cố định) — vì trải spread sẵn dựa trên giá hiện tại, CircuitBreaker cần chặn để không bán mất giá cho user.

- **Pos / PointPos**: mô hình Position trading (OTC, cover order). Trong mô hình này chỉ có MARKET order từ phía user (cover/aggregate orders đi ra venue ngoài được xử lý riêng biệt). Do đó chỉ cần chặn `MARKET`.

### 7.4 Comment-out tại `SpotTradeService`

`SpotTradeService.java:2304-2315`:

```java
// --- (start) 逆指値利用無しのためコメントアウト ---

// サーキットブレーカー発動時は処理終了(逆指値処理スキップ)
// if (SpotOrderService.getBean(symbol).isCircuitBreaking(symbol)) {
// log.warn("ordertradelog,symbolId," + symbol.getId() + ",circuit_breaker");
// return;
// } else {
// log.info("ordertradelog,symbolId," + symbol.getId() + ",trade_stop_order_loop_start");
// }
```

- `逆指値` = stop order (lệnh chờ).
- Comment chính thức nói: "Do **không dùng stop order**, nên comment out" — đây là nhánh xử lý loop stop-order khi trade khớp; vì sản phẩm verup/BB hiện không cung cấp stop order cho user cuối (hoặc tắt feature flag), nên nhánh này bị disable. Logic check CircuitBreaker tại `SpotOrderService.order` đã đủ chặn ở input-side.

### 7.5 ErrorCode

File: `point-common/src/main/java/point/common/constant/ErrorCode.java:225`.

```java
ORDER_ERROR_CIRCUIT_BREAKER(50031),
```

Không tìm thấy resource bundle (`*.properties`) nào trong `bs-integration-server` định nghĩa message cho code 50031. Message tiếng Nhật cho user cuối được render ở **phía client** (theo comment đầu file ErrorCode: "clientのServerErrorCodeとServerErrorMessageの編集も行う"). Trong repo `bs-integration-server` không có file translation; nó nằm ở repo client/frontend (không phải scope nghiên cứu này).

---

## 8. Map bảng: field DB → behavior code → hiệu ứng business

| Field DB                         | Code sử dụng                                                      | Điều kiện                                                     | Hiệu ứng business                                                                                                               |
|----------------------------------|-------------------------------------------------------------------|---------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| `circuit_break_check_timespan`   | `CircuitBreaker.java:53-64`                                       | null hoặc < 1 → skip worker                                   | Cửa sổ detect N phút: so sánh `open(now)` vs `open(now - N min)`. Nhỏ → nhạy (phát hiện spike ngắn), lớn → nhìn xu hướng dài.  |
| `circuit_break_percent`          | `CircuitBreaker.java:104-117`                                     | null hoặc ≤ 0 → skip                                           | Ngưỡng biến động tuyệt đối để trigger. Với alert STG: 50 (%) → trigger khi \|Δ\|/prev > 0.5.                                   |
| `circuit_break_updated_at`       | `CircuitBreaker.java:129` (write)<br>`*OrderService:isCircuitBreaking` (read) | write: khi detect vượt ngưỡng; read: mỗi lần order             | Timestamp trigger. Không null ⇒ đã trigger; null ⇒ chưa bao giờ (hoặc đã reset thủ công).                                       |
| `circuit_break_stop_timespan`    | `*OrderService:isCircuitBreaking`                                 | null → không chặn order                                        | Độ dài cửa sổ cấm order tính từ `updatedAt`. `stopTimespan=5` → 5 phút sau trigger, các MARKET order bị từ chối.                 |
| `tradable` / `enabled`           | không thuộc CircuitBreaker                                         | —                                                              | Kiểm soát chung có cho giao dịch hay không — độc lập với CircuitBreaker. CircuitBreaker không quan tâm 2 flag này khi chạy detect. |

### 8.1 Ví dụ tính toán cho alert STG (ADA_JPY)

Giả sử:
- `circuitBreakCheckTimespan = 5` (phút)
- `circuitBreakPercent = 50` (%)
- `circuitBreakStopTimespan = 10` (phút) — giá trị giả định, cần xác minh từ DB thực tế.

Tại `2026-04-21 12:34:56`:
- `targetAt = 2026-04-21 12:34:00.000`
- `previousTargetAt = 2026-04-21 12:29:00.000`
- `latestCandlestick.open = X`, `previousCandlestick.open = Y`.
- `diffRate = |X − Y| / Y = 0.5128`.
- `calculatePercentage(50) = 0.5`.
- `0.5128 > 0.5` → **TRIGGER**:
  - `circuit_break_updated_at = 2026-04-21 12:34:56`.
  - Trong 10 phút tiếp theo (đến `12:44:56`), mọi MARKET/STOP/SIMPLE_MARKET order cho ADA_JPY/SPOT sẽ bị reject 50031. LIMIT order vẫn đi qua bình thường.

---

## 9. Vì sao chỉ chặn MARKET/STOP/SIMPLE_MARKET, không chặn LIMIT?

Không có comment trực tiếp trong code giải thích. Suy luận từ bản chất các loại order:

- **MARKET**: user gửi lệnh không kèm giá, khớp ngay với orderbook theo giá hiện tại. Trong flash crash / pump, giá khớp có thể chênh rất lớn so với kỳ vọng → user chịu thiệt / hệ thống ra lệnh quá xa giá fair → risk **không kiểm soát được**.
- **STOP**: lệnh chờ biến động; khi trigger trở thành MARKET → cùng risk với MARKET.
- **SIMPLE_MARKET (販売所)**: sàn giao dịch giản đơn với spread sẵn — biến động lớn khiến spread tham chiếu sai lệch.
- **LIMIT**: user chỉ định **giá cụ thể** muốn khớp. Nếu giá không tới mức đó, lệnh chỉ nằm trong sổ. User **tự chịu trách nhiệm** chọn giá. Giá trị phòng ngừa của CircuitBreaker (bảo vệ user khỏi slippage) không áp dụng với LIMIT. Hơn nữa, chặn LIMIT sẽ chặn khả năng user "chốt lời" / "bắt đáy" trong biến động — một chức năng **có chủ đích**.

Ngoài ra, hệ thống có các guard khác cho LIMIT order:
- `limit_price_range_rate` (`CurrencyPairConfig:51`) — giới hạn giá limit cách bao nhiêu % so với best bid/ask.
- `max_order_amount`, `max_active_order_amount` — giới hạn size.

→ CircuitBreaker là **guard đặc thù cho order khớp tức thời**. Với LIMIT, guard khác phù hợp hơn.

---

## 10. Workers liên quan khác & nền hạ tầng dùng chung

Tham khảo `scheduler.md`:

| Worker                            | Invest | Operate | Tần suất (seed DML) | Ghi chú                                                               |
|-----------------------------------|--------|---------|---------------------|-----------------------------------------------------------------------|
| `CircuitBreaker`                  | ✓      | —       | 1000 ms             | Invest-only (row worker_master chỉ ở env invest)                      |
| `ExchangeSummaryCalculator`       | ✓      | —       | (N/A null = one-shot theo trigger) | Invest-only. Chia sẻ cùng framework SQS/SNS + Worker.              |
| `FinancialAssetsDeviationChecker` | ✓      | —       | null                | Invest-only                                                           |
| `SpoofingChecker`                 | ✓      | ✓       | có                  | cả hai env                                                            |
| `HighValueTraderChecker`          | ✓      | —       | 600000 ms / null    | Invest-only                                                           |

Nền hạ tầng **dùng chung** cho tất cả worker:
- `WorkerDaemon` (single thread pool `ThreadPoolTaskExecutor`) quản lý thread cho mọi subscriber.
- `SqsManager` (1 `AmazonSQS` client, maxConnections=150). Tất cả queue đều tạo on-demand với `VisibilityTimeout=120s`, `MessageRetentionPeriod=60s`, long-polling 20s.
- `SqsCallback` xử lý chung logic route message → `WorkerRunner` / `WorkerMasterRunner`.
- `SnsManager` (1 SNS client) publish cho tất cả worker.
- `Worker.workMain` — Redis lock chung (`RedisManager.LockParams.WORKER`), key format `lock:<method>-<symbolId>`.

→ Nghĩa là: CircuitBreaker **không** có namespace infra riêng; nó cùng chia tài nguyên với các worker khác. Nếu thread pool cạn, worker khác chạy lâu có thể cản CircuitBreaker.

---

## 11. Sơ đồ execution flow (ASCII)

```
                            ┌──────────────────────────────┐
                            │ Application.main(args)        │
                            │ - SubscriberGroup.ALL        │
                            │ - addSqsSubscriber(           │
                            │     CircuitBreakerSqsSubscriber)
                            └──────────────┬───────────────┘
                                           │
                                           ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ CircuitBreakerSqsSubscriber.run()                            │
 │ = SqsSubscriber.run()                                        │
 │   → sqsManager.subscribe("<env>-circuitBreaker", 10)        │
 │   (while-loop, long-polling 20s)                             │
 └──────────────┬──────────────────────────────────────────────┘
                │ message: {method: null, params:{symbolId:4}}
                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ SqsCallback.callback(queueName, body)                        │
 │ - decode MessageBodyData → WorkerForm                        │
 │ - if workerForm.method == null:                              │
 │     for each WorkerMaster("stg", "circuitBreaker", enabled): │
 │       if intervalMillis == null → sns.publish(...) one-shot  │
 │       else → WorkerMasterRunner (re-publish every 1000ms     │
 │              during 60s)                                      │
 │ - else:                                                      │
 │     taskExecutor.execute(new WorkerRunner(CircuitBreaker,   │
 │                                            workerForm))      │
 └──────────────┬──────────────────────────────────────────────┘
                │ sns.publish("<env>-circuitBreaker", {method:"...", params:{symbolId, workerMasterId}})
                │      │
                │      └─► SNS topic → SQS queue → chính vòng while của subscriber
                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Worker.work(workerForm) [base class]                         │
 │ - resolve symbol from workerForm.params.symbolId             │
 │ - workerName = "<method>-<symbolId>"                         │
 │ - Redis lock(workerName), nếu fail → return (không execute)  │
 │ - try: execute(symbol, params)                               │
 │ - finally: unlock + log end(durationMillis)                  │
 └──────────────┬──────────────────────────────────────────────┘
                │
                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ CircuitBreaker.execute(symbol, params)                       │
 │                                                              │
 │  targetAt = truncate(now, MINUTE)                            │
 │  config = currencyPairConfigService.findByCondition(TT, CP)  │
 │  latest = CandlestickService.getBean(symbol)                 │
 │             .findOneByCondition(id, PT1M, targetAt, null,    │
 │                                  false) // DESC              │
 │  if latest == null → return                                  │
 │                                                              │
 │  checkTimespan = config.circuitBreakCheckTimespan  (minutes) │
 │  if checkTimespan null/<1 → return                           │
 │  previousTargetAt = targetAt - checkTimespan*60_000          │
 │  previous = findOneByCondition(id, PT1M, previousTargetAt,   │
 │                                 null, true) // ASC           │
 │  if previous == null → return                                │
 │  if previous.open == 0 → return                              │
 │                                                              │
 │  diffRate = |latest.open - previous.open| / previous.open    │
 │  percent = config.circuitBreakPercent                        │
 │  if percent null/≤0 → return                                 │
 │  threshold = percent / 100                                   │
 │                                                              │
 │  if diffRate > threshold:                                    │
 │    config.circuitBreakUpdatedAt = now()                      │
 │    currencyPairConfigService.save(config)                    │
 │    log.info("Circuit Breaker symbol: ... diffRate: ...")     │
 └─────────────────────────────────────────────────────────────┘
                │
                │ (state ghi vào currency_pair_config)
                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ SpotOrderService / PosOrderService / PointPosOrderService    │
 │ .order(symbol, user, form, channel)                          │
 │                                                              │
 │  if form.orderType in {MARKET, STOP, SIMPLE_MARKET} (Spot)   │
 │  or if form.orderType == MARKET (Pos, PointPos):             │
 │    if isCircuitBreaking(symbol):                             │
 │      throw CustomException(ORDER_ERROR_CIRCUIT_BREAKER 50031)│
 │                                                              │
 │  isCircuitBreaking:                                          │
 │    cfg = currencyPairConfigService.findByCondition(...)      │
 │    if cfg/updatedAt/stopTimespan null → false                │
 │    return (now - updatedAt) < stopTimespan * 60_000          │
 └─────────────────────────────────────────────────────────────┘
```

---

## 12. Câu hỏi mở (Open questions)

Những điểm cần xác minh thêm hoặc chưa có bằng chứng trực tiếp trong code:

1. **Giá trị thực tế `circuit_break_*` của ADA_JPY/SPOT trên STG**
   Seed DML không chứa; phải query DB STG (`currency_pair_config`) để biết `circuitBreakPercent`, `circuitBreakCheckTimespan`, `circuitBreakStopTimespan` chính xác tại thời điểm alert.

2. **Bean `posCandlestickService` được inject nhưng không dùng**
   `CircuitBreaker.java:28` khai báo `private final PosCandlestickService posCandlestickService;` nhưng không tham chiếu trong `execute()`. Có thể là dead-code từ bản trước hoặc dành cho mở rộng Pos CircuitBreaker. Cần hỏi team để xóa hoặc dùng.

3. **Tần suất chính xác**
   Seed DML đặt `intervalMillis=1000` cho cả ADA_JPY và NIDT_JPY trên DEV/STG. Tuy nhiên vì `WorkerMasterRunner` chỉ chạy trong **60 giây** rồi phải chờ message tiếp theo, thực tế khoảng cách giữa các lần execute có thể > 1s nếu queue bị congestion. Cần đo thực tế qua log `start/end durationMillis`.

4. **Seed message đầu tiên từ đâu?**
   `SqsCallback.callback` nhánh `workerForm.method == null` giả định sẽ có seed message với method rỗng. Ai gửi message này? Có thể là:
   - `point-mmh` publish khi boot? (Không thấy code rõ ràng.)
   - Scheduler bên ngoài (CloudWatch Event → Lambda → SNS)?
   - Manual bootstrap?
   Cần tra AWS infra / các script deploy để trả lời dứt khoát.

5. **Có endpoint reset `circuit_break_updated_at` không?**
   Không tìm thấy (`CurrencyPairConfigUpdateForm` chỉ expose 3 field config, không expose `updatedAt`). Nếu admin cần "mở lại giao dịch sớm", phải update DB trực tiếp hoặc chờ `stopTimespan` hết.

6. **Resource bundle message cho 50031**
   Không có trong `bs-integration-server`. Message Nhật ngữ "サーキットブレーカー発動中のため..." (hoặc tương đương) nằm ở repo client (react/native). Tạm chưa xác minh text chính xác.

7. **Polymorphism bean naming: cặp tiền nào có CandlestickService?**
   `CandlestickService.getBean(symbol)` gọi `APPLICATION_CONTEXT.getBean("<type>Candlestick<Pair>Service")`. Nếu worker chạy cho `SPOT/ADA_JPY`, bean tên `spotCandlestickAdaJpyService` phải tồn tại. Cần verify tất cả pair trong `worker_master` đều có bean tương ứng — nếu thiếu, `execute()` sẽ `NoSuchBeanDefinitionException`.

8. **Ảnh hưởng khi `stopTimespan` null nhưng `checkTimespan`/`percent` có giá trị**
   `CircuitBreaker.execute` vẫn trigger và set `updatedAt` (vì code không check `stopTimespan` ở worker). Tuy nhiên `isCircuitBreaking` trả `false` (null check L3593-L3595 Spot). Nghĩa là: **alert sẽ bắn** nhưng **không thực sự chặn order**. Đây có thể là bug hoặc thiết kế có chủ đích ("chỉ cảnh báo, không chặn" mode) — cần xác nhận với stakeholder.

9. **Race condition giữa CircuitBreaker.save() và Order.check()**
   Cả hai đều không dùng Redis cache. Aurora có read-replicas lag. Trong khoảnh khắc [worker save → order check] có thể lag ms cấp, dẫn đến 1-2 order lọt qua. Cần đo thực tế để quyết định có quan trọng hay không.

10. **Alert pipeline phía infra (SNS, Slack) — unknown**
    Metric filter CloudWatch nào bắt log `"Circuit Breaker symbol:"`? SNS topic nào? Cần tra `bs-exchange-infra/terraform/components/*` để bổ sung bức tranh end-to-end.

---

## Phụ lục A — File references

| File                                                                                                                          | Vai trò                                             |
|-------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------|
| `bs-integration-server/point-worker/src/main/java/point/worker/worker/CircuitBreaker.java`                                    | Worker chính, logic detect (§4)                     |
| `bs-integration-server/point-worker/src/main/java/point/worker/sqssubscriber/CircuitBreakerSqsSubscriber.java`                 | Thin adapter — trả về `CircuitBreaker.class`        |
| `bs-integration-server/point-worker/src/main/java/point/worker/component/SqsSubscriber.java`                                   | Base class subscriber, `run()` long-poll SQS        |
| `bs-integration-server/point-worker/src/main/java/point/worker/component/SqsManager.java`                                      | AWS SQS client, `subscribe()` loop                  |
| `bs-integration-server/point-worker/src/main/java/point/worker/component/SqsCallback.java`                                     | Decode message, schedule `WorkerMasterRunner`       |
| `bs-integration-server/point-worker/src/main/java/point/worker/component/Worker.java`                                          | Base class worker, Redis lock, logging              |
| `bs-integration-server/point-worker/src/main/java/point/worker/component/SqsBeanName.java`                                     | Sinh tên queue `<env>-<beanName>`                   |
| `bs-integration-server/point-worker/src/main/java/point/worker/component/WorkerDaemon.java`                                    | `SmartLifecycle` — start/stop subscriber thread    |
| `bs-integration-server/point-worker/src/main/java/point/worker/Application.java`                                               | Main + `SubscriberGroup.ALL`                        |
| `bs-integration-server/point-common/src/main/java/point/common/service/CandlestickService.java`                                | Base candlestick service, `findOneByCondition`     |
| `bs-integration-server/point-common/src/main/java/point/pos/service/PosCandlestickService.java`                                | Overrides cho Pos                                   |
| `bs-integration-server/point-common/src/main/java/point/common/entity/Candlestick.java`                                        | Entity OHLC                                         |
| `bs-integration-server/point-common/src/main/java/point/common/constant/CandlestickType.java`                                  | Enum PT1M/…/P1M                                     |
| `bs-integration-server/point-common/src/main/java/point/common/entity/CurrencyPairConfig.java`                                 | Entity cấu hình (§6)                                |
| `bs-integration-server/point-common/src/main/java/point/common/service/CurrencyPairConfigService.java`                          | `findByCondition`, `save` (delete cache)            |
| `bs-integration-server/point-common/src/main/java/point/common/model/request/CurrencyPairConfigUpdateForm.java`                 | Form admin update                                   |
| `bs-integration-server/point-admin/src/main/java/point/admin/controller/V1CurrencyPairConfigRestController.java`                | Admin REST endpoint PUT `/admin/v1/currency-pair-config` |
| `bs-integration-server/point-common/src/main/java/point/common/util/CalculatorUtil.java`                                       | `divide`, `calculatePercentage`                     |
| `bs-integration-server/point-common/src/main/java/point/common/util/DateUnit.java`                                             | MINUTE/HOUR/DAY ms, `truncate`                      |
| `bs-integration-server/point-common/src/main/java/point/common/entity/WorkerMaster.java`                                       | Entity điều khiển tần suất chạy worker              |
| `bs-integration-server/point-common/src/main/java/point/spot/service/SpotOrderService.java`                                    | `isCircuitBreaking` + check ở `order()` (Spot)      |
| `bs-integration-server/point-common/src/main/java/point/pos/service/PosOrderService.java`                                      | `isCircuitBreaking` (Pos)                           |
| `bs-integration-server/point-common/src/main/java/point/pos/service/PointPosOrderService.java`                                 | `isCircuitBreaking` (PointPos)                      |
| `bs-integration-server/point-common/src/main/java/point/spot/service/SpotTradeService.java`                                    | Comment-out nhánh stop-order (L2304-L2315)          |
| `bs-integration-server/point-common/src/main/java/point/common/constant/ErrorCode.java`                                        | `ORDER_ERROR_CIRCUIT_BREAKER(50031)`                |
| `bs-integration-server/docker/flyway-mysql/sql/V1.0.1__create_point_ddl_.sql` (L275-L295)                                      | DDL `currency_pair_config`                          |
| `bs-integration-server/docker/flyway-mysql/sql/V1.0.2__insert_point_dml.sql` (L200-L201)                                       | Seed `worker_master` cho circuitBreaker (STG)       |
| `bs-integration-server/docker/flyway-mysql/sql/V4.3.3_worker_master_統合.sql` (L21-L22)                                        | Seed `worker_master` cho DEV                        |
| `bs-integration-server/scheduler.md`                                                                                           | Bảng liệt kê Worker / Invest / Operate              |

---

## Phụ lục B — Checklist verify khi muốn reproduce trên DEV

1. `SELECT * FROM currency_pair_config WHERE trade_type='SPOT' AND currency_pair='ADA_JPY';` — lấy giá trị `circuit_break_*` hiện tại.
2. `SELECT * FROM worker_master WHERE bean_name='circuitBreaker' AND enabled=true;` — xác nhận env/cặp tiền đang bật.
3. Gọi admin API `PUT /admin/v1/currency-pair-config` với `circuitBreakPercent` rất thấp (ví dụ 0.01) để force trigger trong biến động bình thường.
4. Kiểm tra CloudWatch log group của point-worker → filter theo message `"Circuit Breaker symbol:"` → xem payload JSON đầy đủ.
5. Thử gửi MARKET order qua API client → xác nhận trả về code 50031.
6. Thử gửi LIMIT order → phải PASS (không bị chặn).
7. Chờ hết `stopTimespan` phút, MARKET order phải hoạt động trở lại.

— End of research note —
