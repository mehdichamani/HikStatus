Set WshShell = CreateObject("WScript.Shell")

WshShell.Run "cmd /c taskkill /F /IM python.exe >nul 2>&1", 0, True
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -aon ^| findstr :28888 ^| findstr LISTENING') do taskkill /F /PID %a >nul 2>&1", 0, True
WScript.Sleep 1000

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

WshShell.CurrentDirectory = scriptDir
WshShell.Run "pythonw.exe tray.py", 0, False

WScript.Sleep 3000
CreateObject("Shell.Application").ShellExecute "http://localhost:28888"
