# Implementation Plan: گزارش فروش روزانه برای مدیر (Daily Sales Report)

**Branch**: `001-daily-sales-report` (روی شاخهٔ `claude/pensive-gates-9lbk8e`) | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-daily-sales-report/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

مدیر در پنل یک صفحهٔ «گزارش روزانه» دارد: روز را با تقویم شمسی انتخاب می‌کند و جمع فروش کارتی و
نقدی، تعداد بلیط به تفکیک نوع و تراکنش‌های کارتی نیازمند بررسی را می‌بیند و روی A4 چاپ می‌کند.

رویکرد فنی:

- **محاسبه**: یک تابع دیتابیس `SECURITY INVOKER` (`daily_sales_report`) با مرز روز به وقت تهران.
- **شمارش بلیط**: ثبت نوع آیتم و شناسهٔ نوع بلیط در هر ردیف فاکتور.
- **همگام‌سازی**: سرویس کارت‌خوان هر ۶۰ ثانیه، با کلید اختصاصی کیوسک (فقط هش آن در سرور)،
  تراکنش‌های نیازمند بررسی را بدون شمارهٔ کارت به سرور می‌فرستد و بررسی‌های راه دور را برمی‌گرداند.
- **چاپ**: CSS مخصوص چاپ A4.

جزئیات تصمیم‌ها در [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x (React 19، TanStack Start)؛ SQL (PostgreSQL 15+ / Supabase)؛ C# 7.3 روی .NET Framework 4.8 (سرویس کارت‌خوان)

**Primary Dependencies**: `@tanstack/react-router` / Start، `@supabase/supabase-js` 2.118، `react-day-picker` 9.14 (`react-day-picker/persian`)، `date-fns` 4، Tailwind 4، lucide-react؛ سرویس: `System.Web.Extensions` (JSON)، `HttpWebRequest`. **وابستگی تازه: ندارد.**

**Storage**: Supabase Postgres: `invoices`، `invoice_items` (+ `item_type`، `reference_id`)، جدول‌های تازهٔ `kiosk_devices` و `pos_review_transactions`. روی کیوسک: `transactions.jsonl`، `appsettings.json` و `data/sync-state.json`

**Testing**: vitest (`tests/`)؛ xUnit (`pos-bridge/tests/PosBridge.Tests`)؛ اسکریپت تازهٔ `supabase/tests/run.sh` (Postgres محلی + شبیه‌سازی حداقلی Supabase)؛ بررسی دستی چاپ با Playwright/پیش‌نمایش چاپ

**Target Platform**: مرورگر (Chrome روی کیوسک، گوشی و کامپیوتر مدیر)، برنامهٔ ویندوزی Electron، سرویس کارت‌خوان روی ویندوز ۱۰/۱۱

**Project Type**: وب‌اپ (TanStack Start + Supabase) + سرویس محلی ویندوز + پوستهٔ دسکتاپ

**Performance Goals**: گزارش کمتر از ۳ ثانیه برای ۱٬۰۰۰ فاکتور در روز (SC-001)؛ رسیدن تراکنش نیازمند بررسی به گزارش حداکثر ۵ دقیقه (SC-006)

**Constraints**:
- مرز روز به وقت تهران، مستقل از ساعت دستگاه.
- شمارهٔ کارت هرگز از کیوسک خارج نمی‌شود.
- RLS مرز امنیت است و بدون کلید service role.
- migration فقط از طریق Lovable اجرا می‌شود.
- اگر migration اجرا نشده باشد، UI امن رفتار می‌کند (fail closed).
- فارسی و راست‌به‌چپ؛ چاپ روی یک برگهٔ A4.
- خطای همگام‌سازی هرگز روی پرداخت اثر نمی‌گذارد.

**Scale/Scope**: یک کیوسک (طراحی برای چند کیوسک)، حداکثر حدود ۱٬۰۰۰ فاکتور در روز، چند تراکنش نیازمند بررسی در روز؛ دو صفحهٔ تازه در پنل و یک کارت در صفحهٔ کارت‌خوان

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| اصل | بررسی | نتیجه |
| --- | --- | --- |
| I. ایمنی پرداخت | گزارش فقط خواندنی است. همگام‌سازی در thread جدا و بیرون از قفل پرداخت اجرا می‌شود و خطایش فقط لاگ می‌شود. دفتر محلی مرجع می‌ماند. «بررسی شد» فقط پرچم بررسی را عوض می‌کند، نه وضعیت پرداخت | ✅ PASS |
| II. هیچ رازی در مخزن | کلید کیوسک روی خود کیوسک ساخته و فقط هش آن در سرور ذخیره می‌شود. `kioskSyncKey` در مخزن خالی است و از `/config` خوانده نمی‌شود. کلید service role استفاده نمی‌شود. شمارهٔ کارت فرستاده نمی‌شود و ستونی هم برایش نیست | ✅ PASS |
| III. RLS و migration | جدول‌های تازه در همان migration با `GRANT` → `RLS` → `POLICY`. نوشتن فقط با توابع `SECURITY DEFINER` که کلید یا نقش را بررسی می‌کنند. گزارش با `SECURITY INVOKER`. اگر migration اجرا نشده باشد، UI پیام «فعال نشده» می‌دهد. `supabase/tests/run.sh` پیش از ادغام | ✅ PASS |
| IV. کیوسک فارسی و لمسی | تقویم شمسی، ارقام فارسی، RTL، چاپ A4. گزارش فقط در پنل مدیریت است، نه صفحه‌های بازدیدکننده. هم در برنامهٔ ویندوزی و هم در مرورگر کار می‌کند | ✅ PASS |
| V. تست پیش از انتشار | vitest + xUnit + تست migration. همگام‌سازی با سرور جعلی تست می‌شود. آنچه روی دستگاه یا ویندوز واقعی تست نشده اعلام می‌شود. وابستگی تازه‌ای نیست | ✅ PASS |
| روند توسعه | مستندات (README، `pos-bridge/README.md`، `docs/`) همراه تغییر. ادغام با CI سبز. migration پس از ادغام در Lovable اجرا می‌شود | ✅ PASS |

**بازبینی پس از Phase 1**: طراحی (data-model و contracts) هیچ اصلی را نقض نمی‌کند. نکته‌ها:

- ستون‌های `kiosk_devices.key_hash` با `GRANT` ستونی از `SELECT` مدیران هم پنهان است.
- `kiosk_sync_review_transactions` فقط کلیدهای مجاز را می‌خواند.
- وابستگی به migration حالت بدون رمز (`admin_open_mode()`) در quickstart ذکر شده است.

نتیجه: ✅ PASS.

## Project Structure

### Documentation (this feature)

```text
specs/001-daily-sales-report/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── daily-sales-report.md
│   ├── kiosk-sync.md
│   └── report-ui.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
supabase/
├── migrations/
│   ├── 20261101000000_daily_sales_report.sql   # US1: ستون‌های invoice_items، ایندکس‌ها، daily_sales_report
│   └── 20261101000100_kiosk_review_sync.sql    # US2: kiosk_devices، pos_review_transactions، RLS،
│                                               # register_kiosk، kiosk_sync_review_transactions،
│                                               # review_pos_transaction، review_transactions_for_day،
│                                               # و بازنویسی daily_sales_report با بخش review
└── tests/                                      # تازه
    ├── stub.sql                                # نقش‌ها، auth.uid()، auth.jwt()، storage (شبیه‌سازی حداقلی Supabase)
    ├── daily_report.sql                        # سناریوهای گزارش و مرز روز
    ├── kiosk_sync.sql                          # سناریوهای کلید، upsert، عدم ذخیرهٔ کارت، بررسی یک‌طرفه، اصلاح ساعت
    └── run.sh

src/
├── integrations/supabase/types.ts   # تایپ جدول‌ها و توابع تازه
├── lib/
│   ├── daily-report.ts              # تازه: امروزِ تهران، تبدیل شمسی↔میلادی، fetch و نگاشت پاسخ، قالب‌بندی
│   ├── invoice.ts                   # ذخیرهٔ item_type و reference_id
│   ├── pos.ts                       # کلاینت /sync/pair، /sync/activate، /sync/status، /sync/disable
│   └── pos-audit.ts                 # نوع رویداد ممیزی تازه sync:pair
├── routes/
│   ├── admin.tsx                    # آیتم منوی «گزارش روزانه»
│   ├── admin.reports.tsx            # تازه: صفحهٔ گزارش + بخش چاپ
│   ├── admin.reports.review.tsx     # تازه: فهرست تراکنش‌های نیازمند بررسی + «بررسی شد»
│   ├── admin.pos.tsx                # کارت «اتصال این کیوسک به گزارش روزانه» و وضعیت همگام‌سازی
│   └── cart.tsx                     # فرستادن type و referenceId ردیف‌ها به saveInvoice
├── components/
│   └── DailyReportPrint.tsx         # تازه: نسخهٔ چاپی A4
├── styles.css                       # قواعد @media print و @page A4
└── routeTree.gen.ts                 # دو مسیر تازه

pos-bridge/
├── ReviewSync.cs                    # تازه: حلقهٔ همگام‌سازی، ساخت بدنه (بدون کارت)، اعمال بررسی راه دور
├── TransactionJournal.cs            # UpdatedAt، ReviewedAt، ReviewedBy، ReviewNote، ApplyRemoteReview، ChangedSince
├── PosDevice.cs                     # MarkReviewed: ReviewedAt، ReviewedBy، ReviewNote
├── Config.cs                        # کلیدهای sync*؛ kioskSyncKey مثل accessToken محافظت‌شده
├── Program.cs                       # مسیرهای /sync/*، شروع ReviewSync
├── appsettings.json                 # کلیدهای تازه با مقدار خالی
├── README.md                        # کلیدهای sync* و مسیرهای /sync/*
└── tests/PosBridge.Tests/
    ├── PosBridge.Tests.csproj       # link کردن ReviewSync.cs
    ├── JournalTests.cs              # فیلدهای تازه، ChangedSince، ApplyRemoteReview
    └── ReviewSyncTests.cs           # تازه

tests/
├── daily-report.test.ts             # تازه
└── pos-checkout.test.ts             # ذخیرهٔ item_type و reference_id در saveInvoice

.github/workflows/ci.yml             # job تازهٔ db: PostgreSQL 16 روی runner + supabase/tests/run.sh

README.md، docs/WINDOWS-APP.md، installers/RELEASE-NOTES.md   # مستندات گزارش و اتصال کیوسک
```

**Structure Decision**: همان ساختار فعلی پروژه حفظ می‌شود: وب‌اپ در `src/`، migrationها در
`supabase/migrations/` و سرویس کارت‌خوان در `pos-bridge/`. فقط `supabase/tests/` تازه است و اسکریپت
تست migration را که برای حالت بدون رمز دستی اجرا شد، ماندگار می‌کند.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

نقضی وجود ندارد. تنها پیچیدگی قابل توجه، همگام‌سازی دوطرفهٔ وضعیت بررسی است. خود spec آن را
می‌خواهد (Q1 = B: بررسی از راه دور) و با یک‌طرفه بودن وضعیت (R6) ساده نگه داشته شده است.
