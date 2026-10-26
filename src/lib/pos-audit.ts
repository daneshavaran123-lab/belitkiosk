/**
 * دفترچهٔ سوابق دسترسی و رویدادهای مهم صفحهٔ /admin/pos
 * فقط روی همین کیوسک (localStorage) ذخیره می‌شود؛ رمز و توکن هرگز نوشته نمی‌شوند.
 */

const LS_AUDIT = "pos.auditLog";

export const AUDIT_LIMIT = 200;

export type PosAuditKind =
  | "page:open"
  | "unlock:success"
  | "unlock:failed"
  | "lock"
  | "connect:start"
  | "connect:result"
  | "ping"
  | "handshake"
  | "discover"
  | "logs:watch"
  | "logs:stop"
  | "logs:clear"
  | "report:download"
  | "report:copy"
  | "settings:change"
  | "token:change"
  | "identity:mismatch"
  | "identity:recover"
  | "identity:recovered"
  | "identity:giveup";

export interface PosAuditEntry {
  id: string;
  at: string;
  atFa: string;
  kind: PosAuditKind;
  user: string;
  code?: string;
  detail?: string;
  /** زمان پاسخ ثبت‌شده در لحظهٔ رویداد (اگر مربوط به اتصال باشد) */
  rttMs?: number;
  /** منشأ خطا: شبکه / دستگاه / سرویس پل / تنظیمات */
  source?: string;
}

const LABELS: Record<PosAuditKind, string> = {
  "page:open": "باز شدن صفحهٔ کارت‌خوان",
  "unlock:success": "باز شدن قفل فنی",
  "unlock:failed": "تلاش ناموفق برای باز کردن قفل",
  lock: "قفل کردن دوبارهٔ صفحه",
  "connect:start": "شروع زنجیرهٔ اتصال",
  "connect:result": "نتیجهٔ زنجیرهٔ اتصال",
  ping: "تست ارتباط (ping)",
  handshake: "دست‌دهی با دستگاه",
  discover: "جست‌وجوی دستگاه در شبکه",
  "logs:watch": "شروع مشاهدهٔ لاگ زنده",
  "logs:stop": "پایان مشاهدهٔ لاگ زنده",
  "logs:clear": "پاک کردن لاگ",
  "report:download": "دانلود گزارش پشتیبانی",
  "report:copy": "کپی گزارش پشتیبانی",
  "settings:change": "تغییر تنظیمات دستگاه",
  "token:change": "تغییر توکن دسترسی",
  "identity:mismatch": "ناهمخوانی شناسنامهٔ دستگاه",
  "identity:recover": "شروع بازیابی خودکار شناسنامه",
  "identity:recovered": "بازیابی موفق شناسنامه",
  "identity:giveup": "توقف بازیابی خودکار (سقف تلاش)",
};

export function auditLabel(kind: PosAuditKind): string {
  return LABELS[kind] ?? kind;
}

export function getAuditLog(): PosAuditEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_AUDIT);
    if (!raw) return [];
    return (JSON.parse(raw) as PosAuditEntry[]).slice(-AUDIT_LIMIT);
  } catch {
    return [];
  }
}

export function logAudit(
  kind: PosAuditKind,
  data: { user?: string; code?: string; detail?: string; rttMs?: number; source?: string } = {},
): PosAuditEntry[] {
  const now = new Date();
  const entry: PosAuditEntry = {
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    at: now.toISOString(),
    atFa: now.toLocaleString("fa-IR"),
    kind,
    user: data.user?.trim() || "—",
    code: data.code,
    detail: data.detail,
    rttMs: data.rttMs,
    source: data.source,
  };
  const next = [...getAuditLog(), entry].slice(-AUDIT_LIMIT);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LS_AUDIT, JSON.stringify(next));
    } catch {
      /* حافظهٔ مرورگر پر است */
    }
  }
  return next;
}

export function clearAuditLog(): void {
  if (typeof window !== "undefined") localStorage.removeItem(LS_AUDIT);
}

/** خروجی CSV با هدر فارسی (BOM برای باز شدن درست در اکسل) */
export function auditToCsv(entries: PosAuditEntry[] = getAuditLog()): string {
  const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const rows = [
    ["زمان شمسی", "زمان میلادی", "رویداد", "کاربر", "کد", "RTT (ms)", "منشأ خطا", "توضیح"]
      .map(esc)
      .join(","),
    ...entries.map((e) =>
      [
        e.atFa,
        e.at,
        auditLabel(e.kind),
        e.user,
        e.code ?? "",
        e.rttMs != null ? String(e.rttMs) : "",
        e.source ?? "",
        e.detail ?? "",
      ]
        .map(esc)
        .join(","),
    ),
  ];
  return "\uFEFF" + rows.join("\r\n");
}

/** بخش سوابق برای پیوست به گزارش پشتیبانی */
export function auditToText(entries: PosAuditEntry[] = getAuditLog()): string {
  if (!entries.length) return "سابقه‌ای ثبت نشده است.";
  return entries
    .map(
      (e) =>
        `${e.atFa} — ${auditLabel(e.kind)}${e.code ? ` [${e.code}]` : ""}${
          e.rttMs != null ? ` ${e.rttMs}ms` : ""
        }${e.source ? ` (منشأ: ${e.source})` : ""} — ${e.user}${
          e.detail ? ` — ${e.detail}` : ""
        }`,
    )
    .join("\n");
}
