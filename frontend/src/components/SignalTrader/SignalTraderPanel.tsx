"use client";

import { useState } from "react";
import clsx from "clsx";
import { MAX_LEVERAGE, SignalTrade, SignalTraderState } from "@/hooks/useSignalTrader";

interface Props {
  state: SignalTraderState;
  onReset: (balance: number, riskPct: number, leverage: number) => void;
}

function fmtPrice(n?: number) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

function fmtPct(n?: number) {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtTime(ts?: number) {
  if (!ts) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(ts);
}

function TradeRow({ trade }: { trade: SignalTrade }) {
  const isBuy = trade.direction === "BUY";
  const isOpen = trade.status === "open";
  const pnlPositive = (trade.pnl ?? 0) >= 0;

  return (
    <tr className="border-b border-border text-xs hover:bg-slate-800/40 transition-colors">
      <td className="py-1.5 px-2 whitespace-nowrap text-slate-400">{fmtTime(trade.openAt)}</td>
      <td className="py-1.5 px-2 font-medium text-slate-300">
        {trade.pair} <span className="text-slate-500">{trade.timeframe}</span>
      </td>
      <td className="py-1.5 px-2">
        <span
          className={clsx(
            "font-bold px-1.5 py-0.5 rounded text-[10px]",
            isBuy ? "bg-buy text-black" : "bg-sell text-white"
          )}
        >
          {trade.direction}
        </span>
      </td>
      <td className="py-1.5 px-2 font-mono text-slate-400 text-[10px]">{trade.leverage}x</td>
      <td className="py-1.5 px-2 font-mono text-slate-300">{fmtPrice(trade.entryPrice)}</td>
      <td className="py-1.5 px-2 font-mono text-red-400/80 text-[10px]">{fmtPrice(trade.sl)}</td>
      <td className="py-1.5 px-2 font-mono text-green-400/80 text-[10px]">{fmtPrice(trade.tp)}</td>
      <td className="py-1.5 px-2 font-mono text-slate-300">
        {isOpen ? <span className="text-slate-500 italic">open</span> : fmtPrice(trade.exitPrice)}
      </td>
      <td className="py-1.5 px-2 font-mono">
        {isOpen ? (
          <span className="text-slate-500 italic">—</span>
        ) : (
          <span className={pnlPositive ? "text-green-400" : "text-red-400"}>
            {fmtPct(trade.pnlPct)}
          </span>
        )}
      </td>
      <td className="py-1.5 px-2 font-mono">
        {isOpen ? (
          <span className="text-slate-500 italic">—</span>
        ) : (
          <span className={pnlPositive ? "text-green-400" : "text-red-400"}>
            {pnlPositive ? "+" : ""}
            {fmtPrice(trade.pnl)}
          </span>
        )}
      </td>
      <td className="py-1.5 px-2 text-slate-500 font-mono text-[10px]">
        ${fmtPrice(trade.feesPaid)}
      </td>
      <td className="py-1.5 px-2 text-slate-400 max-w-[160px] truncate">
        {isOpen ? (
          <span className="text-yellow-400 font-medium">● OPEN</span>
        ) : (
          trade.exitReason?.replace(/_/g, " ")
        )}
      </td>
      <td className="py-1.5 px-2 text-slate-500 max-w-[160px] truncate">
        {trade.entryReasons.join(", ").replace(/_/g, " ")}
      </td>
    </tr>
  );
}

function OpenTradeBanner({ trade }: { trade: SignalTrade }) {
  const mark = trade.lastPrice ?? trade.entryPrice;
  const unreal =
    trade.direction === "BUY"
      ? trade.qty * (mark - trade.entryPrice)
      : trade.qty * (trade.entryPrice - mark);
  const unrealPct = (unreal / trade.margin) * 100;
  const positive = unreal >= 0;

  return (
    <div className="rounded border border-yellow-600/50 bg-yellow-900/10 px-3 py-2 text-xs text-yellow-200 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="font-bold">●</span>
      <span className="font-mono text-slate-100">
        {trade.pair} <span className="text-slate-500">{trade.timeframe}</span>
      </span>
      <span
        className={clsx(
          "font-bold px-1.5 py-0.5 rounded text-[10px]",
          trade.direction === "BUY" ? "bg-buy text-black" : "bg-sell text-white"
        )}
      >
        {trade.direction}
      </span>
      <span className="text-slate-400">{trade.leverage}x</span>
      <span>Entry <strong className="font-mono text-slate-200">{fmtPrice(trade.entryPrice)}</strong></span>
      <span>Mark <strong className="font-mono text-slate-200">{fmtPrice(mark)}</strong></span>
      <span>SL <strong className="font-mono text-red-300">{fmtPrice(trade.sl)}</strong></span>
      <span>TP <strong className="font-mono text-green-300">{fmtPrice(trade.tp)}</strong></span>
      <span>Liq <strong className="font-mono text-orange-300">{fmtPrice(trade.liqPrice)}</strong></span>
      <span>Margin <strong className="font-mono text-slate-200">${fmtPrice(trade.margin)}</strong></span>
      <span className={positive ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
        {positive ? "+" : ""}
        {fmtPrice(unreal)} ({fmtPct(unrealPct)})
      </span>
      {trade.trailingActive && <span className="text-cyan-300 font-bold">trailing</span>}
    </div>
  );
}

export function SignalTraderPanel({ state, onReset }: Props) {
  const [showConfig, setShowConfig] = useState(false);
  const [balanceInput, setBalanceInput] = useState(String(state.initialBalance));
  const [riskInput, setRiskInput] = useState(String(state.riskPerTradePct));
  const [levInput, setLevInput] = useState(String(state.leverage));
  const [pairFilter, setPairFilter] = useState<string>("");

  const totalReturnPct =
    state.initialBalance > 0
      ? ((state.equity - state.initialBalance) / state.initialBalance) * 100
      : 0;
  const totalReturnPositive = totalReturnPct >= 0;

  function handleReset() {
    const b = parseFloat(balanceInput);
    const r = parseFloat(riskInput);
    const l = parseFloat(levInput);
    if (isNaN(b) || b <= 0) return;
    if (isNaN(r) || r <= 0 || r > 10) return;
    if (isNaN(l) || l < 1 || l > MAX_LEVERAGE) return;
    onReset(b, r, l);
    setShowConfig(false);
  }

  const openList = Object.values(state.openTrades);
  const visibleTrades = pairFilter
    ? state.trades.filter((t) => t.pair === pairFilter)
    : state.trades;
  const allPairs = Array.from(new Set(state.trades.map((t) => t.pair))).sort();

  return (
    <div className="bg-card rounded border border-border p-4">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h2 className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
          Signal Trading — All Pairs · Weighted Score + ATR Risk Sizing
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-slate-500 uppercase">
            Risk {state.riskPerTradePct}% · Leverage {state.leverage}x · 15m+1h · LONG/SHORT
          </span>
          <button
            onClick={() => setShowConfig((v) => !v)}
            className="rounded border border-border bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white transition"
          >
            {showConfig ? "Hide Config" : "⚙ Config / Reset"}
          </button>
        </div>
      </div>

      {/* Config panel */}
      {showConfig && (
        <div className="mb-4 flex flex-wrap items-end gap-4 rounded border border-border bg-slate-900 p-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Initial Balance (USDT)</label>
            <input
              type="number"
              min="1"
              step="100"
              value={balanceInput}
              onChange={(e) => setBalanceInput(e.target.value)}
              className="w-36 rounded border border-border bg-slate-800 px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-slate-400"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Risk per trade (%)</label>
            <input
              type="number"
              min="0.1"
              max="5"
              step="0.1"
              value={riskInput}
              onChange={(e) => setRiskInput(e.target.value)}
              className="w-24 rounded border border-border bg-slate-800 px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-slate-400"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Leverage (1–{MAX_LEVERAGE}x)</label>
            <input
              type="number"
              min="1"
              max={MAX_LEVERAGE}
              step="1"
              value={levInput}
              onChange={(e) => setLevInput(e.target.value)}
              className="w-20 rounded border border-border bg-slate-800 px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-slate-400"
            />
          </div>
          <button
            onClick={handleReset}
            className="rounded border border-red-700 bg-red-900/40 px-4 py-1.5 text-xs font-bold text-red-300 hover:bg-red-800/60 hover:text-red-100 transition"
          >
            Reset Simulation
          </button>
          <div className="text-xs text-slate-500 mt-1 w-full">
            Position size = (equity × risk%) / SL distance. SL = 1×ATR, TP = 2×ATR.
            One position per pair, multiple pairs in parallel.
          </div>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
        <StatCard label="Equity" value={`$${fmtPrice(state.equity)}`} />
        <StatCard label="Free Balance" value={`$${fmtPrice(state.balance)}`} />
        <StatCard
          label="Total Return"
          value={fmtPct(totalReturnPct)}
          color={totalReturnPositive ? "green" : "red"}
        />
        <StatCard
          label="Total P&L"
          value={`${state.totalPnl >= 0 ? "+" : ""}$${fmtPrice(state.totalPnl)}`}
          color={state.totalPnl >= 0 ? "green" : "red"}
        />
        <StatCard label="Fees Paid" value={`$${fmtPrice(state.totalFees)}`} color="red" />
        <StatCard
          label="Win Rate"
          value={`${state.winRate.toFixed(1)}%`}
          color={state.winRate >= 50 ? "green" : "red"}
        />
        <StatCard
          label="Open / Closed"
          value={`${openList.length} / ${state.trades.filter((t) => t.status === "closed").length}`}
        />
      </div>

      {/* Open trades */}
      {openList.length > 0 && (
        <div className="mb-4 space-y-1.5">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
            Open Positions ({openList.length})
          </div>
          {openList.map((t) => (
            <OpenTradeBanner key={t.id} trade={t} />
          ))}
        </div>
      )}

      {/* Filter by pair */}
      {allPairs.length > 1 && (
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          <span className="text-[10px] text-slate-500 uppercase mr-1">Filter:</span>
          <button
            onClick={() => setPairFilter("")}
            className={clsx(
              "px-2 py-0.5 rounded text-[10px] border transition",
              pairFilter === ""
                ? "border-slate-400 bg-slate-700 text-white"
                : "border-border bg-slate-900 text-slate-400 hover:text-slate-200"
            )}
          >
            All
          </button>
          {allPairs.map((p) => (
            <button
              key={p}
              onClick={() => setPairFilter(p)}
              className={clsx(
                "px-2 py-0.5 rounded text-[10px] border transition font-mono",
                pairFilter === p
                  ? "border-slate-400 bg-slate-700 text-white"
                  : "border-border bg-slate-900 text-slate-400 hover:text-slate-200"
              )}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Trades table */}
      {visibleTrades.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-6">
          No trades yet. Waiting for a STRONG signal (or MEDIUM with trend confirmation)…
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] uppercase text-slate-500 border-b border-border">
                <th className="py-1 px-2">Time</th>
                <th className="py-1 px-2">Pair / TF</th>
                <th className="py-1 px-2">Dir</th>
                <th className="py-1 px-2">Lev</th>
                <th className="py-1 px-2">Entry</th>
                <th className="py-1 px-2">SL</th>
                <th className="py-1 px-2">TP</th>
                <th className="py-1 px-2">Exit</th>
                <th className="py-1 px-2">P&L %</th>
                <th className="py-1 px-2">P&L $</th>
                <th className="py-1 px-2">Fees</th>
                <th className="py-1 px-2">Exit reason</th>
                <th className="py-1 px-2">Entry reasons</th>
              </tr>
            </thead>
            <tbody>
              {visibleTrades.map((t) => (
                <TradeRow key={t.id} trade={t} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "green" | "red";
}) {
  return (
    <div className="rounded border border-border bg-slate-900 px-3 py-2">
      <div className="text-[10px] text-slate-500 uppercase mb-0.5">{label}</div>
      <div
        className={clsx(
          "text-sm font-mono font-bold",
          color === "green" && "text-green-400",
          color === "red" && "text-red-400",
          !color && "text-slate-200"
        )}
      >
        {value}
      </div>
    </div>
  );
}
