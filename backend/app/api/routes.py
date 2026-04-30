from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.auth import verify_internal_request
from app.config import settings
from app.core import grid_trader, signal_trader
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
    timeframe: str = Query(default="15m"),
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


# ---------------------------------------------------------------------------
# Signal-trader endpoints
# ---------------------------------------------------------------------------


class SignalTraderConfigPayload(BaseModel):
    initialBalance: float = Field(gt=0)
    riskPerTradePct: float = Field(gt=0, le=10)
    leverage: int = Field(ge=1, le=signal_trader.MAX_LEVERAGE)


@router.get("/signal-trader")
async def get_signal_trader_state() -> dict:
    """Current state of the background signal-trader bot."""
    return signal_trader.get_state()


@router.post("/signal-trader/reset")
async def reset_signal_trader_state(payload: SignalTraderConfigPayload) -> dict:
    """Wipe all trades and start fresh with the given configuration."""
    return await signal_trader.reset(
        payload.initialBalance, payload.riskPerTradePct, payload.leverage
    )


@router.post("/signal-trader/config")
async def update_signal_trader_config(payload: SignalTraderConfigPayload) -> dict:
    """Update signal-trader configuration without wiping history or open trades."""
    return await signal_trader.update_config(
        payload.initialBalance, payload.riskPerTradePct, payload.leverage
    )


# ---------------------------------------------------------------------------
# Grid-trading endpoints
# ---------------------------------------------------------------------------


class GridConfigPayload(BaseModel):
    initialBalance: float = Field(gt=0)
    leverage: int = Field(ge=1, le=grid_trader.MAX_LEVERAGE)
    perPairAllocationPct: float = Field(gt=0, le=100)


@router.get("/grid")
async def get_grid_state() -> dict:
    """Current state of the background grid-trading bot."""
    return grid_trader.get_state()


@router.post("/grid/reset")
async def reset_grid_state(payload: GridConfigPayload) -> dict:
    return await grid_trader.reset(
        payload.initialBalance, payload.leverage, payload.perPairAllocationPct
    )


@router.post("/grid/config")
async def update_grid_config(payload: GridConfigPayload) -> dict:
    return await grid_trader.update_config(
        payload.initialBalance, payload.leverage, payload.perPairAllocationPct
    )
