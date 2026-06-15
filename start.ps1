$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Start-Process python -ArgumentList "-m uvicorn main:app --host 0.0.0.0 --port 28888" -WorkingDirectory $scriptDir -WindowStyle Hidden