import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useCartStore } from "@/store/cartStore";
import { Trash2, ShoppingCart, CreditCard, Banknote, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/PageShell";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { formatToman } from "@/lib/money";
import { posCancel, posPay, posPrintTicket, type PosResult } from "@/lib/pos";
import { agentPay, agentStatusLabel, getPayBackend } from "@/lib/pos-agent";
import { PosLiveBadge, usePosLiveStatus } from "@/components/PosLiveStatus";
import { saveInvoice, type InvoiceDb } from "@/lib/invoice";
import { buildTicketPayload, qrPngDataUrl, ticketQrValue } from "@/lib/receipt";


export const Route = createFileRoute("/cart")({
  head: () => ({
    meta: [
      { title: "سبد خرید — موزه افتخارات کشتی ایران" },
      { name: "description", content: "بررسی و پرداخت سبد خرید بلیط موزه." },
      { property: "og:title", content: "سبد خرید موزه کشتی ایران" },
      { property: "og:description", content: "پرداخت امن با کارت‌خوان یا نقدی." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CartPage,
});

const fmt = (n: number) => formatToman(n);

function genInvoiceNumber() {
  const now = new Date();
  const d = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const r = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0");
  return `INV-${d}-${r}`;
}

function CartPage() {
  const navigate = useNavigate();
  const { items, removeItem, clearCart, getSubtotal, getTotalDiscount, getTotal } = useCartStore();
  const [method, setMethod] = useState<"cash" | "card">("card");
  const pos = usePosLiveStatus();
  const [paying, setPaying] = useState(false);
  const [posStatus, setPosStatus] = useState("");
  const [abort, setAbort] = useState<AbortController | null>(null);
  const qrHolder = useRef<HTMLDivElement | null>(null);
  const [qrValue, setQrValue] = useState("");

  const persistInvoice = async (
    invoice_number: string,
    total: number,
    pos?: PosResult,
  ): Promise<boolean> => {
    const res = await saveInvoice(supabase as unknown as InvoiceDb, {
      invoiceNumber: invoice_number,
      total,
      method,
      items,
      pos,
    });
    if (!res.ok && res.message) toast.error(res.message);
    return res.ok;
  };

  /** چاپ بلیط روی پرینتر حرارتی؛ اگر پرینتر نبود، فرایند متوقف نمی‌شود */
  const printTicket = async (invoice_number: string, total: number, pos?: PosResult) => {
    setPosStatus("در حال چاپ بلیط...");
    setQrValue(ticketQrValue(invoice_number));
    await new Promise((r) => setTimeout(r, 60));
    const svg = qrHolder.current?.querySelector("svg") ?? null;
    const qrPng = await qrPngDataUrl(svg as SVGSVGElement | null);
    const payload = buildTicketPayload({
      invoiceNumber: invoice_number,
      totalToman: total,
      paymentMethod: method,
      items: items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        totalToman: i.totalPrice,
      })),
      refNumber: pos?.refNumber,
      maskedPan: pos?.maskedPan,
      terminalId: pos?.terminalId,
      responseCode: pos?.responseCode,
      qrPng,
    });
    const res = await posPrintTicket(payload);
    if (!res.ok) toast.warning(`${res.message} — رسید روی صفحه نمایش داده می‌شود`);
    else toast.success("بلیط چاپ شد");
  };

  const finish = (invoice_number: string, total: number, pos?: PosResult) => {
    clearCart();
    navigate({
      to: "/checkout/success",
      search: {
        invoice: invoice_number,
        total,
        method,
        ref: pos?.refNumber,
        pan: pos?.maskedPan,
      },
    });
  };

  const pay = async () => {
    if (items.length === 0) return;
    const invoice_number = genInvoiceNumber();
    const total = getTotal();
    setPaying(true);

    if (method === "card") {
      const useAgent = getPayBackend() === "agent";
      setPosStatus("در حال ارسال مبلغ به دستگاه کارت‌خوان...");
      const ctrl = new AbortController();
      setAbort(ctrl);
      const result = useAgent
        ? await agentPay(
            { amountToman: total, description: `فاکتور ${invoice_number}` },
            { signal: ctrl.signal, onStatus: (s) => setPosStatus(agentStatusLabel(s)) },
          )
        : await posPay({ amountToman: total, invoiceNumber: invoice_number }, {
            signal: ctrl.signal,
          });
      setAbort(null);
      if (!result.success) {
        toast.error(result.message ?? "پرداخت با کارت‌خوان ناموفق بود");
        setPaying(false);
        setPosStatus("");
        return;
      }
      const ok = await persistInvoice(invoice_number, total, result);
      if (!ok) {
        setPaying(false);
        setPosStatus("");
        return;
      }
      await printTicket(invoice_number, total, result);
      finish(invoice_number, total, result);
      return;
    }

    const ok = await persistInvoice(invoice_number, total);
    if (!ok) {
      setPaying(false);
      return;
    }
    await printTicket(invoice_number, total);
    setTimeout(() => finish(invoice_number, total), 600);
  };


  const cancelPos = async () => {
    abort?.abort();
    // در حالت PosAgent لغو از طریق خودِ agentPay و با سیگنال abort انجام می‌شود
    if (getPayBackend() !== "agent") await posCancel();
    setAbort(null);
    setPaying(false);
    setPosStatus("");
    toast.info("تراکنش لغو شد");
  };

  if (paying) {
    return (
      <PageShell title="در حال پرداخت" showCart={false} backTo="/cart">
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-6 text-center">
          <div
            ref={qrHolder}
            aria-hidden
            style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
          >
            {qrValue && <QRCodeSVG value={qrValue} size={320} level="M" />}
          </div>
          <div className="w-20 h-20 border-4 border-primary border-t-transparent rounded-full animate-spin" />

          <h2 className="text-3xl font-black text-bronze-gradient">
            در حال پردازش پرداخت...
          </h2>
          <p className="text-bronze-light/70 text-lg font-medium">
            {method === "card"
              ? "لطفاً کارت خود را روی دستگاه بکشید"
              : "لطفاً مبلغ را به صندوق‌دار پرداخت کنید"}
          </p>
          {method === "card" && (
            <>
              <PosLiveBadge state={pos.state} latencyMs={pos.latencyMs} />
              <p className="text-bronze-light/50 text-sm">{posStatus}</p>
              <p className="text-2xl font-black text-bronze-gradient">{fmt(getTotal())}</p>
              <button
                onClick={cancelPos}
                className="touch-btn h-12 px-8 rounded-full font-black glass border border-primary/30 text-bronze-light"
              >
                لغو تراکنش
              </button>
            </>
          )}
        </div>
      </PageShell>
    );
  }


  return (
    <PageShell title="سبد خرید" showCart={false}>
      <Toaster position="top-center" richColors />
      <section className="max-w-2xl mx-auto px-6 py-8">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center pt-16 glass-bronze rounded-3xl p-10 animate-fade-in-up">
            <ShoppingCart className="w-20 h-20 text-bronze-light/30 mb-5" />
            <p className="text-2xl text-bronze-light/70 font-bold mb-6">
              سبد خرید شما خالی است
            </p>
            <Link
              to="/tickets"
              className="touch-btn inline-flex items-center gap-2 h-14 px-8 text-lg font-black rounded-full text-primary-foreground"
              style={{
                background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)",
                boxShadow: "0 10px 30px rgba(205,127,50,0.35)",
              }}
            >
              <Ticket className="w-5 h-5" />
              خرید بلیط
            </Link>
          </div>
        ) : (
          <div className="space-y-4 animate-fade-in-up">
            {items.map((item) => (
              <div
                key={item.id}
                className="glass-bronze rounded-2xl p-5 flex items-center justify-between"
              >
                <div className="flex-1">
                  <h3 className="text-white font-bold text-lg">{item.name}</h3>
                  <p className="text-bronze-light/60 text-sm font-medium mt-1">
                    {item.quantity} × {fmt(item.unitPrice)}
                    {item.discountPercent > 0 && ` (${item.discountPercent}٪ تخفیف)`}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xl font-black text-bronze-gradient">
                    {fmt(item.totalPrice)}
                  </span>
                  <button
                    onClick={() => removeItem(item.id)}
                    className="touch-btn text-rose-400/70 hover:text-rose-400 p-2"
                    aria-label="حذف"
                  >
                    <Trash2 className="w-6 h-6" />
                  </button>
                </div>
              </div>
            ))}

            <div className="glass-bronze rounded-2xl p-6 space-y-3 mt-6 relative overflow-hidden">
              <div
                className="absolute top-0 inset-x-0 h-1"
                style={{
                  background: "linear-gradient(90deg, #f5c98a, #cd7f32, #8b5a2b)",
                }}
              />
              <div className="flex justify-between text-bronze-light/80 font-medium">
                <span>جمع اقلام:</span>
                <span>{fmt(getSubtotal())}</span>
              </div>
              {getTotalDiscount() > 0 && (
                <div className="flex justify-between text-emerald-400 font-medium">
                  <span>تخفیف:</span>
                  <span>- {fmt(getTotalDiscount())}</span>
                </div>
              )}
              <hr className="border-primary/20" />
              <div className="flex justify-between text-white font-black text-2xl">
                <span>مبلغ قابل پرداخت:</span>
                <span className="text-bronze-gradient">{fmt(getTotal())}</span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-bronze-light/60 text-sm font-bold">وضعیت لحظه‌ای کارت‌خوان</span>
              <PosLiveBadge state={pos.state} latencyMs={pos.latencyMs} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { key: "card" as const, icon: CreditCard, label: "کارت‌خوان", sub: "PAX Q58" },
                { key: "cash" as const, icon: Banknote, label: "نقدی", sub: "پرداخت به صندوق" },
              ].map(({ key, icon: Icon, label, sub }) => (
                <button
                  key={key}
                  onClick={() => setMethod(key)}
                  className={`touch-btn flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition ${
                    method === key
                      ? "glass-bronze border-primary shadow-[0_10px_30px_rgba(205,127,50,0.3)]"
                      : "glass border-white/10 hover:border-primary/40"
                  }`}
                >
                  <Icon
                    className={`w-10 h-10 ${method === key ? "text-primary" : "text-bronze-light/60"}`}
                  />
                  <span className="text-white font-bold text-lg">{label}</span>
                  <span className="text-bronze-light/50 text-xs font-medium">{sub}</span>
                </button>
              ))}
            </div>

            <Button
              onClick={pay}
              className="touch-btn w-full h-16 text-xl font-black rounded-2xl text-primary-foreground"
              style={{
                background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)",
                boxShadow: "0 12px 32px rgba(205,127,50,0.4)",
              }}
            >
              پرداخت {fmt(getTotal())}
            </Button>
          </div>
        )}
      </section>
    </PageShell>
  );
}
