import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { SectionShopPage } from "@/components/SectionShopPage";

export const Route = createFileRoute("/events")({
  head: () => ({
    meta: [
      { title: "رویدادها — موزه افتخارات کشتی ایران" },
      { name: "description", content: "برنامه رویدادها و همایش‌های موزه کشتی." },
      { property: "og:title", content: "رویدادهای موزه کشتی" },
      { property: "og:description", content: "همایش‌ها، مسابقات و برنامه‌های ویژه." },
    ],
  }),
  component: () => (
    <SectionShopPage
      section="events"
      title="رویدادها"
      fallbackIcon={CalendarDays}
      fallbackAccent="#60a5fa"
      cartType="event"
      emptyMessage="رویدادهای پیش‌رو به‌زودی اعلام می‌شود."
    />
  ),
});
