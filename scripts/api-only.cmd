@echo off
REM API only — no MediaMTX, no AIOStreams. Friends cannot use HLS until you also run MediaMTX.
setlocal
cd /d "%~dp0\..\backend"

echo.
echo  Movie Night — API only (port 8000)
echo  For movie night with VRChat HLS, use start-stack.cmd (not api-backend.cmd).
echo.

if not exist ".venv\Scripts\python.exe" (
    echo [setup] Creating venv...
    python -m venv .venv
    call ".venv\Scripts\python.exe" -m pip install -r requirements.txt -q
)
if not exist ".env" copy ".env.example" ".env" >nul

call ".venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
endlocal
