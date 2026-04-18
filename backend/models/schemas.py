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

    size: Optional[str] = None
    shape: Optional[str] = None
    age: Optional[str] = None


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
    has_revision: bool = False
    revision_action: Optional[str] = None
    # Set to the VSG-original is_static value only when a revision has flipped it.
    # Frontend uses this to render a "(now static)" / "(now dynamic)" badge.
    original_is_static: Optional[bool] = None


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
    time_periods: list[TimePeriod] = Field(default_factory=list)


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
    time_periods: list[TimePeriod] = Field(default_factory=list)
    attributes: Optional[MotionAttributes] = None

    # Revision tracking
    has_revision: bool = False
    revision_action: Optional[str] = None

    # Membership removed by group-edge cleanup after a node static/dynamic
    # flip. Empty unless the reclassification pass dropped members — lets
    # the UI keep those edges visible under the flipped node's "Related
    # Edges" section with a "removed after type flip" marker.
    pruned_sources: list[str] = Field(default_factory=list)
    pruned_targets: list[str] = Field(default_factory=list)


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
    new_predicate: Optional[str] = None
    new_time_period: Optional[TimePeriod] = None
    new_time_periods: Optional[list[TimePeriod]] = None
    new_attributes: Optional[MotionAttributes] = None
    new_source: Optional[str | list[str]] = None
    new_target: Optional[str | list[str]] = None
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
    new_time_periods: Optional[list[TimePeriod]] = None
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
    time_periods: Optional[list[TimePeriod]] = None
    attributes: Optional[MotionAttributes] = None
    notes: Optional[str] = None


class DeleteEdgeRequest(BaseModel):
    """Delete an edge."""

    video_id: str
    edge_id: str
    edge_type: Literal["static", "dynamic", "fg_bg"]
    user_id: int
    review_notes: Optional[str] = None


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
    original_time_periods: Optional[list]
    new_time_periods: Optional[list]
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


class ImportResponse(BaseModel):
    """Import response for VSG upload."""

    success: bool
    video_id: str
    message: str
    revisions_cleared: int
    new_vsg_path: str
    imported_at: datetime


# ============================================================================
# Scene Info Schemas
# ============================================================================


class SceneInfo(BaseModel):
    """Scene info for video-level metadata."""

    category: list[str] = Field(default_factory=lambda: ["unknown"])
    transition_types: list[str] = Field(default_factory=lambda: ["unknown"])
    scene_change_relations: list[str] = Field(default_factory=lambda: ["unknown"])
    confidence: float = 0.5


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
    """Primary camera motion descriptor with movement characteristics."""

    type: Literal[
        "dolly", "pedestal", "truck", "pan", "tilt", "roll", "zoom", "static"
    ] = "static"
    direction: Literal[
        "in", "out", "up", "down", "left", "right", "cw", "ccw", "none"
    ] = "none"
    steadiness: Literal[
        "stable", "slight_shake", "moderate_shake", "shaky"
    ] = "stable"
    intensity: Literal["minimal", "subtle", "moderate", "dynamic"] = "minimal"


class CameraMotion(BaseModel):
    """Camera motion for video-level metadata."""

    primary_motion: CameraMotionPrimary = Field(default_factory=CameraMotionPrimary)
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
    new_is_static: Optional[bool] = None
    new_category: Optional[str] = None
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
    original_is_static: Optional[bool] = None
    new_is_static: Optional[bool] = None
    original_category: Optional[str] = None
    new_category: Optional[str] = None
    review_notes: Optional[str]
    created_at: datetime
