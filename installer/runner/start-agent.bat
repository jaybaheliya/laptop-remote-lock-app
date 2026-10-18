@echo off
setlocal

:: Determine directory where this script is located
set "RUNNER_DIR=%~dp0"
:: Base application directory is one level up from runner
pushd "%RUNNER_DIR%.."
set "APP_DIR=%CD%"
popd

:: Setup user log folder in LocalAppData to avoid permission issues
set "LOG_DIR=%LOCALAPPDATA%\LaptopLockAgent\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: Path to bundled portable Node.js executable
set "NODE_EXE=%APP_DIR%\bin\node.exe"

:: Fallback check: if bundled node.exe is missing, search PATH or download portable runtime
if not exist "%NODE_EXE%" (
    where node >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        set "NODE_EXE=node"
    ) else (
        echo [%date% %time%] Node.js runtime not found. Automatically provisioning portable runtime...>> "%LOG_DIR%\agent.log"
        if not exist "%APP_DIR%\bin" mkdir "%APP_DIR%\bin"
        powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('https://nodejs.org/dist/v20.18.0/win-x64/node.exe', '%APP_DIR%\bin\node.exe')" >> "%LOG_DIR%\agent.log" 2>&1
        if exist "%APP_DIR%\bin\node.exe" (
            echo [%date% %time%] Portable Node.js runtime provisioned successfully.>> "%LOG_DIR%\agent.log"
        ) else (
            echo [%date% %time%] Could not provision Node.js runtime. Retrying in 30 seconds...>> "%LOG_DIR%\agent.log"
            timeout /t 30 /nobreak >nul
            goto restart
        )
    )
)

:: Launch native system tray notification icon (if present and not already running)
if exist "%APP_DIR%\app\LaptopLockAgentTray.exe" (
    start "" "%APP_DIR%\app\LaptopLockAgentTray.exe"
) else if exist "%APP_DIR%\app\tray.ps1" (
    start "" /b powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%APP_DIR%\app\tray.ps1"
)

:restart
:: Log rotation: if agent.log > 5MB (5242880 bytes), rotate to agent.old.log
if exist "%LOG_DIR%\agent.log" (
    for %%F in ("%LOG_DIR%\agent.log") do (
        if %%~zF GTR 5242880 (
            del "%LOG_DIR%\agent.old.log" 2>nul
            move /y "%LOG_DIR%\agent.log" "%LOG_DIR%\agent.old.log" >nul
        )
    )
)

echo [%date% %time%] Starting Laptop Lock Agent...>> "%LOG_DIR%\agent.log"

:: Execute agent.js with user LocalAppData configuration
"%NODE_EXE%" "%APP_DIR%\app\agent.js" >> "%LOG_DIR%\agent.log" 2>&1

echo [%date% %time%] Agent process exited with code %ERRORLEVEL%. Restarting in 10 seconds...>> "%LOG_DIR%\agent.log"

timeout /t 10 /nobreak >nul
goto restart

