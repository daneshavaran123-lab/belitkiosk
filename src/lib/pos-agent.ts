/**
 * ارتباط با «PosAgent» — سرویس ویندوزی که روی همان رایانهٔ کیوسک اجرا می‌شود
 * و ارتباط با دستگاه کارت‌خوان را بر عهده دارد (طبق راهنمای یکپارچه‌سازی کلاینت).
 *
 *   HTTP      http://127.0.0.1:18765   →  /health , /payment , /status/{id} , /cancel/{id}
 *   WebSocket ws://127.0.0.1:18766      →  دریافت نتیجهٔ لحظه‌ای پرداخت
 *
 * همهٔ پاسخ‌های HTTP به شکل APIResult<T> با TotalRes / Data / Message است.
 * مبلغ باید به ریال و به‌صورت عدد صحیح ارسال شود.
 */

import { posLog, posLogError, type PosResult } from "./pos";

/* ------------------------------------------------------------------ */
/*  قراردادها (مطابق سند PosAgent)                                       */
/* ------------------------------------------------------------------ */

export interface ApiResult<T> {
  TotalRes: boolean;
  Data: T | null;
  Message: string;
}

export interface StartPaymentRequest {
  TransactionId: string;
  Amount: number;
  Description?: string;
  TimeoutSeconds?: number;
  MerchantData?: string;
}

export interface StartPaymentResponse {
  TransactionId: string;
  Status: string;
}

export type AgentPaymentStatus =
  "WaitingForCard" | "Processing" | "Success" | "Failed" | "Cancelled" | "Timeout" | "Error";

export interface AgentPaymentResult {
  TransactionId: string;
  Success: boolean;
  Status: AgentPaymentStatus;
  Amount: number;
  Rrn?: string;
  TraceNumber?: string;
  CardNumberMasked?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
  CompletedAt: string;
}

/* ------------------------------------------------------------------ */
/*  تنظیمات (ذخیره در localStorage)                                     */
/* ------------------------------------------------------------------ */

const LS_HTTP = "pos.agent.httpUrl";
const LS_WS = "pos.agent.wsUrl";
const LS_BACKEND = "pos.payBackend";

export const DEFAULT_AGENT_HTTP = "http://127.0.0.1:18765";
export const DEFAULT_AGENT_WS = "ws://127.0.0.1:18766";
export const DEFAULT_AGENT_TIMEOUT_SECONDS = 120;

export type PayBackend = "agent" | "bridge";

function readLs(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key)?.trim() || fallback;
}

export function getAgentHttpUrl(): string {
  return readLs(LS_HTTP, DEFAULT_AGENT_HTTP).replace(/\/$/, "");
}

export function setAgentHttpUrl(url: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_HTTP, url.trim().replace(/\/$/, ""));
}

export function getAgentWsUrl(): string {
  return readLs(LS_WS, DEFAULT_AGENT_WS).replace(/\/$/, "");
}

export function setAgentWsUrl(url: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_WS, url.trim().replace(/\/$/, ""));
}

/**
 * روش پرداخت کارت‌خوان: پل pos-bridge (پیش‌فرض؛ پروتکل PC-POS مستقیم با دستگاه) یا سرویس PosAgent.
 * انتخابی که قبلاً در پنل ذخیره شده باشد حفظ می‌شود.
 */
export function getPayBackend(): PayBackend {
  return readLs(LS_BACKEND, "bridge") === "agent" ? "agent" : "bridge";
}

export function setPayBackend(backend: PayBackend) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_BACKEND, backend);
}

/* ------------------------------------------------------------------ */
/*  ابزارهای پایه                                                        */
/* ------------------------------------------------------------------ */

