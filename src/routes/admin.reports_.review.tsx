import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Loader2, RefreshCw, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MAX_REVIEW_NOTE,
  fetchReviewTransactions,
  formatJalaliLong,
  formatTehranTime,
  isDay,
  markReviewed,
  rialToToman,
  tehranToday,
  type ReviewListResult,
  type ReviewTransaction,
} from "@/lib/daily-report";
import { formatNumber } from "@/lib/money";

// نام فایل با «_» یعنی زیرمسیر admin.reports نیست؛ آدرس همان /admin/reports/review می‌ماند
export const Route = createFileRoute("/admin/reports_/review")({
  validateSearch: (search: Record<string, unknown>): { day?: string } =>
    isDay(search.day) ? { day: search.day } : {},
  component: ReviewTransactionsPage,
});

const rowKey = (t: ReviewTransaction) => `${t.kiosk_id}:${t.transaction_id}`;

type State = { status: "loading" } | { status: "done"; result: ReviewListResult };

function ReviewTransactionsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const today = tehranToday();
  const day = search.day && search.day <= today ? search.day : today;
  const [state, setState] = useState<State>({ status: "loading" });
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    setState({ status: "done", result: await fetchReviewTransactions(day) });
  }, [day]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (t: ReviewTransaction) => {
    const key = rowKey(t);
    setSavingKey(key);
    const r = await markReviewed(t.kiosk_id, t.transaction_id, noteOpen === key ? note : "");
    setSavingKey(null);
    if (r.ok) {
      toast.success("بررسی شد ثبت شد");
      setNoteOpen(null);
      setNote("");
      await load();
    } else toast.error(r.message);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <Toaster position="top-center" richColors />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-black text-bronze-gradient ml-auto">
          تراکنش‌های نیازمند بررسی
        </h2>
        <Button
          variant="outline"
          className="rounded-xl gap-2"
          onClick={() => void navigate({ to: "/admin/reports", search: { day } })}
        >
          <ArrowRight className="w-4 h-4" /> بازگشت به گزارش
        </Button>
      </div>
      <p className="text-bronze-light/80 font-bold">{formatJalaliLong(day)}</p>
      <p className="text-xs text-bronze-light/60 leading-6">
        این‌ها پرداخت‌های کارتی‌اند که نتیجه‌شان قطعی نشده؛ ممکن است وجه از کارت مشتری کسر شده باشد
        بدون اینکه بلیط صادر شده باشد. هر مورد را با رسید دستگاه یا گزارش بانک تطبیق دهید و پس از
        بازگشت وجه یا صدور دستی بلیط «بررسی شد» بزنید. شمارهٔ کارت در این فهرست نیست.
      </p>

      {state.status === "loading" && (
        <div className="glass-bronze rounded-2xl h-32 animate-pulse" aria-busy="true" />
      )}

      {state.status === "done" && !state.result.ok && (
        <div
          role="alert"
          className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 space-y-3 max-w-xl"
        >
          <p className="font-bold text-red-100">{state.result.message}</p>
          <Button variant="secondary" className="rounded-xl gap-2" onClick={() => void load()}>
            <RefreshCw className="w-4 h-4" /> تلاش دوباره
          </Button>
        </div>
      )}

      {state.status === "done" && state.result.ok && state.result.rows.length === 0 && (
        <p className="rounded-xl border  p-4 text-bronze-light/80">
          در این روز تراکنش نیازمند بررسی ثبت نشده
        </p>
      )}

      {state.status === "done" && state.result.ok && state.result.rows.length > 0 && (
        <ul className="space-y-3">
          {state.result.rows.map((t) => {
            const key = rowKey(t);
            const pending = !t.reviewed;
            return (
              <li
                key={key}
                className={`glass-bronze rounded-2xl p-4 space-y-2 border ${
                  pending ? "border-amber-400/40" : "border-emerald-400/30"
                }`}
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-black text-white text-lg">
                    {formatNumber(rialToToman(t.amount_rial))} تومان
                  </span>
                  <span className="text-sm text-bronze-light/70">
                    ساعت {formatTehranTime(t.occurred_at)}
                  </span>
                  <span className="text-sm text-bronze-light/70">{t.kiosk_name}</span>
                  <span
                    className={`mr-auto text-xs font-bold px-3 py-1 rounded-full border ${
                      pending
                        ? "border-amber-400/50 text-amber-200"
                        : "border-emerald-400/40 text-emerald-300"
                    }`}
                  >
                    {pending ? "بررسی‌نشده" : "بررسی‌شده"}
                  </span>
                </div>
                <p className="text-sm text-bronze-light/90">{t.reason}</p>
                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-bronze-light/60">
                  {t.invoice_number && (
                    <div className="flex gap-1">
                      <dt>شمارهٔ فاکتور:</dt>
                      <dd dir="ltr">{t.invoice_number}</dd>
                    </div>
                  )}
                  {t.rrn && (
                    <div className="flex gap-1">
                      <dt>شمارهٔ مرجع:</dt>
                      <dd dir="ltr">{t.rrn}</dd>
                    </div>
                  )}
                </dl>

                {t.reviewed && (
                  <p className="text-sm text-emerald-200 flex flex-wrap items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    بررسی شد
                    {t.reviewed_at && <span>({formatTehranTime(t.reviewed_at)})</span>}
                    {t.reviewed_by && <span dir="ltr">— {t.reviewed_by}</span>}
                    {t.review_note && (
                      <span className="text-bronze-light/80">— {t.review_note}</span>
                    )}
                  </p>
                )}

                {pending && (
                  <div className="space-y-2 pt-1">
                    {noteOpen === key && (
                      <Input
                        value={note}
                        maxLength={MAX_REVIEW_NOTE}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="یادداشت (اختیاری)، مثلاً با رسید بانک تطبیق شد"
                        className="bg-black/30 border-primary/20 rounded-xl h-11"
                      />
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        className="rounded-xl h-11 gap-2"
                        disabled={savingKey !== null}
                        onClick={() => void review(t)}
                      >
                        {savingKey === key ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4" />
                        )}
                        بررسی شد
                      </Button>
                      {noteOpen !== key && (
                        <Button
                          variant="ghost"
                          className="rounded-xl h-11 gap-2"
                          onClick={() => {
                            setNoteOpen(key);
                            setNote("");
                          }}
                        >
                          <StickyNote className="w-4 h-4" /> افزودن یادداشت
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-bronze-light/50">
        <Link to="/admin/reports" search={{ day }} className="underline">
          گزارش فروش این روز
        </Link>
      </p>
    </div>
  );
}
