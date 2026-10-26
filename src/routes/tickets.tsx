import { createFileRoute } from "@tanstack/react-router";
import { formatToman } from "@/lib/money";
import { useState } from "react";
import { useCartStore } from "@/store/cartStore";
import { Minus, Plus, Users, Sparkles, Ticket, Mic, Crown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { TICKET_TYPES, type TicketType } from "@/lib/ticketData";
import { PageShell } from "@/components/PageShell";

export const Route = createFileRoute("/tickets")({
  head: () => ({
    meta: [
      { title: "خرید بلیط — موزه افتخارات کشتی ایران" },
      { name: "description", content: "انتخاب و خرید بلیط بازدید از موزه افتخارات کشتی ایران." },
      { property: "og:title", content: "خرید بلیط موزه کشتی ایران" },
      { property: "og:description", content: "بلیط عادی، با راهنما و VIP با تخفیف گروهی." },
    ],
  }),
  component: TicketsPage,
});

const CATEGORY_ICONS = {
  normal: Ticket,
  guided: Mic,
  vip: Crown,
} as const;

const CATEGORY_LABEL = { normal: "عادی", guided: "با راهنما", vip: "VIP" } as const;

const fmt = (n: number) => formatToman(n);

function TicketsPage() {
  const addItem = useCartStore((s) => s.addItem);
  const [selected, setSelected] = useState<TicketType | null>(null);
  const [quantity, setQuantity] = useState(1);

  const discount = (t: TicketType, q: number) =>
    q >= t.group_min_count ? t.group_discount_percent : 0;

  const handleAdd = () => {
    if (!selected) return;
    const d = discount(selected, quantity);
    addItem({
      type: "ticket",
      name: `${selected.name}${d > 0 ? " (گروهی)" : ""}`,
      quantity,
      unitPrice: selected.base_price,
      discountPercent: d,
      referenceId: selected.id,
    });
    toast.success("به سبد خرید اضافه شد");
    setSelected(null);
    setQuantity(1);
  };

  return (
    <PageShell title="فروش بلیط">
      <Toaster position="top-center" richColors />
      <section className="max-w-5xl mx-auto px-6 py-8">
        {!selected ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TICKET_TYPES.map((t, i) => {
              const Icon = CATEGORY_ICONS[t.category];
              return (
                <button
                  key={t.id}
                  onClick={() => setSelected(t)}
                  className="touch-btn group relative glass-bronze rounded-3xl p-8 flex flex-col items-center gap-5 text-center animate-fade-in-up hover:-translate-y-2 transition-all overflow-hidden"
                  style={{ animationDelay: `${i * 100}ms` }}
                >
                  <div
                    className="absolute top-4 left-4 px-3 py-1 rounded-full text-xs font-bold"
                    style={{
                      background: "linear-gradient(135deg, #f5c98a, #cd7f32)",
                      color: "#03080f",
                    }}
                  >
                    {CATEGORY_LABEL[t.category]}
                  </div>
                  <div
                    className="w-24 h-24 rounded-full flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform"
                    style={{
                      background:
                        "radial-gradient(circle at 30% 30%, #f5c98a, #cd7f32 55%, #8b5a2b)",
                      boxShadow: "0 15px 40px rgba(205,127,50,0.45)",
                    }}
                  >
                    <Icon className="w-12 h-12 text-[#03080f]" strokeWidth={2.2} />
                  </div>
                  <h3 className="text-2xl font-black text-bronze-gradient">{t.name}</h3>
                  <p className="text-bronze-light/70 text-sm font-medium min-h-[40px]">
                    {t.description}
                  </p>
                  <div className="text-3xl font-black text-white">{fmt(t.base_price)}</div>
                  <p className="text-xs text-bronze-light/60 flex items-center gap-2 font-medium">
                    <Users className="w-4 h-4" />
                    تخفیف {t.group_discount_percent}٪ برای {t.group_min_count}+ نفر
                  </p>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="max-w-lg mx-auto glass-bronze rounded-3xl p-8 animate-scale-in">
            <div className="flex justify-center mb-6">
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center"
                style={{
                  background:
                    "radial-gradient(circle at 30% 30%, #f5c98a, #cd7f32 55%, #8b5a2b)",
                }}
              >
                {(() => {
                  const Icon = CATEGORY_ICONS[selected.category];
                  return <Icon className="w-10 h-10 text-[#03080f]" strokeWidth={2.2} />;
                })()}
              </div>
            </div>
            <h2 className="text-3xl font-black text-bronze-gradient text-center mb-2">
              {selected.name}
            </h2>
            <p className="text-bronze-light/70 text-center mb-8 font-medium">
              {selected.description}
            </p>

            <div className="flex items-center justify-center gap-6 mb-6">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="touch-btn w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-bronze-light hover:bg-white/10 border border-primary/25"
              >
                <Minus className="w-6 h-6" />
              </button>
              <span className="text-5xl font-black text-white min-w-[80px] text-center">
                {quantity}
              </span>
              <button
                onClick={() => setQuantity(quantity + 1)}
                className="touch-btn w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-bronze-light hover:bg-white/10 border border-primary/25"
              >
                <Plus className="w-6 h-6" />
              </button>
            </div>

            {quantity >= selected.group_min_count && (
              <div className="bg-emerald-500/15 border border-emerald-500/40 rounded-2xl p-4 mb-6 text-center animate-scale-in">
                <p className="text-emerald-300 font-bold flex items-center justify-center gap-2">
                  <Sparkles className="w-5 h-5" />
                  تخفیف گروهی {selected.group_discount_percent}٪ اعمال شد
                </p>
              </div>
            )}

            <div className="bg-black/40 rounded-2xl p-5 mb-6 space-y-3 border border-primary/15">
              <div className="flex justify-between text-bronze-light/70">
                <span>قیمت واحد:</span>
                <span className="font-bold">{fmt(selected.base_price)}</span>
              </div>
              <div className="flex justify-between text-bronze-light/70">
                <span>تعداد:</span>
                <span className="font-bold">{quantity} عدد</span>
              </div>
              {discount(selected, quantity) > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>تخفیف گروهی:</span>
                  <span className="font-bold">{discount(selected, quantity)}٪</span>
                </div>
              )}
              <hr className="border-primary/20" />
              <div className="flex justify-between text-white font-black text-2xl">
                <span>جمع کل:</span>
                <span>
                  {fmt(
                    Math.round(
                      quantity * selected.base_price * (1 - discount(selected, quantity) / 100),
                    ),
                  )}
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={handleAdd}
                className="touch-btn flex-1 h-14 text-lg font-black rounded-2xl text-primary-foreground"
                style={{
                  background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)",
                  boxShadow: "0 10px 30px rgba(205,127,50,0.35)",
                }}
              >
                <Check className="w-5 h-5 ml-2" />
                افزودن به سبد
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSelected(null);
                  setQuantity(1);
                }}
                className="touch-btn h-14 px-6 border-primary/30 text-bronze-light hover:bg-primary/10 rounded-2xl !bg-transparent"
              >
                انصراف
              </Button>
            </div>
          </div>
        )}
      </section>
    </PageShell>
  );
}
