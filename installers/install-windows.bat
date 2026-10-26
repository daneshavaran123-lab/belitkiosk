@echo off
REM ============================================================
REM  نصب نسخهٔ ویندوزی «موزه افتخارات کشتی ایران»
REM  این فایل را کنار پوشهٔ MuseumKiosk-win32-x64 قرار داده و اجرا کنید.
REM ============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul
title نصب کیوسک موزه افتخارات کشتی ایران

set "SRC=%~dp0MuseumKiosk-win32-x64"
if not exist "%SRC%" set "SRC=%~dp0..\electron-release\MuseumKiosk-win32-x64"
set "DEST=%LOCALAPPDATA%\MuseumKiosk"
set "EXE=%DEST%\MuseumKiosk.exe"
set "DESKTOP=%USERPROFILE%\Desktop"
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

if not exist "%SRC%\MuseumKiosk.exe" (
  echo [خطا] پوشهٔ برنامه پیدا نشد: %SRC%
  echo پوشهٔ MuseumKiosk-win32-x64 را کنار این فایل بگذارید.
  pause & exit /b 1
)

echo.
echo === کپی فایل‌های برنامه در %DEST% ===
if exist "%DEST%" (
  echo نسخهٔ قبلی پیدا شد؛ بسته می‌شود و به‌روزرسانی انجام می‌گیرد...
  taskkill /IM MuseumKiosk.exe /F >nul 2>&1
  timeout /t 2 >nul
)
robocopy "%SRC%" "%DEST%" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo [خطا] کپی فایل‌ها ناموفق بود.
  pause & exit /b 1
)

echo === ساخت میان‌بر دسکتاپ و منوی استارت ===
powershell -NoProfile -Command ^
  "$w=New-Object -ComObject WScript.Shell;" ^
  "foreach($p in @('%DESKTOP%\موزه کشتی.lnk','%STARTMENU%\موزه کشتی.lnk')){" ^
  "$s=$w.CreateShortcut($p); $s.TargetPath='%EXE%'; $s.WorkingDirectory='%DEST%'; $s.IconLocation='%EXE%,0'; $s.Save() }"

echo === فعال‌سازی اجرای خودکار هنگام روشن شدن ویندوز ===
powershell -NoProfile -Command ^
  "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut('%STARTUP%\museum-kiosk.lnk');" ^
  "$s.TargetPath='%EXE%'; $s.WorkingDirectory='%DEST%'; $s.Save()"

echo === سرویس پل کارت‌خوان (pos-bridge) ===
set "BRIDGE=%~dp0..\pos-bridge\run.bat"
if exist "%BRIDGE%" (
  powershell -NoProfile -Command ^
    "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut('%STARTUP%\pos-bridge.lnk');" ^
    "$s.TargetPath='%BRIDGE%'; $s.WorkingDirectory='%~dp0..\pos-bridge'; $s.WindowStyle=7; $s.Save()"
  echo pos-bridge برای اجرای خودکار تنظیم شد.
) else (
  echo [هشدار] pos-bridge پیدا نشد؛ پرداخت با کارت‌خوان کار نخواهد کرد.
)

echo.
echo ✅ نصب کامل شد.
echo    اجرا: میان‌بر «موزه کشتی» روی دسکتاپ
echo    خروج از حالت کیوسک: Ctrl + Shift + Q
echo.
choice /C YN /M "همین حالا برنامه اجرا شود؟"
if errorlevel 2 goto end
start "" "%EXE%"
:end
endlocal
