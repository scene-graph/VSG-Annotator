"""Video routes for listing videos and serving frames."""

import io
import os
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.core.vsg_loader import VSGLoader, discover_samples
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

def _auto_link_variant_frames(pvsg_mini_path: Path) -> None:
    """Auto-create frames/masks symlinks for variant samples.

    A variant sample has an outputs/video_scene_graph*.json but no frames/ dir.
    We look for a base video that shares the prefix (e.g. epic_kitchen_P04_32
    is the base for epic_kitchen_P04_32_v2_pro) and symlink its frames/masks.
    """
    if not pvsg_mini_path.exists():
        return

    # Collect dirs that already have frames (potential bases)
    bases: dict[str, Path] = {}
    variants_needing_frames: list[Path] = []

    for d in pvsg_mini_path.iterdir():
        if not d.is_dir() or d.name.startswith("."):
            continue
        has_vsg = (d / "outputs" / "video_scene_graph.json").exists() or list(
            (d / "outputs").glob("video_scene_graph_*.json")
        ) if (d / "outputs").exists() else False
        if not has_vsg:
            continue
        if (d / "frames").exists():
            bases[d.name] = d
        else:
            variants_needing_frames.append(d)

    # Optionally pull base frames from auxiliary roots configured via env.
    # AUX_FRAME_ROOTS is a colon-separated list of directories; each child
    # directory that contains a `frames/` subfolder is registered as a base.
    aux_roots = [
        Path(p) for p in os.environ.get("AUX_FRAME_ROOTS", "").split(":") if p
    ]
    for sd in aux_roots:
        if sd.exists():
            for d in sd.iterdir():
                if d.is_dir() and (d / "frames").exists() and d.name not in bases:
                    bases[d.name] = d

    for variant_dir in variants_needing_frames:
        name = variant_dir.name
        # Find the longest base name that is a prefix of this variant
        best_base = None
        best_len = 0
        for base_name, base_dir in bases.items():
            if name.startswith(base_name) and len(base_name) > best_len:
                best_base = base_dir
                best_len = len(base_name)

        if best_base is not None:
            frames_src = best_base / "frames"
            if frames_src.exists():
                (variant_dir / "frames").symlink_to(frames_src)
            masks_src = best_base / "masks"
            if masks_src.exists() and not (variant_dir / "masks").exists():
                (variant_dir / "masks").symlink_to(masks_src)


router = APIRouter(prefix="/videos", tags=["videos"])


@router.post("/reload")
async def reload_datasource(db: AsyncSession = Depends(get_db)):
    """Scan the data source directory and import any new videos.

    Auto-creates frames/masks symlinks for variant samples (e.g.
    epic_kitchen_P04_32_v2_pro) that share frames with a base video.
    """
    import logging
    logger = logging.getLogger(__name__)

    # Auto-link frames for variant directories missing a frames/ dir
    _auto_link_variant_frames(settings.pvsg_mini_path)

    samples = discover_samples(settings.pvsg_mini_path)
    imported = []
    skipped = []

    for sample in samples:
        # Check if already in DB
        result = await db.execute(
            select(Video).where(Video.video_id == sample["video_id"])
        )
        existing = result.scalar_one_or_none()
        if existing is not None:
            skipped.append(sample["video_id"])
            continue

        # Load VSG to get metadata
        try:
            loader = VSGLoader(sample["vsg_path"])
            metadata = loader.metadata
            resolution = loader.resolution
        except Exception as e:
            logger.warning("Failed to load VSG for %s: %s", sample["video_id"], e)
            continue

        video = Video(
            video_id=sample["video_id"],
            vsg_path=sample["vsg_path"],
            frames_path=sample["frames_path"],
            masks_path=sample.get("masks_path"),
            dataset=sample.get("source_tag") or metadata.get("dataset"),
            status="pending",
            total_frames=metadata.get("total_frames"),
            fps=metadata.get("fps"),
            resolution_width=resolution.get("width"),
            resolution_height=resolution.get("height"),
        )
        db.add(video)
        imported.append(sample["video_id"])

    if imported:
        await db.commit()

    return {
        "imported": imported,
        "skipped": skipped,
        "imported_count": len(imported),
        "skipped_count": len(skipped),
        "total_on_disk": len(samples),
    }


@router.patch("/{video_id}/status")
async def update_video_status(
    video_id: str,
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    """Update video status."""
    status = payload.get("status")
    if status not in {"pending", "in_progress", "completed"}:
        raise HTTPException(status_code=400, detail="Invalid status value")

    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()
    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    video.status = status
    db.add(video)
    await db.commit()
    await db.refresh(video)
    return {"video_id": video.video_id, "status": video.status}


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
        original_is_static = node.is_static
        latest_rev = await tracker.get_latest_node_revision(video_id, node.node_id)
        if latest_rev:
            if latest_rev.new_is_static is not None:
                node.is_static = latest_rev.new_is_static
            if latest_rev.new_category is not None:
                node.category = latest_rev.new_category
            if latest_rev.new_attributes:
                visual = latest_rev.new_attributes.get("visual")
                physical = latest_rev.new_attributes.get("physical")
                if visual:
                    node.attributes.visual = NodeVisualAttributes(**visual)
                if physical:
                    node.attributes.physical = NodePhysicalAttributes(**physical)
                if physical and physical.get("age") is not None:
                    node.attributes.physical.age = physical.get("age")
            node.has_revision = True
            node.revision_action = latest_rev.action
        else:
            node.has_revision = False
            node.revision_action = None
        if node.is_static != original_is_static:
            node.original_is_static = original_is_static

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

    from backend.core.revision_tracker import RevisionTracker
    tracker = RevisionTracker(db)
    original_is_static = node.is_static
    latest_rev = await tracker.get_latest_node_revision(video_id, node.node_id)
    if latest_rev:
        if latest_rev.new_is_static is not None:
            node.is_static = latest_rev.new_is_static
        if latest_rev.new_category is not None:
            node.category = latest_rev.new_category
        if latest_rev.new_attributes:
            visual = latest_rev.new_attributes.get("visual")
            physical = latest_rev.new_attributes.get("physical")
            if visual:
                node.attributes.visual = NodeVisualAttributes(**visual)
            if physical:
                node.attributes.physical = NodePhysicalAttributes(**physical)
            if physical and physical.get("age") is not None:
                node.attributes.physical.age = physical.get("age")
        node.has_revision = True
        node.revision_action = latest_rev.action
    else:
        node.has_revision = False
        node.revision_action = None
    if node.is_static != original_is_static:
        node.original_is_static = original_is_static

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
