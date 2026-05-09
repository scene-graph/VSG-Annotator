"""Routes for Gemini-driven edge re-extraction jobs."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.database import ReextractJob, Video, get_db
from backend.services.reextract_service import ReextractService

router = APIRouter(prefix="/videos/{video_id}/reextract", tags=["reextract"])


def _job_to_dict(job: ReextractJob) -> dict:
    return {
        "id": job.id,
        "edge_id": job.edge_id,
        "prev_edge_type": job.prev_edge_type,
        "new_edge_type": job.new_edge_type,
        "status": job.status,
        "result_predicate": job.result_predicate,
        "result_attributes": job.result_attributes,
        "result_time_periods": job.result_time_periods,
        "error": job.error,
        "applied_revision_id": job.applied_revision_id,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


@router.get("/jobs")
async def list_jobs(
    video_id: str,
    edge_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """List reextraction jobs for a video (optionally filtered by edge / status).

    Returned newest-first so the UI can pick up the latest job per edge.
    """
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()
    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    query = select(ReextractJob).where(ReextractJob.video_id == video.id)
    if edge_id:
        query = query.where(ReextractJob.edge_id == edge_id)
    if status:
        query = query.where(ReextractJob.status == status)
    query = query.order_by(ReextractJob.created_at.desc()).limit(limit)

    rows = await db.execute(query)
    return [_job_to_dict(j) for j in rows.scalars().all()]


@router.post("/edge/{edge_id}")
async def trigger_manual_reextract(
    video_id: str,
    edge_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Manually enqueue a reextraction for ``edge_id``.

    Used when a prior job failed or when the user wants to re-run with
    the current effective edge state (e.g. after editing members). The
    job is enqueued with prev_type==new_type since no auto-transition is
    occurring here; the worker still runs the model call.
    """
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()
    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    from backend.core.vsg_loader import VSGLoader
    from backend.services.annotation_service import AnnotationService

    try:
        loader = VSGLoader(video.vsg_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"VSG load failed: {exc}")

    service = AnnotationService(db, loader, video_id=video_id)
    edges = await service.get_edges_with_revisions()
    edge = next((e for e in edges if e.edge_id == edge_id), None)
    if edge is None:
        raise HTTPException(status_code=404, detail=f"Edge not found: {edge_id}")

    reextract = ReextractService(db, video.id, video_id)
    ids = await reextract.enqueue_transitions([(edge_id, edge.edge_type, edge.edge_type)])
    ReextractService.spawn_background(ids)
    return {"enqueued_job_ids": ids}
