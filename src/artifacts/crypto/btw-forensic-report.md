# BTW (Bitway) — On-chain Decision Briefing


## 🎯 One-screen verdict

> This section is deterministically derived from on-chain detector outputs and is not buy/sell advice. Full evidence is in the sections below.

| Dimension | Conclusion | Key evidence |
|---|---|---|
| **Current phase** | 🔴 Dumping in progress / selling into the pump | 100 large anomalies in last 72h; confirmed realization $25,815,602 |
| **Chip structure** | 🟢 Dispersed | Operator/project-controlled chips 0.0% / CEX relay pool 5.6% / verifiable non-operator sell-pressure 94.4% |
| **Insider / operator spot realization** | 🟠 Partially realized | Confirmed insider realization 12.7% of circ + net CEX-withdrawal distribution 0.0% of circ |
| **Volume quality** | 🔴 24h volume untrustworthy — wash bots dominate | 448,310 on-chain matches; single bot 14.3% |
| **Supply risk** | 🟠 High-frequency liquidation visible — but no new mint source | 100 high-frequency liquidation wallets; cumulative throughput 383% of circ |
| **Market-cap stage** | 🟠 Mid mcap + thin absorption / pumping | mcap $268M; 5% depth $4,127; LP/mcap 0.005; vol/LP 5.4×; 24h +21.3% |
| **Monitoring focus** | Track the continued-distribution path | Addresses with anomalies in last 72h, High-frequency liquidation wallets |

**One-liner**: Dumping in progress / selling into the pump + Dispersed + volume inflated by wash + supply source still present.

## 🎯 Quick-read summary

> This section is for quick retail reading / AI re-interpretation. Detailed forensic detection is in the sections below (with English terms). Everything here is derived from on-chain data and contains no buy/sell advice.

