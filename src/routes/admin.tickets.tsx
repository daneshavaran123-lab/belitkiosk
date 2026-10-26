import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { formatNumber } from "@/lib/money";

export const Route = createFileRoute("/admin/tickets")({
  component: AdminTicketsPage,
});

interface Ticket {
  id: number;
  name: string;
  description: string;
  category: "normal" | "guided" | "vip";
  base_price: number;
  group_min_count: number;
  group_discount_percent: number;
  active: boolean;
}

const empty: Omit<Ticket, "id"> = {
  name: "",
  description: "",
  category: "normal",
  base_price: 0,
  group_min_count: 10,
  group_discount_percent: 20,
  active: true,
};

const fmt = (n: number) => formatNumber(n);

function AdminTicketsPage() {
  const [rows, setRows] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Ticket | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Omit<Ticket, "id">>(empty);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("ticket_types").select("*").order("id");
    if (error) toast.error(error.message);
    setRows((data as Ticket[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(empty);
    setCreating(true);
  };

  const openEdit = (t: Ticket) => {
    setEditing(t);
    setForm({ ...t });
    setCreating(true);
  };

  const save = async () => {
    if (editing) {
      const { error } = await supabase.from("ticket_types").update(form).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("ذخیره شد");
    } else {
      const { error } = await supabase.from("ticket_types").insert(form);
      if (error) return toast.error(error.message);
      toast.success("بلیط جدید ثبت شد");
    }
    setCreating(false);
    load();
  };

  const remove = async (id: number) => {
    if (!confirm("حذف این بلیط؟")) return;
    const { error } = await supabase.from("ticket_types").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("حذف شد");
    load();
  };

  return (
    <div className="space-y-6">
      <Toaster position="top-center" richColors />
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black text-bronze-gradient">مدیریت بلیط‌ها</h2>
        <Button
          onClick={openCreate}
          className="rounded-xl text-primary-foreground"
          style={{ background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)" }}
        >
          <Plus className="w-4 h-4 ml-1" /> بلیط جدید
        </Button>
      </div>

      {loading ? (
        <p className="text-bronze-light/60">در حال بارگذاری...</p>
      ) : (
        <div className="overflow-x-auto glass-bronze rounded-2xl">
          <table className="w-full text-right">
            <thead className="border-b border-primary/20 text-bronze-light/70 text-sm">
              <tr>
                <th className="p-4">نام</th>
                <th className="p-4">دسته</th>
                <th className="p-4">قیمت</th>
                <th className="p-4">تخفیف گروهی</th>
                <th className="p-4">وضعیت</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody className="text-white">
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-primary/10 hover:bg-white/5">
                  <td className="p-4 font-bold">{r.name}</td>
                  <td className="p-4 text-bronze-light/70">{r.category}</td>
                  <td className="p-4">{fmt(r.base_price)} تومان</td>
                  <td className="p-4 text-bronze-light/70">
                    {r.group_discount_percent}٪ برای {r.group_min_count}+
                  </td>
                  <td className="p-4">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-bold ${
                        r.active
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-red-500/20 text-red-300"
                      }`}
                    >
                      {r.active ? "فعال" : "غیرفعال"}
                    </span>
                  </td>
                  <td className="p-4 flex gap-2 justify-end">
                    <button
                      onClick={() => openEdit(r)}
                      className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-bronze-light"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => remove(r.id)}
                      className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-bronze-light/50">
                    بلیطی ثبت نشده است
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur flex items-center justify-center p-4">
          <div className="glass-bronze rounded-3xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-black text-bronze-gradient">
                {editing ? "ویرایش بلیط" : "بلیط جدید"}
              </h3>
              <button
                onClick={() => setCreating(false)}
                className="p-2 rounded-lg hover:bg-white/10 text-bronze-light"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <Label className="text-bronze-light">نام</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="bg-black/40 border-primary/30 text-white"
                />
              </div>
              <div>
                <Label className="text-bronze-light">توضیح</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="bg-black/40 border-primary/30 text-white"
                />
              </div>
              <div>
                <Label className="text-bronze-light">دسته</Label>
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value as Ticket["category"] })
                  }
                  className="w-full h-10 rounded-md bg-black/40 border border-primary/30 text-white px-3"
                >
                  <option value="normal">عادی</option>
                  <option value="guided">با راهنما</option>
                  <option value="vip">VIP</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-bronze-light">قیمت (تومان)</Label>
                  <Input
                    type="number"
                    value={form.base_price}
                    onChange={(e) => setForm({ ...form, base_price: Number(e.target.value) })}
                    className="bg-black/40 border-primary/30 text-white"
                  />
                </div>
                <div>
                  <Label className="text-bronze-light">حداقل گروه</Label>
                  <Input
                    type="number"
                    value={form.group_min_count}
                    onChange={(e) => setForm({ ...form, group_min_count: Number(e.target.value) })}
                    className="bg-black/40 border-primary/30 text-white"
                  />
                </div>
                <div>
                  <Label className="text-bronze-light">تخفیف ٪</Label>
                  <Input
                    type="number"
                    value={form.group_discount_percent}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        group_discount_percent: Number(e.target.value),
                      })
                    }
                    className="bg-black/40 border-primary/30 text-white"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <Switch
                  checked={form.active}
                  onCheckedChange={(v) => setForm({ ...form, active: v })}
                />
                <Label className="text-bronze-light">فعال</Label>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                onClick={save}
                className="flex-1 rounded-xl text-primary-foreground"
                style={{ background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)" }}
              >
                ذخیره
              </Button>
              <Button
                variant="outline"
                onClick={() => setCreating(false)}
                className="rounded-xl border-primary/30 text-bronze-light !bg-transparent"
              >
                انصراف
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
