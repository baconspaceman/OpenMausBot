[CmdletBinding()]
param([string]$VmName = "OpenMausBot-Bazzite")

$ErrorActionPreference = "Stop"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Run elevated." }

try {
  Start-VM -Name $VmName -ErrorAction Stop | Out-Null
  Start-Sleep -Seconds 4
  Start-Process -FilePath "vmconnect.exe" -ArgumentList @("localhost", $VmName)
  Write-Output "Started $VmName and requested VMConnect."
} catch {
  Write-Error (($_ | Format-List * -Force | Out-String).Trim())
  exit 1
}
