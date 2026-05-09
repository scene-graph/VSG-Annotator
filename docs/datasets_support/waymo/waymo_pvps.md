# Waymo PVPS Support

## Source Dataset

**Waymo Open Dataset — Panoramic Video Panoptic Segmentation (PVPS)**
- Location: `{WAYMO_PVPS_ROOT}/validation/`
- Format: Parquet files (v2.0.1)
- Split: Validation (202 segments, 20 with panoptic labels)
- We extract 2 segments as samples into `{PVSG_MINI_PATH}/`

### Samples

| Sample ID | Segment ID | Frames | Masks | Resolution | FPS |
|-----------|-----------|--------|-------|------------|-----|
| `waymo_1024360143` | `1024360143612057520_3580_000_3600_000` | 199 | 99 | 1920x1280 | 10 |
| `waymo_1104871297` | `11048712972908676520_545_000_565_000` | 199 | 99 | 1920x1280 | 10 |

---

## Extraction Pipeline

### Step 1: Frame Extraction (parquet -> JPEG)

Source: `camera_image/{segment_id}.parquet`

Each parquet contains ~995 rows (5 cameras x ~199 timestamps). We extract only the **front camera** (camera_name=1), decode the JPEG binary from the `[CameraImageComponent].image` column, and save as `{frame_idx:04d}.jpg`.

```
199 frames at 10Hz -> 0000.jpg to 0198.jpg
```

### Step 2: Mask Extraction (parquet -> PNG)

Source: `camera_segmentation/{segment_id}.parquet`

Panoptic labels are stored as PNG binary in `[CameraSegmentationLabelComponent].panoptic_label`. Only ~99 out of 199 timestamps have labels (5Hz labeling of 10Hz video). Saved as `{mask_idx:04d}.png`.

**Panoptic encoding** (uint16):
```
semantic_class = pixel_value // 1000   (0-28)
local_instance_id = pixel_value % 1000 (0 = stuff/void)
```

### Step 3: Instance Tracking (local -> global IDs)

**Critical**: Local instance IDs are NOT consistent across frames. The same local ID can refer to different physical objects in different frames.

The parquet contains per-frame mapping columns:
- `instance_id_to_global_id_mapping.local_instance_ids` — local IDs in this frame
- `instance_id_to_global_id_mapping.global_instance_ids` — globally tracked IDs
- `instance_id_to_global_id_mapping.is_tracked` — whether the instance is temporally tracked

We build a `local_to_global` dict per frame and use the **global ID** as the node's identity. This ensures each node represents a single physical object across time.

### Step 4: Frame Remapping (5Hz masks -> 10Hz video)

Masks cover 99 frames at 5Hz, but the video has 199 frames at 10Hz. We remap:
```
mask_frame[i] -> video_frame[i * 2]
```

For odd video frames (between two labeled frames), we copy the bbox from the preceding even frame. This gives near-continuous tracklet coverage across the full video.

### Step 5: Bounding Box Derivation

For each (global_id, semantic_class) pair in each mask frame:
1. Extract the binary mask: `(semantic == sem_id) & (instance == local_id)`
2. Compute tight bounding box: `left=xs.min(), top=ys.min(), width=xs.ptp()+1, height=ys.ptp()+1`
3. Store in `tracking.bboxes_by_frame` keyed by video frame index

Static/stuff nodes also get bboxes (the tight bbox around all pixels of that category per frame).

---

## Categories

### Thing (12 classes, instance-tracked)

| Semantic ID | Name | Typical Count per Segment |
|-------------|------|--------------------------|
| 2 | car | 100-200 |
| 3 | truck | 20-40 |
| 4 | bus | 1-5 |
| 5 | other_large_vehicle | 2-5 |
| 6 | bicycle | 0-2 |
| 7 | motorcycle | 0-1 |
| 8 | trailer | 3-11 |
| 9 | pedestrian | 15-25 |
| 10 | cyclist | 0-2 |
| 11 | motorcyclist | 0-1 |
| 12 | bird | 0 |
| 13 | ground_animal | 0 |

### Stuff (15 classes used, semantic-only)

| Semantic ID | Name |
|-------------|------|
| 14 | construction_cone |
| 15 | pole |
| 16 | pedestrian_object |
| 17 | sign |
| 18 | traffic_light |
| 19 | building |
| 20 | road |
| 21 | lane_marker |
| 22 | road_marker |
| 23 | sidewalk |
| 24 | vegetation |
| 25 | sky |
| 26 | ground |
| 27 | dynamic |
| 28 | static |

Classes 0 (undefined) and 1 (ego_vehicle) are excluded from node generation.

---

## VSG Structure

```
video_scene_graph.json
├── metadata         (video_id, dataset="waymo_pvps", total_frames=199, fps=10, resolution)
├── static_scene_graph
│   └── nodes[]      (15 stuff categories, each with per-frame bboxes)
├── dynamic_scene_graph
│   ├── nodes[]      (274 tracked thing instances with per-frame bboxes)
│   └── edges[]      (co-occurrence "near" edges)
└── foreground_background_relations
    └── edges[]      ("on" edges: dynamic nodes on road/sidewalk/ground)
```

### Node ID Format
- Dynamic: `dynamic_{category}_{global_id:03d}` (e.g., `dynamic_car_123`)
- Static: `static_stuff_{category}` (e.g., `static_stuff_road`)

### Object ID Encoding
- Dynamic: `semantic_id * 1000 + global_id` (e.g., car global_id=123 -> object_id=2123)
- Static: `50001+` sequential

---

## Edge Derivation

Edges are derived heuristically (Waymo has no relation annotations).

### Dynamic Edges ("near")
For each pair of dynamic nodes, if they **co-occur** (both have bboxes) in >= 5 frames:
- `predicate`: "near"
- `start_frame`: first frame where both nodes have bboxes
- `end_frame`: last frame where both nodes have bboxes

### FG-BG Edges ("on")
For each dynamic node, one edge to the first matching ground category (road > sidewalk > ground > lane_marker):
- `predicate`: "on"
- `start_frame` / `end_frame`: full lifespan of the dynamic node

---

## Known Limitations

1. **Sparse mask coverage**: Only 99/199 frames have panoptic labels. Odd-frame bboxes are copies (not interpolated), so bbox motion appears stepped rather than smooth.
2. **No semantic relation annotations**: All edges are heuristic co-occurrence. No "following", "overtaking", "crossing" etc.
3. **Front camera only**: Waymo has 5 cameras per timestamp; we only extract the front camera.
4. **Validation split only**: Only 20 segments have panoptic labels in the validation set.

---

## File Layout

```
sample_data/waymo_{segment_prefix}/
├── frames/          # 199 JPEGs (0000.jpg - 0198.jpg), decoded from parquet
├── masks/           # 99 PNGs (0000.png - 0098.png), uint16 panoptic labels
└── outputs/
    └── video_scene_graph.json   # Auto-generated VSG with tracked nodes + heuristic edges
```

## Data Source Path

```
{WAYMO_PVPS_ROOT}/validation/
├── camera_image/{segment}.parquet         # JPEG images (binary column)
├── camera_segmentation/{segment}.parquet  # Panoptic labels + instance tracking mappings
└── ...
```
