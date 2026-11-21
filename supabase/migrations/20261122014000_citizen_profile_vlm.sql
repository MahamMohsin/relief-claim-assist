-- Citizen Profile VLM Documents & Metadata
-- Adds flexible VLM-extracted profile metadata on public.citizens,
-- standalone citizen_documents + private citizen_images storage,
-- and gateway-dispatched RPC helpers (citizen_profile, citizen_doc_upload, citizen_doc_file).

alter table public.citizens
  add column if not exists profile_metadata_json jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.citizen_documents (
  id uuid primary key default gen_random_uuid(),
  citizen_id uuid not null references public.citizens(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  doc_type text not null check (doc_type in ('cnic','utility_bill','job_proof','income','other')),
  file_url text,
  extracted_json jsonb not null default '{}'::jsonb,
  blur_score numeric,
  tamper_flag boolean not null default false,
  tamper_reason text,
  verified_status text not null default 'unverified',
  model_version text not null default 'deterministic-v1',
  confidence numeric,
  created_at timestamptz not null default now()
);

create index if not exists citizen_documents_citizen_created_idx
  on public.citizen_documents(citizen_id, created_at desc);

alter table public.citizen_documents enable row level security;
revoke all on table public.citizen_documents from public, anon, authenticated;

create table if not exists relief_private.citizen_images (
  document_id uuid primary key references public.citizen_documents(id) on delete cascade,
  image_data text not null check (length(image_data) between 25 and 2800000)
);

revoke all on table relief_private.citizen_images from public, anon, authenticated;

-- 1. Read citizen profile + VLM-extracted metadata + uploaded profile documents
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
  if not relief_private.can_access(uid, actor, person) then
    perform relief_private.audit(uid, actor, 'access_denied', 'citizen', person::text, 'denied');
    return relief_private.failure(403, 'Family consent is missing or has been revoked.');
  end if;

  select * into citizen from public.citizens where id = person;
  if citizen.id is null then
    return relief_private.failure(404, 'Citizen record was not found.');
  end if;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at desc), '[]'::jsonb) into docs
  from public.citizen_documents d where d.citizen_id = person;

  return jsonb_build_object(
    'citizen', to_jsonb(citizen) - 'owner_id',
    'documents', docs
  );
end;
$$;

