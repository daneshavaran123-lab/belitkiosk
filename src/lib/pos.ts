/**
 * ارتباط با «سرویس پل کارت‌خوان» (pos-bridge) که روی همان دستگاه ویندوزی
 * اجرا می‌شود و با کارت‌خوان پارسیان (PAX Q58) روی شبکه یا USB صحبت می‌کند.
 *
 * مرورگر مستقیماً به دستگاه دسترسی ندارد؛ همهٔ ارتباط از طریق HTTP روی 127.0.0.1 است.
 */

import { classifyPing, posErrorInfo, type PosErrorCode, type PosErrorSource } from "./pos-errors";
import {
  qualityText,
  qualityToCsv,
  recordSource,
  sourceLabel,
  summarizeNetworkQuality,
  type PosNetworkQuality,
} from "./pos-quality";
import { auditToText, getAuditLog, type PosAuditEntry } from "./pos-audit";
import {
  checkDeviceIdentity,
  DEVICE_PROFILE,
  serialMatches,
  type DeviceIdentityReport,
  type PosNetworkInterface,
} from "./pos-device";

export type { PosNetworkInterface } from "./pos-device";

const LS_URL = "pos.bridgeUrl";
const LS_TERMINAL = "pos.terminalId";
const LS_MERCHANT = "pos.merchantId";
const LS_MODE = "pos.connectionMode";
const LS_IP = "pos.deviceIp";
const LS_IFACE = "pos.networkInterface";
const LS_IP_LAN = "pos.deviceIp.lan";
const LS_IP_WIFI = "pos.deviceIp.wifi";
const LS_PORT = "pos.devicePort";
const LS_SERIAL = "pos.serialNumber";
const LS_TOKEN = "pos.accessToken";
const LS_STATE = "pos.connectionState";
const LS_PINGS = "pos.pingHistory";

export const DEFAULT_BRIDGE_URL = "http://127.0.0.1:9099";
export const DEFAULT_TERMINAL_ID = "5634056";
export const DEFAULT_MERCHANT_ID = "6618774";
/** پورت PC-POS روی دستگاه (همان پورتی که کتابخانهٔ رسمی PosInterface استفاده می‌کند) */
export const DEFAULT_DEVICE_PORT = "17000";
export const DEFAULT_SERIAL_NUMBER = DEVICE_PROFILE.serialNumber;
/** آدرس دستگاه روی وای‌فای موزه — از «اطلاعات سیستم» خود دستگاه */
export const DEFAULT_WIFI_IP = DEVICE_PROFILE.wifiIp;
/** آدرس دستگاه روی کابل شبکهٔ موزه (قابل تغییر از پنل یا جست‌وجوی خودکار) */
export const DEFAULT_LAN_IP = "192.168.16.160";
export const DEFAULT_DEVICE_IP = DEFAULT_WIFI_IP;
/** رابط پیش‌فرض: کابل شبکه (طبق سیم‌کشی فعلی دستگاه) */
export const DEFAULT_NETWORK_INTERFACE: PosNetworkInterface = "lan";

/** اطلاعات شناسایی دستگاه (فقط نمایشی) */
export const DEVICE_FACTS = {
  model: `${DEVICE_PROFILE.model} — ${DEVICE_PROFILE.brand}`,
  partNumber: DEVICE_PROFILE.partNumber,
  firmware: DEVICE_PROFILE.firmware,
  power: DEVICE_PROFILE.power,
  wifiSsid: DEVICE_PROFILE.wifiSsid,
  wifiNetmask: DEVICE_PROFILE.wifiNetmask,
  telecomCode: DEVICE_PROFILE.telecomCode,
  accountNumber: DEVICE_PROFILE.accountNumber,
  appVersion: DEVICE_PROFILE.appVersion,
} as const;

export type PosConnectionMode = "lan" | "com";

function read(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key)?.trim() || fallback;
}

export function getBridgeUrl(): string {
  return read(LS_URL, DEFAULT_BRIDGE_URL);
}

export function setBridgeUrl(url: string) {
  localStorage.setItem(LS_URL, url.trim().replace(/\/$/, ""));
}

export function getTerminalId(): string {
  return read(LS_TERMINAL, DEFAULT_TERMINAL_ID);
}

export function setTerminalId(id: string) {
  localStorage.setItem(LS_TERMINAL, id.trim());
}

export function getMerchantId(): string {
  return read(LS_MERCHANT, DEFAULT_MERCHANT_ID);
}

export function getConnectionMode(): PosConnectionMode {
  return read(LS_MODE, "lan") === "com" ? "com" : "lan";
}

export function getNetworkInterface(): PosNetworkInterface {
  return read(LS_IFACE, DEFAULT_NETWORK_INTERFACE) === "wifi" ? "wifi" : "lan";
}

/** IP ذخیره‌شدهٔ هر رابط جداگانه نگهداری می‌شود تا با جابه‌جایی کابل از بین نرود */
export function getDeviceIpFor(iface: PosNetworkInterface): string {
  return iface === "wifi"
    ? read(LS_IP_WIFI, read(LS_IP, DEFAULT_WIFI_IP))
    : read(LS_IP_LAN, DEFAULT_LAN_IP);
}

export function setDeviceIpFor(iface: PosNetworkInterface, ip: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(iface === "wifi" ? LS_IP_WIFI : LS_IP_LAN, ip.trim());
  localStorage.setItem(LS_IP, ip.trim());
}

export function getDeviceIp(): string {
  return getDeviceIpFor(getNetworkInterface());
}

export function getDevicePort(): string {
  return read(LS_PORT, DEFAULT_DEVICE_PORT);
}

export function getSerialNumber(): string {
  return read(LS_SERIAL, DEFAULT_SERIAL_NUMBER);
}

/** توکنی که برنامهٔ ویندوزی از تنظیمات سرویس پل همین کامپیوتر می‌دهد (نصب‌کننده آن را می‌سازد) */
export function getDesktopPosToken(): string {
  if (typeof window === "undefined") return "";
  const token = (window as { museumKiosk?: { posAccessToken?: unknown } }).museumKiosk
    ?.posAccessToken;
  return typeof token === "string" ? token : "";
}

/** توکن دسترسی سرویس پل: در برنامهٔ ویندوزی خودکار، وگرنه همان که در پنل ذخیره شده */
export function getPosAccessToken(): string {
  return getDesktopPosToken() || read(LS_TOKEN, "");
}

export function setPosAccessToken(token: string) {
  if (typeof window === "undefined") return;
  if (token.trim()) localStorage.setItem(LS_TOKEN, token.trim());
  else localStorage.removeItem(LS_TOKEN);
}

/* ---------------- حافظهٔ ماندگار وضعیت اتصال ---------------- */

export type PosConnectionStatus = "connected" | "disconnected" | "error" | "unknown";

export interface PosConnectionState {
  status: PosConnectionStatus;
  deviceIp: string;
  devicePort: string;
  connectionMode: PosConnectionMode;
  networkInterface?: PosNetworkInterface;
  lastOkAt?: string;
  lastLatencyMs?: number;
  lastError?: string;
  lastErrorCode?: PosErrorCode;
  lastStepKey?: string;
  /** آخرین شناسنامهٔ اعلام‌شده توسط دستگاه (سریال/مدل/فریم‌ور) */
  lastIdentity?: DeviceIdentityReport;
  updatedAt: string;
}

