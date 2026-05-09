"""AI API routes for node/edge AI suggestions."""

import asyncio
import logging
from contextlib import suppress
from typing import Optional, Awaitable, TypeVar

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.database import get_db, Video
from backend.config import settings
from backend.core.vsg_loader import VSGLoader
from backend.services.annotation_service import AnnotationService
from backend.services.ai_service import suggest_node_attributes, suggest_edge_annotation

router = APIRouter(prefix="/ai", tags=["ai"])
logger = logging.getLogger(__name__)
T = TypeVar("T")


async def _await_with_disconnect_cancel(http_request: Request, op: Awaitable[T]) -> T:
    """Cancel long-running AI work if the HTTP client disconnects."""
    task = asyncio.create_task(op)
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=0.2)
            if task in done:
                return task.result()
            if await http_request.is_disconnected():
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
                raise HTTPException(status_code=499, detail="Client disconnected")
    except Exception:
        if not task.done():
            task.cancel()
        raise


class AttributeSuggestionRequest(BaseModel):
    """Request model for attribute suggestions."""
    video_id: str = Field(..., description="Video identifier")
    node_id: str = Field(..., description="Node identifier")
    frame_idx: int = Field(..., ge=0, description="Frame index")
    debug: bool = Field(False, description="Enable debug mode")
    provider: Optional[str] = Field(None, description="AI provider (kimi, openai, gemini)")
    model: Optional[str] = Field(None, description="Override model name")


class AttributeSuggestionResponse(BaseModel):
    """Response model for attribute suggestions."""
    visual: dict = Field(..., description="Visual attributes (color, texture, material)")
    physical: dict = Field(..., description="Physical attributes (size, shape)")
    confidence: float = Field(0.0, ge=0.0, le=1.0, description="Confidence score")
    node_id: str = Field(..., description="Node identifier")
    frame_idx: int = Field(..., description="Frame index")
    category: str = Field(..., description="Object category")
    error: Optional[str] = Field(None, description="Error message if any")
    debug_info: Optional[dict] = Field(None, description="Debug information")
    cropped_image: Optional[str] = Field(None, description="Base64 cropped image")
    raw_request: Optional[dict] = Field(None, description="Raw API request")
    raw_response: Optional[dict] = Field(None, description="Raw API response")
    response_content: Optional[str] = Field(None, description="Extracted AI response content")


class EdgeSuggestionRequest(BaseModel):
    """Request model for edge AI suggestions."""
    video_id: str = Field(..., description="Video identifier")
    edge_id: str = Field(..., description="Edge identifier")
    frame_idx: int = Field(..., ge=0, description="Center frame index for visual analysis")
    debug: bool = Field(False, description="Enable debug mode")
    provider: Optional[str] = Field(None, description="AI provider (kimi, openai, gemini)")
    model: Optional[str] = Field(None, description="Override model name")


class EdgeMotionSuggestion(BaseModel):
    """Motion attributes for dynamic edges."""
    velocity: str
    direction: str
    trajectory: str


class EdgeSuggestionResponse(BaseModel):
    """Response model for edge AI suggestions."""
    edge_id: str
    edge_type: str
    predicate: str
    time_periods: list[dict] = Field(default_factory=list)
    attributes: Optional[EdgeMotionSuggestion] = None
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    resolved_frame_idx: Optional[int] = Field(
        None, description="Center frame actually used after clamping"
    )
    context_frames: Optional[list[int]] = Field(
        None, description="Frames provided to AI for analysis"
    )
    context_images: Optional[list[str]] = Field(
        None, description="Base64 cropped context images sent to AI (debug mode only)"
    )
    error: Optional[str] = Field(None, description="Error message if any")
    debug_info: Optional[dict] = Field(None, description="Debug information")
    raw_request: Optional[dict] = Field(None, description="Raw API request")
    raw_response: Optional[dict] = Field(None, description="Raw API response")
    response_content: Optional[str] = Field(None, description="Extracted AI response content")


