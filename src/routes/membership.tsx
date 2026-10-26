import { createFileRoute } from "@tanstack/react-router";
import { Gem } from "lucide-react";
import { SectionShopPage } from "@/components/SectionShopPage";

export const Route = createFileRoute("/membership")({
  head: () => ({
    meta: [
      { title: "عضویت سالانه — موزه افتخارات کشتی ایران" },
      { name: "description", content: "عضویت ویژه موزه با مزایای اختصاصی." },
      { property: "og:title", content: "عضویت سالانه موزه کشتی" },
      { property: "og:description", content: "بازدید نامحدود و رویدادهای اختصاصی." },
    ],
  }),
  component: () => (
    <SectionShopPage
      section="membership"
      title="عضویت سالانه"
      fallbackIcon={Gem}
      fallbackAccent="#c084fc"
      cartType="membership"
      emptyMessage="سطوح عضویت به‌زودی معرفی می‌شود."
    />
  ),
});
