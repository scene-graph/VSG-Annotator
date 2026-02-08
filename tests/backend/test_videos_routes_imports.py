from backend.api.routes import videos
from backend.models.schemas import NodePhysicalAttributes, NodeVisualAttributes


def test_video_routes_imports_node_attribute_schemas():
    assert videos.NodeVisualAttributes is NodeVisualAttributes
    assert videos.NodePhysicalAttributes is NodePhysicalAttributes
