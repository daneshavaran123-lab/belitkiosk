# Contract: `daily_sales_report(p_day date) → jsonb`

تابع دیتابیس (`SECURITY INVOKER`، `STABLE`) که صفحهٔ گزارش با `supabase.rpc("daily_sales_report",
{ p_day })` صدا می‌زند. چون INVOKER است، فقط مدیر یا حالت بدون رمز داده می‌بیند. برای بقیه، جمع‌ها
صفر و `review` برابر `null` برمی‌گردد. صفحه این حالت را با نتیجهٔ `has_role` / `admin_open_mode`
تشخیص می‌دهد و «دسترسی ندارید» نشان می‌دهد، نه صفر.

## Request

| Param | Type | Rules |
| --- | --- | --- |
| `p_day` | `date` (`YYYY-MM-DD` میلادی) | روز به وقت تهران. روز آینده → خطای `22023` («روز آینده قابل گزارش نیست») |

## Response

```json
{
  "day": "2026-10-30",
  "generated_at": "2026-10-30T18:42:10Z",
  "is_today": true,
  "sales": {
    "card": { "total": 600000, "count": 3 },
    "cash": { "total": 100000, "count": 2 },
    "total": 700000,
    "invoice_count": 5
  },
  "tickets": {
    "total": 12,
    "by_type": [
      { "ticket_type_id": 1, "name": "بلیط عادی", "category": "normal", "quantity": 2 },
      { "ticket_type_id": 2, "name": "بلیط با راهنما", "category": "guided", "quantity": 10 }
    ],
    "untyped_lines_quantity": 0
  },
  "review": {
    "pending": { "count": 2, "amount_rial": 1500000 },
    "reviewed": { "count": 1, "amount_rial": 500000 },
    "last_sync_at": "2026-10-30T18:40:02Z"
  }
}
```

- همهٔ مبالغ فروش به **تومان** (`bigint`) و مبالغ بررسی به **ریال**‌اند. نمایش هر دو به تومان است.
- `tickets.total` فقط جمع ردیف‌های `item_type = 'ticket'` است. `untyped_lines_quantity` جمع تعداد
  ردیف‌های قدیمی بدون نوع است که در UI «نامشخص» نمایش داده می‌شود.
- `by_type` به ترتیب `category` (`normal`، `guided`، `vip`) و بعد `name` مرتب است. نوعی که فروش
  نداشته نمی‌آید. اگر نوع بلیط حذف شده باشد، `name` برابر `null` است و UI «نوع حذف‌شده #id» می‌نویسد.
- `review` وقتی جدول‌ها هنوز وجود ندارند یا کیوسکی جفت نشده، `null` است و UI «در دسترس نیست» نشان
  می‌دهد (FR-010).
- `last_sync_at` بیشترین `kiosk_devices.last_sync_at` است و ممکن است `null` باشد.

## Errors

| Code | When | UI |
| --- | --- | --- |
| `22023` | روز آینده | جلوگیری در خود date picker. اگر رسید: «روز آینده قابل گزارش نیست» |
| `PGRST202` | تابع نیست (migration اجرا نشده) | «گزارش روزانه هنوز روی دیتابیس فعال نشده است» (fail closed) |
| network | قطعی | «ارتباط با سرور برقرار نشد» + «تلاش دوباره» |
