"""Frame-to-MP4 clip helper for edge re-extraction.

Given the bboxes_by_frame of a set of source/target nodes, compute the
covisible frame range, stitch the corresponding frame images into a short
MP4 via ffmpeg, and return the clip as base64 for Gemini video input.

Kept in the viz backend (not the harness) per the zero-dependency
constraint — we read frame paths from the VSG loader's filesystem layout.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import shutil
import tempfile
from pathlib import Path
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

# Cap clip length. Longer videos swamp Gemini context, add latency, and
# rarely help resolve a predicate. 10s at 10fps ≈ 100 frames.
MAX_CLIP_FRAMES = 150


def covisible_span(bboxes_lists: Iterable[dict]) -> Optional[tuple[int, int]]:
    """Return [min_frame, max_frame] intersection of visibility.

    ``bboxes_lists`` is an iterable of ``bboxes_by_frame`` dicts from the
    nodes involved. The intersection is the frame range where *every*
    node has a visible bbox. Returns None when the nodes never co-appear.
    """
    frame_sets: list[set[int]] = []
    for bboxes in bboxes_lists:
        if not bboxes:
            return None
        frames = {int(f) for f in bboxes.keys()}
        if not frames:
            return None
        frame_sets.append(frames)
    if not frame_sets:
        return None
    shared = set.intersection(*frame_sets)
    if not shared:
        return None
    return min(shared), max(shared)


def _frame_file(frames_dir: Path, frame_idx: int) -> Optional[Path]:
    """Try common frame-name conventions (6-digit png/jpg, 4-digit jpg)."""
    for pattern in (f"{frame_idx:06d}.png", f"{frame_idx:06d}.jpg",
                     f"{frame_idx:04d}.jpg", f"{frame_idx:04d}.png"):
        p = frames_dir / pattern
        if p.exists():
            return p
    return None


async def clip_to_base64_mp4(
    frames_path: str,
    start_frame: int,
    end_frame: int,
    fps: int,
) -> Optional[str]:
    """Stitch [start_frame, end_frame] frame images into a short mp4.

    Returns base64-encoded mp4, or None if clipping fails (missing frames,
    ffmpeg error). Caps the span at ``MAX_CLIP_FRAMES`` — if the covisible
    window is longer, we subsample uniformly so Gemini still sees the full
    arc without blowing up context.
    """
    frames_dir = Path(frames_path)
    if not frames_dir.exists():
        logger.warning("clip_to_base64_mp4: frames dir missing: %s", frames_dir)
        return None

    span = end_frame - start_frame + 1
    if span <= 0:
        return None

    # Uniform subsample to stay within MAX_CLIP_FRAMES
    if span > MAX_CLIP_FRAMES:
        step = span / MAX_CLIP_FRAMES
        picked = [int(start_frame + i * step) for i in range(MAX_CLIP_FRAMES)]
    else:
        picked = list(range(start_frame, end_frame + 1))

    with tempfile.TemporaryDirectory(prefix="reextract_clip_") as tmp:
        tmp_dir = Path(tmp)
        # Copy / link frames with a sequential naming so ffmpeg can read
        # them as an image sequence regardless of the source indices.
        for i, frame_idx in enumerate(picked):
            src = _frame_file(frames_dir, frame_idx)
            if src is None:
                logger.debug("clip: missing frame %s", frame_idx)
                continue
            dst = tmp_dir / f"{i:06d}{src.suffix}"
            try:
                dst.symlink_to(src)
            except OSError:
                shutil.copyfile(src, dst)

        # Determine suffix from first available frame (ffmpeg input glob
        # needs a consistent extension).
        existing = sorted(tmp_dir.glob("*.*"))
        if not existing:
            logger.warning("clip: no frames available in %s", frames_dir)
            return None
        suffix = existing[0].suffix

        out_path = tmp_dir / "clip.mp4"
        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-framerate", str(max(1, fps)),
            "-i", str(tmp_dir / f"%06d{suffix}"),
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            str(out_path),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        _, err = await proc.communicate()
        if proc.returncode != 0 or not out_path.exists():
            logger.warning("ffmpeg failed (%s): %s", proc.returncode, err.decode(errors="ignore"))
            return None

        data = out_path.read_bytes()
        if not data:
            return None
        return base64.b64encode(data).decode("ascii")
