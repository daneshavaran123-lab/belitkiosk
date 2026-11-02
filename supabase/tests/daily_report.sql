-- سناریوهای گزارش فروش روزانه (T006). اجرا: bash supabase/tests/run.sh
-- هر بلوک DO با RAISE EXCEPTION شکست می‌خورد و run.sh را ناموفق می‌کند.

-- ---------- داده‌ها (با کاربر postgres) ----------
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000a1', 'report-admin@test');
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000a1', 'admin');
UPDATE public.app_settings SET value = 'false'::jsonb WHERE key = 'admin_open';
-- فاکتورهای نمونهٔ migrationهای seed کنار گذاشته می‌شوند تا سناریو فقط به دادهٔ خودش وابسته باشد
DELETE FROM public.invoices;

CREATE TEMP TABLE ctx AS
SELECT (now() AT TIME ZONE 'Asia/Tehran')::date AS today,
       (SELECT id FROM public.ticket_types WHERE category = 'normal' ORDER BY id LIMIT 1) AS normal_id,
       (SELECT id FROM public.ticket_types WHERE category = 'guided' ORDER BY id LIMIT 1) AS guided_id;
GRANT SELECT ON ctx TO anon, authenticated;

-- زمان «امروز ساعت hh:mm به وقت تهران» (همیشه پیش از الان، جز در دقیقهٔ اول روز)
CREATE FUNCTION pg_temp.at_tehran(d date, hhmm text) RETURNS timestamptz
LANGUAGE sql AS $$ SELECT (d::text || ' ' || hhmm)::timestamp AT TIME ZONE 'Asia/Tehran' $$;

DO $$
DECLARE c ctx; inv uuid;
BEGIN
  SELECT * INTO c FROM ctx;
  -- امروز: ۳ کارتی و ۲ نقدی
  INSERT INTO invoices (invoice_number, total, payment_method, created_at) VALUES
    ('T-C1', 100000, 'card', pg_temp.at_tehran(c.today, '00:01')),
    ('T-C2', 200000, 'card', pg_temp.at_tehran(c.today, '00:01')),
    ('T-C3', 300000, 'card', pg_temp.at_tehran(c.today, '00:01')),
    ('T-H1', 50000, 'cash', pg_temp.at_tehran(c.today, '00:01')),
    ('T-H2', 50000, 'cash', pg_temp.at_tehran(c.today, '00:01'));
  -- بلیط‌ها: ۲ عادی، ۱۰ با راهنما (گروهی)، و یک ردیف قدیمی بدون نوع
  SELECT id INTO inv FROM invoices WHERE invoice_number = 'T-C1';
  INSERT INTO invoice_items (invoice_id, name, quantity, unit_price, total_price, item_type, reference_id)
    VALUES (inv, 'بلیط عادی', 2, 50000, 100000, 'ticket', c.normal_id);
  SELECT id INTO inv FROM invoices WHERE invoice_number = 'T-C2';
  INSERT INTO invoice_items (invoice_id, name, quantity, unit_price, discount_percent, total_price, item_type, reference_id)
    VALUES (inv, 'بلیط با راهنما (گروهی)', 10, 25000, 20, 200000, 'ticket', c.guided_id);
  SELECT id INTO inv FROM invoices WHERE invoice_number = 'T-H1';
  INSERT INTO invoice_items (invoice_id, name, quantity, unit_price, total_price)
    VALUES (inv, 'کتاب (فروش قدیمی)', 3, 10000, 30000);
  SELECT id INTO inv FROM invoices WHERE invoice_number = 'T-C3';
  INSERT INTO invoice_items (invoice_id, name, quantity, unit_price, total_price, item_type, reference_id)
    VALUES (inv, 'کافه', 1, 300000, 300000, 'product', 7);

  -- مرز روز: ۲۳:۵۹ روز قبل و ۰۰:۰۱ روز بعد (۲ و ۳ روز پیش)
  INSERT INTO invoices (invoice_number, total, payment_method, created_at) VALUES
    ('T-B1', 11000, 'card', pg_temp.at_tehran(c.today - 3, '23:59')),
    ('T-B2', 22000, 'card', pg_temp.at_tehran(c.today - 2, '00:01'));
END $$;

