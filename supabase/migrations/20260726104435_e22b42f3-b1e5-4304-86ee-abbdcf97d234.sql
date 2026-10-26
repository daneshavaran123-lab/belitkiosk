-- ============================================================
-- SEED DATA (idempotent) — test users, roles, surveys, invoices
-- ============================================================

-- ---------- 1. Test users ----------
DO $$
DECLARE
  seed_users JSONB := '[
    {"email":"test-user1@museum.local","role":"user"},
    {"email":"test-mod@museum.local","role":"moderator"},
    {"email":"test-admin2@museum.local","role":"admin"}
  ]'::jsonb;
  u JSONB;
  uid UUID;
BEGIN
  FOR u IN SELECT * FROM jsonb_array_elements(seed_users) LOOP
    SELECT id INTO uid FROM auth.users WHERE email = (u->>'email');

    IF uid IS NULL THEN
      uid := gen_random_uuid();
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, is_super_admin
      ) VALUES (
        '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
        (u->>'email'), crypt('Test@12345', gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('seed', true),
        false
      );

      INSERT INTO auth.identities (
        id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), uid, uid::text,
        jsonb_build_object('sub', uid::text, 'email', u->>'email', 'email_verified', true),
        'email', now(), now(), now()
      );
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (uid, (u->>'role')::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END LOOP;
END $$;

-- ---------- 2. Survey responses ----------
INSERT INTO public.survey_responses
  (overall_rating, guide_rating, environment_rating, visitor_name, comment, created_at)
SELECT * FROM (VALUES
  (5, 5, 5, 'سارا محمدی',  'موزه فوق‌العاده بود، مدال‌های تختی واقعاً دیدنی بودند.', now() - interval '1 day'),
  (4, 5, 4, 'رضا کریمی',   'راهنمای تور خیلی مسلط بود. فقط صف ورود کمی طولانی بود.', now() - interval '2 day'),
  (5, 4, 5, 'مریم اکبری',  'فضای موزه بسیار تمیز و مدرن بود.', now() - interval '3 day'),
  (3, 3, 4, 'حسین نوری',   'بخش رسانه‌ای می‌تواند بهتر شود.', now() - interval '5 day'),
  (5, 5, 5, NULL,          'برای بچه‌ها هم جذاب بود، حتماً دوباره می‌آییم.', now() - interval '7 day'),
  (4, 4, 3, 'الهام رستمی', 'کافه شلوغ بود ولی کیفیت خوب بود.', now() - interval '9 day'),
  (2, 2, 3, 'محمد صادقی',  'سیستم بلیط الکترونیکی کند بود.', now() - interval '12 day'),
  (5, 5, 4, 'زهرا فتحی',   'غرفه یادبود انتخاب‌های خوبی داشت.', now() - interval '15 day')
) AS v(overall_rating, guide_rating, environment_rating, visitor_name, comment, created_at)
WHERE NOT EXISTS (
  SELECT 1 FROM public.survey_responses WHERE visitor_name = 'سارا محمدی'
);

-- ---------- 3. Invoices + items ----------
DO $$
DECLARE
  inv UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM public.invoices WHERE invoice_number LIKE 'SEED-%') THEN
    RETURN;
  END IF;

  INSERT INTO public.invoices (invoice_number, total, payment_method, status, created_at)
  VALUES ('SEED-1001', 300000, 'card', 'paid', now() - interval '1 day') RETURNING id INTO inv;
  INSERT INTO public.invoice_items (invoice_id, name, quantity, unit_price, discount_percent, total_price)
  VALUES (inv, 'بلیط بازدید عادی', 2, 150000, 0, 300000);

  INSERT INTO public.invoices (invoice_number, total, payment_method, status, created_at)
  VALUES ('SEED-1002', 1912500, 'card', 'paid', now() - interval '3 day') RETURNING id INTO inv;
  INSERT INTO public.invoice_items (invoice_id, name, quantity, unit_price, discount_percent, total_price)
  VALUES (inv, 'بلیط بازدید با راهنما', 9, 250000, 15, 1912500);

  INSERT INTO public.invoices (invoice_number, total, payment_method, status, created_at)
  VALUES ('SEED-1003', 830000, 'cash', 'paid', now() - interval '6 day') RETURNING id INTO inv;
  INSERT INTO public.invoice_items (invoice_id, name, quantity, unit_price, discount_percent, total_price) VALUES
    (inv, 'بلیط VIP', 1, 500000, 0, 500000),
    (inv, 'کتاب تاریخ کشتی ایران', 1, 250000, 0, 250000),
    (inv, 'قهوه ترک', 1, 80000, 0, 80000);

  INSERT INTO public.invoices (invoice_number, total, payment_method, status, created_at)
  VALUES ('SEED-1004', 640000, 'card', 'pending', now() - interval '10 day') RETURNING id INTO inv;
  INSERT INTO public.invoice_items (invoice_id, name, quantity, unit_price, discount_percent, total_price) VALUES
    (inv, 'مدال یادبود موزه', 2, 220000, 0, 440000),
    (inv, 'تیشرت تیم ملی کشتی', 1, 200000, 0, 200000);

  INSERT INTO public.invoices (invoice_number, total, payment_method, status, created_at)
  VALUES ('SEED-1005', 2500000, 'cash', 'paid', now() - interval '20 day') RETURNING id INTO inv;
  INSERT INTO public.invoice_items (invoice_id, name, quantity, unit_price, discount_percent, total_price) VALUES
    (inv, 'عضویت سالانه طلایی', 1, 2000000, 0, 2000000),
    (inv, 'حمایت از موزه', 1, 500000, 0, 500000);
END $$;