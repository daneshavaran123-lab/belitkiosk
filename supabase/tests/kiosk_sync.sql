-- سناریوهای همگام‌سازی کیوسک و بخش «نیازمند بررسی» گزارش (T016). اجرا: bash supabase/tests/run.sh
-- هر بلوک DO با RAISE EXCEPTION شکست می‌خورد. now() داخل یک تراکنش ثابت است؛ زمان‌ها صریح ساخته می‌شوند.

CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated;

-- اجرای یک دستور با نقش فعلی؛ SQLSTATE خطا یا 'OK' را برمی‌گرداند
CREATE FUNCTION t.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'OK'; EXCEPTION WHEN others THEN RETURN SQLSTATE; END $$;

CREATE FUNCTION t.sync(p_rows jsonb, p_key text DEFAULT 'kiosk-secret-key-for-tests',
  p_since timestamptz DEFAULT NULL, p_now timestamptz DEFAULT now(),
  p_kiosk uuid DEFAULT '11111111-1111-1111-1111-111111111111') RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.kiosk_sync_review_transactions(p_kiosk, p_key, p_rows, p_since, p_now) $$;

CREATE FUNCTION t.row(p_id text, p_extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'transaction_id', p_id, 'occurred_at', now() - interval '1 hour', 'amount_rial', 1500000,
    'status', 'uncertain', 'reason', 'نتیجهٔ پرداخت نامطمئن است', 'invoice_number', 'INV-' || p_id,
    'rrn', '123456789012', 'needs_review', true, 'reviewed', false) || p_extra $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO anon, authenticated;

-- ---------- داده‌ها ----------
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'sync-admin@test'),
  ('00000000-0000-0000-0000-0000000000a2', 'plain-user@test');
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000a1', 'admin');
UPDATE public.app_settings SET value = 'false'::jsonb WHERE key = 'admin_open';
DELETE FROM public.invoices;

-- پیش از ثبت هر کیوسک: بخش review گزارش «در دسترس نیست» (null) است، نه صفر
DO $$
DECLARE r jsonb;
BEGIN
  r := public.daily_sales_report((now() AT TIME ZONE 'Asia/Tehran')::date);
  IF r -> 'review' <> 'null'::jsonb THEN RAISE EXCEPTION 'review must be null without kiosks: %', r -> 'review'; END IF;
END $$;

-- ---------- ثبت کیوسک ----------
BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF t.err($q$SELECT public.register_kiosk('11111111-1111-1111-1111-111111111111', 'x', repeat('a', 64))$q$) <> '42501' THEN
    RAISE EXCEPTION 'anon registered a kiosk while the panel has a password';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-0000000000a2';
DO $$
BEGIN
  IF t.err($q$SELECT public.register_kiosk('11111111-1111-1111-1111-111111111111', 'x', repeat('a', 64))$q$) <> '42501' THEN
    RAISE EXCEPTION 'non-admin registered a kiosk';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-0000000000a1';
DO $$
DECLARE k record;
BEGIN
  PERFORM public.register_kiosk('11111111-1111-1111-1111-111111111111', '  کیوسک ورودی  ',
    encode(sha256(convert_to('kiosk-secret-key-for-tests', 'UTF8')), 'hex'));
  SELECT id, name INTO k FROM public.kiosk_devices;
  IF k.name <> 'کیوسک ورودی' THEN RAISE EXCEPTION 'name not trimmed: %', k.name; END IF;
  IF t.err($q$SELECT public.register_kiosk('22222222-2222-2222-2222-222222222222', 'bad', 'not-a-hash')$q$) <> '23514' THEN
    RAISE EXCEPTION 'invalid key_hash accepted';
  END IF;
  -- key_hash برای هیچ نقشی خواندنی نیست؛ ستون‌های دیگر هستند
  IF t.err('SELECT key_hash FROM public.kiosk_devices') <> '42501' THEN RAISE EXCEPTION 'key_hash is readable'; END IF;
  IF t.err('SELECT * FROM public.kiosk_devices') <> '42501' THEN RAISE EXCEPTION 'SELECT * exposes key_hash'; END IF;
  IF t.err('SELECT id, name, last_sync_at FROM public.kiosk_devices') <> 'OK' THEN RAISE EXCEPTION 'safe columns unreadable'; END IF;
  -- نوشتن مستقیم ممنوع است
  IF t.err($q$UPDATE public.kiosk_devices SET key_hash = repeat('b', 64)$q$) <> '42501' THEN RAISE EXCEPTION 'direct UPDATE allowed'; END IF;
  IF t.err($q$DELETE FROM public.kiosk_devices$q$) <> '42501' THEN RAISE EXCEPTION 'direct DELETE allowed'; END IF;