const EMPTY_STATE: PosConnectionState = {
  status: "unknown",
  deviceIp: "",
  devicePort: DEFAULT_DEVICE_PORT,
  connectionMode: "lan",
  networkInterface: DEFAULT_NETWORK_INTERFACE,
  updatedAt: "",
};

export function loadConnectionState(): PosConnectionState {
  if (typeof window === "undefined") return { ...EMPTY_STATE };
  try {
    const raw = localStorage.getItem(LS_STATE);
    if (!raw) return { ...EMPTY_STATE };
    return { ...EMPTY_STATE, ...(JSON.parse(raw) as Partial<PosConnectionState>) };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function saveConnectionState(patch: Partial<PosConnectionState>): PosConnectionState {
  const next: PosConnectionState = {
    ...loadConnectionState(),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LS_STATE, JSON.stringify(next));
    } catch {
      /* حافظهٔ مرورگر پر است — نادیده گرفته می‌شود */
    }
  }
  return next;
}

export function clearConnectionState() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(LS_STATE);
    localStorage.removeItem(LS_PINGS);
  }
}

export interface PosPingRecord {
  at: string;
  ok: boolean;
  stage?: string;
  code?: PosErrorCode;
  latencyMs?: number;
  message: string;
  target: string;
}

export const PING_HISTORY_LIMIT = 10;

export function getPingHistory(): PosPingRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return (JSON.parse(localStorage.getItem(LS_PINGS) ?? "[]") as PosPingRecord[]).slice(
      -PING_HISTORY_LIMIT,
    );
  } catch {
    return [];
  }
}

export function pushPingHistory(record: PosPingRecord): PosPingRecord[] {
  const next = [...getPingHistory(), record].slice(-PING_HISTORY_LIMIT);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LS_PINGS, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  return next;
}

export interface PosSettings {
  bridgeUrl: string;
  connectionMode: PosConnectionMode;
  /** رابط فیزیکی شبکهٔ دستگاه: کابل یا وای‌فای */
  networkInterface: PosNetworkInterface;
  deviceIp: string;
  devicePort: string;
  merchantId: string;
  terminalId: string;
  serialNumber: string;
}

export function getPosSettings(): PosSettings {
  return {
    bridgeUrl: getBridgeUrl(),
    connectionMode: getConnectionMode(),
    networkInterface: getNetworkInterface(),
    deviceIp: getDeviceIp(),
    devicePort: getDevicePort(),
    merchantId: getMerchantId(),
    terminalId: getTerminalId(),
    serialNumber: getSerialNumber(),
  };
}

/** ذخیرهٔ تنظیمات در مرورگر و همگام‌سازی با سرویس پل */
export async function savePosSettings(s: PosSettings): Promise<{ ok: boolean; message: string }> {
  setBridgeUrl(s.bridgeUrl);
  setTerminalId(s.terminalId);
  localStorage.setItem(LS_MERCHANT, s.merchantId.trim());
  localStorage.setItem(LS_MODE, s.connectionMode);
  localStorage.setItem(LS_IFACE, s.networkInterface);
  setDeviceIpFor(s.networkInterface, s.deviceIp);
  localStorage.setItem(LS_PORT, s.devicePort.trim());
  localStorage.setItem(LS_SERIAL, s.serialNumber.trim());

  try {
    const res = await req(
      "/config",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionMode: s.connectionMode,
          networkInterface: s.networkInterface,
          deviceIp: s.deviceIp.trim(),
          devicePort: Number(s.devicePort) || Number(DEFAULT_DEVICE_PORT),
          merchantId: s.merchantId.trim(),
          terminalId: s.terminalId.trim(),
          serialNumber: s.serialNumber.trim(),
        }),
      },
      5000,
    );
    if (!res.ok) return { ok: false, message: `سرویس پل تنظیمات را نپذیرفت (${res.status})` };
    posLog("config:saved", s);
    return { ok: true, message: "تنظیمات ذخیره و به سرویس پل ارسال شد" };
  } catch {
    return { ok: false, message: "تنظیمات ذخیره شد، ولی سرویس پل در دسترس نیست" };
  }
}

/** وضعیت‌های تراکنش در دفتر سرویس پل (توضیح کامل در pos-bridge/TransactionJournal.cs) */
export type PosTxStatus =
  | "pending"
  | "sending"
  | "sent"
  | "approved"
  | "approved_late"
  | "declined"
  | "cancelled"
  | "timeout"
  | "failed"
  | "uncertain"
  /** فروش نقدی که متصدی با رمز تأیید کرده است */
  | "cash";

export interface PosResult {
  success: boolean;
  responseCode?: string;
  message?: string;
  refNumber?: string;
  maskedPan?: string;
  terminalId?: string;
  stan?: string;
  /** شناسهٔ یکتای تراکنش که کیوسک ساخته است */
  transactionId?: string;
  status?: PosTxStatus;
  /** نتیجهٔ نهایی است (دیگر تغییر نمی‌کند) */
  final?: boolean;
  /** ممکن است وجه کسر شده باشد ولی تأیید قطعی نداریم — باید با رسید دستگاه بررسی شود */
  uncertain?: boolean;
  needsReview?: boolean;
}

export interface PosDeviceStatus {
  mode?: string;
  connected?: boolean;
  message?: string;
  deviceIp?: string;
  devicePort?: number;
  comPort?: string;
  serialNumber?: string;
  terminalId?: string;
  merchantId?: string;
  libraryLoaded?: boolean;
  simulate?: boolean;
  protocol?: string;
  responseMode?: string;
  callbackPort?: number;
  callbackListening?: boolean;
  callbackError?: string | null;
  busy?: boolean;
  needsReview?: number;
  tokenRequired?: boolean;
}

/** لاگ یکپارچهٔ رویدادهای کارت‌خوان در کنسول مرورگر */
export function posLog(event: string, detail?: unknown) {
  // eslint-disable-next-line no-console
  console.info(`[pos] ${new Date().toISOString()} ${event}`, detail ?? "");
}

export function posLogError(event: string, detail?: unknown) {
  console.error(`[pos] ${new Date().toISOString()} ${event}`, detail ?? "");
}

