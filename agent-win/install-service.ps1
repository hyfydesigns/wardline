<#
.SYNOPSIS
  Installs the Wardline agent as a Windows service.

.DESCRIPTION
  Copies the published agent to Program Files and registers it as an
  auto-start service running as LocalSystem, with restart-on-failure recovery.

  This performs a system/security modification and MUST be run from an
  ELEVATED PowerShell prompt (Run as administrator). It is intentionally not
  run automatically — installing a tamper-resistant background service that
  starts as SYSTEM is a deliberate action a parent (device owner) takes.

.EXAMPLE
  # From an elevated PowerShell prompt, in the agent-win folder:
  .\install-service.ps1
#>

[CmdletBinding()]
param(
  [string]$ServiceName = 'WardlineAgent',
  [string]$InstallDir  = "$env:ProgramFiles\Wardline",
  [string]$SourceDir
)

$ErrorActionPreference = 'Stop'

# Prefer the release output (dist\agent); fall back to a local publish folder.
if (-not $SourceDir) {
  $candidates = @(
    (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist\agent'),
    (Join-Path $PSScriptRoot 'publish')
  )
  $SourceDir = $candidates | Where-Object { Test-Path (Join-Path $_ 'wardline-agent.exe') } | Select-Object -First 1
  if (-not $SourceDir) { $SourceDir = $candidates[0] }
}

# --- Require elevation -------------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
  Write-Error "This script must be run from an elevated (Run as administrator) PowerShell prompt."
  exit 1
}

# --- Require a published build -----------------------------------------------
$exeSource = Join-Path $SourceDir 'wardline-agent.exe'
if (-not (Test-Path $exeSource)) {
  Write-Error "Published agent not found at $exeSource. Run:  npm run build:release   (or: dotnet publish -c Release -r win-x64 -o ..\dist\agent)"
  exit 1
}

# --- Stop & remove any existing instance -------------------------------------
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Existing service found; stopping and removing it first..."
  if ($existing.Status -ne 'Stopped') { Stop-Service -Name $ServiceName -Force }
  sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 2
}

# --- Copy files into Program Files -------------------------------------------
Write-Host "Copying agent to $InstallDir ..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path (Join-Path $SourceDir '*') -Destination $InstallDir -Recurse -Force
$exePath = Join-Path $InstallDir 'wardline-agent.exe'

# --- Register the service ----------------------------------------------------
Write-Host "Registering service '$ServiceName' ..."
# LocalSystem, automatic start.
sc.exe create $ServiceName binPath= "`"$exePath`"" start= auto obj= LocalSystem DisplayName= "Wardline Monitor Agent" | Out-Null
sc.exe description $ServiceName "Wardline parental-monitoring agent. Reports device telemetry and integrity status." | Out-Null

# Restart on failure: 5s, 5s, then every 5s; reset the failure counter daily.
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
# Also restart when the process exits with a non-crash code (best-effort; ignore on older Windows).
try { sc.exe failureflag $ServiceName 1 | Out-Null } catch { }

# --- Start it ----------------------------------------------------------------
Write-Host "Starting service ..."
Start-Service -Name $ServiceName
Start-Sleep -Seconds 2
Get-Service -Name $ServiceName | Format-Table -AutoSize

Write-Host ""
Write-Host "Installed. The service now auto-starts and restarts on failure." -ForegroundColor Green
Write-Host "Edit $InstallDir\appsettings.json to set ApiUrl / DeviceToken, then: Restart-Service $ServiceName"
Write-Host "Logs: Get-WinEvent -LogName Application -MaxEvents 20 | Where-Object { `$_.ProviderName -like '*Wardline*' }"
