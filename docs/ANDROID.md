# نسخهٔ اندروید (PWA / TWA)

برنامه به‌صورت PWA کامل (manifest + آیکون + حالت fullscreen) آماده است و می‌توان از آن
یک اپلیکیشن اندروید (APK/AAB) با Trusted Web Activity ساخت.

## ۱. پیش‌نیازها

- Node.js 20+
- JDK 17
- Android SDK (یا اجازه دهید Bubblewrap خودش نصب کند)
- دامنهٔ HTTPS منتشرشده (مثلاً آدرس لیارا یا دامنهٔ اختصاصی)

```bash
npm i -g @bubblewrap/cli
```

## ۲. ساخت پروژهٔ اندروید

```bash
bubblewrap init --manifest https://<دامنهٔ-شما>/manifest.webmanifest
# نام بسته پیشنهادی: ir.wrestlingmuseum.kiosk
bubblewrap build
```

خروجی: `app-release-signed.apk` و `app-release-bundle.aab`.

## ۳. حذف نوار آدرس (Digital Asset Links)

بعد از `bubblewrap init` فایل `assetlinks.json` تولید می‌شود. اثر انگشت SHA-256 کلید
امضا را در `public/.well-known/assetlinks.json` این پروژه قرار دهید و دوباره deploy کنید:

```bash
bubblewrap fingerprint list
```

سپس مقدار `sha256_cert_fingerprints` را در فایل زیر جایگزین کنید:

```
public/.well-known/assetlinks.json
```

بررسی صحت:

```
https://<دامنهٔ-شما>/.well-known/assetlinks.json
```

## ۴. نصب روی تبلت/کیوسک اندرویدی

```bash
adb install -r app-release-signed.apk
```

برای حالت کیوسک اندروید از **Screen Pinning** (تنظیمات → امنیت → Pin windows) یا یک
لانچر کیوسک استفاده کنید.

## ۵. محدودیت کارت‌خوان روی اندروید

سرویس پل کارت‌خوان (`pos-bridge`) یک برنامهٔ ویندوزی است که با DLL پارسیان کار می‌کند.
روی اندروید:

- اگر کارت‌خوان به یک مینی‌پی‌سی ویندوزی در همان شبکه وصل است، در `/admin/pos`
  آدرس پل را به `http://<IP-ویندوز>:9099` تغییر دهید (نه `127.0.0.1`).
- چون صفحه روی HTTPS است، مرورگر/TWA درخواست HTTP به شبکهٔ محلی را مسدود می‌کند؛
  یا برای pos-bridge گواهی TLS بگذارید، یا در `network_security_config` اپ اندروید
  آن IP را مجاز کنید.
- در غیر این صورت فقط پرداخت **نقدی** روی نسخهٔ اندروید در دسترس است.
