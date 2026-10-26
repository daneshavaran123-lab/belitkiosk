/**
 * شناسنامهٔ سخت‌افزاری کارت‌خوان موزه — از برچسب پشت دستگاه و منوی
 * «اطلاعات سیستم» خوانده شده است. فقط اطلاعات نمایشی؛ هیچ رمز یا توکنی اینجا نیست.
 */

export type PosNetworkInterface = "lan" | "wifi";

export const DEVICE_PROFILE = {
  item: "Counter Top POS Terminal",
  model: "PAX Q58 LAN + LINE + WIFI",
  brand: "پارسیان (Parsian)",
  partNumber: "Q58-M0A-R66-01LU",
  serialNumber: "2500206135",
  firmware: "16.00.31",
  appVersion: "40.05.05.40",
  color: "Gray",
  power: "9.0V ⎓ 1.0A",
  madeIn: "ساخت ایران — پارت ارتباط آوا پیام سِز",
  interfaces: ["LAN (اترنت)", "LINE (خط تلفن)", "WIFI"],
  wifiSsid: "Museum2.5",
  wifiIp: "192.168.16.87",
  wifiNetmask: "255.255.255.0",
  telecomCode: "112999156",
  accountNumber: "1001002651200",
  merchantId: "6618774",
  terminalId: "5634056",
} as const;

/** ردیف‌های آمادهٔ نمایش در کارت «شناسنامهٔ دستگاه» */
export const DEVICE_PROFILE_ROWS: { label: string; value: string; ltr?: boolean }[] = [
  { label: "نوع دستگاه", value: DEVICE_PROFILE.item, ltr: true },
  { label: "مدل", value: DEVICE_PROFILE.model, ltr: true },
  { label: "برند / شبکهٔ پرداخت", value: DEVICE_PROFILE.brand },
  { label: "پارت‌نامبر", value: DEVICE_PROFILE.partNumber, ltr: true },
  { label: "شمارهٔ سریال", value: DEVICE_PROFILE.serialNumber, ltr: true },
  { label: "فریم‌ور دستگاه", value: DEVICE_PROFILE.firmware, ltr: true },
  { label: "نسخهٔ نرم‌افزار پرداخت", value: DEVICE_PROFILE.appVersion, ltr: true },
  { label: "رابط‌های ارتباطی", value: DEVICE_PROFILE.interfaces.join(" • ") },
  { label: "برق ورودی", value: DEVICE_PROFILE.power, ltr: true },
  { label: "رنگ بدنه", value: DEVICE_PROFILE.color, ltr: true },
  { label: "سازنده", value: DEVICE_PROFILE.madeIn },
  { label: "کد پذیرنده", value: DEVICE_PROFILE.merchantId, ltr: true },
  { label: "کد پایانه", value: DEVICE_PROFILE.terminalId, ltr: true },
  { label: "کد تله‌پرداز", value: DEVICE_PROFILE.telecomCode, ltr: true },
  { label: "شمارهٔ حساب", value: DEVICE_PROFILE.accountNumber, ltr: true },
  { label: "وای‌فای", value: `${DEVICE_PROFILE.wifiSsid} — ${DEVICE_PROFILE.wifiIp}` },
];

export const NETWORK_INTERFACES: {
  key: PosNetworkInterface;
  label: string;
  description: string;
}[] = [
  {
    key: "lan",
    label: "کابل شبکه (LAN)",
    description: "کابل اترنت به پورت LAN دستگاه وصل است — پایدارترین حالت برای کیوسک.",
  },
  {
    key: "wifi",
    label: `وای‌فای (${DEVICE_PROFILE.wifiSsid})`,
    description: "دستگاه بدون کابل و از طریق شبکهٔ بی‌سیم موزه وصل می‌شود.",
  },
];

export function networkInterfaceLabel(iface: PosNetworkInterface): string {
  return NETWORK_INTERFACES.find((i) => i.key === iface)?.label ?? iface;
}

