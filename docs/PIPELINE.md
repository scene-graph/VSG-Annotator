# SGG Visualization Pipeline Documentation

## Overview

This document explains the annotation pipeline workflow, including user roles, data flow from AI-generated Video Scene Graphs (VSG) to human review, and where final results are stored.

---

## User Roles

The current system has a **single user type** (no role hierarchy yet):

| Role | Description |
|------|-------------|
| **Annotator** | Can view videos, accept/reject/modify edges, create new edges, export results |

**Database Schema** (`backend/models/database.py`):
- `User` table: `id`, `username`, `created_at`
- No authentication layer (proof-of-concept)
- All annotations tracked to `user_id` for attribution

---

## Pipeline Stages

```
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 1: AI GENERATION (External)                             │
│  AI models generate VSG JSON files with:                        │
│  - Static scene graph (spatial relations)                       │
│  - Dynamic scene graph (action relations)                       │
│  - Foreground-background relations                              │
│  Output: {video_id}/outputs/video_scene_graph.json              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 2: IMPORT                                                │
│  scripts/import_vsg.py                                          │
│  - Discovers VSG files from PVSG_MINI_PATH directory            │
│  - Accepts both video_scene_graph.json and                      │
│    video_scene_graph_*.json (timestamped) filenames             │
│  - Creates Video records in database (status="pending")         │
│  - Stores paths to VSG file, video frames, masks                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 3: AI ASSIST (Optional)                                  │
│  POST /api/ai/suggest-attributes                                │
│  POST /api/ai/suggest-edge                                      │
│  - Default provider: Gemini (google/gemini-3-flash-preview)     │
│  - Fallback provider: OpenAI (gpt-5.2)                          │
│  - Both via bd.ctis.site proxy (unified API_KEY)                │
│  - Suggests node attributes (color, texture, material, etc.)    │
│  - Suggests edge predicates and motion attributes               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 4: HUMAN REVIEW & ANNOTATION                             │
│  Frontend web app (React + TypeScript)                          │
│  - Annotators review edges on video frames                      │
│  - Four actions: Accept, Reject, Modify, Create                 │
│  - Each action creates EdgeRevision record in database          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 5: EXPORT                                                │
│  GET /api/export/{video_id}/download                            │
│  - Applies all revisions to original VSG                        │
│  - Outputs final annotated VSG JSON file                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Dataset

- **Path**: configured via `PVSG_MINI_PATH` in `.env`
- **Layout**: one directory per video, named `<source>__<id>` (e.g.
  `vidor_v2__1011_4633647136`); the source token round-trips as the
  `Video.dataset` chip in the UI.

**VSG filename**: `video_scene_graph.json` (no timestamp suffix)

---

## Annotation Actions

| Action | Description | What Gets Stored |
|--------|-------------|------------------|
| **Accept** | Edge is correct as-is | `action="accept"`, original_predicate |
| **Reject** | Edge is wrong/invalid | `action="reject"`, review_notes |
| **Modify** | Change edge properties | `action="modify"`, original + new values for predicate, time_period, attributes, source, target |
| **Create** | Add new edge | `action="create"`, full edge details, auto-generated edge_id |

---

## Storage Locations

### 1. SQLite Database (`sgg_visualization.db`)

**Tables:**

| Table | Purpose |
|-------|---------|
| `users` | Annotator accounts (username, created_at) |
| `videos` | Video metadata, paths to VSG/frames/masks, status |
| `edge_revisions` | Complete audit trail of all annotations |
| `node_revisions` | Node attribute modifications |
| `metadata_revisions` | Scene/camera metadata changes |

**EdgeRevision Fields:**
- `video_id`, `edge_id`, `edge_type`
- `user_id` (who made the annotation)
- `action` (accept/reject/modify/create)
- `original_*` and `new_*` fields for all properties
- `review_notes`, `created_at`

### 2. Original VSG Files (Read-Only)

- Location: `{PVSG_MINI_PATH}/{video_id}/outputs/video_scene_graph.json`
- Never modified directly
- All changes stored as revisions in database

### 3. Exported VSG Files (Final Output)

- Generated on-demand via export API
- Applies all revisions to original VSG
- Adds flags: `human_annotated: true`, `human_modified: true`, `human_created: true`, `human_rejected: true`
- Filename: `video_scene_graph_{video_id}_{timestamp}.json`

---

## Data Flow Diagram

```
AI-Generated VSG (JSON)
        │
        ▼
