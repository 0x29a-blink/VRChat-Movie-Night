@echo off
REM Frontend dev server (:5173) + API with reload (:8000). Two windows.
setlocal
cd /d "%~dp0\.."

echo.
echo  Movie Night — development mode
echo    UI   http://localhost:5173
echo    API  http://localhost:8000
echo  MediaMTX is NOT started — use start-stack.cmd for full movie night tests.
echo.

start "Movie Night API" cmd /k "cd /d %~dp0\..\backend && .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
start "Movie Night Web" cmd /k "cd /d %~dp0\..\frontend && npm run dev"
endlocal
