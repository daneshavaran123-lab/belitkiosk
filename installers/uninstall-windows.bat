@echo off
REM حذف کامل نسخهٔ ویندوزی کیوسک موزه
setlocal
chcp 65001 >nul
title حذف کیوسک موزه

set "DEST=%LOCALAPPDATA%\MuseumKiosk"
set "DESKTOP=%USERPROFILE%\Desktop"
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

echo بستن برنامه...
taskkill /IM MuseumKiosk.exe /F >nul 2>&1
timeout /t 2 >nul

echo حذف میان‌برها...
del /f /q "%DESKTOP%\موزه کشتی.lnk" >nul 2>&1
del /f /q "%STARTMENU%\موزه کشتی.lnk" >nul 2>&1
del /f /q "%STARTUP%\museum-kiosk.lnk" >nul 2>&1
del /f /q "%STARTUP%\pos-bridge.lnk" >nul 2>&1

echo حذف فایل‌های برنامه...
if exist "%DEST%" rmdir /s /q "%DEST%"

echo.
echo ✅ حذف کامل شد.
pause
endlocal
