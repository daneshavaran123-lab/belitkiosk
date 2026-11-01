import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CreditCard, Banknote, Wallet, RefreshCw, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { JalaliDayPicker } from "@/components/JalaliDayPicker";
import {
  addDays,
  fetchDailyReport,
  formatJalaliLong,
  formatTehranTime,
  isDay,
  rialToToman,
  tehranToday,
  type DailyReport,
  type FetchReportResult,
  type TicketTypeCount,
} from "@/lib/daily-report";
import { formatNumber } from "@/lib/money";

export const Route = createFileRoute("/admin/reports")({
  validateSearch: (search: Record<string, unknown>): { day?: string } =>
    isDay(search.day) ? { day: search.day } : {},
  component: DailyReportPage,
});

const CATEGORY_LABEL: Record<string, string> = {
  normal: "بلیط عادی",
  guided: "بلیط با راهنما",
  vip: "بلیط VIP",
};

const toman = (n: number) => `${formatNumber(n)} تومان`;

function ticketTypeLabel(t: TicketTypeCount): string {
  if (t.name) return t.name;
  return `نوع حذف‌شده #${formatNumber(t.ticket_type_id)}`;
}

type State = { status: "loading" } | { status: "done"; result: FetchReportResult };

function DailyReportPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const today = tehranToday();
  const day = search.day && search.day <= today ? search.day : today;
  const [state, setState] = useState<State>({ status: "loading" });
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    setState({ status: "done", result: await fetchDailyReport(day) });
  }, [day]);

  useEffect(() => {
    void load();
  }, [load]);

  const goTo = (next: string) => {
    setPickerOpen(false);
    void navigate({ to: "/admin/reports", search: { day: next } });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-black text-bronze-gradient ml-auto">گزارش فروش روزانه</h2>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="secondary" className="rounded-xl font-bold gap-2 h-11">
              <CalendarDays className="w-4 h-4" />
              {formatJalaliLong(day)}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <JalaliDayPicker value={day} max={today} onChange={goTo} />
          </PopoverContent>
        </Popover>
        <Button
          variant="outline"
          className="rounded-xl h-11"
          disabled={day === addDays(today, -1)}
          onClick={() => goTo(addDays(today, -1))}
        >
          دیروز
        </Button>
        <Button
          variant="outline"
          className="rounded-xl h-11"
          disabled={day === today}
          onClick={() => goTo(today)}
        >
          امروز
        </Button>
      </div>

      {state.status === "loading" && <ReportSkeleton />}
      {state.status === "done" && !state.result.ok && (
        <ReportFailure message={state.result.message} onRetry={load} />
      )}
      {state.status === "done" && state.result.ok && (
        <ReportBody report={state.result.report} onRefresh={load} />
      )}
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="glass-bronze rounded-2xl h-32 animate-pulse" />
      ))}
    </div>
  );
}

function ReportFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 space-y-3 max-w-xl"
    >
      <p className="font-bold text-red-100">{message}</p>
      <Button variant="secondary" className="rounded-xl gap-2" onClick={onRetry}>
        <RefreshCw className="w-4 h-4" /> تلاش دوباره
      </Button>
    </div>
  );
}

function ReportBody({ report, onRefresh }: { report: DailyReport; onRefresh: () => void }) {
  const empty = report.sales.invoice_count === 0;
  const cards = [
    {
      label: "فروش کارتی",
      value: toman(report.sales.card.total),
      sub: `${formatNumber(report.sales.card.count)} فاکتور`,
      icon: CreditCard,
      tint: "#60a5fa",
    },
    {
      label: "فروش نقدی",
      value: toman(report.sales.cash.total),
      sub: `${formatNumber(report.sales.cash.count)} فاکتور`,
      icon: Banknote,
      tint: "#34d399",
    },
    {
      label: "جمع کل",
      value: toman(report.sales.total),
      sub: `${formatNumber(report.sales.invoice_count)} فاکتور`,
      icon: Wallet,
      tint: "#f59e0b",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-sm text-bronze-light/80">
        <span className="font-bold text-bronze-light">
          گزارش فروش — {formatJalaliLong(report.day)}
        </span>
        {report.is_today && (
          <>
            <span>تا ساعت {formatTehranTime(report.generated_at)}</span>
            <Button variant="ghost" size="sm" className="gap-1 rounded-lg" onClick={onRefresh}>
              <RefreshCw className="w-3.5 h-3.5" /> به‌روزرسانی
            </Button>
          </>
        )}
      </div>

      {empty && (
        <p className="rounded-xl border border-primary/20 bg-black/30 p-4 text-bronze-light/80">
          در این روز فروشی ثبت نشده
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="glass-bronze rounded-2xl p-5 space-y-2">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: `${c.tint}22`, border: `1px solid ${c.tint}55` }}
              >
                <Icon className="w-5 h-5" style={{ color: c.tint }} />
              </div>
              <p className="text-sm font-bold text-bronze-light/70">{c.label}</p>
              <p className="text-2xl font-black text-white">{c.value}</p>
              <p className="text-xs text-bronze-light/60">{c.sub}</p>
            </div>
          );
        })}
      </div>

      <TicketsSection report={report} />
      <ReviewSection report={report} />
    </div>
  );
}

