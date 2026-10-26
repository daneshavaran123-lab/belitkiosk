import { createFileRoute } from "@tanstack/react-router";

import { buildHealthPayload } from "./public/health";

// alias سادهٔ /api/health برای healthCheck لیارا و مانیتورینگ
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(await buildHealthPayload(), { headers: { "cache-control": "no-store" } }),
      HEAD: async () =>
        new Response(null, { status: 200, headers: { "cache-control": "no-store" } }),
    },
  },
});
