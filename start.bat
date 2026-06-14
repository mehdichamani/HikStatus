@echo off
chcp 65001 >nul
title HikStatus - Camera Monitoring System
color 0B

echo ========================================
echo    HikStatus - Camera Monitoring System
echo    Starting...
echo ========================================
echo.

REM Check if Python is available
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH!
    echo Please run install.bat first.
    echo.
    pause
    exit /b 1
)

REM Check if dependencies are installed
echo Checking dependencies...
python -c "import fastapi, uvicorn, sqlmodel, dotenv" >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] Some dependencies are missing.
    echo Running installer...
    echo.
    call install.bat
    if %errorlevel% neq 0 (
        echo [ERROR] Installation failed. Please run install.bat manually.
        pause
        exit /b 1
    )
)

echo [OK] All checks passed.
echo.
echo ========================================
echo    Starting HikStatus Server...
echo    Port: 28888
echo ========================================
echo.
echo Access URL: http://localhost:28888
echo.
echo Press Ctrl+C to stop the server.
echo.

REM Start uvicorn (python-dotenv loads .env automatically in main.py)
uvicorn main:app --host 0.0.0.0 --port 28888

REM If server stops
echo.
echo Server stopped.
pause
