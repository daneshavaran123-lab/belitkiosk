/** لینک دانلود نسخهٔ ویندوزی (MuseumKiosk-Windows.zip) */

/** آخرین Release گیت‌هاب؛ با هر نسخهٔ جدید خودکار به‌روز است */
export const DEFAULT_WINDOWS_DOWNLOAD_URL =
  "https://github.com/daneshavaran123-lab/belitkiosk/releases/latest/download/MuseumKiosk-Windows.zip";

/** مسیر دانلود روی همین سرور (مثلاً https://<app>.liara.run/api/download/windows) */
export const WINDOWS_DOWNLOAD_PATH = "/api/download/windows";

/**
 * آدرس واقعی فایل: مقدار WINDOWS_DOWNLOAD_URL (مثلاً فضای ذخیره‌سازی لیارا) اگر یک آدرس https
 * معتبر باشد، وگرنه آخرین Release گیت‌هاب.
 */
export function resolveWindowsDownloadUrl(configured: string | undefined): string {
  const value = configured?.trim();
  if (!value) return DEFAULT_WINDOWS_DOWNLOAD_URL;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.toString();
  } catch {
    // آدرس نامعتبر؛ پایین هشدار داده می‌شود
  }
  console.warn(
    "WINDOWS_DOWNLOAD_URL باید یک آدرس https معتبر باشد؛ از Release گیت‌هاب استفاده شد.",
  );
  return DEFAULT_WINDOWS_DOWNLOAD_URL;
}
