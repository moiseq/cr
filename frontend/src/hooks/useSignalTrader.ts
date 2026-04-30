"use client";

import { useCallback, useEffect, useState } from "react";
import { WsMessage } from "@/lib/types";
import { useWebSocket } from "./useWebSocket";

// ---------------------------------------------------------------------------
// Signal-trader hook — server-driven.
//
// All trading logic now runs on the backend (`backend/app/core/signal_trader.py`)
// continuously, regardless of whether any frontend client is connected. This
// hook simply mirrors the latest state pushed by the backend over the WS
// channel (`signal_state` messages) and exposes mutators that hit the REST API.
// ---------------------------------------------------------------------------

export interface SignalTrade {
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
  pnlPct?: number;
  lastPrice?: number;

  entryReasons: string[];
  exitReason?: string;
  openAt: number;
  closeAt?: number;
  status: "open" | "closed";
}

export interface SignalTraderState {
  balance: number;
  equity: number;
  initialBalance: number;
  riskPerTradePct: number;
  leverage: number;
  trades: SignalTrade[];
  openTrades: Record<string, SignalTrade>;
  totalPnl: number;
  totalFees: number;
  winRate: number;
}

export const MAX_LEVERAGE = 10;
export const TAKER_FEE = 0.0004;

const EMPTY_STATE: SignalTraderState = {
  balance: 1000,
  equity: 1000,
  initialBalance: 1000,
  riskPerTradePct: 0.5,
  leverage: 5,
  trades: [],
  openTrades: {},
  totalPnl: 0,
  totalFees: 0,
  winRate: 0,
};

export function useSignalTrader() {
  const [state, setState] = useState<SignalTraderState>(EMPTY_STATE);

  // Initial fetch on mount (so the panel is populated even before the first
  // WS push arrives).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/signal-trader")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setState(data as SignalTraderState);
      })
      .catch(() => {
        // Ignore — WS update will populate eventually.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live updates pushed by the backend.
  const handleWs = useCallback((msg: WsMessage) => {
    if (msg.type === "signal_state" && msg.state) {
      setState(msg.state as SignalTraderState);
    }
  }, []);
  useWebSocket({ onMessage: handleWs });

  const reset = useCallback(
    async (initialBalance: number, riskPerTradePct: number, leverage: number) => {
      try {
        const res = await fetch("/api/signal-trader/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initialBalance, riskPerTradePct, leverage }),
        });
        if (res.ok) {
          setState((await res.json()) as SignalTraderState);
        }
      } catch {
        // Swallow — backend will push state again on success.
      }
    },
    []
  );

  const updateConfig = useCallback(
    async (initialBalance: number, riskPerTradePct: number, leverage: number) => {
      try {
        const res = await fetch("/api/signal-trader/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initialBalance, riskPerTradePct, leverage }),
        });
        if (res.ok) {
          setState((await res.json()) as SignalTraderState);
        }
      } catch {
        // Swallow.
      }
    },
    []
  );

  const openTradesCount = Object.keys(state.openTrades).length;

  return { state, reset, updateConfig, openTradesCount };
}
