@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

:: ── Guard: must install first ────────────────────────────────────────────────
if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] HikStatus is not installed yet.
    echo         Run install.bat first.
    pause
    exit /b 1
)

:: ── Optional port argument (default 28888) ───────────────────────────────────
set PORT=28888
if not "%~1"=="" set PORT=%~1

:: ── Ensure data directory exists ─────────────────────────────────────────────
if not exist "data\" mkdir data

:: ── Start server ─────────────────────────────────────────────────────────────
echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║  HikStatus is starting...                    ║
echo  ║  Open: http://localhost:%PORT%                   ║
echo  ║  Press Ctrl+C to stop.                       ║
echo  ╚══════════════════════════════════════════════╝
echo.

.venv\Scripts\uvicorn main:app --host 0.0.0.0 --port %PORT%
