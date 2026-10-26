/**
 * پرداخت کارتی در جریان، در حافظهٔ مرورگر کیوسک.
 *
 * پیش از فرستادن مبلغ به کارت‌خوان ذخیره می‌شود و فقط پس از ثبت نهایی فروش (یا رد قطعی)
 * پاک می‌شود. اگر صفحه وسط پرداخت رفرش شود، برق برود یا مرورگر بسته شود، در ورود بعدی
 * نتیجه از سرویس پل پرسیده می‌شود تا پولی که از کارت مشتری کسر شده بدون بلیط نماند.
 */

import type { InvoiceLine } from "@/lib/invoice";

const LS_PENDING = "pos.pendingPayment";

export interface PendingPayment {
  transactionId: string;
  invoiceNumber: string;
  amountToman: number;
  items: InvoiceLine[];
  startedAt: string;
}

export function savePendingPayment(p: PendingPayment): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_PENDING, JSON.stringify(p));
  } catch {
    /* حافظه پر است — پرداخت ادامه پیدا می‌کند، فقط بازیابی خودکار نخواهیم داشت */
  }
}

export function loadPendingPayment(): PendingPayment | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_PENDING);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PendingPayment>;
    if (
      !p.transactionId ||
      !p.invoiceNumber ||
      typeof p.amountToman !== "number" ||
      !Array.isArray(p.items)
    )
      return null;
    return p as PendingPayment;
  } catch {
    return null;
  }
}

export function clearPendingPayment(transactionId?: string): void {
  if (typeof window === "undefined") return;
  const current = loadPendingPayment();
  if (transactionId && current && current.transactionId !== transactionId) return;
  localStorage.removeItem(LS_PENDING);
}
