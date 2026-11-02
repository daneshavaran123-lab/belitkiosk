import { afterEach, describe, expect, it } from "vitest";
import net from "node:net";
// @ts-expect-error — ابزار Node بدون تایپ است
import {
  BEHAVIORS,
  checksum,
  createVirtualPos,
  frame,
  parseRequest,
} from "../pos-bridge/tools/virtual-pos/virtual-pos.mjs";

/** درخواست خریدی که همان قالب سرویس پل را دارد */
const request = (messageId = 1, amount = 10000, invoice = "12345") =>
  frame(`PCBUY,${amount},${invoice},20261026120000,${messageId},0,,`).toString("ascii");

/** یک اتصال می‌گیرد، درخواست را می‌فرستد و تا بسته‌شدن یا مهلت، هرچه برگشت را جمع می‌کند */
function ask(
  port: number,
  data: string | Buffer,
  waitMs = 1500,
): Promise<{ text: string; closed: boolean }> {
  return new Promise((resolve) => {
    let text = "";
    let closed = false;
    const s = net.connect(port, "127.0.0.1", () => s.write(data));
    s.setEncoding("latin1");
    s.on("data", (d) => (text += d));
    s.on("close", () => {
      closed = true;
      resolve({ text, closed });
    });
    s.on("error", () => {});
    setTimeout(() => {
      s.destroy();
      resolve({ text, closed });
    }, waitMs);
  });
}

const fields = (reply: string) => {
  const m = /^\$(POSBUY,.*)\*([0-9A-F]{2})\r\n$/.exec(reply);
  if (!m) return null;
  const f = m[1].split(",");
  return {
    checksum: m[2],
    valid: checksum(m[1]) === m[2],
    code: f[1],
    amount: f[2],
    rrn: f[3],
    stan: f[4],
    terminal: f[7],
    card: f[8],
    messageId: f[9],
    body: m[1],
  };
};

let running: { stop(): Promise<void> }[] = [];
async function start(options: Record<string, unknown> = {}) {
  const pos = createVirtualPos({ port: 0, controlPort: -1, delayMs: 10, ...options });
  const addr = await pos.start();
  running.push(pos);
  const control = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${addr.controlPort}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return { pos, port: addr.port as number, control };
}
afterEach(async () => {
  await Promise.all(running.map((p) => p.stop()));
  running = [];
});

describe("قاب و چک‌سام", () => {
  it("چک‌سام نمونهٔ شناخته‌شده", () => {
    expect(checksum("PCBUY,10000,12345,20261026120000,1,0,,")).toBe("70");
    expect(frame("PCBUY,10000,12345,20261026120000,1,0,,").toString()).toBe(
      "$PCBUY,10000,12345,20261026120000,1,0,,*70\r\n",
    );
  });

  it("چک‌سام دو رقم هگز بزرگ با صفر پیشین است", () => {
    expect(checksum("")).toBe("00");
    expect(checksum("A")).toBe("41");
    expect(checksum("AA")).toBe("00");
  });
});

