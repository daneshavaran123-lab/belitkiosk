/**
 * ساخت دادهٔ بلیط چاپی و تولید تصویر QR در مرورگر.
 * تصویر QR به‌صورت PNG (base64) به سرویس پل فرستاده می‌شود تا روی
 * پرینتر حرارتی ۸۰ میلی‌متری چاپ شود.
 */

export interface TicketPrintLine {
  name: string;
  quantity: number;
  totalToman: number;
}

export interface TicketPrintPayload {
  museumName: string;
  invoiceNumber: string;
  dateTime: string;
  paymentMethod: "cash" | "card";
  totalToman: number;
  refNumber?: string;
  maskedPan?: string;
  terminalId?: string;
  responseCode?: string;
  footer?: string;
  qrPng?: string;
  copies?: number;
  items: TicketPrintLine[];
}

export const MUSEUM_NAME = "موزه افتخارات کشتی ایران";
export const TICKET_FOOTER = "این بلیط را در ورودی موزه ارائه دهید";

/** متن تاریخ و ساعت شمسی برای چاپ روی بلیط */
export function persianDateTime(d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      dateStyle: "full",
      timeStyle: "short",
      calendar: "persian",
    }).format(d);
  } catch {
    return d.toLocaleString("fa-IR");
  }
}

/** محتوای QR بلیط ورود */
export function ticketQrValue(invoiceNumber: string): string {
  return `MUSEUM-TICKET:${invoiceNumber}`;
}

/**
 * تولید تصویر QR به‌صورت PNG با canvas (بدون وابستگی سرور).
 * از یک SVG ساخته‌شده توسط qrcode.react استفاده نمی‌کنیم تا این ماژول
 * مستقل بماند؛ در عوض از رندر SVG رشته‌ای روی canvas بهره می‌گیریم.
 */
export async function qrPngDataUrl(svg: SVGSVGElement | null, size = 320): Promise<string> {
  if (!svg || typeof window === "undefined") return "";
  try {
    const source = new XMLSerializer().serializeToString(svg);
    const blobUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    const img = new Image();
    img.width = size;
    img.height = size;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("qr-image-failed"));
      img.src = blobUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

/** ساخت بستهٔ چاپ از اطلاعات فاکتور */
export function buildTicketPayload(input: {
  invoiceNumber: string;
  totalToman: number;
  paymentMethod: "cash" | "card";
  items: TicketPrintLine[];
  refNumber?: string | undefined;
  maskedPan?: string | undefined;
  terminalId?: string | undefined;
  responseCode?: string | undefined;
  qrPng?: string | undefined;
  copies?: number;
}): TicketPrintPayload {
  return {
    museumName: MUSEUM_NAME,
    invoiceNumber: input.invoiceNumber,
    dateTime: persianDateTime(),
    paymentMethod: input.paymentMethod,
    totalToman: input.totalToman,
    refNumber: input.refNumber ?? "",
    maskedPan: input.maskedPan ?? "",
    terminalId: input.terminalId ?? "",
    responseCode: input.responseCode ?? "",
    footer: TICKET_FOOTER,
    qrPng: input.qrPng ?? "",
    copies: input.copies ?? 1,
    items: input.items,
  };
}
