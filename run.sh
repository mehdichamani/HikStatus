#!/bin/bash

echo "========================================"
echo "   HikStatus - Camera Monitoring System"
echo "   Starting..."
echo "========================================"
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python3 is not installed!"
    echo "Please install Python3: https://www.python.org/downloads/"
    exit 1
fi

echo "[OK] Python found:"
python3 --version
echo ""

# Check if dependencies are installed
echo "Checking dependencies..."
python3 -c "import fastapi, uvicorn, sqlmodel, dotenv" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "[WARNING] Some dependencies are missing."
    echo "Installing dependencies..."
    echo ""
    pip3 install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to install dependencies."
        exit 1
    fi
fi

echo "[OK] All checks passed."
echo ""
echo "========================================"
echo "   Starting HikStatus Server..."
echo "   Port: 28888"
echo "========================================"
echo ""
echo "Access URL: http://localhost:28888"
echo ""
echo "Press Ctrl+C to stop the server."
echo ""

# Start uvicorn
uvicorn main:app --host 0.0.0.0 --port 28888
