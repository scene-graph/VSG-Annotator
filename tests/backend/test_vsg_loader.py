"""Tests for VSG loader."""

import json
import tempfile
from pathlib import Path

import pytest

from backend.core.vsg_loader import VSGLoader, discover_samples


@pytest.fixture
def sample_vsg():
    """Create a sample VSG for testing."""
    return {
        "metadata": {
            "video_id": "test_video",
            "dataset": "test",
            "version": "Jan20",
            "total_frames": 100,
            "fps": 5,
            "resolution": {"width": 1920, "height": 1080},
            "schema_version": "Jan20"
        },
        "scene_info": {
            "category": ["indoor"],
            "transition_types": [],
            "scene_change_relations": [],
            "confidence": 0.9
        },
        "camera_motion": {
            "primary_motion": {
                "type": "static",
                "direction": "none",
                "steadiness": "stable",
                "intensity": "minimal"
            },
            "confidence": 0.5,
            "description": "Static camera"
        },
        "static_scene_graph": {
            "description": "Static objects",
            "nodes": [
                {
                    "node_id": "static_001",
                    "object_id": 1,
                    "category": "table",
                    "attributes": {
                        "visual": {"color": "brown", "texture": "smooth", "material": "wood"},
                        "physical": {"size": "large", "shape": "rectangular"}
                    },
                    "tracking": {
                        "bboxes_by_frame": {
                            "0": {"left": 100, "top": 200, "width": 300, "height": 150}
                        },
                        "masks_by_frame": {}
                    }
                }
            ],
            "edges": [
                {
                    "edge_id": "static_edge_001",
                    "source": "static_001",
                    "target": "static_002",
                    "source_category": "table",
                    "target_category": "floor",
                    "predicate": "on",
                    "confidence": 0.9,
                    "confidence_round1": 0.9,
                    "confidence_round2": 0.9,
                    "validated": True,
                    "extraction_round": 1,
                    "validation_reasoning_round1": "Table is on the floor",
                    "validation_reasoning_round2": "",
                    "time_period": {"start_frame": 0, "end_frame": 99}
                }
            ]
        },
        "dynamic_scene_graph": {
            "description": "Dynamic objects",
            "nodes": [
                {
                    "node_id": "dynamic_001",
                    "object_id": 1,
                    "category": "adult",
                    "attributes": {
                        "visual": {"color": "unknown", "texture": "unknown", "material": "unknown"},
                        "physical": {"size": "large", "shape": "humanoid"}
                    },
                    "tracking": {
                        "bboxes_by_frame": {
                            "0": {"left": 400, "top": 100, "width": 200, "height": 400}
                        },
                        "masks_by_frame": {}
                    }
                }
            ],
            "edges": [
                {
                    "edge_id": "dynamic_edge_001",
                    "source": "dynamic_001",
                    "target": "dynamic_002",
                    "source_category": "adult",
                    "target_category": "cup",
                    "predicate": "holding",
                    "confidence": 0.85,
                    "confidence_round1": 0.85,
                    "confidence_round2": 0.85,
                    "validated": True,
                    "extraction_round": 0,
                    "validation_reasoning_round1": "Adult holding cup",
                    "validation_reasoning_round2": "",
                    "attributes": {
                        "velocity": "stationary",
                        "direction": "none",
                        "trajectory": "stable"
                    },
                    "time_period": {"start_frame": 10, "end_frame": 50}
                }
            ]
        },
        "foreground_background_relations": {
            "description": "FG-BG relations",
            "edges": [
                {
                    "edge_id": "fg_bg_001",
                    "source": ["dynamic_001"],
                    "target": ["static_001"],
                    "source_category": ["adult"],
                    "target_category": ["table"],
                    "predicate": "standing_on",
                    "confidence": 0.8,
                    "confidence_round1": 0.8,
                    "confidence_round2": 0.8,
                    "validated": False,
                    "extraction_round": 1,
                    "validation_reasoning_round1": "Adult standing near table",
                    "validation_reasoning_round2": "",
                    "time_period": {"start_frame": 0, "end_frame": 99}
                }
            ]
        },
        "summary": {}
    }


@pytest.fixture
def vsg_file(sample_vsg, tmp_path):
    """Create a temporary VSG file."""
    vsg_path = tmp_path / "video_scene_graph_test.json"
    with open(vsg_path, "w") as f:
        json.dump(sample_vsg, f)
    return vsg_path


