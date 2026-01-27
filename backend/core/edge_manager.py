"""Edge manager for filtering and processing edges."""

from typing import Optional

from backend.models.schemas import EdgeFilterParams, EdgeResponse


class EdgeManager:
    """Manage edge filtering and validation."""

    def __init__(self, edges: list[EdgeResponse]):
        """Initialize with a list of edges."""
        self.edges = edges

    def filter(self, params: EdgeFilterParams) -> list[EdgeResponse]:
        """Filter edges based on parameters."""
        filtered = self.edges

        # Filter by edge type
        if params.edge_type is not None:
            filtered = [e for e in filtered if e.edge_type == params.edge_type]

        # Filter by confidence range
        if params.min_confidence is not None:
            filtered = [e for e in filtered if e.confidence >= params.min_confidence]

        if params.max_confidence is not None:
            filtered = [e for e in filtered if e.confidence <= params.max_confidence]

        # Filter by validation status
        if params.validated is not None:
            filtered = [e for e in filtered if e.validated == params.validated]

        # Filter by extraction round
        if params.extraction_round is not None:
            filtered = [e for e in filtered if e.extraction_round == params.extraction_round]

        # Filter by predicate
        if params.predicate is not None:
            filtered = [e for e in filtered if e.predicate == params.predicate]

        # Filter by frame (edges active at this frame)
        if params.frame is not None:
            filtered = [
                e
                for e in filtered
                if e.time_period.start_frame <= params.frame <= e.time_period.end_frame
            ]

        return filtered

    def get_by_id(self, edge_id: str) -> Optional[EdgeResponse]:
        """Get an edge by its ID."""
        for edge in self.edges:
            if edge.edge_id == edge_id:
                return edge
        return None

    def get_by_type(self, edge_type: str) -> list[EdgeResponse]:
        """Get all edges of a specific type."""
        return [e for e in self.edges if e.edge_type == edge_type]

    def get_edges_for_node(self, node_id: str) -> list[EdgeResponse]:
        """Get all edges connected to a specific node."""
        result = []
        for edge in self.edges:
            # Handle both string and list sources/targets
            sources = (
                edge.source if isinstance(edge.source, list) else [edge.source]
            )
            targets = (
                edge.target if isinstance(edge.target, list) else [edge.target]
            )

            if node_id in sources or node_id in targets:
                result.append(edge)

        return result

    def get_edges_at_frame(self, frame: int) -> list[EdgeResponse]:
        """Get all edges active at a specific frame."""
        return [
            e
            for e in self.edges
            if e.time_period.start_frame <= frame <= e.time_period.end_frame
        ]

    def get_unique_predicates(self) -> list[str]:
        """Get list of unique predicates."""
        predicates = set()
        for edge in self.edges:
            predicates.add(edge.predicate)
        return sorted(predicates)

    def get_stats(self) -> dict:
        """Get statistics about the edges."""
        return {
            "total": len(self.edges),
            "static": len([e for e in self.edges if e.edge_type == "static"]),
            "dynamic": len([e for e in self.edges if e.edge_type == "dynamic"]),
            "fg_bg": len([e for e in self.edges if e.edge_type == "fg_bg"]),
            "validated": len([e for e in self.edges if e.validated]),
            "not_validated": len([e for e in self.edges if not e.validated]),
            "pvsg_gt": len([e for e in self.edges if e.extraction_round == 0]),
            "gpt_extracted": len([e for e in self.edges if e.extraction_round == 1]),
            "unique_predicates": self.get_unique_predicates(),
        }
