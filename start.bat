@echo off
chcp 65001 >nul
echo ========================================
echo    HikStatus - Camera Monitoring System
echo ========================================
echo.
echo Starting HikStatus (hidden)...
echo.
echo The app is now running in the system tray.
echo Right-click the tray icon to open or exit.
echo.
start "" "%~dp0HikStatus.vbs"
