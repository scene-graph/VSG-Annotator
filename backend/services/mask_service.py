"""Panoptic mask service — supports two mask formats:

Format A (ego4d, epic_kitchen, vidor):
  masks/0000.png — paletted PNG (mode P, uint8), pixel = object_id

Format B (cityscapes_vps):
  masks/metadata.json — {objects: [{object_id, category, is_thing, color_hex}]}
  masks/composite/XXXX.png — 16-bit PNG (mode I;16), pixel = cat_id*1000 + inst_id
  masks/objects/{object_id}/XXXX.png — binary mask per object (mode L, 0/255)
"""

import json
import logging
from pathlib import Path
from typing import Any, Optional

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

# Cityscapes VPS category ID → name mapping
_CITYSCAPES_CATEGORIES = {
    0: "road", 1: "sidewalk", 2: "building", 3: "wall", 4: "fence",
    5: "pole", 6: "traffic light", 7: "traffic sign", 8: "vegetation",
    9: "terrain", 10: "sky", 11: "person", 12: "rider", 13: "car",
    14: "truck", 15: "bus", 16: "train", 17: "motorcycle", 18: "bicycle",
}
_CITYSCAPES_THING_IDS = {11, 12, 13, 14, 15, 16, 17, 18}


def _detect_format(masks_path: Path) -> str:
    """Detect which mask format a directory uses.

    Returns:
      'palette'   — Format A: paletted PNGs (mode P, uint8), pixel = object_id
      'composite' — Format B: metadata.json + composite/ + objects/
      'step_rgb'  — Format C: 3-channel RGB PNGs (KITTI-STEP, MOTChallenge-STEP)
                     R=semantic_id, G*256+B=instance_id
      'waymo'     — Format D: uint16 PNGs (Waymo PVPS)
                     semantic=pixel//1000, instance=pixel%1000
    """
    if (masks_path / "metadata.json").exists() and (masks_path / "composite").is_dir():
        return "composite"

    # Sample a mask file to detect RGB vs palette vs uint16
    mask_files = sorted(masks_path.glob("*.png"))
    if mask_files:
        img = Image.open(mask_files[0])
        if img.mode == "RGB":
            return "step_rgb"
        if img.mode in ("I;16", "I"):
            return "waymo"
        # Check if uint16 stored as 2-channel or grayscale
        arr = np.array(img)
        if arr.ndim == 2 and arr.dtype in (np.uint16, np.int32):
            return "waymo"

    return "palette"


