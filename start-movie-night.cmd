@echo off
REM ============================================================
REM  VRChat Movie Night - one-click startup
REM  Opens MediaMTX (HLS :8888) + web app/API (:8000)
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo  Starting Movie Night stack...
echo  - MediaMTX window   (RTMP :1935, HLS :8888)
echo  - AIOStreams window (http://localhost:3000)  [skip if not set up yet]
echo  - Web app window    (http://localhost:8000)
echo.

start "MediaMTX" cmd /k "%~dp0start-mediamtx.cmd"
if exist "%~dp0AIOStreams\repo\packages\server\dist\server.js" (
    start "AIOStreams" cmd /k "%~dp0AIOStreams\start-aiostreams.cmd"
) else (
    echo  [info] AIOStreams not built — run AIOStreams\setup-aiostreams.cmd to self-host.
)
timeout /t 2 /nobreak >nul
start "Movie Night API" cmd /k "%~dp0start.cmd"
echo.
echo  All services started in separate windows.
echo  Open http://localhost:8000 when the API window is ready.
echo.
