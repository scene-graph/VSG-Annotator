"""Pydantic schemas for API request/response models."""

from datetime import datetime
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field


# ============================================================================
# Common Schemas
# ============================================================================


class TimePeriod(BaseModel):
    """Time period for an edge."""

    start_frame: int
    end_frame: int


class BBox(BaseModel):
    """Bounding box coordinates."""

    left: int
    top: int
    width: int
    height: int


class MotionAttributes(BaseModel):
    """Motion attributes for dynamic edges."""

    velocity: str = "moderate"
    direction: str = "none"
    trajectory: str = "curved"


# ============================================================================
# Node Schemas
# ============================================================================


class NodeVisualAttributes(BaseModel):
    """Visual attributes for a node."""

    color: str = "unknown"
    texture: str = "unknown"
    material: str = "unknown"


class NodePhysicalAttributes(BaseModel):
    """Physical attributes for a node."""

    size: str = "medium"
    shape: str = "unknown"


class NodeAttributes(BaseModel):
    """Combined attributes for a node."""

    visual: NodeVisualAttributes
    physical: NodePhysicalAttributes


class NodeTracking(BaseModel):
    """Tracking data for a node."""

    bboxes_by_frame: dict[str, BBox]
    masks_by_frame: dict[str, str] = Field(default_factory=dict)


class Node(BaseModel):
    """Scene graph node representing an object."""

    node_id: str
    object_id: int
    category: str
    attributes: NodeAttributes
    tracking: NodeTracking


class NodeResponse(BaseModel):
    """API response for a node."""

    node_id: str
    object_id: int
    category: str
    is_static: bool
    attributes: NodeAttributes
    bboxes_by_frame: dict[str, BBox]


# ============================================================================
# Edge Schemas
# ============================================================================


class EdgeBase(BaseModel):
    """Base edge schema with common fields."""

    edge_id: str
    predicate: str
    confidence: float = 0.5
    confidence_round1: float = 0.5
    confidence_round2: float = 0.5
    validated: bool = False
    extraction_round: int = 1  # 0=PVSG GT, 1=GPT extracted
    validation_reasoning_round1: str = ""
    validation_reasoning_round2: str = ""
    time_period: TimePeriod


class StaticEdge(EdgeBase):
    """Static edge (static ↔ static)."""

    edge_type: Literal["static"] = "static"
    source: str
    target: str
    source_category: str
    target_category: str


class DynamicEdge(EdgeBase):
    """Dynamic edge (dynamic ↔ dynamic) with motion attributes."""

    edge_type: Literal["dynamic"] = "dynamic"
    source: str
    target: str
    source_category: str
    target_category: str
    attributes: MotionAttributes


class FgBgEdge(EdgeBase):
    """Foreground-background edge (dynamic → static) with group-level support."""

    edge_type: Literal["fg_bg"] = "fg_bg"
    source: list[str]  # List of dynamic node IDs
    target: list[str]  # List of static node IDs
    source_category: list[str]
    target_category: list[str]


class EdgeResponse(BaseModel):
    """Unified edge response for API."""

    edge_id: str
    edge_type: Literal["static", "dynamic", "fg_bg"]
    source: str | list[str]
    target: str | list[str]
    source_category: str | list[str]
    target_category: str | list[str]
    predicate: str
    confidence: float
    confidence_round1: float
    confidence_round2: float
    validated: bool
    extraction_round: int
    validation_reasoning_round1: str
    validation_reasoning_round2: str
    time_period: TimePeriod
    attributes: Optional[MotionAttributes] = None

    # Revision tracking
    has_revision: bool = False
    revision_action: Optional[str] = None


# ============================================================================
# Edge Filtering
# ============================================================================


class EdgeFilterParams(BaseModel):
    """Query parameters for filtering edges."""

    edge_type: Optional[Literal["static", "dynamic", "fg_bg"]] = None
    min_confidence: Optional[float] = Field(None, ge=0, le=1)
    max_confidence: Optional[float] = Field(None, ge=0, le=1)
    validated: Optional[bool] = None
    extraction_round: Optional[int] = Field(None, ge=0, le=1)
    predicate: Optional[str] = None
    frame: Optional[int] = None  # Filter edges active at this frame


# ============================================================================
# Video Schemas
# ============================================================================


class VideoSummary(BaseModel):
    """Video summary for listing."""

    id: int
    video_id: str
    dataset: Optional[str]
    status: str
    total_frames: Optional[int]
    fps: Optional[int]
    resolution: Optional[dict[str, int]]
    node_count: int = 0
    edge_count: int = 0


class VideoDetail(VideoSummary):
    """Detailed video information."""

    vsg_path: str
    frames_path: str
    masks_path: Optional[str]
    static_node_count: int = 0
    dynamic_node_count: int = 0
    static_edge_count: int = 0
    dynamic_edge_count: int = 0
    fg_bg_edge_count: int = 0
    revision_count: int = 0


# ============================================================================
# Annotation Schemas
# ============================================================================


class AnnotationAccept(BaseModel):
    """Accept an edge as-is."""

    video_id: str
    edge_id: str
    edge_type: Literal["static", "dynamic", "fg_bg"]
    user_id: int
    notes: Optional[str] = None


class AnnotationReject(BaseModel):
    """Reject an edge."""

    video_id: str
    edge_id: str
    edge_type: Literal["static", "dynamic", "fg_bg"]
    user_id: int
    notes: Optional[str] = None


