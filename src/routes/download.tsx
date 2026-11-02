import { createFileRoute } from "@tanstack/react-router";
import { Download, Monitor } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { WINDOWS_DOWNLOAD_PATH } from "@/lib/windows-download";

// صفحهٔ عمومی دانلود نسخهٔ ویندوزی؛ ورود به پنل مدیریت لازم نیست
export const Route = createFileRoute("/download")({
  head: () => ({
    meta: [{ title: "دانلود نسخهٔ ویندوزی — موزه کشتی" }, { name: "robots", content: "noindex" }],
  }),
  component: DownloadPage,
});

function DownloadPage() {
  return (
    <PageShell title="نسخهٔ ویندوزی" showCart={false}>
      <section className="max-w-xl mx-auto px-6 py-10">
        <div className="glass-bronze rounded-3xl p-8 space-y-6 animate-fade-in-up">
          <div className="text-center">
            <div
              className="w-20 h-20 rounded-full mx-auto flex items-center justify-center"
              style={{
                background: "radial-gradient(circle at 30% 30%, #f5c98a, #cd7f32 55%, #8b5a2b)",
              }}
            >
              <Monitor className="w-10 h-10 text-[#03080f]" strokeWidth={2.2} />
            </div>
            <h2 className="mt-4 text-2xl font-black text-bronze-gradient">
              نسخهٔ ویندوزی کیوسک موزه
            </h2>
            <p className="text-bronze-light/70 text-sm mt-1 font-medium">
              برنامهٔ کیوسک، سرویس کارت‌خوان و نصب‌کننده در یک فایل zip — ویندوز ۱۰ یا ۱۱ (۶۴ بیتی)
            </p>
          </div>

          {/* target=_blank تا داخل برنامهٔ ویندوزی هم در مرورگر پیش‌فرض باز شود */}
          <a
            href={WINDOWS_DOWNLOAD_PATH}
            target="_blank"
            rel="noopener"
            className="touch-btn w-full h-14 text-lg font-black rounded-2xl text-primary-foreground flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #f5c98a, #cd7f32 40%, #8b5a2b)" }}
          >
            <Download className="w-5 h-5" /> دانلود آخرین نسخه
          </a>

          <ol className="list-decimal pr-5 space-y-3 text-sm text-bronze-light/85 leading-7">
            <li>فایل zip را روی کامپیوتر کیوسک دانلود و باز (Extract) کنید.</li>
            <li>
              روی <code dir="ltr">install-windows.bat</code> راست‌کلیک کنید و{" "}
              <bdi className="font-bold">Run as administrator</bdi> را بزنید.
            </li>
            <li>
              نصب‌کننده توکن کارت‌خوان را خودش می‌سازد و رمز متصدی برای پرداخت نقدی را می‌پرسد
              (اختیاری؛ با Enter رد شوید). پنل مدیریت لازم نیست.
            </li>
            <li>
              اگر IP کارت‌خوان با <code dir="ltr">192.168.16.160</code> فرق دارد، آن را در فایل{" "}
              <code dir="ltr">pos-bridge\bin\Release\net48\appsettings.json</code> عوض کنید و ویندوز
              را ری‌استارت کنید.
            </li>
            <li>
              برنامه با میان‌بر «موزه کشتی» روی دسکتاپ و خودکار با روشن شدن ویندوز اجرا می‌شود.
            </li>
          </ol>
        </div>
      </section>
    </PageShell>
  );
}
