"""Backend signal-trader engine.

Runs continuously in the background as part of the FastAPI process. Every closed
candle handled by the processor is fed into ``on_closed_candle`` which manages
open positions (trailing stop / SL / TP / signal-based exits) and decides
whether a new trade should be opened. Live klines update the unrealised P&L for
display purposes only — they never trigger entries or exits.

The full state (free balance, open positions, trade history, summary stats) is
persisted to SQLite (``SignalStateModel``) and broadcast to all connected
WebSocket clients as ``{"type": "signal_state", "state": {...}}`` whenever it
changes.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from sqlalchemy import select

from app.api.ws import manager
from app.storage.database import AsyncSessionLocal, SignalStateModel

logger = logging.getLogger(__name__)

# --- Trading constants (mirror frontend hook) ---
MAX_LEVERAGE = 10
TAKER_FEE = 0.0004
ATR_SL_MULT = 1.0
ATR_TP_MULT = 2.0
DEFAULT_VOL_PCT = 0.005
LIQ_BUFFER = 0.005
MIN_LIQ_TO_SL_RATIO = 3
TIMEFRAMES_ALLOWED = {"15m", "1h"}
MAX_HISTORY = 500

DEFAULT_INITIAL_BALANCE = 1000.0
DEFAULT_RISK_PCT = 0.5
DEFAULT_LEVERAGE = 5

_state_lock = asyncio.Lock()
_state: dict | None = None
_id_counter = int(time.time() * 1000)


def _next_id() -> int:
    global _id_counter
    _id_counter += 1
    return _id_counter


def _make_empty(initial_balance: float, risk_pct: float, leverage: int) -> dict:
    lev = max(1, min(int(leverage), MAX_LEVERAGE))
    return {
        "balance": float(initial_balance),
        "equity": float(initial_balance),
        "initialBalance": float(initial_balance),
        "riskPerTradePct": float(risk_pct),
        "leverage": lev,
        "trades": [],
        "openTrades": {},
        "totalPnl": 0.0,
        "totalFees": 0.0,
        "winRate": 0.0,
    }


def _approx_liq_price(entry: float, leverage: int, direction: str) -> float:
    dist_pct = (1 - LIQ_BUFFER) / leverage
    return entry * (1 - dist_pct) if direction == "BUY" else entry * (1 + dist_pct)


def _compute_risk_levels(entry: float, direction: str, indicators: dict) -> tuple[float, float, float]:
    atr = indicators.get("atr") or 0
    dist_pct = (atr / entry) if (atr and entry > 0) else DEFAULT_VOL_PCT
    sl_dist_pct = ATR_SL_MULT * dist_pct
    tp_dist_pct = ATR_TP_MULT * dist_pct
    if direction == "BUY":
        return entry * (1 - sl_dist_pct), entry * (1 + tp_dist_pct), sl_dist_pct
    return entry * (1 + sl_dist_pct), entry * (1 - tp_dist_pct), sl_dist_pct


def _should_enter(signal: dict) -> bool:
    s = signal.get("strength")
    if s == "STRONG":
        return True
    if s != "MEDIUM":
        return False
    reasons = signal.get("reasons", [])
    if signal.get("direction") == "BUY":
        return any(r in ("trend_up_confirm", "mean_reversion_long") for r in reasons)
    return any(r in ("trend_down_confirm", "mean_reversion_short") for r in reasons)


def _check_exit(trade: dict, candle: dict, indicators: dict) -> tuple[float, str] | None:
    high = candle["high"]
    low = candle["low"]
    close = candle["close"]
    ema9 = indicators.get("ema9")
    ema21 = indicators.get("ema21")
    rsi = indicators.get("rsi")

    if trade["direction"] == "BUY":
        if low <= trade["sl"]:
            return trade["sl"], "stop_loss"
        if high >= trade["tp"]:
            return trade["tp"], "take_profit"
        if ema9 is not None and ema21 is not None and ema9 < ema21:
            return close, "ema_bearish_exit"
        if rsi is not None and rsi > 75:
            return close, "rsi_overbought_exit"
    else:
        if high >= trade["sl"]:
            return trade["sl"], "stop_loss"
        if low <= trade["tp"]:
            return trade["tp"], "take_profit"
        if ema9 is not None and ema21 is not None and ema9 > ema21:
            return close, "ema_bullish_exit"
        if rsi is not None and rsi < 25:
            return close, "rsi_oversold_exit"
    return None


def _maybe_trail(trade: dict, candle: dict, indicators: dict) -> dict:
    atr = indicators.get("atr") or 0
    if atr <= 0:
        return trade
    if trade["direction"] == "BUY":
        if candle["high"] - trade["entryPrice"] >= atr:
            new_sl = max(trade["sl"], trade["entryPrice"])
            if new_sl != trade["sl"]:
                trade["sl"] = new_sl
                trade["trailingActive"] = True
    else:
        if trade["entryPrice"] - candle["low"] >= atr:
            new_sl = min(trade["sl"], trade["entryPrice"])
            if new_sl != trade["sl"]:
                trade["sl"] = new_sl
                trade["trailingActive"] = True
    return trade


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
    state["equity"] = state["balance"] + locked_margin + unrealised


async def _save() -> None:
    if _state is None:
        return
    payload = json.dumps(_state)
    async with AsyncSessionLocal() as session:
        existing = (
            await session.execute(select(SignalStateModel).where(SignalStateModel.id == 1))
        ).scalar_one_or_none()
        if existing is None:
            session.add(SignalStateModel(id=1, data=payload))
        else:
            existing.data = payload
        await session.commit()


async def _broadcast() -> None:
    if _state is None:
        return
    await manager.broadcast({"type": "signal_state", "state": _state})


async def load() -> None:
    """Load persisted state from SQLite into memory. Called once on startup."""
    global _state
    async with AsyncSessionLocal() as session:
        row = (
            await session.execute(select(SignalStateModel).where(SignalStateModel.id == 1))
        ).scalar_one_or_none()
        if row is None:
            _state = _make_empty(DEFAULT_INITIAL_BALANCE, DEFAULT_RISK_PCT, DEFAULT_LEVERAGE)
            await _save()
            logger.info("Signal trader initialised with default state (no prior state found)")
            return
        try:
            parsed = json.loads(row.data)
            parsed.setdefault("openTrades", {})
            parsed.setdefault("trades", [])
            _state = parsed
            _recalc_stats(_state)
            logger.info(
                "Signal trader loaded: balance=%.2f equity=%.2f open=%d closed=%d",
                _state["balance"],
                _state["equity"],
                len(_state["openTrades"]),
                sum(1 for t in _state["trades"] if t["status"] == "closed"),
            )
        except Exception:
            logger.exception("Failed to parse persisted signal-trader state — resetting")
            _state = _make_empty(DEFAULT_INITIAL_BALANCE, DEFAULT_RISK_PCT, DEFAULT_LEVERAGE)
            await _save()


def get_state() -> dict:
    if _state is None:
        return _make_empty(DEFAULT_INITIAL_BALANCE, DEFAULT_RISK_PCT, DEFAULT_LEVERAGE)
    return _state


async def reset(initial_balance: float, risk_pct: float, leverage: int) -> dict:
    global _state
    async with _state_lock:
        _state = _make_empty(initial_balance, risk_pct, leverage)
        await _save()
        snapshot = json.loads(json.dumps(_state))
    await _broadcast()
    logger.info(
        "Signal trader RESET: balance=%.2f risk%%=%.2f lev=%dx",
        initial_balance, risk_pct, _state["leverage"],
    )
    return snapshot


async def update_config(initial_balance: float, risk_pct: float, leverage: int) -> dict:
    global _state
    async with _state_lock:
        if _state is None:
            _state = _make_empty(initial_balance, risk_pct, leverage)
        else:
            _state["initialBalance"] = float(initial_balance)
            _state["riskPerTradePct"] = float(risk_pct)
            _state["leverage"] = max(1, min(int(leverage), MAX_LEVERAGE))
        await _save()
        snapshot = json.loads(json.dumps(_state))
    await _broadcast()
    return snapshot


def _replace_in_history(state: dict, trade: dict) -> None:
    for i, t in enumerate(state["trades"]):
        if t["id"] == trade["id"]:
            state["trades"][i] = trade
            return


async def on_closed_candle(
    symbol: str,
    timeframe: str,
    candle: dict,
    indicators: dict,
    signal: dict | None,
) -> None:
    """Process a closed candle: manage open trade for this symbol; maybe enter."""
    if timeframe not in TIMEFRAMES_ALLOWED:
        return
    global _state
    async with _state_lock:
        if _state is None:
            return
        state = _state

        # --- 1. Manage open trade for this symbol ---
        existing = state["openTrades"].get(symbol)
        if existing is not None:
            if existing["timeframe"] == timeframe:
                trade = _maybe_trail(existing, candle, indicators)
                trade["lastPrice"] = candle["close"]
                exit_result = _check_exit(trade, candle, indicators)
                if exit_result is not None:
                    exit_price, exit_reason = exit_result
                    exit_notional = trade["qty"] * exit_price
                    exit_fee = exit_notional * TAKER_FEE
                    if trade["direction"] == "BUY":
                        gross = trade["qty"] * (exit_price - trade["entryPrice"])
                    else:
                        gross = trade["qty"] * (trade["entryPrice"] - exit_price)
                    total_fees = trade["feesPaid"] + exit_fee
                    net = gross - exit_fee
                    trade["exitPrice"] = exit_price
                    trade["pnl"] = net
                    trade["pnlPct"] = (net / trade["margin"]) * 100 if trade["margin"] > 0 else 0.0
                    trade["feesPaid"] = total_fees
                    trade["exitReason"] = exit_reason
                    trade["closeAt"] = candle["close_time"]
                    trade["status"] = "closed"
                    state["balance"] = state["balance"] + trade["margin"] + net
                    _replace_in_history(state, trade)
                    del state["openTrades"][symbol]
                    logger.info(
                        "Signal CLOSE %s %s %s entry=%.4f exit=%.4f pnl=%.2f (%.2f%%) reason=%s",
                        symbol, timeframe, trade["direction"], trade["entryPrice"],
                        exit_price, net, trade["pnlPct"], exit_reason,
                    )
                else:
                    state["openTrades"][symbol] = trade
                    _replace_in_history(state, trade)
            else:
                # Different timeframe candle: just refresh mark price
                existing["lastPrice"] = candle["close"]
                state["openTrades"][symbol] = existing
                _replace_in_history(state, existing)

        # --- 2. Maybe enter (only if no open trade for THIS symbol) ---
        if (
            symbol not in state["openTrades"]
            and signal
            and _should_enter(signal)
            and signal.get("price")
        ):
            entry_price = float(signal["price"])
            sl, tp, sl_dist_pct = _compute_risk_levels(entry_price, signal["direction"], indicators)
            if sl_dist_pct > 0:
                equity_for_risk = state["balance"] + sum(
                    t["margin"] for t in state["openTrades"].values()
                )
                risk_usd = (equity_for_risk * state["riskPerTradePct"]) / 100
                notional_ideal = risk_usd / sl_dist_pct
                max_notional = state["balance"] * state["leverage"]
                notional = min(notional_ideal, max_notional)
                margin = notional / state["leverage"] if state["leverage"] > 0 else 0
                liq_price = _approx_liq_price(entry_price, state["leverage"], signal["direction"])
                sl_dist = abs(entry_price - sl)
                liq_dist = abs(entry_price - liq_price)
                qty = notional / entry_price if entry_price > 0 else 0
                entry_fee = notional * TAKER_FEE

                ok = (
                    notional >= 10
                    and margin >= 1
                    and (margin + entry_fee) <= state["balance"]
                    and liq_dist >= MIN_LIQ_TO_SL_RATIO * sl_dist
                )
                if ok:
                    new_trade = {
                        "id": _next_id(),
                        "pair": symbol,
                        "timeframe": timeframe,
                        "direction": signal["direction"],
                        "entryPrice": entry_price,
                        "notional": notional,
                        "margin": margin,
                        "leverage": state["leverage"],
                        "qty": qty,
                        "liqPrice": liq_price,
                        "initialSl": sl,
                        "sl": sl,
                        "tp": tp,
                        "trailingActive": False,
                        "feesPaid": entry_fee,
                        "lastPrice": entry_price,
                        "entryReasons": signal.get("reasons", []),
                        "openAt": signal.get("timestamp", candle["close_time"]),
                        "status": "open",
                    }
                    state["balance"] = state["balance"] - margin - entry_fee
                    state["openTrades"][symbol] = new_trade
                    state["trades"] = ([new_trade] + state["trades"])[:MAX_HISTORY]
                    logger.info(
                        "Signal OPEN %s %s %s entry=%.4f notional=%.2f margin=%.2f sl=%.4f tp=%.4f reasons=%s",
                        symbol, timeframe, signal["direction"], entry_price,
                        notional, margin, sl, tp, ",".join(signal.get("reasons", [])),
                    )

        _recalc_stats(state)
        await _save()
    await _broadcast()


async def on_live_tick(symbol: str, candle: dict) -> None:
    """Refresh unrealised P&L on the open position for ``symbol`` (if any).

    Called on every non-final kline update. Never triggers entries or exits.
    Does NOT persist to SQLite (high frequency); only broadcasts.
    """
    global _state
    if _state is None or symbol not in _state.get("openTrades", {}):
        return
    async with _state_lock:
        if _state is None or symbol not in _state["openTrades"]:
            return
        trade = _state["openTrades"][symbol]
        trade["lastPrice"] = candle["close"]
        _replace_in_history(_state, trade)
        _recalc_stats(_state)
    await _broadcast()
