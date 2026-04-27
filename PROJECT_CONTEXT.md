# CR — Crypto Technical Analysis Bot

## What it is
A full-stack real-time crypto trading dashboard that streams live candlestick data from **Binance USDT-M Futures (perpetuals)**, computes technical indicators, and renders buy/sell signals. Paper trading models long and short positions with leverage.

## Stack
| Layer | Tech |
|-------|------|
| Backend | Python 3.12, FastAPI, pandas-ta 0.4.71b0, pandas ≥2.3.2, numpy ≥2.2.6 |
| WebSocket feed | Binance USDT-M Futures combined stream (`wss://fstream.binance.com/stream`) |
| Cache | Redis 7-alpine |
| DB | SQLite via SQLAlchemy 2 + aiosqlite (file: `backend/data/cr.db`) |
| Frontend | Next.js 16.2.4, React 19, TypeScript, Tailwind CSS, lightweight-charts ^4.1.3 |
| Infrastructure | Docker Compose v2 |

## Pairs & timeframes
- Pairs (USDT-M perpetuals): BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT
- Timeframes: 1m, 5m, 15m
- Total streams: 15

## Indicators computed
RSI, EMA (9, 21, 50), MACD, Bollinger Bands, ATR(14)

## Strategy & paper trading

### Signal engine (backend, `app/indicators/signals.py`)
Weighted-score model. Each indicator contributes a positive (bullish) or negative (bearish) value. A master trend filter (`close vs EMA50` + `EMA21 vs EMA50`) damps counter-trend setups by 60%. Optional macro sentiment from RSS news (VADER) nudges the score.

Strength buckets (from `config.py`):
- `|score| < 0.8` → discarded
- `|score| ≥ 1.4` → MEDIUM
- `|score| ≥ 2.2` → STRONG

### Paper trading (frontend, `hooks/usePaperTrading.ts`)
- **LONG and SHORT** (futures semantics).
- **Timeframes**: 5m and 15m only. 1m is shown for charts but never trades.
- **Entry**: STRONG always (any direction); MEDIUM only if a matching trend/mean-reversion reason confirms (`trend_up_confirm` or `mean_reversion_long` for LONG; `trend_down_confirm` or `mean_reversion_short` for SHORT).
- **Sizing**: risk-based. `position_notional = (equity × risk%) / sl_distance%`. Capped by `balance × leverage`.
- **SL/TP**: ATR-based (`SL = 1×ATR`, `TP = 2×ATR`). Trailing to breakeven once price moves 1×ATR in favour (both directions).
- **Liquidation guard**: trade rejected if `|entry − liq_price| < 3 × |entry − SL|`.
- **Fees**: 0.04% taker × 2 (entry + exit) deducted from P&L — matches Binance USDT-M VIP 0 taker rate.
- **Funding rate**: NOT modelled (known limitation; would apply every 8h on real perpetuals).
- **Defaults**: 1000 USDT balance, 0.5% risk/trade, 5x leverage. Hard cap 10x in UI.

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
BINANCE_WS_URL=wss://fstream.binance.com/stream
```

## Frontend env vars (`frontend/.env`)
```
NEXT_PUBLIC_API_URL=http://localhost:8001
NEXT_PUBLIC_WS_URL=ws://localhost:8001/ws
```