@router.post("/suggest-attributes", response_model=AttributeSuggestionResponse)
async def get_attribute_suggestions(
    request: AttributeSuggestionRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db)
) -> AttributeSuggestionResponse:
    """
    Get AI-suggested attributes for a node at a specific frame.

    This endpoint uses the Kimi 2.5 vision-language model to analyze
    the object in the specified frame and suggest visual and physical
    attributes based on the schema.

    Args:
        request: Contains video_id, node_id, and frame_idx
        db: Database session
        current_user: Optional authenticated user

    Returns:
        AttributeSuggestionResponse with suggested attributes

    Raises:
        HTTPException: If video, node, or frame not found
    """
    try:
        logger.info(
            "AI suggestion request: video=%s node=%s frame=%s provider=%s model=%s",
            request.video_id,
            request.node_id,
            request.frame_idx,
            request.provider or settings.ai_default_provider,
            request.model or "default"
        )
        # Verify video exists in database
        result = await db.execute(select(Video).where(Video.video_id == request.video_id))
        video = result.scalar_one_or_none()
        if not video:
            raise HTTPException(status_code=404, detail=f"Video {request.video_id} not found")

        # Load VSG data to get nodes
        try:
            loader = VSGLoader(video.vsg_path)
            vsg_data = loader.load()

            # Get all nodes from both static and dynamic scene graphs
            all_nodes = []
            if 'static_scene_graph' in vsg_data and 'nodes' in vsg_data['static_scene_graph']:
                all_nodes.extend(vsg_data['static_scene_graph']['nodes'])
            if 'dynamic_scene_graph' in vsg_data and 'nodes' in vsg_data['dynamic_scene_graph']:
                all_nodes.extend(vsg_data['dynamic_scene_graph']['nodes'])

            # Find the specific node
            node = None
            for n in all_nodes:
                if n.get('node_id') == request.node_id:
                    node = n
                    break

            if not node:
                raise HTTPException(
                    status_code=404,
                    detail=f"Node {request.node_id} not found in video {request.video_id}"
                )
        except Exception as e:
            logger.error(f"Error loading VSG data: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Error loading video data: {str(e)}")

        # Check if node is visible at this frame
        bbox_key = str(request.frame_idx)
        # Bounding boxes are stored in node['tracking']['bboxes_by_frame']
        bboxes = node.get('tracking', {}).get('bboxes_by_frame', {})

        # Check if frame is within video bounds
        if request.frame_idx >= video.total_frames:
            raise HTTPException(
                status_code=400,
                detail=f"Frame {request.frame_idx} is out of bounds. Video has {video.total_frames} frames (0-{video.total_frames-1})"
            )

        if bbox_key not in bboxes:
            # Get the valid frame range for this node
            frame_numbers = sorted([int(k) for k in bboxes.keys()])
            if frame_numbers:
                min_frame = frame_numbers[0]
                max_frame = frame_numbers[-1]
                raise HTTPException(
                    status_code=400,
                    detail=f"Node {request.node_id} not visible at frame {request.frame_idx}. Node is visible in frames {min_frame}-{max_frame}"
                )
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Node {request.node_id} has no bounding boxes defined"
                )

        # Get frames path from settings
        frames_path = str(settings.pvsg_mini_path)

        # Call AI service with debug mode
        suggestions = await _await_with_disconnect_cancel(
            http_request,
            suggest_node_attributes(
                video_id=request.video_id,
                node=node,
                frame_idx=request.frame_idx,
                frames_path=frames_path,
                provider=request.provider,
                model=request.model,
                debug_mode=request.debug,
            ),
        )

        # Log the request for analytics
        logger.info(
            f"AI suggestions requested for video={request.video_id}, "
            f"node={request.node_id}, frame={request.frame_idx}"
        )

        return AttributeSuggestionResponse(**suggestions)

    except ValueError as e:
        # Handle validation errors from AI service
        logger.error(f"AI service error: {str(e)}")
        return AttributeSuggestionResponse(
            visual={"color": "unknown", "texture": "unknown", "material": "unknown"},
            physical={"size": "medium", "shape": "irregular"},
            confidence=0.0,
            node_id=request.node_id,
            frame_idx=request.frame_idx,
            category=node.get('category', 'unknown') if node else 'unknown',
            error=str(e)
        )

    except HTTPException:
        # Re-raise HTTP exceptions
        raise

    except asyncio.CancelledError:
        logger.info(
            "Node AI request cancelled: video=%s node=%s frame=%s",
            request.video_id,
            request.node_id,
            request.frame_idx,
        )
        raise

    except Exception as e:
        # Handle unexpected errors
        logger.error(f"Unexpected error in get_attribute_suggestions: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error during AI analysis")


@router.post("/suggest-edge", response_model=EdgeSuggestionResponse)
async def get_edge_suggestions(
    request: EdgeSuggestionRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
) -> EdgeSuggestionResponse:
    """Get AI suggestions for edge predicate/motion attributes."""
    logger.info(
        "AI edge suggestion request: video=%s edge=%s frame=%s provider=%s model=%s",
        request.video_id,
        request.edge_id,
        request.frame_idx,
        request.provider or settings.ai_default_provider,
        request.model or "default",
    )

    # Verify video exists
    result = await db.execute(select(Video).where(Video.video_id == request.video_id))
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=404, detail=f"Video {request.video_id} not found")

    if video.total_frames is not None and request.frame_idx >= video.total_frames:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Frame {request.frame_idx} is out of bounds. "
                f"Video has {video.total_frames} frames (0-{video.total_frames - 1})"
            ),
        )

    try:
        loader = VSGLoader(video.vsg_path)
        service = AnnotationService(db, loader, video_id=request.video_id)
        effective_edges = await service.get_edges_with_revisions()
        edge = next((e for e in effective_edges if e.edge_id == request.edge_id), None)
        if edge is None:
            raise HTTPException(
                status_code=404,
                detail=f"Edge {request.edge_id} not found in video {request.video_id}",
            )

        suggestions = await _await_with_disconnect_cancel(
            http_request,
            suggest_edge_annotation(
                video_id=request.video_id,
                edge=edge.model_dump(),
                frame_idx=request.frame_idx,
                frames_path=video.frames_path,
                nodes_by_id={k: v.model_dump() for k, v in loader.get_all_nodes().items()},
                total_frames=video.total_frames or loader.total_frames,
                provider=request.provider,
                model=request.model,
                debug_mode=request.debug,
            ),
        )
        return EdgeSuggestionResponse(**suggestions)
    except HTTPException:
        raise
    except asyncio.CancelledError:
        logger.info(
            "Edge AI request cancelled: video=%s edge=%s frame=%s",
            request.video_id,
            request.edge_id,
            request.frame_idx,
        )
        raise
    except Exception as e:
        logger.error("Unexpected error in get_edge_suggestions: %s", str(e))
        raise HTTPException(status_code=500, detail="Internal server error during edge AI analysis")


@router.get("/health")
async def check_ai_health() -> dict:
    """
    Check if AI service is configured and healthy.

    Returns:
        Dict with health status
    """
    api_ok = bool(settings.api_key)
    return {
        "status": "healthy" if api_ok else "unconfigured",
        "api_configured": api_ok,
        "model": settings.gemini_model,
        "temperature": settings.gemini_temperature,
        "default_provider": settings.ai_default_provider,
        "providers": {
            "openai": {
                "enabled": api_ok,
                "model": settings.openai_model,
            },
            "gemini": {
                "enabled": api_ok,
                "model": settings.gemini_model,
            },
        }
    }
