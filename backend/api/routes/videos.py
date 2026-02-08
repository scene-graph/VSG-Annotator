"""Video routes for listing videos and serving frames."""

import io
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.core.vsg_loader import VSGLoader
from backend.models.database import MetadataRevision, Video, get_db
from backend.models.schemas import (
    NodePhysicalAttributes,
    NodeResponse,
    NodeVisualAttributes,
    VideoDetail,
    VideoSummary,
)
from backend.services.video_service import VideoService, get_frame_for_video, get_disk_frame_cache


def normalize_scene_info(raw_data: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Normalize scene_info to the new schema format.

    Handles backward compatibility:
    - Converts single string 'category' to array
    - Adds default values for new fields
    - Removes deprecated fields
    """
    if raw_data is None:
        return None

    normalized = {}

    # Handle category: convert string to array if needed
    category = raw_data.get("category")
    if category is None:
        normalized["category"] = ["unknown"]
    elif isinstance(category, str):
        normalized["category"] = [category]
    elif isinstance(category, list):
        normalized["category"] = category
    else:
        normalized["category"] = ["unknown"]

    # Handle transition_types (new field)
    normalized["transition_types"] = raw_data.get("transition_types", ["unknown"])
    if not isinstance(normalized["transition_types"], list):
        normalized["transition_types"] = ["unknown"]

    # Handle scene_change_relations (new field)
    normalized["scene_change_relations"] = raw_data.get("scene_change_relations", ["unknown"])
    if not isinstance(normalized["scene_change_relations"], list):
        normalized["scene_change_relations"] = ["unknown"]

    # Keep confidence
    normalized["confidence"] = raw_data.get("confidence", 0.5)

    return normalized


def normalize_camera_motion(raw_data: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Normalize camera_motion to the new schema format.

    Handles backward compatibility:
    - Moves steadiness/intensity from attributes to primary_motion
    - Removes deprecated fields (has_motion, motion_clarity, purpose_of_movement)
    """
    if raw_data is None:
        return None

    normalized = {}

    # Build primary_motion
    primary_motion_raw = raw_data.get("primary_motion", {})
    attributes_raw = raw_data.get("attributes", {})

    primary_motion = {
        "type": primary_motion_raw.get("type", "static"),
        "direction": primary_motion_raw.get("direction", "none"),
        # First check primary_motion for steadiness/intensity (new schema)
        # Then fall back to attributes (old schema)
        "steadiness": primary_motion_raw.get(
            "steadiness",
            attributes_raw.get("steadiness", "stable")
        ),
        "intensity": primary_motion_raw.get(
            "intensity",
            attributes_raw.get("intensity", "minimal")
        ),
    }

    normalized["primary_motion"] = primary_motion
    normalized["confidence"] = raw_data.get("confidence", 0.5)
    normalized["description"] = raw_data.get("description")

    return normalized

router = APIRouter(prefix="/videos", tags=["videos"])


@router.get("", response_model=list[VideoSummary])
async def list_videos(
    db: AsyncSession = Depends(get_db),
    status: Optional[str] = Query(None, description="Filter by status"),
    dataset: Optional[str] = Query(None, description="Filter by dataset"),
):
    """List all imported videos."""
    query = select(Video)

    if status is not None:
        query = query.where(Video.status == status)
    if dataset is not None:
        query = query.where(Video.dataset == dataset)

    result = await db.execute(query)
    videos = result.scalars().all()

    summaries = []
    for video in videos:
        # Load VSG to get counts - handle missing/corrupt files gracefully
        node_count = 0
        edge_count = 0
        try:
            loader = VSGLoader(video.vsg_path)
            node_count = len(loader.get_static_nodes()) + len(loader.get_dynamic_nodes())
            edge_count = (
                len(loader.get_static_edges())
                + len(loader.get_dynamic_edges())
                + len(loader.get_fg_bg_edges())
            )
        except Exception:
            # VSG file missing or corrupt - use default counts
            pass

        summaries.append(
            VideoSummary(
                id=video.id,
                video_id=video.video_id,
                dataset=video.dataset,
                status=video.status,
                total_frames=video.total_frames,
                fps=video.fps,
                resolution={
                    "width": video.resolution_width,
                    "height": video.resolution_height,
                }
                if video.resolution_width
                else None,
                node_count=node_count,
                edge_count=edge_count,
            )
        )

    return summaries


@router.get("/{video_id}", response_model=VideoDetail)
async def get_video(video_id: str, db: AsyncSession = Depends(get_db)):
    """Get detailed information about a video."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    # Load VSG - handle missing/corrupt files gracefully
    try:
        loader = VSGLoader(video.vsg_path)
        summary = loader.get_summary()
    except Exception:
        # VSG file missing or corrupt - use default counts
        summary = {
            "static_node_count": 0,
            "dynamic_node_count": 0,
            "static_edge_count": 0,
            "dynamic_edge_count": 0,
            "fg_bg_edge_count": 0,
        }

    return VideoDetail(
        id=video.id,
        video_id=video.video_id,
        dataset=video.dataset,
        status=video.status,
        total_frames=video.total_frames,
        fps=video.fps,
        resolution={
            "width": video.resolution_width,
            "height": video.resolution_height,
        }
        if video.resolution_width
        else None,
        vsg_path=video.vsg_path,
        frames_path=video.frames_path,
        masks_path=video.masks_path,
        node_count=summary["static_node_count"] + summary["dynamic_node_count"],
        edge_count=(
            summary["static_edge_count"]
            + summary["dynamic_edge_count"]
            + summary["fg_bg_edge_count"]
        ),
        static_node_count=summary["static_node_count"],
        dynamic_node_count=summary["dynamic_node_count"],
        static_edge_count=summary["static_edge_count"],
        dynamic_edge_count=summary["dynamic_edge_count"],
        fg_bg_edge_count=summary["fg_bg_edge_count"],
    )


@router.get("/{video_id}/frame/{frame_idx}")
async def get_frame(
    video_id: str,
    frame_idx: int,
    db: AsyncSession = Depends(get_db),
):
    """Get a specific frame image (served from disk cache if enabled)."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    # Use caching function (disk cache -> memory cache -> source)
    frame_path = get_frame_for_video(video_id, video.frames_path, frame_idx)

    if frame_path is None or not frame_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Frame {frame_idx} not found for video {video_id}",
        )

    # Determine media type from extension
    media_type = "image/png" if frame_path.suffix.lower() == ".png" else "image/jpeg"

    return FileResponse(
        frame_path,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/{video_id}/frame/{frame_idx}/jpeg")
async def get_frame_jpeg(
    video_id: str,
    frame_idx: int,
    quality: int = Query(80, ge=10, le=100, description="JPEG quality (10-100)"),
    db: AsyncSession = Depends(get_db),
):
    """Get a specific frame as JPEG with configurable quality for optimized playback.

    Converts PNG frames to JPEG on-the-fly to reduce bandwidth (~94% smaller).
    """
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    # Use caching function (disk cache -> memory cache -> source)
    frame_path = get_frame_for_video(video_id, video.frames_path, frame_idx)

    if frame_path is None or not frame_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Frame {frame_idx} not found for video {video_id}",
        )

    # Convert to JPEG with specified quality
    with Image.open(frame_path) as img:
        # Convert RGBA or palette images to RGB for JPEG
        if img.mode in ('RGBA', 'P'):
            img = img.convert('RGB')

        buffer = io.BytesIO()
        img.save(buffer, format='JPEG', quality=quality, optimize=True)
        buffer.seek(0)

        return Response(
            content=buffer.getvalue(),
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=3600"},
        )


