import asyncio
import logging

from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import verify_internal_websocket
from app.api.routes import router
from app.api.ws import manager
from app.binance.backfill import backfill_all
from app.binance.client import BinanceWSClient
from app.config import settings
from app.core import grid_trader
from app.core.processor import bootstrap_grid_regimes, handle_kline, seed_buffers, sentiment_refresh_loop
from app.storage.database import init_db
from app.storage.redis_client import close_redis, wait_for_redis

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

binance_client: BinanceWSClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global binance_client

    # Initialise database tables
    await init_db()

    # Swarm does not guarantee dependency readiness; wait for Redis before startup work.
    await wait_for_redis()

    # Backfill historical candles via REST for any timeframe that doesn't yet
    # have enough history in Redis (avoids waiting EMA50 candles before grid
    # regime / signal-trader can fire on a newly-added timeframe).
    await backfill_all()

    # Seed in-memory candle buffers from Redis (enables indicators immediately after restart)
    await seed_buffers()

    # Load persisted grid-trading state.
    await grid_trader.load()

    # Bootstrap regime / build the grid right away from the seeded buffers so
    # we don't have to wait for the next 1h candle close to start trading.
    await bootstrap_grid_regimes()

    # Start Binance WebSocket client
    binance_client = BinanceWSClient(on_kline=handle_kline)
    await binance_client.start()

    # Background task: refresh macro sentiment from RSS feeds
    sentiment_task = asyncio.create_task(sentiment_refresh_loop(), name="sentiment_refresh_loop")

    logger.info("Startup complete — streaming %d pairs × %d timeframes",
                len(settings.pairs), len(settings.timeframes))
    yield

    # Shutdown
    sentiment_task.cancel()
    try:
        await sentiment_task
    except (asyncio.CancelledError, Exception):
        pass
    if binance_client:
        await binance_client.stop()
    await close_redis()
    logger.info("Shutdown complete")


app = FastAPI(title="CR — Crypto Technical Analysis", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    if not await verify_internal_websocket(websocket):
        return

    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive; client can send pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception:
        await manager.disconnect(websocket)
