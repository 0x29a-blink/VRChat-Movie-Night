@echo off
REM ============================================================
REM  LEGACY — not part of the Movie Night web app
REM
REM  Copies a YouTube URL from the clipboard and downloads with
REM  yt-dlp into this folder. Prefer Get Videos in the web app
REM  (library/youtube/, progress UI, auto library scan).
REM ============================================================
for /f "usebackq tokens=* delims=" %%i in (`powershell -command "Get-Clipboard"`) do set "url=%%i"

echo Downloading: "%url%"

:: --js-runtimes deno forces yt-dlp to use your new Scoop installation
yt-dlp --js-runtimes deno "%url%" -o "%%(uploader)s - %%(title)s"

pause
