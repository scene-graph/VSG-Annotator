# MOTChallenge-STEP Support

## Source Dataset

**MOTChallenge-STEP — Segmenting and Tracking Every Pixel**
- Location: `{MOTCHALLENGE_STEP_ROOT}/`
- Panoptic maps: extracted from `motchallenge-step.tar.gz` -> `panoptic_maps/train/{0002,0009}/`
- RGB images: extracted from `step_images.zip` -> `train/STEP-ICCV21-{02,09}/`
- Split: Train (2 sequences with annotations; test sequences have no annotations)

### Samples

| Sample ID | Sequence | Frames | Masks | Resolution | FPS |
|-----------|----------|--------|-------|------------|-----|
| `motchallenge_0002` | STEP-ICCV21-02 | 600 | 600 | 1920x1080 | 30 |
| `motchallenge_0009` | STEP-ICCV21-09 | 525 | 525 | 1920x1080 | 30 |

---

## Extraction Pipeline

### Step 1: Archive Extraction

```bash
cd {MOTCHALLENGE_STEP_ROOT}/
tar xzf motchallenge-step.tar.gz    # -> panoptic_maps/train/{0002,0009}/
unzip -q step_images.zip            # -> train/STEP-ICCV21-{02,09}/
```

### Step 2: Link into sample_data

Frames and masks are symlinked (not copied):
```
sample_data/motchallenge_0002/frames -> .../MOTChallenge-STEP/train/STEP-ICCV21-02
sample_data/motchallenge_0002/masks  -> .../MOTChallenge-STEP/panoptic_maps/train/0002
```

### Step 3: Frame Naming Convention

- **Frames**: 6-digit, **1-indexed** JPEGs (`000001.jpg` - `000600.jpg`)
- **Masks**: 6-digit, **1-indexed** PNGs (`000001.png` - `000600.png`)

The backend `get_frame_path()` handles 1-indexed files by trying `{frame_idx + 1:06d}.jpg` patterns. Video frame 0 maps to file `000001.jpg`.

### Step 4: Panoptic Mask Decoding

Same STEP encoding as KITTI-STEP — 3-channel RGB PNGs (1920x1080, uint8):

```python
mask = np.array(Image.open('000001.png'))   # (1080, 1920, 3) uint8
semantic = mask[:, :, 0]                     # Class IDs: 0-6, 255=void
instance = mask[:, :, 1].astype(np.uint16) * 256 + mask[:, :, 2].astype(np.uint16)
# instance > 0 for tracked persons, 0 for stuff
```

Instance IDs are **globally consistent** across frames (same as KITTI-STEP, no remapping needed).

### Step 5: Node Extraction

- Mask frames are sampled every 3rd frame (`sample_every=3`) for performance (600 frames at 1920x1080)
- For each sampled frame, extract binary masks per (semantic_id, instance_id)
- Compute bounding boxes and store in `tracking.bboxes_by_frame`
- **1:1 frame mapping** — mask frame `i` maps to video frame `i` (both at 30Hz)

Static/stuff nodes also get per-frame bboxes from sampled frames.

### Step 6: Edge Derivation

**Dynamic edges ("near")**: Created when two person instances co-occur in >= 3 sampled frames.
- `start_frame`: first frame of co-occurrence
- `end_frame`: last frame of co-occurrence

**FG-BG edges ("on")**: Each person gets one edge to sidewalk or road.

---

## Categories

### Thing (1 class tracked, 1 semantic-only)

| Semantic ID | Name | Instance Tracking |
|-------------|------|-------------------|
| 4 | person | Yes (primary tracking target) |
| 6 | bicycle | No (semantic-only, treated as stuff) |

### Stuff (5 classes)

| Semantic ID | Name |
|-------------|------|
| 0 | sidewalk |
| 1 | building |
| 2 | vegetation |
| 3 | sky |
| 5 | road |

| 255 | void (excluded) |

---

## VSG Structure

```
video_scene_graph.json
├── metadata         (dataset="motchallenge_step", fps=30, resolution=1920x1080)
├── static_scene_graph
│   └── nodes[]      (3-6 stuff categories with per-frame bboxes)
├── dynamic_scene_graph
│   ├── nodes[]      (26-35 tracked person instances with per-frame bboxes)
│   └── edges[]      (co-occurrence "near" edges between persons)
└── foreground_background_relations
    └── edges[]      ("on" edges: persons on sidewalk/road)
```

### Node ID Format
- Dynamic: `dynamic_person_{instance_id:03d}` (e.g., `dynamic_person_024`)
- Static: `static_stuff_{category}` (e.g., `static_stuff_sidewalk`)

### Object ID Encoding
- Dynamic: `semantic_id * 1000 + instance_id` (person sem=11 in our mapping, e.g., person 24 -> 11024)
- Static: `50001+` sequential

---

## Comparison with KITTI-STEP and Waymo

| Aspect | MOTChallenge-STEP | KITTI-STEP | Waymo PVPS |
|--------|-------------------|-----------|------------|
| Domain | Urban pedestrian | Urban driving | Urban driving |
| Resolution | 1920x1080 | 1242x375 | 1920x1280 |
| FPS | 30 | 10 | 10 |
| Thing classes | 1 (person) | 2 (person, car) | 12 |
| Stuff classes | 5 | 17 | 15 |
| Instance tracking | Global, consistent | Global, consistent | Local, needs mapping |
| Frame:mask ratio | 1:1 | 1:1 | 2:1 |
| Mask encoding | RGB STEP format | RGB STEP format | uint16 panoptic |
| Frame naming | 6-digit, 1-indexed | 6-digit, 0-indexed | 4-digit, 0-indexed |

---

## Known Limitations

1. **Person-only tracking**: Only the `person` class has instance tracking. All other categories are semantic-only (stuff).
2. **Small dataset**: Only 2 annotated sequences (train split). Test sequences have no panoptic annotations.
3. **Sampled bboxes**: Nodes have bboxes every 3rd frame (not every frame) to keep extraction fast. Gaps in the tracklet timeline are expected.
4. **No relation annotations**: All edges are heuristic co-occurrence.

---

## File Layout

```
sample_data/motchallenge_{seq}/
├── frames -> .../MOTChallenge-STEP/train/STEP-ICCV21-{02,09}/
│                    # 525-600 JPEGs (000001.jpg - 000600.jpg), 6-digit 1-indexed
├── masks  -> .../MOTChallenge-STEP/panoptic_maps/train/{0002,0009}/
│                    # 525-600 PNGs (000001.png - 000600.png), 6-digit 1-indexed
└── outputs/
    └── video_scene_graph.json
```
