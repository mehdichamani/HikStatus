@echo off
setlocal
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════╗
echo  ║      HikStatus - Uninstall           ║
echo  ╚══════════════════════════════════════╝
echo.
echo This will remove the Python virtual environment (.venv).
echo Your data and .env will NOT be deleted.
echo.

set /p CONFIRM=Type YES to continue: 
if /i not "%CONFIRM%"=="YES" (
    echo Cancelled.
    exit /b 0
)

if exist ".venv\" (
    echo [INFO] Removing .venv...
    rmdir /s /q .venv
    echo [OK] .venv removed.
) else (
    echo [INFO] .venv does not exist, nothing to remove.
)

echo.
echo [DONE] Uninstall complete.
echo        Run install.bat again to reinstall.
echo.
pause
