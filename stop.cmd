@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Action stop %*
