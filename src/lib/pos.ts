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
export const DEFAULT_DEVICE_PORT = "8888";
export const DEFAULT_SERIAL_NUMBER = DEVICE_PROFILE.serialNumber;
/** آدرس دستگاه روی وای‌فای موزه — از «اطلاعات سیستم» خود دستگاه */
export const DEFAULT_WIFI_IP = DEVICE_PROFILE.wifiIp;
/** در حالت کابل، IP از قبل معلوم نیست و با جست‌وجوی خودکار پیدا می‌شود */
export const DEFAULT_LAN_IP = "";
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

/** توکن دسترسی سرویس پل (فقط روی همین کیوسک ذخیره می‌شود) */
export function getPosAccessToken(): string {
  return read(LS_TOKEN, "");
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

export interface PosResult {
  success: boolean;
  responseCode?: string;
  message?: string;
  refNumber?: string;
  maskedPan?: string;
  terminalId?: string;
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

/** بررسی در دسترس بودن سرویس پل و خودِ دستگاه کارت‌خوان */
export async function posHealth(
  timeoutMs = 5000,
): Promise<{ ok: boolean; message: string; device?: PosDeviceStatus }> {
  try {
    const res = await req("/health", { method: "GET" }, timeoutMs);
    if (!res.ok) {
      posLogError("health:bad-status", res.status);
      return { ok: false, message: `پاسخ نامعتبر از سرویس پل (${res.status})` };
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
      : (body.code ??
        classifyPing({ ok: body.ok, stage: body.stage, message: body.message }));
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
    saveConnectionState({ status: "error", lastError: health.message, lastStepKey: "bridge", lastErrorCode: "BRIDGE_DOWN" });
    return false;
  }
  set("bridge", { state: "ok", detail: "سرویس پاسخ داد", latencyMs: Date.now() - t0 });

  // ۲) ارسال تنظیمات
  set("config", { state: "running" });
  const saved = await savePosSettings(settings);
  if (!saved.ok) {
    set("config", { state: "fail", detail: saved.message });
    failRest("config");
    saveConnectionState({ status: "error", lastError: saved.message, lastStepKey: "config", lastErrorCode: "CFG_INVALID" });
    return false;
  }
  set("config", { state: "ok", detail: saved.message });

  // ۳) و ۴) شبکه و دست‌دهی
  set("network", { state: "running" });
  const ping = await posPing({ ip: settings.deviceIp, port: settings.devicePort }, 8000);
  if (!ping.ok) {
    set("network", { state: "fail", detail: ping.message, latencyMs: ping.latencyMs });
    failRest("network");
    saveConnectionState({ status: "disconnected", lastError: ping.message, lastStepKey: "network", lastErrorCode: ping.code ?? "NET_UNREACHABLE" });
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


/**
 * شروع تراکنش. مبلغ به تومان داده می‌شود و به ریال تبدیل می‌شود.
 * دستگاه معمولاً تا ۲ دقیقه منتظر کشیدن کارت می‌ماند.
 */
export async function posPay(
  params: { amountToman: number; invoiceNumber: string },
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<PosResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 150_000);
  opts.signal?.addEventListener("abort", () => ctrl.abort());
  posLog("pay:start", { invoice: params.invoiceNumber, amountToman: params.amountToman });
  try {
    const res = await fetch(`${getBridgeUrl()}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amountRial: params.amountToman * 10,
        amountToman: params.amountToman,
        invoiceNumber: params.invoiceNumber,
        terminalId: getTerminalId(),
        merchantId: getMerchantId(),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      posLogError("pay:bad-status", { status: res.status, invoice: params.invoiceNumber });
      return { success: false, message: `خطای سرویس کارت‌خوان (${res.status})` };
    }
    const result = (await res.json()) as PosResult;
    if (result.success) posLog("pay:approved", { invoice: params.invoiceNumber, ref: result.refNumber });
    else posLogError("pay:declined", { invoice: params.invoiceNumber, result });
    return result;
  } catch (e) {
    const aborted = (e as Error).name === "AbortError";
    posLogError(aborted ? "pay:aborted" : "pay:network-error", {
      invoice: params.invoiceNumber,
      error: (e as Error).message,
    });
    return {
      success: false,
      message: aborted
        ? "تراکنش لغو شد یا زمان انتظار به پایان رسید"
        : "اتصال به سرویس کارت‌خوان برقرار نشد",
    };
  } finally {
    clearTimeout(t);
  }
}

/** لغو تراکنش جاری روی دستگاه */
export async function posCancel(): Promise<void> {
  try {
    posLog("cancel:request");
    await req("/cancel", { method: "POST" }, 5000);
  } catch (e) {
    posLogError("cancel:failed", (e as Error).message);
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
    expectedKiosk: "Windows 10 Enterprise 22H2 (19045) • Core i5-7500 • 8GB • 1080x1920 لمسی ۱۰ نقطه",
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
    ["زمان شمسی", "زمان میلادی", "نتیجه", "مقصد", "RTT (ms)", "مرحله", "کد خطا", "منشأ خطا", "پیام"],
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
    line("آخرین زمان پاسخ", r.connection.lastLatencyMs != null ? `${r.connection.lastLatencyMs}ms` : "—"),
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
