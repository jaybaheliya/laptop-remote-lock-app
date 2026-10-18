# =====================================================================
# Laptop Remote Lock Agent - Windows System Tray Notification Icon
# =====================================================================

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon

# Resolve app icon
$iconPath = Join-Path $PSScriptRoot "app_icon.ico"
if (Test-Path $iconPath) {
    try {
        $notifyIcon.Icon = New-Object System.Drawing.Icon($iconPath)
    } catch {
        $notifyIcon.Icon = [System.Drawing.SystemIcons]::Shield
    }
} else {
    $notifyIcon.Icon = [System.Drawing.SystemIcons]::Shield
}

$notifyIcon.Text = "Laptop Remote Lock - Active"
$notifyIcon.Visible = $true

# Context Menu
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

$itemHeader = $contextMenu.Items.Add("Laptop Remote Lock")
$itemHeader.Enabled = $false

$itemStatus = $contextMenu.Items.Add("Status: Active (Connected)")
$itemStatus.Enabled = $false

$sep1 = New-Object System.Windows.Forms.ToolStripSeparator
$contextMenu.Items.Add($sep1) | Out-Null

$itemLock = $contextMenu.Items.Add("Lock Workstation Now")
$itemLock.add_Click({
    Start-Process "rundll32.exe" -ArgumentList "user32.dll,LockWorkStation" -NoNewWindow
})

$itemDash = $contextMenu.Items.Add("Open Web Controller")
$itemDash.add_Click({
    Start-Process "https://laptop-remote-lock-app-mobile-contr-nine.vercel.app"
})

$itemLogs = $contextMenu.Items.Add("View Agent Logs")
$itemLogs.add_Click({
    $logFile = "$env:LOCALAPPDATA\LaptopLockAgent\logs\agent.log"
    if (Test-Path $logFile) {
        Start-Process "notepad.exe" -ArgumentList "`"$logFile`""
    }
})

$sep2 = New-Object System.Windows.Forms.ToolStripSeparator
$contextMenu.Items.Add($sep2) | Out-Null

$itemExit = $contextMenu.Items.Add("Exit Agent")
$itemExit.add_Click({
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    Stop-Process -Name node -ErrorAction SilentlyContinue
    [System.Windows.Forms.Application]::Exit()
})

$notifyIcon.ContextMenuStrip = $contextMenu

# Keep Windows Forms message pump running
[System.Windows.Forms.Application]::Run()

