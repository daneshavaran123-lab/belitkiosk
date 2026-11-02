/**
 * کارت «اتصال این کیوسک به گزارش روزانه» در صفحهٔ تنظیمات کارت‌خوان.
 *
 * سرویس کارت‌خوان همین کامپیوتر تراکنش‌های «نیازمند بررسی» را بدون شمارهٔ کارت به سرور می‌فرستد تا
 * گزارش روزانه از هر جا کامل باشد و مدیر از راه دور هم بتواند «بررسی شد» بزند. این کارت فقط روی خود
 * کیوسک کار می‌کند، چون با سرویس محلی (127.0.0.1) صحبت می‌کند.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CloudUpload, Loader2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_KIOSK_NAME,
  MAX_KIOSK_NAME,
  defaultPairDeps,
  formatTehranDateTime,
  pairKiosk,
} from "@/lib/daily-report";
import { formatNumber } from "@/lib/money";
import { posSyncDisable, posSyncStatus, type PosSyncStatus } from "@/lib/pos";

/** اختلاف ساعت بیش از این (ثانیه) یعنی ساعت ویندوز کیوسک تنظیم نیست */
const CLOCK_WARN_SECONDS = 120;

interface Props {
  /** ثبت در دفتر رویدادهای صفحهٔ کارت‌خوان */
  onAudit?: (kind: "sync:pair" | "sync:disable", detail: string) => void;
}

export function KioskSyncCard({ onAudit }: Props) {
  const [status, setStatus] = useState<PosSyncStatus | null>(null);
  const [unreachable, setUnreachable] = useState("");
  const [name, setName] = useState(DEFAULT_KIOSK_NAME);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await posSyncStatus();
    if (r.ok) {
      setStatus(r.data);
      setUnreachable("");
    } else {
      setStatus(null);
      setUnreachable(r.message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const connect = async () => {
    setBusy(true);
    const result = await pairKiosk(name, await defaultPairDeps());
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      onAudit?.("sync:pair", `ناموفق در مرحلهٔ ${result.step}`);
    } else if (result.synced) {
      toast.success("کیوسک به گزارش روزانه وصل شد");
      onAudit?.("sync:pair", "موفق");
    } else {
      toast.warning(
        `کیوسک وصل شد ولی اولین ارسال ناموفق بود: ${result.status.lastError || "نامشخص"}`,
      );
      onAudit?.("sync:pair", "وصل شد؛ اولین ارسال ناموفق");
    }
    void refresh();
  };

  const disconnect = async () => {
    if (
      !window.confirm(
        "با قطع اتصال، تراکنش‌های نیازمند بررسی دیگر به سرور نمی‌روند و گزارش روزانه از این کیوسک عقب می‌ماند. ادامه می‌دهید؟",
      )
    )
      return;
    setBusy(true);
    const r = await posSyncDisable();
    setBusy(false);
    if (r.ok) {
      toast.success("اتصال قطع شد");
      onAudit?.("sync:disable", "قطع اتصال");
    } else toast.error(r.message);
    void refresh();
  };

  const clockOff = status !== null && Math.abs(status.clockOffsetSeconds) > CLOCK_WARN_SECONDS;
  const badge = unreachable
    ? { text: "سرویس در دسترس نیست", tone: "border-white/20 text-bronze-light/60" }
    : status?.enabled
      ? { text: "فعال", tone: "border-emerald-400/40 text-emerald-300" }
      : { text: "وصل نیست", tone: "border-amber-400/50 text-amber-200" };

  return (
    <div className="glass rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-black text-bronze-light flex items-center gap-2">
          <CloudUpload className="w-5 h-5 text-primary" />
          اتصال این کیوسک به گزارش روزانه
        </p>
        <span className={`text-xs font-bold px-3 py-1 rounded-full border ${badge.tone}`}>
          {badge.text}
        </span>
      </div>

      <p className="text-xs text-bronze-light/60 leading-6">
        تراکنش‌های کارتی «نیازمند بررسی» (پاسخ نامطمئن، تأیید دیرهنگام، قطع ارتباط) هر دقیقه به سرور
        فرستاده می‌شوند تا در «گزارش روزانه» از هر جا دیده شوند و مدیر از راه دور «بررسی شد» بزند.
        شمارهٔ کارت (حتی ماسک‌شده) هرگز فرستاده نمی‌شود و کلید این کیوسک از همین رایانه بیرون
        نمی‌رود. اتصال را روی خود کیوسک انجام دهید.
      </p>

      {unreachable && (
        <p className="text-sm text-bronze-light/70 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
          {unreachable}
        </p>
      )}

      {status?.enabled && (
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-bronze-light/50 text-xs">آخرین ارسال موفق</dt>
            <dd className="font-bold text-bronze-light">
              {status.lastSyncedAt ? formatTehranDateTime(status.lastSyncedAt) : "هنوز ارسال نشده"}
            </dd>
          </div>
          <div>
            <dt className="text-bronze-light/50 text-xs">در صف ارسال</dt>
            <dd className="font-bold text-bronze-light">{formatNumber(status.pendingCount)}</dd>
          </div>
          <div>
            <dt className="text-bronze-light/50 text-xs">شناسهٔ کیوسک</dt>
            <dd className="font-mono text-xs text-bronze-light/80" dir="ltr">
              {status.kioskId.slice(0, 8)}…
            </dd>
          </div>
        </dl>
      )}

      {status?.lastError && (
        <p role="alert" className="text-sm text-rose-300 leading-6">
          آخرین خطا: {status.lastError} (سرویس دوباره تلاش می‌کند)
        </p>
      )}

      {clockOff && (
        <p
          role="alert"
          className="text-sm text-amber-200 leading-6 flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-1" />
          ساعت کیوسک تنظیم نیست (حدود{" "}
          {formatNumber(Math.round(Math.abs(status!.clockOffsetSeconds) / 60))} دقیقه اختلاف با
          سرور)؛ ساعت ویندوز را درست کنید. زمان تراکنش‌ها در سرور اصلاح می‌شود ولی بهتر است ساعت
          درست باشد.
        </p>
      )}

      {!status?.enabled && !unreachable && (
        <label className="space-y-1 text-sm text-bronze-light/70 block max-w-sm">
          <span>نام کیوسک (برای نمایش در گزارش)</span>
          <Input
            value={name}
            maxLength={MAX_KIOSK_NAME}
            onChange={(e) => setName(e.target.value)}
            className="bg-black/30 border-primary/20 rounded-xl h-11"
          />
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {status?.enabled ? (
          <Button variant="outline" onClick={() => void disconnect()} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
            <span className="mr-2">قطع اتصال</span>
          </Button>
        ) : (
          <Button onClick={() => void connect()} disabled={busy || !!unreachable}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            <span className="mr-2">
              {status?.paired ? "اتصال دوباره (کلید تازه)" : "اتصال این کیوسک"}
            </span>
          </Button>
        )}
      </div>
    </div>
  );
}
