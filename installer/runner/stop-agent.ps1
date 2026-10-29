param([Parameter(Mandatory = $true)][string]$AgentScriptPath)

$ErrorActionPreference = 'Stop'
$configDir = Join-Path $env:LOCALAPPDATA 'LaptopLockAgent'
$agentScript = [IO.Path]::GetFullPath($AgentScriptPath)
$stopFlag = Join-Path $configDir 'agent.stop'

New-Item -ItemType Directory -Force -Path $configDir | Out-Null
New-Item -ItemType File -Force -Path $stopFlag | Out-Null

try {
  $agents = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and $_.CommandLine.IndexOf($agentScript, [StringComparison]::OrdinalIgnoreCase) -ge 0
  }
  foreach ($agent in $agents) {
    Stop-Process -Id $agent.ProcessId -Force -ErrorAction Stop
  }
  Start-Sleep -Milliseconds 700
} catch {
  Remove-Item -LiteralPath $stopFlag -Force -ErrorAction SilentlyContinue
  throw
}