async function req(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const token = getPosAccessToken();
    const headers = new Headers(init.headers);
    if (token) headers.set("X-Pos-Token", token);
    return await fetch(`${getBridgeUrl()}${path}`, { ...init, headers, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** پیام فارسی برای پاسخ‌های خطای سرویس پل */
export function bridgeHttpError(status: number): string {
  if (status === 401)
    return "توکن دسترسی سرویس کارت‌خوان درست نیست (۴۰۱) — آن را در تنظیمات کارت‌خوان وارد کنید";
  if (status === 403) {
    const origin =
      typeof window !== "undefined" && window.location ? window.location.origin : "این صفحه";
    return `سرویس کارت‌خوان آدرس ${origin} را مجاز نمی‌داند — آن را به allowedOrigins در appsettings.json اضافه کنید`;
  }
  return `خطای سرویس کارت‌خوان (${status})`;
}

/** بررسی در دسترس بودن سرویس پل و خودِ دستگاه کارت‌خوان */
export async function posHealth(
  timeoutMs = 5000,
): Promise<{ ok: boolean; message: string; device?: PosDeviceStatus }> {
  try {
    const res = await req("/health", { method: "GET" }, timeoutMs);
    if (!res.ok) {
      posLogError("health:bad-status", res.status);
      return {
        ok: false,
        message:
          res.status === 403 ? bridgeHttpError(403) : `پاسخ نامعتبر از سرویس پل (${res.status})`,
      };
    }
    const body = (await res.json()) as {
      status?: string;
      terminalId?: string;
      device?: PosDeviceStatus;
    };
    posLog("health:ok", body);

    const device = body.device;
    if (device && device.connected === false) {
      return {
        ok: false,
        device,
        message: device.message ?? "سرویس پل بالا است ولی دستگاه کارت‌خوان پاسخ نمی‌دهد",
      };
    }
    return {
      ok: true,
      device,
      message:
        device?.mode === "lan"
          ? `متصل — دستگاه ${device.deviceIp}:${device.devicePort} • پایانه ${body.terminalId ?? getTerminalId()}`
          : `متصل — پایانه ${body.terminalId ?? getTerminalId()}`,
    };
  } catch (e) {
    posLogError("health:unreachable", { url: getBridgeUrl(), error: (e as Error).message });
    return { ok: false, message: "سرویس کارت‌خوان در دسترس نیست (pos-bridge اجرا نشده است)" };
  }
}

/** جست‌وجوی خودکار کارت‌خوان روی شبکهٔ محلی */
export interface PosDiscoveredDevice {
  ip: string;
  latencyMs?: number;
  serialNumber?: string;
  /** سریال پاسخ دستگاه با سریال ثبت‌شدهٔ موزه یکی است */
  serialMatch?: boolean;
}

export async function posDiscover(
  port = getDevicePort(),
  timeoutMs = 60_000,
  serial = getSerialNumber(),
): Promise<{
  ok: boolean;
  devices: PosDiscoveredDevice[];
  subnets: string[];
  best?: PosDiscoveredDevice;
  message: string;
}> {
  try {
    posLog("discover:start", { port, serial });
    const qs = new URLSearchParams({ port, serial });
    const res = await req(`/discover?${qs.toString()}`, { method: "GET" }, timeoutMs);
    if (!res.ok)
      return { ok: false, devices: [], subnets: [], message: `خطای جست‌وجو (${res.status})` };
    const body = (await res.json()) as {
      devices?: (PosDiscoveredDevice | string)[];
      subnet?: string;
      subnets?: string[];
    };
    const devices: PosDiscoveredDevice[] = (body.devices ?? []).map((d) =>
      typeof d === "string" ? { ip: d } : d,
    );
    const subnets = body.subnets ?? (body.subnet ? [body.subnet] : []);
    const best = devices.find((d) => d.serialMatch) ?? devices[0];
    posLog("discover:done", body);
    return {
      ok: true,
      devices,
      subnets,
      best,
      message: devices.length
        ? devices.some((d) => d.serialMatch)
          ? `کارت‌خوان موزه پیدا شد: ${devices.find((d) => d.serialMatch)!.ip}`
          : `${devices.length} دستگاه روی پورت ${port} پاسخ داد (سریال هیچ‌کدام تأیید نشد)`
        : `دستگاهی روی پورت ${port} در زیرشبکه‌های ${subnets.join("، ") || "محلی"} پیدا نشد`,
    };
  } catch (e) {
    posLogError("discover:failed", (e as Error).message);
    return {
      ok: false,
      devices: [],
      subnets: [],
      message: "سرویس پل کارت‌خوان در دسترس نیست",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  تست ارتباط، توالی اتصال، بازآزمایی و لاگ زنده                       */
/* ------------------------------------------------------------------ */

export interface PosPingResult {
  ok: boolean;
  stage?: "network" | "tcp" | "handshake";
  latencyMs?: number;
  message: string;
  deviceIp?: string;
  devicePort?: number;
  /** سریالی که خودِ دستگاه در پاسخ handshake اعلام کرده */
  reportedSerial?: string;
  /** مدل اعلام‌شده توسط دستگاه */
  reportedModel?: string;
  /** نسخهٔ فریم‌ور اعلام‌شده توسط دستگاه */
  reportedFirmware?: string;
  /** نتیجهٔ تطبیق شناسنامهٔ دستگاه با مشخصات ثبت‌شده */
  identity?: DeviceIdentityReport;
  /** کد خطای طبقه‌بندی‌شده برای عیب‌یابی سریع */
  code?: PosErrorCode;
}

function record(
  result: PosPingResult,
  override: { ip?: string; port?: string },
  elapsed: number,
): PosPingResult {
  pushPingHistory({
    at: new Date().toISOString(),
    ok: result.ok,
    stage: result.stage,
    code: result.code,
    latencyMs: result.latencyMs ?? elapsed,
    message: result.message,
    target: `${override.ip || getDeviceIp() || "—"}:${override.port || getDevicePort()}`,
  });
  if (result.identity && (result.identity.reported.serialNumber || result.identity.reported.model))
    saveConnectionState({ lastIdentity: result.identity });
  saveConnectionState(
    result.ok
      ? {
          status: "connected",
          lastOkAt: new Date().toISOString(),
          lastLatencyMs: result.latencyMs ?? elapsed,
          lastError: undefined,
          lastErrorCode: "OK",
        }
      : {
          status: "error",
          lastError: result.message,
          lastStepKey: result.stage,
          lastErrorCode: result.code ?? "UNKNOWN",
        },
  );
  return result;
}

/** تست ارتباط مستقیم با کارت‌خوان (اختیاری روی IP/پورت دلخواه، بدون ذخیره‌سازی) */
export async function posPing(
  override: { ip?: string; port?: string } = {},
  timeoutMs = 6000,
): Promise<PosPingResult> {
  const qs = new URLSearchParams();
  if (override.ip) qs.set("ip", override.ip);
  if (override.port) qs.set("port", override.port);
  qs.set("timeout", String(Math.min(timeoutMs - 500, 5000)));
  const started = Date.now();
  try {
    const res = await req(`/ping?${qs.toString()}`, { method: "GET" }, timeoutMs);
    if (!res.ok) {
      const code = classifyPing({ ok: false, httpStatus: res.status });
      const m =
        res.status === 401
          ? "توکن دسترسی سرویس پل درست نیست (۴۰۱)"
          : `سرویس پل خطا داد (${res.status})`;
      posLogError("ping:bad-status", m);
      return record({ ok: false, message: m, code }, override, Date.now() - started);
    }
    const body = (await res.json()) as PosPingResult;
    if (body.ok) posLog("ping:ok", body);
    else posLogError("ping:failed", body);
    const expectedSerial = getSerialNumber();
    const identity = checkDeviceIdentity({
      serialNumber: body.reportedSerial,
      model: body.reportedModel,
      firmware: body.reportedFirmware,
    });
    const mismatch = body.ok && !serialMatches(body.reportedSerial, expectedSerial);
    const code = mismatch
      ? "DEV_SERIAL_MISMATCH"
      : (body.code ?? classifyPing({ ok: body.ok, stage: body.stage, message: body.message }));
    const result: PosPingResult = {
      latencyMs: Date.now() - started,
      ...body,
      identity,
      code,
      ...(mismatch
        ? {
            ok: false,
            stage: "handshake" as const,
            message: `دستگاه پاسخ‌دهنده سریال ${body.reportedSerial} دارد، ولی کارت‌خوان موزه ${expectedSerial} است`,
          }
        : {}),
    };
    return record(result, override, Date.now() - started);
  } catch (e) {
    posLogError("ping:unreachable", (e as Error).message);
    return record(
      {
        ok: false,
        stage: "network",
        code: "BRIDGE_DOWN",
        message: "سرویس پل کارت‌خوان در دسترس نیست",
      },
      override,
      Date.now() - started,
    );
  }
}

export type PosStepKey = "bridge" | "config" | "network" | "handshake" | "ready";

export interface PosStep {
  key: PosStepKey;
  label: string;
  state: "pending" | "running" | "ok" | "fail";
  detail?: string;
  latencyMs?: number;
}

export const POS_STEPS: { key: PosStepKey; label: string }[] = [
  { key: "bridge", label: "سرویس پل روی کیوسک" },
  { key: "config", label: "ارسال تنظیمات به سرویس" },
  { key: "network", label: "پیدا شدن دستگاه در شبکه" },
  { key: "handshake", label: "دست‌دهی با کارت‌خوان" },
  { key: "ready", label: "آماده دریافت پرداخت" },
];

export function initialPosSteps(): PosStep[] {
  return POS_STEPS.map((s) => ({ ...s, state: "pending" as const }));
}

/** پیشنهاد راه‌حل برای هر مرحلهٔ ناموفق */
export function posStepHint(key: PosStepKey): string {
  switch (key) {
    case "bridge":
      return "سرویس pos-bridge روی کیوسک اجرا نشده است — فایل pos-bridge\\run.bat را اجرا کنید.";
    case "config":
      return "سرویس پل تنظیمات را نپذیرفت — مقادیر IP، پورت و کد پایانه را بررسی کنید.";
    case "network":
      return "دستگاه در شبکه پیدا نشد — IP را از منوی «تنظیمات → شبکه» دستگاه بخوانید یا جست‌وجوی خودکار بزنید.";
    case "handshake":
      return "پورت باز است ولی دستگاه پاسخ نداد — دستگاه را در حالت آماده (صفحهٔ اصلی) بگذارید.";
    default:
      return "";
  }
}

/**
 * اجرای کامل توالی اتصال؛ نتیجهٔ هر مرحله بلافاصله از طریق onStep گزارش می‌شود.
 */
export async function posConnectSequence(
  settings: PosSettings,
  onStep: (steps: PosStep[]) => void,
): Promise<boolean> {
  const steps = initialPosSteps();
  const emit = () => onStep(steps.map((s) => ({ ...s })));
  const set = (key: PosStepKey, patch: Partial<PosStep>) => {
    const s = steps.find((x) => x.key === key);
    if (s) Object.assign(s, patch);
    emit();
  };
  const failRest = (from: PosStepKey) => {
    const i = steps.findIndex((s) => s.key === from);
    steps.slice(i + 1).forEach((s) => (s.state = "pending"));
    emit();
  };

  emit();
  posLog("connect:start", settings);
  saveConnectionState({
    deviceIp: settings.deviceIp,
    devicePort: settings.devicePort,
    connectionMode: settings.connectionMode,
    networkInterface: settings.networkInterface,
  });

  // در حالت شبکه، بدون IP اصلاً نمی‌توان اتصال گرفت
  if (settings.connectionMode === "lan" && !settings.deviceIp.trim()) {
    set("bridge", { state: "pending" });
    set("config", {
      state: "fail",
      detail: "IP دستگاه خالی است — «جست‌وجوی خودکار در شبکه» را بزنید",
    });
    saveConnectionState({
      status: "error",
      lastError: "IP دستگاه وارد نشده است",
      lastStepKey: "config",
      lastErrorCode: "CFG_INVALID",
    });
    return false;
  }

  // ۱) سرویس پل
  set("bridge", { state: "running" });
  const t0 = Date.now();
  const health = await posHealth(6000);
  if (!health.device && !health.ok && health.message.includes("در دسترس نیست")) {
    set("bridge", { state: "fail", detail: health.message });
    failRest("bridge");
    saveConnectionState({
      status: "error",
      lastError: health.message,
      lastStepKey: "bridge",
      lastErrorCode: "BRIDGE_DOWN",
    });
    return false;
  }
  set("bridge", { state: "ok", detail: "سرویس پاسخ داد", latencyMs: Date.now() - t0 });

  // ۲) ارسال تنظیمات
  set("config", { state: "running" });
  const saved = await savePosSettings(settings);
  if (!saved.ok) {
    set("config", { state: "fail", detail: saved.message });
    failRest("config");
    saveConnectionState({
      status: "error",
      lastError: saved.message,
      lastStepKey: "config",
      lastErrorCode: "CFG_INVALID",
    });
    return false;
  }
  set("config", { state: "ok", detail: saved.message });

  // ۳) و ۴) شبکه و دست‌دهی
  set("network", { state: "running" });
  const ping = await posPing({ ip: settings.deviceIp, port: settings.devicePort }, 8000);
  if (!ping.ok) {
    set("network", { state: "fail", detail: ping.message, latencyMs: ping.latencyMs });
    failRest("network");
    saveConnectionState({
      status: "disconnected",
      lastError: ping.message,
      lastStepKey: "network",
      lastErrorCode: ping.code ?? "NET_UNREACHABLE",
    });
    return false;
  }
  set("network", {
    state: "ok",
    detail: `${settings.deviceIp}:${settings.devicePort}`,
    latencyMs: ping.latencyMs,
  });

  set("handshake", {
    state: ping.stage === "handshake" ? "ok" : "ok",
    detail: ping.message,
    latencyMs: ping.latencyMs,
  });
  set("ready", { state: "ok", detail: "دستگاه آمادهٔ دریافت پرداخت است" });
  posLog("connect:ready", ping);
  saveConnectionState({
    status: "connected",
    lastStepKey: "ready",
    lastError: undefined,
    lastOkAt: new Date().toISOString(),
    lastLatencyMs: ping.latencyMs,
  });
  return true;
}

/** فاصلهٔ بازآزمایی با backoff نمایی: ۲، ۴، ۸، ۱۶، ۳۰ ثانیه و سپس ۳۰ ثانیه */
export function posBackoffSeconds(attempt: number): number {
  const table = [2, 4, 8, 16, 30];
  return table[Math.min(attempt, table.length - 1)];
}

export interface PosLogEntry {
  id: number;
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  time: string;
}

/**
 * دریافت لحظه‌ای لاگ سرویس پل. ابتدا SSE امتحان می‌شود؛ اگر برقرار نشد
 * هر ۲ ثانیه از مسیر /logs خوانده می‌شود. تابع پاک‌سازی برمی‌گرداند.
 */
export function subscribePosEvents(handlers: {
  onLog: (entry: PosLogEntry) => void;
  onStatus?: (status: PosDeviceStatus) => void;
  onTransport?: (t: "sse" | "polling") => void;
}): () => void {
  let stopped = false;
  let lastId = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let source: EventSource | null = null;

  const poll = async () => {
    handlers.onTransport?.("polling");
    const tick = async () => {
      if (stopped) return;
      try {
        const res = await req(`/logs?after=${lastId}`, { method: "GET" }, 4000);
        if (!res.ok) return;
        const body = (await res.json()) as { lastId: number; items: PosLogEntry[] };
        body.items?.forEach((i) => {
          lastId = Math.max(lastId, i.id);
          handlers.onLog(i);
        });
      } catch {
        /* سرویس پایین است — دفعهٔ بعد دوباره تلاش می‌شود */
      }
    };
    await tick();
    timer = setInterval(() => void tick(), 2000);
  };

  if (typeof EventSource !== "undefined") {
    try {
      const token = getPosAccessToken();
      source = new EventSource(
        `${getBridgeUrl()}/events${token ? `?token=${encodeURIComponent(token)}` : ""}`,
      );
      source.addEventListener("log", (e) => {
        const entry = JSON.parse((e as MessageEvent).data) as PosLogEntry;
        lastId = Math.max(lastId, entry.id);
        handlers.onLog(entry);
      });
      source.addEventListener("status", (e) => {
        handlers.onStatus?.(JSON.parse((e as MessageEvent).data) as PosDeviceStatus);
      });
      source.addEventListener("open", () => handlers.onTransport?.("sse"));
      source.addEventListener("error", () => {
        source?.close();
        source = null;
        if (!stopped && !timer) void poll();
      });
    } catch {
      void poll();
    }
  } else {
    void poll();
  }

  return () => {
    stopped = true;
    source?.close();
    if (timer) clearInterval(timer);
  };
}

/** پاک کردن لاگ سرویس پل */
export async function clearPosLogs(): Promise<void> {
  try {
    await req("/logs", { method: "POST" }, 4000);
  } catch {
    /* ignore */
  }
}

/** شناسهٔ یکتای تراکنش؛ با همین شناسه می‌توان نتیجه را بعداً از سرویس پل پرسید */
export function newTransactionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** تبدیل پاسخ سرویس پل به خروجی استاندارد برنامه */
export function normalizePosResult(
  body: Record<string, unknown>,
  transactionId: string,
): PosResult {
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
  const bool = (k: string) => (typeof body[k] === "boolean" ? (body[k] as boolean) : undefined);
  const status = str("status") as PosTxStatus | undefined;
  const success = body.success === true;
  return {
    success,
    status,
    transactionId: str("transactionId") ?? transactionId,
    responseCode: str("responseCode"),
    message: str("message"),
    refNumber: str("refNumber"),
    maskedPan: str("maskedPan"),
    terminalId: str("terminalId"),
    stan: str("stan"),
    // پاسخ قدیمی سرویس پل وضعیت نداشت؛ آن را نهایی فرض می‌کنیم
    final: bool("final") ?? (status ? !["pending", "sending", "sent"].includes(status) : true),
    uncertain: bool("uncertain") ?? false,
    needsReview: bool("needsReview") ?? false,
  };
}

/** پرسیدن وضعیت یک تراکنش؛ null یعنی سرویس پل چنین تراکنشی ندارد */
export async function posTransactionStatus(
  transactionId: string,
  timeoutMs = 4000,
): Promise<PosResult | null> {
  const res = await req(
    `/status?id=${encodeURIComponent(transactionId)}`,
    { method: "GET" },
    timeoutMs,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(bridgeHttpError(res.status));
  return normalizePosResult((await res.json()) as Record<string, unknown>, transactionId);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * انتظار برای نتیجهٔ نهایی یک تراکنش با پرسیدن مکرر /status — وقتی اتصال HTTP پرداخت قطع
 * شد یا صفحه وسط پرداخت رفرش شد. هرگز دوباره پرداخت نمی‌کند.
 */
export async function posWaitForResult(
  transactionId: string,
  opts: {
    deadlineMs?: number;
    intervalMs?: number;
    onStatus?: (r: PosResult) => void;
    /** اگر سرویس پل از همان ابتدا در دسترس نبود، زود اعلام شود (درخواست اصلاً نرسیده) */
    failFastIfUnreachable?: boolean;
  } = {},
): Promise<PosResult> {
  const deadline = Date.now() + (opts.deadlineMs ?? 180_000);
  const interval = opts.intervalMs ?? 1500;
  let notFound = 0;
  let unreachable = 0;
  let reached = false;
  let last: PosResult | null = null;
  while (Date.now() < deadline) {
    try {
      const r = await posTransactionStatus(transactionId);
      reached = true;
      if (r === null) {
        // سرویس پل این تراکنش را ندارد → اصلاً به دستگاه نرسیده است
        if (++notFound >= 3) {
          posLog("pay:not-started", { transactionId });
          return {
            success: false,
            final: true,
            transactionId,
            message: "درخواست پرداخت به کارت‌خوان نرسید؛ می‌توانید دوباره تلاش کنید",
          };
        }
      } else {
        last = r;
        opts.onStatus?.(r);
        if (r.final) return r;
      }
    } catch {
      // سرویس پل موقتاً در دسترس نیست؛ دوباره می‌پرسیم
      if (opts.failFastIfUnreachable && !reached && ++unreachable >= 3) {
        posLogError("pay:bridge-down", { transactionId });
        return {
          success: false,
          // تا وقتی سرویس دوباره بالا بیاید و نبودِ تراکنش را تأیید کند، نهایی نیست
          final: false,
          uncertain: false,
          transactionId,
          message: "سرویس کارت‌خوان (pos-bridge) روی این رایانه در دسترس نیست",
        };
      }
    }
    await sleep(interval);
  }
  posLogError("pay:status-unknown", { transactionId, last });
  return {
    success: false,
    final: false,
    uncertain: true,
    transactionId,
    status: last?.status,
    message:
      "ارتباط با سرویس کارت‌خوان قطع شد و نتیجهٔ پرداخت هنوز معلوم نیست. اگر مبلغ کسر شده، رسید کارت‌خوان را به متصدی نشان دهید.",
  };
}

/**
 * پرداخت با کارت‌خوان. مبلغ به تومان داده و به ریال تبدیل می‌شود.
 *
 * ایمنی: هر پرداخت یک transactionId دارد. اگر پاسخ HTTP گم شود (قطع شبکه، رفرش، ری‌استارت)
 * نتیجه از /status خوانده می‌شود و درخواست پرداخت هرگز دوباره فرستاده نمی‌شود. برای لغو از
 * posCancel استفاده کنید؛ این تابع تا رسیدن نتیجهٔ واقعی دستگاه (حتی پس از لغو) صبر می‌کند تا
 * پولی که مشتری همان لحظه پرداخته گم نشود.
 */
export async function posPay(
  params: { amountToman: number; invoiceNumber: string; transactionId?: string },
  opts: { timeoutMs?: number; statusDeadlineMs?: number; onStatus?: (r: PosResult) => void } = {},
): Promise<PosResult> {
  const transactionId = params.transactionId ?? newTransactionId();
  const amountRial = Math.round(params.amountToman) * 10;
  if (!Number.isSafeInteger(amountRial) || amountRial <= 0) {
    return { success: false, final: true, transactionId, message: "مبلغ پرداخت نامعتبر است" };
  }

  const started = Date.now();
  posLog("pay:start", {
    transactionId,
    invoice: params.invoiceNumber,
    amountToman: params.amountToman,
  });
  let res: Response;
  try {
    res = await req(
      "/pay",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId,
          amountRial,
          amountToman: Math.round(params.amountToman),
          invoiceNumber: params.invoiceNumber,
        }),
      },
      opts.timeoutMs ?? 200_000,
    );
  } catch (e) {
    // درخواست شاید به سرویس رسیده و پرداخت در جریان باشد → فقط وضعیت را می‌پرسیم
    posLogError("pay:connection-lost", { transactionId, error: (e as Error).message });
    return posWaitForResult(transactionId, {
      deadlineMs: opts.statusDeadlineMs,
      onStatus: opts.onStatus,
      // خطای فوری یعنی اتصال اصلاً برقرار نشد (سرویس اجرا نیست)
      failFastIfUnreachable: Date.now() - started < 3000,
    });
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 409 && body.code === "IN_PROGRESS") {
    return posWaitForResult(transactionId, {
      deadlineMs: opts.statusDeadlineMs,
      onStatus: opts.onStatus,
    });
  }
  if (!res.ok) {
    // پرداخت شروع نشده است (مشغول، ورودی نامعتبر، دسترسی) — کسر وجهی رخ نداده
    posLogError("pay:rejected", { transactionId, status: res.status, body });
    return {
      success: false,
      final: true,
      transactionId,
      message:
        typeof body.message === "string" && res.status !== 401 && res.status !== 403
          ? body.message
          : bridgeHttpError(res.status),
    };
  }

  const result = normalizePosResult(body, transactionId);
  if (result.success) posLog("pay:approved", { transactionId, ref: result.refNumber });
  else posLogError("pay:not-approved", { transactionId, result });
  return result;
}

/**
 * درخواست لغو تراکنش جاری. کارت‌خوان فرمان لغو ندارد؛ سرویس پل چند ثانیه برای نتیجهٔ نهایی
 * صبر می‌کند و posPay همان نتیجه را برمی‌گرداند (اگر مشتری همان لحظه پرداخت کرده باشد، فروش ثبت می‌شود).
 */
export async function posCancel(
  transactionId?: string,
): Promise<{ accepted: boolean; message: string }> {
  try {
    posLog("cancel:request", { transactionId });
    const res = await req(
      "/cancel",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId }),
      },
      5000,
    );
    const body = (await res.json().catch(() => ({}))) as { accepted?: boolean; message?: string };
    return { accepted: body.accepted === true, message: body.message ?? "" };
  } catch (e) {
    posLogError("cancel:failed", (e as Error).message);
    return { accepted: false, message: "سرویس کارت‌خوان در دسترس نیست" };
  }
}

/* ------------------------------------------------------------------ */
/*  دفتر تراکنش‌ها و بررسی تراکنش‌های نامطمئن                         */
/* ------------------------------------------------------------------ */

export interface PosTransactionRecord extends PosResult {
  messageId?: number;
  invoiceNumber?: string;
  amountRial?: number;
  createdAt?: string;
  completedAt?: string;
  cancelRequested?: boolean;
  lateResponse?: boolean;
  reviewed?: boolean;
  note?: string;
  via?: string;
}

export async function posTransactions(limit = 50): Promise<{
  ok: boolean;
  items: PosTransactionRecord[];
  needsReview: number;
  message: string;
}> {
  try {
    const res = await req(`/transactions?limit=${limit}`, { method: "GET" }, 6000);
    if (!res.ok)
      return { ok: false, items: [], needsReview: 0, message: bridgeHttpError(res.status) };
    const body = (await res.json()) as { items?: Record<string, unknown>[]; needsReview?: number };
    const items = (body.items ?? []).map((raw) => {
      const r = normalizePosResult(raw, String(raw.transactionId ?? ""));
      return {
        ...r,
        messageId: typeof raw.messageId === "number" ? raw.messageId : undefined,
        invoiceNumber: typeof raw.invoiceNumber === "string" ? raw.invoiceNumber : undefined,
        amountRial: typeof raw.amountRial === "number" ? raw.amountRial : undefined,
        createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
        completedAt: typeof raw.completedAt === "string" ? raw.completedAt : undefined,
        cancelRequested: raw.cancelRequested === true,
        lateResponse: raw.lateResponse === true,
        reviewed: raw.reviewed === true,
        note: typeof raw.note === "string" ? raw.note : undefined,
        via: typeof raw.via === "string" ? raw.via : undefined,
      } satisfies PosTransactionRecord;
    });
    return {
      ok: true,
      items,
      needsReview: body.needsReview ?? 0,
      message: `${items.length} تراکنش`,
    };
  } catch {
    return { ok: false, items: [], needsReview: 0, message: "سرویس کارت‌خوان در دسترس نیست" };
  }
}

/** علامت «بررسی شد» برای تراکنش نامطمئن (پس از بازگشت وجه یا صدور دستی بلیط) */
export async function posMarkReviewed(transactionId: string, note = ""): Promise<boolean> {
  try {
    const res = await req(
      "/transactions/review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId, note }),
      },
      5000,
    );
    return res.ok;
  } catch {
    return false;
  }
}

export type PosResponseMode = "auto" | "same" | "callback";
export type PosProtocol = "native" | "sdk";

/** تنظیمات پروتکل سرویس پل (نحوهٔ برگشت پاسخ دستگاه) */
export async function posGetProtocol(): Promise<{
  ok: boolean;
  protocol?: PosProtocol;
  responseMode?: PosResponseMode;
  timeoutSeconds?: number;
  tokenRequired?: boolean;
}> {
  try {
    const res = await req("/config", { method: "GET" }, 5000);
    if (!res.ok) return { ok: false };
    const b = (await res.json()) as {
      protocol?: PosProtocol;
      responseMode?: PosResponseMode;
      timeoutSeconds?: number;
      tokenRequired?: boolean;
    };
    return { ok: true, ...b };
  } catch {
    return { ok: false };
  }
}

export async function posSaveProtocol(settings: {
  protocol: PosProtocol;
  responseMode: PosResponseMode;
  timeoutSeconds: number;
}): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await req(
      "/config",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      },
      8000,
    );
    if (res.status === 409)
      return { ok: false, message: "کارت‌خوان مشغول تراکنش است؛ بعد از پایان آن ذخیره کنید" };
    if (!res.ok) return { ok: false, message: bridgeHttpError(res.status) };
    return { ok: true, message: "تنظیمات پروتکل ذخیره و اعمال شد" };
  } catch {
    return { ok: false, message: "سرویس کارت‌خوان در دسترس نیست" };
  }
}

