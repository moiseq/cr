from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.auth import verify_internal_request
from app.config import settings
from app.storage import redis_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", dependencies=[Depends(verify_internal_request)])


@router.get("/pairs")
async def get_pairs() -> dict:
    return {"pairs": settings.pairs, "timeframes": settings.timeframes}


@router.get("/candles/{symbol}/{timeframe}")
async def get_candles(
    symbol: str,
    timeframe: str,
    limit: int = Query(default=200, ge=1, le=500),
) -> dict:
    symbol = symbol.upper()
    if symbol not in settings.pairs:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not tracked")
    if timeframe not in settings.timeframes:
        raise HTTPException(status_code=404, detail=f"Timeframe {timeframe} not tracked")

    candles = await redis_client.get_candles(symbol, timeframe, limit=limit)
    indicators = await redis_client.get_indicators(symbol, timeframe)

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "candles": candles,
        "indicators": indicators,
    }


@router.get("/signals")
async def get_signals(
    symbol: str = Query(default="BTCUSDT"),
    timeframe: str = Query(default="5m"),
    limit: int = Query(default=50, ge=1, le=100),
) -> dict:
    symbol = symbol.upper()
    if symbol not in settings.pairs:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not tracked")
    if timeframe not in settings.timeframes:
        raise HTTPException(status_code=404, detail=f"Timeframe {timeframe} not tracked")

    signals = await redis_client.get_signals(symbol, timeframe, limit=limit)
    return {"symbol": symbol, "timeframe": timeframe, "signals": signals}


@router.get("/sentiment")
async def get_sentiment() -> dict:
    """Latest macro sentiment score from crypto news feeds."""
    payload = await redis_client.get_sentiment()
    if payload is None:
        return {"score": 0.0, "samples": 0, "label": "neutral"}
    return payload
