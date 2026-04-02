"""Application configuration."""

from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings

# Resolve .env relative to this file's parent (project root)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _PROJECT_ROOT / ".env"


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

    # Unified AI API key (bd.ctis.site proxy)
    api_key: str = Field("", alias="API_KEY")

    # Multi-provider AI Configuration
    ai_default_provider: str = "gemini"

    openai_api_url: str = "https://bd.ctis.site/v1/chat/completions"
    openai_model: str = "gpt-5.2"
    openai_max_tokens: int = 1024
    openai_temperature: float = 0.6

    gemini_api_url: str = "https://bd.ctis.site/v1"
    gemini_model: str = "google/gemini-3-flash-preview"
    gemini_max_tokens: int = 2048
    gemini_temperature: float = 0.6

    # AI HTTP client timeouts (seconds)
    ai_http_connect_timeout_s: float = 5.0
    ai_http_read_timeout_s: float = 25.0
    ai_http_write_timeout_s: float = 25.0
    ai_http_pool_timeout_s: float = 5.0

    class Config:
        env_file = str(_ENV_FILE)
        env_file_encoding = "utf-8"
        populate_by_name = True


settings = Settings()
