-- Remove old admin
DELETE FROM auth.users WHERE email = 'admin@museum.local';

-- Remove any prior instance of the new email to avoid conflict
DELETE FROM auth.users WHERE email = 'daneshavaran2@gmail.com';

-- Create new admin user
DO $$
DECLARE
  new_user_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token,
    email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    'daneshavaran2@gmail.com',
    crypt('123456789', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    false, '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    new_user_id,
    jsonb_build_object('sub', new_user_id::text, 'email', 'daneshavaran2@gmail.com', 'email_verified', true),
    'email',
    new_user_id::text,
    now(), now(), now()
  );

  INSERT INTO public.user_roles (user_id, role) VALUES (new_user_id, 'admin'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;