
@echo off
cd /d "J:\Web Developer\AI\laptop-lock-app"

if not exist "logs" mkdir "logs"

"C:\Program Files\nodejs\node.exe" "J:\Web Developer\AI\laptop-lock-app\agent.js" >> "J:\Web Developer\AI\laptop-lock-app\logs\agent.log" 2>&1

