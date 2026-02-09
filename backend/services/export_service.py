"""Export service for exporting annotated VSG to Jan20 schema format."""

import json
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.revision_tracker import RevisionTracker
from backend.core.vsg_loader import VSGLoader
from backend.models.database import MetadataRevision, NodeRevision, Video


class ExportService:
    """Service for exporting annotated VSG files."""

    def __init__(self, session: AsyncSession, vsg_loader: VSGLoader, video_id: str):
        """Initialize with database session, VSG loader, and database video_id."""
        self.session = session
        self.vsg_loader = vsg_loader
        self.video_id = video_id  # Use DB video_id, not VSG metadata video_id
        self.tracker = RevisionTracker(session)

    async def export(
        self,
        include_rejected: bool = False,
        apply_modifications: bool = True,
        user_id: int | None = None,
    ) -> dict[str, Any]:
        """
        Export the VSG with human annotations applied.

        Args:
            include_rejected: If True, include rejected edges (marked)
            apply_modifications: If True, apply modifications to edges
            user_id: Filter revisions by specific user

        Returns:
            Complete VSG dict with annotations applied
        """
        # Load original VSG
        vsg = self.vsg_loader.load().copy()

        # Get all revisions (newest first) and keep latest per edge
        revisions = await self.tracker.get_video_revisions(self.video_id)
        latest_edge_revisions: dict[str, Any] = {}
        for rev in revisions:
            if user_id is not None and rev.user_id != user_id:
                continue
            if rev.edge_id not in latest_edge_revisions:
                latest_edge_revisions[rev.edge_id] = rev

        # Process static edges
        vsg["static_scene_graph"]["edges"] = self._process_edges(
            vsg["static_scene_graph"]["edges"],
            latest_edge_revisions,
            include_rejected,
            apply_modifications,
        )

        # Process dynamic edges
        vsg["dynamic_scene_graph"]["edges"] = self._process_edges(
            vsg["dynamic_scene_graph"]["edges"],
            latest_edge_revisions,
            include_rejected,
            apply_modifications,
        )

        # Process FG-BG edges
        vsg["foreground_background_relations"]["edges"] = self._process_edges(
            vsg["foreground_background_relations"]["edges"],
            latest_edge_revisions,
            include_rejected,
            apply_modifications,
        )

        # Add newly created edges
        created_edges = await self.tracker.get_created_edges(self.video_id)
        for rev in created_edges:
            if user_id is not None and rev.user_id != user_id:
                continue

            latest_rev = latest_edge_revisions.get(rev.edge_id)
            if latest_rev is not None and latest_rev.action == "delete":
                continue

            new_edge = self._build_edge_from_revision(rev)
            if latest_rev is not None and latest_rev.action == "modify" and apply_modifications:
                new_edge = self._apply_edge_modifications(new_edge, latest_rev)
            if latest_rev is not None and latest_rev.action in {"modify", "accept", "create"}:
                new_edge = self._mark_edge_validated(new_edge)

            if rev.edge_type == "static":
                vsg["static_scene_graph"]["edges"].append(new_edge)
            elif rev.edge_type == "dynamic":
                vsg["dynamic_scene_graph"]["edges"].append(new_edge)
            elif rev.edge_type == "fg_bg":
                vsg["foreground_background_relations"]["edges"].append(new_edge)

        # Apply node revisions (attributes)
        vsg = await self._apply_node_revisions(vsg, user_id)

        # Reclassify edges after node static/dynamic changes
        vsg = self._reclassify_edges_by_nodes(vsg)

        # Apply metadata revisions (scene_info, camera_motion)
        vsg = await self._apply_metadata_revisions(vsg, user_id)

        # Update metadata
        vsg["metadata"]["exported_at"] = datetime.now().isoformat()
        vsg["metadata"]["human_annotated"] = True

        # Update summary
        vsg["summary"] = self._build_summary(vsg)

        return vsg

    def _reclassify_edges_by_nodes(self, vsg: dict) -> dict:
        """Rebuild edge lists based on current node is_static values."""
        static_nodes = vsg.get("static_scene_graph", {}).get("nodes", [])
        dynamic_nodes = vsg.get("dynamic_scene_graph", {}).get("nodes", [])
        static_ids = {n.get("node_id") for n in static_nodes}
        dynamic_ids = {n.get("node_id") for n in dynamic_nodes}
        node_is_static = {node_id: True for node_id in static_ids}
        node_is_static.update({node_id: False for node_id in dynamic_ids})

        all_edges = (
            vsg.get("static_scene_graph", {}).get("edges", [])
            + vsg.get("dynamic_scene_graph", {}).get("edges", [])
            + vsg.get("foreground_background_relations", {}).get("edges", [])
        )

        static_edges = []
        dynamic_edges = []
        fg_bg_edges = []

        for edge in all_edges:
            sources = edge.get("source")
            targets = edge.get("target")
            src_list = sources if isinstance(sources, list) else [sources]
            tgt_list = targets if isinstance(targets, list) else [targets]
            src_static = [node_is_static.get(s, False) for s in src_list]
            tgt_static = [node_is_static.get(t, False) for t in tgt_list]

            if len(src_list) == 1 and len(tgt_list) == 1:
                s_static = src_static[0]
                t_static = tgt_static[0]
                if s_static and t_static:
                    edge["edge_type"] = "static"
                    static_edges.append(edge)
                elif not s_static and not t_static:
                    edge["edge_type"] = "dynamic"
                    dynamic_edges.append(edge)
                else:
                    edge["edge_type"] = "fg_bg"
                    fg_bg_edges.append(edge)
                continue

            # Multi-node edges: keep fg_bg if it still fits, else keep existing type and flag
            if all(not s for s in src_static) and all(t for t in tgt_static):
                edge["edge_type"] = "fg_bg"
                fg_bg_edges.append(edge)
            else:
                if not edge.get("validation_reasoning_round2"):
                    edge["validation_reasoning_round2"] = "Edge type mismatch after node type change"
                # Keep in its current list by edge_type
                edge_type = edge.get("edge_type")
                if edge_type == "static":
                    static_edges.append(edge)
                elif edge_type == "dynamic":
                    dynamic_edges.append(edge)
                else:
                    fg_bg_edges.append(edge)

        vsg["static_scene_graph"]["edges"] = static_edges
        vsg["dynamic_scene_graph"]["edges"] = dynamic_edges
        vsg["foreground_background_relations"]["edges"] = fg_bg_edges
        return vsg

    async def _apply_metadata_revisions(
        self, vsg: dict, user_id: int | None = None
    ) -> dict:
        """Apply metadata revisions (scene_info, camera_motion) to VSG."""
        # Get video record
        result = await self.session.execute(
            select(Video).where(Video.video_id == self.video_id)
        )
        video = result.scalar_one_or_none()

        if video is None:
            return vsg

        # Get latest metadata revisions
        for metadata_type in ["scene_info", "camera_motion"]:
            query = (
                select(MetadataRevision)
                .where(
                    MetadataRevision.video_id == video.id,
                    MetadataRevision.metadata_type == metadata_type,
                )
                .order_by(MetadataRevision.created_at.desc())
                .limit(1)
            )

            if user_id is not None:
                query = query.where(MetadataRevision.user_id == user_id)

            result = await self.session.execute(query)
            revision = result.scalar_one_or_none()

            if revision is not None:
                # Apply the revision
                vsg[metadata_type] = revision.new_value
                vsg[f"{metadata_type}_human_modified"] = True

        return vsg

    async def _apply_node_revisions(self, vsg: dict, user_id: int | None = None) -> dict:
        """Apply node attribute revisions to VSG nodes."""
        result = await self.session.execute(
            select(Video).where(Video.video_id == self.video_id)
        )
        video = result.scalar_one_or_none()

        if video is None:
            return vsg

        query = (
            select(NodeRevision)
            .where(NodeRevision.video_id == video.id)
            .order_by(NodeRevision.created_at.desc())
        )
        if user_id is not None:
            query = query.where(NodeRevision.user_id == user_id)

        result = await self.session.execute(query)
        revisions = result.scalars().all()

        latest_node_revisions: dict[str, NodeRevision] = {}
        for rev in revisions:
            if rev.node_id not in latest_node_revisions:
                latest_node_revisions[rev.node_id] = rev

        if not latest_node_revisions:
            return vsg

        def apply_to_nodes(nodes: list[dict]) -> None:
            for node in nodes:
                node_id = node.get("node_id")
                rev = latest_node_revisions.get(node_id)
                if rev is None:
                    continue

                attrs = node.get("attributes", {})
                new_attrs = rev.new_attributes or {}
                if "visual" in new_attrs:
                    attrs["visual"] = new_attrs["visual"]
                if "physical" in new_attrs:
                    attrs["physical"] = new_attrs["physical"]
                node["attributes"] = attrs
                node["human_modified"] = True
                if rev.new_is_static is not None:
                    node["is_static"] = rev.new_is_static

        static_nodes = vsg.get("static_scene_graph", {}).get("nodes", [])
        dynamic_nodes = vsg.get("dynamic_scene_graph", {}).get("nodes", [])

        # Seed is_static based on current list membership if missing
        for node in static_nodes:
            node.setdefault("is_static", True)
        for node in dynamic_nodes:
            node.setdefault("is_static", False)

        apply_to_nodes(static_nodes)
        apply_to_nodes(dynamic_nodes)

        # Move nodes between static/dynamic lists based on updated is_static
        all_nodes = static_nodes + dynamic_nodes
        vsg["static_scene_graph"]["nodes"] = [n for n in all_nodes if n.get("is_static", True)]
        vsg["dynamic_scene_graph"]["nodes"] = [n for n in all_nodes if not n.get("is_static", True)]

        # Ensure nodes carry explicit is_static
        for node in vsg["static_scene_graph"]["nodes"]:
            node["is_static"] = True
        for node in vsg["dynamic_scene_graph"]["nodes"]:
            node["is_static"] = False

        return vsg

    def _process_edges(
        self,
        edges: list[dict],
        latest_edge_revisions: dict[str, Any],
        include_rejected: bool,
        apply_modifications: bool,
    ) -> list[dict]:
        """Process edges with annotations."""
        result = []

        for edge in edges:
            edge_id = edge["edge_id"]
            rev = latest_edge_revisions.get(edge_id)

            if "time_periods" not in edge and "time_period" in edge:
                edge = edge.copy()
                edge["time_periods"] = [edge["time_period"]]

            # Handle deleted edges
            if rev is not None and rev.action == "delete":
                continue

            # Handle rejected edges
            if rev is not None and rev.action == "reject":
                if include_rejected:
                    edge = edge.copy()
                    edge["human_rejected"] = True
                    result.append(edge)
                continue

            # Apply modifications
            if rev is not None and rev.action == "modify" and apply_modifications:
                edge = self._apply_edge_modifications(edge.copy(), rev)

            if rev is not None and rev.action in {"modify", "accept"}:
                edge = self._mark_edge_validated(edge.copy())

            result.append(edge)

        return result

    def _apply_edge_modifications(self, edge: dict, rev: Any) -> dict:
        """Apply modifications from a revision to an edge."""
        if rev.new_predicate is not None:
            edge["predicate"] = rev.new_predicate
        if rev.new_time_periods is not None:
            edge["time_periods"] = rev.new_time_periods
            edge["time_period"] = self._merge_time_periods(rev.new_time_periods)
        elif rev.new_time_period is not None:
            edge["time_period"] = rev.new_time_period
            edge["time_periods"] = [rev.new_time_period]
        if rev.new_attributes is not None:
            edge["attributes"] = rev.new_attributes
        if rev.new_source is not None:
            edge["source"] = json.loads(rev.new_source)
        if rev.new_target is not None:
            edge["target"] = json.loads(rev.new_target)
        edge["human_modified"] = True
        return edge

    def _mark_edge_validated(self, edge: dict) -> dict:
        """Mark edge as human validated."""
        edge["validated"] = True
        edge["validation_reasoning_round1"] = "Human annotated"
        edge["validation_reasoning_round2"] = ""
        return edge

    def _build_edge_from_revision(self, rev) -> dict:
        """Build an edge dict from a create revision."""
        source = json.loads(rev.new_source) if rev.new_source else []
        target = json.loads(rev.new_target) if rev.new_target else []
        time_periods = (
            rev.new_time_periods
            or ([rev.new_time_period] if rev.new_time_period else None)
            or [{"start_frame": 0, "end_frame": 0}]
        )

        # Look up node categories
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

        # For static/dynamic edges with single source/target, use string instead of list
        if rev.edge_type in ("static", "dynamic"):
            source_category = source_category[0] if len(source_category) == 1 else source_category
            target_category = target_category[0] if len(target_category) == 1 else target_category

        edge = {
            "edge_id": rev.edge_id,
            "source": source,
            "target": target,
            "source_category": source_category,
            "target_category": target_category,
            "predicate": rev.new_predicate or "",
            "time_period": self._merge_time_periods(time_periods),
            "time_periods": time_periods,
            "confidence": 1.0,
            "confidence_round1": 1.0,
            "confidence_round2": 1.0,
            "validated": True,
            "extraction_round": 2,  # Human annotated
            "validation_reasoning_round1": "Human annotated",
            "validation_reasoning_round2": "",
            "human_created": True,
        }

        if rev.edge_type == "dynamic" and rev.new_attributes:
            edge["attributes"] = rev.new_attributes

        return edge

    @staticmethod
    def _merge_time_periods(time_periods: list[dict]) -> dict:
        """Compute a union time period dict from a list."""
        if not time_periods:
            return {"start_frame": 0, "end_frame": 0}
        start = min(tp.get("start_frame", 0) for tp in time_periods)
        end = max(tp.get("end_frame", 0) for tp in time_periods)
        return {"start_frame": start, "end_frame": end}

    def _build_summary(self, vsg: dict) -> dict:
        """Build summary for the exported VSG."""
        static_nodes = vsg.get("static_scene_graph", {}).get("nodes", [])
        dynamic_nodes = vsg.get("dynamic_scene_graph", {}).get("nodes", [])
        static_edges = vsg.get("static_scene_graph", {}).get("edges", [])
        dynamic_edges = vsg.get("dynamic_scene_graph", {}).get("edges", [])
        fg_bg_edges = vsg.get("foreground_background_relations", {}).get("edges", [])

        all_categories = set()
        for node in static_nodes + dynamic_nodes:
            all_categories.add(node.get("category", "unknown"))

        all_predicates = set()
        for edge in static_edges + dynamic_edges + fg_bg_edges:
            all_predicates.add(edge.get("predicate", "unknown"))

        return {
            "total_static_nodes": len(static_nodes),
            "total_dynamic_nodes": len(dynamic_nodes),
            "total_static_edges": len(static_edges),
            "total_dynamic_edges": len(dynamic_edges),
            "total_fg_bg_edges": len(fg_bg_edges),
            "unique_categories": sorted(list(all_categories)),
            "unique_predicates": sorted(list(all_predicates)),
            "human_modified_nodes": len(
                [n for n in static_nodes + dynamic_nodes if n.get("human_modified")]
            ),
            "human_modified_edges": len(
                [e for e in static_edges + dynamic_edges + fg_bg_edges if e.get("human_modified")]
            ),
            "human_created_edges": len(
                [e for e in static_edges + dynamic_edges + fg_bg_edges if e.get("human_created")]
            ),
            "human_rejected_edges": len(
                [e for e in static_edges + dynamic_edges + fg_bg_edges if e.get("human_rejected")]
            ),
            "scene_info_human_modified": vsg.get("scene_info_human_modified", False),
            "camera_motion_human_modified": vsg.get("camera_motion_human_modified", False),
        }

    async def get_revision_summary(self) -> dict:
        """Get a summary of all revisions for the video."""
        edge_stats = await self.tracker.get_revision_stats(self.video_id)

        # Get video record
        result = await self.session.execute(
            select(Video).where(Video.video_id == self.video_id)
        )
        video = result.scalar_one_or_none()

        # Count metadata revisions
        metadata_stats = {"scene_info": 0, "camera_motion": 0}
        node_revision_count = 0
        if video is not None:
            for metadata_type in ["scene_info", "camera_motion"]:
                result = await self.session.execute(
                    select(MetadataRevision)
                    .where(
                        MetadataRevision.video_id == video.id,
                        MetadataRevision.metadata_type == metadata_type,
                    )
                )
                metadata_stats[metadata_type] = len(result.scalars().all())

            result = await self.session.execute(
                select(NodeRevision).where(NodeRevision.video_id == video.id)
            )
            node_revision_count = len(result.scalars().all())

        return {
            **edge_stats,
            "scene_info_revisions": metadata_stats["scene_info"],
            "camera_motion_revisions": metadata_stats["camera_motion"],
            "node_revisions": node_revision_count,
        }
