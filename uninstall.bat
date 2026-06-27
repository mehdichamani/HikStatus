@echo off
cd /d "%~dp0"

echo Removing HikStatus shortcuts...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create_shortcuts.ps1" -InstallDir "%~dp0." -Remove

echo.
echo Shortcuts removed. Application files and data/ were kept.
echo To fully remove HikStatus, delete this folder after stopping the app.
pause
