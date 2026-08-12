[CmdletBinding()]
param([string]$VmName = "OpenMausBot-Bazzite")

$ErrorActionPreference = "Stop"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Run elevated." }

$vm = Get-VM -Name $VmName -ErrorAction Stop
[pscustomobject]@{
  Name = $vm.Name
  State = [string]$vm.State
  Generation = $vm.Generation
  Path = $vm.Path
  MemoryStartup = $vm.MemoryStartup
  MemoryMinimum = $vm.MemoryMinimum
  MemoryMaximum = $vm.MemoryMaximum
  ProcessorCount = $vm.ProcessorCount
  Switches = @(Get-VMNetworkAdapter -VMName $VmName | Select-Object Name,SwitchName,Status,MacAddress)
  Disks = @(Get-VMHardDiskDrive -VMName $VmName | Select-Object ControllerType,ControllerNumber,ControllerLocation,Path)
  Dvds = @(Get-VMDvdDrive -VMName $VmName | Select-Object Path,State)
} | ConvertTo-Json -Depth 5
