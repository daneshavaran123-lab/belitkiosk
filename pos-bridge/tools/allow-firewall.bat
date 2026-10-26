@echo off
REM ============================================================
REM  Allow the card reader to send payment results back to this kiosk.
REM  In PC-POS "callback" mode (the official DLL's default) the reader opens
REM  a TCP connection to this PC on port 17000. If Windows Firewall blocks it,
REM  the card is charged but the kiosk never sees the answer.
REM
REM  Run as Administrator:   allow-firewall.bat [READER_IP] [PORT]
REM  Defaults:               192.168.16.160 17000
REM  The rule only accepts connections from the reader's IP address.
REM ============================================================
setlocal
set "POS_IP=192.168.16.160"
set "PORT=17000"
if not "%~1"=="" set "POS_IP=%~1"
if not "%~2"=="" set "PORT=%~2"

net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Please run this file as Administrator ^(right-click - Run as administrator^).
  pause
  exit /b 1
)

netsh advfirewall firewall delete rule name="PosBridge PC-POS callback" >nul 2>&1
netsh advfirewall firewall add rule name="PosBridge PC-POS callback" dir=in action=allow protocol=TCP localport=%PORT% remoteip=%POS_IP% profile=any
if errorlevel 1 (
  echo [ERROR] Could not add the firewall rule.
  pause
  exit /b 1
)
echo.
echo OK: inbound TCP %PORT% is allowed from the card reader %POS_IP% only.
pause
endlocal
