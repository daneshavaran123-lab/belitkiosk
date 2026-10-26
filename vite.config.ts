// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // خروجی build خارج از لاولیبل به‌صورت «سرور Node» ساخته می‌شود (برای لیارا و مشابه آن).
  // داخل بیلد لاولیبل، LOVABLE_NITRO_PRESET اولویت دارد و این مقدار نادیده گرفته می‌شود.
  nitro: { preset: process.env["NITRO_PRESET"] ?? "node_server" },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
