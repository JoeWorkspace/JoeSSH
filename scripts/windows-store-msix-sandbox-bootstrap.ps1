[CmdletBinding()]
param(
  [switch]$Elevated
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$inputRoot = "C:\JoeSSHInput"
$outputRoot = "C:\JoeSSHOutput"
$statusPath = Join-Path $outputRoot "status.json"
$resultPath = Join-Path $outputRoot "result.json"
$inputManifestPath = Join-Path $inputRoot "input-manifest.json"
$templatePath = Join-Path $inputRoot "conversion-template.xml"
$bundlePath = Join-Path $inputRoot "MSIXPackagingTool.msixbundle"
$licensePath = Join-Path $inputRoot "MSIXPackagingTool.License.xml"
$driverPath = Join-Path $inputRoot "MSIXPackagingTool.Driver.cab"
$expectedToolVersion = "1.2024.405.0"
$currentStage = "bootstrap"

function Write-SandboxJson {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [object]$Value
  )

  $temporaryPath = "$Path.tmp"
  $Value | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
  Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

function Write-Status {
  param(
    [Parameter(Mandatory = $true)]
    [string]$State,
    [Parameter(Mandatory = $true)]
    [string]$Stage,
    [string]$Code = ""
  )

  Write-SandboxJson -Path $statusPath -Value ([ordered]@{
      schemaVersion = 1
      state = $State
      stage = $Stage
      code = $Code
      updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    })
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-InputManifest {
  $manifest = Get-Content -LiteralPath $inputManifestPath -Raw -Encoding UTF8 |
    ConvertFrom-Json
  $entries = @($manifest.files)
  if ($manifest.schemaVersion -ne 1 -or $entries.Count -ne 6) {
    throw "The private input manifest has an invalid contract."
  }

  $expectedNames = @($entries | ForEach-Object { $_.fileName })
  if (($expectedNames | Select-Object -Unique).Count -ne $entries.Count) {
    throw "The private input manifest contains duplicate file names."
  }
  $actualNames = @(
    Get-ChildItem -LiteralPath $inputRoot -File -Force |
      ForEach-Object { $_.Name }
  )
  $manifestNames = @($expectedNames) + "input-manifest.json"
  if (@(Compare-Object $actualNames $manifestNames -CaseSensitive).Count -ne 0) {
    throw "The private input directory does not match its manifest."
  }

  foreach ($entry in $entries) {
    if (
      [string]::IsNullOrWhiteSpace($entry.fileName) -or
      [IO.Path]::GetFileName($entry.fileName) -cne $entry.fileName -or
      $entry.sha256 -cnotmatch "^[a-f0-9]{64}$" -or
      [int64]$entry.sizeBytes -le 0
    ) {
      throw "The private input manifest contains an invalid file entry."
    }
    $path = Join-Path $inputRoot $entry.fileName
    $item = Get-Item -LiteralPath $path -Force
    $hash = Get-FileHash -LiteralPath $path -Algorithm SHA256
    if (
      $item.Length -ne [int64]$entry.sizeBytes -or
      $hash.Hash.ToLowerInvariant() -cne $entry.sha256
    ) {
      throw "A private input failed integrity verification."
    }
  }
}

function Invoke-CheckedProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string[]]$ArgumentList,
    [int[]]$AllowedExitCodes = @(0)
  )

  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList `
    -PassThru -Wait -WindowStyle Hidden
  if ($AllowedExitCodes -notcontains $process.ExitCode) {
    throw "Process failed with exit code $($process.ExitCode)."
  }
  return $process.ExitCode
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

if (-not (Test-IsAdministrator)) {
  Write-Status -State "waiting" -Stage "elevation" -Code "uac-required"
  if ($Elevated) {
    exit 10
  }

  $powershellPath = Join-Path $PSHOME "powershell.exe"
  $argumentLine = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Elevated"
  Start-Process -FilePath $powershellPath -ArgumentList $argumentLine -Verb RunAs | Out-Null
  exit 0
}

try {
  foreach ($requiredPath in @(
      $inputManifestPath,
      $templatePath,
      $bundlePath,
      $licensePath,
      $driverPath
    )) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
      throw "A required private input is missing."
    }
  }

  $currentStage = "input-integrity"
  Write-Status -State "running" -Stage $currentStage
  Assert-InputManifest

  $currentStage = "driver"
  Write-Status -State "running" -Stage $currentStage
  $driverExitCode = Invoke-CheckedProcess -FilePath "$env:SystemRoot\System32\dism.exe" `
    -ArgumentList @(
      "/Online",
      "/Add-Package",
      "/PackagePath:$driverPath",
      "/Quiet",
      "/NoRestart"
    ) -AllowedExitCodes @(0, 3010)
  if ($driverExitCode -eq 3010) {
    throw "The offline driver requires a restart."
  }

  $currentStage = "tool-install"
  Write-Status -State "running" -Stage $currentStage
  Add-AppxProvisionedPackage -Online -PackagePath $bundlePath `
    -LicensePath $licensePath -ErrorAction Stop | Out-Null

  $toolPackage = Get-AppxPackage -Name "Microsoft.MSIXPackagingTool"
  if ($null -eq $toolPackage) {
    Add-AppxPackage -Path $bundlePath -ForceApplicationShutdown -ErrorAction Stop
    $toolPackage = Get-AppxPackage -Name "Microsoft.MSIXPackagingTool"
  }
  if ($null -eq $toolPackage -or $toolPackage.Version.ToString() -ne $expectedToolVersion) {
    throw "The approved MSIX Packaging Tool version is not registered."
  }

  $toolAlias = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\MsixPackagingTool.exe"
  $aliasDeadline = (Get-Date).AddSeconds(30)
  while (-not (Test-Path -LiteralPath $toolAlias -PathType Leaf)) {
    if ((Get-Date) -ge $aliasDeadline) {
      throw "The MSIX Packaging Tool execution alias is unavailable."
    }
    Start-Sleep -Milliseconds 250
  }

  $currentStage = "conversion"
  Write-Status -State "running" -Stage $currentStage
  $localLogRoot = Join-Path $env:TEMP "joessh-msix-conversion"
  New-Item -ItemType Directory -Path $localLogRoot -Force | Out-Null
  $standardOutput = Join-Path $localLogRoot "stdout.log"
  $standardError = Join-Path $localLogRoot "stderr.log"
  $conversion = Start-Process -FilePath $toolAlias -ArgumentList @(
      "create-package",
      "--template",
      $templatePath
    ) -PassThru -Wait -WindowStyle Hidden `
    -RedirectStandardOutput $standardOutput -RedirectStandardError $standardError
  if ($conversion.ExitCode -ne 0) {
    throw "MSIX conversion failed with exit code $($conversion.ExitCode)."
  }

  $packages = @(Get-ChildItem -LiteralPath $outputRoot -File -Filter "*.msix")
  if ($packages.Count -ne 1) {
    throw "MSIX conversion did not create exactly one package."
  }

  $currentStage = "result"
  $package = $packages[0]
  $hash = Get-FileHash -LiteralPath $package.FullName -Algorithm SHA256
  $signature = Get-AuthenticodeSignature -LiteralPath $package.FullName
  if ($signature.Status.ToString() -ne "NotSigned") {
    throw "The Store-only MSIX must remain unsigned for Microsoft Store signing."
  }
  Write-SandboxJson -Path $resultPath -Value ([ordered]@{
      schemaVersion = 1
      state = "completed"
      fileName = $package.Name
      sizeBytes = $package.Length
      sha256 = $hash.Hash.ToLowerInvariant()
      authenticode = $signature.Status.ToString()
      toolVersion = $toolPackage.Version.ToString()
      completedAt = (Get-Date).ToUniversalTime().ToString("o")
    })
  Write-Status -State "completed" -Stage $currentStage
  exit 0
}
catch {
  Write-Status -State "failed" -Stage $currentStage -Code "sandbox-step-failed"
  exit 1
}
