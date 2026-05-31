@echo off
REM ============================================================
REM  VRChat Movie Night - one-click start (production mode)
REM  Serves the built webapp + API at http://localhost:8000
REM ============================================================
setlocal
cd /d "%~dp0backend"

if not exist ".venv" (
    echo [setup] Creating Python virtual environment...
    python -m venv .venv
    call ".venv\Scripts\python.exe" -m pip install --upgrade pip
    call ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)

if not exist ".env" (
    echo [setup] No .env found - copying from .env.example
    copy ".env.example" ".env" >nul
    echo [setup] Edit backend\.env to set your password and keys, then re-run.
)

if not exist "..\frontend\dist\index.html" (
    echo [warn] Frontend is not built yet. Run build-frontend.cmd first,
    echo        or use dev mode ^(run-dev.cmd^).
)

echo.
echo  Open http://localhost:8000  ^(or http://YOUR-IP:8000 from another PC^)
echo.
echo  Also run start-mediamtx.cmd in a second window for VRChat HLS ^(port 8888^).
echo  Or use start-movie-night.cmd to launch both automatically.
echo.
call ".venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
endlocal
