"use client";

import { useCallback, useEffect, useState } from "react";
import { Candle, Indicators, Signal } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaperTrade {
  id: number;
  pair: string;
  timeframe: string;
  direction: "BUY" | "SELL";
  entryPrice: number;
  exitPrice?: number;

  notional: number;
  margin: number;
  leverage: number;
  qty: number;
  liqPrice: number;

  initialSl: number;
  sl: number;
  tp: number;
  trailingActive: boolean;

  feesPaid: number;

  pnl?: number;
  pnlPct?: number;     // % of margin

  // Last seen mark price for live unrealised tracking
  lastPrice?: number;

  entryReasons: string[];
  exitReason?: string;
  openAt: number;
  closeAt?: number;
  status: "open" | "closed";
}

export interface PaperTradingState {
  balance: number;
  equity: number;
  initialBalance: number;
  riskPerTradePct: number;
  leverage: number;
  /** Closed + still-open trades (history). */
  trades: PaperTrade[];
  /** Currently open positions, keyed by pair. One position per pair. */
  openTrades: Record<string, PaperTrade>;
  totalPnl: number;
  totalFees: number;
  winRate: number;
}

export interface PaperTradingConfig {
  initialBalance: number;
  riskPerTradePct: number;
  leverage: number;
}

// ---------------------------------------------------------------------------
// Trading constants
// ---------------------------------------------------------------------------
export const MAX_LEVERAGE = 10;
export const TAKER_FEE = 0.0004;
const ATR_SL_MULT = 1.0;
const ATR_TP_MULT = 2.0;
const DEFAULT_VOL_PCT = 0.005;
const LIQ_BUFFER = 0.005;
const MIN_LIQ_TO_SL_RATIO = 3;
const TIMEFRAMES_ALLOWED = new Set(["5m", "15m"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function approxLiqPrice(entry: number, leverage: number, direction: "BUY" | "SELL"): number {
  const distPct = (1 - LIQ_BUFFER) / leverage;
  return direction === "BUY"
    ? entry * (1 - distPct)
    : entry * (1 + distPct);
}

function computeRiskLevels(
  entry: number,
  direction: "BUY" | "SELL",
  indicators: Indicators
): { sl: number; tp: number; slDistPct: number } {
  const atr = indicators.atr;
  const distPct = atr && atr > 0 ? atr / entry : DEFAULT_VOL_PCT;
  const slDistPct = ATR_SL_MULT * distPct;
  const tpDistPct = ATR_TP_MULT * distPct;
  if (direction === "BUY") {
    return {
      sl: entry * (1 - slDistPct),
      tp: entry * (1 + tpDistPct),
      slDistPct,
    };
  }
  return {
    sl: entry * (1 + slDistPct),
    tp: entry * (1 - tpDistPct),
    slDistPct,
  };
}

function shouldEnter(signal: Signal): boolean {
  if (signal.strength === "STRONG") return true;
  if (signal.strength !== "MEDIUM") return false;

  if (signal.direction === "BUY") {
    return signal.reasons.some(
      (r) => r === "trend_up_confirm" || r === "mean_reversion_long"
    );
  }
  // SELL
  return signal.reasons.some(
    (r) => r === "trend_down_confirm" || r === "mean_reversion_short"
  );
}

function checkExitOnCandle(
  trade: PaperTrade,
  candle: Candle,
  indicators: Indicators
): { exitPrice: number; exitReason: string } | null {
  const { high, low, close } = candle;

  if (trade.direction === "BUY") {
    if (low <= trade.sl) return { exitPrice: trade.sl, exitReason: "stop_loss" };
    if (high >= trade.tp) return { exitPrice: trade.tp, exitReason: "take_profit" };
    const ema9 = indicators.ema9;
    const ema21 = indicators.ema21;
    if (ema9 != null && ema21 != null && ema9 < ema21) {
      return { exitPrice: close, exitReason: "ema_bearish_exit" };
    }
    if ((indicators.rsi ?? 0) > 75) {
      return { exitPrice: close, exitReason: "rsi_overbought_exit" };
    }
  } else {
    if (high >= trade.sl) return { exitPrice: trade.sl, exitReason: "stop_loss" };
    if (low <= trade.tp) return { exitPrice: trade.tp, exitReason: "take_profit" };
    const ema9 = indicators.ema9;
    const ema21 = indicators.ema21;
    if (ema9 != null && ema21 != null && ema9 > ema21) {
      return { exitPrice: close, exitReason: "ema_bullish_exit" };
    }
    if ((indicators.rsi ?? 100) < 25) {
      return { exitPrice: close, exitReason: "rsi_oversold_exit" };
    }
  }
  return null;
}

function maybeTrailStop(trade: PaperTrade, candle: Candle, indicators: Indicators): PaperTrade {
  const atr = indicators.atr ?? 0;
  if (atr <= 0) return trade;

  if (trade.direction === "BUY") {
    const moveInFavour = candle.high - trade.entryPrice;
    if (moveInFavour >= atr) {
      const newSl = Math.max(trade.sl, trade.entryPrice);
      if (newSl !== trade.sl) {
        return { ...trade, sl: newSl, trailingActive: true };
      }
    }
  } else {
    const moveInFavour = trade.entryPrice - candle.low;
    if (moveInFavour >= atr) {
      const newSl = Math.min(trade.sl, trade.entryPrice);
      if (newSl !== trade.sl) {
        return { ...trade, sl: newSl, trailingActive: true };
      }
    }
  }
  return trade;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = "paper_trading_state_v4";

function loadFromStorage(initialBalance: number, riskPct: number, leverage: number): PaperTradingState {
  if (typeof window === "undefined") return makeEmpty(initialBalance, riskPct, leverage);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PaperTradingState;
      // Forward-compat sanity defaults
      if (!parsed.openTrades) parsed.openTrades = {};
      return parsed;
    }
  } catch {
    // ignore
  }
  return makeEmpty(initialBalance, riskPct, leverage);
}

function saveToStorage(state: PaperTradingState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function makeEmpty(
  initialBalance: number,
  riskPerTradePct: number,
  leverage: number
): PaperTradingState {
  return {
    balance: initialBalance,
    equity: initialBalance,
    initialBalance,
    riskPerTradePct,
    leverage: Math.min(leverage, MAX_LEVERAGE),
    trades: [],
    openTrades: {},
    totalPnl: 0,
    totalFees: 0,
    winRate: 0,
  };
}

function recalcStats(state: PaperTradingState): PaperTradingState {
  const closed = state.trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;

  // Equity = free balance + locked margin + unrealised P&L on each open trade
  let lockedMargin = 0;
  let unrealised = 0;
  for (const t of Object.values(state.openTrades)) {
    lockedMargin += t.margin;
    const mark = t.lastPrice ?? t.entryPrice;
    unrealised += t.direction === "BUY"
      ? t.qty * (mark - t.entryPrice)
      : t.qty * (t.entryPrice - mark);
  }

  return {
    ...state,
    totalPnl: closed.reduce((s, t) => s + (t.pnl ?? 0), 0),
    totalFees: closed.reduce((s, t) => s + t.feesPaid, 0),
    winRate: closed.length > 0 ? (wins / closed.length) * 100 : 0,
    equity: state.balance + lockedMargin + unrealised,
  };
}

let _idCounter = Date.now();
function nextId() {
  return ++_idCounter;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePaperTrading(config: PaperTradingConfig) {
  const [ptState, setPtState] = useState<PaperTradingState>(() =>
    loadFromStorage(config.initialBalance, config.riskPerTradePct, config.leverage)
  );

  useEffect(() => {
    saveToStorage(ptState);
  }, [ptState]);

  const onClosedCandle = useCallback(
    (
      symbol: string,
      timeframe: string,
      candle: Candle,
      indicators: Indicators,
      signal: Signal | undefined,
    ) => {
      if (!TIMEFRAMES_ALLOWED.has(timeframe)) return;

      setPtState((prev) => {
        const openTrades = { ...prev.openTrades };
        let trades = prev.trades;
        let balance = prev.balance;

        // --- 1. Manage open trade for THIS symbol ---
        const existing = openTrades[symbol];
        if (existing) {
          // Only the trade's own timeframe should manage exits (avoid 5m candle
          // closing a 15m trade prematurely).
          if (existing.timeframe === timeframe) {
            let trade = maybeTrailStop(existing, candle, indicators);
            trade = { ...trade, lastPrice: candle.close };

            const exit = checkExitOnCandle(trade, candle, indicators);
            if (exit) {
              const exitNotional = trade.qty * exit.exitPrice;
              const exitFee = exitNotional * TAKER_FEE;
              const grossPnl =
                trade.direction === "BUY"
                  ? trade.qty * (exit.exitPrice - trade.entryPrice)
                  : trade.qty * (trade.entryPrice - exit.exitPrice);
              const totalFees = trade.feesPaid + exitFee;
              const netPnl = grossPnl - exitFee;

              const closedTrade: PaperTrade = {
                ...trade,
                exitPrice: exit.exitPrice,
                pnl: netPnl,
                pnlPct: (netPnl / trade.margin) * 100,
                feesPaid: totalFees,
                exitReason: exit.exitReason,
                closeAt: candle.close_time,
                status: "closed",
              };

              balance = balance + trade.margin + netPnl;
              trades = [closedTrade, ...trades.filter((t) => t.id !== trade.id)].slice(0, 500);
              delete openTrades[symbol];
            } else {
              openTrades[symbol] = trade;
              trades = trades.map((t) => (t.id === trade.id ? trade : t));
            }
          } else {
            // Different timeframe: just refresh mark price for equity
            const updated = { ...existing, lastPrice: candle.close };
            openTrades[symbol] = updated;
            trades = trades.map((t) => (t.id === existing.id ? updated : t));
          }
        }

        // --- 2. Maybe enter (only if no open trade for THIS symbol) ---
        if (!openTrades[symbol] && signal && shouldEnter(signal) && signal.price) {
          const entryPrice = signal.price;
          const { sl, tp, slDistPct } = computeRiskLevels(entryPrice, signal.direction, indicators);

          if (slDistPct > 0) {
            // Risk-based sizing on TOTAL equity (not just free balance)
            const equityForRisk = balance
              + Object.values(openTrades).reduce((s, t) => s + t.margin, 0);
            const riskUsd = (equityForRisk * prev.riskPerTradePct) / 100;
            const notionalIdeal = riskUsd / slDistPct;

            const maxNotional = balance * prev.leverage;
            const notional = Math.min(notionalIdeal, maxNotional);
            const margin = notional / prev.leverage;

            const liqPrice = approxLiqPrice(entryPrice, prev.leverage, signal.direction);
            const slDist = Math.abs(entryPrice - sl);
            const liqDist = Math.abs(entryPrice - liqPrice);

            const qty = notional / entryPrice;
            const entryFee = notional * TAKER_FEE;

            const ok =
              notional >= 10 &&
              margin >= 1 &&
              margin + entryFee <= balance &&
              liqDist >= MIN_LIQ_TO_SL_RATIO * slDist;

            if (ok) {
              const newTrade: PaperTrade = {
                id: nextId(),
                pair: symbol,
                timeframe,
                direction: signal.direction,
                entryPrice,
                notional,
                margin,
                leverage: prev.leverage,
                qty,
                liqPrice,
                initialSl: sl,
                sl,
                tp,
                trailingActive: false,
                feesPaid: entryFee,
                lastPrice: entryPrice,
                entryReasons: signal.reasons,
                openAt: signal.timestamp,
                status: "open",
              };

              balance = balance - margin - entryFee;
              openTrades[symbol] = newTrade;
              trades = [newTrade, ...trades].slice(0, 500);
            }
          }
        }

        return recalcStats({
          ...prev,
          balance,
          openTrades,
          trades,
        });
      });
    },
    []
  );

  const reset = useCallback(
    (newBalance?: number, newRiskPct?: number, newLeverage?: number) => {
      const fresh = makeEmpty(
        newBalance ?? config.initialBalance,
        newRiskPct ?? config.riskPerTradePct,
        Math.min(newLeverage ?? config.leverage, MAX_LEVERAGE)
      );
      setPtState(fresh);
      saveToStorage(fresh);
    },
    [config.initialBalance, config.riskPerTradePct, config.leverage]
  );

  const updateConfig = useCallback(
    (newBalance: number, newRiskPct: number, newLeverage: number) => {
      setPtState((prev) => ({
        ...prev,
        initialBalance: newBalance,
        riskPerTradePct: newRiskPct,
        leverage: Math.min(newLeverage, MAX_LEVERAGE),
      }));
    },
    []
  );

  const openTradesCount = Object.keys(ptState.openTrades).length;

  return { ptState, onClosedCandle, reset, updateConfig, openTradesCount };
}
