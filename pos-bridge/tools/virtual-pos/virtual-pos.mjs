#!/usr/bin/env node
/**
 * کارت‌خوان مجازی (PC-POS) — جای دستگاه واقعی PAX برای تست سرویس پل و کیوسک.
 *
 * همان پروتکل دستگاه واقعی را روی TCP صحبت می‌کند (قالب‌ها با خود PosInterface.dll تأیید شده‌اند):
 *   درخواست:  $PCBUY,<مبلغ ریال>,<شمارهٔ فاکتور>,<yyyyMMddHHmmss>,<MessageId>,0,<appId>,*<XOR>\r\n
 *   پاسخ:     $POSBUY,<کد>,<مبلغ>,<RRN>,<STAN>,<تاریخ>,<پذیرنده>,<پایانه>,<کارت>,<MessageId>,*<XOR>\r\n
 * چک‌سام = XOR همهٔ بایت‌های بین $ و * به‌صورت دو رقم هگز بزرگ؛ ویرگول انتهایی در چک‌سام حساب می‌شود.
 *
 * دو روش پاسخ مثل دستگاه واقعی:
 *   same      پاسخ روی همان اتصالی می‌آید که درخواست از آن رسید
 *   callback  دستگاه به آدرس فرستنده و پورت callbackPort وصل می‌شود و پاسخ را آنجا می‌دهد (پیش‌فرض کتابخانهٔ رسمی)
 *
 * رفتار هر پرداخت را می‌شود عوض کرد (پیش‌فرض با --behavior، لحظه‌ای با API کنترل).
 *
 * اجرا:   node pos-bridge/tools/virtual-pos/virtual-pos.mjs --port 17000 --control 17080
 * راهنما: node pos-bridge/tools/virtual-pos/virtual-pos.mjs --help
 * بدون هیچ وابستگی؛ فقط Node 18 یا بالاتر. API کنترل فقط روی 127.0.0.1 گوش می‌دهد.
 */

import net from "node:net";
import http from "node:http";
import { pathToFileURL } from "node:url";

/* ------------------------------ پروتکل ------------------------------ */

/** XOR همهٔ بایت‌های بدنه، دو رقم هگز بزرگ */
export function checksum(body) {
  let x = 0;
  for (const b of Buffer.from(body, "ascii")) x ^= b;
  return x.toString(16).toUpperCase().padStart(2, "0");
}

/** قاب کامل: $body*CS\r\n */
export function frame(body) {
  return Buffer.from(`$${body}*${checksum(body)}\r\n`, "ascii");
}

const MAX_MESSAGE_ID = 999999999;

/**
 * درخواست خرید را اعتبارسنجی و تجزیه می‌کند. strict یعنی ویرگول انتهایی لازم است (دستگاه واقعی
 * بدون آن ممکن است با کد ۴۱۲ رد کند؛ اسکریپت‌های دستی معمولاً آن را جا می‌اندازند).
 */
export function parseRequest(line, { strict = true } = {}) {
  const fail = (error, partial = {}) => ({ ok: false, error, ...partial });
  const text = String(line).replace(/[\r\n\0 ]+$/g, "");
  if (!text.startsWith("$")) return fail("frame must start with $");
  const star = text.lastIndexOf("*");
  if (star < 2 || text.length - star - 1 !== 2) return fail("checksum not found");
  const body = text.slice(1, star);
  const got = text.slice(star + 1).toUpperCase();
  const want = checksum(body);
  const f = body.split(",");
  const partial = {
    messageId: /^\d+$/.test(f[4] ?? "") ? f[4] : "0",
    amountText: /^\d+$/.test(f[1] ?? "") ? f[1] : "0",
  };
  if (got !== want) return fail(`bad checksum (got ${got}, expected ${want})`, partial);
  if (f[0] !== "PCBUY") return fail(`unknown message type ${f[0]}`, partial);
  if (f.length < 7) return fail("too few fields", partial);
  if (strict && (f.length !== 8 || f[7] !== "")) return fail("trailing comma missing", partial);
  if (!/^\d+$/.test(f[1]) || Number(f[1]) <= 0)
    return fail("amount must be a positive integer", partial);
  if (!/^\d+$/.test(f[2])) return fail("invoice must be digits", partial);
  if (!/^\d{14}$/.test(f[3])) return fail("datetime must be yyyyMMddHHmmss", partial);
  if (!/^\d+$/.test(f[4]) || Number(f[4]) <= 0 || Number(f[4]) > MAX_MESSAGE_ID)
    return fail("messageId out of range", partial);
  if (f[5] !== "0") return fail("split count must be 0", partial);
  return {
    ok: true,
    amount: Number(f[1]),
    amountText: f[1],
    invoice: f[2],
    datetime: f[3],
    messageId: f[4],
    appId: f[6],
  };
}

