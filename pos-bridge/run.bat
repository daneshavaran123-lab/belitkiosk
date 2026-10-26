@echo off
REM اجرای سرویس پل کارت‌خوان موزه (PC-POS پارسیان)
cd /d "%~dp0"
if exist "bin\Release\net48\PosBridge.exe" (
  start "" "bin\Release\net48\PosBridge.exe"
) else (
  echo نسخه build نشده است. ابتدا دستور زیر را اجرا کنید:
  echo     dotnet build -c Release
  pause
)
