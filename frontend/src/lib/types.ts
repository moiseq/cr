// Shared types matching the backend API contract

export interface Candle {
  open_time: number;
  close_time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  is_final?: boolean;
}

export interface Indicators {
  rsi?: number;
  ema9?: number;
  ema21?: number;
  ema50?: number;
  macd?: number;
  macd_signal?: number;
  macd_hist?: number;
  bb_upper?: number;
  bb_mid?: number;
  bb_lower?: number;
  atr?: number;
}

export type SignalDirection = "BUY" | "SELL";
export type SignalStrength = "STRONG" | "MEDIUM" | "WEAK";

export interface Signal {
  direction: SignalDirection;
  strength: SignalStrength;
  reasons: string[];
  timestamp: number;
  price?: number;
  score?: number;
}

export interface Sentiment {
  score: number;     // -1 .. +1
  samples: number;
  label: "bullish" | "bearish" | "neutral";
}

export type WsMessageType = "candle_live" | "candle_closed" | "grid_state";

export interface WsMessage {
  type: WsMessageType;
  // Present for candle_live / candle_closed
  symbol?: string;
  timeframe?: string;
  candle?: Candle;
  indicators?: Indicators;
  signal?: Signal;
  // Present for grid_state
  state?: unknown;
}

export type Pair =
  | "BTCUSDT"
  | "ETHUSDT"
  | "BNBUSDT"
  | "SOLUSDT"
  | "XRPUSDT"
  | string;

export type Timeframe = "15m" | "1h" | "4h" | string;
