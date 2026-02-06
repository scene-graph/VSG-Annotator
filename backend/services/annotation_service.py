"""Annotation service for managing edge annotations."""

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.revision_tracker import RevisionTracker
from backend.core.vsg_loader import VSGLoader
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


class AnnotationService:
    """Service for managing edge annotations."""

    def __init__(self, session: AsyncSession, vsg_loader: VSGLoader, video_id: str = None):
        """Initialize with database session and VSG loader."""
        self.session = session
        self.vsg_loader = vsg_loader
        self.tracker = RevisionTracker(session)
        # Use provided video_id or fall back to VSG metadata
        self._video_id = video_id or vsg_loader.video_id

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
        # Get the original edge - first try VSG, then database (for created edges)
        edge = self.vsg_loader.get_edge_by_id(annotation.edge_id)
        if edge is None:
            # Edge not in VSG - might be a created edge, look in database
            edge = await self._get_created_edge_current_state(annotation.edge_id)
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

    async def delete_edge(
        self,
        video_id: str,
        edge_id: str,
        edge_type: str,
        user_id: int,
        review_notes: Optional[str] = None,
    ) -> dict:
        """Delete an edge (records deletion in revision history)."""
        revision = await self.tracker.record_delete(
            video_id=video_id,
            edge_id=edge_id,
            edge_type=edge_type,
            user_id=user_id,
            review_notes=review_notes,
        )

        return {
            "success": True,
            "revision_id": revision.id,
            "edge_id": edge_id,
            "action": "delete",
        }

    async def _get_created_edge_current_state(self, edge_id: str) -> Optional[EdgeResponse]:
        """Get the current state of a created edge from the database.

        For created edges (not in VSG), this builds an EdgeResponse from
        the latest revision data.
        """
        import json
        from backend.models.schemas import MotionAttributes, TimePeriod

        # Get the latest revision for this edge
        latest = await self.tracker.get_latest_revision(self._video_id, edge_id)
        if latest is None:
            return None

        # Only handle create/modify actions (not accept/reject which are for VSG edges)
        if latest.action not in ("create", "modify"):
            return None

        # For "create" revision, the new_* fields are the initial state
        # For "modify" revision, the new_* fields are the current state (or None if unchanged)
        # We need to trace back to get the full current state

        # Get the original create revision to get base values
        all_revisions = await self.tracker.get_edge_history(self._video_id, edge_id)
        if not all_revisions:
            return None

        # Find the create revision (oldest one with action=create)
        from backend.models.database import EdgeRevision, Video

        create_rev = None
        for rev in reversed(all_revisions):  # oldest first
            if rev.action == "create":
                # Need to get the actual EdgeRevision object, not RevisionResponse
                video_result = await self.session.execute(
                    select(Video).where(Video.video_id == self._video_id)
                )
                video = video_result.scalar_one_or_none()
                if video:
                    result = await self.session.execute(
                        select(EdgeRevision).where(EdgeRevision.id == rev.id)
                    )
                    create_rev = result.scalar_one_or_none()
                break

        if create_rev is None:
            return None

        # Start with create revision values
        source = json.loads(create_rev.new_source) if create_rev.new_source else []
        target = json.loads(create_rev.new_target) if create_rev.new_target else []
        predicate = create_rev.new_predicate or ""
        time_period_dict = create_rev.new_time_period or {"start_frame": 0, "end_frame": 0}
        attributes_dict = create_rev.new_attributes

        # Apply any subsequent modifications
        if latest.action == "modify" and latest.id != create_rev.id:
            # Get the latest revision object
            result = await self.session.execute(
                select(EdgeRevision).where(EdgeRevision.id == latest.id)
            )
            modify_rev = result.scalar_one_or_none()
            if modify_rev:
                if modify_rev.new_predicate:
                    predicate = modify_rev.new_predicate
                if modify_rev.new_time_period:
                    time_period_dict = modify_rev.new_time_period
                if modify_rev.new_attributes:
                    attributes_dict = modify_rev.new_attributes
                if modify_rev.new_source:
                    source = json.loads(modify_rev.new_source)
                if modify_rev.new_target:
                    target = json.loads(modify_rev.new_target)

        # Build and return EdgeResponse
        time_period = TimePeriod(**time_period_dict)
        attributes = MotionAttributes(**attributes_dict) if attributes_dict else None

        # Get node categories for source/target
        all_nodes = self.vsg_loader.get_all_nodes()
        source_list = source if isinstance(source, list) else [source]
        target_list = target if isinstance(target, list) else [target]

        source_category = [
            all_nodes[nid].category if nid in all_nodes else "unknown"
            for nid in source_list
        ]
        target_category = [
            all_nodes[nid].category if nid in all_nodes else "unknown"
            for nid in target_list
        ]

        if create_rev.edge_type in ("static", "dynamic"):
            source_category = source_category[0] if len(source_category) == 1 else source_category
            target_category = target_category[0] if len(target_category) == 1 else target_category

        return EdgeResponse(
            edge_id=edge_id,
            edge_type=create_rev.edge_type,
            source=source,
            target=target,
            source_category=source_category,
            target_category=target_category,
            predicate=predicate,
            confidence=1.0,
            confidence_round1=1.0,
            confidence_round2=1.0,
            validated=True,
            extraction_round=2,
            validation_reasoning_round1="Human annotated",
            validation_reasoning_round2="",
            time_period=time_period,
            attributes=attributes,
            has_revision=True,
            revision_action=latest.action,
        )

    async def modify_node(self, modification: NodeModify) -> dict:
        """Modify a node's attributes."""
        # Get the original node
        node = self.vsg_loader.get_node_by_id(modification.node_id)
        if node is None:
            raise ValueError(f"Node not found: {modification.node_id}")

        # Get original attributes (NodeResponse has attributes as NodeAttributes)
        original_attributes = {
            "visual": node.attributes.visual.model_dump(),
            "physical": node.attributes.physical.model_dump(),
        }

        # Record the modification
        revision = await self.tracker.record_node_modify(modification, original_attributes)

        return {
            "success": True,
            "revision_id": revision.id,
            "node_id": modification.node_id,
            "action": "modify",
            "changes": {
                "visual_attributes": (
                    modification.new_visual_attributes.model_dump()
                    if modification.new_visual_attributes
                    else None
                ),
                "physical_attributes": (
                    modification.new_physical_attributes.model_dump()
                    if modification.new_physical_attributes
                    else None
                ),
            },
        }

    async def get_node_history(
        self, video_id: str, node_id: str
    ) -> list[NodeRevisionResponse]:
        """Get revision history for a node."""
        return await self.tracker.get_node_history(video_id, node_id)

    async def get_edge_with_revisions(self, edge_id: str) -> Optional[EdgeResponse]:
        """Get an edge with its revision status and applied modifications."""
        edge = self.vsg_loader.get_edge_by_id(edge_id)
        if edge is None:
            return None

        # Check for latest revision (use canonical video_id)
        latest = await self.tracker.get_latest_revision(
            self._video_id, edge_id
        )

        if latest is not None:
            edge.has_revision = True
            edge.revision_action = latest.action

            # Apply modifications if this is a "modify" action
            if latest.action == "modify":
                if latest.new_predicate:
                    edge.predicate = latest.new_predicate
                if latest.new_time_period:
                    from backend.models.schemas import TimePeriod
                    edge.time_period = TimePeriod(**latest.new_time_period)
                if latest.new_attributes:
                    from backend.models.schemas import MotionAttributes
                    edge.attributes = MotionAttributes(**latest.new_attributes)

        return edge

    async def get_edge_history(
        self, video_id: str, edge_id: str
    ) -> list[RevisionResponse]:
        """Get revision history for an edge."""
        return await self.tracker.get_edge_history(video_id, edge_id)

    async def get_edges_with_revisions(self) -> list[EdgeResponse]:
        """Get all edges with their revision statuses and applied modifications."""
        edges = self.vsg_loader.get_all_edges()

        # Get all revisions for this video (use canonical video_id)
        revisions = await self.tracker.get_video_revisions(self._video_id)

        # Build a map of edge_id -> latest revision (full object)
        from backend.models.database import EdgeRevision
        revision_map: dict[str, EdgeRevision] = {}
        for rev in revisions:
            # Keep only the latest revision per edge
            if rev.edge_id not in revision_map:
                revision_map[rev.edge_id] = rev

        # Get deleted edge IDs (edges whose latest revision is "delete")
        deleted_ids = {
            edge_id for edge_id, rev in revision_map.items()
            if rev.action == "delete"
        }

        from backend.models.schemas import TimePeriod, MotionAttributes

        # Update edges with revision info and apply modifications
        for edge in edges:
            if edge.edge_id in revision_map:
                rev = revision_map[edge.edge_id]
                edge.has_revision = True
                edge.revision_action = rev.action

                # Apply modifications if this is a "modify" action
                if rev.action == "modify":
                    if rev.new_predicate:
                        edge.predicate = rev.new_predicate
                    if rev.new_time_period:
                        edge.time_period = TimePeriod(**rev.new_time_period)
                    if rev.new_attributes:
                        edge.attributes = MotionAttributes(**rev.new_attributes)

        # Filter out deleted edges
        edges = [e for e in edges if e.edge_id not in deleted_ids]

        # Also include newly created edges from the database
        # Pass revision_map so modifications are applied to created edges
        # (deleted created edges are already filtered by deleted_ids check)
        created_edges = await self.get_created_edges(revision_map)
        created_edges = [e for e in created_edges if e.edge_id not in deleted_ids]
        edges.extend(created_edges)

        return edges

    async def get_created_edges(self, revision_map: dict = None) -> list[EdgeResponse]:
        """Get all newly created edges as EdgeResponse objects.

        Args:
            revision_map: Optional map of edge_id -> latest revision. If provided,
                         modifications will be applied to created edges.
        """
        import json
        from backend.models.schemas import MotionAttributes, TimePeriod

        created_revisions = await self.tracker.get_created_edges(self._video_id)

        # Get all nodes for category lookups
        all_nodes = self.vsg_loader.get_all_nodes()

        edges = []
        for rev in created_revisions:
            # Build EdgeResponse from revision data
            source = json.loads(rev.new_source) if rev.new_source else []
            target = json.loads(rev.new_target) if rev.new_target else []
            predicate = rev.new_predicate or ""
            time_period_dict = rev.new_time_period or {"start_frame": 0, "end_frame": 0}
            attributes_dict = rev.new_attributes
            revision_action = "create"

            # Check if there's a later modification for this edge
            if revision_map and rev.edge_id in revision_map:
                latest_rev = revision_map[rev.edge_id]
                if latest_rev.action == "modify":
                    revision_action = "modify"
                    # Apply modifications
                    if latest_rev.new_predicate:
                        predicate = latest_rev.new_predicate
                    if latest_rev.new_time_period:
                        time_period_dict = latest_rev.new_time_period
                    if latest_rev.new_attributes:
                        attributes_dict = latest_rev.new_attributes
                    if latest_rev.new_source:
                        source = json.loads(latest_rev.new_source)
                    if latest_rev.new_target:
                        target = json.loads(latest_rev.new_target)

            # Look up categories from node data
            source_list = source if isinstance(source, list) else [source]
            target_list = target if isinstance(target, list) else [target]

            source_category = [
                all_nodes[nid].category if nid in all_nodes else "unknown"
                for nid in source_list
            ]
            target_category = [
                all_nodes[nid].category if nid in all_nodes else "unknown"
                for nid in target_list
            ]

            # For static/dynamic edges with single source/target, use string instead of list
            if rev.edge_type in ("static", "dynamic"):
                source_category = source_category[0] if len(source_category) == 1 else source_category
                target_category = target_category[0] if len(target_category) == 1 else target_category

            time_period = TimePeriod(**time_period_dict)

            attributes = None
            if rev.edge_type == "dynamic" and attributes_dict:
                attributes = MotionAttributes(**attributes_dict)

            edges.append(
                EdgeResponse(
                    edge_id=rev.edge_id,
                    edge_type=rev.edge_type,
                    source=source,
                    target=target,
                    source_category=source_category,
                    target_category=target_category,
                    predicate=predicate,
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
                    revision_action=revision_action,
                )
            )

        return edges
