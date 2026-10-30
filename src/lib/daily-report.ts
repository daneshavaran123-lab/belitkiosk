/**
 * گزارش فروش روزانه برای مدیر (specs/001-daily-sales-report).
 *
 * «روز» همیشه به وقت تهران است و هیچ تابعی به ساعت یا منطقهٔ زمانی دستگاه وابسته نیست؛ ساعت
 * کامپیوتر کیوسک یا گوشی مدیر ممکن است اشتباه یا روی منطقهٔ دیگری باشد.
 */

const TEHRAN = "Asia/Tehran";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** آیا مقدار یک روز معتبر به قالب YYYY-MM-DD است */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** امروز به وقت تهران، مثل 2026-10-30 */
export function tehranToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TEHRAN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** n روز بعد (یا قبل) از یک روز تقویمی */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** آیا روز بعد از امروزِ تهران است */
export function isFutureDay(day: string, now: Date = new Date()): boolean {
  return day > tehranToday(now);
}

/**
 * تاریخ شمسی کامل، مثل «جمعه ۸ آبان ۱۴۰۵». ظهر همان روز تبدیل می‌شود تا مرز روز جابه‌جا نشود؛
 * اجزا جدا گرفته و کنار هم گذاشته می‌شوند چون ترتیب پیش‌فرض بین موتورهای ICU فرق دارد.
 */
export function formatJalaliLong(day: string): string {
  const parts = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone: TEHRAN,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(new Date(`${day}T08:30:00Z`));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}`;
}

/** ساعت و دقیقه به وقت تهران با ارقام فارسی، مثل «۱۸:۴۲» */
export function formatTehranTime(iso: string): string {
  return new Intl.DateTimeFormat("fa-IR", {
    timeZone: TEHRAN,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** تاریخ و ساعت تهران برای سربرگ چاپ، مثل «۸ آبان ۱۴۰۵، ۱۸:۴۲» */
export function formatTehranDateTime(iso: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone: TEHRAN,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    date.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}، ${formatTehranTime(iso)}`;
}

/** مبالغ کارت‌خوان به ریال‌اند و گزارش به تومان */
export function rialToToman(rial: number): number {
  return Math.round(rial / 10);
}
