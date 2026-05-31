@echo off
REM Build the React frontend into frontend\dist (served by the backend)
setlocal
cd /d "%~dp0frontend"
if not exist "node_modules" (
    echo [setup] Installing frontend dependencies...
    call npm install
)
echo [build] Building frontend...
call npm run build
echo [done] Frontend built to frontend\dist
endlocal
