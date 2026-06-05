@echo off
REM MediaMTX alone in this window (Ctrl+C to stop). Normal use: start-stack.cmd
setlocal
cd /d "%~dp0MediaMTX"

echo.
echo  MediaMTX only (debug)
echo  Full stack:  start-stack.cmd
echo  RTMP :1935   HLS http://localhost:8888/live/vrstream/
echo.

if not exist "mediamtx.yml" (
    echo [error] mediamtx.yml not found
    exit /b 1
)

if exist "mediamtx.exe" (
    mediamtx.exe mediamtx.yml
    exit /b %ERRORLEVEL%
)

where mediamtx >nul 2>&1
if errorlevel 1 (
    echo [error] Place mediamtx.exe in MediaMTX\ or install on PATH
    exit /b 1
)
mediamtx mediamtx.yml
endlocal
