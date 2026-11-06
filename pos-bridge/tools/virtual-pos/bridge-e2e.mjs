#!/usr/bin/env node
/**
 * آزمون سرتاسری سرویس پل با «کارت‌خوان مجازی» — خود PosBridge.exe واقعی اجرا می‌شود (روی ویندوز مستقیم،
 * روی لینوکس با mono) و از راه HTTP همان کارهایی را می‌کند که کیوسک می‌کند؛ دستگاه مجازی هم روی TCP
 * با همان پروتکل PC-POS جواب می‌دهد. نیازی به دستگاه واقعی، اینترنت یا دیتابیس نیست.
 *
 *   node pos-bridge/tools/virtual-pos/bridge-e2e.mjs --bridge <مسیر PosBridge.exe> [--full] [--keep]
 *   (یا متغیر POS_BRIDGE_EXE)
 *
 * پیش‌فرض ≈ ۱ دقیقه. --full سناریوهای مهلت ۳۰ ثانیه‌ای را هم می‌زند (چک‌سام خراب، خط بی‌معنی، قطع
 * اتصال، بی‌پاسخی؛ حدود ۳ دقیقهٔ دیگر). فایل‌های سرویس در پوشهٔ موقت کپی می‌شوند و تنظیمات واقعی
 * دست‌نخورده می‌ماند. کد خروج ۰ فقط وقتی همهٔ بررسی‌ها گذشته باشند.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createVirtualPos } from "./virtual-pos.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const exe = opt("--bridge") ?? process.env.POS_BRIDGE_EXE;
const FULL = flag("--full");
const KEEP = flag("--keep");
if (flag("--help") || !exe) {
  console.log("استفاده: node bridge-e2e.mjs --bridge <مسیر PosBridge.exe> [--full] [--keep]");
  process.exit(exe ? 0 : 1);
}
if (!fs.existsSync(exe)) {
  console.error(`PosBridge.exe پیدا نشد: ${exe}`);
  process.exit(1);
}

const FULL_PAN = "6037991234567391";
const TOKEN = "e2e-" + crypto.randomBytes(8).toString("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();
let passed = 0;
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? "  — " + extra : ""}`);
  if (cond) passed++;
  else failed++;
};

// پورت آزادِ دلخواه. پورت‌های قبلاً داده‌شده دوباره داده نمی‌شوند: ویندوز ممکن است پورتی را که همین الان
// آزاد شده بلافاصله دوباره بدهد و آن‌وقت پورت HTTP سرویس با پورت پاسخ برگشتی یکی می‌شود.
const handedOut = new Set();
const freePort = async () => {
  for (let i = 0; i < 50; i++) {
    const port = await new Promise((resolve, reject) => {
      const s = net.createServer();
      s.once("error", reject);
      s.listen(0, "127.0.0.1", () => {
        const { port } = s.address();
        s.close(() => resolve(port));
      });
    });
    if (!handedOut.has(port)) {
      handedOut.add(port);
      return port;
    }
  }
  throw new Error("پورت آزاد پیدا نشد");
};

/* ------------------------------ سرویس پل ------------------------------ */

const work = fs.mkdtempSync(path.join(os.tmpdir(), "belit-bridge-e2e-"));
let proc = null;
let base = "";

