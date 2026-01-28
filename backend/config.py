"""Application configuration."""

from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Application
    app_name: str = "SGG Visualization"
    debug: bool = False

    # Database
    database_url: str = "sqlite+aiosqlite:///./sgg_visualization.db"

    # Paths
    pvsg_mini_path: Path = Path("/home/jtu9/sgg/VideoSGG_AnyGran/examples/pvsg_mini")

    # API
    api_prefix: str = "/api"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Frame Cache
    frame_cache_path: Path = Path("/srv/local/shared/temp/tmp1/jtu9/cache/sgg_frames")
    frame_cache_enabled: bool = True

    # Pagination
    default_page_size: int = 50
    max_page_size: int = 200

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
