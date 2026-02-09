"""AI API routes for attribute suggestions."""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.database import get_db, Video
from backend.config import settings
from backend.core.vsg_loader import VSGLoader
from backend.services.ai_service import suggest_node_attributes

router = APIRouter(prefix="/ai", tags=["ai"])
logger = logging.getLogger(__name__)


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


@router.post("/suggest-attributes", response_model=AttributeSuggestionResponse)
async def get_attribute_suggestions(
    request: AttributeSuggestionRequest,
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
        suggestions = await suggest_node_attributes(
            video_id=request.video_id,
            node=node,
            frame_idx=request.frame_idx,
            frames_path=frames_path,
            provider=request.provider,
            model=request.model,
            debug_mode=request.debug
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

    except Exception as e:
        # Handle unexpected errors
        logger.error(f"Unexpected error in get_attribute_suggestions: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error during AI analysis")


@router.get("/health")
async def check_ai_health() -> dict:
    """
    Check if AI service is configured and healthy.

    Returns:
        Dict with health status
    """
    return {
        "status": "healthy" if settings.nvidia_api_key else "unconfigured",
        "api_configured": bool(settings.nvidia_api_key),
        "model": settings.kimi_model,
        "temperature": settings.kimi_temperature,
        "thinking_enabled": settings.kimi_enable_thinking,
        "default_provider": settings.ai_default_provider,
        "providers": {
            "kimi": {
                "enabled": bool(settings.nvidia_api_key or settings.kimi_api_key),
                "model": settings.kimi_model,
                "key_source": "nvidia" if settings.nvidia_api_key else "kimi" if settings.kimi_api_key else "none",
            },
            "openai": {
                "enabled": bool(settings.openai_api_key),
                "model": settings.openai_model
            },
            "gemini": {
                "enabled": bool(settings.gemini_api_key),
                "model": settings.gemini_model
            }
        }
    }
