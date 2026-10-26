import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { PageShell } from "@/components/PageShell";
import { KeyRound } from "lucide-react";

export const Route = createFileRoute("/admin/reset-password")({
  head: () => ({
    meta: [
      { title: "بازیابی رمز — پنل مدیریت" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Supabase places a recovery session in the URL hash; wait for it.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

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
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error("تغییر رمز ناموفق: " + error.message);
      return;
    }
    toast.success("رمز عبور با موفقیت تغییر کرد");
    navigate({ to: "/admin" });
  };

  return (
    <PageShell title="بازیابی رمز" showCart={false}>
      <Toaster position="top-center" richColors />
      <section className="max-w-md mx-auto px-6 py-10">
        <form onSubmit={onSubmit} className="glass-bronze rounded-3xl p-8 space-y-5 animate-fade-in-up">
          <div className="text-center mb-2">
            <div
              className="w-20 h-20 rounded-full mx-auto flex items-center justify-center"
              style={{ background: "radial-gradient(circle at 30% 30%, #f5c98a, #cd7f32 55%, #8b5a2b)" }}
            >
              <KeyRound className="w-10 h-10 text-[#03080f]" strokeWidth={2.2} />
            </div>
            <h2 className="mt-4 text-2xl font-black text-bronze-gradient">تعیین رمز جدید</h2>
            <p className="text-bronze-light/70 text-sm mt-1 font-medium">
              {ready ? "رمز جدید خود را وارد کنید" : "در حال بررسی لینک بازیابی..."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pwd" className="text-bronze-light">رمز جدید</Label>
            <Input
              id="pwd"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 bg-black/40 border-primary/30 text-white"
              dir="ltr"
              disabled={!ready}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pwd2" className="text-bronze-light">تکرار رمز جدید</Label>
            <Input
              id="pwd2"
              type="password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-12 bg-black/40 border-primary/30 text-white"
              dir="ltr"
              disabled={!ready}
            />
          </div>

          <Button
            type="submit"
            disabled={loading || !ready}
            className="touch-btn w-full h-14 text-lg font-black rounded-2xl text-primary-foreground"
            style={{ background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)" }}
          >
            {loading ? "در حال ذخیره..." : "ذخیره رمز جدید"}
          </Button>
        </form>
      </section>
    </PageShell>
  );
}
