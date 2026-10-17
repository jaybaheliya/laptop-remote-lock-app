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

:: Fallback check: if bundled node.exe is missing, search PATH
if not exist "%NODE_EXE%" (
    where node >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        set "NODE_EXE=node"
    ) else (
        echo [%date% %time%] Node.js runtime not found in %NODE_EXE% or PATH.>> "%LOG_DIR%\agent.log"
        timeout /t 30 /nobreak >nul
        goto restart
    )
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

