-- ============================================================
-- پنل مدیریت بدون رمز («حالت باز»)
--
-- تا وقتی برای پنل رمز گذاشته نشده، هر بازدیدکنندهٔ سایت (anon یا هر کاربر واردشده) همان
-- دسترسی مدیر را دارد: مدیریت بلیط‌ها، محصولات و تصاویرشان، دیدن فاکتورها و نظرسنجی‌ها.
-- با claim_admin_and_close_open_mode() (دکمهٔ «گذاشتن رمز» در داشبورد) کاربر واردشده مدیر
-- می‌شود و حالت باز بسته می‌شود؛ از آن به بعد فقط ورود با ایمیل و رمز. نقش‌ها (user_roles)
-- در حالت باز هم قابل تغییر نیستند.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- فقط از طریق توابع زیر خوانده و نوشته می‌شود
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.app_settings (key, value)
VALUES ('admin_open', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_open_mode()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value = 'true'::jsonb FROM public.app_settings WHERE key = 'admin_open'),
    false
  );
$$;
REVOKE ALL ON FUNCTION public.admin_open_mode() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_open_mode() TO anon, authenticated, service_role;

-- کاربر واردشده را مدیر می‌کند و حالت باز را می‌بندد (فقط در حالت باز، یا برای مدیر فعلی)
CREATE OR REPLACE FUNCTION public.claim_admin_and_close_open_mode()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'login required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.admin_open_mode() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin panel already has a password' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;
  UPDATE public.app_settings
  SET value = 'false'::jsonb, updated_at = now()
  WHERE key = 'admin_open';
END;
$$;
REVOKE ALL ON FUNCTION public.claim_admin_and_close_open_mode() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_admin_and_close_open_mode() TO authenticated;

-- ---------- دسترسی مدیر در حالت باز (همان کارهایی که مدیر می‌تواند) ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_types TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO anon, authenticated;
GRANT SELECT ON public.invoices TO anon, authenticated;
GRANT SELECT ON public.invoice_items TO anon, authenticated;
GRANT SELECT, DELETE ON public.survey_responses TO anon, authenticated;
-- شناسهٔ بلیط‌ها و محصولات BIGSERIAL است؛ افزودن ردیف اجازهٔ sequence را هم لازم دارد
DO $$
DECLARE
  seq TEXT;
BEGIN
  FOREACH seq IN ARRAY ARRAY[
    pg_get_serial_sequence('public.ticket_types', 'id'),
    pg_get_serial_sequence('public.products', 'id')
  ] LOOP
    IF seq IS NOT NULL THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO anon, authenticated', seq);
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Open admin mode manages tickets" ON public.ticket_types;
CREATE POLICY "Open admin mode manages tickets" ON public.ticket_types
  FOR ALL TO anon, authenticated
  USING (public.admin_open_mode()) WITH CHECK (public.admin_open_mode());

DROP POLICY IF EXISTS "Open admin mode manages products" ON public.products;
CREATE POLICY "Open admin mode manages products" ON public.products
  FOR ALL TO anon, authenticated
  USING (public.admin_open_mode()) WITH CHECK (public.admin_open_mode());

DROP POLICY IF EXISTS "Open admin mode views invoices" ON public.invoices;
CREATE POLICY "Open admin mode views invoices" ON public.invoices
  FOR SELECT TO anon, authenticated
  USING (public.admin_open_mode());

DROP POLICY IF EXISTS "Open admin mode views invoice items" ON public.invoice_items;
CREATE POLICY "Open admin mode views invoice items" ON public.invoice_items
  FOR SELECT TO anon, authenticated
  USING (public.admin_open_mode());

DROP POLICY IF EXISTS "Open admin mode views surveys" ON public.survey_responses;
CREATE POLICY "Open admin mode views surveys" ON public.survey_responses
  FOR SELECT TO anon, authenticated
  USING (public.admin_open_mode());

DROP POLICY IF EXISTS "Open admin mode deletes surveys" ON public.survey_responses;
CREATE POLICY "Open admin mode deletes surveys" ON public.survey_responses
  FOR DELETE TO anon, authenticated
  USING (public.admin_open_mode());

DROP POLICY IF EXISTS "Open admin mode uploads product images" ON storage.objects;
CREATE POLICY "Open admin mode uploads product images" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'product-images' AND public.admin_open_mode());

DROP POLICY IF EXISTS "Open admin mode updates product images" ON storage.objects;
CREATE POLICY "Open admin mode updates product images" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'product-images' AND public.admin_open_mode())
  WITH CHECK (bucket_id = 'product-images' AND public.admin_open_mode());

DROP POLICY IF EXISTS "Open admin mode deletes product images" ON storage.objects;
CREATE POLICY "Open admin mode deletes product images" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'product-images' AND public.admin_open_mode());
