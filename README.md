# SGG Visualization

Video Scene Graph Edge Annotation & Visualization System - A web-based tool for human reviewers to visualize, validate, and revise AI-generated video scene graph edges.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
  - [1. Clone the Repository](#1-clone-the-repository)
  - [2. Backend Setup](#2-backend-setup)
  - [3. Frontend Setup](#3-frontend-setup)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
  - [Video Data Path](#video-data-path)
  - [Frame Cache Path](#frame-cache-path)
- [Data Directory Structure](#data-directory-structure)
- [Running the Application](#running-the-application)
- [API Reference](#api-reference)
- [Usage Guide](#usage-guide)
- [Production Deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)

---

## Features

- **Video Player**: Frame-by-frame navigation with bounding box overlay for source/target objects
- **Edge Timeline**: Temporal visualization of edge time periods with D3.js
- **Tracklet Timeline**: Object presence visualization across video frames
- **Edge Review Panel**: Accept/Reject/Modify/Create operations with validation reasoning
- **Filtering**: Filter edges by type, confidence, validation status, extraction source
- **Revision Tracking**: Full audit trail of human annotations
- **Export**: Export annotated VSG to Jan20 schema format with human review flags

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (React + TypeScript + Vite)                           │
│  - Tailwind CSS for styling                                     │
│  - D3.js for timeline visualization                             │
│  - Zustand for state management                                 │
│  - React Query for data fetching                                │
└─────────────────────────────────────────────────────────────────┘
                              ↓ HTTP/REST
┌─────────────────────────────────────────────────────────────────┐
│  Backend (Python FastAPI)                                       │
│  - SQLAlchemy ORM with async SQLite                             │
│  - Pydantic for data validation                                 │
│  - Pillow/OpenCV for image processing                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Data Storage                                                   │
│  - SQLite database (annotations, users, video metadata)         │
│  - VSG JSON files (AI-generated scene graphs)                   │
│  - Video frames (PNG/JPG images)                                │
│  - Frame cache (optional, for faster playback)                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.10+ | Required for backend |
| Node.js | 18+ | Required for frontend |
| pnpm | Latest | Recommended (or npm/yarn) |
| Git | Latest | For cloning the repository |

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/JiachenTu/SGG_Visualization.git
cd SGG_Visualization
```

### 2. Backend Setup

```bash
# Create and activate virtual environment
python -m venv venv
source venv/bin/activate  # Linux/macOS
# or: venv\Scripts\activate  # Windows

# Install Python dependencies
pip install -e .

# For development (includes pytest)
pip install -e ".[dev]"

# For production with PostgreSQL support
pip install -e ".[prod]"
```

### 3. Frontend Setup

```bash
cd frontend

# Install Node.js dependencies
pnpm install
# or: npm install
# or: yarn install
```

---

## Configuration

### Environment Variables

Create a `.env` file in the project root directory:

```bash
# Copy the example and edit
cp .env.example .env
```

**`.env` file contents:**

```env
# =============================================================================
# SGG Visualization Configuration
# =============================================================================

# --- Application Settings ---
DEBUG=false
APP_NAME=SGG Visualization

# --- Database ---
# SQLite (default, recommended for single-user deployment)
DATABASE_URL=sqlite+aiosqlite:///./sgg_visualization.db

# PostgreSQL (for production multi-user deployment)
# DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/sgg_viz

# --- Video Data Path ---
# Directory containing video samples with VSG files and frames
# Each subdirectory should be a video sample (see Data Directory Structure)
PVSG_MINI_PATH=/path/to/your/video/data

# --- Frame Cache (Optional but Recommended) ---
# Enable disk caching for faster frame loading
FRAME_CACHE_ENABLED=true

# Path to store cached frames (should be on fast storage, e.g., SSD)
FRAME_CACHE_PATH=/path/to/cache/sgg_frames

# --- CORS (Frontend URLs allowed to access the API) ---
# Add your frontend URL if deploying to a different domain
CORS_ORIGINS=["http://localhost:5173", "http://localhost:3000"]

# --- Pagination ---
DEFAULT_PAGE_SIZE=50
MAX_PAGE_SIZE=200
```

### Video Data Path

The `PVSG_MINI_PATH` environment variable specifies where your video data is stored.

**Important**: This is the most critical configuration. The system expects a specific directory structure (see [Data Directory Structure](#data-directory-structure)).

```env
# Example paths
PVSG_MINI_PATH=/home/user/datasets/pvsg_mini
PVSG_MINI_PATH=/data/video_scene_graphs
PVSG_MINI_PATH=C:\Users\user\datasets\pvsg_mini  # Windows
```

### Frame Cache Path

The frame cache improves playback performance by copying frames to fast local storage.

```env
# Enable caching (recommended)
FRAME_CACHE_ENABLED=true

# Use fast storage (SSD recommended)
FRAME_CACHE_PATH=/tmp/sgg_frames           # Temporary (cleared on reboot)
FRAME_CACHE_PATH=/fast_ssd/sgg_frames      # Persistent SSD storage
FRAME_CACHE_PATH=/srv/local/cache/frames   # Shared server storage
```

**Cache behavior:**
- When a video is first accessed, all frames are copied to the cache in a background thread
- Subsequent frame requests are served directly from the cache
- Cache can be managed via CLI tool (see [Cache Management](#cache-management))

---

## Data Directory Structure

The system expects video data organized in the following structure:

```
{PVSG_MINI_PATH}/
├── {video_id_1}/                          # Video sample directory
│   ├── outputs/
│   │   └── video_scene_graph_*.json       # VSG file(s) - latest is used
│   ├── frames/                            # Video frames (required)
│   │   ├── 0000.png                       # Frame files (0000.png, 0001.png, ...)
│   │   ├── 0001.png                       # or (frame_0000.png, frame_0001.png, ...)
│   │   └── ...
│   └── masks/                             # Segmentation masks (optional)
│       ├── 0000.png
│       └── ...
│
├── {video_id_2}/
│   ├── outputs/
│   │   └── video_scene_graph_20260124_191136.json
│   ├── frames/
│   └── masks/
│
└── ...
```

**Key points:**

| Component | Required | Description |
|-----------|----------|-------------|
| `outputs/video_scene_graph_*.json` | Yes | AI-generated VSG file (Jan20 schema) |
| `frames/` | Yes | Directory with video frames as PNG/JPG |
| `masks/` | No | Optional segmentation masks |

**Frame naming conventions supported:**
- `0000.png`, `0001.png`, ... (zero-padded 4 digits)
- `frame_0000.png`, `frame_0001.png`, ...
- `0000.jpg`, `0001.jpg`, ... (JPEG format)

**Example with real data:**

```
/data/pvsg_mini/
├── ego4d_22cc4d54-34be-4580-983a-9e710e831c16/
│   ├── outputs/
│   │   └── video_scene_graph_20260124_191136.json
│   ├── frames/
│   │   ├── 0000.png
│   │   ├── 0001.png
│   │   └── ... (300 frames)
│   └── masks/
│       └── ...
│
├── vidor_0001_1234567890/
│   ├── outputs/
│   │   └── video_scene_graph_20260120_103045.json
│   └── frames/
│       └── ...
```

---

## Running the Application

### Step 1: Initialize the Database

```bash
# Make sure virtual environment is activated
source venv/bin/activate

# Import video samples into the database
python scripts/import_vsg.py

# (Optional) Create test users
python scripts/seed_data.py
```

### Step 2: Start the Backend Server

```bash
# From the project root directory
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The backend will be available at:
- API: http://localhost:8000
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

### Step 3: Start the Frontend Server

```bash
# In a new terminal
cd frontend
pnpm dev
# or: npm run dev
```

The frontend will be available at: http://localhost:5173

### Server Summary

| Service | URL | Description |
|---------|-----|-------------|
| Backend API | http://localhost:8000 | FastAPI REST server |
| API Documentation | http://localhost:8000/docs | Interactive Swagger UI |
| Frontend UI | http://localhost:5173 | React development server |

---

## Cache Management

Manage the frame cache using the CLI tool:

```bash
# Check cache status
python scripts/cache_manager.py --status

# Pre-warm cache for a specific video (faster first load)
python scripts/cache_manager.py --warm <video_id>

# Clear cache for a specific video
python scripts/cache_manager.py --clear <video_id>

# Clear entire cache
python scripts/cache_manager.py --clear-all
```

Check cache status via API:
```bash
curl http://localhost:8000/api/videos/cache/status
```

---

## API Reference

### Videos

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/videos` | GET | List all videos |
| `/api/videos/{video_id}` | GET | Get video details |
| `/api/videos/{video_id}/frame/{frame_idx}` | GET | Get frame image (PNG) |
| `/api/videos/{video_id}/frame/{frame_idx}/jpeg` | GET | Get JPEG frame (smaller) |
| `/api/videos/{video_id}/nodes` | GET | Get all nodes |
| `/api/videos/{video_id}/edges` | GET | Get edges with filters |
| `/api/videos/cache/status` | GET | Get frame cache status |

### Annotations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/annotations/accept` | POST | Accept an edge as correct |
| `/api/annotations/reject` | POST | Reject an edge as incorrect |
| `/api/annotations/modify` | POST | Modify edge properties |
| `/api/annotations/create` | POST | Create a new edge |
| `/api/annotations/history/{video_id}/{edge_id}` | GET | Get revision history |

### Export

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/export/{video_id}` | POST | Export annotated VSG |
| `/api/export/{video_id}/download` | GET | Download as JSON file |
| `/api/export/{video_id}/summary` | GET | Preview revision summary |

### Users

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/users` | GET | List all users |
| `/api/users` | POST | Create new user |
| `/api/users/{user_id}` | GET | Get user details |
| `/api/users/{user_id}` | DELETE | Delete user |

---

## Usage Guide

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Play/Pause video |
| Left Arrow | Previous frame |
| Right Arrow | Next frame |
| Home | Go to first frame |
| End | Go to last frame |

### Annotation Workflow

1. **Select a video** from the sidebar
2. **Browse edges** in the Edge Timeline
3. **Click an edge** to review it
4. **View the edge** on the video with bounding boxes (cyan=source, magenta=target)
5. **Take action**:
   - **Accept**: Edge is correct as-is
   - **Reject**: Edge is wrong (provide notes)
   - **Modify**: Change predicate, time period, or attributes
   - **Create**: Add a new edge (select source/target nodes)
6. **Export** the annotated VSG when done

---

## Production Deployment

### Backend with Gunicorn

```bash
# Install gunicorn
pip install gunicorn

# Run with multiple workers
gunicorn backend.main:app -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000
```

### Frontend Build

```bash
cd frontend

# Build for production
pnpm build

# Preview the build locally
pnpm preview

# The built files are in frontend/dist/
# Serve with nginx, Apache, or any static file server
```

### Nginx Configuration Example

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Frontend static files
    location / {
        root /path/to/SGG_Visualization/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API proxy
    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### PostgreSQL for Multi-User

For production with multiple concurrent users, use PostgreSQL:

```bash
# Install PostgreSQL dependencies
pip install -e ".[prod]"

# Update .env
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/sgg_visualization
```

---

## Troubleshooting

### Port Already in Use

```bash
# Check what's using the port
lsof -i:8000  # Backend
lsof -i:5173  # Frontend

# Kill the process
lsof -ti:8000 | xargs kill -9
```

### No Videos Found After Import

1. Check `PVSG_MINI_PATH` is set correctly in `.env`
2. Verify directory structure matches expected format
3. Ensure each video has `outputs/video_scene_graph_*.json` and `frames/` directory
4. Check import script output for errors:
   ```bash
   python scripts/import_vsg.py
   ```

### Frames Not Loading

1. Check the `frames/` directory exists and contains images
2. Verify frame file naming (0000.png, 0001.png, etc.)
3. Check backend logs for file access errors
4. Try clearing the frame cache:
   ```bash
   python scripts/cache_manager.py --clear-all
   ```

### Database Errors

```bash
# Reset the database (WARNING: deletes all annotations)
rm sgg_visualization.db
python scripts/import_vsg.py
python scripts/seed_data.py
```

### CORS Errors in Browser

Add your frontend URL to `CORS_ORIGINS` in `.env`:
```env
CORS_ORIGINS=["http://localhost:5173", "http://your-server:5173"]
```

---

## Project Structure

```
SGG_Visualization/
├── backend/
│   ├── main.py                 # FastAPI entry point
│   ├── config.py               # Application configuration
│   ├── api/routes/             # API endpoints
│   ├── core/                   # Business logic
│   ├── models/                 # Database & Pydantic models
│   └── services/               # Service layer
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # Main application
│   │   ├── components/         # React components
│   │   ├── hooks/              # Custom hooks
│   │   ├── services/           # API client
│   │   ├── store/              # Zustand state
│   │   └── types/              # TypeScript types
│   └── vite.config.ts
├── scripts/
│   ├── import_vsg.py           # Import VSG files to database
│   ├── seed_data.py            # Create test users
│   └── cache_manager.py        # Frame cache CLI
├── docs/
│   └── PIPELINE.md             # Pipeline documentation
├── tests/
├── .env                        # Environment configuration
├── pyproject.toml              # Python dependencies
└── README.md
```

---

## License

MIT
