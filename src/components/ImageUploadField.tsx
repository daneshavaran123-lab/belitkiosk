import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { uploadProductImage } from "@/lib/product-image";
import { useResolvedProductImage } from "@/components/ProductImage";

interface Props {
  value: string | null;
  section: string;
  onChange: (value: string | null) => void;
}

export function ImageUploadField({ value, section, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const preview = useResolvedProductImage(value);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const ref = await uploadProductImage(file, section);
      onChange(ref);
      toast.success("تصویر بارگذاری شد");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "بارگذاری ناموفق بود");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <Label className="text-bronze-light">تصویر محصول</Label>
      <div className="flex items-center gap-3">
        <div className="w-20 h-20 rounded-xl overflow-hidden border border-primary/25 bg-black/40 flex items-center justify-center shrink-0">
          {preview ? (
            <img src={preview} alt="پیش‌نمایش" className="w-full h-full object-cover" />
          ) : (
            <ImagePlus className="w-6 h-6 text-bronze-light/40" />
          )}
        </div>
        <div className="flex flex-col gap-2 flex-1">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="rounded-xl border-primary/30 text-bronze-light !bg-transparent"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 ml-1 animate-spin" />
              ) : (
                <ImagePlus className="w-4 h-4 ml-1" />
              )}
              انتخاب تصویر
            </Button>
            {value && (
              <Button
                type="button"
                variant="outline"
                onClick={() => onChange(null)}
                className="rounded-xl border-red-400/30 text-red-300 !bg-transparent"
              >
                <Trash2 className="w-4 h-4 ml-1" /> حذف
              </Button>
            )}
          </div>
          <p className="text-xs text-bronze-light/50">JPG / PNG / WebP — حداکثر ۵ مگابایت</p>
        </div>
      </div>
      <Input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value.trim() ? e.target.value : null)}
        placeholder="یا آدرس تصویر (https://...)"
        dir="ltr"
        className="bg-black/40 border-primary/30 text-white"
      />
    </div>
  );
}