describe("تجزیهٔ درخواست", () => {
  it("درخواست معتبر را می‌پذیرد", () => {
    const r = parseRequest(request(7, 250000, "98"));
    expect(r).toMatchObject({
      ok: true,
      amount: 250000,
      invoice: "98",
      messageId: "7",
      datetime: "20261026120000",
    });
  });

  it("بدون ویرگول انتهایی در حالت سخت‌گیر رد می‌شود و در حالت lenient قبول", () => {
    const line = frame("PCBUY,10000,12345,20261026120000,1,0,").toString();
    expect(parseRequest(line)).toMatchObject({ ok: false, error: "trailing comma missing" });
    expect(parseRequest(line, { strict: false })).toMatchObject({ ok: true });
  });

  it.each([
    ["چک‌سام غلط", "$PCBUY,10000,12345,20261026120000,1,0,,*00\r\n", /bad checksum/],
    ["بدون $", "PCBUY,10000,1,20261026120000,1,0,,*70\r\n", /start with/],
    ["نوع ناشناخته", `${frame("PCFOO,10000,1,20261026120000,1,0,,")}`, /unknown message type/],
    ["مبلغ صفر", `${frame("PCBUY,0,1,20261026120000,1,0,,")}`, /amount/],
    ["مبلغ اعشاری", `${frame("PCBUY,10.5,1,20261026120000,1,0,,")}`, /amount/],
    ["تاریخ کوتاه", `${frame("PCBUY,10000,1,2026,1,0,,")}`, /datetime/],
    ["messageId صفر", `${frame("PCBUY,10000,1,20261026120000,0,0,,")}`, /messageId/],
    [
      "messageId بزرگ‌تر از ۹ رقم",
      `${frame("PCBUY,10000,1,20261026120000,1000000000,0,,")}`,
      /messageId/,
    ],
    ["شمارندهٔ تقسیم غیرصفر", `${frame("PCBUY,10000,1,20261026120000,1,2,,")}`, /split/],
  ])("%s رد می‌شود", (_name, line, why) => {
    const r = parseRequest(line);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(why);
  });
});

describe("پاسخ هم‌اتصال (same)", () => {
  it("تأیید: کد ۰، مبلغ و messageId همان درخواست، RRN و کارت کامل", async () => {
    const { port } = await start();
    const { text, closed } = await ask(port, request(42, 123000));
    const r = fields(text)!;
    expect(r.valid).toBe(true);
    expect(r).toMatchObject({
      code: "0",
      amount: "123000",
      messageId: "42",
      terminal: "5634056",
      card: "6037991234567391",
    });
    expect(r.rrn).toMatch(/^\d{12}$/);
    expect(closed).toBe(true);
  });

  it("هر تأیید RRN یکتا دارد", async () => {
    const { port } = await start();
    const a = fields((await ask(port, request(1))).text)!;
    const b = fields((await ask(port, request(2))).text)!;
    expect(a.rrn).not.toBe(b.rrn);
  });

  it("رد با کد ۵۱: بدون RRN و بدون کارت", async () => {
    const { port } = await start({ behavior: "decline", code: 51 });
    const r = fields((await ask(port, request(5))).text)!;
    expect(r).toMatchObject({ valid: true, code: "51", rrn: "", card: "", messageId: "5" });
  });

  it("درخواست با چک‌سام غلط → ۴۱۲ و چیزی تأیید نمی‌شود", async () => {
    const { port, control } = await start();
    const r = fields((await ask(port, "$PCBUY,10000,12345,20261026120000,9,0,,*00\r\n")).text)!;
    expect(r).toMatchObject({ valid: true, code: "412", messageId: "9" });
    expect((await control("GET", "/state")).approved).toBe(0);
  });

  it("درخواست بدون ویرگول انتهایی → ۴۱۲", async () => {
    const { port } = await start();
    const r = fields(
      (await ask(port, frame("PCBUY,10000,12345,20261026120000,3,0,").toString())).text,
    )!;
    expect(r.code).toBe("412");
  });

  it("درخواست تکه‌تکه (چند بسته TCP) درست جمع می‌شود", async () => {
    const { port } = await start();
    const req = request(11);
    const reply = await new Promise<string>((resolve) => {
      let text = "";
      const s = net.connect(port, "127.0.0.1", async () => {
        for (let i = 0; i < req.length; i += 5) {
          s.write(req.slice(i, i + 5));
          await new Promise((r) => setTimeout(r, 5));
        }
      });
      s.setEncoding("latin1");
      s.on("data", (d) => (text += d));
      s.on("close", () => resolve(text));
    });
    expect(fields(reply)).toMatchObject({ valid: true, code: "0", messageId: "11" });
  });
});

