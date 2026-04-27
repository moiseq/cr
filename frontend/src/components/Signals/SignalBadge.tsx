"use client";

import { Signal } from "@/lib/types";
import clsx from "clsx";

interface Props {
  signal: Signal;
  timeframe: string;
}

function formatSignalPrice(price?: number) {
  if (price == null) return null;

  return price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
}

function getTimeframeOffsetMs(timeframe: string) {
  const match = timeframe.match(/^(\d+)([mhd])$/i);
  if (!match) return 0;

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (unit === "m") return value * 60_000;
  if (unit === "h") return value * 3_600_000;
  if (unit === "d") return value * 86_400_000;

  return 0;
}

function formatSignalTime(timestamp: number, timeframe: string, hasPrice: boolean) {
  const displayTimestamp = hasPrice
    ? timestamp
    : timestamp - getTimeframeOffsetMs(timeframe);

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(displayTimestamp);
}

export function SignalBadge({ signal, timeframe }: Props) {
  const isBuy = signal.direction === "BUY";
  const isStrong = signal.strength === "STRONG";
  const formattedPrice = formatSignalPrice(signal.price);

  return (
    <div
      className={clsx(
        "flex items-center gap-2 rounded px-3 py-2 text-sm border",
        isBuy
          ? "border-buy/40 bg-buy/10 text-buy"
          : "border-sell/40 bg-sell/10 text-sell"
      )}
    >
      <span
        className={clsx(
          "font-bold text-xs px-1.5 py-0.5 rounded",
          isBuy ? "bg-buy text-black" : "bg-sell text-white"
        )}
      >
        {signal.direction}
      </span>
      <span
        className={clsx(
          "text-xs font-medium",
          isStrong ? "text-strong" : signal.strength === "MEDIUM" ? "text-yellow-400" : "text-weak"
        )}
      >
        {signal.strength}
      </span>
      <span className="text-xs text-slate-400 truncate">
        {signal.reasons.join(", ")}
      </span>
      {formattedPrice && (
        <span className="text-xs font-mono text-slate-300 whitespace-nowrap">
          {formattedPrice}
        </span>
      )}
      <span className="ml-auto text-xs text-slate-500 whitespace-nowrap">
        {formatSignalTime(signal.timestamp, timeframe, signal.price != null)}
      </span>
    </div>
  );
}
