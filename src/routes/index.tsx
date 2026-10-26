import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCartStore } from "@/store/cartStore";
import { ShoppingCart, Globe, Ticket, Settings } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

import museumBg from "@/assets/museum-hall-bg.jpg";
import federationLogo from "@/assets/federation-logo.png";
import ticketHero from "@/assets/ticket-hero.png";
import iconBooks from "@/assets/icon-books.png";
import iconCoffee from "@/assets/icon-coffee.png";
import iconMedal from "@/assets/icon-medal.png";
import iconGem from "@/assets/icon-gem.png";
import iconCastle from "@/assets/icon-castle.png";
import iconHeart from "@/assets/icon-heart.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "موزه افتخارات کشتی ایران — خرید بلیط آنلاین" },
      {
        name: "description",
        content:
          "خرید آنلاین بلیط موزه افتخارات کشتی، بازدید از تاریخ زرین کشتی ایران، فروشگاه یادبود، کافه و رویدادها.",
      },
      { property: "og:title", content: "موزه افتخارات کشتی ایران" },
      { property: "og:description", content: "پلتفرم رسمی خرید بلیط موزه افتخارات کشتی." },
    ],
  }),
  component: Home,
});

type TileRoute = "/bookstore" | "/cafe" | "/souvenirs" | "/membership" | "/events" | "/support";

interface Tile {
  label: string;
  icon: string;
  from: string;
  to_color: string;
  glow: string;
  to: TileRoute;
}

const TILES: Tile[] = [
  { label: "فروشگاه کتاب", icon: iconBooks, from: "#1e3a8a", to_color: "#0c4a6e", glow: "#3b82f6", to: "/bookstore" },
  { label: "کافه موزه", icon: iconCoffee, from: "#78350f", to_color: "#451a03", glow: "#f59e0b", to: "/cafe" },
  { label: "فروشگاه یادبود", icon: iconMedal, from: "#065f46", to_color: "#022c22", glow: "#10b981", to: "/souvenirs" },
  { label: "عضویت سالانه", icon: iconGem, from: "#581c87", to_color: "#3b0764", glow: "#a855f7", to: "/membership" },
  { label: "رویدادها", icon: iconCastle, from: "#1e3a8a", to_color: "#0f172a", glow: "#60a5fa", to: "/events" },
  { label: "حمایت و نظرسنجی", icon: iconHeart, from: "#7f1d1d", to_color: "#450a0a", glow: "#ef4444", to: "/support" },
];

