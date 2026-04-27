from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    redis_url: str = "redis://localhost:6379"
    database_url: str = "sqlite+aiosqlite:///./data/cr.db"
    binance_ws_url: str = "wss://stream.binance.com:9443/stream"

    pairs: List[str] = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"]
    timeframes: List[str] = ["1m", "5m", "15m"]

    # Candle buffer per pair/timeframe
    candle_buffer_size: int = 500
    # Max signals stored in Redis list
    signal_list_max: int = 100

    # Indicator parameters
    rsi_period: int = 14
    ema_fast: int = 9
    ema_mid: int = 21
    ema_slow: int = 50
    macd_fast: int = 12
    macd_slow: int = 26
    macd_signal: int = 9
    bb_period: int = 20
    bb_std: float = 2.0
    atr_period: int = 14

    # Signal thresholds
    rsi_oversold: float = 30.0
    rsi_overbought: float = 70.0

    # Weighted-score signal classification
    signal_min_score: float = 0.8     # below abs(score) is discarded (WEAK)
    signal_medium_score: float = 1.1  # >= MEDIUM
    signal_strong_score: float = 1.8  # >= STRONG

    # Counter-trend dampening (0..1). Lower = more aggressive filter.
    counter_trend_dampening: float = 0.6

    # Sentiment
    sentiment_refresh_seconds: int = 600  # 10 minutes
    sentiment_bull_threshold: float = 0.15
    sentiment_bear_threshold: float = -0.15

    # CORS origins
    cors_origins: List[str] = ["http://localhost:3000"]

    internal_auth_token: str = "dev-backend-token"


settings = Settings()
