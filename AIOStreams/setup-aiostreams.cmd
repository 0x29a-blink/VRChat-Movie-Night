@echo off
REM ============================================================
REM  AIOStreams — first-time setup from source (no Docker)
REM  Clones upstream, installs deps, builds, creates .env
REM  Docs: https://docs.aiostreams.viren070.me/getting-started/deployment/#from-source
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM Prefer scoop nodejs-lts when present so setup/start use the same Node.
if exist "%USERPROFILE%\scoop\apps\nodejs-lts\current\bin" (
    set "PATH=%USERPROFILE%\scoop\apps\nodejs-lts\current\bin;%USERPROFILE%\scoop\apps\nodejs-lts\current;%PATH%"
)

set "REPO_DIR=%~dp0repo"
set "DATA_DIR=%~dp0data"
set "ENV_FILE=%~dp0.env"
set "UPSTREAM=https://github.com/Viren070/AIOStreams.git"

echo.
echo  AIOStreams setup (from source)
echo  ==============================
echo.

where git >nul 2>&1
if errorlevel 1 (
    echo [error] git not found on PATH. Install Git for Windows and re-run.
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo [error] node not found on PATH.
    echo         Install Node.js 24+ ^(e.g. scoop install nodejs^) and re-run.
    exit /b 1
)

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%v"
if !NODE_MAJOR! LSS 24 (
    echo [error] Node.js 24+ required ^(found v%NODE_MAJOR%^). Current AIOStreams needs Node 24+.
    echo         Upgrade: scoop update nodejs   or   https://nodejs.org/
    exit /b 1
)

where pnpm >nul 2>&1
if errorlevel 1 (
    echo [setup] pnpm not found — installing globally via npm...
    call npm install -g pnpm@11
    if errorlevel 1 (
        echo [error] Failed to install pnpm. Try: npm install -g pnpm@11
        exit /b 1
    )
)

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

if not exist "%REPO_DIR%\.git" (
    echo [setup] Cloning AIOStreams into repo\ ...
    git clone "%UPSTREAM%" "%REPO_DIR%"
    if errorlevel 1 exit /b 1
) else (
    echo [setup] Updating existing clone...
    pushd "%REPO_DIR%"
    git pull --ff-only
    if errorlevel 1 (
        echo [warn] git pull failed — continuing with existing checkout.
    )
    popd
)

if not exist "%ENV_FILE%" (
    echo [setup] Creating .env from .env.example ...
    copy /Y "%~dp0.env.example" "%ENV_FILE%" >nul
    for /f "delims=" %%k in ('node -e "console.log(require(''crypto'').randomBytes(32).toString(''hex''))"') do (
        powershell -NoProfile -Command "(Get-Content '%ENV_FILE%') -replace '^SECRET_KEY=.*','SECRET_KEY=%%k' | Set-Content '%ENV_FILE%' -Encoding ascii"
    )
    echo [setup] Generated SECRET_KEY in AIOStreams\.env
) else (
    echo [setup] Using existing AIOStreams\.env
)

echo.
echo [setup] Installing dependencies ^(pnpm install^) ...
pushd "%REPO_DIR%"
call pnpm install
if errorlevel 1 (
    popd
    exit /b 1
)

call "%~dp0_rebuild-native.cmd" "%REPO_DIR%"
if errorlevel 1 (
    popd
    exit /b 1
)

echo.
echo [setup] Building ^(pnpm run build^) ...
call pnpm run build
if errorlevel 1 (
    popd
    exit /b 1
)

echo.
echo [setup] Generating metadata ^(pnpm run metadata --channel=nightly^) ...
call pnpm run metadata --channel=nightly
set "BUILD_OK=%ERRORLEVEL%"
popd

echo.
if %BUILD_OK% neq 0 (
    echo [error] Build failed. See output above.
    exit /b 1
)

echo  Setup complete.
echo.
echo  Next steps:
echo    1. Run start-aiostreams.cmd  ^(or start-movie-night.cmd to launch everything^)
echo    2. Open http://localhost:3000/stremio/configure
echo    3. Enable marketplace addons + built-ins ^(Torrentio, Knaben, etc.^)
echo       — these are disabled on public instances but work on your own instance.
echo    4. Add your TorBox API key in AIOStreams configure page.
echo    5. Copy your manifest URL, remove "/manifest.json", paste into Movie Night
echo       Settings -^> AIOStreams base URL
echo       ^(e.g. http://localhost:3000/stremio/your-config-id^)
echo.
endlocal
