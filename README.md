# SGG Visualization

Web-based tool for visualizing, validating, and annotating AI-generated video
scene graph edges.

## Quick Start

```bash
git clone https://github.com/scene-graph/VSG-Annotator.git
cd VSG-Annotator

# Backend
python -m venv venv
source venv/bin/activate
pip install -e .

# Frontend
cd frontend && npm install && cd ..

# Run both servers
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8888 &
(cd frontend && npx vite --port 8889 --host 0.0.0.0) &
```

Open **http://localhost:8889** in your browser.

If the servers are running on a remote host, forward the ports from your laptop:

```bash
ssh -L 8889:<host>:8889 -L 8888:<host>:8888 <user>@<remote>
```

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Data Directory Structure](#data-directory-structure)
- [Running the Application](#running-the-application)
- [AI Assist](#ai-assist)
- [Usage Guide](#usage-guide)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)
- [Project Structure](#project-structure)

---

## Prerequisites

- **Python** 3.10+
- **Node.js** 18+
- **npm** (or pnpm)

---

## Installation

```bash
git clone https://github.com/scene-graph/VSG-Annotator.git
cd VSG-Annotator

# Backend
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
# Required: path to video data directory
PVSG_MINI_PATH=/path/to/data_root

# AI assist key (used by both providers via the unified proxy)
OPENAI_API_KEY=sk-...

# Optional: frame cache for faster playback
FRAME_CACHE_ENABLED=true
FRAME_CACHE_PATH=./.frame_cache

# Optional: database (defaults to SQLite)
DATABASE_URL=sqlite+aiosqlite:///./sgg_visualization.db

# CORS origins — must include the frontend URL
CORS_ORIGINS=["http://localhost:8889", "http://localhost:3000"]
```

---

## Data Directory Structure

```
{PVSG_MINI_PATH}/
├── {source}__{video_id}/
│   ├── video_scene_graph.json           # VSG file (top-level)
│   │   # or outputs/video_scene_graph[_*].json (legacy layout)
│   ├── frames/                          # Video frames
│   │   ├── 0000.png
│   │   ├── 0001.png
│   │   └── ...
│   └── masks/                           # Optional: segmentation masks
└── ...
```

The leading `<source>` token of each directory name (`vidor_v2`, `Kitti_v2`,
`ego_4d_v2`, …) is stamped onto `Video.dataset` at import time and rendered
as the source-domain chip in the video list.

---

## Running the Application

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

| Service     | Port | URL                            |
| ----------- | ---- | ------------------------------ |
| Frontend    | 8889 | http://localhost:8889          |
| Backend API | 8888 | http://localhost:8888          |
| API Docs    | 8888 | http://localhost:8888/docs     |

---

## AI Assist

Node attributes and edge predicates can be suggested by AI directly in the
annotation UI.

| Provider             | Model                          | Notes                             |
| -------------------- | ------------------------------ | --------------------------------- |
| **OpenAI** (default) | `gpt-5.4-mini`                 | Chat Completions via proxy        |
| Gemini               | `google/gemini-3-flash-preview` | Responses API via proxy           |

Both providers read the same key from `OPENAI_API_KEY` (the legacy `API_KEY`
name is also accepted). The provider can be switched at runtime from the
dropdown in the top navigation bar.

**Health check**:
```bash
curl http://localhost:8888/api/ai/health
```

---

## Usage Guide

**Keyboard Shortcuts**: Space (play/pause), Left/Right arrows
(prev/next frame), Home/End (first/last frame).

**Workflow**:
1. Select a video from the source-domain list (or filter by chip)
2. Browse nodes in the Object Tracklets timeline and edges in the Edge Types timeline
3. Review with bounding-box overlays (cyan = source, magenta = target)
4. Optionally use **AI Assist** to get suggested attributes / predicates
5. Take action: Accept / Reject / Modify / Create
6. Export the annotated VSG when done

---

## API Reference

See interactive docs at `http://localhost:8888/docs`.

Key endpoints:
- `GET  /api/videos` — list videos (filterable by `dataset`)
- `GET  /api/videos/{id}/nodes` — node list
- `GET  /api/videos/{id}/edges` — edge list (filterable by class)
- `POST /api/annotations/{accept|reject|modify|create}` — annotation actions
- `GET  /api/export/{id}/download` — download annotated VSG
- `POST /api/ai/suggest-attributes` — AI node-attribute suggestions
- `POST /api/ai/suggest-edge` — AI edge suggestions

---

## Troubleshooting

### Empty user dropdown / cannot save

```bash
source venv/bin/activate
python scripts/seed_data.py
```

### No videos found

1. Verify `PVSG_MINI_PATH` in `.env` points to the data root.
2. Ensure each video directory contains `video_scene_graph.json`
   (top-level) or `outputs/video_scene_graph[_*].json`, plus a `frames/` directory.
3. Re-run: `python scripts/import_vsg.py`.

### AI returns "API_KEY not configured"

Add `OPENAI_API_KEY=sk-...` (or `API_KEY=sk-...`) to `.env` and restart the backend.

### Port in use

```bash
lsof -ti:8888 | xargs kill -9   # backend
lsof -ti:8889 | xargs kill -9   # frontend
```

### CORS errors

Add your frontend URL to `CORS_ORIGINS` in `.env`.

### Database reset

```bash
rm sgg_visualization.db
python scripts/import_vsg.py
python scripts/seed_data.py
```

---

## Project Structure

```
VSG-Annotator/
├── backend/                    # FastAPI backend (port 8888)
│   ├── main.py                 # entry point
│   ├── api/routes/             # REST endpoints (videos, edges, annotations,
│   │                           #   ai, export, import, masks, reextract, users)
│   ├── models/                 # SQLAlchemy + Pydantic models
│   ├── services/               # business logic (annotation, export, ai, video, masks)
│   └── core/                   # VSG loader, edge manager, schema validator
├── frontend/                   # React + TypeScript frontend (port 8889)
│   └── src/
│       ├── components/         # UI components (EdgeReview, NodeReview, VideoPlayer, …)
│       ├── hooks/              # React Query hooks
│       ├── services/           # API clients (api.ts, ai.ts, segmentationApi.ts)
│       └── store/              # Zustand state management
├── scripts/
│   ├── import_vsg.py           # Import VSG files into the database
│   ├── seed_data.py            # Create test users
│   └── cache_manager.py        # Frame cache utilities
├── docs/
│   └── PIPELINE.md             # Pipeline documentation
└── .env                        # Configuration (not committed)
```

---

## License

MIT
