"""Video service for frame extraction and video management."""

import os
from pathlib import Path
from typing import Optional

from backend.config import settings


class VideoService:
    """Service for video and frame operations."""

    def __init__(self, frames_path: str):
        """Initialize with path to frames directory."""
        self.frames_path = Path(frames_path)

    def get_frame_path(self, frame_idx: int) -> Optional[Path]:
        """Get the path to a specific frame image."""
        # Try common naming patterns
        patterns = [
            f"{frame_idx:04d}.png",
            f"{frame_idx:04d}.jpg",
            f"frame_{frame_idx:04d}.png",
            f"frame_{frame_idx:04d}.jpg",
            f"{frame_idx}.png",
            f"{frame_idx}.jpg",
        ]

        for pattern in patterns:
            path = self.frames_path / pattern
            if path.exists():
                return path

        return None

    def get_frame_count(self) -> int:
        """Count the number of frames in the directory."""
        if not self.frames_path.exists():
            return 0

        count = 0
        for ext in [".png", ".jpg", ".jpeg"]:
            count += len(list(self.frames_path.glob(f"*{ext}")))
        return count

    def list_frames(self) -> list[str]:
        """List all frame files."""
        if not self.frames_path.exists():
            return []

        frames = []
        for ext in [".png", ".jpg", ".jpeg"]:
            frames.extend([f.name for f in self.frames_path.glob(f"*{ext}")])

        # Sort by frame number
        frames.sort(key=lambda x: int(Path(x).stem.replace("frame_", "")))
        return frames

    def get_frame_range(self) -> tuple[int, int]:
        """Get the range of frame indices."""
        frames = self.list_frames()
        if not frames:
            return (0, 0)

        indices = []
        for f in frames:
            try:
                idx = int(Path(f).stem.replace("frame_", ""))
                indices.append(idx)
            except ValueError:
                continue

        if not indices:
            return (0, 0)

        return (min(indices), max(indices))


class FrameCache:
    """Simple frame path cache to avoid repeated filesystem lookups."""

    def __init__(self, max_size: int = 100):
        self.max_size = max_size
        self._cache: dict[str, Optional[Path]] = {}

    def get(self, key: str) -> Optional[Path]:
        """Get cached frame path."""
        return self._cache.get(key)

    def set(self, key: str, value: Optional[Path]) -> None:
        """Set cached frame path."""
        if len(self._cache) >= self.max_size:
            # Remove oldest entry
            oldest_key = next(iter(self._cache))
            del self._cache[oldest_key]
        self._cache[key] = value

    def clear(self) -> None:
        """Clear the cache."""
        self._cache.clear()


# Global frame cache
frame_cache = FrameCache()


def get_frame_for_video(video_id: str, frames_path: str, frame_idx: int) -> Optional[Path]:
    """Get frame path with caching."""
    cache_key = f"{video_id}:{frame_idx}"

    cached = frame_cache.get(cache_key)
    if cached is not None:
        return cached

    service = VideoService(frames_path)
    path = service.get_frame_path(frame_idx)

    frame_cache.set(cache_key, path)
    return path
