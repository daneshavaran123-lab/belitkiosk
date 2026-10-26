import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Receipt, TrendingUp, Ticket as TicketIcon, DollarSign, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { formatNumber } from "@/lib/money";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
});

const fmt = (n: number) => formatNumber(n);

function AdminDashboard() {
  const [stats, setStats] = useState({ invoices: 0, revenue: 0, today: 0, todayRev: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("invoices").select("total, created_at");
      const rows = data ?? [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayRows = rows.filter((r) => new Date(r.created_at) >= today);
      setStats({
        invoices: rows.length,
        revenue: rows.reduce((s, r) => s + r.total, 0),
        today: todayRows.length,
        todayRev: todayRows.reduce((s, r) => s + r.total, 0),
      });
      setLoading(false);
    };
    load();
  }, []);

  const cards = [
    { label: "کل فاکتورها", value: fmt(stats.invoices), icon: Receipt, tint: "#60a5fa" },
    { label: "درآمد کل", value: fmt(stats.revenue) + " تومان", icon: DollarSign, tint: "#34d399" },
    { label: "فروش امروز", value: fmt(stats.today), icon: TicketIcon, tint: "#f59e0b" },
    {
      label: "درآمد امروز",
      value: fmt(stats.todayRev) + " تومان",
      icon: TrendingUp,
      tint: "#c084fc",
    },
  ];

  return (
    <div className="space-y-6">
      <Toaster position="top-center" richColors />
      <h2 className="text-2xl font-black text-bronze-gradient">داشبورد</h2>
      {loading ? (
        <p className="text-bronze-light/60">در حال بارگذاری...</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.label}
                className="glass-bronze rounded-2xl p-5 flex flex-col gap-3 relative overflow-hidden"
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{ background: `${c.tint}22`, border: `1px solid ${c.tint}55` }}
                >
                  <Icon className="w-5 h-5" style={{ color: c.tint }} />
                </div>
                <p className="text-bronze-light/70 text-sm font-bold">{c.label}</p>
                <p className="text-2xl font-black text-white">{c.value}</p>
              </div>
            );
          })}
        </div>
      )}

      <ChangePasswordCard />
    </div>
  );
}

function ChangePasswordCard() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("رمز باید حداقل ۸ کاراکتر باشد");
      return;
    }
    if (password !== confirm) {
      toast.error("تکرار رمز مطابقت ندارد");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      toast.error("تغییر رمز ناموفق: " + error.message);
      return;
    }
    setPassword("");
    setConfirm("");
    toast.success("رمز عبور با موفقیت تغییر کرد");
  };

  return (
    <div className="glass-bronze rounded-2xl p-6 max-w-xl">
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)" }}
        >
          <KeyRound className="w-5 h-5 text-[#03080f]" />
        </div>
        <div>
          <h3 className="text-lg font-black text-bronze-gradient">تغییر رمز عبور</h3>
          <p className="text-xs text-bronze-light/60">
            پس از اولین ورود، رمز پیش‌فرض را حتماً عوض کنید.
          </p>
        </div>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="np" className="text-bronze-light">
            رمز جدید
          </Label>
          <Input
            id="np"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 bg-black/40 border-primary/30 text-white"
            dir="ltr"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="np2" className="text-bronze-light">
            تکرار رمز جدید
          </Label>
          <Input
            id="np2"
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="h-11 bg-black/40 border-primary/30 text-white"
            dir="ltr"
          />
        </div>
        <Button
          type="submit"
          disabled={saving}
          className="h-11 px-6 font-black rounded-xl text-primary-foreground"
          style={{ background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)" }}
        >
          {saving ? "در حال ذخیره..." : "ذخیره رمز جدید"}
        </Button>
      </form>
    </div>
  );
}
