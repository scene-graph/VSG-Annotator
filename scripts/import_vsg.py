#!/usr/bin/env python3
"""Import VSG files from pvsg_mini into the database."""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select

from backend.config import settings
from backend.core.vsg_loader import VSGLoader, discover_samples
from backend.models.database import Video, async_session, init_db


async def import_sample(sample: dict) -> bool:
    """Import a single sample into the database."""
    async with async_session() as session:
        # Check if already imported
        result = await session.execute(
            select(Video).where(Video.video_id == sample["video_id"])
        )
        existing = result.scalar_one_or_none()

        if existing is not None:
            print(f"  Skipping {sample['video_id']} (already imported)")
            return False

        # Load VSG to get metadata
        loader = VSGLoader(sample["vsg_path"])
        metadata = loader.metadata
        resolution = loader.resolution

        # Create video record
        video = Video(
            video_id=sample["video_id"],
            vsg_path=sample["vsg_path"],
            frames_path=sample["frames_path"],
            masks_path=sample.get("masks_path"),
            dataset=sample.get("source_tag") or metadata.get("dataset"),
            status="pending",
            total_frames=metadata.get("total_frames"),
            fps=metadata.get("fps"),
            resolution_width=resolution.get("width"),
            resolution_height=resolution.get("height"),
        )

        session.add(video)
        await session.commit()

        print(f"  Imported {sample['video_id']}")
        return True


async def main():
    """Main import function."""
    print("Initializing database...")
    await init_db()

    print(f"\nDiscovering samples in {settings.pvsg_mini_path}...")
    samples = discover_samples(settings.pvsg_mini_path)

    if not samples:
        print("No samples found!")
        return

    print(f"Found {len(samples)} samples\n")

    imported = 0
    skipped = 0

    for sample in samples:
        if await import_sample(sample):
            imported += 1
        else:
            skipped += 1

    print(f"\nDone! Imported: {imported}, Skipped: {skipped}")


if __name__ == "__main__":
    asyncio.run(main())
