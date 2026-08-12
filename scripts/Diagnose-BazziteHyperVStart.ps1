[CmdletBinding()]
param([string]$VmName = "OpenMausBot-Bazzite")

$ErrorActionPreference = "Continue"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Run elevated." }

try { Start-VM -Name $VmName -ErrorAction Stop | Out-Null; "StartVM=ok" } catch { "StartVM=failed"; ($_ | Format-List * -Force | Out-String) }
Get-WinEvent -LogName "Microsoft-Windows-Hyper-V-VMMS-Admin" -MaxEvents 8 -ErrorAction SilentlyContinue |
  Select-Object TimeCreated,Id,LevelDisplayName,Message | Format-List
Get-WinEvent -LogName "Microsoft-Windows-Hyper-V-Worker-Admin" -MaxEvents 8 -ErrorAction SilentlyContinue |
  Select-Object TimeCreated,Id,LevelDisplayName,Message | Format-List
