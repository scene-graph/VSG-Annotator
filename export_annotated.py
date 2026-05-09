#!/usr/bin/env python3
"""Export all annotated video scene graphs to a target directory.

Usage:
    python export_annotated.py [--output-dir /home/jtu9/sgg/annotated]
                               [--status completed in_progress]
                               [--include-rejected]
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Ensure backend imports work
sys.path.insert(0, str(Path(__file__).resolve().parent))

from backend.config import settings
from backend.core.vsg_loader import VSGLoader
from backend.models.database import Video, EdgeRevision, NodeRevision, async_session, init_db
from backend.services.export_service import ExportService
from sqlalchemy import select, func


async def get_videos_with_annotations(statuses: list[str]) -> list[dict]:
    """Get all videos that have annotations, filtered by status."""
    async with async_session() as session:
        # Get videos with the requested statuses
        result = await session.execute(
            select(Video).where(Video.status.in_(statuses)).order_by(Video.video_id)
        )
        videos = result.scalars().all()

        video_infos = []
        for v in videos:
            # Count edge revisions
            edge_count_result = await session.execute(
                select(func.count(EdgeRevision.id)).where(EdgeRevision.video_id == v.id)
            )
            edge_count = edge_count_result.scalar() or 0

            # Count node revisions
            node_count_result = await session.execute(
                select(func.count(NodeRevision.id)).where(NodeRevision.video_id == v.id)
            )
            node_count = node_count_result.scalar() or 0

            video_infos.append({
                "db_id": v.id,
                "video_id": v.video_id,
                "vsg_path": v.vsg_path,
                "frames_path": v.frames_path,
                "status": v.status,
                "dataset": v.dataset,
                "edge_revisions": edge_count,
                "node_revisions": node_count,
                "total_revisions": edge_count + node_count,
            })

        return video_infos


async def export_video(video_id: str, vsg_path: str, output_path: Path,
                       include_rejected: bool = False) -> dict:
    """Export a single video's annotated VSG."""
    async with async_session() as session:
        loader = VSGLoader(vsg_path)
        export_service = ExportService(session, loader, video_id)
        vsg = await export_service.export(
            include_rejected=include_rejected,
            apply_modifications=True,
        )
        summary = await export_service.get_revision_summary()
        return vsg, summary


async def main():
    parser = argparse.ArgumentParser(description="Export annotated video scene graphs")
    parser.add_argument(
        "--output-dir", type=str,
        default="/home/jtu9/sgg/annotated",
        help="Output directory for exported VSGs",
    )
    parser.add_argument(
        "--status", nargs="+",
        default=["completed", "in_progress"],
        help="Video statuses to export (default: completed in_progress)",
    )
    parser.add_argument(
        "--include-rejected", action="store_true",
        help="Include rejected edges in export (marked with human_rejected=True)",
    )
    parser.add_argument(
        "--only-with-annotations", action="store_true", default=True,
        help="Only export videos that have at least one revision",
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Initialize database
    await init_db()

    # Get videos
    print(f"Querying videos with status: {args.status}")
    videos = await get_videos_with_annotations(args.status)

    if args.only_with_annotations:
        videos = [v for v in videos if v["total_revisions"] > 0]

    print(f"\nFound {len(videos)} videos to export:")
    print(f"{'Video ID':<55} {'Status':<13} {'Dataset':<15} {'Edge Rev':<10} {'Node Rev':<10}")
    print("-" * 103)
    for v in videos:
        print(f"{v['video_id']:<55} {v['status']:<13} {v['dataset'] or 'unknown':<15} "
              f"{v['edge_revisions']:<10} {v['node_revisions']:<10}")

    # Export each video
    print(f"\nExporting to: {output_dir}")
    exported = 0
    failed = 0
    manifest = []

    for v in videos:
        video_id = v["video_id"]
        vsg_path = v["vsg_path"]

        # Check that VSG file exists
        if not Path(vsg_path).exists():
            print(f"  SKIP {video_id}: VSG file not found at {vsg_path}")
            failed += 1
            continue

        try:
            vsg, summary = await export_video(
                video_id, vsg_path, output_dir,
                include_rejected=args.include_rejected,
            )

            # Save to output directory
            out_file = output_dir / f"{video_id}.json"
            with open(out_file, "w") as f:
                json.dump(vsg, f, indent=2, default=str)

            file_size_kb = out_file.stat().st_size / 1024
            print(f"  OK   {video_id} -> {out_file.name} ({file_size_kb:.1f} KB) "
                  f"[{summary.get('total', 0)} revisions]")
            exported += 1

            manifest.append({
                "video_id": video_id,
                "dataset": v["dataset"],
                "status": v["status"],
                "file": out_file.name,
                "edge_revisions": v["edge_revisions"],
                "node_revisions": v["node_revisions"],
                "revision_summary": summary,
                "export_summary": vsg.get("summary", {}),
            })

        except Exception as e:
            print(f"  FAIL {video_id}: {e}")
            failed += 1

    # Save manifest
    manifest_path = output_dir / "export_manifest.json"
    with open(manifest_path, "w") as f:
        json.dump({
            "exported_at": str(asyncio.get_event_loop().time()),
            "total_exported": exported,
            "total_failed": failed,
            "statuses": args.status,
            "include_rejected": args.include_rejected,
            "videos": manifest,
        }, f, indent=2, default=str)

    print(f"\nDone! Exported {exported} videos, {failed} failed.")
    print(f"Manifest saved to: {manifest_path}")


if __name__ == "__main__":
    asyncio.run(main())
