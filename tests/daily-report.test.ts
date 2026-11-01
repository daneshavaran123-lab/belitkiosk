import { describe, expect, it } from "vitest";
import {
  addDays,
  dayToLocalDate,
  fetchDailyReport,
  formatJalaliLong,
  formatTehranTime,
  isDay,
  isFutureDay,
  localDateToDay,
  parseDailyReport,
  rialToToman,
  tehranToday,
  type RpcClient,
} from "@/lib/daily-report";

describe("روز به وقت تهران", () => {
  it("مرز نیمه‌شب تهران (UTC+3:30) را درست تشخیص می‌دهد", () => {
    expect(tehranToday(new Date("2026-10-30T20:29:00Z"))).toBe("2026-10-30");
    expect(tehranToday(new Date("2026-10-30T20:31:00Z"))).toBe("2026-10-31");
  });

  it("روز آینده را تشخیص می‌دهد", () => {
    const now = new Date("2026-10-30T10:00:00Z");
    expect(isFutureDay("2026-10-30", now)).toBe(false);
    expect(isFutureDay("2026-10-29", now)).toBe(false);
    expect(isFutureDay("2026-10-31", now)).toBe(true);
  });

  it("جمع و تفریق روز از مرز ماه و سال رد می‌شود", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("فقط روزهای واقعی YYYY-MM-DD معتبرند", () => {
    expect(isDay("2026-10-30")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-10-30T00:00")).toBe(false);
    expect(isDay(undefined)).toBe(false);
  });
});

describe("قالب‌بندی", () => {
  it("تاریخ شمسی کامل", () => {
    const text = formatJalaliLong("2026-10-30");
    expect(text).toContain("۱۴۰۵");
    expect(text).toContain("آبان");
    expect(text).toContain("۸");
    expect(text.startsWith("جمعه")).toBe(true);
  });

  it("ساعت تهران با ارقام فارسی", () => {
    expect(formatTehranTime("2026-10-30T15:12:00Z")).toBe("۱۸:۴۲");
  });

  it("ریال به تومان", () => {
    expect(rialToToman(15000)).toBe(1500);
    expect(rialToToman(1500000)).toBe(150000);
  });
});

describe("تبدیل روز و تاریخ تقویم", () => {
  it("رفت‌وبرگشت بدون جابه‌جایی روز", () => {
    for (const day of ["2026-10-30", "2026-03-21", "2027-01-01"]) {
      expect(localDateToDay(dayToLocalDate(day))).toBe(day);
    }
  });
});

const sample = {
  day: "2026-10-30",
  generated_at: "2026-10-30T15:12:00Z",
  is_today: true,
  sales: {
    card: { total: 600000, count: 3 },
    cash: { total: 100000, count: 2 },
    total: 700000,
    invoice_count: 5,
  },
  tickets: {
    total: 12,
    by_type: [
      { ticket_type_id: 1, name: "بلیط عادی", category: "normal", quantity: 2 },
      { ticket_type_id: 9, name: null, category: null, quantity: 10 },
    ],
    untyped_lines_quantity: 3,
  },
  review: null,
};

const client = (
  result: { data?: unknown; error?: { code?: string; message: string } | null } | Error,
): RpcClient => ({
  rpc: async () => {
    if (result instanceof Error) throw result;
    return { data: result.data ?? null, error: result.error ?? null };
  },
});

describe("fetchDailyReport", () => {
  it("پاسخ موفق به گزارش نگاشت می‌شود (از جمله نوع حذف‌شده و review تهی)", async () => {
    const r = await fetchDailyReport("2026-10-30", client({ data: sample }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.sales.total).toBe(700000);
    expect(r.report.tickets.by_type[1]).toMatchObject({ name: null, quantity: 10 });
    expect(r.report.review).toBeNull();
  });

  it("بخش بررسی پر هم نگاشت می‌شود", async () => {
    const review = {
      pending: { count: 2, amount_rial: 1500000 },
      reviewed: { count: 1, amount_rial: 500000 },
      last_sync_at: "2026-10-30T15:00:00Z",
    };
    const r = await fetchDailyReport("2026-10-30", client({ data: { ...sample, review } }));
    expect(r.ok && r.report.review?.pending.count).toBe(2);
  });

  it.each([
    [
      { code: "PGRST202", message: "Could not find the function public.daily_sales_report" },
      "not-enabled",
    ],
    [{ code: "22023", message: "روز آینده قابل گزارش نیست" }, "future"],
    [{ code: "42501", message: "permission denied for table invoices" }, "no-access"],
    [{ code: "", message: "TypeError: Failed to fetch" }, "network"],
    [{ code: "XX000", message: "internal" }, "error"],
  ])("خطای %j → %s", async (error, kind) => {
    const r = await fetchDailyReport("2026-10-30", client({ error }));
    expect(r).toMatchObject({ ok: false, kind });
  });

  it("استثنای شبکه → network و پاسخ ناقص → error؛ هیچ‌کدام عدد صفر برنمی‌گردانند", async () => {
    expect(await fetchDailyReport("2026-10-30", client(new Error("boom")))).toMatchObject({
      ok: false,
      kind: "network",
    });
    for (const bad of [null, {}, { ...sample, sales: { ...sample.sales, total: "700" } }]) {
      const r = await fetchDailyReport("2026-10-30", client({ data: bad }));
      expect(r).toMatchObject({ ok: false, kind: "error" });
      expect("report" in r).toBe(false);
    }
  });

  it("parseDailyReport ردیف نوع بلیط ناقص را رد می‌کند", () => {
    const broken = { ...sample, tickets: { ...sample.tickets, by_type: [{ quantity: 1 }] } };
    expect(parseDailyReport(broken)).toBeNull();
  });
});
