#!/usr/bin/env python3
"""Pre-cache all video frames as JPG for faster playback."""

import sys
from pathlib import Path

# Add SGG_Visualization to path for imports
script_dir = Path(__file__).resolve().parent
backend_dir = script_dir.parent
sgg_viz_dir = backend_dir.parent
sys.path.insert(0, str(sgg_viz_dir))

from backend.config import settings
from backend.services.video_service import DiskFrameCache


def main():
    """Cache all video frames from pvsg_mini to the frame cache."""
    videos_path = settings.pvsg_mini_path
    cache = DiskFrameCache(settings.frame_cache_path)

    print(f"Source: {videos_path}")
    print(f"Cache:  {settings.frame_cache_path}")
    print()

    if not videos_path.exists():
        print(f"Error: Videos path does not exist: {videos_path}")
        sys.exit(1)

    video_dirs = sorted([d for d in videos_path.iterdir() if d.is_dir()])
    print(f"Found {len(video_dirs)} videos to cache")
    print()

    total_frames = 0
    for i, video_dir in enumerate(video_dirs, 1):
        video_id = video_dir.name
        frames_path = video_dir / "frames"

        if not frames_path.exists():
            print(f"[{i}/{len(video_dirs)}] Skipping {video_id}: no frames directory")
            continue

        print(f"[{i}/{len(video_dirs)}] Caching {video_id}...")
        frames_cached = cache.warm_cache_sync(video_id, str(frames_path))
        total_frames += frames_cached

    print()
    print(f"Done! Cached {total_frames} total frames.")

    # Show cache status
    status = cache.get_status()
    print(f"Cache size: {status['total_size_mb']:.1f} MB")


if __name__ == "__main__":
    main()
