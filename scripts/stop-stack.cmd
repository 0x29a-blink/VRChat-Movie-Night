@echo off
REM Stop MediaMTX / AIOStreams / API children left after closing the stack window.
setlocal
cd /d "%~dp0\.."
set "PS_ARGS="
if /i "%~1"=="quiet" set "PS_ARGS=-Quiet"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-stack.ps1" %PS_ARGS%
endlocal
