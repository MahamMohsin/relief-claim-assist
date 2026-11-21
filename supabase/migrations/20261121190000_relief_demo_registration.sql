create extension if not exists pgcrypto with schema extensions;

-- Public user metadata cannot assign an administrator role.
do $$
declare
  definition text := pg_get_functiondef('public.handle_new_user()'::regprocedure);
  role_source text := $predicate$v_role      := coalesce(nullif(trim(NEW.raw_user_meta_data->>'role'), ''), 'citizen');$predicate$;
  trusted_role_source text := $predicate$v_role := coalesce(
    nullif(trim(NEW.raw_app_meta_data->>'relief_role'), ''),
    case when NEW.raw_user_meta_data->>'role' in ('citizen','helper','shopkeeper','officer','auditor')
      then NEW.raw_user_meta_data->>'role' end,
    'citizen'
  );$predicate$;
begin
  if position(role_source in definition) = 0 then
    raise exception 'Unexpected profile provisioning role rule';
  end if;
  execute replace(definition, role_source, trusted_role_source);
end;
$$;

create function public.relief_register_demo(proof text, display_name text, password text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  account_id uuid := gen_random_uuid();
  account_email text := 'test-' || replace(account_id::text,'-','') || '@registration.relief-demo.example';
  account_name text := trim(display_name);
begin
  if not exists (
    select 1 from relief_private.server_credentials
    where (name='gateway' or name like 'gateway:%')
      and secret_hash=encode(sha256(convert_to(proof,'UTF8')),'hex')
  ) then
    return relief_private.failure(403,'Server gateway authorization failed.');
  end if;

  if account_name is null or length(account_name) not between 2 and 80 or password is null
    or length(password) < 6 or octet_length(password) > 72 then
    return relief_private.failure(400,'Provide a synthetic name and a password between 6 characters and 72 bytes.');
  end if;

  perform pg_advisory_xact_lock(213763502);
  if (select count(*) from auth.users where email like '%@registration.relief-demo.example'
      and created_at > now() - interval '1 hour') >= 30 then
    return relief_private.failure(429,'The demo registration limit was reached. Try again later.');
  end if;

  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
  values ('00000000-0000-0000-0000-000000000000',account_id,'authenticated','authenticated',account_email,
    extensions.crypt(password,extensions.gen_salt('bf',10)),now(),
    '{"provider":"email","providers":["email"],"relief_demo_registration":true}',
    jsonb_build_object('full_name',account_name,'role','citizen','locale','en'),now(),now(),'','','','');

  insert into auth.identities(id,provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
  values (gen_random_uuid(),account_id::text,account_id,
    jsonb_build_object('sub',account_id,'email',account_email,'email_verified',true),'email',now(),now(),now());

  perform relief_private.audit(account_id,'citizen','demo_registration','profile',account_id::text,'created');
  return jsonb_build_object('email',account_email);
end;
$$;

revoke all on function public.relief_register_demo(text,text,text) from public, anon, authenticated;
grant execute on function public.relief_register_demo(text,text,text) to anon, authenticated;
