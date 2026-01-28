# SGG Visualization

Video Scene Graph Edge Annotation & Visualization System - A web-based tool for human reviewers to visualize, validate, and revise AI-generated video scene graph edges.

## Features

- **Video Player**: Frame-by-frame navigation with bounding box overlay
- **Edge Timeline**: Temporal visualization of edge time periods with D3.js
- **Edge Review Panel**: Accept/Reject/Modify operations with validation reasoning
- **Filtering**: Filter edges by type, confidence, validation status, extraction source
- **Revision Tracking**: Full history of human annotations
- **Export**: Export annotated VSG to Jan20 schema format

## Architecture

- **Backend**: Python FastAPI with SQLAlchemy (SQLite/PostgreSQL)
- **Frontend**: React + TypeScript + Vite with Tailwind CSS
- **Visualization**: D3.js for timeline, Canvas/SVG for bounding boxes

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- pnpm (or npm/yarn)

### Backend Setup

```bash
cd /home/jtu9/sgg/VideoSGG_AnyGran/vis_annotation/SGG_Visualization

# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -e .

# Initialize database and import data
python scripts/import_vsg.py
python scripts/seed_data.py

# Start the backend server
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
pnpm install  # or npm install

# Start development server
pnpm dev  # or npm run dev
```

The application will be available at http://localhost:5173

## Running the Servers

### Server Ports

| Service | URL | Description |
|---------|-----|-------------|
| Backend API | http://localhost:8000 | FastAPI server |
| API Docs | http://localhost:8000/docs | Swagger UI documentation |
| Frontend UI | http://localhost:5173 | React development server |

### Starting Servers

**Backend** (from `backend/` directory):
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Frontend** (from `frontend/` directory):
```bash
pnpm dev    # or npm run dev
```

### Stopping Servers

**Option 1: Ctrl+C**
Press `Ctrl+C` in each terminal where a server is running.

**Option 2: Find and kill processes**
```bash
# Find server processes
ps aux | grep -E "uvicorn|npm.*dev" | grep -v grep

# Kill by PID
kill <PID>

# Or kill by port
lsof -ti:8000 | xargs kill  # Backend
lsof -ti:5173 | xargs kill  # Frontend
```

### Troubleshooting

**Port already in use:**
```bash
# Check what's using a port
lsof -i:8000  # or :5173

# Kill the process using the port
lsof -ti:8000 | xargs kill -9
```

**Server won't start:**
- Ensure virtual environment is activated for backend
- Ensure dependencies are installed (`pip install -e .` for backend, `pnpm install` for frontend)
- Check that database is initialized (`python scripts/import_vsg.py`)

## Project Structure

```
SGG_Visualization/
├── backend/
│   ├── main.py                 # FastAPI entry point
│   ├── config.py               # Application configuration
│   ├── api/routes/             # API endpoints
│   │   ├── videos.py           # Video & frame endpoints
│   │   ├── edges.py            # Edge listing & filtering
│   │   ├── annotations.py      # Accept/Reject/Modify/Create
│   │   ├── export.py           # Export to Jan20 schema
│   │   └── users.py            # User management
│   ├── core/
│   │   ├── vsg_loader.py       # VSG file parser
│   │   ├── edge_manager.py     # Edge filtering
│   │   ├── revision_tracker.py # Annotation tracking
│   │   └── schema_validator.py # Schema validation
│   ├── models/
│   │   ├── database.py         # SQLAlchemy models
│   │   └── schemas.py          # Pydantic schemas
│   └── services/
│       ├── video_service.py    # Frame extraction
│       ├── annotation_service.py
│       └── export_service.py
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # Main application
│   │   ├── components/
│   │   │   ├── VideoPlayer/    # Video + bbox overlay
│   │   │   ├── EdgeTimeline/   # D3.js timeline
│   │   │   ├── EdgeReview/     # Review panel
│   │   │   ├── Filters/        # Filter controls
│   │   │   └── GraphVisualization/
│   │   ├── hooks/              # React Query hooks
│   │   ├── services/api.ts     # API client
│   │   ├── store/              # Zustand state
│   │   └── types/              # TypeScript types
│   └── vite.config.ts
│
├── scripts/
│   ├── import_vsg.py           # Import VSG files
│   └── seed_data.py            # Seed test users
│
└── tests/
```

## API Endpoints

### Videos
- `GET /api/videos` - List all videos
- `GET /api/videos/{id}` - Get video details
- `GET /api/videos/{id}/frame/{frame_idx}` - Get frame image (PNG)
- `GET /api/videos/{id}/frame/{frame_idx}/jpeg?quality=80` - Get frame as optimized JPEG
- `GET /api/videos/{id}/nodes` - Get all nodes
- `GET /api/videos/{id}/edges` - Get edges with filters

### Annotations
- `POST /api/annotations/accept` - Accept an edge
- `POST /api/annotations/reject` - Reject an edge
- `POST /api/annotations/modify` - Modify an edge
- `POST /api/annotations/create` - Create new edge
- `GET /api/annotations/history/{video_id}/{edge_id}` - Revision history