describe("رفتارهای ناسالم", () => {
  it("no-response: چیزی نمی‌فرستد ولی درخواست ثبت می‌شود", async () => {
    const { port, control } = await start({ behavior: "no-response" });
    const { text } = await ask(port, request(1), 400);
    expect(text).toBe("");
    expect((await control("GET", "/requests")).items).toHaveLength(1);
  });

  it("drop: اتصال را بی‌پاسخ می‌بندد", async () => {
    const { port } = await start({ behavior: "drop" });
    const { text, closed } = await ask(port, request(1));
    expect(text).toBe("");
    expect(closed).toBe(true);
  });

  it("bad-checksum: چک‌سام پاسخ غلط است", async () => {
    const { port } = await start({ behavior: "bad-checksum" });
    const r = fields((await ask(port, request(1))).text)!;
    expect(r.valid).toBe(false);
    expect(r.code).toBe("0");
  });

  it("wrong-amount و wrong-terminal", async () => {
    const a = await start({ behavior: "wrong-amount" });
    expect(fields((await ask(a.port, request(1, 10000))).text)).toMatchObject({
      valid: true,
      code: "0",
      amount: "10010",
    });
    const t = await start({ behavior: "wrong-terminal" });
    expect(fields((await ask(t.port, request(1))).text)).toMatchObject({
      valid: true,
      code: "0",
      terminal: "9999999",
    });
  });

  it("duplicate-rrn: RRN تأیید قبلی را تکرار می‌کند", async () => {
    const { port, control } = await start();
    const first = fields((await ask(port, request(1))).text)!;
    await control("POST", "/behavior", { behavior: "duplicate-rrn" });
    const second = fields((await ask(port, request(2))).text)!;
    expect(second.code).toBe("0");
    expect(second.rrn).toBe(first.rrn);
  });

  it("no-rrn، malformed و no-crlf", async () => {
    const n = await start({ behavior: "no-rrn" });
    expect(fields((await ask(n.port, request(1))).text)).toMatchObject({ code: "0", rrn: "" });
    const m = await start({ behavior: "malformed" });
    expect((await ask(m.port, request(1))).text).toBe("THIS-IS-NOT-A-FRAME\r\n");
    const c = await start({ behavior: "no-crlf" });
    const { text } = await ask(c.port, request(1), 500);
    expect(text.endsWith("\r\n")).toBe(false);
    expect(text).toMatch(
      /^\$POSBUY,0,10000,\d{12},\d{6},\d{14},6618774,5634056,6037991234567391,1,\*[0-9A-F]{2}$/,
    );
  });

  it("split: پاسخ معتبر ولی تکه‌تکه می‌رسد", async () => {
    const { port } = await start({ behavior: "split" });
    const chunks: string[] = [];
    await new Promise<void>((resolve) => {
      const s = net.connect(port, "127.0.0.1", () => s.write(request(1)));
      s.setEncoding("latin1");
      s.on("data", (d) => chunks.push(String(d)));
      s.on("close", () => resolve());
    });
    expect(chunks.length).toBeGreaterThan(3);
    expect(fields(chunks.join(""))).toMatchObject({ valid: true, code: "0" });
  });

  it("late: پس از lateMs تأیید می‌کند", async () => {
    const { port } = await start({ behavior: "late", lateMs: 300 });
    const t0 = Date.now();
    const { text } = await ask(port, request(1), 3000);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(280);
    expect(fields(text)).toMatchObject({ valid: true, code: "0" });
  });
});

