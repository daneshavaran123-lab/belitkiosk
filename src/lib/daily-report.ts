/**
 * گزارش فروش روزانه برای مدیر (specs/001-daily-sales-report).
 *
 * «روز» همیشه به وقت تهران است و هیچ تابعی به ساعت یا منطقهٔ زمانی دستگاه وابسته نیست؛ ساعت
 * کامپیوتر کیوسک یا گوشی مدیر ممکن است اشتباه یا روی منطقهٔ دیگری باشد.
 */

import type { PosSyncResult, PosSyncStatus } from "@/lib/pos";

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

/* ---------------- تبدیل روز ↔ تاریخ تقویم ---------------- */

/**
 * تقویم روز را به‌صورت Date محلی دستگاه (ظهر) می‌سازد و برمی‌گرداند. هر دو سمت با اجزای «محلی» کار
 * می‌کنند، پس منطقهٔ زمانی دستگاه روز انتخاب‌شده را جابه‌جا نمی‌کند.
 */
export function dayToLocalDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

export function localDateToDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/* ---------------- گزارش روزانه (قرارداد: contracts/daily-sales-report.md) ---------------- */

export interface PaymentTotals {
  total: number;
  count: number;
}

export interface TicketTypeCount {
  ticket_type_id: number;
  /** null: نوع بلیط حذف شده است */
  name: string | null;
  category: "normal" | "guided" | "vip" | null;
  quantity: number;
}

export interface ReviewSummary {
  pending: { count: number; amount_rial: number };
  reviewed: { count: number; amount_rial: number };
  last_sync_at: string | null;
}

export interface DailyReport {
  day: string;
  generated_at: string;
  is_today: boolean;
  sales: { card: PaymentTotals; cash: PaymentTotals; total: number; invoice_count: number };
  tickets: { total: number; by_type: TicketTypeCount[]; untyped_lines_quantity: number };
  /** null: کیوسکی هنوز به گزارش وصل نشده («در دسترس نیست»، نه صفر) */
  review: ReviewSummary | null;
}

export type ReportFailure = "not-enabled" | "future" | "network" | "no-access" | "error";

export type FetchReportResult =
  | { ok: true; report: DailyReport }
  | { ok: false; kind: ReportFailure; message: string };

export const REPORT_MESSAGES: Record<ReportFailure, string> = {
  "not-enabled": "گزارش روزانه هنوز روی دیتابیس فعال نشده است",
  future: "روز آینده قابل گزارش نیست",
  network: "ارتباط با سرور برقرار نشد",
  "no-access": "دسترسی ندارید",
  error: "خطا در دریافت گزارش",
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseTotals(v: unknown): PaymentTotals | null {
  if (!isObj(v)) return null;
  const total = num(v.total);
  const count = num(v.count);
  return total === null || count === null ? null : { total, count };
}

function parseReview(v: unknown): ReviewSummary | null | undefined {
  if (v === null) return null;
  if (!isObj(v) || !isObj(v.pending) || !isObj(v.reviewed)) return undefined;
  const pc = num(v.pending.count);
  const pa = num(v.pending.amount_rial);
  const rc = num(v.reviewed.count);
  const ra = num(v.reviewed.amount_rial);
  if (pc === null || pa === null || rc === null || ra === null) return undefined;
  return {
    pending: { count: pc, amount_rial: pa },
    reviewed: { count: rc, amount_rial: ra },
    last_sync_at: typeof v.last_sync_at === "string" ? v.last_sync_at : null,
  };
}

/** پاسخ تابع دیتابیس را به DailyReport می‌برد؛ اگر شکل پاسخ درست نباشد null (هرگز صفر جایش نمی‌نشیند) */
export function parseDailyReport(data: unknown): DailyReport | null {
  if (!isObj(data) || !isObj(data.sales) || !isObj(data.tickets)) return null;
  const card = parseTotals(data.sales.card);
  const cash = parseTotals(data.sales.cash);
  const total = num(data.sales.total);
  const invoiceCount = num(data.sales.invoice_count);
  const ticketTotal = num(data.tickets.total);
  const untyped = num(data.tickets.untyped_lines_quantity);
  if (!card || !cash || total === null || invoiceCount === null) return null;
  if (ticketTotal === null || untyped === null || !Array.isArray(data.tickets.by_type)) return null;
  if (typeof data.day !== "string" || typeof data.generated_at !== "string") return null;

  const byType: TicketTypeCount[] = [];
  for (const row of data.tickets.by_type) {
    if (!isObj(row)) return null;
    const id = num(row.ticket_type_id);
    const quantity = num(row.quantity);
    if (id === null || quantity === null) return null;
    const category =
      row.category === "normal" || row.category === "guided" || row.category === "vip"
        ? row.category
        : null;
    byType.push({
      ticket_type_id: id,
      name: typeof row.name === "string" ? row.name : null,
      category,
      quantity,
    });
  }
  const review = parseReview(data.review);
  if (review === undefined) return null;

  return {
    day: data.day,
    generated_at: data.generated_at,
    is_today: data.is_today === true,
    sales: { card, cash, total, invoice_count: invoiceCount },
    tickets: { total: ticketTotal, by_type: byType, untyped_lines_quantity: untyped },
    review,
  };
}

/** فقط همین بخش از کلاینت Supabase لازم است؛ در تست‌ها جعلی می‌شود */
export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
}

