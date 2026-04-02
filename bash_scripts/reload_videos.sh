#!/bin/bash
# reload_videos.sh — Re-import videos from PVSG_MINI_PATH and restart servers.
# Usage: bash bash_scripts/reload_videos.sh

set -euo pipefail

PROJECT_DIR="/scratch/jtu9/sgg/annotations/SGG_Visualization"
cd "$PROJECT_DIR"

module load python/3.11.11 2>/dev/null || true
source venv/bin/activate

echo "==========================================="
echo "  Importing videos from PVSG dataset"
echo "==========================================="
echo ""

python scripts/import_vsg.py 2>&1 | grep -E '(Found|Imported|Skipping|Done|No samples|video)'

echo ""
echo "Seeding users..."
python scripts/seed_data.py 2>&1 | grep -E '(Created|exists|Done)'

echo ""
echo "Restarting servers..."
bash bash_scripts/ensure_servers.sh
