import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Star, Trash2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/surveys")({
  head: () => ({
    meta: [
      { title: "نظرسنجی‌ها — پنل مدیریت" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminSurveys,
});

interface SurveyRow {
  id: string;
  overall_rating: number;
  guide_rating: number | null;
  environment_rating: number | null;
  visitor_name: string | null;
  comment: string | null;
  created_at: string;
}

function Stars({ n }: { n: number | null }) {
  if (!n) return <span className="text-bronze-light/30 text-sm">—</span>;
  return (
    <div className="flex flex-row-reverse gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`w-4 h-4 ${i < n ? "fill-primary text-primary" : "text-bronze-light/20"}`}
        />
      ))}
    </div>
  );
}

function AdminSurveys() {
  const [rows, setRows] = useState<SurveyRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("survey_responses")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error("خطا در بارگذاری");
    setRows((data as SurveyRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async (id: string) => {
    if (!confirm("این پاسخ حذف شود؟")) return;
    const { error } = await supabase.from("survey_responses").delete().eq("id", id);
    if (error) return toast.error("خطا در حذف");
    toast.success("حذف شد");
    load();
  };

  const avg = (key: keyof SurveyRow) => {
    const vals = rows.map((r) => r[key] as number | null).filter((v): v is number => !!v);
    if (!vals.length) return "—";
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-bronze-gradient mb-1">نظرسنجی‌های بازدیدکنندگان</h2>
        <p className="text-bronze-light/60 text-sm">مجموع {rows.length.toLocaleString("fa-IR")} پاسخ</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: "میانگین کلی", v: avg("overall_rating") },
          { label: "میانگین راهنما", v: avg("guide_rating") },
          { label: "میانگین محیط", v: avg("environment_rating") },
        ].map((s) => (
          <div key={s.label} className="glass-bronze rounded-2xl p-4">
            <p className="text-bronze-light/60 text-sm">{s.label}</p>
            <p className="text-3xl font-black text-bronze-gradient mt-1">{s.v}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-bronze-light/60">در حال بارگذاری...</div>
      ) : rows.length === 0 ? (
        <div className="glass-bronze rounded-2xl p-12 text-center">
          <MessageSquare className="w-12 h-12 mx-auto text-bronze-light/40 mb-3" />
          <p className="text-bronze-light/70">هنوز نظرسنجی‌ای ثبت نشده است.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="glass-bronze rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="font-bold text-bronze-light">
                    {r.visitor_name || "ناشناس"}
                  </p>
                  <p className="text-xs text-bronze-light/50">
                    {new Date(r.created_at).toLocaleString("fa-IR")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(r.id)}
                  className="text-red-300 hover:bg-red-500/10"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                <div>
                  <p className="text-xs text-bronze-light/60 mb-1">کلی</p>
                  <Stars n={r.overall_rating} />
                </div>
                <div>
                  <p className="text-xs text-bronze-light/60 mb-1">راهنما</p>
                  <Stars n={r.guide_rating} />
                </div>
                <div>
                  <p className="text-xs text-bronze-light/60 mb-1">محیط</p>
                  <Stars n={r.environment_rating} />
                </div>
              </div>
              {r.comment && (
                <p className="text-bronze-light/80 text-sm border-t border-primary/10 pt-3 leading-relaxed">
                  {r.comment}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
