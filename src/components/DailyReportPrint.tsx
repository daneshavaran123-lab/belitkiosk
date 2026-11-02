import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  formatJalaliLong,
  formatTehranDateTime,
  formatTehranTime,
  rialToToman,
  type DailyReport,
  type TicketTypeCount,
} from "@/lib/daily-report";
import { formatNumber } from "@/lib/money";

interface Props {
  report: DailyReport;
  /** لحظهٔ چاپ (ISO)؛ هنگام چاپ تازه می‌شود */
  printedAt: string;
  /** ایمیل چاپ‌کننده یا «حالت بدون رمز» */
  printedBy: string;
}

const TOMAN = "تومان";
const toman = (n: number) => `${formatNumber(n)} ${TOMAN}`;

const CATEGORY_LABEL: Record<string, string> = {
  normal: "بلیط عادی",
  guided: "بلیط با راهنما",
  vip: "بلیط VIP",
};

function ticketLabel(t: TicketTypeCount): string {
  return t.name ?? `نوع حذف‌شده #${formatNumber(t.ticket_type_id)}`;
}

const TH = "border border-black px-2 py-0.5 text-right font-bold";
const TD = "border border-black px-2 py-0.5";
const H3 = "font-black text-[12.5px] mt-3 mb-1";

/**
 * نسخهٔ چاپی گزارش روزانه روی A4 عمودی؛ همان عددهای صفحه، سربرگ موزه و جای امضا.
 *
 * مستقیماً زیر <body> رندر می‌شود (portal) و روی صفحه پنهان است؛ هنگام چاپ، قواعد @media print در
 * styles.css بقیهٔ برنامه را پنهان می‌کنند تا چیدمان پنل (ارتفاع ثابت، overflow پنهان) چیزی را
 * نبُرد و صفحه‌بندی درست کار کند.
 */
export function DailyReportPrint({ report, printedAt, printedBy }: Props) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = document.createElement("div");
    el.id = "daily-report-print-root";
    document.body.appendChild(el);
    setContainer(el);
    return () => {
      el.remove();
      setContainer(null);
    };
  }, []);

  if (!container) return null;

  const { sales, tickets, review } = report;
  return createPortal(
    <section
      id="daily-report-print"
      dir="rtl"
      className="bg-white text-black text-[11px] leading-snug"
    >
      <header className="text-center border-b-2 border-black pb-2 mb-2">
        <h1 className="text-[18px] font-black">موزهٔ افتخارات کشتی ایران</h1>
        <h2 className="text-[14px] font-bold">گزارش فروش روزانه</h2>
        <p className="font-black mt-1">{formatJalaliLong(report.day)}</p>
        {report.is_today && (
          <p className="text-[11px]">آمار تا ساعت {formatTehranTime(report.generated_at)}</p>
        )}
        <p className="text-[11px]">
          چاپ: {formatTehranDateTime(printedAt)} — چاپ‌کننده: <bdi dir="ltr">{printedBy}</bdi>
        </p>
      </header>

      <h3 className={H3}>فروش</h3>
      <table className="w-full border-collapse break-inside-avoid">
        <thead>
          <tr>
            <th className={TH}>روش پرداخت</th>
            <th className={`${TH} w-28`}>تعداد فاکتور</th>
            <th className={`${TH} w-44`}>مبلغ</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={TD}>کارتی</td>
            <td className={TD}>{formatNumber(sales.card.count)}</td>
            <td className={TD}>{toman(sales.card.total)}</td>
          </tr>
          <tr>
            <td className={TD}>نقدی</td>
            <td className={TD}>{formatNumber(sales.cash.count)}</td>
            <td className={TD}>{toman(sales.cash.total)}</td>
          </tr>
          <tr className="font-black">
            <td className={TD}>جمع کل</td>
            <td className={TD}>{formatNumber(sales.invoice_count)}</td>
            <td className={TD}>{toman(sales.total)}</td>
          </tr>
        </tbody>
      </table>
      {sales.invoice_count === 0 && <p className="mt-1">در این روز فروشی ثبت نشده</p>}

      <h3 className={H3}>بلیط‌های فروخته‌شده</h3>
      {/* فهرست بلند می‌تواند به صفحهٔ بعد برود؛ ردیف‌ها نمی‌شکنند و سرستون تکرار می‌شود */}
      <table className="w-full border-collapse [&_tr]:break-inside-avoid">
        <thead>
          <tr>
            <th className={TH}>نوع بلیط</th>
            <th className={`${TH} w-28`}>تعداد</th>
          </tr>
        </thead>
        <tbody>
          {tickets.by_type.map((t) => (
            <tr key={t.ticket_type_id}>
              <td className={TD}>
                {ticketLabel(t)}
                {t.category && t.name ? ` (${CATEGORY_LABEL[t.category]})` : ""}
              </td>
              <td className={TD}>{formatNumber(t.quantity)}</td>
            </tr>
          ))}
          {tickets.untyped_lines_quantity > 0 && (
            <tr>
              <td className={TD}>نامشخص (فروش‌های قدیمی)</td>
              <td className={TD}>{formatNumber(tickets.untyped_lines_quantity)}</td>
            </tr>
          )}
          <tr className="font-black">
            <td className={TD}>جمع بلیط‌ها</td>
            <td className={TD}>{formatNumber(tickets.total)}</td>
          </tr>
        </tbody>
      </table>

      <h3 className={H3}>تراکنش‌های نیازمند بررسی</h3>
      {review === null ? (
        <p>در دسترس نیست — کیوسک هنوز به گزارش وصل نشده</p>
      ) : (
        <>
          <table className="w-full border-collapse break-inside-avoid">
            <thead>
              <tr>
                <th className={TH}>وضعیت</th>
                <th className={`${TH} w-28`}>تعداد</th>
                <th className={`${TH} w-44`}>مبلغ</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={TD}>بررسی‌نشده</td>
                <td className={TD}>{formatNumber(review.pending.count)}</td>
                <td className={TD}>{toman(rialToToman(review.pending.amount_rial))}</td>
              </tr>
              <tr>
                <td className={TD}>بررسی‌شده</td>
                <td className={TD}>{formatNumber(review.reviewed.count)}</td>
                <td className={TD}>{toman(rialToToman(review.reviewed.amount_rial))}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-[11px] mt-1">
            مبلغ این تراکنش‌ها در جمع فروش نیامده.{" "}
            {review.last_sync_at
              ? `آخرین ارسال از کیوسک: ${formatTehranTime(review.last_sync_at)}`
              : "آخرین ارسال از کیوسک: هنوز ارسال نشده"}
          </p>
        </>
      )}

      <div className="grid grid-cols-2 gap-6 mt-6 break-inside-avoid">
        {["تحویل‌دهنده", "تحویل‌گیرنده"].map((who) => (
          <div key={who} className="border border-black h-20 p-2">
            <p className="font-bold">{who}</p>
            <p className="text-[11px] mt-1">نام و امضا:</p>
          </div>
        ))}
      </div>
    </section>,
    container,
  );
}
