"""VSG Loader for Jan20 schema video scene graph files."""

import json
import logging
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

from backend.models.schemas import (
    BBox,
    DynamicEdge,
    EdgeResponse,
    FgBgEdge,
    MotionAttributes,
    Node,
    NodeAttributes,
    NodePhysicalAttributes,
    NodeResponse,
    NodeTracking,
    NodeVisualAttributes,
    StaticEdge,
    TimePeriod,
)

PERSON_CATEGORIES = {"person", "adult", "child", "baby"}


class VSGLoader:
    """Load and parse Jan20 schema VSG files."""

    def __init__(self, vsg_path: str | Path):
        """Initialize with path to VSG JSON file."""
        self.vsg_path = Path(vsg_path)
        self._data: Optional[dict] = None
        self._nodes_cache: Optional[dict[str, NodeResponse]] = None
        self._edges_cache: Optional[list[EdgeResponse]] = None

    def load(self) -> dict[str, Any]:
        """Load the VSG file."""
        if self._data is None:
            try:
                with open(self.vsg_path) as f:
                    self._data = json.load(f)
            except OSError as e:
                normalized = self._normalize_outputs_path(self.vsg_path)
                if normalized != self.vsg_path and normalized.exists():
                    self.vsg_path = normalized
                    with open(self.vsg_path) as f:
                        self._data = json.load(f)
                else:
                    raise e
        return self._data

    @staticmethod
    def _normalize_outputs_path(path: Path) -> Path:
        value = str(path)
        while "/outputs/outputs" in value:
            value = value.replace("/outputs/outputs", "/outputs")
        return Path(value)

    @property
    def data(self) -> dict[str, Any]:
        """Get the loaded VSG data."""
        return self.load()

    @property
    def metadata(self) -> dict[str, Any]:
        """Get video metadata."""
        return self.data.get("metadata", {})

    @property
    def video_id(self) -> str:
        """Get video ID."""
        return self.metadata.get("video_id", "unknown")

    @property
    def dataset(self) -> str:
        """Get dataset name."""
        return self.metadata.get("dataset", "unknown")

    @property
    def total_frames(self) -> int:
        """Get total frame count."""
        return self.metadata.get("total_frames", 0)

    @property
    def fps(self) -> int:
        """Get frames per second."""
        return self.metadata.get("fps", 5)

    @property
    def resolution(self) -> dict[str, int]:
        """Get video resolution."""
        return self.metadata.get("resolution", {"width": 1920, "height": 1080})

    @property
    def scene_info(self) -> Optional[dict[str, Any]]:
        """Get scene info from VSG."""
        return self.data.get("scene_info")

    @property
    def camera_motion(self) -> Optional[dict[str, Any]]:
        """Get camera motion from VSG."""
        return self.data.get("camera_motion")

    def get_static_nodes(self) -> list[dict]:
        """Get raw static nodes from VSG."""
        return self.data.get("static_scene_graph", {}).get("nodes", [])

    def get_dynamic_nodes(self) -> list[dict]:
        """Get raw dynamic nodes from VSG."""
        return self.data.get("dynamic_scene_graph", {}).get("nodes", [])

    def get_static_edges(self) -> list[dict]:
        """Get raw static edges from VSG."""
        return self.data.get("static_scene_graph", {}).get("edges", [])

    def get_dynamic_edges(self) -> list[dict]:
        """Get raw dynamic edges from VSG."""
        return self.data.get("dynamic_scene_graph", {}).get("edges", [])

    def get_fg_bg_edges(self) -> list[dict]:
        """Get raw foreground-background edges from VSG."""
        return self.data.get("foreground_background_relations", {}).get("edges", [])

    def get_all_nodes(self) -> dict[str, NodeResponse]:
        """Get all nodes as NodeResponse objects, keyed by node_id."""
        if self._nodes_cache is not None:
            return self._nodes_cache

        nodes: dict[str, NodeResponse] = {}

        # Parse static nodes
        for node_data in self.get_static_nodes():
            node = self._parse_node(node_data, is_static=True)
            nodes[node.node_id] = node

        # Parse dynamic nodes
        for node_data in self.get_dynamic_nodes():
            node = self._parse_node(node_data, is_static=False)
            nodes[node.node_id] = node

        self._nodes_cache = nodes
        return nodes

    def _parse_node(self, node_data: dict, is_static: bool) -> NodeResponse:
        """Parse a raw node dict into NodeResponse."""
        tracking = node_data.get("tracking", {})
        bboxes_raw = tracking.get("bboxes_by_frame", {})

        # Convert bboxes to BBox objects
        bboxes = {}
        for frame_str, bbox_data in bboxes_raw.items():
            bboxes[frame_str] = BBox(
                left=bbox_data.get("left", 0),
                top=bbox_data.get("top", 0),
                width=bbox_data.get("width", 0),
                height=bbox_data.get("height", 0),
            )

        # Parse attributes
        attrs = node_data.get("attributes", {})
        visual = attrs.get("visual", {})
        physical = attrs.get("physical", {})

        category = node_data.get("category", "unknown")
        is_person = category.lower().strip() in PERSON_CATEGORIES

        return NodeResponse(
            node_id=node_data["node_id"],
            object_id=node_data.get("object_id", 0),
            category=category,
            is_static=is_static,
            attributes=NodeAttributes(
                visual=NodeVisualAttributes(
                    color=visual.get("color", "unknown"),
                    texture=visual.get("texture", "unknown"),
                    material=visual.get("material", "unknown"),
                ),
                physical=NodePhysicalAttributes(
                    size=None if is_person else physical.get("size", "medium"),
                    shape=None if is_person else physical.get("shape", "unknown"),
                    age=physical.get("age", "unknown") if is_person else None,
                ),
            ),
            bboxes_by_frame=bboxes,
        )

    def get_all_edges(self) -> list[EdgeResponse]:
        """Get all edges as EdgeResponse objects."""
        if self._edges_cache is not None:
            return self._edges_cache

        edges: list[EdgeResponse] = []

        # Parse static edges
        for edge_data in self.get_static_edges():
            edge = self._parse_static_edge(edge_data)
            edges.append(edge)

        # Parse dynamic edges
        for edge_data in self.get_dynamic_edges():
            edge = self._parse_dynamic_edge(edge_data)
            edges.append(edge)

        # Parse FG-BG edges
        for edge_data in self.get_fg_bg_edges():
            edge = self._parse_fg_bg_edge(edge_data)
            edges.append(edge)

        # Deduplicate edge IDs: rename later occurrences to <id>_dup1, _dup2, ...
        seen: dict[str, int] = {}
        for edge in edges:
            original_id = edge.edge_id
            if original_id in seen:
                seen[original_id] += 1
                edge.edge_id = f"{original_id}_dup{seen[original_id]}"
                logger.warning(
                    "Duplicate edge_id '%s' in VSG — renamed to '%s'",
                    original_id, edge.edge_id,
                )
            else:
                seen[original_id] = 0

        self._edges_cache = edges
        return edges

    def _parse_time_period(self, tp_data: dict) -> TimePeriod:
        """Parse time period from edge data."""
        return TimePeriod(
            start_frame=tp_data.get("start_frame", 0),
            end_frame=tp_data.get("end_frame", self.total_frames - 1),
        )

    def _parse_time_periods(self, edge_data: dict) -> list[TimePeriod]:
        """Parse time periods list from edge data.

        Accepts either `time_periods` (current schema key) or `time_spans`
        (legacy / alternative key produced by some extractors). Without
        this fallback, multi-interval edges collapsed to the merged
        `time_period` envelope and the UI hid the real gaps.
        """
        tp_list = edge_data.get("time_periods")
        if not (isinstance(tp_list, list) and tp_list):
            tp_list = edge_data.get("time_spans")
        if isinstance(tp_list, list) and tp_list:
            return [
                self._parse_time_period(tp)
                for tp in tp_list
                if isinstance(tp, dict)
            ]
        # Fallback to single time_period if provided
        if "time_period" in edge_data:
            return [self._parse_time_period(edge_data.get("time_period", {}))]
        # Default full span
        return [TimePeriod(start_frame=0, end_frame=self.total_frames - 1)]

    def _merge_time_periods(self, periods: list[TimePeriod]) -> TimePeriod:
        """Compute a union time period from a list."""
        if not periods:
            return TimePeriod(start_frame=0, end_frame=self.total_frames - 1)
        return TimePeriod(
            start_frame=min(p.start_frame for p in periods),
            end_frame=max(p.end_frame for p in periods),
        )

    def _parse_static_edge(self, edge_data: dict) -> EdgeResponse:
        """Parse a static edge."""
        time_periods = self._parse_time_periods(edge_data)
        merged = self._merge_time_periods(time_periods)
        return EdgeResponse(
            edge_id=edge_data["edge_id"],
            edge_type="static",
            source=edge_data["source"],
            target=edge_data["target"],
            source_category=edge_data.get("source_category", "unknown"),
            target_category=edge_data.get("target_category", "unknown"),
            predicate=edge_data["predicate"],
            confidence=edge_data.get("confidence", 0.5),
            confidence_round1=edge_data.get("confidence_round1", 0.5),
            confidence_round2=edge_data.get("confidence_round2", 0.5),
            validated=edge_data.get("validated", False),
            extraction_round=edge_data.get("extraction_round", 1),
            validation_reasoning_round1=edge_data.get("validation_reasoning_round1", ""),
            validation_reasoning_round2=edge_data.get("validation_reasoning_round2", ""),
            time_period=merged,
            time_periods=time_periods,
            attributes=None,
        )

    def _parse_dynamic_edge(self, edge_data: dict) -> EdgeResponse:
        """Parse a dynamic edge with motion attributes."""
        attrs_data = edge_data.get("attributes", {})
        attrs = MotionAttributes(
            velocity=attrs_data.get("velocity", "moderate"),
            direction=attrs_data.get("direction", "none"),
            trajectory=attrs_data.get("trajectory", "curved"),
        )
        time_periods = self._parse_time_periods(edge_data)
        merged = self._merge_time_periods(time_periods)
        return EdgeResponse(
            edge_id=edge_data["edge_id"],
            edge_type="dynamic",
            source=edge_data["source"],
            target=edge_data["target"],
            source_category=edge_data.get("source_category", "unknown"),
            target_category=edge_data.get("target_category", "unknown"),
            predicate=edge_data["predicate"],
            confidence=edge_data.get("confidence", 0.5),
            confidence_round1=edge_data.get("confidence_round1", 0.5),
            confidence_round2=edge_data.get("confidence_round2", 0.5),
            validated=edge_data.get("validated", False),
            extraction_round=edge_data.get("extraction_round", 1),
            validation_reasoning_round1=edge_data.get("validation_reasoning_round1", ""),
            validation_reasoning_round2=edge_data.get("validation_reasoning_round2", ""),
            time_period=merged,
            time_periods=time_periods,
            attributes=attrs,
        )

    def _parse_fg_bg_edge(self, edge_data: dict) -> EdgeResponse:
        """Parse a foreground-background edge with group-level support."""
        time_periods = self._parse_time_periods(edge_data)
        merged = self._merge_time_periods(time_periods)
        return EdgeResponse(
            edge_id=edge_data["edge_id"],
            edge_type="fg_bg",
            source=edge_data["source"],  # List of node IDs
            target=edge_data["target"],  # List of node IDs
            source_category=edge_data.get("source_category", []),
            target_category=edge_data.get("target_category", []),
            predicate=edge_data["predicate"],
            confidence=edge_data.get("confidence", 0.5),
            confidence_round1=edge_data.get("confidence_round1", 0.5),
            confidence_round2=edge_data.get("confidence_round2", 0.5),
            validated=edge_data.get("validated", False),
            extraction_round=edge_data.get("extraction_round", 1),
            validation_reasoning_round1=edge_data.get("validation_reasoning_round1", ""),
            validation_reasoning_round2=edge_data.get("validation_reasoning_round2", ""),
            time_period=merged,
            time_periods=time_periods,
            attributes=None,
        )

    def get_edge_by_id(self, edge_id: str) -> Optional[EdgeResponse]:
        """Get a specific edge by ID."""
        for edge in self.get_all_edges():
            if edge.edge_id == edge_id:
                return edge
        return None

    def get_node_by_id(self, node_id: str) -> Optional[NodeResponse]:
        """Get a specific node by ID."""
        return self.get_all_nodes().get(node_id)

    def get_summary(self) -> dict[str, Any]:
        """Get a summary of the VSG content."""
        return {
            "video_id": self.video_id,
            "dataset": self.dataset,
            "total_frames": self.total_frames,
            "fps": self.fps,
            "resolution": self.resolution,
            "static_node_count": len(self.get_static_nodes()),
            "dynamic_node_count": len(self.get_dynamic_nodes()),
            "static_edge_count": len(self.get_static_edges()),
            "dynamic_edge_count": len(self.get_dynamic_edges()),
            "fg_bg_edge_count": len(self.get_fg_bg_edges()),
        }