function TicketsSection({ report }: { report: DailyReport }) {
  const { tickets } = report;
  return (
    <section className="glass-bronze rounded-2xl p-5 space-y-3">
      <h3 className="flex items-center gap-2 font-black text-bronze-gradient">
        <Ticket className="w-5 h-5" /> بلیط‌های فروخته‌شده
      </h3>
      <p className="text-3xl font-black text-white">{formatNumber(tickets.total)}</p>
      {(tickets.by_type.length > 0 || tickets.untyped_lines_quantity > 0) && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-bronze-light/60 text-right">
              <th className="py-2 font-bold">نوع</th>
              <th className="py-2 font-bold w-28">تعداد</th>
            </tr>
          </thead>
          <tbody>
            {tickets.by_type.map((t) => (
              <tr key={t.ticket_type_id} className="border-t border-primary/10">
                <td className="py-2">
                  {ticketTypeLabel(t)}
                  {t.category && t.name && (
                    <span className="text-xs text-bronze-light/50 mr-2">
                      {CATEGORY_LABEL[t.category]}
                    </span>
                  )}
                </td>
                <td className="py-2 font-bold">{formatNumber(t.quantity)}</td>
              </tr>
            ))}
            {tickets.untyped_lines_quantity > 0 && (
              <tr className="border-t border-primary/10 text-bronze-light/70">
                <td className="py-2">نامشخص (فروش‌های قدیمی)</td>
                <td className="py-2 font-bold">{formatNumber(tickets.untyped_lines_quantity)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ReviewSection({ report }: { report: DailyReport }) {
  const { review } = report;
  if (review === null) {
    return (
      <section className="glass-bronze rounded-2xl p-5 space-y-2">
        <h3 className="font-black text-bronze-gradient">تراکنش‌های نیازمند بررسی</h3>
        <p className="text-bronze-light/80">در دسترس نیست — کیوسک هنوز به گزارش وصل نشده</p>
      </section>
    );
  }
  const cells = [
    {
      label: "بررسی‌نشده",
      count: review.pending.count,
      amount: review.pending.amount_rial,
      tone: review.pending.count > 0 ? "text-amber-200" : "text-white",
    },
    {
      label: "بررسی‌شده",
      count: review.reviewed.count,
      amount: review.reviewed.amount_rial,
      tone: "text-emerald-200",
    },
  ];
  return (
    <section className="glass-bronze rounded-2xl p-5 space-y-3">
      <h3 className="font-black text-bronze-gradient">تراکنش‌های نیازمند بررسی</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cells.map((c) => (
          <div key={c.label} className="rounded-xl bg-black/30 p-4 space-y-1">
            <p className="text-sm font-bold text-bronze-light/70">{c.label}</p>
            <p className={`text-3xl font-black ${c.tone}`}>{formatNumber(c.count)}</p>
            <p className="text-sm text-bronze-light/70">{toman(rialToToman(c.amount))}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-bronze-light/60 leading-6">
        مبلغ تراکنش‌های نیازمند بررسی در جمع فروش نیامده؛ پس از بررسی (بازگشت وجه یا صدور دستی بلیط)
        «بررسی شد» بزنید.{" "}
        {review.last_sync_at ? (
          <>آخرین ارسال از کیوسک: {formatTehranTime(review.last_sync_at)}</>
        ) : (
          <>آخرین ارسال از کیوسک: هنوز ارسال نشده</>
        )}
      </p>
      <Link
        to="/admin/reports/review"
        search={{ day: report.day }}
        className="inline-flex items-center h-11 px-4 rounded-xl font-bold border border-primary/30 text-bronze-light hover:bg-white/5"
      >
        مشاهدهٔ فهرست
      </Link>
    </section>
  );
}
