import { type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ShoppingCart } from "lucide-react";
import { useCartStore } from "@/store/cartStore";
import { formatNumber } from "@/lib/money";
import { KioskBackdrop } from "@/components/KioskBackdrop";
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
      <KioskBackdrop dim="normal" />

      <header className="relative z-10 shrink-0 w-full max-w-6xl mx-auto px-5 pt-5">
        <div className="glass rounded-[2rem] px-3 py-3 flex items-center justify-between gap-3">
          <button
            onClick={() => navigate({ to: backTo })}
            className="touch-btn glass-chip rounded-full h-14 px-6 flex items-center gap-2 text-white font-bold hover:brightness-125"
            aria-label="بازگشت"
          >
            <ArrowRight className="w-5 h-5" />
            <span>بازگشت</span>
          </button>

          <Link to="/" className="flex items-center gap-3 min-w-0 group touch-btn">
            <img
              src={federationLogo}
              alt="نشان فدراسیون"
              className="w-14 h-14 object-contain drop-shadow-[0_0_18px_rgba(205,127,50,0.6)] group-hover:scale-105 transition"
            />
            <h1 className="hidden sm:block text-xl md:text-2xl font-black text-bronze-gradient truncate">
              {title}
            </h1>
          </Link>

          {showCart ? (
            <button
              onClick={() => navigate({ to: "/cart" })}
              className="touch-btn glass-chip rounded-full h-14 w-14 relative flex items-center justify-center text-white hover:brightness-125"
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
          ) : (
            <div className="w-14" />
          )}
        </div>
      </header>

      <h1 className="sm:hidden relative z-10 shrink-0 text-center text-2xl font-black text-bronze-gradient mt-4">
        {title}
      </h1>

      <main className="kiosk-body relative z-10 w-full">{children}</main>

      <footer className="relative z-10 shrink-0 text-center text-white/40 text-xs py-4">
        © فدراسیون کشتی جمهوری اسلامی ایران
      </footer>
    </div>
  );
}
