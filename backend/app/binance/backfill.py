"""REST backfill for historical klines.

Binance WebSocket only delivers candles as they close. For a freshly added
timeframe we'd otherwise have to wait dozens of candles to accumulate enough
history for indicators (EMA50, BB(20), ATR(14)). This module fetches recent
klines via the public Binance REST endpoint and pushes them into Redis.

Endpoint: ``GET https://api.binance.com/api/v3/klines``
Rate limits are weight-based; we keep a small concurrency cap and a tiny
delay between calls. ``limit=500`` is a single weight unit.
"""

from __future__ import annotations

import asyncio
import logging

import aiohttp

from app.config import settings
from app.storage import redis_client

logger = logging.getLogger(__name__)

REST_URL = "https://api.binance.com/api/v3/klines"
TARGET_CANDLES = 500
MIN_REQUIRED = 60  # below this we always backfill (need ≥ EMA50)
CONCURRENCY = 4


def _kline_to_candle(raw: list) -> dict:
    return {
        "open_time": int(raw[0]),
        "open": float(raw[1]),
        "high": float(raw[2]),
        "low": float(raw[3]),
        "close": float(raw[4]),
        "volume": float(raw[5]),
        "close_time": int(raw[6]),
        "is_final": True,
    }


async def _fetch_one(
    session: aiohttp.ClientSession,
    symbol: str,
    timeframe: str,
    limit: int,
) -> list[dict]:
    params = {"symbol": symbol, "interval": timeframe, "limit": limit}
    async with session.get(REST_URL, params=params, timeout=aiohttp.ClientTimeout(total=15)) as resp:
        resp.raise_for_status()
        data = await resp.json()
    return [_kline_to_candle(row) for row in data]


async def _backfill_pair_tf(
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    symbol: str,
    timeframe: str,
) -> int:
    async with sem:
        existing = await redis_client.get_candles(symbol, timeframe, limit=TARGET_CANDLES)
        if len(existing) >= MIN_REQUIRED:
            return 0
        try:
            candles = await _fetch_one(session, symbol, timeframe, TARGET_CANDLES)
        except Exception as exc:
            logger.warning("Backfill %s/%s failed: %s", symbol, timeframe, exc)
            return 0

        existing_open_times = {c["open_time"] for c in existing}
        added = 0
        for c in candles:
            if c["open_time"] in existing_open_times:
                continue
            # Only persist closed candles (the last one from REST may be the
            # currently-open candle if the interval has just rolled over).
            if c["close_time"] >= c["open_time"]:
                await redis_client.store_candle(symbol, timeframe, c)
                added += 1
        # Politeness: stay well under Binance weight limits
        await asyncio.sleep(0.1)
        return added


async def backfill_all() -> None:
    """Backfill any (pair, timeframe) that has < MIN_REQUIRED candles in Redis."""
    sem = asyncio.Semaphore(CONCURRENCY)
    async with aiohttp.ClientSession() as session:
        tasks = [
            _backfill_pair_tf(session, sem, symbol, tf)
            for symbol in settings.pairs
            for tf in settings.timeframes
        ]
        results = await asyncio.gather(*tasks, return_exceptions=False)

    total_added = sum(results)
    if total_added:
        logger.info("Backfill complete — inserted %d candles", total_added)
    else:
        logger.info("Backfill skipped — all timeframes already populated")
