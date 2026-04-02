#!/bin/bash
# stop_servers.sh — Stop SGG annotation servers.
# Usage: bash bash_scripts/stop_servers.sh

set -euo pipefail

BACKEND_PORT=8888
FRONTEND_PORT=8889

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "Stopping SGG servers..."

pkill -f "uvicorn backend.main:app" 2>/dev/null && echo -e "  Backend:  ${GREEN}stopped${NC}" || echo -e "  Backend:  ${RED}not running${NC}"
pkill -f "node.*vite" 2>/dev/null && echo -e "  Frontend: ${GREEN}stopped${NC}" || echo -e "  Frontend: ${RED}not running${NC}"

# Clean up ports
for port in $BACKEND_PORT $FRONTEND_PORT; do
    pids=$(lsof -ti :"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
done

echo "Done."
