-- ============================================================
-- گزارش فروش روزانه — بخش US2: همگام‌سازی تراکنش‌های نیازمند بررسی (specs/001-daily-sales-report)
--
-- سرویس کارت‌خوان روی هر کیوسک هر دقیقه تراکنش‌های «نیازمند بررسی» را (بدون شمارهٔ کارت) به
-- kiosk_sync_review_transactions می‌فرستد؛ آن تابع با کلید اختصاصی کیوسک احراز هویت می‌کند و فقط
-- هش آن کلید (kiosk_devices.key_hash) در سرور است. مدیر از هر جا «بررسی شد» می‌زند.
--
-- وابسته به 20261029100000_admin_open_mode.sql (admin_open_mode) و 20261101000000_daily_sales_report.sql.
-- قابل اجرای دوباره.
-- ============================================================

-- ---------- کیوسک‌ها ----------
CREATE TABLE IF NOT EXISTS public.kiosk_devices (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- sha256 کلید کیوسک (هگز کوچک)؛ خود کلید هرگز در سرور نیست
  key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz
);
-- ستون key_hash برای هیچ نقشی خواندنی نیست؛ نوشتن فقط با register_kiosk
REVOKE ALL ON public.kiosk_devices FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, name, created_at, last_sync_at) ON public.kiosk_devices TO anon, authenticated;
GRANT ALL ON public.kiosk_devices TO service_role;
ALTER TABLE public.kiosk_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins view kiosks" ON public.kiosk_devices;
CREATE POLICY "Admins view kiosks" ON public.kiosk_devices FOR SELECT TO anon, authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.admin_open_mode());

-- ---------- تراکنش‌های نیازمند بررسی ----------
-- هیچ ستونی برای شمارهٔ کارت (حتی ماسک‌شده) وجود ندارد
CREATE TABLE IF NOT EXISTS public.pos_review_transactions (
  kiosk_id uuid NOT NULL REFERENCES public.kiosk_devices(id) ON DELETE CASCADE,
  transaction_id text NOT NULL CHECK (char_length(transaction_id) BETWEEN 1 AND 100),
  occurred_at timestamptz NOT NULL,
  amount_rial bigint NOT NULL CHECK (amount_rial > 0),
  status text NOT NULL CHECK (char_length(status) BETWEEN 1 AND 40),
  reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 300),
  invoice_number text CHECK (char_length(invoice_number) <= 100),
  rrn text CHECK (char_length(rrn) <= 40),
  -- آخرین مقدار کیوسک؛ false یعنی نگرانی برطرف شده (مثلاً رد دیررس) بی‌آنکه کسی بررسی کرده باشد
  needs_review boolean NOT NULL DEFAULT true,
  reviewed boolean NOT NULL DEFAULT false,
  review_note text CHECK (char_length(review_note) <= 500),
  reviewed_at timestamptz,
  reviewed_by text CHECK (char_length(reviewed_by) <= 200),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kiosk_id, transaction_id)
);
CREATE INDEX IF NOT EXISTS pos_review_transactions_occurred_at_idx
  ON public.pos_review_transactions (occurred_at);
-- نوشتن مستقیم برای هیچ نقشی مجاز نیست؛ فقط توابع زیر
REVOKE ALL ON public.pos_review_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pos_review_transactions TO anon, authenticated;
GRANT ALL ON public.pos_review_transactions TO service_role;
ALTER TABLE public.pos_review_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins view review transactions" ON public.pos_review_transactions;
CREATE POLICY "Admins view review transactions" ON public.pos_review_transactions
  FOR SELECT TO anon, authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.admin_open_mode());

