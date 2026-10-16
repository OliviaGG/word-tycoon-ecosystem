$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$sc = $ws.CreateShortcut("$desktop\Wordle Live.lnk")
$sc.TargetPath = 'C:\Wordle\start.bat'
$sc.WorkingDirectory = 'C:\Wordle'
$sc.IconLocation = 'C:\Windows\System32\shell32.dll,24'
$sc.Description = 'Launch Wordle Live Game'
$sc.Save()
Write-Host "Shortcut created on Desktop"
