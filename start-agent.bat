@echo off
cd /d "J:\Web Developer\AI\laptop-lock-app"

if not exist "logs" mkdir "logs"

:: Resolve Node.js binary: prefer default 64-bit path, fallback to PATH
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" (
    where node >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        set "NODE_EXE=node"
    ) else (
        echo [%date% %time%] Node.js executable not found in Program Files or PATH.>> "logs\agent.log"
        timeout /t 30 /nobreak >nul
        goto restart
    )
)

:restart
:: Log rotation: if agent.log > 5MB (5242880 bytes), rotate to agent.old.log
if exist "logs\agent.log" (
    for %%F in ("logs\agent.log") do (
        if %%~zF GTR 5242880 (
            del "logs\agent.old.log" 2>nul
            move /y "logs\agent.log" "logs\agent.old.log" >nul
        )
    )
)

echo [%date% %time%] Starting laptop agent...>> "logs\agent.log"

"%NODE_EXE%" "J:\Web Developer\AI\laptop-lock-app\agent.js" >> "J:\Web Developer\AI\laptop-lock-app\logs\agent.log" 2>&1

echo [%date% %time%] Agent exited with code %ERRORLEVEL%. Restarting in 10 seconds...>> "logs\agent.log"

timeout /t 10 /nobreak >nul
goto restart
