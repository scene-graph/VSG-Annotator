#!/usr/bin/env python3
"""Cache management script for frame disk cache.

Usage:
    python scripts/cache_manager.py --status           # Show cache status
    python scripts/cache_manager.py --warm <video_id>  # Pre-cache frames for a video
    python scripts/cache_manager.py --clear <video_id> # Clear cache for a video
    python scripts/cache_manager.py --clear-all        # Clear entire cache
"""

import argparse
import shutil
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.config import settings


def get_cache_path() -> Path:
    """Get the frame cache path from settings."""
    return settings.frame_cache_path


def get_status() -> None:
    """Display cache status information."""
    cache_path = get_cache_path()

    if not cache_path.exists():
        print(f"Cache directory does not exist: {cache_path}")
        print("Cache is empty.")
        return

    total_size = 0
    video_count = 0
    total_frames = 0

    print(f"Cache path: {cache_path}")
    print(f"Cache enabled: {settings.frame_cache_enabled}")
    print("-" * 60)

    for video_dir in sorted(cache_path.iterdir()):
        if video_dir.is_dir():
            video_count += 1
            frames_dir = video_dir / "frames"
            if frames_dir.exists():
                frame_files = list(frames_dir.glob("*"))
                frame_count = len(frame_files)
                size = sum(f.stat().st_size for f in frame_files if f.is_file())
                total_size += size
                total_frames += frame_count
                size_mb = size / (1024 * 1024)
                print(f"  {video_dir.name}: {frame_count} frames, {size_mb:.2f} MB")

    print("-" * 60)
    print(f"Total: {video_count} videos, {total_frames} frames, {total_size / (1024 * 1024):.2f} MB")


def warm_cache(video_id: str) -> None:
    """Pre-cache all frames for a video."""
    # Need to get frames_path from database
    import asyncio
    from sqlalchemy import select
    from backend.models.database import Video, async_session

    async def _warm():
        async with async_session() as session:
            result = await session.execute(
                select(Video).where(Video.video_id == video_id)
            )
            video = result.scalar_one_or_none()

            if video is None:
                print(f"Error: Video not found: {video_id}")
                return False

            frames_path = Path(video.frames_path)
            if not frames_path.exists():
                print(f"Error: Frames path does not exist: {frames_path}")
                return False

            cache_path = get_cache_path() / video_id / "frames"
            cache_path.mkdir(parents=True, exist_ok=True)

            print(f"Caching frames from: {frames_path}")
            print(f"Caching to: {cache_path}")

            frame_count = 0
            for ext in [".png", ".jpg", ".jpeg"]:
                for src_file in sorted(frames_path.glob(f"*{ext}")):
                    dest_file = cache_path / src_file.name
                    if not dest_file.exists():
                        shutil.copy2(src_file, dest_file)
                        frame_count += 1
                        if frame_count % 100 == 0:
                            print(f"  Cached {frame_count} frames...")

            print(f"Done! Cached {frame_count} frames for {video_id}")
            return True

    asyncio.run(_warm())


def clear_video(video_id: str) -> None:
    """Clear cache for a specific video."""
    cache_path = get_cache_path() / video_id

    if not cache_path.exists():
        print(f"No cache found for video: {video_id}")
        return

    shutil.rmtree(cache_path)
    print(f"Cleared cache for video: {video_id}")


def clear_all() -> None:
    """Clear the entire cache."""
    cache_path = get_cache_path()

    if not cache_path.exists():
        print("Cache directory does not exist. Nothing to clear.")
        return

    count = 0
    for video_dir in cache_path.iterdir():
        if video_dir.is_dir():
            shutil.rmtree(video_dir)
            count += 1

    print(f"Cleared cache for {count} videos.")


def main():
    parser = argparse.ArgumentParser(
        description="Manage the frame disk cache",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--status", action="store_true", help="Show cache status")
    group.add_argument("--warm", metavar="VIDEO_ID", help="Pre-cache frames for a video")
    group.add_argument("--clear", metavar="VIDEO_ID", help="Clear cache for a video")
    group.add_argument("--clear-all", action="store_true", help="Clear entire cache")

    args = parser.parse_args()

    if args.status:
        get_status()
    elif args.warm:
        warm_cache(args.warm)
    elif args.clear:
        clear_video(args.clear)
    elif args.clear_all:
        response = input("Are you sure you want to clear the entire cache? [y/N] ")
        if response.lower() == "y":
            clear_all()
        else:
            print("Aborted.")


if __name__ == "__main__":
    main()
