"use client";

import { Signal } from "@/lib/types";
import { SignalBadge } from "./SignalBadge";

interface Props {
  signals: Signal[];
  timeframe: string;
}

export function SignalFeed({ signals, timeframe }: Props) {
  return (
    <div className="flex flex-col gap-1 overflow-y-auto max-h-72">
      {signals.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-4">
          Waiting for signals…
        </p>
      ) : (
        signals.map((s, i) => (
          <SignalBadge
            key={`${s.timestamp}-${i}`}
            signal={s}
            timeframe={timeframe}
          />
        ))
      )}
    </div>
  );
}
