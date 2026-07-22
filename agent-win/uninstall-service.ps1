<#
.SYNOPSIS
  Stops and removes the Wardline agent Windows service.

.DESCRIPTION
  Must be run from an ELEVATED PowerShell prompt. In the real product an
  uninstall additionally requires the parent's dashboard password or a remote
  approval; this script is the developer/parent-side removal tool.

.EXAMPLE
  .\uninstall-service.ps1
#>

[CmdletBinding()]
param(
  [string]$ServiceName = 'WardlineAgent',
  [string]$InstallDir  = "$env:ProgramFiles\Wardline",
  [switch]$KeepFiles
)

$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
  Write-Error "This script must be run from an elevated (Run as administrator) PowerShell prompt."
  exit 1
}

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
  if ($svc.Status -ne 'Stopped') {
    Write-Host "Stopping $ServiceName ..."
    Stop-Service -Name $ServiceName -Force
  }
  Write-Host "Deleting service $ServiceName ..."
  sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 2
} else {
  Write-Host "Service '$ServiceName' is not installed."
}

if (-not $KeepFiles -and (Test-Path $InstallDir)) {
  Write-Host "Removing $InstallDir ..."
  Remove-Item -Path $InstallDir -Recurse -Force
}

Write-Host "Done." -ForegroundColor Green