END $$;
ROLLBACK;

-- در حالت بدون رمز، ثبت کیوسک برای هر بازدیدکننده باز است (استثنای FR-007b)
BEGIN;
UPDATE public.app_settings SET value = 'true'::jsonb WHERE key = 'admin_open';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF t.err($q$SELECT public.register_kiosk('33333333-3333-3333-3333-333333333333', 'open', repeat('c', 64))$q$) <> 'OK' THEN
    RAISE EXCEPTION 'open mode should allow registering';
  END IF;
END $$;
ROLLBACK;

-- ---------- کیوسک را به‌صورت مستقیم می‌سازیم (postgres) و همگام‌سازی را امتحان می‌کنیم ----------
INSERT INTO public.kiosk_devices (id, name, key_hash) VALUES
  ('11111111-1111-1111-1111-111111111111', 'کیوسک ۱', encode(sha256(convert_to('kiosk-secret-key-for-tests', 'UTF8')), 'hex')),
  ('22222222-2222-2222-2222-222222222222', 'کیوسک ۲', encode(sha256(convert_to('other-kiosk-key', 'UTF8')), 'hex'));

BEGIN;
SET LOCAL ROLE anon;
DO $$
DECLARE r jsonb; s record;
BEGIN
  -- کلید نادرست و کیوسک ناشناخته: یک خطای یکسان (۴۲۵۰۱) و هیچ چیزی ثبت نمی‌شود
  IF t.err($q$SELECT t.sync(jsonb_build_array(t.row('x')), 'wrong-key')$q$) <> '42501' THEN RAISE EXCEPTION 'wrong key accepted'; END IF;
  IF t.err($q$SELECT t.sync(jsonb_build_array(t.row('x')), 'kiosk-secret-key-for-tests', NULL, now(), '99999999-9999-9999-9999-999999999999')$q$) <> '42501' THEN
    RAISE EXCEPTION 'unknown kiosk accepted';
  END IF;
  BEGIN
    PERFORM t.sync('[]'::jsonb, 'wrong-key');
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'invalid kiosk key' THEN RAISE EXCEPTION 'error text differs: %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM t.sync('[]'::jsonb, 'wrong-key', NULL, now(), '99999999-9999-9999-9999-999999999999');
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'invalid kiosk key' THEN RAISE EXCEPTION 'unknown kiosk reveals itself: %', SQLERRM; END IF;
  END;

  -- بدنهٔ نادرست
  IF t.err($q$SELECT t.sync('{"a":1}'::jsonb)$q$) <> '22023' THEN RAISE EXCEPTION 'non-array accepted'; END IF;
  IF t.err($q$SELECT t.sync((SELECT jsonb_agg(t.row('r' || g)) FROM generate_series(1, 501) g))$q$) <> '22023' THEN
    RAISE EXCEPTION '501 rows accepted';
  END IF;
  IF (SELECT count(*) FROM (SELECT 1) x) <> 1 THEN RAISE EXCEPTION 'sanity'; END IF;
END $$;
ROLLBACK;

