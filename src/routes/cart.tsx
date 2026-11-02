import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useCartStore } from "@/store/cartStore";
import {
  Trash2,
  ShoppingCart,
  CreditCard,
  Banknote,
  Ticket,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/PageShell";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { formatNumber, formatToman } from "@/lib/money";
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
      itemType: i.type,
      referenceId: i.referenceId,
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
          <div className="glass-bronze rounded-[2.5rem] w-full max-w-xl px-8 py-12 flex flex-col items-center gap-6 animate-scale-in">
            <div className="relative w-36 h-36 flex items-center justify-center">
              <span
                className="absolute inset-0 rounded-full border-2 border-[#f0b868]/60 animate-ring-pulse"
                aria-hidden
              />
              <span
                className="absolute inset-0 rounded-full border-2 border-[#f0b868]/40 animate-ring-pulse"
                style={{ animationDelay: "1.1s" }}
                aria-hidden
              />
              <div
                className="relative w-28 h-28 rounded-full flex items-center justify-center"
                style={{
                  background:
                    "radial-gradient(circle at 30% 25%, #fff0d2, #f0b868 35%, #cd7f32 70%, #8b5a2b)",
                  boxShadow:
                    "inset 0 2px 0 rgba(255,255,255,0.7), inset 0 -4px 10px rgba(120,60,10,0.45), 0 18px 44px rgba(205,127,50,0.55)",
                }}
              >
                {method === "card" ? (
                  <CreditCard className="w-14 h-14 text-[#2a1606]" strokeWidth={2} />
                ) : (
                  <Banknote className="w-14 h-14 text-[#2a1606]" strokeWidth={2} />
                )}
              </div>
            </div>

            <h2 className="text-3xl font-black text-bronze-gradient">در حال پردازش پرداخت...</h2>
            <p className="text-white/80 text-xl font-bold">
              {method === "card"
                ? "لطفاً کارت خود را روی دستگاه بکشید"
                : "پرداخت نقدی با تأیید متصدی ثبت شد"}
            </p>
            {method === "card" && (
              <>
                <p className="text-4xl font-black text-bronze-gradient">{fmt(payAmount)}</p>
                <PosLiveBadge state={pos.state} latencyMs={pos.latencyMs} />
                <p className="text-white/55 text-sm font-medium leading-7">{posStatus}</p>
                {(activeTx || abort) && (
                  <button
                    onClick={() => void cancelPos()}
                    disabled={cancelling}
                    className="touch-btn glass-chip h-14 px-10 rounded-full font-black text-white disabled:opacity-50"
                  >
                    {cancelling ? "در حال لغو..." : "لغو تراکنش"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="سبد خرید" showCart={false}>
      <Toaster position="top-center" richColors />
      <section className="max-w-2xl mx-auto px-6 py-8 min-h-full flex flex-col">
        {notice && (
          <div
            role="alert"
            className="glass-amber mb-6 rounded-[2rem] p-6 space-y-3 animate-fade-in-up"
          >
            <p className="flex items-center gap-2 text-amber-200 font-black text-lg">
              <AlertTriangle className="w-6 h-6" />
              {notice.title}
            </p>
            <p className="text-white/85 leading-7">{notice.body}</p>
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
              className="touch-btn glass-chip h-12 px-8 rounded-full font-black text-amber-100"
            >
              متوجه شدم
            </button>
          </div>
        )}
        {items.length === 0 ? (
          <div className="my-auto flex flex-col items-center justify-center text-center glass-bronze rounded-[2.5rem] p-12 animate-fade-in-up">
            <ShoppingCart className="w-24 h-24 text-white/30 mb-5" strokeWidth={1.5} />
            <p className="text-2xl text-white/80 font-bold mb-2">سبد خرید شما خالی است</p>
            <p className="text-white/50 mb-7">برای شروع، یک بلیط انتخاب کنید.</p>
            <Link
              to="/tickets"
              className="touch-btn btn-liquid inline-flex items-center gap-2 h-16 px-10 text-xl font-black rounded-full hover:brightness-105"
            >
              <Ticket className="w-5 h-5" />
              خرید بلیط
            </Link>
          </div>
        ) : (
          <div className="my-auto flex flex-col gap-4 animate-fade-in-up">
            {items.map((item) => (
              <div
                key={item.id}
                className="glass-bronze rounded-[1.75rem] p-5 flex items-center justify-between gap-4"
              >
                <div className="flex-1">
                  <h3 className="text-white font-black text-xl">{item.name}</h3>
                  <p className="text-white/60 text-sm font-medium mt-1">
                    {formatNumber(item.quantity)} × {fmt(item.unitPrice)}
                    {item.discountPercent > 0 && ` (${formatNumber(item.discountPercent)}٪ تخفیف)`}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xl font-black text-bronze-gradient">
                    {fmt(item.totalPrice)}
                  </span>
                  <button
                    onClick={() => removeItem(item.id)}
                    className="touch-btn glass-chip h-12 w-12 rounded-full flex items-center justify-center text-rose-300 hover:text-rose-200"
                    aria-label="حذف"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}

            <div className="glass-bronze rounded-[2rem] p-6 space-y-3 relative overflow-hidden">
              <div
                className="absolute top-0 inset-x-0 h-1"
                style={{
                  background: "linear-gradient(90deg, #f5c98a, #cd7f32, #8b5a2b)",
                }}
              />
              <div className="flex justify-between text-white/75 font-medium">
                <span>جمع اقلام:</span>
                <span>{fmt(getSubtotal())}</span>
              </div>
              {getTotalDiscount() > 0 && (
                <div className="flex justify-between text-emerald-300 font-medium">
                  <span>تخفیف:</span>
                  <span>- {fmt(getTotalDiscount())}</span>
                </div>
              )}
              <hr className="border-white/15" />
              <div className="flex justify-between items-baseline text-white font-black text-2xl">
                <span>مبلغ قابل پرداخت:</span>
                <span className="text-bronze-gradient">{fmt(getTotal())}</span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-white/60 text-sm font-bold">وضعیت لحظه‌ای کارت‌خوان</span>
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
                  aria-pressed={method === key}
                  className={`touch-btn relative flex flex-col items-center gap-3 p-6 rounded-[2rem] transition disabled:opacity-40 ${
                    method === key
                      ? "glass-bronze !border-[#f0b868] shadow-[0_0_0_2px_rgb(240_184_104/0.55),0_20px_44px_-12px_rgb(205_127_50/0.55)]"
                      : "glass hover:brightness-125"
                  }`}
                >
                  {method === key && (
                    <CheckCircle2 className="absolute top-3 right-3 w-6 h-6 text-[#f0b868] animate-pop-in" />
                  )}
                  <Icon
                    className={`w-12 h-12 ${method === key ? "text-[#f0b868]" : "text-white/60"}`}
                  />
                  <span className="text-white font-black text-xl">{label}</span>
                  <span className="text-white/55 text-xs font-medium">{sub}</span>
                </button>
              ))}
            </div>

            <Button
              onClick={() => void pay()}
              disabled={paying}
              className="touch-btn btn-liquid w-full h-[4.5rem] text-2xl font-black rounded-full hover:brightness-105"
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
