#!/usr/bin/env bash
# HikStatus - Native Python launcher
# Usage: ./start.sh [--port PORT]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${1:-28888}"

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "[HikStatus] Creating virtual environment..."
    python3 -m venv .venv
fi

# Activate virtual environment
source .venv/bin/activate

# Install/upgrade dependencies
echo "[HikStatus] Installing dependencies..."
pip install -q -r requirements.txt

# Create data directory
mkdir -p data

# Copy example .env if none exists
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "[HikStatus] .env file created from .env.example — please edit it before use."
    fi
fi

echo "[HikStatus] Starting on http://localhost:${PORT}"
exec uvicorn main:app --host 0.0.0.0 --port "$PORT"