/* ------------------------------------------------------------------ */
/*  پرداخت نقدی با رمز متصدی                                           */
/* ------------------------------------------------------------------ */

export type CashAuthCode = "WRONG_PIN" | "LOCKED" | "NOT_CONFIGURED" | "BRIDGE_DOWN" | "ERROR";

/** آیا رمز متصدی تنظیم شده است (بدون آن پرداخت نقدی در کیوسک غیرفعال است) */
export async function posCashStatus(): Promise<{
  ok: boolean;
  pinConfigured: boolean;
  lockedSeconds: number;
}> {
  try {
    const res = await req("/cash/status", { method: "GET" }, 4000);
    if (!res.ok) return { ok: false, pinConfigured: false, lockedSeconds: 0 };
    const b = (await res.json()) as { pinConfigured?: boolean; lockedSeconds?: number };
    return {
      ok: true,
      pinConfigured: b.pinConfigured === true,
      lockedSeconds: b.lockedSeconds ?? 0,
    };
  } catch {
    return { ok: false, pinConfigured: false, lockedSeconds: 0 };
  }
}

/**
 * تأیید پرداخت نقدی با رمز متصدی. رمز فقط به سرویس پل روی همین رایانه فرستاده می‌شود و
 * آنجا با هش ذخیره‌شده مقایسه می‌شود؛ در مرورگر ذخیره یا لاگ نمی‌شود.
 */
