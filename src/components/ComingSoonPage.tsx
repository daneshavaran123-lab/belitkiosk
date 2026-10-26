import { PageShell } from "@/components/PageShell";
import { Link } from "@tanstack/react-router";
import { Ticket, type LucideIcon } from "lucide-react";

interface Props {
  title: string;
  icon: LucideIcon;
  description: string;
  accent: string;
}

export function ComingSoonPage({ title, icon: Icon, description, accent }: Props) {
  return (
    <PageShell title={title}>
      <section className="max-w-2xl mx-auto px-6 py-10">
        <div className="glass-bronze rounded-3xl p-10 text-center space-y-6 animate-fade-in-up relative overflow-hidden">
          <div
            className="absolute top-0 inset-x-0 h-1"
            style={{ background: `linear-gradient(90deg, ${accent}, #cd7f32)` }}
          />
          <div
            className="w-28 h-28 mx-auto rounded-full flex items-center justify-center shadow-2xl"
            style={{
              background: `radial-gradient(circle at 30% 30%, ${accent}, #cd7f32 60%, #8b5a2b)`,
              boxShadow: `0 15px 40px ${accent}55`,
            }}
          >
            <Icon className="w-14 h-14 text-[#03080f]" strokeWidth={2.2} />
          </div>
          <h2 className="text-4xl font-black text-bronze-gradient">{title}</h2>
          <p className="text-bronze-light/70 text-lg font-medium leading-relaxed">
            {description}
          </p>
          <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full glass border border-primary/30 text-bronze-light font-bold text-sm">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            به‌زودی راه‌اندازی می‌شود
          </div>
          <div className="pt-2">
            <Link
              to="/tickets"
              className="touch-btn inline-flex items-center gap-2 h-12 px-6 rounded-full text-primary-foreground font-black"
              style={{
                background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)",
              }}
            >
              <Ticket className="w-4 h-4" />
              خرید بلیط بازدید
            </Link>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
