@echo off
REM ============================================================
REM  نصب نسخهٔ ویندوزی «موزه افتخارات کشتی ایران» + سرویس کارت‌خوان
REM  این فایل را کنار پوشه‌های MuseumKiosk-win32-x64 و pos-bridge قرار داده و
REM  با «Run as administrator» اجرا کنید (برای قاعدهٔ فایروال کارت‌خوان).
REM ============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul
title نصب کیوسک موزه افتخارات کشتی ایران

set "SRC=%~dp0MuseumKiosk-win32-x64"
if not exist "%SRC%" set "SRC=%~dp0..\electron-release\MuseumKiosk-win32-x64"
set "BRIDGE_SRC=%~dp0pos-bridge"
if not exist "%BRIDGE_SRC%\run.bat" set "BRIDGE_SRC=%~dp0..\pos-bridge"
set "DEST=%LOCALAPPDATA%\MuseumKiosk"
set "BRIDGE=%DEST%\pos-bridge"
set "BRIDGE_BIN=%BRIDGE%\bin\Release\net48"
set "EXE=%DEST%\MuseumKiosk.exe"
set "DESKTOP=%USERPROFILE%\Desktop"
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

set "ADMIN=0"
net session >nul 2>&1
if not errorlevel 1 set "ADMIN=1"

if not exist "%SRC%\MuseumKiosk.exe" (
  echo [خطا] پوشهٔ برنامه پیدا نشد: %SRC%
  echo پوشهٔ MuseumKiosk-win32-x64 را کنار این فایل بگذارید.
  pause & exit /b 1
)

echo.
echo === کپی فایل‌های برنامه در %DEST% ===
if exist "%DEST%\MuseumKiosk.exe" (
  echo نسخهٔ قبلی پیدا شد؛ بسته می‌شود و به‌روزرسانی انجام می‌گیرد...
  taskkill /IM MuseumKiosk.exe /F >nul 2>&1
  timeout /t 2 >nul
)
robocopy "%SRC%" "%DEST%" /E /R:5 /W:2 /NFL /NDL /NJH /NJS /NP >nul
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

echo === سرویس کارت‌خوان (pos-bridge) ===
if not exist "%BRIDGE_SRC%\bin\Release\net48\PosBridge.exe" (
  echo [هشدار] سرویس کارت‌خوان کنار این فایل نیست؛ پرداخت با کارت‌خوان کار نخواهد کرد.
  goto bridge_done
)

REM توقف نسخهٔ در حال اجرا (حلقهٔ run.bat و خود سرویس) پیش از به‌روزرسانی
powershell -NoProfile -Command ^
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*pos-bridge*run.bat*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
taskkill /IM PosBridge.exe /F >nul 2>&1
timeout /t 2 >nul

REM تنظیمات کیوسک (توکن، رمز متصدی، IP دستگاه) و دفتر تراکنش‌ها هرگز بازنویسی نمی‌شوند
robocopy "%BRIDGE_SRC%" "%BRIDGE%" /E /XF appsettings.json /XD data logs /R:5 /W:2 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo [خطا] کپی سرویس کارت‌خوان ناموفق بود.
  pause & exit /b 1
)
if not exist "%BRIDGE_BIN%\appsettings.json" (
  copy /y "%BRIDGE_SRC%\bin\Release\net48\appsettings.json" "%BRIDGE_BIN%\appsettings.json" >nul
  echo تنظیمات اولیهٔ کارت‌خوان نصب شد: %BRIDGE_BIN%\appsettings.json
) else (
  echo تنظیمات فعلی کارت‌خوان حفظ شد.
)

powershell -NoProfile -Command ^
  "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut('%STARTUP%\pos-bridge.lnk');" ^
  "$s.TargetPath='%BRIDGE%\run.bat'; $s.WorkingDirectory='%BRIDGE%'; $s.WindowStyle=7; $s.Save()"
echo سرویس کارت‌خوان برای اجرای خودکار تنظیم شد.

if "%ADMIN%"=="1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%BRIDGE%\tools\allow-firewall.ps1" -SettingsPath "%BRIDGE_BIN%\appsettings.json"
) else (
  echo [هشدار] بدون دسترسی Administrator قاعدهٔ فایروال کارت‌خوان ساخته نشد.
  echo         فایل %BRIDGE%\tools\allow-firewall.bat را با Run as administrator اجرا کنید.
)

start "" /min "%BRIDGE%\run.bat"
echo سرویس کارت‌خوان اجرا شد.

:bridge_done
echo.
echo ✅ نصب کامل شد.
echo    اجرا: میان‌بر «موزه کشتی» روی دسکتاپ
echo    خروج از حالت کیوسک: Ctrl + Shift + Q
echo    تنظیمات کارت‌خوان: %BRIDGE_BIN%\appsettings.json
echo      (accessToken را بگذارید و در پنل مدیریت ← تنظیمات کارت‌خوان، توکن و رمز متصدی را وارد کنید)
echo.
choice /C YN /M "همین حالا برنامه اجرا شود؟"
if errorlevel 2 goto end
start "" "%EXE%"
:end
endlocal
