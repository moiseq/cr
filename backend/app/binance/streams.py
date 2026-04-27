from app.config import settings


def build_combined_stream_url() -> str:
    """Build Binance combined stream URL for all pairs and timeframes."""
    streams = []
    for pair in settings.pairs:
        for tf in settings.timeframes:
            streams.append(f"{pair.lower()}@kline_{tf}")
    stream_path = "/".join(streams)
    return f"{settings.binance_ws_url}?streams={stream_path}"