-- 2. Store uploaded profile document + private image + merge VLM-extracted metadata
create or replace function relief_private.citizen_doc_upload(args jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  uid uuid := auth.uid();
  actor text;
  acct_status text;
  person uuid;
  citizen public.citizens%rowtype;
  rule_ver int;
  doc_kind text := coalesce(args->>'docType', 'other');
  analysis jsonb := coalesce(args->'analysis', '{}'::jsonb);
  extracted jsonb := coalesce(analysis->'fields', '{}'::jsonb);
  profile_patch jsonb := coalesce(analysis->'profile_updates', '{}'::jsonb);
  core_patch jsonb := coalesce(analysis->'core_updates', '{}'::jsonb);
  is_tamper boolean := coalesce((analysis->>'tamper')::boolean, false);
  v_status text := coalesce(analysis->>'status', 'unverified');
  v_model text := coalesce(analysis->>'model', 'deterministic-v1');
  v_conf numeric := nullif(analysis->>'confidence', '')::numeric;
  v_blur numeric := nullif(analysis->>'blurScore', '')::numeric;
  apply_core boolean := coalesce((args->>'applyToCore')::boolean, true);
  doc public.citizen_documents%rowtype;
  file_path text;
begin
  select role, status into actor, acct_status from public.profiles where id = uid;
  if actor is null then return relief_private.failure(401, 'Sign in with a demo persona.'); end if;
  if acct_status is not null and acct_status <> 'active' then
    return relief_private.failure(403, 'Your account is pending approval or inactive.');
  end if;
  if actor not in ('citizen', 'helper') then
    perform relief_private.audit(uid, actor, 'access_denied', 'action', 'citizen_doc_upload', 'denied');
    return relief_private.failure(403, 'Only citizens and authorized helpers can upload profile documents.');
  end if;

  if actor = 'citizen' then
    select id into person from public.citizens where owner_id = uid limit 1;
  else
    person := nullif(args->>'citizenId', '')::uuid;
  end if;
  if person is null then
    return relief_private.failure(400, 'Choose a family first.');
  end if;
  if not relief_private.can_access(uid, actor, person) then
    perform relief_private.audit(uid, actor, 'access_denied', 'citizen', person::text, 'denied');
    return relief_private.failure(403, 'Family consent is missing or has been revoked.');
  end if;

  if doc_kind not in ('cnic','utility_bill','job_proof','income','other') then
    return relief_private.failure(400, 'Unsupported profile document type.');
  end if;

  select version into rule_ver from public.eligibility_rules where is_active limit 1;

  insert into public.citizen_documents(
    citizen_id, uploaded_by, doc_type, extracted_json, blur_score,
    tamper_flag, tamper_reason, verified_status, model_version, confidence
  ) values (
    person, uid, doc_kind,
    jsonb_build_object(
      'summary', coalesce(analysis->>'summary', ''),
      'note', coalesce(analysis->>'note', ''),
      'fields', extracted,
      'model', v_model
    ),
    v_blur, is_tamper,
    case when is_tamper then coalesce(analysis->>'note', 'Possible alteration detected') else null end,
    v_status, v_model, v_conf
  ) returning * into doc;

  if args->>'image' is not null then
    file_path := '/api/relief/profile-file/' || doc.id::text;
    insert into relief_private.citizen_images(document_id, image_data)
    values (doc.id, args->>'image')
    on conflict (document_id) do nothing;
    update public.citizen_documents set file_url = file_path where id = doc.id returning * into doc;
  end if;

  -- Merge extracted metadata into citizen profile (skip overwriting if document was flagged suspect/tampered)
  if not is_tamper and v_status <> 'unreadable' then
    update public.citizens set
      profile_metadata_json = coalesce(profile_metadata_json, '{}'::jsonb) || jsonb_build_object(
        doc_kind, jsonb_build_object(
          'document_id', doc.id,
          'verified_status', v_status,
          'confidence', v_conf,
          'model', v_model,
          'updated_at', now(),
          'fields', extracted
        )
      ) || profile_patch,
      cnic_mock = case
        when apply_core and nullif(trim(coalesce(core_patch->>'cnic_mock', '')), '') is not null
        then trim(core_patch->>'cnic_mock') else cnic_mock end,
      village_area = case
        when apply_core and nullif(trim(coalesce(core_patch->>'village_area', '')), '') is not null
        then trim(core_patch->>'village_area') else village_area end,
      phone = case
        when apply_core and nullif(trim(coalesce(core_patch->>'phone', '')), '') is not null
        then trim(core_patch->>'phone') else phone end,
      monthly_income_mock = case
        when apply_core and nullif(core_patch->>'monthly_income_mock', '') is not null
          and (core_patch->>'monthly_income_mock')::int between 0 and 10000000
        then (core_patch->>'monthly_income_mock')::int else monthly_income_mock end,
      household_size = case
        when apply_core and nullif(core_patch->>'household_size', '') is not null
          and (core_patch->>'household_size')::int between 1 and 100
        then (core_patch->>'household_size')::int else household_size end,
      updated_at = now()
    where id = person
    returning * into citizen;
  else
    select * into citizen from public.citizens where id = person;
  end if;

  perform relief_private.audit(
    uid, actor, 'profile_doc_extracted', 'citizen', person::text, v_status,
    rule_ver, v_model, v_conf,
    jsonb_build_object('doc_type', doc_kind, 'document_id', doc.id, 'tamper', is_tamper, 'applied_core', apply_core and not is_tamper)
  );

  return jsonb_build_object(
    'document', to_jsonb(doc),
    'citizen', to_jsonb(citizen) - 'owner_id'
  );
end;
$$;

-- 3. Private image read for profile documents
create or replace function relief_private.citizen_doc_file(args jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  uid uuid := auth.uid();
  actor text;
  acct_status text;
  doc_id uuid := (args->>'documentId')::uuid;
  doc public.citizen_documents%rowtype;
  image text;
begin
  select role, status into actor, acct_status from public.profiles where id = uid;
  if actor is null then return relief_private.failure(401, 'Sign in with a demo persona.'); end if;
  if acct_status is not null and acct_status <> 'active' then
    return relief_private.failure(403, 'Your account is pending approval or inactive.');
  end if;
  select * into doc from public.citizen_documents where id = doc_id;
  if doc.id is null then return relief_private.failure(404, 'The profile document could not be found.'); end if;
  if not (relief_private.can_access(uid, actor, doc.citizen_id) or actor in ('officer', 'admin')) then
    perform relief_private.audit(uid, actor, 'access_denied', 'document', doc_id::text, 'denied');
    return relief_private.failure(403, 'Your role or family consent does not allow you to open this document.');
  end if;
  select image_data into image from relief_private.citizen_images where document_id = doc_id;
  if image is null then return relief_private.failure(404, 'This sample has no attached image.'); end if;
  perform relief_private.audit(uid, actor, 'profile_doc_viewed', 'document', doc_id::text, 'read');
  return jsonb_build_object('image', image);
end;
$$;

-- 4. Hook the 3 profile actions into public.relief_gateway cleanly
do $$
declare
  definition text := pg_get_functiondef('public.relief_gateway(text,jsonb,text)'::regprocedure);
  anchor text := $a$  if action='evidence_file' then return relief_private.evidence_file(args); end if;$a$;
  addition text := $b$  if action='evidence_file' then return relief_private.evidence_file(args); end if;
  if action='citizen_profile' then return relief_private.citizen_profile(args); end if;
  if action='citizen_doc_upload' then return relief_private.citizen_doc_upload(args); end if;
  if action='citizen_doc_file' then return relief_private.citizen_doc_file(args); end if;$b$;
begin
  if position('citizen_profile' in definition) = 0 then
    if position(anchor in definition) = 0 then
      raise exception 'Unexpected relief_gateway definition';
    end if;
    execute replace(definition, anchor, addition);
  end if;
end;
$$;
