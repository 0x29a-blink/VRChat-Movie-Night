# Stop Movie Night stack processes (saved PIDs + stray mediamtx.exe).
param(
    [switch]$Quiet
)

$ErrorActionPreference = "SilentlyContinue"
$Root = Split-Path $PSScriptRoot -Parent
$StateFile = Join-Path $Root ".stack\state.json"
$stopped = 0

function Stop-PidTree([int]$Pid, [string]$Name) {
    if ($Pid -le 0) { return $false }
    $p = Get-Process -Id $Pid -ErrorAction SilentlyContinue
    if (-not $p) { return $false }
    & taskkill /PID $Pid /T /F 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        if (-not $Quiet) { Write-Host "[stop] Ended PID $Pid ($Name)" }
        return $true
    }
    return $false
}

if (Test-Path $StateFile) {
    $state = Get-Content $StateFile -Raw | ConvertFrom-Json
    foreach ($entry in $state.processes) {
        if (Stop-PidTree -Pid ([int]$entry.pid) -Name $entry.name) { $stopped++ }
    }
    Remove-Item $StateFile -Force -ErrorAction SilentlyContinue
}

$mtx = Get-Process -Name mediamtx -ErrorAction SilentlyContinue
if ($mtx) {
    & taskkill /IM mediamtx.exe /F 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        if (-not $Quiet) { Write-Host "[stop] Ended mediamtx.exe" }
        $stopped++
    }
}

if (-not $Quiet) {
    if ($stopped -eq 0) {
        Write-Host "[stop] No Movie Night stack processes were running."
    } else {
        Write-Host "[stop] Done. Stopped $stopped process group(s)."
    }
}

exit 0