export async function posAuthorizeCash(params: {
  pin: string;
  invoiceNumber: string;
  amountToman: number;
}): Promise<{
  ok: boolean;
  code?: CashAuthCode;
  message: string;
  authorizationId?: string;
  remainingAttempts?: number;
  retryAfterSeconds?: number;
}> {
  let res: Response;
  try {
    res = await req(
      "/cash/authorize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin: params.pin,
          invoiceNumber: params.invoiceNumber,
          amountToman: Math.round(params.amountToman),
        }),
      },
      10_000,
    );
  } catch {
    return {
      ok: false,
      code: "BRIDGE_DOWN",
      message: "سرویس کارت‌خوان در دسترس نیست؛ تأیید پرداخت نقدی ممکن نیست",
    };
  }
  const b = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    code?: CashAuthCode;
    message?: string;
    authorizationId?: string;
    remainingAttempts?: number;
    retryAfterSeconds?: number;
  };
  if (!res.ok) {
    return {
      ok: false,
      code: "ERROR",
      message:
        res.status === 401 || res.status === 403
          ? bridgeHttpError(res.status)
          : (b.message ?? bridgeHttpError(res.status)),
    };
  }
  if (b.ok === true) posLog("cash:authorized", { invoice: params.invoiceNumber });
  else posLogError("cash:rejected", { invoice: params.invoiceNumber, code: b.code });
  return {
    ok: b.ok === true,
    code: b.code,
    message: b.message ?? (b.ok ? "پرداخت نقدی تأیید شد" : "رمز متصدی پذیرفته نشد"),
    authorizationId: b.authorizationId,
    remainingAttempts: b.remainingAttempts,
    retryAfterSeconds: b.retryAfterSeconds,
  };
}

