import { describe, expect, it } from "vitest";
import {
  addDays,
  dayToLocalDate,
  fetchDailyReport,
  fetchReviewTransactions,
  formatJalaliLong,
  formatTehranTime,
  isDay,
  isFutureDay,
  localDateToDay,
  markReviewed,
  pairKiosk,
  parseDailyReport,
  rialToToman,
  tehranToday,
  type PairDeps,
  type RpcClient,
} from "@/lib/daily-report";
import type { PosSyncStatus } from "@/lib/pos";

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

/* ---------------- جفت کردن کیوسک ---------------- */

const status: PosSyncStatus = {
  enabled: true,
  paired: true,
  kioskId: "k-1",
  lastSyncedAt: "",
  lastAttemptAt: "",
  lastError: "",
  pendingCount: 0,
  clockOffsetSeconds: 0,
};

function pairDeps(overrides: Partial<PairDeps> = {}): {
  deps: PairDeps;
  calls: string[];
  args: unknown[][];
} {
  const calls: string[] = [];
  const args: unknown[][] = [];
  const deps: PairDeps = {
    pair: async () => {
      calls.push("pair");
      return { ok: true, data: { kioskId: "k-1", keyHash: "a".repeat(64) } };
    },
    register: async (...a) => {
      calls.push("register");
      args.push(a);
      return null;
    },
    activate: async () => {
      calls.push("activate");
      return { ok: true, data: { synced: true, status } };
    },
    ...overrides,
  };
  return { deps, calls, args };
}

describe("pairKiosk", () => {
  it("به ترتیب جفت، ثبت در سرور و فعال‌سازی را انجام می‌دهد و فقط هش را می‌فرستد", async () => {
    const { deps, calls, args } = pairDeps();
    const r = await pairKiosk("  کیوسک ورودی  ", deps);
    expect(r).toMatchObject({ ok: true, synced: true });
    expect(calls).toEqual(["pair", "register", "activate"]);
    expect(args[0]).toEqual(["k-1", "کیوسک ورودی", "a".repeat(64)]);
  });

  it("نام خالی نام پیش‌فرض می‌گیرد و نام بلند به ۸۰ کاراکتر بریده می‌شود", async () => {
    const empty = pairDeps();
    await pairKiosk("   ", empty.deps);
    expect(empty.args[0][1]).toBe("کیوسک ۱");
    const long = pairDeps();
    await pairKiosk("ک".repeat(200), long.deps);
    expect((long.args[0][1] as string).length).toBe(80);
  });

  it("اگر ثبت در سرور خطا بدهد، فعال‌سازی اجرا نمی‌شود", async () => {
    const { deps, calls } = pairDeps({ register: async () => ({ message: "permission denied" }) });
    const r = await pairKiosk("x", deps);
    expect(r).toMatchObject({ ok: false, step: "register" });
    expect(r.ok === false && r.message).toContain("permission denied");
    expect(calls).not.toContain("activate");
  });

  it("اگر سرویس کارت‌خوان در دسترس نباشد، به سرور چیزی ثبت نمی‌شود", async () => {
    const { deps, calls } = pairDeps({
      pair: async () => ({ ok: false, message: "سرویس کارت‌خوان در دسترس نیست" }),
    });
    const r = await pairKiosk("x", deps);
    expect(r).toMatchObject({ ok: false, step: "pair" });
    expect(calls).toEqual([]);
  });

  it("خطای فعال‌سازی با پیام خود سرویس برمی‌گردد", async () => {
    const { deps } = pairDeps({
      activate: async () => ({ ok: false, message: "ابتدا کیوسک را جفت کنید" }),
    });
    const r = await pairKiosk("x", deps);
    expect(r).toMatchObject({ ok: false, step: "activate", message: "ابتدا کیوسک را جفت کنید" });
  });

  it("اگر اولین همگام‌سازی ناموفق بود، synced=false و وضعیت برمی‌گردد", async () => {
    const bad: PosSyncStatus = { ...status, lastError: "HTTP 403: invalid kiosk key" };
    const { deps } = pairDeps({
      activate: async () => ({ ok: true, data: { synced: false, status: bad } }),
    });
    const r = await pairKiosk("x", deps);
    expect(r).toMatchObject({ ok: true, synced: false });
    expect(r.ok && r.status.lastError).toContain("403");
  });
});

/* ---------------- فهرست تراکنش‌های نیازمند بررسی ---------------- */

describe("تراکنش‌های نیازمند بررسی", () => {
  const rows = [
    {
      kiosk_id: "k-1",
      kiosk_name: "کیوسک ۱",
      transaction_id: "t-1",
      occurred_at: "2026-10-30T09:12:00Z",
      amount_rial: 1500000,
      status: "uncertain",
      reason: "نامطمئن",
      invoice_number: "INV-1",
      rrn: null,
      needs_review: true,
      reviewed: false,
      review_note: null,
      reviewed_at: null,
      reviewed_by: null,
    },
  ];

  it("فهرست یک روز را با پارامتر روز می‌گیرد", async () => {
    let seen: { fn: string; args: Record<string, unknown> } | null = null;
    const client: RpcClient = {
      rpc: async (fn, args) => {
        seen = { fn, args };
        return { data: rows, error: null };
      },
    };
    const r = await fetchReviewTransactions("2026-10-30", client);
    expect(r).toMatchObject({ ok: true });
    expect(seen).toEqual({ fn: "review_transactions_for_day", args: { p_day: "2026-10-30" } });
  });

  it("خطاها دلیل دارند و هیچ‌وقت فهرست خالی جایشان نمی‌نشیند", async () => {
    const mk = (code: string): RpcClient => ({
      rpc: async () => ({ data: null, error: { code, message: "x" } }),
    });
    expect(await fetchReviewTransactions("2026-10-30", mk("PGRST202"))).toMatchObject({
      ok: false,
      kind: "not-enabled",
    });
    expect(await fetchReviewTransactions("2026-10-30", mk("42501"))).toMatchObject({
      ok: false,
      kind: "no-access",
    });
    expect(await fetchReviewTransactions("2026-10-30", mk(""))).toMatchObject({
      ok: false,
      kind: "network",
    });
    const notArray: RpcClient = { rpc: async () => ({ data: { x: 1 }, error: null }) };
    expect(await fetchReviewTransactions("2026-10-30", notArray)).toMatchObject({
      ok: false,
      kind: "error",
    });
  });

  it("«بررسی شد» یادداشت اختیاری را تا ۵۰۰ کاراکتر می‌فرستد", async () => {
    const seen: Record<string, unknown>[] = [];
    const client: RpcClient = {
      rpc: async (_fn, args) => {
        seen.push(args);
        return { data: null, error: null };
      },
    };
    expect(await markReviewed("k-1", "t-1", "", client)).toEqual({ ok: true });
    expect(await markReviewed("k-1", "t-1", " ".concat("ی".repeat(900)), client)).toEqual({
      ok: true,
    });
    expect(seen[0]).toEqual({ p_kiosk_id: "k-1", p_transaction_id: "t-1", p_note: "" });
    expect((seen[1].p_note as string).length).toBe(500);
  });

  it("خطای «بررسی شد» پیام فارسی برمی‌گرداند", async () => {
    const client: RpcClient = {
      rpc: async () => ({ data: null, error: { code: "42501", message: "denied" } }),
    };
    expect(await markReviewed("k-1", "t-1", "", client)).toEqual({
      ok: false,
      message: "دسترسی ندارید",
    });
  });
});
