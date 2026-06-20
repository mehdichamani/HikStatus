' HikStatus System Tray Launcher
' Runs the app hidden in background, accessible via system tray

Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

' Get the directory where this script is located
scriptPath = FSO.GetParentFolderName(WScript.ScriptFullName)
pyFile = scriptPath & "\start_tray.py"

' Check if start_tray.py exists
If Not FSO.FileExists(pyFile) Then
    MsgBox "start_tray.py not found in: " & scriptPath, vbCritical, "HikStatus Launcher Error"
    WScript.Quit 1
End If

' Change to the script directory
WshShell.CurrentDirectory = scriptPath

' Run the Python script hidden (0 = hidden window)
WshShell.Run "cmd /c " & Chr(34) & "python " & pyFile & Chr(34), 0, False

' Optional: Show a brief notification
' WScript.Sleep 1000
' WshShell.Run "powershell -Command ""New-BurntToastNotification -Text 'HikStatus', 'Server started on port 28888'""", 0, False