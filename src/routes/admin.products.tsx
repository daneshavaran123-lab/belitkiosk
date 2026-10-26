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
import { ImageUploadField } from "@/components/ImageUploadField";
import { ProductImage } from "@/components/ProductImage";

export const Route = createFileRoute("/admin/products")({
  component: AdminProductsPage,
});

interface Product {
  id: number;
  section: string;
  name: string;
  description: string;
  price: number;
  icon: string;
  accent: string;
  image_url: string | null;
  active: boolean;
  sort_order: number;
}

const SECTIONS: { value: string; label: string }[] = [
  { value: "bookstore", label: "کتاب‌فروشی" },
  { value: "cafe", label: "کافه" },
  { value: "souvenirs", label: "سوغاتی" },
  { value: "membership", label: "عضویت" },
  { value: "events", label: "رویدادها" },
  { value: "support", label: "حمایت" },
];

const empty: Omit<Product, "id"> = {
  section: "bookstore",
  name: "",
  description: "",
  price: 0,
  icon: "Package",
  accent: "#cd7f32",
  image_url: null,
  active: true,
  sort_order: 0,
};

const fmt = (n: number) => formatNumber(n);

function AdminProductsPage() {
  const [rows, setRows] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Omit<Product, "id">>(empty);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("section")
      .order("sort_order")
      .order("id");
    if (error) toast.error(error.message);
    setRows((data as Product[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(empty);
    setOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      section: p.section,
      name: p.name,
      description: p.description,
      price: p.price,
      icon: p.icon,
      accent: p.accent,
      image_url: p.image_url ?? null,
      active: p.active,
      sort_order: p.sort_order,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("نام لازم است");
    if (editing) {
      const { error } = await supabase.from("products").update(form).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("ذخیره شد");
    } else {
      const { error } = await supabase.from("products").insert(form);
      if (error) return toast.error(error.message);
      toast.success("محصول جدید ثبت شد");
    }
    setOpen(false);
    load();
  };

  const remove = async (id: number) => {
    if (!confirm("حذف این محصول؟")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("حذف شد");
    load();
  };

  const filtered = filter === "all" ? rows : rows.filter((r) => r.section === filter);

  return (
    <div className="space-y-6">
      <Toaster position="top-center" richColors />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-black text-bronze-gradient">مدیریت محصولات</h2>
        <Button
          onClick={openCreate}
          className="rounded-xl text-primary-foreground"
          style={{ background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)" }}
        >
          <Plus className="w-4 h-4 ml-1" /> محصول جدید
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1.5 rounded-full text-sm font-bold ${
            filter === "all"
              ? "bg-primary text-primary-foreground"
              : "glass border border-primary/25 text-bronze-light"
          }`}
        >
          همه
        </button>
        {SECTIONS.map((s) => (
          <button
            key={s.value}
            onClick={() => setFilter(s.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-bold ${
              filter === s.value
                ? "bg-primary text-primary-foreground"
                : "glass border border-primary/25 text-bronze-light"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-bronze-light/60">در حال بارگذاری...</p>
      ) : (
        <div className="overflow-x-auto glass-bronze rounded-2xl">
          <table className="w-full text-right">
            <thead className="border-b border-primary/20 text-bronze-light/70 text-sm">
              <tr>
                <th className="p-4">تصویر</th>
                <th className="p-4">نام</th>
                <th className="p-4">بخش</th>
                <th className="p-4">قیمت</th>
                <th className="p-4">وضعیت</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody className="text-white">
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-primary/10 hover:bg-white/5">
                  <td className="p-4">
                    <ProductImage
                      value={r.image_url}
                      alt={r.name}
                      className="w-12 h-12 rounded-lg object-cover"
                      fallback={
                        <div className="w-12 h-12 rounded-lg bg-white/5 border border-primary/20" />
                      }
                    />
                  </td>
                  <td className="p-4 font-bold">{r.name}</td>
                  <td className="p-4 text-bronze-light/70">
                    {SECTIONS.find((s) => s.value === r.section)?.label ?? r.section}
                  </td>
                  <td className="p-4">{fmt(r.price)} تومان</td>
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
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-bronze-light/50">
                    محصولی یافت نشد
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur flex items-center justify-center p-4">
          <div className="glass-bronze rounded-3xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-black text-bronze-gradient">
                {editing ? "ویرایش محصول" : "محصول جدید"}
              </h3>
              <button
                onClick={() => setOpen(false)}
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-bronze-light">بخش</Label>
                  <select
                    value={form.section}
                    onChange={(e) => setForm({ ...form, section: e.target.value })}
                    className="w-full h-10 rounded-md bg-black/40 border border-primary/30 text-white px-3"
                  >
                    {SECTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-bronze-light">قیمت (تومان)</Label>
                  <Input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
                    className="bg-black/40 border-primary/30 text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-bronze-light">آیکن (نام lucide)</Label>
                  <Input
                    value={form.icon}
                    onChange={(e) => setForm({ ...form, icon: e.target.value })}
                    placeholder="BookOpen, Coffee, Medal, Gem, ..."
                    className="bg-black/40 border-primary/30 text-white"
                    dir="ltr"
                  />
                </div>
                <div>
                  <Label className="text-bronze-light">رنگ</Label>
                  <div className="flex gap-2 items-center">
                    <Input
                      value={form.accent}
                      onChange={(e) => setForm({ ...form, accent: e.target.value })}
                      className="bg-black/40 border-primary/30 text-white flex-1"
                      dir="ltr"
                    />
                    <input
                      type="color"
                      value={form.accent}
                      onChange={(e) => setForm({ ...form, accent: e.target.value })}
                      className="w-10 h-10 rounded cursor-pointer bg-transparent border border-primary/30"
                    />
                  </div>
                </div>
              </div>
              <ImageUploadField
                value={form.image_url}
                section={form.section}
                onChange={(v) => setForm({ ...form, image_url: v })}
              />
              <div>
                <Label className="text-bronze-light">ترتیب نمایش</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                  className="bg-black/40 border-primary/30 text-white"
                />
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
                onClick={() => setOpen(false)}
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
