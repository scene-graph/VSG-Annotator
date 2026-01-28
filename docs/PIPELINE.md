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

**Future Enhancement**: Could add `Reviewer` role for quality control, `Admin` for system management.

---

## Pipeline Stages

```
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 1: AI GENERATION (External)                             │
│  AI models generate VSG JSON files with:                        │
│  - Static scene graph (spatial relations)                       │
│  - Dynamic scene graph (action relations)                       │
│  - Foreground-background relations                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 2: IMPORT                                                │
│  scripts/import_vsg.py                                          │
│  - Discovers VSG files from pvsg_mini/ directory                │
│  - Creates Video records in database (status="pending")         │
│  - Stores paths to VSG file, video frames, masks                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 3: HUMAN REVIEW & ANNOTATION                             │
│  Frontend web app (React + TypeScript)                          │
│  - Annotators review edges on video frames                      │
│  - Four actions: Accept, Reject, Modify, Create                 │
│  - Each action creates EdgeRevision record in database          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 4: EXPORT                                                │
│  GET /api/export/{video_id}/download                            │
│  - Applies all revisions to original VSG                        │
│  - Outputs final annotated VSG JSON file                        │
└─────────────────────────────────────────────────────────────────┘
```

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

**EdgeRevision Fields:**
- `video_id`, `edge_id`, `edge_type`
- `user_id` (who made the annotation)
- `action` (accept/reject/modify/create)
- `original_*` and `new_*` fields for all properties
- `review_notes`, `created_at`

### 2. Original VSG Files (Read-Only)

- Location: `pvsg_mini/{dataset}/{video_id}/video_scene_graph.json`
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

---

## Key Files

| File | Purpose |
|------|---------|
| `backend/models/database.py` | SQLAlchemy models (User, Video, EdgeRevision) |
| `backend/core/vsg_loader.py` | Parse and cache VSG JSON files |
| `backend/services/annotation_service.py` | Handle annotation actions |
| `backend/core/revision_tracker.py` | Record revisions to database |
| `backend/services/export_service.py` | Generate final annotated VSG |
| `scripts/import_vsg.py` | Import VSG files to database |

---

## Additional Components

| File | Purpose |
|------|---------|
| `backend/core/edge_manager.py` | Edge filtering and analysis |
| `backend/core/schema_validator.py` | Jan20 schema validation |
| `backend/services/video_service.py` | Frame extraction and caching |
| `backend/config.py` | Application settings |
| `scripts/cache_manager.py` | Frame cache operations |

---

## Notes

- **Immutable Audit Trail**: All revisions stored permanently for full history
- **Multi-Annotator**: Same video can be reviewed by multiple users; export can filter by user_id
- **Schema Validation**: Enforces Jan20 format constraints on predicates and motion attributes
- **Frame Caching**: Video frames cached on disk for performance
