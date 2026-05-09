# KITTI-STEP Support

## Source Dataset

**KITTI-STEP — Segmenting and Tracking Every Pixel**
- Location: `{KITTI_STEP_ROOT}/`
- Panoptic maps: `kitti-step/panoptic_maps/{train,val}/{seq_id}/` (extracted from `kitti-step.tar.gz`)
- RGB images: Pre-extracted in `sample_data/kitti_{seq}/frames/` (originally from `data_tracking_image_2.zip`)
- Split: Validation (9 sequences, 2,981 frames)

### Samples

| Sample ID | Sequence | Frames | Masks | Resolution | FPS |
|-----------|----------|--------|-------|------------|-----|
| `kitti_0002` | val/0002 | 233 | 233 | 1242x375 | 10 |
| `kitti_0006` | val/0006 | 270 | 270 | 1242x375 | 10 |

---

## Extraction Pipeline

### Step 1: Link Frames and Masks

KITTI frames were previously extracted into `sample_data/kitti_{seq}/frames/` as 4-digit PNGs (`0000.png` - `0232.png`).

Panoptic masks are symlinked from the dataset:
```
sample_data/kitti_0002/masks -> {KITTI_STEP_ROOT}/kitti-step/panoptic_maps/val/0002/
```

Mask files are 6-digit PNGs (`000000.png` - `000232.png`). The backend `get_frame_path()` handles both naming conventions.

### Step 2: Panoptic Mask Decoding

KITTI-STEP masks are 3-channel RGB PNGs (1242x375, uint8). The encoding follows the STEP format:

```python
mask = np.array(Image.open('000001.png'))   # (375, 1242, 3) uint8
semantic = mask[:, :, 0]                     # Class IDs: 0-18, 255=void
instance = mask[:, :, 1].astype(np.uint16) * 256 + mask[:, :, 2].astype(np.uint16)
# instance > 0 for tracked persons and cars, 0 for stuff
```

**Key difference from Waymo**: KITTI-STEP instance IDs are **globally consistent** across frames within a sequence. No local-to-global mapping is needed — the same instance ID always refers to the same physical object.

### Step 3: Node Extraction

For each frame, for each (semantic_id, instance_id) pair:
1. Extract binary mask: `(semantic == sem_id) & (instance == inst_id)`
2. Compute bounding box: `left, top, width, height`
3. Accumulate into `tracking.bboxes_by_frame` keyed by frame index

**1:1 frame mapping** — mask frame `i` maps directly to video frame `i` (both at 10Hz, no remapping needed).

Static/stuff nodes also get per-frame bboxes (tight bbox around all pixels of that category).

### Step 4: Edge Derivation

Same heuristic approach as other datasets (no relation annotations available):

**Dynamic edges ("near")**: Created when two dynamic nodes co-occur in >= 3 frames.
- `start_frame`: first frame where both have bboxes
- `end_frame`: last frame where both have bboxes

**FG-BG edges ("on")**: Each dynamic node gets one edge to the first matching ground category (road or sidewalk).

---

## Categories

### Thing (2 classes, instance-tracked)

| Semantic ID | Name | Note |
|-------------|------|------|
| 11 | person | Tracked with consistent instance IDs |
| 13 | car | Tracked with consistent instance IDs |

### Stuff (17 classes, semantic-only)

| Semantic ID | Name | Semantic ID | Name |
|-------------|------|-------------|------|
| 0 | road | 1 | sidewalk |
| 2 | building | 3 | wall |
| 4 | fence | 5 | pole |
| 6 | traffic_light | 7 | traffic_sign |
| 8 | vegetation | 9 | terrain |
| 10 | sky | 12 | rider |
| 14 | truck | 15 | bus |
| 16 | train | 17 | motorcycle |
| 18 | bicycle | 255 | void (excluded) |

Note: rider, truck, bus, train, motorcycle, bicycle are Cityscapes "thing" classes but treated as stuff in KITTI-STEP (no instance tracking).

---

## VSG Structure

```
video_scene_graph.json
├── metadata         (dataset="kitti_step", fps=10, resolution=1242x375)
├── static_scene_graph
│   └── nodes[]      (13-15 stuff categories with per-frame bboxes)
├── dynamic_scene_graph
│   ├── nodes[]      (11-16 tracked car/person instances with per-frame bboxes)
│   └── edges[]      (co-occurrence "near" edges)
└── foreground_background_relations
    └── edges[]      ("on" edges: cars/persons on road/sidewalk)
```

### Node ID Format
- Dynamic: `dynamic_{category}_{instance_id:03d}` (e.g., `dynamic_car_012`)
- Static: `static_stuff_{category}` (e.g., `static_stuff_vegetation`)

### Object ID Encoding
- Dynamic: `semantic_id * 1000 + instance_id` (e.g., car instance 12 -> 13012)
- Static: `50001+` sequential

---

## Comparison with Waymo PVPS

| Aspect | KITTI-STEP | Waymo PVPS |
|--------|-----------|------------|
| Instance ID tracking | Globally consistent | Local per-frame, requires global mapping |
| Frame:mask ratio | 1:1 (all frames labeled) | 2:1 (every other frame labeled) |
| Thing classes | 2 (person, car) | 12 |
| Stuff classes | 17 | 15 |
| Resolution | 1242x375 | 1920x1280 |
| FPS | 10 | 10 |

---

## File Layout

```
sample_data/kitti_{seq}/
├── frames/          # 233-270 PNGs (0000.png - 0232.png), 4-digit 0-indexed
├── masks -> {KITTI_STEP_ROOT}/kitti-step/panoptic_maps/val/{seq}/
│                    # 233-270 PNGs (000000.png - 000232.png), 6-digit 0-indexed
├── masks_composite/ # Original composite-format masks (backup, not used)
└── outputs/
    └── video_scene_graph.json
```