-- ---------- ثبت و به‌روزرسانی ----------
BEGIN;
SET LOCAL ROLE anon;
DO $$
DECLARE r jsonb;
BEGIN
  -- حداکثر ۵۰۰ ردیف پذیرفته می‌شود
  r := t.sync((SELECT jsonb_agg(t.row('bulk' || g)) FROM generate_series(1, 500) g));
  IF (r ->> 'rejected')::int <> 0 THEN RAISE EXCEPTION '500 rows: %', r; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.pos_review_transactions) <> 500 THEN RAISE EXCEPTION 'expected 500 stored rows'; END IF;
  DELETE FROM public.pos_review_transactions;
END $$;
SET LOCAL ROLE anon;
DO $$
DECLARE r jsonb;
BEGIN
  -- ردیف تازه + ارسال دوباره: یک ردیف می‌ماند؛ وضعیت به‌روز، زمان و مبلغ ثابت
  r := t.sync(jsonb_build_array(t.row('a')));
  IF jsonb_typeof(r -> 'remote_reviews') <> 'array' OR r ->> 'server_time' IS NULL THEN RAISE EXCEPTION 'response shape: %', r; END IF;
  r := t.sync(jsonb_build_array(t.row('a', jsonb_build_object(
    'status', 'approved_late', 'reason', 'تأیید پس از لغو یا پایان زمان رسید',
    'amount_rial', 999, 'occurred_at', now() - interval '9 hours'))));
END $$;
RESET ROLE;
DO $$
DECLARE x record;
BEGIN
  IF (SELECT count(*) FROM public.pos_review_transactions) <> 1 THEN RAISE EXCEPTION 'duplicate rows after resend'; END IF;
  SELECT * INTO x FROM public.pos_review_transactions;
  IF x.status <> 'approved_late' THEN RAISE EXCEPTION 'status not updated: %', x.status; END IF;
  IF x.amount_rial <> 1500000 THEN RAISE EXCEPTION 'amount changed on resend: %', x.amount_rial; END IF;
  IF abs(extract(epoch FROM (x.occurred_at - (now() - interval '1 hour')))) > 1 THEN RAISE EXCEPTION 'occurred_at changed on resend: %', x.occurred_at; END IF;
  IF x.invoice_number <> 'INV-a' OR x.rrn <> '123456789012' OR NOT x.needs_review OR x.reviewed THEN RAISE EXCEPTION 'fields: %', row_to_json(x); END IF;
  IF (SELECT last_sync_at FROM public.kiosk_devices WHERE id = '11111111-1111-1111-1111-111111111111') IS NULL THEN
    RAISE EXCEPTION 'last_sync_at not set';
  END IF;
  -- هیچ ستونی برای شمارهٔ کارت وجود ندارد
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pos_review_transactions'
             AND (column_name ILIKE '%pan%' OR column_name ILIKE '%card%')) THEN
    RAISE EXCEPTION 'a card-number column exists';
  END IF;
END $$;
SET LOCAL ROLE anon;
DO $$
DECLARE r jsonb;
BEGIN
  -- کلید ناشناخته (masked_pan) نادیده گرفته می‌شود و جایی ذخیره نمی‌شود
  r := t.sync(jsonb_build_array(t.row('pan', jsonb_build_object('masked_pan', '603799******7391', 'card', '6037997391'))));
  IF (r ->> 'rejected')::int <> 0 THEN RAISE EXCEPTION 'unknown keys rejected the row: %', r; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pos_review_transactions t WHERE row_to_json(t)::text LIKE '%7391%' OR row_to_json(t)::text LIKE '%603799%') THEN
    RAISE EXCEPTION 'card data was stored';
  END IF;
