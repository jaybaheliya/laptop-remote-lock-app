@echo off
echo Stopping Laptop Lock Agent and Node.js processes...
taskkill /f /im node.exe 2>nul
timeout /t 2 /nobreak >nul

echo Deploying updated agent.js...
copy /y "j:\Web Developer\AI\laptop-lock-app\agent.js" "%LOCALAPPDATA%\Programs\LaptopLockAgent\app\agent.js"
if errorlevel 1 (
    echo FAILED to copy agent.js - check permissions
    pause
    exit /b 1
)

echo Deploying updated start-agent.bat...
copy /y "j:\Web Developer\AI\laptop-lock-app\installer\runner\start-agent.bat" "%LOCALAPPDATA%\Programs\LaptopLockAgent\runner\start-agent.bat"

echo Restarting agent...
start "" wscript.exe "%LOCALAPPDATA%\Programs\LaptopLockAgent\runner\start-agent-hidden.vbs"

echo Done! Agent restarted with new unlock logic.
timeout /t 3 /nobreak >nul

