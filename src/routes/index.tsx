import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCartStore } from "@/store/cartStore";
import { ShoppingCart, Globe, Ticket, Settings } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { KioskBackdrop } from "@/components/KioskBackdrop";
import { formatNumber } from "@/lib/money";

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
  {
    label: "فروشگاه کتاب",
    icon: iconBooks,
    from: "#1e3a8a",
    to_color: "#0c4a6e",
    glow: "#3b82f6",
    to: "/bookstore",
  },
  {
    label: "کافه موزه",
    icon: iconCoffee,
    from: "#78350f",
    to_color: "#451a03",
    glow: "#f59e0b",
    to: "/cafe",
  },
  {
    label: "فروشگاه یادبود",
    icon: iconMedal,
    from: "#065f46",
    to_color: "#022c22",
    glow: "#10b981",
    to: "/souvenirs",
  },
  {
    label: "عضویت سالانه",
    icon: iconGem,
    from: "#581c87",
    to_color: "#3b0764",
    glow: "#a855f7",
    to: "/membership",
  },
  {
    label: "رویدادها",
    icon: iconCastle,
    from: "#1e3a8a",
    to_color: "#0f172a",
    glow: "#60a5fa",
    to: "/events",
  },
  {
    label: "حمایت و نظرسنجی",
    icon: iconHeart,
    from: "#7f1d1d",
    to_color: "#450a0a",
    glow: "#ef4444",
    to: "/support",
  },
];

function Home() {
  const navigate = useNavigate();
  const itemCount = useCartStore((s) => s.getItemCount());

  return (
    <div className="kiosk-root">
      <KioskBackdrop dim="soft" />

      <Toaster position="top-center" richColors />

      {/* Top bar */}
      <header className="relative z-10 shrink-0 w-full max-w-6xl mx-auto px-5 pt-5">
        <div className="flex items-center justify-between">
          <button
            onClick={() => toast("به‌زودی به دو زبان در دسترس خواهد بود")}
            className="touch-btn glass rounded-full h-14 px-6 flex items-center gap-2 text-white font-bold hover:brightness-125"
            aria-label="تغییر زبان"
          >
            <Globe className="w-5 h-5" />
            <span>EN</span>
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate({ to: "/cart" })}
              className="touch-btn glass rounded-full h-14 w-14 relative flex items-center justify-center text-white hover:brightness-125"
              aria-label="سبد خرید"
            >
              <ShoppingCart className="w-6 h-6" />
              {itemCount > 0 && (
                <span
                  className="btn-liquid absolute -top-1.5 -right-1.5 min-w-[1.6rem] h-[1.6rem] px-1.5 rounded-full text-xs font-black flex items-center justify-center animate-pop-in"
                  style={{ boxShadow: "0 0 0 2px rgba(3,8,15,0.9), 0 6px 14px rgba(0,0,0,0.4)" }}
                >
                  {formatNumber(itemCount)}
                </span>
              )}
            </button>
            <button
              onClick={() => navigate({ to: "/admin/login" })}
              title="ورود به پنل مدیریت"
              aria-label="ورود به پنل مدیریت"
              className="touch-btn glass rounded-full h-14 w-14 flex items-center justify-center text-white/70 hover:text-white hover:rotate-45 transition-all duration-500"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="kiosk-body relative z-10 w-full flex flex-col justify-start">
        {/* Hero: logo & title */}
        <section className="relative z-10 flex flex-col items-center text-center pt-2 pb-6 px-6">
          <div className="relative">
            <span
              className="absolute inset-[-14%] rounded-full animate-ring-pulse border border-[#e0a572]/40"
              aria-hidden
            />
            <img
              src={federationLogo}
              alt="نشان فدراسیون کشتی جمهوری اسلامی ایران"
              width={1024}
              height={1024}
              className="relative w-32 h-32 md:w-44 md:h-44 object-contain drop-shadow-[0_0_44px_rgba(235,150,60,0.6)]"
            />
          </div>
          <h1 className="mt-4 text-4xl md:text-5xl font-black text-bronze-gradient tracking-tight">
            موزه کشتی ایران
          </h1>
          <p className="mt-2 text-sm md:text-base tracking-[0.3em] text-white/60 font-medium">
            IRAN WRESTLING MUSEUM
          </p>
          <div
            className="mt-4 h-px w-40"
            style={{ background: "linear-gradient(90deg, transparent, #e0a572, transparent)" }}
          />
        </section>

        {/* Featured ticket card */}
        <section className="relative z-10 w-full max-w-4xl mx-auto px-6">
          <div className="glass-bronze rounded-[2.5rem] p-6 md:p-10 flex flex-col md:flex-row-reverse items-center gap-6 md:gap-10 animate-fade-in-up">
            <div className="shrink-0">
              <img
                src={ticketHero}
                alt="بلیط موزه"
                width={1024}
                height={1024}
                className="w-44 h-44 md:w-60 md:h-60 object-contain drop-shadow-[0_24px_60px_rgba(235,150,60,0.55)]"
              />
            </div>
            <div className="flex-1 text-right">
              <h2 className="text-5xl md:text-6xl font-black text-bronze-gradient leading-tight">
                فروش بلیط
              </h2>
              <p className="mt-3 text-white/75 text-lg font-medium">
                همین امروز بازدید خود را آغاز کنید.
              </p>
              <Link
                to="/tickets"
                className="touch-btn btn-liquid relative overflow-hidden mt-6 inline-flex items-center gap-3 px-10 h-[4.5rem] rounded-full text-xl font-black hover:brightness-105"
              >
                <span
                  className="pointer-events-none absolute inset-y-0 w-1/4 bg-white/45 blur-md"
                  style={{ animation: "sheen-sweep 3.6s ease-in-out 1.2s infinite" }}
                  aria-hidden
                />
                <Ticket className="w-7 h-7" />
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
                className="touch-btn group relative rounded-[2rem] p-6 flex flex-col items-center justify-center gap-3 aspect-[4/3] overflow-hidden hover:-translate-y-1 hover:brightness-110 animate-fade-in-up"
                style={{
                  background: `radial-gradient(130% 90% at 50% 0%, ${t.glow}45, transparent 62%), linear-gradient(150deg, ${t.from}b0, ${t.to_color}a0)`,
                  WebkitBackdropFilter: "blur(24px) saturate(1.7)",
                  backdropFilter: "blur(24px) saturate(1.7)",
                  boxShadow: `inset 1px 1.5px 0 rgba(255,255,255,0.5), inset -1px -1px 0 ${t.glow}55, inset 0 0 44px ${t.glow}28, 0 26px 44px -16px rgba(0,0,0,0.7)`,
                  animationDelay: `${i * 70}ms`,
                  border: `1px solid ${t.glow}55`,
                }}
              >
                <span
                  className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent"
                  aria-hidden
                />
                <img
                  src={t.icon}
                  alt=""
                  loading="lazy"
                  width={512}
                  height={512}
                  className="relative w-16 h-16 md:w-20 md:h-20 object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,0.55)] group-hover:scale-110 transition-transform duration-300"
                />
                <span className="relative text-white font-extrabold text-base md:text-lg text-center">
                  {t.label}
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <footer className="relative z-10 shrink-0 text-center text-white/40 text-xs py-4">
        © فدراسیون کشتی جمهوری اسلامی ایران
      </footer>
    </div>
  );
}
