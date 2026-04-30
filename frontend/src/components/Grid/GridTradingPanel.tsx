"use client";

import { useState } from "react";
import clsx from "clsx";
import {
  GRID_MAX_LEVERAGE,
  GridCellTrade,
  GridTradingState,
  PairGrid,
  Regime,
} from "@/hooks/useGridTrading";

interface Props {
  state: GridTradingState;
  onReset: (balance: number, leverage: number, perPairPct: number) => void;
}

function fmtPrice(n?: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
}

function fmtUsd(n?: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

function regimeColor(r: Regime): string {
  switch (r) {
    case "TREND_UP":
      return "text-green-400 border-green-700/50 bg-green-900/20";
    case "TREND_DOWN":
      return "text-red-400 border-red-700/50 bg-red-900/20";
    case "RANGE":
      return "text-blue-300 border-blue-700/50 bg-blue-900/20";
    case "CHOP":
      return "text-orange-400 border-orange-700/50 bg-orange-900/20";
    default:
      return "text-slate-400 border-border bg-slate-900";
  }
}

function GridPairCard({
  pair,
  grid,
  openTrades,
}: {
  pair: string;
  grid: PairGrid;
  openTrades: GridCellTrade[];
}) {
  const cells = openTrades.filter((t) => t.pair === pair);
  const buys = cells.filter((c) => c.direction === "BUY");
  const sells = cells.filter((c) => c.direction === "SELL");

  // Use last seen price across any open cell, else center
  const livePrice =
    cells[0]?.lastPrice ??
    (grid.center ?? null);

  return (
    <div className="rounded border border-border bg-slate-900/50 p-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-slate-100">{pair}</span>
          <span
            className={clsx(
              "text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider",
              regimeColor(grid.regime)
            )}
          >
            {grid.regime}
          </span>
          {grid.disabledReason && (
            <span className="text-[10px] text-slate-500 italic">
              {grid.disabledReason}
            </span>
          )}
        </div>
        <span className="text-[10px] text-slate-500 font-mono">
          updated {fmtTime(grid.regimeUpdatedAt)}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
        <Mini label="Allocated" value={`$${fmtUsd(grid.allocatedCapital)}`} />
        <Mini label="Live price" value={fmtPrice(livePrice)} />
        <Mini label="Center (EMA21)" value={fmtPrice(grid.center)} />
        <Mini label="Spacing" value={fmtPrice(grid.spacing)} />
        <Mini label="ATR" value={fmtPrice(grid.atr)} />
      </div>

      <div className="text-xs text-slate-400">
        Bounds:{" "}
        <span className="font-mono text-slate-200">{fmtPrice(grid.lower)}</span>{" "}
        →{" "}
        <span className="font-mono text-slate-200">{fmtPrice(grid.upper)}</span>{" "}
        · {grid.levels?.length ?? 0} levels · {buys.length} long · {sells.length} short
      </div>

      {grid.levels && grid.levels.length > 0 && livePrice != null && (
        <GridLevelsBar grid={grid} livePrice={livePrice} cells={cells} />
      )}
    </div>
  );
}

function GridLevelsBar({
  grid,
  livePrice,
  cells,
}: {
  grid: PairGrid;
  livePrice: number;
  cells: GridCellTrade[];
}) {
  const lower = grid.lower ?? 0;
  const upper = grid.upper ?? 0;
  const range = upper - lower;
  if (range <= 0) return null;

  const cellByLevel = new Map<string, GridCellTrade>();
  for (const c of cells) cellByLevel.set(c.level.toFixed(8), c);

  return (
    <div className="relative h-12 bg-slate-950 border border-border rounded">
      {grid.levels?.map((level) => {
        const pct = ((level - lower) / range) * 100;
        const cell = cellByLevel.get(level.toFixed(8));
        const filled = !!cell;
        return (
          <div
            key={level}
            className={clsx(
              "absolute top-0 bottom-0 w-px",
              filled
                ? cell!.direction === "BUY"
                  ? "bg-green-400"
                  : "bg-red-400"
                : "bg-slate-700"
            )}
            style={{ left: `${pct}%` }}
            title={`${fmtPrice(level)}${filled ? ` · ${cell!.direction}` : ""}`}
          />
        );
      })}
      {/* Live price marker */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-yellow-300 shadow-[0_0_8px_rgba(252,211,77,0.7)]"
        style={{
          left: `${Math.max(0, Math.min(100, ((livePrice - lower) / range) * 100))}%`,
        }}
        title={`live ${fmtPrice(livePrice)}`}
      />
      <div className="absolute -bottom-4 left-0 text-[9px] text-slate-500 font-mono">
        {fmtPrice(lower)}
      </div>
      <div className="absolute -bottom-4 right-0 text-[9px] text-slate-500 font-mono">
        {fmtPrice(upper)}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-slate-950 px-2 py-1">
      <div className="text-[9px] text-slate-500 uppercase">{label}</div>
      <div className="text-xs font-mono text-slate-200">{value}</div>
    </div>
  );
}

function CellRow({ trade }: { trade: GridCellTrade }) {
  const isBuy = trade.direction === "BUY";
  const isOpen = trade.status === "open";
  const pnlPositive = (trade.pnl ?? 0) >= 0;

  return (
    <tr className="border-b border-border text-xs hover:bg-slate-800/40">
      <td className="py-1.5 px-2 whitespace-nowrap text-slate-400">
        {fmtTime(trade.openAt)}
      </td>
      <td className="py-1.5 px-2 font-mono text-slate-300">{trade.pair}</td>
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
      <td className="py-1.5 px-2 font-mono text-slate-300">
        {fmtPrice(trade.level)}
      </td>
      <td className="py-1.5 px-2 font-mono text-slate-300">
        {fmtPrice(trade.entryPrice)}
      </td>
      <td className="py-1.5 px-2 font-mono text-green-400/80 text-[10px]">
        {fmtPrice(trade.tp)}
      </td>
      <td className="py-1.5 px-2 font-mono text-red-400/80 text-[10px]">
        {fmtPrice(trade.sl)}
      </td>
      <td className="py-1.5 px-2 font-mono text-slate-300">
        {isOpen ? (
          <span className="text-yellow-400 italic">open</span>
        ) : (
          fmtPrice(trade.exitPrice)
        )}
      </td>
      <td className="py-1.5 px-2 font-mono">
        {isOpen ? (
          <span className="text-slate-500 italic">—</span>
        ) : (
          <span className={pnlPositive ? "text-green-400" : "text-red-400"}>
            {pnlPositive ? "+" : ""}${fmtUsd(trade.pnl)}
          </span>
        )}
      </td>
      <td className="py-1.5 px-2 font-mono text-[10px]">
        {isOpen ? (
          <span className="text-slate-500">—</span>
        ) : (
          <span className={pnlPositive ? "text-green-400" : "text-red-400"}>
            {fmtPct(trade.pnlPct)}
          </span>
        )}
      </td>
      <td className="py-1.5 px-2 text-slate-400 text-[10px]">
        {isOpen ? (
          <span className="text-yellow-400">● {trade.regime}</span>
        ) : (
          trade.exitReason?.replace(/_/g, " ")
        )}
      </td>
    </tr>
  );
}

export function GridTradingPanel({ state, onReset }: Props) {
  const [showConfig, setShowConfig] = useState(false);
  const [activeTab, setActiveTab] = useState<"grids" | "trades">("grids");
  const [balanceInput, setBalanceInput] = useState(String(state.initialBalance));
  const [levInput, setLevInput] = useState(String(state.leverage));
  const [allocInput, setAllocInput] = useState(String(state.perPairAllocationPct));

  const totalReturnPct =
    state.initialBalance > 0
      ? ((state.equity - state.initialBalance) / state.initialBalance) * 100
      : 0;

  // Open P&L = unrealised mark-to-market on currently-open cells, NET of the
  // entry fees already deducted from balance. Defined so that
  //   equity = initialBalance + realisedPnL + openPnL
  // always holds (otherwise paid entry fees would be invisible until close).
  const openPnl = state.equity - state.initialBalance - state.totalPnl;

  function handleReset() {
    const b = parseFloat(balanceInput);
    const l = parseFloat(levInput);
    const a = parseFloat(allocInput);
    if (isNaN(b) || b <= 0) return;
    if (isNaN(l) || l < 1 || l > GRID_MAX_LEVERAGE) return;
    if (isNaN(a) || a <= 0 || a > 100) return;
    onReset(b, l, a);
    setShowConfig(false);
  }

  const openTrades = Object.values(state.openTrades);
  const closedTrades = state.trades.filter((t) => t.status === "closed");

  return (
    <div className="bg-card rounded border border-border p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
          Adaptive Grid Trading — BTC + ETH · regime-aware
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-slate-500 uppercase">
            Lev {state.leverage}x · {state.perPairAllocationPct}%/pair · 1h regime · 15m exec
          </span>
          <button
            onClick={() => setShowConfig((v) => !v)}
            className="rounded border border-border bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white"
          >
            {showConfig ? "Hide Config" : "⚙ Config / Reset"}
          </button>
        </div>
      </div>

      {showConfig && (
        <div className="flex flex-wrap items-end gap-4 rounded border border-border bg-slate-900 p-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Initial Balance (USDT)
            </label>
            <input
              type="number"
              min="1"
              step="50"
              value={balanceInput}
              onChange={(e) => setBalanceInput(e.target.value)}
              className="w-36 rounded border border-border bg-slate-800 px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-slate-400"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Leverage (1–{GRID_MAX_LEVERAGE}x)
            </label>
            <input
              type="number"
              min="1"
              max={GRID_MAX_LEVERAGE}
              step="1"
              value={levInput}
              onChange={(e) => setLevInput(e.target.value)}
              className="w-20 rounded border border-border bg-slate-800 px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-slate-400"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Allocation per pair (%)
            </label>
            <input
              type="number"
              min="10"
              max="100"
              step="5"
              value={allocInput}
              onChange={(e) => setAllocInput(e.target.value)}
              className="w-24 rounded border border-border bg-slate-800 px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-slate-400"
            />
          </div>
          <button
            onClick={handleReset}
            className="rounded border border-red-700 bg-red-900/40 px-4 py-1.5 text-xs font-bold text-red-300 hover:bg-red-800/60 hover:text-red-100"
          >
            Reset Grid
          </button>
          <p className="text-xs text-slate-500 mt-1 w-full">
            Grid bounds = max(BB, 1.5×ATR) around EMA21. Spacing = 0.5×ATR. Up to{" "}
            12 levels per pair. RANGE = bidirectional, TREND = single-direction,
            CHOP = disabled.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <Stat label="Equity" value={`$${fmtUsd(state.equity)}`} />
        <Stat label="Free Balance" value={`$${fmtUsd(state.balance)}`} />
        <Stat
          label="Total Return"
          value={fmtPct(totalReturnPct)}
          color={totalReturnPct >= 0 ? "green" : "red"}
        />
        <Stat
          label="Realised P&L"
          value={`${state.totalPnl >= 0 ? "+" : ""}$${fmtUsd(state.totalPnl)}`}
          color={state.totalPnl >= 0 ? "green" : "red"}
        />
        <Stat
          label="Open P&L"
          value={`${openPnl >= 0 ? "+" : ""}$${fmtUsd(openPnl)}`}
          color={openPnl >= 0 ? "green" : "red"}
        />
        <Stat label="Fees Paid" value={`$${fmtUsd(state.totalFees)}`} color="red" />
        <Stat
          label="Win Rate"
          value={`${state.winRate.toFixed(1)}%`}
          color={state.winRate >= 50 ? "green" : "red"}
        />
        <Stat
          label="Open / Closed"
          value={`${openTrades.length} / ${closedTrades.length}`}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <TabButton
          active={activeTab === "grids"}
          onClick={() => setActiveTab("grids")}
        >
          Grids ({state.pairs.length})
        </TabButton>
        <TabButton
          active={activeTab === "trades"}
          onClick={() => setActiveTab("trades")}
        >
          Cell trades ({state.trades.length})
        </TabButton>
      </div>

      {activeTab === "grids" && (
        <div className="space-y-3">
          {state.pairs.map((pair) => {
            const grid = state.grids[pair];
            if (!grid) return null;
            return (
              <GridPairCard
                key={pair}
                pair={pair}
                grid={grid}
                openTrades={openTrades}
              />
            );
          })}
        </div>
      )}

      {activeTab === "trades" && (
        <div>
          {state.trades.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-6">
              No grid cells fired yet. Waiting for regime detection on a 15m
              close…
            </p>
          ) : (
            <div className="overflow-x-auto overflow-y-auto max-h-[60vh] rounded border border-border">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-slate-900 z-10">
                  <tr className="text-[10px] uppercase text-slate-500 border-b border-border">
                    <th className="py-1 px-2">Time</th>
                    <th className="py-1 px-2">Pair</th>
                    <th className="py-1 px-2">Dir</th>
                    <th className="py-1 px-2">Level</th>
                    <th className="py-1 px-2">Entry</th>
                    <th className="py-1 px-2">TP</th>
                    <th className="py-1 px-2">SL</th>
                    <th className="py-1 px-2">Exit</th>
                    <th className="py-1 px-2">P&L</th>
                    <th className="py-1 px-2">P&L %</th>
                    <th className="py-1 px-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {state.trades.slice(0, 200).map((t) => (
                    <CellRow key={t.id} trade={t} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "px-3 py-2 text-xs font-semibold uppercase tracking-wider border-b-2 -mb-px transition-colors",
        active
          ? "text-slate-100 border-blue-500"
          : "text-slate-500 border-transparent hover:text-slate-300"
      )}
    >
      {children}
    </button>
  );
}

function Stat({
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