async function agentFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${getAgentHttpUrl()}${path}`, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** بررسی فعال بودن سرویس PosAgent */
export async function agentHealth(timeoutMs = 4000): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await agentFetch("/health", { method: "GET" }, timeoutMs);
    if (!res.ok) return { ok: false, message: `پاسخ نامعتبر از سرویس پرداخت (${res.status})` };
    posLog("agent:health", "ok");
    return { ok: true, message: "سرویس پرداخت (PosAgent) فعال است" };
  } catch {
    return {
      ok: false,
      message: "سرویس پرداخت در دسترس نیست — PosAgent روی این رایانه اجرا نیست",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  نگاشت نتیجهٔ Agent به خروجی استاندارد برنامه                         */
/* ------------------------------------------------------------------ */

export function mapAgentResult(r: AgentPaymentResult): PosResult {
  if (r.Success || r.Status === "Success") {
    return {
      success: true,
      final: true,
      transactionId: r.TransactionId,
      responseCode: "00",
      message: "تراکنش موفق",
      refNumber: r.Rrn ?? "",
      maskedPan: r.CardNumberMasked ?? "",
    };
  }
  const message =
    r.Status === "Timeout"
      ? "زمان انتظار برای کشیدن کارت به پایان رسید"
      : r.Status === "Cancelled"
        ? "عملیات پرداخت لغو شد"
        : r.ErrorMessage || "تراکنش ناموفق بود";
  return {
    success: false,
    final: true,
    transactionId: r.TransactionId,
    responseCode: r.ErrorCode ?? "",
    message,
    refNumber: r.Rrn ?? "",
    maskedPan: r.CardNumberMasked ?? "",
  };
}

/** برچسب فارسی وضعیت‌های زندهٔ تراکنش برای نمایش روی صفحه */
export function agentStatusLabel(status: AgentPaymentStatus): string {
  switch (status) {
    case "WaitingForCard":
      return "در انتظار کشیدن کارت...";
    case "Processing":
      return "در حال پردازش تراکنش...";
    case "Success":
      return "تراکنش موفق";
    case "Timeout":
      return "زمان انتظار به پایان رسید";
    case "Cancelled":
      return "تراکنش لغو شد";
    case "Failed":
    case "Error":
      return "تراکنش ناموفق";
    default:
      return "";
  }
}

/* ------------------------------------------------------------------ */
/*  جریان پرداخت                                                         */
/* ------------------------------------------------------------------ */

/** لغو تراکنش جاری از طریق Agent */
export async function agentCancel(transactionId: string): Promise<void> {
  try {
    posLog("agent:cancel", transactionId);
    await agentFetch(`/cancel/${encodeURIComponent(transactionId)}`, { method: "POST" }, 5000);
  } catch (e) {
    posLogError("agent:cancel-failed", (e as Error).message);
  }
}

/** گوش‌دادن به نتیجهٔ لحظه‌ای از WebSocket + پشتیبانِ polling روی /status */
/** بعد از لغو، حداکثر این مدت منتظر تأیید لغو (یا پرداخت هم‌زمان) از Agent می‌مانیم */
const CANCEL_GRACE_MS = 20_000;

function waitForResult(
  transactionId: string,
  overallTimeoutMs: number,
  onStatus?: (status: AgentPaymentStatus) => void,
  signal?: AbortSignal,
): Promise<AgentPaymentResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws: WebSocket | null = null;

    const finish = (r: AgentPaymentResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poller);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      resolve(r);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poller);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      reject(new Error(message));
    };

    let timer = setTimeout(() => fail("پاسخی از سرویس پرداخت دریافت نشد"), overallTimeoutMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => fail("لغو ثبت شد ولی سرویس پرداخت نتیجه را تأیید نکرد"),
        CANCEL_GRACE_MS,
      );
    });

    const handleResult = (r: AgentPaymentResult) => {
      if (r.TransactionId !== transactionId) return;
      if (r.Status === "WaitingForCard" || r.Status === "Processing") {
        onStatus?.(r.Status);
        return;
      }
      finish(r);
    };

    // WebSocket — مسیر اصلی دریافت نتیجه
    try {
      ws = new WebSocket(getAgentWsUrl());
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as AgentPaymentResult;
          if (data && typeof data.TransactionId === "string") handleResult(data);
        } catch {
          /* پیام نامعتبر نادیده گرفته می‌شود */
        }
      };
      ws.onerror = () => posLogError("agent:ws-error", transactionId);
    } catch (e) {
      posLogError("agent:ws-open-failed", (e as Error).message);
    }

    // Polling پشتیبان هر ۵ ثانیه
    const poller = setInterval(async () => {
      try {
        const res = await agentFetch(
          `/status/${encodeURIComponent(transactionId)}`,
          { method: "GET" },
          4000,
        );
        if (!res.ok) return;
        const body = (await res.json()) as ApiResult<AgentPaymentResult>;
        if (body.TotalRes && body.Data) handleResult(body.Data);
      } catch {
        /* تلاش بعدی */
      }
    }, 5000);
  });
}

/**
 * پرداخت کامل از طریق PosAgent:
 * ۱) شروع تراکنش با POST /payment  ۲) انتظار برای نتیجه روی WebSocket
 * در صورت abort شدن سیگنال، لغو تراکنش هم به Agent ارسال می‌شود.
 */
export async function agentPay(
  params: { amountToman: number; description?: string; timeoutSeconds?: number },
  opts: { signal?: AbortSignal; onStatus?: (status: AgentPaymentStatus) => void } = {},
): Promise<PosResult> {
  const timeoutSeconds = params.timeoutSeconds ?? DEFAULT_AGENT_TIMEOUT_SECONDS;
  const transactionId = crypto.randomUUID();
  posLog("agent:pay-start", { transactionId, amountToman: params.amountToman });

  let cancelledByUser = false;
  const onAbort = () => {
    cancelledByUser = true;
    void agentCancel(transactionId);
  };
  opts.signal?.addEventListener("abort", onAbort);

  try {
    const body: StartPaymentRequest = {
      TransactionId: transactionId,
      Amount: Math.round(params.amountToman * 10),
      Description: params.description ?? "خرید بلیط موزه",
      TimeoutSeconds: timeoutSeconds,
    };

    let startRes: Response;
    try {
      startRes = await agentFetch(
        "/payment",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        8000,
      );
    } catch {
      return {
        success: false,
        message: "سرویس پرداخت در دسترس نیست — PosAgent روی این رایانه اجرا نیست",
      };
    }

    const startBody = (await startRes
      .json()
      .catch(() => null)) as ApiResult<StartPaymentResponse> | null;
    if (!startRes.ok || !startBody || !startBody.TotalRes) {
      const msg = startBody?.Message || `خطا در شروع پرداخت (${startRes.status})`;
      posLogError("agent:pay-start-rejected", { transactionId, msg });
      return { success: false, message: msg };
    }

    opts.onStatus?.("WaitingForCard");
    const result = await waitForResult(
      transactionId,
      (timeoutSeconds + 10) * 1000,
      opts.onStatus,
      opts.signal,
    );

    // حتی اگر مشتری لغو زده باشد، نتیجهٔ واقعی دستگاه ملاک است: اگر همان لحظه کارت کشیده
    // و پرداخت تأیید شده، فروش باید ثبت شود نه اینکه پولش گم شود
    const mapped = mapAgentResult(result);
    if (cancelledByUser && mapped.success) posLog("agent:approved-after-cancel", { transactionId });
    if (mapped.success) posLog("agent:pay-approved", { transactionId, rrn: mapped.refNumber });
    else posLogError("agent:pay-declined", { transactionId, status: result.Status });
    return mapped;
  } catch (e) {
    const msg = (e as Error).message || "خطای غیرمنتظره در پرداخت";
    posLogError("agent:pay-failed", { transactionId, msg, cancelledByUser });
    // نتیجه‌ای از Agent نرسید؛ ممکن است وجه کسر شده باشد
    return { success: false, final: true, uncertain: true, transactionId, message: msg };
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
