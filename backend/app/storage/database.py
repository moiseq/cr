from __future__ import annotations

import logging

from sqlalchemy import BigInteger, Column, Float, Integer, String, Text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

logger = logging.getLogger(__name__)

engine = create_async_engine(settings.database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class CandleModel(Base):
    __tablename__ = "candles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(20), nullable=False, index=True)
    timeframe = Column(String(5), nullable=False, index=True)
    open_time = Column(BigInteger, nullable=False, index=True)
    close_time = Column(BigInteger, nullable=False)
    open = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    close = Column(Float, nullable=False)
    volume = Column(Float, nullable=False)


class SignalModel(Base):
    __tablename__ = "signals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(20), nullable=False, index=True)
    timeframe = Column(String(5), nullable=False, index=True)
    timestamp = Column(BigInteger, nullable=False, index=True)
    direction = Column(String(4), nullable=False)
    strength = Column(String(6), nullable=False)
    reasons = Column(Text, nullable=False)


class SignalStateModel(Base):
    """Single-row table holding the full signal-trader state JSON blob."""

    __tablename__ = "signal_state"

    id = Column(Integer, primary_key=True)  # always 1
    data = Column(Text, nullable=False)


class GridStateModel(Base):
    """Single-row table holding the full grid-trading state JSON blob."""

    __tablename__ = "grid_state"

    id = Column(Integer, primary_key=True)  # always 1
    data = Column(Text, nullable=False)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created/verified")


async def persist_candle(symbol: str, timeframe: str, candle: dict) -> None:
    async with AsyncSessionLocal() as session:
        session: AsyncSession
        row = CandleModel(
            symbol=symbol,
            timeframe=timeframe,
            open_time=candle["open_time"],
            close_time=candle["close_time"],
            open=candle["open"],
            high=candle["high"],
            low=candle["low"],
            close=candle["close"],
            volume=candle["volume"],
        )
        session.add(row)
        await session.commit()


async def persist_signal(
    symbol: str, timeframe: str, signal: dict, timestamp: int
) -> None:
    import json

    async with AsyncSessionLocal() as session:
        row = SignalModel(
            symbol=symbol,
            timeframe=timeframe,
            timestamp=timestamp,
            direction=signal["direction"],
            strength=signal["strength"],
            reasons=json.dumps(signal["reasons"]),
        )
        session.add(row)
        await session.commit()
