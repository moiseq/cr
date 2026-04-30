"""Adaptive grid-trading engine — runs in background.

Combines classic grid trading with our existing trend / sentiment stack to
solve the main weakness of grids (catastrophic drawdowns in strong trends):

  * Regime detection on each closed 1h candle (TREND_UP / TREND_DOWN /
    RANGE / CHOP) using EMA21 vs EMA50 spread, close vs EMA50, and Bollinger
    Band width. Sentiment from the news engine biases the regime.
  * The grid is rebuilt around EMA21 with bounds derived from the wider of
    BB / ATR. Spacing = 0.5 × ATR.
  * In RANGE the grid is bidirectional. In TREND_UP only LONG cells fire
    (buy dips, sell at the next level up). In TREND_DOWN only SHORT cells.
    In CHOP the grid is disabled (capital sits idle).
  * Cell entries / exits are evaluated on every closed 15m candle using the
    candle high / low (so we don't miss intra-candle wicks).
  * Hard safety: if price escapes the grid by more than 2×ATR we close all
    open cells (the regime has changed) and rebuild on the next 1h close.
  * Strong sentiment flip (>|0.3|) against any open cells closes them.

State is persisted to SQLite (``GridStateModel``) and broadcast to all
connected WS clients as ``{"type": "grid_state", "state": {...}}``.

Independent capital from the signal-trader (``signal_trader``).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from sqlalchemy import select

from app.api.ws import manager
from app.storage.database import AsyncSessionLocal, GridStateModel

logger = logging.getLogger(__name__)

# --- Configuration ---
GRID_PAIRS: list[str] = ["BTCUSDT", "ETHUSDT"]
REGIME_TIMEFRAME = "1h"
EXECUTION_TIMEFRAME = "15m"
MAX_LEVELS = 12
MIN_LEVELS = 4
MAX_CELLS_PER_SIDE = 3  # cap simultaneous open LONGs (or SHORTs) per pair
SPACING_ATR_MULT = 0.5
GRID_HALF_WIDTH_ATR_MULT = 1.5  # used as fallback when BB is too narrow
ESCAPE_ATR_MULT = 2.0  # close all if |price - center| > half_width + ESCAPE × ATR
TAKER_FEE = 0.0004
MAX_LEVERAGE = 10
MAX_HISTORY = 1000
SENTIMENT_PANIC = 0.30  # |sentiment| above this closes opposed cells

# Regime detection thresholds (relative to price)
TREND_SCORE_STRONG = 0.015  # |close - ema50| / ema50
EMA_SPREAD_STRONG = 0.005  # |ema21 - ema50| / ema50
CHOP_BB_WIDTH = 0.04
CHOP_TREND_MAX = 0.005

# Sentiment bias on regime
SENTIMENT_BULL = 0.15
SENTIMENT_BEAR = -0.15

# Defaults
DEFAULT_INITIAL_BALANCE = 700.0  # 70% of $1000 (signal_trader gets the other 30%)
DEFAULT_LEVERAGE = 3
DEFAULT_PER_PAIR_PCT = 50.0  # equal split BTC/ETH

_state_lock = asyncio.Lock()
_state: dict | None = None
_id_counter = int(time.time() * 1000) + 500_000  # disjoint from signal_trader ids


def _next_id() -> int:
    global _id_counter
    _id_counter += 1
    return _id_counter


# ---------------------------------------------------------------------------
# State helpers
# ---------------------------------------------------------------------------


def _make_empty(initial_balance: float, leverage: int, per_pair_pct: float) -> dict:
    lev = max(1, min(int(leverage), MAX_LEVERAGE))
    grids: dict[str, dict] = {
        pair: {
            "regime": "UNKNOWN",
            "regimeUpdatedAt": 0,
            "lower": None,
            "upper": None,
            "center": None,
            "spacing": None,
            "atr": None,
            "levels": [],
            "cells": {},  # keyed by str(level)
            "allocatedCapital": 0.0,
            "lastBuildAt": 0,
            "disabledReason": None,
        }
        for pair in GRID_PAIRS
    }
    return {
        "balance": float(initial_balance),
        "equity": float(initial_balance),
        "initialBalance": float(initial_balance),
        "leverage": lev,
        "perPairAllocationPct": float(per_pair_pct),
        "pairs": list(GRID_PAIRS),
        "grids": grids,
        "trades": [],
        "openTrades": {},  # map cellId -> trade (open positions)
        "totalPnl": 0.0,
        "totalFees": 0.0,
        "winRate": 0.0,
        "totalTrades": 0,
    }


def _recalc_stats(state: dict) -> None:
    closed = [t for t in state["trades"] if t["status"] == "closed"]
    wins = sum(1 for t in closed if (t.get("pnl") or 0) > 0)

    locked_margin = 0.0
    unrealised = 0.0
    for t in state["openTrades"].values():
        locked_margin += t["margin"]
        mark = t.get("lastPrice") or t["entryPrice"]
        if t["direction"] == "BUY":
            unrealised += t["qty"] * (mark - t["entryPrice"])
        else:
            unrealised += t["qty"] * (t["entryPrice"] - mark)

    state["totalPnl"] = sum((t.get("pnl") or 0) for t in closed)
    state["totalFees"] = sum(t.get("feesPaid", 0) for t in closed)
    state["winRate"] = (wins / len(closed) * 100) if closed else 0.0
    state["totalTrades"] = len(closed)
    state["equity"] = state["balance"] + locked_margin + unrealised


async def _save() -> None:
    if _state is None:
        return
    payload = json.dumps(_state)
    async with AsyncSessionLocal() as session:
        existing = (
            await session.execute(select(GridStateModel).where(GridStateModel.id == 1))
        ).scalar_one_or_none()
        if existing is None:
            session.add(GridStateModel(id=1, data=payload))
        else:
            existing.data = payload
        await session.commit()


async def _broadcast() -> None:
    if _state is None:
        return
    await manager.broadcast({"type": "grid_state", "state": _state})


async def load() -> None:
    global _state
    async with AsyncSessionLocal() as session:
        row = (
            await session.execute(select(GridStateModel).where(GridStateModel.id == 1))
        ).scalar_one_or_none()
        if row is None:
            _state = _make_empty(DEFAULT_INITIAL_BALANCE, DEFAULT_LEVERAGE, DEFAULT_PER_PAIR_PCT)
            await _save()
            logger.info("Grid trader initialised with default state")
            return
        try:
            parsed = json.loads(row.data)
            # Forward-compat: ensure all configured pairs exist
            parsed.setdefault("grids", {})
            for pair in GRID_PAIRS:
                if pair not in parsed["grids"]:
                    parsed["grids"][pair] = _make_empty(0, 1, 50.0)["grids"][pair]
            parsed.setdefault("openTrades", {})
            parsed.setdefault("trades", [])
            _state = parsed
            _recalc_stats(_state)
            logger.info(
                "Grid trader loaded: balance=%.2f equity=%.2f cells_open=%d trades_closed=%d",
                _state["balance"],
                _state["equity"],
                len(_state["openTrades"]),
                _state["totalTrades"],
            )
        except Exception:
            logger.exception("Failed to parse persisted grid state — resetting")
            _state = _make_empty(DEFAULT_INITIAL_BALANCE, DEFAULT_LEVERAGE, DEFAULT_PER_PAIR_PCT)
            await _save()


def get_state() -> dict:
    if _state is None:
        return _make_empty(DEFAULT_INITIAL_BALANCE, DEFAULT_LEVERAGE, DEFAULT_PER_PAIR_PCT)
    return _state


async def reset(initial_balance: float, leverage: int, per_pair_pct: float) -> dict:
    global _state
    async with _state_lock:
        _state = _make_empty(initial_balance, leverage, per_pair_pct)
        await _save()
        snapshot = json.loads(json.dumps(_state))
    await _broadcast()
    logger.info(
        "Grid trader RESET: balance=%.2f lev=%dx per_pair=%.1f%%",
        initial_balance, _state["leverage"], per_pair_pct,
    )
    return snapshot


async def update_config(initial_balance: float, leverage: int, per_pair_pct: float) -> dict:
    global _state
    async with _state_lock:
        if _state is None:
            _state = _make_empty(initial_balance, leverage, per_pair_pct)
        else:
            _state["initialBalance"] = float(initial_balance)
            _state["leverage"] = max(1, min(int(leverage), MAX_LEVERAGE))
            _state["perPairAllocationPct"] = float(per_pair_pct)
        await _save()
        snapshot = json.loads(json.dumps(_state))
    await _broadcast()
    return snapshot


# ---------------------------------------------------------------------------
# Regime detection
# ---------------------------------------------------------------------------


def _detect_regime(indicators: dict, sentiment_score: float, close: float) -> str:
    ema21 = indicators.get("ema21")
    ema50 = indicators.get("ema50")
    bb_upper = indicators.get("bb_upper")
    bb_lower = indicators.get("bb_lower")
    bb_mid = indicators.get("bb_mid")
    if ema21 is None or ema50 is None or bb_mid is None or close <= 0:
        return "UNKNOWN"

    trend_score = (close - ema50) / ema50
    ema_spread = (ema21 - ema50) / ema50
    bb_width = (bb_upper - bb_lower) / bb_mid if (bb_upper and bb_lower and bb_mid) else 0

    # Apply sentiment bias: bullish sentiment makes us more willing to call TREND_UP, etc.
    if sentiment_score >= SENTIMENT_BULL:
        trend_score += 0.003
    elif sentiment_score <= SENTIMENT_BEAR:
        trend_score -= 0.003

    # Strong trend (matching EMA spread direction)
    if trend_score > TREND_SCORE_STRONG and ema_spread > EMA_SPREAD_STRONG:
        return "TREND_UP"
    if trend_score < -TREND_SCORE_STRONG and ema_spread < -EMA_SPREAD_STRONG:
        return "TREND_DOWN"

    # High volatility but no clear direction → CHOP (dangerous, sit out)
    if bb_width > CHOP_BB_WIDTH and abs(trend_score) < CHOP_TREND_MAX:
        return "CHOP"

    return "RANGE"


def _allowed_directions(regime: str) -> tuple[bool, bool]:
    """Returns (allow_long, allow_short) for the given regime."""
    if regime == "RANGE":
        return True, True
    if regime == "TREND_UP":
        return True, False
    if regime == "TREND_DOWN":
        return False, True
    return False, False


# ---------------------------------------------------------------------------
# Grid building
# ---------------------------------------------------------------------------


def _build_grid_levels(
    center: float, atr: float, bb_upper: float | None, bb_lower: float | None
) -> tuple[list[float], float, float, float]:
    """Returns (levels, lower, upper, spacing)."""
    spacing = max(SPACING_ATR_MULT * atr, center * 0.0005)  # min 5bp spacing
    half_atr = GRID_HALF_WIDTH_ATR_MULT * atr
    half_bb = max(
        (bb_upper - center) if bb_upper else 0,
        (center - bb_lower) if bb_lower else 0,
    )
    half_width = max(half_atr, half_bb)

    n_each_side = int(half_width // spacing)
    n_each_side = max(MIN_LEVELS // 2, min(MAX_LEVELS // 2, n_each_side))

    levels: list[float] = []
    for i in range(-n_each_side, n_each_side + 1):
        levels.append(round(center + i * spacing, 8))
    lower = levels[0]
    upper = levels[-1]
    return levels, lower, upper, spacing


def _rebuild_grid(grid: dict, indicators: dict, close: float) -> None:
    """Rebuild the grid in place. Does not affect open cells (their level snapshots persist)."""
    atr = indicators.get("atr") or 0
    if atr <= 0:
        return
    center = indicators.get("ema21") or close
    levels, lower, upper, spacing = _build_grid_levels(
        center, atr, indicators.get("bb_upper"), indicators.get("bb_lower")
    )
    grid["levels"] = levels
    grid["lower"] = lower
    grid["upper"] = upper
    grid["center"] = center
    grid["spacing"] = spacing
    grid["atr"] = atr
    grid["lastBuildAt"] = int(time.time() * 1000)


# ---------------------------------------------------------------------------
# Cell open / close
# ---------------------------------------------------------------------------


def _cell_id(symbol: str, level: float, direction: str) -> str:
    return f"{symbol}:{direction}:{level:.8f}"


def _allocated_for_pair(state: dict, pair: str) -> float:
    grid = state["grids"][pair]
    initial_alloc = state["initialBalance"] * (state["perPairAllocationPct"] / 100.0)
    grid["allocatedCapital"] = initial_alloc
    return initial_alloc


def _cell_notional(state: dict, pair: str) -> float:
    grid = state["grids"][pair]
    levels = grid.get("levels") or []
    if not levels:
        return 0.0
    alloc = _allocated_for_pair(state, pair)
    # Use both legs combined; one cell per level/direction
    n_cells_capacity = max(2, len(levels))
    return (alloc * state["leverage"]) / n_cells_capacity


def _open_cell(
    state: dict,
    symbol: str,
    direction: str,
    level: float,
    entry_price: float,
    open_at: int,
    regime: str,
) -> dict | None:
    cid = _cell_id(symbol, level, direction)
    if cid in state["openTrades"]:
        return None

    notional = _cell_notional(state, symbol)
    margin = notional / state["leverage"] if state["leverage"] > 0 else 0
    if notional < 5 or margin < 1:
        return None
    entry_fee = notional * TAKER_FEE
    if margin + entry_fee > state["balance"]:
        return None
    qty = notional / entry_price if entry_price > 0 else 0
    if qty <= 0:
        return None

    grid = state["grids"][symbol]
    spacing = grid.get("spacing") or 0
    if spacing <= 0:
        return None
    tp = level + spacing if direction == "BUY" else level - spacing
    # Hard SL: 2 levels away. RR 1:2 → breakeven win-rate ~66.7% (we run ~81%).
    sl_distance = 2 * spacing
    sl = level - sl_distance if direction == "BUY" else level + sl_distance

    trade = {
        "id": _next_id(),
        "cellId": cid,
        "pair": symbol,
        "timeframe": EXECUTION_TIMEFRAME,
        "direction": direction,
        "level": level,
        "entryPrice": entry_price,
        "tp": tp,
        "sl": sl,
        "notional": notional,
        "margin": margin,
        "leverage": state["leverage"],
        "qty": qty,
        "feesPaid": entry_fee,
        "lastPrice": entry_price,
        "regime": regime,
        "openAt": open_at,
        "status": "open",
    }

    state["balance"] -= (margin + entry_fee)
    state["openTrades"][cid] = trade
    state["trades"] = ([trade] + state["trades"])[:MAX_HISTORY]
    grid_cells = grid.setdefault("cells", {})
    grid_cells[cid] = trade["id"]

    logger.info(
        "Grid OPEN  %s %s level=%.4f entry=%.4f tp=%.4f sl=%.4f notional=%.2f margin=%.2f regime=%s",
        symbol, direction, level, entry_price, tp, sl, notional, margin, regime,
    )
    return trade


def _close_cell(
    state: dict,
    cid: str,
    exit_price: float,
    exit_reason: str,
    close_at: int,
) -> None:
    trade = state["openTrades"].get(cid)
    if trade is None:
        return
    exit_notional = trade["qty"] * exit_price
    exit_fee = exit_notional * TAKER_FEE
    if trade["direction"] == "BUY":
        gross = trade["qty"] * (exit_price - trade["entryPrice"])
    else:
        gross = trade["qty"] * (trade["entryPrice"] - exit_price)
    total_fees = trade["feesPaid"] + exit_fee
    net = gross - exit_fee

    # Update history copy
    for i, t in enumerate(state["trades"]):
        if t["id"] == trade["id"]:
            state["trades"][i] = {
                **trade,
                "exitPrice": exit_price,
                "pnl": net,
                "pnlPct": (net / trade["margin"]) * 100 if trade["margin"] > 0 else 0.0,
                "feesPaid": total_fees,
                "exitReason": exit_reason,
                "closeAt": close_at,
                "status": "closed",
            }
            break

    state["balance"] += trade["margin"] + net
    del state["openTrades"][cid]
    grid = state["grids"].get(trade["pair"], {})
    grid_cells = grid.get("cells", {})
    grid_cells.pop(cid, None)

    logger.info(
        "Grid CLOSE %s %s level=%.4f entry=%.4f exit=%.4f pnl=%.4f reason=%s",
        trade["pair"], trade["direction"], trade["level"],
        trade["entryPrice"], exit_price, net, exit_reason,
    )


def _close_all_for_pair(state: dict, pair: str, exit_price: float, reason: str, close_at: int) -> int:
    cids = [cid for cid, t in state["openTrades"].items() if t["pair"] == pair]
    for cid in cids:
        _close_cell(state, cid, exit_price, reason, close_at)
    return len(cids)


# ---------------------------------------------------------------------------
# Public hooks (called by processor)
# ---------------------------------------------------------------------------


async def on_regime_candle(
    symbol: str,
    candle: dict,
    indicators: dict,
    sentiment_score: float,
) -> None:
    """Called on each closed REGIME_TIMEFRAME candle. Updates regime + grid bounds."""
    if symbol not in GRID_PAIRS:
        return
    global _state
    async with _state_lock:
        if _state is None:
            return
        grid = _state["grids"][symbol]
        new_regime = _detect_regime(indicators, sentiment_score, candle["close"])

        if new_regime in ("UNKNOWN", "CHOP"):
            # Close all open cells; sit out
            if _state["openTrades"]:
                _close_all_for_pair(_state, symbol, candle["close"], f"regime_{new_regime.lower()}", candle["close_time"])
            grid["regime"] = new_regime
            grid["disabledReason"] = "no clean regime" if new_regime == "UNKNOWN" else "high vol no direction"
        else:
            grid["disabledReason"] = None
            # If regime flipped between TREND_UP and TREND_DOWN, close opposed cells
            if grid.get("regime") and grid["regime"] != new_regime:
                allow_long, allow_short = _allowed_directions(new_regime)
                cids_to_close = []
                for cid, t in list(_state["openTrades"].items()):
                    if t["pair"] != symbol:
                        continue
                    if t["direction"] == "BUY" and not allow_long:
                        cids_to_close.append(cid)
                    elif t["direction"] == "SELL" and not allow_short:
                        cids_to_close.append(cid)
                for cid in cids_to_close:
                    _close_cell(_state, cid, candle["close"], "regime_change", candle["close_time"])
            grid["regime"] = new_regime
            _rebuild_grid(grid, indicators, candle["close"])

        grid["regimeUpdatedAt"] = candle["close_time"]
        _recalc_stats(_state)
        await _save()
    await _broadcast()
    logger.info(
        "Grid REGIME %s -> %s  close=%.4f",
        symbol, _state["grids"][symbol]["regime"], candle["close"],
    )


async def on_execution_candle(symbol: str, candle: dict, sentiment_score: float) -> None:
    """Called on each closed EXECUTION_TIMEFRAME candle. Triggers cell entries / exits."""
    if symbol not in GRID_PAIRS:
        return
    global _state
    async with _state_lock:
        if _state is None:
            return
        grid = _state["grids"][symbol]
        regime = grid.get("regime")
        levels = grid.get("levels") or []
        spacing = grid.get("spacing") or 0
        if not levels or spacing <= 0 or regime in (None, "UNKNOWN", "CHOP"):
            return

        high = candle["high"]
        low = candle["low"]
        close = candle["close"]
        open_at = candle["close_time"]

        atr = grid.get("atr") or spacing * 2
        center = grid.get("center") or close

        # ESCAPE: if price went well outside the grid bounds → close all (regime broke)
        upper = grid.get("upper") or 0
        lower = grid.get("lower") or 0
        escape = ESCAPE_ATR_MULT * atr
        if (upper and high > upper + escape) or (lower and low < lower - escape):
            n_closed = _close_all_for_pair(_state, symbol, close, "grid_escape", open_at)
            grid["regime"] = "UNKNOWN"
            grid["disabledReason"] = "price escaped grid bounds"
            if n_closed:
                logger.info("Grid ESCAPE %s closed %d cells (price=%.4f bounds=[%.4f, %.4f])",
                            symbol, n_closed, close, lower, upper)
            _recalc_stats(_state)
            await _save()
            await _broadcast()
            return

        # SENTIMENT PANIC: strong opposite sentiment closes opposed cells
        if abs(sentiment_score) >= SENTIMENT_PANIC:
            cids_to_close = []
            for cid, t in list(_state["openTrades"].items()):
                if t["pair"] != symbol:
                    continue
                if t["direction"] == "BUY" and sentiment_score <= -SENTIMENT_PANIC:
                    cids_to_close.append(cid)
                elif t["direction"] == "SELL" and sentiment_score >= SENTIMENT_PANIC:
                    cids_to_close.append(cid)
            for cid in cids_to_close:
                _close_cell(_state, cid, close, "sentiment_panic", open_at)

        # --- 1. Close existing cells on TP / SL hits ---
        for cid, t in list(_state["openTrades"].items()):
            if t["pair"] != symbol:
                continue
            if t["direction"] == "BUY":
                if low <= t["sl"]:
                    _close_cell(_state, cid, t["sl"], "stop_loss", open_at)
                elif high >= t["tp"]:
                    _close_cell(_state, cid, t["tp"], "take_profit", open_at)
            else:
                if high >= t["sl"]:
                    _close_cell(_state, cid, t["sl"], "stop_loss", open_at)
                elif low <= t["tp"]:
                    _close_cell(_state, cid, t["tp"], "take_profit", open_at)

        # --- 2. Open new cells where price crossed an empty level ---
        allow_long, allow_short = _allowed_directions(regime)
        for level in levels:
            # LONG cell triggers when candle low <= level <= previous price (i.e. dip touched it)
            # We don't have prev tick, so use: level is between low and high AND below mid of candle
            in_range = low <= level <= high
            if not in_range:
                continue
            # LONG: candle dipped through level (i.e. close <= level + spacing/2 OR low touched and price recovered)
            if allow_long and level <= close + spacing * 0.25:
                cid = _cell_id(symbol, level, "BUY")
                if cid not in _state["openTrades"]:
                    # Cap simultaneous LONGs to limit drawdown when regime flips.
                    open_buys = sum(1 for t in _state["openTrades"].values() if t["pair"] == symbol and t["direction"] == "BUY")
                    if open_buys < MAX_CELLS_PER_SIDE:
                        _open_cell(_state, symbol, "BUY", level, level, open_at, regime)
            # SHORT: candle rallied through level
            if allow_short and level >= close - spacing * 0.25:
                cid = _cell_id(symbol, level, "SELL")
                if cid not in _state["openTrades"]:
                    open_sells = sum(1 for t in _state["openTrades"].values() if t["pair"] == symbol and t["direction"] == "SELL")
                    if open_sells < MAX_CELLS_PER_SIDE:
                        _open_cell(_state, symbol, "SELL", level, level, open_at, regime)

        # Update mark price on remaining open cells
        for t in _state["openTrades"].values():
            if t["pair"] == symbol:
                t["lastPrice"] = close

        _recalc_stats(_state)
        await _save()
    await _broadcast()


async def on_live_tick(symbol: str, candle: dict) -> None:
    """Refresh unrealised P&L on open cells for ``symbol``. Never opens / closes cells."""
    if symbol not in GRID_PAIRS:
        return
    global _state
    if _state is None:
        return
    has_open = any(t["pair"] == symbol for t in _state["openTrades"].values())
    if not has_open:
        return
    async with _state_lock:
        if _state is None:
            return
        for t in _state["openTrades"].values():
            if t["pair"] == symbol:
                t["lastPrice"] = candle["close"]
        _recalc_stats(_state)
    await _broadcast()
