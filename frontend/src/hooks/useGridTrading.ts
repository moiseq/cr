"use client";

import { useCallback, useEffect, useState } from "react";
import { WsMessage } from "@/lib/types";
import { useWebSocket } from "./useWebSocket";

// ---------------------------------------------------------------------------
// Grid-trading hook — server-driven.
// All logic runs in `backend/app/core/grid_trader.py`.
// ---------------------------------------------------------------------------

export type Regime = "TREND_UP" | "TREND_DOWN" | "RANGE" | "CHOP" | "UNKNOWN";

export interface GridCellTrade {
  id: number;
  cellId: string;
  pair: string;
  timeframe: string;
  direction: "BUY" | "SELL";
  level: number;
  entryPrice: number;
  exitPrice?: number;
  tp: number;
  sl: number;
  notional: number;
  margin: number;
  leverage: number;
  qty: number;
  feesPaid: number;
  lastPrice?: number;
  pnl?: number;
  pnlPct?: number;
  regime: Regime;
  openAt: number;
  closeAt?: number;
  exitReason?: string;
  status: "open" | "closed";
}

export interface PairGrid {
  regime: Regime;
  regimeUpdatedAt: number;
  lower: number | null;
  upper: number | null;
  center: number | null;
  spacing: number | null;
  atr: number | null;
  levels: number[];
  cells: Record<string, number>;
  allocatedCapital: number;
  lastBuildAt: number;
  disabledReason: string | null;
}

export interface GridTradingState {
  balance: number;
  equity: number;
  initialBalance: number;
  leverage: number;
  perPairAllocationPct: number;
  pairs: string[];
  grids: Record<string, PairGrid>;
  trades: GridCellTrade[];
  openTrades: Record<string, GridCellTrade>;
  totalPnl: number;
  totalFees: number;
  winRate: number;
  totalTrades: number;
}

export const GRID_MAX_LEVERAGE = 10;

const EMPTY_STATE: GridTradingState = {
  balance: 700,
  equity: 700,
  initialBalance: 700,
  leverage: 3,
  perPairAllocationPct: 50,
  pairs: ["BTCUSDT", "ETHUSDT"],
  grids: {},
  trades: [],
  openTrades: {},
  totalPnl: 0,
  totalFees: 0,
  winRate: 0,
  totalTrades: 0,
};

export function useGridTrading() {
  const [state, setState] = useState<GridTradingState>(EMPTY_STATE);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/grid")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setState(data as GridTradingState);
      })
      .catch(() => {
        // ignore — WS will populate
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleWs = useCallback((msg: WsMessage) => {
    if (msg.type === "grid_state" && msg.state) {
      setState(msg.state as GridTradingState);
    }
  }, []);
  useWebSocket({ onMessage: handleWs });

  const reset = useCallback(
    async (initialBalance: number, leverage: number, perPairAllocationPct: number) => {
      try {
        const res = await fetch("/api/grid/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initialBalance, leverage, perPairAllocationPct }),
        });
        if (res.ok) setState((await res.json()) as GridTradingState);
      } catch {
        // ignore
      }
    },
    []
  );

  const updateConfig = useCallback(
    async (initialBalance: number, leverage: number, perPairAllocationPct: number) => {
      try {
        const res = await fetch("/api/grid/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initialBalance, leverage, perPairAllocationPct }),
        });
        if (res.ok) setState((await res.json()) as GridTradingState);
      } catch {
        // ignore
      }
    },
    []
  );

  const openCellsCount = Object.keys(state.openTrades).length;

  return { state, reset, updateConfig, openCellsCount };
}