def find_latest_vsg(sample_dir: Path) -> Optional[Path]:
    """Find the latest VSG file in a sample's outputs directory."""
    outputs_dir = sample_dir / "outputs"
    if not outputs_dir.exists():
        return None

    vsg_files = list(outputs_dir.glob("video_scene_graph_*.json"))
    # Also match the exact name "video_scene_graph.json" (no timestamp suffix)
    exact = outputs_dir / "video_scene_graph.json"
    if exact.exists() and exact not in vsg_files:
        vsg_files.append(exact)
    if not vsg_files:
        return None

    # Sort by modification time, return latest
    vsg_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return vsg_files[0]


def discover_samples(pvsg_mini_path: Path) -> list[dict[str, Any]]:
    """Discover all video samples in pvsg_mini directory."""
    samples = []

    for sample_dir in pvsg_mini_path.iterdir():
        if not sample_dir.is_dir() or sample_dir.name.startswith("."):
            continue

        vsg_path = find_latest_vsg(sample_dir)
        if vsg_path is None:
            continue

        frames_dir = sample_dir / "frames"
        masks_dir = sample_dir / "masks"

        if not frames_dir.exists():
            continue

        samples.append({
            "video_id": sample_dir.name,
            "vsg_path": str(vsg_path),
            "frames_path": str(frames_dir),
            "masks_path": str(masks_dir) if masks_dir.exists() else None,
            "sample_dir": str(sample_dir),
        })

    return samples
