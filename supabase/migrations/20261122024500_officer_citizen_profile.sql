-- Allow review officers and admins to inspect an applicant's full profile
-- (citizen record, VLM-extracted profile_metadata_json, and uploaded citizen_documents).

create or replace function relief_private.citizen_profile(args jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  uid uuid := auth.uid();
  actor text;
  acct_status text;
  person uuid;
  citizen public.citizens%rowtype;
  docs jsonb;
begin
  select role, status into actor, acct_status from public.profiles where id = uid;
  if actor is null then return relief_private.failure(401, 'Sign in with a demo persona.'); end if;
  if acct_status is not null and acct_status <> 'active' then
    return relief_private.failure(403, 'Your account is pending approval or inactive.');
  end if;
  if actor not in ('citizen', 'helper', 'officer', 'admin') then
    perform relief_private.audit(uid, actor, 'access_denied', 'action', 'citizen_profile', 'denied');
    return relief_private.failure(403, 'Your role cannot view citizen profile documents.');
  end if;

  if actor = 'citizen' then
    select id into person from public.citizens where owner_id = uid limit 1;
  else
    person := nullif(args->>'citizenId', '')::uuid;
  end if;
  if person is null then
    return relief_private.failure(400, 'Choose a family first.');
  end if;
  if not (relief_private.can_access(uid, actor, person) or actor in ('officer', 'admin')) then
    perform relief_private.audit(uid, actor, 'access_denied', 'citizen', person::text, 'denied');
    return relief_private.failure(403, 'Family consent is missing or has been revoked.');
  end if;

  select * into citizen from public.citizens where id = person;
  if citizen.id is null then
    return relief_private.failure(404, 'Citizen record was not found.');
  end if;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at desc), '[]'::jsonb) into docs
  from public.citizen_documents d where d.citizen_id = person;

  if actor in ('officer', 'admin') then
    perform relief_private.audit(uid, actor, 'profile_viewed', 'citizen', person::text, 'read');
  end if;

  return jsonb_build_object(
    'citizen', to_jsonb(citizen) - 'owner_id',
    'documents', docs
  );
end;
$$;