function failure(kind: ReportFailure): FetchReportResult {
  return { ok: false, kind, message: REPORT_MESSAGES[kind] };
}

/**
 * گزارش یک روز را از دیتابیس می‌گیرد. در هر خطا نتیجهٔ ناموفق با دلیل برمی‌گردد و هیچ‌وقت صفر
 * جای دادهٔ نیامده نمی‌نشیند (FR-010).
 */
export async function fetchDailyReport(
  day: string,
  client?: RpcClient,
): Promise<FetchReportResult> {
  try {
    const rpcClient =
      client ?? ((await import("@/integrations/supabase/client")).supabase as unknown as RpcClient);
    const { data, error } = await rpcClient.rpc("daily_sales_report", { p_day: day });
    if (error) {
      const code = error.code ?? "";
      if (code === "PGRST202" || /could not find the function/i.test(error.message))
        return failure("not-enabled");
      if (code === "22023") return failure("future");
      if (code === "42501") return failure("no-access");
      // خطای شبکه در supabase-js کد ندارد
      if (code === "") return failure("network");
      return failure("error");
    }
    const report = parseDailyReport(data);
    return report ? { ok: true, report } : failure("error");
  } catch {
    return failure("network");
  }
}

/* ---------------- اتصال کیوسک به گزارش (جفت کردن) ---------------- */

/** مراحل جفت کردن؛ هر کدام جدا تا در تست جعلی شوند */
export interface PairDeps {
  pair(): Promise<PosSyncResult<{ kioskId: string; keyHash: string }>>;
  /** null یعنی ثبت شد */
  register(kioskId: string, name: string, keyHash: string): Promise<{ message: string } | null>;
  activate(): Promise<PosSyncResult<{ synced: boolean; status: PosSyncStatus }>>;
}

export type PairResult =
  | { ok: true; synced: boolean; status: PosSyncStatus }
  | { ok: false; step: "pair" | "register" | "activate"; message: string };

export const DEFAULT_KIOSK_NAME = "کیوسک ۱";
export const MAX_KIOSK_NAME = 80;

/**
 * کیوسک را به گزارش وصل می‌کند: ۱) سرویس شناسه و کلید می‌سازد و فقط هش کلید را می‌دهد، ۲) هش با
 * نشست مدیر در سرور ثبت می‌شود، ۳) سرویس همگام‌سازی را روشن می‌کند. هر مرحله که شکست بخورد، بعدی
 * اجرا نمی‌شود. کلید خام هرگز به صفحه نمی‌رسد.
 */
