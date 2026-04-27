from __future__ import annotations

from typing import Any

from app.config import settings


# ---------------------------------------------------------------------------
# Weighted-score strategy
#
# Replaces the previous "count reasons" approach with a directional score:
#   score > 0  → bullish bias
#   score < 0  → bearish bias
#
# Indicators contribute positively or negatively. A master trend filter
# (price vs EMA50, EMA21 vs EMA50) gates / dampens counter-trend setups.
# Optional sentiment (-1..+1) nudges the score.
#
# Strength buckets (from config):
#   |score| < signal_min_score      → discarded
#   |score| >= signal_medium_score  → MEDIUM
#   |score| >= signal_strong_score  → STRONG
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Crossover helpers
# ---------------------------------------------------------------------------

def _ema_cross_up(ind: dict) -> bool:
    """EMA9 crosses above EMA21."""
    prev9 = ind.get("_prev_ema9")
    prev21 = ind.get("_prev_ema21")
    cur9 = ind.get("ema9")
    cur21 = ind.get("ema21")
    if None in (prev9, prev21, cur9, cur21):
        return False
    return prev9 <= prev21 and cur9 > cur21


def _ema_cross_down(ind: dict) -> bool:
    """EMA9 crosses below EMA21."""
    prev9 = ind.get("_prev_ema9")
    prev21 = ind.get("_prev_ema21")
    cur9 = ind.get("ema9")
    cur21 = ind.get("ema21")
    if None in (prev9, prev21, cur9, cur21):
        return False
    return prev9 >= prev21 and cur9 < cur21


def _macd_cross_up(ind: dict) -> bool:
    """MACD line crosses above signal line."""
    pm = ind.get("_prev_macd")
    ps = ind.get("_prev_macd_signal")
    cm = ind.get("macd")
    cs = ind.get("macd_signal")
    if None in (pm, ps, cm, cs):
        return False
    return pm <= ps and cm > cs


def _macd_cross_down(ind: dict) -> bool:
    """MACD line crosses below signal line."""
    pm = ind.get("_prev_macd")
    ps = ind.get("_prev_macd_signal")
    cm = ind.get("macd")
    cs = ind.get("macd_signal")
    if None in (pm, ps, cm, cs):
        return False
    return pm >= ps and cm < cs


def generate_signal(indicators: dict[str, Any]) -> dict[str, Any] | None:
    """
    Weighted-score strategy using RSI, EMA, MACD, Bollinger Bands and an
    optional macro sentiment score. The master trend filter (close vs EMA50,
    EMA21 vs EMA50) dampens counter-trend setups.

    Returns { direction, strength, score, reasons } or None.
    """
    rsi = indicators.get("rsi")
    prev_rsi = indicators.get("_prev_rsi")
    ema21 = indicators.get("ema21")
    ema50 = indicators.get("ema50")
    macd_hist = indicators.get("macd_hist")
    prev_macd_hist = indicators.get("_prev_macd_hist")
    bb_upper = indicators.get("bb_upper")
    bb_lower = indicators.get("bb_lower")
    close = indicators.get("_close")  # injected by processor
    sentiment = indicators.get("_sentiment", 0.0) or 0.0

    # Master trend filter requires EMA50 + EMA21 + close
    if ema50 is None or ema21 is None or close is None:
        return None

    trend_up = close > ema50 and ema21 > ema50
    trend_down = close < ema50 and ema21 < ema50

    score = 0.0
    reasons: list[str] = []

    # --- 1. MACD momentum (cross weight 1.0; histogram-shift 0.4) ---
    if _macd_cross_up(indicators):
        score += 1.0
        reasons.append("macd_cross_up")
    elif macd_hist is not None and prev_macd_hist is not None:
        if macd_hist > 0 and macd_hist > prev_macd_hist:
            score += 0.4
            reasons.append("macd_hist_rising")

    if _macd_cross_down(indicators):
        score -= 1.0
        reasons.append("macd_cross_down")
    elif macd_hist is not None and prev_macd_hist is not None:
        if macd_hist < 0 and macd_hist < prev_macd_hist:
            score -= 0.4
            reasons.append("macd_hist_falling")

    # --- 2. EMA short-term cross (weight 0.8) ---
    if _ema_cross_up(indicators):
        score += 0.8
        reasons.append("ema_cross_up")
    if _ema_cross_down(indicators):
        score -= 0.8
        reasons.append("ema_cross_down")

    # --- 3. RSI: extremes weigh, neutral zone ignored ---
    if rsi is not None:
        if rsi < settings.rsi_oversold:
            score += 1.0
            reasons.append("rsi_oversold")
        elif rsi < 40:
            score += 0.3
        elif rsi > settings.rsi_overbought:
            score -= 1.0
            reasons.append("rsi_overbought")
        elif rsi > 60:
            score -= 0.3

        # Reversal confirmation: leaving the extreme zone
        if prev_rsi is not None:
            if prev_rsi < settings.rsi_oversold <= rsi:
                score += 0.7
                reasons.append("rsi_exit_oversold")
            if prev_rsi > settings.rsi_overbought >= rsi:
                score -= 0.7
                reasons.append("rsi_exit_overbought")

    # --- 4. Bollinger: only the band touches matter ---
    bb_lower_touched = bb_lower is not None and close <= bb_lower * 1.002
    bb_upper_touched = bb_upper is not None and close >= bb_upper * 0.998
    if bb_lower_touched:
        score += 0.6
        reasons.append("bb_lower_touch")
    if bb_upper_touched:
        score -= 0.6
        reasons.append("bb_upper_touch")

    # --- 4b. Mean-reversion bonus: oversold + BB-lower (or overbought + BB-upper)
    # is a classic high-probability reversion setup, give it extra weight so it
    # survives the trend filter even in a downtrend / uptrend.
    rsi_oversold_now = rsi is not None and rsi < settings.rsi_oversold
    rsi_overbought_now = rsi is not None and rsi > settings.rsi_overbought
    if bb_lower_touched and rsi_oversold_now:
        score += 0.6
        reasons.append("mean_reversion_long")
    if bb_upper_touched and rsi_overbought_now:
        score -= 0.6
        reasons.append("mean_reversion_short")

    # --- 5. Macro sentiment (weight 0.4) ---
    if sentiment >= settings.sentiment_bull_threshold:
        score += 0.4
        reasons.append("sentiment_bullish")
    elif sentiment <= settings.sentiment_bear_threshold:
        score -= 0.4
        reasons.append("sentiment_bearish")

    # --- 6. Apply master trend filter (directional gating) ---
    damp = settings.counter_trend_dampening
    if score > 0 and trend_down:
        score *= damp  # buy against the trend → penalised
    if score < 0 and trend_up:
        score *= damp  # sell against the trend → penalised
    if score > 0 and trend_up:
        reasons.append("trend_up_confirm")
    if score < 0 and trend_down:
        reasons.append("trend_down_confirm")

    # --- 7. Classify ---
    abs_score = abs(score)
    if abs_score < settings.signal_min_score:
        return None

    direction = "BUY" if score > 0 else "SELL"
    if abs_score >= settings.signal_strong_score:
        strength = "STRONG"
    elif abs_score >= settings.signal_medium_score:
        strength = "MEDIUM"
    else:
        strength = "WEAK"

    return {
        "direction": direction,
        "strength": strength,
        "score": round(score, 3),
        "reasons": reasons[:6],
    }
