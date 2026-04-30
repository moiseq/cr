# CR — Crypto Technical Analysis Bot

## What it is
A full-stack real-time crypto trading dashboard that streams live candlestick data from **Binance Spot**, computes technical indicators, and renders buy/sell signals. Paper trading models perpetual-futures-style positions (LONG/SHORT, leverage, liquidation) over the spot price feed.

> Note: an attempt to use Binance USDT-M Futures (`fstream.binance.com`) as the live feed was reverted because the WebSocket connections are accepted but no klines are pushed for our server IP (REST works; WS feed is silently blocked). Spot price tracks perpetual price within ~0.1% basis, which is irrelevant for our indicator-driven signals.

## Stack
| Layer | Tech |
|-------|------|
| Backend | Python 3.12, FastAPI, pandas-ta 0.4.71b0, pandas ≥2.3.2, numpy ≥2.2.6 |
| WebSocket feed | Binance Spot combined stream (`wss://stream.binance.com:9443/stream`) |
| Cache | Redis 7-alpine |
| DB | SQLite via SQLAlchemy 2 + aiosqlite (file: `backend/data/cr.db`) |
| Frontend | Next.js 16.2.4, React 19, TypeScript, Tailwind CSS, lightweight-charts ^4.1.3 |
| Infrastructure | Docker Compose v2 |

## Pairs & timeframes
- Pairs: BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT (spot prices)
- Timeframes: 15m, 1h, 4h
- Total streams: 15

## Indicators computed
RSI, EMA (9, 21, 50), MACD, Bollinger Bands, ATR(14)

## Strategy & paper trading

> Signal trading was removed (April 2026) — results were inconclusive. The bot
> now runs **grid trading only**.

### Indicator engine (backend, `app/indicators/signals.py`)
Weighted-score model used to flag BUY/SELL events on the dashboard (display
only; no trading is performed off these signals anymore). A master trend filter
(`close vs EMA50` + `EMA21 vs EMA50`) damps counter-trend setups by 60%.
Optional macro sentiment from RSS news (VADER) nudges the score.

Strength buckets (from `config.py`):
- `|score| < 0.8` → discarded
- `|score| ≥ 1.4` → MEDIUM
- `|score| ≥ 2.2` → STRONG

### Grid trader (backend, `app/core/grid_trader.py`)
Adaptive regime-aware grid on **BTCUSDT + ETHUSDT** only.

- **Regime** detected on each closed 1h candle (TREND_UP / TREND_DOWN / RANGE /
  CHOP) from EMA21 vs EMA50 spread, close vs EMA50, BB width. Sentiment biases
  the call.
- **Grid build**: centred on EMA21, half-width = max(BB, 1.5×ATR), spacing =
  0.5×ATR. Bounded by `MIN_LEVELS=4` / `MAX_LEVELS=12`.
- **Direction allowed**: RANGE = both, TREND_UP = LONG only, TREND_DOWN = SHORT
  only, CHOP/UNKNOWN = grid disabled (capital idle).
- **Cell sizing**: `notional = (alloc_pair × leverage) / n_levels` — fixed by
  `initialBalance` (no compounding). Margin = notional / leverage.
- **TP / SL**: TP = 1×spacing, **SL = 2×spacing** (RR 1:2; old value 3× was too
  wide for the 81% historical win-rate). `MAX_CELLS_PER_SIDE = 3` per pair to
  limit drawdown when regime flips.
- **Safety**: hard escape closes all cells if price exits grid by >2×ATR.
  Sentiment >|0.30| against open cells closes the opposed side.
- **Fees**: 0.04% taker on entry AND exit, both deducted from `balance` /
  reflected in trade `pnl` (fix April 2026 — prior trades had only exit fee).
- **Funding rate**: NOT modelled.
- **Defaults**: $1000 balance, 3× leverage, 50% per pair, max 10× leverage in UI.
- **Endpoints**: `GET /api/grid`, `POST /api/grid/reset`, `POST /api/grid/config`,
  `POST /api/grid/backfill-pnl` (one-off, idempotent, recomputes pnl with both fees).

### Sentiment module (backend, `app/sentiment/news.py`)
RSS aggregation (Cointelegraph, CoinDesk, Decrypt, CryptoPanic, Bitcoin Magazine) + VADER. Refreshed every 10 min by background task. Exposed at `GET /api/sentiment` and injected into the signal engine as `_sentiment`.

## Ports
| Service | Host port | Container port |
|---------|-----------|----------------|
| Backend (FastAPI) | 8001 | 8000 |
| Frontend (Next.js) | 3000 | 3000 |
| Redis | 6379 | 6379 |

