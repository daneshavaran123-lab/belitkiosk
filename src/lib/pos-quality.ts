/**
 * خلاصهٔ کیفیت شبکه بر پایهٔ تاریخچهٔ ping/handshake کارت‌خوان.
 * خروجی برای کارت «شناسنامهٔ دستگاه» استفاده می‌شود تا اپراتور سریع بفهمد
 * مشکل از شبکه است یا از خود دستگاه.
 */

import type { PosPingRecord } from "./pos";
import { POS_ERROR_CATALOG, type PosErrorSource } from "./pos-errors";

export type PosQualityRating = "excellent" | "good" | "weak" | "unstable" | "down" | "unknown";

export interface PosNetworkQuality {
  attempts: number;
  okCount: number;
  failCount: number;
  /** درصد بسته‌های بی‌پاسخ (packet loss) */
  lossPercent: number;
  timeouts: number;
  lastRttMs?: number;
  avgRttMs?: number;
  minRttMs?: number;
  maxRttMs?: number;
  /** نوسان زمان پاسخ (اختلاف میانگین بین دو تلاش پیاپی) */
  jitterMs?: number;
  rating: PosQualityRating;
  label: string;
  hint: string;
  /** منشأ غالب خطاها در تلاش‌های ناموفق */
  dominantSource?: PosErrorSource;
}

const RATING_LABEL: Record<PosQualityRating, string> = {
  excellent: "عالی",
  good: "مناسب",
  weak: "کند",
  unstable: "ناپایدار",
  down: "قطع",
  unknown: "نامشخص",
};

