# Download yt-dlp + ffmpeg (essentials) into tools/
# Run from repo root:  powershell -ExecutionPolicy Bypass -File scripts\fetch-tools.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Tools = Join-Path $Root "tools"
$Media = Join-Path $Root "MediaMTX"
New-Item -ItemType Directory -Force -Path $Tools | Out-Null

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

Write-Step "yt-dlp"
$YtdlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
$YtdlpOut = Join-Path $Tools "yt-dlp.exe"
Invoke-WebRequest -Uri $YtdlpUrl -OutFile $YtdlpOut -UseBasicParsing
Write-Host "Saved $YtdlpOut"

Write-Step "ffmpeg + ffprobe (BtbN essentials win64)"
$FfmpegZip = Join-Path $env:TEMP "ffmpeg-essentials.zip"
$FfmpegUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
Invoke-WebRequest -Uri $FfmpegUrl -OutFile $FfmpegZip -UseBasicParsing
$Extract = Join-Path $env:TEMP "ffmpeg-extract"
if (Test-Path $Extract) { Remove-Item -Recurse -Force $Extract }
Expand-Archive -Path $FfmpegZip -DestinationPath $Extract -Force
$Bin = Get-ChildItem -Path $Extract -Recurse -Directory -Filter "bin" | Select-Object -First 1
if (-not $Bin) { throw "Could not find bin/ in ffmpeg zip" }
Copy-Item (Join-Path $Bin.FullName "ffmpeg.exe") (Join-Path $Tools "ffmpeg.exe") -Force
Copy-Item (Join-Path $Bin.FullName "ffprobe.exe") (Join-Path $Tools "ffprobe.exe") -Force
Write-Host "Saved ffmpeg.exe and ffprobe.exe"

Write-Step "MediaMTX (optional)"
$MtxOut = Join-Path $Media "mediamtx.exe"
if (-not (Test-Path $MtxOut)) {
    Write-Host "Download mediamtx from https://github.com/bluenviron/mediamtx/releases"
    Write-Host "and place mediamtx.exe in MediaMTX\"
} else {
    Write-Host "Already present: $MtxOut"
}

Write-Host "`nDone. Run startup.cmd to verify." -ForegroundColor Green
