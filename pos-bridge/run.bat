@echo off
REM ============================================================
REM  Card-reader bridge for the museum kiosk (PC-POS).
REM  Keeps PosBridge running: if it ever stops or crashes, it is
REM  restarted after 5 seconds. Unfinished payments are recovered
REM  from data\transactions.jsonl on restart.
REM ============================================================
cd /d "%~dp0"
set "EXE=bin\Release\net48\PosBridge.exe"
if not exist "%EXE%" (
  echo PosBridge is not built yet. Run this first in this folder:
  echo     dotnet build -c Release
  pause
  exit /b 1
)

:loop
"%EXE%"
REM exit code 2 = another PosBridge is already running
if "%errorlevel%"=="2" (
  echo PosBridge is already running.
  exit /b 0
)
echo PosBridge stopped ^(exit code %errorlevel%^); restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
