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
        # Get the current edge state (VSG edge or created edge)
        edge = self.vsg_loader.get_edge_by_id(annotation.edge_id)
        if edge is None:
            effective_edges = await self.get_edges_with_revisions()
            edge = next((e for e in effective_edges if e.edge_id == annotation.edge_id), None)
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

        time_periods = None
        if annotation.new_time_periods is not None:
            time_periods = [tp.model_dump() for tp in annotation.new_time_periods]
        elif annotation.new_time_period is not None:
            time_periods = [annotation.new_time_period.model_dump()]

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
                "time_periods": time_periods,
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
        revision history.
        """
        import json
        from backend.models.schemas import MotionAttributes, TimePeriod
        from backend.models.database import EdgeRevision, Video

        video_result = await self.session.execute(
            select(Video).where(Video.video_id == self._video_id)
        )
        video = video_result.scalar_one_or_none()
        if video is None:
            return None

        result = await self.session.execute(
            select(EdgeRevision)
            .where(
                EdgeRevision.video_id == video.id,
                EdgeRevision.edge_id == edge_id,
            )
            .order_by(EdgeRevision.created_at.asc(), EdgeRevision.id.asc())
        )
        revisions = list(result.scalars().all())
        if not revisions:
            return None

        latest = revisions[-1]
        if latest.action == "delete":
            return None

        create_rev = next((rev for rev in revisions if rev.action == "create"), None)
        if create_rev is None:
            return None

        source = json.loads(create_rev.new_source) if create_rev.new_source else []
        target = json.loads(create_rev.new_target) if create_rev.new_target else []
        predicate = create_rev.new_predicate or ""
        time_periods_dict = (
            create_rev.new_time_periods
            or ([create_rev.new_time_period] if create_rev.new_time_period else None)
            or [{"start_frame": 0, "end_frame": 0}]
        )
        attributes_dict = create_rev.new_attributes

        for rev in revisions:
            if rev.id == create_rev.id:
                continue
            if rev.action == "delete":
                return None
            if rev.action not in ("modify", "accept"):
                continue

            if rev.new_predicate is not None:
                predicate = rev.new_predicate
            if rev.new_time_periods is not None:
                time_periods_dict = rev.new_time_periods
            elif rev.new_time_period is not None:
                time_periods_dict = [rev.new_time_period]
            if rev.new_attributes is not None:
                attributes_dict = rev.new_attributes
            if rev.new_source is not None:
                source = json.loads(rev.new_source)
            if rev.new_target is not None:
                target = json.loads(rev.new_target)

        # Build and return EdgeResponse
        time_periods = [TimePeriod(**tp) for tp in time_periods_dict]
        time_period = self._merge_time_periods(time_periods)
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
            time_periods=time_periods,
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
        original_is_static = node.is_static
        original_category = node.category

        # Prefer latest revision values if exists
        latest_rev = await self.tracker.get_latest_node_revision(
            modification.video_id, modification.node_id
        )
        if latest_rev:
            if latest_rev.new_is_static is not None:
                original_is_static = latest_rev.new_is_static
            if latest_rev.new_category is not None:
                original_category = latest_rev.new_category

        # Snapshot pre-flip effective edge_type per edge so we can detect
        # transitions caused by this node flip and enqueue reextraction.
        pre_flip_types: dict[str, str] = {}
        flip_changed_type = (
            modification.new_is_static is not None
            and modification.new_is_static != original_is_static
        )
        if flip_changed_type:
            pre_edges = await self.get_edges_with_revisions()
            pre_flip_types = {e.edge_id: e.edge_type for e in pre_edges}

        # Record the modification
        revision = await self.tracker.record_node_modify(
            modification, original_attributes, original_is_static, original_category
        )

        # After the revision is recorded, recompute effective edges to see
        # which ones transitioned. Enqueue Gemini reextract jobs for each
        # transitioning edge so the predicate + motion attrs match the new
        # edge_type's schema vocabulary.
        enqueued: list[int] = []
        if flip_changed_type:
            post_edges = await self.get_edges_with_revisions()
            transitions: list[tuple[str, str, str]] = []
            for e in post_edges:
                prev_type = pre_flip_types.get(e.edge_id)
                if prev_type and prev_type != e.edge_type:
                    transitions.append((e.edge_id, prev_type, e.edge_type))

            if transitions:
                from backend.models.database import Video
                from backend.services.reextract_service import ReextractService

                vid_row = await self.session.execute(
                    select(Video).where(Video.video_id == modification.video_id)
                )
                vid = vid_row.scalar_one_or_none()
                if vid is not None:
                    reextract = ReextractService(self.session, vid.id, modification.video_id)
                    enqueued = await reextract.enqueue_transitions(transitions)
                    ReextractService.spawn_background(enqueued)

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
                "is_static": modification.new_is_static,
                "category": modification.new_category,
            },
            "reextract_job_ids": enqueued,
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

            # Apply accepted/modified values if present.
            if latest.action in ("modify", "accept"):
                if latest.new_predicate is not None:
                    edge.predicate = latest.new_predicate
                if latest.new_time_periods is not None:
                    from backend.models.schemas import TimePeriod
                    periods = [TimePeriod(**tp) for tp in latest.new_time_periods]
                    edge.time_periods = periods
                    edge.time_period = self._merge_time_periods(periods)
                elif latest.new_time_period is not None:
                    from backend.models.schemas import TimePeriod
                    edge.time_period = TimePeriod(**latest.new_time_period)
                    edge.time_periods = [edge.time_period]
                if latest.new_attributes is not None:
                    from backend.models.schemas import MotionAttributes
                    edge.attributes = MotionAttributes(**latest.new_attributes)
                if latest.new_source is not None:
                    import json
                    edge.source = json.loads(latest.new_source)
                if latest.new_target is not None:
                    import json
                    edge.target = json.loads(latest.new_target)

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

                # Apply accepted/modified values if present.
                if rev.action in ("modify", "accept"):
                    if rev.new_predicate is not None:
                        edge.predicate = rev.new_predicate
                    if rev.new_time_periods is not None:
                        periods = [TimePeriod(**tp) for tp in rev.new_time_periods]
                        edge.time_periods = periods
                        edge.time_period = self._merge_time_periods(periods)
                    elif rev.new_time_period is not None:
                        edge.time_period = TimePeriod(**rev.new_time_period)
                        edge.time_periods = [edge.time_period]
                    if rev.new_attributes is not None:
                        edge.attributes = MotionAttributes(**rev.new_attributes)
                    if rev.new_source is not None:
                        import json
                        edge.source = json.loads(rev.new_source)
                    if rev.new_target is not None:
                        import json
                        edge.target = json.loads(rev.new_target)

        # Filter out deleted edges
        edges = [e for e in edges if e.edge_id not in deleted_ids]

        # Also include newly created edges from the database
        # Pass revision_map so modifications are applied to created edges
        # (deleted created edges are already filtered by deleted_ids check)
        created_edges = await self.get_created_edges(revision_map)
        created_edges = [e for e in created_edges if e.edge_id not in deleted_ids]
        edges.extend(created_edges)

        # Reclassify edge types based on current node static/dynamic status
        edges = await self._reclassify_edges_by_nodes(edges)

        return edges

    async def _reclassify_edges_by_nodes(self, edges: list[EdgeResponse]) -> list[EdgeResponse]:
        """Update edge_type based on current node static/dynamic status.

        Derived side effects driven by node static/dynamic flips:
          * When an edge is reclassified to ``static``, overwrite its
            time_period(s) with the full video span, since static objects
            are assumed not to move and the relation holds for the whole
            video.
          * On group ``fg_bg`` edges, drop sources whose type flipped to
            static and targets whose type flipped to dynamic (those members
            no longer satisfy the fg_bg contract of dynamic→static). If a
            side is emptied, the edge is dropped entirely.
          * Refresh each edge's ``source_category`` / ``target_category``
            from the live node map so that a node-category revision
            propagates to its related edges.
          * After reclassification, drop edges whose stored predicate does
            not belong to the new edge_type's canonical vocabulary (e.g. a
            fg_bg ``driving_on`` edge that reclassifies to ``static`` has
            no valid static-edge predicate and is dropped).
        """
        from backend.models.schemas import TimePeriod
        from backend.core.predicate_vocab import predicate_valid_for_type

        # Build node_id -> is_static map with revisions applied
        all_nodes = list(self.vsg_loader.get_all_nodes().values())
        node_map = {n.node_id: n.is_static for n in all_nodes}
        category_map = {n.node_id: n.category for n in all_nodes}

        # Apply latest node revisions to the type + category maps
        for node in all_nodes:
            latest_rev = await self.tracker.get_latest_node_revision(self._video_id, node.node_id)
            if latest_rev:
                if latest_rev.new_is_static is not None:
                    node_map[node.node_id] = latest_rev.new_is_static
                if latest_rev.new_category is not None:
                    category_map[node.node_id] = latest_rev.new_category

        total_frames = self.vsg_loader.total_frames
        # Guard against zero-frame or unknown metadata
        full_span_end = max(total_frames - 1, 0)
        full_span = TimePeriod(start_frame=0, end_frame=full_span_end)

        def classify_edge(edge: EdgeResponse) -> tuple[str, Optional[str]]:
            sources = edge.source if isinstance(edge.source, list) else [edge.source]
            targets = edge.target if isinstance(edge.target, list) else [edge.target]
            source_static = [node_map.get(s, False) for s in sources]
            target_static = [node_map.get(t, False) for t in targets]

            # Lists: only keep fg_bg unless singleton conversion is possible
            if len(sources) != 1 or len(targets) != 1:
                if all(not s for s in source_static) and all(t for t in target_static):
                    return "fg_bg", None
                return edge.edge_type, "Edge type mismatch after node type change"

            s_static = source_static[0]
            t_static = target_static[0]
            if s_static and t_static:
                return "static", None
            if not s_static and not t_static:
                return "dynamic", None
            return "fg_bg", None

        reconciled: list[EdgeResponse] = []
        for edge in edges:
            # 1) Prune group-edge members whose type no longer fits the fg_bg
            #    contract. Only true group edges (>1 source or >1 target)
            #    are pruned; singleton 1:1 fg_bg edges are left intact so
            #    classify_edge below can transition them to ``static`` when
            #    both endpoints become static.
            is_group_fg_bg = (
                edge.edge_type == "fg_bg"
                and isinstance(edge.source, list)
                and isinstance(edge.target, list)
                and (len(edge.source) > 1 or len(edge.target) > 1)
            )
            if is_group_fg_bg:
                kept_sources = [s for s in edge.source if not node_map.get(s, False)]
                kept_targets = [t for t in edge.target if node_map.get(t, False)]

                if not kept_sources or not kept_targets:
                    # Drop the edge entirely — there are no valid
                    # dynamic→static pairings left.
                    continue

                if kept_sources != edge.source or kept_targets != edge.target:
                    src_cats = edge.source_category if isinstance(edge.source_category, list) else [edge.source_category]
                    tgt_cats = edge.target_category if isinstance(edge.target_category, list) else [edge.target_category]
                    source_cat_map = dict(zip(edge.source, src_cats))
                    target_cat_map = dict(zip(edge.target, tgt_cats))
                    edge.source = kept_sources
                    edge.target = kept_targets
                    edge.source_category = [source_cat_map.get(s, "unknown") for s in kept_sources]
                    edge.target_category = [target_cat_map.get(t, "unknown") for t in kept_targets]
                    note = "Group members dropped after node type change"
                    if not edge.validation_reasoning_round2:
                        edge.validation_reasoning_round2 = note

            # 2) Reclassify edge_type from node types
            prev_type = edge.edge_type
            new_type, note = classify_edge(edge)
            edge.edge_type = new_type
            if note and not edge.validation_reasoning_round2:
                edge.validation_reasoning_round2 = note

            # 2b) When transitioning from fg_bg to a 1:1 static or dynamic
            #     edge, collapse singleton lists to strings so the response
            #     shape matches the StaticEdge/DynamicEdge contract.
            if new_type in ("static", "dynamic") and new_type != prev_type:
                if isinstance(edge.source, list) and len(edge.source) == 1:
                    edge.source = edge.source[0]
                if isinstance(edge.target, list) and len(edge.target) == 1:
                    edge.target = edge.target[0]
                if isinstance(edge.source_category, list) and len(edge.source_category) == 1:
                    edge.source_category = edge.source_category[0]
                if isinstance(edge.target_category, list) and len(edge.target_category) == 1:
                    edge.target_category = edge.target_category[0]

            # 3) When an edge transitions into ``static`` from a non-static
            #    type, force the full-video span. Static relations are
            #    assumed to hold for the entire video. We only overwrite on
            #    transition so that pre-existing static edges keep any
            #    user-annotated narrow spans.
            if new_type == "static" and prev_type != "static":
                edge.time_period = full_span
                edge.time_periods = [full_span]

            # 4) Refresh source_category / target_category from the live
            #    node map. A node-category revision would otherwise leave
            #    stale strings on every edge that references it.
            if isinstance(edge.source, list):
                edge.source_category = [
                    category_map.get(s, "unknown") for s in edge.source
                ]
            else:
                edge.source_category = category_map.get(edge.source, edge.source_category)
            if isinstance(edge.target, list):
                edge.target_category = [
                    category_map.get(t, "unknown") for t in edge.target
                ]
            else:
                edge.target_category = category_map.get(edge.target, edge.target_category)

            # 5) Drop edges whose predicate is not valid for the new
            #    edge_type. This catches fg_bg motion predicates leaking
            #    into reclassified static edges (e.g. ``driving_on`` on a
            #    static→static pair) and static spatial predicates leaking
            #    into dynamic reclassifications. Until the auto-reextract
            #    pipeline is wired, the safe action is removal.
            if not predicate_valid_for_type(edge.predicate, new_type):
                continue

            reconciled.append(edge)

        return reconciled

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
            time_periods_dict = (
                rev.new_time_periods
                or ([rev.new_time_period] if rev.new_time_period else None)
                or [{"start_frame": 0, "end_frame": 0}]
            )
            attributes_dict = rev.new_attributes
            revision_action = "create"

            # Check if there's a later accepted/modified state for this edge
            if revision_map and rev.edge_id in revision_map:
                latest_rev = revision_map[rev.edge_id]
                if latest_rev.action in ("modify", "accept"):
                    revision_action = latest_rev.action
                    if latest_rev.new_predicate is not None:
                        predicate = latest_rev.new_predicate
                    if latest_rev.new_time_periods is not None:
                        time_periods_dict = latest_rev.new_time_periods
                    elif latest_rev.new_time_period is not None:
                        time_periods_dict = [latest_rev.new_time_period]
                    if latest_rev.new_attributes is not None:
                        attributes_dict = latest_rev.new_attributes
                    if latest_rev.new_source is not None:
                        source = json.loads(latest_rev.new_source)
                    if latest_rev.new_target is not None:
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

            time_periods = [TimePeriod(**tp) for tp in time_periods_dict]
            time_period = self._merge_time_periods(time_periods)

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
                    time_periods=time_periods,
                    attributes=attributes,
                    has_revision=True,
                    revision_action=revision_action,
                )
            )

        return edges

    @staticmethod
    def _merge_time_periods(periods: list) -> "TimePeriod":
        """Compute a union TimePeriod from a list."""
        from backend.models.schemas import TimePeriod

        if not periods:
            return TimePeriod(start_frame=0, end_frame=0)
        return TimePeriod(
            start_frame=min(p.start_frame for p in periods),
            end_frame=max(p.end_frame for p in periods),
        )
