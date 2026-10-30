---

description: "Task list for the daily sales report (001)"
---

# Tasks: گزارش فروش روزانه برای مدیر (Daily Sales Report)

**Input**: Design documents from `/specs/001-daily-sales-report/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: تست‌ها در این فهرست هستند. spec آن‌ها را جدا نخواسته، ولی اصل V constitution برای هر تغییر
در دفتر تراکنش و منطق پرداخت تست خودکار را الزامی می‌کند. اصل III هم تست migration روی Postgres
آزمایشی را می‌خواهد. plan.md (بخش Testing) همین را ثبت کرده است.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1، US2، US3)
- مسیرها نسبت به ریشهٔ مخزن‌اند: وب‌اپ در `src/` و `tests/`، دیتابیس در `supabase/` و سرویس
  کارت‌خوان در `pos-bridge/`.

## قواعد مشترک همهٔ کارها

- **قالب‌بندی**: کد TypeScript و Markdown با `npx prettier@3.8.3` (نسخهٔ lockfile) قالب‌بندی شود، نه
  Prettier نصب‌شدهٔ محلی.
- **`src/routeTree.gen.ts`**: هر مسیر تازه دستی و به همان الگوی ورودی‌های موجود اضافه شود. پس از
  `vite build` تغییرات ترتیبی ابزار را برگردانید.
- **migrationها**: قابل اجرای دوباره باشند (`IF NOT EXISTS`، `CREATE OR REPLACE`،
  `DROP POLICY IF EXISTS`). هر جدول تازه در همان فایل `GRANT` → `ENABLE ROW LEVEL SECURITY` →
  `CREATE POLICY` دارد. مقادیر راز هرگز در فایل نمی‌آیند.
- **پیام‌ها**: پیام‌های کاربر فارسی‌اند و مبالغ با `formatNumber` از `src/lib/money.ts` به تومان
  نمایش داده می‌شوند.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: زیرساخت تست migration که هر دو migration این قابلیت به آن تکیه دارند

- [ ] T001 Create `supabase/tests/stub.sql`: شبیه‌سازی حداقلی Supabase.
  - نقش‌ها: `anon` و `authenticated` (NOLOGIN) و `service_role` (BYPASSRLS).
  - `CREATE EXTENSION pgcrypto`.
  - اسکیمای `auth`، با جدول `auth.users` (ستون‌های `instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous, confirmation_token, email_change, email_change_token_new, recovery_token`) و جدول `auth.identities`.
  - تابع `auth.uid()` که `nullif(current_setting('request.jwt.claim.sub', true), '')::uuid` را برمی‌گرداند.
  - تابع `auth.jwt()` که `coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb` را برمی‌گرداند (برای `reviewed_by` در T020).
  - اسکیمای `storage` با جدول `storage.objects(id, bucket_id, name, owner)` و RLS روشن.
  - `GRANT USAGE` روی این اسکیماها به همهٔ نقش‌ها.
- [ ] T002 Create `supabase/tests/run.sh`:
  - یک cluster موقت PostgreSQL 16 در `$TMPDIR` با `initdb` می‌سازد. اگر root بود، با کاربر `postgres` و `runuser`.
  - روی `127.0.0.1:${PGPORT:-55432}` و بدون unix socket گوش می‌دهد.
  - `stub.sql` و سپس همهٔ `supabase/migrations/*.sql` را به ترتیب نام با `-v ON_ERROR_STOP=1` اجرا می‌کند.
  - آخرین migration را یک بار دیگر اجرا می‌کند تا قابل اجرای دوباره بودنش بررسی شود.
  - هر فایل سناریوی `supabase/tests/*.sql` (به‌جز `stub.sql`) را اجرا می‌کند. سناریوها در بلوک `DO` با `RAISE EXCEPTION` شکست می‌خورند.
  - در پایان cluster را می‌بندد و پاک می‌کند. با خروجی غیر صفر برای هر خطا.
- [ ] T003 [P] Add job `db` to `.github/workflows/ci.yml` روی `ubuntu-latest`: checkout و
  `bash supabase/tests/run.sh` با `PATH` شامل `/usr/lib/postgresql/16/bin`. اگر روی runner نبود، اول
  `sudo apt-get install -y postgresql-16`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: کمکی‌های تاریخ و قالب‌بندی که هر سه داستان استفاده می‌کنند

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Create `src/lib/daily-report.ts` با این تابع‌های خالص:
  - `tehranToday(now = new Date()): string` → امروز به وقت تهران به‌صورت `YYYY-MM-DD` (`Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" })`).
  - `addDays(day, n)`.
  - `isFutureDay(day, now)`.
  - `formatJalaliLong(day)` → مثل «پنجشنبه ۸ آبان ۱۴۰۵»، با `Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", dateStyle: "full" })` روی ظهر همان روز تا مرز روز جابه‌جا نشود.
  - `formatTehranTime(iso)` → `hh:mm` فارسی.
  - `rialToToman(rial)` → `Math.round(rial / 10)`.
  - هیچ تابعی به ساعت یا منطقهٔ زمانی دستگاه وابسته نباشد (research R2).
- [ ] T005 [P] Create `tests/daily-report.test.ts`:
  - `tehranToday` برای `2026-10-30T20:29:00Z` → `2026-10-30` و برای `2026-10-30T20:31:00Z` → `2026-10-31` (UTC+3:30).
  - `isFutureDay`.
  - `formatJalaliLong("2026-10-30")` شامل «۱۴۰۵» و «آبان».
  - `rialToToman(15000)` → `1500`.

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - خلاصهٔ فروش یک روز (Priority: P1) 🎯 MVP

**Goal**: مدیر روز را با تقویم شمسی انتخاب می‌کند و جمع فروش کارتی و نقدی و کل، تعداد فاکتورها و
تعداد بلیط به تفکیک نوع را می‌بیند (FR-001 تا FR-006، FR-009 تا FR-012).

**Independent Test**: چند فروش کارتی و نقدی (شامل یک بلیط گروهی) در دو روز ثبت کنید. گزارش هر روز
باید دقیقاً با فاکتورهای همان روز بخواند. فروش ۲۳:۵۹ و ۰۰:۰۱ تهران هر کدام در روز خودش باشد
(quickstart §۱ و §۲).

### Tests for User Story 1

- [ ] T006 [P] [US1] Create `supabase/tests/daily_report.sql` (سناریوها در `DO` با `RAISE EXCEPTION`):
  - **دادهٔ نمونه**: یک کاربر مدیر در `auth.users` و `user_roles`، و `app_settings.admin_open = false`.
  - **جمع‌ها**: ۳ فاکتور کارتی (۱۰۰٬۰۰۰، ۲۰۰٬۰۰۰، ۳۰۰٬۰۰۰) و ۲ نقدی (۵۰٬۰۰۰) با `created_at` امروز تهران. با نقش مدیر (`SET LOCAL ROLE authenticated` و `request.jwt.claim.sub`)، `daily_sales_report` باید `card.total=600000`، `cash.total=100000`، `total=700000` و `card.count=3` بدهد.
  - **بلیط‌ها**: ردیف `item_type='ticket'` با `reference_id` بلیط عادی و `quantity=2` و ردیف گروهی با `quantity=10` نوع راهنما → `tickets.total=12` و `by_type` به ترتیب `normal` و سپس `guided`.
  - **ردیف قدیمی**: یک ردیف با `item_type NULL` و `quantity=3` → `untyped_lines_quantity=3` که در `tickets.total` نیست.
  - **مرز روز**: فاکتورهای `2026-10-29 23:59` و `2026-10-30 00:01` به وقت تهران هر کدام فقط در روز خودشان.
  - **روز آینده**: خطای `22023`.
  - **بدون دسترسی**: `anon` با حالت بدون رمز خاموش → همهٔ جمع‌ها صفر.
  - **CHECK**: درج `item_type='ticket'` بدون `reference_id` خطا بدهد.
- [ ] T007 [P] [US1] Add tests to `tests/daily-report.test.ts` برای `fetchDailyReport` با `supabase.rpc` جعلی:
  - پاسخ موفق به `DailyReport` نگاشت می‌شود.
  - خطای `PGRST202` → `{ kind: "not-enabled" }`.
  - `22023` → `{ kind: "future" }`.
  - خطای شبکه → `{ kind: "network" }`.
  - هیچ حالت خطایی عدد صفر برنمی‌گرداند (FR-010).
- [ ] T008 [P] [US1] Add a test to `tests/pos-checkout.test.ts`: `saveInvoice` برای ردیف با
  `itemType: "ticket", referenceId: 2` در `invoice_items` مقدار `item_type: "ticket", reference_id: 2`
  و برای ردیف بدون این‌ها `null` می‌فرستد.

### Implementation for User Story 1

- [ ] T009 [US1] Create `supabase/migrations/20261101000000_daily_sales_report.sql`:
  - **ستون‌های `invoice_items`**:
    - `item_type text NULL` با CHECK «یکی از `ticket`، `product`، `event`، `membership`، `donation`».
    - `reference_id bigint NULL`، **بدون FK**.
    - CHECK «اگر `item_type = 'ticket'` باشد، `reference_id` باید پر باشد».
    - هر سه با `ADD COLUMN IF NOT EXISTS` و `DROP CONSTRAINT IF EXISTS` پیش از `ADD CONSTRAINT`.
  - **ایندکس‌ها** (با `IF NOT EXISTS`): `invoices_created_at_idx` روی `invoices(created_at)` و `invoice_items_invoice_id_idx` روی `invoice_items(invoice_id)`.
  - **تابع `public.daily_sales_report(p_day date) RETURNS jsonb`**: `LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public`.
    - اگر `p_day > (now() AT TIME ZONE 'Asia/Tehran')::date` باشد، `RAISE EXCEPTION ... USING ERRCODE = '22023'`.
    - بازهٔ `[p_day::timestamp AT TIME ZONE 'Asia/Tehran', (p_day + 1)::timestamp AT TIME ZONE 'Asia/Tehran')`.
    - جمع‌ها با `bigint`.
    - `tickets.by_type` با `LEFT JOIN ticket_types` (`name` و `category` برای نوع حذف‌شده `null`)، به ترتیب `normal, guided, vip` و سپس `name`.
    - `untyped_lines_quantity`.
    - `review: null`.
    - `is_today` و `generated_at`.
    - ساختار دقیق خروجی در `specs/001-daily-sales-report/contracts/daily-sales-report.md`.
  - `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO anon, authenticated`.
- [ ] T010 [P] [US1] Update `src/integrations/supabase/types.ts`:
  - در `invoice_items`: `item_type: string | null` و `reference_id: number | null` در Row، و اختیاری در Insert و Update.
  - در `Functions`: `daily_sales_report: { Args: { p_day: string }; Returns: Json }`.
- [ ] T011 [P] [US1] Update `src/lib/invoice.ts`:
  - به `InvoiceLine` فیلدهای اختیاری `itemType?: "ticket" | "product" | "event" | "membership" | "donation"` و `referenceId?: number` اضافه شود.
  - `saveInvoice` آن‌ها را به‌صورت `item_type: i.itemType ?? null` و `reference_id: i.referenceId ?? null` در ردیف‌های `invoice_items` بفرستد.
- [ ] T012 [US1] Update `toLines()` in `src/routes/cart.tsx` تا `itemType: i.type` و
  `referenceId: i.referenceId` را هم برگرداند (پس از T011).
- [ ] T013 [US1] Add to `src/lib/daily-report.ts`:
  - تایپ `DailyReport` مطابق قرارداد.
  - `fetchDailyReport(day, client = supabase)`: `client.rpc("daily_sales_report", { p_day: day })`.
  - نتیجه: `{ ok: true, report }` یا `{ ok: false, kind: "not-enabled" | "future" | "network" | "error", message }` (پس از T010).
- [ ] T014 [US1] Create `src/routes/admin.reports.tsx` (`createFileRoute("/admin/reports")`):
  - **پارامتر**: `validateSearch` با `day?: string` (فقط `^\d{4}-\d{2}-\d{2}$`؛ پیش‌فرض `tehranToday()`).
  - **انتخاب روز**: `DayPicker` از `react-day-picker/persian` با `locale={faIR}` و `dir="rtl"`. روزهای بعد از `tehranToday()` با `disabled`. دکمه‌های «امروز» و «دیروز».
  - **سرتیتر**: «گزارش فروش — {formatJalaliLong(day)}». برای امروز «تا ساعت {formatTehranTime(generated_at)}» و دکمهٔ «به‌روزرسانی».
  - **کارت‌ها**: کارت‌های فروش کارتی و نقدی (مبلغ و تعداد فاکتور) و جمع کل.
  - **جدول بلیط‌ها**: نوع → تعداد، با ردیف «نامشخص (فروش‌های قدیمی)» فقط وقتی `untyped_lines_quantity > 0`.
  - **بخش بررسی**: وقتی `review === null` بنویسد «در دسترس نیست — کیوسک هنوز به گزارش وصل نشده».
  - **حالت‌ها**: loading، «در این روز فروشی ثبت نشده»، not-enabled («گزارش روزانه هنوز روی دیتابیس فعال نشده است»)، network (با «تلاش دوباره»).
  - مطابق `contracts/report-ui.md`. هیچ‌جا صفر جای دادهٔ نیامده نمی‌نشیند.
- [ ] T015 [US1] Add NAV entry in `src/routes/admin.tsx`:
  `{ to: "/admin/reports", label: "گزارش روزانه", icon: FileChartColumn, exact: false }` بعد از
  «فاکتورها»، و مسیر `/admin/reports` را به `src/routeTree.gen.ts` اضافه
  کنید (فرزند `AdminRoute` مثل `/admin/invoices`).

**Checkpoint**: User Story 1 کامل و مستقل قابل آزمون است (MVP)

---

## Phase 4: User Story 2 - تراکنش‌های نیازمند بررسی (Priority: P2)

**Goal**: کیوسک تراکنش‌های نیازمند بررسی را بدون شمارهٔ کارت به سرور می‌فرستد. گزارش تعداد و مبلغ
بررسی‌نشده و بررسی‌شده را از هر جا نشان می‌دهد. مدیر از راه دور «بررسی شد» می‌زند و کیوسک آن را
دریافت می‌کند (FR-007، FR-007a، FR-007b، FR-007c، SC-005، SC-006).

**Independent Test**: quickstart §۳. کیوسک را جفت کنید، با بستن سرویس وسط پرداخت شبیه‌سازی‌شده یک
تراکنش نیازمند بررسی بسازید و ببینید حداکثر ۵ دقیقه بعد روی دستگاه دیگری در گزارش است. «بررسی شد»
از راه دور باید روی کیوسک دیده شود.

### Tests for User Story 2

- [ ] T016 [P] [US2] Create `supabase/tests/kiosk_sync.sql`:
  - **ثبت کیوسک**: `register_kiosk` برای غیرمدیر (حالت بدون رمز خاموش) خطای `42501` می‌دهد و برای مدیر ثبت می‌کند. `key_hash` غیر هگز ۶۴ کاراکتری با CHECK رد می‌شود.
  - **کلید نادرست**: `kiosk_sync_review_transactions` با کلید نادرست `42501` می‌دهد و هیچ ردیفی ثبت نمی‌شود.
  - **کلید درست**: ثبت می‌شود و `last_sync_at` پر می‌شود.
  - **ارسال دوباره**: همان `transaction_id` یک ردیف می‌ماند و `status` به‌روز می‌شود.
  - **کلید ناشناخته**: کلیدی مثل `masked_pan` در `p_rows` هیچ‌جا ذخیره نمی‌شود (جدول اصلاً چنین ستونی ندارد و تابع آن را نمی‌خواند).
  - **بیش از حد**: ۵۰۱ ردیف خطای `22023` می‌دهد.
  - **بررسی یک‌طرفه**: `review_pos_transaction` برای مدیر `reviewed=true` و `reviewed_by` را می‌گذارد. ارسال بعدی کیوسک با `reviewed=false` آن را برنمی‌گرداند.
  - **بررسی راه دور**: پاسخ همگام‌سازی با `p_since` قبلی آن بررسی را در `remote_reviews` دارد.
  - **دسترسی ستونی**: مدیر از `kiosk_devices` ستون `key_hash` را نمی‌تواند `SELECT` کند (permission denied).
  - **گزارش**: `daily_sales_report` بخش `review` را با تعداد و مبلغ بر اساس روز تهرانِ `occurred_at` پر می‌کند.
- [ ] T017 [P] [US2] Add to `pos-bridge/tests/PosBridge.Tests/JournalTests.cs`:
  - `UpdatedAt`، `ReviewedAt` و `ReviewedBy` پس از بارگذاری دوباره از فایل حفظ می‌شوند.
  - هر `Save` مقدار `UpdatedAt` را جلو می‌برد.
  - `ChangedSince(iso)` فقط تراکنش‌های `NeedsReview` با `UpdatedAt` بعد از آن را برمی‌گرداند.
  - `ApplyRemoteReview` یک‌طرفه است و تراکنش بررسی‌شده را دوباره «بررسی‌نشده» نمی‌کند.
- [ ] T018 [P] [US2] Create `pos-bridge/tests/PosBridge.Tests/ReviewSyncTests.cs` (با transport جعلی و serializer مبتنی بر `System.Text.Json`):
  - **بدون کارت**: بدنه هیچ کلید یا مقداری از `MaskedPan` ندارد. یک تراکنش با `MaskedPan = "603799******1234"` بسازید و بررسی کنید `603799` و `1234` در بدنه نیستند.
  - **کلیدهای بدنه**: فقط کلیدهای مجاز قرارداد `contracts/kiosk-sync.md` می‌آیند.
  - **فقط تغییرها**: فقط ردیف‌های تغییرکرده بعد از `pushedUntil` فرستاده می‌شوند.
  - **دسته‌ها**: حداکثر ۵۰۰ ردیف در هر فراخوانی.
  - **پاسخ موفق**: `remote_reviews` در دفتر اعمال و `pushedUntil` و `pulledUntil` به‌روز می‌شوند.
  - **خطای HTTP یا شبکه**: watermarkها تغییر نمی‌کنند و `lastError` پر می‌شود.
  - **کلید در لاگ**: `kioskSyncKey` در هیچ لاگی (`PosLog`) نمی‌آید.
  - **هدرها**: کلید publishable با پیشوند `sb_publishable_` فقط در هدر `apikey` می‌رود و `Authorization` ندارد. کلید JWT هر دو هدر را دارد.
  - csproj تست باید `../../ReviewSync.cs` را link کند.
- [ ] T019 [P] [US2] Add tests to `tests/daily-report.test.ts` (یا `tests/kiosk-pairing.test.ts`):
  - **جفت کردن**: `pairKiosk` به RPC `register_kiosk` فقط `sha256` هگز کلید را می‌فرستد، نه خود کلید.
  - **ترتیب**: ترتیب فراخوانی `/sync/pair` → `register_kiosk` → `/sync/activate` است.
  - **خطا**: اگر `register_kiosk` خطا بدهد، `/sync/activate` صدا زده نمی‌شود.

### Implementation for User Story 2

- [ ] T020 [US2] Create `supabase/migrations/20261101000100_kiosk_review_sync.sql` (پس از T009):
  - **جدول `kiosk_devices`**:
    - ستون‌ها: `id uuid PK`، `name text NOT NULL` با CHECK «حداکثر ۸۰ کاراکتر»، `key_hash text NOT NULL` با CHECK `key_hash ~ '^[0-9a-f]{64}$'`، `created_at timestamptz NOT NULL DEFAULT now()`، `last_sync_at timestamptz NULL`.
    - `GRANT SELECT (id, name, created_at, last_sync_at) ON kiosk_devices TO anon, authenticated`، بدون `key_hash`.
    - RLS با سیاست SELECT «`has_role(auth.uid(),'admin') OR admin_open_mode()`».
  - **جدول `pos_review_transactions`**:
    - ستون‌ها: `kiosk_id uuid REFERENCES kiosk_devices(id) ON DELETE CASCADE`، `transaction_id text`، `occurred_at timestamptz NOT NULL`، `amount_rial bigint NOT NULL CHECK (amount_rial > 0)`، `status text NOT NULL`، `reason text NOT NULL DEFAULT ''`، `invoice_number text NULL`، `rrn text NULL`، `reviewed boolean NOT NULL DEFAULT false`، `review_note text NULL CHECK (char_length(review_note) <= 500)`، `reviewed_at timestamptz NULL`، `reviewed_by text NULL`، `updated_at timestamptz NOT NULL DEFAULT now()`.
    - کلید اصلی `PRIMARY KEY (kiosk_id, transaction_id)` و ایندکس روی `occurred_at`.
    - **هیچ ستونی برای شمارهٔ کارت نیست.**
    - `GRANT SELECT` به `anon` و `authenticated` و RLS SELECT با همان شرط. INSERT، UPDATE و DELETE مستقیم برای هیچ نقشی مجاز نیست.
  - **توابع `SECURITY DEFINER SET search_path = public`** طبق `contracts/kiosk-sync.md`:
    - `register_kiosk(p_kiosk_id uuid, p_name text, p_key_hash text)`: فقط مدیر یا حالت بدون رمز، وگرنه `42501`. upsert هش و نام.
    - `kiosk_sync_review_transactions(p_kiosk_id uuid, p_key text, p_rows jsonb, p_since timestamptz) RETURNS jsonb`:
      - مقایسهٔ `encode(sha256(convert_to(p_key,'UTF8')),'hex')` با `key_hash`؛ اگر نخواند، `42501`.
      - بیش از ۵۰۰ ردیف → `22023`.
      - فقط کلیدهای مجاز قرارداد خوانده می‌شوند. upsert روی `(kiosk_id, transaction_id)`.
      - `reviewed` فقط `false → true` (با `reviewed_by = 'کیوسک'`).
      - `last_sync_at = now()`.
      - برمی‌گرداند `{ server_time, remote_reviews }` برای ردیف‌های همین کیوسک با `reviewed_at > p_since` و `reviewed_by <> 'کیوسک'`.
      - `GRANT EXECUTE TO anon`.
    - `review_pos_transaction(p_kiosk_id uuid, p_transaction_id text, p_note text)`: فقط مدیر یا حالت بدون رمز. اگر قبلاً بررسی شده، بدون تغییر. `reviewed_by` = ایمیل از `auth.jwt() ->> 'email'` یا «حالت بدون رمز».
    - `review_transactions_for_day(p_day date) RETURNS TABLE(...)`: `SECURITY INVOKER`، همان مرز روز تهران، با نام کیوسک.
  - **`daily_sales_report`**: با `CREATE OR REPLACE` بازنویسی شود تا `review` را پر کند: `pending` و `reviewed` (هر کدام `count` و `amount_rial`) و `last_sync_at = max(kiosk_devices.last_sync_at)`. وقتی هیچ کیوسکی ثبت نشده، `review` برابر `null` است.
- [ ] T021 [P] [US2] Update `src/integrations/supabase/types.ts`:
  - جدول‌های `kiosk_devices` (Row بدون `key_hash`) و `pos_review_transactions`.
  - توابع `register_kiosk`، `kiosk_sync_review_transactions`، `review_pos_transaction` و `review_transactions_for_day`.
- [ ] T022 [P] [US2] Update `pos-bridge/TransactionJournal.cs`:
  - فیلدهای `UpdatedAt`، `ReviewedAt` و `ReviewedBy` در `PosTransaction`، و ذخیره و خواندنشان در JSONL (همان کلیدهای camelCase).
  - `Save` همیشه `UpdatedAt = Now()` بگذارد.
  - متد `IList<PosTransaction> ChangedSince(string isoUtc)`: تراکنش‌های `NeedsReview` با `UpdatedAt` بزرگ‌تر، به ترتیب `UpdatedAt`.
  - متد `bool ApplyRemoteReview(string id, string note, string reviewedAt, string reviewedBy)`: فقط وقتی `!Reviewed`، `Reviewed = true` و ذخیره. اگر تراکنش نبود، false.
- [ ] T023 [US2] Update `PosDevice.MarkReviewed` in `pos-bridge/PosDevice.cs` تا `ReviewedAt = Now()` و
  `ReviewedBy = "کیوسک"` هم بگذارد (پس از T022).
- [ ] T024 [P] [US2] Update `pos-bridge/Config.cs` و `pos-bridge/appsettings.json`:
  - کلیدهای تازه (Load، Save و مقدار پیش‌فرض) با مقادیر `syncEnabled: false`، `supabaseUrl: ""`، `supabaseKey: ""`، `kioskId: ""`، `kioskSyncKey: ""` و `syncIntervalSeconds: 60`.
  - `Normalize` مقدار `syncIntervalSeconds` را به «بین ۳۰ تا ۳۰۰» محدود کند.
  - در `pos-bridge/Program.cs` → `HandleConfig`، مقدار `kioskSyncKey` مثل `accessToken` نه برگردانده و نه از بدنه پذیرفته شود.
- [ ] T025 [US2] Create `pos-bridge/ReviewSync.cs` (پس از T022):
  - **وابستگی‌ها**: به `Config` یا `JavaScriptSerializer` وابسته نباشد تا در تست net8 link شود. تنظیمات، `ISyncTransport` (`Post(url, headers, body) → (status, body)`)، `Func<object,string> serialize` و `Func<string, Dictionary<string,object>> deserialize` را می‌گیرد.
  - **`BuildRows(IEnumerable<PosTransaction>)`**:
    - فقط کلیدهای مجاز قرارداد را می‌سازد: `transaction_id`، `occurred_at = CreatedAt`، `amount_rial`، `status`، `reason`، `invoice_number`، `rrn`، `reviewed`، `review_note = Note`، `reviewed_at`.
    - `reason`: متن فارسی از روی `Status` و `LateResponse` (مثلاً «پاسخ دستگاه نامطمئن بود»، «تأیید پس از لغو یا پایان زمان رسید»، «تراکنش وسط کار قطع شد»).
    - **هرگز `MaskedPan`.**
  - **`RunOnce()`**:
    1. `data/sync-state.json` را بخواند.
    2. `ChangedSince(pushedUntil)` را در دسته‌های ۵۰۰تایی به `{supabaseUrl}/rest/v1/rpc/kiosk_sync_review_transactions` با بدنهٔ `{ p_kiosk_id, p_key, p_rows, p_since: pulledUntil }` بفرستد.
    3. **هدرها**: `apikey`، و `Authorization: Bearer` فقط اگر کلید با `sb_publishable_` یا `sb_secret_` شروع نشود.
    4. در موفقیت: `remote_reviews` را با `ApplyRemoteReview` اعمال کند، `pushedUntil` را به بیشترین `UpdatedAt` فرستاده‌شده و `pulledUntil` را به `server_time` برساند، و `lastSyncedAt` را بگذارد.
    5. در خطا: فقط `lastError` و `lastAttemptAt`.
    6. **امنیت لاگ**: کلید در لاگ یا خطا نیاید.
  - **`Start()`**: یک thread پس‌زمینه (`IsBackground`) که هر `syncIntervalSeconds` بعلاوهٔ ۰ تا ۱۰ ثانیهٔ تصادفی `RunOnce` را در `try/catch` اجرا می‌کند و هیچ قفل پرداختی نمی‌گیرد (اصل I).
  - **`Status()`** برای `/sync/status`.
- [ ] T026 [US2] Wire sync into `pos-bridge/Program.cs` (پس از T024، T025):
  - **transport واقعی**: با `HttpWebRequest`، timeout ۱۵ ثانیه، و `ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12`.
  - **راه‌اندازی**: شروع `ReviewSync` هنگام اجرا اگر `syncEnabled`.
  - **مسیرها**: پشت همان بررسی Origin و توکن، طبق `contracts/kiosk-sync.md` §۴:
    - `POST /sync/pair`: `kioskId` (Guid تازه، اگر نبود) و `kioskSyncKey` (با `BridgeSetup.NewToken()`) را ذخیره و `{ kioskId, kioskKey }` را برگرداند.
    - `POST /sync/activate`: `supabaseUrl` فقط https و `supabaseKey` غیر خالی؛ `syncEnabled = true`، ذخیره، و شروع یا راه‌اندازی دوباره.
    - `GET /sync/status`: بدون کلید.
    - `POST /sync/disable`.
  - `/sync/pair` و `/sync/activate` را به فهرست مسیرهای POST نیازمند JSON اضافه کنید.
- [ ] T027 [P] [US2] Add bridge client functions to `src/lib/pos.ts`:
  - `posSyncPair()`، `posSyncActivate({ supabaseUrl, supabaseKey, kioskName })`، `posSyncStatus()` و `posSyncDisable()`.
  - با همان helper درخواست و `X-Pos-Token` موجود.
  - مطمئن شوید `supportReportText` هیچ مقدار کلید کیوسک را نمی‌نویسد.
- [ ] T028 [US2] Add to `src/lib/daily-report.ts` (پس از T021، T027):
  - `sha256Hex(text)` با `crypto.subtle.digest`.
  - `pairKiosk(name, deps)`:
    1. `posSyncPair`.
    2. `supabase.rpc("register_kiosk", { p_kiosk_id, p_name: name, p_key_hash: await sha256Hex(kioskKey) })`.
    3. `posSyncActivate({ supabaseUrl: import.meta.env.VITE_SUPABASE_URL, supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, kioskName: name })`.
    - خطای هر مرحله با پیام فارسی برگردانده شود و مرحلهٔ بعد اجرا نشود.
  - `fetchReviewTransactions(day)` با `review_transactions_for_day`.
  - `markReviewed(kioskId, transactionId, note)` با `review_pos_transaction`.
- [ ] T029 [US2] Add card «اتصال این کیوسک به گزارش روزانه» to `src/routes/admin.pos.tsx`:
  - وضعیت از `posSyncStatus()`: فعال یا غیرفعال، «آخرین ارسال: …»، آخرین خطا و تعداد در صف.
  - ورودی نام کیوسک (حداکثر ۸۰ کاراکتر، پیش‌فرض «کیوسک ۱»).
  - دکمه‌های «اتصال» (`pairKiosk`) و «قطع اتصال» (`posSyncDisable`).
  - رویداد ممیزی با `audits("sync:pair", …)` ثبت شود؛ نوع رویداد تازه به `src/lib/pos-audit.ts` اضافه شود.
- [ ] T030 [US2] Fill the review section in `src/routes/admin.reports.tsx`:
  - بررسی‌نشده و بررسی‌شده (تعداد + مبلغ به تومان با `rialToToman`).
  - «آخرین ارسال از کیوسک: {formatTehranTime(last_sync_at)}».
  - توضیح «مبلغ تراکنش‌های نیازمند بررسی در جمع فروش نیامده».
  - لینک «مشاهدهٔ فهرست» به `/admin/reports/review?day=…`.
- [ ] T031 [US2] Create `src/routes/admin.reports.review.tsx` (`/admin/reports/review`، `validateSearch` با `day`):
  - جدول: زمان، مبلغ، علت، شمارهٔ فاکتور، شمارهٔ مرجع، کیوسک، وضعیت. **بدون شمارهٔ کارت.**
  - برای ردیف بررسی‌نشده، دکمهٔ «بررسی شد» با یادداشت (حداکثر ۵۰۰ کاراکتر) → `markReviewed` و بارگذاری دوباره.
  - مسیر را به `src/routeTree.gen.ts` اضافه کنید.

**Checkpoint**: User Stories 1 و 2 هر دو مستقل کار می‌کنند

---

## Phase 5: User Story 3 - چاپ گزارش (Priority: P3)

**Goal**: نسخهٔ چاپی A4 عمودی با سربرگ، همان اعداد صفحه و جای امضا (FR-008، FR-009، SC-003).

**Independent Test**: گزارش یک روز را باز کنید و «چاپ گزارش» را بزنید. پیش‌نمایش باید یک برگهٔ A4
بدون منو و دکمه باشد و اعدادش با صفحه یکی باشد (quickstart §۲ مرحلهٔ ۵).

### Implementation for User Story 3

- [ ] T032 [P] [US3] Create `src/components/DailyReportPrint.tsx`:
  - همان شیء `DailyReport` و `printedBy` را می‌گیرد و در `<section id="daily-report-print" dir="rtl">` رندر می‌کند.
  - **سربرگ**: «موزهٔ افتخارات کشتی ایران — گزارش فروش روزانه»، `formatJalaliLong(day)`، «چاپ: <تاریخ و ساعت تهران>»، «چاپ‌کننده: {printedBy}».
  - **بدنه**: جدول‌های فروش، بلیط و بررسی، بدون لینک.
  - **پاورقی**: دو کادر امضا «تحویل‌دهنده» و «تحویل‌گیرنده».
  - متن مشکی روی سفید.
- [ ] T033 [P] [US3] Add print rules to `src/styles.css`:
  - `@media print { @page { size: A4 portrait; margin: 15mm } }`.
  - پنهان کردن همهٔ عناصر به‌جز `#daily-report-print` و فرزندانش (`body * { visibility: hidden }` و `#daily-report-print, #daily-report-print * { visibility: visible }` با موقعیت ثابت بالا).
  - `#daily-report-print` روی صفحه با `display: none` و در چاپ با `display: block`.
- [ ] T034 [US3] Wire printing in `src/routes/admin.reports.tsx` (پس از T032، T033):
  - `<DailyReportPrint report={report} printedBy={email || "حالت بدون رمز"} />`، با ایمیل از `useAdminAccess()`.
  - دکمهٔ «چاپ گزارش» → `window.print()`، غیرفعال در حالت loading یا خطا.
- [ ] T035 [US3] Verify print layout of `src/components/DailyReportPrint.tsx` with Playwright:
  - `page.emulateMedia({ media: "print" })` و `page.pdf({ format: "A4" })` روی گزارش نمونه با ۳ نوع بلیط.
  - PDF دقیقاً یک صفحه باشد و متن «تحویل‌گیرنده» و جمع کل را داشته باشد.
  - اسکریپت در scratchpad اجرا می‌شود و commit نمی‌شود. نتیجه در شرح PR ثبت شود.

**Checkpoint**: همهٔ داستان‌ها مستقل کار می‌کنند

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: مستندات، بررسی امنیت و اعتبارسنجی نهایی

- [ ] T036 [P] Document the report in `README.md`:
  - بخش «گزارش فروش روزانه»: کجاست، چه چیزی نشان می‌دهد، و ترتیب اجرای دو migration در Lovable (پس از `20261029100000_admin_open_mode.sql`).
  - جدول RLS بخش ۵ با دو جدول تازه.
- [ ] T037 [P] Document sync in `pos-bridge/README.md`:
  - کلیدهای `sync*`، `kioskId` و `kioskSyncKey` (راز).
  - مسیرهای `/sync/*`.
  - اینکه شمارهٔ کارت فرستاده نمی‌شود.
  - عیب‌یابی «آخرین ارسال» قدیمی.
- [ ] T038 [P] Add the pairing step to `docs/WINDOWS-APP.md` و `installers/RELEASE-NOTES.md`: «یک
  بار در پنل → کارت‌خوان → اتصال این کیوسک به گزارش روزانه».
- [ ] T039 Security pass on `pos-bridge/ReviewSync.cs`، `pos-bridge/appsettings.json` و `src/lib/pos.ts`:
  - `grep -rn "MaskedPan\|masked_pan" pos-bridge/ReviewSync.cs supabase/migrations/20261101000100_kiosk_review_sync.sql` باید خالی یا فقط در کامنت «فرستاده نمی‌شود» باشد.
  - `kioskSyncKey` در `pos-bridge/appsettings.json` خالی باشد.
  - کلید در `/config`، لاگ‌ها و `supportReportText` نیاید.
- [ ] T040 Run all checks (`package.json` scripts، `pos-bridge/tests/PosBridge.Tests`، `supabase/tests/run.sh`) and fix failures:
  - `bun run lint`، `bunx tsc --noEmit`، `bun run test:run`.
  - `dotnet test pos-bridge/tests/PosBridge.Tests`.
  - `bash supabase/tests/run.sh`.
  - `NITRO_PRESET=node_server npx vite build`، و برگرداندن تغییرات ترتیبی `src/routeTree.gen.ts`.
- [ ] T041 Run `specs/001-daily-sales-report/quickstart.md` §۱ تا §۳ (با شبیه‌ساز) و نتیجه را در شرح
  PR بنویسید. آنچه روی دستگاه یا ویندوز واقعی تست نشده صریحاً ذکر شود (اصل V).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: بدون وابستگی. T002 به T001 وابسته است.
- **Foundational (Phase 2)**: T004 بلافاصله. T005 پس از T004. **جلوی همهٔ داستان‌ها را می‌گیرد.**
- **US1 (Phase 3)**: پس از Phase 2. تست migration (T006) به T001 و T002 نیاز دارد.
- **US2 (Phase 4)**: پس از Phase 2 و **T009** (migration آن `daily_sales_report` را بازنویسی می‌کند)
  و **T014** (بخش بررسی صفحه).
- **US3 (Phase 5)**: پس از T014 (به صفحهٔ گزارش وصل می‌شود). به US2 وابسته نیست. اگر `review` تهی
  باشد، بخش بررسی چاپ «در دسترس نیست» می‌نویسد.
- **Polish (Phase 6)**: پس از داستان‌های انتخاب‌شده.

### User Story Dependencies

- **US1 (P1)**: فقط به Foundational وابسته است.
- **US2 (P2)**: به T009 و T014 از US1 وابسته است، ولی جدا قابل آزمون است (quickstart §۳).
- **US3 (P3)**: به T014 از US1 وابسته است و جدا قابل آزمون است.

### Within Each User Story

- تست‌ها پیش از پیاده‌سازی نوشته شوند و اول شکست بخورند.
- migration، سپس types، سپس lib و در آخر صفحه.
- سمت سرویس کارت‌خوان: دفتر (T022)، سپس ReviewSync (T025)، سپس مسیرها (T026).

### Parallel Opportunities

- T003 با T001 و T002.
- در US1: T006، T007 و T008 با هم. سپس T010 و T011 با هم (پس از T009 فقط T010 به طرح migration تکیه
  دارد).
- در US2: T016، T017، T018 و T019 با هم. سپس T021، T022، T024 و T027 با هم (فایل‌های جدا).
- در US3: T032 و T033 با هم.
- در Polish: T036، T037 و T038 با هم.

---

## Parallel Example: User Story 2

```bash
# تست‌ها با هم:
Task: "Create supabase/tests/kiosk_sync.sql (T016)"
Task: "Journal tests in pos-bridge/tests/PosBridge.Tests/JournalTests.cs (T017)"
Task: "ReviewSync tests in pos-bridge/tests/PosBridge.Tests/ReviewSyncTests.cs (T018)"
Task: "Pairing tests in tests/daily-report.test.ts (T019)"

# پس از migration (T020)، فایل‌های جدا با هم:
Task: "Types in src/integrations/supabase/types.ts (T021)"
Task: "Journal fields in pos-bridge/TransactionJournal.cs (T022)"
Task: "Config keys in pos-bridge/Config.cs + appsettings.json (T024)"
Task: "Bridge client in src/lib/pos.ts (T027)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (T001–T003) و Phase 2 (T004–T005).
2. Phase 3 (T006–T015).
3. **STOP and VALIDATE**: `bash supabase/tests/run.sh`، `bun run test:run`، و quickstart §۲.
4. ادغام. اجرای migration `20261101000000` در Lovable، Publish و `liara deploy`.

### Incremental Delivery

1. Setup + Foundational → آماده.
2. US1 → آزمون → انتشار (MVP: جمع فروش و بلیط).
3. US2 → آزمون → migration دوم در Lovable + نسخهٔ تازهٔ برنامهٔ ویندوزی + جفت کردن کیوسک.
4. US3 → آزمون → انتشار.

---

## Notes

- [P] = فایل جدا و بدون وابستگی به کار ناتمام.
- [USn] = ردیابی به داستان spec.
- پس از هر کار یا گروه منطقی commit کنید. تاریخچهٔ push‌شده بازنویسی نشود (Lovable).
- هیچ تستی برای سبز شدن CI حذف یا غیرفعال نشود (اصل V).
