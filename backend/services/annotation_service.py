"""Annotation service for managing edge annotations."""

from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.revision_tracker import RevisionTracker
from backend.core.vsg_loader import VSGLoader
from backend.models.schemas import (
    AnnotationAccept,
    AnnotationCreate,
    AnnotationModify,
    AnnotationReject,
    EdgeResponse,
    RevisionResponse,
)


class AnnotationService:
    """Service for managing edge annotations."""

    def __init__(self, session: AsyncSession, vsg_loader: VSGLoader):
        """Initialize with database session and VSG loader."""
        self.session = session
        self.vsg_loader = vsg_loader
        self.tracker = RevisionTracker(session)

    async def accept_edge(self, annotation: AnnotationAccept) -> dict:
        """Accept an edge as-is."""
        # Get the original edge
        edge = self.vsg_loader.get_edge_by_id(annotation.edge_id)
        if edge is None:
            raise ValueError(f"Edge not found: {annotation.edge_id}")

        # Record the acceptance
        revision = await self.tracker.record_accept(annotation, edge)

        return {
            "success": True,
            "revision_id": revision.id,
            "edge_id": annotation.edge_id,
            "action": "accept",
        }

    async def reject_edge(self, annotation: AnnotationReject) -> dict:
        """Reject an edge."""
        # Get the original edge
        edge = self.vsg_loader.get_edge_by_id(annotation.edge_id)
        if edge is None:
            raise ValueError(f"Edge not found: {annotation.edge_id}")

        # Record the rejection
        revision = await self.tracker.record_reject(annotation, edge)

        return {
            "success": True,
            "revision_id": revision.id,
            "edge_id": annotation.edge_id,
            "action": "reject",
        }

    async def modify_edge(self, annotation: AnnotationModify) -> dict:
        """Modify an existing edge."""
        # Get the original edge
        edge = self.vsg_loader.get_edge_by_id(annotation.edge_id)
        if edge is None:
            raise ValueError(f"Edge not found: {annotation.edge_id}")

        # Record the modification
        revision = await self.tracker.record_modify(annotation, edge)

        return {
            "success": True,
            "revision_id": revision.id,
            "edge_id": annotation.edge_id,
            "action": "modify",
            "changes": {
                "predicate": annotation.new_predicate,
                "time_period": (
                    annotation.new_time_period.model_dump()
                    if annotation.new_time_period
                    else None
                ),
                "attributes": (
                    annotation.new_attributes.model_dump()
                    if annotation.new_attributes
                    else None
                ),
            },
        }

    async def create_edge(self, annotation: AnnotationCreate) -> dict:
        """Create a new edge."""
        # Record the creation
        revision = await self.tracker.record_create(annotation)

        return {
            "success": True,
            "revision_id": revision.id,
            "edge_id": revision.edge_id,
            "action": "create",
        }

    async def get_edge_with_revisions(self, edge_id: str) -> Optional[EdgeResponse]:
        """Get an edge with its revision status."""
        edge = self.vsg_loader.get_edge_by_id(edge_id)
        if edge is None:
            return None

        # Check for latest revision
        latest = await self.tracker.get_latest_revision(
            self.vsg_loader.video_id, edge_id
        )

        if latest is not None:
            edge.has_revision = True
            edge.revision_action = latest.action

        return edge

    async def get_edge_history(
        self, video_id: str, edge_id: str
    ) -> list[RevisionResponse]:
        """Get revision history for an edge."""
        return await self.tracker.get_edge_history(video_id, edge_id)

    async def get_edges_with_revisions(self) -> list[EdgeResponse]:
        """Get all edges with their revision statuses."""
        edges = self.vsg_loader.get_all_edges()
        video_id = self.vsg_loader.video_id

        # Get all revisions for this video
        revisions = await self.tracker.get_video_revisions(video_id)

        # Build a map of edge_id -> latest revision action
        revision_map: dict[str, str] = {}
        for rev in revisions:
            # Keep only the latest revision per edge
            if rev.edge_id not in revision_map:
                revision_map[rev.edge_id] = rev.action

        # Update edges with revision info
        for edge in edges:
            if edge.edge_id in revision_map:
                edge.has_revision = True
                edge.revision_action = revision_map[edge.edge_id]

        return edges

    async def get_created_edges(self) -> list[EdgeResponse]:
        """Get all newly created edges as EdgeResponse objects."""
        import json

        created_revisions = await self.tracker.get_created_edges(self.vsg_loader.video_id)

        edges = []
        for rev in created_revisions:
            # Build EdgeResponse from revision data
            source = json.loads(rev.new_source) if rev.new_source else []
            target = json.loads(rev.new_target) if rev.new_target else []

            from backend.models.schemas import MotionAttributes, TimePeriod

            time_period = TimePeriod(**rev.new_time_period) if rev.new_time_period else TimePeriod(start_frame=0, end_frame=0)

            attributes = None
            if rev.edge_type == "dynamic" and rev.new_attributes:
                attributes = MotionAttributes(**rev.new_attributes)

            edges.append(
                EdgeResponse(
                    edge_id=rev.edge_id,
                    edge_type=rev.edge_type,
                    source=source,
                    target=target,
                    source_category=[],  # Will need node lookup
                    target_category=[],
                    predicate=rev.new_predicate or "",
                    confidence=1.0,
                    confidence_round1=1.0,
                    confidence_round2=1.0,
                    validated=True,
                    extraction_round=2,  # Human created
                    validation_reasoning_round1="Human annotated",
                    validation_reasoning_round2="",
                    time_period=time_period,
                    attributes=attributes,
                    has_revision=True,
                    revision_action="create",
                )
            )

        return edges
