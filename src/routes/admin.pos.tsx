import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Copy,
  CreditCard,
  Cpu,
  Download,
  FileClock,
  Lock,
  Loader2,
  PlayCircle,
  Printer,
  Radar,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { buildTicketPayload } from "@/lib/receipt";
import {
  buildSupportReport,
  clearPosLogs,
  DEFAULT_BRIDGE_URL,
  DEFAULT_NETWORK_INTERFACE,
  getDeviceIpFor,
  DEFAULT_LAN_IP,
  DEFAULT_WIFI_IP,
  DEVICE_FACTS,
  type PosDiscoveredDevice,
  DEFAULT_DEVICE_PORT,
  DEFAULT_MERCHANT_ID,
  DEFAULT_SERIAL_NUMBER,
  DEFAULT_TERMINAL_ID,
  getPingHistory,
  getPosAccessToken,
  getPosSettings,
  initialPosSteps,
  loadConnectionState,
  posBackoffSeconds,
  posConnectSequence,
  posDiscover,
  posHealth,
  posPing,
  posPrinters,
  posPrintTicket,
  posSavePrinter,
  posStepHint,
  savePosSettings,
  saveConnectionState,
  setPosAccessToken,
  subscribePosEvents,
  supportReportText,
  pingsToCsv,
  type PosConnectionMode,
  type PosDeviceStatus,
  type PosLogEntry,
  type PosPingResult,
  type PosSettings,
  type PosPingRecord,
  type PosStep,
} from "@/lib/pos";
import { PosLiveBadge, type PosLiveState } from "@/components/PosLiveStatus";
import {
  CashierPinCard,
  PosProtocolCard,
  PosTransactionsCard,
} from "@/components/PosTransactionsCard";
import {
  agentHealth,
  getAgentHttpUrl,
  getAgentWsUrl,
  getPayBackend,
  setAgentHttpUrl,
  setAgentWsUrl,
  setPayBackend,
  type PayBackend,
} from "@/lib/pos-agent";
import { summarizeNetworkQuality, qualityTone, recordSource, sourceLabel } from "@/lib/pos-quality";
import {
  DEVICE_PROFILE,
  DEVICE_PROFILE_ROWS,
  NETWORK_INTERFACES,
  networkInterfaceLabel,
  needsIdentityRecovery,
  identityMismatchCodes,
  isApipa,
  sameSubnet,
  type PosNetworkInterface,
} from "@/lib/pos-device";
import {
  POS_ERROR_CATALOG,
  posErrorInfo,
  posSourceSentence,
  posSourceSteps,
  type PosErrorCode,
} from "@/lib/pos-errors";
import {
  auditLabel,
  auditToCsv,
  clearAuditLog,
  getAuditLog,
  logAudit,
  type PosAuditEntry,
} from "@/lib/pos-audit";

export const Route = createFileRoute("/admin/pos")({
  head: () => ({
    meta: [
      { title: "تنظیمات کارت‌خوان — پنل مدیریت" },
      { name: "description", content: "اتصال، تست ارتباط و لاگ زندهٔ کارت‌خوان موزه." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPosGuarded,
});

/* ------------------------------------------------------------------ */
/*  قفل اضافه: باز کردن صفحه با رمز حساب مدیر (اعتبارسنجی سمت سرور)     */
/* ------------------------------------------------------------------ */

const UNLOCK_KEY = "pos.unlockedUntil";
const UNLOCK_HOURS = 8;

function isUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  const until = Number(sessionStorage.getItem(UNLOCK_KEY) ?? 0);
  return Number.isFinite(until) && until > Date.now();
}

function AdminPosGuarded() {
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setUnlocked(isUnlocked());
    setReady(true);
  }, []);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setError("");
    const { data } = await supabase.auth.getUser();
    const email = data.user?.email;
    if (!email) {
      setError("نشست شما منقضی شده است؛ دوباره وارد شوید.");
      logAudit("unlock:failed", { detail: "نشست منقضی شده بود" });
      setChecking(false);
      return;
    }
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setChecking(false);
    if (authError) {
      setError("رمز درست نیست.");
      logAudit("unlock:failed", { user: email, detail: "رمز نادرست" });
      return;
    }
    logAudit("unlock:success", { user: email });
    sessionStorage.setItem(UNLOCK_KEY, String(Date.now() + UNLOCK_HOURS * 3600_000));
    setPassword("");
    setUnlocked(true);
  };

  if (!ready) return null;

  if (!unlocked) {
    return (
      <div className="max-w-md mx-auto mt-10">
        <Toaster position="top-center" richColors />
        <form onSubmit={unlock} className="glass-bronze rounded-2xl p-7 space-y-4 text-center">
          <Lock className="w-10 h-10 text-primary mx-auto" />
          <h2 className="text-xl font-black text-bronze-gradient">صفحهٔ کارت‌خوان قفل است</h2>
          <p className="text-sm text-bronze-light/70 leading-7">
            برای دیدن تنظیمات، توالی اتصال و لاگ زندهٔ دستگاه، رمز حساب مدیر را دوباره وارد کنید.
            قفل برای {UNLOCK_HOURS} ساعت روی همین دستگاه باز می‌ماند.
          </p>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="رمز حساب مدیر"
            className="text-center"
          />
          {error && <p className="text-sm font-bold text-rose-400">{error}</p>}
          <Button type="submit" disabled={checking || !password} className="w-full rounded-xl font-black h-12">
            {checking ? <Loader2 className="w-5 h-5 animate-spin ml-2" /> : <ShieldCheck className="w-5 h-5 ml-2" />}
            باز کردن صفحه
          </Button>
        </form>
      </div>
    );
  }

  return <AdminPos onLock={() => {
    logAudit("lock");
    sessionStorage.removeItem(UNLOCK_KEY);
    setUnlocked(false);
  }} />;
}

const INITIAL: PosSettings = {
  bridgeUrl: DEFAULT_BRIDGE_URL,
  connectionMode: "lan",
  networkInterface: DEFAULT_NETWORK_INTERFACE,
  deviceIp: DEFAULT_LAN_IP,
  devicePort: DEFAULT_DEVICE_PORT,
  merchantId: DEFAULT_MERCHANT_ID,
  terminalId: DEFAULT_TERMINAL_ID,
  serialNumber: DEFAULT_SERIAL_NUMBER,
};

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