END $$;
SET LOCAL ROLE anon;
DO $$
DECLARE r jsonb;
BEGIN
  -- یک ردیف خراب همگام‌سازی بقیه را نمی‌بندد
  r := t.sync(jsonb_build_array(
    t.row('good1'),
    t.row('badamount', jsonb_build_object('amount_rial', -5)),
    t.row('badtime', jsonb_build_object('occurred_at', 'not a time')),
    t.row('good2')));
  IF (r ->> 'rejected')::int <> 2 THEN RAISE EXCEPTION 'rejected count: %', r; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pos_review_transactions WHERE transaction_id = 'good1')
     OR NOT EXISTS (SELECT 1 FROM public.pos_review_transactions WHERE transaction_id = 'good2')
     OR EXISTS (SELECT 1 FROM public.pos_review_transactions WHERE transaction_id IN ('badamount', 'badtime')) THEN
    RAISE EXCEPTION 'bad row handling';
  END IF;
END $$;
ROLLBACK;

-- ---------- اصلاح ساعت کیوسک ----------
BEGIN;
SET LOCAL ROLE anon;
DO $$
DECLARE r jsonb;
BEGIN
  -- ساعت کیوسک ۳ ساعت عقب است: زمان ردیف با همان اختلاف اصلاح می‌شود
  r := t.sync(jsonb_build_array(t.row('late-clock', jsonb_build_object('occurred_at', now() - interval '3 hours'))),
    'kiosk-secret-key-for-tests', NULL, now() - interval '3 hours');
  IF abs((r ->> 'clock_offset_seconds')::numeric - 10800) > 5 THEN RAISE EXCEPTION 'offset: %', r ->> 'clock_offset_seconds'; END IF;
  -- اختلاف کمتر از ۲ دقیقه دست نمی‌خورد
  r := t.sync(jsonb_build_array(t.row('ok-clock', jsonb_build_object('occurred_at', now() - interval '1 hour'))),
    'kiosk-secret-key-for-tests', NULL, now() - interval '30 seconds');
  IF abs((r ->> 'clock_offset_seconds')::numeric - 30) > 5 THEN RAISE EXCEPTION 'small offset: %', r ->> 'clock_offset_seconds'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF abs(extract(epoch FROM ((SELECT occurred_at FROM public.pos_review_transactions WHERE transaction_id = 'late-clock') - now()))) > 5 THEN
    RAISE EXCEPTION 'late clock not corrected';
  END IF;
  IF abs(extract(epoch FROM ((SELECT occurred_at FROM public.pos_review_transactions WHERE transaction_id = 'ok-clock') - (now() - interval '1 hour')))) > 1 THEN
    RAISE EXCEPTION 'small skew was modified';
  END IF;
END $$;
ROLLBACK;

-- ---------- بررسی: یک‌طرفه، از کیوسک و از راه دور ----------
BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  PERFORM t.sync(jsonb_build_array(t.row('k1'), t.row('r1'), t.row('r2')));
  -- بررسی روی کیوسک
  PERFORM t.sync(jsonb_build_array(t.row('k1', jsonb_build_object(
    'needs_review', false, 'reviewed', true, 'review_note', 'روی دستگاه دیدم', 'reviewed_at', now()))));
END $$;
RESET ROLE;
DO $$
DECLARE x record;
BEGIN
  SELECT * INTO x FROM public.pos_review_transactions WHERE transaction_id = 'k1';
  IF NOT x.reviewed OR x.reviewed_by <> 'کیوسک' OR x.review_note <> 'روی دستگاه دیدم' THEN RAISE EXCEPTION 'kiosk review: %', row_to_json(x); END IF;
END $$;
SET LOCAL ROLE anon;
DO $$
BEGIN
  -- ارسال بعدی با reviewed=false بررسی را برنمی‌گرداند و یادداشت اول می‌ماند
  PERFORM t.sync(jsonb_build_array(t.row('k1', jsonb_build_object('reviewed', false, 'review_note', 'دیگر'))));
END $$;
RESET ROLE;
DO $$
DECLARE x record;
BEGIN
  SELECT * INTO x FROM public.pos_review_transactions WHERE transaction_id = 'k1';
  IF NOT x.reviewed OR x.review_note <> 'روی دستگاه دیدم' THEN RAISE EXCEPTION 'review was undone: %', row_to_json(x); END IF;
