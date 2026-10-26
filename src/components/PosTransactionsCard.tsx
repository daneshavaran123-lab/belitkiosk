/**
 * کارت‌های «پروتکل ارتباط» و «دفتر تراکنش‌ها» در صفحهٔ تنظیمات کارت‌خوان.
 *
 * دفتر تراکنش‌ها از خود سرویس پل خوانده می‌شود؛ تراکنش‌های «نیازمند بررسی» آن‌هایی هستند که
 * ممکن است وجه از کارت مشتری کسر شده باشد بدون اینکه کیوسک بلیط داده باشد (پاسخ دیرهنگام،
 * قطع ارتباط، پاسخ ناهمخوان). متصدی پس از بازگشت وجه یا صدور دستی بلیط آن را «بررسی شد» می‌زند.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ListChecks,
  Loader2,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatToman } from "@/lib/money";
import {
  posGetProtocol,
  posMarkReviewed,
  posSaveProtocol,
  posTransactions,
  type PosProtocol,
  type PosResponseMode,
  type PosTransactionRecord,
  type PosTxStatus,
} from "@/lib/pos";

const STATUS_LABEL: Record<PosTxStatus, string> = {
  pending: "در حال اتصال",
  sending: "در حال ارسال",
  sent: "منتظر کارت",
  approved: "موفق",
  approved_late: "موفقِ دیرهنگام",
  declined: "رد شد",
  cancelled: "لغو شد",
  timeout: "بی‌پاسخ",
  failed: "ارسال نشد",
  uncertain: "نامطمئن",
};

function statusTone(t: PosTransactionRecord): string {
  if (t.needsReview && !t.reviewed) return "border-amber-400/50 text-amber-200";
  if (t.status === "approved") return "border-emerald-400/40 text-emerald-300";
  if (t.status === "declined" || t.status === "failed") return "border-rose-400/40 text-rose-300";
  return "border-white/20 text-bronze-light/70";
}

const RESPONSE_MODES: { key: PosResponseMode; title: string; sub: string }[] = [
  {
    key: "auto",
    title: "خودکار (پیشنهادی)",
    sub: "هم روی همان اتصال و هم با اتصال برگشتی دستگاه منتظر پاسخ می‌ماند",
  },
  {
    key: "callback",
    title: "اتصال برگشتی",
    sub: "مثل پیش‌فرض کتابخانهٔ رسمی؛ دستگاه پس از تراکنش به کیوسک وصل می‌شود",
  },
  {
    key: "same",
    title: "همان اتصال",
    sub: "پاسخ روی همان اتصال TCP درخواست برمی‌گردد",
  },
];

/** انتخاب پروتکل و نحوهٔ برگشت پاسخ کارت‌خوان */
export function PosProtocolCard() {
  const [protocol, setProtocol] = useState<PosProtocol>("native");
  const [mode, setMode] = useState<PosResponseMode>("auto");
  const [timeoutSeconds, setTimeoutSeconds] = useState(120);
  const [tokenRequired, setTokenRequired] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void posGetProtocol().then((r) => {
      if (!r.ok) return;
      if (r.protocol) setProtocol(r.protocol);
      if (r.responseMode) setMode(r.responseMode);
      if (r.timeoutSeconds) setTimeoutSeconds(r.timeoutSeconds);
      setTokenRequired(r.tokenRequired ?? false);
      setLoaded(true);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    const r = await posSaveProtocol({ protocol, responseMode: mode, timeoutSeconds });
    setSaving(false);
    if (r.ok) toast.success(r.message);
    else toast.error(r.message);
  };

  return (
    <div className="glass rounded-2xl p-6 space-y-4">
      <p className="font-black text-bronze-light flex items-center gap-2">
        <Settings2 className="w-5 h-5 text-primary" />
        پروتکل ارتباط با کارت‌خوان (PC-POS)
      </p>

      {tokenRequired === false && (
        <p className="text-xs leading-6 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-amber-200">
          توکن دسترسی سرویس پل تنظیم نشده است. برای امنیت کامل، یک رشتهٔ تصادفی طولانی در
          <span dir="ltr" className="font-mono mx-1">
            accessToken
          </span>
          فایل appsettings.json بگذارید و همان را در بخش «توکن دسترسی» همین صفحه وارد کنید.
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {RESPONSE_MODES.map((o) => (
          <button
            key={o.key}
            onClick={() => setMode(o.key)}
            className={`touch-btn text-right p-4 rounded-xl border-2 transition ${
              mode === o.key
                ? "glass-bronze border-primary"
                : "glass border-white/10 hover:border-primary/40"
            }`}
          >
            <p className="font-black text-bronze-light">{o.title}</p>
            <p className="text-xs text-bronze-light/60 mt-1 leading-5">{o.sub}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm text-bronze-light/70">
          <span>پیاده‌سازی</span>
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as PosProtocol)}
            className="w-full h-11 rounded-xl bg-black/30 border border-primary/20 px-3 text-bronze-light"
          >
            <option value="native">مستقیم در سرویس پل (پیشنهادی)</option>
            <option value="sdk">کتابخانهٔ رسمی PosInterface.dll</option>
          </select>
        </label>
        <label className="space-y-1 text-sm text-bronze-light/70">
          <span>حداکثر زمان انتظار برای کارت (ثانیه)</span>
          <select
            value={timeoutSeconds}
            onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
            className="w-full h-11 rounded-xl bg-black/30 border border-primary/20 px-3 text-bronze-light"
          >
            {[60, 90, 120, 150, 180].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={saving || !loaded}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          <span className="mr-2">ذخیره و اعمال</span>
        </Button>
        {!loaded && <span className="text-xs text-bronze-light/50">سرویس پل در دسترس نیست</span>}
      </div>

      <p className="text-xs text-bronze-light/50 leading-6">
        در حالت «خودکار» و «اتصال برگشتی»، کارت‌خوان برای برگرداندن نتیجه به پورت 17000 همین رایانه
        وصل می‌شود؛ این پورت باید در فایروال ویندوز باز باشد (فایل
        pos-bridge\tools\allow-firewall.bat).
      </p>
    </div>
  );
}

/** دفتر تراکنش‌های سرویس پل و تراکنش‌های نیازمند بررسی */
export function PosTransactionsCard() {
  const [items, setItems] = useState<PosTransactionRecord[]>([]);
  const [needsReview, setNeedsReview] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await posTransactions(30);
    setLoading(false);
    setItems(r.items);
    setNeedsReview(r.needsReview);
    setMessage(r.ok ? "" : r.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (t: PosTransactionRecord) => {
    if (!t.transactionId) return;
    const note =
      window.prompt("یادداشت بررسی (مثلاً «وجه برگشت داده شد» یا «بلیط دستی صادر شد»):", "") ?? "";
    if (await posMarkReviewed(t.transactionId, note)) {
      toast.success("تراکنش بررسی‌شده علامت خورد");
      void load();
    } else toast.error("ثبت بررسی ناموفق بود");
  };

  return (
    <div className="glass rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-black text-bronze-light flex items-center gap-2">
          <ListChecks className="w-5 h-5 text-primary" />
          دفتر تراکنش‌های کارت‌خوان
          {needsReview > 0 && (
            <span className="text-xs font-bold px-3 py-1 rounded-full border border-amber-400/50 text-amber-200">
              {needsReview} مورد نیازمند بررسی
            </span>
          )}
        </p>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          <span className="mr-2">تازه‌سازی</span>
        </Button>
      </div>

      {message && <p className="text-sm text-rose-300/90">{message}</p>}

      {items.length === 0 && !message ? (
        <p className="text-sm text-bronze-light/50">هنوز تراکنشی ثبت نشده است.</p>
      ) : (
        <div className="space-y-2 max-h-[28rem] overflow-y-auto">
          {items.map((t) => (
            <div
              key={t.transactionId}
              className={`rounded-xl border p-3 text-sm space-y-1 ${
                t.needsReview && !t.reviewed
                  ? "border-amber-400/40 bg-amber-500/5"
                  : "border-white/10"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-full border ${statusTone(t)}`}
                >
                  {t.status ? STATUS_LABEL[t.status] : "—"}
                  {t.reviewed && " • بررسی شد"}
                </span>
                <span className="font-black text-bronze-light">
                  {t.amountRial != null ? formatToman(Math.round(t.amountRial / 10)) : "—"}
                </span>
                <span className="text-xs text-bronze-light/50" dir="ltr">
                  {t.createdAt ? new Date(t.createdAt).toLocaleString("fa-IR") : ""}
                </span>
              </div>
              <p className="text-xs text-bronze-light/70 leading-6">{t.message}</p>
              <div
                className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-bronze-light/60"
                dir="ltr"
              >
                {t.invoiceNumber && <span>{t.invoiceNumber}</span>}
                {t.refNumber && <span>RRN {t.refNumber}</span>}
                {t.maskedPan && <span>{t.maskedPan}</span>}
                <span>#{(t.transactionId ?? "").replace(/-/g, "").slice(0, 8).toUpperCase()}</span>
              </div>
              {t.note && <p className="text-xs text-bronze-light/50">{t.note}</p>}
              {t.needsReview && !t.reviewed && (
                <div className="flex items-center gap-3 pt-1">
                  <AlertTriangle className="w-4 h-4 text-amber-300" />
                  <span className="text-xs text-amber-200/90">
                    با رسید کارت‌خوان یا گزارش بانک تطبیق دهید
                  </span>
                  <Button size="sm" variant="outline" onClick={() => void review(t)}>
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="mr-1">بررسی شد</span>
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
