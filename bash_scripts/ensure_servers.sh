#!/bin/bash
# ensure_servers.sh — Check if SGG annotation servers are running; restart if needed.
# Usage: bash bash_scripts/ensure_servers.sh

set -euo pipefail

PROJECT_DIR="/scratch/jtu9/sgg/annotations/SGG_Visualization"
LOG_DIR="/scratch/jtu9/sgg/annotations"
BACKEND_PORT=8888
FRONTEND_PORT=8889
NODE_HOSTNAME=$(hostname -s)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

cd "$PROJECT_DIR"

# --- Helper functions ---

check_backend() {
    curl -s --max-time 3 http://localhost:${BACKEND_PORT}/health | grep -q '"healthy"' 2>/dev/null
}

check_frontend() {
    curl -s --max-time 3 -o /dev/null -w "%{http_code}" http://localhost:${FRONTEND_PORT} 2>/dev/null | grep -q "200"
}

kill_port() {
    local port=$1
    local pids
    pids=$(lsof -ti :"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo -e "${YELLOW}  Killing process(es) on port $port: $pids${NC}"
        echo "$pids" | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
}

# --- Check current status ---

echo "==========================================="
echo "  SGG Annotation Server Health Check"
echo "==========================================="
echo ""

BACKEND_OK=false
FRONTEND_OK=false

if check_backend; then
    echo -e "  Backend  (port $BACKEND_PORT): ${GREEN}RUNNING${NC}"
    BACKEND_OK=true
else
    echo -e "  Backend  (port $BACKEND_PORT): ${RED}DOWN${NC}"
fi

if check_frontend; then
    echo -e "  Frontend (port $FRONTEND_PORT): ${GREEN}RUNNING${NC}"
    FRONTEND_OK=true
else
    echo -e "  Frontend (port $FRONTEND_PORT): ${RED}DOWN${NC}"
fi

echo ""

# --- If both are running, just print the tunnel command ---

if $BACKEND_OK && $FRONTEND_OK; then
    echo -e "${GREEN}Both servers are healthy. No restart needed.${NC}"
    echo ""
    echo "==========================================="
    echo "  Run this on your laptop to connect:"
    echo "==========================================="
    echo ""
    echo "  ssh -L ${FRONTEND_PORT}:${NODE_HOSTNAME}:${FRONTEND_PORT} -L ${BACKEND_PORT}:${NODE_HOSTNAME}:${BACKEND_PORT} jtu9@cc-login.campuscluster.illinois.edu"
    echo ""
    echo "  Then open: http://localhost:${FRONTEND_PORT}"
    echo "==========================================="
    exit 0
fi

# --- Restart needed ---

echo "Restarting servers..."
echo ""

# Kill any stale processes
pkill -f "uvicorn backend.main:app" 2>/dev/null || true
pkill -f "node.*vite" 2>/dev/null || true
sleep 1

# Free up ports if still occupied
kill_port $BACKEND_PORT
kill_port $FRONTEND_PORT

# Verify ports are free
for port in $BACKEND_PORT $FRONTEND_PORT; do
    if lsof -ti :"$port" >/dev/null 2>&1; then
        echo -e "${RED}ERROR: Port $port is still in use after cleanup. Aborting.${NC}"
        lsof -i :"$port" 2>/dev/null
        exit 1
    fi
done
echo -e "  Ports $BACKEND_PORT and $FRONTEND_PORT are ${GREEN}free${NC}"

# Load environment
module load python/3.11.11 2>/dev/null || true
source venv/bin/activate

# Start backend
if ! $BACKEND_OK; then
    nohup python -m uvicorn backend.main:app --host 0.0.0.0 --port $BACKEND_PORT > "${LOG_DIR}/backend.log" 2>&1 &
    echo "  Backend  started (PID: $!) on port $BACKEND_PORT"
fi

# Start frontend (override port via env)
if ! $FRONTEND_OK; then
    cd frontend
    nohup npx vite --port $FRONTEND_PORT --host 0.0.0.0 > "${LOG_DIR}/frontend.log" 2>&1 &
    echo "  Frontend started (PID: $!) on port $FRONTEND_PORT"
    cd "$PROJECT_DIR"
fi

# Wait and verify
echo ""
echo "Waiting for servers to come up..."
sleep 5

FAIL=false
if check_backend; then
    echo -e "  Backend:  ${GREEN}OK${NC}"
else
    echo -e "  Backend:  ${RED}FAILED${NC} — check ${LOG_DIR}/backend.log"
    FAIL=true
fi

if check_frontend; then
    echo -e "  Frontend: ${GREEN}OK${NC}"
else
    echo -e "  Frontend: ${RED}FAILED${NC} — check ${LOG_DIR}/frontend.log"
    FAIL=true
fi

if $FAIL; then
    echo ""
    echo -e "${RED}One or more servers failed to start. Check logs above.${NC}"
    exit 1
fi

echo ""
echo "==========================================="
echo "  Run this on your laptop to connect:"
echo "==========================================="
echo ""
echo "  ssh -L ${FRONTEND_PORT}:${NODE_HOSTNAME}:${FRONTEND_PORT} -L ${BACKEND_PORT}:${NODE_HOSTNAME}:${BACKEND_PORT} jtu9@cc-login.campuscluster.illinois.edu"
echo ""
echo "  Then open: http://localhost:${FRONTEND_PORT}"
echo "==========================================="