END $$;

-- بررسی از راه دور: غیرمدیر نمی‌تواند، تراکنش ناشناخته خطا می‌دهد، مدیر می‌تواند
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-0000000000a2';
DO $$
BEGIN
  IF t.err($q$SELECT public.review_pos_transaction('11111111-1111-1111-1111-111111111111', 'r1', 'x')$q$) <> '42501' THEN
    RAISE EXCEPTION 'non-admin reviewed';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-0000000000a1';
SET LOCAL "request.jwt.claims" = '{"email":"sync-admin@test"}';
DO $$
BEGIN
  IF t.err($q$SELECT public.review_pos_transaction('11111111-1111-1111-1111-111111111111', 'nope', 'x')$q$) <> 'P0002' THEN
    RAISE EXCEPTION 'unknown transaction did not raise';
  END IF;
  PERFORM public.review_pos_transaction('11111111-1111-1111-1111-111111111111', 'r1', '  تطبیق شد  ');
  PERFORM public.review_pos_transaction('11111111-1111-1111-1111-111111111111', 'r2', '');
  -- بار دوم چیزی را عوض نمی‌کند
  PERFORM public.review_pos_transaction('11111111-1111-1111-1111-111111111111', 'r1', 'دوم');
END $$;
RESET ROLE;
DO $$
DECLARE x record;
BEGIN
  SELECT * INTO x FROM public.pos_review_transactions WHERE transaction_id = 'r1';
  IF NOT x.reviewed OR x.reviewed_by <> 'sync-admin@test' OR x.review_note <> 'تطبیق شد' THEN RAISE EXCEPTION 'remote review: %', row_to_json(x); END IF;
  SELECT * INTO x FROM public.pos_review_transactions WHERE transaction_id = 'r2';
  IF NOT x.reviewed OR x.review_note IS NOT NULL THEN RAISE EXCEPTION 'optional note: %', row_to_json(x); END IF;
END $$;

-- کیوسک بررسی راه دور را در پاسخ همگام‌سازی می‌گیرد؛ ارسال خودش آن را برنمی‌گرداند
SET LOCAL ROLE anon;
DO $$
DECLARE r jsonb;
BEGIN
  r := t.sync(jsonb_build_array(t.row('r1')), 'kiosk-secret-key-for-tests', now() - interval '1 minute');
  IF jsonb_array_length(r -> 'remote_reviews') <> 2 THEN RAISE EXCEPTION 'remote_reviews: %', r -> 'remote_reviews'; END IF;
  IF NOT (SELECT bool_and(e ->> 'reviewed_by' IN ('sync-admin@test')) FROM jsonb_array_elements(r -> 'remote_reviews') e) THEN
    RAISE EXCEPTION 'remote reviewer: %', r -> 'remote_reviews';
  END IF;
  IF (SELECT e ->> 'review_note' FROM jsonb_array_elements(r -> 'remote_reviews') e WHERE e ->> 'transaction_id' = 'r1') <> 'تطبیق شد' THEN
    RAISE EXCEPTION 'remote note: %', r -> 'remote_reviews';
  END IF;
  -- بررسی خود کیوسک (k1) در remote_reviews نیست
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'remote_reviews') e WHERE e ->> 'transaction_id' = 'k1') THEN
    RAISE EXCEPTION 'kiosk-side review echoed back';
  END IF;
  -- با علامت زمانی خیلی دیرتر، چیزی برنمی‌گردد
  r := t.sync('[]'::jsonb, 'kiosk-secret-key-for-tests', now() + interval '10 minutes');
  IF jsonb_array_length(r -> 'remote_reviews') <> 0 THEN RAISE EXCEPTION 'since filter ignored: %', r -> 'remote_reviews'; END IF;
  -- کیوسک دیگر بررسی‌های این کیوسک را نمی‌بیند
  r := public.kiosk_sync_review_transactions('22222222-2222-2222-2222-222222222222', 'other-kiosk-key', '[]'::jsonb, NULL, now());
  IF jsonb_array_length(r -> 'remote_reviews') <> 0 THEN RAISE EXCEPTION 'reviews leaked across kiosks'; END IF;
  -- ارسال کیوسک با reviewed=false بررسی راه دور را برنمی‌گرداند
  PERFORM t.sync(jsonb_build_array(t.row('r1')));
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT (SELECT reviewed FROM public.pos_review_transactions WHERE transaction_id = 'r1') THEN RAISE EXCEPTION 'remote review undone by kiosk push'; END IF;
END $$;
ROLLBACK;

