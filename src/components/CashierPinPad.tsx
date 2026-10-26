/**
 * صفحه‌کلید لمسی رمز متصدی برای تأیید پرداخت نقدی در کیوسک.
 * رمز فقط در حافظهٔ همین کامپوننت است و پس از هر تلاش پاک می‌شود.
 */

import { useCallback, useEffect, useState } from "react";
import { Banknote, Delete, Loader2, Lock } from "lucide-react";
import { formatToman } from "@/lib/money";

const MIN_DIGITS = 4;
const MAX_DIGITS = 8;

export function CashierPinPad({
  amountToman,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  amountToman: number;
  busy: boolean;
  error: string;
  onSubmit: (pin: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState("");

  const press = useCallback(
    (d: string) => setPin((p) => (busy || p.length >= MAX_DIGITS ? p : p + d)),
    [busy],
  );
  const back = useCallback(() => setPin((p) => p.slice(0, -1)), []);

  const submit = useCallback(async () => {
    if (busy || pin.length < MIN_DIGITS) return;
    const value = pin;
    setPin("");
    await onSubmit(value);
  }, [busy, pin, onSubmit]);

  // برای متصدی‌ای که صفحه‌کلید فیزیکی دارد
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") back();
      else if (e.key === "Enter") void submit();
      else if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, back, submit, onCancel]);

  const keyClass =
    "touch-btn h-16 rounded-2xl glass border border-primary/25 text-2xl font-black text-bronze-light active:scale-95 transition disabled:opacity-40";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="رمز متصدی"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm px-6"
    >
      <div className="glass-bronze w-full max-w-sm rounded-3xl p-6 space-y-5 text-center animate-scale-in">
        <div className="space-y-2">
          <Banknote className="w-10 h-10 mx-auto text-primary" />
          <h2 className="text-2xl font-black text-bronze-gradient">پرداخت نقدی</h2>
          <p className="text-bronze-light/80 font-medium">
            مبلغ <span className="font-black text-white">{formatToman(amountToman)}</span> را به
            متصدی بپردازید.
          </p>
          <p className="text-bronze-light/60 text-sm flex items-center justify-center gap-1">
            <Lock className="w-4 h-4" />
            متصدی پس از دریافت وجه، رمز خود را وارد کند
          </p>
        </div>

        <div className="flex justify-center gap-3 h-6" dir="ltr" aria-live="polite">
          {Array.from({ length: Math.max(MIN_DIGITS, pin.length) }).map((_, i) => (
            <span
              key={i}
              className={`w-4 h-4 rounded-full border-2 border-primary/60 ${i < pin.length ? "bg-primary" : ""}`}
            />
          ))}
        </div>

        <p className="min-h-6 text-sm font-bold text-rose-300" role="alert">
          {error}
        </p>

        <div className="grid grid-cols-3 gap-3" dir="ltr">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} className={keyClass} onClick={() => press(d)} disabled={busy}>
              {d}
            </button>
          ))}
          <button
            className={keyClass}
            onClick={() => setPin("")}
            disabled={busy}
            aria-label="پاک کردن"
          >
            C
          </button>
          <button className={keyClass} onClick={() => press("0")} disabled={busy}>
            0
          </button>
          <button className={keyClass} onClick={back} disabled={busy} aria-label="حذف رقم آخر">
            <Delete className="w-6 h-6 mx-auto" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="touch-btn h-14 rounded-2xl font-black glass border border-white/15 text-bronze-light disabled:opacity-40"
          >
            انصراف
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || pin.length < MIN_DIGITS}
            className="touch-btn h-14 rounded-2xl font-black text-primary-foreground disabled:opacity-40 inline-flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)" }}
          >
            {busy && <Loader2 className="w-5 h-5 animate-spin" />}
            تأیید
          </button>
        </div>
      </div>
    </div>
  );
}
