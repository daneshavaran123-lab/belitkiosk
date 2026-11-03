import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { KioskBackdrop } from "../components/KioskBackdrop";

function NotFoundComponent() {
  return (
    <div className="h-full relative flex items-center justify-center px-4">
      <KioskBackdrop dim="deep" />
      <div className="relative z-10 glass-bronze rounded-[2.5rem] max-w-md w-full p-10 text-center animate-scale-in">
        <h1 className="text-7xl font-black text-bronze-gradient">۴۰۴</h1>
        <h2 className="mt-4 text-2xl font-black text-white">صفحه پیدا نشد</h2>
        <p className="mt-2 text-white/70">صفحه‌ای که دنبالش بودید وجود ندارد یا جابه‌جا شده است.</p>
        <div className="mt-8">
          <Link
            to="/"
            className="touch-btn btn-liquid inline-flex items-center justify-center h-14 px-8 rounded-full text-lg font-black"
          >
            صفحهٔ اصلی
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="h-full relative flex items-center justify-center px-4">
      <KioskBackdrop dim="deep" />
      <div className="relative z-10 glass-bronze rounded-[2.5rem] max-w-md w-full p-10 text-center animate-scale-in">
        <h1 className="text-3xl font-black text-bronze-gradient">این صفحه باز نشد</h1>
        <p className="mt-3 text-white/75 leading-8">
          مشکلی پیش آمد. دوباره امتحان کنید یا به صفحهٔ اصلی برگردید.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="touch-btn btn-liquid inline-flex items-center justify-center h-14 px-8 rounded-full text-lg font-black"
          >
            تلاش دوباره
          </button>
          <a
            href="/"
            className="touch-btn glass-chip inline-flex items-center justify-center h-14 px-8 rounded-full text-lg font-black text-white"
          >
            صفحهٔ اصلی
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
      },
      { name: "theme-color", content: "#03080f" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "موزه کشتی" },

      { title: "موزه افتخارات کشتی ایران — Iran Wrestling Museum" },
      {
        name: "description",
        content:
          "پلتفرم رسمی فروش بلیط موزه افتخارات کشتی فدراسیون جمهوری اسلامی ایران — خرید آنلاین بلیط، فروشگاه، کافه و رویدادها.",
      },
      { name: "author", content: "Iran Wrestling Federation" },
      { property: "og:title", content: "موزه افتخارات کشتی ایران" },
      {
        property: "og:description",
        content: "خرید بلیط و خدمات موزه افتخارات کشتی جمهوری اسلامی ایران.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "icon", href: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },

      {
        rel: "preload",
        href: "/fonts/Vazirmatn-Variable.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
