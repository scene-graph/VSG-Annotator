"""Annotation routes for Accept/Reject/Modify/Create operations."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.vsg_loader import VSGLoader
from backend.models.database import Video, get_db
from backend.models.schemas import (
    AnnotationAccept,
    AnnotationCreate,
    AnnotationModify,
    AnnotationReject,
    RevisionResponse,
)
from backend.services.annotation_service import AnnotationService

router = APIRouter(prefix="/annotations", tags=["annotations"])


@router.post("/accept")
async def accept_edge(
    annotation: AnnotationAccept,
    db: AsyncSession = Depends(get_db),
):
    """Accept an edge as valid."""
    result = await db.execute(
        select(Video).where(Video.video_id == annotation.video_id)
    )
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(
            status_code=404, detail=f"Video not found: {annotation.video_id}"
        )

    loader = VSGLoader(video.vsg_path)
    service = AnnotationService(db, loader)

    try:
        result = await service.accept_edge(annotation)
        await db.commit()
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/reject")
async def reject_edge(
    annotation: AnnotationReject,
    db: AsyncSession = Depends(get_db),
):
    """Reject an edge as invalid."""
    result = await db.execute(
        select(Video).where(Video.video_id == annotation.video_id)
    )
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(
            status_code=404, detail=f"Video not found: {annotation.video_id}"
        )

    loader = VSGLoader(video.vsg_path)
    service = AnnotationService(db, loader)

    try:
        result = await service.reject_edge(annotation)
        await db.commit()
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/modify")
async def modify_edge(
    annotation: AnnotationModify,
    db: AsyncSession = Depends(get_db),
):
    """Modify an existing edge."""
    result = await db.execute(
        select(Video).where(Video.video_id == annotation.video_id)
    )
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(
            status_code=404, detail=f"Video not found: {annotation.video_id}"
        )

    loader = VSGLoader(video.vsg_path)
    service = AnnotationService(db, loader)

    try:
        result = await service.modify_edge(annotation)
        await db.commit()
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/create")
async def create_edge(
    annotation: AnnotationCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new edge."""
    result = await db.execute(
        select(Video).where(Video.video_id == annotation.video_id)
    )
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(
            status_code=404, detail=f"Video not found: {annotation.video_id}"
        )

    loader = VSGLoader(video.vsg_path)
    service = AnnotationService(db, loader)

    try:
        result = await service.create_edge(annotation)
        await db.commit()
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/history/{video_id}/{edge_id}", response_model=list[RevisionResponse])
async def get_revision_history(
    video_id: str,
    edge_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get revision history for an edge."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    loader = VSGLoader(video.vsg_path)
    service = AnnotationService(db, loader)

    return await service.get_edge_history(video_id, edge_id)
