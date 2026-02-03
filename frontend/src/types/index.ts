// Common types
export interface TimePeriod {
  start_frame: number;
  end_frame: number;
}

export interface BBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MotionAttributes {
  velocity: string;
  direction: string;
  trajectory: string;
}

// Node types
export interface NodeVisualAttributes {
  color: string;
  texture: string;
  material: string;
}

export interface NodePhysicalAttributes {
  size: string;
  shape: string;
}

export interface NodeAttributes {
  visual: NodeVisualAttributes;
  physical: NodePhysicalAttributes;
}

export interface Node {
  node_id: string;
  object_id: number;
  category: string;
  is_static: boolean;
  attributes: NodeAttributes;
  bboxes_by_frame: Record<string, BBox>;
}

// Edge types
export type EdgeType = 'static' | 'dynamic' | 'fg_bg';

export interface Edge {
  edge_id: string;
  edge_type: EdgeType;
  source: string | string[];
  target: string | string[];
  source_category: string | string[];
  target_category: string | string[];
  predicate: string;
  confidence: number;
  confidence_round1: number;
  confidence_round2: number;
  validated: boolean;
  extraction_round: number;
  validation_reasoning_round1: string;
  validation_reasoning_round2: string;
  time_period: TimePeriod;
  attributes?: MotionAttributes;
  has_revision?: boolean;
  revision_action?: string;
}

// Video types
export interface VideoSummary {
  id: number;
  video_id: string;
  dataset: string | null;
  status: string;
  total_frames: number | null;
  fps: number | null;
  resolution: { width: number; height: number } | null;
  node_count: number;
  edge_count: number;
}

export interface VideoDetail extends VideoSummary {
  vsg_path: string;
  frames_path: string;
  masks_path: string | null;
  static_node_count: number;
  dynamic_node_count: number;
  static_edge_count: number;
  dynamic_edge_count: number;
  fg_bg_edge_count: number;
  revision_count?: number;
}

// Annotation types
export interface AnnotationAccept {
  video_id: string;
  edge_id: string;
  edge_type: EdgeType;
  user_id: number;
  notes?: string;
}

export interface AnnotationReject {
  video_id: string;
  edge_id: string;
  edge_type: EdgeType;
  user_id: number;
  notes?: string;
}

export interface AnnotationModify {
  video_id: string;
  edge_id: string;
  edge_type: EdgeType;
  user_id: number;
  new_predicate?: string;
  new_time_period?: TimePeriod;
  new_attributes?: MotionAttributes;
  new_source?: string | string[];
  new_target?: string | string[];
  notes?: string;
}

export interface AnnotationCreate {
  video_id: string;
  edge_type: EdgeType;
  user_id: number;
  source: string | string[];
  target: string | string[];
  predicate: string;
  time_period: TimePeriod;
  attributes?: MotionAttributes;
  notes?: string;
}

// Revision types
export interface Revision {
  id: number;
  edge_id: string;
  edge_type: string;
  action: string;
  user_id: number;
  username: string;
  original_predicate?: string;
  new_predicate?: string;
  original_time_period?: TimePeriod;
  new_time_period?: TimePeriod;
  original_attributes?: MotionAttributes;
  new_attributes?: MotionAttributes;
  review_notes?: string;
  created_at: string;
}

// User types
export interface User {
  id: number;
  username: string;
  created_at: string;
}

// Filter types
export interface EdgeFilters {
  edge_type?: EdgeType;
  min_confidence?: number;
  max_confidence?: number;
  validated?: boolean;
  extraction_round?: number;
  predicate?: string;
  frame?: number;
}

// Edge stats
export interface EdgeStats {
  total: number;
  static: number;
  dynamic: number;
  fg_bg: number;
  validated: number;
  not_validated: number;
  pvsg_gt: number;
  gpt_extracted: number;
  unique_predicates: string[];
}

// Scene Info types
export interface SceneAttributes {
  environment: 'indoor' | 'outdoor' | 'vehicle';
  lighting_source: 'natural' | 'artificial' | 'mixed' | 'unknown';
  lighting_level: 'bright' | 'normal' | 'dim' | 'dark';
  spatial_layout: 'enclosed' | 'semi_open' | 'open' | 'close_up';
  crowdedness: 'empty' | 'sparse' | 'moderate' | 'crowded';
  activity_level: 'static' | 'low' | 'moderate' | 'high';
}

export interface SceneInfo {
  category: string;
  confidence: number;
  attributes: SceneAttributes;
}

// Camera Motion types
export interface CameraMotionPrimary {
  type: 'dolly' | 'pedestal' | 'truck' | 'pan' | 'tilt' | 'roll' | 'zoom' | 'static';
  direction: 'in' | 'out' | 'up' | 'down' | 'left' | 'right' | 'cw' | 'ccw' | 'none';
}

export interface CameraMotionAttributes {
  style: 'handheld' | 'stabilized' | 'tripod' | 'mounted' | 'drone';
  steadiness: 'stable' | 'slight_shake' | 'moderate_shake' | 'shaky' | 'complex' | 'minor';
  intensity: 'minimal' | 'subtle' | 'moderate' | 'dynamic';
  dynamism: 'static' | 'low' | 'moderate' | 'high';
  follows_action: 'tracking' | 'observational' | 'independent';
}

export interface CameraMotion {
  has_motion: boolean;
  motion_clarity: 'simple' | 'complex' | 'minor';
  primary_motion: CameraMotionPrimary;
  attributes?: CameraMotionAttributes;
  purpose_of_movement?: string;
  confidence: number;
  description?: string;
}

// Video metadata response
export interface VideoMetadata {
  scene_info?: SceneInfo;
  camera_motion?: CameraMotion;
}

// Metadata modification requests
export interface SceneInfoModifyRequest {
  video_id: string;
  user_id: number;
  scene_info: SceneInfo;
  notes?: string;
}

export interface CameraMotionModifyRequest {
  video_id: string;
  user_id: number;
  camera_motion: CameraMotion;
  notes?: string;
}

// Metadata revision
export interface MetadataRevision {
  id: number;
  video_id: string;
  metadata_type: 'scene_info' | 'camera_motion';
  user_id: number;
  username: string;
  original_value: Record<string, unknown>;
  new_value: Record<string, unknown>;
  review_notes?: string;
  created_at: string;
}

// Node modification types
export interface NodeModify {
  video_id: string;
  node_id: string;
  user_id: number;
  new_visual_attributes?: NodeVisualAttributes;
  new_physical_attributes?: NodePhysicalAttributes;
  notes?: string;
}

// Node revision
export interface NodeRevision {
  id: number;
  node_id: string;
  action: string;
  user_id: number;
  username: string;
  original_attributes?: {
    visual?: NodeVisualAttributes;
    physical?: NodePhysicalAttributes;
  };
  new_attributes?: {
    visual?: NodeVisualAttributes;
    physical?: NodePhysicalAttributes;
  };
  review_notes?: string;
  created_at: string;
}
