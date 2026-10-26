import { createFileRoute } from "@tanstack/react-router";
import { Coffee } from "lucide-react";
import { SectionShopPage } from "@/components/SectionShopPage";

export const Route = createFileRoute("/cafe")({
  head: () => ({
    meta: [
      { title: "کافه موزه — موزه افتخارات کشتی ایران" },
      { name: "description", content: "کافه اختصاصی موزه با فضای آرام و اصیل." },
      { property: "og:title", content: "کافه موزه کشتی" },
      { property: "og:description", content: "لحظات دلنشین در کافه موزه." },
    ],
  }),
  component: () => (
    <SectionShopPage
      section="cafe"
      title="کافه موزه"
      fallbackIcon={Coffee}
      fallbackAccent="#fbbf24"
      cartType="product"
      emptyMessage="منوی کافه موزه به‌زودی راه‌اندازی می‌شود."
    />
  ),
});