/** تنظیم، تغییر یا حذف (newPin خالی) رمز متصدی؛ اگر رمز قبلی وجود دارد، currentPin لازم است */
export async function posSetCashierPin(params: {
  currentPin?: string;
  newPin: string;
}): Promise<{ ok: boolean; message: string; pinConfigured?: boolean }> {
  try {
    const res = await req(
      "/cash/pin",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPin: params.currentPin ?? "", newPin: params.newPin }),
      },
      10_000,
    );
    const b = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      pinConfigured?: boolean;
    };
    if (res.status === 401 || res.status === 403)
      return { ok: false, message: bridgeHttpError(res.status) };
    return {
      ok: b.ok === true,
      message: b.message ?? (res.ok ? "ذخیره شد" : bridgeHttpError(res.status)),
      pinConfigured: b.pinConfigured,
    };
  } catch {
    return { ok: false, message: "سرویس کارت‌خوان در دسترس نیست" };
  }
}

/* ------------------------------------------------------------------ */
/*  چاپ بلیط روی پرینتر حرارتی                                          */
/* ------------------------------------------------------------------ */

export interface PosPrintResult {
  ok: boolean;
  message: string;
  printer?: string;
}

/** فهرست پرینترهای نصب‌شده روی ویندوز کیوسک */
export async function posPrinters(timeoutMs = 6000): Promise<{
  ok: boolean;
  printers: string[];
  defaultPrinter?: string;
  selected?: string;
  printEnabled?: boolean;
  message: string;
}> {
  try {
    const res = await req("/printers", { method: "GET" }, timeoutMs);
    if (!res.ok) return { ok: false, printers: [], message: `پاسخ نامعتبر (${res.status})` };
    const body = (await res.json()) as {
      printers?: string[];
      defaultPrinter?: string;
      selected?: string;
      printEnabled?: boolean;
    };
    return {
      ok: true,
      printers: body.printers ?? [],
      defaultPrinter: body.defaultPrinter ?? "",
      selected: body.selected ?? "",
      printEnabled: body.printEnabled ?? true,
      message: `${(body.printers ?? []).length} پرینتر پیدا شد`,
    };
  } catch {
    return { ok: false, printers: [], message: "سرویس چاپ در دسترس نیست" };
  }
}

