import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Heart, Star, Send, ArrowRight, CheckCircle2 } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { formatToman, formatTomanShort } from "@/lib/money";

import museumBg from "@/assets/museum-hall-bg.jpg";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "حمایت و نظرسنجی — موزه افتخارات کشتی ایران" },
      { name: "description", content: "از موزه افتخارات کشتی حمایت کنید و در نظرسنجی شرکت کنید." },
      { property: "og:title", content: "حمایت و نظرسنجی موزه کشتی" },
      { property: "og:description", content: "با حمایت و بازخورد خود میراث کشتی را زنده نگه دارید." },
    ],
  }),
  component: SupportPage,
});

const surveySchema = z.object({
  overall_rating: z.number().int().min(1).max(5),
  guide_rating: z.number().int().min(1).max(5).optional().nullable(),
  environment_rating: z.number().int().min(1).max(5).optional().nullable(),
  visitor_name: z.string().trim().max(80).optional().nullable(),
  comment: z.string().trim().max(1000).optional().nullable(),
});

const DONATION_AMOUNTS = [50000, 100000, 200000, 500000, 1000000];

function StarRow({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div>
      <p className="text-bronze-light font-bold mb-2">{label}</p>
      <div className="flex flex-row-reverse justify-end gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className="p-1 touch-btn transition-transform hover:scale-110"
            aria-label={`${n} ستاره`}
          >
            <Star
              className={`w-8 h-8 ${
                n <= value ? "fill-primary text-primary" : "text-bronze-light/30"
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function SupportPage() {
  const navigate = useNavigate();
  const [amount, setAmount] = useState<number>(100000);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [overall, setOverall] = useState(0);
  const [guide, setGuide] = useState(0);
  const [environment, setEnvironment] = useState(0);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleDonate = () => {
    const final = customAmount ? Number(customAmount) : amount;
    if (!final || final < 10000) {
      toast.error("مبلغ حمایت نامعتبر است");
      return;
    }
    toast.success(`سپاسگزاریم! (${formatToman(final)}) — درگاه پرداخت به‌زودی فعال می‌شود.`);
  };

  const submitSurvey = async () => {
    const parsed = surveySchema.safeParse({
      overall_rating: overall,
      guide_rating: guide || null,
      environment_rating: environment || null,
      visitor_name: name || null,
      comment: comment || null,
    });
    if (!parsed.success) {
      toast.error("لطفاً حداقل امتیاز کلی را وارد کنید");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("survey_responses").insert(parsed.data);
    setSubmitting(false);
    if (error) {
      toast.error("خطا در ثبت نظرسنجی");
      return;
    }
    setSubmitted(true);
    toast.success("نظر شما ثبت شد. سپاسگزاریم!");
  };

  return (
    <div className="min-h-screen relative">
      <div
        className="fixed inset-0 z-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${museumBg})` }}
        aria-hidden
      />
      <div
        className="fixed inset-0 z-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(3,8,15,0.75) 0%, rgba(3,8,15,0.9) 100%)",
        }}
        aria-hidden
      />
      <Toaster position="top-center" richColors />

      <header className="relative z-10 max-w-4xl mx-auto px-6 pt-6 flex items-center justify-between">
        <button
          onClick={() => navigate({ to: "/" })}
          className="touch-btn glass-bronze rounded-2xl px-4 py-3 flex items-center gap-2 text-bronze-light"
        >
          <ArrowRight className="w-5 h-5" />
          بازگشت
        </button>
        <h1 className="text-2xl md:text-3xl font-black text-bronze-gradient">حمایت و نظرسنجی</h1>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-6 py-8 grid gap-6 md:grid-cols-2">
        {/* Donation */}
        <section className="glass-bronze rounded-3xl p-6 animate-fade-in-up">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#f87171,#7f1d1d)" }}
            >
              <Heart className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-xl font-black text-bronze-light">حمایت از موزه</h2>
          </div>
          <p className="text-bronze-light/70 mb-4 leading-relaxed">
            حمایت شما به حفظ و توسعهٔ موزهٔ افتخارات کشتی ایران کمک می‌کند.
          </p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {DONATION_AMOUNTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => {
                  setAmount(a);
                  setCustomAmount("");
                }}
                className={`touch-btn rounded-xl py-3 font-bold text-sm transition ${
                  amount === a && !customAmount
                    ? "text-[#03080f]"
                    : "glass text-bronze-light border border-primary/20"
                }`}
                style={
                  amount === a && !customAmount
                    ? { background: "linear-gradient(135deg,#f5c98a,#cd7f32 40%,#8b5a2b)" }
                    : undefined
                }
              >
                {formatTomanShort(a)}
              </button>
            ))}
          </div>
          <input
            type="number"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            placeholder="مبلغ دلخواه (تومان)"
            className="w-full h-12 rounded-xl px-4 bg-black/40 border border-primary/30 text-bronze-light placeholder:text-bronze-light/40 focus:outline-none focus:border-primary"
            dir="ltr"
          />
          <Button
            onClick={handleDonate}
            className="w-full mt-4 h-12 rounded-xl text-base font-black text-[#03080f]"
            style={{ background: "linear-gradient(135deg,#f5c98a,#cd7f32 40%,#8b5a2b)" }}
          >
            <Heart className="w-5 h-5 ml-2" />
            پرداخت و حمایت
          </Button>
        </section>

        {/* Survey */}
        <section className="glass-bronze rounded-3xl p-6 animate-fade-in-up">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#60a5fa,#1e3a8a)" }}
            >
              <Star className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-xl font-black text-bronze-light">نظرسنجی بازدید</h2>
          </div>

          {submitted ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-3" />
              <p className="text-bronze-light font-bold text-lg">سپاس از بازخورد شما!</p>
              <p className="text-bronze-light/60 text-sm mt-1">نظر شما برای بهبود موزه ارزشمند است.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <StarRow value={overall} onChange={setOverall} label="امتیاز کلی به موزه *" />
              <StarRow value={guide} onChange={setGuide} label="کیفیت راهنمایی" />
              <StarRow value={environment} onChange={setEnvironment} label="محیط و فضای موزه" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 80))}
                placeholder="نام (اختیاری)"
                className="w-full h-12 rounded-xl px-4 bg-black/40 border border-primary/30 text-bronze-light placeholder:text-bronze-light/40 focus:outline-none focus:border-primary"
              />
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 1000))}
                placeholder="نظر یا پیشنهاد شما (اختیاری)"
                rows={4}
                className="w-full rounded-xl p-4 bg-black/40 border border-primary/30 text-bronze-light placeholder:text-bronze-light/40 focus:outline-none focus:border-primary resize-none"
              />
              <Button
                onClick={submitSurvey}
                disabled={submitting || overall === 0}
                className="w-full h-12 rounded-xl text-base font-black text-[#03080f] disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#f5c98a,#cd7f32 40%,#8b5a2b)" }}
              >
                <Send className="w-5 h-5 ml-2" />
                {submitting ? "در حال ثبت..." : "ثبت نظرسنجی"}
              </Button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
