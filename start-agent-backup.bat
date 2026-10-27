@echo off
setlocal

set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"
if not exist "%APP_DIR%logs" mkdir "%APP_DIR%logs"

set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE_EXE%" (
    where node >nul 2>nul
    if errorlevel 1 (
        echo Node.js was not found in Program Files or PATH.
        exit /b 1
    )
    set "NODE_EXE=node"
)

"%NODE_EXE%" "%APP_DIR%agent.js" >> "%APP_DIR%logs\agent.log" 2>&1
exit /b %ERRORLEVEL%
