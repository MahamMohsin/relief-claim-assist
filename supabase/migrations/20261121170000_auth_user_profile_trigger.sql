-- ====================================================================
-- MIGRATION: Auto-provision profile and citizen on auth.users registration
-- ====================================================================

-- 1. Function executed by trigger on auth.users insert
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_full_name    text;
  v_role         text;
  v_locale       text;
  v_status       text;
  v_phone        text;
  v_cnic_tail    text;
BEGIN
  -- Extract metadata supplied during supabase.auth.signUp(...)
  v_full_name := coalesce(nullif(trim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(NEW.email, '@', 1));
  v_role      := coalesce(nullif(trim(NEW.raw_user_meta_data->>'role'), ''), 'citizen');
  v_locale    := coalesce(nullif(trim(NEW.raw_user_meta_data->>'locale'), ''), 'en');
  v_phone     := nullif(trim(NEW.raw_user_meta_data->>'phone'), '');

  -- Validate role
  IF v_role NOT IN ('citizen', 'helper', 'shopkeeper', 'officer', 'admin', 'auditor') THEN
    v_role := 'citizen';
  END IF;

  -- Staff roles require admin verification; citizens and shopkeepers become active immediately
  IF v_role IN ('helper', 'officer', 'auditor') THEN
    v_status := 'pending_approval';
  ELSE
    v_status := 'active';
  END IF;

  -- 2. Insert into public.profiles
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    role,
    phone,
    locale,
    status,
    created_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    v_role,
    v_phone,
    v_locale,
    v_status,
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET email     = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        role      = EXCLUDED.role,
        status    = EXCLUDED.status;

  -- 3. If citizen, auto-create their corresponding mock citizen profile record
  IF v_role = 'citizen' AND NOT EXISTS (SELECT 1 FROM public.citizens WHERE owner_id = NEW.id) THEN
    v_cnic_tail := lpad(floor(random() * 900 + 100)::text, 3, '0');
    INSERT INTO public.citizens (
      owner_id,
      cnic_mock,
      full_name,
      name_phonetic,
      household_size,
      monthly_income_mock,
      phone,
      village_area
    )
    VALUES (
      NEW.id,
      '35201-MOCK-' || v_cnic_tail,
      v_full_name,
      lower(regexp_replace(v_full_name, '[^a-zA-Z0-9]+', '-', 'g')),
      4,
      22000,
      coalesce(v_phone, '0300-' || v_cnic_tail || '000'),
      'Darya Colony'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Bind trigger to auth.users table
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
