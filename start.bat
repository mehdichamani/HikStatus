@echo off
for /f "usebackq tokens=1,* delims==" %%a in (".env") do set "%%a=%%b"
uvicorn main:app --host 0.0.0.0 --port 28888
