/**
 * تست end-to-end جریان پرداخت با کارت‌خوان:
 * یک سرویس ماک pos-bridge روی لوکال‌هاست بالا می‌آید تا بدون دستگاه واقعی
 * همهٔ حالت‌های موفق/ناموفق/قطع اتصال/لغو آزمایش شوند.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
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
  posAuthorizeCash,
  posCancel,
  posCashStatus,
  posSetCashierPin,
  posPay,
  posPing,
  posTransactionStatus,
  posStepHint,
  saveConnectionState,
  setBridgeUrl,
  setPosAccessToken,
  supportReportText,
  setTerminalId,
  type PosStep,
} from "@/lib/pos";
import {
  flushInvoiceOutbox,
  invoiceOutboxSize,
  newInvoiceNumber,
  saveInvoice,
  savePaidInvoice,
  type InvoiceDb,
  type InvoiceLine,
} from "@/lib/invoice";

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

/**
 * approve / decline / error: پاسخ فوری
 * hang: پرداخت منتظر می‌ماند تا /cancel برسد (لغو → cancelled)
 * approve-on-cancel: مشتری همان لحظهٔ لغو کارت کشیده است (لغو → approved)
 * approve-lost: پرداخت تأیید می‌شود ولی پاسخ HTTP هرگز نمی‌رسد (فقط از /status معلوم است)
 * busy: سرویس پل مشغول تراکنش دیگری است
 */
type Mode =
  | "approve"
  | "decline"
  | "hang"
  | "error"
  | "approve-on-cancel"
  | "approve-lost"
  | "busy";
let mode: Mode = "approve";
let lastPayHeaders: IncomingMessage["headers"] = {};
let lastPayBody: Record<string, unknown> = {};
const txs = new Map<string, Record<string, unknown>>();
const held = new Map<string, ServerResponse>();
let cashierPin = "";
let lastCashBody: Record<string, unknown> = {};

