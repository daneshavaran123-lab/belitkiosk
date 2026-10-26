@echo off
REM ============================================================
REM  Allow the card reader to send payment results back to this kiosk.
REM  In PC-POS "callback" mode (the official DLL's default) the reader opens
REM  a TCP connection to this PC on port 17000. If Windows Firewall blocks it,
REM  the card is charged but the kiosk never sees the answer.
REM
REM  Run as Administrator:   allow-firewall.bat [READER_IP] [PORT]
REM  Without arguments the reader IP/port come from PosBridge's appsettings.json.
REM  The rule only accepts connections from the reader's IP address.
REM ============================================================
setlocal
net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Please run this file as Administrator ^(right-click - Run as administrator^).
  pause
  exit /b 1
)
set "ARGS="
if not "%~1"=="" set "ARGS=-PosIp %~1"
if not "%~2"=="" set "ARGS=%ARGS% -Port %~2"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0allow-firewall.ps1" %ARGS%
pause
endlocal