const pad2 = (n) => String(n).padStart(2, "0");
export function nowStamp(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

/* ------------------------------ تنظیمات و رفتارها ------------------------------ */

export const BEHAVIORS = {
  approve: "تأیید موفق (کد ۰) با RRN یکتا",
  decline:
    "رد با کد دلخواه (پیش‌فرض ۵۱: موجودی کافی نیست؛ ۵۰۲: لغو روی دستگاه؛ ۴۰۲: قطع ارتباط با سوئیچ)",
  "no-response": "هیچ پاسخی نمی‌دهد (مشتری کارت نکشید یا دستگاه هنگ کرد)",
  drop: "اتصال را بلافاصله می‌بندد، بی‌پاسخ",
  late: "پس از lateMs میلی‌ثانیه (پیش‌فرض ۵۰۰۰) تأیید می‌کند؛ برای تست «تأیید پس از لغو یا پایان زمان»",
  "bad-checksum": "تأیید با چک‌سام نادرست",
  "wrong-amount": "تأیید با مبلغی غیر از مبلغ درخواست",
  "wrong-terminal": "تأیید از شمارهٔ پایانهٔ دیگر",
  "duplicate-rrn": "تأیید با همان RRN تراکنش قبلی (پاسخ تکراری)",
  "no-rrn": "تأیید بدون RRN",
  malformed: "یک خط بی‌معنی به‌جای فریم",
  split: "تأیید معتبر که تکه‌تکه (۷ بایتی) فرستاده می‌شود",
  "no-crlf": "تأیید معتبر بدون \\r\\n انتهایی",
};

const DEFAULTS = {
  host: "127.0.0.1",
  port: 17000,
  /** 0 = بدون API کنترل */
  controlPort: 0,
  /** same | callback */
  response: "same",
  /** پورتی که دستگاه برای پاسخ برگشتی به PC وصل می‌شود (در کتابخانهٔ رسمی همان پورت دستگاه) */
  callbackPort: 17000,
  /** آدرس پاسخ برگشتی؛ خالی = آدرس فرستندهٔ درخواست */
  callbackHost: "",
  merchantId: "6618774",
  terminalId: "5634056",
  /** شمارهٔ کامل کارت؛ سرویس پل باید آن را ماسک کند */
  pan: "6037991234567391",
  /** زمان «کارت کشیدن مشتری» (میلی‌ثانیه) پیش از هر پاسخ */
  delayMs: 800,
  behavior: "approve",
  code: 51,
  lateMs: 5000,
  strictFormat: true,
  /** بستن اتصال پس از پاسخ روی همان اتصال */
  closeAfterReply: true,
  log: false,
};

function normalizeBehavior(b, cfg) {
  const o = typeof b === "string" ? { behavior: b } : { ...b };
  if (!Object.prototype.hasOwnProperty.call(BEHAVIORS, o.behavior))
    throw new Error(`unknown behavior: ${o.behavior}`);
  return { code: cfg.code, lateMs: cfg.lateMs, ...o };
}

const stripV4Mapped = (a) => String(a ?? "").replace(/^::ffff:/i, "");

/* ------------------------------ دستگاه مجازی ------------------------------ */

export function createVirtualPos(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const state = {
    cfg,
    requests: [],
    queue: [],
    rrnSeed: Number(String(Date.now()).slice(-9)) * 1000,
    stan: 100000,
    lastApprovedRrn: "",
    online: true,
    approved: 0,
    declined: 0,
  };
  const sockets = new Set();
  const timers = new Set();
  let tcp = null;
  let control = null;
  const say = (...a) => {
    if (cfg.log) console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...a);
  };

  const later = (ms, fn) => {
    const t = setTimeout(
      () => {
        timers.delete(t);
        fn();
      },
      Math.max(0, ms),
    );
    timers.add(t);
  };

  function nextRrn() {
    state.rrnSeed += 1;
    return String(state.rrnSeed % 1e12).padStart(12, "0");
  }

  function body(code, req, over = {}) {
    const approved = code === 0;
    const fields = {
      amount: over.amount ?? req.amountText,
      rrn: over.rrn ?? (approved ? nextRrn() : ""),
      stan: String(++state.stan % 1e6).padStart(6, "0"),
      terminal: over.terminal ?? cfg.terminalId,
      card: over.card ?? (approved ? cfg.pan : ""),
    };
    return `POSBUY,${code},${fields.amount},${fields.rrn},${fields.stan},${nowStamp()},${cfg.merchantId},${fields.terminal},${fields.card},${req.messageId},`;
  }

  /** پاسخ را به‌صورت بایت و روش ارسال برمی‌گرداند؛ null یعنی هیچ‌چیز نفرست */
  function buildReply(b, req) {
    switch (b.behavior) {
      case "approve":
      case "late": {
        const bd = body(0, req);
        state.lastApprovedRrn = bd.split(",")[3];
        return { data: frame(bd) };
      }
      case "decline":
        return { data: frame(body(Number(b.code), req)) };
      case "bad-checksum": {
        const bd = body(0, req);
        const wrong = (parseInt(checksum(bd), 16) ^ 0x01)
          .toString(16)
          .toUpperCase()
          .padStart(2, "0");
        return { data: Buffer.from(`$${bd}*${wrong}\r\n`, "ascii") };
      }
      case "wrong-amount":
        return { data: frame(body(0, req, { amount: String(req.amount + 10) })) };
      case "wrong-terminal":
        return { data: frame(body(0, req, { terminal: "9999999" })) };
      case "duplicate-rrn": {
        const rrn = state.lastApprovedRrn || nextRrn();
        state.lastApprovedRrn = rrn;
        return { data: frame(body(0, req, { rrn })) };
      }
      case "no-rrn":
        return { data: frame(body(0, req, { rrn: "" })) };
      case "malformed":
        return { data: Buffer.from("THIS-IS-NOT-A-FRAME\r\n", "ascii") };
      case "split": {
        const bd = body(0, req);
        state.lastApprovedRrn = bd.split(",")[3];
        return { data: frame(bd), chunk: 7 };
      }
      case "no-crlf": {
        const bd = body(0, req);
        state.lastApprovedRrn = bd.split(",")[3];
        return { data: frame(bd).subarray(0, -2) };
      }
      default:
        return null;
    }
  }

  function deliver(reply, sock, entry) {
    const writeChunks = (target, then) => {
      const { data, chunk } = reply;
      if (!chunk) {
        target.write(data, then);
        return;
      }
      let i = 0;
      const step = () => {
        if (target.destroyed) return;
        target.write(data.subarray(i, i + chunk));
        i += chunk;
        if (i < data.length) later(15, step);
        else then?.();
      };
      step();
    };
    if (cfg.response === "callback") {
      const host = cfg.callbackHost || stripV4Mapped(sock.remoteAddress);
      const c = net.connect({ host, port: Number(cfg.callbackPort) });
      sockets.add(c);
      c.on("close", () => sockets.delete(c));
      c.on("error", (e) => {
        entry.deliveryError = e.message;
        say("callback failed:", e.message);
      });
      c.on("connect", () => writeChunks(c, () => c.end()));
      if (cfg.closeAfterReply) later(50, () => sock.end());
      entry.delivered = `callback ${host}:${cfg.callbackPort}`;
    } else {
      writeChunks(sock, () => {
        if (cfg.closeAfterReply) sock.end();
      });
      entry.delivered = "same-socket";
    }
  }

  function handleLine(sock, line) {
    const req = parseRequest(line, { strict: cfg.strictFormat });
    const entry = {
      at: new Date().toISOString(),
      remote: stripV4Mapped(sock.remoteAddress),
      raw: line.replace(/[\r\n]+$/, ""),
      valid: req.ok,
    };
    state.requests.push(entry);
    if (state.requests.length > 500) state.requests.shift();

    if (!req.ok) {
      entry.error = req.error;
      entry.behavior = "reject-412";
      say("← invalid request:", req.error);
      const bd = `POSBUY,412,${req.amountText},,,${nowStamp()},${cfg.merchantId},${cfg.terminalId},,${req.messageId},`;
      deliver({ data: frame(bd) }, sock, entry);
      return;
    }
    Object.assign(entry, {
      amount: req.amount,
      invoice: req.invoice,
      messageId: req.messageId,
      appId: req.appId,
    });

    const b = normalizeBehavior(state.queue.length ? state.queue.shift() : cfg.behavior, cfg);
    entry.behavior = b.behavior;
    say(`← PCBUY amount=${req.amount} invoice=${req.invoice} msg=${req.messageId} → ${b.behavior}`);
    const wait = b.behavior === "late" ? b.lateMs : (b.delayMs ?? cfg.delayMs);
    later(wait, () => {
      if (sock.destroyed && cfg.response === "same") {
        entry.deliveryError = "client already disconnected";
        return;
      }
      if (b.behavior === "no-response") return;
      if (b.behavior === "drop") {
        sock.destroy();
        return;
      }
      const reply = buildReply(b, req);
      if (!reply) return;
      if (b.behavior === "decline") state.declined++;
      else if (!["malformed", "bad-checksum"].includes(b.behavior)) state.approved++;
      entry.replied = b.behavior;
      entry.reply = reply.data.toString("ascii").replace(/[\r\n]+$/, "");
      deliver(reply, sock, entry);
    });
  }

  function onConnection(sock) {
    sockets.add(sock);
    let buf = "";
    sock.setEncoding("latin1");
    sock.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i + 1);
        buf = buf.slice(i + 1);
        if (line.trim()) handleLine(sock, line);
      }
      if (buf.length > 4096) {
        sock.destroy();
        buf = "";
      }
    });
    sock.on("error", () => {});
    sock.on("close", () => sockets.delete(sock));
  }

  /* ---- راه‌اندازی TCP ---- */
  function listenTcp() {
    return new Promise((resolve, reject) => {
      const s = net.createServer(onConnection);
      s.once("error", reject);
      s.listen(Number(cfg.port), cfg.host, () => {
        cfg.port = s.address().port;
        tcp = s;
        state.online = true;
        resolve();
      });
    });
  }
  function closeTcp() {
    return new Promise((resolve) => {
      if (!tcp) return resolve();
      const s = tcp;
      tcp = null;
      state.online = false;
      for (const k of [...sockets]) k.destroy();
      s.close(() => resolve());
    });
  }

  /* ---- API کنترل ---- */
  function readJson(req) {
    return new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
        if (raw.length > 65536) req.destroy();
      });
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          resolve(null);
        }
      });
    });
  }
  const view = () => ({
    online: state.online,
    port: cfg.port,
    response: cfg.response,
    callbackPort: cfg.callbackPort,
    behavior: cfg.behavior,
    code: cfg.code,
    delayMs: cfg.delayMs,
    lateMs: cfg.lateMs,
    merchantId: cfg.merchantId,
    terminalId: cfg.terminalId,
    queue: state.queue,
    requestCount: state.requests.length,
    approved: state.approved,
    declined: state.declined,
  });
  async function onControl(req, res) {
    const send = (status, obj) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(obj));
    };
    const url = new URL(req.url, "http://x");
    const body = req.method === "POST" ? await readJson(req) : {};
    if (body === null) return send(400, { error: "invalid json" });
    try {
      const route = `${req.method} ${url.pathname}`;
      if (route === "GET /health") return send(200, { ok: true });
      if (route === "GET /state") return send(200, view());
      if (route === "GET /requests") return send(200, { items: state.requests });
      if (route === "DELETE /requests") {
        state.requests.length = 0;
        return send(200, { ok: true });
      }
      if (route === "POST /behavior") {
        normalizeBehavior(body, cfg);
        cfg.behavior = body;
        if (body.code) cfg.code = body.code;
        return send(200, view());
      }
      if (route === "POST /queue") {
        for (const it of body.items ?? [body]) normalizeBehavior(it, cfg);
        state.queue.push(...(body.items ?? [body]));
        return send(200, view());
      }
      if (route === "DELETE /queue") {
        state.queue.length = 0;
        return send(200, view());
      }
      if (route === "POST /config") {
        for (const k of [
          "response",
          "callbackPort",
          "callbackHost",
          "merchantId",
          "terminalId",
          "pan",
          "delayMs",
          "lateMs",
          "strictFormat",
          "closeAfterReply",
        ])
          if (k in body) cfg[k] = body[k];
        return send(200, view());
      }
      if (route === "POST /offline") {
        await closeTcp();
        return send(200, view());
      }
      if (route === "POST /online") {
        if (!tcp) await listenTcp();
        return send(200, view());
      }
      if (route === "POST /reset") {
        Object.assign(cfg, {
          ...DEFAULTS,
          host: cfg.host,
          port: cfg.port,
          controlPort: cfg.controlPort,
          log: cfg.log,
        });
        state.requests.length = 0;
        state.queue.length = 0;
        state.lastApprovedRrn = "";
        if (!tcp) await listenTcp();
        return send(200, view());
      }
      return send(404, { error: "not found" });
    } catch (e) {
      return send(400, { error: String(e.message ?? e) });
    }
  }

  return {
    state,
    cfg,
    get port() {
      return cfg.port;
    },
    get controlPort() {
      return control ? control.address().port : 0;
    },
    async start() {
      await listenTcp();
      // controlPort: 0 = بدون API کنترل؛ عدد مثبت = همان پورت؛ -1 = یک پورت آزاد (برای تست‌ها)
      const wanted = Number(cfg.controlPort) || 0;
      if (wanted !== 0) {
        await new Promise((resolve, reject) => {
          const s = http.createServer(onControl);
          s.once("error", reject);
          s.listen(wanted < 0 ? 0 : wanted, "127.0.0.1", () => {
            control = s;
            resolve();
          });
        });
      }
      return { port: cfg.port, controlPort: control ? control.address().port : 0 };
    },
    async stop() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      await closeTcp();
      for (const k of [...sockets]) k.destroy();
      await new Promise((r) => (control ? control.close(() => r()) : r()));
      control = null;
    },
  };
}