function approved(id: string, amountRial: number) {
  return {
    transactionId: id,
    success: true,
    status: "approved",
    final: true,
    uncertain: false,
    needsReview: false,
    amountRial,
    responseCode: "0",
    refNumber: "123456789",
    maskedPan: "622106******1234",
    terminalId: "5634056",
    message: "تراکنش موفق",
  };
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data ? (JSON.parse(data) as Record<string, unknown>) : {}));
  });
}
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

    if (req.url === "/cash/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ pinConfigured: cashierPin !== "", lockedSeconds: 0 }));
      return;
    }
    if (req.url === "/cash/authorize") {
      void readBody(req).then((b) => {
        lastCashBody = b;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify(
            cashierPin === ""
              ? { ok: false, code: "NOT_CONFIGURED", message: "رمز متصدی تنظیم نشده است" }
              : b.pin === cashierPin
                ? { ok: true, authorizationId: "cash-1", message: "پرداخت نقدی تأیید شد" }
                : {
                    ok: false,
                    code: "WRONG_PIN",
                    remainingAttempts: 4,
                    message: "رمز متصدی نادرست است (4 تلاش دیگر)",
                  },
          ),
        );
      });
      return;
    }
    if (req.url === "/cash/pin") {
      void readBody(req).then((b) => {
        const allowed = cashierPin === "" || b.currentPin === cashierPin;
        if (allowed) cashierPin = String(b.newPin ?? "");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify(
            allowed
              ? { ok: true, pinConfigured: cashierPin !== "", message: "رمز متصدی ذخیره شد" }
              : { ok: false, code: "WRONG_PIN", message: "رمز فعلی متصدی نادرست است" },
          ),
        );
      });
      return;
    }
    if (req.url?.startsWith("/status")) {
      const id = new URL(req.url, "http://x").searchParams.get("id") ?? "";
      const tx = txs.get(id);
      res.writeHead(tx ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(tx ?? { success: false, message: "not found" }));
      return;
    }
    if (req.url === "/cancel") {
      void readBody(req).then((b) => {
        const id = String(b.transactionId ?? "");
        const pending = held.get(id);
        if (pending) {
          held.delete(id);
          const tx = txs.get(id)!;
          const result =
            mode === "approve-on-cancel"
              ? approved(id, Number(tx.amountRial))
              : {
                  transactionId: id,
                  success: false,
                  status: "cancelled",
                  final: true,
                  uncertain: false,
                  message: "تراکنش لغو شد",
                };
          txs.set(id, result);
          pending.writeHead(200, { "content-type": "application/json" });
          pending.end(JSON.stringify(result));
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ accepted: !!pending, message: "ok" }));
      });
      return;
    }
    if (req.url === "/pay") {
      lastPayHeaders = req.headers;
      void readBody(req).then((b) => {
        lastPayBody = b;
        const id = String(b.transactionId);
        const amountRial = Number(b.amountRial);
        if (mode === "busy") {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              final: true,
              code: "DEV_BUSY",
              message: "کارت‌خوان مشغول است",
            }),
          );
          return;
        }
        if (mode === "error") {
          res.writeHead(500);
          res.end("boom");
          return;
        }
        if (mode === "hang" || mode === "approve-on-cancel") {
          txs.set(id, {
            transactionId: id,
            success: false,
            status: "sent",
            final: false,
            amountRial,
          });
          held.set(id, res);
          return;
        }
        if (mode === "approve-lost") {
          txs.set(id, approved(id, amountRial));
          return; // پاسخ HTTP هرگز فرستاده نمی‌شود
        }
        const result =
          mode === "approve"
            ? approved(id, amountRial)
            : {
                transactionId: id,
                success: false,
                status: "declined",
                final: true,
                uncertain: false,
                responseCode: "51",
                message: "موجودی کافی نیست",
              };
        txs.set(id, result);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
      });
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
    expect(pos.final).toBe(true);
    expect(pos.uncertain).toBe(false);
    expect(pos.message).toBe("موجودی کافی نیست");
  });

  it("مبلغ به ریال، شناسهٔ تراکنش و توکن دسترسی همراه درخواست پرداخت فرستاده می‌شود", async () => {
    setPosAccessToken("s3cr3t");
    const pos = await posPay({
      amountToman: 12345,
      invoiceNumber: "INV-T",
      transactionId: "tx-fixed-0001",
    });
    setPosAccessToken("");
    expect(pos.success).toBe(true);
    expect(pos.transactionId).toBe("tx-fixed-0001");
    expect(lastPayHeaders["x-pos-token"]).toBe("s3cr3t");
    expect(lastPayHeaders["content-type"]).toContain("application/json");
    expect(lastPayBody).toMatchObject({
      amountRial: 123450,
      amountToman: 12345,
      transactionId: "tx-fixed-0001",
    });
  });

  it("مبلغ نامعتبر اصلاً به کارت‌خوان فرستاده نمی‌شود", async () => {
    lastPayBody = {};
    const pos = await posPay({ amountToman: 0, invoiceNumber: "INV-0" });
    expect(pos.success).toBe(false);
    expect(lastPayBody).toEqual({});
  });

  it("خطای سرویس پل → پیام خطای وضعیت HTTP و نتیجهٔ قطعی (کسر وجه نشده)", async () => {
    mode = "error";
    const pos = await posPay({ amountToman: 1000, invoiceNumber: "INV-3" });
    expect(pos.success).toBe(false);
    expect(pos.final).toBe(true);
    expect(pos.uncertain).toBeFalsy();
    expect(pos.message).toContain("500");
  });

  it("کارت‌خوان مشغول → پرداخت شروع نمی‌شود", async () => {
    mode = "busy";
    const pos = await posPay({ amountToman: 1000, invoiceNumber: "INV-B" });
    expect(pos.success).toBe(false);
    expect(pos.final).toBe(true);
    expect(pos.message).toContain("مشغول");
  });

  it("پاسخ HTTP گم شد ولی پرداخت تأیید شده بود → نتیجه از /status بازیابی می‌شود", async () => {
    mode = "approve-lost";
    const pos = await posPay(
      { amountToman: 5000, invoiceNumber: "INV-L" },
      { timeoutMs: 300, statusDeadlineMs: 5000 },
    );
    expect(pos.success).toBe(true);
    expect(pos.refNumber).toBe("123456789");
  });

  it("پاسخ گم شد و پرداخت هنوز در جریان است → «نامشخص»، نه «ناموفق»", async () => {
    mode = "hang";
    const pos = await posPay(
      { amountToman: 1000, invoiceNumber: "INV-4" },
      { timeoutMs: 300, statusDeadlineMs: 1200 },
    );
    expect(pos.success).toBe(false);
    expect(pos.uncertain).toBe(true);
    expect(pos.final).toBe(false);
    expect(pos.message).toContain("معلوم نیست");
    await posCancel(pos.transactionId);
  });

  it("لغو تراکنش → منتظر نتیجهٔ واقعی دستگاه می‌ماند و «لغو شد» برمی‌گرداند", async () => {
    mode = "hang";
    const paying = posPay({
      amountToman: 1000,
      invoiceNumber: "INV-5",
      transactionId: "tx-cancel-0001",
    });
    await new Promise((r) => setTimeout(r, 100));
    const c = await posCancel("tx-cancel-0001");
    expect(c.accepted).toBe(true);
    const pos = await paying;
    expect(pos.success).toBe(false);
    expect(pos.status).toBe("cancelled");
    expect(pos.message).toContain("لغو");
  });

  it("مشتری همان لحظهٔ لغو کارت کشیده → پرداخت موفق حفظ می‌شود (پول گم نمی‌شود)", async () => {
    mode = "approve-on-cancel";
    const paying = posPay({
      amountToman: 1000,
      invoiceNumber: "INV-5b",
      transactionId: "tx-cancel-0002",
    });
    await new Promise((r) => setTimeout(r, 100));
    await posCancel("tx-cancel-0002");
    const pos = await paying;
    expect(pos.success).toBe(true);
    expect(pos.refNumber).toBe("123456789");
  });

  it("وضعیت تراکنش با شناسه قابل پرسش است؛ تراکنش ناشناخته null است", async () => {
    await posPay({ amountToman: 1000, invoiceNumber: "INV-S", transactionId: "tx-status-0001" });
    const st = await posTransactionStatus("tx-status-0001");
    expect(st?.status).toBe("approved");
    expect(await posTransactionStatus("tx-unknown-0001")).toBeNull();
  });

  it("سرویس اجرا نیست → سریع پیام «در دسترس نیست» (بدون انتظار طولانی)", async () => {
    setBridgeUrl("http://127.0.0.1:1");
    const started = Date.now();
    const pos = await posPay({ amountToman: 1000, invoiceNumber: "INV-6" });
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(pos.success).toBe(false);
    expect(pos.uncertain).toBe(false);
    expect(pos.message).toContain("در دسترس نیست");
    setBridgeUrl(`http://127.0.0.1:${port}`);
  }, 20_000);

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

  it("پرداخت موفق + قطع پایگاه‌داده → فاکتور در صف می‌ماند و بعداً ثبت می‌شود", async () => {
    const pos = await posPay({ amountToman: 200000, invoiceNumber: "INV-Q" });
    const down = makeDb("invoices");
    const res = await savePaidInvoice(down.db, {
      invoiceNumber: "INV-Q",
      total: 200000,
      method: "card",
      items,
      pos,
    });
    expect(res.ok).toBe(false);
    expect(res.queued).toBe(true);
    expect(invoiceOutboxSize()).toBe(1);

    const up = makeDb();
    const flushed = await flushInvoiceOutbox(up.db);
    expect(flushed).toEqual({ saved: 1, remaining: 0 });
    expect(up.calls).toEqual(["invoices", "invoice_items"]);
  });

  it("تلاش دوباره وقتی خود فاکتور قبلاً ثبت شده بود، فقط اقلام را ثبت می‌کند", async () => {
    const calls: string[] = [];
    const db: InvoiceDb = {
      from(table: string) {
        return {
          async insert() {
            calls.push(table);
            return table === "invoices"
              ? {
                  error: {
                    code: "23505",
                    message: 'duplicate key value violates unique constraint "invoices_pkey"',
                  },
                }
              : { error: null };
          },
        };
      },
    };
    const res = await saveInvoice(db, {
      invoiceNumber: "INV-R",
      total: 1000,
      method: "card",
      items,
      invoiceId: "22222222-2222-2222-2222-222222222222",
    });
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["invoices", "invoice_items"]);
  });

  it("شمارهٔ فاکتور قالب ثابت و بخش تصادفی ۱۰ رقمی دارد و تکرار نمی‌شود", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const n = newInvoiceNumber(new Date(2026, 9, 26));
      expect(n).toMatch(/^INV-20261026-\d{10}$/);
      seen.add(n);
    }
    expect(seen.size).toBe(2000);
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