export async function pairKiosk(name: string, deps: PairDeps): Promise<PairResult> {
  const clean = name.trim().slice(0, MAX_KIOSK_NAME) || DEFAULT_KIOSK_NAME;

  const paired = await deps.pair();
  if (!paired.ok) return { ok: false, step: "pair", message: paired.message };

  const failed = await deps.register(paired.data.kioskId, clean, paired.data.keyHash);
  if (failed) {
    return {
      ok: false,
      step: "register",
      message: `ثبت کیوسک در سرور ناموفق بود: ${failed.message}`,
    };
  }

  const activated = await deps.activate();
  if (!activated.ok) return { ok: false, step: "activate", message: activated.message };
  return { ok: true, synced: activated.data.synced, status: activated.data.status };
}

/** وابستگی‌های واقعی؛ ماژول‌های سنگین فقط هنگام استفاده بار می‌شوند */
export async function defaultPairDeps(): Promise<PairDeps> {
  const pos = await import("@/lib/pos");
  const { supabase } = await import("@/integrations/supabase/client");
  return {
    pair: () => pos.posSyncPair(),
    register: async (kioskId, name, keyHash) => {
      const { error } = await supabase.rpc("register_kiosk", {
        p_kiosk_id: kioskId,
        p_name: name,
        p_key_hash: keyHash,
      });
      return error ? { message: error.message } : null;
    },
    activate: () =>
      pos.posSyncActivate({
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      }),
  };
}

/* ---------------- فهرست تراکنش‌های نیازمند بررسی ---------------- */

export interface ReviewTransaction {
  kiosk_id: string;
  kiosk_name: string;
  transaction_id: string;
  occurred_at: string;
  amount_rial: number;
  status: string;
  reason: string;
  invoice_number: string | null;
  rrn: string | null;
  needs_review: boolean;
  reviewed: boolean;
  review_note: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export type ReviewListResult =
  | { ok: true; rows: ReviewTransaction[] }
  | { ok: false; kind: ReportFailure; message: string };

export const MAX_REVIEW_NOTE = 500;

function rpcFailure(error: { code?: string; message: string }): {
  kind: ReportFailure;
  message: string;
} {
  const code = error.code ?? "";
  let kind: ReportFailure = "error";
  if (code === "PGRST202" || /could not find the function/i.test(error.message))
    kind = "not-enabled";
  else if (code === "42501") kind = "no-access";
  else if (code === "") kind = "network";
  return { kind, message: REPORT_MESSAGES[kind] };
}

/** تراکنش‌های نیازمند بررسی (و بررسی‌شدهٔ) یک روز به وقت تهران؛ کارت شماره‌ای در آن‌ها نیست */
export async function fetchReviewTransactions(
  day: string,
  client?: RpcClient,
): Promise<ReviewListResult> {
  try {
    const rpcClient =
      client ?? ((await import("@/integrations/supabase/client")).supabase as unknown as RpcClient);
    const { data, error } = await rpcClient.rpc("review_transactions_for_day", { p_day: day });
    if (error) return { ok: false, ...rpcFailure(error) };
    if (!Array.isArray(data)) return { ok: false, kind: "error", message: REPORT_MESSAGES.error };
    return { ok: true, rows: data as ReviewTransaction[] };
  } catch {
    return { ok: false, kind: "network", message: REPORT_MESSAGES.network };
  }
}

/** «بررسی شد»؛ یادداشت اختیاری است و تا ۵۰۰ کاراکتر بریده می‌شود */
export async function markReviewed(
  kioskId: string,
  transactionId: string,
  note: string,
  client?: RpcClient,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const rpcClient =
      client ?? ((await import("@/integrations/supabase/client")).supabase as unknown as RpcClient);
    const { error } = await rpcClient.rpc("review_pos_transaction", {
      p_kiosk_id: kioskId,
      p_transaction_id: transactionId,
      p_note: note.trim().slice(0, MAX_REVIEW_NOTE),
    });
    if (error) return { ok: false, message: rpcFailure(error).message };
    return { ok: true };
  } catch {
    return { ok: false, message: REPORT_MESSAGES.network };
  }
}
