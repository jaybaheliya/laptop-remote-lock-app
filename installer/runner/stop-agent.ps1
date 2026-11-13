param([Parameter(Mandatory = $false)][string]$AgentScriptPath)

$ErrorActionPreference = 'SilentlyContinue'
$configDir = Join-Path $env:LOCALAPPDATA 'LaptopLockAgent'
$stopFlag = Join-Path $configDir 'agent.stop'

try {
  if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null
  }
  New-Item -ItemType File -Force -Path $stopFlag | Out-Null
} catch {}

# Stop system tray process if running
Get-Process LaptopLockAgentTray -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Stop agent by stored PID
$pidPath = Join-Path $configDir '.agent.pid'
if (Test-Path $pidPath) {
  try {
    $pId = (Get-Content $pidPath -Raw).Trim()
    if ($pId -and ($pId -match '^\d+$')) {
      Stop-Process -Id ([int]$pId) -Force -ErrorAction SilentlyContinue
    }
  } catch {}
}

# Stop any running process executing agent.js or LaptopLockAgent
try {
  $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and ($_.CommandLine -like "*agent.js*" -or $_.CommandLine -like "*LaptopLockAgent*")
  }
  if ($procs) {
    foreach ($p in $procs) {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
} catch {}

Start-Sleep -Milliseconds 600