class PanopticMaskService:
    """Unified mask service that auto-detects and handles both formats."""

    _synthetic_nodes_cache: dict[str, list[dict[str, Any]]] = {}  # class-level cache by masks_path

    def __init__(self, masks_path: str):
        self._masks_path = Path(masks_path)
        self._format = _detect_format(self._masks_path)
        self._palette: Optional[list[int]] = None
        self._metadata_cache: Optional[dict] = None
        logger.debug("Mask format for %s: %s", masks_path, self._format)

    @property
    def masks_path(self) -> Path:
        return self._masks_path

    @property
    def format(self) -> str:
        return self._format

    def has_masks(self) -> bool:
        if self._format == "composite":
            return any((self._masks_path / "composite").glob("*.png"))
        return any(self._masks_path.glob("*.png"))

    def get_mask_path(self, frame_idx: int) -> Optional[Path]:
        """Return path to the serveable mask file for a given frame."""
        if self._format == "composite":
            p = self._masks_path / "composite" / f"{frame_idx:04d}.png"
            return p if p.exists() else None

        # Try multiple naming patterns
        for pattern in [
            f"{frame_idx:04d}.png",
            f"{frame_idx:06d}.png",
            # 1-indexed (MOTChallenge: frame 0 -> 000001.png)
            f"{frame_idx + 1:06d}.png",
            f"{frame_idx + 1:04d}.png",
        ]:
            p = self._masks_path / pattern
            if p.exists():
                return p

        # Waymo: masks are at half the video frame rate (frame i -> mask i//2)
        if self._format == "waymo":
            mask_idx = frame_idx // 2
            for pattern in [f"{mask_idx:04d}.png", f"{mask_idx:06d}.png"]:
                p = self._masks_path / pattern
                if p.exists():
                    return p

        return None

    def get_total_frames(self) -> int:
        if self._format == "composite":
            return len(list((self._masks_path / "composite").glob("*.png")))
        return len(list(self._masks_path.glob("*.png")))

    # ── Format A (palette) helpers ─────────────────────────────────────

    def _load_palette(self) -> list[int]:
        if self._palette is not None:
            return self._palette
        for p in sorted(self._masks_path.glob("*.png")):
            img = Image.open(p)
            if img.mode == "P":
                self._palette = img.getpalette() or []
                return self._palette
        self._palette = []
        return self._palette

    def get_palette_map(self) -> dict[int, str]:
        """Return {object_id: '#rrggbb'} for palette format."""
        palette = self._load_palette()
        result: dict[int, str] = {}
        for i in range(256):
            idx = i * 3
            if idx + 2 < len(palette):
                r, g, b = palette[idx], palette[idx + 1], palette[idx + 2]
                result[i] = f"#{r:02x}{g:02x}{b:02x}"
        return result

    # ── Format B (composite) helpers ───────────────────────────────────

    def _load_composite_metadata(self) -> dict:
        """Load metadata.json for composite format."""
        if self._metadata_cache is not None:
            return self._metadata_cache
        meta_path = self._masks_path / "metadata.json"
        if meta_path.exists():
            self._metadata_cache = json.loads(meta_path.read_text())
        else:
            self._metadata_cache = {"objects": []}
        return self._metadata_cache

    @staticmethod
    def _decode_composite_id(pixel_val: int) -> tuple[int, int]:
        """Decode a cityscapes composite pixel value → (cat_id, inst_id)."""
        return pixel_val // 1000, pixel_val % 1000

    # ── Unified API ────────────────────────────────────────────────────

    def get_metadata(self, vsg_nodes: list[dict[str, Any]]) -> dict[str, Any]:
        """Build metadata from whichever format is present."""
        if not self.has_masks():
            return {"has_masks": False, "objects": [], "total_frames": 0,
                    "palette": {}, "mask_format": self._format}

        if self._format == "composite":
            return self._get_metadata_composite()
        if self._format in ("step_rgb", "waymo"):
            return self._get_metadata_panoptic(vsg_nodes)
        return self._get_metadata_palette(vsg_nodes)

    def get_available_frames(self) -> list[int]:
        """Return sorted list of frame indices that have mask data."""
        if self._format == "composite":
            composite_dir = self._masks_path / "composite"
            return sorted(int(p.stem) for p in composite_dir.glob("*.png"))
        return sorted(int(p.stem) for p in self._masks_path.glob("*.png"))

    def _get_metadata_composite(self) -> dict[str, Any]:
        """Build metadata from metadata.json + composite masks."""
        meta = self._load_composite_metadata()
        objects = []
        palette: dict[str, str] = {}

        composite_dir = self._masks_path / "composite"
        composite_files = sorted(composite_dir.glob("*.png"))

        # Build a map from metadata.json
        meta_objects = {o["object_id"]: o for o in meta.get("objects", [])}

        # Scan a sample composite to find all pixel values
        all_pixel_vals: set[int] = set()
        sample_indices = {0, len(composite_files) // 2, len(composite_files) - 1}
        sample_indices.update(range(0, len(composite_files), max(1, len(composite_files) // 10)))
        for idx in sample_indices:
            if idx < len(composite_files):
                arr = np.array(Image.open(composite_files[idx]))
                all_pixel_vals.update(int(v) for v in np.unique(arr) if v != 0)

        # Build objects list: use metadata.json if available, else decode from pixel values
        if meta_objects:
            for obj in meta.get("objects", []):
                obj_id = obj["object_id"]
                objects.append({
                    "object_id": obj_id,
                    "node_id": obj_id,
                    "category": obj.get("category", "unknown"),
                    "is_static": not obj.get("is_thing", False),
                    "color_hex": obj.get("color_hex", "#808080"),
                })
                palette[obj_id] = obj.get("color_hex", "#808080")
        else:
            # Decode from pixel values
            for pv in sorted(all_pixel_vals):
                cat_id, inst_id = self._decode_composite_id(pv)
                cat_name = _CITYSCAPES_CATEGORIES.get(cat_id, f"cat_{cat_id}")
                is_thing = cat_id in _CITYSCAPES_THING_IDS
                obj_id = f"{cat_name}_{inst_id}" if is_thing else f"stuff_{cat_name}"
                objects.append({
                    "object_id": obj_id,
                    "node_id": obj_id,
                    "category": cat_name,
                    "is_static": not is_thing,
                    "color_hex": "#808080",
                })
                palette[obj_id] = "#808080"

        available_frames = sorted(int(p.stem) for p in composite_files)
        return {
            "has_masks": True,
            "objects": objects,
            "total_frames": len(composite_files),
            "palette": palette,
            "mask_format": "composite",
            "available_frames": available_frames,
        }

    def _get_metadata_palette(self, vsg_nodes: list[dict[str, Any]]) -> dict[str, Any]:
        """Build metadata from paletted PNGs + VSG cross-reference."""
        palette_map = self.get_palette_map()
        node_by_obj_id: dict[int, dict[str, Any]] = {}
        for node in vsg_nodes:
            obj_id = node.get("object_id")
            if obj_id is not None:
                node_by_obj_id[int(obj_id)] = node

        all_obj_ids: set[int] = set()
        mask_files = sorted(self._masks_path.glob("*.png"))
        sample_indices = {0, len(mask_files) // 2, len(mask_files) - 1}
        sample_indices.update(range(0, len(mask_files), 10))
        for idx in sample_indices:
            if idx < len(mask_files):
                img = Image.open(mask_files[idx])
                arr = np.array(img)
                all_obj_ids.update(int(v) for v in np.unique(arr) if v != 0)

        objects = []
        for obj_id in sorted(all_obj_ids):
            node = node_by_obj_id.get(obj_id)
            objects.append({
                "object_id": obj_id,
                "node_id": node.get("node_id", f"unknown_{obj_id}") if node else f"unknown_{obj_id}",
                "category": node.get("category", "unknown") if node else "unknown",
                "is_static": node.get("is_static", True) if node else True,
                "color_hex": palette_map.get(obj_id, "#808080"),
            })

        return {
            "has_masks": True,
            "objects": objects,
            "total_frames": len(mask_files),
            "palette": {str(k): v for k, v in palette_map.items() if k in all_obj_ids},
            "mask_format": "palette",
        }

    # ── Format C/D (step_rgb / waymo) helpers ───────────────────────────

    def _decode_panoptic_frame(self, mask_path: Path) -> np.ndarray:
        """Decode a panoptic mask into a 2D array of unique object IDs.

        STEP RGB: R=semantic, G*256+B=instance -> oid = semantic*1000 + instance
        Waymo uint16: pixel = semantic*1000 + instance (already encoded)

        Returns uint32 array where 0 = background/void.
        """
        img = Image.open(mask_path)
        arr = np.array(img)

        if self._format == "step_rgb":
            semantic = arr[:, :, 0].astype(np.uint32)
            instance = arr[:, :, 1].astype(np.uint32) * 256 + arr[:, :, 2].astype(np.uint32)
            oid = semantic * 1000 + instance
            # Void (semantic=255) -> 0
            oid[semantic == 255] = 0
            # Stuff with no instance (instance=0) -> semantic*1000
            return oid
        else:
            # Waymo: already semantic*1000+instance
            if arr.ndim == 3:
                label = arr[:, :, 0].astype(np.uint32) * 256 + arr[:, :, 1].astype(np.uint32)
            else:
                label = arr.astype(np.uint32)
            # class 0 (undefined) -> 0
            label[label // 1000 == 0] = 0
            return label

    def _get_metadata_panoptic(self, vsg_nodes: list[dict[str, Any]]) -> dict[str, Any]:
        """Build metadata for STEP RGB or Waymo uint16 panoptic masks."""
        # Build multiple lookup maps for VSG nodes
        node_by_obj_id: dict[int, dict[str, Any]] = {}
        node_by_category: dict[str, dict[str, Any]] = {}  # for stuff matching
        for node in vsg_nodes:
            obj_id = node.get("object_id")
            if obj_id is not None:
                node_by_obj_id[int(obj_id)] = node
            cat = node.get("category", "")
            if node.get("is_static") and cat:
                node_by_category[cat] = node

        all_oids: set[int] = set()
        mask_files = sorted(self._masks_path.glob("*.png"))
        sample_indices = {0, len(mask_files) // 2, len(mask_files) - 1}
        sample_indices.update(range(0, len(mask_files), max(1, len(mask_files) // 10)))
        for idx in sample_indices:
            if 0 <= idx < len(mask_files):
                oid_arr = self._decode_panoptic_frame(mask_files[idx])
                all_oids.update(int(v) for v in np.unique(oid_arr) if v != 0)

        import hashlib

        def oid_color(oid: int) -> str:
            h = hashlib.md5(str(oid).encode()).hexdigest()
            return f"#{h[:6]}"

        # Category name maps for labeling
        step_cats = _CITYSCAPES_CATEGORIES  # works for KITTI & MOT
        waymo_cats = {
            2: "car", 3: "truck", 4: "bus", 5: "other_large_vehicle",
            6: "bicycle", 7: "motorcycle", 8: "trailer", 9: "pedestrian",
            10: "cyclist", 11: "motorcyclist", 12: "bird", 13: "ground_animal",
            14: "construction_cone", 15: "pole", 16: "pedestrian_object",
            17: "sign", 18: "traffic_light", 19: "building", 20: "road",
            21: "lane_marker", 22: "road_marker", 23: "sidewalk",
            24: "vegetation", 25: "sky", 26: "ground", 27: "dynamic", 28: "static",
        }

        objects = []
        for oid in sorted(all_oids):
            sem_id = oid // 1000
            inst_id = oid % 1000

            # Try direct VSG match first
            node = node_by_obj_id.get(oid)

            # Derive category name from semantic ID
            if self._format == "step_rgb":
                cat_name = step_cats.get(sem_id, f"class_{sem_id}")
            else:
                cat_name = waymo_cats.get(sem_id, f"class_{sem_id}")

            # For stuff (inst_id=0), try matching by category name
            if node is None and inst_id == 0:
                node = node_by_category.get(cat_name)

            is_thing = inst_id > 0
            label = f"{cat_name}_{inst_id}" if is_thing else cat_name

            objects.append({
                "object_id": oid,
                "node_id": node.get("node_id", label) if node else label,
                "category": node.get("category", cat_name) if node else cat_name,
                "is_static": not is_thing,
                "color_hex": oid_color(oid),
            })

        palette: dict[str, str] = {}
        for obj in objects:
            palette[str(obj["object_id"])] = obj["color_hex"]

        return {
            "has_masks": True,
            "objects": objects,
            "total_frames": len(mask_files),
            "palette": palette,
            "mask_format": self._format,
        }

    _paletted_cache_dir: Optional[Path] = None

    def _get_paletted_cache_dir(self) -> Path:
        """Get/create a cache directory for converted paletted masks."""
        if self._paletted_cache_dir is None:
            cache_dir = self._masks_path / ".paletted_cache"
            cache_dir.mkdir(exist_ok=True)
            self._paletted_cache_dir = cache_dir
        return self._paletted_cache_dir

    def convert_panoptic_to_paletted(self, mask_path: Path) -> bytes:
        """Convert a STEP RGB or Waymo panoptic mask to a paletted 8-bit PNG.

        Uses a disk cache to avoid re-converting on every request.
        Returns PNG bytes.
        """
        # Check disk cache
        cache_dir = self._get_paletted_cache_dir()
        cached_path = cache_dir / mask_path.name
        if cached_path.exists():
            return cached_path.read_bytes()

        import io
        import hashlib

        oid_arr = self._decode_panoptic_frame(mask_path)
        unique_oids = sorted(set(int(v) for v in np.unique(oid_arr) if v != 0))

        # Map oid -> palette index (1-based, 0=background)
        oid_to_idx = {oid: i + 1 for i, oid in enumerate(unique_oids)}
        indexed = np.zeros(oid_arr.shape, dtype=np.uint8)
        for oid, idx in oid_to_idx.items():
            if idx > 255:
                break
            indexed[oid_arr == oid] = idx

        # Build RGB palette
        palette_flat = [0, 0, 0]  # index 0 = black (background)
        for oid in unique_oids[:255]:
            h = hashlib.md5(str(oid).encode()).hexdigest()
            palette_flat.extend([int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)])
        palette_flat.extend([0] * (768 - len(palette_flat)))

        img = Image.fromarray(indexed, mode="P")
        img.putpalette(palette_flat)

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        png_bytes = buf.getvalue()

        # Write to disk cache
        cached_path.write_bytes(png_bytes)

        return png_bytes

    def generate_synthetic_nodes(self) -> list[dict[str, Any]]:
        """Generate VSG-compatible node dicts from mask metadata + per-object masks.

        For datasets like Cityscapes VPS where the VSG has no nodes but masks
        exist with metadata.json and per-object binary masks in objects/{id}/.
        Each object gets bboxes_by_frame computed from its binary masks.
        Results are cached at the class level to avoid re-scanning on every request.
        """
        cache_key = str(self._masks_path)
        if cache_key in PanopticMaskService._synthetic_nodes_cache:
            return PanopticMaskService._synthetic_nodes_cache[cache_key]

        if self._format != "composite":
            return []

        meta = self._load_composite_metadata()
        objects_dir = self._masks_path / "objects"
        if not objects_dir.exists():
            return []

        nodes = []
        for idx, obj in enumerate(meta.get("objects", []), start=1):
            obj_id = obj["object_id"]  # e.g. "car_1", "stuff_road"
            category = obj.get("category", "unknown")
            is_thing = obj.get("is_thing", False)

            # Compute bboxes from per-object binary masks
            obj_mask_dir = objects_dir / obj_id
            bboxes_by_frame: dict[str, dict] = {}

            if obj_mask_dir.exists():
                for mask_file in sorted(obj_mask_dir.glob("*.png")):
                    frame_idx = int(mask_file.stem)
                    try:
                        arr = np.array(Image.open(mask_file))
                        ys, xs = np.where(arr > 127)
                        if len(xs) == 0:
                            continue
                        bboxes_by_frame[str(frame_idx)] = {
                            "left": int(xs.min()),
                            "top": int(ys.min()),
                            "width": int(xs.max() - xs.min()),
                            "height": int(ys.max() - ys.min()),
                        }
                    except Exception:
                        continue

            if not bboxes_by_frame:
                continue

            nodes.append({
                "node_id": f"{'dynamic' if is_thing else 'static'}_{idx:03d}",
                "object_id": idx,  # integer for VSG compatibility
                "category": category,
                "is_static": not is_thing,
                "attributes": {
                    "visual": {"color": "unknown", "texture": "unknown", "material": "unknown"},
                    "physical": {"size": "medium", "shape": "irregular"}
                    if not is_thing
                    else {"age": "unknown"}
                    if category in ("person", "rider")
                    else {"size": "medium", "shape": "irregular"},
                },
                "bboxes_by_frame": bboxes_by_frame,
                "mask_object_id": obj_id,  # original string ID for mask cross-reference
                "color_hex": obj.get("color_hex", "#808080"),
            })

        logger.info("Generated %d synthetic nodes from mask data", len(nodes))
        PanopticMaskService._synthetic_nodes_cache[cache_key] = nodes
        return nodes

    def get_objects_at_frame(self, frame_idx: int) -> list[dict[str, Any]]:
        """Return objects present at a specific frame with bounding boxes."""
        mask_path = self.get_mask_path(frame_idx)
        if mask_path is None:
            return []

        img = Image.open(mask_path)
        arr = np.array(img)
        h, w = arr.shape[:2]

        objects = []
        for val in np.unique(arr):
            if val == 0:
                continue

            if self._format == "composite":
                cat_id, inst_id = self._decode_composite_id(int(val))
                cat_name = _CITYSCAPES_CATEGORIES.get(cat_id, f"cat_{cat_id}")
                is_thing = cat_id in _CITYSCAPES_THING_IDS
                obj_id = f"{cat_name}_{inst_id}" if is_thing else f"stuff_{cat_name}"
            else:
                obj_id = int(val)

            ys, xs = np.where(arr == val)
            left, top = int(xs.min()), int(ys.min())
            right, bottom = int(xs.max()), int(ys.max())
            area = int(len(xs))
            area_pct = round(area / (h * w) * 100, 2)
            objects.append({
                "object_id": obj_id,
                "bbox": {"left": left, "top": top, "width": right - left, "height": bottom - top},
                "area_pct": area_pct,
            })

        return objects
