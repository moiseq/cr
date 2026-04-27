"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
  ColorType,
} from "lightweight-charts";
import { Candle, Indicators } from "@/lib/types";

interface Props {
  candles: Candle[];
  indicators: Indicators;
}

function toChartCandle(c: Candle): CandlestickData {
  return {
    time: Math.floor(c.open_time / 1000) as any,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
}

function toLineData(candles: Candle[], getValue: (c: Candle, idx: number) => number | undefined): LineData[] {
  return candles
    .map((c, i) => {
      const v = getValue(c, i);
      if (v == null) return null;
      return { time: Math.floor(c.open_time / 1000) as any, value: v };
    })
    .filter(Boolean) as LineData[];
}

function computeEMA(candles: Candle[], period: number): LineData[] {
  if (candles.length < period) return [];
  const multiplier = 2 / (period + 1);
  const result: LineData[] = [];
  let ema: number | null = null;
  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    if (ema === null) {
      if (i === period - 1) {
        // Seed EMA with SMA of first `period` candles
        ema = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
        result.push({ time: Math.floor(candles[i].open_time / 1000) as any, value: ema });
      }
    } else {
      ema = close * multiplier + ema * (1 - multiplier);
      result.push({ time: Math.floor(candles[i].open_time / 1000) as any, value: ema });
    }
  }
  return result;
}

export function CandlestickChart({ candles, indicators }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ema9Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema21Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);

  // Init chart
  useEffect(() => {
    if (!containerRef.current) return;

    const initialHeight = window.innerWidth < 768 ? 260 : 360;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#1e293b" },
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "#334155" },
        horzLines: { color: "#334155" },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: "#334155" },
      timeScale: { borderColor: "#334155", timeVisible: true },
      width: containerRef.current.clientWidth,
      height: initialHeight,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const ema9 = chart.addLineSeries({ color: "#f59e0b", lineWidth: 1 });
    const ema21 = chart.addLineSeries({ color: "#60a5fa", lineWidth: 1 });
    const ema50 = chart.addLineSeries({ color: "#a78bfa", lineWidth: 1, lineStyle: 2 });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    ema9Ref.current = ema9;
    ema21Ref.current = ema21;
    ema50Ref.current = ema50;

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        const h = window.innerWidth < 768 ? 260 : 360;
        chart.applyOptions({ width: containerRef.current.clientWidth, height: h });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, []);

  // Update data
  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return;

    const chartCandles = candles.map(toChartCandle);
    candleSeriesRef.current.setData(chartCandles);

    if (ema9Ref.current) ema9Ref.current.setData(computeEMA(candles, 9));
    if (ema21Ref.current) ema21Ref.current.setData(computeEMA(candles, 21));
    if (ema50Ref.current) ema50Ref.current.setData(computeEMA(candles, 50));
  }, [candles]);

  return (
    <div className="w-full">
      <div ref={containerRef} className="w-full rounded overflow-hidden" />
      <div className="flex gap-4 mt-1 text-xs text-slate-400 px-1">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-[#f59e0b] inline-block" /> EMA9
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-[#60a5fa] inline-block" /> EMA21
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-[#a78bfa] inline-block" /> EMA50
        </span>
      </div>
    </div>
  );
}
