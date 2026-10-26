#!/usr/bin/env node
/**
 * تست دود (smoke test) بعد از استقرار روی لیارا.
 * استفاده:  npm run smoke -- https://your-app.liara.run
 * یا:       BASE_URL=https://your-app.liara.run npm run smoke
 */

const base = (process.argv[2] || process.env.BASE_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);

const pages = [
  ["/", "صفحهٔ اصلی", "موزه"],
  ["/tickets", "خرید بلیط", "بلیط"],
  ["/cart", "سبد خرید", "سبد"],
  ["/bookstore", "کتاب‌فروشی", null],
  ["/cafe", "کافه موزه", null],
  ["/souvenirs", "یادگاری‌ها", null],
  ["/membership", "عضویت سالانه", null],
  ["/events", "رویدادها", null],
  ["/support", "حمایت و نظرسنجی", null],
  ["/admin/login", "ورود مدیریت", null],
  ["/admin/pos", "پیکربندی کارت‌خوان (بدون دستگاه)", null],
];

const results = [];

async function get(path, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(base + path, { signal: ctrl.signal, redirect: "follow" });
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

function record(name, ok, note) {
  results.push({ name, ok, note: note ?? "" });
  console.log(`${ok ? "✅" : "❌"} ${name}${note ? ` — ${note}` : ""}`);
}

async function checkHealth() {
  try {
    const { status, body } = await get("/api/health");
    const json = JSON.parse(body);
    const ok = status === 200 && (json.status === "ok" || json.status === "degraded");
    record("/api/health", ok, `status=${json.status} db=${json.db} port=${json.port ?? "-"}`);
    if (json.db === "down") record("اتصال دیتابیس", false, "متغیرهای SUPABASE_* را بررسی کنید");
  } catch (e) {
    record("/api/health", false, e.message);
  }
}

async function checkPage(path, label, needle) {
  try {
    const { status, body } = await get(path);
    let ok = status === 200;
    let note = `HTTP ${status}`;
    if (ok && /"unhandled":true/.test(body)) {
      ok = false;
      note = "خطای SSR (unhandled)";
    }
    if (ok && needle && !body.includes(needle)) {
      ok = false;
      note = `محتوای «${needle}» یافت نشد`;
    }
    record(`${path} (${label})`, ok, note);
  } catch (e) {
    record(`${path} (${label})`, false, e.message);
  }
}

console.log(`\n🔎 smoke test روی ${base}\n`);
await checkHealth();
for (const [path, label, needle] of pages) await checkPage(path, label, needle);

const failed = results.filter((r) => !r.ok);
console.log(`\nنتیجه: ${results.length - failed.length}/${results.length} موفق`);
if (failed.length) {
  console.log("موارد ناموفق:");
  for (const f of failed) console.log(` - ${f.name}: ${f.note}`);
  process.exit(1);
}
console.log("همهٔ بررسی‌ها موفق بود ✅");
