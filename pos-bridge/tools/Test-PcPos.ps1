<#
.SYNOPSIS
    Direct test of the card reader (PC-POS over LAN), without the kiosk or PosBridge.

.DESCRIPTION
    Sends ONE purchase request in exactly the format the official PosInterface.dll uses
    (verified by capturing the DLL's bytes) and waits for the device's answer:

        request : $PCBUY,<amountRial>,<invoice>,<yyyyMMddHHmmss>,<messageId>,0,<appId>,*<XOR>\r\n
        response: $POSBUY,<code>,<amount>,<RRN>,<STAN>,<dateTime>,<merchant>,<terminal>,<card>,<messageId>,*<XOR>\r\n

    The device can return the answer on the same TCP connection, or by opening a NEW
    connection back to this PC on the same port ("callback", the DLL's default). The
    default mode "Auto" listens for both.

    WARNING: this is a REAL purchase. If a card is presented, money is taken.
    Stop PosBridge first in Auto/Callback mode (both need TCP port 17000 on this PC),
    and allow inbound TCP 17000 from the reader in Windows Firewall
    (pos-bridge\tools\allow-firewall.bat).

.EXAMPLE
    .\Test-PcPos.ps1 -Amount 10000
.EXAMPLE
    .\Test-PcPos.ps1 -PosIp 192.168.16.160 -Amount 10000 -ResponseMode Same
#>
[CmdletBinding()]
param(
    [string]$PosIp = "192.168.16.160",
    [ValidateRange(1, 65535)][int]$PosPort = 17000,
    # Amount in RIAL (toman x 10)
    [Parameter(Mandatory = $true)][ValidateRange(1000, 1000000000)][long]$Amount,
    # Digits only; empty = derived from the current time
    [string]$Invoice = "",
    [ValidateSet("Auto", "Same", "Callback")][string]$ResponseMode = "Auto",
    # 0 = same as PosPort (like the official DLL)
    [ValidateRange(0, 65535)][int]$CallbackPort = 0,
    [ValidateRange(30, 600)][int]$TimeoutSeconds = 120,
    [string]$AppId = "",
    [string]$ExpectedTerminalId = "5634056",
    # Skip the confirmation prompt
    [switch]$Force
)

Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"
$inv = [Globalization.CultureInfo]::InvariantCulture

$messages = @{
    0 = "Approved"; 3 = "Invalid merchant"; 5 = "Transaction abandoned"; 6 = "Error";
    12 = "Invalid transaction"; 51 = "Insufficient funds"; 55 = "Wrong PIN"; 56 = "Invalid card";
    61 = "Amount over limit"; 84 = "Issuer not responding"; 400 = "No answer from switch";
    402 = "No connection to switch"; 403 = "POS send failed"; 410 = "POS receipt print failed";
    412 = "POS could not parse the request"; 501 = "POS prerequisites missing (login/settlement)";
    502 = "Cancelled by user"; 777 = "Timeout"
}

function Get-XorChecksum([string]$Data) {
    $x = 0
    foreach ($b in [Text.Encoding]::ASCII.GetBytes($Data)) { $x = $x -bxor $b }
    return ([byte]$x).ToString("X2", $inv)
}

function ConvertFrom-PosFrame([string]$Frame) {
    $text = $Frame.Trim("`r", "`n", " ", [char]0)
    if (-not $text.StartsWith('$')) { throw "Frame does not start with `$: $text" }
    # The last '*' starts the checksum (a masked card number may contain '*')
    $star = $text.LastIndexOf('*')
    if ($star -lt 2 -or ($text.Length - $star - 1) -ne 2) { throw "Frame has no checksum: $text" }
    $body = $text.Substring(1, $star - 1)
    $received = $text.Substring($star + 1).ToUpperInvariant()
    $calculated = Get-XorChecksum $body
    if ($received -ne $calculated) { throw "Bad checksum (received $received, calculated $calculated)" }

    $f = $body.Split(',')
    $get = { param($i) if ($f.Length -gt $i) { $f[$i].Trim() } else { "" } }
    $code = 0
    if (-not [int]::TryParse((& $get 1), [ref]$code)) { throw "Response code is not numeric: $(& $get 1)" }
    [pscustomobject]@{
        Type = $f[0]; Code = $code; Amount = (& $get 2); Rrn = (& $get 3); Stan = (& $get 4)
        DateTime = (& $get 5); MerchantId = (& $get 6); TerminalId = (& $get 7)
        Card = (& $get 8); MessageId = (& $get 9)
    }
}

# Reads until one complete frame ($ ... \n) arrives, the peer closes, or the deadline passes.
function Read-PosFrame([System.Net.Sockets.TcpClient]$Client, [datetime]$DeadlineUtc) {
    $stream = $Client.GetStream()
    $buf = New-Object byte[] 512
    $sb = New-Object System.Text.StringBuilder
    while ([datetime]::UtcNow -lt $DeadlineUtc) {
        if (-not $Client.Client.Poll(300000, [System.Net.Sockets.SelectMode]::SelectRead)) { continue }
        $n = $stream.Read($buf, 0, $buf.Length)
        if ($n -le 0) { break }
        [void]$sb.Append([Text.Encoding]::ASCII.GetString($buf, 0, $n))
        $s = $sb.ToString()
        $start = $s.IndexOf('$')
        if ($start -ge 0) {
            $end = $s.IndexOf("`n", $start)
            if ($end -gt 0) { return $s.Substring($start, $end - $start + 1) }
        }
    }
    $s = $sb.ToString()
    $start = $s.IndexOf('$')
    if ($start -ge 0 -and $s.LastIndexOf('*') -gt $start) { return $s.Substring($start) }
    return $null
}

# ---------------- request ----------------
if ([string]::IsNullOrEmpty($Invoice)) { $Invoice = (Get-Date).ToString("yyMMddHHmmss", $inv) }
if ($Invoice -notmatch '^\d{1,20}$') { throw "Invoice must be digits only" }
if ($AppId -match '[,$*\r\n]') { throw "AppId must not contain , `$ * or line breaks" }
if ($CallbackPort -eq 0) { $CallbackPort = $PosPort }

# Gregorian date regardless of the Windows culture (fa-IR would give a Persian year)
$date = (Get-Date).ToString("yyyyMMddHHmmss", $inv)
# The official DLL treats MessageId as an int; keep it below 1e9
$messageId = Get-Random -Minimum 1 -Maximum 999999999
$body = "PCBUY,$Amount,$Invoice,$date,$messageId,0,$AppId,"
$frame = '$' + $body + '*' + (Get-XorChecksum $body) + "`r`n"

Write-Host ""
Write-Host "=== PC-POS PURCHASE TEST ===" -ForegroundColor Cyan
Write-Host ("Device        : {0}:{1}   response mode: {2}" -f $PosIp, $PosPort, $ResponseMode)
Write-Host ("Amount        : {0:N0} rial ({1:N0} toman)" -f $Amount, ($Amount / 10))
Write-Host ("Request frame : {0}" -f $frame.TrimEnd())

if (-not $Force) {
    $answer = Read-Host "This is a REAL purchase. Send it to the card reader? (y/N)"
    if ($answer -ne "y") { Write-Host "Cancelled."; exit 3 }
}

$listener = $null
$client = $null
$result = $null
try {
    if ($ResponseMode -ne "Same") {
        try {
            $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $CallbackPort)
            $listener.Start()
        }
        catch {
            throw "TCP port $CallbackPort is busy on this PC (is PosBridge running?). Stop it, or use -ResponseMode Same."
        }
    }

    # Connect (retrying is safe here: nothing has been sent yet)
    for ($attempt = 1; $attempt -le 3 -and $null -eq $client; $attempt++) {
        $c = New-Object System.Net.Sockets.TcpClient
        try {
            $ar = $c.BeginConnect($PosIp, $PosPort, $null, $null)
            if ($ar.AsyncWaitHandle.WaitOne(10000)) { $c.EndConnect($ar); if ($c.Connected) { $client = $c } }
        }
        catch { Write-Host "Connect attempt $attempt failed: $($_.Exception.Message)" -ForegroundColor Yellow }
        if ($null -eq $client) { $c.Close(); if ($attempt -lt 3) { Start-Sleep -Seconds $attempt } }
    }
    if ($null -eq $client) { throw "Could not connect to $PosIp`:$PosPort (device off, wrong IP, or PC-POS disabled on the device)." }

    # Send ONCE. Never resend after this point: the card could be charged twice.
    $bytes = [Text.Encoding]::ASCII.GetBytes($frame)
    $stream = $client.GetStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    Write-Host "Request sent. Present the card on the reader..." -ForegroundColor Green
    if ($ResponseMode -eq "Callback") { $client.Close(); $client = $null }

    $deadline = [datetime]::UtcNow.AddSeconds($TimeoutSeconds)
    $raw = $null
    while ($null -eq $raw -and [datetime]::UtcNow -lt $deadline) {
        if ($null -ne $client -and $client.Client.Poll(200000, [System.Net.Sockets.SelectMode]::SelectRead)) {
            $raw = Read-PosFrame $client ([datetime]::UtcNow.AddSeconds(5))
            if ($null -eq $raw) { $client.Close(); $client = $null }   # device closed the request socket
            else { Write-Host "Answer received on the same connection." }
        }
        if ($null -eq $raw -and $null -ne $listener -and $listener.Pending()) {
            $back = $listener.AcceptTcpClient()
            $remote = ([System.Net.IPEndPoint]$back.Client.RemoteEndPoint).Address.ToString()
            if ($remote -ne $PosIp) {
                Write-Host "Ignored callback connection from $remote (not the card reader)." -ForegroundColor Yellow
                $back.Close()
                continue
            }
            $raw = Read-PosFrame $back ([datetime]::UtcNow.AddSeconds(30))
            $back.Close()
            if ($null -ne $raw) { Write-Host "Answer received by callback connection from $remote." }
        }
        if ($null -eq $raw -and $null -eq $client) { Start-Sleep -Milliseconds 200 }
    }

    if ($null -eq $raw) {
        Write-Host ""
        Write-Host "NO ANSWER within $TimeoutSeconds s. If the reader printed a receipt, the card WAS charged:" -ForegroundColor Red
        Write-Host "  - check Windows Firewall allows inbound TCP $CallbackPort from $PosIp (tools\allow-firewall.bat)" -ForegroundColor Red
        Write-Host "  - try -ResponseMode Same / Callback to match the reader's PC-POS setting" -ForegroundColor Red
        exit 2
    }

    Write-Host ("Raw answer    : {0}" -f $raw.TrimEnd())
    $result = ConvertFrom-PosFrame $raw
}
catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 2
}
finally {
    if ($null -ne $client) { $client.Close() }
    if ($null -ne $listener) { $listener.Stop() }
}

