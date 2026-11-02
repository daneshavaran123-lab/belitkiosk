import { createFileRoute } from "@tanstack/react-router";

import { resolveWindowsDownloadUrl } from "@/lib/windows-download";

// لینک ثابت دانلود نسخهٔ ویندوزی روی همین سرور؛ به فایل اصلی (WINDOWS_DOWNLOAD_URL یا آخرین
// Release گیت‌هاب) هدایت می‌کند تا با انتشار نسخهٔ جدید، لینک عوض نشود.
export const Route = createFileRoute("/api/download/windows")({
  server: {
    handlers: {
      GET: () => toDownload(),
      HEAD: () => toDownload(),
    },
  },
});

function toDownload() {
  return new Response(null, {
    status: 302,
    headers: {
      location: resolveWindowsDownloadUrl(process.env["WINDOWS_DOWNLOAD_URL"]),
      "cache-control": "no-store",
    },
  });
}
