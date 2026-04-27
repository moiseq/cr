from __future__ import annotations

import logging
from typing import Any

import pandas as pd
import pandas_ta as ta

from app.config import settings

logger = logging.getLogger(__name__)


def calculate_indicators(candles: list[dict]) -> dict[str, Any] | None:
    """
    Given a list of closed candle dicts, calculate technical indicators.
    Returns latest indicator values or None if insufficient data.
    """
    if len(candles) < settings.ema_slow + 1:
        return None

    df = pd.DataFrame(candles)
    df = df.sort_values("open_time").reset_index(drop=True)

    close = df["close"].astype(float)
    high = df["high"].astype(float)
    low = df["low"].astype(float)

    # RSI
    rsi_series = ta.rsi(close, length=settings.rsi_period)

    # EMAs
    ema9_series = ta.ema(close, length=settings.ema_fast)
    ema21_series = ta.ema(close, length=settings.ema_mid)
    ema50_series = ta.ema(close, length=settings.ema_slow)

    # MACD
    macd_df = ta.macd(
        close,
        fast=settings.macd_fast,
        slow=settings.macd_slow,
        signal=settings.macd_signal,
    )

    # Bollinger Bands
    bb_df = ta.bbands(close, length=settings.bb_period, std=settings.bb_std)

    # ATR (volatility) — used for SL/TP sizing and risk-based position sizing
    atr_series = ta.atr(high, low, close, length=settings.atr_period)

    # Extract latest and previous values (for crossover detection)
    def last(series, n=0):
        if series is None:
            return None
        valid = series.dropna()
        if len(valid) <= n:
            return None
        return float(valid.iloc[-(1 + n)])

    macd_col = f"MACD_{settings.macd_fast}_{settings.macd_slow}_{settings.macd_signal}"
    signal_col = f"MACDs_{settings.macd_fast}_{settings.macd_slow}_{settings.macd_signal}"
    hist_col = f"MACDh_{settings.macd_fast}_{settings.macd_slow}_{settings.macd_signal}"

    # pandas_ta formats std as int when it has no fractional part (2.0 → "2")
    bb_std_str = int(settings.bb_std) if settings.bb_std == int(settings.bb_std) else settings.bb_std
    bb_upper_col = f"BBU_{settings.bb_period}_{bb_std_str}"
    bb_mid_col = f"BBM_{settings.bb_period}_{bb_std_str}"
    bb_lower_col = f"BBL_{settings.bb_period}_{bb_std_str}"

    # Fall back to searching the actual column names in case of version differences
    if bb_df is not None and bb_upper_col not in bb_df.columns:
        for col in bb_df.columns:
            if col.startswith("BBU_"):
                bb_upper_col = col
            elif col.startswith("BBM_"):
                bb_mid_col = col
            elif col.startswith("BBL_"):
                bb_lower_col = col

    return {
        # Current values
        "rsi": last(rsi_series),
        "ema9": last(ema9_series),
        "ema21": last(ema21_series),
        "ema50": last(ema50_series),
        "macd": last(macd_df[macd_col]) if macd_df is not None else None,
        "macd_signal": last(macd_df[signal_col]) if macd_df is not None else None,
        "macd_hist": last(macd_df[hist_col]) if macd_df is not None else None,
        "bb_upper": last(bb_df[bb_upper_col]) if bb_df is not None else None,
        "bb_mid": last(bb_df[bb_mid_col]) if bb_df is not None else None,
        "bb_lower": last(bb_df[bb_lower_col]) if bb_df is not None else None,
        "atr": last(atr_series),
        # Previous values for crossover / momentum-shift detection
        "_prev_ema9": last(ema9_series, n=1),
        "_prev_ema21": last(ema21_series, n=1),
        "_prev_macd": last(macd_df[macd_col], n=1) if macd_df is not None else None,
        "_prev_macd_signal": last(macd_df[signal_col], n=1) if macd_df is not None else None,
        "_prev_macd_hist": last(macd_df[hist_col], n=1) if macd_df is not None else None,
        "_prev_rsi": last(rsi_series, n=1),
    }
