@echo off
chcp 65001 >nul
title HikStatus - Camera Monitoring System
color 0B

echo ========================================
echo    HikStatus - Camera Monitoring System
echo    Starting...
echo ========================================
echo.

REM Stop all running instances
echo [1/3] Stopping existing instances...
taskkill /F /IM "python.exe" /FI "WINDOWTITLE eq HikStatus*" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :28888 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
timeout /t 1 >nul
echo [OK] Previous instances stopped.
echo.

REM Check if Python is available
echo [2/3] Checking Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH!
    echo Please run install.bat first.
    pause
    exit /b 1
)

REM Check dependencies
python -c "import fastapi, uvicorn, sqlmodel, dotenv" >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] Dependencies missing. Running installer...
    call install.bat
    if %errorlevel% neq 0 (
        echo [ERROR] Installation failed.
        pause
        exit /b 1
    )
)
echo [OK] Python and dependencies ready.
echo.

REM Start with system tray
echo [3/3] Starting HikStatus with system tray...
echo.
python tray.py
