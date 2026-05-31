@echo off
REM ============================================================
REM  MediaMTX relay for OBS -> VRChat HLS
REM  RTMP in :1935  |  HLS out :8888  |  path /live/vrstream/
REM  Run this BEFORE movie night (start.cmd does NOT start it).
REM ============================================================
setlocal
cd /d "%~dp0MediaMTX"

if not exist "mediamtx.yml" (
    echo [error] mediamtx.yml not found in %CD%
    exit /b 1
)

where mediamtx >nul 2>&1
if %ERRORLEVEL%==0 (
    echo Starting MediaMTX from PATH...
    mediamtx mediamtx.yml
    exit /b %ERRORLEVEL%
)

if exist "mediamtx.exe" (
    echo Starting MediaMTX\mediamtx.exe ...
    mediamtx.exe mediamtx.yml
    exit /b %ERRORLEVEL%
)

echo [error] mediamtx not found. Install MediaMTX and add it to PATH,
echo         or place mediamtx.exe in the MediaMTX folder.
echo.
echo   scoop install mediamtx
echo   -- or download from https://github.com/bluenviron/mediamtx/releases
exit /b 1
