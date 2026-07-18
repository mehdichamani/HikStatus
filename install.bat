@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════╗
echo  ║       HikStatus - Installation       ║
echo  ╚══════════════════════════════════════╝
echo.

:: ── Check & install Python ──────────────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    :: Try py launcher as fallback
    py -3 --version >nul 2>&1
    if errorlevel 1 (
        echo [INFO] Python is not installed. Installing via winget...
        where winget >nul 2>&1
        if errorlevel 1 (
            echo [ERROR] winget is not available. Please install Python manually:
            echo        https://www.python.org/downloads/
            echo        Make sure to check "Add Python to PATH" during installation.
            pause
            exit /b 1
        )
        winget install --id Python.Python.3.13 --accept-package-agreements --accept-source-agreements
        if errorlevel 1 (
            echo [ERROR] Python install failed. Please install Python manually:
            echo        https://www.python.org/downloads/
            pause
            exit /b 1
        )
        echo [OK] Python installed.
        echo [INFO] Please CLOSE this window and re-run install.bat.
        echo        The new Python needs a fresh PATH to work.
        pause
        exit /b 0
    )
)

for /f "tokens=*" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
if not defined PY_VER (
    for /f "tokens=*" %%v in ('py -3 --version 2^>^&1') do set PY_VER=%%v
)
echo [OK] Found !PY_VER!

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

:: ── Check & install ffmpeg ───────────────────────────────────────────────────
where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo [INFO] ffmpeg not found. Installing via winget...
    where winget >nul 2>&1
    if errorlevel 1 (
        echo [WARN] winget is not available. Please install ffmpeg manually:
        echo        https://www.gyan.dev/ffmpeg/builds/
        echo        Download ffmpeg-release-essentials.zip and add bin\ to PATH.
    ) else (
        winget install --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
        if errorlevel 1 (
            echo [WARN] winget install failed. Please install ffmpeg manually:
            echo        https://www.gyan.dev/ffmpeg/builds/
        ) else (
            echo [OK] ffmpeg installed.
        )
    )
) else (
    echo [OK] ffmpeg found.
)

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
echo  ║  2. Run start.bat to launch HikStatus                    ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.
pause
