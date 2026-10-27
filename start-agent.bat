@echo off
setlocal

set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

if not exist "%APP_DIR%logs" mkdir "%APP_DIR%logs"

:resolve_node
set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE_EXE%" (
    where node >nul 2>nul
    if errorlevel 1 (
        echo [%date% %time%] Node.js executable not found in Program Files or PATH.>> "%APP_DIR%logs\agent.log"
        timeout /t 30 /nobreak >nul
        goto resolve_node
    )
    set "NODE_EXE=node"
)

:restart
if exist "%APP_DIR%logs\agent.log" (
    for %%F in ("%APP_DIR%logs\agent.log") do (
        if %%~zF GTR 5242880 (
            del "%APP_DIR%logs\agent.old.log" 2>nul
            move /y "%APP_DIR%logs\agent.log" "%APP_DIR%logs\agent.old.log" >nul
        )
    )
)

echo [%date% %time%] Starting Laptop Lock Agent...>> "%APP_DIR%logs\agent.log"
"%NODE_EXE%" "%APP_DIR%agent.js" >> "%APP_DIR%logs\agent.log" 2>&1

echo [%date% %time%] Agent exited with code %ERRORLEVEL%. Restarting in 10 seconds...>> "%APP_DIR%logs\agent.log"
timeout /t 10 /nobreak >nul
goto restart
