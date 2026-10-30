# Data Model: گزارش فروش روزانه برای مدیر

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## سرور (Postgres / Supabase)

### `invoices` (موجود — بدون تغییر ستون)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `invoice_number` | text | یکتا |
| `total` | integer | تومان |
| `payment_method` | text | `card` یا `cash` |
| `status` | text | فعلاً همیشه `paid` |
| `created_at` | timestamptz | مرز روز با `AT TIME ZONE 'Asia/Tehran'` |

- **تازه**: ایندکس `invoices_created_at_idx` روی `created_at`.

### `invoice_items` (موجود — دو ستون تازه)

| Field | Type | Notes |
| --- | --- | --- |
| `item_type` | text, nullable | **تازه.** یکی از `ticket`، `product`، `event`، `membership`، `donation` (CHECK). `NULL` = ردیف قدیمی، «نامشخص» |
| `reference_id` | bigint, nullable | **تازه.** برای `ticket`: شناسهٔ `ticket_types.id`. بدون FK تا حذف نوع بلیط، فاکتورهای قدیمی را نشکند |

- **تازه**: ایندکس `invoice_items_invoice_id_idx`.
- **Validation**: اگر `item_type = 'ticket'` باشد، `reference_id` باید پر باشد (CHECK).
- ردیف‌های قدیمی دست نمی‌خورند.

### `kiosk_devices` (تازه)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK، همان `kioskId` در `appsettings.json` کیوسک |
| `name` | text | مثلاً «کیوسک ورودی»، حداکثر ۸۰ کاراکتر |
| `key_hash` | text | `sha256` کلید کیوسک، هگز ۶۴ کاراکتری. خود کلید هرگز ذخیره نمی‌شود |
| `created_at` | timestamptz | |
| `last_sync_at` | timestamptz, nullable | آخرین همگام‌سازی موفق؛ در گزارش «آخرین ارسال از کیوسک» |

- **RLS**: SELECT برای مدیر یا حالت بدون رمز، بدون ستون `key_hash` (دسترسی به ستون‌ها با `GRANT`
  محدود می‌شود). INSERT فقط از طریق تابع `register_kiosk`. UPDATE و DELETE مستقیم برای هیچ نقشی مجاز
  نیست.

### `pos_review_transactions` (تازه)

| Field | Type | Notes |
| --- | --- | --- |
| `kiosk_id` | uuid | FK → `kiosk_devices.id`. بخشی از PK |
| `transaction_id` | text | شناسهٔ تراکنش در دفتر کیوسک. بخشی از PK |
| `occurred_at` | timestamptz | زمان ایجاد تراکنش روی کیوسک؛ روز گزارش با همین تعیین می‌شود |
| `amount_rial` | bigint | > 0 |
| `status` | text | وضعیت دفتر کیوسک: `uncertain`، `approved_late`، `timeout`، `failed`، … |
| `reason` | text | متن فارسی کوتاه برای مدیر |
| `invoice_number` | text, nullable | شمارهٔ فاکتوری که قرار بود صادر شود |
| `rrn` | text, nullable | شمارهٔ مرجع، اگر دستگاه داده |
| `reviewed` | boolean | پیش‌فرض false |
| `review_note` | text, nullable | حداکثر ۵۰۰ کاراکتر |
| `reviewed_at` | timestamptz, nullable | |
| `reviewed_by` | text, nullable | ایمیل مدیر یا «کیوسک» |
| `updated_at` | timestamptz | |

- **No card number**: هیچ ستونی برای شمارهٔ کارت (حتی ماسک‌شده) وجود ندارد (FR-007a).
- **RLS**: SELECT برای مدیر یا حالت بدون رمز. UPDATE فقط روی ستون‌های بررسی و فقط از طریق تابع
  `review_pos_transaction`. INSERT فقط از طریق `kiosk_sync_review_transactions`.
- **ایندکس**: `(occurred_at)`.

### State transitions — بررسی

```text
[ارسال از کیوسک] → reviewed = false ──(«بررسی شد» روی کیوسک یا از راه دور)──► reviewed = true
                                     (یک‌طرفه؛ بازگشت ندارد. اولین بررسی، یادداشت و زمانش می‌ماند)
```

`status` ممکن است با ارسال بعدی کیوسک عوض شود (مثلاً `uncertain` → `approved_late`)، ولی `reviewed`
از `true` به `false` برنمی‌گردد.

### گزارش روزانه (محاسبه‌ای — ذخیره نمی‌شود)

خروجی `daily_sales_report(p_day)`؛ ساختار دقیق در
[contracts/daily-sales-report.md](./contracts/daily-sales-report.md).

## کیوسک (سرویس کارت‌خوان)

### `PosTransaction` در دفتر `transactions.jsonl` (موجود — سه فیلد تازه)

| Field | Notes |
| --- | --- |
| `UpdatedAt` | **تازه.** هر تغییر وضعیت یا بررسی آن را به‌روز می‌کند. ملاک «چه چیزی باید فرستاده شود» |
| `ReviewedAt` | **تازه.** زمان «بررسی شد» |
| `ReviewedBy` | **تازه.** «کیوسک» یا ایمیل مدیری که از راه دور بررسی کرده |

`MaskedPan` در دفتر محلی می‌ماند، ولی هرگز در بدنهٔ همگام‌سازی نمی‌آید.

### `appsettings.json` (موجود — کلیدهای تازه)

| Key | Default | Notes |
| --- | --- | --- |
| `syncEnabled` | `false` | بعد از جفت کردن `true` می‌شود |
| `supabaseUrl` | `""` | عمومی |
| `supabaseKey` | `""` | کلید publishable (عمومی) |
| `kioskId` | `""` | UUID |
| `kioskSyncKey` | `""` | **راز.** فقط روی همین کامپیوتر؛ هرگز در مخزن (اصل II). از `/config` خوانده نمی‌شود |
| `syncIntervalSeconds` | `60` | بین ۳۰ تا ۳۰۰ |

### `data/sync-state.json` (تازه)

`{ "lastSyncedAt": "<ISO>", "lastError": "", "lastAttemptAt": "<ISO>" }`. وضعیت همگام‌سازی برای
`GET /sync/status` و پنل.