function avg(nums: number[]): number | undefined {
  if (!nums.length) return undefined;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export function summarizeNetworkQuality(records: PosPingRecord[]): PosNetworkQuality {
  const attempts = records.length;
  const ok = records.filter((r) => r.ok);
  const fails = records.filter((r) => !r.ok);
  const rtts = ok.map((r) => r.latencyMs).filter((n): n is number => typeof n === "number");
  const lossPercent = attempts ? Math.round((fails.length / attempts) * 100) : 0;
  const timeouts = fails.filter((r) => r.code === "NET_TIMEOUT" || r.stage === "network").length;

  let jitterMs: number | undefined;
  if (rtts.length > 1) {
    const diffs = rtts.slice(1).map((v, i) => Math.abs(v - rtts[i]));
    jitterMs = avg(diffs);
  }

  const avgRttMs = avg(rtts);
  const lastRttMs = records.length ? records[records.length - 1].latencyMs : undefined;

  // منشأ غالب خطا
  let dominantSource: PosErrorSource | undefined;
  if (fails.length) {
    const tally = new Map<PosErrorSource, number>();
    for (const f of fails) {
      const src = POS_ERROR_CATALOG[f.code ?? "UNKNOWN"]?.source ?? "unknown";
      tally.set(src, (tally.get(src) ?? 0) + 1);
    }
    dominantSource = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  let rating: PosQualityRating = "unknown";
  if (!attempts) rating = "unknown";
  else if (lossPercent >= 80) rating = "down";
  else if (lossPercent >= 25) rating = "unstable";
  else if (avgRttMs != null && avgRttMs > 900) rating = "weak";
  else if (avgRttMs != null && (avgRttMs > 350 || (jitterMs ?? 0) > 250)) rating = "weak";
  else if (avgRttMs != null) rating = avgRttMs <= 150 ? "excellent" : "good";
  else rating = "unstable";

  const hint =
    rating === "unknown"
      ? "هنوز تلاشی برای اتصال ثبت نشده — یک بار «شروع اتصال» را بزنید."
      : rating === "down"
        ? dominantSource === "device"
          ? "دستگاه پاسخ نمی‌دهد؛ کارت‌خوان را روشن/ریست کنید و صفحهٔ آماده را بیاورید."
          : "هیچ بسته‌ای به مقصد نرسید؛ کابل شبکه یا اتصال وای‌فای کیوسک را بررسی کنید."
        : rating === "unstable"
          ? `از هر ۱۰۰ تلاش حدود ${lossPercent} تلاش بی‌پاسخ مانده — کیفیت شبکه ناپایدار است (کابل/سیگنال وای‌فای).`
          : rating === "weak"
            ? "پاسخ‌ها کند یا پرنوسان‌اند؛ فاصلهٔ دستگاه تا اکسس‌پوینت یا شلوغی شبکه را بررسی کنید."
            : "شبکه سالم است؛ اگر پرداخت انجام نشد مشکل از خود دستگاه یا تنظیمات پذیرنده است.";

  return {
    attempts,
    okCount: ok.length,
    failCount: fails.length,
    lossPercent,
    timeouts,
    lastRttMs,
    avgRttMs,
    minRttMs: rtts.length ? Math.min(...rtts) : undefined,
    maxRttMs: rtts.length ? Math.max(...rtts) : undefined,
    jitterMs,
    rating,
    label: RATING_LABEL[rating],
    hint,
    dominantSource,
  };
}

/** رنگ نمایشی متناسب با کیفیت (کلاس Tailwind) */
export function qualityTone(rating: PosQualityRating): string {
  switch (rating) {
    case "excellent":
      return "text-emerald-400";
    case "good":
      return "text-emerald-300";
    case "weak":
      return "text-amber-400";
    case "unstable":
      return "text-orange-400";
    case "down":
      return "text-rose-400";
    default:
      return "text-bronze-light/50";
  }
}

/** برچسب فارسی منشأ خطا برای نمایش در گزارش و CSV */
export function sourceLabel(source: PosErrorSource | undefined): string {
  switch (source) {
    case "network":
      return "شبکه";
    case "device":
      return "دستگاه کارت‌خوان";
    case "bridge":
      return "سرویس پل";
    case "config":
      return "تنظیمات";
    case "ok":
      return "بدون خطا";
    case "unknown":
      return "نامشخص";
    default:
      return "—";
  }
}

/** منشأ خطای یک تلاش ping بر پایهٔ کد خطا */
export function recordSource(record: PosPingRecord): PosErrorSource {
  if (record.ok) return "ok";
  return POS_ERROR_CATALOG[record.code ?? "UNKNOWN"]?.source ?? "unknown";
}

/** خلاصهٔ متنی کیفیت شبکه برای گزارش پشتیبانی */
export function qualityText(q: PosNetworkQuality): string[] {
  const ms = (v?: number) => (v != null ? `${v}ms` : "—");
  return [
    `رتبهٔ کیفیت: ${q.label} (${q.rating})`,
    `تعداد تلاش: ${q.attempts} — موفق: ${q.okCount} — ناموفق: ${q.failCount}`,
    `بسته‌های بی‌پاسخ: ${q.lossPercent}٪ — پایان زمان انتظار: ${q.timeouts} بار`,
    `RTT آخر/میانگین/کمینه/بیشینه: ${ms(q.lastRttMs)} / ${ms(q.avgRttMs)} / ${ms(q.minRttMs)} / ${ms(q.maxRttMs)}`,
    `نوسان (jitter): ${ms(q.jitterMs)}`,
    `منشأ غالب خطا: ${sourceLabel(q.dominantSource)}`,
    `راهنما: ${q.hint}`,
  ];
}

/** ردیف‌های CSV خلاصهٔ کیفیت (بدون BOM؛ در pingsToCsv ادغام می‌شود) */
export function qualityToCsv(q: PosNetworkQuality): string[][] {
  const v = (n?: number) => (n != null ? String(n) : "");
  return [
    ["خلاصهٔ کیفیت شبکه", ""],
    ["رتبه", q.label],
    ["تعداد تلاش", String(q.attempts)],
    ["موفق", String(q.okCount)],
    ["ناموفق", String(q.failCount)],
    ["درصد بسته‌های بی‌پاسخ", String(q.lossPercent)],
    ["تعداد timeout", String(q.timeouts)],
    ["آخرین RTT (ms)", v(q.lastRttMs)],
    ["میانگین RTT (ms)", v(q.avgRttMs)],
    ["کمینه RTT (ms)", v(q.minRttMs)],
    ["بیشینه RTT (ms)", v(q.maxRttMs)],
    ["نوسان jitter (ms)", v(q.jitterMs)],
    ["منشأ غالب خطا", sourceLabel(q.dominantSource)],
  ];
}
