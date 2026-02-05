"""Export service for exporting annotated VSG to Jan20 schema format."""

import json
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.revision_tracker import RevisionTracker
from backend.core.vsg_loader import VSGLoader
from backend.models.database import MetadataRevision, Video


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

        # Get all revisions
        revisions = await self.tracker.get_video_revisions(self.video_id)

        # Build revision maps
        accepted_edges: set[str] = set()
        rejected_edges: set[str] = set()
        modifications: dict[str, dict] = {}

        for rev in revisions:
            if user_id is not None and rev.user_id != user_id:
                continue

            if rev.action == "accept":
                accepted_edges.add(rev.edge_id)
            elif rev.action == "reject":
                rejected_edges.add(rev.edge_id)
            elif rev.action == "modify":
                modifications[rev.edge_id] = {
                    "predicate": rev.new_predicate,
                    "time_period": rev.new_time_period,
                    "attributes": rev.new_attributes,
                    "source": json.loads(rev.new_source) if rev.new_source else None,
                    "target": json.loads(rev.new_target) if rev.new_target else None,
                }

        # Process static edges
        vsg["static_scene_graph"]["edges"] = self._process_edges(
            vsg["static_scene_graph"]["edges"],
            rejected_edges,
            modifications,
            include_rejected,
            apply_modifications,
        )

        # Process dynamic edges
        vsg["dynamic_scene_graph"]["edges"] = self._process_edges(
            vsg["dynamic_scene_graph"]["edges"],
            rejected_edges,
            modifications,
            include_rejected,
            apply_modifications,
        )

        # Process FG-BG edges
        vsg["foreground_background_relations"]["edges"] = self._process_edges(
            vsg["foreground_background_relations"]["edges"],
            rejected_edges,
            modifications,
            include_rejected,
            apply_modifications,
        )

        # Add newly created edges
        created_edges = await self.tracker.get_created_edges(self.video_id)
        for rev in created_edges:
            if user_id is not None and rev.user_id != user_id:
                continue

            new_edge = self._build_edge_from_revision(rev)

            if rev.edge_type == "static":
                vsg["static_scene_graph"]["edges"].append(new_edge)
            elif rev.edge_type == "dynamic":
                vsg["dynamic_scene_graph"]["edges"].append(new_edge)
            elif rev.edge_type == "fg_bg":
                vsg["foreground_background_relations"]["edges"].append(new_edge)

        # Apply metadata revisions (scene_info, camera_motion)
        vsg = await self._apply_metadata_revisions(vsg, user_id)

        # Update metadata
        vsg["metadata"]["exported_at"] = datetime.now().isoformat()
        vsg["metadata"]["human_annotated"] = True

        # Update summary
        vsg["summary"] = self._build_summary(vsg)

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

    def _process_edges(
        self,
        edges: list[dict],
        rejected_edges: set[str],
        modifications: dict[str, dict],
        include_rejected: bool,
        apply_modifications: bool,
    ) -> list[dict]:
        """Process edges with annotations."""
        result = []

        for edge in edges:
            edge_id = edge["edge_id"]

            # Handle rejected edges
            if edge_id in rejected_edges:
                if include_rejected:
                    edge = edge.copy()
                    edge["human_rejected"] = True
                    result.append(edge)
                continue

            # Apply modifications
            if apply_modifications and edge_id in modifications:
                edge = edge.copy()
                mods = modifications[edge_id]

                if mods["predicate"] is not None:
                    edge["predicate"] = mods["predicate"]

                if mods["time_period"] is not None:
                    edge["time_period"] = mods["time_period"]

                if mods["attributes"] is not None:
                    edge["attributes"] = mods["attributes"]

                if mods["source"] is not None:
                    edge["source"] = mods["source"]

                if mods["target"] is not None:
                    edge["target"] = mods["target"]

                edge["human_modified"] = True

            result.append(edge)

        return result

    def _build_edge_from_revision(self, rev) -> dict:
        """Build an edge dict from a create revision."""
        source = json.loads(rev.new_source) if rev.new_source else []
        target = json.loads(rev.new_target) if rev.new_target else []

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
            "time_period": rev.new_time_period or {"start_frame": 0, "end_frame": 0},
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

        return {
            **edge_stats,
            "scene_info_revisions": metadata_stats["scene_info"],
            "camera_motion_revisions": metadata_stats["camera_motion"],
        }
