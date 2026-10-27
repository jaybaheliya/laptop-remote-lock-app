param([string]$Password = "test1234")

# Quick standalone test of the unlock script logic
# Run this WHILE the laptop is locked to test unlock behavior
# Usage: powershell -File test-unlock.ps1 -Password "YourActualPassword"

$PasswordBase64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Password))

$scriptPath = Join-Path $env:TEMP "win_unlock_worker.ps1"

if (-not (Test-Path $scriptPath)) {
    Write-Host "Unlock script not found at $scriptPath - agent must have run at least once"
    exit 1
}

Write-Host "Running unlock test with password length: $($Password.Length)"
Write-Host "Script: $scriptPath"

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -PasswordBase64 $PasswordBase64

Write-Host "Unlock script exited with: $LASTEXITCODE"

