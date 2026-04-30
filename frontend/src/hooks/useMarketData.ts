"use client";

import { useState, useCallback, useRef } from "react";
import { Candle, Indicators, Signal, WsMessage, Pair, Timeframe } from "@/lib/types";
import { useWebSocket } from "./useWebSocket";

const MAX_CANDLES = 500;

interface MarketData {
  candles: Candle[];
  indicators: Indicators;
  signals: Signal[];
}

type MarketState = Record<string, Record<string, MarketData>>;

function key(symbol: string, tf: string) {
  return `${symbol}:${tf}`;
}

function emptyData(): MarketData {
  return { candles: [], indicators: {}, signals: [] };
}

export function useMarketData(activePair: Pair, activeTimeframe: Timeframe) {
  const [state, setState] = useState<MarketState>({});
  const loadedRef = useRef<Set<string>>(new Set());

  const loadHistory = useCallback(async (symbol: string, tf: string) => {
    const k = key(symbol, tf);
    if (loadedRef.current.has(k)) return;
    loadedRef.current.add(k);

    try {
      const res = await fetch(`/api/candles/${symbol}/${tf}?limit=200`);
      if (!res.ok) return;
      const data = await res.json();

      setState((prev) => ({
        ...prev,
        [symbol]: {
          ...(prev[symbol] ?? {}),
          [tf]: {
            candles: data.candles ?? [],
            indicators: data.indicators ?? {},
            signals: [],
          },
        },
      }));

      const sres = await fetch(
        `/api/signals?symbol=${symbol}&timeframe=${tf}&limit=50`
      );
      if (sres.ok) {
        const sdata = await sres.json();
        setState((prev) => ({
          ...prev,
          [symbol]: {
            ...(prev[symbol] ?? {}),
            [tf]: {
              ...(prev[symbol]?.[tf] ?? emptyData()),
              signals: sdata.signals ?? [],
            },
          },
        }));
      }
    } catch {
      loadedRef.current.delete(k);
    }
  }, []);

  const handleMessage = useCallback((msg: WsMessage) => {
    // Ignore non-candle WS messages (e.g. signal_state — handled by useSignalTrader).
    if (msg.type !== "candle_live" && msg.type !== "candle_closed") return;

    const { type, symbol, timeframe, candle, indicators, signal } = msg;
    if (!symbol || !timeframe || !candle) return;

    setState((prev) => {
      const pairData = prev[symbol] ?? {};
      const tfData = pairData[timeframe] ?? emptyData();

      let candles = [...tfData.candles];

      if (
        candles.length > 0 &&
        candles[candles.length - 1].open_time === candle.open_time
      ) {
        candles[candles.length - 1] = candle;
      } else {
        candles = [...candles, candle].slice(-MAX_CANDLES);
      }

      const updatedSignals =
        signal && type === "candle_closed"
          ? [signal, ...tfData.signals].slice(0, 100)
          : tfData.signals;

      return {
        ...prev,
        [symbol]: {
          ...pairData,
          [timeframe]: {
            candles,
            indicators: indicators ?? tfData.indicators,
            signals: updatedSignals,
          },
        },
      };
    });
  }, []);

  useWebSocket({ onMessage: handleMessage });

  const currentData = state[activePair]?.[activeTimeframe] ?? emptyData();

  if (!loadedRef.current.has(key(activePair, activeTimeframe))) {
    loadHistory(activePair, activeTimeframe);
  }

  return { data: currentData, loadHistory };
}