-- ---------- ثبت کیوسک (فقط مدیر یا حالت بدون رمز) ----------
CREATE OR REPLACE FUNCTION public.register_kiosk(p_kiosk_id uuid, p_name text, p_key_hash text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.admin_open_mode()) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.kiosk_devices (id, name, key_hash)
  VALUES (p_kiosk_id, left(coalesce(nullif(btrim(p_name), ''), 'کیوسک'), 80), lower(btrim(p_key_hash)))
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, key_hash = EXCLUDED.key_hash;
END;
$$;
REVOKE ALL ON FUNCTION public.register_kiosk(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_kiosk(uuid, text, text) TO anon, authenticated, service_role;

-- ---------- همگام‌سازی از کیوسک ----------
-- قرارداد: specs/001-daily-sales-report/contracts/kiosk-sync.md §2
CREATE OR REPLACE FUNCTION public.kiosk_sync_review_transactions(
  p_kiosk_id uuid, p_key text, p_rows jsonb, p_since timestamptz, p_kiosk_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_now timestamptz := now();
  v_raw_offset interval := v_now - coalesce(p_kiosk_now, v_now);
  v_offset interval;
  v_row jsonb;
  v_reviewed boolean;
  v_rejected int := 0;
  v_remote jsonb;
BEGIN
  -- کیوسک ناشناخته و کلید نادرست یک خطای یکسان می‌دهند تا نتوان شناسه‌ها را شمرد
  SELECT key_hash INTO v_hash FROM public.kiosk_devices WHERE id = p_kiosk_id;
  IF v_hash IS NULL OR p_key IS NULL OR v_hash <> encode(sha256(convert_to(p_key, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'invalid kiosk key' USING ERRCODE = '42501';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be an array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'at most 500 rows per call' USING ERRCODE = '22023';
  END IF;

  -- ساعت کیوسک اشتباه است: زمان تراکنش‌های تازه با اختلاف اصلاح می‌شود تا روز گزارش درست بماند
  v_offset := CASE WHEN abs(extract(epoch FROM v_raw_offset)) > 120 THEN v_raw_offset ELSE interval '0' END;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      v_reviewed := coalesce((v_row ->> 'reviewed')::boolean, false);
      -- فقط کلیدهای مجاز خوانده می‌شوند؛ هر کلید دیگر (مثل masked_pan) نادیده گرفته می‌شود
      INSERT INTO public.pos_review_transactions AS t (
        kiosk_id, transaction_id, occurred_at, amount_rial, status, reason, invoice_number, rrn,
        needs_review, reviewed, review_note, reviewed_at, reviewed_by, updated_at)
      VALUES (
        p_kiosk_id,
        v_row ->> 'transaction_id',
        (v_row ->> 'occurred_at')::timestamptz + v_offset,
        (v_row ->> 'amount_rial')::bigint,
        v_row ->> 'status',
        coalesce(left(v_row ->> 'reason', 300), ''),
        nullif(v_row ->> 'invoice_number', ''),
        nullif(v_row ->> 'rrn', ''),
        coalesce((v_row ->> 'needs_review')::boolean, true),
        v_reviewed,
        left(nullif(v_row ->> 'review_note', ''), 500),
        CASE WHEN v_reviewed THEN coalesce((v_row ->> 'reviewed_at')::timestamptz, v_now) END,
        CASE WHEN v_reviewed THEN 'کیوسک' END,
        v_now)
      ON CONFLICT (kiosk_id, transaction_id) DO UPDATE SET
        -- زمان و مبلغ فقط هنگام اولین ثبت تعیین می‌شوند (با تصحیح ساعت همان لحظه)
        status = EXCLUDED.status,
        reason = EXCLUDED.reason,
        invoice_number = EXCLUDED.invoice_number,
        rrn = EXCLUDED.rrn,
        needs_review = EXCLUDED.needs_review,
        -- «بررسی شد» یک‌طرفه است: false → true، و اولین بررسی (یادداشت و بررسی‌کننده) می‌ماند
        reviewed = t.reviewed OR EXCLUDED.reviewed,
        review_note = CASE WHEN t.reviewed THEN t.review_note ELSE EXCLUDED.review_note END,
        reviewed_at = CASE WHEN t.reviewed THEN t.reviewed_at ELSE EXCLUDED.reviewed_at END,
        reviewed_by = CASE WHEN t.reviewed THEN t.reviewed_by ELSE EXCLUDED.reviewed_by END,
        updated_at = v_now;
    EXCEPTION WHEN others THEN
      -- یک ردیف خراب نباید همگام‌سازی همهٔ ردیف‌ها را برای همیشه ببندد
      v_rejected := v_rejected + 1;
    END;
  END LOOP;

  UPDATE public.kiosk_devices SET last_sync_at = v_now WHERE id = p_kiosk_id;

  -- بررسی‌هایی که مدیر از راه دور زده؛ با ۲ دقیقه هم‌پوشانی تا تراکنشی که هم‌زمان با دور قبل
  -- ثبت شده جا نماند (کیوسک اعمال تکراری را نادیده می‌گیرد)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'transaction_id', transaction_id, 'review_note', review_note,
           'reviewed_at', reviewed_at, 'reviewed_by', reviewed_by) ORDER BY reviewed_at), '[]'::jsonb)
  INTO v_remote
  FROM public.pos_review_transactions
  WHERE kiosk_id = p_kiosk_id AND reviewed AND reviewed_by IS DISTINCT FROM 'کیوسک'
    AND reviewed_at > coalesce(p_since, '-infinity'::timestamptz) - interval '2 minutes';

  RETURN jsonb_build_object(
    'server_time', v_now,
    'clock_offset_seconds', round(extract(epoch FROM v_raw_offset)),
    'rejected', v_rejected,
    'remote_reviews', v_remote);
END;
$$;
REVOKE ALL ON FUNCTION public.kiosk_sync_review_transactions(uuid, text, jsonb, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosk_sync_review_transactions(uuid, text, jsonb, timestamptz, timestamptz)
  TO anon, authenticated, service_role;

-- ---------- «بررسی شد» از پنل (فقط مدیر یا حالت بدون رمز) ----------
CREATE OR REPLACE FUNCTION public.review_pos_transaction(p_kiosk_id uuid, p_transaction_id text, p_note text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_found boolean;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.admin_open_mode()) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT true INTO v_found FROM public.pos_review_transactions
  WHERE kiosk_id = p_kiosk_id AND transaction_id = p_transaction_id;
  IF v_found IS NULL THEN
    RAISE EXCEPTION 'تراکنش پیدا نشد' USING ERRCODE = 'P0002';
  END IF;
  -- اگر قبلاً بررسی شده، چیزی عوض نمی‌شود
  UPDATE public.pos_review_transactions
  SET reviewed = true,
      review_note = left(nullif(btrim(p_note), ''), 500),
      reviewed_at = now(),
      reviewed_by = coalesce(nullif(auth.jwt() ->> 'email', ''), 'حالت بدون رمز'),
      updated_at = now()
  WHERE kiosk_id = p_kiosk_id AND transaction_id = p_transaction_id AND NOT reviewed;
END;
$$;
REVOKE ALL ON FUNCTION public.review_pos_transaction(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_pos_transaction(uuid, text, text) TO anon, authenticated, service_role;

-- ---------- فهرست یک روز (به وقت تهران) ----------
-- نگرانی‌برطرف‌شده‌ها (needs_review=false و بررسی‌نشده) در فهرست نمی‌آیند
CREATE OR REPLACE FUNCTION public.review_transactions_for_day(p_day date)
RETURNS TABLE (
  kiosk_id uuid, kiosk_name text, transaction_id text, occurred_at timestamptz, amount_rial bigint,
  status text, reason text, invoice_number text, rrn text, needs_review boolean, reviewed boolean,
  review_note text, reviewed_at timestamptz, reviewed_by text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT t.kiosk_id, k.name, t.transaction_id, t.occurred_at, t.amount_rial, t.status, t.reason,
         t.invoice_number, t.rrn, t.needs_review, t.reviewed, t.review_note, t.reviewed_at, t.reviewed_by
  FROM public.pos_review_transactions t
  JOIN public.kiosk_devices k ON k.id = t.kiosk_id
  WHERE t.occurred_at >= (p_day::timestamp AT TIME ZONE 'Asia/Tehran')
    AND t.occurred_at < ((p_day + 1)::timestamp AT TIME ZONE 'Asia/Tehran')
    AND (t.needs_review OR t.reviewed)
  ORDER BY t.occurred_at, t.transaction_id;
$$;
REVOKE ALL ON FUNCTION public.review_transactions_for_day(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_transactions_for_day(date) TO anon, authenticated, service_role;

-- ---------- گزارش روزانه با بخش بررسی ----------
-- همان تابع migration قبلی؛ فقط 'review' پر می‌شود. اگر کیوسکی ثبت نشده (یا برای این نقش دیده
-- نمی‌شود)، 'review' برابر null است و صفحه «در دسترس نیست» می‌نویسد، نه صفر.
CREATE OR REPLACE FUNCTION public.daily_sales_report(p_day date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Tehran')::date;
  v_from timestamptz;
  v_to timestamptz;
  v_sales jsonb;
  v_tickets jsonb;
  v_review jsonb := NULL;
BEGIN
  IF p_day IS NULL OR p_day > v_today THEN
    RAISE EXCEPTION 'روز آینده قابل گزارش نیست' USING ERRCODE = '22023';
  END IF;
  v_from := p_day::timestamp AT TIME ZONE 'Asia/Tehran';
  v_to := (p_day + 1)::timestamp AT TIME ZONE 'Asia/Tehran';

  SELECT jsonb_build_object(
    'card', jsonb_build_object(
      'total', coalesce(sum(i.total) FILTER (WHERE i.payment_method = 'card'), 0),
      'count', count(*) FILTER (WHERE i.payment_method = 'card')),
    'cash', jsonb_build_object(
      'total', coalesce(sum(i.total) FILTER (WHERE i.payment_method = 'cash'), 0),
      'count', count(*) FILTER (WHERE i.payment_method = 'cash')),
    'total', coalesce(sum(i.total), 0),
    'invoice_count', count(*))
  INTO v_sales
  FROM invoices i
  WHERE i.created_at >= v_from AND i.created_at < v_to;

  WITH lines AS (
    SELECT ii.item_type, ii.reference_id, ii.quantity
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.created_at >= v_from AND i.created_at < v_to
  ),
  by_type AS (
    SELECT l.reference_id AS ticket_type_id, t.name, t.category, sum(l.quantity)::bigint AS quantity
    FROM lines l
    LEFT JOIN ticket_types t ON t.id = l.reference_id
    WHERE l.item_type = 'ticket'
    GROUP BY l.reference_id, t.name, t.category
  )
  SELECT jsonb_build_object(
    'total', coalesce((SELECT sum(quantity) FROM by_type), 0),
    'by_type', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'ticket_type_id', ticket_type_id, 'name', name, 'category', category, 'quantity', quantity)
        ORDER BY array_position(ARRAY['normal', 'guided', 'vip'], category) NULLS LAST,
          name NULLS LAST, ticket_type_id)
      FROM by_type), '[]'::jsonb),
    'untyped_lines_quantity', coalesce((SELECT sum(quantity) FROM lines WHERE item_type IS NULL), 0))
  INTO v_tickets;

  IF EXISTS (SELECT 1 FROM kiosk_devices) THEN
    SELECT jsonb_build_object(
      'pending', jsonb_build_object(
        'count', count(*) FILTER (WHERE r.needs_review AND NOT r.reviewed),
        'amount_rial', coalesce(sum(r.amount_rial) FILTER (WHERE r.needs_review AND NOT r.reviewed), 0)),
      'reviewed', jsonb_build_object(
        'count', count(*) FILTER (WHERE r.reviewed),
        'amount_rial', coalesce(sum(r.amount_rial) FILTER (WHERE r.reviewed), 0)),
      'last_sync_at', (SELECT max(last_sync_at) FROM kiosk_devices))
    INTO v_review
    FROM pos_review_transactions r
    WHERE r.occurred_at >= v_from AND r.occurred_at < v_to;
  END IF;

  RETURN jsonb_build_object(
    'day', p_day,
    'generated_at', now(),
    'is_today', p_day = v_today,
    'sales', v_sales,
    'tickets', v_tickets,
    'review', v_review);
END;
$$;

REVOKE ALL ON FUNCTION public.daily_sales_report(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daily_sales_report(date) TO anon, authenticated, service_role;
