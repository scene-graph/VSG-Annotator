#!/usr/bin/env python3
"""Convert PNG frames to JPEG (quality 85) to reduce dataset size.

Walks all */frames/*.png under the dataset directory, converts each to JPEG,
and deletes the original PNG after successful conversion.
Uses multiprocessing for parallelism.
"""

import os
import sys
from pathlib import Path
from multiprocessing import Pool, cpu_count
from PIL import Image


QUALITY = 85
# Override at the command line, e.g.:
#     DATASET_DIR=/path/to/data python scripts/convert_frames_to_jpg.py
DATASET_DIR = Path(os.environ.get("DATASET_DIR", "./data"))


def convert_one(png_path: str) -> tuple[str, bool, str]:
    """Convert a single PNG to JPEG. Returns (path, success, error_msg)."""
    try:
        jpg_path = png_path.rsplit(".", 1)[0] + ".jpg"
        with Image.open(png_path) as img:
            img = img.convert("RGB")
            img.save(jpg_path, "JPEG", quality=QUALITY)
        os.remove(png_path)
        return (png_path, True, "")
    except Exception as e:
        return (png_path, False, str(e))


def main():
    dataset_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DATASET_DIR

    # Collect all PNG files grouped by sample
    samples = {}
    for sample_dir in sorted(dataset_dir.iterdir()):
        frames_dir = sample_dir / "frames"
        if not frames_dir.is_dir():
            continue
        pngs = sorted(str(p) for p in frames_dir.glob("*.png"))
        if pngs:
            samples[sample_dir.name] = pngs

    total_files = sum(len(v) for v in samples.values())
    print(f"Found {total_files} PNG frames across {len(samples)} samples")

    if total_files == 0:
        print("Nothing to convert.")
        return

    workers = min(cpu_count(), 8)
    print(f"Using {workers} workers\n")

    converted = 0
    failed = 0

    for sample_name, pngs in samples.items():
        print(f"  {sample_name}: {len(pngs)} frames ... ", end="", flush=True)
        with Pool(workers) as pool:
            results = pool.map(convert_one, pngs)
        ok = sum(1 for _, s, _ in results if s)
        nok = sum(1 for _, s, _ in results if not s)
        converted += ok
        failed += nok
        status = "done" if nok == 0 else f"done ({nok} failed)"
        print(status)
        for path, success, err in results:
            if not success:
                print(f"    FAILED: {path}: {err}")

    print(f"\nFinished: {converted} converted, {failed} failed")


if __name__ == "__main__":
    main()