describe("پرداخت نقدی با رمز متصدی", () => {
  it("تا رمز تنظیم نشده، نقدی غیرفعال است", async () => {
    cashierPin = "";
    expect((await posCashStatus()).pinConfigured).toBe(false);
    const r = await posAuthorizeCash({ pin: "1234", invoiceNumber: "INV-C0", amountToman: 1000 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NOT_CONFIGURED");
  });

  it("تنظیم رمز اول بار؛ تغییر بعدی رمز فعلی را لازم دارد", async () => {
    cashierPin = "";
    expect((await posSetCashierPin({ newPin: "4821" })).ok).toBe(true);
    expect((await posCashStatus()).pinConfigured).toBe(true);
    const bad = await posSetCashierPin({ currentPin: "0000", newPin: "1111" });
    expect(bad.ok).toBe(false);
    expect(cashierPin).toBe("4821");
  });

  it("رمز درست → تأیید؛ رمز نادرست → رد با تعداد تلاش باقی‌مانده", async () => {
    cashierPin = "4821";
    const wrong = await posAuthorizeCash({
      pin: "0000",
      invoiceNumber: "INV-C1",
      amountToman: 50000,
    });
    expect(wrong.ok).toBe(false);
    expect(wrong.code).toBe("WRONG_PIN");
    expect(wrong.message).toContain("نادرست");

    const ok = await posAuthorizeCash({ pin: "4821", invoiceNumber: "INV-C1", amountToman: 50000 });
    expect(ok.ok).toBe(true);
    expect(lastCashBody).toMatchObject({ invoiceNumber: "INV-C1", amountToman: 50000 });
  });

  it("رمز هرگز در حافظهٔ مرورگر ذخیره نمی‌شود", async () => {
    cashierPin = "4821";
    await posAuthorizeCash({ pin: "4821", invoiceNumber: "INV-C2", amountToman: 1000 });
    for (const v of store.values()) expect(v).not.toContain("4821");
  });

  it("سرویس پل در دسترس نیست → نقدی تأیید نمی‌شود", async () => {
    setBridgeUrl("http://127.0.0.1:1");
    const r = await posAuthorizeCash({ pin: "4821", invoiceNumber: "INV-C3", amountToman: 1000 });
    setBridgeUrl(`http://127.0.0.1:${port}`);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("BRIDGE_DOWN");
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
      {
        at: new Date().toISOString(),
        ok: true,
        latencyMs: 42,
        message: "پاسخ داد",
        target: "192.168.16.87:8080",
        stage: "handshake",
      },
      {
        at: new Date().toISOString(),
        ok: false,
        code: "NET_TIMEOUT",
        latencyMs: 5000,
        message: "timeout",
        target: "192.168.16.87:8080",
        stage: "network",
      },
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("RTT (ms)");
    expect(csv).toContain("منشأ خطا");
    expect(csv).toContain("شبکه");
    expect(csv).toContain("درصد بسته‌های بی‌پاسخ");
  });

  it("متن گزارش شامل خلاصهٔ کیفیت شبکه است", async () => {
    const { buildSupportReport, supportReportText, pushPingHistory } =
      await import("../src/lib/pos");
    pushPingHistory({
      at: new Date().toISOString(),
      ok: true,
      latencyMs: 80,
      message: "ok",
      target: "x",
    });
    pushPingHistory({
      at: new Date().toISOString(),
      ok: false,
      code: "DEV_HANDSHAKE_FAILED",
      latencyMs: 3000,
      message: "no",
      target: "x",
    });
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
    logAudit("identity:mismatch", {
      code: "DEV_MODEL_MISMATCH",
      rttMs: 120,
      source: "دستگاه کارت‌خوان",
    });
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
    expect(needsIdentityRecovery(checkDeviceIdentity({ model: "PAX Q58 LAN + LINE + WIFI" }))).toBe(
      false,
    );
  });

  it("تشخیص زیرشبکهٔ ناهمخوان و آدرس APIPA", async () => {
    const { sameSubnet, isApipa } = await import("../src/lib/pos-device");
    expect(sameSubnet("10.62.158.1", "192.168.16.87")).toBe(false);
    expect(sameSubnet("192.168.16.5", "192.168.16.87")).toBe(true);
    expect(isApipa("169.254.78.62")).toBe(true);
    expect(isApipa("10.62.158.98")).toBe(false);
  });
});
