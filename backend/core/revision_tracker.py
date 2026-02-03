"""Revision tracker for tracking human edits to edges."""

import json
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.database import EdgeRevision, NodeRevision, User, Video
from backend.models.schemas import (
    AnnotationAccept,
    AnnotationCreate,
    AnnotationModify,
    AnnotationReject,
    EdgeResponse,
    NodeModify,
    NodeRevisionResponse,
    RevisionResponse,
)


class RevisionTracker:
    """Track human revisions to edges."""

    def __init__(self, session: AsyncSession):
        """Initialize with database session."""
        self.session = session

    async def get_video_by_video_id(self, video_id: str) -> Optional[Video]:
        """Get video record by video_id string."""
        result = await self.session.execute(
            select(Video).where(Video.video_id == video_id)
        )
        return result.scalar_one_or_none()

    async def get_user(self, user_id: int) -> Optional[User]:
        """Get user by ID."""
        result = await self.session.execute(
            select(User).where(User.id == user_id)
        )
        return result.scalar_one_or_none()

    async def record_accept(
        self, annotation: AnnotationAccept, original_edge: EdgeResponse
    ) -> EdgeRevision:
        """Record an edge acceptance."""
        video = await self.get_video_by_video_id(annotation.video_id)
        if video is None:
            raise ValueError(f"Video not found: {annotation.video_id}")

        revision = EdgeRevision(
            video_id=video.id,
            edge_id=annotation.edge_id,
            edge_type=annotation.edge_type,
            user_id=annotation.user_id,
            action="accept",
            original_predicate=original_edge.predicate,
            original_time_period=original_edge.time_period.model_dump(),
            original_attributes=(
                original_edge.attributes.model_dump()
                if original_edge.attributes
                else None
            ),
            original_source=json.dumps(original_edge.source),
            original_target=json.dumps(original_edge.target),
            review_notes=annotation.notes,
        )

        self.session.add(revision)
        await self.session.flush()
        return revision

    async def record_reject(
        self, annotation: AnnotationReject, original_edge: EdgeResponse
    ) -> EdgeRevision:
        """Record an edge rejection."""
        video = await self.get_video_by_video_id(annotation.video_id)
        if video is None:
            raise ValueError(f"Video not found: {annotation.video_id}")

        revision = EdgeRevision(
            video_id=video.id,
            edge_id=annotation.edge_id,
            edge_type=annotation.edge_type,
            user_id=annotation.user_id,
            action="reject",
            original_predicate=original_edge.predicate,
            original_time_period=original_edge.time_period.model_dump(),
            original_attributes=(
                original_edge.attributes.model_dump()
                if original_edge.attributes
                else None
            ),
            original_source=json.dumps(original_edge.source),
            original_target=json.dumps(original_edge.target),
            review_notes=annotation.notes,
        )

        self.session.add(revision)
        await self.session.flush()
        return revision

    async def record_modify(
        self, annotation: AnnotationModify, original_edge: EdgeResponse
    ) -> EdgeRevision:
        """Record an edge modification."""
        video = await self.get_video_by_video_id(annotation.video_id)
        if video is None:
            raise ValueError(f"Video not found: {annotation.video_id}")

        revision = EdgeRevision(
            video_id=video.id,
            edge_id=annotation.edge_id,
            edge_type=annotation.edge_type,
            user_id=annotation.user_id,
            action="modify",
            original_predicate=original_edge.predicate,
            new_predicate=annotation.new_predicate,
            original_time_period=original_edge.time_period.model_dump(),
            new_time_period=(
                annotation.new_time_period.model_dump()
                if annotation.new_time_period
                else None
            ),
            original_attributes=(
                original_edge.attributes.model_dump()
                if original_edge.attributes
                else None
            ),
            new_attributes=(
                annotation.new_attributes.model_dump()
                if annotation.new_attributes
                else None
            ),
            original_source=json.dumps(original_edge.source),
            new_source=(
                json.dumps(annotation.new_source)
                if annotation.new_source
                else None
            ),
            original_target=json.dumps(original_edge.target),
            new_target=(
                json.dumps(annotation.new_target)
                if annotation.new_target
                else None
            ),
            review_notes=annotation.notes,
        )

        self.session.add(revision)
        await self.session.flush()
        return revision

    async def record_create(self, annotation: AnnotationCreate) -> EdgeRevision:
        """Record a new edge creation."""
        video = await self.get_video_by_video_id(annotation.video_id)
        if video is None:
            raise ValueError(f"Video not found: {annotation.video_id}")

        # Generate a new edge ID
        edge_prefix = {
            "static": "static_edge_new_",
            "dynamic": "dynamic_edge_new_",
            "fg_bg": "fg_bg_new_",
        }[annotation.edge_type]

        # Count existing created edges for this video and type
        result = await self.session.execute(
            select(EdgeRevision).where(
                EdgeRevision.video_id == video.id,
                EdgeRevision.action == "create",
                EdgeRevision.edge_type == annotation.edge_type,
            )
        )
        existing_count = len(result.scalars().all())
        edge_id = f"{edge_prefix}{existing_count + 1:03d}"

        revision = EdgeRevision(
            video_id=video.id,
            edge_id=edge_id,
            edge_type=annotation.edge_type,
            user_id=annotation.user_id,
            action="create",
            new_predicate=annotation.predicate,
            new_time_period=annotation.time_period.model_dump(),
            new_attributes=(
                annotation.attributes.model_dump()
                if annotation.attributes
                else None
            ),
            new_source=json.dumps(annotation.source),
            new_target=json.dumps(annotation.target),
            review_notes=annotation.notes,
        )

        self.session.add(revision)
        await self.session.flush()
        return revision

    async def get_edge_history(self, video_id: str, edge_id: str) -> list[RevisionResponse]:
        """Get revision history for an edge."""
        video = await self.get_video_by_video_id(video_id)
        if video is None:
            return []

        result = await self.session.execute(
            select(EdgeRevision, User)
            .join(User, EdgeRevision.user_id == User.id)
            .where(
                EdgeRevision.video_id == video.id,
                EdgeRevision.edge_id == edge_id,
            )
            .order_by(EdgeRevision.created_at.desc())
        )

        revisions = []
        for revision, user in result.all():
            revisions.append(
                RevisionResponse(
                    id=revision.id,
                    edge_id=revision.edge_id,
                    edge_type=revision.edge_type,
                    action=revision.action,
                    user_id=revision.user_id,
                    username=user.username,
                    original_predicate=revision.original_predicate,
                    new_predicate=revision.new_predicate,
                    original_time_period=revision.original_time_period,
                    new_time_period=revision.new_time_period,
                    original_attributes=revision.original_attributes,
                    new_attributes=revision.new_attributes,
                    review_notes=revision.review_notes,
                    created_at=revision.created_at,
                )
            )

        return revisions

    async def get_latest_revision(
        self, video_id: str, edge_id: str
    ) -> Optional[EdgeRevision]:
        """Get the latest revision for an edge."""
        video = await self.get_video_by_video_id(video_id)
        if video is None:
            return None

        result = await self.session.execute(
            select(EdgeRevision)
            .where(
                EdgeRevision.video_id == video.id,
                EdgeRevision.edge_id == edge_id,
            )
            .order_by(EdgeRevision.created_at.desc())
            .limit(1)
        )

        return result.scalar_one_or_none()

    async def get_video_revisions(self, video_id: str) -> list[EdgeRevision]:
        """Get all revisions for a video."""
        video = await self.get_video_by_video_id(video_id)
        if video is None:
            return []

        result = await self.session.execute(
            select(EdgeRevision)
            .where(EdgeRevision.video_id == video.id)
            .order_by(EdgeRevision.created_at.desc())
        )

        return list(result.scalars().all())

    async def get_created_edges(self, video_id: str) -> list[EdgeRevision]:
        """Get all newly created edges for a video."""
        video = await self.get_video_by_video_id(video_id)
        if video is None:
            return []

        result = await self.session.execute(
            select(EdgeRevision)
            .where(
                EdgeRevision.video_id == video.id,
                EdgeRevision.action == "create",
            )
            .order_by(EdgeRevision.created_at.asc())
        )

        return list(result.scalars().all())

    async def get_revision_stats(self, video_id: str) -> dict:
        """Get revision statistics for a video."""
        video = await self.get_video_by_video_id(video_id)
        if video is None:
            return {
                "accepted": 0,
                "rejected": 0,
                "modified": 0,
                "created": 0,
                "total": 0,
            }

        revisions = await self.get_video_revisions(video_id)

        return {
            "accepted": len([r for r in revisions if r.action == "accept"]),
            "rejected": len([r for r in revisions if r.action == "reject"]),
            "modified": len([r for r in revisions if r.action == "modify"]),
            "created": len([r for r in revisions if r.action == "create"]),
            "total": len(revisions),
        }

    # =========================================================================
    # Node Revision Methods
    # =========================================================================

    async def record_node_modify(
        self, modification: NodeModify, original_attributes: dict
    ) -> NodeRevision:
        """Record a node attribute modification."""
        video = await self.get_video_by_video_id(modification.video_id)
        if video is None:
            raise ValueError(f"Video not found: {modification.video_id}")

        # Build new attributes dict
        new_attributes = {}
        if modification.new_visual_attributes:
            new_attributes["visual"] = modification.new_visual_attributes.model_dump()
        if modification.new_physical_attributes:
            new_attributes["physical"] = modification.new_physical_attributes.model_dump()

        revision = NodeRevision(
            video_id=video.id,
            node_id=modification.node_id,
            user_id=modification.user_id,
            action="modify",
            original_attributes=original_attributes,
            new_attributes=new_attributes,
            review_notes=modification.notes,
        )

        self.session.add(revision)
        await self.session.flush()
        return revision

    async def get_node_history(
        self, video_id: str, node_id: str
    ) -> list[NodeRevisionResponse]:
        """Get revision history for a node."""
        video = await self.get_video_by_video_id(video_id)
        if video is None:
            return []

        result = await self.session.execute(
            select(NodeRevision, User)
            .join(User, NodeRevision.user_id == User.id)
            .where(
                NodeRevision.video_id == video.id,
                NodeRevision.node_id == node_id,
            )
            .order_by(NodeRevision.created_at.desc())
        )

        revisions = []
        for revision, user in result.all():
            revisions.append(
                NodeRevisionResponse(
                    id=revision.id,
                    node_id=revision.node_id,
                    action=revision.action,
                    user_id=revision.user_id,
                    username=user.username,
                    original_attributes=revision.original_attributes,
                    new_attributes=revision.new_attributes,
                    review_notes=revision.review_notes,
                    created_at=revision.created_at,
                )
            )

        return revisions

    async def get_latest_node_revision(
        self, video_id: str, node_id: str
    ) -> Optional[NodeRevision]:
        """Get the latest revision for a node."""
        video = await self.get_video_by_video_id(video_id)
        if video is None:
            return None

        result = await self.session.execute(
            select(NodeRevision)
            .where(
                NodeRevision.video_id == video.id,
                NodeRevision.node_id == node_id,
            )
            .order_by(NodeRevision.created_at.desc())
            .limit(1)
        )

        return result.scalar_one_or_none()
