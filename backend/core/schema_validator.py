"""Schema validator for Jan20 video scene graph format."""

from typing import Any


# Valid values from the Jan20 schema
VALID_VELOCITY_VALUES = [
    "stationary",
    "very_slow",
    "slow",
    "moderate",
    "fast",
    "very_fast",
]

VALID_DIRECTION_VALUES = [
    "none",
    "up",
    "down",
    "left",
    "right",
    "forward",
    "backward",
    "toward_body",
    "away_from_body",
    "inward",
    "outward",
    "rotational",
]

VALID_TRAJECTORY_VALUES = [
    "stable",
    "straight",
    "curved",
    "arc",
    "circular",
    "zigzag",
    "oscillating",
    "irregular",
]

# Spatial predicates (for static-static and fg-bg relations)
SPATIAL_PREDICATES = [
    "on",
    "under",
    "over",
    "in",
    "around",
    "beside",
    "left_of",
    "right_of",
    "in_front_of",
    "behind",
    "near",
    "between",
    "along",
    "across",
    # FG-BG specific
    "standing_on",
    "sitting_on",
    "lying_on",
    "placed_on",
    "inside",
]

# Action predicates (for dynamic-dynamic relations)
ACTION_PREDICATES = [
    # Manipulation
    "picking",
    "picking up",
    "placing",
    "putting",
    "putting down",
    "holding",
    "grabbing",
    "grasping",
    "releasing",
    "dropping",
    "lifting",
    "lowering",
    "carrying",
    "moving",
    # Force/Motion
    "throwing",
    "tossing",
    "pushing",
    "pulling",
    "dragging",
    "sliding",
    "rolling",
    "spinning",
    "twisting",
    "turning",
    "shaking",
    "waving",
    "swinging",
    "hitting",
    "kicking",
    "catching",
    # Gestural
    "pointing",
    "looking at",
    "watching",
    "touching",
    "reaching",
    "reaching for",
    # Consumptive
    "eating",
    "drinking",
    "biting",
    "chewing",
    "blowing",
    "licking",
    # Spatial/Positional
    "sitting on",
    "standing on",
    "lying on",
    "leaning on",
    "riding",
    # Operational
    "opening",
    "closing",
    "using",
    "operating",
    "pressing",
    "typing",
    "writing",
    "cutting",
    "wiping",
    "cleaning",
    "stirring",
    "pouring",
    "folding",
    "inserting",
    "removing",
    "attaching",
    "detaching",
    "tightening",
    "loosening",
    "adjusting",
    "covering",
    "wrapping",
    "taping",
]


class ValidationError:
    """Represents a validation error."""

    def __init__(self, path: str, message: str, value: Any = None):
        self.path = path
        self.message = message
        self.value = value

    def __repr__(self) -> str:
        return f"ValidationError(path='{self.path}', message='{self.message}')"


