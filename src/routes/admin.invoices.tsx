import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatNumber } from "@/lib/money";

export const Route = createFileRoute("/admin/invoices")({
  component: AdminInvoicesPage,
});

interface Invoice {
  id: string;
  invoice_number: string;
  total: number;
  payment_method: string;
  status: string;
  created_at: string;
}
interface Item {
  id: string;
  invoice_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  total_price: number;
}

const fmt = (n: number) => formatNumber(n);
const fmtDate = (s: string) => new Date(s).toLocaleString("fa-IR");

function AdminInvoicesPage() {
  const [rows, setRows] = useState<Invoice[]>([]);
  const [items, setItems] = useState<Record<string, Item[]>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) toast.error(error.message);
      setRows((data as Invoice[]) ?? []);
      setLoading(false);
    };
    load();
  }, []);

  const toggle = async (id: string) => {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    if (!items[id]) {
      const { data } = await supabase
        .from("invoice_items")
        .select("*")
        .eq("invoice_id", id);
      setItems((p) => ({ ...p, [id]: (data as Item[]) ?? [] }));
    }
  };

  return (
    <div className="space-y-6">
      <Toaster position="top-center" richColors />
      <h2 className="text-2xl font-black text-bronze-gradient">فاکتورها</h2>

      {loading ? (
        <p className="text-bronze-light/60">در حال بارگذاری...</p>
      ) : rows.length === 0 ? (
        <div className="glass-bronze rounded-2xl p-10 text-center text-bronze-light/60">
          فاکتوری ثبت نشده است
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="glass-bronze rounded-2xl overflow-hidden">
              <button
                onClick={() => toggle(r.id)}
                className="w-full grid grid-cols-2 md:grid-cols-5 gap-3 items-center p-4 text-right hover:bg-white/5 transition"
              >
                <span className="font-mono font-bold text-bronze-light">
                  {r.invoice_number}
                </span>
                <span className="text-bronze-light/70 text-sm">{fmtDate(r.created_at)}</span>
                <span className="text-bronze-light/70">
                  {r.payment_method === "card" ? "کارت‌خوان" : "نقدی"}
                </span>
                <span className="text-white font-black">{fmt(r.total)} تومان</span>
                <span className="flex justify-end">
                  {open === r.id ? (
                    <ChevronUp className="w-5 h-5 text-bronze-light" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-bronze-light" />
                  )}
                </span>
              </button>
              {open === r.id && (
                <div className="border-t border-primary/20 p-4 bg-black/30 space-y-2">
                  {(items[r.id] ?? []).map((it) => (
                    <div
                      key={it.id}
                      className="flex justify-between text-sm text-bronze-light"
                    >
                      <span>
                        {it.name} × {it.quantity}
                        {it.discount_percent > 0 && ` (${it.discount_percent}٪ تخفیف)`}
                      </span>
                      <span className="font-bold text-white">
                        {fmt(it.total_price)} تومان
                      </span>
                    </div>
                  ))}
                  {(items[r.id]?.length ?? 0) === 0 && (
                    <p className="text-bronze-light/50 text-sm">در حال بارگذاری اقلام...</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
