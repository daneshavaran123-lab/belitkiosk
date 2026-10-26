import type { PosResult } from "@/lib/pos";
import { posLog, posLogError } from "@/lib/pos";

export interface InvoiceLine {
  name: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  totalPrice: number;
}

export interface SaveInvoiceInput {
  invoiceNumber: string;
  total: number;
  method: "cash" | "card";
  items: InvoiceLine[];
  pos?: PosResult | undefined;
  /** شناسهٔ ثابت فاکتور؛ در تلاش دوباره همان شناسه استفاده می‌شود تا فاکتور تکراری ساخته نشود */
  invoiceId?: string;
}

export interface SaveInvoiceResult {
  ok: boolean;
  invoiceId?: string;
  /** پیام قابل نمایش به کاربر در صورت خطا */
  message?: string;
  /** فاکتور در صف ارسال دوباره قرار گرفت */
  queued?: boolean;
}

type InsertResult = { error: { message: string; code?: string } | null };
export interface InvoiceDb {
  from(table: string): { insert(rows: unknown): Promise<InsertResult> };
}

/**
 * شمارهٔ فاکتور یکتا: INV-YYYYMMDD-XXXXXXXXXX (۱۰ رقم تصادفی امن).
 * نسخهٔ قبلی فقط ۴ رقم Math.random داشت و با چند صد فروش در روز احتمال تکرار بالا بود؛
 * تکرار یعنی خطای UNIQUE در ثبت فاکتور — آن هم بعد از اینکه پول از کارت کسر شده.
 */
export function newInvoiceNumber(now = new Date()): string {
  const d = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  const rand = ((bytes[0] % 100000) * 100000 + (bytes[1] % 100000)).toString().padStart(10, "0");
  return `INV-${d}-${rand}`;
}

function isDuplicateOf(error: { message: string; code?: string }, constraint: string): boolean {
  return error.code === "23505" && error.message.includes(constraint);
}

/**
 * ثبت فاکتور و اقلام آن. شناسه در کلاینت ساخته می‌شود چون کاربر مهمان
 * اجازهٔ خواندن رکورد درج‌شده را ندارد (RLS).
 */
export async function saveInvoice(
  db: InvoiceDb,
  input: SaveInvoiceInput,
  newId: () => string = () => crypto.randomUUID(),
): Promise<SaveInvoiceResult> {
  const invoiceId = input.invoiceId ?? newId();
  try {
    const { error } = await db.from("invoices").insert({
      id: invoiceId,
      invoice_number: input.invoiceNumber,
      total: input.total,
      payment_method: input.method,
      status: "paid",
      pos_ref_number: input.pos?.refNumber ?? null,
      pos_masked_pan: input.pos?.maskedPan ?? null,
      pos_response_code: input.pos?.responseCode ?? null,
      pos_terminal_id: input.pos?.terminalId ?? null,
    });
    // در تلاش دوباره ممکن است خود فاکتور قبلاً ثبت شده باشد (پاسخ قبلی گم شده بود)
    if (error && !(input.invoiceId && isDuplicateOf(error, "invoices_pkey")))
      throw new Error(error.message);

    const rows = input.items.map((i) => ({
      invoice_id: invoiceId,
      name: i.name,
      quantity: i.quantity,
      unit_price: i.unitPrice,
      discount_percent: i.discountPercent,
      total_price: i.totalPrice,
    }));
    const { error: e2 } = await db.from("invoice_items").insert(rows);
    if (e2) throw new Error(e2.message);

    posLog("invoice:saved", {
      invoice_number: input.invoiceNumber,
      total: input.total,
      ref: input.pos?.refNumber ?? null,
    });
    return { ok: true, invoiceId };
  } catch (e) {
    posLogError("invoice:save-failed", {
      invoice_number: input.invoiceNumber,
      total: input.total,
      error: (e as Error).message,
    });
    return {
      ok: false,
      invoiceId,
      message: input.pos?.success
        ? `پرداخت انجام شد (کد پیگیری ${input.pos.refNumber ?? "—"}) اما ثبت فاکتور ناموفق بود؛ کد را یادداشت کنید.`
        : "ثبت فاکتور با خطا مواجه شد؛ لطفاً دوباره تلاش کنید.",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  صف ارسال دوبارهٔ فاکتورهای پرداخت‌شده                              */
/* ------------------------------------------------------------------ */

const LS_OUTBOX = "invoice.outbox";
const OUTBOX_LIMIT = 200;

interface OutboxEntry {
  input: SaveInvoiceInput & { invoiceId: string };
  queuedAt: string;
  attempts: number;
  lastError?: string;
}

function readOutbox(): OutboxEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(LS_OUTBOX) ?? "[]") as OutboxEntry[];
  } catch {
    return [];
  }
}

function writeOutbox(entries: OutboxEntry[]) {
  if (typeof window === "undefined") return;
  try {
    if (entries.length === 0) localStorage.removeItem(LS_OUTBOX);
    else localStorage.setItem(LS_OUTBOX, JSON.stringify(entries.slice(-OUTBOX_LIMIT)));
  } catch {
    /* ignore */
  }
}

export function invoiceOutboxSize(): number {
  return readOutbox().length;
}

/**
 * ثبت فاکتور فروشی که پولش گرفته شده. اگر پایگاه‌داده در دسترس نباشد، فاکتور در صف
 * می‌ماند و بعداً ارسال می‌شود؛ فروش (و چاپ بلیط) نباید به‌خاطر خطای شبکه متوقف شود.
 */
export async function savePaidInvoice(
  db: InvoiceDb,
  input: SaveInvoiceInput,
): Promise<SaveInvoiceResult> {
  const withId = { ...input, invoiceId: input.invoiceId ?? crypto.randomUUID() };
  const res = await saveInvoice(db, withId);
  if (res.ok) {
    void flushInvoiceOutbox(db);
    return res;
  }
  const entries = readOutbox();
  if (!entries.some((e) => e.input.invoiceId === withId.invoiceId))
    entries.push({
      input: withId,
      queuedAt: new Date().toISOString(),
      attempts: 1,
      lastError: res.message,
    });
  writeOutbox(entries);
  posLogError("invoice:queued", { invoice_number: input.invoiceNumber });
  return {
    ...res,
    queued: true,
    message: "فاکتور به‌دلیل قطع ارتباط ذخیره نشد و خودکار دوباره ارسال می‌شود",
  };
}

let flushing = false;

/** ارسال دوبارهٔ فاکتورهای در صف؛ بعد از هر فروش موفق و هنگام باز شدن سبد خرید صدا زده می‌شود */
export async function flushInvoiceOutbox(
  db: InvoiceDb,
): Promise<{ saved: number; remaining: number }> {
  if (flushing) return { saved: 0, remaining: readOutbox().length };
  flushing = true;
  let saved = 0;
  try {
    for (const entry of readOutbox()) {
      const res = await saveInvoice(db, entry.input);
      const current = readOutbox();
      if (res.ok) {
        saved++;
        writeOutbox(current.filter((e) => e.input.invoiceId !== entry.input.invoiceId));
      } else {
        writeOutbox(
          current.map((e) =>
            e.input.invoiceId === entry.input.invoiceId
              ? { ...e, attempts: e.attempts + 1, lastError: res.message }
              : e,
          ),
        );
      }
    }
  } finally {
    flushing = false;
  }
  const remaining = readOutbox().length;
  if (saved > 0) posLog("invoice:outbox-flushed", { saved, remaining });
  return { saved, remaining };
}