-- ---------- دسترسی و RLS ----------
BEGIN;
INSERT INTO public.pos_review_transactions (kiosk_id, transaction_id, occurred_at, amount_rial, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'acl', now(), 1000, 'uncertain');
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.pos_review_transactions) <> 0 THEN RAISE EXCEPTION 'anon sees review transactions'; END IF;
  IF (SELECT count(*) FROM public.kiosk_devices) <> 0 THEN RAISE EXCEPTION 'anon sees kiosks'; END IF;
  IF (SELECT count(*) FROM public.review_transactions_for_day((now() AT TIME ZONE 'Asia/Tehran')::date)) <> 0 THEN RAISE EXCEPTION 'anon sees the review list'; END IF;
  IF (public.daily_sales_report((now() AT TIME ZONE 'Asia/Tehran')::date) -> 'review') <> 'null'::jsonb THEN RAISE EXCEPTION 'anon sees review summary'; END IF;
  IF t.err($q$INSERT INTO public.pos_review_transactions (kiosk_id, transaction_id, occurred_at, amount_rial, status)
              VALUES ('11111111-1111-1111-1111-111111111111', 'x', now(), 1, 's')$q$) <> '42501' THEN RAISE EXCEPTION 'anon INSERT'; END IF;
  IF t.err($q$UPDATE public.pos_review_transactions SET reviewed = true$q$) <> '42501' THEN RAISE EXCEPTION 'anon UPDATE'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-0000000000a1';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.pos_review_transactions) <> 1 THEN RAISE EXCEPTION 'admin cannot see review transactions'; END IF;
  IF t.err($q$INSERT INTO public.pos_review_transactions (kiosk_id, transaction_id, occurred_at, amount_rial, status)
              VALUES ('11111111-1111-1111-1111-111111111111', 'x', now(), 1, 's')$q$) <> '42501' THEN RAISE EXCEPTION 'admin direct INSERT'; END IF;
  IF t.err($q$UPDATE public.pos_review_transactions SET reviewed = true$q$) <> '42501' THEN RAISE EXCEPTION 'admin direct UPDATE'; END IF;
  IF t.err($q$DELETE FROM public.pos_review_transactions$q$) <> '42501' THEN RAISE EXCEPTION 'admin direct DELETE'; END IF;
END $$;
RESET ROLE;
-- حالت بدون رمز: همان دسترسی مدیر
UPDATE public.app_settings SET value = 'true'::jsonb WHERE key = 'admin_open';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.pos_review_transactions) <> 1 THEN RAISE EXCEPTION 'open mode: anon cannot see'; END IF;
  IF t.err($q$SELECT public.review_pos_transaction('11111111-1111-1111-1111-111111111111', 'acl', 'x')$q$) <> 'OK' THEN RAISE EXCEPTION 'open mode: anon cannot review'; END IF;
END $$;
ROLLBACK;

