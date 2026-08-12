[CmdletBinding()]
param(
  [string]$VmName = "OpenMausBot-Bazzite",
  [UInt64]$MinimumBytes = 4GB,
  [UInt64]$StartupBytes = 4GB,
  [UInt64]$MaximumBytes = 6GB
)

$ErrorActionPreference = "Stop"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Run elevated." }

Set-VMMemory -VMName $VmName -DynamicMemoryEnabled $true -MinimumBytes $MinimumBytes -StartupBytes $StartupBytes -MaximumBytes $MaximumBytes
Set-VM -Name $VmName -AutomaticStartAction Nothing -AutomaticStopAction ShutDown
Write-Output "Set $VmName dynamic memory: $([math]::Round($MinimumBytes / 1GB, 1))-$([math]::Round($MaximumBytes / 1GB, 1)) GB, startup $([math]::Round($StartupBytes / 1GB, 1)) GB."
Write-Output "Set OMB lifecycle: no automatic start; shut down with the host."