@router.get("/{video_id}/nodes", response_model=list[NodeResponse])
async def get_nodes(
    video_id: str,
    db: AsyncSession = Depends(get_db),
    is_static: Optional[bool] = Query(None, description="Filter by static/dynamic"),
    frame: Optional[int] = Query(None, description="Filter by frame (nodes visible at frame)"),
):
    """Get all nodes for a video with their tracking data."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    try:
        loader = VSGLoader(video.vsg_path)
        nodes = list(loader.get_all_nodes().values())
    except Exception:
        # VSG file missing or corrupt - return empty list
        return []

    # Apply latest node revisions (attributes + static/dynamic)
    from backend.core.revision_tracker import RevisionTracker
    tracker = RevisionTracker(db)
    for node in nodes:
        latest_rev = await tracker.get_latest_node_revision(video_id, node.node_id)
        if latest_rev:
            if latest_rev.new_is_static is not None:
                node.is_static = latest_rev.new_is_static
            if latest_rev.new_attributes:
                visual = latest_rev.new_attributes.get("visual")
                physical = latest_rev.new_attributes.get("physical")
                if visual:
                    node.attributes.visual = NodeVisualAttributes(**visual)
                if physical:
                    node.attributes.physical = NodePhysicalAttributes(**physical)

    # Filter by static/dynamic
    if is_static is not None:
        nodes = [n for n in nodes if n.is_static == is_static]

    # Filter by frame
    if frame is not None:
        frame_str = str(frame)
        nodes = [n for n in nodes if frame_str in n.bboxes_by_frame]

    return nodes


@router.get("/{video_id}/nodes/{node_id}", response_model=NodeResponse)
async def get_node(
    video_id: str,
    node_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a specific node by ID."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    try:
        loader = VSGLoader(video.vsg_path)
        node = loader.get_node_by_id(node_id)
    except Exception:
        # VSG file missing or corrupt
        raise HTTPException(status_code=404, detail=f"VSG file unavailable for video: {video_id}")

    if node is None:
        raise HTTPException(status_code=404, detail=f"Node not found: {node_id}")

    return node


@router.get("/{video_id}/metadata")
async def get_metadata(
    video_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get VSG metadata for a video."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    try:
        loader = VSGLoader(video.vsg_path)
        return loader.metadata
    except Exception:
        # VSG file missing or corrupt - return None
        return None


@router.get("/{video_id}/scene-info")
async def get_scene_info(
    video_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get scene info for a video (with any human revisions applied)."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    # Check for latest revision first
    revision_result = await db.execute(
        select(MetadataRevision)
        .where(MetadataRevision.video_id == video.id)
        .where(MetadataRevision.metadata_type == "scene_info")
        .order_by(MetadataRevision.created_at.desc())
        .limit(1)
    )
    revision = revision_result.scalar_one_or_none()

    if revision:
        return revision.new_value  # Return human-revised data (already normalized)

    # Fall back to original VSG data with normalization
    try:
        loader = VSGLoader(video.vsg_path)
        return normalize_scene_info(loader.scene_info)
    except Exception:
        # VSG file missing or corrupt - return None
        return None


@router.get("/{video_id}/camera-motion")
async def get_camera_motion(
    video_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get camera motion for a video (with any human revisions applied)."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    # Check for latest revision first
    revision_result = await db.execute(
        select(MetadataRevision)
        .where(MetadataRevision.video_id == video.id)
        .where(MetadataRevision.metadata_type == "camera_motion")
        .order_by(MetadataRevision.created_at.desc())
        .limit(1)
    )
    revision = revision_result.scalar_one_or_none()

    if revision:
        return revision.new_value  # Return human-revised data (already normalized)

    # Fall back to original VSG data with normalization
    try:
        loader = VSGLoader(video.vsg_path)
        return normalize_camera_motion(loader.camera_motion)
    except Exception:
        # VSG file missing or corrupt - return None
        return None


@router.get("/cache/status")
async def get_cache_status():
    """Get frame cache status information."""
    cache = get_disk_frame_cache()
    if cache is None:
        return {"enabled": False, "message": "Disk frame cache is disabled"}

    status = cache.get_status()
    status["enabled"] = True
    return status
