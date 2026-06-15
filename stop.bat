@echo off
chcp 65001 >nul
echo ========================================
echo    HikStatus - Stop Server
echo ========================================
echo.
echo Searching for HikStatus processes...

for /f "tokens=2 delims=," %%a in ('wmic process where "commandline like '%%main:app%%' or commandline like '%%tray.py%%'" get processid /format:csv 2^>nul ^| findstr /r "[0-9]"') do (
    echo Stopping process ^(PID: %%a^)...
    taskkill /F /PID %%a >nul 2>&1
)

taskkill /F /IM pythonw.exe >nul 2>&1

echo.
echo [OK] HikStatus stopped.
timeout /t 2 >nul
