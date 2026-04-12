"""Mask routes for serving panoptic mask data."""

import io
import json
import threading

import numpy as np
from PIL import Image
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.vsg_loader import VSGLoader
from backend.models.database import Video, get_db
from backend.services.mask_service import PanopticMaskService

router = APIRouter(prefix="/videos/{video_id}/masks", tags=["masks"])


def _get_mask_service(video: Video) -> PanopticMaskService:
    """Create a PanopticMaskService from the video's masks_path."""
    if not video.masks_path:
        raise HTTPException(status_code=404, detail="No masks path configured for this video")
    return PanopticMaskService(video.masks_path)


@router.get("/metadata")
async def get_mask_metadata(
    video_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get mask metadata: object list with colors, categories, and frame count."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()
    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    svc = _get_mask_service(video)
    if not svc.has_masks():
        return {"has_masks": False, "objects": [], "total_frames": 0, "palette": {}}

    # Load VSG nodes for cross-referencing
    try:
        loader = VSGLoader(video.vsg_path)
        nodes = loader.get_all_nodes()
        vsg_nodes = [
            {
                "object_id": n.object_id,
                "node_id": n.node_id,
                "category": n.category,
                "is_static": n.is_static,
            }
            for n in nodes.values()
        ]
    except Exception:
        vsg_nodes = []

    metadata = svc.get_metadata(vsg_nodes)

    # For composite format, the frame endpoint converts 16-bit → paletted 8-bit
    # with sequential IDs (1, 2, 3...). Remap the metadata to match.
    if metadata.get("mask_format") == "composite":
        objects = metadata.get("objects", [])
        remapped_palette: dict[str, str] = {}
        for i, obj in enumerate(objects, start=1):
            obj["object_id"] = i  # sequential int matching frame endpoint
            remapped_palette[str(i)] = obj["color_hex"]
        metadata["palette"] = remapped_palette
        metadata["mask_format"] = "palette"  # frontend can treat as palette now

    # Pre-warm cache for panoptic formats in background
    if svc.format in ("step_rgb", "waymo"):
        def _warm():
            mask_files = sorted(svc.masks_path.glob("*.png"))
            for mf in mask_files:
                svc.convert_panoptic_to_paletted(mf)
        threading.Thread(target=_warm, daemon=True).start()

    return metadata


@router.get("/frame/{frame_idx}")
async def get_mask_frame(
    video_id: str,
    frame_idx: int,
    db: AsyncSession = Depends(get_db),
):
    """Serve the raw panoptic mask PNG for a frame.

    The PNG is paletted (mode P) — pixel values are object_ids.
    The embedded palette provides RGB colors for visualization.
    Responses are cacheable (masks don't change during viewing).
    """
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()
    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    svc = _get_mask_service(video)
    mask_path = svc.get_mask_path(frame_idx)
    if mask_path is None:
        raise HTTPException(status_code=404, detail=f"Mask not found for frame {frame_idx}")

    # For palette format, serve the raw file (browser handles it)
    if svc.format == "palette":
        return FileResponse(
            str(mask_path),
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    # For STEP RGB or Waymo panoptic, convert to paletted 8-bit PNG
    if svc.format in ("step_rgb", "waymo"):
        png_bytes = svc.convert_panoptic_to_paletted(mask_path)
        return Response(
            content=png_bytes,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    # For composite (16-bit) format, convert to paletted 8-bit PNG with
    # sequential IDs that the browser can decode correctly.
    # Map each unique composite pixel value → sequential uint8 ID,
    # and build a palette from metadata colors.
    img = Image.open(mask_path)
    arr = np.array(img)
    unique_vals = sorted(int(v) for v in np.unique(arr) if v != 0)

    # Load colors from metadata
    meta = svc._load_composite_metadata()
    meta_objects = meta.get("objects", [])
    # Build composite pixel_val → metadata object mapping
    from backend.services.mask_service import _CITYSCAPES_CATEGORIES, _CITYSCAPES_THING_IDS
    val_to_color: dict[int, tuple[int, int, int]] = {}
    val_to_obj_id: dict[int, str] = {}
    for pv in unique_vals:
        cat_id, inst_id = pv // 1000, pv % 1000
        cat_name = _CITYSCAPES_CATEGORIES.get(cat_id, f"cat_{cat_id}")
        is_thing = cat_id in _CITYSCAPES_THING_IDS
        obj_id = f"{cat_name}_{inst_id}" if is_thing else f"stuff_{cat_name}"
        val_to_obj_id[pv] = obj_id
        # Find color from metadata
        for mo in meta_objects:
            if mo["object_id"] == obj_id:
                h = mo["color_hex"].lstrip("#")
                val_to_color[pv] = (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
                break
        else:
            # Fallback: also try matching by general object_id pattern
            # (vipseg uses "stuff_14", not cityscapes encoding)
            for mo in meta_objects:
                # Vipseg composite pixel values may be simple sequential IDs
                # Try direct match with pixel value
                pass
            val_to_color.setdefault(pv, (128, 128, 128))

    # If metadata uses non-cityscapes object_ids (e.g. vipseg "stuff_14"),
    # match by index order: pixel values 1,2,3... → metadata objects[0,1,2...]
    if not any(v in val_to_color for v in unique_vals if val_to_color.get(v) != (128, 128, 128)):
        # All fell back to gray — try index-based matching
        for i, pv in enumerate(unique_vals):
            if i < len(meta_objects):
                h = meta_objects[i]["color_hex"].lstrip("#")
                val_to_color[pv] = (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

    # Build a remap: composite pixel_val → sequential uint8 (1, 2, 3...)
    remap = {0: 0}
    for i, pv in enumerate(unique_vals, start=1):
        remap[pv] = min(i, 255)

    # Remap array
    out = np.zeros_like(arr, dtype=np.uint8)
    for pv, new_id in remap.items():
        out[arr == pv] = new_id

    # Build palette (768 bytes = 256 * RGB)
    palette = [0, 0, 0] * 256  # all black
    for pv, new_id in remap.items():
        if pv == 0:
            continue
        r, g, b = val_to_color.get(pv, (128, 128, 128))
        palette[new_id * 3] = r
        palette[new_id * 3 + 1] = g
        palette[new_id * 3 + 2] = b

    out_img = Image.fromarray(out, mode="P")
    out_img.putpalette(palette)

    buf = io.BytesIO()
    out_img.save(buf, format="PNG")
    return Response(
        content=buf.getvalue(),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/objects-at-frame/{frame_idx}")
async def get_objects_at_frame(
    video_id: str,
    frame_idx: int,
    db: AsyncSession = Depends(get_db),
):
    """Get objects present at a specific frame with bounding boxes and area."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()
    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    svc = _get_mask_service(video)
    return svc.get_objects_at_frame(frame_idx)