function Home() {
  const navigate = useNavigate();
  const itemCount = useCartStore((s) => s.getItemCount());

  return (
    <div className="kiosk-root">
      {/* Museum hall background */}
      <div
        className="fixed inset-0 z-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${museumBg})` }}
        aria-hidden
      />
      <div
        className="fixed inset-0 z-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(3,8,15,0.55) 0%, rgba(3,8,15,0.7) 50%, rgba(3,8,15,0.9) 100%)",
        }}
        aria-hidden
      />

      <Toaster position="top-center" richColors />

      {/* Top bar */}
      <header className="relative z-10 shrink-0 w-full flex items-center justify-between px-6 pt-6 max-w-6xl mx-auto">
        <button
          onClick={() => toast("به‌زودی به دو زبان در دسترس خواهد بود")}
          className="touch-btn glass-bronze rounded-2xl px-4 py-3 flex items-center gap-2 text-bronze-light hover:brightness-110 transition"
          aria-label="تغییر زبان"
        >
          <Globe className="w-5 h-5" />
          <span className="font-bold">EN</span>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate({ to: "/admin/login" })}
            title="ورود به پنل مدیریت"
            aria-label="ورود به پنل مدیریت"
            className="touch-btn glass-bronze rounded-2xl p-3 text-bronze-light hover:brightness-110 hover:rotate-45 transition-all duration-500"
          >
            <Settings className="w-5 h-5" />
          </button>
        <button
          onClick={() => navigate({ to: "/cart" })}
          className="touch-btn glass-bronze rounded-2xl px-4 py-3 relative text-bronze-light hover:brightness-110 transition"
          aria-label="سبد خرید"
        >
          <ShoppingCart className="w-6 h-6" />
          {itemCount > 0 && (
            <span
              className="absolute -top-2 -right-2 min-w-[24px] h-6 px-1.5 rounded-full bg-red-500 text-white text-xs font-black flex items-center justify-center ring-2"
              style={{ boxShadow: "0 0 0 2px var(--museum-navy)" }}
            >
              {itemCount}
            </span>
          )}
        </button>
        </div>
      </header>

      <div className="kiosk-body relative z-10 w-full flex flex-col justify-start">
      {/* Hero: logo & title */}
      <section className="relative z-10 flex flex-col items-center text-center pt-4 pb-6 px-6">
        <img
          src={federationLogo}
          alt="نشان فدراسیون کشتی جمهوری اسلامی ایران"
          width={1024}
          height={1024}
          className="w-32 h-32 md:w-44 md:h-44 object-contain drop-shadow-[0_0_40px_rgba(205,127,50,0.5)]"
        />
        <h1 className="mt-4 text-4xl md:text-5xl font-black text-bronze-gradient tracking-tight">
          موزه کشتی ایران
        </h1>
        <p className="mt-2 text-sm md:text-base tracking-[0.3em] text-bronze-light/70 font-medium">
          IRAN WRESTLING MUSEUM
        </p>
        <div className="mt-3 w-2 h-2 rotate-45" style={{ background: "#cd7f32" }} />
      </section>

      {/* Featured ticket card */}
      <section className="relative z-10 w-full max-w-4xl mx-auto px-6">
        <div className="glass-bronze rounded-[32px] p-6 md:p-10 flex flex-col md:flex-row-reverse items-center gap-6 md:gap-10 animate-fade-in-up">
          <div className="shrink-0">
            <img
              src={ticketHero}
              alt="بلیط موزه"
              width={1024}
              height={1024}
              className="w-44 h-44 md:w-60 md:h-60 object-contain drop-shadow-[0_20px_60px_rgba(205,127,50,0.45)]"
            />
          </div>
          <div className="flex-1 text-right">
            <h2 className="text-5xl md:text-6xl font-black text-bronze-gradient leading-tight">
              فروش بلیط
            </h2>
            <p className="mt-3 text-bronze-light/70 text-lg font-medium">
              همین امروز بازدید خود را آغاز کنید.
            </p>
            <Link
              to="/tickets"
              className="touch-btn mt-6 inline-flex items-center gap-3 px-8 py-4 rounded-full text-lg font-black text-primary-foreground shadow-2xl transition-all hover:brightness-110 hover:-translate-y-0.5"
              style={{
                background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)",
                boxShadow: "0 10px 30px rgba(205,127,50,0.35)",
              }}
            >
              <Ticket className="w-6 h-6" />
              خرید بلیط
            </Link>
          </div>
        </div>
      </section>

      {/* Category grid */}
      <section className="relative z-10 w-full max-w-4xl mx-auto px-6 py-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {TILES.map((t, i) => (
            <Link
              key={t.label}
              to={t.to}
              className="touch-btn group relative rounded-3xl p-6 flex flex-col items-center justify-center gap-3 aspect-[4/3] overflow-hidden transition-all hover:-translate-y-1 animate-fade-in-up"
              style={{
                background: `linear-gradient(135deg, ${t.from}, ${t.to_color})`,
                boxShadow: `0 12px 30px rgba(0,0,0,0.35), inset 0 0 40px ${t.glow}22`,
                animationDelay: `${i * 60}ms`,
                border: `1px solid ${t.glow}33`,
              }}
            >
              <img
                src={t.icon}
                alt=""
                loading="lazy"
                width={512}
                height={512}
                className="w-16 h-16 md:w-20 md:h-20 object-contain drop-shadow-[0_6px_18px_rgba(0,0,0,0.5)]"
              />
              <span className="text-white font-extrabold text-base md:text-lg text-center">
                {t.label}
              </span>
            </Link>
          ))}
        </div>
      </section>
      </div>

      <footer className="relative z-10 shrink-0 text-center text-bronze-light/40 text-xs py-4">
        © فدراسیون کشتی جمهوری اسلامی ایران
      </footer>
    </div>
  );
}
