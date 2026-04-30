"use client";

import { Timeframe } from "@/lib/types";
import clsx from "clsx";

const TIMEFRAMES: Timeframe[] = ["15m", "1h", "4h"];

interface Props {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
}

export function TimeframeSelector({ value, onChange }: Props) {
  return (
    <div className="flex gap-1">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          onClick={() => onChange(tf)}
          className={clsx(
            "px-3 py-1 rounded text-sm font-medium transition-colors",
            value === tf
              ? "bg-slate-500 text-white"
              : "bg-card text-slate-400 hover:bg-slate-700 border border-border"
          )}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}
