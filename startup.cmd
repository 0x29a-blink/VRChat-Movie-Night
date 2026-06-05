@echo off
REM Setup menu — checks, tools, UI build. Daily start: start-stack.cmd
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title Movie Night - Setup menu

set "ROOT=%~dp0"
set "MODE=%~1"
if /i "%MODE%"=="--start" goto launch_stack
if /i "%MODE%"=="start" goto launch_stack

:menu
cls
echo.
echo  ============================================================
echo   Movie Night — setup menu
echo  ============================================================
echo.
echo   Daily use:  start-stack.cmd     (one window, full stack)
echo               stop-stack.cmd      (kill stray MediaMTX/API)
echo.
call "%ROOT%scripts\preflight.cmd"
set "CHECK_FAILED=%ERRORLEVEL%"
echo.
echo  [1] Run checks again
echo  [2] Download tools ^(yt-dlp, ffmpeg, ffprobe^)
echo  [3] Build web UI
echo  [4] Start full stack ^(same as start-stack.cmd^)
echo  [5] API only ^(api-backend.cmd^)
echo  [6] Dev mode ^(Vite + API reload^)
echo  [7] Stop leftover stack processes
echo  [8] OBS setup notes
echo  [Q] Quit
echo.
set "CHOICE="
set /p CHOICE=Choose:
if /i "!CHOICE!"=="1" goto menu
if /i "!CHOICE!"=="2" goto fetch_tools
if /i "!CHOICE!"=="3" goto build_ui
if /i "!CHOICE!"=="4" goto launch_stack
if /i "!CHOICE!"=="5" goto launch_api
if /i "!CHOICE!"=="6" goto launch_dev
if /i "!CHOICE!"=="7" goto stop_stack
if /i "!CHOICE!"=="8" goto obs_notes
if /i "!CHOICE!"=="Q" exit /b 0
goto menu

:fetch_tools
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\fetch-tools.ps1"
pause
goto menu

:build_ui
call "%ROOT%build-frontend.cmd"
pause
goto menu

:launch_api
call "%ROOT%api-backend.cmd"
pause
goto menu

:launch_dev
call "%ROOT%scripts\dev.cmd"
pause
goto menu

:stop_stack
call "%ROOT%scripts\stop-stack.cmd"
pause
goto menu

:launch_stack
call "%ROOT%scripts\preflight.cmd"
if errorlevel 1 (
    echo.
    echo  Fix [FAIL] items above, or continue anyway with start-stack.cmd
    if /i not "%MODE%"=="--start" if /i not "%MODE%"=="start" pause
)
call "%ROOT%start-stack.cmd"
if /i "%MODE%"=="--start" exit /b 0
if /i "%MODE%"=="start" exit /b 0
pause
goto menu

:obs_notes
cls
echo.
echo  OBS one-time setup
echo  -------------------
echo  1. OBS 28+ — enable WebSocket ^(port 4455^)
echo  2. backend\.env — OBS_PASSWORD
echo  3. Stream — Custom: rtmp://localhost:1935/live  key: vrstream
echo  4. Media source named VRStream
echo  5. start-stack.cmd must be running for HLS ^(:8888^)
echo.
pause
goto menu
