@echo off
REM Quick environment check (used by startup.cmd menu).
setlocal EnableExtensions EnableDelayedExpansion
set "ROOT=%~dp0\.."
set "CHECK_FAILED=0"

echo.
echo  --- Required ---
where python >nul 2>&1
if errorlevel 1 (
    echo  [FAIL] Python not on PATH
    set "CHECK_FAILED=1"
) else (
    for /f "delims=" %%V in ('python --version 2^>^&1') do echo  [ OK ] %%V
)

if exist "%ROOT%\backend\.venv\" (echo  [ OK ] backend\.venv) else (echo  [WARN] backend\.venv — created on first start)

if exist "%ROOT%\backend\.env" (echo  [ OK ] backend\.env) else (echo  [WARN] backend\.env — copied from .env.example on first start)

echo.
echo  --- Tools ---
if exist "%ROOT%\tools\ffmpeg.exe" (echo  [ OK ] tools\ffmpeg.exe) else (echo  [ -- ] tools\ffmpeg.exe)
if exist "%ROOT%\MediaMTX\mediamtx.exe" (echo  [ OK ] MediaMTX\mediamtx.exe) else (
    where mediamtx >nul 2>&1
    if errorlevel 1 (echo  [WARN] MediaMTX — put mediamtx.exe in MediaMTX\ or PATH) else (echo  [ OK ] mediamtx on PATH)
)

echo.
echo  --- Web UI ---
if exist "%ROOT%\frontend\dist\index.html" (echo  [ OK ] frontend built) else (echo  [WARN] run build-frontend.cmd)

echo.
echo  --- Optional ---
if exist "%ROOT%\AIOStreams\repo\packages\server\dist\server.js" (echo  [ OK ] AIOStreams built) else (echo  [ -- ] AIOStreams not built)
powershell -NoProfile -Command "$c = Test-NetConnection -ComputerName 127.0.0.1 -Port 4455 -WarningAction SilentlyContinue; exit $(if ($c.TcpTestSucceeded) {0} else {1})" >nul 2>&1
if errorlevel 1 (echo  [ -- ] OBS WebSocket :4455 not listening) else (echo  [ OK ] OBS WebSocket :4455)

if "%CHECK_FAILED%"=="1" (
  endlocal
  exit /b 1
)
endlocal
exit /b 0
