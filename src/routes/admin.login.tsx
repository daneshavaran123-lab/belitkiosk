import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { PageShell } from "@/components/PageShell";
import { LogIn, KeyRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/admin/login")({
  head: () => ({
    meta: [{ title: "ورود ادمین — موزه کشتی" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/admin" });
    });
  }, [navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error("ورود ناموفق: " + error.message);
      return;
    }
    toast.success("خوش آمدید");
    navigate({ to: "/admin" });
  };

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: window.location.origin + "/admin/reset-password",
    });
    setResetLoading(false);
    if (error) {
      toast.error("ارسال ایمیل ناموفق: " + error.message);
      return;
    }
    toast.success("لینک بازیابی ارسال شد. صندوق ایمیل خود را بررسی کنید.");
    setResetOpen(false);
  };

  return (
    <PageShell title="ورود ادمین" showCart={false}>
      <Toaster position="top-center" richColors />
      <section className="max-w-md mx-auto px-6 py-10">
        <form
          onSubmit={onSubmit}
          className="glass-bronze rounded-3xl p-8 space-y-5 animate-fade-in-up"
        >
          <div className="text-center mb-2">
            <div
              className="w-20 h-20 rounded-full mx-auto flex items-center justify-center"
              style={{
                background: "radial-gradient(circle at 30% 30%, #f5c98a, #cd7f32 55%, #8b5a2b)",
              }}
            >
              <LogIn className="w-10 h-10 text-[#03080f]" strokeWidth={2.2} />
            </div>
            <h2 className="mt-4 text-2xl font-black text-bronze-gradient">پنل مدیریت</h2>
            <p className="text-bronze-light/70 text-sm mt-1 font-medium">ورود ویژه مدیران موزه</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" className="text-bronze-light">
              ایمیل
            </Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-12 bg-black/40 border-primary/30 text-white"
              dir="ltr"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-bronze-light">
              رمز عبور
            </Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 bg-black/40 border-primary/30 text-white"
              dir="ltr"
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="touch-btn w-full h-14 text-lg font-black rounded-2xl text-primary-foreground"
            style={{
              background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)",
            }}
          >
            {loading ? "در حال ورود..." : "ورود"}
          </Button>

          <button
            type="button"
            onClick={() => setResetOpen(true)}
            className="w-full text-center text-sm text-bronze-light/80 hover:text-primary font-medium flex items-center justify-center gap-1"
          >
            <KeyRound className="w-4 h-4" />
            فراموشی رمز عبور
          </button>
        </form>
      </section>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="glass-bronze border-primary/30" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-bronze-gradient">بازیابی رمز عبور</DialogTitle>
            <DialogDescription className="text-bronze-light/70">
              ایمیل خود را وارد کنید تا لینک بازیابی برایتان ارسال شود.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={sendReset} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-email" className="text-bronze-light">
                ایمیل
              </Label>
              <Input
                id="reset-email"
                type="email"
                required
                dir="ltr"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                className="h-12 bg-black/40 border-primary/30 text-white"
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={resetLoading}
                className="w-full h-12 font-black rounded-xl text-primary-foreground"
                style={{ background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)" }}
              >
                {resetLoading ? "در حال ارسال..." : "ارسال لینک بازیابی"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
