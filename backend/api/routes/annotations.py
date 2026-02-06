"""Annotation routes for Accept/Reject/Modify/Create operations."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.vsg_loader import VSGLoader
from backend.models.database import MetadataRevision, User, Video, get_db
from backend.models.schemas import (
    AnnotationAccept,
    AnnotationCreate,
    AnnotationModify,
    AnnotationReject,
    CameraMotionModifyRequest,
    DeleteEdgeRequest,
    MetadataRevisionResponse,
    NodeModify,
    NodeRevisionResponse,
    RevisionResponse,
    SceneInfoModifyRequest,
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


@router.post("/delete")
async def delete_edge(
    request: DeleteEdgeRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete an edge (soft delete via revision tracking)."""
    result = await db.execute(
        select(Video).where(Video.video_id == request.video_id)
    )
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(
            status_code=404, detail=f"Video not found: {request.video_id}"
        )

    # Verify user exists
    result = await db.execute(select(User).where(User.id == request.user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=404, detail=f"User not found: {request.user_id}")

    loader = VSGLoader(video.vsg_path)
    service = AnnotationService(db, loader)

    try:
        result = await service.delete_edge(
            video_id=request.video_id,
            edge_id=request.edge_id,
            edge_type=request.edge_type,
            user_id=request.user_id,
            review_notes=request.review_notes,
        )
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


@router.post("/modify-node")
async def modify_node(
    modification: NodeModify,
    db: AsyncSession = Depends(get_db),
):
    """Modify a node's attributes."""
    result = await db.execute(
        select(Video).where(Video.video_id == modification.video_id)
    )
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(
            status_code=404, detail=f"Video not found: {modification.video_id}"
        )

    # Verify user exists
    result = await db.execute(select(User).where(User.id == modification.user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=404, detail=f"User not found: {modification.user_id}")

    loader = VSGLoader(video.vsg_path)
    service = AnnotationService(db, loader)

    try:
        result = await service.modify_node(modification)
        await db.commit()
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/node-history/{video_id}/{node_id}", response_model=list[NodeRevisionResponse])
async def get_node_revision_history(
    video_id: str,
    node_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get revision history for a node."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    loader = VSGLoader(video.vsg_path)
    service = AnnotationService(db, loader)

    return await service.get_node_history(video_id, node_id)


@router.post("/modify-scene-info")
async def modify_scene_info(
    request: SceneInfoModifyRequest,
    db: AsyncSession = Depends(get_db),
):
    """Modify scene info for a video."""
    # Verify video exists
    result = await db.execute(
        select(Video).where(Video.video_id == request.video_id)
    )
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(
            status_code=404, detail=f"Video not found: {request.video_id}"
        )

    # Verify user exists
    result = await db.execute(select(User).where(User.id == request.user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=404, detail=f"User not found: {request.user_id}")

    # Get original scene info
    loader = VSGLoader(video.vsg_path)
    original_scene_info = loader.scene_info

    # Create revision record
    revision = MetadataRevision(
        video_id=video.id,
        user_id=request.user_id,
        metadata_type="scene_info",
        original_value=original_scene_info,
        new_value=request.scene_info.model_dump(),
        review_notes=request.notes,
    )

    db.add(revision)
    await db.commit()
    await db.refresh(revision)

    return {"success": True, "revision_id": revision.id}


@router.post("/modify-camera-motion")
async def modify_camera_motion(
    request: CameraMotionModifyRequest,
    db: AsyncSession = Depends(get_db),
):
    """Modify camera motion for a video."""
    # Verify video exists
    result = await db.execute(
        select(Video).where(Video.video_id == request.video_id)
    )
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(
            status_code=404, detail=f"Video not found: {request.video_id}"
        )

    # Verify user exists
    result = await db.execute(select(User).where(User.id == request.user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=404, detail=f"User not found: {request.user_id}")

    # Get original camera motion
    loader = VSGLoader(video.vsg_path)
    original_camera_motion = loader.camera_motion

    # Create revision record
    revision = MetadataRevision(
        video_id=video.id,
        user_id=request.user_id,
        metadata_type="camera_motion",
        original_value=original_camera_motion,
        new_value=request.camera_motion.model_dump(),
        review_notes=request.notes,
    )

    db.add(revision)
    await db.commit()
    await db.refresh(revision)

    return {"success": True, "revision_id": revision.id}


@router.get("/metadata-history/{video_id}", response_model=list[MetadataRevisionResponse])
async def get_metadata_revision_history(
    video_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get metadata revision history for a video."""
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    # Get all metadata revisions for this video
    result = await db.execute(
        select(MetadataRevision, User)
        .join(User, MetadataRevision.user_id == User.id)
        .where(MetadataRevision.video_id == video.id)
        .order_by(MetadataRevision.created_at.desc())
    )
    rows = result.all()

    return [
        MetadataRevisionResponse(
            id=rev.id,
            video_id=video_id,
            metadata_type=rev.metadata_type,
            user_id=rev.user_id,
            username=user.username,
            original_value=rev.original_value or {},
            new_value=rev.new_value,
            review_notes=rev.review_notes,
            created_at=rev.created_at,
        )
        for rev, user in rows
    ]
