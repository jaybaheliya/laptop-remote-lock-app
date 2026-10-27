Add-Type -Path "j:\Web Developer\AI\laptop-lock-app\WinTypeTest.cs"
Add-Type -AssemblyName System.Windows.Forms

$form = New-Object System.Windows.Forms.Form
$form.Text = "keybd_event Input Test"
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$textBox = New-Object System.Windows.Forms.TextBox
$textBox.Dock = [System.Windows.Forms.DockStyle]::Fill
$form.Controls.Add($textBox)

$form.Show()
$form.Activate()
$textBox.Focus()
[System.Windows.Forms.Application]::DoEvents()

Start-Sleep -Milliseconds 400

foreach ($c in "6282".ToCharArray()) {
    [WinTypeTest]::SendChar($c)
}

[System.Windows.Forms.Application]::DoEvents()
Start-Sleep -Milliseconds 300

Write-Host "Result in TextBox using keybd_event: [" $textBox.Text "]"
$form.Close()
$form.Dispose()
