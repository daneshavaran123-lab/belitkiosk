import { createFileRoute } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { SectionShopPage } from "@/components/SectionShopPage";

export const Route = createFileRoute("/bookstore")({
  head: () => ({
    meta: [
      { title: "فروشگاه کتاب — موزه افتخارات کشتی ایران" },
      { name: "description", content: "کتاب‌ها و منابع تخصصی تاریخ کشتی ایران." },
      { property: "og:title", content: "فروشگاه کتاب موزه کشتی" },
      { property: "og:description", content: "کتاب‌های تاریخ و افتخارات کشتی ایران." },
    ],
  }),
  component: () => (
    <SectionShopPage
      section="bookstore"
      title="فروشگاه کتاب"
      fallbackIcon={BookOpen}
      fallbackAccent="#60a5fa"
      cartType="product"
      emptyMessage="مجموعه کتاب‌های تخصصی کشتی ایران به‌زودی در دسترس قرار می‌گیرد."
    />
  ),
});