class TestVSGLoader:
    """Tests for VSGLoader class."""

    def test_load_vsg(self, vsg_file):
        """Test loading a VSG file."""
        loader = VSGLoader(vsg_file)
        data = loader.load()

        assert data["metadata"]["video_id"] == "test_video"
        assert data["metadata"]["total_frames"] == 100

    def test_metadata_properties(self, vsg_file):
        """Test metadata property access."""
        loader = VSGLoader(vsg_file)

        assert loader.video_id == "test_video"
        assert loader.dataset == "test"
        assert loader.total_frames == 100
        assert loader.fps == 5
        assert loader.resolution == {"width": 1920, "height": 1080}

    def test_get_static_nodes(self, vsg_file):
        """Test getting static nodes."""
        loader = VSGLoader(vsg_file)
        nodes = loader.get_static_nodes()

        assert len(nodes) == 1
        assert nodes[0]["node_id"] == "static_001"
        assert nodes[0]["category"] == "table"

    def test_get_dynamic_nodes(self, vsg_file):
        """Test getting dynamic nodes."""
        loader = VSGLoader(vsg_file)
        nodes = loader.get_dynamic_nodes()

        assert len(nodes) == 1
        assert nodes[0]["node_id"] == "dynamic_001"
        assert nodes[0]["category"] == "adult"

    def test_get_all_nodes(self, vsg_file):
        """Test getting all nodes as NodeResponse objects."""
        loader = VSGLoader(vsg_file)
        nodes = loader.get_all_nodes()

        assert len(nodes) == 2
        assert "static_001" in nodes
        assert "dynamic_001" in nodes

        static_node = nodes["static_001"]
        assert static_node.is_static is True
        assert static_node.category == "table"

        dynamic_node = nodes["dynamic_001"]
        assert dynamic_node.is_static is False
        assert dynamic_node.category == "adult"

    def test_get_static_edges(self, vsg_file):
        """Test getting static edges."""
        loader = VSGLoader(vsg_file)
        edges = loader.get_static_edges()

        assert len(edges) == 1
        assert edges[0]["edge_id"] == "static_edge_001"
        assert edges[0]["predicate"] == "on"

    def test_get_dynamic_edges(self, vsg_file):
        """Test getting dynamic edges."""
        loader = VSGLoader(vsg_file)
        edges = loader.get_dynamic_edges()

        assert len(edges) == 1
        assert edges[0]["edge_id"] == "dynamic_edge_001"
        assert edges[0]["predicate"] == "holding"
        assert edges[0]["attributes"]["velocity"] == "stationary"

    def test_get_fg_bg_edges(self, vsg_file):
        """Test getting FG-BG edges."""
        loader = VSGLoader(vsg_file)
        edges = loader.get_fg_bg_edges()

        assert len(edges) == 1
        assert edges[0]["edge_id"] == "fg_bg_001"
        assert edges[0]["predicate"] == "standing_on"
        assert edges[0]["source"] == ["dynamic_001"]
        assert edges[0]["target"] == ["static_001"]

    def test_get_all_edges(self, vsg_file):
        """Test getting all edges as EdgeResponse objects."""
        loader = VSGLoader(vsg_file)
        edges = loader.get_all_edges()

        assert len(edges) == 3

        edge_types = {e.edge_type for e in edges}
        assert edge_types == {"static", "dynamic", "fg_bg"}

        # Check dynamic edge has attributes
        dynamic_edge = next(e for e in edges if e.edge_type == "dynamic")
        assert dynamic_edge.attributes is not None
        assert dynamic_edge.attributes.velocity == "stationary"

    def test_get_edge_by_id(self, vsg_file):
        """Test getting a specific edge by ID."""
        loader = VSGLoader(vsg_file)

        edge = loader.get_edge_by_id("dynamic_edge_001")
        assert edge is not None
        assert edge.predicate == "holding"

        missing = loader.get_edge_by_id("nonexistent")
        assert missing is None

    def test_get_node_by_id(self, vsg_file):
        """Test getting a specific node by ID."""
        loader = VSGLoader(vsg_file)

        node = loader.get_node_by_id("static_001")
        assert node is not None
        assert node.category == "table"

        missing = loader.get_node_by_id("nonexistent")
        assert missing is None

    def test_get_summary(self, vsg_file):
        """Test getting VSG summary."""
        loader = VSGLoader(vsg_file)
        summary = loader.get_summary()

        assert summary["video_id"] == "test_video"
        assert summary["static_node_count"] == 1
        assert summary["dynamic_node_count"] == 1
        assert summary["static_edge_count"] == 1
        assert summary["dynamic_edge_count"] == 1
        assert summary["fg_bg_edge_count"] == 1
