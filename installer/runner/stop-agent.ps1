param([Parameter(Mandatory = $true)][string]$AgentScriptPath)

$ErrorActionPreference = 'SilentlyContinue'
$configDir = Join-Path $env:LOCALAPPDATA 'LaptopLockAgent'
$stopFlag = Join-Path $configDir 'agent.stop'

try {
  if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null
  }
  New-Item -ItemType File -Force -Path $stopFlag | Out-Null
} catch {}

try {
  $agentScript = [IO.Path]::GetFullPath($AgentScriptPath)
  $agents = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine.IndexOf($agentScript, [StringComparison]::OrdinalIgnoreCase) -ge 0
  }
  if ($agents) {
    foreach ($agent in $agents) {
      Stop-Process -Id $agent.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Milliseconds 700
} catch {}
