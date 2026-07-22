<#
.SYNOPSIS
  Build every distributable artifact: the agent, the extension package, and the
  Windows installer — optionally Authenticode-signed.

.DESCRIPTION
  Steps, in order:
    1. dotnet publish  → agent-win\publish
    2. package the browser extension → dist\wardline-extension-vX.Y.Z.zip
    3. compile the installer with Inno Setup → dist\WardlineSetup.exe
    4. sign the agent and installer, if a certificate is supplied

  Steps that need a tool you don't have are skipped with a clear message rather
  than failing the whole build, so you always get whatever can be produced.

.PARAMETER CertThumbprint
  Thumbprint of a code-signing certificate in the local certificate store.

.PARAMETER PfxPath / PfxPassword
  Alternative to a thumbprint: sign with a .pfx file.

.PARAMETER SkipInstaller
  Build the agent and extension only.

.EXAMPLE
  .\tools\build-release.ps1
  .\tools\build-release.ps1 -CertThumbprint A1B2C3...
#>

[CmdletBinding()]
param(
  [string]$CertThumbprint,
  [string]$PfxPath,
  [string]$PfxPassword,
  [string]$TimestampUrl = 'http://timestamp.digicert.com',
  [switch]$SkipInstaller
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Skip($msg) { Write-Host "    skipped: $msg" -ForegroundColor Yellow }

$artifacts = @()

# --- 1. Agent ---------------------------------------------------------------
Step 1 'Publishing the Windows agent'
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
  Skip 'the .NET SDK is not installed (https://dotnet.microsoft.com/download)'
} else {
  # Publish OUTSIDE the project directory — publishing into it makes each build
  # nest the previous output (publish\publish\publish\...).
  $agentOut = Join-Path $dist 'agent'
  Remove-Item $agentOut -Recurse -Force -ErrorAction SilentlyContinue
  Push-Location (Join-Path $root 'agent-win')
  try {
    & dotnet publish -c Release -r win-x64 -o $agentOut | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed ($LASTEXITCODE)" }
    $agentExe = Join-Path $agentOut 'wardline-agent.exe'
    Write-Host "    -> dist\agent\wardline-agent.exe"
    $artifacts += $agentExe
  } finally { Pop-Location }
}

# --- 2. Extension -----------------------------------------------------------
Step 2 'Packaging the browser extension'
Push-Location $root
try {
  & npm run package:ext
  if ($LASTEXITCODE -ne 0) { throw "extension packaging failed ($LASTEXITCODE)" }
  $artifacts += (Get-ChildItem (Join-Path $dist 'wardline-extension-v*.zip') | Select-Object -Last 1).FullName
} finally { Pop-Location }

# --- 3. Installer -----------------------------------------------------------
Step 3 'Compiling the Windows installer'
if ($SkipInstaller) {
  Skip '-SkipInstaller was passed'
} else {
  # winget may install Inno Setup machine-wide or per-user, so check both.
  $iscc = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $iscc) {
    $iscc = (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source
  }

  if (-not $iscc) {
    Skip 'Inno Setup 6 not found. Install it with:  winget install -e --id JRSoftware.InnoSetup'
  } elseif (-not (Test-Path (Join-Path $dist 'agent\wardline-agent.exe'))) {
    Skip 'no published agent to bundle (step 1 did not run)'
  } else {
    & $iscc (Join-Path $root 'installer\wardline.iss')
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed ($LASTEXITCODE)" }
    $setup = Join-Path $dist 'WardlineSetup.exe'
    Write-Host "    -> dist\WardlineSetup.exe"
    $artifacts += $setup
  }
}

# --- 4. Signing -------------------------------------------------------------
Step 4 'Signing'
$signArgs = $null
if ($CertThumbprint) { $signArgs = @('/sha1', $CertThumbprint) }
elseif ($PfxPath) {
  $signArgs = @('/f', $PfxPath)
  if ($PfxPassword) { $signArgs += @('/p', $PfxPassword) }
}

if (-not $signArgs) {
  Skip 'no certificate supplied (-CertThumbprint or -PfxPath). Unsigned builds trigger SmartScreen warnings.'
} else {
  $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $signtool) {
    Skip 'signtool.exe not found (install the Windows SDK)'
  } else {
    foreach ($file in $artifacts | Where-Object { $_ -like '*.exe' }) {
      & $signtool.FullName sign @signArgs /fd SHA256 /tr $TimestampUrl /td SHA256 $file
      if ($LASTEXITCODE -ne 0) { throw "signing failed for $file" }
      Write-Host "    signed $(Split-Path $file -Leaf)"
    }
  }
}

# --- Summary ----------------------------------------------------------------
Write-Host "`nArtifacts:" -ForegroundColor Green
foreach ($a in $artifacts) {
  if (Test-Path $a) {
    $kb = [math]::Round((Get-Item $a).Length / 1KB, 1)
    Write-Host ("  {0,-42} {1,8} KB" -f (Resolve-Path -Relative $a), $kb)
  }
}
Write-Host ''
