/**
 * نشانگر زندهٔ وضعیت کارت‌خوان: متصل / در حال اتصال / قطع.
 * روی صفحهٔ پرداخت و پنل مدیریت استفاده می‌شود و خودش هر چند ثانیه
 * یک ping سبک می‌زند (و هنگام بازگشت به صفحه فوراً وضعیت را تازه می‌کند).
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Wifi, WifiOff } from "lucide-react";
import { getDeviceIp, getDevicePort, loadConnectionState, posPing } from "@/lib/pos";

export type PosLiveState = "connected" | "connecting" | "disconnected";

export function usePosLiveStatus(intervalMs = 20_000) {
  const [state, setState] = useState<PosLiveState>(() =>
    loadConnectionState().status === "connected" ? "connected" : "disconnected",
  );
  const [latencyMs, setLatencyMs] = useState<number | undefined>(
    () => loadConnectionState().lastLatencyMs,
  );
  const [message, setMessage] = useState<string>("");

  const check = useCallback(async () => {
    setState("connecting");
    const p = await posPing({ ip: getDeviceIp(), port: getDevicePort() }, 4000);
    setState(p.ok ? "connected" : "disconnected");
    setLatencyMs(p.latencyMs);
    setMessage(p.message);
  }, []);

  useEffect(() => {
    void check();
    const id = window.setInterval(() => void check(), intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [check, intervalMs]);

  return { state, latencyMs, message, refresh: check };
}

export const POS_LIVE_LABEL: Record<PosLiveState, string> = {
  connected: "کارت‌خوان متصل",
  connecting: "در حال اتصال…",
  disconnected: "کارت‌خوان قطع",
};

export function PosLiveBadge({
  state,
  latencyMs,
  className = "",
}: {
  state: PosLiveState;
  latencyMs?: number;
  className?: string;
}) {
  const tone =
    state === "connected"
      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
      : state === "connecting"
        ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
        : "border-rose-400/40 bg-rose-400/10 text-rose-300";

  return (
    <span
      className={`inline-flex items-center gap-2 px-3 h-9 rounded-full border font-black text-sm ${tone} ${className}`}
      aria-live="polite"
    >
      {state === "connecting" ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : state === "connected" ? (
        <Wifi className="w-4 h-4" />
      ) : (
        <WifiOff className="w-4 h-4" />
      )}
      {POS_LIVE_LABEL[state]}
      {state === "connected" && latencyMs != null && (
        <span dir="ltr" className="text-xs opacity-70">
          {latencyMs}ms
        </span>
      )}
    </span>
  );
}

/** نسخهٔ آمادهٔ استفاده که خودش وضعیت را زنده نگه می‌دارد */
export function PosLiveStatus({ className = "" }: { className?: string }) {
  const { state, latencyMs } = usePosLiveStatus();
  return <PosLiveBadge state={state} latencyMs={latencyMs} className={className} />;
}
