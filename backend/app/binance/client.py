import asyncio
import json
import logging
from typing import Callable, Awaitable

import websockets
from websockets.exceptions import ConnectionClosed

from app.binance.streams import build_combined_stream_url

logger = logging.getLogger(__name__)

# Callback type: async fn(symbol, timeframe, candle_data) -> None
KlineCallback = Callable[[str, str, dict], Awaitable[None]]


def _parse_kline_event(message: dict) -> tuple[str, str, dict] | None:
    """Parse a combined stream kline message into (symbol, timeframe, candle)."""
    data = message.get("data", {})
    if data.get("e") != "kline":
        return None

    k = data["k"]
    candle = {
        "open_time": k["t"],
        "close_time": k["T"],
        "open": float(k["o"]),
        "high": float(k["h"]),
        "low": float(k["l"]),
        "close": float(k["c"]),
        "volume": float(k["v"]),
        "is_final": k["x"],
    }
    return k["s"], k["i"], candle


class BinanceWSClient:
    """Async WebSocket client for Binance combined kline streams."""

    def __init__(self, on_kline: KlineCallback) -> None:
        self._on_kline = on_kline
        self._running = False
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        self._running = True
        self._task = asyncio.create_task(self._run_forever())
        logger.info("BinanceWSClient started")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("BinanceWSClient stopped")

    async def _run_forever(self) -> None:
        url = build_combined_stream_url()
        backoff = 1
        # We always have at least one open candle being traded so Binance pushes
        # a kline tick frequently (multiple per second on liquid pairs). If we
        # go longer than this without ANY message, the connection is silently
        # dead — force a reconnect.
        idle_timeout = 60
        while self._running:
            try:
                logger.info("Connecting to Binance WS: %s", url[:80] + "...")
                async with websockets.connect(url, ping_interval=20, ping_timeout=30) as ws:
                    backoff = 1
                    logger.info("Connected to Binance Spot combined stream (%d streams)", 15)
                    while self._running:
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=idle_timeout)
                        except asyncio.TimeoutError:
                            logger.warning(
                                "No kline received for %ds — forcing reconnect", idle_timeout
                            )
                            break
                        try:
                            message = json.loads(raw)
                            result = _parse_kline_event(message)
                            if result is not None:
                                symbol, timeframe, candle = result
                                await self._on_kline(symbol, timeframe, candle)
                        except Exception:
                            logger.exception("Error processing kline message")
            except ConnectionClosed as exc:
                logger.warning("Binance WS connection closed: %s. Reconnecting in %ds", exc, backoff)
            except Exception:
                logger.exception("Unexpected Binance WS error. Reconnecting in %ds", backoff)

            if self._running:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)