### Export
- `POST /api/export/{video_id}` - Export annotated VSG
- `GET /api/export/{video_id}/download` - Download as JSON file

### Users
- `GET /api/users` - List users
- `POST /api/users` - Create user

## Edge Types

### Static Edges (static ↔ static)
Spatial relationships between static objects.
- Predicates: on, under, over, in, beside, left_of, right_of, etc.

### Dynamic Edges (dynamic ↔ dynamic)
Actions between dynamic objects with motion attributes.
- Predicates: touching, holding, picking, pushing, eating, etc.
- Attributes: velocity, direction, trajectory

### FG-BG Edges (dynamic → static)
Relationships between foreground and background objects.
- Group-level: source/target can be lists of nodes
- Predicates: standing_on, sitting_on, inside, beside, etc.

## Keyboard Shortcuts

- **Space**: Play/Pause
- **Left Arrow**: Previous frame
- **Right Arrow**: Next frame
- **Home**: Go to first frame
- **End**: Go to last frame

## Data Sources

The system expects VSG files in the Jan20 schema format from:
```
/home/jtu9/sgg/VideoSGG_AnyGran/examples/pvsg_mini/{sample}/outputs/video_scene_graph_*.json
```

## Development

### Running Tests

```bash
# Backend tests
cd backend
pytest

# Frontend tests
cd frontend
pnpm test
```

### Building for Production

```bash
# Frontend build
cd frontend
pnpm build

# The built files will be in frontend/dist/
```

## Configuration

Environment variables can be set in a `.env` file:

```env
DATABASE_URL=sqlite+aiosqlite:///./sgg_visualization.db
PVSG_MINI_PATH=/home/jtu9/sgg/VideoSGG_AnyGran/examples/pvsg_mini
DEBUG=false
FRAME_CACHE_PATH=/srv/local/shared/temp/tmp1/jtu9/cache/sgg_frames
FRAME_CACHE_ENABLED=true
```

## Frame Cache

For faster frame loading during video playback, frames are automatically cached on fast local storage.

### How It Works

1. **Eager Pre-caching**: When a video is first accessed, all frames are copied to the cache in a background thread
2. **Fast Serving**: Subsequent frame requests are served directly from the cache
3. **Automatic**: Caching happens transparently - no manual intervention required

### Cache Location

```
/srv/local/shared/temp/tmp1/jtu9/cache/sgg_frames/
├── {video_id_1}/
│   └── frames/
│       ├── 0000.png
│       ├── 0001.png
│       └── ...
└── {video_id_2}/
    └── frames/
```

### Cache Management

```bash
# Check cache status
python scripts/cache_manager.py --status

# Pre-warm cache for a video (run in advance for faster first load)
python scripts/cache_manager.py --warm <video_id>

# Clear cache for a specific video
python scripts/cache_manager.py --clear <video_id>

# Clear entire cache
python scripts/cache_manager.py --clear-all
```

### API Endpoint

Check cache status via API:
```bash
curl http://localhost:8000/api/videos/cache/status
```

## Performance Optimizations

### JPEG Frame Compression

The video player uses JPEG compression to reduce frame transfer sizes by ~94%:

| Dataset | PNG Size | JPEG Size (q=80) | Reduction |
|---------|----------|------------------|-----------|
| Ego4D | ~2.5 MB | ~150 KB | 94% |
| VIDor | ~358 KB | ~35 KB | 90% |

**API Endpoint:**
```bash
# Get JPEG-compressed frame (quality 10-100, default 80)
GET /api/videos/{video_id}/frame/{frame_idx}/jpeg?quality=80
```

### Canvas Rendering with Frame Buffering

The video player uses several optimizations for smooth playback:

1. **Canvas Rendering**: Uses `<canvas>` instead of `<img>` for precise frame control
2. **Frame Buffer**: Maintains 50-frame buffer with 25-frame lookahead
3. **requestAnimationFrame**: Synced to display refresh rate (eliminates jitter)
4. **Pre-indexed BBox Lookup**: O(1) bounding box retrieval per frame
5. **Adaptive Playback**: Only advances when next frame is buffered (prevents drops)

### Expected Performance

| Metric | Before | After |
|--------|--------|-------|
| Frame transfer | 1-3 MB | 100-200 KB |
| Buffer capacity | 10-15 frames | 50 frames |
| Timing sync | setInterval | requestAnimationFrame |
| BBox lookup | O(n) | O(1) |

## Changelog

### 2026-01-27
- **Perf**: Add JPEG frame endpoint for 94% bandwidth reduction
- **Perf**: Canvas rendering with 50-frame buffer and requestAnimationFrame
- **Perf**: Pre-indexed bounding box lookup (O(1) per frame)
- **Fix**: Video frame now updates correctly during timeline playback (fixed stale closure issue in VideoPlayer.tsx)

## License

MIT
