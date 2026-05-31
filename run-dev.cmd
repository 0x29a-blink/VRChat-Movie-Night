@echo off
REM ============================================================
REM  Dev mode: backend (uvicorn --reload) + Vite dev server.
REM  Opens two windows. Use http://localhost:5173 for the UI.
REM ============================================================
setlocal
cd /d "%~dp0"

start "VRC Movie Night - API" cmd /k "cd /d %~dp0backend && .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
start "VRC Movie Night - Web" cmd /k "cd /d %~dp0frontend && npm run dev"

echo Dev servers starting...
echo   UI:  http://localhost:5173
echo   API: http://localhost:8000
endlocal