/* ------------------------------ خط فرمان ------------------------------ */

const HELP = `کارت‌خوان مجازی PC-POS

  node virtual-pos.mjs [گزینه‌ها]

  --host <ip>            آدرس گوش‌دادن (پیش‌فرض 127.0.0.1؛ برای کیوسک روی شبکه 0.0.0.0)
  --port <n>             پورت دستگاه (پیش‌فرض 17000)
  --control <n>          پورت API کنترل روی 127.0.0.1 (پیش‌فرض خاموش)
  --response same|callback   روش پاسخ (پیش‌فرض same)
  --callback-port <n>    پورت PC برای پاسخ برگشتی (پیش‌فرض 17000)
  --callback-host <ip>   آدرس PC برای پاسخ برگشتی (پیش‌فرض آدرس فرستندهٔ درخواست)
  --behavior <نام>       رفتار پیش‌فرض (پایین)
  --code <n>             کد رد برای behavior=decline (پیش‌فرض 51)
  --delay <ms>           زمان کارت‌کشیدن مشتری (پیش‌فرض 800)
  --late <ms>            تأخیر behavior=late (پیش‌فرض 5000)
  --merchant <id>  --terminal <id>  --pan <شماره کارت>
  --lenient              ویرگول انتهایی درخواست را اجباری نکن
  --quiet                لاگ نکن

رفتارها:
${Object.entries(BEHAVIORS)
  .map(([k, v]) => `  ${k.padEnd(15)} ${v}`)
  .join("\n")}

API کنترل (JSON، فقط 127.0.0.1):
  GET /state  GET /requests  DELETE /requests  POST /behavior {behavior,code?}
  POST /queue {items:[{behavior,...},...]}  DELETE /queue  POST /config {...}
  POST /offline  POST /online  POST /reset`;

