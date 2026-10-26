import { useEffect, useState, type ReactNode } from "react";
import { resolveProductImageUrl } from "@/lib/product-image";

interface Props {
  value: string | null | undefined;
  alt: string;
  className?: string;
  fallback?: ReactNode;
}

export function useResolvedProductImage(value: string | null | undefined) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    resolveProductImageUrl(value).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [value]);

  return src;
}

export function ProductImage({ value, alt, className, fallback = null }: Props) {
  const src = useResolvedProductImage(value);
  if (!value || !src) return <>{fallback}</>;
  return <img src={src} alt={alt} loading="lazy" className={className} />;
}