async function startBridge(over = {}) {
  await stopBridge();
  fs.rmSync(path.join(work, "data"), { recursive: true, force: true });
  const srcDir = path.dirname(path.resolve(exe));
  for (const f of fs.readdirSync(srcDir)) {
    const p = path.join(srcDir, f);
    if (fs.statSync(p).isFile() && !/^appsettings\.json$|\.log$|\.jsonl$/i.test(f))
      fs.copyFileSync(p, path.join(work, f));
  }
  const listen = await freePort();
  base = `http://127.0.0.1:${listen}`;
  const cfg = {
    listenUrl: `${base}/`,
    deviceIp: "127.0.0.1",
    responseMode: "auto",
    accessToken: TOKEN,
    timeoutSeconds: 30,
    connectTimeoutSeconds: 3,
    cancelGraceSeconds: 3,
    lateResponseSeconds: 60,
    merchantId: "6618774",
    terminalId: "5634056",
    journalPath: "data/e2e.jsonl",
    allowedOrigins: [],
    printEnabled: false,
    syncEnabled: false,
    ...over,
  };
  fs.writeFileSync(path.join(work, "appsettings.json"), JSON.stringify(cfg, null, 2));
  const out = fs.openSync(path.join(work, "bridge.log"), "a");
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(https?|all)_proxy$/i.test(k)) delete env[k];
  const name = path.basename(exe);
  proc =
    process.platform === "win32"
      ? spawn(path.join(work, name), [], { cwd: work, stdio: ["ignore", out, out], env })
      : spawn("mono", [name], { cwd: work, stdio: ["ignore", out, out], env });
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) return cfg;
    } catch {
      /* هنوز بالا نیامده */
    }
    if (proc.exitCode !== null) break; // سرویس خودش بسته شده؛ منتظر ماندن فایده ندارد
    await sleep(250);
  }
  // علت را در خروجی (مثلاً لاگ CI) بگذار؛ پوشهٔ موقت روی ماشین CI بعداً در دسترس نیست
  let tail = "";
  try {
    tail = fs
      .readFileSync(path.join(work, "bridge.log"), "utf8")
      .split(/\r?\n/)
      .slice(-40)
      .join("\n");
  } catch {
    tail = "(bridge.log خوانده نشد)";
  }
  console.error(
    `--- bridge.log (listen ${base}, callback ${cfg.callbackPort}, device ${cfg.devicePort}, exitCode ${proc.exitCode}) ---\n${tail}\n---`,
  );
  throw new Error(`سرویس پل بالا نیامد؛ ${path.join(work, "bridge.log")} را ببینید`);
}
async function stopBridge() {
  if (proc) {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    await new Promise((r) => (proc.exitCode !== null ? r() : proc.once("exit", r)));
    proc = null;
    await sleep(300);
  }
}

