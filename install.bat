@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════╗
echo  ║       HikStatus - Installation       ║
echo  ╚══════════════════════════════════════╝
echo.

:: ── Check Python ────────────────────────────────────────────────────────────
where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH.
    echo         Download it from https://www.python.org/downloads/
    echo         Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo [OK] Found %PY_VER%

:: ── Create virtual environment ───────────────────────────────────────────────
if not exist ".venv\Scripts\python.exe" (
    echo [INFO] Creating virtual environment...
    python -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo [OK] Virtual environment created.
) else (
    echo [OK] Virtual environment already exists.
)

:: ── Install dependencies ─────────────────────────────────────────────────────
echo [INFO] Installing dependencies (this may take a moment)...
.venv\Scripts\pip install -q --upgrade pip
.venv\Scripts\pip install -q -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)
echo [OK] Dependencies installed.

:: ── Create data directory ────────────────────────────────────────────────────
if not exist "data\" (
    mkdir data
    echo [OK] Data directory created.
)

:: ── Create .env from example ─────────────────────────────────────────────────
if not exist ".env" (
    if exist ".env.example" (
        copy /Y ".env.example" ".env" >nul
        echo [WARN] .env file created from .env.example
        echo        Edit .env and set a secure ADMIN_PASS before starting.
    ) else (
        echo [WARN] .env.example not found. Create a .env file manually.
    )
) else (
    echo [OK] .env file already exists.
)

:: ── Done ─────────────────────────────────────────────────────────────────────
echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║  Installation complete!                                  ║
echo  ║                                                          ║
echo  ║  Next steps:                                             ║
echo  ║  1. Edit .env  and set ADMIN_USER / ADMIN_PASS           ║
echo  ║  2. (Optional) Edit init_config.json with your NVR info  ║
echo  ║  3. Run start.bat to launch HikStatus                    ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.
pause