- **Project**: Bitway (BTW), main contract [`0x444045b0…`](https://bscscan.com/address/0x444045b0ee1ee319a660a5e3d604ca0ffa35acaa)
- **Listing**: Binance Alpha S2 (Spot + Perp) · primary chain BSC

- **Confirmed insider on-chain realization**: **317,499,955 tokens (12.68% of circulating)** ≈ **$25,815,602 USD** — a lower bound on what insider wallets have realized themselves via (a) deposits to centralized-exchange deposit addresses + (b) their own direct on-chain matches; actual sell-out is most likely higher (see 📊 Confirmed sell-out section)
- **Historical high-throughput operators surfaced**: 100 wallets ran cumulative **throughput** (token in/out flow, NOT sell volume, includes wash double-counting) of **9,589,667,129 tokens** over 365 days then zeroed out — already exited

- **Report-completeness note**: only on-chain-verifiable wallet → DEX/CEX flows are included. Off-chain behaviour (distribution after a CEX withdrawal / OTC transfers / bridges not in the surf index, etc.) is not on-chain-detectable, so real sell-out may exceed the figures here. See the 🟡 completeness note below.

- **How to use this report**: read it alongside the **Monitored wallets** section below; add the core wallets to Binance Wallet / OKX monitoring (monitoring_paste.json supports one-click import). Make entry/exit decisions according to your own risk tolerance.


> ⚠️ **Read first — on-chain detection limits / data caveats**
>
> - 🚨 **24h volume / on-chain matches dominated by a wash bot**: 200 counterparty addresses / 448,310 on-chain matches, with a single wash bot doing up to 64,183 wash matches (single wash bot share 14.3%). **Do not use 24h volume to judge real absorption** — see "absorption cap (5% depth)" below. Detail → 📊 Confirmed sell-out section.
_Tool version 1.0.5 · Main chain BSC · Alpha listed 2026-03-02_

_Total supply 10,000,000,000 · Circulating 2,504,885,365 (25.0%) · Type VC_LIKELY_
_Tier S2 · S1 2026-03-02 · S2 2026-06-04_
## 💹 Token market (real-time)

| Item | Value |
|---|---|
| **Project name** | **Bitway** (BTW) |
| Ticker | `BTW` |
| Primary chain | BSC |
| Listing | S2 (Alpha + Binance Perps) · Alpha listed 2026-03-02 · Perp listed 2026-06-04 |
| **Current price** | **$0.1049** (🟢 +19.16% 24H) |
| **Network 24H volume (CEX+DEX)** | **$35,243,445** |
| Current LP (DEX main pool) | $1,465,689 |
| Market cap (mcap / FDV) | $229,437,120 / $1,042,896,001 |
| Data source | surf+Alpha API (real-time) · 44,228 holders · 24H 109,589 txns |

## 📋 Decision summary

| Item | Value |
|---|---|
| **🎯 Risk score** | **🟥🟥🟥🟥🟥🟥🟥🟥🟥🟥 (10/10)** |
| **On-chain state label** | **Recent distribution** — Recent 72h on-chain activity — 100 large transfers |
| Primary chain | binance-smart-chain (this chain's current LP $160,685) |
| **Entry cap (LP 5% depth)** | **$4,127** |
| Near-term catalysts | None |
| Blind spots you must cross-check yourself | None |

> 🎯 **Meaning of the 5 on-chain-state labels** (deterministically derived at render time, describing on-chain detection state only, not trading advice):
> - **No significant trigger** — no significant on-chain detection signal (risk 0-2)
> - **Watching** — some activity but no primary signal triggered (risk 2-5)
> - **Distributed and exited** — historical operator already distributed; on-chain historical sell-pressure released (risk 4-7)
> - **Dormant insider, undistributed** — dormant insider wallets have not distributed; timing unpredictable (risk 6-9)
> - **Recent distribution** — large on-chain activity in the last 72h (risk 7-10)

> BTW (Bitway) on BSC is in an active distribution phase. The deployer minted 10B tokens and pre-launch distributed all 10B to 16 insider addresses. 12.7% of circulating supply has already been confirmed sold via CEX (Bitget) for ~$25.8M. However, 4 distributing wallets still hold 82.8% of total supply. The 24h volume of $35.2M is heavily wash-traded (448K on-chain matches, single bot at 14.3%), making the apparent pump of +21.3% unreliable. Entry size cap is extremely thin at $4,127 (5% slippage). Verdict: EXIT_IF_HOLDING.



## 🎯 On-chain state: Recent distribution (risk score 10/10)

**Recent 72h on-chain activity — 100 large transfers**


| Decision anchor | Value | Status |
|---|---|---|
| Alpha 5% slippage cap | $4,127 | 🔴 Very thin |
| DEX main pool USD liquidity | $81,875 | 🟡 |
| Pool token 24h net throughput (NOT LP add/remove) | -2.33% | 🟢 |


## 🧠 Current on-chain behaviour profile

> This section translates 10 detector outputs into 4 categories of "what the operator might be doing." Multi-label by design — one token can hit several categories at once (e.g. A1 accumulation + B1 wash volume + C3 recent activity). Order: severity (🔴 STRONG / 🟠 MEDIUM / 🟡 WEAK) → category → label ID. Describes on-chain facts only, not trading advice.

| Severity | Label | Category | Trigger metric | On-chain fact |
|:-:|---|---|---|---|
| 🔴 **STRONG** | `B1` Wash-trade volume inflation (24h vol untrustworthy) | B Volume fabrication | `wash_swap_count=448310, wash_top_bot_share=0.143, wash_n_dex_addrs=200` | 448,310 on-chain matches in 24h across 200 on-chain trading addresses, a single wash bot accounting for 14.3% — the 24h volume contains heavy wash trading and does not equal real absorption |
| 🔴 **STRONG** | `C1` On-chain confirmed outflow (CEX deposit + DEX swap) | C Dump behavior | `net_sellout_usd=25815602.0, sell_pct_circ=12.675` | On-chain confirmed outflow $25,815,602 (12.68% of circulating) — real insider realization observed via CEX deposit + on-chain match paths |
| 🔴 **STRONG** | `C2` Historical high-frequency operator liquidation | C Dump behavior | `ht_operator_count=100, ht_throughput_pct_supply=95.9` | 100 high-frequency operator wallets (cumulative **throughput** = 96% of total supply; throughput = token in/out flow, NOT sell volume) — already exited historically, balance near 0 |
| 🔴 **STRONG** | `C3` Anomalous on-chain activity in last 72h | C Dump behavior | `anomaly_72h_count=100, truncated=True` | 100 large anomalous transfers in the last 72h (count, not token amount) (detector saturated / truncated) — on-chain activity is elevated |
| 🟠 **MEDIUM** | `B2` Fake depth (LP/mcap mismatch or high vol/LP) | B Volume fabrication | `vol_lp_ratio=5.41, lp_mcap_ratio=0.0055, lp_usd=1465689.1523420978` | Volume/liquidity ratio = 5.4× / liquidity/mcap ratio = 0.0055 — surface liquidity is low and a single trade has large price impact |
| 🟠 **MEDIUM** | `D2` Cross-chain deployment / coordination | D Coordination structure | `non_primary_chains=1, cg_chains=2` | This token is deployed on 2 chains (1 non-primary chains have independent on-chain hits) — cross-chain dump paths require separate monitoring |

> **Behaviour profile is not the verdict**: the 🎯 on-chain state label above is a composite of 5 tiers (No significant trigger / Watching / Distributed and exited / Dormant insider / Recent distribution); the behaviour profile here is the finer-grained 10-class on-chain detection signals. A token can be "Recent distribution" while also hitting multiple labels like A1+A2+A3+B1+C2+C3.


## 🔴 Confirmed sell-out (insider lower bound)

### 🎯 Pump counterparty check

> **⚡ Quick read**: circulating 9918.8M tokens · **non-operator sell-pressure 94.4%** (9,366,991,397 tokens = verifiable within top 100 holders 94.4%) · operator ammo 0.0% (⚠️ Alpha API reports 2505M circulating, on-chain dumpable 9919M = 3.96x, Alpha understates (cosmetic)) · exchange transit pool (retail vs project custody indistinguishable) 5.6% (3 exchange wallets) · insider confirmed realization $25,815,602 (12.7% of circulating).

> ⚠️ **Three-bucket sanity check triggered** — the following buckets are ≈ 0%, investigate:
> - **operator ammo 0%**: Rare — Alpha-class tokens usually have operator control. Check: (a) is `_master_cluster_addrs` empty (should be ≥ 50)? (b) did the m6 / mint_authority / cex_fanout / ht_dumpers detectors run? (c) inspect the funding_attribution segments
> When the operator wants to pump, **the potential sellers = the held chips that don't belong to the operator**. The smaller this is, the more confident the operator is to pump (less fear of being dumped on); the larger, the more cautious.

| Chip bucket | Tokens | % of current circulating | Interpretation |
|---|---:|---:|---|
| 🟣 **Operator / project-controlled chips** | **0** | **0.0%** | **Dispersed** — no clear operator footprint |
| 🔥 **Verifiable non-operator sell-pressure** | **9,366,991,397** | **94.4%** | **Heavy external sell-pressure** (includes retail whales + protocol contracts + bridge transit) |
| 🟦 **Exchange transit pool (neutral, indistinguishable)** | **551,849,330** | **5.6%** | 3 exchange hot/cold/deposit wallets. On-chain it is **impossible to distinguish** retail deposit aggregation vs project custody reserve. During a pump it may flow out from either side |

### Key judgment

**Project-controlled chips < 50%** — control is weak; the external counterparty + CEX pool flow direction decide the book.

<details>
<summary>🔍 Expand: operator-ammo 11-sub-bucket detail (with raw total + overlap note)</summary>

| Sub-bucket | Tokens | % of circulating | Note |
|---|---:|---:|---|
| ①a Public lockup / treasury / airdrop contract outside m6 lineage | 0 | 0.0% | Sablier / Hedgey / custom lockups. Public release schedule, **won't dump immediately during a pump**. Lower bound after subtracting the 7,495,114,635 unminted reserve |
| ①b Movable multisig outside m6 lineage | 0 | 0.0% | Gnosis Safe Proxy etc. The operator can transfer today with one signature |
| ② m6 lineage portion in circulation | 7,792,065,322 | 78.6% | m6 lineage total holdings 9,287,179,957 minus lockup 0. Includes pure insiders (8,279,015,862) |
| ⚠️ ③ Exchange-withdrawal distribution (net control not computable) | — | — | Gross inflow; phase-2 SQL truncated; net fan-out cannot be computed.  |
| ④ DEX pool token-side holdings | 1,532,204 | 0.0% | DEX pools are 99% provided by the project / market maker |
| ⑤ Other detector hits | 3,795,077 | 0.0% | 35 wallets — flow operators / cross-token whales / high-throughput exit operators |
| ⑥'' Heuristic hidden ammo (top-100 unclassified ≥ 3%) | 2,000,000,000 | 20.2% | 1 wallets. **The 3% threshold risks false positives** — cross-check via monitoring_paste |
| 📌 Unminted operator-controlled reserve | 7,495,114,635 | _75.0% of total supply_ | **Not in the circulating denominator — but operator-controlled**. Adds sell-pressure once lockup / mint cadence releases it into circulation |
| ━━━━━ | ━━━━━ | ━━━━━ | ━━━━━ |
| Operator ammo raw total | 9,797,392,604 | 98.8% | Sum of buckets assuming no overlap. Upper-bound estimate |

**Notes**:
- The quick-read "operator ammo" is a **wallet-level back-calculation**: iterate the top 100 and de-dup-sum those in the operator set. Different from the raw total — raw is per-bucket upper bound (with overlap), quick-read is strictly de-duplicated.
- The quick-read "non-operator sell-pressure" includes **retail whales + protocol contracts (Wormhole / veVELVET etc.)**, not all of which is true retail. It is an upper bound.
- ①a vesting / ⑥ mint reserve → **won't dump immediately** during a pump; enters circulation only over the medium term.
- ①b multisig / ⑥' cluster → **transferable today**, different in nature from "lockup".
- Algorithm version: operator-ammo / non-operator-sell-pressure reverse algorithm v0.8.4.8.

</details>

#### 🔍 Verifiable non-operator sell-pressure wallet detail (reverse calc)

> Top-100 holders that are **neither in the operator set nor the exchange pool**. Operator set: m6 lineage + multisig / public lockup / treasury / airdrop contract / DEX pool + heuristic catches + detector hits. **All exchange wallets are excluded** (placed in the neutral "exchange transit pool", retail deposits vs project custody indistinguishable). Non-operator sell-pressure mainly comprises true retail whales + bridge protocol contracts + DeFi protocol contracts.

| # | Wallet | Current balance | % circulating | Type | Arkham label |
|---:|---|---:|---:|---|---|
| 1 | [`0x76d77531258b`](https://bscscan.com/address/0x76d77531258b4dddfa4087e97a6c89bc0f0f1e50) | 8,000,000,000 | 80.65% | Unclassified | — |
| 2 | [`0xcd3e5e5ca176`](https://bscscan.com/address/0xcd3e5e5ca176af4958ee33e346cc5ee93eca73d7) | 1,002,354,766 | 10.11% | Unclassified | — |
| 3 | [`0x61d8cff69ed7`](https://bscscan.com/address/0x61d8cff69ed737d7a937bbcf72e02cd1639ac9b4) | 130,999,910 | 1.32% | Unclassified | — |
| 4 | [`0x60add99bc0a8`](https://bscscan.com/address/0x60add99bc0a85c5f67e16ef0c45fb600d50855ad) | 96,417,849 | 0.97% | Unclassified | — |
| 5 | [`0x87dc0e03e7ac`](https://bscscan.com/address/0x87dc0e03e7ac509cd4500b18a3d104be1c9b1383) | 59,203,814 | 0.60% | Unclassified | — |
| 6 | [`0x93deb693b170`](https://bscscan.com/address/0x93deb693b170d56bdde1b0a5222b14c0f885d976) | 50,002,860 | 0.50% | Unclassified | — |
| 7 | [`0x1ab4973a48dc`](https://bscscan.com/address/0x1ab4973a48dc892cd9971ece8e01dcc7688f8f23) | 9,773,799 | 0.10% | Unclassified | — |
| 8 | [`0x5c4a69037325`](https://bscscan.com/address/0x5c4a6903732532eeb3ae0803e062d8ae25d52bd1) | 6,706,195 | 0.07% | Unclassified | — |
| 9 | [`0xfd2d369dfeb5`](https://bscscan.com/address/0xfd2d369dfeb50dd74e502933dd98019449e268db) | 5,000,000 | 0.05% | Unclassified | — |
| 10 | [`0xdbc29e3649b0`](https://bscscan.com/address/0xdbc29e3649b06d8886d4c5ff4c9e011053d2811c) | 5,000,000 | 0.05% | Unclassified | — |
| 11 | [`0x238a35880837`](https://bscscan.com/address/0x238a358808379702088667322f80ac48bad5e6c4) | 1,532,204 | 0.02% | DEX pool | PancakeSwap | Vault |
| ━━━━━━━━━━━━━━━━━ | ━━━━━━━━━━━━━━━━━ | ━━━━━━━━━ | ━━━━━━━ | ━━━━━━━━━ | ━━━━━━━━━ |
| **Total verifiable non-operator sell-pressure (within top 100 holders)** | 11 wallets | **9,366,991,397** | **94.4%** | — | — |

> ⚠️ **Nature of non-operator sell-pressure**: mainly true retail whales + protocol contracts like Wormhole / veVELVET (user-deposited) + bridge transit. Large bare addresses (no Arkham label + > 1% circulating) are suspect as either operator aliases or true retail whales — cross-check wallet activity via monitoring_paste below.

---

| Item | Value |
|---|---|
| Tracked wallets (full m6 lineage) | **16** (13 standard insiders + 3 public-lockup custody / dust / CEX-DEX infrastructure) |
| **Pure insider current holdings (the true dormant sell-pressure the verdict references)** | **82.7902% of supply** (8,279,015,862 tokens, **excluding** vesting / multisig / treasury / CEX custody / DEX routing) |
| Insider-tree current holdings (incl. lockup, conservation anchor) | 92.8718% of supply (9,287,179,957 tokens, includes unreleased lockup + CEX/DEX transit balances, **not equal to the insider-controlled figure**) |
| (a) Confirmed sell-out — CEX deposit | 317,499,955 → Bitget |
| (b) Confirmed sell-out — DEX swap (own wallet) | 0 (0 swaps) |
| **Confirmed gross sell-out, a+b** | **≥ 317,499,955 = 12.7% of circulating**, USD ≈ $25,815,602 |
| **Confirmed net sell-out** | **$25,815,602** |



> 🕵️ Tracking 1 hidden operator-ammo wallets (heuristic / fake-mining mint cluster): **since 2026-03-02no realization observed via (a) deposits to exchange deposit addresses + (b) own on-chain matches**. The project / market maker may still be in the accumulation phase, distribution not yet started.
> ⚠️ **This token's on-chain dump is dominated by a wash bot**: 200 counterparty addresses with 448,310 on-chain matches total, a single wash bot doing up to 64,183 wash matches. Many insiders route tokens to relays / bots before selling (this portion is **unattributable** and not counted in the confirmed lower bound above — so real sell-out is most likely higher than the lower bound). Massive wash = dumping while inflating surface activity to lure buyers.


<a id="section-recent-anomaly"></a>
## 📊 Risk-signal aggregation (detectors + rhythm)

### Detector summary

| emoji | Category | Count | Interpretation |
|---|---|---|---|
| 🔴 | Pre-launch insider distribution | 16 | Rule 11 backward trace: deployer → 16 insiders → downstream distribution. 11 wallets fully distributed, 4 still distributing (82.8% supply). Confirms systematic insider cash-out pipeline. |
| 🔴 | Fully-distributed insider wallets | 11 | 72h anomaly scan: 100 large on-chain transfers detected. 8 highlighted events totaling ~$7.4M, primarily CEX-linked (Binance Cold Wallet, MEXC Hot Wallet). |
| ⚪ | Quiet wallets (never distributed) | 0 | Wash trading detector: 448,310 on-chain matches in 24h, single bot at 14.3%. Volume is heavily inflated and does not represent genuine market absorption. |
| 🔴 | Recent 72h anomaly large transfers (truncated ≥100) | 100 | High-frequency liquidation: 100 wallets with cumulative throughput of 383% of circulating supply. This indicates extensive token cycling — tokens are being moved rapidly through multiple wallets, likely for wash trading and distribution obfuscation. |

### Rhythm recognition

**Three-wave distribution pattern: (1) pre-launch OTC allocation, (2) mass retail dispersion at Alpha listing, (3) ongoing 72h CEX-linked transfers. The rhythm shows accelerating distribution intensity peaking around the 2026-03-02 Alpha listing date.**

- Wave 1: Pre-launch OTC distribution (2025-12-19 ~ 2026-01-21 UTC): Deployer distributed 10B tokens to 16 insider wallets over 2025-12-19 to 2026-01-21. Largest single transfer: 9.5B tokens to 0x7d455713. This phase established the insider network.
- Wave 2: Distribution carriers → downstream (2025-12-22 ~ 2026-05-29 UTC): Insider carriers dispersed allocations to 30+ downstream wallets each, peaking on 2026-03-02 (Alpha listing date). Total dispersed: 10.95B tokens from 0x7d455713 alone. This represents the systematic retail distribution wave.
- Wave 3: Recent 72h anomalies (2026-06-20 ~ 2026-06-23 UTC): Recent 72h (2026-06-20 to 2026-06-23) shows 8 large transfers totaling ~$7.4M in value, primarily between Binance Cold Wallet (0x26209d9f) and intermediary 0x1ab4973a. This indicates active CEX-level repositioning and possible continued cash-out preparation.


<details>
<summary>📂 <strong>📊 Full anomaly event list (raw detail, grouped by distribution wave, UTC)</strong> — 3 distribution waves, 27 events total (click to expand the full timeline + wallet flows)</summary>

### 🟠 Wave 1: Pre-launch OTC distribution (2025-12-19 ~ 2026-01-21 UTC, **Completed**)

| Event ID | UTC | Ago | Source → Target | Nature | Amount |
|---|---|---|---|---|---|
| `evt_007` | 2026-01-21 08:20 | ~153 days ago (3687h) | Deployer `0x8dafd691…` → `0x7d455713…` | Pre-launch OTC distribution from deployer to insider wallet. Amount: 9,500,000,000 tokens. This is the initial token allocation phase. | 9,500,000,000 tokens |
| `evt_002` | 2025-12-19 09:56 | ~186 days ago (4478h) | Deployer `0x8dafd691…` → `0xfa0f1a7b…` | Pre-launch OTC distribution from deployer to insider wallet. Amount: 100,000,000 tokens. This is the initial token allocation phase. | 100,000,000 tokens |
| `evt_003` | 2025-12-22 02:21 | ~183 days ago (4413h) | Deployer `0x8dafd691…` → `0x61d8cff6…` | Pre-launch OTC distribution from deployer to insider wallet. Amount: 300,000,000 tokens. This is the initial token allocation phase. | 300,000,000 tokens |
| `evt_004` | 2025-12-22 02:21 | ~183 days ago (4413h) | Deployer `0x8dafd691…` → `0x60add99b…` | Pre-launch OTC distribution from deployer to insider wallet. Amount: 100,000,000 tokens. This is the initial token allocation phase. | 100,000,000 tokens |

### 🔴 Wave 2: Distribution carriers → downstream (2025-12-22 ~ 2026-05-29 UTC, **Completed — all major carriers have dispersed their allocations to downstream wallets. 6 carriers distributed to 30+ recipients each, creating wide retail dispersion.**)

| Event ID | UTC | Ago | Source → Target | Nature | Amount |
|---|---|---|---|---|---|
| `evt_008` | 2026-01-21 08:34 | ~153 days ago (3687h) | `0x7d455713…` → 30 recipient addresses | Mass distribution to 30+ downstream wallets (total 10,950,458,922 tokens). Indicates systematic retail dispersion from a carrier wallet. | total 10,950,458,922 tokens |
| `evt_079` | 2026-03-02 08:00 | ~113 days ago (2728h) | `0x238a3588…` → 30 recipient addresses | Mass distribution to 30+ downstream wallets (total 9,355,854,705 tokens). Indicates systematic retail dispersion from a carrier wallet. | total 9,355,854,705 tokens |
| `evt_146` | 2026-03-02 08:00 | ~113 days ago (2728h) | `0xb300000b…` → 30 recipient addresses | Mass distribution to 30+ downstream wallets (total 6,286,688,441 tokens). Indicates systematic retail dispersion from a carrier wallet. | total 6,286,688,441 tokens |
| `evt_176` | 2026-03-02 08:11 | ~113 days ago (2727h) | `0xf2a69b94…` → 4 recipient addresses | Targeted distribution to 4 wallets (total 1,321,829,266 tokens). Suggests structured allocation to specific recipients, possibly sub-insiders. | total 1,321,829,266 tokens |
| `evt_180` | 2026-03-02 08:50 | ~113 days ago (2727h) | `0xbd97306a…` → 11 recipient addresses | Single-recipient transfer (total 1,153,701,984 tokens). Likely a CEX deposit or OTC delivery to a specific buyer. | total 1,153,701,984 tokens |
| `evt_070` | 2026-03-02 08:02 | ~113 days ago (2727h) | `0x76d77531…` → 4 recipient addresses | Targeted distribution to 4 wallets (total 1,000,000,000 tokens). Suggests structured allocation to specific recipients, possibly sub-insiders. | total 1,000,000,000 tokens |
| `evt_111` | 2026-03-09 09:00 | ~106 days ago (2559h) | `0x9ee993d4…` → 1 recipient addresses | Single-recipient transfer (total 317,499,955 tokens). Likely a CEX deposit or OTC delivery to a specific buyer. | total 317,499,955 tokens |
| `evt_075` | 2026-03-02 10:31 | ~113 days ago (2725h) | `0xeb4abc20…` → 4 recipient addresses | Targeted distribution to 4 wallets (total 209,212,500 tokens). Suggests structured allocation to specific recipients, possibly sub-insiders. | total 209,212,500 tokens |
| `evt_068` | 2026-01-12 04:20 | ~162 days ago (3907h) | `0x61d8cff6…` → 2 recipient addresses | Dual-recipient transfer (total 169,000,090 tokens). Split distribution, possibly to CEX deposit + retail. | total 169,000,090 tokens |
| `evt_109` | 2026-03-02 09:00 | ~113 days ago (2727h) | `0xad9e8b57…` → 2 recipient addresses | Dual-recipient transfer (total 124,875,000 tokens). Split distribution, possibly to CEX deposit + retail. | total 124,875,000 tokens |
| `evt_074` | 2026-04-02 02:50 | ~82 days ago (1989h) | `0xcd3e5e5c…` → 1 recipient addresses | Single-recipient transfer (total 82,000,050 tokens). Likely a CEX deposit or OTC delivery to a specific buyer. | total 82,000,050 tokens |
| `evt_112` | 2026-05-29 10:22 | ~25 days ago (613h) | `0x93deb693…` → 3 recipient addresses | Insider downstream distribution (total 59,004,290 tokens). | total 59,004,290 tokens |
| `evt_115` | 2026-03-02 06:00 | ~113 days ago (2730h) | `0x7fcbd9d4…` → 1 recipient addresses | Single-recipient transfer (total 57,020,555 tokens). Likely a CEX deposit or OTC delivery to a specific buyer. | total 57,020,555 tokens |
| `evt_038` | 2025-12-22 10:01 | ~183 days ago (4405h) | `0xfa0f1a7b…` → 30 recipient addresses | Mass distribution to 30+ downstream wallets (total 96,361 tokens). Indicates systematic retail dispersion from a carrier wallet. | total 96,361 tokens |
| `evt_116` | 2026-03-02 08:15 | ~113 days ago (2727h) | `0x317cd61f…` → 30 recipient addresses | Mass distribution to 30+ downstream wallets (total 42,600 tokens). Indicates systematic retail dispersion from a carrier wallet. | total 42,600 tokens |

### 🔴 Wave 3: Recent 72h anomalies (2026-06-20 ~ 2026-06-23 UTC, **Active — 72h anomaly window shows continued large transfers between CEX-linked addresses.**)

| Event ID | UTC | Ago | Source → Target | Nature | Amount |
|---|---|---|---|---|---|
| `evt_191` | 2026-06-20 08:34 | ~3 days ago (87h) | `0x1ab4973a…` → `0x26209d9f…` | Large USD-value transfer ($2,524,131) involving Binance Cold Wallet address 0x26209d9f. Indicates CEX-level movement and potential exchange reserve rebalancing. | $2,524,131 |
| `evt_192` | 2026-06-22 02:46 | ~1 day ago (45h) | `0x26209d9f…` → `0x1ab4973a…` | Large USD-value transfer ($2,148,000) involving Binance Cold Wallet address 0x26209d9f. Indicates CEX-level movement and potential exchange reserve rebalancing. | $2,148,000 |
| `evt_193` | 2026-06-22 02:47 | ~1 day ago (45h) | `0x1ab4973a…` → `0x9493c8a5…` | Recent 72h anomaly: $1,074,000 transferred `0x1ab4973a…` → `0x9493c8a5…`. Large-value on-chain movement requiring monitoring. | $1,074,000 |
| `evt_194` | 2026-06-21 11:41 | ~2 days ago (60h) | `0x26209d9f…` → `0x1ab4973a…` | Large USD-value transfer ($1,074,000) involving Binance Cold Wallet address 0x26209d9f. Indicates CEX-level movement and potential exchange reserve rebalancing. | $1,074,000 |
| `evt_195` | 2026-06-23 04:34 | ~19h ago | `0x1ab4973a…` → `0x26209d9f…` | Large USD-value transfer ($643,506) involving Binance Cold Wallet address 0x26209d9f. Indicates CEX-level movement and potential exchange reserve rebalancing. | $643,506 |
| `evt_196` | 2026-06-22 03:05 | ~1 day ago (44h) | `0x3e148e08…` → `0x4982085c…` | Transfer ($537,000) to MEXC Hot Wallet address 0x4982085c. CEX inflow detected — possible deposit for selling. | $537,000 |
| `evt_197` | 2026-06-22 03:02 | ~1 day ago (44h) | `0x9493c8a5…` → `0x3e148e08…` | Recent 72h anomaly: $537,000 transferred `0x9493c8a5…` → `0x3e148e08…`. Large-value on-chain movement requiring monitoring. | $537,000 |
| `evt_198` | 2026-06-22 00:44 | ~1 day ago (47h) | `0x26209d9f…` → `0x1ab4973a…` | Large USD-value transfer ($429,600) involving Binance Cold Wallet address 0x26209d9f. Indicates CEX-level movement and potential exchange reserve rebalancing. | $429,600 |


</details>


## Primary chain (MULTI-CHAIN)

| Item | Value |
|---|---|
| **Primary chain** | **BSC** (BNB Chain) |
| Mint chain (supply_chain) | BSC, totalSupply 10,000,000,000 |
| Trading chain (trading_venue_chain) | BSC (Alpha + DEX main pool) |
| Cross-chain distribution | **Single chain, no cross-chain bridge found** (v0.6 phase B.3 minimal — BSC only) |
| Report coverage | **Full coverage** |

✅ No non-BSC chain data required.

**Interpretation**: BTW is a single-chain BSC token — mint, trading venue, and all on-chain activity occur on BNB Smart Chain. No cross-chain bridge activity was detected. An Ethereum contract address exists (0x3a63de35...) but the primary trading and forensic coverage is on BSC. Full coverage confirmed.

## Entry-price anchor (TGE)

| Time anchor | UTC | Price | vs current |
|---|---|---|---|
| LP creation first tx (DEX start) | 2026-03-02 08:00 UTC | — | — |
| Alpha first tx | 2026-03-02 08:00 UTC | — | — |
| **Current price** | 2026-06-24 | **$0.1074** | 1.00× |

**Interpretation**: LP creation and Alpha listing both occurred on 2026-03-02 08:00 UTC, approximately 114 days ago. Current price is $0.1074. The token has been trading for ~4 months. The deployer minted 10B tokens on 2025-12-19 and completed pre-launch distribution to 16 insiders by 2026-01-21, about 6 weeks before Alpha listing. This gap suggests ample time for insider positioning before public trading.

<a id="section-alloc"></a>
## Project allocation power (ALLOC)

| Item | Value | Source |
|---|---|---|
| Alpha quota (officially disclosed) | **Not disclosed** | Binance Alpha API does not expose this field |
| Deployer wallet `0x8dafd691…` current balance | Nearly empty (all distributed) | Deployer distribution trace |
| Pre-launch insider recipients 16 cumulative balance | 9,287,179,957 tokens (= 92.87% of supply) | Insider wallet sum |
| Quiet wallets 0 holding (core future risk) | **0 tokens (= 0.00% of supply / $0)** | Insiders that never distributed |
| Fully-distributed insiders 11 (distribution complete) | 100% distributed, 0 remaining | Insiders with ≥95% distributed |

**Interpretation**: The deployer (0x8dafd691) minted 10B tokens and distributed ALL to 16 insider addresses before launch. 11 of 16 insiders have fully distributed (dumped 100%). 4 are still distributing (82.8% of supply remains). Crucially, 0 quiet wallets exist — every insider has engaged in some distribution, meaning no dormant insider stash remains hidden. However, the 4 active distributors holding 82.8% represent the primary ongoing sell-pressure risk.

## Near-term CEX catalyst (CEX-TRACE)

| Exchange | Status | Time | Since |
|---|---|---|---|
| Binance | Listed | 2026-06-04 | ~19 days ago |
| Aster | Unverified | — | — |
| Bitget | Unverified | — | — |

No new catalyst within 14 days. Current S2 (Alpha + Binance Perps).

**Interpretation**: BTW is listed on Binance (S2 tier: Alpha + Binance Perps) since 2026-06-04 (~19 days ago). Aster and Bitget perp listings are unverified. No new CEX catalyst within 14 days. The confirmed CEX cash-out went through Bitget, not Binance — suggesting insiders may be using smaller exchanges for exit liquidity while Binance provides the primary trading venue.

<a id="section-liq"></a>
## Entry ceiling (LIQ)

| Anchor | Value | Note |
|---|---|---|
| **Max single buy under 5% slippage (estimated)** | $4,127 | Derived from Alpha 24h vol (vol_24h / 96 × 0.05 heuristic estimate) |
| DEX main pool liquidity | $81,875 | surf 0x94a177b1… |
| DEX main pool 24h volume | $35,243,445 | surf project-detail (cross-chain CEX+DEX realtime aggregation) |
| Pool token 24h net throughput (NOT LP add/remove) | -2.33% (in 1,962,664 / out 2,008,483) | surf agent.bsc_transfers |
| DEX main pool address | `0x94a177b18c83123e6b6202191dcdd092e5638fcb` | FDV $1,042,896,001 |

**Interpretation**: Liquidity is extremely thin: DEX main pool has only $81,875, 5% slippage cap is $4,127. The 24h volume of $35.2M is 432x the pool liquidity (vol/LP = 5.4×), which is only possible through high-frequency wash trading (448K on-chain matches). LP/mcap ratio is 0.005 — dangerously low. Pool token net throughput is -2.33% (slightly more outflow than inflow), indicating mild net selling pressure into the pool. A single large sell could cause severe price impact.

<a id="section-holdings"></a>
## Holdings distribution by role

**Distribution table**:

| Role | Wallet # | Current balance | % of supply | Top wallet |
|---|---|---|---|---|
| DEX main pool | 0 | 0 | —% | — |
| Deployer wallet | 0 | 0 | —% | — |
| Project / infra / distribution pool (vesting / multisig / treasury / DEX infra / CEX custody / 3rd-party distribution platform / retail claim pool, Arkham-verified) | 3 | 1,006,863,568 | 10.0686% | [`0xcd3e5e5c…`](https://bscscan.com/address/0xcd3e5e5ca176af4958ee33e346cc5ee93eca73d7) |
| Quiet wallet (insider, never distributed) | 0 | 0 | —% | — |
| Distributing wallet (insider) | 4 | 8,277,420,619 | 82.7742% | [`0x76d77531…`](https://bscscan.com/address/0x76d77531258b4dddfa4087e97a6c89bc0f0f1e50) |
| Fully distributed wallet (insider) | 1 | 1,660,860 | 0.0166% | [`0x317cd61f…`](https://bscscan.com/address/0x317cd61fa24e2e4068b4c47bd58d5fc9f4e7a12b) |
| Retail recipient (distribution downstream) | 11 | 106,244,049 | 1.0624% | [`0x87dc0e03…`](https://bscscan.com/address/0x87dc0e03e7ac509cd4500b18a3d104be1c9b1383) |
| Other (retail + unclassified) | 31 | 588,445,344 | 5.8845% | [`0x26209d9f…`](https://bscscan.com/address/0x26209d9f0dc3ac0129c3fb1badabfeb9ee728c66) |

**Key takeaways**:
- Insider tree: **16** wallets hold **92.9%** of supply cumulatively, of which 11 fully distributed (each ≈ 0) · 5 distributing · 0 near-zero holdings.
- Insiders have on-chain-confirmed outflow of **25.8M USD** = **12.68%** of circulating, priced at the insider self-sell TWAP (not the wash quote).

<details>
<summary>📂 <strong>Backward trace (Deployer → insider lineage)</strong> — 16 insider wallets: 11 fully distributed / 5 distributing / 0 quiet (click to expand the full lineage + wallet balances + distribution rate)</summary>

**Insider wallet list (deployer distribution trace)**:

| ID | Address | Received from deployer | Current balance | Dumped % |
|---|---|---|---|---|
| `m6_003` | [`0x7d455713`](https://bscscan.com/address/0x7d455713a6e14967fa145c7f5204122aebfd9256) | 9,500,000,000 | -0 | 100.0% |
| `m6_004` | [`0xfa0f1a7b`](https://bscscan.com/address/0xfa0f1a7bf2b5f8ae783b7c3d8b9f1350d5665c90) | 100,000,000 | 70,802 | 99.9% |
| `m6_002` | [`0x61d8cff6`](https://bscscan.com/address/0x61d8cff69ed737d7a937bbcf72e02cd1639ac9b4) | 300,000,000 | 130,999,910 | 56.3% |
| `m6_001` | [`0x60add99b`](https://bscscan.com/address/0x60add99bc0a85c5f67e16ef0c45fb600d50855ad) | 100,000,000 | 96,417,849 | 3.6% |
| `m6_005` | [`0x76d77531`](https://bscscan.com/address/0x76d77531258b4dddfa4087e97a6c89bc0f0f1e50) | 9,000,000,000 | 8,000,000,000 | 11.1% |
| `m6_006` | [`0xcd3e5e5c`](https://bscscan.com/address/0xcd3e5e5ca176af4958ee33e346cc5ee93eca73d7) | 1,084,354,716 | 1,002,354,766 | 7.6% |
| `m6_007` | [`0xeb4abc20`](https://bscscan.com/address/0xeb4abc2093d741f87583da386b9d3969f4b9abab) | 200,000,000 | 0 | 100.0% |
| `m6_008` | [`0x238a3588`](https://bscscan.com/address/0x238a358808379702088667322f80ac48bad5e6c4) | 178,703,442 | 2,718,936 | 98.5% |
| `m6_009` | [`0xad9e8b57`](https://bscscan.com/address/0xad9e8b579fb959fefadee1e431e0f608d5e0936d) | 125,000,000 | 125,000 | 99.9% |
| `m6_010` | [`0x9ee993d4`](https://bscscan.com/address/0x9ee993d478b3d5ee679727b0237e353ad4746eed) | 120,000,000 | 0 | 100.0% |
| `m6_011` | [`0x93deb693`](https://bscscan.com/address/0x93deb693b170d56bdde1b0a5222b14c0f885d976) | 109,000,000 | 50,002,860 | 54.1% |
| `m6_012` | [`0x7fcbd9d4`](https://bscscan.com/address/0x7fcbd9d429932a11884cb5ce9c61055b369f56f7) | 60,000,090 | 2,979,535 | 95.0% |
| `m6_013` | [`0x317cd61f`](https://bscscan.com/address/0x317cd61fa24e2e4068b4c47bd58d5fc9f4e7a12b) | 50,000,000 | 2,232,020 | 95.5% |
| `m6_014` | [`0xb300000b`](https://bscscan.com/address/0xb300000b72deaeb607a12d5f54773d1c19c7028d) | 2,725,961,412 | -14,142 | 100.0% |
| `m6_015` | [`0xf2a69b94`](https://bscscan.com/address/0xf2a69b94d3c7f2d2c35e8f44a94b42e5bf486ed8) | 1,320,651,473 | -638,414 | 100.0% |
| `m6_016` | [`0xbd97306a`](https://bscscan.com/address/0xbd97306a087ed0c46b783cfbfdcdc6c12c7a2866) | 719,134,668 | -69,165 | 100.0% |
_Stats (full m6 lineage, **16** wallets): 0 near-zero holdings / public-lockup custody · 5 distributing · 11 fully distributed_

**m4_notes (pre-LP allocation interpretation)**:
- Deployer distribution trace: deployer wallet 0x8dafd691... minted 10,000,000,000 tokens at 2025-12-19 07:39, then pre-launch distributed 10,000,000,000 to 16 insider addresses. 0 quiet wallets (never distributed) collectively hold 0 tokens.
- Of 16 pre-launch insider recipients, 11 have fully distributed their allocations (dumped ≥95%), 4 are still actively distributing (0x76d77531 at 11%, 0x60add99b at 4%, 0xcd3e5e5c at 8%, 0x61d8cff6 at 56%), and 1 has partially distributed (0x93deb693 at 54%). The largest single recipient 0x7d455713 received 9.5B tokens and has fully distributed. The second-largest 0x76d77531 received 9B tokens and has only distributed 11% — this is the primary future sell-pressure source.
- Infrastructure wallets (Gnosis Safe, PancakeSwap Vault, Binance Wallet, DEX Router) received ~1.57B tokens combined and are classified as project/infra, not operator-controlled chips. These are excluded from the operator-control percentage, resulting in 0% operator-controlled chips. The real risk is from the 4 distributing wallets holding 82.8%.



**⚠️ Step4 budget-cap truncation (data gap — conclusion is a lower bound)**: the dispersal tree is wider than the step4 recursion budget (default 12); the largest sub-dumpers were expanded and **35 additional sub-dumpers (~12,201,798,575 tokens cumulative) were not recursively expanded**. The current verdict is based on the expanded portion and is a **lower bound** — the real operator network may be deeper.
_Action: this is a budget truncation, not a surf failure. For full depth, re-run with `BINANCE_ALPHA_STEP4_MAX_DUMPERS=40`._

</details>

## 💰 High-Value Address Funding Source (mint / DEX / P2P)

Below are the high-value addresses already surfaced by the wash setup / flow operator / m6 insider / Top-30 holder sections, classified by how they ACQUIRED their tokens over the past 365 days: mint (received directly from 0x0 — covers mining contracts, bridge mint authorities, airdrop mint contracts), DEX buy (received from a known DEX main pool), or P2P (any other EOA transfer, including unidentified CEX withdrawals). Use this to distinguish: ⛏️ high mint% = mining-token operator or sockpuppet airdrop farmer; 🟢 high DEX% = real retail buyer; 🔵 high P2P% = operator aggregation hub or OTC recipient.

> Queried 200 high-value addresses; 30 have real incoming activity in the past 365 days — ⛏️ Mint-fed 0 / 🟢 DEX-fed 9 / 🔵 P2P-fed 21.


| Address | Primary Source | Total Received | Mint % | DEX buy % | P2P % |
|---|---|---:|---:|---:|---:|
| [`0x238a3588…`](https://bscscan.com/address/0x238a358808379702088667322f80ac48bad5e6c4) | 🔵 P2P-fed | 11,200,036,391 | 0.0% | 0.0% | 100.0% |
| [`0x7d455713…`](https://bscscan.com/address/0x7d455713a6e14967fa145c7f5204122aebfd9256) | 🔵 P2P-fed | 10,950,460,022 | 0.0% | 0.3% | 99.7% |
| [`0x76d77531…`](https://bscscan.com/address/0x76d77531258b4dddfa4087e97a6c89bc0f0f1e50) | 🔵 P2P-fed | 9,000,000,000 | 0.0% | 0.0% | 100.0% |
| [`0xb300000b…`](https://bscscan.com/address/0xb300000b72deaeb607a12d5f54773d1c19c7028d) | 🔵 P2P-fed | 6,332,609,538 | 0.0% | 43.0% | 57.0% |
| [`0xf2a69b94…`](https://bscscan.com/address/0xf2a69b94d3c7f2d2c35e8f44a94b42e5bf486ed8) | 🟢 DEX-buy-fed | 1,321,190,852 | 0.0% | 100.0% | 0.0% |
| [`0xbd97306a…`](https://bscscan.com/address/0xbd97306a087ed0c46b783cfbfdcdc6c12c7a2866) | 🟢 DEX-buy-fed | 1,153,632,819 | 0.0% | 62.3% | 37.7% |
| [`0xcd3e5e5c…`](https://bscscan.com/address/0xcd3e5e5ca176af4958ee33e346cc5ee93eca73d7) | 🔵 P2P-fed | 1,084,354,816 | 0.0% | 0.0% | 100.0% |
| [`0x9ee993d4…`](https://bscscan.com/address/0x9ee993d478b3d5ee679727b0237e353ad4746eed) | 🔵 P2P-fed | 317,499,955 | 0.0% | 0.0% | 100.0% |
| [`0x61d8cff6…`](https://bscscan.com/address/0x61d8cff69ed737d7a937bbcf72e02cd1639ac9b4) | 🔵 P2P-fed | 300,000,000 | 0.0% | 0.0% | 100.0% |
| [`0xeb4abc20…`](https://bscscan.com/address/0xeb4abc2093d741f87583da386b9d3969f4b9abab) | 🔵 P2P-fed | 209,212,500 | 0.0% | 0.0% | 100.0% |
| [`0x9999b0cd…`](https://bscscan.com/address/0x9999b0cdd35d7f3b281ba02efc0d228486940515) | 🔵 P2P-fed | 132,524,529 | 0.0% | 44.4% | 55.6% |
| [`0xad9e8b57…`](https://bscscan.com/address/0xad9e8b579fb959fefadee1e431e0f608d5e0936d) | 🔵 P2P-fed | 125,000,000 | 0.0% | 0.0% | 100.0% |
| [`0x93deb693…`](https://bscscan.com/address/0x93deb693b170d56bdde1b0a5222b14c0f885d976) | 🔵 P2P-fed | 109,007,150 | 0.0% | 0.0% | 100.0% |
| [`0xfa0f1a7b…`](https://bscscan.com/address/0xfa0f1a7bf2b5f8ae783b7c3d8b9f1350d5665c90) | 🔵 P2P-fed | 100,000,000 | 0.0% | 0.0% | 100.0% |
| [`0x60add99b…`](https://bscscan.com/address/0x60add99bc0a85c5f67e16ef0c45fb600d50855ad) | 🔵 P2P-fed | 100,000,000 | 0.0% | 0.0% | 100.0% |
| [`0x09f39770…`](https://bscscan.com/address/0x09f3977040a58b1ab4d87cb2345f4a7e775af169) | 🟢 DEX-buy-fed | 60,840,557 | 0.0% | 52.6% | 47.4% |
| [`0x7fcbd9d4…`](https://bscscan.com/address/0x7fcbd9d429932a11884cb5ce9c61055b369f56f7) | 🔵 P2P-fed | 60,000,090 | 0.0% | 0.0% | 100.0% |
| [`0x317cd61f…`](https://bscscan.com/address/0x317cd61fa24e2e4068b4c47bd58d5fc9f4e7a12b) | 🔵 P2P-fed | 59,000,000 | 0.0% | 0.0% | 100.0% |
| [`0x157a82ea…`](https://bscscan.com/address/0x157a82eaa7ecd25328aeca1b901f82e886498f9f) | 🟢 DEX-buy-fed | 21,738,511 | 0.0% | 100.0% | 0.0% |
| [`0x12d2b8ac…`](https://bscscan.com/address/0x12d2b8ac38c59758a062a9f757f2740461779439) | 🔵 P2P-fed | 18,474,360 | 0.0% | 46.8% | 53.2% |
| [`0x0f0067cd…`](https://bscscan.com/address/0x0f0067cd819cb8f20bda62046daff7a2b5c88280) | 🟢 DEX-buy-fed | 7,562,650 | 0.0% | 57.0% | 43.0% |
| [`0x8d91fe87…`](https://bscscan.com/address/0x8d91fe87524b39df2b5684739a95ae151ab21fc1) | 🟢 DEX-buy-fed | 6,602,428 | 0.0% | 98.9% | 1.1% |
| [`0xb127edd5…`](https://bscscan.com/address/0xb127edd581529393d15a5c1b06c565e5a006e941) | 🟢 DEX-buy-fed | 5,874,095 | 0.0% | 100.0% | 0.0% |
| [`0xc9220831…`](https://bscscan.com/address/0xc92208319a6602c8c74b6576d8e1335368fc4d52) | 🟢 DEX-buy-fed | 5,187,879 | 0.0% | 100.0% | 0.0% |
| [`0x8c5ff004…`](https://bscscan.com/address/0x8c5ff004d2bc097a507082f195929c95ebf0d790) | 🔵 P2P-fed | 1,835,408 | 0.0% | 0.0% | 100.0% |
| [`0xcae214dc…`](https://bscscan.com/address/0xcae214dcc97572152a667d7c9c06b39d7790efea) | 🔵 P2P-fed | 1,812,628 | 0.0% | 0.0% | 100.0% |
| [`0x7b9d43ef…`](https://bscscan.com/address/0x7b9d43ef9d740bc6b6e593e1fc7c4b910a75fd00) | 🔵 P2P-fed | 1,622,995 | 0.0% | 0.0% | 100.0% |
| [`0xcbb56eb6…`](https://bscscan.com/address/0xcbb56eb6eb12da918de1fff49ceb09bb7cbfc130) | 🔵 P2P-fed | 1,577,368 | 0.0% | 0.0% | 100.0% |
| [`0x324e559d…`](https://bscscan.com/address/0x324e559d0f7507c4782f54662b09b984b1874094) | 🔵 P2P-fed | 1,000,064 | 0.0% | 0.0% | 100.0% |
| [`0xe2228e89…`](https://bscscan.com/address/0xe2228e892aae78fffd5f27d158074e888b72b5b9) | 🟢 DEX-buy-fed | 18 | 0.0% | 76.3% | 23.7% |

> _Scan cap: the pipeline collected 237 high-value candidates, max_addrs cap = 200, actually queried 200 (ordered by detector priority: wash → flow → m6 → dump-sellers → Top-30 holders). Truncated 37 — common on PLAY-class tokens with many (60+) flow_operators._

> _The CEX-withdrawal column is not yet separately identified (a v0.7.24 candidate) and is currently grouped under P2P. When a real CEX hot-wallet transfer cannot be distinguished from a plain EOA transfer, both count as P2P._



<a id="section-bridge-mint"></a>
### 🌉 Bridge / mint-authority self-sell detail (v0.7.24a)

> Detected **0 mint-authority contracts** (receive mint from 0x0, excluding the deployer + wallets already covered in the mining-fed section). They are bridge / staking / airdrop contracts that may **themselves** DEX swap. This is a dump path the v0.7.23.x series missed entirely.

| Authority address | Arkham label | 365d Mint amount | % of supply | Own DEX sell | USD ≈ |
|---|---|---:|---:|---|---:|





<a id="section-high-throughput"></a>
### 🌊 High-throughput dump wallets (v0.7.24b)

> Detected **100 operator wallets** with a high-throughput clear-out pattern (large token flow-through + balance ≈ 0 + high-frequency tx). Thresholds: throughput 1M ~ 5% of supply, balance < 5% of throughput, n_tx ≥ 1000. Already filtered out infra labels like DEX routers / CEX deposits / aggregators (not operators). These are operators that finished dumping and left before the 60d window — missed by flow_operators (60d window) + mining-fed (balance > threshold).

| Operator address | Primary role | Arkham label | 365d inflow (= received mint/p2p) | Outflow (= sold / transferred out) | Residual balance | tx count |
|---|---|---|---:|---:|---:|---:|
| [`0x2e8fc72e46d1…`](https://bscscan.com/address/0x2e8fc72e46d1c6584bf7c66b673c99cbfa3a882c) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 470,332,814 | 470,332,814 | 0 | 99,022 |
| [`0x653dd7677aea…`](https://bscscan.com/address/0x653dd7677aea3030eab68c97ed3594bacf560158) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 460,542,588 | 460,519,826 | 22,763 | 20,070 |
| [`0xb7697d225fa3…`](https://bscscan.com/address/0xb7697d225fa34bf1ebd3413adfa1c35b1be74729) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 437,177,349 | 437,177,349 | 0 | 31,760 |
| [`0x238a35880837…`](https://bscscan.com/address/0x238a358808379702088667322f80ac48bad5e6c4) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 427,165,754 | 427,981,098 | -815,343 | 892,075 |
| [`0xbeb2c2171e3d…`](https://bscscan.com/address/0xbeb2c2171e3d9086aca86c785a69bb5bfdd5c5a5) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 354,257,593 | 354,257,593 | 0 | 167,177 |
| [`0xbd97306a087e…`](https://bscscan.com/address/0xbd97306a087ed0c46b783cfbfdcdc6c12c7a2866) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 344,584,301 | 344,878,978 | -294,677 | 478,844 |
| [`0x286da9568057…`](https://bscscan.com/address/0x286da9568057420df90c5489e51cbb82b29f0301) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 338,579,449 | 338,899,789 | -320,340 | 105,580 |
| [`0x5c9450ad619c…`](https://bscscan.com/address/0x5c9450ad619cf7e8a123c0f4af8f92044c1c66cf) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 336,506,664 | 336,506,664 | 0 | 24,015 |
| [`0xd060a0193a72…`](https://bscscan.com/address/0xd060a0193a72ba809149476cec1ca865a887ec91) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 266,487,425 | 266,487,425 | 0 | 24,812 |
| [`0x22f8326cf3da…`](https://bscscan.com/address/0x22f8326cf3da32e36d3d2df911def876b7be486f) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 262,526,137 | 262,526,137 | 0 | 79,808 |
| [`0x031942f26a09…`](https://bscscan.com/address/0x031942f26a094be40414f442a2f1295e3a5c1680) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 242,362,463 | 242,041,320 | 321,144 | 48,093 |
| [`0x94a177b18c83…`](https://bscscan.com/address/0x94a177b18c83123e6b6202191dcdd092e5638fcb) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 237,614,945 | 237,220,053 | 394,892 | 214,587 |
| [`0x278d858f05b9…`](https://bscscan.com/address/0x278d858f05b94576c1e6f73285886876ff6ef8d2) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 236,839,890 | 236,687,273 | 152,617 | 295,952 |
| [`0x0303e4fe3d5a…`](https://bscscan.com/address/0x0303e4fe3d5a3d4f225e7690f038786648657b2b) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 225,205,208 | 224,569,054 | 636,153 | 8,741 |
| [`0xc477032db5cc…`](https://bscscan.com/address/0xc477032db5ccbea767fa74ab76556ba15a06de5b) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 216,282,043 | 216,282,043 | 0 | 1,378 |
| [`0xc383960159d5…`](https://bscscan.com/address/0xc383960159d5c5f6ad9bbc6519a9e1937ca58046) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 214,852,305 | 214,836,756 | 15,549 | 21,851 |
| [`0xd7b4cc3aff43…`](https://bscscan.com/address/0xd7b4cc3aff43736b2ec0a322948e9792920b4d82) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 210,342,899 | 210,342,899 | -0 | 1,478 |
| [`0xda35d6bd48e8…`](https://bscscan.com/address/0xda35d6bd48e8552c422ae4c8308559aaddcf37c3) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 189,106,482 | 188,656,013 | 450,469 | 1,870 |
| [`0x055a3b37957b…`](https://bscscan.com/address/0x055a3b37957bfbd3345bed9968e7e8dd56d67066) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 187,925,843 | 187,837,473 | 88,370 | 15,947 |
| [`0x1231deb6f574…`](https://bscscan.com/address/0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae) | 🌊 HT operator (primary) | _Unlabeled (EOA / not indexed) | 173,700,629 | 173,700,629 | -0 | 27,666 |

> _Showing top 20; 100 high-throughput operator wallets detected in total (sorted by throughput; throughput = token in/out flow, NOT sell volume). Full list in skeleton.json `funding_attribution.high_throughput_dumpers.dumpers`._

> 🌊 These wallets passed **9,589,667,129 tokens** through over 365d then cleared out — operators that have finished dumping. They've already sold, but **if the project mints another batch and distributes it to similar-pattern wallets in future**, they become the next dump-risk source.




### 🔗 Cross-chain dump trace (v0.7.24c)

> Detected that this token is deployed on multiple chains. The primary chain's (BSC) dump activity already surfaced in earlier sections; here we show **other chains'** dump activity. The earlier v0.7.23.x single-chain forensic missed cross-chain entirely.


#### 🔗 ETHEREUM (CA: [`0x3a63de3572c6…`](https://bscscan.com/address/0x3a63de3572c69a1307ff08394f3ee7702c16d25d))

> ⏭️ **ethereum skipped** — 0 DEX pools on this chain — no market to forensic.



> _💡 This section only surfaces what the current detectors could fetch cross-chain. For the real cross-chain dump magnitude, combine with on-chain explorers like Etherscan / Bscscan / Arbiscan._


<a id="section-wallet-cluster-graph"></a>
## 🌐 Wallet-graph clusters (v0.8.6.5)

> **Wallet ↔ wallet direct-transfer graph clusters** — operator clusters that bypass CEX, mint, and the m6 lineage. Bubblemaps-style algorithm: high-value transfers between candidate wallets (≥0.5% supply per edge) form connected components ≥ 3 nodes. Uses undirected 2-core pruning to exclude single-edge false positives.| Metric | Value |
|---|---|
| Clusters detected | **1** |
| Total cluster wallets | **10** |
| Candidate wallets input | 101 |
| Excluded by L1 Arkham filter | 0 |
| Total graph edges | 44 |
| Newly discovered (not master_cluster) | 0 |
| SQL chunks run | 1 |

#### 🌐 Cluster 1: 10 wallets

| Field | Value |
|---|---|
| cluster wallets | 10 |
| edge count | 14 |
| Total transfer weight | 2,458,884,378 tokens |
| Max edge weight | 470,332,814 tokens |
| Cluster current total holdings | 2,712,494 tokens |
| Arkham UNLABELED % | 100% |
| Source distribution | master_cluster: 10 |

**Cluster wallets (sorted by transfer weight)**:

| # | Recipient wallet | Current balance (tokens) |
|---:|---|---:|
| 1 | [`0x238a35880837`](https://bscscan.com/address/0x238a358808379702088667322f80ac48bad5e6c4) | 2,718,936 |
| 2 | [`0x2e8fc72e46d1`](https://bscscan.com/address/0x2e8fc72e46d1c6584bf7c66b673c99cbfa3a882c) | 0 |
| 3 | [`0x286da9568057`](https://bscscan.com/address/0x286da9568057420df90c5489e51cbb82b29f0301) | -320,340 |
| 4 | [`0x031942f26a09`](https://bscscan.com/address/0x031942f26a094be40414f442a2f1295e3a5c1680) | 321,144 |
| 5 | [`0xc383960159d5`](https://bscscan.com/address/0xc383960159d5c5f6ad9bbc6519a9e1937ca58046) | -7,275 |
| 6 | [`0xdfd97c55f95e`](https://bscscan.com/address/0xdfd97c55f95e8c1bf652b3b43b4facaf8ad53489) | 0 |
| 7 | [`0x507b7c70752e`](https://bscscan.com/address/0x507b7c70752e2fa98dc5360f844fa289f6177c93) | 0 |
| 8 | [`0x144d395b5562`](https://bscscan.com/address/0x144d395b5562c742259932d2ee6e1d8d092a21b8) | 29 |
| 9 | [`0x723508dd8275`](https://bscscan.com/address/0x723508dd82759d8350fcf96eed43b9d8801caadb) | 0 |
| 10 | [`0x25af352f4490`](https://bscscan.com/address/0x25af352f4490cb40f12bd5a881bdd99838cc9c14) | 0 |

<a id="section-monitoring"></a>
## Monitored wallets + real-time alerts


> 📊 **Monitoring priority (v0.7.27 deterministic ranker)**: 🚨 1 CRITICAL · 🔥 3 HIGH · 👀 9 NORMAL · 💤 10 NOT_TRACKED (not exported to paste.json)>
> Wallets in paste.json are sorted by level, 🚨 first. Prioritize CRITICAL+HIGH (4) — when these wallets move, the on-chain detection picture changes. NORMAL (9) is for bulk cross-checking, no push notification needed. 💤 NOT_TRACKED are DEX routers / public CEX hot wallets whose flow noise drowns the real signal, removed from paste.

_(the report shows only the top 10; for all 23 wallets use `monitoring/monitoring_paste.json` to one-click paste into Binance Wallet / OKX monitoring)_

| # | Level | Wallet | Role | primary role section | Trigger condition | Status |
|---|:-:|---|---|---|---|---|
| 1 | 💤 NOT_TRACKED | [`0x8dafd691`](https://bscscan.com/address/0x8dafd691ef82f90b23fddb10a67d782f04073bd3) | Deployer wallet | [Project allocation power (ALLOC)](#section-alloc) | Not exported to paste.json (infrastructure / public wallet, flow too high) | 🟡 |
| 2 | 💤 NOT_TRACKED | [`0x7d455713`](https://bscscan.com/address/0x7d455713a6e14967fa145c7f5204122aebfd9256) | Fully distributed wallet (dumped 100%) | [📌 Monitored wallets](#section-monitoring) | Not exported to paste.json (infrastructure / public wallet, flow too high) | 🟢 |
| 3 | 💤 NOT_TRACKED | [`0xfa0f1a7b`](https://bscscan.com/address/0xfa0f1a7bf2b5f8ae783b7c3d8b9f1350d5665c90) | Fully distributed wallet (dumped 100%) | [📌 Monitored wallets](#section-monitoring) | Not exported to paste.json (infrastructure / public wallet, flow too high) | 🟢 |
| 4 | 👀 NORMAL | [`0x61d8cff6`](https://bscscan.com/address/0x61d8cff69ed737d7a937bbcf72e02cd1639ac9b4) | Distributing wallet (dumped 56%) | [📌 Monitored wallets](#section-monitoring) | Listed in bulk for cross-checking, low priority | 🟠 |
| 5 | 👀 NORMAL | [`0x60add99b`](https://bscscan.com/address/0x60add99bc0a85c5f67e16ef0c45fb600d50855ad) | Distributing wallet (dumped 4%) | [📌 Monitored wallets](#section-monitoring) | Listed in bulk for cross-checking, low priority | 🟠 |
| 6 | 🔥 HIGH | [`0x76d77531`](https://bscscan.com/address/0x76d77531258b4dddfa4087e97a6c89bc0f0f1e50) | Distributing wallet (dumped 11%) | [📌 Monitored wallets](#section-monitoring) | On-chain behaviour reference: large (≥ $10k) transfer into a DEX router / CEX deposit address | 🟠 |
| 7 | 👀 NORMAL | [`0xcd3e5e5c`](https://bscscan.com/address/0xcd3e5e5ca176af4958ee33e346cc5ee93eca73d7) | Distributing wallet (dumped 8%) | [📌 Monitored wallets](#section-monitoring) | Listed in bulk for cross-checking, low priority | 🟠 |
| 8 | 💤 NOT_TRACKED | [`0xeb4abc20`](https://bscscan.com/address/0xeb4abc2093d741f87583da386b9d3969f4b9abab) | Fully distributed wallet (dumped 100%) | [📌 Monitored wallets](#section-monitoring) | Not exported to paste.json (infrastructure / public wallet, flow too high) | 🟢 |
| 9 | 👀 NORMAL | [`0x238a3588`](https://bscscan.com/address/0x238a358808379702088667322f80ac48bad5e6c4) | Fully distributed wallet (dumped 98%) | [🌊 High-throughput dump wallet](#section-high-throughput) | Listed in bulk for cross-checking, low priority | 🟢 |
| 10 | 💤 NOT_TRACKED | [`0xad9e8b57`](https://bscscan.com/address/0xad9e8b579fb959fefadee1e431e0f608d5e0936d) | Fully distributed wallet (dumped 100%) | [📌 Monitored wallets](#section-monitoring) | Not exported to paste.json (infrastructure / public wallet, flow too high) | 🟢 |

16 wallets tracked from the forensic. Priority wallets: 0x76d77531 (8B tokens, only 11% dumped — highest risk), 0x71720ef1 (2B tokens, heuristically flagged hidden operator ammo reserve, CRITICAL), 0x61d8cff6 (131M tokens, 56% dumped), and recent 72h anomaly participants 0x00debf90 and 0x09f39770 (HIGH). Import monitoring_paste.json into Binance Wallet or OKX for real-time alerts.

## 🗺️ Multi-role address index (cross-section index, v0.7.28)

> The table below lists wallets that appear in ≥2 detector sections. Retail readers seeing "the same address N times" won't mistake it for N different wallets. AI re-interpretation can get cross-role context without following anchors.

| Recipient wallet | Primary role section | All matched roles |
|---|---|---|
| [`0x00debf90`](https://bscscan.com/address/0x00debf90dde729b59602ee90e9dc945e010af465) | [🌊 High-throughput dump wallet](#section-high-throughput) | high-throughput dump operator, other |
| [`0x238a3588`](https://bscscan.com/address/0x238a358808379702088667322f80ac48bad5e6c4) | [🌊 High-throughput dump wallet](#section-high-throughput) | high-throughput dump operator, other |
| [`0xbd97306a`](https://bscscan.com/address/0xbd97306a087ed0c46b783cfbfdcdc6c12c7a2866) | [🌊 High-throughput dump wallet](#section-high-throughput) | high-throughput dump operator, other |
| [`0x09f39770`](https://bscscan.com/address/0x09f3977040a58b1ab4d87cb2345f4a7e775af169) | [🌊 High-throughput dump wallet](#section-high-throughput) | high-throughput dump operator, other |
| [`0x8dafd691`](https://bscscan.com/address/0x8dafd691ef82f90b23fddb10a67d782f04073bd3) | [Project allocation power (ALLOC)](#section-alloc) | deployer, other |

> _5 multi-role addresses total; the table shows the top 30 by number of matched roles. Full index in the `address_role_index` field of the machine-readable JSON below._

## Machine-readable JSON (compact)

```json
{
  "schema_version": "1.0.5",
  "symbol": "BTW",
  "verdict": "EXIT_IF_HOLDING",
  "verdict_zh": "Exit if holding",
  "verdict_downgrade_applied": 1,
  "chain_state": "RECENT_DISTRIBUTION",
  "chain_state_label": "Recent 72h on-chain activity — 100 large transfers",
  "chain_state_risk_score": 10,
  "alpha_listing_tier": "S2",
  "any_anomaly_firing": true,
  "render_provenance": {
    "rendered_by": "render_report.py (v0.6, jinja2)",
    "data_source": "report_data.json (LLM-filled, Python-validated)",
    "deterministic": true
  },
  "structural_counts": {
    "anomaly_waves": 3,
    "evidence_graph_entries": 346,
    "holdings_role_rows": 8,
    "holdings_progress_bars": 8,
    "monitoring_wallets": 23,
    "lineage_flowchart_nodes": 40,
    "lineage_flowchart_edges": 53,
    "m6_rows": 16,
    "decision_anchors": 3,
    "decision_re_entry_conditions": 1
  },
  "address_role_index": {
    "0xeb4abc2093d741f87583da386b9d3969f4b9abab": {
      "primary_role": "other",
      "all_roles": \[
        "other"
      \],
      "primary_section_anchor": "section-monitoring"
    },
    "0xbeb2c2171e3d9086aca86c785a69bb5bfdd5c5a5": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x71d98d3db374f2b865eb7da5f85d0079ea2f78f0": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x00000000214b106a4d67113a969ab6e7a56cfb0d": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x8f10b468b06c6fd214b65f87778827f7d113f996": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x031942f26a094be40414f442a2f1295e3a5c1680": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x286da9568057420df90c5489e51cbb82b29f0301": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xaa86268030aae432ac471f220080ba3e46b52b43": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x94a177b18c83123e6b6202191dcdd092e5638fcb": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xc477032db5ccbea767fa74ab76556ba15a06de5b": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x7d455713a6e14967fa145c7f5204122aebfd9256": {
      "primary_role": "other",
      "all_roles": \[
        "other"
      \],
      "primary_section_anchor": "section-monitoring"
    },
    "0xf2a69b94d3c7f2d2c35e8f44a94b42e5bf486ed8": {
      "primary_role": "other",
      "all_roles": \[
        "other"
      \],
      "primary_section_anchor": "section-monitoring"
    },
    "0x317cd61fa24e2e4068b4c47bd58d5fc9f4e7a12b": {
      "primary_role": "other",
      "all_roles": \[
        "other"
      \],
      "primary_section_anchor": "section-monitoring"
    },
    "0xdb29e288824777f32a4c8dce921f4255da6f8ebc": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x6ec512ccdf675364a27e6117d413bb71eeaaf098": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x097fd934ce9124fe6aec6dd325108b34986770d1": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xc3080ec4306d2a7316f01f3d29e1e58c85fa195b": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x9999b0cdd35d7f3b281ba02efc0d228486940515": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x2e8fc72e46d1c6584bf7c66b673c99cbfa3a882c": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xb5dc8c684a81ac3d25c08a68e5bcb166ef18ae6a": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x7a2c0fff9d8ec24eb6ec6c3ea05d55aafeb933f2": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x885cf41e07fb25f99fb239abed9729ed66376777": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x723508dd82759d8350fcf96eed43b9d8801caadb": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x653dd7677aea3030eab68c97ed3594bacf560158": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x6843e9d53af732985e9af951f7f167ecec3a9fb0": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xb7697d225fa34bf1ebd3413adfa1c35b1be74729": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xd060a0193a72ba809149476cec1ca865a887ec91": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x5c9450ad619cf7e8a123c0f4af8f92044c1c66cf": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xfa74192e5691b6e141711d1374442f3c997ccfdd": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xe94753d6e067d25e0dbe90ed782b7ea21475fc48": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x12d2b8ac38c59758a062a9f757f2740461779439": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x9bbab50219e5ab3fb66c5561d64b6ddd518ae24f": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xd60192432e14dfe4701f588b2aa4a44a98ec6b56": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x072e987662b03726b28c28eb56c7a28c38f1ffd5": {
      "primary_role": "other",
      "all_roles": \[
        "other"
      \],
      "primary_section_anchor": "section-monitoring"
    },
    "0x2480faeb931272cd1f7375d8f4c104a4db5fff63": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x18170512967fe8239cd78ed21778e2ec9d63468b": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x03631c388fb01e0d929627b614eeb501c0ef9dce": {
      "primary_role": "other",
      "all_roles": \[
        "other"
      \],
      "primary_section_anchor": "section-monitoring"
    },
    "0x593980c50a2b838a706d124881085635bc39f97e": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xce434b0ae521d84022096ac7b286b32d1301928d": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xb5576ee3feaa4347b53c2c5caa700fa922f99dfe": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x00debf90dde729b59602ee90e9dc945e010af465": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator",
        "other"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x0303e4fe3d5a3d4f225e7690f038786648657b2b": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x31d6ea082acc3d4e377528a721ac5c4b891726fb": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x144d395b5562c742259932d2ee6e1d8d092a21b8": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xf7b5a9b7ef764606f900c9c1db39afc682049bc4": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x0f0067cd819cb8f20bda62046daff7a2b5c88280": {
      "primary_role": "other",
      "all_roles": \[
        "other"
      \],
      "primary_section_anchor": "section-monitoring"
    },
    "0x0501f595d17dd90ff11a9873692ee3f8d478f4e5": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xf45ecc0b00283c607f2f6e93425e4b9f8e7488d8": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x2331efad6d375e6978b52957307bd47ed85e326c": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x2ad99fcfe69248561bf5f0eb788af5217afaaa29": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x238a358808379702088667322f80ac48bad5e6c4": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator",
        "other"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x2add4ea65c917a166d8b379c80d354205c44240d": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xeaeb8acd87cbef7b50ded7558e603b0d0b37eb42": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xe1158c775cbaba85491d78b629d3afbf31f84f72": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x6a5ddb48136d00732d3195f17b01db0c841c666e": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xdfd97c55f95e8c1bf652b3b43b4facaf8ad53489": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x22f8326cf3da32e36d3d2df911def876b7be486f": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x7fcbd9d429932a11884cb5ce9c61055b369f56f7": {
      "primary_role": "other",
      "all_roles": \[
        "other"
      \],
      "primary_section_anchor": "section-monitoring"
    },
    "0x507b7c70752e2fa98dc5360f844fa289f6177c93": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x157a82eaa7ecd25328aeca1b901f82e886498f9f": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x25af352f4490cb40f12bd5a881bdd99838cc9c14": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x63242a4ea82847b20e506b63b0e2e2eff0cc6cb0": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x4c1079f1c260da4444a002aaabcecc7fdc2b2b73": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x718802f4e84e7cdae2538a2972a91cd17f2c514d": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xd04fe2fdb8ccce24364725d6cf6f917f982b4777": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xd8b1bf348f5848c35b9ed8175dfa843f06a98c53": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x60add99bc0a85c5f67e16ef0c45fb600d50855ad": {
      "primary_role": "other",
      "all_roles": \[
        "other"
      \],
      "primary_section_anchor": "section-monitoring"
    },
    "0xa41ee55e16d8ba0a7dd60b576a15946b379b7ebf": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xb300000b72deaeb607a12d5f54773d1c19c7028d": {
      "primary_role": "other",
      "all_roles": \[
        "other"
      \],
      "primary_section_anchor": "section-monitoring"
    },
    "0xfd650452002e818956489c76fdf57fe6c6e48d6b": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xbd97306a087ed0c46b783cfbfdcdc6c12c7a2866": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator",
        "other"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x4a4915a02ebfd6e05132ff9f622646d157b719bb": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x1905dbf18c916bf8ec659545de0858d9f20eaeab": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x76d77531258b4dddfa4087e97a6c89bc0f0f1e50": {
      "primary_role": "other",
      "all_roles": \[
        "other"
      \],
      "primary_section_anchor": "section-monitoring"
    },
    "0x663bac2055054c2ca64c0f9d0d548c8fca0cf071": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xc5a1350019fabafe58cb2c3576672b6f7e1fd562": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xcd3e5e5ca176af4958ee33e346cc5ee93eca73d7": {
      "primary_role": "other",
      "all_roles": \[
        "other"
      \],
      "primary_section_anchor": "section-monitoring"
    },
    "0xd7b4cc3aff43736b2ec0a322948e9792920b4d82": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x175af905198a27b8ddd39e90e3887f3e64705555": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xad9e8b579fb959fefadee1e431e0f608d5e0936d": {
      "primary_role": "other",
      "all_roles": \[
        "other"
      \],
      "primary_section_anchor": "section-monitoring"
    },
    "0x9ee993d478b3d5ee679727b0237e353ad4746eed": {
      "primary_role": "other",
      "all_roles": \[
        "other"
      \],
      "primary_section_anchor": "section-monitoring"
    },
    "0xcc6f6216d8fe4d17758a2bc436e01386a710e89e": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x218c18d02f0723291ce93aa5c0e5eb709903179a": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xfa0f1a7bf2b5f8ae783b7c3d8b9f1350d5665c90": {
      "primary_role": "other",
      "all_roles": \[
        "other"
      \],
      "primary_section_anchor": "section-monitoring"
    },
    "0x9e229b12cc9081d6a510b29ccbd6311743e277ed": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x3f30085347bc801d72f385a293c0c3a17bf0721e": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x3156020dff8d99af1ddc523ebdfb1ad2018554a0": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xc383960159d5c5f6ad9bbc6519a9e1937ca58046": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x62ccef0b4545166f721caa9fee13c1d3767e27dc": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xdd3cb5c974601bc3974d908ea4a86020f9999e0c": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x47bdf280e1b247583e11a06f7d7b17b49af5d560": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x7817dbf38e9d1c95671625f0052c147864692fe0": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xfc9efe51f84d75ae5ef0355a43c85df84928f13e": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x4a99693dbc7545efc4b39431f163adcb4ed541fb": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x09f3977040a58b1ab4d87cb2345f4a7e775af169": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator",
        "other"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x491fe15fc950fb43e2b80282e0ec1323e31edad9": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x4e7ed91e702ef2ff0c58e251c6e20d1dc1e31a5f": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xf53498ebdba5f4b8b1f20008d51c1ad42da9e135": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x055a3b37957bfbd3345bed9968e7e8dd56d67066": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xf55b3aa396b09e61b1beb546959d07aabd60b56e": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xaffa9bd0bb32b53158d596bcb058d68548acf58b": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xda012034fae8a8cb8d81c1d34e2d42419c3fcd3c": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x2f7790de790a198d3e50094a204a624c37313831": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x8f6fbb791a1920a236c5be0184ddcc942dcbe611": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x61d8cff69ed737d7a937bbcf72e02cd1639ac9b4": {
      "primary_role": "other",
      "all_roles": \[
        "other"
      \],
      "primary_section_anchor": "section-monitoring"
    },
    "0xd9c500dff816a1da21a48a732d3498bf09dc9aeb": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x278d858f05b94576c1e6f73285886876ff6ef8d2": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x68d04638eb46cd37c7b4ae316ac1da4a330c75c6": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xda35d6bd48e8552c422ae4c8308559aaddcf37c3": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x8dafd691ef82f90b23fddb10a67d782f04073bd3": {
      "primary_role": "deployer",
      "all_roles": \[
        "deployer",
        "other"
      \],
      "primary_section_anchor": "section-alloc"
    },
    "0xe6123111637c59e662b69f83511ccc184e2ff77d": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x93deb693b170d56bdde1b0a5222b14c0f885d976": {
      "primary_role": "other",
      "all_roles": \[
        "other"
      \],
      "primary_section_anchor": "section-monitoring"
    },
    "0xb7cbad7dd322bd1610c61c539ff2d36909055f54": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xc2eff1f1ce35d395408a34ad881dbcd978f40b89": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0xc1faf39ecd3dd4149a04474797f61695da23f93d": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    },
    "0x2caec2e2e8d915f8783a8a147f22d779b42933b7": {
      "primary_role": "high_throughput_operator",
      "all_roles": \[
        "high_throughput_operator"
      \],
      "primary_section_anchor": "section-high-throughput"
    }
  }
}
```

---

****Data research only, not investment advice. evidence_graph contains 346 stable IDs for provenance tracing.****
