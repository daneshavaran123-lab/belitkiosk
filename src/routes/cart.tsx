import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useCartStore } from "@/store/cartStore";
import { Trash2, ShoppingCart, CreditCard, Banknote, Ticket, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/PageShell";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { formatToman } from "@/lib/money";
import {
  newTransactionId,
  posAuthorizeCash,
  posCancel,
  posCashStatus,
  posPay,
  posPrintTicket,
  posTransactionStatus,
  posWaitForResult,
  type PosResult,
} from "@/lib/pos";
import { agentPay, agentStatusLabel, getPayBackend } from "@/lib/pos-agent";
import { PosLiveBadge, usePosLiveStatus } from "@/components/PosLiveStatus";
import { CashierPinPad } from "@/components/CashierPinPad";
import {
  flushInvoiceOutbox,
  newInvoiceNumber,
  savePaidInvoice,
  type InvoiceDb,
  type InvoiceLine,
} from "@/lib/invoice";
import { clearPendingPayment, loadPendingPayment, savePendingPayment } from "@/lib/pending-payment";
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
const db = () => supabase as unknown as InvoiceDb;

/** بازیابی پرداخت نیمه‌کاره فقط یک بار در هر بار باز شدن برنامه */
let recoveryStarted = false;
/** پرداختی که بعد از این مدت بازیابی شود دیگر خودکار بلیط چاپ نمی‌کند (مشتری رفته است) */
const RECOVERY_PRINT_WINDOW_MS = 10 * 60 * 1000;

/** کد کوتاه تراکنش برای گفتن به متصدی */
const shortCode = (id?: string) => (id ?? "").replace(/-/g, "").slice(0, 8).toUpperCase();

interface PaymentNotice {
  title: string;
  body: string;
  code?: string;
}

function CartPage() {
  const navigate = useNavigate();
  const { items, removeItem, clearCart, getSubtotal, getTotalDiscount, getTotal } = useCartStore();
  const [method, setMethod] = useState<"cash" | "card">("card");
  const pos = usePosLiveStatus();
  const [paying, setPaying] = useState(false);
  const [posStatus, setPosStatus] = useState("");
  const [payAmount, setPayAmount] = useState(0);
  const [abort, setAbort] = useState<AbortController | null>(null);
  const [activeTx, setActiveTx] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState<PaymentNotice | null>(null);
  // پرداخت نقدی فقط با رمز متصدی؛ false یعنی رمز تنظیم نشده و گزینهٔ نقدی غیرفعال است
  const [cashEnabled, setCashEnabled] = useState<boolean | null>(null);
  const [cashSale, setCashSale] = useState<{
    invoiceNumber: string;
    total: number;
    lines: InvoiceLine[];
  } | null>(null);
  const [cashBusy, setCashBusy] = useState(false);
  const [cashError, setCashError] = useState("");
  const qrHolder = useRef<HTMLDivElement | null>(null);
  const [qrValue, setQrValue] = useState("");
  // قفل هم‌زمان: لمس دوبارهٔ دکمه پیش از رندر بعدی نباید پرداخت دوم بسازد
  const payingRef = useRef(false);

  const toLines = (): InvoiceLine[] =>
    items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discountPercent: i.discountPercent,
      totalPrice: i.totalPrice,
    }));

  /** چاپ بلیط روی پرینتر حرارتی؛ اگر پرینتر نبود، فرایند متوقف نمی‌شود */
  const printTicket = async (
    invoice_number: string,
    total: number,
    payMethod: "cash" | "card",
    lines: InvoiceLine[],
    pos?: PosResult,
  ) => {
    setPosStatus("در حال چاپ بلیط...");
    setQrValue(ticketQrValue(invoice_number));
    await new Promise((r) => setTimeout(r, 60));
    const svg = qrHolder.current?.querySelector("svg") ?? null;
    const qrPng = await qrPngDataUrl(svg as SVGSVGElement | null);
    const payload = buildTicketPayload({
      invoiceNumber: invoice_number,
      totalToman: total,
      paymentMethod: payMethod,
      items: lines.map((i) => ({
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

  const finish = (
    invoice_number: string,
    total: number,
    payMethod: "cash" | "card",
    pos?: PosResult,
  ) => {
    clearCart();
    navigate({
      to: "/checkout/success",
      search: {
        invoice: invoice_number,
        total,
        method: payMethod,
        ref: pos?.refNumber,
        pan: pos?.maskedPan,
      },
    });
  };

  /** پرداخت کارتی تأیید شد: ثبت فاکتور (یا صف ارسال دوباره)، چاپ بلیط و رفتن به رسید */
  const completeCardSale = async (
    invoice_number: string,
    total: number,
    result: PosResult,
    lines: InvoiceLine[],
  ) => {
    setPosStatus("پرداخت تأیید شد — در حال ثبت فروش...");
    const saved = await savePaidInvoice(db(), {
      invoiceNumber: invoice_number,
      total,
      method: "card",
      items: lines,
      pos: result,
    });
    if (!saved.ok) toast.warning(saved.message ?? "ثبت فاکتور با تأخیر انجام می‌شود");
    clearPendingPayment(result.transactionId);
    await printTicket(invoice_number, total, "card", lines, result);
    finish(invoice_number, total, "card", result);
  };

  /** پرداخت تأیید نشد؛ اگر وضعیت نامعلوم است پیام روشن با کد پیگیری نشان داده می‌شود */
  const handleNotApproved = (result: PosResult) => {
    if (result.final !== false) clearPendingPayment(result.transactionId);
    setPaying(false);
    setPosStatus("");
    setActiveTx(null);
    setCancelling(false);
    if (result.uncertain) {
      setNotice({
        title: "وضعیت پرداخت نامشخص است",
        body: `${result.message ?? ""} اگر مبلغ از حساب شما کسر شده، رسید کارت‌خوان را به متصدی نشان دهید تا بلیط صادر یا وجه برگشت داده شود.`,
        code: shortCode(result.transactionId),
      });
    } else if (result.status === "cancelled") {
      toast.info(result.message ?? "تراکنش لغو شد");
    } else {
      toast.error(result.message ?? "پرداخت با کارت‌خوان ناموفق بود");
    }
  };

  // ارسال فاکتورهای مانده در صف و بازیابی پرداختی که وسط کار قطع شده بود
  useEffect(() => {
    void posCashStatus().then((r) => {
      if (r.ok) setCashEnabled(r.pinConfigured);
      if (r.ok && !r.pinConfigured) setMethod((m) => (m === "cash" ? "card" : m));
    });
  }, []);

  useEffect(() => {
    void flushInvoiceOutbox(db());
    const pending = loadPendingPayment();
    if (!pending || recoveryStarted || getPayBackend() !== "bridge") return;
    recoveryStarted = true;
    void (async () => {
      // یک پرسش سریع؛ اگر سرویس پل پایین است صفحه را قفل نمی‌کنیم و دفعهٔ بعد دوباره می‌پرسیم
      let first: PosResult | null;
      try {
        first = await posTransactionStatus(pending.transactionId, 3000);
      } catch {
        recoveryStarted = false;
        return;
      }
      if (first === null) {
        clearPendingPayment(pending.transactionId); // درخواست هرگز به کارت‌خوان نرسیده بود
        return;
      }
      if (payingRef.current) return;
      payingRef.current = true;
      setMethod("card");
      setPaying(true);
      setPayAmount(pending.amountToman);
      setActiveTx(first.final ? null : pending.transactionId);
      setPosStatus("در حال بررسی نتیجهٔ پرداخت قبلی...");
      try {
        const r = first.final
          ? first
          : await posWaitForResult(pending.transactionId, { deadlineMs: 150_000 });
        const recent =
          Date.now() - new Date(pending.startedAt).getTime() < RECOVERY_PRINT_WINDOW_MS;
        if (r.success && recent) {
          await completeCardSale(pending.invoiceNumber, pending.amountToman, r, pending.items);
        } else if (r.success) {
          clearPendingPayment(pending.transactionId);
          handleNotApproved({
            ...r,
            success: false,
            uncertain: true,
            message:
              "پرداخت قبلی پس از مدتی طولانی تأیید شده است و در فهرست بررسی کارت‌خوان ثبت شد.",
          });
        } else {
          handleNotApproved(r);
        }
      } finally {
        payingRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pay = async () => {
    if (items.length === 0 || payingRef.current) return;
    payingRef.current = true;
    try {
      const invoice_number = newInvoiceNumber();
      const total = getTotal();
      const lines = toLines();
      setNotice(null);

      if (method === "cash") {
        if (cashEnabled === false) {
          toast.error("پرداخت نقدی غیرفعال است؛ رمز متصدی در پنل مدیریت تنظیم نشده");
          return;
        }
        // بلیط نقدی فقط پس از تأیید متصدی با رمز صادر می‌شود
        setCashError("");
        setCashSale({ invoiceNumber: invoice_number, total, lines });
        return;
      }

      setPayAmount(total);
      setPaying(true);

      if (method === "card") {
        if (getPayBackend() === "agent") {
          setPosStatus("در حال ارسال مبلغ به دستگاه کارت‌خوان...");
          const ctrl = new AbortController();
          setAbort(ctrl);
          const result = await agentPay(
            { amountToman: total, description: `فاکتور ${invoice_number}` },
            { signal: ctrl.signal, onStatus: (s) => setPosStatus(agentStatusLabel(s)) },
          );
          setAbort(null);
          if (result.success) await completeCardSale(invoice_number, total, result, lines);
          else handleNotApproved(result);
          return;
        }

        const transactionId = newTransactionId();
        // پیش از فرستادن مبلغ ذخیره می‌شود تا اگر صفحه بسته شد، نتیجه قابل بازیابی باشد
        savePendingPayment({
          transactionId,
          invoiceNumber: invoice_number,
          amountToman: total,
          items: lines,
          startedAt: new Date().toISOString(),
        });
        setActiveTx(transactionId);
        setPosStatus("مبلغ به کارت‌خوان ارسال شد — لطفاً کارت را بکشید و رمز را وارد کنید");
        const result = await posPay({
          amountToman: total,
          invoiceNumber: invoice_number,
          transactionId,
        });
        setActiveTx(null);
        setCancelling(false);
        if (result.success) await completeCardSale(invoice_number, total, result, lines);
        else handleNotApproved(result);
        return;
      }
    } finally {
      payingRef.current = false;
    }
  };

  /** رمز متصدی را سرویس پل بررسی می‌کند؛ فقط با تأیید آن فروش نقدی ثبت و بلیط چاپ می‌شود */
  const submitCashPin = async (pin: string) => {
    if (!cashSale || payingRef.current) return;
    setCashBusy(true);
    setCashError("");
    const auth = await posAuthorizeCash({
      pin,
      invoiceNumber: cashSale.invoiceNumber,
      amountToman: cashSale.total,
    });
    setCashBusy(false);
    if (!auth.ok) {
      setCashError(auth.message);
      if (auth.code === "NOT_CONFIGURED") {
        setCashEnabled(false);
        setCashSale(null);
        setMethod("card");
        toast.error(auth.message);
      }
      return;
    }

    const { invoiceNumber, total, lines } = cashSale;
    setCashSale(null);
    payingRef.current = true;
    try {
      setPayAmount(total);
      setPaying(true);
      setPosStatus("پرداخت نقدی تأیید شد — در حال ثبت فروش...");
      // وجه دریافت شده؛ اگر پایگاه‌داده در دسترس نبود فاکتور در صف می‌ماند و بلیط صادر می‌شود
      const saved = await savePaidInvoice(db(), {
        invoiceNumber,
        total,
        method: "cash",
        items: lines,
      });
      if (!saved.ok) toast.warning(saved.message ?? "ثبت فاکتور با تأخیر انجام می‌شود");
      await printTicket(invoiceNumber, total, "cash", lines);
      finish(invoiceNumber, total, "cash");
    } finally {
      payingRef.current = false;
    }
  };

  /**
   * لغو: کارت‌خوان فرمان لغو ندارد؛ درخواست به سرویس داده می‌شود و تا رسیدن نتیجهٔ واقعی
   * دستگاه صبر می‌کنیم. اگر مشتری همان لحظه پرداخت کرده باشد، فروش ثبت و بلیط چاپ می‌شود.
   */
  const cancelPos = async () => {
    if (cancelling) return;
    setCancelling(true);
    setPosStatus(
      "در حال لغو — اگر کارت‌خوان هنوز منتظر کارت است، دکمهٔ قرمز (لغو) را روی دستگاه بزنید",
    );
    if (getPayBackend() === "agent") {
      abort?.abort();
      return;
    }
    if (activeTx) await posCancel(activeTx);
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

          <h2 className="text-3xl font-black text-bronze-gradient">در حال پردازش پرداخت...</h2>
          <p className="text-bronze-light/70 text-lg font-medium">
            {method === "card"
              ? "لطفاً کارت خود را روی دستگاه بکشید"
              : "پرداخت نقدی با تأیید متصدی ثبت شد"}
          </p>
          {method === "card" && (
            <>
              <PosLiveBadge state={pos.state} latencyMs={pos.latencyMs} />
              <p className="text-bronze-light/50 text-sm">{posStatus}</p>
              <p className="text-2xl font-black text-bronze-gradient">{fmt(payAmount)}</p>
              {(activeTx || abort) && (
                <button
                  onClick={() => void cancelPos()}
                  disabled={cancelling}
                  className="touch-btn h-12 px-8 rounded-full font-black glass border border-primary/30 text-bronze-light disabled:opacity-50"
                >
                  {cancelling ? "در حال لغو..." : "لغو تراکنش"}
                </button>
              )}
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
        {notice && (
          <div
            role="alert"
            className="mb-6 rounded-2xl border border-amber-400/50 bg-amber-500/10 p-5 space-y-3 animate-fade-in-up"
          >
            <p className="flex items-center gap-2 text-amber-200 font-black text-lg">
              <AlertTriangle className="w-6 h-6" />
              {notice.title}
            </p>
            <p className="text-bronze-light/80 leading-7">{notice.body}</p>
            {notice.code && (
              <p className="text-bronze-light/70">
                کد پیگیری کیوسک:{" "}
                <span className="font-mono font-black text-white" dir="ltr">
                  {notice.code}
                </span>
              </p>
            )}
            <button
              onClick={() => setNotice(null)}
              className="touch-btn h-11 px-6 rounded-full font-black glass border border-amber-400/40 text-amber-100"
            >
              متوجه شدم
            </button>
          </div>
        )}
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center pt-16 glass-bronze rounded-3xl p-10 animate-fade-in-up">
            <ShoppingCart className="w-20 h-20 text-bronze-light/30 mb-5" />
            <p className="text-2xl text-bronze-light/70 font-bold mb-6">سبد خرید شما خالی است</p>
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
              <span className="text-bronze-light/60 text-sm font-bold">
                وضعیت لحظه‌ای کارت‌خوان
              </span>
              <PosLiveBadge state={pos.state} latencyMs={pos.latencyMs} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { key: "card" as const, icon: CreditCard, label: "کارت‌خوان", sub: "PAX Q58" },
                {
                  key: "cash" as const,
                  icon: Banknote,
                  label: "نقدی",
                  sub:
                    cashEnabled === false
                      ? "غیرفعال — رمز متصدی تنظیم نشده"
                      : "پرداخت به متصدی با تأیید رمز",
                },
              ].map(({ key, icon: Icon, label, sub }) => (
                <button
                  key={key}
                  onClick={() => setMethod(key)}
                  disabled={key === "cash" && cashEnabled === false}
                  className={`touch-btn flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition disabled:opacity-40 ${
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
              onClick={() => void pay()}
              disabled={paying}
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
      {cashSale && (
        <CashierPinPad
          amountToman={cashSale.total}
          busy={cashBusy}
          error={cashError}
          onSubmit={submitCashPin}
          onCancel={() => {
            if (cashBusy) return;
            setCashSale(null);
            setCashError("");
          }}
        />
      )}
    </PageShell>
  );
}
