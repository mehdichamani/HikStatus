@echo off
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
    echo HikStatus is not installed yet.
    echo Run install.bat first.
    pause
    exit /b 1
)

if /i "%~1"=="console" (
    call "%~dp0start_terminal.bat"
    exit /b %ERRORLEVEL%
)

if not exist start_tray.vbs (
    echo start_tray.vbs not found.
    exit /b 1
)

start "" wscript.exe "%~dp0start_tray.vbs"
exit /b 0
