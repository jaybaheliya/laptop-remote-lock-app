Add-Type -Path "j:\Web Developer\AI\laptop-lock-app\DirectPostTest.cs"
Add-Type -AssemblyName System.Windows.Forms

$form = New-Object System.Windows.Forms.Form
$form.Text = "WM_CHAR Input Test"
$textBox = New-Object System.Windows.Forms.TextBox
$textBox.Dock = [System.Windows.Forms.DockStyle]::Fill
$form.Controls.Add($textBox)

$form.Show()
[System.Windows.Forms.Application]::DoEvents()

Start-Sleep -Milliseconds 200

# Send WM_CHAR directly to textbox handle
[DirectPostTest]::SendCharsToHandle($textBox.Handle, "6282")

[System.Windows.Forms.Application]::DoEvents()
Start-Sleep -Milliseconds 200

Write-Host "Result in TextBox using WM_CHAR: [" $textBox.Text "]"
$form.Close()
$form.Dispose()