function AdminPos({ onLock }: { onLock: () => void }) {
  const [form, setForm] = useState<PosSettings>(INITIAL);
  const [steps, setSteps] = useState<PosStep[]>(initialPosSteps());
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [device, setDevice] = useState<PosDeviceStatus | undefined>();
  const [ping, setPing] = useState<PosPingResult | null>(null);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [manualCheck, setManualCheck] = useState<PosPingResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<PosDiscoveredDevice[]>([]);
  const [logs, setLogs] = useState<PosLogEntry[]>([]);
  const [transport, setTransport] = useState<"sse" | "polling" | null>(null);
  const [token, setToken] = useState("");
  const [pings, setPings] = useState<PosPingRecord[]>([]);
  const [audit, setAudit] = useState<PosAuditEntry[]>([]);
  const [auditFilter, setAuditFilter] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [showCatalog, setShowCatalog] = useState(false);
  const [restored, setRestored] = useState(() => loadConnectionState());
  const [identity, setIdentity] = useState(() => loadConnectionState().lastIdentity);
  const [refreshingProfile, setRefreshingProfile] = useState(false);
  const [subnets, setSubnets] = useState<string[]>([]);

  // بازیابی خودکار شناسنامه (مدل/فریم‌ور ناهمخوان)
  const [autoIdentityRecovery, setAutoIdentityRecovery] = useState(true);
  const [identityAttempt, setIdentityAttempt] = useState(0);
  const [identityRecovering, setIdentityRecovering] = useState(false);
  const identityBusy = useRef(false);

  // بازآزمایی خودکار
  const [autoRetry, setAutoRetry] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const busy = useRef(false);
  const logBox = useRef<HTMLDivElement>(null);

  const audits = useCallback(
    (kind: Parameters<typeof logAudit>[0], data: Parameters<typeof logAudit>[1] = {}) => {
      setAudit(logAudit(kind, { ...data, user: userEmail }));
    },
    [userEmail],
  );

  const set = <K extends keyof PosSettings>(key: K, value: PosSettings[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const pushLog = useCallback((entry: PosLogEntry) => {
    setLogs((l) => [...l.slice(-199), entry]);
  }, []);

  const localLog = useCallback(
    (level: PosLogEntry["level"], event: string, message: string) =>
      pushLog({
        id: Date.now() + Math.random(),
        level,
        event,
        message,
        time: new Date().toLocaleTimeString("fa-IR"),
      }),
    [pushLog],
  );

  /** اجرای کامل توالی اتصال */
  const startConnect = useCallback(
    async (settings: PosSettings, silent = false) => {
      if (busy.current) return false;
      busy.current = true;
      setConnecting(true);
      setSteps(initialPosSteps());
      if (!silent) localLog("info", "connect", "شروع بررسی اتصال...");
      audits("connect:start", {
        detail: `${settings.deviceIp || "—"}:${settings.devicePort}${silent ? " (خودکار)" : ""}`,
      });

      const ok = await posConnectSequence(settings, setSteps);
      setConnected(ok);
      setConnecting(false);
      busy.current = false;

      const p = await posPing({ ip: settings.deviceIp, port: settings.devicePort });
      setPing(p);
      setPings(getPingHistory());
      setRestored(loadConnectionState());
      if (ok) {
        setLastOk(new Date().toLocaleTimeString("fa-IR"));
        saveConnectionState({ status: "connected" });
        setAttempt(0);
        setCountdown(0);
        localLog("info", "connect", `اتصال برقرار شد (${p.latencyMs ?? 0}ms)`);
        audits("connect:result", { code: "OK", detail: `متصل — ${p.latencyMs ?? 0}ms` });
        if (!silent) toast.success("اتصال کارت‌خوان برقرار شد");
      } else {
        saveConnectionState({ status: "disconnected" });
        const failed = steps.find((s) => s.state === "fail");
        localLog("error", "connect", `اتصال ناموفق — ${failed?.detail ?? p.message}`);
        audits("connect:result", {
          code: p.code ?? "UNKNOWN",
          detail: failed?.detail ?? p.message,
        });
        if (!silent) toast.error("اتصال برقرار نشد — جزئیات را در مراحل زیر ببینید");
      }
      return ok;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localLog, audits],
  );

  // بارگذاری اولیه + لاگ زنده
  useEffect(() => {
    const s = getPosSettings();
    setForm(s);
    setToken(getPosAccessToken());
    setPings(getPingHistory());
    setAudit(getAuditLog());
    void supabase.auth.getUser().then(({ data }) => {
      const email = data.user?.email ?? "";
      setUserEmail(email);
      setAudit(logAudit("page:open", { user: email }));
    });
    const saved = loadConnectionState();
    setRestored(saved);
    if (saved.lastOkAt) setLastOk(new Date(saved.lastOkAt).toLocaleTimeString("fa-IR"));
    if (saved.status === "connected") setConnected(true);

    void (async () => {
      const h = await posHealth();
      setDevice(h.device);
      // اگر IP ذخیره‌شده داریم فقط یک ping سریع می‌زنیم، نه اسکن کامل
      if (h.ok && s.deviceIp) {
        const p = await posPing({ ip: s.deviceIp, port: s.devicePort }, 4000);
        setPing(p);
        if (p.identity) setIdentity(p.identity);
        setPings(getPingHistory());
        setConnected(p.ok);
        if (p.ok) setLastOk(new Date().toLocaleTimeString("fa-IR"));
      } else {
        setConnected(h.ok);
        if (h.ok) setLastOk(new Date().toLocaleTimeString("fa-IR"));
      }
      setRestored(loadConnectionState());
    })();

    setAudit(logAudit("logs:watch", { detail: "اتصال به استریم لاگ سرویس پل" }));
    const unsub = subscribePosEvents({
      onLog: pushLog,
      onStatus: setDevice,
      onTransport: setTransport,
    });
    return () => {
      setAudit(logAudit("logs:stop", { detail: "قطع استریم لاگ" }));
      unsub();
    };
  }, [pushLog]);

  // اسکرول خودکار لاگ
  useEffect(() => {
    logBox.current?.scrollTo({ top: logBox.current.scrollHeight });
  }, [logs]);

  // بازگشت از حالت پس‌زمینه: ادامهٔ اتصال با همان backoff
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === "hidden" || busy.current) return;
      const s = getPosSettings();
      if (connected === false) {
        setAttempt(0);
        localLog("warn", "resume", "بازگشت به صفحه — تلاش دوبارهٔ اتصال");
        void startConnect(s, true);
      } else {
        void (async () => {
          const p = await posPing({ ip: s.deviceIp, port: s.devicePort }, 4000);
          setPing(p);
          setPings(getPingHistory());
          setConnected(p.ok);
          setRestored(loadConnectionState());
          if (!p.ok) localLog("warn", "resume", `پس از بازگشت دستگاه پاسخ نداد — ${p.message}`);
        })();
      }
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
    };
  }, [connected, startConnect, localLog]);

  // بازآزمایی خودکار با backoff نمایی
  useEffect(() => {
    if (retryTimer.current) clearInterval(retryTimer.current);
    if (!autoRetry || connected !== false || connecting) return;

    const wait = posBackoffSeconds(attempt);
    setCountdown(wait);
    retryTimer.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (retryTimer.current) clearInterval(retryTimer.current);
          setAttempt((a) => a + 1);
          localLog("warn", "retry", `تلاش مجدد شمارهٔ ${attempt + 1}`);
          void startConnect(getPosSettings(), true);
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => {
      if (retryTimer.current) clearInterval(retryTimer.current);
    };
  }, [autoRetry, connected, connecting, attempt, startConnect, localLog]);

  const verifyManual = async () => {
    if (form.connectionMode === "lan" && !IP_RE.test(form.deviceIp.trim())) {
      setManualCheck({ ok: false, message: "قالب IP درست نیست (مثال: 192.168.1.100)" });
      return;
    }
    setVerifying(true);
    const p = await posPing({ ip: form.deviceIp, port: form.devicePort });
    setManualCheck(p);
    setVerifying(false);
    localLog(p.ok ? "info" : "error", "verify", `${form.deviceIp}:${form.devicePort} — ${p.message}`);
    audits(p.stage === "handshake" ? "handshake" : "ping", {
      code: p.code ?? (p.ok ? "OK" : "UNKNOWN"),
      detail: `${form.deviceIp}:${form.devicePort} — ${p.message}`,
    });
  };

  /** جابه‌جایی بین کابل و وای‌فای؛ IP هر رابط جداگانه به یاد سپرده می‌شود */
  const switchInterface = (iface: PosNetworkInterface) => {
    const remembered = getDeviceIpFor(iface);
    setForm((f) => ({
      ...f,
      networkInterface: iface,
      deviceIp: remembered || (iface === "wifi" ? DEFAULT_WIFI_IP : ""),
    }));
    setFound([]);
    setManualCheck(null);
    localLog("info", "config", `رابط شبکه روی «${networkInterfaceLabel(iface)}» تنظیم شد`);
  };

  const save = async () => {
    const res = await savePosSettings(form);
    if (res.ok) toast.success(res.message);
    else toast.warning(res.message);
    localLog(res.ok ? "info" : "warn", "config", res.message);
    audits("settings:change", {
      code: res.ok ? "OK" : "CFG_INVALID",
      detail: `IP ${form.deviceIp}:${form.devicePort} • پایانه ${form.terminalId} • حالت ${form.connectionMode}`,
    });
    await startConnect(form);
  };

  const discover = async () => {
    setScanning(true);
    setFound([]);
    localLog("info", "discover", "جست‌وجوی خودکار در شبکه...");
    const res = await posDiscover(form.devicePort, 60_000, form.serialNumber);
    setFound(res.devices);
    setSubnets(res.subnets);
    if (res.ok && res.best) {
      set("deviceIp", res.best.ip);
      setManualCheck(null);
      if (res.best.serialMatch) toast.success(res.message);
      else toast.warning(res.message);
    } else {
      toast.error(res.message);
    }
    localLog(res.ok ? "info" : "error", "discover", res.message);
    audits("discover", { code: res.ok ? "OK" : "NET_UNREACHABLE", detail: res.message });
    setScanning(false);
  };

  /** اسکن دوبارهٔ چندزیرشبکه‌ای + خواندن دوبارهٔ شناسنامهٔ دستگاه، بدون رفرش صفحه */
  const rescanProfile = async () => {
    setRefreshingProfile(true);
    localLog("info", "discover", "اسکن دوباره و به‌روزرسانی شناسنامهٔ دستگاه…");
    const res = await posDiscover(form.devicePort, 60_000, form.serialNumber);
    setFound(res.devices);
    setSubnets(res.subnets);
    const target = res.best?.ip || form.deviceIp;
    if (res.best?.ip) set("deviceIp", res.best.ip);
    audits("discover", { code: res.ok ? "OK" : "NET_UNREACHABLE", detail: res.message });

    if (target) {
      const p = await posPing({ ip: target, port: form.devicePort }, 6000);
      setPing(p);
      setPings(getPingHistory());
      setConnected(p.ok);
      if (p.identity) setIdentity(p.identity);
      if (p.ok) setLastOk(new Date().toLocaleTimeString("fa-IR"));
      setRestored(loadConnectionState());
      localLog(p.ok ? "info" : "error", "handshake", p.message);
      if (p.identity && !p.identity.ok)
        toast.warning("مشخصات دستگاه با شناسنامهٔ ثبت‌شده همخوان نیست");
      else if (p.ok) toast.success("شناسنامهٔ دستگاه به‌روز شد");
      else toast.error(p.message);
    } else {
      toast.error(res.message);
    }
    setRefreshingProfile(false);
  };

  const MAX_IDENTITY_ATTEMPTS = 2;

  /**
   * بازیابی خودکار وقتی مدل یا فریم‌ور دستگاه با شناسنامهٔ ثبت‌شده همخوان نیست:
   * ۱) اتصال دوبارهٔ سبک روی همان IP  ۲) اگر باز ناهمخوان بود، اسکن محدود برای یافتن سریال درست.
   */
  const recoverIdentity = useCallback(
    async (round: number) => {
      if (identityBusy.current) return;
      identityBusy.current = true;
      setIdentityRecovering(true);
      const settings = getPosSettings();
      localLog(
        "warn",
        "identity",
        `بازیابی خودکار شناسنامه — تلاش ${round} از ${MAX_IDENTITY_ATTEMPTS}`,
      );
      audits("identity:recover", { detail: `تلاش ${round} روی ${settings.deviceIp || "—"}` });

      // ۱) اتصال دوبارهٔ سبک روی همان آدرس
      let p = await posPing({ ip: settings.deviceIp, port: settings.devicePort }, 6000);
      setPing(p);
      setPings(getPingHistory());
      if (p.identity) setIdentity(p.identity);

      // ۲) اگر همچنان ناهمخوان بود: اسکن محدود همان زیرشبکه
      if (needsIdentityRecovery(p.identity)) {
        localLog("warn", "identity", "ناهمخوانی ادامه دارد — اسکن محدود زیرشبکه…");
        const res = await posDiscover(settings.devicePort, 25_000, settings.serialNumber);
        setFound(res.devices);
        setSubnets(res.subnets);
        const match = res.devices.find((d) => d.serialMatch) ?? res.best;
        if (match?.ip) {
          set("deviceIp", match.ip);
          await savePosSettings({ ...settings, deviceIp: match.ip });
          p = await posPing({ ip: match.ip, port: settings.devicePort }, 6000);
          setPing(p);
          setPings(getPingHistory());
          if (p.identity) setIdentity(p.identity);
          localLog("info", "identity", `دستگاه هم‌سریال روی ${match.ip} آزمایش شد — ${p.message}`);
        } else {
          localLog("error", "identity", res.message);
        }
      }

      const stillBad = needsIdentityRecovery(p.identity);
      setConnected(p.ok && !stillBad);
      setRestored(loadConnectionState());
      if (!stillBad) {
        audits("identity:recovered", {
          code: "OK",
          rttMs: p.latencyMs,
          source: sourceLabel("ok"),
          detail: `شناسنامه تأیید شد روی ${getPosSettings().deviceIp}`,
        });
        localLog("info", "identity", "شناسنامهٔ دستگاه تأیید شد — هشدار برداشته شد");
        toast.success("شناسنامهٔ دستگاه به‌طور خودکار تأیید شد");
      } else {
        audits("identity:mismatch", {
          code: identityMismatchCodes(p.identity).join("، ") || "DEV_MODEL_MISMATCH",
          rttMs: p.latencyMs,
          source: sourceLabel("device"),
          detail: `تلاش ${round} ناموفق`,
        });
      }
      setIdentityRecovering(false);
      identityBusy.current = false;
    },
    [audits, localLog],
  );

  // فعال‌سازی بازیابی خودکار در صورت ناهمخوانی مدل/فریم‌ور — با سقف تلاش
  useEffect(() => {
    if (!autoIdentityRecovery) return;
    if (!needsIdentityRecovery(identity)) return;
    if (identityRecovering || identityBusy.current) return;

    if (identityAttempt >= MAX_IDENTITY_ATTEMPTS) {
      if (identityAttempt === MAX_IDENTITY_ATTEMPTS) {
        setIdentityAttempt((a) => a + 1);
        localLog(
          "error",
          "identity",
          "بازیابی خودکار متوقف شد — نیازمند بررسی دستی دستگاه است",
        );
        audits("identity:giveup", {
          code: identityMismatchCodes(identity).join("، "),
          source: sourceLabel("device"),
          detail: `پس از ${MAX_IDENTITY_ATTEMPTS} تلاش`,
        });
        toast.error("ناهمخوانی شناسنامه با بازیابی خودکار رفع نشد — بررسی دستی لازم است");
      }
      return;
    }

    const next = identityAttempt + 1;
    const t = setTimeout(() => {
      setIdentityAttempt(next);
      void recoverIdentity(next);
    }, 2500);
    return () => clearTimeout(t);
  }, [
    autoIdentityRecovery,
    identity,
    identityAttempt,
    identityRecovering,
    recoverIdentity,
    localLog,
    audits,
  ]);



  const copyLogs = async () => {
    const text = logs.map((l) => `${l.time} [${l.level}] ${l.event} — ${l.message}`).join("\n");
    await navigator.clipboard.writeText(text);
    toast.success("لاگ کپی شد");
  };

  const clearLogs = async () => {
    setLogs([]);
    audits("logs:clear");
    await clearPosLogs();
  };

  const reportText = () => supportReportText(buildSupportReport(logs));

  const downloadReport = () => {
    const report = buildSupportReport(logs);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const blob = new Blob(
      [reportText() + "\n\n--- JSON ---\n" + JSON.stringify(report, null, 2)],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pos-report-${report.settings.serialNumber}-${stamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    audits("report:download", { code: report.connection.lastErrorCode });
    toast.success("گزارش پشتیبانی دانلود شد");
  };

  const copyReport = async () => {
    await navigator.clipboard.writeText(reportText());
    audits("report:copy");
    toast.success("گزارش کپی شد");
  };

  const lastCode: PosErrorCode | undefined =
    (ping?.code as PosErrorCode | undefined) ?? restored.lastErrorCode;
  const diag = posErrorInfo(lastCode);
  const diagSteps = posSourceSteps(diag.source);

  const filteredAudit = [...audit]
    .reverse()
    .filter((e) => {
      const q = auditFilter.trim();
      if (!q) return true;
      return `${auditLabel(e.kind)} ${e.user} ${e.code ?? ""} ${e.detail ?? ""} ${e.atFa}`.includes(q);
    });

  // شناسنامه که سالم شد، شمارندهٔ بازیابی صفر می‌شود
  useEffect(() => {
    if (identity && identity.ok && identityAttempt !== 0) setIdentityAttempt(0);
  }, [identity, identityAttempt]);

  const downloadPingsCsv = () => {
    const blob = new Blob([pingsToCsv(pings)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pos-attempts-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    audits("report:download", {
      code: quality.dominantSource ? sourceLabel(quality.dominantSource) : "OK",
      rttMs: quality.lastRttMs,
      source: sourceLabel(quality.dominantSource),
      detail: `CSV تلاش‌های اتصال (${pings.length} ردیف)`,
    });
    toast.success("CSV تلاش‌های اتصال دانلود شد");
  };

  const downloadAudit = () => {
    const blob = new Blob([auditToCsv(audit)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pos-audit-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("سوابق دسترسی دانلود شد");
  };

  const statusColor = connecting
    ? "bg-amber-400 animate-pulse"
    : connected
      ? "bg-emerald-400"
      : "bg-rose-500";

  const liveState: PosLiveState = connecting
    ? "connecting"
    : connected
      ? "connected"
      : "disconnected";
  const quality = summarizeNetworkQuality(pings);

  /** تشخیص «کیوسک و کارت‌خوان در یک شبکه نیستند» یا «کابل بدون DHCP» */
  const subnetWarning = (() => {
    const ip = form.deviceIp.trim();
    if (subnets.some((sn) => isApipa(sn) || sn.startsWith("169.254"))) {
      return {
        code: "NET_CABLE_UNPLUGGED",
        title: "کارت شبکهٔ کابلی آدرس معتبر نگرفته است (169.254.x.x)",
        hint: "کابل اترنت کیوسک آدرس DHCP نگرفته؛ کابل و پورت سوییچ را بررسی کنید یا موقتاً روی وای‌فای همان شبکهٔ کارت‌خوان بروید.",
      };
    }
    if (!ip || subnets.length === 0) return null;
    const anySame = subnets.some((sn) => sameSubnet(`${sn}.1`, ip) === true);
    if (anySame) return null;
    return {
      code: "NET_WRONG_SUBNET",
      title: "کیوسک و کارت‌خوان در یک زیرشبکه نیستند",
      hint: `زیرشبکهٔ کیوسک: ${subnets.join("، ")} — آدرس کارت‌خوان: ${ip}. هر دو باید روی یک شبکه باشند؛ کابل کارت‌خوان را به همان سوییچ/روتر کیوسک بزنید یا کیوسک را به وای‌فای «${DEVICE_PROFILE.wifiSsid}» وصل کنید.`,
    };
  })();

  return (
    <div className="space-y-6 max-w-3xl">
      <Toaster position="top-center" richColors />

      <div className="flex items-center gap-3">
        <CreditCard className="w-6 h-6 text-primary" />
        <h2 className="text-2xl font-black text-bronze-gradient">
          تنظیمات کارت‌خوان (PAX Q58 — پارسیان)
        </h2>
        <div className="flex-1" />
        <PosLiveBadge state={liveState} latencyMs={ping?.latencyMs ?? restored.lastLatencyMs} />
        <Button variant="secondary" className="rounded-xl h-9 font-black" onClick={onLock}>
          <Lock className="w-4 h-4 ml-2" /> قفل کردن دوباره
        </Button>
      </div>

      {/* وضعیت + دکمهٔ شروع اتصال */}
      <div className="glass-bronze rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full ${statusColor}`} />
            <div>
              <p className="font-black text-bronze-light">
                {connecting
                  ? "در حال اتصال…"
                  : connected
                    ? "کارت‌خوان متصل است"
                    : connected === false
                      ? "اتصال برقرار نیست"
                      : "بررسی نشده"}
              </p>
              <p className="text-xs text-bronze-light/60">
                {ping?.message ?? device?.message ?? "—"}
                {ping?.latencyMs != null && ` • زمان پاسخ ${ping.latencyMs}ms`}
                {lastOk && ` • آخرین اتصال موفق ${lastOk}`}
              </p>
              <p className="text-xs text-bronze-light/50">
                {restored.updatedAt
                  ? `وضعیت ذخیره‌شده: ${
                      restored.status === "connected"
                        ? "متصل"
                        : restored.status === "disconnected"
                          ? "قطع"
                          : restored.status === "error"
                            ? "خطا"
                            : "نامشخص"
                    }${
                      restored.lastOkAt
                        ? ` • آخرین اتصال موفق ${new Date(restored.lastOkAt).toLocaleString("fa-IR")}`
                        : ""
                    }${restored.lastLatencyMs != null ? ` — ${restored.lastLatencyMs}ms` : ""}`
                  : "هنوز وضعیتی ذخیره نشده است"}
              </p>
              <p className="text-xs text-bronze-light/40" dir="ltr">
                serial {form.serialNumber} • terminal {form.terminalId} • merchant {form.merchantId}
              </p>
            </div>
          </div>

          <Button
            onClick={() => void startConnect(form)}
            disabled={connecting}
            className="rounded-xl font-black h-12 px-6"
          >
            {connecting ? (
              <Loader2 className="w-5 h-5 animate-spin ml-2" />
            ) : (
              <PlayCircle className="w-5 h-5 ml-2" />
            )}
            شروع اتصال
          </Button>
        </div>

        {/* مراحل */}
        <ol className="space-y-2">
          {steps.map((s) => (
            <li key={s.key} className="flex items-start gap-3 text-sm">
              {s.state === "ok" ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : s.state === "fail" ? (
                <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              ) : s.state === "running" ? (
                <Loader2 className="w-5 h-5 text-amber-400 animate-spin shrink-0 mt-0.5" />
              ) : (
                <Circle className="w-5 h-5 text-bronze-light/25 shrink-0 mt-0.5" />
              )}
              <div>
                <p
                  className={`font-bold ${
                    s.state === "fail"
                      ? "text-rose-300"
                      : s.state === "ok"
                        ? "text-bronze-light"
                        : "text-bronze-light/60"
                  }`}
                >
                  {s.label}
                  {s.latencyMs != null && s.state === "ok" && (
                    <span className="text-bronze-light/45 font-medium"> — {s.latencyMs}ms</span>
                  )}
                </p>
                {s.detail && <p className="text-xs text-bronze-light/55">{s.detail}</p>}
                {s.state === "fail" && (
                  <p className="text-xs text-amber-300/80 mt-1">{posStepHint(s.key)}</p>
                )}
              </div>
            </li>
          ))}
        </ol>

        {/* بازآزمایی خودکار */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/10">
          <p className="text-xs text-bronze-light/70">
            {connected === false && autoRetry
              ? `در حال اتصال… تلاش ${attempt + 1} — تلاش بعدی تا ${countdown} ثانیه`
              : autoRetry
                ? "بازآزمایی خودکار فعال است"
                : "بازآزمایی خودکار خاموش است"}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="rounded-xl font-black h-9"
              onClick={() => {
                setAutoRetry((v) => !v);
                setCountdown(0);
              }}
            >
              {autoRetry ? "توقف بازآزمایی" : "شروع بازآزمایی خودکار"}
            </Button>
            <Button
              variant="secondary"
              className="rounded-xl font-black h-9"
              disabled={connecting}
              onClick={() => void startConnect(form)}
            >
              <RefreshCw className="w-4 h-4 ml-2" />
              بازآزمایی الان
            </Button>
          </div>
        </div>
      </div>

      {/* شناسنامهٔ دستگاه */}
      <div className="glass rounded-2xl p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Cpu className="w-5 h-5 text-primary" />
          <p className="font-black text-bronze-light">شناسنامهٔ دستگاه کارت‌خوان</p>
          <div className="flex-1" />
          <PosLiveBadge state={liveState} latencyMs={ping?.latencyMs} />
          <Button
            variant="secondary"
            className="rounded-xl h-9 font-black"
            disabled={refreshingProfile || scanning}
            onClick={() => void rescanProfile()}
          >
            {refreshingProfile ? (
              <Loader2 className="w-4 h-4 animate-spin ml-2" />
            ) : (
              <RefreshCw className="w-4 h-4 ml-2" />
            )}
            اسکن دوباره و به‌روزرسانی شناسنامه
          </Button>
        </div>

        {/* هشدار ناهمخوانی مدل/فریم‌ور/سریال */}
        {identity && !identity.ok && (
          <div className="rounded-xl border-2 border-amber-400/40 bg-amber-400/10 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <p className="font-black text-amber-300">
                مشخصات دستگاه با شناسنامهٔ ثبت‌شده همخوان نیست
              </p>
            </div>
            {identity.mismatches.map((m) => (
              <div key={m.field} className="text-sm space-y-1">
                <p className="font-bold text-bronze-light/90">
                  {m.label} — کد خطا:{" "}
                  <span dir="ltr" className="font-mono text-amber-300">
                    {m.code}
                  </span>
                </p>
                <p className="text-xs text-bronze-light/70" dir="ltr">
                  ثبت‌شده: {m.expected} ← دریافتی از دستگاه: {m.reported}
                </p>
                <p className="text-xs text-bronze-light/60">{POS_ERROR_CATALOG[m.code].hint}</p>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {identityRecovering ? (
                <span className="flex items-center gap-2 text-xs font-black text-amber-300">
                  <Loader2 className="w-4 h-4 animate-spin" /> بازیابی خودکار در حال اجرا (تلاش{" "}
                  {identityAttempt} از 2)…
                </span>
              ) : identityAttempt > 2 ? (
                <span className="text-xs font-black text-rose-300">
                  بازیابی خودکار متوقف شد — بررسی دستی دستگاه لازم است.
                </span>
              ) : (
                <span className="text-xs text-bronze-light/70">
                  {autoIdentityRecovery
                    ? "بازیابی خودکار فعال است و به‌زودی اجرا می‌شود."
                    : "بازیابی خودکار خاموش است."}
                </span>
              )}
              <div className="flex-1" />
              <Button
                variant="secondary"
                className="rounded-xl h-8 text-xs font-black"
                onClick={() => {
                  setIdentityAttempt(0);
                  void recoverIdentity(1);
                }}
                disabled={identityRecovering}
              >
                <RefreshCw className="w-3.5 h-3.5 ml-1.5" /> بازیابی الان
              </Button>
              <Button
                variant={autoIdentityRecovery ? "default" : "secondary"}
                className="rounded-xl h-8 text-xs font-black"
                onClick={() => {
                  setAutoIdentityRecovery((v) => !v);
                  setIdentityAttempt(0);
                }}
              >
                {autoIdentityRecovery ? "خاموش کردن بازیابی خودکار" : "روشن کردن بازیابی خودکار"}
              </Button>
            </div>
          </div>
        )}

        {/* هشدار زیرشبکهٔ ناهمخوان / کابل بدون DHCP */}
        {subnetWarning && (
          <div className="rounded-xl border-2 border-rose-400/40 bg-rose-400/10 p-4 space-y-1">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-400" />
              <p className="font-black text-rose-300">{subnetWarning.title}</p>
              <span dir="ltr" className="font-mono text-xs text-rose-200/80">
                {subnetWarning.code}
              </span>
            </div>
            <p className="text-xs text-bronze-light/75 leading-6">{subnetWarning.hint}</p>
          </div>
        )}

        {/* کیفیت شبکه و زمان پاسخ */}
        <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Activity className={`w-4 h-4 ${qualityTone(quality.rating)}`} />
            <p className="font-black text-bronze-light">کیفیت شبکه</p>
            <span className={`font-black ${qualityTone(quality.rating)}`}>{quality.label}</span>
            <div className="flex-1" />
            <span className="text-xs text-bronze-light/50">
              بر پایهٔ {quality.attempts} تلاش اخیر
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            {[
              { k: "آخرین RTT", v: quality.lastRttMs != null ? `${quality.lastRttMs}ms` : "—" },
              { k: "میانگین RTT", v: quality.avgRttMs != null ? `${quality.avgRttMs}ms` : "—" },
              {
                k: "کمینه/بیشینه",
                v:
                  quality.minRttMs != null
                    ? `${quality.minRttMs}/${quality.maxRttMs}ms`
                    : "—",
              },
              { k: "نوسان (jitter)", v: quality.jitterMs != null ? `${quality.jitterMs}ms` : "—" },
              { k: "بسته‌های بی‌پاسخ", v: `${quality.lossPercent}٪` },
              { k: "پایان زمان انتظار", v: `${quality.timeouts} بار` },
              { k: "پاسخ موفق", v: `${quality.okCount} از ${quality.attempts}` },
              {
                k: "منشأ غالب خطا",
                v:
                  quality.dominantSource === "network"
                    ? "شبکه"
                    : quality.dominantSource === "device"
                      ? "دستگاه"
                      : quality.dominantSource === "bridge"
                        ? "سرویس پل"
                        : quality.dominantSource === "config"
                          ? "تنظیمات"
                          : "—",
              },
            ].map((c) => (
              <div key={c.k} className="rounded-lg bg-white/5 py-2">
                <p className="text-[11px] text-bronze-light/50">{c.k}</p>
                <p dir="ltr" className="font-black text-bronze-light text-sm">
                  {c.v}
                </p>
              </div>
            ))}
          </div>
          <p className="text-xs text-bronze-light/60 leading-6">{quality.hint}</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
          {DEVICE_PROFILE_ROWS.map((r) => (
            <div
              key={r.label}
              className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5"
            >
              <span className="text-xs text-bronze-light/50 shrink-0">{r.label}</span>
              <span
                dir={r.ltr ? "ltr" : "rtl"}
                className="text-sm font-bold text-bronze-light/90 text-left"
              >
                {r.value}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-bronze-light/45 leading-6">
          این مقادیر از برچسب پشت دستگاه و منوی «اطلاعات سیستم» خوانده شده‌اند. رمز دستگاه و توکن
          سرویس در این صفحه نمایش داده نمی‌شوند.
        </p>
      </div>

      {/* تشخیص سریع */}
      <div
        className={`rounded-2xl p-5 space-y-3 border ${
          diag.source === "ok"
            ? "border-emerald-400/30 bg-emerald-400/5"
            : "border-amber-400/30 bg-amber-400/5"
        }`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-black text-bronze-light">تشخیص سریع</p>
          <span
            dir="ltr"
            className="px-2 py-0.5 rounded-lg bg-black/30 text-xs font-mono text-bronze-light/80"
          >
            {lastCode ?? "—"}
          </span>
          <span className="text-sm font-bold text-bronze-light/80">{diag.label}</span>
        </div>
        <p className="text-sm font-black text-bronze-light">{posSourceSentence(diag.source)}</p>
        <p className="text-xs text-bronze-light/70 leading-6">{diag.hint}</p>
        {diag.source !== "ok" && (
          <ol className="text-xs text-bronze-light/70 leading-6 list-decimal pr-5 space-y-1">
            {diagSteps.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        )}
        <div className="text-xs text-bronze-light/50 leading-6" dir="rtl">
          دستگاه: {DEVICE_FACTS.model} • وای‌فای {DEVICE_FACTS.wifiSsid} • کد تله‌پرداز{" "}
          <span dir="ltr">{DEVICE_FACTS.telecomCode}</span> • حساب{" "}
          <span dir="ltr">{DEVICE_FACTS.accountNumber}</span> • نسخه{" "}
          <span dir="ltr">{DEVICE_FACTS.appVersion}</span>
        </div>
        <button
          type="button"
          onClick={() => setShowCatalog((v) => !v)}
          className="text-xs font-black text-primary underline underline-offset-4"
        >
          {showCatalog ? "بستن فهرست کدهای خطا" : "دیدن فهرست کامل کدهای خطا"}
        </button>
        {showCatalog && (
          <div className="rounded-xl bg-black/25 p-3 space-y-2 text-xs max-h-56 overflow-y-auto">
            {Object.values(POS_ERROR_CATALOG)
              .filter((c) => c.code !== "OK")
              .map((c) => (
                <div key={c.code} className="leading-6">
                  <span dir="ltr" className="font-mono text-primary">
                    {c.code}
                  </span>{" "}
                  — <span className="font-bold text-bronze-light/85">{c.label}</span>{" "}
                  <span className="text-bronze-light/45">
                    ({posSourceSentence(c.source).replace("مشکل از ", "").replace(".", "")})
                  </span>
                  <p className="text-bronze-light/60">{c.hint}</p>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* تنظیمات */}
      <div className="glass-bronze rounded-2xl p-6 space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-bold text-bronze-light/80">
            آدرس سرویس پل روی همین کیوسک
          </label>
          <Input
            dir="ltr"
            value={form.bridgeUrl}
            onChange={(e) => set("bridgeUrl", e.target.value)}
            className="text-left"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-bronze-light/80">نوع اتصال دستگاه</label>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                { key: "lan", label: "شبکه (LAN / IP)" },
                { key: "com", label: "کابل USB" },
              ] as { key: PosConnectionMode; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => set("connectionMode", key)}
                className={`h-12 rounded-xl border-2 font-black transition ${
                  form.connectionMode === key
                    ? "border-primary text-primary bg-primary/10"
                    : "border-white/10 text-bronze-light/70 hover:border-primary/40"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {form.connectionMode === "lan" && (
          <div className="space-y-2">
            <label className="text-sm font-bold text-bronze-light/80">رابط شبکهٔ دستگاه</label>
            <div className="grid grid-cols-2 gap-3">
              {NETWORK_INTERFACES.map((i) => (
                <button
                  key={i.key}
                  type="button"
                  onClick={() => switchInterface(i.key)}
                  className={`p-3 rounded-xl border-2 text-right transition ${
                    form.networkInterface === i.key
                      ? "border-primary bg-primary/10"
                      : "border-white/10 hover:border-primary/40"
                  }`}
                >
                  <p
                    className={`font-black ${
                      form.networkInterface === i.key ? "text-primary" : "text-bronze-light/80"
                    }`}
                  >
                    {i.label}
                  </p>
                  <p className="text-xs text-bronze-light/50 leading-5 mt-1">{i.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {form.connectionMode === "lan" && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-2">
                <label className="text-sm font-bold text-bronze-light/80">
                  IP دستگاه روی {networkInterfaceLabel(form.networkInterface)}
                </label>
                <Input
                  dir="ltr"
                  placeholder={
                    form.networkInterface === "wifi" ? DEFAULT_WIFI_IP : "مثلاً 192.168.16.50"
                  }
                  value={form.deviceIp}
                  onChange={(e) => {
                    set("deviceIp", e.target.value);
                    setManualCheck(null);
                  }}
                  className="text-left"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-bronze-light/80">پورت</label>
                <Input
                  dir="ltr"
                  value={form.devicePort}
                  onChange={(e) => {
                    set("devicePort", e.target.value);
                    setManualCheck(null);
                  }}
                  className="text-left"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                className="rounded-xl font-black h-9"
                disabled={verifying}
                onClick={() => void verifyManual()}
              >
                {verifying ? (
                  <Loader2 className="w-4 h-4 animate-spin ml-2" />
                ) : (
                  <Zap className="w-4 h-4 ml-2" />
                )}
                تأیید همین آدرس
              </Button>
              <Button
                variant="secondary"
                className="rounded-xl font-black h-9"
                disabled={scanning}
                onClick={() => void discover()}
              >
                {scanning ? (
                  <Loader2 className="w-4 h-4 animate-spin ml-2" />
                ) : (
                  <Radar className="w-4 h-4 ml-2" />
                )}
                جست‌وجوی خودکار در شبکه
              </Button>
              {manualCheck && (
                <span
                  className={`text-sm font-bold ${manualCheck.ok ? "text-emerald-400" : "text-rose-400"}`}
                >
                  {manualCheck.ok ? "✓ " : "✕ "}
                  {manualCheck.message}
                </span>
              )}
            </div>

            {found.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-bronze-light/60">
                  دستگاه‌های پاسخ‌دهنده روی پورت {form.devicePort} — موردی را انتخاب کنید:
                </p>
                {found.map((d) => (
                  <button
                    key={d.ip}
                    type="button"
                    onClick={() => {
                      set("deviceIp", d.ip);
                      setManualCheck(null);
                    }}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl border text-sm ${
                      form.deviceIp === d.ip
                        ? "border-primary bg-primary/10"
                        : "border-white/10 hover:border-primary/40"
                    }`}
                  >
                    <span dir="ltr" className="font-black text-bronze-light">
                      {d.ip}
                    </span>
                    <span className="flex items-center gap-2 text-xs">
                      {d.latencyMs != null && (
                        <span className="text-bronze-light/50" dir="ltr">
                          {d.latencyMs}ms
                        </span>
                      )}
                      {d.serialNumber && (
                        <span className="text-bronze-light/50" dir="ltr">
                          S/N {d.serialNumber}
                        </span>
                      )}
                      <span
                        className={`font-black ${
                          d.serialMatch ? "text-emerald-400" : "text-amber-400"
                        }`}
                      >
                        {d.serialMatch ? "✓ سریال تأیید شد" : "سریال تأیید نشد"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-bold text-bronze-light/80">کد پذیرنده</label>
            <Input
              dir="ltr"
              value={form.merchantId}
              onChange={(e) => set("merchantId", e.target.value)}
              className="text-left"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-bronze-light/80">کد پایانه</label>
            <Input
              dir="ltr"
              value={form.terminalId}
              onChange={(e) => set("terminalId", e.target.value)}
              className="text-left"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-bronze-light/80">شماره سریال</label>
            <Input
              dir="ltr"
              value={form.serialNumber}
              onChange={(e) => set("serialNumber", e.target.value)}
              className="text-left"
            />
          </div>
        </div>

        <Button onClick={() => void save()} className="rounded-xl font-black">
          ذخیره و اتصال
        </Button>
      </div>

      {/* توکن دسترسی سرویس پل */}
      <div className="glass rounded-2xl p-5 space-y-3">
        <p className="font-black text-bronze-light flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" /> توکن دسترسی سرویس پل
        </p>
        <p className="text-xs text-bronze-light/60 leading-6">
          اگر در فایل <span dir="ltr">pos-bridge\appsettings.json</span> مقدار
          <span dir="ltr"> accessToken </span>تنظیم شده باشد، مسیرهای تنظیمات و لاگ فقط با همین
          توکن پاسخ می‌دهند. توکن فقط روی همین مرورگر ذخیره می‌شود و داخل گزارش پشتیبانی نوشته
          نمی‌شود.
        </p>
        <div className="flex gap-2">
          <Input
            dir="ltr"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="بدون توکن"
            className="text-left"
          />
          <Button
            variant="secondary"
            className="rounded-xl font-black shrink-0"
            onClick={() => {
              setPosAccessToken(token);
              toast.success(token.trim() ? "توکن ذخیره شد" : "توکن حذف شد");
              localLog("info", "token", token.trim() ? "توکن دسترسی به‌روزرسانی شد" : "توکن حذف شد");
              audits("token:change", { detail: token.trim() ? "توکن تغییر کرد" : "توکن حذف شد" });
            }}
          >
            ذخیره توکن
          </Button>
        </div>
      </div>

      {/* گزارش پشتیبانی */}
      <div className="glass rounded-2xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-black text-bronze-light">گزارش خطا برای پشتیبانی</p>
          <div className="flex gap-2">
            <Button className="rounded-xl font-black h-9" onClick={downloadReport}>
              <Download className="w-4 h-4 ml-2" /> دانلود گزارش
            </Button>
            <Button variant="secondary" className="rounded-xl font-black h-9" onClick={() => void copyReport()}>
              <Copy className="w-4 h-4 ml-2" /> کپی گزارش
            </Button>
            <Button
              variant="secondary"
              className="rounded-xl font-black h-9"
              onClick={downloadPingsCsv}
            >
              <Download className="w-4 h-4 ml-2" /> CSV تلاش‌های اتصال
            </Button>
          </div>
        </div>
        <p className="text-xs text-bronze-light/60">
          شامل آخرین {pings.length} تلاش ping/handshake، رویدادهای سرویس پل، تنظیمات دستگاه و
          مشخصات کیوسک (ویندوز، پردازنده، رزولوشن ۱۰۸۰×۱۹۲۰ و لمسی). رمز دستگاه و توکن داخل گزارش
          نوشته نمی‌شود.
        </p>
        <div className="rounded-xl bg-black/25 p-3 space-y-1 text-xs font-mono max-h-40 overflow-y-auto">
          {pings.length === 0 ? (
            <p className="text-bronze-light/40">هنوز تلاشی ثبت نشده است.</p>
          ) : (
            [...pings].reverse().map((p, i) => (
              <p key={`${p.at}-${i}`} className={p.ok ? "text-emerald-300/80" : "text-rose-300"}>
                <span className="text-bronze-light/40">
                  {new Date(p.at).toLocaleTimeString("fa-IR")}
                </span>{" "}
                {p.ok ? "OK" : "FAIL"}{" "}
                <span dir="ltr" className="text-primary/80">
                  {p.code ?? "-"}
                </span>{" "}
                <span dir="ltr">{p.target}</span>{" "}
                {p.latencyMs != null && `${p.latencyMs}ms`} — {p.message}
              </p>
            ))
          )}
        </div>
      </div>

      {/* سوابق دسترسی */}
      <div className="glass rounded-2xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-black text-bronze-light flex items-center gap-2">
            <FileClock className="w-5 h-5 text-primary" /> سوابق دسترسی و رویدادها
            <span className="text-xs font-medium text-bronze-light/45">
              ({audit.length} رکورد اخیر)
            </span>
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="rounded-xl font-black h-9" onClick={downloadAudit}>
              <Download className="w-4 h-4 ml-2" /> خروجی CSV
            </Button>
            <Button
              variant="secondary"
              className="rounded-xl h-9"
              onClick={() => {
                clearAuditLog();
                setAudit([]);
                toast.success("سوابق پاک شد");
              }}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <Input
          value={auditFilter}
          onChange={(e) => setAuditFilter(e.target.value)}
          placeholder="فیلتر بر اساس رویداد، کاربر یا کد خطا…"
          className="h-10"
        />

        <div className="max-h-64 overflow-y-auto rounded-xl bg-black/25">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-black/60 text-bronze-light/60">
              <tr>
                <th className="text-right font-bold p-2">زمان</th>
                <th className="text-right font-bold p-2">رویداد</th>
                <th className="text-right font-bold p-2">کاربر</th>
                <th className="text-right font-bold p-2">کد</th>
                <th className="text-right font-bold p-2">توضیح</th>
              </tr>
            </thead>
            <tbody>
              {filteredAudit.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-3 text-bronze-light/40">
                    سابقه‌ای مطابق فیلتر پیدا نشد.
                  </td>
                </tr>
              ) : (
                filteredAudit.map((e) => (
                  <tr key={e.id} className="border-t border-white/5 align-top">
                    <td className="p-2 text-bronze-light/50 whitespace-nowrap">{e.atFa}</td>
                    <td className="p-2 text-bronze-light/85 font-bold">{auditLabel(e.kind)}</td>
                    <td className="p-2 text-bronze-light/60" dir="ltr">
                      {e.user}
                    </td>
                    <td
                      className={`p-2 font-mono ${
                        e.code && e.code !== "OK" ? "text-rose-300" : "text-emerald-300/80"
                      }`}
                      dir="ltr"
                    >
                      {e.code ?? "—"}
                    </td>
                    <td className="p-2 text-bronze-light/60">{e.detail ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-bronze-light/45 leading-6">
          سوابق فقط روی همین کیوسک نگهداری می‌شود (حداکثر ۲۰۰ رکورد) و به انتهای گزارش پشتیبانی هم
          پیوست می‌شود. رمز دستگاه و توکن دسترسی هرگز در سوابق نوشته نمی‌شوند.
        </p>
      </div>

      {/* لاگ زنده */}
      <div className="glass rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="font-black text-bronze-light">
            لاگ زندهٔ اتصال
            <span className="text-xs font-medium text-bronze-light/45">
              {transport === "sse"
                ? " — استریم لحظه‌ای"
                : transport === "polling"
                  ? " — به‌روزرسانی هر ۲ ثانیه"
                  : ""}
            </span>
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="rounded-xl h-9" onClick={() => void copyLogs()}>
              <Copy className="w-4 h-4" />
            </Button>
            <Button variant="secondary" className="rounded-xl h-9" onClick={() => void clearLogs()}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div
          ref={logBox}
          className="h-56 overflow-y-auto rounded-xl bg-black/30 p-3 space-y-1 text-xs font-mono"
        >
          {logs.length === 0 ? (
            <p className="text-bronze-light/40">هنوز رویدادی ثبت نشده است.</p>
          ) : (
            logs.map((l) => (
              <p
                key={l.id}
                className={
                  l.level === "error"
                    ? "text-rose-300"
                    : l.level === "warn"
                      ? "text-amber-300"
                      : "text-bronze-light/75"
                }
              >
                <span className="text-bronze-light/40">{l.time}</span> [{l.event}] {l.message}
              </p>
            ))
          )}
        </div>
      </div>

      <PosTransactionsCard />

      <CashierPinCard />

      <PosProtocolCard />

      <AgentCard />

      <PrinterCard />

      <div className="glass rounded-2xl p-6 text-sm leading-7 text-bronze-light/75 space-y-2">
        <p className="font-black text-bronze-light">راهنمای سریع</p>
        <p>
          سرویس ویندوزی «pos-bridge» را روی همین کیوسک اجرا کنید؛ فقط روی
          <span dir="ltr"> 127.0.0.1:9099 </span>گوش می‌دهد و درخواست پرداخت را روی شبکه به کارت‌خوان
          می‌فرستد.
        </p>
        <p>
چون کابل شبکه به پورت LAN دستگاه وصل است، رابط «کابل شبکه» را انتخاب و «جست‌وجوی
          خودکار در شبکه» را بزنید؛ سیستم با تطبیق سریال {DEVICE_PROFILE.serialNumber} خودِ کارت‌خوان
          موزه را پیدا می‌کند. اگر کابل را جدا کردید، رابط «وای‌فای» را انتخاب کنید تا آدرس{" "}
          {DEFAULT_WIFI_IP} برگردد. IP دستگاه را می‌توانید از منوی «اطلاعات سیستم» روی خود کارت‌خوان
          هم بخوانید. کیوسک و کارت‌خوان باید روی یک شبکه
          باشند.
        </p>
      </div>
    </div>
  );
}

/** تنظیمات سرویس PosAgent (پرداخت از طریق سرویس ویندوزی Agent) */
function AgentCard() {
  const [backend, setBackend] = useState<PayBackend>(() => getPayBackend());
  const [httpUrl, setHttpUrl] = useState(() => getAgentHttpUrl());
  const [wsUrl, setWsUrl] = useState(() => getAgentWsUrl());
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<{ ok: boolean; message: string } | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    const res = await agentHealth();
    setChecking(false);
    setHealth(res);
    if (!res.ok && getPayBackend() === "agent") {
      toast.warning("سرویس پرداخت در دسترس نیست — مطمئن شوید PosAgent اجراست (net start PosAgentService)");
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const pick = (b: PayBackend) => {
    setBackend(b);
    setPayBackend(b);
    toast.success(b === "agent" ? "پرداخت از طریق PosAgent انجام می‌شود" : "پرداخت از طریق pos-bridge انجام می‌شود");
  };

  const saveUrls = () => {
    setAgentHttpUrl(httpUrl);
    setAgentWsUrl(wsUrl);
    toast.success("آدرس‌های PosAgent ذخیره شد");
    void check();
  };

  return (
    <div className="glass rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-black text-bronze-light flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" />
          روش پرداخت کارت‌خوان
        </p>
        <div className="flex items-center gap-2">
          {health && backend === "agent" && (
            <span
              className={`text-xs font-bold px-3 py-1 rounded-full border ${
                health.ok
                  ? "border-emerald-400/40 text-emerald-300"
                  : "border-rose-400/40 text-rose-300"
              }`}
            >
              {health.ok ? "فعال" : "خارج از دسترس"}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => void check()} disabled={checking}>
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="mr-2">بررسی دوباره</span>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {(
          [
            { key: "bridge" as const, title: "پل pos-bridge (پیشنهادی)", sub: "پروتکل PC-POS مستقیم با دستگاه — پورت 9099، با دفتر تراکنش و بازیابی" },
            { key: "agent" as const, title: "PosAgent", sub: "سرویس ویندوزی Agent — HTTP 18765 / WebSocket 18766" },
          ]
        ).map((o) => (
          <button
            key={o.key}
            onClick={() => pick(o.key)}
            className={`touch-btn text-right p-4 rounded-xl border-2 transition ${
              backend === o.key
                ? "glass-bronze border-primary"
                : "glass border-white/10 hover:border-primary/40"
            }`}
          >
            <p className="font-black text-bronze-light">{o.title}</p>
            <p className="text-xs text-bronze-light/60 mt-1" dir="rtl">{o.sub}</p>
          </button>
        ))}
      </div>

      {backend === "agent" && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm text-bronze-light/70">
              <span>آدرس HTTP سرویس Agent</span>
              <Input
                value={httpUrl}
                onChange={(e) => setHttpUrl(e.target.value)}
                dir="ltr"
                className="bg-black/30 border-primary/20 rounded-xl h-11 text-left"
              />
            </label>
            <label className="space-y-1 text-sm text-bronze-light/70">
              <span>آدرس WebSocket نتیجهٔ لحظه‌ای</span>
              <Input
                value={wsUrl}
                onChange={(e) => setWsUrl(e.target.value)}
                dir="ltr"
                className="bg-black/30 border-primary/20 rounded-xl h-11 text-left"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={saveUrls}>ذخیرهٔ آدرس‌ها</Button>
            {health && !health.ok && (
              <p className="text-xs text-rose-300/90">
                Agent اجرا نیست؛ روی ویندوز کیوسک دستور «net start PosAgentService» را اجرا کنید.
              </p>
            )}
          </div>
        </>
      )}

      <p className="text-xs text-bronze-light/50 leading-6">
        در حالت PosAgent مرورگر فقط با سرویس Agent روی همین رایانه صحبت می‌کند و نتیجهٔ پرداخت
        (شمارهٔ پیگیری و کارت ماسک‌شده) به‌صورت لحظه‌ای از WebSocket دریافت می‌شود.
      </p>
    </div>
  );
}

/** تنظیمات پرینتر حرارتی ۸۰ میلی‌متری و تست چاپ */
function PrinterCard() {
  const [printers, setPrinters] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await posPrinters();
    setLoading(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setPrinters(res.printers);
    setSelected(res.selected || res.defaultPrinter || "");
    setEnabled(res.printEnabled !== false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    const res = await posSavePrinter(selected, enabled);
    setBusy(false);
    if (res.ok) toast.success(res.message);
    else toast.error(res.message);
  };

  const testPrint = async () => {
    setBusy(true);
    const res = await posPrintTicket(
      buildTicketPayload({
        invoiceNumber: "TEST-PRINT",
        totalToman: 0,
        paymentMethod: "card",
        items: [{ name: "تست چاپ بلیط", quantity: 1, totalToman: 0 }],
      }),
    );
    setBusy(false);
    if (res.ok) toast.success(`${res.message}${res.printer ? ` — ${res.printer}` : ""}`);
    else toast.error(res.message);
  };

  return (
    <div className="glass rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-black text-bronze-light flex items-center gap-2">
          <Printer className="w-5 h-5 text-primary" />
          پرینتر حرارتی بلیط (۸۰ میلی‌متری)
        </p>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="mr-2">بازخوانی فهرست</span>
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm text-bronze-light/70">
          <span>پرینتر انتخاب‌شده</span>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full h-11 rounded-xl bg-black/30 border border-primary/20 px-3 text-bronze-light"
          >
            <option value="">پرینتر پیش‌فرض ویندوز</option>
            {printers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-3 text-sm text-bronze-light/70 md:mt-6">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-5 h-5 accent-[#cd7f32]"
          />
          چاپ خودکار بلیط پس از پرداخت موفق
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => void save()} disabled={busy}>
          ذخیرهٔ تنظیمات چاپ
        </Button>
        <Button variant="outline" onClick={() => void testPrint()} disabled={busy}>
          <Printer className="w-4 h-4" />
          <span className="mr-2">چاپ آزمایشی</span>
        </Button>
      </div>

      <p className="text-xs text-bronze-light/50 leading-6">
        پرینتر باید در ویندوز نصب و به‌عنوان پرینتر معمولی (درایور ۸۰ میلی‌متری) شناخته شده باشد.
        سرویس pos-bridge بلیط را با فونت فارسی و کد QR ورود چاپ می‌کند.
      </p>
    </div>
  );
}