-- ---------- بخش review گزارش و فهرست یک روز ----------
DO $$
DECLARE d date := (now() AT TIME ZONE 'Asia/Tehran')::date;
BEGIN
  -- امروز: ۲ بررسی‌نشده (۱٬۰۰۰ + ۲٬۰۰۰)، ۱ بررسی‌شده (۴٬۰۰۰)، ۱ نگرانی‌برطرف‌شده (۸٬۰۰۰، شمرده نمی‌شود)
  -- مرز روز: ۲۳:۵۹ دیروز و ۰۰:۰۱ امروز هر کدام در روز خودش؛ یک ردیف کیوسک ۲ هم هست
  INSERT INTO public.pos_review_transactions (kiosk_id, transaction_id, occurred_at, amount_rial, status, needs_review, reviewed, reviewed_by) VALUES
    ('11111111-1111-1111-1111-111111111111', 'p1', ((d::text || ' 10:00')::timestamp AT TIME ZONE 'Asia/Tehran'), 1000, 'uncertain', true, false, NULL),
    ('11111111-1111-1111-1111-111111111111', 'p2', ((d::text || ' 11:00')::timestamp AT TIME ZONE 'Asia/Tehran'), 2000, 'approved_late', true, false, NULL),
    ('11111111-1111-1111-1111-111111111111', 'v1', ((d::text || ' 12:00')::timestamp AT TIME ZONE 'Asia/Tehran'), 4000, 'timeout', false, true, 'کیوسک'),
    ('11111111-1111-1111-1111-111111111111', 'z1', ((d::text || ' 13:00')::timestamp AT TIME ZONE 'Asia/Tehran'), 8000, 'declined', false, false, NULL),
    ('22222222-2222-2222-2222-222222222222', 'o1', ((d::text || ' 14:00')::timestamp AT TIME ZONE 'Asia/Tehran'), 16000, 'uncertain', true, false, NULL),
    ('11111111-1111-1111-1111-111111111111', 'y1', (((d - 1)::text || ' 23:59')::timestamp AT TIME ZONE 'Asia/Tehran'), 32000, 'uncertain', true, false, NULL);
  UPDATE public.kiosk_devices SET last_sync_at = now() WHERE id = '11111111-1111-1111-1111-111111111111';
END $$;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-0000000000a1';
DO $$
DECLARE d date := (now() AT TIME ZONE 'Asia/Tehran')::date; r jsonb; ids text;
BEGIN
  r := public.daily_sales_report(d) -> 'review';
  IF (r #>> '{pending,count}')::int <> 3 OR (r #>> '{pending,amount_rial}')::bigint <> 19000 THEN RAISE EXCEPTION 'pending: %', r -> 'pending'; END IF;
  IF (r #>> '{reviewed,count}')::int <> 1 OR (r #>> '{reviewed,amount_rial}')::bigint <> 4000 THEN RAISE EXCEPTION 'reviewed: %', r -> 'reviewed'; END IF;
  IF r ->> 'last_sync_at' IS NULL THEN RAISE EXCEPTION 'last_sync_at missing'; END IF;

  -- دیروز: فقط y1
  r := public.daily_sales_report(d - 1) -> 'review';
  IF (r #>> '{pending,count}')::int <> 1 OR (r #>> '{pending,amount_rial}')::bigint <> 32000 THEN RAISE EXCEPTION 'yesterday: %', r; END IF;

  -- فهرست: نگرانی‌برطرف‌شده (z1) نیست، بقیه به ترتیب زمان
  SELECT string_agg(transaction_id, ',' ORDER BY occurred_at) INTO ids FROM public.review_transactions_for_day(d);
  IF ids <> 'p1,p2,v1,o1' THEN RAISE EXCEPTION 'list: %', ids; END IF;
  IF (SELECT count(*) FROM public.review_transactions_for_day(d) WHERE kiosk_name = 'کیوسک ۲') <> 1 THEN RAISE EXCEPTION 'kiosk name missing'; END IF;
  SELECT string_agg(transaction_id, ',') INTO ids FROM public.review_transactions_for_day(d - 1);
  IF ids <> 'y1' THEN RAISE EXCEPTION 'yesterday list: %', ids; END IF;
END $$;
ROLLBACK;
