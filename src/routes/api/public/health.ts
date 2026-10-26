import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () => Response.json(await buildHealthPayload(), { headers: NO_STORE }),
      HEAD: async () => new Response(null, { status: 200, headers: NO_STORE }),
    },
  },
});

const NO_STORE = { "cache-control": "no-store" };

export async function buildHealthPayload() {
  const startedAt = Date.now();
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];

  let db: "ok" | "down" | "unconfigured" = "unconfigured";
  if (url && key) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${url}/auth/v1/health`, {
        headers: { apikey: key },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      // هر پاسخ HTTP یعنی سرویس در دسترس است؛ فقط خطای شبکه «down» است.
      db = res.status < 500 ? "ok" : "down";
    } catch {
      db = "down";
    }
  }

  return {
    status: db === "down" ? "degraded" : "ok",
    app: "iran-wrestling-museum-kiosk",
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime?.() ?? 0),
    nodeEnv: process.env["NODE_ENV"] ?? "unknown",
    port: process.env["PORT"] ?? null,
    host: process.env["HOST"] ?? null,
    db,
    checkDurationMs: Date.now() - startedAt,
  };
}
