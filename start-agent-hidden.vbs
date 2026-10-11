
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "J:\Web Developer\AI\laptop-lock-app"
WshShell.Run """J:\Web Developer\AI\laptop-lock-app\start-agent.bat""", 0, False
