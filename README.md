# SGG Visualization

Web-based tool for visualizing, validating, and annotating AI-generated video scene graph edges.

## Quick Start

**1. Configure** (create `.env` in project root):
```env
PVSG_MINI_PATH=/path/to/your/video/data
FRAME_CACHE_PATH=/path/to/cache           # optional
```

**2. Install & Run**:
```bash
# Backend (Terminal 1)
python -m venv venv && source venv/bin/activate
pip install -e .
python scripts/import_vsg.py
python scripts/seed_data.py              # creates test users
cd backend && uvicorn main:app --reload --port 8000

# Frontend (Terminal 2)
cd frontend && pnpm install && pnpm dev
```

**3. Open**: http://localhost:5173

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Data Directory Structure](#data-directory-structure)
- [Running the Application](#running-the-application)
- [Usage Guide](#usage-guide)
- [API Reference](#api-reference)
- [Production Deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Python** 3.10+
- **Node.js** 18+
- **pnpm** (or npm/yarn)

---

## Installation

```bash
git clone https://github.com/JiachenTu/SGG_Visualization.git
cd SGG_Visualization

# Backend
python -m venv venv
source venv/bin/activate  # Linux/macOS (Windows: venv\Scripts\activate)
pip install -e .          # or pip install -e ".[dev]" for development

# Frontend
cd frontend && pnpm install
```

---

## Configuration

Create a `.env` file in the project root (copy from `.env.example`):

```env
# Required: Path to video data directory
PVSG_MINI_PATH=/path/to/your/video/data

# Optional: Frame cache for faster playback (use SSD)
FRAME_CACHE_ENABLED=true
FRAME_CACHE_PATH=/path/to/cache/sgg_frames

# Optional: Database (defaults to SQLite)
DATABASE_URL=sqlite+aiosqlite:///./sgg_visualization.db
# DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/sgg_viz

# Optional: CORS origins (add your frontend URL if different)
CORS_ORIGINS=["http://localhost:5173", "http://localhost:3000"]
```

---

## Data Directory Structure

```
{PVSG_MINI_PATH}/
├── {video_id}/
│   ├── outputs/
│   │   └── video_scene_graph_*.json    # Required: VSG file
│   ├── frames/                          # Required: Video frames
│   │   ├── 0000.png                     # Naming: 0000.png or frame_0000.png
│   │   ├── 0001.png
│   │   └── ...
│   └── masks/                           # Optional: Segmentation masks
└── ...
```

---

## Running the Application

```bash
# 1. Initialize database (from project root, with venv activated)
python scripts/import_vsg.py     # Import video samples
python scripts/seed_data.py      # Create test users (admin, annotator1, annotator2, reviewer)

# 2. Start backend (Terminal 1)
cd backend && uvicorn main:app --reload --port 8000

# 3. Start frontend (Terminal 2)
cd frontend && pnpm dev
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| API Docs | http://localhost:8000/docs |

---

## Usage Guide

**Keyboard Shortcuts**: Space (play/pause), Left/Right arrows (prev/next frame), Home/End (first/last frame)

**Workflow**:
1. Select a video from the sidebar
2. Browse and click edges in the Edge Timeline
3. Review with bounding boxes (cyan=source, magenta=target)
4. Take action: Accept / Reject / Modify / Create
5. Export the annotated VSG when done

---

## API Reference

See interactive docs at http://localhost:8000/docs

Key endpoints:
- `GET /api/videos` - List videos
- `GET /api/videos/{id}/edges` - Get edges with filters
- `POST /api/annotations/{accept|reject|modify|create}` - Annotation actions
- `GET /api/export/{id}/download` - Download annotated VSG

---

## Production Deployment

```bash
# Backend with Gunicorn
pip install gunicorn
gunicorn backend.main:app -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000

# Frontend build
cd frontend && pnpm build
# Serve frontend/dist/ with nginx or any static file server
```

For PostgreSQL (multi-user): `pip install -e ".[prod]"` and update `DATABASE_URL` in `.env`.

---

## Troubleshooting

### Empty User Dropdown / Cannot Save

After database reset, no users exist. Run the seed script:
```bash
source venv/bin/activate
python scripts/seed_data.py
```
Then refresh the frontend.

### No Videos Found

1. Verify `PVSG_MINI_PATH` in `.env` points to correct directory
2. Check each video has `outputs/video_scene_graph_*.json` and `frames/` directory
3. Re-run: `python scripts/import_vsg.py`

### Database Reset

```bash
rm sgg_visualization.db
python scripts/import_vsg.py
python scripts/seed_data.py
```

### Port in Use

```bash
lsof -ti:8000 | xargs kill -9  # Backend
lsof -ti:5173 | xargs kill -9  # Frontend
```

### CORS Errors

Add your frontend URL to `CORS_ORIGINS` in `.env`.

---

## Project Structure

```
SGG_Visualization/
├── backend/           # FastAPI backend
│   ├── main.py        # Entry point
│   ├── api/routes/    # API endpoints
│   ├── models/        # Database & Pydantic models
│   └── services/      # Business logic
├── frontend/          # React frontend
│   └── src/
│       ├── components/
│       ├── hooks/
│       ├── services/  # API client
│       └── store/     # Zustand state
├── scripts/
│   ├── import_vsg.py  # Import VSG files
│   └── seed_data.py   # Create test users
└── .env               # Configuration
```

---

## License

MIT
