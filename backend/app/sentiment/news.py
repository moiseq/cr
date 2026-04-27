"""
Crypto market sentiment from RSS news feeds + VADER analyser.

Returns a compound score in the range [-1.0, +1.0]:
  > 0  → bullish bias
  < 0  → bearish bias
  ~ 0  → neutral / mixed

Inspired by kukapay/crypto-skills "market-sentiment" but implemented
natively in the backend so it can feed the signal engine directly.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Iterable

import feedparser
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

logger = logging.getLogger(__name__)

# Crypto-focused news feeds. Kept short to limit latency and rate-limits.
DEFAULT_FEEDS: tuple[str, ...] = (
    "https://cointelegraph.com/rss",
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://decrypt.co/feed",
    "https://cryptopanic.com/news/rss/",
    "https://bitcoinmagazine.com/.rss/full/",
)

_analyzer = SentimentIntensityAnalyzer()


def _score_feed(url: str, max_entries: int = 20, keyword: str | None = None) -> list[float]:
    """Synchronously parse one RSS feed and score each entry."""
    scores: list[float] = []
    try:
        parsed = feedparser.parse(url)
    except Exception as exc:  # pragma: no cover - network/parsing edge cases
        logger.warning("feedparser failed for %s: %s", url, exc)
        return scores

    entries = getattr(parsed, "entries", []) or []
    for entry in entries[:max_entries]:
        title = getattr(entry, "title", "") or ""
        summary = getattr(entry, "summary", "") or ""
        text = f"{title}. {summary}".strip()
        if not text:
            continue
        if keyword and keyword.lower() not in text.lower():
            continue
        try:
            compound = _analyzer.polarity_scores(text)["compound"]
        except Exception:
            continue
        scores.append(compound)
    return scores


async def compute_sentiment(
    feeds: Iterable[str] = DEFAULT_FEEDS,
    keyword: str | None = None,
) -> dict:
    """
    Aggregate sentiment across all feeds. Returns:
      {
        "score": float in [-1, 1],
        "samples": int,
        "label": "bullish" | "bearish" | "neutral",
      }

    Network I/O is blocking, so each feed is parsed in a worker thread.
    """
    feed_list = list(feeds)
    loop = asyncio.get_running_loop()

    tasks = [loop.run_in_executor(None, _score_feed, url, 20, keyword) for url in feed_list]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_scores: list[float] = []
    for res in results:
        if isinstance(res, Exception):
            continue
        all_scores.extend(res)

    if not all_scores:
        return {"score": 0.0, "samples": 0, "label": "neutral"}

    score = sum(all_scores) / len(all_scores)
    if score >= 0.15:
        label = "bullish"
    elif score <= -0.15:
        label = "bearish"
    else:
        label = "neutral"

    return {
        "score": round(score, 4),
        "samples": len(all_scores),
        "label": label,
    }