/** آیا سریال پاسخ دستگاه با سریال ثبت‌شده یکی است؟ (فاصله و صفرِ ابتدا نادیده) */
export function serialMatches(reported: string | undefined, expected: string): boolean {
  if (!reported) return true; // دستگاه سریال برنگرداند — تطبیق را رد نمی‌کنیم
  const norm = (v: string) => v.replace(/[^0-9a-zA-Z]/g, "").replace(/^0+/, "").toUpperCase();
  return norm(reported) === norm(expected);
}

/* ---------------- تطبیق شناسنامهٔ دستگاه با مشخصات ثبت‌شده ---------------- */

export interface DeviceIdentityReport {
  /** آنچه دستگاه در پاسخ handshake اعلام کرده */
  reported: { serialNumber?: string; model?: string; firmware?: string };
  mismatches: {
    field: "serial" | "model" | "firmware";
    code: "DEV_SERIAL_MISMATCH" | "DEV_MODEL_MISMATCH" | "DEV_FIRMWARE_MISMATCH";
    label: string;
    expected: string;
    reported: string;
  }[];
  ok: boolean;
}

/** مقایسهٔ نرمِ مدل: بزرگی حروف، فاصله و علائم نادیده گرفته می‌شود */
export function modelMatches(reported: string | undefined, expected: string): boolean {
  if (!reported) return true;
  const norm = (v: string) => v.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
  const r = norm(reported);
  const e = norm(expected);
  return r === e || e.includes(r) || r.includes(e);
}

export function firmwareMatches(reported: string | undefined, expected: string): boolean {
  if (!reported) return true;
  const norm = (v: string) => v.trim().replace(/^v/i, "");
  return norm(reported) === norm(expected);
}

export function checkDeviceIdentity(reported: {
  serialNumber?: string;
  model?: string;
  firmware?: string;
}): DeviceIdentityReport {
  const mismatches: DeviceIdentityReport["mismatches"] = [];

  if (reported.serialNumber && !serialMatches(reported.serialNumber, DEVICE_PROFILE.serialNumber))
    mismatches.push({
      field: "serial",
      code: "DEV_SERIAL_MISMATCH",
      label: "شمارهٔ سریال",
      expected: DEVICE_PROFILE.serialNumber,
      reported: reported.serialNumber,
    });

  if (reported.model && !modelMatches(reported.model, DEVICE_PROFILE.model))
    mismatches.push({
      field: "model",
      code: "DEV_MODEL_MISMATCH",
      label: "مدل دستگاه",
      expected: DEVICE_PROFILE.model,
      reported: reported.model,
    });

  if (reported.firmware && !firmwareMatches(reported.firmware, DEVICE_PROFILE.firmware))
    mismatches.push({
      field: "firmware",
      code: "DEV_FIRMWARE_MISMATCH",
      label: "نسخهٔ فریم‌ور",
      expected: DEVICE_PROFILE.firmware,
      reported: reported.firmware,
    });

  return { reported, mismatches, ok: mismatches.length === 0 };
}

/** آیا ناهمخوانی مدل یا فریم‌ور رخ داده و بازیابی خودکار لازم است؟ */
export function needsIdentityRecovery(report: DeviceIdentityReport | undefined): boolean {
  if (!report || report.ok) return false;
  return report.mismatches.some(
    (m) => m.code === "DEV_MODEL_MISMATCH" || m.code === "DEV_FIRMWARE_MISMATCH",
  );
}

/** کدهای ناهمخوانی برای نمایش/ثبت در سوابق */
export function identityMismatchCodes(report: DeviceIdentityReport | undefined): string[] {
  return report?.mismatches.map((m) => m.code) ?? [];
}

/** آیا کیوسک و کارت‌خوان در یک زیرشبکه هستند؟ (مقایسهٔ /24) */
export function sameSubnet(a: string | undefined, b: string | undefined): boolean | undefined {
  const ok = (v?: string) => !!v && /^\d{1,3}(\.\d{1,3}){3}$/.test(v.trim());
  if (!ok(a) || !ok(b)) return undefined;
  const pre = (v: string) => v.trim().split(".").slice(0, 3).join(".");
  return pre(a!) === pre(b!);
}

/** آدرس APIPA یعنی کارت شبکه از DHCP آدرس نگرفته است */
export function isApipa(ip: string | undefined): boolean {
  return !!ip && ip.trim().startsWith("169.254.");
}
