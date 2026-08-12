[CmdletBinding()]
param(
  [string]$VmName = "OpenMausBot-Android",
  [string]$VmPath = "F:\VMs\Android\OpenMausBot-Android",
  [string]$IsoPath = "F:\VMs\Android\ISO\Bliss-v16.9.7-x86_64-OFFICIAL-gapps-20241011.iso",
  [string]$SwitchName = "OpenMausBot-External",
  [UInt64]$VhdSizeBytes = 64GB
)

$ErrorActionPreference = "Stop"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this script from an elevated PowerShell window."
}
if (-not (Test-Path -LiteralPath $IsoPath -PathType Leaf)) {
  throw "Bliss OS ISO was not found: $IsoPath"
}

New-Item -ItemType Directory -Force -Path $VmPath, (Join-Path $VmPath "Shared") | Out-Null

$vm = Get-VM -Name $VmName -ErrorAction SilentlyContinue
if ($vm) {
  Write-Host "VM already exists; leaving its disk and settings untouched: $VmName"
  Write-Host "Use VMConnect.exe localhost $VmName to open it."
  exit 0
}

$switch = Get-VMSwitch -Name $SwitchName -ErrorAction SilentlyContinue
if (-not $switch) {
  $adapter = Get-NetAdapter |
    Where-Object { $_.Status -eq "Up" -and $_.HardwareInterface -and $_.Name -notmatch "vEthernet|Wi-Fi Direct|Loopback" } |
    Sort-Object ifIndex |
    Select-Object -First 1
  if (-not $adapter) { throw "No active physical network adapter was found for the Hyper-V external switch." }
  Write-Host "Creating external switch '$SwitchName' on adapter '$($adapter.Name)'. Network connectivity may briefly reset."
  $switch = New-VMSwitch -Name $SwitchName -NetAdapterName $adapter.Name -AllowManagementOS $true
}

$vhdPath = Join-Path $VmPath "$VmName.vhdx"
if (Test-Path -LiteralPath $vhdPath) {
  throw "A disk already exists at $vhdPath but no VM named '$VmName' exists; refusing to attach or overwrite it."
}

New-VM -Name $VmName -Generation 2 -MemoryStartupBytes 4GB -NewVHDPath $vhdPath -NewVHDSizeBytes $VhdSizeBytes -Path $VmPath -SwitchName $SwitchName | Out-Null
Set-VMProcessor -VMName $VmName -Count 2
Set-VMMemory -VMName $VmName -DynamicMemoryEnabled $true -MinimumBytes 4GB -StartupBytes 4GB -MaximumBytes 6GB
Set-VM -Name $VmName -AutomaticStartAction Nothing -AutomaticStopAction ShutDown
Set-VMFirmware -VMName $VmName -EnableSecureBoot Off
Add-VMDvdDrive -VMName $VmName -Path $IsoPath | Out-Null

Write-Host "Created $VmName"
Write-Host "  Disk:    $vhdPath (dynamic, max $([math]::Round($VhdSizeBytes / 1GB)) GB)"
Write-Host "  Memory:  dynamic 4-6 GB, startup 4 GB"
Write-Host "  CPU:     2 virtual processors"
Write-Host "  Network: $SwitchName (external, internet-capable)"
Write-Host "  Shared:  $(Join-Path $VmPath 'Shared')"

Start-VM -Name $VmName | Out-Null
Start-Process -FilePath "$env:SystemRoot\System32\vmconnect.exe" -ArgumentList @("localhost", $VmName)
Write-Host "VM started and VMConnect opened. This is a compatibility test; Bliss documents KVM/QEMU as its supported VM path, not Hyper-V."
