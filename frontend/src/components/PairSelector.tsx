"use client";

import { Pair } from "@/lib/types";
import clsx from "clsx";

const PAIRS: Pair[] = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"];

interface Props {
  value: Pair;
  onChange: (pair: Pair) => void;
}

export function PairSelector({ value, onChange }: Props) {
  return (
    <div className="flex gap-2 flex-wrap">
      {PAIRS.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={clsx(
            "px-3 py-1 rounded text-sm font-medium transition-colors",
            value === p
              ? "bg-blue-600 text-white"
              : "bg-card text-slate-300 hover:bg-slate-700 border border-border"
          )}
        >
          {p.replace("USDT", "/USDT")}
        </button>
      ))}
    </div>
  );
}
