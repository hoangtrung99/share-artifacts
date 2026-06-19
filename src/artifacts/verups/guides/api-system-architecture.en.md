# API System Architecture — bs-integration-server (verup)

> **Scope**: `bs-integration-server` (verup — merged Exchange + Point services), `cb-exchange-server` (coinbook exchange origin), `bs-point-server` (legacy Point-only server).  
> **Related repos**: `bs-exchange-infra` (infra/k8s), `bs-point-infra`, `coinbook/infra`.  
> **Last reviewed**: 2026-05-13

---

## Table of Contents

1. [Overview](#1-overview)
2. [Two Services, One Deployment](#2-two-services-one-deployment)
3. [point-api — Public Trading API](#3-point-api--public-trading-api)
   - [3.1 Evolution from bs-point-server](#31-evolution-from-bs-point-server)
   - [3.2 Endpoint Catalogue](#32-endpoint-catalogue)
   - [3.3 HMAC Authentication Protocol](#33-hmac-authentication-protocol)
   - [3.4 ApiInfo Permission Model](#34-apiinfo-permission-model)
   - [3.5 Rate Limiting](#35-rate-limiting)
4. [point-app — BFF (Browser-Facing API)](#4-point-app--bff-browser-facing-api)
   - [4.1 Evolution from exchange-app](#41-evolution-from-exchange-app)
   - [4.2 Path Namespaces](#42-path-namespaces)
   - [4.3 Authentication Chains](#43-authentication-chains)
   - [4.4 Exchange Domain Endpoints](#44-exchange-domain-endpoints)
   - [4.5 Invest / Point Domain Endpoints](#45-invest--point-domain-endpoints)
   - [4.6 Game Domain Endpoints](#46-game-domain-endpoints)
   - [4.7 Operate Domain Endpoints](#47-operate-domain-endpoints)
   - [4.8 Frontend Consumer Classification](#48-frontend-consumer-classification)
5. [Maintenance Mode and /api/*](#5-maintenance-mode-and-api)
6. [Cross-Cutting Notes](#6-cross-cutting-notes)
7. [API Evolution: Three Generations](#7-api-evolution-three-generations)
   - [7.1 Gen 0 — cb-exchange-server (Coinbook Exchange)](#71-gen-0--cb-exchange-server-coinbook-exchange)
   - [7.2 Gen 1 — bs-point-server (Point Only)](#72-gen-1--bs-point-server-point-only)
   - [7.3 Three-Generation Comparison](#73-three-generation-comparison)
   - [7.4 Key Structural Changes at Each Generation](#74-key-structural-changes-at-each-generation)

---

## 1. Overview

`bs-integration-server` is a multi-module Gradle project that was originally forked from
`cb-server` (the Coinbook exchange backend) and had all `exchange.*` packages renamed to `point.*`
via `rename_exchange_to_point.py`. It consolidates two formerly separate systems:

| Former system | What it served | Now lives in |
|---|---|---|
| Coinbook exchange API (`exchange-api`) | Public REST API for trader bots, market data, exchange trading | `point-api` module |
| Point server API (`bs-point-server/point-api`) | Minimal asset API + webhooks for Point product | `point-api` module (merged) |
| Both products' browser-facing APIs | SPA frontends for Exchange UI, Point/Invest UI, Game | `point-app` module |

The result is **one deployable JAR per module**, but the two key modules serve entirely different
audiences:

```
                   Internet
                      │
         ┌────────────┴────────────┐
         ▼                         ▼
   CloudFront CDN             (direct)
         │
   WAF WebACL (point-cloudfront-customer)
         │
   ALB → EKS Ingress
         │
    ┌────┴─────────────────────────┐
    │  path-based routing          │
    ├─────────────────────────────┤
    │ /api/*  → point-api-svc:8080 │  ← Public REST API (HMAC auth)
    │ /app/*  → point-app-svc:8080 │  ← Browser BFF (JWT auth)
    │ /admin/*→ point-admin-svc    │
    └─────────────────────────────┘
```

---

## 2. Two Services, One Deployment

| Attribute | `point-api` | `point-app` |
|---|---|---|
| **Deployment** | `point-api-deployment` | `point-app-deployment` |
| **K8s Service** | `point-api-service:8080` | `point-app-service:8080` |
| **Ingress path** | `/api` (Prefix) | `/app`, `/websocket` |
| **Audience** | External clients: trader bots, partner systems (GMO, BPO, Ponta) | SPA web browsers (Exchange UI, Invest/Point UI, Game UI) |
| **Auth model** | HMAC-SHA256 (API-KEY + NONCE + SIGNATURE headers) | JWT tokens (stateless, Redis-cached) |
| **Spring Security** | `anyRequest().permitAll()` + custom filter chain | Full multi-chain Spring Security |
| **Session state** | Stateless (nonce tracked in Redis) | Stateless JWT (tokens cached in Redis) |

---

## 3. point-api — Public Trading API

### 3.1 Evolution from bs-point-server

`bs-point-server/point-api` was the original Point-only API. When merged into
`bs-integration-server`, the exchange trading endpoints were ported in alongside the existing
Point endpoints. The table below shows what changed:

| Endpoint | bs-point-server | bs-integration-server | Added in merge |
|---|:---:|:---:|:---:|
| `GET /api/v1/asset` | ✓ | ✓ | — |
| `POST /api/v1/bpo-callback` | ✓ | ✓ | — |
| `POST /api/v1/gmo-callback` | ✓ | ✓ | — |
| `GET /api/v1/candlestick` | — | ✓ | ✓ Exchange |
| `GET /api/v1/orderbook` | — | ✓ | ✓ Exchange |
| `GET /api/v1/symbol` | — | ✓ | ✓ Exchange |
| `GET /api/v1/ticker` | — | ✓ | ✓ Exchange |
| `GET /api/v1/trades` | — | ✓ | ✓ Exchange |
| `GET/POST/DELETE /api/v1/spot/order` | — | ✓ | ✓ Exchange |
| `GET /api/v1/spot/trade` | — | ✓ | ✓ Exchange |
| `POST /api/v1/transactions-callback` | — | ✓ | ✓ Exchange |

**Key changes to `HandlerInterceptorImpl`:**

1. **`bs-point-server`** `UNAUTHORIZED_URIS` = `["/favicon.ico", "/healthcheck"]` only.  
   No permission gates on `/api/v1/asset`.

2. **`bs-integration-server`** `UNAUTHORIZED_URIS` expanded to include all public market data:
   ```java
   Arrays.asList(
       "/favicon.ico", "/healthcheck",
       "/candlestick", "/orderbook", "/symbol", "/ticker", "/trades",
       // "/transactions-callback",   // NOTE: currently commented out — effectively authenticated
       "/gmo-callback", "/bpo-callback"
   )
   ```
   Added full HMAC validation, Redis-backed nonce tracking, and per-endpoint permission gates.

### 3.2 Endpoint Catalogue

#### Public — no authentication required

| Endpoint | Method | Description |
|---|---|---|
| `/api/v1/candlestick` | GET | OHLCV candle data (chart) |
| `/api/v1/orderbook` | GET | Live order book |
| `/api/v1/symbol` | GET | Available trading pairs |
| `/api/v1/ticker` | GET | Market price summary |
| `/api/v1/trades` | GET | Recent public trades |
| `/api/v1/gmo-callback` | POST | Webhook: GMO Aozora Net Bank deposit event |
| `/api/v1/bpo-callback` | POST | Webhook: BPO eKYC result |
| `/api/healthcheck` | GET | Health probe |

#### Authenticated — requires API-KEY + NONCE + SIGNATURE

| Endpoint | Method | Required permission | Description |
|---|---|---|---|
| `/api/v1/asset` | GET | `canGetAssetInfo` | User wallet balances |
| `/api/v1/spot/order` | GET | `canGetOrderInfo` | Query open / historical orders |
| `/api/v1/spot/order` | GET `/active` | `canGetOrderInfo` | List active orders |
| `/api/v1/spot/order` | GET `/history` | `canGetOrderInfo` | Order history |
| `/api/v1/spot/order` | POST | `canCreateNewOrder` | Place a new spot order |
| `/api/v1/spot/order` | POST `/multi` | `canCreateNewOrder` | Place multiple orders (bulk) |
| `/api/v1/spot/order` | DELETE | `canDeleteOrder` | Cancel an order |
| `/api/v1/spot/trade` | GET | `canGetTradeInfo` | Matched trade history |
| `/api/v1/transactions-callback` | POST | *(auth required — see note)* | Webhook: transaction details |

> **Note on `/api/v1/transactions-callback`**: The URI is commented out of `UNAUTHORIZED_URIS`
> (line 46 `HandlerInterceptorImpl.java`), so it passes through HMAC validation. Callers must
> supply a valid API-KEY. This differs from `/gmo-callback` and `/bpo-callback` which are public.

### 3.3 HMAC Authentication Protocol

Implemented in:
- `PreControllerFilter.java` — captures the **seed** (raw payload for signing)
- `HandlerInterceptorImpl.java` — validates headers, resolves `User` and `ApiInfo` into request attributes

**Three required headers:**

| Header | Content |
|---|---|
| `API-KEY` | Public identifier (looked up in `api_info` table via `ApiInfoService`) |
| `NONCE` | Monotonic integer (Unix timestamp in milliseconds). Must be strictly greater than the previous nonce stored in Redis for the same API key, and the difference must be ≥ 60 seconds (unless `apiInfo.isUnlimited()`). |
| `SIGNATURE` | HMAC-SHA256(`secret`, `nonce + seed`) encoded as hex. `secret` is per-API-key, stored in DB. |

**How `seed` is constructed** (`PreControllerFilter.java`):

```
GET / DELETE  →  seed = requestURI + "?" + queryString   (e.g. "/api/v1/orderbook?symbolId=1&size=20")
POST / PUT    →  seed = raw request body JSON string
```

> **Note — official spec example uses `/v1/...` (without `/api` prefix)**:
> The published spec shows `1586345939000/v1/spot/order/65?id=1` as the hash input.
> The actual server uses the full `requestURI` which includes `/api` (e.g. `/api/v1/spot/order/65?id=1`).
> API clients must use the full path including `/api` when computing SIGNATURE.

**Validation flow** (`HandlerInterceptorImpl.authenticate()`):

```
1. URI in UNAUTHORIZED_URIS?  → pass through (no auth needed)
2. Read "API-KEY" header       → look up ApiInfo in DB
3. ApiInfo.enabled == true?    → else 401 INVALID_API_KEY
4. Read "NONCE" header         → must be present
5. Redis get("nonce:{apiKey}") → previousNonce
   └─ if |nonce - previousNonce| < 60  AND !isUnlimited → 429 TOO_MANY_REQUESTS
6. Read "SIGNATURE" header
7. Recompute: HMAC-SHA256(apiInfo.secret, nonce + seed)
   └─ if mismatch → 401 INVALID_SIGNATURE
8. Load User by apiInfo.userId  → User.enabled && User.allowedToLogin
9. Set request attributes: "apiInfo" → ApiInfo, "user" → User
10. Redis set("nonce:{apiKey}", nonce)  ← update last nonce
```

**Signature algorithm** (`PointApiConfig.java`, `SignatureUtil.java`):

```java
// Algorithm.HMAC_SHA256
SignatureUtil.getHash(Algorithm.HMAC_SHA256, secret, nonce + seed)
```

### 3.4 ApiInfo Permission Model

`ApiInfo` entity (`point.common.entity.exchange.ApiInfo`) has 5 independent boolean flags:

| DB column | Java field | Checked in controller |
|---|---|---|
| `can_get_asset_info` | `canGetAssetInfo` | `V1AssetRestController` |
| `can_get_order_info` | `canGetOrderInfo` | `V1SpotOrderRestController` (GET, /active, /history) |
| `can_create_new_order` | `canCreateNewOrder` | `V1SpotOrderRestController` (POST, /multi) |
| `can_delete_order` | `canDeleteOrder` | `V1SpotOrderRestController` (DELETE) |
| `can_get_trade_info` | `canGetTradeInfo` | `V1SpotTradeRestController` (GET) |

All default to `false`. Users manage their API keys via the Exchange BFF endpoint
`POST /app/exchange/v1/api-info` (inside `point-app`).

**`isUnlimited` flag**: skips the 60-second nonce rate limit. Intended for internal / trusted
automation that needs high-frequency access.

### 3.5 Rate Limiting

Rate limiting is nonce-based, stored in Redis:

```
key: "nonce:{apiKey}"
value: last accepted nonce value (Unix timestamp ms string)
TTL: no explicit TTL — value persists indefinitely
```

Rule: consecutive requests from the same API key must have nonce values that differ by at least
`REQUEST_SPAN = 60` (seconds). This effectively limits authenticated endpoints to 1 request per
minute per API key (unless `isUnlimited`).

Public endpoints (in `UNAUTHORIZED_URIS`) bypass this entirely — they are unlimited.

---

## 4. point-app — BFF (Browser-Facing API)

`point-app` is a single Spring Boot service that hosts BFF endpoints for **four domains** under
the `/app/*` prefix. Exchange and Invest/Point have fully separate path namespaces, auth providers,
and JWT token types.

### 4.1 Evolution from exchange-app

The `point-app` BFF evolved through three distinct generations. Unlike `point-api` which
re-merged Exchange endpoints at Gen 2, the BFF also changed its **path architecture** and
**auth model** — not just its endpoint set.

#### Generation comparison

| Feature / Domain | Gen 0 — exchange-app | Gen 1 — bs-point-server | Gen 2 — bs-integration-server |
|---|:---:|:---:|:---:|
| **Path architecture** | Flat `/app/v1/*` | Flat `/app/v1/*` | Dual: `/app/exchange/v1/*` + `/app/v1/*` |
| **Auth chains** | 1 (single JWT) | **3** (AuthFilter + PontaAuth + JwtFilter w/ cross-type guard) | **6** (invest-login, exchange-login, ponta, operateJWT, exchangeJWT, investJWT) |
| **Auth providers** | 1 | 2 (credentials + JWT) | **6** (invest-creds, exchange-creds, JWT, ExchangeJWT, InvestJWT, Ponta) |
| **KYC gate filter** | — | — | ✅ ExchangeKycStatusFilter |
| Exchange trading (`/spot/order`, `/spot/trade`) | ✅ `/app/v1/` | ❌ removed | ✅ `/app/exchange/v1/` |
| Exchange account mgmt (`/deposit`, `/withdrawal`, `/bank-account`) | ✅ `/app/v1/` | ❌ removed | ✅ `/app/exchange/v1/` |
| Exchange transfers (`/transfer`, `/vasp`, `/withdrawal-account`) | ✅ `/app/v1/` | ❌ removed | ✅ `/app/exchange/v1/` |
| API key management (`/api-info`) | ✅ `/app/v1/api-info` | ❌ removed | ✅ `/app/exchange/v1/api-info` |
| IEO (`/ieo-apply`, `/ieo-details`) | ✅ `/app/v1/` | ❌ removed | ✅ `/app/exchange/v1/` |
| **Staking** (`/staking`) | ✅ `/app/v1/staking` | ❌ removed | ❌ **permanently dropped** |
| Invest domain (`/invest/**`) | ❌ | ✅ `/app/v1/invest/**` | ✅ `/app/v1/invest/**` |
| **Game domain** (`/game/**`) | ❌ | ✅ `/app/v1/game/**` | ✅ `/app/v1/game/**` |
| **Operate domain** (`/operate/**`) | ❌ | ✅ `/app/v1/operate/**` | ✅ `/app/v1/operate/**` |
| Ponta OAuth (`/operate/user/ponta-login`) | ❌ | ✅ | ✅ |
| Ponta callback (`/ponta-callback`) | ❌ | ✅ `/app/v1/ponta-callback` | ✅ `/app/v1/ponta-callback` |
| GMO OAuth in BFF (`/gmo/oauth`) | ✅ `/app/v1/gmo/oauth` | ✅ `/app/v1/gmo/oauth` | ✅ still exists — **different from** `/api/v1/gmo-callback` |
| Cross-domain POS via Exchange JWT | ❌ | ❌ | ✅ `/app/exchange/v1/point/pos/*` |

> **Key observation**: Game and Operate domains were introduced in **Gen 1** (bs-point-server),
> not Gen 2. The Point product was already a full platform (with game, operate, ponta) before
> the Exchange system was re-merged.

#### Gen 0 → Gen 1: Point replaces Exchange in the BFF

| What changed | Detail |
|---|---|
| All exchange trading/account controllers removed | `/spot/order`, `/spot/trade`, `/deposit`, `/withdrawal`, `/withdrawal-account`, `/transfer`, `/transfer-account`, `/transfername`, `/vasp` — all gone from BFF |
| Exchange-only features dropped permanently | `/staking`, `/deposit-account` |
| IEO/crypto-token features removed | `/ieo-apply`, `/ieo-details`, `/crypto-token/apply`, `/crypto-token/config` |
| Invest domain added | `/app/v1/invest/**` — farm, monster, trade history, Ponta point management |
| Game domain added | `/app/v1/game/**` — home, account-info, quiz, choice, campaign, user balance |
| Operate domain added | `/app/v1/operate/**` — full internal ops panel for Point system |
| Ponta OAuth integration | `/app/v1/operate/user/ponta-login` + `/app/v1/operate/user/token` (both PUBLIC) |
| Auth gains PontaFilter | `PontaAuthenticationProcessingFilter` added — handles `GET /app/v1/ponta-callback/oauth` callback |
| Cross-type guard added to JwtFilter | `JwtAuthenticationProcessingFilter` now blocks Invest user → `/app/v1/operate/**` and Operate user → non-operate paths (except `COMMON_WHITE_LIST` for game domain) |
| COMMON_WHITE_LIST for game | 12 game paths (`/app/v1/game/choice/**`, `/app/v1/game/quiz/**`, `/app/v1/game/campaigns`, ...) accessible by **both** Invest and Operate JWT |
| GMO OAuth kept in BFF | `/app/v1/gmo/oauth` still exists — OAuth redirect flow still in BFF |

#### Gen 1 → Gen 2: Exchange namespace merged in

| What changed | Detail |
|---|---|
| `/app/exchange/v1/*` namespace created | All Exchange BFF features restored under the new sub-prefix; controllers renamed (e.g. `V1ExchangeSpotOrderRestController`). Exchange did NOT reclaim original `/app/v1/*` paths — those were already repurposed for Invest in Gen 1 and remain Invest-only. |
| Multi-chain auth introduced | 3 filters → 6 filters: adds `ExchangeAuthProcessingFilter`, `ExchangeJwtFilter`, `InvestJwtFilter` (separate from OperateJwt) |
| 6 AuthenticationProviders registered | invest-creds, exchange-creds, JWT (operate), ExchangeJWT, InvestJWT, Ponta |
| ExchangeKycStatusFilter added | `addFilterAfter(ExchangeJwtFilter)` — blocks unverified users; KYC-exempt paths: `/user-info/**`, `/user-ekyc/**`, `/user-mfa/**`, `/user/condition`, `/user/logout`, `/user/agreement/**`, `/user-agreement-file/**`, `/postcodes/**`, `/refresh-token`, `/file/**` |
| `/app/v1/gmo/oauth` still in BFF | NOT removed — serves GMO OAuth redirect for Invest users; distinct from `/api/v1/gmo-callback` webhook |
| Invest Ponta login path added | `/app/v1/invest/user/ponta-login` (new `InvestUserController`) mirrors operate's ponta-login for Invest domain |
| Cross-domain POS routing added | `V1PointPosOrderRestController` + `V1PointPosTradeRestController` (Java: invest package) expose `/app/exchange/v1/point/pos/*`; Exchange JWT required |
| Token types not interchangeable | ExchangeJWT ≠ InvestJWT ≠ OperateJWT — three separate login flows, three separate token stores |
| COMMON_WHITE_LIST removed from game paths | Gen 1's 12-path cross-type game access (Invest+Operate JWT) is gone. Gen 2 `InvestJwtAuthenticationProcessingFilter` only accepts Invest JWT; Operate filter strictly enforces `OPERATE_REQUEST_PATH_MATCHER` — Operate JWT cannot reach `/app/v1/game/**` |

---

### 4.2 Path Namespaces

```java
// WebSecurityConfig.java
private final String pointTokenBasedAuthEntryPoint  = "/app/v1/operate/**";
private final String exchangeTokenBasedAuthEntryPoint = "/app/exchange/v1/**";
private final String investTokenBasedAuthEntryPoint   = "/app/v1/**";
```

| Path prefix | Domain | Auth filter | JWT type |
|---|---|---|---|
| `/app/exchange/v1/**` | Exchange | `ExchangeJwtAuthenticationProcessingFilter` | Exchange JWT (input: `ExchangeJwtAuthenticationToken`) |
| `/app/v1/**` (excl. operate) | Invest / Point | `InvestJwtAuthenticationProcessingFilter` | Invest JWT (input: `InvestJwtAuthenticationToken`) |
| `/app/v1/operate/**` | Operate | `JwtAuthenticationProcessingFilter` | Operate JWT (input: `JwtAuthenticationToken`) |
| `/app/v1/game/**` | Game | `InvestJwtAuthenticationProcessingFilter` | **Invest JWT only** (Gen 2; see Gen 1 note below) |
| `/app/exchange/v1/point/pos/**` | Cross-domain POS | `ExchangeJwtAuthenticationProcessingFilter` | Exchange JWT → reads Point data |
| `/websocket` | WebSocket | public | — |

> **Important**: Exchange JWT and Invest JWT are **not interchangeable**. A user logged in via
> `/app/exchange/v1/user/login` cannot call `/app/v1/user-info` and vice versa.
>
> **Gen 1 note (bs-point-server only)**: In Gen 1, `JwtAuthenticationProcessingFilter` contained
> `COMMON_WHITE_LIST_REQUEST_MATCHER` allowing 12 game paths to accept **both** Invest and Operate JWT.
> In Gen 2, the operate filter (`JwtAuthenticationProcessingFilter`) enforces `OPERATE_REQUEST_PATH_MATCHER`
> and rejects any non-operate path. Game paths are Invest JWT only in Gen 2.
>
> `/app/exchange/v1/point/pos/**` accepts Exchange JWT but reads Invest/Point data (cross-domain).

### 4.3 Authentication Chains

`WebSecurityConfig` wires 6 filters (`addFilterBefore`) + 1 post-filter (`addFilterAfter`) and **6 auth providers** in order:

```
Incoming request to point-app
│
├─ 1. PontaAuthenticationProcessingFilter   (Ponta OTP/OAuth)
│     path: /app/v1/operate/user/ponta-login, /app/v1/invest/user/ponta-login
│     provider: PontaAuthenticationProviderImpl
│     success: issues InvestJWT + OperateJWT
│
├─ 2. AuthenticationProcessingFilter        (Invest/Point login)
│     path: /app/v1/user/login[/otpauth]
│     provider: AuthenticationProviderImpl (appAuthenticationProvider)
│     success: appAuthenticationSuccessHandler → issues InvestJWT
│
├─ 3. ExchangeAuthenticationProcessingFilter (Exchange login)
│     path: /app/exchange/v1/user/login[/otpauth]
│     provider: ExchangeAuthenticationProviderImpl
│     success: exchangeAuthenticationSuccessHandler → issues ExchangeJWT
│
├─ 4. JwtAuthenticationProcessingFilter     (Operate token validation)
│     scope: /app/v1/operate/**
│     skip: whiteListEntryPoint
│
├─ 5. ExchangeJwtAuthenticationProcessingFilter (Exchange token validation)
│     scope: /app/exchange/v1/**
│     skip: whiteListEntryPoint
│     followed by: ExchangeKycStatusFilter (KYC gate for exchange endpoints)
│
└─ 6. InvestJwtAuthenticationProcessingFilter (Invest token validation)
      scope: /app/v1/** (excluding /app/v1/operate/**)
      skip: whiteListEntryPoint
```

**ExchangeKycStatusFilter** (`addFilterAfter` ExchangeJwtFilter): blocks exchange trading/account
endpoints if the user has not registered their profile or their KYC status is restricted.

Restricted KYC statuses: `NONE`, `DOCUMENT_REJECTED`, `INFORMATION_REQUIRED`, `URL_EXPIRED`, `WAITING_SET_PWD`.

KYC-**exempt** paths (always pass through even without KYC):
```
/app/exchange/v1/user/condition        /app/exchange/v1/user-info/**
/app/exchange/v1/user-ekyc/**          /app/exchange/v1/user/agreement/**
/app/exchange/v1/user-agreement-file/**  /app/exchange/v1/user-mfa/**
/app/exchange/v1/postcodes/**          /app/exchange/v1/refresh-token
/app/exchange/v1/file/**               /app/exchange/v1/user/logout
+ all BASE_WHITE_LIST entries
```

**COMMON_WHITE_LIST** (**Gen 1 only** — `bs-point-server/JwtAuthenticationProcessingFilter`): 12 game
paths that accepted **both** Invest and Operate JWT in Gen 1. **Removed in Gen 2**: the
`InvestJwtAuthenticationProcessingFilter` (Gen 2) only issues `InvestJwtAuthenticationToken`, and
the Operate filter strictly enforces `OPERATE_REQUEST_PATH_MATCHER`. Game paths are Invest JWT only in Gen 2.

Gen 1 COMMON_WHITE_LIST paths (historical, bs-point-server only):
```
/app/v1/game/choice/info          /app/v1/game/choice/vote
/app/v1/game/choice/self-status   /app/v1/game/choice/vote-history
/app/v1/game/choice/reward-history  /app/v1/game/choice/reward-x-connect
/app/v1/game/choice/reward-withdraw /app/v1/game/quiz/questions
/app/v1/game/quiz/submit           /app/v1/game/campaigns
/app/v1/game/account-info          /app/v1/game/point-balance
```

**Login whitelist** (`LOGIN_WHITE_LIST`): conditionally added to `whiteListEntryPoint` based on
`point-app.security.enable-invest-login-whitelist` config flag:

```java
"/app/v1/user/login"              "/app/v1/user/login/otpauth"
"/app/exchange/v1/user/login"     "/app/exchange/v1/user/login/otpauth"
```

### 4.4 Exchange Domain Endpoints

Controllers in package `point.app.exchange.controller.*`, all under `/app/exchange/v1/`:

| Path | Description |
|---|---|
| `/app/exchange/v1/user` | Login, register, password, logout, MFA |
| `/app/exchange/v1/user-info` | Profile info |
| `/app/exchange/v1/user-ekyc` | eKYC upload & status |
| `/app/exchange/v1/user-mfa` | MFA management |
| `/app/exchange/v1/asset` | Asset balances |
| `/app/exchange/v1/spot/order` | Spot order management |
| `/app/exchange/v1/spot/trade` | Trade history |
| `/app/exchange/v1/orderbook` | Order book (public) |
| `/app/exchange/v1/candlestick` | Chart data (public) |
| `/app/exchange/v1/ticker` | Ticker prices (public) |
| `/app/exchange/v1/trades` | Recent trades (public) |
| `/app/exchange/v1/deposit` | Fiat deposit |
| `/app/exchange/v1/withdrawal` | Fiat withdrawal |
| `/app/exchange/v1/bank-account` | Bank accounts |
| `/app/exchange/v1/bank` | Bank list |
| `/app/exchange/v1/crypto-history` | Crypto transfer history |
| `/app/exchange/v1/report` | Transaction reports / CSV export |
| `/app/exchange/v1/ieo-apply` | IEO application (partially public) |
| `/app/exchange/v1/pos/**` | POS system (OTC) |
| `/app/exchange/v1/api-info` | API key management (for `point-api` HMAC) |
| `/app/exchange/v1/refresh-token` | JWT refresh |
| `/app/exchange/v1/currency` | Currency list (public) |
| `/app/exchange/v1/currency-pair` | Currency pair list (public) |
| `/app/exchange/v1/chart-snapshot/**` | Chart snapshot images (public) |
| `/app/exchange/v1/vasp` | VASP travel rule |
| `/app/exchange/v1/transfer` | Internal transfer |
| `/app/exchange/v1/transfer-account` | Transfer accounts |
| `/app/exchange/v1/transfername` | Transfer recipient lookup |
| `/app/exchange/v1/onetime-bank-account` | One-time bank account |
| `/app/exchange/v1/withdrawal-account` | Withdrawal account management |
| `/app/exchange/v1/crypto-token/asset` | Crypto token asset |
| `/app/exchange/v1/cryptoTransfer` | Crypto transfer (on-chain) |
| `/app/exchange/v1/deposit-account` | Deposit accounts |
| `/app/exchange/v1/ieo-details` | IEO details / results |
| `/app/exchange/v1/postcodes/**` | Postcode lookup (KYC-exempt) |
| `/app/exchange/v1/file/**` | Document file upload/download (KYC-exempt) |
| `/app/exchange/v1/user-agreement-file/**` | Agreement file management (KYC-exempt) |
| `/app/exchange/v1/news` | News feed (public) |
| `/app/exchange/v1/point/pos/order` | **Cross-domain** — Point POS order (ExchangeJWT, invest package) |
| `/app/exchange/v1/point/pos/trade` | **Cross-domain** — Point POS trade (ExchangeJWT, invest package) |

**Cross-domain note**: `V1PointPosOrderRestController` and `V1PointPosTradeRestController`
are physically in the `invest/controller/` Java package but mapped under `/app/exchange/v1/`.
They are guarded by `ExchangeJwtAuthenticationProcessingFilter` (Exchange token required),
yet they query Invest/Point POS data. This is the only place where Exchange authentication
grants access to Point domain data.

### 4.5 Invest / Point Domain Endpoints

Controllers in package `point.app.invest.controller.*`, all under `/app/v1/`:

| Path | Description |
|---|---|
| `/app/v1/user` | Login, register, password, logout, MFA, token switch |
| `/app/v1/user-info` | Profile info |
| `/app/v1/user-ekyc` | eKYC |
| `/app/v1/user-mfa` | MFA management |
| `/app/v1/asset` | Asset balances |
| `/app/v1/asset-summary` | Asset summary |
| `/app/v1/pos/**` | POS order / trade / candlestick / price |
| `/app/v1/bank-account` | Bank accounts |
| `/app/v1/bank` | Bank list |
| `/app/v1/fiat-withdrawal` | Fiat withdrawal |
| `/app/v1/crypto-history` | Crypto history |
| `/app/v1/crypto-token/asset` | Crypto token asset |
| `/app/v1/currency` | Currency list (public) |
| `/app/v1/currency-pair` | Currency pair list (public) |
| `/app/v1/jpy-history` | JPY transaction history |
| `/app/v1/report` | Reports / CSV |
| `/app/v1/news` | News (public) |
| `/app/v1/mail-notices` | Mail notification settings |
| `/app/v1/user-agreement-file` | Agreement files |
| `/app/v1/contact` | Contact form (public) |
| `/app/v1/country` | Country list (public) |
| `/app/v1/postcodes` | Postcode lookup |
| `/app/v1/onetime-bank-account` | One-time bank account |
| `/app/v1/ponta-callback/**` | Ponta OAuth callback (public); `/ponta-callback/oauth-ex` triggers `PontaAuthFilter` |
| `/app/v1/gmo/oauth` | GMO OAuth redirect (public) — still in BFF alongside `/api/v1/gmo-callback` webhook |
| `/app/v1/invest/**` | Invest features (farm, monster, trade history, X/Twitter share) |
| `/app/v1/invest/point` | Ponta ↔ Invest point conversion; requires KYC DONE |
| `/app/v1/invest/user` | Invest Ponta auth: `ponta-login`, `token`, `invest`, `token/switch` (public paths) |
| `/app/v1/refresh-token` | Invest JWT refresh |
| `/app/v1/user/token/switch` | Token switch between user types (public) |

### 4.6 Game Domain Endpoints

Game domain has two controller sets: **Invest-facing** (`point.app.game.controller.*`) and
**Operate-facing** (`point.app.game.controller.operate.*`).

In Gen 2 (`bs-integration-server`), user-facing game paths (`/app/v1/game/**`) require **Invest JWT only**.
In Gen 1 (`bs-point-server`), these paths were accessible by both Invest and Operate JWT via
`COMMON_WHITE_LIST_REQUEST_MATCHER` — that cross-type access was removed in Gen 2.

#### User-facing game (`/app/v1/game/*`)

| Path | Auth | Description |
|---|---|---|
| `/app/v1/game/home/**` | **Public** (WAF allowlist for Ponta) | Ponta game home page redirect |
| `/app/v1/game/support-browser` | **Public** | Browser compatibility check |
| `/app/v1/game/account-info` | **Invest JWT** | Game account info |
| `/app/v1/game/point-balance` | **Invest JWT** | User point balance |
| `/app/v1/game/campaigns` | **Invest JWT** | Active campaigns |
| `/app/v1/game/choice/info` | **Invest JWT** | Choice power info |
| `/app/v1/game/choice/vote` | **Invest JWT** | Cast / read vote |
| `/app/v1/game/choice/vote-history` | **Invest JWT** | Vote history |
| `/app/v1/game/choice/reward-history` | **Invest JWT** | Reward history |
| `/app/v1/game/choice/reward-x-connect` | **Invest JWT** | Share reward to X/Twitter |
| `/app/v1/game/choice/reward-withdraw` | **Invest JWT** | Reward withdrawal |
| `/app/v1/game/quiz/questions` | **Invest JWT** | Quiz questions |
| `/app/v1/game/quiz/submit` | **Invest JWT** | Submit quiz answer |

#### Operate-side game (`/app/v1/operate/game/*`)

| Path | Auth | Description |
|---|---|---|
| `/app/v1/operate/game/account-info` | Operate JWT | Game account info (operate view) |
| `/app/v1/operate/game/choice` | Operate JWT | Choice management (operate) |
| `/app/v1/operate/game/quiz` | Operate JWT | Quiz management (operate) |
| `/app/v1/operate/game` | Operate JWT | Campaign / balance (operate view) |

> **Note**: `/app/v1/game/home/**` has a dedicated WAF rule (`maintenance_mode_for_path_ponta`)
> at Priority 2 — it is blocked separately from the `/app/*` catchall when maintenance is ON.

### 4.7 Operate Domain Endpoints

Controllers in package `point.app.operate.controller.*`, under `/app/v1/operate/`.
All endpoints require Operate JWT unless marked **Public**.

| Path | Auth | Description |
|---|---|---|
| `/app/v1/operate/user/ponta-login` | **Public** | Validates `partnerNumber` → redirect to Ponta login page |
| `/app/v1/operate/user/token` | **Public** | OTP → Operate JWT exchange |
| `/app/v1/operate/user/invest` | Operate JWT | Returns linked Invest user ID |
| `/app/v1/operate/mock/success` | **Public** | Dev/STG mock Ponta success |
| `/app/v1/operate/mock/failure` | **Public** | Dev/STG mock Ponta failure |
| `/app/v1/operate/mock/login` | **Public** | Dev/STG mock login |
| `/app/v1/operate/price` | **Public** | Board price (public context) |
| `/app/v1/operate/board-price` | Operate JWT | Board price (auth context) |
| `/app/v1/operate/candlestick` | **Public** | Candlestick data |
| `/app/v1/operate/currency` | Operate JWT | Currency list |
| `/app/v1/operate/asset` | Operate JWT | Asset list / summary |
| `/app/v1/operate/order` | Operate JWT | POS order management |
| `/app/v1/operate/trade` | Operate JWT | Trade history (legacy — `@Hidden` in Swagger) |
| `/app/v1/operate/trade-history/**` | Operate JWT | Trade history (current — replaces `/operate/trade`) |
| `/app/v1/operate/report/**` | Operate JWT | CSV download reports |
| `/app/v1/operate/farm-info/select` | Operate JWT | Farm selection info |
| `/app/v1/operate/monster/**` | Operate JWT | Monster list, growth history, unlock, patch |
| `/app/v1/operate/agreement-file` | Operate JWT | Terms of service file (operate type) |
| `/app/v1/operate/agreement` | Operate JWT | Get / accept agreement version |
| `/app/v1/operate/point/ponta-to-operation` | Operate JWT | Ponta → Operation points (no KYC required) |
| `/app/v1/operate/point/operation-to-ponta` | Operate JWT | Operation → Ponta (includes fee validation) |
| `/app/v1/operate/point/exchange-history` | Operate JWT | Combined Ponta ↔ Operation transfer history |
| `/app/v1/operate/refresh-token` | **Public** | Operate JWT refresh (served from invest package) |
| `/app/v1/operate/game/**` | Operate JWT | Game tools — see §4.6 operate-side game |

> **Note on legacy trade endpoints**: `TradeRestController` (`/app/v1/operate/trade`) is marked
> `@Hidden` in Swagger and superseded by `TradeHistoryOperateController`
> (`/app/v1/operate/trade-history/page/history`). The old endpoint still functions but is not
> documented in the public API spec.

### 4.8 Frontend Consumer Classification

The `/app/*` namespace is **not mixed-access**. Each path prefix is owned exclusively by one
frontend via a dedicated JWT auth chain. A token issued by one login flow cannot access the other
namespace — they are enforced at the Spring Security filter chain level.

| Classification | Path prefix | Frontend consumer | JWT type (Gen 2) |
|---|---|---|---|
| **EXCHANGE-only** | `/app/exchange/v1/*` | BACKSEAT (Exchange UI) | Exchange JWT |
| **POINT-only** | `/app/v1/*` (excl. operate) | Ponta牧場 (Invest / Point UI) | Invest JWT |
| **OPERATE-only** | `/app/v1/operate/*` | Internal ops panel | Operate JWT |
| **POINT-only** (game) | `/app/v1/game/**` | Ponta牧場 (Invest UI only in Gen 2) | **Invest JWT only** |
| **Cross-domain POS** | `/app/exchange/v1/point/pos/*` | BACKSEAT (Exchange POS) | Exchange JWT → reads Point data |

#### Historical note: path reuse across generations

These paths were NOT always Point-only. The classification changed across generations:

| Path | Gen 0 (cb-exchange-server) | Gen 1 (bs-point-server) | Gen 2 (bs-integration-server) |
|---|---|---|---|
| `/app/v1/user` | **Exchange** (`User` entity, Exchange JWT) | **Invest/Point** (`UserPrincipal`, Invest JWT) | **Invest/Point** (unchanged from Gen 1) |
| `/app/v1/bank` | **Exchange** | **Invest/Point** | **Invest/Point** |
| `/app/v1/currency` | **Public** (whitelist in Gen 0) | **Public** | **Public** |
| `/app/v1/refresh-token` | **Exchange** (whitelist + internal JWT validation) | **Invest** | **Invest** |

When Gen 1 removed all Exchange features, Point inherited the same URL paths and repurposed them
for Invest users. Gen 2 brought Exchange back under the new `/app/exchange/v1/*` prefix rather
than reclaiming the original `/app/v1/*` paths.

> **Migration implication**: Any BACKSEAT (Exchange UI) client still calling `/app/v1/user` with an
> Exchange JWT will fail in Gen 2 — the Invest JWT auth chain will reject the Exchange token. BACKSEAT
> must use `/app/exchange/v1/user` in Gen 2.

#### Mirror controller pattern — no "SHARED" paths between Exchange and Point in Gen 2

Gen 2 (`bs-integration-server`) introduced parallel "mirror" controllers for every common resource.
Every endpoint that appears to be a candidate for sharing has **two separate implementations**
in separate Java packages, served under separate URL namespaces, guarded by different JWT types:

| Resource | POINT endpoint (`invest` package) | EXCHANGE endpoint (`exchange` package) |
|---|---|---|
| User management | `/app/v1/user` → `V1UserRestController` | `/app/exchange/v1/user` → `V1Exchange1UserRestController` |
| User profile | `/app/v1/user-info` → `V1UserInfoRestController` | `/app/exchange/v1/user-info` → `V1ExchangeUserInfoRestController` |
| Assets | `/app/v1/asset`, `/app/v1/asset-summary` | `/app/exchange/v1/asset` → `V1ExchangeAssetRestController` |
| Bank | `/app/v1/bank` → `V1BankRestController` | `/app/exchange/v1/bank` → `V1ExchangeBankRestController` |
| Bank accounts | `/app/v1/bank-account` → `V1BankAccountRestController` | `/app/exchange/v1/bank-account` → `V1ExchangeBankAccountRestController` |
| Currency | `/app/v1/currency` → `V1CurrencyRestController` | `/app/exchange/v1/currency` → `V1ExchangeCurrencyRestController` |
| Currency pairs | `/app/v1/currency-pair` → `V1CurrencyPairRestController` | `/app/exchange/v1/currency-pair` → `V1ExchangeCurrencyPairRestController` |
| JWT refresh | `/app/v1/refresh-token` → `V1InvestRefreshTokenController` | `/app/exchange/v1/refresh-token` → `V1ExchangeRefreshTokenController` |
| POS trading | `/app/v1/pos/**` → Invest POS controllers | `/app/exchange/v1/pos/**` → `V1ExchangePos*RestController` |

> **Why**: When Exchange was merged back in Gen 2, it could not reuse the Invest controllers
> because Invest state (eKYC, KYC gate, Ponta account) is separate from Exchange state. The
> mirror pattern keeps the two products independently deployable with zero cross-contamination.
>
> **`UserPrincipal` vs `User` entity as Principal**: Invest controllers inject
> `@AuthenticationPrincipal UserPrincipal` (`point.app.component.model.UserPrincipal` — a
> dedicated wrapper). Exchange controllers inject `@AuthenticationPrincipal User` directly
> (the JPA entity `point.common.entity.User implements UserDetails`).
>
> **How the principal types differ**: Both `ExchangeJwtAuthenticationProvider` and
> `InvestJwtAuthenticationProvider` return a `JwtAuthenticationToken` as the authenticated result
> (not `ExchangeJwtAuthenticationToken` / `InvestJwtAuthenticationToken` — those are pre-auth input
> tokens used only by `supports()` routing). The difference is what's inside:
> - Exchange provider: `new JwtAuthenticationToken(user, ...)` where `user` is `point.common.entity.User`
> - Invest provider: `new JwtAuthenticationToken(userPrincipal, ...)` where `userPrincipal` is `UserPrincipal`
>
> When `@AuthenticationPrincipal UserPrincipal` is used in an invest controller and an Exchange JWT
> request somehow arrives, Spring would cast `User` → `UserPrincipal` → `ClassCastException`. The
> separate filter chain scopes (`/app/exchange/v1/**` vs `/app/v1/**`) make this structurally impossible.

---

## 5. Maintenance Mode and /api/*

Maintenance mode is controlled entirely by AWS WAF — the Spring Boot services are **unaware** of
maintenance state. The Lambda `waf-maintenance-lambda` injects / removes a rule group reference
in WebACL `point-cloudfront-customer`.

**Rule group** (`rulegroup-maintenance.tf`) — 6 rules evaluated in priority order:

| Priority | Rule name | Match | Action |
|---|---|---|---|
| 1 | `pass_maintenance_access` | `STARTS_WITH /maintenance/` | **Allow** |
| 2 | `maintenance_mode_for_path_ponta` | `STARTS_WITH /app/v1/game/home/` AND IP NOT in allowlist | Block 503 + HTML redirect |
| 3 | `maintenance_mode_for_path_admin` | `STARTS_WITH /admin/` AND IP NOT in allowlist | Block 503 + JSON |
| 4 | `maintenance_mode_for_path_api` | **`STARTS_WITH /api/`** AND IP NOT in allowlist | **Block 503 + JSON** |
| 5 | `maintenance_mode_for_path_app` | `STARTS_WITH /app/` AND IP NOT in allowlist | Block 503 + JSON |
| 6 | `maintenance_mode_for_html` | NOT in allowlist (catch-all) | Block 503 + HTML redirect |

**Response bodies:**

```json
// maintenance_json  (returned for /api/*, /admin/*)
{"code": 10005}

// maintenance_html  (returned for /app/*, catch-all)
<html><body><script>location.href = "/maintenance/";</script></body></html>
```

**Effect on /api/ endpoints during maintenance:**

| Scenario | Client IP | Result |
|---|---|---|
| Any `GET/POST /api/v1/*` | Not in `maintenance_ips` allowlist | WAF returns `HTTP 503` + `{"code": 10005}`. Request never reaches `point-api` pod. |
| Any `GET/POST /api/v1/*` | In `maintenance_ips` allowlist | WAF allows, request forwarded to `point-api` as normal. |

> **Frontend implication**: Code `10005` is the maintenance signal. Frontend/API clients should
> handle this error code specifically and display a maintenance banner.

---

## 6. Cross-Cutting Notes

### Logging
- `point-api` logs all **authenticated** requests via `UserLog` (after completion):
  - Logged: any URI starting with `/api/` that is NOT in `UNAUTHORIZED_URIS`
  - Not logged: public market data endpoints, webhooks
- `point-app` uses Spring's `HandlerInterceptorImpl` similarly with session-based user context.

### Internal service communication
`point-worker` and `point-mmh` call `point-api` endpoints internally via Kubernetes DNS:
```
http://point-api-service.default.svc.cluster.local:8080/api/v1/...
```
These calls originate from within the cluster so they bypass CloudFront, WAF, and the ALB.
Internal callers still need a valid API key (HMAC auth applies).

### Swagger / OpenAPI
`point-app` exposes Swagger UI at `/app/swagger-ui.html` (whitelisted, public).  
`point-api` has no Swagger — API contract is maintained via `docs/api.xlsx` (legacy) and this
document.

### No `/api/v1/auth/login` endpoint
There is **no login endpoint under `/api/v1/`**. The `/api/` namespace uses stateless HMAC
authentication, not username+password login. API keys are managed via:
- `POST /app/exchange/v1/api-info` — create an API key (requires Exchange login first)
- `PUT /app/exchange/v1/api-info` — update permissions
- `DELETE /app/exchange/v1/api-info` — revoke an API key

User authentication (browser login) uses:
- Exchange UI → `POST /app/exchange/v1/user/login[/otpauth]`
- Point/Invest UI → `POST /app/v1/user/login[/otpauth]`
- Ponta (Game/Operate) → `GET /app/v1/operate/user/ponta-login` (OAuth redirect)

---

## 7. API Evolution: Three Generations

This section traces how the `/api/*` and `/app/*` namespaces evolved across the three generations of
the codebase, from the original Coinbook exchange server through to the merged verup integration server.

```
Gen 0: cb-exchange-server   →  Gen 1: bs-point-server  →  Gen 2: bs-integration-server (verup)
       (exchange only)              (point only)                  (exchange + point merged)
```

---

### 7.1 Gen 0 — cb-exchange-server (Coinbook Exchange)

**Repository**: `coinbook/cb-exchange-server`  
**Modules**: `exchange-api`, `exchange-app`, `exchange-admin`, `exchange-mmh`, `exchange-worker`  
**Package prefix**: `exchange.*`

#### exchange-api (Gen 0 Public REST API)

8 endpoints — exchange trading and market data only. No webhooks.

| Endpoint | Method | Auth required | Description |
|---|---|---|---|
| `/api/v1/symbol` | GET | No (public) | Symbol list |
| `/api/v1/candlestick` | GET | No (public) | OHLCV candle data |
| `/api/v1/orderbook` | GET | No (public) | Live order book |
| `/api/v1/ticker` | GET | No (public) | Market price summary |
| `/api/v1/trades` | GET | No (public) | Recent public trades |
| `/api/v1/asset` | GET | Yes (`canGetAssetInfo`) | User wallet balances |
| `/api/v1/spot/order` | GET | Yes (`canGetOrderInfo`) | Query orders (paginated) |
| `/api/v1/spot/order/active` | GET | Yes (`canGetOrderInfo`) | List active (unfilled / partially filled) orders |
| `/api/v1/spot/order/history` | GET | Yes (`canGetOrderInfo`) | Combined current + historical orders |
| `/api/v1/spot/order` | POST | Yes (`canCreateNewOrder`) | Place a new spot order |
| `/api/v1/spot/order/multi` | POST | Yes (`canCreateNewOrder`) | Batch cancel + place orders in one request |
| `/api/v1/spot/order` | DELETE | Yes (`canDeleteOrder`) | Cancel an order |
| `/api/v1/spot/trade` | GET | Yes (`canGetTradeInfo`) | Executed trade history |

**`UNAUTHORIZED_URIS`** (7 items — no webhooks):
```java
Arrays.asList(
    "/favicon.ico",
    "/healthcheck",
    "/candlestick",
    "/orderbook",
    "/symbol",
    "/ticker",
    "/trades"
)
```

`REQUEST_SPAN = 60` (same 60-second nonce window as Gen 2).

#### exchange-app (Gen 0 BFF)

~50 endpoints, **all under flat `/app/v1/*`** — there is no `exchange/` sub-prefix in Gen 0.
The Exchange and any future product domains would all share the same path namespace.

**Security config** (`WebSecurityConfig.java`):

```java
private final String tokenBasedAuthEntryPoint = "/app/**";
```

**Single auth chain** — one `JwtAuthenticationProcessingFilter` for all `/app/**` routes.
There is no multi-chain setup; Exchange JWT is the only token type.

**Public whitelist** (selected entries):
```java
"/app/v1/candlestick",
"/app/v1/contact",
"/app/v1/country",
"/app/v1/currency",
"/app/v1/currency-pair",
"/app/v1/news",
"/app/v1/orderbook",
"/app/v1/spot/order/calculate",
"/app/v1/symbol",
"/app/v1/ticker",
"/app/v1/trades",
"/app/v1/user/login",
"/app/v1/user/login/otpauth",
"/app/v1/gmo/oauth",
"/app/v1/staking/list",
// ... (login, registration, refresh-token, etc.)
```

**Notable controllers unique to Gen 0**:

| Controller | Path | Status in Gen 2 |
|---|---|---|
| `V1StakingInfoRestController` | `/app/v1/staking` | **Dropped** — no equivalent in `bs-integration-server` |
| `GmoCallBackController` | `/app/v1/gmo/oauth` | **Moved** — became `/api/v1/gmo-callback` webhook in Gen 2 |
| `V1CryptoTokenApplyRestController` | `/app/v1/crypto-token/apply` | Absorbed into exchange domain |
| `V1CryptoTokenConfigRestController` | `/app/v1/crypto-token/config` | Absorbed into exchange domain |

**Full BFF endpoint list** (all `/app/v1/*`, Gen 0):

| Path | Description |
|---|---|
| `/app/v1/user` | User auth (login, register, password, logout) |
| `/app/v1/user-info` | User profile |
| `/app/v1/user-ekyc` | eKYC upload |
| `/app/v1/user-mfa` | MFA management |
| `/app/v1/asset` | Asset balances |
| `/app/v1/asset-summary` | Asset summary |
| `/app/v1/spot/order` | Spot order management |
| `/app/v1/spot/trade` | Trade history |
| `/app/v1/orderbook` | Order book (public) |
| `/app/v1/candlestick` | Chart data (public) |
| `/app/v1/ticker` | Ticker prices (public) |
| `/app/v1/trades` | Recent trades (public) |
| `/app/v1/symbol` | Symbol list (public) |
| `/app/v1/api-info` | API key management |
| `/app/v1/deposit` | Fiat deposit |
| `/app/v1/deposit-account` | Deposit accounts |
| `/app/v1/withdrawal` | Fiat withdrawal |
| `/app/v1/fiat-withdrawal` | Fiat withdrawal (v2) |
| `/app/v1/withdrawal-account` | Withdrawal accounts |
| `/app/v1/bank-account` | Bank accounts |
| `/app/v1/bank` | Bank list |
| `/app/v1/crypto-history` | Crypto transfer history |
| `/app/v1/crypto-token/asset` | Crypto token asset |
| `/app/v1/crypto-token/apply` | Crypto token application |
| `/app/v1/crypto-token/config` | Crypto token config |
| `/app/v1/currency` | Currency list (public) |
| `/app/v1/currency-pair` | Currency pair list (public) |
| `/app/v1/jpy-history` | JPY transaction history |
| `/app/v1/report` | Reports / CSV export |
| `/app/v1/ieo-apply` | IEO application |
| `/app/v1/ieo-details` | IEO details |
| `/app/v1/staking` | **Staking info (Gen 0 only — dropped in Gen 2)** |
| `/app/v1/pos/**` | POS (OTC) system |
| `/app/v1/transfer` | Internal transfer |
| `/app/v1/transfer-account` | Transfer accounts |
| `/app/v1/transfername` | Transfer recipient lookup |
| `/app/v1/onetime-bank-account` | One-time bank account |
| `/app/v1/vasp` | VASP travel rule |
| `/app/v1/file` | Document file upload/download |
| `/app/v1/user-agreement-file` | Agreement file management |
| `/app/v1/news` | News feed (public) |
| `/app/v1/contact` | Contact form (public) |
| `/app/v1/country` | Country list (public) |
| `/app/v1/postcodes` | Postcode lookup |
| `/app/v1/mail-notices` | Mail notification settings |
| `/app/v1/refresh-token` | JWT refresh |
| `/app/v1/gmo/oauth` | GMO OAuth callback (public, → became `/api/v1/gmo-callback` in Gen 2) |

---

### 7.2 Gen 1 — bs-point-server (Point Only)

**Repository**: `verup/bs-point-server`  
**Modules**: `point-api`, `point-app`, `point-admin`, `point-mmh`, `point-worker`  
**Package prefix**: `point.*` (renamed from `exchange.*` via `rename_exchange_to_point.py`)

#### point-api (Gen 1 Public API)

3 endpoints — point-domain webhooks only. All exchange market data endpoints were removed.

| Endpoint | Method | Auth |
|---|---|---|
| `/api/v1/asset` | GET | Yes (HMAC) |
| `/api/v1/gmo-callback` | POST | No (public) |
| `/api/v1/bpo-callback` | POST | No (public) |

**`UNAUTHORIZED_URIS`** (2 items — minimal):
```java
Arrays.asList("/favicon.ico", "/healthcheck")
```

> Note: `/api/v1/asset` is authenticated but no explicit permission gate — the HMAC key itself is the gate.

#### point-app (Gen 1 BFF)

Still uses the **same single-chain architecture** inherited from Gen 0:

```java
private final String tokenBasedAuthEntryPoint = "/app/**";
```

One `JwtAuthenticationProcessingFilter`. The Invest/Point features (`/app/v1/invest/*`) were added under the same flat `/app/v1/*` namespace inherited from the exchange BFF.

---

### 7.3 Three-Generation Comparison

#### Public API module (`/api/*`)

| Attribute | Gen 0 — cb-exchange-server | Gen 1 — bs-point-server | Gen 2 — bs-integration-server |
|---|---|---|---|
| Module name | `exchange-api` | `point-api` | `point-api` (merged) |
| Package prefix | `exchange.api.*` | `point.api.*` | `point.api.*` |
| Total `/api/v1/*` endpoints | **8** (exchange trading) | **3** (point webhooks) | **11** (8 exchange + 3 point) |
| Market data endpoints | `/candlestick`, `/orderbook`, `/symbol`, `/ticker`, `/trades` | **None** | All 5 restored |
| Spot trading endpoints | `/spot/order`, `/spot/trade` | **None** | Both restored |
| Webhooks | **None** | `/gmo-callback`, `/bpo-callback` | All 3 (+ `/transactions-callback`) |
| `UNAUTHORIZED_URIS` count | 7 | 2 | 9 |
| HMAC `REQUEST_SPAN` | 60 s | 60 s | 60 s |

#### BFF module (`/app/*`)

| Attribute | Gen 0 — exchange-app | Gen 1 — point-app | Gen 2 — point-app |
|---|---|---|---|
| Path namespace | Flat `/app/v1/*` | Flat `/app/v1/*` | Dual: `/app/exchange/v1/*` + `/app/v1/*` |
| Auth chains | **1** (single JWT) | **1** (single JWT) | **4** (ExchangeJWT, InvestJWT, OperateJWT, PontaOAuth) |
| JWT types | `JwtAuthenticationToken` | `JwtAuthenticationToken` | `ExchangeJwtAuthenticationToken`, `InvestJwtAuthenticationToken`, `JwtAuthenticationToken` |
| `tokenBasedAuthEntryPoint` | `"/app/**"` | `"/app/**"` | Per-chain (3 separate entry points) |
| KYC gate filter | None | None | `ExchangeKycStatusFilter` (after ExchangeJWT) |
| Staking feature | `/app/v1/staking` ✓ | None | **Dropped** |
| Game domain | None | None | `/app/v1/game/**` ✓ |
| Operate domain | None | None | `/app/v1/operate/**` ✓ |
| Ponta OAuth | None | None | `/app/v1/operate/user/ponta-login` ✓ |
| GMO callback | `/app/v1/gmo/oauth` (BFF) | `/api/v1/gmo-callback` (API) | `/api/v1/gmo-callback` (API) |

---

### 7.4 Key Structural Changes at Each Generation

#### Gen 0 → Gen 1: Point product replaces Exchange product

| What changed | Detail |
|---|---|
| Package rename | `exchange.*` → `point.*` (via `rename_exchange_to_point.py`) |
| `/api/*` stripped back | 8 exchange endpoints removed; 3 point webhooks added |
| GMO callback relocated | `/app/v1/gmo/oauth` (user-facing OAuth in BFF) → `/api/v1/gmo-callback` (server-to-server webhook in API) |
| BPO webhook added | `/api/v1/bpo-callback` is new — no equivalent in Gen 0 |
| Staking dropped | `/app/v1/staking` removed with no replacement |
| Point/Invest features added | `/app/v1/invest/**` added to `point-app` |
| Auth architecture unchanged | Still single JWT chain `/app/**` |

#### Gen 1 → Gen 2: Exchange + Point merged into one server

| What changed | Detail |
|---|---|
| Exchange endpoints restored | All 8 `/api/v1/*` exchange endpoints re-added to `point-api` |
| BFF namespace split | Flat `/app/v1/*` → `exchange/` sub-prefix added; Exchange endpoints moved to `/app/exchange/v1/*` |
| Multi-chain Spring Security | Single JWT → 3 JWT types + Ponta OAuth provider, 6 filters |
| KYC gate introduced | `ExchangeKycStatusFilter` added after ExchangeJWT validation |
| Game domain added | `/app/v1/game/**` with Operate JWT auth |
| Operate domain added | `/app/v1/operate/**` with dedicated OperateJWT |
| Ponta OAuth integration | Full OAuth provider for game/operate flows |
| `transactions-callback` added | New webhook in `point-api` (not in Gen 0 or Gen 1) |
| POS cross-domain routing | Exchange-authenticated users can access Point POS via `/app/exchange/v1/point/pos/*` |
