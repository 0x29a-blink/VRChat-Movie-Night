@echo off
REM Optional personal Cloudflare Tunnel — uses npm cloudflared (no separate install).
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Node.js not found on PATH — install Node 18+ or use the stack's AIOStreams Node.
    echo.
    exit /b 1
)

if not exist "node_modules\cloudflared" (
    echo [tunnel] Installing cloudflare npm deps ^(one time^)...
    call npm install --omit=dev
    if errorlevel 1 exit /b 1
)

if not exist ".env" if not exist "config.yml" (
    echo.
    echo  Missing cloudflare\.env or cloudflare\config.yml
    echo  Easiest: copy .env.example to .env and paste CF_TUNNEL_TOKEN from Cloudflare dashboard.
    echo.
    exit /b 1
)

echo.
node run.mjs
set "EC=%ERRORLEVEL%"
endlocal & exit /b %EC%
