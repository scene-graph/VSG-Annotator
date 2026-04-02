"""SQLAlchemy database models for annotation tracking."""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    text,
)
from sqlalchemy.ext.asyncio import AsyncAttrs, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from backend.config import settings


class Base(AsyncAttrs, DeclarativeBase):
    """Base class for all models."""
    pass


class User(Base):
    """User model for multi-annotator support."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    # Relationships
    revisions: Mapped[list["EdgeRevision"]] = relationship(
        "EdgeRevision", back_populates="user"
    )
    metadata_revisions: Mapped[list["MetadataRevision"]] = relationship(
        "MetadataRevision", back_populates="user"
    )
    node_revisions: Mapped[list["NodeRevision"]] = relationship(
        "NodeRevision", back_populates="user"
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, username='{self.username}')>"


class Video(Base):
    """Video model representing a video sample with its VSG file."""

    __tablename__ = "videos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    video_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    vsg_path: Mapped[str] = mapped_column(Text, nullable=False)
    frames_path: Mapped[str] = mapped_column(Text, nullable=False)
    masks_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    dataset: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), default="pending", nullable=False
    )
    total_frames: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    fps: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    resolution_width: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    resolution_height: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationships
    revisions: Mapped[list["EdgeRevision"]] = relationship(
        "EdgeRevision", back_populates="video"
    )
    metadata_revisions: Mapped[list["MetadataRevision"]] = relationship(
        "MetadataRevision", back_populates="video"
    )
    node_revisions: Mapped[list["NodeRevision"]] = relationship(
        "NodeRevision", back_populates="video"
    )

    def __repr__(self) -> str:
        return f"<Video(id={self.id}, video_id='{self.video_id}', status='{self.status}')>"


class EdgeRevision(Base):
    """Edge revision model for tracking human edits to edges."""

    __tablename__ = "edge_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    video_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("videos.id"), nullable=False
    )
    edge_id: Mapped[str] = mapped_column(String(100), nullable=False)
    edge_type: Mapped[str] = mapped_column(String(20), nullable=False)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False
    )
    action: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # accept, reject, modify, create
    original_predicate: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    new_predicate: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    original_time_period: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    new_time_period: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    original_time_periods: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    new_time_periods: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    original_attributes: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    new_attributes: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    original_source: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    new_source: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    original_target: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    new_target: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    review_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    # Relationships
    video: Mapped["Video"] = relationship("Video", back_populates="revisions")
    user: Mapped["User"] = relationship("User", back_populates="revisions")

    def __repr__(self) -> str:
        return f"<EdgeRevision(id={self.id}, edge_id='{self.edge_id}', action='{self.action}')>"


class MetadataRevision(Base):
    """Metadata revision model for tracking human edits to scene_info and camera_motion."""

    __tablename__ = "metadata_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    video_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("videos.id"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False
    )
    metadata_type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # "scene_info" or "camera_motion"
    original_value: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    new_value: Mapped[dict] = mapped_column(JSON, nullable=False)
    review_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    # Relationships
    video: Mapped["Video"] = relationship("Video", back_populates="metadata_revisions")
    user: Mapped["User"] = relationship("User", back_populates="metadata_revisions")

    def __repr__(self) -> str:
        return f"<MetadataRevision(id={self.id}, metadata_type='{self.metadata_type}')>"


class NodeRevision(Base):
    """Node revision model for tracking human edits to node attributes."""

    __tablename__ = "node_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    video_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("videos.id"), nullable=False
    )
    node_id: Mapped[str] = mapped_column(String(100), nullable=False)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False
    )
    action: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # modify
    original_attributes: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    new_attributes: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    original_is_static: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    new_is_static: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    original_category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    new_category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    review_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    # Relationships
    video: Mapped["Video"] = relationship("Video", back_populates="node_revisions")
    user: Mapped["User"] = relationship("User", back_populates="node_revisions")

    def __repr__(self) -> str:
        return f"<NodeRevision(id={self.id}, node_id='{self.node_id}', action='{self.action}')>"


# Async engine and session factory
engine = create_async_engine(settings.database_url, echo=settings.debug)
async_session = async_sessionmaker(engine, expire_on_commit=False)


async def init_db() -> None:
    """Initialize the database, creating all tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Lightweight migration: add node_revisions columns if missing (SQLite)
        result = await conn.execute(text("PRAGMA table_info(node_revisions)"))
        existing_cols = {row[1] for row in result.fetchall()}
        if "original_is_static" not in existing_cols:
            await conn.execute(text("ALTER TABLE node_revisions ADD COLUMN original_is_static BOOLEAN"))
        if "new_is_static" not in existing_cols:
            await conn.execute(text("ALTER TABLE node_revisions ADD COLUMN new_is_static BOOLEAN"))
        if "original_category" not in existing_cols:
            await conn.execute(text("ALTER TABLE node_revisions ADD COLUMN original_category VARCHAR(100)"))
        if "new_category" not in existing_cols:
            await conn.execute(text("ALTER TABLE node_revisions ADD COLUMN new_category VARCHAR(100)"))
        # Lightweight migration: add edge_revisions time_periods columns if missing (SQLite)
        result = await conn.execute(text("PRAGMA table_info(edge_revisions)"))
        existing_cols = {row[1] for row in result.fetchall()}
        if "original_time_periods" not in existing_cols:
            await conn.execute(text("ALTER TABLE edge_revisions ADD COLUMN original_time_periods JSON"))
        if "new_time_periods" not in existing_cols:
            await conn.execute(text("ALTER TABLE edge_revisions ADD COLUMN new_time_periods JSON"))


async def get_db():
    """Dependency for getting async database sessions."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
