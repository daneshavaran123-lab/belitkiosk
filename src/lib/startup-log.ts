/**
 * لاگ یک‌بارهٔ زمان استارت سرور — برای تشخیص سریع خطای «پورت اشتباه» روی لیارا.
 * فقط وضعیت متغیرها چاپ می‌شود، هرگز مقدار آن‌ها.
 */

let printed = false;

function flag(name: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? "✔ تنظیم‌شده" : "✘ تنظیم‌نشده";
}

export function logStartupInfo(): void {
  if (printed) return;
  printed = true;

  const host = process.env["HOST"] ?? process.env["NITRO_HOST"] ?? "(پیش‌فرض nitro)";
  const port = process.env["PORT"] ?? process.env["NITRO_PORT"] ?? "(پیش‌فرض 3000)";
  const mode = process.env["NODE_ENV"] ?? "unknown";
  const preset = process.env["NITRO_PRESET"] ?? process.env["LOVABLE_NITRO_PRESET"] ?? "(پیش‌فرض)";

  const lines = [
    "──────── راه‌اندازی سرور موزه کشتی ────────",
    `HOST            : ${host}`,
    `PORT            : ${port}`,
    `NODE_ENV        : ${mode}`,
    `NITRO_PRESET    : ${preset}`,
    `SUPABASE_URL    : ${flag("SUPABASE_URL")}`,
    `SUPABASE_KEY    : ${flag("SUPABASE_PUBLISHABLE_KEY")}`,
    `VITE_SUPABASE_* : ${flag("VITE_SUPABASE_URL")} / ${flag("VITE_SUPABASE_PUBLISHABLE_KEY")}`,
    "سلامت سرویس     : GET /api/health",
    "───────────────────────────────────────────",
  ];
  console.info(lines.join("\n"));

  if (!process.env["PORT"]) {
    console.warn(
      "[startup] هشدار: متغیر PORT تعریف نشده است. روی لیارا باید سرویس روی PORT محیطی گوش کند.",
    );
  }
  const h = process.env["HOST"];
  if (h && h !== "0.0.0.0" && h !== "::") {
    console.warn(
      `[startup] هشدار: HOST برابر «${h}» است. برای لیارا باید 0.0.0.0 باشد وگرنه خطای listen می‌گیرید.`,
    );
  }
  if (!process.env["SUPABASE_URL"] || !process.env["SUPABASE_PUBLISHABLE_KEY"]) {
    console.warn(
      "[startup] هشدار: متغیرهای SUPABASE_* روی سرور تنظیم نشده‌اند؛ بررسی سلامت دیتابیس ناموفق خواهد بود.",
    );
  }
}
