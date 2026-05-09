# SGG Visualization

Web-based tool for visualizing, validating, and annotating AI-generated video scene graph edges.

## Quick Start (Illinois Campus Cluster)

```bash
cd /scratch/jtu9/sgg/annotations/SGG_Visualization

# First time: import data and start servers
bash bash_scripts/reload_videos.sh

# Subsequently: check/restart servers
bash bash_scripts/ensure_servers.sh
```

Then tunnel from your laptop:
```
ssh -L 8889:ccc0477:8889 -L 8888:ccc0477:8888 jtu9@cc-login.campuscluster.illinois.edu
```
Open **http://localhost:8889**

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Data Directory Structure](#data-directory-structure)
- [Running the Application](#running-the-application)
- [Bash Scripts](#bash-scripts)
- [AI Assist](#ai-assist)
- [Usage Guide](#usage-guide)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)
- [Project Structure](#project-structure)

---

## Prerequisites

- **Python** 3.10+ (module: `python/3.11.11` on ICC)
- **Node.js** 18+
- **npm** (or pnpm)

---

## Installation

```bash
git clone https://github.com/JiachenTu/SGG_Visualization.git
cd SGG_Visualization

# Backend
module load python/3.11.11   # on ICC
python -m venv venv
source venv/bin/activate
pip install -e .

# Frontend
cd frontend && npm install
```

---

## Configuration

Create a `.env` file in the project root (copy from `.env.example`):

```env
# Required: Path to video data directory
PVSG_MINI_PATH=/u/jtu9/scratch/sgg/ai_pipeline/pvsg_annotated_40

# AI assist (bd.ctis.site unified proxy key)
API_KEY=sk-...

# Optional: Frame cache for faster playback
FRAME_CACHE_ENABLED=true
FRAME_CACHE_PATH=/scratch/jtu9/sgg/annotations/SGG_Visualization/.frame_cache

# Optional: Database (defaults to SQLite)
DATABASE_URL=sqlite+aiosqlite:///./sgg_visualization.db

# CORS origins — must include the frontend port
CORS_ORIGINS=["http://localhost:8889", "http://localhost:3000"]
```

---

## Data Directory Structure

```
{PVSG_MINI_PATH}/
├── {video_id}/
│   ├── outputs/
│   │   └── video_scene_graph.json      # VSG file (or video_scene_graph_*.json)
│   ├── frames/                          # Video frames
│   │   ├── 0000.png
│   │   ├── 0001.png
│   │   └── ...
│   └── masks/                           # Optional: segmentation masks
└── ...
```

**Current dataset**: `pvsg_annotated_40` — 40 videos (ego4d + epic_kitchen)

---

## Running the Application

### Option A: Bash scripts (recommended on ICC)

```bash
# Import videos + start both servers
bash bash_scripts/reload_videos.sh

# Health check / restart if down
bash bash_scripts/ensure_servers.sh

# Stop both servers
bash bash_scripts/stop_servers.sh
```

### Option B: Manual

```bash
# Terminal 1 — Backend
source venv/bin/activate
python scripts/import_vsg.py    # first time only
python scripts/seed_data.py     # first time only
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8888

# Terminal 2 — Frontend
cd frontend
npx vite --port 8889 --host 0.0.0.0
```

| Service | Port | URL (after SSH tunnel) |
|---------|------|------------------------|
| Frontend | 8889 | http://localhost:8889 |
| Backend API | 8888 | http://localhost:8888 |
| API Docs | 8888 | http://localhost:8888/docs |

---

## Bash Scripts

| Script | Purpose |
|--------|---------|
| `bash_scripts/ensure_servers.sh` | Health-check backend + frontend; restart if either is down; prints SSH tunnel command |
| `bash_scripts/reload_videos.sh` | Re-import videos from `PVSG_MINI_PATH`, seed users, restart servers |
| `bash_scripts/stop_servers.sh` | Stop both servers cleanly |

---

## AI Assist

Node attributes and edge predicates can be suggested by AI directly in the annotation UI.

| Provider | Model | Notes |
|----------|-------|-------|
| **Gemini** (default) | `google/gemini-3-flash-preview` | Uses OpenAI Responses API via proxy |
| OpenAI | `gpt-5.2` | Uses Chat Completions API via proxy |

Both providers use the same `API_KEY` against the `bd.ctis.site/v1` proxy (see `/u/jtu9/scratch/sgg/api/API_GUIDE.md`).

The provider can be switched at runtime from the dropdown in the top navigation bar.

**Health check**:
```bash
curl http://localhost:8888/api/ai/health
```

---

## Usage Guide

**Keyboard Shortcuts**: Space (play/pause), Left/Right arrows (prev/next frame), Home/End (first/last frame)

**Workflow**:
1. Select a video from the sidebar
2. Browse edges in the Edge Timeline
3. Review with bounding boxes (cyan = source, magenta = target)
4. Optionally use **AI Assist** to get suggested attributes/predicates
5. Take action: Accept / Reject / Modify / Create
6. Export the annotated VSG when done

---

## API Reference

See interactive docs at `http://localhost:8888/docs`

Key endpoints:
- `GET /api/videos` — List videos
- `GET /api/videos/{id}/edges` — Get edges with filters
- `POST /api/annotations/{accept|reject|modify|create}` — Annotation actions
- `GET /api/export/{id}/download` — Download annotated VSG
- `POST /api/ai/suggest-attributes` — AI node attribute suggestions
- `POST /api/ai/suggest-edge` — AI edge suggestions

---

## Troubleshooting

### Empty User Dropdown / Cannot Save

```bash
source venv/bin/activate
python scripts/seed_data.py
```

### No Videos Found

1. Verify `PVSG_MINI_PATH` in `.env` points to the correct directory
2. Ensure each video has `outputs/video_scene_graph.json` and a `frames/` directory
3. Re-run: `python scripts/import_vsg.py`

### AI Returns "API_KEY not configured"

Add `API_KEY=sk-...` to `.env` and restart the backend.

### Port in Use

```bash
lsof -ti:8888 | xargs kill -9  # Backend
lsof -ti:8889 | xargs kill -9  # Frontend
```

Or use: `bash bash_scripts/ensure_servers.sh`

### CORS Errors

Add your frontend URL to `CORS_ORIGINS` in `.env`.

### Database Reset

```bash
rm sgg_visualization.db
python scripts/import_vsg.py
python scripts/seed_data.py
```

---

## Project Structure

```
SGG_Visualization/
├── backend/                    # FastAPI backend (port 8888)
│   ├── main.py                 # Entry point
│   ├── api/routes/             # REST endpoints (videos, edges, annotations, ai, export)
│   ├── models/                 # SQLAlchemy + Pydantic models
│   ├── services/               # Business logic (annotation, export, ai, video)
│   └── core/                   # VSG loader, edge manager, schema validator
├── frontend/                   # React + TypeScript frontend (port 8889)
│   └── src/
│       ├── components/         # UI components (EdgeReview, NodeReview, VideoPlayer, etc.)
│       ├── hooks/              # React Query hooks
│       ├── services/           # API clients (api.ts, ai.ts)
│       └── store/              # Zustand state management
├── scripts/
│   ├── import_vsg.py           # Import VSG files to database
│   ├── seed_data.py            # Create test users
│   └── cache_manager.py        # Frame cache utilities
├── bash_scripts/
│   ├── ensure_servers.sh       # Health check + auto-restart
│   ├── reload_videos.sh        # Re-import data + restart
│   └── stop_servers.sh         # Stop both servers
├── docs/
│   └── PIPELINE.md             # Pipeline documentation
└── .env                        # Configuration (not committed)
```

---

## License

MIT
