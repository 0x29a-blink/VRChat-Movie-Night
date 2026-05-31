@echo off
REM Rebuild native Node addons when the active Node version changes.
setlocal EnableDelayedExpansion
set "REPO_DIR=%~1"
set "STAMP_FILE=%REPO_DIR%\.node-modules-version"

if "%REPO_DIR%"=="" exit /b 1
if not exist "%REPO_DIR%\package.json" exit /b 1

for /f "delims=" %%m in ('node -p "process.versions.modules"') do set "CURRENT_MOD=%%m"

set "NEED_REBUILD=1"
if exist "%STAMP_FILE%" (
    set /p "SAVED_MOD=" < "%STAMP_FILE%"
    if "!SAVED_MOD!"=="!CURRENT_MOD!" set "NEED_REBUILD=0"
)

if "!NEED_REBUILD!"=="0" exit /b 0

echo [setup] Rebuilding native modules for Node module !CURRENT_MOD! ...
pushd "%REPO_DIR%"
call pnpm rebuild better-sqlite3 bcrypt
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" exit /b %RC%

echo !CURRENT_MOD!> "%STAMP_FILE%"
exit /b 0
