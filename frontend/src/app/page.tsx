"use client";

import { useState } from "react";
import { Pair, Timeframe } from "@/lib/types";
import { useMarketData } from "@/hooks/useMarketData";
import { usePaperTrading } from "@/hooks/usePaperTrading";
import { useSentiment } from "@/hooks/useSentiment";
import { PairSelector } from "@/components/PairSelector";
import { TimeframeSelector } from "@/components/TimeframeSelector";
import { CandlestickChart } from "@/components/Chart/CandlestickChart";
import { IndicatorPanel } from "@/components/Chart/IndicatorPanel";
import { SignalFeed } from "@/components/Signals/SignalFeed";
import { PaperTradingPanel } from "@/components/PaperTrading/PaperTradingPanel";
import { Sidebar, View } from "@/components/Sidebar";

export default function DashboardPage() {
  const [pair, setPair] = useState<Pair>("BTCUSDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("5m");
  const [view, setView] = useState<View>("dashboard");

  const { ptState, onClosedCandle, reset, openTradesCount } = usePaperTrading({
    initialBalance: 1000,
    riskPerTradePct: 0.5,
    leverage: 5,
  });

  const { data, loadHistory } = useMarketData(pair, timeframe, onClosedCandle);
  const sentiment = useSentiment();

  function handlePairChange(p: Pair) {
    setPair(p);
    loadHistory(p, timeframe);
  }

  function handleTimeframeChange(tf: Timeframe) {
    setTimeframe(tf);
    loadHistory(pair, tf);
  }

  const lastCandle = data.candles[data.candles.length - 1];
  const lastSignal = data.signals[0];

  return (
    <div className="min-h-[100dvh] bg-surface flex flex-col md:flex-row">
      <Sidebar current={view} onChange={setView} openTradesCount={openTradesCount} />

      <main className="flex-1 p-3 md:p-4 min-w-0">
        {view === "dashboard" && (
          <>
            <header className="mb-3 md:mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:flex-wrap md:gap-3">
              <div>
                <h1 className="text-lg md:text-xl font-bold tracking-tight">
                  Dashboard{" "}
                  <span className="text-slate-500 font-normal text-sm md:text-base">
                    {pair} · {timeframe}
                  </span>
                </h1>
              </div>
              <div className="flex items-center gap-2 md:gap-3 flex-wrap overflow-x-auto no-scrollbar -mx-1 px-1">
                <PairSelector value={pair} onChange={handlePairChange} />
                <TimeframeSelector value={timeframe} onChange={handleTimeframeChange} />
              </div>
            </header>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:items-center gap-2 md:gap-4 mb-3 md:mb-4 lg:flex-wrap">
              <div className="bg-card rounded px-4 py-2 border border-border">
                <span className="text-xs text-slate-500 block">Last Close</span>
                <span className="text-2xl font-mono font-bold">
                  {lastCandle
                    ? lastCandle.close.toLocaleString("en-US", { minimumFractionDigits: 2 })
                    : "—"}
                </span>
              </div>

              {lastSignal && (
                <div className="bg-card rounded px-4 py-2 border border-border">
                  <span className="text-xs text-slate-500 block mb-0.5">Latest Signal</span>
                  <span
                    className={
                      lastSignal.direction === "BUY"
                        ? "text-buy font-bold text-lg"
                        : "text-sell font-bold text-lg"
                    }
                  >
                    {lastSignal.direction}
                  </span>
                  <span
                    className={
                      lastSignal.strength === "STRONG"
                        ? " text-strong text-sm ml-2"
                        : " text-weak text-sm ml-2"
                    }
                  >
                    {lastSignal.strength}
                  </span>
                </div>
              )}

              <div className="bg-card rounded px-4 py-2 border border-border">
                <span className="text-xs text-slate-500 block">Candles</span>
                <span className="text-lg font-mono">{data.candles.length}</span>
              </div>

              {sentiment && (
                <div className="bg-card rounded px-4 py-2 border border-border">
                  <span className="text-xs text-slate-500 block">Market Sentiment</span>
                  <span
                    className={
                      sentiment.label === "bullish"
                        ? "text-buy font-bold text-lg"
                        : sentiment.label === "bearish"
                        ? "text-sell font-bold text-lg"
                        : "text-slate-300 font-bold text-lg"
                    }
                  >
                    {sentiment.label.toUpperCase()}
                  </span>
                  <span className="text-xs text-slate-500 ml-2 font-mono">
                    {sentiment.score >= 0 ? "+" : ""}
                    {sentiment.score.toFixed(2)} ({sentiment.samples})
                  </span>
                </div>
              )}

              {openTradesCount > 0 && (
                <button
                  onClick={() => setView("paper")}
                  className="bg-yellow-900/30 border border-yellow-600/50 rounded px-4 py-2 hover:bg-yellow-900/50 transition"
                >
                  <span className="text-xs text-yellow-400/70 block">Active Trades</span>
                  <span className="text-lg font-mono font-bold text-yellow-300">
                    {openTradesCount} open
                  </span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-3 md:gap-4">
              <div className="flex flex-col gap-3 md:gap-4">
                <div className="bg-card rounded border border-border p-2 md:p-3">
                  <CandlestickChart candles={data.candles} indicators={data.indicators} />
                </div>
                <div className="bg-card rounded border border-border p-3">
                  <h2 className="text-xs text-slate-500 mb-2 uppercase tracking-wider">
                    Indicators
                  </h2>
                  <IndicatorPanel indicators={data.indicators} />
                </div>
              </div>

              <div className="bg-card rounded border border-border p-3">
                <h2 className="text-xs text-slate-500 mb-2 uppercase tracking-wider">
                  Signal Feed — {pair} {timeframe}
                </h2>
                <SignalFeed signals={data.signals} timeframe={timeframe} />
              </div>
            </div>
          </>
        )}

        {view === "paper" && (
          <>
            <header className="mb-4">
              <h1 className="text-xl font-bold tracking-tight">
                Paper Trading{" "}
                <span className="text-slate-500 font-normal text-base">
                  All pairs · global history
                </span>
              </h1>
            </header>
            <PaperTradingPanel state={ptState} onReset={reset} />
          </>
        )}
      </main>
    </div>
  );
}
