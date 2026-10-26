import { createFileRoute, Outlet, Link, useNavigate, useRouterState, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LayoutDashboard, Ticket, Receipt, LogOut, Home, Package, MessageSquare, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "پنل مدیریت — موزه کشتی" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminLayout,
});

const NAV = [
  { to: "/admin", label: "داشبورد", icon: LayoutDashboard, exact: true },
  { to: "/admin/tickets", label: "مدیریت بلیط‌ها", icon: Ticket, exact: false },
  { to: "/admin/products", label: "مدیریت محصولات", icon: Package, exact: false },
  { to: "/admin/invoices", label: "فاکتورها", icon: Receipt, exact: false },
  { to: "/admin/surveys", label: "نظرسنجی‌ها", icon: MessageSquare, exact: false },
  { to: "/admin/pos", label: "کارت‌خوان", icon: CreditCard, exact: false },
] as const;

function AdminLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [state, setState] = useState<"loading" | "ok" | "denied">("loading");
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const { data: userData } = await supabase.auth.getUser();
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
  }, [navigate]);

  if (pathname === "/admin/login") return <div className="h-full overflow-y-auto"><Outlet /></div>;

  if (state === "loading") {
    return (
      <div className="h-full flex items-center justify-center bg-[#03080f]">
        <div className="w-14 h-14 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 bg-[#03080f] text-center px-6">
        <h2 className="text-3xl font-black text-bronze-gradient">دسترسی مجاز نیست</h2>
        <p className="text-bronze-light/70">حساب شما نقش «admin» ندارد.</p>
        <div className="flex gap-3">
          <Button
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/admin/login" });
            }}
            className="rounded-xl"
          >
            خروج
          </Button>
          <Link to="/" className="inline-flex items-center gap-2 h-10 px-4 rounded-xl glass-bronze text-bronze-light">
            <Home className="w-4 h-4" /> صفحه اصلی
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh max-h-dvh flex flex-col overflow-hidden bg-[#03080f] text-bronze-light">
      <header className="shrink-0 border-b border-primary/20 bg-black/40 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)",
              }}
            >
              <LayoutDashboard className="w-5 h-5 text-[#03080f]" />
            </div>
            <h1 className="text-lg font-black text-bronze-gradient">پنل مدیریت موزه</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-bronze-light/70" dir="ltr">{email}</span>
            <Link
              to="/"
              className="touch-btn h-10 px-3 rounded-xl glass border border-primary/20 text-bronze-light flex items-center gap-1 text-sm"
            >
              <Home className="w-4 h-4" /> سایت
            </Link>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/admin/login" });
              }}
              className="touch-btn h-10 px-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 flex items-center gap-1 text-sm"
            >
              <LogOut className="w-4 h-4" /> خروج
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 max-w-7xl w-full mx-auto flex flex-col lg:flex-row overflow-hidden">
        <nav className="lg:w-56 shrink-0 p-4 lg:border-l lg:border-primary/15 lg:overflow-y-auto">
          <ul className="flex lg:flex-col gap-2 overflow-x-auto">
            {NAV.map((n) => {
              const active = n.exact ? pathname === n.to : pathname.startsWith(n.to);
              const Icon = n.icon;
              return (
                <li key={n.to}>
                  <Link
                    to={n.to}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold whitespace-nowrap transition ${
                      active
                        ? "text-[#03080f]"
                        : "text-bronze-light hover:bg-white/5"
                    }`}
                    style={
                      active
                        ? { background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)" }
                        : undefined
                    }
                  >
                    <Icon className="w-4 h-4" />
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
  );
}
