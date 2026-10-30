import { describe, expect, it } from "vitest";
import {
  addDays,
  formatJalaliLong,
  formatTehranTime,
  isDay,
  isFutureDay,
  rialToToman,
  tehranToday,
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
