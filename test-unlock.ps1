# Wake-only smoke test. Windows sign-in must be completed locally.

$scriptPath = Join-Path $env:TEMP "win_unlock_worker.ps1"

if (-not (Test-Path $scriptPath)) {
    Write-Host "Unlock script not found at $scriptPath - agent must have run at least once"
    exit 1
}

Write-Host "Running display wake test; no Windows credential is accepted or sent."
Write-Host "Script: $scriptPath"

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath

Write-Host "Unlock script exited with: $LASTEXITCODE"

