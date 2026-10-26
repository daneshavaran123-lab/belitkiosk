import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/PageShell";
import { ProductImage } from "@/components/ProductImage";
import { supabase } from "@/integrations/supabase/client";
import * as Icons from "lucide-react";
import { Minus, Plus, RefreshCw, ShoppingCart, TriangleAlert, type LucideIcon } from "lucide-react";
import { useCartStore, type CartItem } from "@/store/cartStore";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { formatNumber, formatToman } from "@/lib/money";

export interface Product {
  id: number;
  section: string;
  name: string;
  description: string;
  price: number;
  icon: string;
  accent: string;
  image_url: string | null;
  active: boolean;
}

interface Props {
  section: string;
  title: string;
  fallbackIcon: LucideIcon;
  fallbackAccent: string;
  emptyMessage: string;
  cartType: CartItem["type"];
}

function resolveIcon(name: string): LucideIcon {
  const map = Icons as unknown as Record<string, LucideIcon>;
  return map[name] ?? Icons.Package;
}

async function fetchSectionProducts(section: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, section, name, description, price, icon, accent, image_url, active")
    .eq("section", section)
    .eq("active", true)
    .order("sort_order")
    .order("id");
  if (error) {
    console.error(`[shop:${section}] خطای دریافت محصولات:`, error.message, error);
    throw new Error(error.message);
  }
  return (data as Product[]) ?? [];
}


export function SectionShopPage({
  section,
  title,
  fallbackIcon: FallbackIcon,
  fallbackAccent,
  emptyMessage,
  cartType,
}: Props) {
  const [qty, setQty] = useState<Record<number, number>>({});
  const addItem = useCartStore((s) => s.addItem);

  const {
    data: items = [],
    isPending: loading,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["products", section],
    queryFn: () => fetchSectionProducts(section),
    retry: 2,
    staleTime: 60_000,
  });


  const getQty = (id: number) => qty[id] ?? 1;
  const setQ = (id: number, n: number) =>
    setQty((q) => ({ ...q, [id]: Math.max(1, Math.min(99, n)) }));

  const add = (p: Product) => {
    const quantity = getQty(p.id);
    addItem({
      type: cartType,
      name: p.name,
      quantity,
      unitPrice: p.price,
      discountPercent: 0,
      referenceId: p.id,
    });
    toast.success(`${p.name} به سبد اضافه شد`);
  };

  return (
    <PageShell title={title}>
      <Toaster position="top-center" richColors />
      <section className="max-w-5xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="glass-bronze rounded-3xl p-10 text-center space-y-5 max-w-2xl mx-auto animate-fade-in-up">
            <TriangleAlert className="w-16 h-16 mx-auto text-amber-400" />
            <h2 className="text-2xl font-black text-bronze-gradient">
              دریافت محصولات ناموفق بود
            </h2>
            <p className="text-bronze-light/70 text-sm" dir="ltr">
              {(error as Error).message}
            </p>
            <p className="text-bronze-light/60">
              اتصال اینترنت دستگاه را بررسی کنید و دوباره تلاش کنید.
            </p>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="touch-btn inline-flex items-center gap-2 h-12 px-8 rounded-full font-black text-primary-foreground disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)" }}
            >
              <RefreshCw className={`w-5 h-5 ${isFetching ? "animate-spin" : ""}`} />
              تلاش دوباره
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="glass-bronze rounded-3xl p-10 text-center space-y-6 max-w-2xl mx-auto animate-fade-in-up relative overflow-hidden">
            <div
              className="absolute top-0 inset-x-0 h-1"
              style={{ background: `linear-gradient(90deg, ${fallbackAccent}, #cd7f32)` }}
            />
            <div
              className="w-24 h-24 mx-auto rounded-full flex items-center justify-center shadow-2xl"
              style={{
                background: `radial-gradient(circle at 30% 30%, ${fallbackAccent}, #cd7f32 60%, #8b5a2b)`,
              }}
            >
              <FallbackIcon className="w-12 h-12 text-[#03080f]" strokeWidth={2.2} />
            </div>
            <h2 className="text-3xl font-black text-bronze-gradient">{title}</h2>
            <p className="text-bronze-light/70">{emptyMessage}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {items.map((p, i) => {
              const Icon = resolveIcon(p.icon);
              return (
                <div
                  key={p.id}
                  className="glass-bronze rounded-2xl p-5 flex flex-col gap-4 relative overflow-hidden animate-fade-in-up"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div
                    className="absolute top-0 inset-x-0 h-1"
                    style={{ background: `linear-gradient(90deg, ${p.accent}, #cd7f32)` }}
                  />
                  <div className="flex items-start gap-4">
                    {p.image_url ? (
                      <ProductImage
                        value={p.image_url}
                        alt={p.name}
                        className="w-16 h-16 rounded-xl object-cover shrink-0"
                      />
                    ) : (
                      <div
                        className="w-16 h-16 rounded-xl flex items-center justify-center shrink-0 shadow-lg"
                        style={{
                          background: `radial-gradient(circle at 30% 30%, ${p.accent}, #cd7f32 65%, #8b5a2b)`,
                        }}
                      >
                        <Icon className="w-8 h-8 text-[#03080f]" strokeWidth={2.2} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-black text-bronze-gradient leading-tight">
                        {p.name}
                      </h3>
                      <p className="text-bronze-light/70 text-sm mt-1 line-clamp-3">
                        {p.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-primary/15">
                    <div className="text-bronze-light">
                      <span className="text-xl font-black text-bronze-gradient">
                        {formatToman(p.price)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 glass rounded-full border border-primary/25 p-1">
                      <button
                        onClick={() => setQ(p.id, getQty(p.id) - 1)}
                        className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-bronze-light"
                        aria-label="کاهش"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-7 text-center font-black text-bronze-light">
                        {formatNumber(getQty(p.id))}
                      </span>
                      <button
                        onClick={() => setQ(p.id, getQty(p.id) + 1)}
                        className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-bronze-light"
                        aria-label="افزایش"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={() => add(p)}
                    className="touch-btn w-full h-11 rounded-xl font-black text-primary-foreground flex items-center justify-center gap-2"
                    style={{
                      background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)",
                    }}
                  >
                    <ShoppingCart className="w-4 h-4" />
                    افزودن به سبد
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </PageShell>
  );
}
