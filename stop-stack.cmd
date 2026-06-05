@echo off
REM Stop hidden MediaMTX / AIOStreams left running after closing the stack window.
call "%~dp0scripts\stop-stack.cmd" %*
pause
