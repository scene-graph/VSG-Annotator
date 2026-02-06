"""Edge routes for listing and filtering edges."""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.edge_manager import EdgeManager
from backend.core.schema_validator import SchemaValidator
from backend.core.vsg_loader import VSGLoader
from backend.models.database import Video, get_db
from backend.models.schemas import EdgeFilterParams, EdgeResponse
from backend.services.annotation_service import AnnotationService

router = APIRouter(prefix="/videos/{video_id}/edges", tags=["edges"])


@router.get("", response_model=list[EdgeResponse])
async def get_edges(
    video_id: str,
    db: AsyncSession = Depends(get_db),
    edge_type: Optional[Literal["static", "dynamic", "fg_bg"]] = Query(
        None, description="Filter by edge type"
    ),
    min_confidence: Optional[float] = Query(
        None, ge=0, le=1, description="Minimum confidence"
    ),
    max_confidence: Optional[float] = Query(
        None, ge=0, le=1, description="Maximum confidence"
    ),
    validated: Optional[bool] = Query(None, description="Filter by validation status"),
    extraction_round: Optional[int] = Query(
        None, ge=0, le=1, description="Filter by extraction round (0=PVSG GT, 1=GPT)"
    ),
    predicate: Optional[str] = Query(None, description="Filter by predicate"),
    frame: Optional[int] = Query(
        None, description="Filter edges active at this frame"
    ),
    include_revisions: bool = Query(
        True, description="Include revision status on edges"
    ),
):
    """Get all edges for a video with optional filters."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    loader = VSGLoader(video.vsg_path)

    if include_revisions:
        service = AnnotationService(db, loader, video_id=video_id)
        edges = await service.get_edges_with_revisions()
    else:
        edges = loader.get_all_edges()

    # Apply filters
    params = EdgeFilterParams(
        edge_type=edge_type,
        min_confidence=min_confidence,
        max_confidence=max_confidence,
        validated=validated,
        extraction_round=extraction_round,
        predicate=predicate,
        frame=frame,
    )

    manager = EdgeManager(edges)
    return manager.filter(params)


@router.get("/stats")
async def get_edge_stats(
    video_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get edge statistics for a video."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    loader = VSGLoader(video.vsg_path)
    edges = loader.get_all_edges()

    manager = EdgeManager(edges)
    return manager.get_stats()


@router.get("/predicates")
async def get_predicates(
    video_id: str,
    edge_type: Optional[Literal["static", "dynamic", "fg_bg"]] = Query(
        None, description="Get valid predicates for edge type"
    ),
    db: AsyncSession = Depends(get_db),
):
    """Get valid predicates, optionally filtered by edge type."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    if edge_type is not None:
        return {"predicates": SchemaValidator.get_valid_predicates(edge_type)}

    # Return all predicates organized by type
    return {
        "static": SchemaValidator.get_valid_predicates("static"),
        "dynamic": SchemaValidator.get_valid_predicates("dynamic"),
        "fg_bg": SchemaValidator.get_valid_predicates("fg_bg"),
    }


@router.get("/motion-values")
async def get_motion_values():
    """Get valid motion attribute values."""
    return SchemaValidator.get_valid_motion_values()


@router.get("/{edge_id}", response_model=EdgeResponse)
async def get_edge(
    video_id: str,
    edge_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a specific edge by ID."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    loader = VSGLoader(video.vsg_path)
    service = AnnotationService(db, loader, video_id=video_id)

    edge = await service.get_edge_with_revisions(edge_id)

    if edge is None:
        raise HTTPException(status_code=404, detail=f"Edge not found: {edge_id}")

    return edge


@router.get("/{edge_id}/history")
async def get_edge_history(
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
    service = AnnotationService(db, loader, video_id=video_id)

    return await service.get_edge_history(video_id, edge_id)
