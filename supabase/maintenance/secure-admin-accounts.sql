-- امن‌سازی حساب‌های مدیر — رمزهای زیر در README و migrationهای مخزن عمومی نوشته شده‌اند:
--   daneshavaran2@gmail.com   (مدیر اصلی؛ رمز پیش‌فرض)
--   test-admin2@museum.local  (حساب تستِ «admin» با رمز Test@12345)
--   test-mod@museum.local / test-user1@museum.local (حساب‌های تست)
--
-- این اسکریپت: ۱) حساب‌های تست را کامل پاک می‌کند، ۲) رمز مدیر اصلی را به رمز جدیدِ شما تغییر می‌دهد
-- و ۳) نشست‌های واردشدهٔ آن حساب را می‌بندد.
--
-- قبل از اجرا خط new_pw را با یک رمز قوی (دست‌کم ۱۲ نویسه) که خودتان انتخاب می‌کنید عوض کنید.
-- در Lovable: Cloud ← Database ← SQL editor ← چسباندن ← Run.
DO $$
DECLARE
  new_pw  text := 'PUT-A-STRONG-PASSWORD-HERE';
  admin_id uuid;
BEGIN
  IF new_pw = 'PUT-A-STRONG-PASSWORD-HERE' OR length(new_pw) < 12 THEN
    RAISE EXCEPTION 'ابتدا new_pw را با یک رمز قوی (دست‌کم ۱۲ نویسه) عوض کنید';
  END IF;

  SELECT id INTO admin_id FROM auth.users WHERE email = 'daneshavaran2@gmail.com';
  IF admin_id IS NULL THEN
    RAISE EXCEPTION 'کاربر daneshavaran2@gmail.com پیدا نشد؛ اگر ایمیل مدیر چیز دیگری است، اسکریپت را اصلاح کنید';
  END IF;

  -- ۱) حساب‌های تست (اگر هستند)
  DELETE FROM public.user_roles
   WHERE user_id IN (SELECT id FROM auth.users
                      WHERE email IN ('test-admin2@museum.local', 'test-mod@museum.local', 'test-user1@museum.local', 'admin@museum.local'));
  DELETE FROM auth.users
   WHERE email IN ('test-admin2@museum.local', 'test-mod@museum.local', 'test-user1@museum.local', 'admin@museum.local');

  -- ۲) رمز مدیر اصلی
  UPDATE auth.users
     SET encrypted_password = crypt(new_pw, gen_salt('bf')), updated_at = now()
   WHERE id = admin_id;

  -- ۳) نشست‌ها و توکن‌های تازه‌سازی قبلی را باطل کن
  IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
    DELETE FROM auth.refresh_tokens WHERE user_id = admin_id::text;
  END IF;
  IF to_regclass('auth.sessions') IS NOT NULL THEN
    DELETE FROM auth.sessions WHERE user_id = admin_id;
  END IF;
END $$;
