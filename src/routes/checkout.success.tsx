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
  ref: z.string().optional(),
  pan: z.string().optional(),
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
        <div className="glass-bronze rounded-3xl p-8 text-center space-y-6 animate-scale-in relative overflow-hidden">
          <div
            className="absolute top-0 inset-x-0 h-1"
            style={{ background: "linear-gradient(90deg, #f5c98a, #cd7f32, #8b5a2b)" }}
          />
          <div
            className="w-24 h-24 rounded-full mx-auto flex items-center justify-center"
            style={{
              background: "radial-gradient(circle at 30% 30%, #86efac, #22c55e 55%, #14532d)",
              boxShadow: "0 15px 40px rgba(34,197,94,0.35)",
            }}
          >
            <CheckCircle2 className="w-14 h-14 text-white" strokeWidth={2.5} />
          </div>

          <div>
            <h2 className="text-3xl font-black text-bronze-gradient">پرداخت با موفقیت ثبت شد</h2>
            <p className="mt-2 text-bronze-light/70 font-medium">
              روش پرداخت: {method === "card" ? "کارت‌خوان" : "نقدی"}
            </p>
          </div>

          <div
            ref={qrBox}
            className="bg-white rounded-2xl p-5 inline-block mx-auto shadow-2xl border-4 border-[#cd7f32]/40"
          >
            <QRCodeSVG value={ticketQrValue(invoice)} size={180} level="M" />
          </div>

          <div className="bg-black/40 rounded-2xl p-5 border border-primary/20 text-right space-y-2">
            <div className="flex justify-between text-bronze-light/70">
              <span>شماره فاکتور:</span>
              <span className="font-mono font-bold text-bronze-light">{invoice}</span>
            </div>
            {ref && (
              <div className="flex justify-between text-bronze-light/70">
                <span>کد پیگیری کارت‌خوان:</span>
                <span className="font-mono font-bold text-bronze-light" dir="ltr">
                  {ref}
                </span>
              </div>
            )}
            {pan && (
              <div className="flex justify-between text-bronze-light/70">
                <span>شمارهٔ کارت:</span>
                <span className="font-mono font-bold text-bronze-light" dir="ltr">
                  {pan}
                </span>
              </div>
            )}
            <hr className="border-primary/20" />
            <div className="flex justify-between text-white font-black text-xl">
              <span>مبلغ پرداختی:</span>
              <span className="text-bronze-gradient">{fmt(total)}</span>
            </div>
          </div>

          <p className="text-bronze-light/60 text-sm font-medium">
            لطفاً از این صفحه عکس بگیرید تا در ورودی موزه ارائه دهید.
          </p>

          <button
            onClick={reprint}
            disabled={printing}
            className="touch-btn inline-flex items-center justify-center gap-2 w-full h-14 text-lg font-black rounded-2xl glass border border-primary/30 text-bronze-light disabled:opacity-60"
          >
            <Printer className="w-5 h-5" />
            {printing ? "در حال چاپ..." : "چاپ دوبارهٔ بلیط"}
          </button>

          <Link
            to="/"
            className="touch-btn inline-flex items-center justify-center gap-2 w-full h-14 text-lg font-black rounded-2xl text-primary-foreground"
            style={{
              background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)",
              boxShadow: "0 10px 30px rgba(205,127,50,0.35)",
            }}
          >
            <Home className="w-5 h-5" />
            بازگشت به صفحه اصلی
          </Link>
        </div>
      </section>
    </PageShell>
  );
}