# ---------------- verify ----------------
$problems = @()
if ($result.Type -ne "POSBUY") { $problems += "unexpected response type '$($result.Type)'" }
if ($result.MessageId -and $result.MessageId -ne "$messageId") { $problems += "MessageId $($result.MessageId) does not match request $messageId" }
if ($result.Code -eq 0) {
    if ($result.Amount -and $result.Amount -ne "$Amount") { $problems += "amount $($result.Amount) differs from requested $Amount" }
    if (-not $result.Rrn) { $problems += "approved without RRN" }
    if ($ExpectedTerminalId -and $result.TerminalId -and $result.TerminalId.TrimStart('0') -ne $ExpectedTerminalId.TrimStart('0')) {
        $problems += "answered by terminal $($result.TerminalId), expected $ExpectedTerminalId"
    }
}
$text = $messages[$result.Code]
if (-not $text) { $text = "Declined" }

# Mask the card number: keep only the first 6 and last 4 digits
$card = $result.Card
if ($card -match '^\d{10,}$') { $card = $card.Substring(0, 6) + ('*' * ($card.Length - 10)) + $card.Substring($card.Length - 4) }

Write-Host ""
Write-Host "=== RESULT ===" -ForegroundColor Cyan
Write-Host ("Response code : {0} ({1})" -f $result.Code, $text)
Write-Host ("Amount        : {0}" -f $result.Amount)
Write-Host ("RRN           : {0}" -f $result.Rrn)
Write-Host ("STAN          : {0}" -f $result.Stan)
Write-Host ("Terminal      : {0}   Merchant: {1}" -f $result.TerminalId, $result.MerchantId)
Write-Host ("Card          : {0}" -f $card)
Write-Host ("MessageId     : {0}" -f $result.MessageId)

if ($problems.Count -gt 0) {
    Write-Host ""
    Write-Host "UNTRUSTED ANSWER - do not issue a ticket, check the reader's receipt:" -ForegroundColor Red
    $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 2
}
if ($result.Code -eq 0) {
    Write-Host ""
    Write-Host "APPROVED" -ForegroundColor Green
    exit 0
}
Write-Host ""
Write-Host "DECLINED - no money was taken." -ForegroundColor Yellow
exit 1
