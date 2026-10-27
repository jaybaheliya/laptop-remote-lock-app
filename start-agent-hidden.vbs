Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

currentFolder = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = fso.BuildPath(currentFolder, "start-agent.bat")

If fso.FileExists(batPath) Then
    WshShell.CurrentDirectory = currentFolder
    WshShell.Run """" & batPath & """", 0, False
End If
