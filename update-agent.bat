@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "INSTALL_DIR=%LOCALAPPDATA%\Programs\LaptopLockAgent"
set "CONFIG_DIR=%LOCALAPPDATA%\LaptopLockAgent"
set "STOP_FLAG=%CONFIG_DIR%\agent.stop"
set "TASK_NAME=LaptopLockAgent"

if not exist "%INSTALL_DIR%\app" (
    echo Laptop Lock Agent installation was not found at:
    echo %INSTALL_DIR%
    pause
    exit /b 1
)

if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"
type nul > "%STOP_FLAG%"

echo Stopping the Laptop Lock Agent scheduled task...
schtasks /End /TN "%TASK_NAME%" >nul 2>&1
if exist "%CONFIG_DIR%\.agent.pid" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$pidFile = '%CONFIG_DIR%\.agent.pid'; $pidText = (Get-Content -Raw -LiteralPath $pidFile).Trim(); if ($pidText -match '^\d+$') { $proc = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq [int]$pidText -and $_.CommandLine -like '*\LaptopLockAgent\app\agent.js*' }; if ($proc) { Stop-Process -Id $proc.ProcessId -Force } }"
)
timeout /t 2 /nobreak >nul

echo Deploying updated agent and runner...
copy /y "%PROJECT_DIR%agent.js" "%INSTALL_DIR%\app\agent.js" >nul
if errorlevel 1 goto copy_failed

copy /y "%PROJECT_DIR%installer\runner\start-agent.bat" "%INSTALL_DIR%\runner\start-agent.bat" >nul
if errorlevel 1 goto copy_failed

copy /y "%PROJECT_DIR%installer\runner\start-agent-hidden.vbs" "%INSTALL_DIR%\runner\start-agent-hidden.vbs" >nul
if errorlevel 1 goto copy_failed

del "%STOP_FLAG%" 2>nul
echo Restarting the Laptop Lock Agent...
schtasks /Run /TN "%TASK_NAME%" >nul 2>&1
if errorlevel 1 (
    start "" wscript.exe "%INSTALL_DIR%\runner\start-agent-hidden.vbs"
)

echo Updated agent and launcher files and requested restart.
timeout /t 3 /nobreak >nul
exit /b 0

:copy_failed
del "%STOP_FLAG%" 2>nul
schtasks /Run /TN "%TASK_NAME%" >nul 2>&1
if errorlevel 1 (
    start "" wscript.exe "%INSTALL_DIR%\runner\start-agent-hidden.vbs"
)
echo Update failed while copying files. Check that the installation folder is writable.
pause
exit /b 1
