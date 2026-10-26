@echo off
REM ============================================================
REM  Iran Wrestling Museum - Kiosk Launcher (Windows 10/11)
REM  Target screen: 1080 x 1920 (portrait touch monitor)
REM
REM  1) Edit KIOSK_URL below to your published address.
REM  2) Double-click this file, or put a shortcut to it in
REM     shell:startup so the kiosk starts with Windows.
REM ============================================================

set "KIOSK_URL=https://project--3d29a01c-1de0-4d4b-982c-4c0bd066984d.lovable.app"

REM Dedicated profile keeps the kiosk isolated from normal browsing
set "KIOSK_PROFILE=%LOCALAPPDATA%\MuseumKiosk\ChromeProfile"

REM Locate Chrome (falls back to Edge)
set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%BROWSER%" (
  echo [ERROR] Chrome or Edge was not found. Install Google Chrome first.
  pause
  exit /b 1
)

echo Starting museum kiosk...
echo URL: %KIOSK_URL%

REM Clear any previous crash banner ("Restore pages?")
if exist "%KIOSK_PROFILE%\Default\Preferences" (
  powershell -NoProfile -Command ^
    "(Get-Content '%KIOSK_PROFILE%\Default\Preferences' -Raw) -replace '\"exit_type\":\"Crashed\"','\"exit_type\":\"Normal\"' | Set-Content '%KIOSK_PROFILE%\Default\Preferences'" >nul 2>&1
)

start "" "%BROWSER%" ^
  --kiosk ^
  --user-data-dir="%KIOSK_PROFILE%" ^
  --window-size=1080,1920 ^
  --window-position=0,0 ^
  --force-device-scale-factor=1 ^
  --high-dpi-support=1 ^
  --start-fullscreen ^
  --no-first-run ^
  --no-default-browser-check ^
  --disable-pinch ^

  --overscroll-history-navigation=0 ^
  --disable-features=TranslateUI,Translate ^
  --disable-session-crashed-bubble ^
  --disable-infobars ^
  --touch-events=enabled ^
  --unsafely-treat-insecure-origin-as-secure=http://127.0.0.1:9099 ^
  --allow-running-insecure-content ^
  --autoplay-policy=no-user-gesture-required ^
  --check-for-update-interval=604800 ^
  "%KIOSK_URL%"

exit /b 0
