"""API routes package."""

from backend.api.routes.videos import router as videos_router
from backend.api.routes.edges import router as edges_router
from backend.api.routes.annotations import router as annotations_router
from backend.api.routes.export import router as export_router
from backend.api.routes.users import router as users_router

__all__ = [
    "videos_router",
    "edges_router",
    "annotations_router",
    "export_router",
    "users_router",
]
