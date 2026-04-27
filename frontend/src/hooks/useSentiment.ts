"use client";

import { useEffect, useState } from "react";
import { Sentiment } from "@/lib/types";

export function useSentiment(refreshMs = 60_000) {
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/sentiment");
        if (!res.ok) return;
        const data = (await res.json()) as Sentiment;
        if (!cancelled) setSentiment(data);
      } catch {
        // ignore
      }
    }

    load();
    const id = setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshMs]);

  return sentiment;
}
