import { supabase } from "@/integrations/supabase/client";

export const PRODUCT_IMAGE_BUCKET = "product-images";
const STORAGE_PREFIX = "storage:";
const SIGNED_TTL = 60 * 60 * 24 * 365; // یک سال

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const cache = new Map<string, string>();

export function isStorageRef(value: string | null | undefined): boolean {
  return !!value && value.startsWith(STORAGE_PREFIX);
}

export function storagePathOf(value: string): string {
  return value.slice(STORAGE_PREFIX.length);
}

/** آدرس قابل نمایش تصویر را برمی‌گرداند (لینک مستقیم یا لینک امضاشدهٔ استوریج) */
export async function resolveProductImageUrl(
  value: string | null | undefined,
): Promise<string | null> {
  if (!value) return null;
  if (!isStorageRef(value)) return value;
  const cached = cache.get(value);
  if (cached) return cached;
  const { data, error } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .createSignedUrl(storagePathOf(value), SIGNED_TTL);
  if (error || !data?.signedUrl) {
    console.error("[product-image] خطا در ساخت لینک تصویر:", error?.message);
    return null;
  }
  cache.set(value, data.signedUrl);
  return data.signedUrl;
}

function extOf(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

/** آپلود تصویر و برگرداندن مقدار قابل ذخیره در ستون image_url */
export async function uploadProductImage(file: File, section: string): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("فقط فایل JPG، PNG یا WebP مجاز است");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("حجم فایل باید کمتر از ۵ مگابایت باشد");
  }
  const path = `products/${section || "misc"}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${extOf(file)}`;
  const { error } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(path, file, { cacheControl: "31536000", upsert: false, contentType: file.type });
  if (error) throw new Error(error.message);
  return `${STORAGE_PREFIX}${path}`;
}

/** حذف فایل از استوریج (فقط برای مقادیر استوریجی) */
export async function deleteProductImage(value: string | null | undefined): Promise<void> {
  if (!isStorageRef(value)) return;
  cache.delete(value!);
  const { error } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .remove([storagePathOf(value!)]);
  if (error) console.error("[product-image] حذف فایل ناموفق:", error.message);
}
