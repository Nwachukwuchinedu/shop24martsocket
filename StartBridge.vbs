' StartBridge.vbs
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run chr(34) & "PrintBridge.exe" & chr(34), 0, False
Set WshShell = Nothing