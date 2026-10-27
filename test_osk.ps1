Start-Process "C:\Windows\System32\osk.exe"
Start-Sleep -Seconds 2

$osk = Get-Process -Name osk -ErrorAction SilentlyContinue
if ($osk) {
    Write-Host "OSK PID: " $osk.Id
    Write-Host "OSK Window Handle: " $osk.MainWindowHandle
} else {
    Write-Host "OSK failed to launch"
}

Stop-Process -Name osk -Force -ErrorAction SilentlyContinue
