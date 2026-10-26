/**
 * طبقه‌بندی خطاهای ping/handshake کارت‌خوان به کدهای کوتاه، به‌همراه راهنمای
 * فارسی و مشخص کردن منشأ مشکل (شبکه / دستگاه / سرویس پل / تنظیمات).
 */

export type PosErrorCode =
  | "OK"
  | "BRIDGE_DOWN"
  | "BRIDGE_UNAUTHORIZED"
  | "BRIDGE_ERROR"
  | "NET_UNREACHABLE"
  | "NET_TIMEOUT"
  | "NET_REFUSED"
  | "NET_WRONG_SUBNET"
  | "NET_CABLE_UNPLUGGED"
  | "DEV_HANDSHAKE_FAILED"
  | "DEV_BUSY"
  | "DEV_SERIAL_MISMATCH"
  | "DEV_MODEL_MISMATCH"
  | "DEV_FIRMWARE_MISMATCH"
  | "CFG_INVALID"
  | "UNKNOWN";

/** منشأ مشکل — برای جملهٔ «مشکل از کجاست» */
export type PosErrorSource = "ok" | "network" | "device" | "bridge" | "config" | "unknown";

export interface PosErrorInfo {
  code: PosErrorCode;
  /** برچسب کوتاه فارسی */
  label: string;
  source: PosErrorSource;
  /** راهنمای یک‌خطی رفع مشکل */
  hint: string;
}