describe("پاسخ برگشتی (callback)", () => {
  it("دستگاه خودش به callbackPort وصل می‌شود و پاسخ را آنجا می‌دهد", async () => {
    const replies: string[] = [];
    const listener = net.createServer((s) => {
      s.setEncoding("latin1");
      s.on("data", (d) => replies.push(String(d)));
    });
    await new Promise<void>((r) => listener.listen(0, "127.0.0.1", () => r()));
    const callbackPort = (listener.address() as net.AddressInfo).port;
    try {
      const { port } = await start({ response: "callback", callbackPort });
      const direct = await ask(port, request(21, 5000), 800);
      expect(direct.text).toBe(""); // روی خود اتصال درخواست چیزی نمی‌آید
      await new Promise((r) => setTimeout(r, 150));
      expect(fields(replies.join(""))).toMatchObject({
        valid: true,
        code: "0",
        amount: "5000",
        messageId: "21",
      });
    } finally {
      listener.close();
    }
  });

  it("اگر کسی روی callbackPort گوش ندهد، خطای تحویل در /requests ثبت می‌شود", async () => {
    const free = net.createServer();
    await new Promise<void>((r) => free.listen(0, "127.0.0.1", () => r()));
    const deadPort = (free.address() as net.AddressInfo).port;
    await new Promise((r) => free.close(r));
    const { port, control } = await start({ response: "callback", callbackPort: deadPort });
    await ask(port, request(1), 500);
    const { items } = await control("GET", "/requests");
    expect(items[0].deliveryError).toMatch(/ECONNREFUSED/);
  });
});

describe("API کنترل", () => {
  it("صف رفتارها به ترتیب مصرف می‌شود و بعد به پیش‌فرض برمی‌گردد", async () => {
    const { port, control } = await start();
    await control("POST", "/queue", { items: [{ behavior: "decline", code: 55 }, "approve"] });
    expect(fields((await ask(port, request(1))).text)!.code).toBe("55");
    expect(fields((await ask(port, request(2))).text)!.code).toBe("0");
    expect(fields((await ask(port, request(3))).text)!.code).toBe("0");
    expect((await control("GET", "/state")).queue).toEqual([]);
  });

  it("POST /behavior پیش‌فرض را عوض می‌کند و رفتار ناشناخته ۴۰۰ می‌دهد", async () => {
    const { port, control } = await start();
    await control("POST", "/behavior", { behavior: "decline", code: 51 });
    expect(fields((await ask(port, request(1))).text)!.code).toBe("51");
    expect(await control("POST", "/behavior", { behavior: "nope" })).toMatchObject({
      error: expect.stringContaining("unknown behavior"),
    });
  });

  it("/requests همهٔ درخواست‌ها را با مبلغ و شمارهٔ فاکتور نگه می‌دارد و DELETE پاکشان می‌کند", async () => {
    const { port, control } = await start();
    await ask(port, request(1, 7000, "555"));
    const { items } = await control("GET", "/requests");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      valid: true,
      amount: 7000,
      invoice: "555",
      messageId: "1",
      behavior: "approve",
      delivered: "same-socket",
      reply: expect.stringMatching(/^\$POSBUY,0,7000,\d{12},/),
    });
    await control("DELETE", "/requests");
    expect((await control("GET", "/requests")).items).toEqual([]);
  });

  it("offline اتصال را رد می‌کند و online دوباره برمی‌گرداند", async () => {
    const { port, control } = await start();
    await control("POST", "/offline");
    const refused = await new Promise<string>((resolve) => {
      const s = net.connect(port, "127.0.0.1");
      s.on("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? "error"));
      s.on("connect", () => {
        s.destroy();
        resolve("connected");
      });
    });
    expect(refused).toBe("ECONNREFUSED");
    await control("POST", "/online");
    expect(fields((await ask(port, request(1))).text)).toMatchObject({ code: "0" });
  });

  it("همهٔ رفتارهای مستندشده شناخته‌شده‌اند", () => {
    expect(Object.keys(BEHAVIORS)).toEqual(
      expect.arrayContaining([
        "approve",
        "decline",
        "no-response",
        "drop",
        "late",
        "bad-checksum",
        "wrong-amount",
        "wrong-terminal",
        "duplicate-rrn",
        "no-rrn",
        "malformed",
        "split",
        "no-crlf",
      ]),
    );
  });
});
