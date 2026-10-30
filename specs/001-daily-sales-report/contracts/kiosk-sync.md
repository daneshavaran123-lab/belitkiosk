# Contract: همگام‌سازی کیوسک ↔ سرور

## 1. `register_kiosk(p_kiosk_id uuid, p_name text, p_key_hash text) → void`

- `SECURITY DEFINER`. فقط وقتی `has_role(auth.uid(),'admin')` یا `admin_open_mode()` درست باشد، وگرنه
  خطای `42501`.
- `p_key_hash`: هگز کوچک ۶۴ کاراکتری (`sha256`) — با CHECK. کلید خام هرگز به سرور نمی‌رسد.
- اگر `p_kiosk_id` از قبل باشد، هش و نام را **جایگزین** می‌کند (جفت کردن دوباره پس از نصب مجدد).
- `GRANT EXECUTE` به `anon` و `authenticated` (خود تابع دسترسی را بررسی می‌کند).

## 2. `kiosk_sync_review_transactions(p_kiosk_id uuid, p_key text, p_rows jsonb, p_since timestamptz, p_kiosk_now timestamptz) → jsonb`

- `SECURITY DEFINER`. اول `sha256(p_key)` را با `kiosk_devices.key_hash` مقایسه می‌کند. اگر نخواند،
  خطای `42501` می‌دهد و هیچ چیزی ثبت نمی‌شود.
- `GRANT EXECUTE` به `anon` (سرویس کارت‌خوان بدون نشست کاربر و با کلید publishable صدا می‌زند).
- حداکثر ۵۰۰ ردیف در هر فراخوانی (بیشتر → خطای `22023`). سرویس دسته‌دسته می‌فرستد.
- `p_kiosk_now`: ساعت فعلی کیوسک (UTC) در لحظهٔ فراخوانی.
- **اصلاح ساعت کیوسک**:
  - تابع `offset := now() - p_kiosk_now` را حساب می‌کند.
  - اگر `abs(offset) > interval '2 minutes'` باشد، `occurred_at` هر ردیف با `offset` جابه‌جا ذخیره می‌شود؛ وگرنه همان مقدار کیوسک.
  - به این ترتیب روز گزارش با ساعت رسمی تهران تعیین می‌شود، حتی اگر ساعت کیوسک اشتباه باشد.
  - اختلاف در پاسخ (`clock_offset_seconds`) برمی‌گردد تا کیوسک هشدار بدهد.

### `p_rows` (آرایه)

```json
[
  {
    "transaction_id": "5f7f1365-…",
    "occurred_at": "2026-10-30T09:12:00Z",
    "amount_rial": 1500000,
    "status": "uncertain",
    "reason": "پاسخ دستگاه نامطمئن بود",
    "invoice_number": "INV-1403-000123",
    "rrn": "123456789012",
    "reviewed": false,
    "review_note": null,
    "reviewed_at": null
  }
]
```

- **کلیدهای مجاز فقط همین‌ها هستند.** هر کلید دیگری (مثل `masked_pan` یا `card`) نادیده گرفته
  می‌شود و هرگز ذخیره نمی‌شود. سرویس هم آن را نمی‌فرستد. این در تست هر دو طرف بررسی می‌شود.
- Upsert با کلید `(kiosk_id, transaction_id)`: فیلدهای غیر بررسی (`status`، `reason`، `rrn`، …)
  به‌روز می‌شوند. اگر ردیف ورودی `reviewed = true` باشد و ردیف سرور هنوز بررسی نشده باشد، بررسی با
  `reviewed_by = 'کیوسک'` ثبت می‌شود. بررسی هرگز از `true` به `false` برنمی‌گردد.
- `kiosk_devices.last_sync_at = now()`.

### Response

```json
{
  "server_time": "2026-10-30T09:13:01Z",
  "clock_offset_seconds": 4,
  "remote_reviews": [
    {
      "transaction_id": "…",
      "review_note": "با رسید بانک تطبیق شد",
      "reviewed_at": "2026-10-30T10:00:00Z",
      "reviewed_by": "admin@example.com"
    }
  ]
}
```

- `remote_reviews`: ردیف‌های همین کیوسک که از راه دور بعد از `p_since` بررسی شده‌اند
  (`reviewed_by <> 'کیوسک'`). سرویس آن‌ها را در دفتر محلی اعمال و `server_time` را به‌عنوان `p_since`
  بعدی ذخیره می‌کند.
- `clock_offset_seconds`: `now() - p_kiosk_now` به ثانیه (مثبت یعنی ساعت کیوسک عقب است). سرویس آن را
  در `/sync/status` می‌گذارد و پنل اگر قدر مطلقش بیش از ۱۲۰ باشد، هشدار «ساعت کیوسک تنظیم نیست» می‌دهد.

## 3. `review_pos_transaction(p_kiosk_id uuid, p_transaction_id text, p_note text) → void`

- `SECURITY DEFINER`. فقط مدیر یا حالت بدون رمز. `reviewed = true`، `reviewed_at = now()`،
  `reviewed_by` برابر ایمیل کاربر (یا «حالت بدون رمز»). اگر از قبل بررسی شده، تغییری نمی‌دهد.

## 4. سرویس کارت‌خوان — مسیرهای HTTP تازه (روی `127.0.0.1:9099`، با `X-Pos-Token`)

| Method | Path | Body / Response |
| --- | --- | --- |
| `POST` | `/sync/pair` | `{}` → `{ kioskId, kioskKey }`. شناسه و کلید تازه می‌سازد و ذخیره می‌کند (همگام‌سازی هنوز خاموش). اگر از قبل باشد، کلید تازه می‌سازد |
| `POST` | `/sync/activate` | `{ supabaseUrl, supabaseKey, kioskName }` → `{ ok: true }`. فقط `https://…supabase.co` یا دامنهٔ معتبر https؛ `syncEnabled = true` |
| `GET` | `/sync/status` | `{ enabled, kioskId, lastSyncedAt, lastAttemptAt, lastError, pendingCount, clockOffsetSeconds }`. **بدون** کلید |
| `POST` | `/sync/disable` | `{}` → `{ ok: true }` |

- `/config` همچنان `kioskSyncKey` را نه برمی‌گرداند و نه می‌پذیرد (مثل `accessToken`).
- این مسیرها مثل بقیه پشت بررسی Origin و توکن‌اند.
