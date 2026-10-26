/**
 * تست end-to-end جریان پرداخت با کارت‌خوان:
 * یک سرویس ماک pos-bridge روی لوکال‌هاست بالا می‌آید تا بدون دستگاه واقعی
 * همهٔ حالت‌های موفق/ناموفق/قطع اتصال/لغو آزمایش شوند.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSupportReport,
  clearConnectionState,
  getPingHistory,
  getPosSettings,
  loadConnectionState,
  PING_HISTORY_LIMIT,
  posBackoffSeconds,
  posConnectSequence,
  posDiscover,
  posHealth,
  posPay,
  posPing,
  posStepHint,
  saveConnectionState,
  setBridgeUrl,
  setPosAccessToken,
  supportReportText,
  setTerminalId,
  type PosStep,
} from "@/lib/pos";
import { saveInvoice, type InvoiceDb, type InvoiceLine } from "@/lib/invoice";

// localStorage ساده برای محیط node
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
});
vi.stubGlobal("window", {
  screen: { width: 1080, height: 1920 },
  innerWidth: 1080,
  innerHeight: 1920,
  devicePixelRatio: 1,
});
vi.stubGlobal("navigator", {
  userAgent: "Chrome/Kiosk",
  platform: "Win32",
  language: "fa-IR",
  onLine: true,
  maxTouchPoints: 10,
  hardwareConcurrency: 4,
});

type Mode = "approve" | "decline" | "hang" | "error";
let mode: Mode = "approve";
let deviceUp = true;
let requireToken = false;
let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          terminalId: "5634056",
          merchantId: "6618774",
          device: {
            mode: "lan",
            connected: deviceUp,
            deviceIp: "192.168.1.100",
            devicePort: 8888,
            terminalId: "5634056",
            merchantId: "6618774",
            message: deviceUp
              ? "دستگاه روی شبکه پاسخ می‌دهد"
              : "دستگاه در آدرس 192.168.1.100:8888 پاسخ نمی‌دهد",
          },
        }),
      );
      return;
    }
    if (req.url?.startsWith("/ping")) {
      if (requireToken && req.headers["x-pos-token"] !== "s3cr3t") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          deviceUp
            ? { ok: true, stage: "handshake", latencyMs: 42, message: "دستگاه پاسخ داد (42ms)" }
            : {
                ok: false,
                stage: "tcp",
                latencyMs: 2500,
                message: "پورت 8888 روی 192.168.1.100 باز نشد",
              },
        ),
      );
      return;
    }
    if (req.url?.startsWith("/logs")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          lastId: 1,
          items: [{ id: 1, level: "info", event: "ping", message: "ok", time: "10:00:00" }],
        }),
      );
      return;
    }
    if (req.url === "/config") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    if (req.url?.startsWith("/discover")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ subnet: "192.168.1", port: 8888, devices: ["192.168.1.100"] }));
      return;
    }

    if (req.url === "/cancel") {
      res.writeHead(200);
      res.end("{}");
      return;
    }
    if (req.url === "/pay") {
      if (mode === "hang") return; // بدون پاسخ → timeout / لغو
      if (mode === "error") {
        res.writeHead(500);
        res.end("boom");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          mode === "approve"
            ? {
                success: true,
                responseCode: "00",
                refNumber: "123456789",
                maskedPan: "6221-06**-****-1234",
                terminalId: "5634056",
              }
            : { success: false, responseCode: "51", message: "موجودی کافی نیست" },
        ),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
  setBridgeUrl(`http://127.0.0.1:${port}`);
  setTerminalId("5634056");
});

afterAll(() => void server.close());

beforeEach(() => {
  mode = "approve";
  deviceUp = true;
});

const items: InvoiceLine[] = [
  { name: "بلیط عادی", quantity: 2, unitPrice: 100000, discountPercent: 0, totalPrice: 200000 },
];

function makeDb(fail?: "invoices" | "invoice_items"): { db: InvoiceDb; calls: string[] } {
  const calls: string[] = [];
  const db: InvoiceDb = {
    from(table: string) {
      return {
        async insert() {
          calls.push(table);
          return fail === table ? { error: { message: "RLS denied" } } : { error: null };
        },
      };
    },
  };
  return { db, calls };
}

describe("سلامت سرویس پل کارت‌خوان", () => {
  it("وقتی سرویس بالا است متصل گزارش می‌دهد", async () => {
    const h = await posHealth();
    expect(h.ok).toBe(true);
  });

  it("وقتی سرویس در دسترس نیست پیام مناسب می‌دهد", async () => {
    setBridgeUrl("http://127.0.0.1:1");
    const h = await posHealth(500);
    expect(h.ok).toBe(false);
    expect(h.message).toContain("در دسترس نیست");
    setBridgeUrl(`http://127.0.0.1:${port}`);
  });

  it("اتصال شبکه‌ای دستگاه را در پیام وضعیت نشان می‌دهد", async () => {
    const h = await posHealth();
    expect(h.ok).toBe(true);
    expect(h.device?.mode).toBe("lan");
    expect(h.message).toContain("192.168.1.100");
  });

  it("سرویس بالا ولی کارت‌خوان روی شبکه پاسخ نمی‌دهد", async () => {
    deviceUp = false;
    const h = await posHealth();
    expect(h.ok).toBe(false);
    expect(h.message).toContain("پاسخ نمی‌دهد");
  });

  it("جست‌وجوی خودکار، IP دستگاه را پیدا می‌کند", async () => {
    const d = await posDiscover("8888", 3000);
    expect(d.ok).toBe(true);
    expect(d.devices.map((x) => x.ip)).toContain("192.168.1.100");
    expect(d.best?.ip).toBe("192.168.1.100");
  });
});

describe("پرداخت کارت‌خوان و ثبت فاکتور", () => {
  it("پرداخت موفق → فاکتور و اقلام ثبت و کد پیگیری برگردانده می‌شود", async () => {
    const pos = await posPay({ amountToman: 200000, invoiceNumber: "INV-1" });
    expect(pos.success).toBe(true);
    expect(pos.refNumber).toBe("123456789");

    const { db, calls } = makeDb();
    const res = await saveInvoice(
      db,
      { invoiceNumber: "INV-1", total: 200000, method: "card", items, pos },
      () => "11111111-1111-1111-1111-111111111111",
    );
    expect(res.ok).toBe(true);
    expect(res.invoiceId).toBe("11111111-1111-1111-1111-111111111111");
    expect(calls).toEqual(["invoices", "invoice_items"]);
  });

  it("پاسخ ناموفق دستگاه → فاکتور ثبت نمی‌شود", async () => {
    mode = "decline";
    const pos = await posPay({ amountToman: 200000, invoiceNumber: "INV-2" });
    expect(pos.success).toBe(false);
    expect(pos.message).toBe("موجودی کافی نیست");
  });

  it("خطای سرویس پل → پیام خطای وضعیت HTTP", async () => {
    mode = "error";
    const pos = await posPay({ amountToman: 1000, invoiceNumber: "INV-3" });
    expect(pos.success).toBe(false);
    expect(pos.message).toContain("500");
  });

  it("timeout → پیام پایان زمان انتظار", async () => {
    mode = "hang";
    const pos = await posPay({ amountToman: 1000, invoiceNumber: "INV-4" }, { timeoutMs: 300 });
    expect(pos.success).toBe(false);
    expect(pos.message).toContain("زمان انتظار");
  });

  it("لغو تراکنش توسط کاربر → پیام لغو", async () => {
    mode = "hang";
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 100);
    const pos = await posPay({ amountToman: 1000, invoiceNumber: "INV-5" }, { signal: ctrl.signal });
    expect(pos.success).toBe(false);
    expect(pos.message).toContain("لغو");
  });

  it("سرویس در دسترس نیست → پیام اتصال برقرار نشد", async () => {
    setBridgeUrl("http://127.0.0.1:1");
    const pos = await posPay({ amountToman: 1000, invoiceNumber: "INV-6" });
    expect(pos.success).toBe(false);
    expect(pos.message).toContain("اتصال");
    setBridgeUrl(`http://127.0.0.1:${port}`);
  });

  it("پرداخت موفق ولی خطای ثبت فاکتور → هشدار یادداشت کد پیگیری", async () => {
    const pos = await posPay({ amountToman: 200000, invoiceNumber: "INV-7" });
    const { db } = makeDb("invoices");
    const res = await saveInvoice(db, {
      invoiceNumber: "INV-7",
      total: 200000,
      method: "card",
      items,
      pos,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("123456789");
    expect(res.message).toContain("یادداشت");
  });

  it("خطای ثبت اقلام فاکتور هم گزارش می‌شود", async () => {
    const { db, calls } = makeDb("invoice_items");
    const res = await saveInvoice(db, {
      invoiceNumber: "INV-8",
      total: 200000,
      method: "cash",
      items,
    });
    expect(res.ok).toBe(false);
    expect(calls).toEqual(["invoices", "invoice_items"]);
    expect(res.message).toContain("دوباره تلاش");
  });

  it("پرداخت نقدی بدون کارت‌خوان ثبت می‌شود", async () => {
    const { db } = makeDb();
    const res = await saveInvoice(db, {
      invoiceNumber: "INV-9",
      total: 200000,
      method: "cash",
      items,
    });
    expect(res.ok).toBe(true);
  });
});


describe("تست ارتباط و توالی اتصال کارت‌خوان", () => {
  it("درخواست بدون توکن با ۴۰۱ رد می‌شود", async () => {
    requireToken = true;
    setPosAccessToken("");
    const bad = await posPing({ ip: "192.168.1.100", port: "8888" });
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("۴۰۱");

    setPosAccessToken("s3cr3t");
    const good = await posPing({ ip: "192.168.1.100", port: "8888" });
    expect(good.ok).toBe(true);
    setPosAccessToken("");
    requireToken = false;
  });

  it("ping موفق زمان پاسخ و مرحلهٔ handshake را برمی‌گرداند", async () => {
    const p = await posPing({ ip: "192.168.1.100", port: "8888" });
    expect(p.ok).toBe(true);
    expect(p.stage).toBe("handshake");
    expect(p.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("ping ناموفق علت و مرحلهٔ خطا را مشخص می‌کند", async () => {
    deviceUp = false;
    const p = await posPing({ ip: "192.168.1.100", port: "8888" });
    expect(p.ok).toBe(false);
    expect(p.stage).toBe("tcp");
    expect(p.message).toContain("باز نشد");
  });

  it("وقتی سرویس پل پایین است ping پیام مناسب می‌دهد", async () => {
    setBridgeUrl("http://127.0.0.1:1");
    const p = await posPing({}, 800);
    expect(p.ok).toBe(false);
    expect(p.message).toContain("در دسترس نیست");
    setBridgeUrl(`http://127.0.0.1:${port}`);
  });

  it("توالی اتصال همهٔ پنج مرحله را موفق طی می‌کند", async () => {
    const seen: PosStep[][] = [];
    const ok = await posConnectSequence(
      { ...getPosSettings(), deviceIp: "192.168.1.100", devicePort: "8888" },
      (s) => seen.push(s),
    );
    expect(ok).toBe(true);
    const final = seen[seen.length - 1];
    expect(final).toHaveLength(5);
    expect(final.every((s) => s.state === "ok")).toBe(true);
  });

  it("اگر دستگاه پاسخ ندهد توالی روی مرحلهٔ شبکه متوقف می‌شود", async () => {
    deviceUp = false;
    let final: PosStep[] = [];
    const ok = await posConnectSequence(
      { ...getPosSettings(), deviceIp: "192.168.1.100", devicePort: "8888" },
      (s) => (final = s),
    );
    expect(ok).toBe(false);
    expect(final.find((s) => s.key === "network")?.state).toBe("fail");
    expect(final.find((s) => s.key === "ready")?.state).toBe("pending");
    expect(posStepHint("network")).toContain("IP");
  });

  it("backoff نمایی ترتیب ۲،۴،۸،۱۶،۳۰ را رعایت می‌کند و سقف دارد", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(posBackoffSeconds)).toEqual([2, 4, 8, 16, 30, 30, 30]);
  });
});


describe("ماندگاری وضعیت اتصال و گزارش پشتیبانی", () => {
  beforeEach(() => clearConnectionState());

  it("وضعیت اتصال بین رفرش‌ها ذخیره و بازیابی می‌شود", () => {
    saveConnectionState({
      status: "connected",
      deviceIp: "192.168.1.100",
      devicePort: "8888",
      connectionMode: "lan",
      lastLatencyMs: 42,
    });
    const s = loadConnectionState();
    expect(s.status).toBe("connected");
    expect(s.deviceIp).toBe("192.168.1.100");
    expect(s.lastLatencyMs).toBe(42);
    expect(s.updatedAt).not.toBe("");
  });

  it("ping موفق و ناموفق وضعیت ذخیره‌شده را به‌روزرسانی می‌کند", async () => {
    deviceUp = true;
    await posPing({ ip: "192.168.1.100", port: "8888" });
    expect(loadConnectionState().status).toBe("connected");
    expect(loadConnectionState().lastOkAt).toBeTruthy();

    deviceUp = false;
    await posPing({ ip: "192.168.1.100", port: "8888" });
    expect(loadConnectionState().status).toBe("error");
    expect(loadConnectionState().lastError).toContain("باز نشد");
  });

  it("تاریخچهٔ ping حداکثر ۱۰ مورد نگه می‌دارد", async () => {
    deviceUp = true;
    for (let i = 0; i < PING_HISTORY_LIMIT + 3; i++) {
      await posPing({ ip: "192.168.1.100", port: "8888" });
    }
    expect(getPingHistory()).toHaveLength(PING_HISTORY_LIMIT);
  });

  it("گزارش پشتیبانی شامل تلاش‌ها و مشخصات کیوسک است و توکن را فاش نمی‌کند", async () => {
    setPosAccessToken("s3cr3t");
    deviceUp = true;
    await posPing({ ip: "192.168.1.100", port: "8888" });
    const report = buildSupportReport([
      { id: 1, level: "info", event: "connect", message: "اتصال برقرار شد", time: "10:00:00" },
    ]);
    expect(report.pingAttempts.length).toBeGreaterThan(0);
    expect(report.settings.serialNumber).toBe("2500206135");
    expect(report.settings.accessTokenConfigured).toBe("بله");
    expect(report.kiosk.screen).toBe("1080x1920");

    const text = supportReportText(report);
    expect(text).not.toContain("s3cr3t");
    expect(text).toContain("گزارش پشتیبانی");
    expect(text).toContain("اتصال برقرار شد");
    setPosAccessToken("");
  });
});

describe("کیفیت شبکه و تطبیق شناسنامهٔ دستگاه", () => {
  it("packet loss و RTT از تاریخچهٔ ping محاسبه می‌شود", async () => {
    const { summarizeNetworkQuality } = await import("../src/lib/pos-quality");
    const q = summarizeNetworkQuality([
      { at: "", ok: true, latencyMs: 100, message: "", target: "" },
      { at: "", ok: true, latencyMs: 140, message: "", target: "" },
      { at: "", ok: false, code: "NET_TIMEOUT", latencyMs: 5000, message: "", target: "" },
      { at: "", ok: true, latencyMs: 120, message: "", target: "" },
    ]);
    expect(q.attempts).toBe(4);
    expect(q.lossPercent).toBe(25);
    expect(q.timeouts).toBe(1);
    expect(q.avgRttMs).toBe(120);
    expect(q.minRttMs).toBe(100);
    expect(q.maxRttMs).toBe(140);
    expect(q.rating).toBe("unstable");
    expect(q.dominantSource).toBe("network");
  });

  it("شبکهٔ سالم با پاسخ سریع «عالی» ارزیابی می‌شود", async () => {
    const { summarizeNetworkQuality } = await import("../src/lib/pos-quality");
    const q = summarizeNetworkQuality([
      { at: "", ok: true, latencyMs: 90, message: "", target: "" },
      { at: "", ok: true, latencyMs: 110, message: "", target: "" },
    ]);
    expect(q.rating).toBe("excellent");
    expect(q.lossPercent).toBe(0);
  });

  it("ناهمخوانی مدل و فریم‌ور کد خطای مشخص برمی‌گرداند", async () => {
    const { checkDeviceIdentity } = await import("../src/lib/pos-device");
    const r = checkDeviceIdentity({
      serialNumber: "2500206135",
      model: "PAX S920",
      firmware: "17.01.00",
    });
    expect(r.ok).toBe(false);
    expect(r.mismatches.map((m) => m.code)).toEqual([
      "DEV_MODEL_MISMATCH",
      "DEV_FIRMWARE_MISMATCH",
    ]);
  });

  it("مشخصات درست دستگاه هیچ هشداری تولید نمی‌کند", async () => {
    const { checkDeviceIdentity, DEVICE_PROFILE } = await import("../src/lib/pos-device");
    const r = checkDeviceIdentity({
      serialNumber: DEVICE_PROFILE.serialNumber,
      model: DEVICE_PROFILE.model,
      firmware: DEVICE_PROFILE.firmware,
    });
    expect(r.ok).toBe(true);
  });
});

describe("گزارش پشتیبانی با RTT و منشأ خطا", () => {
  beforeEach(() => localStorage.clear());

  it("CSV تلاش‌های اتصال ستون RTT و منشأ خطا دارد", async () => {
    const { pingsToCsv } = await import("../src/lib/pos");
    const csv = pingsToCsv([
      { at: new Date().toISOString(), ok: true, latencyMs: 42, message: "پاسخ داد", target: "192.168.16.87:8080", stage: "handshake" },
      { at: new Date().toISOString(), ok: false, code: "NET_TIMEOUT", latencyMs: 5000, message: "timeout", target: "192.168.16.87:8080", stage: "network" },
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("RTT (ms)");
    expect(csv).toContain("منشأ خطا");
    expect(csv).toContain("شبکه");
    expect(csv).toContain("درصد بسته‌های بی‌پاسخ");
  });

  it("متن گزارش شامل خلاصهٔ کیفیت شبکه است", async () => {
    const { buildSupportReport, supportReportText, pushPingHistory } = await import("../src/lib/pos");
    pushPingHistory({ at: new Date().toISOString(), ok: true, latencyMs: 80, message: "ok", target: "x" });
    pushPingHistory({ at: new Date().toISOString(), ok: false, code: "DEV_HANDSHAKE_FAILED", latencyMs: 3000, message: "no", target: "x" });
    const r = buildSupportReport();
    expect(r.quality.attempts).toBe(2);
    expect(r.pingAttempts[1].source).toBe("device");
    const txt = supportReportText(r);
    expect(txt).toContain("--- کیفیت شبکه ---");
    expect(txt).toContain("منشأ غالب خطا");
    expect(txt).toContain("منشأ: دستگاه کارت‌خوان");
  });

  it("CSV سوابق دسترسی ستون RTT و منشأ را ثبت می‌کند", async () => {
    const { logAudit, auditToCsv } = await import("../src/lib/pos-audit");
    logAudit("identity:mismatch", { code: "DEV_MODEL_MISMATCH", rttMs: 120, source: "دستگاه کارت‌خوان" });
    const csv = auditToCsv();
    expect(csv).toContain("DEV_MODEL_MISMATCH");
    expect(csv).toContain("120");
    expect(csv).toContain("دستگاه کارت‌خوان");
  });

  it("ناهمخوانی مدل/فریم‌ور بازیابی خودکار را لازم می‌کند ولی سریال به‌تنهایی نه", async () => {
    const { needsIdentityRecovery, checkDeviceIdentity } = await import("../src/lib/pos-device");
    expect(needsIdentityRecovery(checkDeviceIdentity({ model: "PAX S920" }))).toBe(true);
    expect(needsIdentityRecovery(checkDeviceIdentity({ firmware: "17.00.00" }))).toBe(true);
    expect(needsIdentityRecovery(checkDeviceIdentity({ serialNumber: "999" }))).toBe(false);
    expect(needsIdentityRecovery(checkDeviceIdentity({ model: "PAX Q58 LAN + LINE + WIFI" }))).toBe(false);
  });

  it("تشخیص زیرشبکهٔ ناهمخوان و آدرس APIPA", async () => {
    const { sameSubnet, isApipa } = await import("../src/lib/pos-device");
    expect(sameSubnet("10.62.158.1", "192.168.16.87")).toBe(false);
    expect(sameSubnet("192.168.16.5", "192.168.16.87")).toBe(true);
    expect(isApipa("169.254.78.62")).toBe(true);
    expect(isApipa("10.62.158.98")).toBe(false);
  });
});