/** ذخیرهٔ پرینتر انتخاب‌شده در سرویس پل */
export async function posSavePrinter(
  printerName: string,
  printEnabled: boolean,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await req(
      "/config",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printerName, printEnabled }),
      },
      6000,
    );
    if (!res.ok) return { ok: false, message: `سرویس پل تنظیمات چاپ را نپذیرفت (${res.status})` };
    posLog("printer:saved", { printerName, printEnabled });
    return { ok: true, message: "تنظیمات چاپ ذخیره شد" };
  } catch {
    return { ok: false, message: "سرویس پل در دسترس نیست" };
  }
}

/** ارسال بلیط برای چاپ روی پرینتر حرارتی ۸۰ میلی‌متری */
export async function posPrintTicket(
  payload: unknown,
  timeoutMs = 20_000,
): Promise<PosPrintResult> {
  try {
    posLog("print:start", payload);
    const res = await req(
      "/print",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      timeoutMs,
    );
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      message?: string;
      printer?: string;
    };
    const ok = res.ok && body.success === true;
    if (ok) posLog("print:ok", body);
    else posLogError("print:failed", body);
    return {
      ok,
      message: body.message ?? (ok ? "بلیط چاپ شد" : "چاپ بلیط ناموفق بود"),
      ...(body.printer ? { printer: body.printer } : {}),
    };
  } catch (e) {
    posLogError("print:unreachable", (e as Error).message);
    return { ok: false, message: "سرویس چاپ در دسترس نیست (pos-bridge اجرا نشده است)" };
  }
}

