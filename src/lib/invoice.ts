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
}

export interface SaveInvoiceResult {
  ok: boolean;
  invoiceId?: string;
  /** پیام قابل نمایش به کاربر در صورت خطا */
  message?: string;
}

type InsertResult = { error: { message: string } | null };
export interface InvoiceDb {
  from(table: string): { insert(rows: unknown): Promise<InsertResult> };
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
  const invoiceId = newId();
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
    if (error) throw new Error(error.message);

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
      message: input.pos?.success
        ? `پرداخت انجام شد (کد پیگیری ${input.pos.refNumber ?? "—"}) اما ثبت فاکتور ناموفق بود؛ کد را یادداشت کنید.`
        : "ثبت فاکتور با خطا مواجه شد؛ لطفاً دوباره تلاش کنید.",
    };
  }
}
