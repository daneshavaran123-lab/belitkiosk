import { type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ShoppingCart } from "lucide-react";
import { useCartStore } from "@/store/cartStore";
import museumBg from "@/assets/museum-hall-bg.jpg";
import federationLogo from "@/assets/federation-logo.png";

interface PageShellProps {
  title: string;
  backTo?: string;
  showCart?: boolean;
  children: ReactNode;
}

export function PageShell({ title, backTo = "/", showCart = true, children }: PageShellProps) {
  const navigate = useNavigate();
  const itemCount = useCartStore((s) => s.getItemCount());

  return (
    <div className="kiosk-root">
      <div
        className="fixed inset-0 z-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${museumBg})` }}
        aria-hidden
      />
      <div
        className="fixed inset-0 z-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(3,8,15,0.65) 0%, rgba(3,8,15,0.8) 50%, rgba(3,8,15,0.95) 100%)",
        }}
        aria-hidden
      />

      <header className="relative z-10 shrink-0 w-full flex items-center justify-between px-6 pt-6 max-w-6xl mx-auto">
        <button
          onClick={() => navigate({ to: backTo })}
          className="touch-btn glass-bronze rounded-2xl px-4 py-3 flex items-center gap-2 text-bronze-light hover:brightness-110 transition"
          aria-label="بازگشت"
        >
          <ArrowRight className="w-5 h-5" />
          <span className="font-bold">بازگشت</span>
        </button>

        <Link to="/" className="flex items-center gap-3 group">
          <img
            src={federationLogo}
            alt="نشان فدراسیون"
            className="w-14 h-14 object-contain drop-shadow-[0_0_20px_rgba(205,127,50,0.5)] group-hover:scale-105 transition"
          />
          <h1 className="hidden sm:block text-xl md:text-2xl font-black text-bronze-gradient">
            {title}
          </h1>
        </Link>

        {showCart ? (
          <button
            onClick={() => navigate({ to: "/cart" })}
            className="touch-btn glass-bronze rounded-2xl px-4 py-3 relative text-bronze-light hover:brightness-110 transition"
            aria-label="سبد خرید"
          >
            <ShoppingCart className="w-6 h-6" />
            {itemCount > 0 && (
              <span
                className="absolute -top-2 -right-2 min-w-[24px] h-6 px-1.5 rounded-full bg-red-500 text-white text-xs font-black flex items-center justify-center"
                style={{ boxShadow: "0 0 0 2px var(--museum-navy)" }}
              >
                {itemCount}
              </span>
            )}
          </button>
        ) : (
          <div className="w-[112px]" />
        )}
      </header>

      <h1 className="sm:hidden relative z-10 shrink-0 text-center text-2xl font-black text-bronze-gradient mt-4">
        {title}
      </h1>

      <main className="kiosk-body relative z-10 w-full">{children}</main>

      <footer className="relative z-10 shrink-0 text-center text-bronze-light/40 text-xs py-4">
        © فدراسیون کشتی جمهوری اسلامی ایران
      </footer>
    </div>
  );
}
