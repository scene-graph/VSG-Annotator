"""Video service for frame extraction and video management."""

import logging
import shutil
import threading
from pathlib import Path
from typing import Optional

from PIL import Image

from backend.config import settings

# JPEG quality for cached frames (85 is good quality/size balance)
JPEG_QUALITY = 85

logger = logging.getLogger(__name__)


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


class DiskFrameCache:
    """Disk-based frame cache for fast playback.

    Copies frames to fast local storage for faster access during playback.
    Supports eager pre-caching in background threads.
    """

    def __init__(self, cache_path: Path):
        self.cache_path = cache_path
        self.cache_path.mkdir(parents=True, exist_ok=True)
        self._warming_threads: dict[str, threading.Thread] = {}
        self._warming_lock = threading.Lock()

    def get_video_cache_path(self, video_id: str) -> Path:
        """Get the cache directory for a video."""
        return self.cache_path / video_id / "frames"

    def is_cached(self, video_id: str) -> bool:
        """Check if a video has been cached."""
        cache_dir = self.get_video_cache_path(video_id)
        return cache_dir.exists() and any(cache_dir.iterdir())

    def is_warming(self, video_id: str) -> bool:
        """Check if cache is currently being warmed for a video."""
        with self._warming_lock:
            thread = self._warming_threads.get(video_id)
            return thread is not None and thread.is_alive()

    def get_cached_frame(self, video_id: str, frame_idx: int) -> Optional[Path]:
        """Get a cached frame if it exists."""
        cache_dir = self.get_video_cache_path(video_id)

        # Check JPG first (preferred), then PNG
        patterns = [
            f"{frame_idx:04d}.jpg",  # JPG first (smaller, faster)
            f"{frame_idx:04d}.png",
            f"frame_{frame_idx:04d}.jpg",
            f"frame_{frame_idx:04d}.png",
        ]

        for pattern in patterns:
            cached_path = cache_dir / pattern
            if cached_path.exists():
                return cached_path

        return None

    def cache_frame(self, video_id: str, source_path: Path) -> Path:
        """Cache a single frame, converting PNG to JPG for faster loading."""
        cache_dir = self.get_video_cache_path(video_id)
        cache_dir.mkdir(parents=True, exist_ok=True)

        # Always save as JPG for faster loading
        dest_path = cache_dir / f"{source_path.stem}.jpg"
        if not dest_path.exists():
            with Image.open(source_path) as img:
                # Convert RGBA/P modes to RGB for JPEG
                if img.mode in ('RGBA', 'P'):
                    img = img.convert('RGB')
                img.save(dest_path, 'JPEG', quality=JPEG_QUALITY, optimize=True)

        return dest_path

    def warm_cache(self, video_id: str, frames_path: str) -> None:
        """Pre-cache all frames for a video in a background thread."""
        if self.is_cached(video_id) or self.is_warming(video_id):
            logger.info(f"Cache already warm or warming for {video_id}")
            return

        def _warm():
            try:
                source_dir = Path(frames_path)
                if not source_dir.exists():
                    logger.warning(f"Frames path does not exist: {frames_path}")
                    return

                # Convert and cache all frames
                frame_count = 0
                for ext in [".png", ".jpg", ".jpeg"]:
                    for src_file in sorted(source_dir.glob(f"*{ext}")):
                        self.cache_frame(video_id, src_file)
                        frame_count += 1

                logger.info(f"Cached {frame_count} frames for {video_id}")
            except Exception as e:
                logger.error(f"Error warming cache for {video_id}: {e}")
            finally:
                with self._warming_lock:
                    self._warming_threads.pop(video_id, None)

        with self._warming_lock:
            if video_id not in self._warming_threads:
                thread = threading.Thread(target=_warm, daemon=True)
                self._warming_threads[video_id] = thread
                thread.start()
                logger.info(f"Started cache warming for {video_id}")

    def warm_cache_sync(self, video_id: str, frames_path: str) -> int:
        """Synchronously cache all frames (for CLI use).

        Returns the number of frames cached.
        """
        source_dir = Path(frames_path)
        if not source_dir.exists():
            return 0

        frame_count = 0
        for ext in [".png", ".jpg", ".jpeg"]:
            for src_file in sorted(source_dir.glob(f"*{ext}")):
                self.cache_frame(video_id, src_file)
                frame_count += 1
                if frame_count % 20 == 0:
                    print(f"  {frame_count} frames cached...")

        print(f"  Total: {frame_count} frames")
        return frame_count

    def clear_video(self, video_id: str) -> bool:
        """Clear cache for a specific video."""
        video_cache = self.cache_path / video_id
        if video_cache.exists():
            shutil.rmtree(video_cache)
            logger.info(f"Cleared cache for {video_id}")
            return True
        return False

    def clear_all(self) -> int:
        """Clear the entire cache. Returns count of cleared videos."""
        count = 0
        for video_dir in self.cache_path.iterdir():
            if video_dir.is_dir():
                shutil.rmtree(video_dir)
                count += 1
        logger.info(f"Cleared cache for {count} videos")
        return count

    def get_status(self) -> dict:
        """Get cache status information."""
        total_size = 0
        video_count = 0
        video_info = {}

        for video_dir in self.cache_path.iterdir():
            if video_dir.is_dir():
                video_count += 1
                frames_dir = video_dir / "frames"
                if frames_dir.exists():
                    frame_files = list(frames_dir.glob("*"))
                    frame_count = len(frame_files)
                    size = sum(f.stat().st_size for f in frame_files if f.is_file())
                    total_size += size
                    video_info[video_dir.name] = {
                        "frame_count": frame_count,
                        "size_mb": round(size / (1024 * 1024), 2),
                    }

        return {
            "cache_path": str(self.cache_path),
            "video_count": video_count,
            "total_size_mb": round(total_size / (1024 * 1024), 2),
            "videos": video_info,
        }


# Global disk frame cache (initialized if enabled in settings)
disk_frame_cache: Optional[DiskFrameCache] = None

def get_disk_frame_cache() -> Optional[DiskFrameCache]:
    """Get or initialize the disk frame cache."""
    global disk_frame_cache
    if settings.frame_cache_enabled and disk_frame_cache is None:
        disk_frame_cache = DiskFrameCache(settings.frame_cache_path)
    return disk_frame_cache if settings.frame_cache_enabled else None


def get_frame_for_video(video_id: str, frames_path: str, frame_idx: int) -> Optional[Path]:
    """Get frame path with caching (disk cache first, then memory cache)."""
    # Try disk cache first if enabled
    cache = get_disk_frame_cache()
    if cache is not None:
        cached_frame = cache.get_cached_frame(video_id, frame_idx)
        if cached_frame is not None:
            return cached_frame

        # Trigger background cache warming if not already cached/warming
        if not cache.is_cached(video_id) and not cache.is_warming(video_id):
            cache.warm_cache(video_id, frames_path)

    # Fall back to memory cache for path lookup
    cache_key = f"{video_id}:{frame_idx}"

    cached = frame_cache.get(cache_key)
    if cached is not None:
        # If disk cache exists, copy to cache on access
        if cache is not None and cached.exists():
            return cache.cache_frame(video_id, cached)
        return cached

    service = VideoService(frames_path)
    path = service.get_frame_path(frame_idx)

    frame_cache.set(cache_key, path)

    # Copy to disk cache if enabled
    if cache is not None and path is not None and path.exists():
        return cache.cache_frame(video_id, path)

    return path
