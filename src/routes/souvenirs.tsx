import { createFileRoute } from "@tanstack/react-router";
import { Medal } from "lucide-react";
import { SectionShopPage } from "@/components/SectionShopPage";

export const Route = createFileRoute("/souvenirs")({
  head: () => ({
    meta: [
      { title: "فروشگاه یادبود — موزه افتخارات کشتی ایران" },
      { name: "description", content: "هدایا و یادگاری‌های اختصاصی موزه کشتی." },
      { property: "og:title", content: "فروشگاه یادبود موزه کشتی" },
      { property: "og:description", content: "یادگاری‌های به‌یادماندنی از موزه." },
    ],
  }),
  component: () => (
    <SectionShopPage
      section="souvenirs"
      title="فروشگاه یادبود"
      fallbackIcon={Medal}
      fallbackAccent="#34d399"
      cartType="product"
      emptyMessage="اقلام یادبود موزه به‌زودی عرضه می‌شود."
    />
  ),
});
