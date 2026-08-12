[CmdletBinding()]
param(
  [string]$TargetRoot = "E:\OpenMausBot",
  [UInt64]$TriggerFreeBytes = 130GB
)

$ErrorActionPreference = "Stop"

function Get-DriveHealth([string]$Letter) {
  $volume = Get-Volume -DriveLetter $Letter -ErrorAction Stop
  [pscustomobject]@{
    Drive = "$Letter`:\"
    FileSystem = $volume.FileSystem
    Label = $volume.FileSystemLabel
    SizeGb = [math]::Round($volume.Size / 1GB, 1)
    FreeGb = [math]::Round($volume.SizeRemaining / 1GB, 1)
    Health = [string]$volume.HealthStatus
    TriggerReached = [bool]($Letter -eq "C" -and $volume.SizeRemaining -le $TriggerFreeBytes)
  }
}

$target = [System.IO.Path]::GetFullPath($TargetRoot)
$targetDrive = $target.Substring(0, 1).ToUpperInvariant()
$targetVolume = Get-DriveHealth $targetDrive
New-Item -ItemType Directory -Force -Path $target | Out-Null
$probe = Join-Path $target ".storage-wellness-probe"
"openmausbot-storage-probe" | Set-Content -LiteralPath $probe -Encoding utf8
$probeOk = (Get-Content -LiteralPath $probe -Raw) -eq "openmausbot-storage-probe`r`n"
Remove-Item -LiteralPath $probe -Force

$sourceData = Join-Path $HOME ".openmausbot"
$sourceInstall = Join-Path $env:LOCALAPPDATA "Programs\OpenMausBot"
$packagedExe = Join-Path $target "App\OpenMausBot.exe"

[pscustomobject]@{
  CurrentC = Get-DriveHealth "C"
  TargetVolume = $targetVolume
  TargetRoot = $target
  TargetWritable = $probeOk
  CurrentDataPresent = Test-Path -LiteralPath $sourceData
  CurrentInstallPresent = Test-Path -LiteralPath (Join-Path $sourceInstall "OpenMausBot.exe")
  RelocatedInstallPresent = Test-Path -LiteralPath $packagedExe
  RelocatedServerResourcesPresent = Test-Path -LiteralPath (Join-Path $target "App\resources\app.asar")
  RelocationRecommended = (Get-DriveHealth "C").TriggerReached
} | ConvertTo-Json -Depth 4

if (-not $probeOk -or $targetVolume.Health -ne "Healthy") { exit 2 }
