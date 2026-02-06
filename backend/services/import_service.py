"""Import service for importing VSG files."""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.database import EdgeRevision, MetadataRevision, NodeRevision, Video

logger = logging.getLogger(__name__)


class VSGValidationError(Exception):
    """Raised when VSG validation fails."""

    pass


class ImportService:
    """Service for importing VSG files."""

    def __init__(self, session: AsyncSession):
        """Initialize with database session."""
        self.session = session

    def validate_vsg(self, vsg_data: dict[str, Any]) -> None:
        """
        Validate VSG JSON structure.

        Required structure:
        - metadata object
        - static_scene_graph with nodes[] and edges[]
        - dynamic_scene_graph with nodes[] and edges[]
        - foreground_background_relations with edges[]

        Raises:
            VSGValidationError: If validation fails
        """
        # Check top-level keys
        required_keys = [
            "metadata",
            "static_scene_graph",
            "dynamic_scene_graph",
            "foreground_background_relations",
        ]

        for key in required_keys:
            if key not in vsg_data:
                raise VSGValidationError(f"Missing required key: {key}")

        # Validate metadata
        if not isinstance(vsg_data["metadata"], dict):
            raise VSGValidationError("metadata must be an object")

        # Validate static_scene_graph
        ssg = vsg_data["static_scene_graph"]
        if not isinstance(ssg, dict):
            raise VSGValidationError("static_scene_graph must be an object")
        if "nodes" not in ssg or not isinstance(ssg["nodes"], list):
            raise VSGValidationError("static_scene_graph must have nodes array")
        if "edges" not in ssg or not isinstance(ssg["edges"], list):
            raise VSGValidationError("static_scene_graph must have edges array")

        # Validate dynamic_scene_graph
        dsg = vsg_data["dynamic_scene_graph"]
        if not isinstance(dsg, dict):
            raise VSGValidationError("dynamic_scene_graph must be an object")
        if "nodes" not in dsg or not isinstance(dsg["nodes"], list):
            raise VSGValidationError("dynamic_scene_graph must have nodes array")
        if "edges" not in dsg or not isinstance(dsg["edges"], list):
            raise VSGValidationError("dynamic_scene_graph must have edges array")

        # Validate foreground_background_relations
        fbr = vsg_data["foreground_background_relations"]
        if not isinstance(fbr, dict):
            raise VSGValidationError("foreground_background_relations must be an object")
        if "edges" not in fbr or not isinstance(fbr["edges"], list):
            raise VSGValidationError("foreground_background_relations must have edges array")

        logger.info("VSG validation passed")

    async def save_vsg_file(self, video: Video, vsg_data: dict[str, Any]) -> str:
        """
        Save VSG file to disk in the imports directory.

        Args:
            video: Video database object
            vsg_data: VSG data to save

        Returns:
            Path to saved file
        """
        # Get sample directory from existing vsg_path
        original_vsg_path = Path(video.vsg_path)
        sample_dir = original_vsg_path.parent.parent  # Go up from outputs/

        # Create imports directory
        imports_dir = sample_dir / "outputs" / "imports"
        imports_dir.mkdir(parents=True, exist_ok=True)

        # Generate filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"video_scene_graph_{video.video_id}_{timestamp}.json"
        file_path = imports_dir / filename

        # Write the file
        with open(file_path, "w") as f:
            json.dump(vsg_data, f, indent=2)

        logger.info(f"Saved imported VSG to: {file_path}")
        return str(file_path)

    async def clear_revisions(self, video_id: int) -> dict[str, int]:
        """
        Delete all revisions for a video.

        Args:
            video_id: Database video ID (not string video_id)

        Returns:
            Dict with counts of deleted revisions by type
        """
        counts = {
            "edge_revisions": 0,
            "metadata_revisions": 0,
            "node_revisions": 0,
        }

        # Delete edge revisions
        result = await self.session.execute(
            delete(EdgeRevision).where(EdgeRevision.video_id == video_id)
        )
        counts["edge_revisions"] = result.rowcount

        # Delete metadata revisions
        result = await self.session.execute(
            delete(MetadataRevision).where(MetadataRevision.video_id == video_id)
        )
        counts["metadata_revisions"] = result.rowcount

        # Delete node revisions
        result = await self.session.execute(
            delete(NodeRevision).where(NodeRevision.video_id == video_id)
        )
        counts["node_revisions"] = result.rowcount

        logger.info(f"Cleared revisions for video {video_id}: {counts}")
        return counts

    async def import_vsg(
        self,
        video_id: str,
        vsg_data: dict[str, Any],
        user_id: int,
        clear_revisions: bool = True,
    ) -> dict[str, Any]:
        """
        Import a VSG file for a video.

        Args:
            video_id: String video ID
            vsg_data: Parsed VSG JSON data
            user_id: ID of user performing the import
            clear_revisions: Whether to clear existing revisions

        Returns:
            Dict with import results
        """
        # Get video from database
        result = await self.session.execute(
            select(Video).where(Video.video_id == video_id)
        )
        video = result.scalar_one_or_none()

        if video is None:
            raise ValueError(f"Video not found: {video_id}")

        # Validate VSG structure
        self.validate_vsg(vsg_data)

        # Save the file
        new_vsg_path = await self.save_vsg_file(video, vsg_data)

        # Clear existing revisions if requested
        revisions_cleared = {"edge_revisions": 0, "metadata_revisions": 0, "node_revisions": 0}
        if clear_revisions:
            revisions_cleared = await self.clear_revisions(video.id)

        # Update video's vsg_path
        video.vsg_path = new_vsg_path
        video.updated_at = datetime.utcnow()

        # Add import metadata to track who imported
        logger.info(
            f"User {user_id} imported VSG for video {video_id}: {new_vsg_path}"
        )

        return {
            "success": True,
            "video_id": video_id,
            "message": "VSG imported successfully",
            "revisions_cleared": sum(revisions_cleared.values()),
            "revisions_cleared_detail": revisions_cleared,
            "new_vsg_path": new_vsg_path,
            "imported_at": datetime.now().isoformat(),
        }
