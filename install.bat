@echo off
chcp 65001 >nul
title HikStatus Installer
color 0A

echo ========================================
echo    HikStatus - Camera Monitoring System
echo    Installer v1.0.0
echo ========================================
echo.

REM Check if Python is installed
echo [1/5] Checking Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Python is not installed!
    echo.
    echo Would you like to download and install Python 3.11?
    echo.
    set /p INSTALL_PYTHON="Install Python? (Y/N): "
    
    if /i "%INSTALL_PYTHON%"=="Y" (
        echo.
        echo Downloading Python 3.11.9...
        echo Please wait...
        echo.
        
        REM Create temp directory
        if not exist "%TEMP%\python_install" mkdir "%TEMP%\python_install"
        
        REM Download Python installer
        powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe' -OutFile '%TEMP%\python_install\python_installer.exe'}"
        
        if exist "%TEMP%\python_install\python_installer.exe" (
            echo.
            echo Running Python installer...
            echo Please follow the installation wizard.
            echo.
            echo IMPORTANT: Check "Add Python to PATH" during installation!
            echo.
            "%TEMP%\python_install\python_installer.exe" /passive InstallAllUsers=0 PrependPath=1 Include_test=0
            
            echo.
            echo Python installation completed.
            echo Please restart this installer.
            echo.
            pause
            exit /b 1
        ) else (
            echo.
            echo [ERROR] Failed to download Python installer.
            echo Please download Python manually from: https://www.python.org/downloads/
            echo.
            pause
            exit /b 1
        )
    ) else (
        echo.
        echo Python is required to run HikStatus.
        echo Please install Python from: https://www.python.org/downloads/
        echo.
        echo Make sure to check "Add Python to PATH" during installation.
        echo.
        pause
        exit /b 1
    )
)

echo [OK] Python found:
python --version
echo.

REM Check Python version
echo [2/5] Checking Python version...
for /f "tokens=2" %%a in ('python --version 2^>^&1') do set PYTHON_VERSION=%%a
echo Python version: %PYTHON_VERSION%
echo.

REM Check pip
echo [3/5] Checking pip installation...
pip --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] pip is not installed!
    echo Installing pip...
    python -m ensurepip --upgrade
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install pip.
        echo Please install pip manually.
        pause
        exit /b 1
    )
)
echo [OK] pip found:
pip --version
echo.

REM Install dependencies
echo [4/5] Installing dependencies...
echo.
echo Installing packages from requirements.txt...
echo.
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to install some dependencies.
    echo Please check your internet connection and try again.
    echo.
    pause
    exit /b 1
)
echo [OK] All dependencies installed successfully!
echo.

REM Create .env if not exists
echo [5/5] Setting up configuration...
if not exist ".env" (
    echo Creating .env file with default settings...
    (
        echo ADMIN_USER=admin
        echo ADMIN_PASS=admin
    ) > .env
    echo [OK] .env file created with default credentials:
    echo      Username: admin
    echo      Password: admin
    echo.
    echo [WARNING] Please change the default password after first login!
    echo.
) else (
    echo [OK] .env file already exists.
    echo.
)

REM Create camera_names.csv if not exists
if not exist "camera_names.csv" (
    echo Creating sample camera_names.csv...
    (
        echo IP,Name
        echo 192.168.1.100,Entry Gate
        echo 192.168.1.101,Parking Lot
    ) > camera_names.csv
    echo [OK] Sample camera_names.csv created.
    echo.
)

echo ========================================
echo    Installation Complete!
echo ========================================
echo.
echo To start HikStatus:
echo    1. Run "start.bat"
echo    2. Open browser: http://localhost:28888
echo    3. Login with credentials from .env file
echo.
echo Default credentials:
echo    Username: admin
echo    Password: admin
echo.
echo [IMPORTANT] Change the default password after first login!
echo.
pause