function parseArgs(argv) {
  const o = {};
  const map = {
    "--host": "host",
    "--port": "port",
    "--control": "controlPort",
    "--response": "response",
    "--callback-port": "callbackPort",
    "--callback-host": "callbackHost",
    "--behavior": "behavior",
    "--code": "code",
    "--delay": "delayMs",
    "--late": "lateMs",
    "--merchant": "merchantId",
    "--terminal": "terminalId",
    "--pan": "pan",
  };
  const numeric = new Set(["port", "controlPort", "callbackPort", "code", "delayMs", "lateMs"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      o.help = true;
      continue;
    }
    if (a === "--lenient") {
      o.strictFormat = false;
      continue;
    }
    if (a === "--quiet") {
      o.log = false;
      continue;
    }
    const key = map[a];
    if (!key) throw new Error(`گزینهٔ ناشناخته: ${a} (برای راهنما --help)`);
    const v = argv[++i];
    if (v === undefined) throw new Error(`${a} مقدار لازم دارد`);
    o[key] = numeric.has(key) ? Number(v) : v;
    if (numeric.has(key) && !Number.isFinite(o[key])) throw new Error(`${a} باید عدد باشد`);
  }
  return o;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.behavior && !(args.behavior in BEHAVIORS))
    throw new Error(`رفتار ناشناخته: ${args.behavior}`);
  if (args.response && !["same", "callback"].includes(args.response))
    throw new Error("--response باید same یا callback باشد");
  const pos = createVirtualPos({ log: args.log !== false, ...args });
  const { port, controlPort } = await pos.start();
  console.log(
    `کارت‌خوان مجازی روی ${pos.cfg.host}:${port} بالا آمد — پاسخ: ${pos.cfg.response}، رفتار: ${pos.cfg.behavior}`,
  );
  if (controlPort) console.log(`API کنترل: http://127.0.0.1:${controlPort}/state`);
  const quit = async () => {
    await pos.stop();
    process.exit(0);
  };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(String(e.message ?? e));
    process.exit(1);
  });
}