/* ------------------------------------------------------------------ */
/*  گزارش پشتیبانی                                                     */
/* ------------------------------------------------------------------ */

export interface PosSupportReportPing extends PosPingRecord {
  /** منشأ خطا بر پایهٔ کد (شبکه / دستگاه / سرویس پل / تنظیمات) */
  source: PosErrorSource;
  sourceLabel: string;
}

export interface PosSupportReport {
  generatedAt: string;
  kiosk: Record<string, string | number | boolean>;
  settings: Record<string, string>;
  connection: PosConnectionState;
  pingAttempts: PosSupportReportPing[];
  /** خلاصهٔ کیفیت شبکه بر پایهٔ همان تلاش‌ها */
  quality: PosNetworkQuality;
  events: { time: string; level: string; event: string; message: string }[];
  audit: PosAuditEntry[];
}

function kioskInfo(): Record<string, string | number | boolean> {
  if (typeof window === "undefined") return { environment: "server" };
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    language: nav.language,
    online: nav.onLine,
    touchPoints: nav.maxTouchPoints,
    deviceMemoryGb: nav.deviceMemory ?? 0,
    logicalCores: nav.hardwareConcurrency ?? 0,
    screen: `${window.screen.width}x${window.screen.height}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
    orientation: window.screen.height >= window.screen.width ? "portrait" : "landscape",
    expectedKiosk:
      "Windows 10 Enterprise 22H2 (19045) • Core i5-7500 • 8GB • 1080x1920 لمسی ۱۰ نقطه",
  };
}

/** افزودن منشأ خطا به هر تلاش ping */
export function enrichPings(records: PosPingRecord[]): PosSupportReportPing[] {
  return records.map((r) => {
    const source = recordSource(r);
    return { ...r, source, sourceLabel: sourceLabel(source) };
  });
}

/** خروجی CSV تلاش‌های اتصال + خلاصهٔ کیفیت (BOM برای اکسل) */
export function pingsToCsv(records: PosPingRecord[] = getPingHistory()): string {
  const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const rows: string[][] = [
    [
      "زمان شمسی",
      "زمان میلادی",
      "نتیجه",
      "مقصد",
      "RTT (ms)",
      "مرحله",
      "کد خطا",
      "منشأ خطا",
      "پیام",
    ],
    ...enrichPings(records).map((p) => [
      new Date(p.at).toLocaleString("fa-IR"),
      p.at,
      p.ok ? "OK" : "FAIL",
      p.target,
      p.latencyMs != null ? String(p.latencyMs) : "",
      p.stage ?? "",
      p.code ?? "",
      p.sourceLabel,
      p.message,
    ]),
    ["", ""],
    ...qualityToCsv(summarizeNetworkQuality(records)),
  ];
  return "\uFEFF" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

/** ساخت گزارش خلاصهٔ عیب‌یابی — هیچ رمز یا توکنی داخل آن نوشته نمی‌شود */
export function buildSupportReport(events: PosLogEntry[] = []): PosSupportReport {
  const s = getPosSettings();
  return {
    generatedAt: new Date().toISOString(),
    kiosk: kioskInfo(),
    settings: {
      bridgeUrl: s.bridgeUrl,
      connectionMode: s.connectionMode,
      deviceIp: s.deviceIp || "—",
      devicePort: s.devicePort,
      merchantId: s.merchantId,
      terminalId: s.terminalId,
      serialNumber: s.serialNumber,
      networkInterface: s.networkInterface === "wifi" ? "وای‌فای" : "کابل شبکه (LAN)",
      model: DEVICE_FACTS.model,
      partNumber: DEVICE_FACTS.partNumber,
      firmware: DEVICE_FACTS.firmware,
      power: DEVICE_FACTS.power,
      wifiSsid: DEVICE_FACTS.wifiSsid,
      telecomCode: DEVICE_FACTS.telecomCode,
      accountNumber: DEVICE_FACTS.accountNumber,
      appVersion: DEVICE_FACTS.appVersion,
      accessTokenConfigured: getPosAccessToken() ? "بله" : "خیر",
    },
    connection: loadConnectionState(),
    pingAttempts: enrichPings(getPingHistory()),
    quality: summarizeNetworkQuality(getPingHistory()),
    events: events.slice(-100).map((e) => ({
      time: e.time,
      level: e.level,
      event: e.event,
      message: e.message,
    })),
    audit: getAuditLog(),
  };
}

/** نسخهٔ متنی خوانا برای ارسال در پیام‌رسان */
export function supportReportText(r: PosSupportReport): string {
  const line = (k: string, v: unknown) => `${k}: ${v}`;
  const lastCode = r.connection.lastErrorCode;
  const info = posErrorInfo(lastCode);
  return [
    "=== گزارش پشتیبانی کارت‌خوان موزه کشتی ===",
    line("زمان تولید", new Date(r.generatedAt).toLocaleString("fa-IR")),
    "",
    "--- تنظیمات دستگاه ---",
    ...Object.entries(r.settings).map(([k, v]) => line(k, v)),
    "",
    "--- وضعیت اتصال ---",
    line("وضعیت", r.connection.status),
    line("آخرین کد خطا", lastCode ? `${lastCode} — ${info.label}` : "—"),
    line("راهنما", lastCode ? info.hint : "—"),
    line("آخرین اتصال موفق", r.connection.lastOkAt ?? "—"),
    line(
      "آخرین زمان پاسخ",
      r.connection.lastLatencyMs != null ? `${r.connection.lastLatencyMs}ms` : "—",
    ),
    line("آخرین خطا", r.connection.lastError ?? "—"),
    line("آخرین مرحله", r.connection.lastStepKey ?? "—"),
    "",
    "--- کیفیت شبکه ---",
    ...qualityText(r.quality),
    "",
    `--- آخرین ${r.pingAttempts.length} تلاش ping/handshake ---`,
    ...r.pingAttempts.map(
      (p) =>
        `${new Date(p.at).toLocaleTimeString("fa-IR")} ${p.ok ? "OK " : "FAIL"} ${p.target} ${
          p.latencyMs ?? "—"
        }ms [${p.stage ?? "-"}] {${p.code ?? "-"}} منشأ: ${p.sourceLabel} — ${p.message}`,
    ),
    "",
    "--- رویدادهای سرویس پل ---",
    ...r.events.map((e) => `${e.time} [${e.level}] ${e.event} — ${e.message}`),
    "",
    `--- سوابق دسترسی (${r.audit.length} رکورد) ---`,
    auditToText(r.audit),
    "",
    "--- مشخصات کیوسک ---",
    ...Object.entries(r.kiosk).map(([k, v]) => line(k, v)),
  ].join("\n");
}

/** آخرین شناسنامهٔ خوانده‌شده از دستگاه (بین رفرش‌ها می‌ماند) */
export function getLastIdentity(): DeviceIdentityReport | undefined {
  return loadConnectionState().lastIdentity;
}

export type { DeviceIdentityReport };