export const POS_ERROR_CATALOG: Record<PosErrorCode, PosErrorInfo> = {
  OK: {
    code: "OK",
    label: "بدون خطا",
    source: "ok",
    hint: "ارتباط با کارت‌خوان برقرار است.",
  },
  BRIDGE_DOWN: {
    code: "BRIDGE_DOWN",
    label: "سرویس پل بالا نیست",
    source: "bridge",
    hint: "روی همین کیوسک فایل pos-bridge\\run.bat را اجرا کنید تا سرویس روی 127.0.0.1:9099 بالا بیاید.",
  },
  BRIDGE_UNAUTHORIZED: {
    code: "BRIDGE_UNAUTHORIZED",
    label: "توکن سرویس پل نادرست",
    source: "config",
    hint: "مقدار accessToken در appsettings.json را با توکن واردشده در همین صفحه یکسان کنید.",
  },
  BRIDGE_ERROR: {
    code: "BRIDGE_ERROR",
    label: "خطای داخلی سرویس پل",
    source: "bridge",
    hint: "پنجرهٔ سرویس pos-bridge را ببندید و دوباره اجرا کنید؛ متن خطا در لاگ زنده دیده می‌شود.",
  },
  NET_UNREACHABLE: {
    code: "NET_UNREACHABLE",
    label: "دستگاه در شبکه پیدا نشد",
    source: "network",
    hint: "کیوسک و کارت‌خوان باید هر دو روی شبکهٔ Museum2.5 باشند؛ IP دستگاه را از منوی «اطلاعات سیستم» بخوانید.",
  },
  NET_TIMEOUT: {
    code: "NET_TIMEOUT",
    label: "پاسخی از دستگاه نیامد",
    source: "network",
    hint: "سیگنال وای‌فای ضعیف است یا IP دستگاه عوض شده — یک بار «جست‌وجوی خودکار در شبکه» بزنید.",
  },
  NET_REFUSED: {
    code: "NET_REFUSED",
    label: "پورت دستگاه بسته است",
    source: "device",
    hint: "کارت‌خوان را در صفحهٔ اصلی (آماده) بگذارید و مطمئن شوید حالت پذیرش اتصال شبکه روی آن فعال است.",
  },
  NET_WRONG_SUBNET: {
    code: "NET_WRONG_SUBNET",
    label: "کیوسک و کارت‌خوان روی یک شبکه نیستند",
    source: "network",
    hint: "IP کیوسک و IP دستگاه باید سه بخش اول یکسان داشته باشند (مثلاً هر دو 192.168.16.x). کابل هر دو را به یک سوییچ/مودم بزنید.",
  },
  NET_CABLE_UNPLUGGED: {
    code: "NET_CABLE_UNPLUGGED",
    label: "کابل شبکهٔ دستگاه وصل نیست",
    source: "network",
    hint: "کابل را در پورت LAN پشت دستگاه محکم کنید؛ چراغ سبز پورت باید روشن و چراغ زرد چشمک‌زن باشد.",
  },
  DEV_SERIAL_MISMATCH: {
    code: "DEV_SERIAL_MISMATCH",
    label: "دستگاه پیداشده کارت‌خوان موزه نیست",
    source: "device",
    hint: "سریال پاسخ‌دهنده با 2500206135 یکی نیست — IP دستگاه دیگری وارد شده است؛ «جست‌وجوی خودکار» را بزنید و مورد با علامت «سریال تأیید شد» را انتخاب کنید.",
  },
  DEV_HANDSHAKE_FAILED: {
    code: "DEV_HANDSHAKE_FAILED",
    label: "دست‌دهی با دستگاه ناموفق",
    source: "device",
    hint: "کد پذیرنده، کد پایانه و شمارهٔ سریال را با «اطلاعات سیستم» روی خود دستگاه مقایسه کنید.",
  },
  DEV_BUSY: {
    code: "DEV_BUSY",
    label: "دستگاه مشغول است",
    source: "device",
    hint: "تراکنش نیمه‌کارهٔ روی صفحهٔ کارت‌خوان را با دکمهٔ قرمز ببندید و دوباره تلاش کنید.",
  },
  DEV_MODEL_MISMATCH: {
    code: "DEV_MODEL_MISMATCH",
    label: "مدل دستگاه با مشخصات ثبت‌شده فرق دارد",
    source: "device",
    hint: "دستگاه پاسخ‌دهنده کارت‌خوان ثبت‌شدهٔ موزه (PAX Q58) نیست — IP را بررسی کنید یا مشخصات دستگاه جدید را در پروفایل به‌روز کنید.",
  },
  DEV_FIRMWARE_MISMATCH: {
    code: "DEV_FIRMWARE_MISMATCH",
    label: "نسخهٔ فریم‌ور با مقدار ثبت‌شده فرق دارد",
    source: "device",
    hint: "فریم‌ور دستگاه به‌روزرسانی شده است؛ اگر پرداخت درست کار می‌کند فقط مقدار ثبت‌شده را اصلاح کنید.",
  },
  CFG_INVALID: {
    code: "CFG_INVALID",
    label: "تنظیمات ناقص است",
    source: "config",
    hint: "IP، پورت و شمارهٔ سریال را کامل و درست وارد کنید (نمونه: 192.168.16.87 و پورت 8888).",
  },
  UNKNOWN: {
    code: "UNKNOWN",
    label: "خطای طبقه‌بندی‌نشده",
    source: "unknown",
    hint: "متن خام خطا را از گزارش پشتیبانی برای تیم فنی بفرستید.",
  },
};

export function posErrorInfo(code: PosErrorCode | undefined): PosErrorInfo {
  return POS_ERROR_CATALOG[code ?? "UNKNOWN"] ?? POS_ERROR_CATALOG.UNKNOWN;
}

/** جملهٔ صریح «مشکل از کجاست» بر اساس منشأ */
export function posSourceSentence(source: PosErrorSource): string {
  switch (source) {
    case "ok":
      return "همه‌چیز سالم است — دستگاه آمادهٔ پرداخت است.";
    case "network":
      return "مشکل از شبکه است (وای‌فای یا آدرس دستگاه).";
    case "device":
      return "مشکل از خودِ کارت‌خوان است.";
    case "bridge":
      return "مشکل از سرویس پل روی کیوسک است.";
    case "config":
      return "مشکل از تنظیمات واردشده است.";
    default:
      return "منشأ مشکل مشخص نیست.";
  }
}

