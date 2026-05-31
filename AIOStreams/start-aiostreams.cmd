@echo off
REM ============================================================
REM  AIOStreams — run your self-hosted instance (from source)
REM  Configure at http://localhost:3000/stremio/configure
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM Prefer scoop nodejs-lts when present so setup/start use the same Node.
if exist "%USERPROFILE%\scoop\apps\nodejs-lts\current\bin" (
    set "PATH=%USERPROFILE%\scoop\apps\nodejs-lts\current\bin;%USERPROFILE%\scoop\apps\nodejs-lts\current;%PATH%"
)

set "REPO_DIR=%~dp0repo"
set "ENV_FILE=%~dp0.env"
set "SERVER_ENTRY=%REPO_DIR%\packages\server\dist\server.js"

if not exist "%REPO_DIR%\package.json" (
    echo [error] AIOStreams source not found. Run setup-aiostreams.cmd first.
    exit /b 1
)

if not exist "%SERVER_ENTRY%" (
    echo [error] Server not built. Run setup-aiostreams.cmd first.
    exit /b 1
)

if not exist "%ENV_FILE%" (
    echo [error] Missing AIOStreams\.env — run setup-aiostreams.cmd first.
    exit /b 1
)

if not exist "%~dp0data" mkdir "%~dp0data"

REM Sync bootstrap env into repo cwd (AIOStreams reads .env from process cwd).
copy /Y "%ENV_FILE%" "%REPO_DIR%\.env" >nul

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%v"
if !NODE_MAJOR! LSS 24 (
    echo [error] Node.js 24+ required ^(found v!NODE_MAJOR!^).
    echo         Upgrade: scoop install nodejs-lts
    exit /b 1
)

call "%~dp0_rebuild-native.cmd" "%REPO_DIR%"
if errorlevel 1 exit /b 1

echo.
echo  AIOStreams starting...
echo  Configure: http://localhost:3000/stremio/configure
echo  Stop with Ctrl+C in this window.
echo.

pushd "%REPO_DIR%"
call pnpm run start
set "EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %EXIT_CODE%
