<#
.SYNOPSIS
    Allow the card reader to send payment results back to this kiosk (PC-POS callback).

.DESCRIPTION
    In callback mode (the official DLL's default) the reader opens a TCP connection to this
    PC on the PC-POS port (17000). If Windows Firewall blocks it, the card is charged but the
    kiosk never sees the answer. The rule only accepts connections from the reader's IP.

    The reader IP and port are read from PosBridge's appsettings.json unless given.
    Must run as Administrator.
#>
param(
    [string]$SettingsPath = "",
    [string]$PosIp = "",
    [int]$Port = 0
)
$ErrorActionPreference = "Stop"

if (-not $SettingsPath) { $SettingsPath = Join-Path $PSScriptRoot "..\bin\Release\net48\appsettings.json" }
if (Test-Path $SettingsPath) {
    $cfg = Get-Content -Raw -Encoding UTF8 $SettingsPath | ConvertFrom-Json
    if (-not $PosIp -and $cfg.deviceIp) { $PosIp = [string]$cfg.deviceIp }
    if ($Port -le 0) {
        if ($cfg.callbackPort -gt 0) { $Port = [int]$cfg.callbackPort }
        elseif ($cfg.devicePort -gt 0) { $Port = [int]$cfg.devicePort }
    }
}
if (-not $PosIp) { $PosIp = "192.168.16.160" }
if ($Port -le 0) { $Port = 17000 }

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: run as Administrator to add the firewall rule." -ForegroundColor Red
    exit 1
}

$name = "PosBridge PC-POS callback"
Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP `
    -LocalPort $Port -RemoteAddress $PosIp -Profile Any | Out-Null
Write-Host "OK: inbound TCP $Port is allowed from the card reader $PosIp only." -ForegroundColor Green
exit 0