class SchemaValidator:
    """Validate VSG data against Jan20 schema."""

    def __init__(self):
        self.errors: list[ValidationError] = []

    def validate(self, vsg: dict) -> tuple[bool, list[ValidationError]]:
        """Validate a complete VSG structure."""
        self.errors = []

        self._validate_metadata(vsg.get("metadata", {}))
        self._validate_static_scene_graph(vsg.get("static_scene_graph", {}))
        self._validate_dynamic_scene_graph(vsg.get("dynamic_scene_graph", {}))
        self._validate_fg_bg_relations(vsg.get("foreground_background_relations", {}))

        return len(self.errors) == 0, self.errors

    def _validate_metadata(self, metadata: dict) -> None:
        """Validate metadata section."""
        required_fields = ["video_id", "total_frames", "fps", "resolution"]
        for field in required_fields:
            if field not in metadata:
                self.errors.append(
                    ValidationError(f"metadata.{field}", f"Missing required field: {field}")
                )

        if "resolution" in metadata:
            res = metadata["resolution"]
            if "width" not in res or "height" not in res:
                self.errors.append(
                    ValidationError(
                        "metadata.resolution",
                        "Resolution must have 'width' and 'height'",
                    )
                )

    def _validate_node(self, node: dict, path: str) -> None:
        """Validate a node structure."""
        required = ["node_id", "object_id", "category"]
        for field in required:
            if field not in node:
                self.errors.append(
                    ValidationError(f"{path}.{field}", f"Missing required field: {field}")
                )

        if "tracking" in node:
            tracking = node["tracking"]
            if "bboxes_by_frame" not in tracking:
                self.errors.append(
                    ValidationError(
                        f"{path}.tracking.bboxes_by_frame",
                        "Missing bboxes_by_frame",
                    )
                )

    def _validate_static_edge(self, edge: dict, path: str) -> None:
        """Validate a static edge."""
        required = ["edge_id", "source", "target", "predicate", "time_period"]
        for field in required:
            if field not in edge:
                self.errors.append(
                    ValidationError(f"{path}.{field}", f"Missing required field: {field}")
                )

        if "time_period" in edge:
            tp = edge["time_period"]
            if "start_frame" not in tp or "end_frame" not in tp:
                self.errors.append(
                    ValidationError(
                        f"{path}.time_period",
                        "time_period must have start_frame and end_frame",
                    )
                )

    def _validate_dynamic_edge(self, edge: dict, path: str) -> None:
        """Validate a dynamic edge with motion attributes."""
        self._validate_static_edge(edge, path)

        if "attributes" in edge:
            attrs = edge["attributes"]

            if "velocity" in attrs and attrs["velocity"] not in VALID_VELOCITY_VALUES:
                self.errors.append(
                    ValidationError(
                        f"{path}.attributes.velocity",
                        f"Invalid velocity: {attrs['velocity']}",
                        attrs["velocity"],
                    )
                )

            if "direction" in attrs and attrs["direction"] not in VALID_DIRECTION_VALUES:
                self.errors.append(
                    ValidationError(
                        f"{path}.attributes.direction",
                        f"Invalid direction: {attrs['direction']}",
                        attrs["direction"],
                    )
                )

            if (
                "trajectory" in attrs
                and attrs["trajectory"] not in VALID_TRAJECTORY_VALUES
            ):
                self.errors.append(
                    ValidationError(
                        f"{path}.attributes.trajectory",
                        f"Invalid trajectory: {attrs['trajectory']}",
                        attrs["trajectory"],
                    )
                )

    def _validate_fg_bg_edge(self, edge: dict, path: str) -> None:
        """Validate a foreground-background edge with group-level support."""
        required = ["edge_id", "source", "target", "predicate", "time_period"]
        for field in required:
            if field not in edge:
                self.errors.append(
                    ValidationError(f"{path}.{field}", f"Missing required field: {field}")
                )

        # Validate source/target are lists
        if "source" in edge and not isinstance(edge["source"], list):
            self.errors.append(
                ValidationError(
                    f"{path}.source",
                    "FG-BG edge source must be a list",
                )
            )

        if "target" in edge and not isinstance(edge["target"], list):
            self.errors.append(
                ValidationError(
                    f"{path}.target",
                    "FG-BG edge target must be a list",
                )
            )

    def _validate_static_scene_graph(self, ssg: dict) -> None:
        """Validate static scene graph section."""
        for i, node in enumerate(ssg.get("nodes", [])):
            self._validate_node(node, f"static_scene_graph.nodes[{i}]")

        for i, edge in enumerate(ssg.get("edges", [])):
            self._validate_static_edge(edge, f"static_scene_graph.edges[{i}]")

    def _validate_dynamic_scene_graph(self, dsg: dict) -> None:
        """Validate dynamic scene graph section."""
        for i, node in enumerate(dsg.get("nodes", [])):
            self._validate_node(node, f"dynamic_scene_graph.nodes[{i}]")

        for i, edge in enumerate(dsg.get("edges", [])):
            self._validate_dynamic_edge(edge, f"dynamic_scene_graph.edges[{i}]")

    def _validate_fg_bg_relations(self, fbr: dict) -> None:
        """Validate foreground-background relations section."""
        for i, edge in enumerate(fbr.get("edges", [])):
            self._validate_fg_bg_edge(edge, f"foreground_background_relations.edges[{i}]")

    def validate_predicate(self, predicate: str, edge_type: str) -> bool:
        """Validate a predicate for a given edge type."""
        if edge_type == "static":
            return predicate in SPATIAL_PREDICATES
        elif edge_type == "dynamic":
            return predicate in ACTION_PREDICATES
        elif edge_type == "fg_bg":
            return predicate in SPATIAL_PREDICATES
        return False

    def validate_motion_attributes(self, attrs: dict) -> list[str]:
        """Validate motion attributes and return list of invalid fields."""
        invalid = []

        if "velocity" in attrs and attrs["velocity"] not in VALID_VELOCITY_VALUES:
            invalid.append(f"velocity: {attrs['velocity']}")

        if "direction" in attrs and attrs["direction"] not in VALID_DIRECTION_VALUES:
            invalid.append(f"direction: {attrs['direction']}")

        if "trajectory" in attrs and attrs["trajectory"] not in VALID_TRAJECTORY_VALUES:
            invalid.append(f"trajectory: {attrs['trajectory']}")

        return invalid

    @staticmethod
    def get_valid_predicates(edge_type: str) -> list[str]:
        """Get valid predicates for an edge type."""
        if edge_type == "static":
            return SPATIAL_PREDICATES.copy()
        elif edge_type == "dynamic":
            return ACTION_PREDICATES.copy()
        elif edge_type == "fg_bg":
            return SPATIAL_PREDICATES.copy()
        return []

    @staticmethod
    def get_valid_motion_values() -> dict:
        """Get valid motion attribute values."""
        return {
            "velocity": VALID_VELOCITY_VALUES.copy(),
            "direction": VALID_DIRECTION_VALUES.copy(),
            "trajectory": VALID_TRAJECTORY_VALUES.copy(),
        }