## Directory layout
```
cr/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile          # python:3.12-slim
│   ├── requirements.txt
│   ├── .env / .env.example
│   └── app/
│       ├── main.py         # FastAPI app, startup/shutdown
│       ├── config.py       # pydantic-settings
│       ├── api/
│       │   ├── routes.py   # REST endpoints
│       │   └── ws.py       # WebSocket endpoint (/ws/{pair}/{tf})
│       ├── binance/
│       │   └── client.py   # BinanceWSClient (combined stream)
│       ├── core/           # signal engine
│       ├── indicators/     # indicator calculations
│       └── storage/
│           └── database.py # SQLAlchemy async setup
└── frontend/
    ├── Dockerfile          # node:20-alpine, npm install --force, CMD npm run dev
    ├── package.json        # next 16.2.4, "dev": "next dev --webpack"
    └── src/
        ├── app/            # Next.js app router (layout, page, globals.css)
        ├── components/
        │   ├── Chart/      # lightweight-charts candlestick component
        │   ├── Signals/    # buy/sell signal display
        │   ├── PairSelector.tsx
        │   └── TimeframeSelector.tsx
        ├── hooks/          # WebSocket/data hooks
        └── lib/            # API client helpers
```

## docker-compose volumes (frontend)
```yaml
volumes:
  - ./frontend:/app       # bind mount (source code)
  - /app/node_modules     # anonymous volume (isolates container's musl-native node_modules from host's gnu ones)
  - /app/.next            # anonymous volume (build cache)
```

## Key lessons learned during setup

### Next.js version in container was wrong (14.x instead of 16.x)
- **Root cause**: anonymous volumes `/app/node_modules` and `/app/.next` were persisting stale layer cache even after `docker-compose down -v`. Docker's layer cache was winning.
- **Fix**: Delete the frontend Docker image entirely (`docker rmi cr-frontend`) and rebuild with `--no-cache`. The anonymous volumes are now explicitly declared (see above) to prevent the *host's glibc-built* node_modules from leaking into the Alpine container.

### Turbopack fails on Alpine Linux
- Alpine uses musl libc; `@next/swc-linux-x64-gnu` requires glibc → fails to load.
- `@next/swc-linux-x64-musl` is not installed when running `npm install` on the host (host is glibc).
- Next.js 16 defaults to Turbopack which requires native bindings → crashes.
- **Fix**: `"dev": "next dev --webpack"` in `package.json` — uses Webpack instead of Turbopack.

### npm install installs wrong next version
- Running `npm install --force` inside the Dockerfile (Alpine/node:20-alpine) was installing next@15.3.1 (deprecated, security CVE) instead of 16.2.4.
- **Workaround**: Install on the host first (`npm install --force` in `frontend/`), then the bind mount + anonymous volume for node_modules ensures the container uses the image's own freshly-installed packages.

## How to run
```bash
# First time / after changing dependencies on host:
cd frontend && npm install --force && cd ..

# Delete any stale frontend image:
docker rmi cr-frontend 2>/dev/null || true

# Start everything:
docker-compose up --build -d
docker-compose logs -f frontend
```

## Backend env vars (`backend/.env`)
```
REDIS_URL=redis://redis:6379
DATABASE_URL=sqlite+aiosqlite:///./data/cr.db
BINANCE_WS_URL=wss://stream.binance.com:9443/stream
```

## Frontend env vars (`frontend/.env`)
```
NEXT_PUBLIC_API_URL=http://localhost:8001
NEXT_PUBLIC_WS_URL=ws://localhost:8001/ws
```

## TODO — going live

### Exchange selection (in evaluation)
- **Binance USDT-M Futures**: WS feed (`fstream.binance.com`) silently blocks
  klines for our current server IP (REST works). Would need a different
  VPS / region or IP whitelisting before going live.
- **Robinhood Europe** (legal in PT): comparable taker fees to Binance and now
  exposes a **futures API**. Worth investigating as the primary venue — avoids
  the Binance WS-block issue entirely. Action items when we get there:
    - Confirm API supports BTCUSDT / ETHUSDT perpetuals + LONG and SHORT
    - Compare effective fees (maker/taker, funding) against Binance
    - Validate WS market-data + REST execution latency from our infra
    - Build a thin abstraction layer so the grid trader can target either venue

### Other prerequisites before real money
- Execution layer: LIMIT orders at each grid level + fill reconciliation
- Funding-rate handling (subscribe + factor into P&L; potentially close
  positions before unfavourable funding windows)
- Risk: kill switch, daily loss limit, hard max-position cap, state-vs-exchange
  reconciliation guard
- Slippage / min-notional / lot-size enforcement per symbol
- Telegram or email alerts on fills, SL hits, errors, disconnections
- Test on the venue's testnet (or smallest possible live size) for 1–2 weeks
  before scaling capital