-- ---------- مدیر ----------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-0000000000a1';
DO $$
DECLARE c ctx; r jsonb;
BEGIN
  SELECT * INTO c FROM ctx;
  r := public.daily_sales_report(c.today);
  IF (r #>> '{sales,card,total}')::bigint <> 600000 THEN RAISE EXCEPTION 'card total: %', r -> 'sales'; END IF;
  IF (r #>> '{sales,card,count}')::int <> 3 THEN RAISE EXCEPTION 'card count: %', r -> 'sales'; END IF;
  IF (r #>> '{sales,cash,total}')::bigint <> 100000 THEN RAISE EXCEPTION 'cash total: %', r -> 'sales'; END IF;
  IF (r #>> '{sales,cash,count}')::int <> 2 THEN RAISE EXCEPTION 'cash count: %', r -> 'sales'; END IF;
  IF (r #>> '{sales,total}')::bigint <> 700000 THEN RAISE EXCEPTION 'total: %', r -> 'sales'; END IF;
  IF (r #>> '{sales,invoice_count}')::int <> 5 THEN RAISE EXCEPTION 'invoice_count: %', r -> 'sales'; END IF;
  IF (r #>> '{tickets,total}')::int <> 12 THEN RAISE EXCEPTION 'tickets total: %', r -> 'tickets'; END IF;
  IF (r #>> '{tickets,untyped_lines_quantity}')::int <> 3 THEN RAISE EXCEPTION 'untyped: %', r -> 'tickets'; END IF;
  IF r #>> '{tickets,by_type,0,category}' <> 'normal' OR (r #>> '{tickets,by_type,0,quantity}')::int <> 2
     OR r #>> '{tickets,by_type,1,category}' <> 'guided' OR (r #>> '{tickets,by_type,1,quantity}')::int <> 10
     OR jsonb_array_length(r #> '{tickets,by_type}') <> 2 THEN
    RAISE EXCEPTION 'by_type: %', r #> '{tickets,by_type}';
  END IF;
  IF (r ->> 'is_today')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'is_today'; END IF;
  IF r -> 'review' <> 'null'::jsonb THEN RAISE EXCEPTION 'review should be null: %', r -> 'review'; END IF;

  -- مرز روز تهران
  r := public.daily_sales_report(c.today - 3);
  IF (r #>> '{sales,total}')::bigint <> 11000 THEN RAISE EXCEPTION 'boundary day-3: %', r -> 'sales'; END IF;
  r := public.daily_sales_report(c.today - 2);
  IF (r #>> '{sales,total}')::bigint <> 22000 THEN RAISE EXCEPTION 'boundary day-2: %', r -> 'sales'; END IF;
  IF (r ->> 'is_today')::boolean THEN RAISE EXCEPTION 'is_today for past day'; END IF;

  -- روز بدون فروش
  r := public.daily_sales_report(c.today - 10);
  IF (r #>> '{sales,invoice_count}')::int <> 0 OR (r #>> '{tickets,total}')::int <> 0 THEN
    RAISE EXCEPTION 'empty day: %', r;
  END IF;

  -- روز آینده
  BEGIN
    PERFORM public.daily_sales_report(c.today + 1);
    RAISE EXCEPTION 'future day accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;
ROLLBACK;

-- ---------- بدون دسترسی: anon با حالت بدون رمز خاموش ----------
BEGIN;
SET LOCAL ROLE anon;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.daily_sales_report((SELECT today FROM ctx));
  IF (r #>> '{sales,invoice_count}')::int <> 0 OR (r #>> '{sales,total}')::bigint <> 0
     OR (r #>> '{tickets,total}')::int <> 0 THEN
    RAISE EXCEPTION 'anon sees data: %', r;
  END IF;
END $$;
ROLLBACK;

-- ---------- قیدها ----------
DO $$
BEGIN
  BEGIN
    INSERT INTO invoice_items (invoice_id, name, quantity, unit_price, total_price, item_type)
    SELECT id, 'بلیط بی‌نوع', 1, 1, 1, 'ticket' FROM invoices LIMIT 1;
    RAISE EXCEPTION 'ticket without reference_id accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO invoice_items (invoice_id, name, quantity, unit_price, total_price, item_type)
    SELECT id, 'نوع نامعتبر', 1, 1, 1, 'gift' FROM invoices LIMIT 1;
    RAISE EXCEPTION 'unknown item_type accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- ---------- فقط خواندنی (FR-011) ----------
DO $$
DECLARE p record;
BEGIN
  SELECT provolatile, prosecdef INTO p FROM pg_proc WHERE proname = 'daily_sales_report';
  IF p.provolatile <> 's' THEN RAISE EXCEPTION 'daily_sales_report must be STABLE'; END IF;
  IF p.prosecdef THEN RAISE EXCEPTION 'daily_sales_report must be SECURITY INVOKER'; END IF;
END $$;

-- ---------- کارایی (SC-001): ۱٬۰۰۰ فاکتور با ۲ ردیف ----------
DO $$
DECLARE c ctx;
BEGIN
  SELECT * INTO c FROM ctx;
  WITH inv AS (
    INSERT INTO invoices (invoice_number, total, payment_method, created_at)
    SELECT 'P-' || g, 1000 + g, CASE WHEN g % 3 = 0 THEN 'cash' ELSE 'card' END,
           pg_temp.at_tehran(c.today - 5, '10:00') + (g || ' seconds')::interval
    FROM generate_series(1, 1000) g
    RETURNING id
  )
  INSERT INTO invoice_items (invoice_id, name, quantity, unit_price, total_price, item_type, reference_id)
  SELECT id, 'بلیط', 1, 1000, 1000, 'ticket', c.normal_id FROM inv
  UNION ALL
  SELECT id, 'کافه', 1, 500, 500, 'product', 1 FROM inv;
END $$;
ANALYZE invoices;
ANALYZE invoice_items;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-0000000000a1';
DO $$
DECLARE t0 timestamptz; ms numeric; r jsonb;
BEGIN
  t0 := clock_timestamp();
  r := public.daily_sales_report((SELECT today FROM ctx) - 5);
  ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  IF (r #>> '{sales,invoice_count}')::int <> 1000 OR (r #>> '{tickets,total}')::int <> 1000 THEN
    RAISE EXCEPTION 'perf data: %', r;
  END IF;
  IF ms > 500 THEN RAISE EXCEPTION 'daily_sales_report took % ms (> 500)', round(ms); END IF;
  RAISE NOTICE 'daily_sales_report (1000 invoices): % ms', round(ms, 1);
END $$;
ROLLBACK;
