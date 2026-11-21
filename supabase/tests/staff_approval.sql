begin;
do $$
declare
  candidate uuid := gen_random_uuid();
  attempted_admin uuid := gen_random_uuid();
  response jsonb;
begin
  insert into auth.users(id,email,raw_user_meta_data)
  values (candidate,'staff-'||candidate||'@registration.relief-demo.example','{"role":"helper","full_name":"Synthetic approval test"}'),
    (attempted_admin,'role-'||attempted_admin||'@registration.relief-demo.example','{"role":"admin","full_name":"Synthetic role test"}');

  if (select role from public.profiles where id=attempted_admin) is distinct from 'citizen' then
    raise exception 'Public auth metadata assigned an administrator role';
  end if;

  perform set_config('request.jwt.claim.sub',candidate::text,true);
  response := public.relief_action('profile','{}');
  if response->>'status' is distinct from '403' then raise exception 'Unapproved staff entered workspace'; end if;

  perform set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000006',true);
  response := public.relief_action('decide_staff',jsonb_build_object('userId',candidate,'decision','active'));
  if response->>'status' is distinct from '403' then raise exception 'Auditor changed account approval'; end if;

  perform set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000005',true);
  response := public.relief_action('decide_staff',jsonb_build_object('userId',candidate,'decision','active'));
  if response->>'status' is distinct from 'active' then raise exception 'Administrator could not approve pending staff'; end if;

  perform set_config('request.jwt.claim.sub',candidate::text,true);
  response := public.relief_action('profile','{}');
  if response->>'role' is distinct from 'helper' then raise exception 'Approved staff could not enter workspace'; end if;
end;
$$;
select 'staff_approval_verified' as result;
rollback;
