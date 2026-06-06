from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, Boolean, Date, DateTime, text
from datetime import date, datetime
import os


DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://rrc_user:password@localhost:5432/rrc_db')
# asyncpg requires postgresql+asyncpg://
ASYNC_DATABASE_URL = DATABASE_URL.replace('postgresql://', 'postgresql+asyncpg://', 1)

engine = create_async_engine(ASYNC_DATABASE_URL, echo=False, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class RegulatoryWindow(Base):
    __tablename__ = 'regulatory_windows'

    id: Mapped[str] = mapped_column(String, primary_key=True)
    jurisdiction: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    source_url: Mapped[str | None] = mapped_column(String, nullable=True)
    is_manual: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


async def get_session() -> AsyncSession:
    async with SessionLocal() as session:
        yield session