class AnnotationModify(BaseModel):
    """Modify an existing edge."""

    video_id: str
    edge_id: str
    edge_type: Literal["static", "dynamic", "fg_bg"]
    user_id: int
    new_predicate: Optional[str] = None
    new_time_period: Optional[TimePeriod] = None
    new_attributes: Optional[MotionAttributes] = None
    new_source: Optional[str | list[str]] = None
    new_target: Optional[str | list[str]] = None
    notes: Optional[str] = None


class AnnotationCreate(BaseModel):
    """Create a new edge."""

    video_id: str
    edge_type: Literal["static", "dynamic", "fg_bg"]
    user_id: int
    source: str | list[str]
    target: str | list[str]
    predicate: str
    time_period: TimePeriod
    attributes: Optional[MotionAttributes] = None
    notes: Optional[str] = None


class RevisionResponse(BaseModel):
    """Response for revision history."""

    id: int
    edge_id: str
    edge_type: str
    action: str
    user_id: int
    username: str
    original_predicate: Optional[str]
    new_predicate: Optional[str]
    original_time_period: Optional[dict]
    new_time_period: Optional[dict]
    original_attributes: Optional[dict]
    new_attributes: Optional[dict]
    review_notes: Optional[str]
    created_at: datetime


# ============================================================================
# User Schemas
# ============================================================================


class UserCreate(BaseModel):
    """Create a new user."""

    username: str


class UserResponse(BaseModel):
    """User response."""

    id: int
    username: str
    created_at: datetime


# ============================================================================
# Export Schemas
# ============================================================================


class ExportRequest(BaseModel):
    """Request to export annotated VSG."""

    video_id: str
    include_rejected: bool = False
    apply_modifications: bool = True
    user_id: Optional[int] = None  # Filter by specific annotator


class ExportResponse(BaseModel):
    """Export response with VSG content."""

    video_id: str
    exported_at: datetime
    vsg: dict[str, Any]
    revision_summary: dict[str, int]


# ============================================================================
# Scene Info Schemas
# ============================================================================


class SceneAttributes(BaseModel):
    """Scene attributes for video-level metadata."""

    environment: Literal["indoor", "outdoor", "vehicle"] = "indoor"
    lighting_source: Literal["natural", "artificial", "mixed", "unknown"] = "unknown"
    lighting_level: Literal["bright", "normal", "dim", "dark"] = "normal"
    spatial_layout: Literal["enclosed", "semi_open", "open", "close_up"] = "enclosed"
    crowdedness: Literal["empty", "sparse", "moderate", "crowded"] = "moderate"
    activity_level: Literal["static", "low", "moderate", "high"] = "moderate"


class SceneInfo(BaseModel):
    """Scene info for video-level metadata."""

    category: str = "unknown"
    confidence: float = 0.5
    attributes: SceneAttributes = Field(default_factory=SceneAttributes)


class SceneInfoModifyRequest(BaseModel):
    """Request to modify scene info."""

    video_id: str
    user_id: int
    scene_info: SceneInfo
    notes: Optional[str] = None


# ============================================================================
# Camera Motion Schemas
# ============================================================================


class CameraMotionPrimary(BaseModel):
    """Primary camera motion descriptor."""

    type: Literal[
        "dolly", "pedestal", "truck", "pan", "tilt", "roll", "zoom", "static"
    ] = "static"
    direction: Literal[
        "in", "out", "up", "down", "left", "right", "cw", "ccw", "none"
    ] = "none"


class CameraMotionAttributes(BaseModel):
    """Camera motion attributes."""

    style: Literal[
        "handheld", "stabilized", "tripod", "mounted", "drone"
    ] = "stabilized"
    steadiness: Literal[
        "stable", "slight_shake", "moderate_shake", "shaky", "complex", "minor"
    ] = "stable"
    intensity: Literal["minimal", "subtle", "moderate", "dynamic"] = "minimal"
    dynamism: Literal["static", "low", "moderate", "high"] = "static"
    follows_action: Literal["tracking", "observational", "independent"] = "observational"


class CameraMotion(BaseModel):
    """Camera motion for video-level metadata."""

    has_motion: bool = False
    motion_clarity: Literal["simple", "complex", "minor"] = "simple"
    primary_motion: CameraMotionPrimary = Field(default_factory=CameraMotionPrimary)
    attributes: Optional[CameraMotionAttributes] = None
    purpose_of_movement: Optional[str] = None
    confidence: float = 0.5
    description: Optional[str] = None


class CameraMotionModifyRequest(BaseModel):
    """Request to modify camera motion."""

    video_id: str
    user_id: int
    camera_motion: CameraMotion
    notes: Optional[str] = None


# ============================================================================
# Metadata Revision Schemas
# ============================================================================


class MetadataRevisionResponse(BaseModel):
    """Response for metadata revision history."""

    id: int
    video_id: str
    metadata_type: str  # "scene_info" or "camera_motion"
    user_id: int
    username: str
    original_value: dict[str, Any]
    new_value: dict[str, Any]
    review_notes: Optional[str]
    created_at: datetime


# ============================================================================
# Node Revision Schemas
# ============================================================================


class NodeModify(BaseModel):
    """Modify node attributes."""

    video_id: str
    node_id: str
    user_id: int
    new_visual_attributes: Optional[NodeVisualAttributes] = None
    new_physical_attributes: Optional[NodePhysicalAttributes] = None
    notes: Optional[str] = None


class NodeRevisionResponse(BaseModel):
    """Response for node revision history."""

    id: int
    node_id: str
    action: str
    user_id: int
    username: str
    original_attributes: Optional[dict[str, Any]]
    new_attributes: Optional[dict[str, Any]]
    review_notes: Optional[str]
    created_at: datetime
