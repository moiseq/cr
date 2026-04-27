from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict

from app.api.ws import manager
from app.config import settings
from app.indicators.calculator import calculate_indicators
from app.indicators.signals import generate_signal
from app.sentiment.news import compute_sentiment
from app.storage import database, redis_client

logger = logging.getLogger(__name__)

# In-memory candle buffers keyed by (symbol, timeframe)
_buffers: dict[tuple[str, str], list[dict]] = defaultdict(list)
_MAX_BUFFER = 600  # keep last 600 candles in memory per stream

# In-memory cached sentiment (-1..+1). Updated by the background loop.
_sentiment_cache: dict = {"score": 0.0, "samples": 0, "label": "neutral"}


def get_cached_sentiment() -> dict:
    return dict(_sentiment_cache)


async def sentiment_refresh_loop() -> None:
    """Background task: periodically refresh macro sentiment from RSS feeds."""
    global _sentiment_cache
    # Initial delay so startup is not blocked by network calls
    await asyncio.sleep(5)
    while True:
        try:
            payload = await compute_sentiment()
            _sentiment_cache = payload
            await redis_client.store_sentiment(payload)
            logger.info(
                "Sentiment refreshed: score=%.3f samples=%d label=%s",
                payload["score"], payload["samples"], payload["label"],
            )
        except Exception:
            logger.exception("Sentiment refresh failed")
        await asyncio.sleep(settings.sentiment_refresh_seconds)


async def seed_buffers() -> None:
    """Pre-populate in-memory buffers from Redis on startup and recalculate indicators."""
    for symbol in settings.pairs:
        for timeframe in settings.timeframes:
            candles = await redis_client.get_candles(symbol, timeframe, limit=_MAX_BUFFER)
            if not candles:
                continue
            key = (symbol, timeframe)
            _buffers[key] = list(candles)
            logger.info("Seeded buffer %s/%s with %d candles", symbol, timeframe, len(candles))
            indicators = calculate_indicators(_buffers[key])
            if indicators:
                await redis_client.store_indicators(symbol, timeframe, indicators)
                logger.info("Recalculated indicators for %s/%s after seed", symbol, timeframe)


async def handle_kline(symbol: str, timeframe: str, candle: dict) -> None:
    """Called for every kline event. Only processes closed candles."""
    if not candle.get("is_final"):
        # Broadcast live (non-closed) candle for real-time chart updates
        await manager.broadcast({
            "type": "candle_live",
            "symbol": symbol,
            "timeframe": timeframe,
            "candle": candle,
        })
        return

    # --- Closed candle ---
    key = (symbol, timeframe)
    buf = _buffers[key]
    buf.append(candle)

    # Trim buffer
    if len(buf) > _MAX_BUFFER:
        _buffers[key] = buf[-_MAX_BUFFER:]

    # Persist raw candle
    try:
        await database.persist_candle(symbol, timeframe, candle)
    except Exception:
        logger.exception("DB persist_candle failed")

    # Store in Redis
    try:
        await redis_client.store_candle(symbol, timeframe, candle)
    except Exception:
        logger.exception("Redis store_candle failed")

    # Calculate indicators
    indicators = calculate_indicators(_buffers[key])
    if indicators is None:
        return

    # Store indicators in Redis
    try:
        await redis_client.store_indicators(symbol, timeframe, indicators)
    except Exception:
        logger.exception("Redis store_indicators failed")

    # Generate signal — inject current close price + macro sentiment
    indicators["_close"] = candle["close"]
    indicators["_sentiment"] = _sentiment_cache.get("score", 0.0)
    signal = generate_signal(indicators)
    timestamp = candle["open_time"]
    signal_price = candle["close"]

    if signal:
        try:
            await redis_client.store_signal(symbol, timeframe, signal, timestamp, signal_price)
            await database.persist_signal(symbol, timeframe, signal, timestamp)
        except Exception:
            logger.exception("Signal storage failed")

    # Build public indicator dict (strip internal _ keys)
    public_indicators = {k: v for k, v in indicators.items() if not k.startswith("_")}

    # Broadcast to frontend
    payload: dict = {
        "type": "candle_closed",
        "symbol": symbol,
        "timeframe": timeframe,
        "candle": candle,
        "indicators": public_indicators,
    }
    if signal:
        payload["signal"] = {**signal, "timestamp": timestamp, "price": signal_price}

    await manager.broadcast(payload)
    logger.debug("Processed closed candle %s %s close=%.4f", symbol, timeframe, candle["close"])