/** گام‌های پیشنهادی برای هر منشأ */
export function posSourceSteps(source: PosErrorSource): string[] {
  switch (source) {
    case "network":
      return [
        "اگر کابل شبکه وصل است، چراغ پورت LAN پشت دستگاه را ببینید (سبز روشن).",
        "روی کارت‌خوان مسیر «اطلاعات سیستم» را باز کنید و IP فعال (LAN یا WiFi) را بخوانید.",
        "همان IP را در کادر «IP دستگاه» بگذارید و «تأیید همین آدرس» را بزنید.",
        "اگر IP را نمی‌دانید، «جست‌وجوی خودکار در شبکه» را بزنید تا با تطبیق سریال پیدا شود.",
        "کیوسک و کارت‌خوان باید در یک زیرشبکه باشند (سه بخش اول IP یکسان).",
      ];
    case "device":
      return [
        "کارت‌خوان را به صفحهٔ اصلی برگردانید (دکمهٔ قرمز).",
        "دستگاه را خاموش و روشن کنید و منتظر اتصال وای‌فای بمانید.",
        "کد پذیرنده/پایانه/سریال را با اطلاعات سیستم دستگاه مقایسه کنید.",
      ];
    case "bridge":
      return [
        "فایل pos-bridge\\run.bat را روی کیوسک اجرا کنید.",
        "آدرس سرویس پل باید http://127.0.0.1:9099 باشد.",
        "پنجرهٔ سرویس را ببندید و دوباره باز کنید، سپس «شروع اتصال» را بزنید.",
      ];
    case "config":
      return [
        "IP و پورت را دوباره وارد کنید (پیش‌فرض پورت 8888).",
        "اگر توکن سرویس پل تنظیم شده، همان مقدار را در این صفحه ذخیره کنید.",
      ];
    default:
      return ["گزارش پشتیبانی را دانلود و برای تیم فنی ارسال کنید."];
  }
}

/** طبقه‌بندی نتیجهٔ ping سرویس پل به کد خطا */
export function classifyPing(input: {
  ok?: boolean;
  stage?: string;
  message?: string;
  httpStatus?: number;
  unreachable?: boolean;
  /** سریال پاسخ دستگاه با سریال ثبت‌شده نمی‌خواند */
  serialMismatch?: boolean;
}): PosErrorCode {
  if (input.unreachable) return "BRIDGE_DOWN";
  if (input.httpStatus === 401 || input.httpStatus === 403) return "BRIDGE_UNAUTHORIZED";
  if (input.httpStatus && input.httpStatus >= 500) return "BRIDGE_ERROR";
  if (input.httpStatus && input.httpStatus >= 400) return "CFG_INVALID";
  if (input.serialMismatch) return "DEV_SERIAL_MISMATCH";
  if (input.ok) return "OK";

  const m = (input.message ?? "").toLowerCase();
  const fa = input.message ?? "";

  if (fa.includes("کابل") || m.includes("cable") || m.includes("link down"))
    return "NET_CABLE_UNPLUGGED";
  if (m.includes("no route") || fa.includes("زیرشبکه")) return "NET_WRONG_SUBNET";
  if (m.includes("refused") || fa.includes("باز نشد")) return "NET_REFUSED";
  if (m.includes("timed out") || m.includes("timeout") || fa.includes("زمان")) return "NET_TIMEOUT";
  if (m.includes("unreachable") || fa.includes("پیدا نشد"))
    return "NET_UNREACHABLE";
  if (fa.includes("مشغول") || m.includes("busy")) return "DEV_BUSY";
  if (input.stage === "handshake" || fa.includes("handshake")) return "DEV_HANDSHAKE_FAILED";
  if (input.stage === "network") return "NET_UNREACHABLE";
  if (input.stage === "tcp") return "NET_REFUSED";
  return "UNKNOWN";
}
