[CmdletBinding()]
param(
  [string]$TargetRoot = "E:\OpenMausBot",
  [UInt64]$TriggerFreeBytes = 130GB,
  [switch]$Now
)

$ErrorActionPreference = "Stop"
$sourceInstall = Join-Path $env:LOCALAPPDATA "Programs\OpenMausBot"
$sourceData = Join-Path $HOME ".openmausbot"
$target = [System.IO.Path]::GetFullPath($TargetRoot)
$targetApp = Join-Path $target "App"
$targetData = Join-Path $target "Data"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

$c = Get-Volume -DriveLetter C -ErrorAction Stop
$e = Get-Volume -DriveLetter $target.Substring(0, 1) -ErrorAction Stop
if (-not $Now -and $c.SizeRemaining -gt $TriggerFreeBytes) {
  throw "C: still has $([math]::Round($c.SizeRemaining / 1GB, 1)) GB free; the 130 GB trigger has not been reached. Use -Now only when you explicitly want to move OpenMausBot now."
}
if ([string]$e.HealthStatus -ne "Healthy") { throw "The target volume is not healthy: $($e.HealthStatus)" }
if ($e.SizeRemaining -lt 20GB) { throw "The target volume has less than 20 GB free." }
if (-not (Test-Path -LiteralPath (Join-Path $sourceInstall "OpenMausBot.exe"))) { throw "The installed OpenMausBot executable was not found at $sourceInstall" }
if (Get-Process -Name OpenMausBot -ErrorAction SilentlyContinue) { throw "Close OpenMausBot before relocation; the script will not kill a running app." }

New-Item -ItemType Directory -Force -Path $targetApp, $targetData | Out-Null

& robocopy.exe $sourceInstall $targetApp /E /COPY:DAT /DCOPY:DAT /R:2 /W:2 /XJ /NFL /NDL /NP | Out-Null
if ($LASTEXITCODE -gt 7) { throw "App copy failed with robocopy exit code $LASTEXITCODE" }
if (Test-Path -LiteralPath $sourceData) {
  & robocopy.exe $sourceData $targetData /E /COPY:DAT /DCOPY:DAT /R:2 /W:2 /XJ /NFL /NDL /NP | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Data copy failed with robocopy exit code $LASTEXITCODE" }
}

$marker = @{ root = $target; movedAt = (Get-Date).ToUniversalTime().ToString("o"); source = "OpenMausBot" } | ConvertTo-Json
Set-Content -LiteralPath (Join-Path $targetApp "openmausbot-storage.json") -Value $marker -Encoding utf8

$verify = Join-Path $targetApp "OpenMausBot.exe"
if (-not (Test-Path -LiteralPath $verify)) { throw "Relocation verification failed: $verify is missing" }
if (-not (Test-Path -LiteralPath (Join-Path $targetApp "resources\app.asar"))) { throw "Relocation verification failed: packaged resources are missing" }

$installBackup = "$sourceInstall.c-backup-$stamp"
$dataBackup = "$sourceData.c-backup-$stamp"
Move-Item -LiteralPath $sourceInstall -Destination $installBackup
if (Test-Path -LiteralPath $sourceData) { Move-Item -LiteralPath $sourceData -Destination $dataBackup }

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "OpenMausBot (E).lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $verify
$shortcut.WorkingDirectory = $targetApp
$shortcut.Description = "OpenMausBot relocated to E:"
$shortcut.Save()

[pscustomobject]@{
  Status = "relocated"
  App = $verify
  Data = $targetData
  InstallBackup = $installBackup
  DataBackup = if (Test-Path -LiteralPath $dataBackup) { $dataBackup } else { $null }
  Shortcut = $shortcutPath
} | ConvertTo-Json -Depth 3
