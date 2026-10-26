@echo off
REM ============================================================
REM  نصب نسخهٔ ویندوزی کیوسک موزه افتخارات کشتی ایران
REM  - میان‌بر دسکتاپ می‌سازد
REM  - اجرای خودکار هنگام روشن شدن ویندوز را فعال می‌کند
REM  - در صورت وجود، سرویس پل کارت‌خوان (pos-bridge) را هم اجرا می‌کند
REM  اجرا: راست‌کلیک > Run as administrator
REM ============================================================
setlocal
chcp 65001 >nul

set "ROOT=%~dp0"
set "LAUNCHER=%ROOT%launch-kiosk.bat"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "DESKTOP=%USERPROFILE%\Desktop"

if not exist "%LAUNCHER%" (
  echo [خطا] فایل launch-kiosk.bat کنار این اسکریپت پیدا نشد.
  pause & exit /b 1
)

echo.
echo === ساخت میان‌بر دسکتاپ ===
powershell -NoProfile -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%DESKTOP%\موزه کشتی - کیوسک.lnk');" ^
  "$s.TargetPath='%LAUNCHER%'; $s.WorkingDirectory='%ROOT%'; $s.WindowStyle=7; $s.Save()"

echo === فعال‌سازی اجرای خودکار در استارتاپ ===
powershell -NoProfile -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%STARTUP%\museum-kiosk.lnk');" ^
  "$s.TargetPath='%LAUNCHER%'; $s.WorkingDirectory='%ROOT%'; $s.WindowStyle=7; $s.Save()"

echo === بررسی سرویس پل کارت‌خوان ===
if exist "%ROOT%..\pos-bridge\run.bat" (
  echo سرویس pos-bridge پیدا شد. برای اجرای خودکار آن هم میان‌بر ساخته می‌شود.
  powershell -NoProfile -Command ^
    "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%STARTUP%\pos-bridge.lnk');" ^
    "$s.TargetPath='%ROOT%..\pos-bridge\run.bat'; $s.WorkingDirectory='%ROOT%..\pos-bridge'; $s.WindowStyle=7; $s.Save()"
) else (
  echo [هشدار] pos-bridge پیدا نشد؛ پرداخت با کارت‌خوان کار نخواهد کرد.
)

echo.
echo ✅ نصب کامل شد. با ریستارت ویندوز، کیوسک به‌صورت خودکار بالا می‌آید.
echo    برای اجرای فوری، میان‌بر دسکتاپ را باز کنید.
pause
endlocal
