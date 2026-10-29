import { createContext, useContext } from "react";
import { supabase } from "@/integrations/supabase/client";

/** وضعیت دسترسی پنل مدیریت (از AdminLayout به صفحه‌های پنل می‌رسد) */
export type AdminAccess = {
  /** پنل بدون رمز است؛ هر بازدیدکننده‌ای دسترسی مدیر دارد */
  openMode: boolean;
  /** ایمیل کاربر واردشده (در حالت بدون رمز ممکن است خالی باشد) */
  email: string;
  /** وضعیت را دوباره از سرور می‌خواند (مثلاً بعد از گذاشتن رمز) */
  refresh: () => void;
};

export const AdminAccessContext = createContext<AdminAccess>({
  openMode: false,
  email: "",
  refresh: () => {},
});

export const useAdminAccess = () => useContext(AdminAccessContext);

/**
 * آیا پنل مدیریت هنوز بدون رمز است؟ اگر migration «admin_open_mode» هنوز روی دیتابیس اجرا نشده
 * باشد یا خطایی رخ دهد، false (یعنی ورود عادی با ایمیل و رمز).
 */
export async function fetchAdminOpenMode(): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_open_mode");
  if (error) return false;
  return data === true;
}

/**
 * برای پنل رمز می‌گذارد: با ایمیل و رمز وارد می‌شود (یا اگر حساب ندارد، حساب می‌سازد)، کاربر را
 * مدیر می‌کند و حالت بدون رمز را می‌بندد.
 */
export async function setAdminPassword(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; message: string; needsEmailConfirm?: boolean }> {
  let { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    const signIn = await supabase.auth.signInWithPassword({ email, password });
    if (!signIn.data.session) {
      const signUp = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + "/admin" },
      });
      if (signUp.error) {
        const exists = /registered|exists/i.test(signUp.error.message);
        return {
          ok: false,
          message: exists
            ? "این ایمیل از قبل حساب دارد؛ رمز درست همان حساب را وارد کنید."
            : "ساخت حساب ناموفق: " + signUp.error.message,
        };
      }
      if (!signUp.data.session) {
        return {
          ok: false,
          needsEmailConfirm: true,
          message:
            "ایمیل تأیید فرستاده شد. روی لینک داخل ایمیل بزنید و بعد همین فرم را با همان ایمیل و رمز دوباره بفرستید. (اگر این ایمیل از قبل حساب دارد، رمز درست همان حساب را وارد کنید.)",
        };
      }
    }
    sessionData = (await supabase.auth.getSession()).data;
    if (!sessionData.session) return { ok: false, message: "ورود ناموفق بود؛ دوباره تلاش کنید." };
  }
  const { error } = await supabase.rpc("claim_admin_and_close_open_mode");
  if (error) return { ok: false, message: "گذاشتن رمز ناموفق: " + error.message };
  return { ok: true };
}
