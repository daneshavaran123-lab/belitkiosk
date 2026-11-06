import { createFileRoute } from "@tanstack/react-router";
import { formatNumber, formatToman } from "@/lib/money";
import { useState } from "react";
import { useCartStore } from "@/store/cartStore";
import { Minus, Plus, Users, Sparkles, Ticket, Mic, Crown, Check, ChevronLeft } from "lucide-react";
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

  const total = selected
    ? Math.round(quantity * selected.base_price * (1 - discount(selected, quantity) / 100))
    : 0;

  return (
    <PageShell title="فروش بلیط">
      <Toaster position="top-center" richColors />
      <section className="max-w-4xl mx-auto px-6 py-8 min-h-full flex flex-col justify-center">
        {!selected ? (
          <>
            <div className="text-center mb-8 animate-fade-in-up">
              <h2 className="text-3xl md:text-4xl font-black text-white">
                نوع بلیط را انتخاب کنید
              </h2>
              <p className="mt-2 text-white/60 font-medium">
                برای ادامه روی یکی از بلیط‌ها بزنید؛ در مرحلهٔ بعد تعداد را انتخاب می‌کنید.
              </p>
            </div>
            <div className="flex flex-col gap-5">
              {TICKET_TYPES.map((t, i) => {
                const Icon = CATEGORY_ICONS[t.category];
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelected(t)}
                    className="touch-btn group glass-bronze rounded-[2rem] p-6 md:p-7 flex items-center gap-6 text-right animate-fade-in-up hover:-translate-y-1 hover:brightness-110"
                    style={{ animationDelay: `${i * 90}ms` }}
                  >
                    <div
                      className="w-24 h-24 shrink-0 rounded-full flex items-center justify-center"
                      style={{
                        background:
                          "radial-gradient(circle at 30% 25%, #fff0d2, #f0b868 35%, #cd7f32 70%, #8b5a2b)",
                        boxShadow:
                          "inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -4px 10px rgba(120,60,10,0.4), 0 10px 22px rgba(205,127,50,0.28)",
                      }}
                    >
                      <Icon className="w-11 h-11 text-[#2a1606]" strokeWidth={2.2} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="text-2xl md:text-3xl font-black text-white">{t.name}</h3>
                        <span className="glass-chip rounded-full px-3 py-0.5 text-xs font-bold text-bronze-light">
                          {CATEGORY_LABEL[t.category]}
                        </span>
                      </div>
                      <p className="mt-1.5 text-white/70 text-base font-medium">{t.description}</p>
                      <p className="mt-2 text-sm text-emerald-300/90 flex items-center gap-2 font-bold">
                        <Users className="w-4 h-4" />
                        تخفیف {formatNumber(t.group_discount_percent)}٪ برای{" "}
                        {formatNumber(t.group_min_count)}+ نفر
                      </p>
                    </div>

                    <div className="shrink-0 text-center" aria-label={fmt(t.base_price)}>
                      <div className="text-3xl md:text-4xl font-black text-bronze-gradient leading-none">
                        {formatNumber(t.base_price)}
                      </div>
                      <div className="mt-1.5 text-sm font-bold text-white/60">تومان</div>
                    </div>

                    <ChevronLeft
                      className="w-8 h-8 shrink-0 text-white/40 group-hover:text-bronze-light transition"
                      aria-hidden
                    />
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="max-w-xl w-full mx-auto glass-strong rounded-[2.25rem] p-8 animate-scale-in">
            <div className="flex justify-center mb-5">
              <div
                className="w-24 h-24 rounded-full flex items-center justify-center"
                style={{
                  background:
                    "radial-gradient(circle at 30% 25%, #fff0d2, #f0b868 35%, #cd7f32 70%, #8b5a2b)",
                  boxShadow:
                    "inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -4px 10px rgba(120,60,10,0.4), 0 10px 22px rgba(205,127,50,0.28)",
                }}
              >
                {(() => {
                  const Icon = CATEGORY_ICONS[selected.category];
                  return <Icon className="w-11 h-11 text-[#2a1606]" strokeWidth={2.2} />;
                })()}
              </div>
            </div>
            <h2 className="text-3xl font-black text-bronze-gradient text-center mb-2">
              {selected.name}
            </h2>
            <p className="text-white/70 text-center mb-8 font-medium">{selected.description}</p>

            <div className="flex items-center justify-center gap-6 mb-6">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                disabled={quantity <= 1}
                className="touch-btn glass-chip w-[4.5rem] h-[4.5rem] rounded-full flex items-center justify-center text-white disabled:opacity-40"
                aria-label="یکی کمتر"
              >
                <Minus className="w-8 h-8" />
              </button>
              <span className="text-6xl font-black text-white min-w-[5.5rem] text-center tabular-nums">
                {formatNumber(quantity)}
              </span>
              <button
                onClick={() => setQuantity(quantity + 1)}
                className="touch-btn glass-chip w-[4.5rem] h-[4.5rem] rounded-full flex items-center justify-center text-white"
                aria-label="یکی بیشتر"
              >
                <Plus className="w-8 h-8" />
              </button>
            </div>

            {quantity >= selected.group_min_count ? (
              <div className="bg-emerald-400/15 border border-emerald-300/40 rounded-2xl p-4 mb-6 text-center animate-scale-in backdrop-blur-md">
                <p className="text-emerald-200 font-bold flex items-center justify-center gap-2">
                  <Sparkles className="w-5 h-5" />
                  تخفیف گروهی {formatNumber(selected.group_discount_percent)}٪ اعمال شد
                </p>
              </div>
            ) : (
              <p className="mb-6 text-center text-sm text-white/55 font-medium">
                با خرید {formatNumber(selected.group_min_count)} عدد یا بیشتر،{" "}
                {formatNumber(selected.group_discount_percent)}٪ تخفیف گروهی می‌گیرید.
              </p>
            )}

            <div className="glass-well rounded-3xl p-5 mb-6 space-y-3">
              <div className="flex justify-between text-white/70">
                <span>قیمت واحد:</span>
                <span className="font-bold">{fmt(selected.base_price)}</span>
              </div>
              <div className="flex justify-between text-white/70">
                <span>تعداد:</span>
                <span className="font-bold">{formatNumber(quantity)} عدد</span>
              </div>
              {discount(selected, quantity) > 0 && (
                <div className="flex justify-between text-emerald-300">
                  <span>تخفیف گروهی:</span>
                  <span className="font-bold">{formatNumber(discount(selected, quantity))}٪</span>
                </div>
              )}
              <hr className="border-white/15" />
              <div className="flex justify-between items-baseline text-white font-black text-2xl">
                <span>جمع کل:</span>
                <span className="text-bronze-gradient text-3xl">{fmt(total)}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={handleAdd}
                className="touch-btn btn-liquid flex-1 h-16 text-xl font-black rounded-full hover:brightness-105"
              >
                <Check className="w-6 h-6 ml-2" />
                افزودن به سبد
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSelected(null);
                  setQuantity(1);
                }}
                className="touch-btn h-16 px-8 text-lg rounded-full"
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
