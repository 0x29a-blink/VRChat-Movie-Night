@echo off
REM ============================================================
REM  PRIMARY START — full Movie Night stack (one window)
REM    MediaMTX + optional AIOStreams + web app :8000
REM  Stop with Ctrl+C, close this window, or:  stop-stack.cmd
REM ============================================================
setlocal EnableDelayedExpansion
title Movie Night - Stack
cd /d "%~dp0"

echo.
echo  Stopping any leftover stack from a previous run...
call "%~dp0scripts\stop-stack.cmd" quiet

cd /d "%~dp0backend"
if not exist ".venv\Scripts\python.exe" (
    echo [setup] Creating Python virtual environment...
    python -m venv .venv
    call ".venv\Scripts\python.exe" -m pip install --upgrade pip -q
    call ".venv\Scripts\python.exe" -m pip install -r requirements.txt -q
)

call ".venv\Scripts\python.exe" run_stack.py
set "EC=!ERRORLEVEL!"
echo.
if not "!EC!"=="0" echo  Stack exited with error !EC!
endlocal
exit /b %EC%
