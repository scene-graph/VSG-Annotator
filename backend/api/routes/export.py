"""Export routes for exporting annotated VSG files."""

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.vsg_loader import VSGLoader
from backend.models.database import Video, get_db
from backend.models.schemas import ExportRequest, ExportResponse
from backend.services.export_service import ExportService

router = APIRouter(prefix="/export", tags=["export"])


@router.post("/{video_id}", response_model=ExportResponse)
async def export_vsg(
    video_id: str,
    include_rejected: bool = Query(
        False, description="Include rejected edges (marked)"
    ),
    apply_modifications: bool = Query(
        True, description="Apply modifications to edges"
    ),
    user_id: Optional[int] = Query(
        None, description="Filter revisions by specific user"
    ),
    db: AsyncSession = Depends(get_db),
):
    """Export the annotated VSG for a video."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    loader = VSGLoader(video.vsg_path)
    service = ExportService(db, loader)

    vsg = await service.export(
        include_rejected=include_rejected,
        apply_modifications=apply_modifications,
        user_id=user_id,
    )

    revision_summary = await service.get_revision_summary()

    return ExportResponse(
        video_id=video_id,
        exported_at=datetime.now(),
        vsg=vsg,
        revision_summary=revision_summary,
    )


@router.get("/{video_id}/download")
async def download_vsg(
    video_id: str,
    include_rejected: bool = Query(False),
    apply_modifications: bool = Query(True),
    user_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Download the annotated VSG as a JSON file."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    loader = VSGLoader(video.vsg_path)
    service = ExportService(db, loader)

    vsg = await service.export(
        include_rejected=include_rejected,
        apply_modifications=apply_modifications,
        user_id=user_id,
    )

    # Format filename with timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"video_scene_graph_{video_id}_{timestamp}.json"

    return JSONResponse(
        content=vsg,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Type": "application/json",
        },
    )


@router.get("/{video_id}/summary")
async def get_export_summary(
    video_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a summary of revisions for export preview."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    loader = VSGLoader(video.vsg_path)
    service = ExportService(db, loader)

    summary = await service.get_revision_summary()
    original_summary = loader.get_summary()

    return {
        "video_id": video_id,
        "original": original_summary,
        "revisions": summary,
    }
