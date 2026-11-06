import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, Home, Printer } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { PageShell } from "@/components/PageShell";
import { formatToman } from "@/lib/money";
import { posPrintTicket } from "@/lib/pos";
import { buildTicketPayload, qrPngDataUrl, ticketQrValue } from "@/lib/receipt";

const searchSchema = z.object({
  invoice: z.string().default(""),
  total: z.coerce.number().default(0),
  method: z.enum(["card", "cash"]).default("card"),
  ref: z.coerce.string().optional(),
  pan: z.coerce.string().optional(),
});

export const Route = createFileRoute("/checkout/success")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "پرداخت موفق — موزه افتخارات کشتی ایران" },
      { name: "description", content: "پرداخت شما با موفقیت ثبت شد." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SuccessPage,
});

const fmt = (n: number) => formatToman(n);

function SuccessPage() {
  const { invoice, total, method, ref, pan } = Route.useSearch();
  const qrBox = useRef<HTMLDivElement | null>(null);
  const [printing, setPrinting] = useState(false);

  const reprint = async () => {
    setPrinting(true);
    try {
      const svg = qrBox.current?.querySelector("svg") ?? null;
      const qrPng = await qrPngDataUrl(svg as SVGSVGElement | null);
      const res = await posPrintTicket(
        buildTicketPayload({
          invoiceNumber: invoice,
          totalToman: total,
          paymentMethod: method,
          items: [],
          refNumber: ref,
          maskedPan: pan,
          qrPng,
        }),
      );
      if (res.ok) toast.success("بلیط دوباره چاپ شد");
      else toast.error(res.message);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <PageShell title="پرداخت موفق" showCart={false}>
      <Toaster position="top-center" richColors />
      <section className="max-w-xl mx-auto px-6 py-8">
        <div className="glass-bronze rounded-[2.5rem] p-8 text-center space-y-6 animate-scale-in relative overflow-hidden">
          <div
            className="absolute top-0 inset-x-0 h-1"
            style={{ background: "linear-gradient(90deg, #f5c98a, #cd7f32, #8b5a2b)" }}
          />
          <div className="relative w-28 h-28 mx-auto">
            <span
              className="absolute inset-0 rounded-full border-2 border-emerald-300/60 animate-ring-pulse"
              aria-hidden
            />
            <div
              className="relative w-28 h-28 rounded-full flex items-center justify-center animate-pop-in"
              style={{
                background:
                  "radial-gradient(circle at 30% 25%, #d1fae5, #4ade80 40%, #16a34a 75%, #14532d)",
                boxShadow:
                  "inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -5px 12px rgba(5,60,30,0.45), 0 12px 28px rgba(34,197,94,0.28)",
              }}
            >
              <CheckCircle2 className="w-16 h-16 text-white" strokeWidth={2.5} />
            </div>
          </div>

          <div>
            <h2 className="text-3xl font-black text-bronze-gradient">پرداخت با موفقیت ثبت شد</h2>
            <p className="mt-2 text-white/70 font-medium">
              روش پرداخت: {method === "card" ? "کارت‌خوان" : "نقدی"}
            </p>
          </div>

          <div
            ref={qrBox}
            className="bg-white rounded-3xl p-5 inline-block mx-auto shadow-[0_16px_36px_-12px_rgba(0,0,0,0.6)] ring-4 ring-white/20"
          >
            <QRCodeSVG value={ticketQrValue(invoice)} size={180} level="M" />
          </div>

          <div className="glass-well rounded-3xl p-5 text-right space-y-2">
            <div className="flex justify-between text-white/70">
              <span>شماره فاکتور:</span>
              <span className="font-mono font-bold text-white">{invoice}</span>
            </div>
            {ref && (
              <div className="flex justify-between text-white/70">
                <span>کد پیگیری کارت‌خوان:</span>
                <span className="font-mono font-bold text-white" dir="ltr">
                  {ref}
                </span>
              </div>
            )}
            {pan && (
              <div className="flex justify-between text-white/70">
                <span>شمارهٔ کارت:</span>
                <span className="font-mono font-bold text-white" dir="ltr">
                  {pan}
                </span>
              </div>
            )}
            <hr className="border-white/15 border-dashed" />
            <div className="flex justify-between items-baseline text-white font-black text-xl">
              <span>مبلغ پرداختی:</span>
              <span className="text-bronze-gradient text-2xl">{fmt(total)}</span>
            </div>
          </div>

          <p className="text-white/60 text-sm font-medium">
            لطفاً از این صفحه عکس بگیرید تا در ورودی موزه ارائه دهید.
          </p>

          <button
            onClick={reprint}
            disabled={printing}
            className="touch-btn glass-chip inline-flex items-center justify-center gap-2 w-full h-16 text-lg font-black rounded-full text-white disabled:opacity-60"
          >
            <Printer className="w-5 h-5" />
            {printing ? "در حال چاپ..." : "چاپ دوبارهٔ بلیط"}
          </button>

          <Link
            to="/"
            className="touch-btn btn-liquid inline-flex items-center justify-center gap-2 w-full h-[4.25rem] text-xl font-black rounded-full hover:brightness-105"
          >
            <Home className="w-6 h-6" />
            بازگشت به صفحه اصلی
          </Link>
        </div>
      </section>
    </PageShell>
  );
}
