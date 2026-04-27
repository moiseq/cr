from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import redis.asyncio as aioredis

from app.config import settings

logger = logging.getLogger(__name__)

_redis: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None


async def wait_for_redis(max_attempts: int = 30, delay_seconds: float = 2.0) -> None:
    r = await get_redis()
    last_error: Exception | None = None

    for attempt in range(1, max_attempts + 1):
        try:
            await r.ping()
            logger.info("Redis became available after %d attempt(s)", attempt)
            return
        except Exception as exc:
            last_error = exc
            logger.warning(
                "Redis unavailable on startup (attempt %d/%d): %s",
                attempt,
                max_attempts,
                exc,
            )
            if attempt < max_attempts:
                await asyncio.sleep(delay_seconds)

    assert last_error is not None
    raise last_error


# Key helpers
def _candles_key(symbol: str, timeframe: str) -> str:
    return f"candles:{symbol}:{timeframe}"


def _indicators_key(symbol: str, timeframe: str) -> str:
    return f"indicators:{symbol}:{timeframe}"


def _signals_key(symbol: str, timeframe: str) -> str:
    return f"signals:{symbol}:{timeframe}"


async def store_candle(symbol: str, timeframe: str, candle: dict) -> None:
    r = await get_redis()
    key = _candles_key(symbol, timeframe)
    score = candle["open_time"]
    value = json.dumps(candle)
    async with r.pipeline(transaction=True) as pipe:
        pipe.zadd(key, {value: score})
        pipe.zremrangebyrank(key, 0, -(settings.candle_buffer_size + 1))
        await pipe.execute()


async def get_candles(symbol: str, timeframe: str, limit: int = 200) -> list[dict]:
    r = await get_redis()
    key = _candles_key(symbol, timeframe)
    raw_list = await r.zrange(key, -limit, -1)
    return [json.loads(v) for v in raw_list]


async def store_indicators(symbol: str, timeframe: str, indicators: dict[str, Any]) -> None:
    r = await get_redis()
    key = _indicators_key(symbol, timeframe)
    # Remove internal crossover keys before storing
    public = {k: str(v) for k, v in indicators.items() if not k.startswith("_") and v is not None}
    if public:
        await r.hset(key, mapping=public)


async def get_indicators(symbol: str, timeframe: str) -> dict[str, float]:
    r = await get_redis()
    key = _indicators_key(symbol, timeframe)
    raw = await r.hgetall(key)
    return {k: float(v) for k, v in raw.items()}


async def store_signal(
    symbol: str,
    timeframe: str,
    signal: dict,
    timestamp: int,
    price: float,
) -> None:
    r = await get_redis()
    key = _signals_key(symbol, timeframe)
    entry = json.dumps({**signal, "timestamp": timestamp, "price": price})
    async with r.pipeline(transaction=True) as pipe:
        pipe.lpush(key, entry)
        pipe.ltrim(key, 0, settings.signal_list_max - 1)
        await pipe.execute()


async def get_signals(symbol: str, timeframe: str, limit: int = 50) -> list[dict]:
    r = await get_redis()
    key = _signals_key(symbol, timeframe)
    raw_list = await r.lrange(key, 0, limit - 1)
    return [json.loads(v) for v in raw_list]


# ---------------------------------------------------------------------------
# Sentiment
# ---------------------------------------------------------------------------
_SENTIMENT_KEY = "sentiment:global"


async def store_sentiment(payload: dict) -> None:
    r = await get_redis()
    await r.set(_SENTIMENT_KEY, json.dumps(payload))


async def get_sentiment() -> dict | None:
    r = await get_redis()
    raw = await r.get(_SENTIMENT_KEY)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None

