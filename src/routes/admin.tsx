import {
  createFileRoute,
  Outlet,
  Link,
  useNavigate,
  useRouterState,
  redirect,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  LayoutDashboard,
  Ticket,
  Receipt,
  LogOut,
  Home,
  Package,
  MessageSquare,
  CreditCard,
  ShieldAlert,
  FileChartColumn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminAccessContext, fetchAdminOpenMode } from "@/lib/admin-access";
import { KioskBackdrop } from "@/components/KioskBackdrop";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "پنل مدیریت — موزه کشتی" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminLayout,
});

const NAV = [
  { to: "/admin", label: "داشبورد", icon: LayoutDashboard, exact: true },
  { to: "/admin/tickets", label: "مدیریت بلیط‌ها", icon: Ticket, exact: false },
  { to: "/admin/products", label: "مدیریت محصولات", icon: Package, exact: false },
  { to: "/admin/invoices", label: "فاکتورها", icon: Receipt, exact: false },
  { to: "/admin/reports", label: "گزارش روزانه", icon: FileChartColumn, exact: false },
  { to: "/admin/surveys", label: "نظرسنجی‌ها", icon: MessageSquare, exact: false },
  { to: "/admin/pos", label: "کارت‌خوان", icon: CreditCard, exact: false },
] as const;

function AdminLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [state, setState] = useState<"loading" | "ok" | "denied">("loading");
  const [email, setEmail] = useState<string>("");
  const [openMode, setOpenMode] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const open = await fetchAdminOpenMode();
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;
      setOpenMode(open);
      // پنل هنوز رمز ندارد: ورود بدون ایمیل و رمز
      if (open) {
        setEmail(userData.user?.email ?? "");
        setState("ok");
        return;
      }
      if (!userData.user) {
        if (!cancelled) navigate({ to: "/admin/login" });
        return;
      }
      const { data: roleData } = await supabase.rpc("has_role", {
        _user_id: userData.user.id,
        _role: "admin",
      });
      if (cancelled) return;
      if (!roleData) {
        setState("denied");
        return;
      }
      setEmail(userData.user.email ?? "");
      setState("ok");
    };
    check();
    const { data: sub } = supabase.auth.onAuthStateChange(() => check());
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [navigate, version]);

  if (pathname === "/admin/login")
    return (
      <div className="h-full overflow-y-auto">
        <Outlet />
      </div>
    );

  if (state === "loading") {
    return (
      <div className="h-full flex items-center justify-center relative">
        <KioskBackdrop dim="deep" />
        <div className="relative z-10 glass rounded-full p-5">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="h-full flex items-center justify-center relative px-6">
        <KioskBackdrop dim="deep" />
        <div className="relative z-10 glass-strong rounded-[2rem] p-10 flex flex-col items-center gap-4 text-center max-w-md">
          <h2 className="text-3xl font-black text-bronze-gradient">دسترسی مجاز نیست</h2>
          <p className="text-white/70">حساب شما نقش «admin» ندارد.</p>
          <div className="flex gap-3">
            <Button
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/admin/login" });
              }}
            >
              خروج
            </Button>
            <Link
              to="/"
              className="touch-btn glass-chip inline-flex items-center gap-2 h-11 px-5 rounded-full text-white font-bold"
            >
              <Home className="w-4 h-4" /> صفحه اصلی
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AdminAccessContext.Provider
      value={{ openMode, email, refresh: () => setVersion((v) => v + 1) }}
    >
      <div className="h-dvh max-h-dvh flex flex-col overflow-hidden text-foreground relative">
        <KioskBackdrop dim="deep" />
        <header className="relative z-10 shrink-0 px-4 pt-4">
          <div className="max-w-7xl mx-auto glass rounded-[1.75rem] px-5 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="btn-liquid w-11 h-11 rounded-2xl flex items-center justify-center">
                <LayoutDashboard className="w-5 h-5" />
              </div>
              <h1 className="text-lg font-black text-bronze-gradient">پنل مدیریت موزه</h1>
            </div>
            <div className="flex items-center gap-3">
              {email ? (
                <span className="hidden sm:block text-sm text-white/70" dir="ltr">
                  {email}
                </span>
              ) : (
                <span className="glass-chip rounded-full px-3 py-1 text-xs text-amber-200 font-bold">
                  بدون رمز
                </span>
              )}
              <Link
                to="/"
                className="touch-btn glass-chip h-10 px-4 rounded-full text-white flex items-center gap-1.5 text-sm font-bold"
              >
                <Home className="w-4 h-4" /> سایت
              </Link>
              {email && (
                <button
                  onClick={async () => {
                    await supabase.auth.signOut();
                    navigate({ to: "/admin/login" });
                  }}
                  className="touch-btn h-10 px-4 rounded-full bg-red-500/25 border border-red-300/40 text-red-100 backdrop-blur-md flex items-center gap-1.5 text-sm font-bold"
                >
                  <LogOut className="w-4 h-4" /> خروج
                </button>
              )}
            </div>
          </div>
          {openMode && (
            <div className="max-w-7xl mx-auto mt-3 glass-amber rounded-2xl text-amber-50 text-sm">
              <div className="px-5 py-2.5 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>
                  پنل مدیریت بدون رمز است و هر کسی آدرس آن را بداند وارد می‌شود. از داشبورد ←
                  «گذاشتن رمز برای پنل» رمز بگذارید.
                </span>
              </div>
            </div>
          )}
        </header>

        <div className="relative z-10 flex-1 min-h-0 max-w-7xl w-full mx-auto flex flex-col lg:flex-row overflow-hidden">
          <nav className="lg:w-60 shrink-0 p-4 lg:overflow-y-auto">
            <ul className="glass rounded-[1.75rem] p-2.5 flex lg:flex-col gap-1.5 overflow-x-auto">
              {NAV.map((n) => {
                const active = n.exact ? pathname === n.to : pathname.startsWith(n.to);
                const Icon = n.icon;
                return (
                  <li key={n.to}>
                    <Link
                      to={n.to}
                      className={`touch-btn flex items-center gap-3 px-4 py-3 rounded-full font-bold whitespace-nowrap transition ${
                        active ? "btn-liquid" : "text-white/80 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <Icon className="w-[1.15rem] h-[1.15rem]" />
                      {n.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <main className="flex-1 min-h-0 overflow-y-auto p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </AdminAccessContext.Provider>
  );
}
