"use client";

import { Indicators } from "@/lib/types";
import clsx from "clsx";

interface Props {
  indicators: Indicators;
}

function Metric({
  label,
  value,
  colorFn,
}: {
  label: string;
  value?: number;
  colorFn?: (v: number) => string;
}) {
  const display = value != null ? value.toFixed(2) : "—";
  const color = value != null && colorFn ? colorFn(value) : "text-slate-300";
  return (
    <div className="flex flex-col items-center bg-card rounded p-2 min-w-[80px]">
      <span className="text-xs text-slate-500 mb-0.5">{label}</span>
      <span className={clsx("text-sm font-mono font-semibold", color)}>
        {display}
      </span>
    </div>
  );
}

export function IndicatorPanel({ indicators }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      <Metric
        label="RSI(14)"
        value={indicators.rsi}
        colorFn={(v) =>
          v < 30 ? "text-buy" : v > 70 ? "text-sell" : "text-slate-300"
        }
      />
      <Metric label="EMA9" value={indicators.ema9} />
      <Metric label="EMA21" value={indicators.ema21} />
      <Metric label="EMA50" value={indicators.ema50} />
      <Metric
        label="MACD"
        value={indicators.macd}
        colorFn={(v) => (v >= 0 ? "text-buy" : "text-sell")}
      />
      <Metric label="MACD Sig" value={indicators.macd_signal} />
      <Metric
        label="MACD Hist"
        value={indicators.macd_hist}
        colorFn={(v) => (v >= 0 ? "text-buy" : "text-sell")}
      />
      <Metric label="BB Upper" value={indicators.bb_upper} />
      <Metric label="BB Mid" value={indicators.bb_mid} />
      <Metric label="BB Lower" value={indicators.bb_lower} />
    </div>
  );
}
