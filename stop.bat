@echo off
chcp 65001 >nul
echo ========================================
echo    HikStatus - Stop Server
echo ========================================
echo.
echo Searching for HikStatus processes...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :28888 ^| findstr LISTENING 2^>nul') do (
    echo Stopping process on port 28888 ^(PID: %%a^)...
    taskkill /F /PID %%a >nul 2>&1
)

for /f "tokens=2" %%a in ('wmic process where "commandline like '%%uvicorn%%main:app%%'" get processid /value 2^>nul ^| findstr ProcessId') do (
    echo Stopping uvicorn process ^(PID: %%a^)...
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo [OK] HikStatus stopped.
timeout /t 2 >nul