const H = () => ({ "X-Pos-Token": TOKEN, "Content-Type": "application/json" });
async function api(method, p, body, headers = {}) {
  const r = await fetch(`${base}${p}`, {
    method,
    headers: { ...H(), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  return { ...(await r.json().catch(() => ({}))), _status: r.status };
}
const pay = (id, rial, extra = {}) =>
  api("POST", "/pay", {
    transactionId: id,
    amountRial: rial,
    amountToman: Math.round(rial / 10),
    invoiceNumber: `INV-20261102-${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`,
    ...extra,
  });
const status = (id) => api("GET", `/status?id=${id}`);
const cancel = (id) => api("POST", "/cancel", { transactionId: id });
const journal = () => {
  try {
    return fs.readFileSync(path.join(work, "data", "e2e.jsonl"), "utf8");
  } catch {
    return "";
  }
};

/* ------------------------------ دستگاه مجازی ------------------------------ */

async function startDevice(over = {}) {
  const pos = createVirtualPos({
    port: await freePort(),
    controlPort: -1,
    delayMs: 300,
    log: false,
    ...over,
  });
  const addr = await pos.start();
  const control = async (method, p, body) =>
    (
      await fetch(`http://127.0.0.1:${addr.controlPort}${p}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    ).json();
  return {
    pos,
    port: addr.port,
    control,
    requests: async () => (await control("GET", "/requests")).items,
  };
}
const rrnOf = (reply) => /^\$POSBUY,\d+,\d+,(\d*),/.exec(reply ?? "")?.[1];

function approvedShape(r, name, amount) {
  ok(
    `${name}: approved + success`,
    r.status === "approved" && r.success === true && r.final === true && r.uncertain === false,
    `${r.status}/${r.message}`,
  );
  ok(`${name}: card number masked`, r.maskedPan === "603799******7391", r.maskedPan);
  ok(`${name}: RRN is 12 digits`, /^\d{12}$/.test(r.refNumber ?? ""), r.refNumber);
  ok(
    `${name}: amount echoed, no review needed`,
    r.amountRial === amount && r.needsReview === false,
  );
}

/* ------------------------------ سناریوها ------------------------------ */

async function groupSameSocket() {
  console.log("\n# پاسخ روی همان اتصال (responseMode=auto)");
  const dev = await startDevice();
  await startBridge({ devicePort: dev.port, callbackPort: await freePort() });

  const r0 = await fetch(`${base}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transactionId: uuid(),
      amountRial: 10000,
      amountToman: 1000,
      invoiceNumber: "INV-1",
    }),
  });
  ok("دسترسی: /pay بدون توکن رد می‌شود", r0.status === 401 || r0.status === 403, String(r0.status));
  const r0b = await api(
    "POST",
    "/pay",
    { transactionId: uuid(), amountRial: 10000, amountToman: 1000, invoiceNumber: "INV-1" },
    { Origin: "https://evil.example" },
  );
  ok("دسترسی: Origin بیگانه رد می‌شود", r0b._status === 403, String(r0b._status));
  ok("دسترسی: درخواست ردشده هرگز به دستگاه نرسید", (await dev.requests()).length === 0);

  const t1 = uuid();
  const r1 = await pay(t1, 100000);
  approvedShape(r1, "تأیید عادی", 100000);
  const q1 = await dev.requests();
  ok(
    "دستگاه دقیقاً یک PCBUY معتبر دید (ویرگول انتهایی و چک‌سام)",
    q1.length === 1 && q1[0].valid === true && /,,\*[0-9A-F]{2}$/.test(q1[0].raw),
    q1[0]?.raw,
  );
  ok(
    "مبلغ و RRN دستگاه همان است که سرویس گزارش کرد",
    q1[0]?.amount === 100000 && r1.refNumber === rrnOf(q1[0]?.reply),
    `${r1.refNumber}`,
  );

  const again = await pay(t1, 100000);
  ok(
    "تکرار همان transactionId: نتیجهٔ ذخیره‌شده، دستگاه دوباره صدا زده نمی‌شود",
    again.replayed === true &&
      again.refNumber === r1.refNumber &&
      (await dev.requests()).length === 1,
  );
  const reused = await pay(t1, 999990);
  ok(
    "همان شناسه با مبلغ دیگر: ۴۰۹ ID_REUSED",
    reused._status === 409 && reused.code === "ID_REUSED",
    `${reused._status}/${reused.code}`,
  );

  await dev.control("POST", "/queue", { items: ["split", "no-crlf"] });
  approvedShape(await pay(uuid(), 50000), "پاسخ تکه‌تکه", 50000);
  approvedShape(await pay(uuid(), 60000), "پاسخ بدون CRLF", 60000);

  await dev.control("POST", "/queue", { items: [{ behavior: "decline", code: 51 }] });
  const d = await pay(uuid(), 70000);
  ok(
    "رد (۵۱): declined، موفق نیست، نامطمئن نیست، دلیل فارسی",
    d.status === "declined" &&
      d.success === false &&
      d.uncertain === false &&
      /موجودی کافی نیست/.test(d.message ?? ""),
    `${d.status}/${d.message}`,
  );

  for (const [name, behavior] of [
    ["مبلغ پاسخ متفاوت", "wrong-amount"],
    ["پایانهٔ دیگر", "wrong-terminal"],
    ["تأیید بدون RRN", "no-rrn"],
  ]) {
    await dev.control("POST", "/queue", { items: [behavior] });
    const r = await pay(uuid(), 80000);
    ok(
      `${name}: نامطمئن و نیازمند بررسی، هرگز موفق نیست`,
      r.success === false && r.uncertain === true && r.needsReview === true,
      `${r.status}/${r.message}`,
    );
  }
  await dev.control("POST", "/queue", { items: ["duplicate-rrn"] });
  const dup = await pay(uuid(), 12000);
  ok(
    "RRN تکراری: نامطمئن و نیازمند بررسی",
    dup.success === false &&
      dup.uncertain === true &&
      dup.needsReview === true &&
      /RRN/.test(dup.message ?? ""),
    dup.message,
  );

  await dev.control("POST", "/config", { delayMs: 2500 });
  const slow = pay(uuid(), 90000);
  await sleep(700);
  const busy = await pay(uuid(), 90000);
  ok(
    "پرداخت همزمان: دومی ۴۰۹ DEV_BUSY",
    busy._status === 409 && busy.code === "DEV_BUSY",
    `${busy._status}/${busy.code}`,
  );
  ok("پرداخت همزمان: اولی همچنان تأیید می‌شود", (await slow).status === "approved");
  await dev.control("POST", "/config", { delayMs: 300 });

  await dev.control("POST", "/queue", { items: ["no-response"] });
  const t4 = uuid();
  const p4 = pay(t4, 40000);
  await sleep(1200);
  await cancel(t4);
  const r4 = await p4;
  ok(
    "لغو با دستگاه ساکت: پس از فرصت لغو «cancelled»",
    r4.status === "cancelled" && r4.success === false,
    `${r4.status}`,
  );

  await dev.control("POST", "/queue", { items: [{ behavior: "approve", delayMs: 2200 }] });
  const t4b = uuid();
  const p4b = pay(t4b, 41000);
  await sleep(1000);
  await cancel(t4b);
  const r4b = await p4b;
  ok(
    "پرداخت مشتری داخل فرصت لغو: تأیید و فروش حفظ می‌شود",
    r4b.status === "approved" && r4b.success === true,
    `${r4b.status}`,
  );

  await dev.control("POST", "/queue", { items: [{ behavior: "late", lateMs: 6500 }] });
  const t6 = uuid();
  const p6 = pay(t6, 42000);
  await sleep(800);
  await cancel(t6);
  const r6 = await p6;
  ok(
    "تأیید دیرهنگام: پاسخ اول «cancelled» (بلیط صادر نمی‌شود)",
    r6.status === "cancelled" && r6.success === false,
  );
  await sleep(5000);
  const s6 = await status(t6);
  ok(
    "تأیید دیرهنگام: بعداً approved_late + نیازمند بررسی با RRN",
    s6.status === "approved_late" && s6.needsReview === true && /^\d{12}$/.test(s6.refNumber ?? ""),
    `${s6.status}`,
  );

  await dev.control("POST", "/offline");
  const t0 = Date.now();
  const off = await pay(uuid(), 30000);
  ok(
    "دستگاه خاموش: سریع و بدون ابهام شکست می‌خورد (چیزی فرستاده نشده)",
    off.success === false &&
      off.uncertain !== true &&
      off.needsReview !== true &&
      Date.now() - t0 < 25000,
    `${off.status}/${Date.now() - t0}ms`,
  );
  await dev.control("POST", "/online");
  approvedShape(await pay(uuid(), 31000), "بعد از برگشت دستگاه", 31000);

  if (FULL) {
    for (const [name, behavior] of [
      ["چک‌سام خراب", "bad-checksum"],
      ["خط بی‌معنی", "malformed"],
      ["قطع اتصال بعد از درخواست", "drop"],
      ["بی‌پاسخی", "no-response"],
    ]) {
      console.log(`… ${name}: انتظار برای مهلت ۳۰ ثانیه`);
      await dev.control("POST", "/queue", { items: [behavior] });
      const r = await pay(uuid(), 20000);
      ok(
        `${name}: هرگز موفق نیست و نیازمند بررسی است`,
        r.success === false && r.needsReview === true,
        `${r.status}`,
      );
    }
  }

  const list = (await api("GET", "/transactions?limit=200")).items ?? [];
  ok(
    "دفتر: فقط approved و approved_late موفق‌اند و تأیید دیرهنگام نیازمند بررسی است",
    list
      .filter((t) => !["approved", "approved_late"].includes(t.status))
      .every((t) => t.success === false) &&
      list.filter((t) => t.status === "approved_late").every((t) => t.needsReview),
    "",
  );
  const rrns = list.filter((t) => t.status === "approved").map((t) => t.refNumber);
  ok(
    "دفتر: RRNهای تأییدشده یکتا و ۱۲ رقمی‌اند",
    rrns.length > 0 && new Set(rrns).size === rrns.length && rrns.every((r) => /^\d{12}$/.test(r)),
    `n=${rrns.length}`,
  );
  ok("ایمنی کارت: شمارهٔ کامل کارت در دفتر تراکنش نیست", !journal().includes(FULL_PAN));
  ok(
    "ایمنی کارت: در /logs و فایل لاگ هم نیست",
    !JSON.stringify(await api("GET", "/logs")).includes(FULL_PAN) &&
      !fs.readFileSync(path.join(work, "bridge.log"), "utf8").includes(FULL_PAN),
  );
  await dev.pos.stop();
}

async function groupCallback(mode) {
  console.log(`\n# پاسخ برگشتی: دستگاه به سرویس وصل می‌شود (responseMode=${mode})`);
  const callbackPort = await freePort();
  const dev = await startDevice({ response: "callback", callbackPort });
  await startBridge({ devicePort: dev.port, callbackPort, responseMode: mode });
  const r = await pay(uuid(), 100000);
  approvedShape(r, `تأیید با پاسخ برگشتی (${mode})`, 100000);
  ok(
    "پاسخ واقعاً از اتصال برگشتی دستگاه آمد",
    (await dev.requests())[0]?.delivered === `callback 127.0.0.1:${callbackPort}`,
    (await dev.requests())[0]?.delivered,
  );
  await dev.control("POST", "/queue", { items: [{ behavior: "decline", code: 51 }] });
  const d = await pay(uuid(), 100000);
  ok(
    "رد با پاسخ برگشتی: declined",
    d.status === "declined" && d.success === false && d.uncertain === false,
    d.status,
  );
  await dev.control("POST", "/queue", { items: [{ behavior: "late", lateMs: 6500 }] });
  const t = uuid();
  const p = pay(t, 43000);
  await sleep(800);
  await cancel(t);
  ok("تأیید دیرهنگام با پاسخ برگشتی: ابتدا cancelled", (await p).status === "cancelled");
  await sleep(5000);
  const s = await status(t);
  ok(
    "تأیید دیرهنگام با پاسخ برگشتی: بعداً approved_late + نیازمند بررسی",
    s.status === "approved_late" && s.needsReview === true,
    s.status,
  );
  ok("ایمنی کارت: شمارهٔ کامل کارت در دفتر تراکنش نیست", !journal().includes(FULL_PAN));
  await dev.pos.stop();
}

async function main() {
  console.log(`سرویس پل: ${path.resolve(exe)}${FULL ? "  (حالت کامل)" : ""}\nپوشهٔ کار: ${work}`);
  await groupSameSocket();
  await groupCallback("callback");
  await groupCallback("auto");
  await stopBridge();
  console.log(`\nنتیجه: ${failed ? "ناموفق" : "همه گذشتند"} — ${passed} موفق، ${failed} ناموفق`);
  return failed ? 1 : 0;
}

let code = 2;
try {
  code = await main();
} catch (e) {
  console.error(e);
} finally {
  await stopBridge();
  if (!KEEP && code === 0) fs.rmSync(work, { recursive: true, force: true });
  else console.log(`پوشهٔ کار برای بررسی مانده است: ${work}`);
}
process.exit(code);
