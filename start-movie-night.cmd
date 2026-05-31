@echo off
REM ============================================================
REM  VRChat Movie Night - one-click startup
REM  Opens MediaMTX (HLS :8888) + web app/API (:8000)
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo  Starting Movie Night stack...
echo  - MediaMTX window  (RTMP :1935, HLS :8888)
echo  - Web app window   (http://localhost:8000)
echo.

start "MediaMTX" cmd /k "%~dp0start-mediamtx.cmd"
timeout /t 2 /nobreak >nul
call "%~dp0start.cmd"