┌─────────────────┐
│  import_vsg.py  │──────► SQLite DB (videos table)
└─────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│  VSGLoader (backend/core/vsg_loader.py)                 │
│  - Parses VSG JSON                                       │
│  - Provides nodes, edges, metadata                       │
└─────────────────────────────────────────────────────────┘
        │
        ├──► AI Service (optional)
        │    POST /api/ai/suggest-attributes
        │    POST /api/ai/suggest-edge
        │    - Gemini 3 Flash (default) via bd.ctis.site
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│  AnnotationService (backend/services/annotation_service.py)  │
│  - Enriches edges with revision status                   │
│  - Handles accept/reject/modify/create                   │
└─────────────────────────────────────────────────────────┘
        │
        ├──► EdgeRevision records ──► SQLite DB
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│  ExportService (backend/services/export_service.py)     │
│  - Loads original VSG                                    │
│  - Applies all revisions                                 │
│  - Outputs annotated VSG                                 │
└─────────────────────────────────────────────────────────┘
        │
        ▼
   Final Annotated VSG (JSON download)
```

---

## AI Assist

The AI assist feature uses a unified proxy API (`bd.ctis.site`) with a single `API_KEY`.

| Provider | Model | API Type |
|----------|-------|----------|
| **Gemini** (default) | `google/gemini-3-flash-preview` | OpenAI Responses API |
| OpenAI | `gpt-5.2` | Chat Completions API |

**Configuration** (`.env`):
```env
API_KEY=sk-...
```

**Endpoints:**
- `POST /api/ai/suggest-attributes` — node color, texture, material, size, shape, age
- `POST /api/ai/suggest-edge` — edge predicate and motion attributes
- `GET /api/ai/health` — check API key and active provider

The provider can be switched at runtime from the UI dropdown (Gemini / OpenAI).

---

## Key API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/videos` | List all videos |
| `GET /api/videos/{video_id}/edges` | Get edges with revision status |
| `POST /api/annotations/accept` | Accept an edge |
| `POST /api/annotations/reject` | Reject an edge |
| `POST /api/annotations/modify` | Modify edge properties |
| `POST /api/annotations/create` | Create new edge |
| `GET /api/export/{video_id}/download` | Download final VSG |
| `GET /api/export/{video_id}/summary` | Preview revision stats |
| `POST /api/ai/suggest-attributes` | AI node attribute suggestions |
| `POST /api/ai/suggest-edge` | AI edge suggestions |

---

## Key Files

| File | Purpose |
|------|---------|
| `backend/models/database.py` | SQLAlchemy models (User, Video, EdgeRevision, NodeRevision) |
| `backend/core/vsg_loader.py` | Parse and cache VSG JSON files |
| `backend/services/annotation_service.py` | Handle annotation actions |
| `backend/core/revision_tracker.py` | Record revisions to database |
| `backend/services/export_service.py` | Generate final annotated VSG |
| `backend/services/ai_service.py` | Gemini / OpenAI AI suggestions |
| `backend/config.py` | Application settings |
| `scripts/import_vsg.py` | Import VSG files to database |
| `bash_scripts/ensure_servers.sh` | Start/health-check servers |
| `bash_scripts/reload_videos.sh` | Re-import data and restart |
| `bash_scripts/stop_servers.sh` | Stop both servers |

---

## Notes

- **Immutable Audit Trail**: All revisions stored permanently for full history
- **Multi-Annotator**: Same video can be reviewed by multiple users; export can filter by user_id
- **Schema Validation**: Enforces Jan20 format constraints on predicates and motion attributes
- **Frame Caching**: Video frames cached on disk for performance
- **VSG Discovery**: Supports both `video_scene_graph.json` and `video_scene_graph_*.json` filenames
