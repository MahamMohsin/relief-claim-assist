create schema if not exists relief_private;
revoke all on schema relief_private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id),
  email text not null unique,
  full_name text not null,
  role text not null check (role in ('citizen','helper','shopkeeper','officer','admin','auditor')),
  phone text,
  locale text not null default 'en',
  created_at timestamptz not null default now()
);
create table public.citizens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id),
  cnic_mock text not null,
  full_name text not null,
  name_phonetic text not null,
  household_size int not null check (household_size > 0),
  monthly_income_mock int not null check (monthly_income_mock >= 0),
  phone text not null,
  village_area text not null
);
create index on public.citizens(owner_id);
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  citizen_id uuid not null references public.citizens(id),
  grantee_user_id uuid not null references public.profiles(id),
  scope text not null default 'claim_access',
  status text not null check (status in ('granted','revoked')),
  granted_at timestamptz,
  revoked_at timestamptz,
  unique (citizen_id, grantee_user_id, scope)
);
create index on public.consents(grantee_user_id, status);
create table public.data_correction_requests (
  id uuid primary key default gen_random_uuid(),
  citizen_id uuid not null references public.citizens(id),
  requested_by uuid not null references public.profiles(id),
  field_name text not null,
  current_value text not null,
  proposed_value text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create table public.eligibility_rules (
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  name text not null,
  config_json jsonb not null,
  is_active boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index eligibility_rules_one_active on public.eligibility_rules(is_active) where is_active;
create table public.claims (
  id uuid primary key default gen_random_uuid(),
  citizen_id uuid not null references public.citizens(id),
  submitted_by uuid not null references public.profiles(id),
  status text not null default 'draft' check (status in ('draft','submitted','needs_proof','in_review','approved','rejected','closed')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed')),
  amount_pkr int not null default 0,
  payload_json jsonb not null default '{}',
  citizen_reason_en text,
  citizen_reason_ur text,
  rule_version_used int references public.eligibility_rules(version),
  ai_confidence numeric,
  ai_route text,
  assigned_officer_id uuid references public.profiles(id),
  handoff_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.claims(citizen_id, updated_at desc);
create index on public.claims(status, ai_confidence);
create table public.claim_documents (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id),
  doc_type text not null,
  file_url text,
  ocr_json jsonb not null default '{}',
  blur_score numeric,
  tamper_flag boolean not null default false,
  tamper_reason text,
  verified_status text not null default 'unverified',
  created_at timestamptz not null default now()
);
create index on public.claim_documents(claim_id);
create table public.mock_payments (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null unique references public.claims(id),
  raast_ref text not null unique,
  amount_pkr int not null,
  status text not null check (status in ('pending','paid','failed')),
  disbursed_at timestamptz
);
create table public.scam_checks (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references public.profiles(id),
  claim_id uuid references public.claims(id),
  message_text text not null,
  jev_label text not null,
  jev_confidence numeric not null,
  jev_route text not null,
  rail_match_status text not null,
  missing_payment_reported boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.policy_sections (
  id uuid primary key default gen_random_uuid(),
  policy_version text not null,
  section_code text not null,
  title text not null,
  effective_date date not null,
  content text not null,
  keywords text[] not null default '{}',
  unique (policy_version, section_code)
);
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_role text not null,
  event_type text not null,
  entity_type text not null,
  entity_id text,
  input_ref text,
  rule_version int,
  model_version text not null default 'deterministic-v1',
  confidence numeric,
  outcome text not null,
  metadata_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.audit_logs(created_at desc);
create index on public.audit_logs(entity_id, created_at desc);
create table public.idempotency_keys (
  key uuid not null,
  user_id uuid not null references public.profiles(id),
  endpoint text not null,
  request_json jsonb not null,
  response_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint, key)
);
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_hash text not null unique,
  scopes text[] not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.agent_sessions (
  user_id uuid not null references public.profiles(id),
  citizen_id uuid not null,
  entries_json jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (user_id, citizen_id)
);

do $$
declare relation text;
begin
  foreach relation in array array['profiles','citizens','consents','data_correction_requests','eligibility_rules','claims',
    'claim_documents','mock_payments','scam_checks','policy_sections','audit_logs','idempotency_keys','api_keys','agent_sessions']
  loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on table public.%I from public, anon, authenticated', relation);
  end loop;
end;
$$;

create function relief_private.immutable_audit() returns trigger language plpgsql as $$
begin
  raise exception 'Audit logs are append-only';
end;
$$;
create trigger audit_logs_immutable before update or delete or truncate on public.audit_logs
for each statement execute function relief_private.immutable_audit();

create function relief_private.audit(uid uuid, actor text, action text, entity text, ref text, result text,
  rule int default null, model text default 'deterministic-v1', score numeric default null, detail jsonb default '{}')
returns void language sql set search_path = '' as $$
  insert into public.audit_logs(actor_id,actor_role,event_type,entity_type,entity_id,input_ref,outcome,rule_version,model_version,confidence,metadata_json)
  values(uid,actor,action,entity,ref,ref,result,rule,model,score,detail);
$$;

create function relief_private.failure(status_code int, message text) returns jsonb language sql immutable as $$
  select jsonb_build_object('status',status_code,'error',message);
$$;

create function relief_private.payload_eligible(payload jsonb, rule jsonb) returns boolean language sql immutable as $$
  select coalesce((payload->>'monthly_income')::int <= (rule->>'income_cap')::int
    and (payload->>'household_size')::int >= (rule->>'minimum_household')::int, false);
$$;

create function relief_private.can_access(uid uuid, actor text, person uuid) returns boolean language sql volatile set search_path = '' as $$
  select case actor
    when 'citizen' then exists(select 1 from public.citizens where id=person and owner_id=uid)
    when 'helper' then exists(select 1 from public.consents where citizen_id=person and grantee_user_id=uid and scope='claim_access' and status='granted')
    else false
  end;
$$;

create function public.relief_action(action text, args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  profile public.profiles%rowtype;
  citizen public.citizens%rowtype;
  claim public.claims%rowtype;
  rule public.eligibility_rules%rowtype;
  person uuid := nullif(args->>'citizenId','')::uuid;
  requested_claim_id uuid := nullif(args->>'claimId','')::uuid;
  idem uuid := nullif(args->>'key','')::uuid;
  session_scope uuid;
  cached public.idempotency_keys%rowtype;
  replay_request jsonb;
  payment public.mock_payments%rowtype;
  payload jsonb;
  result jsonb;
  note text;
  evidence text;
  evidence_data jsonb;
  score numeric;
  eligible boolean;
  next_state text;
  ref text;
  decision text;
  target_user uuid;
  model text;
begin
  select * into profile from public.profiles where id=uid;
  if profile.id is null then return relief_private.failure(401,'Sign in with a demo persona.'); end if;
  select * into rule from public.eligibility_rules where is_active;

  if action='profile' then
    return to_jsonb(profile) || jsonb_build_object('citizen_id',(select id from public.citizens where owner_id=uid order by id limit 1));
  end if;

  if action in ('claims','draft','submit','evidence','correction','privacy','nadra') then
    if person is null and profile.role='citizen' then
      select id into person from public.citizens where owner_id=uid order by id limit 1;
    end if;
    if not relief_private.can_access(uid,profile.role,person) then
      perform relief_private.audit(uid,profile.role,'access_denied','citizen',person::text,'denied',rule.version,
        detail=>jsonb_build_object('action',action));
      return relief_private.failure(403,'This family has not granted you access.');
    end if;
    select * into citizen from public.citizens where id=person;
  end if;

  if (action in ('families','switch_family') and profile.role<>'helper')
    or (action='consent' and profile.role<>'citizen')
    or (action in ('queue','review','disburse') and profile.role<>'officer')
    or (action in ('rules','simulate','publish') and profile.role<>'admin')
    or (action='audit' and profile.role not in ('admin','auditor'))
    or (action in ('check','report','raast') and profile.role not in ('citizen','helper','shopkeeper','officer')) then
    perform relief_private.audit(uid,profile.role,'access_denied','action',action,'denied',rule.version);
    return relief_private.failure(403,'Your role does not have access to this operation.');
  end if;

  if action in ('draft','submit','evidence','report','consent','correction') then
    if idem is null then return relief_private.failure(400,'An idempotency key is required.'); end if;
    if action='consent' and not relief_private.can_access(uid,profile.role,person) then
      perform relief_private.audit(uid,profile.role,'access_denied','consent',person::text,'denied');
      return relief_private.failure(403,'Only the citizen can manage this consent.');
    end if;
    perform pg_advisory_xact_lock(hashtextextended(uid::text || action || idem::text,0));
    replay_request := args - 'analysis' - 'classification';
    select * into cached from public.idempotency_keys where user_id=uid and endpoint=action and key=idem;
    if found then
      if cached.request_json<>replay_request then return relief_private.failure(409,'This retry key was already used for a different request.'); end if;
      if profile.role='helper' and action='report' then
        select citizen_id into person from public.claims where id=(cached.response_json->>'claim_id')::uuid;
        if not relief_private.can_access(uid,profile.role,person) then
          perform relief_private.audit(uid,profile.role,'access_denied','report',person::text,'denied');
          return relief_private.failure(403,'This family has not granted you access.');
        end if;
      end if;
      return cached.response_json;
    end if;
  end if;

  case action
    when 'policy' then
      select coalesce(jsonb_agg(s order by s.section_code),'[]') into result
      from public.policy_sections s where s.policy_version=(select policy_version from public.policy_sections
        where effective_date<=current_date order by effective_date desc,policy_version desc limit 1);
    when 'policy_trace' then
      perform relief_private.audit(uid,profile.role,'policy_rag','policy',args->>'version',args->>'outcome',rule.version,
        detail=>jsonb_build_object('citations',args->'citations'));
      result := jsonb_build_object('ok',true);
    when 'scheme' then
      result := jsonb_build_object('name',rule.name,'version',rule.version,'config',rule.config_json);
    when 'nadra' then
      result := to_jsonb(citizen) - 'owner_id';
    when 'families' then
      select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'full_name',c.full_name,'village_area',c.village_area,
        'consent',coalesce(g.status,'missing')) order by c.full_name),'[]') into result
      from public.citizens c left join public.consents g on g.citizen_id=c.id and g.grantee_user_id=uid and g.scope='claim_access';
    when 'switch_family' then
      if not relief_private.can_access(uid,profile.role,person) then
        perform relief_private.audit(uid,profile.role,'access_denied','citizen',person::text,'denied');
        return relief_private.failure(403,'This family has not granted you access.');
      end if;
      delete from public.agent_sessions where user_id=uid;
      perform relief_private.audit(uid,profile.role,action,'citizen',person::text,'context_cleared');
      result := jsonb_build_object('citizenId',person);
    when 'claims' then
      select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('payment',to_jsonb(p),'documents',
        (select coalesce(jsonb_agg(d order by d.created_at),'[]') from public.claim_documents d where d.claim_id=c.id))
        order by c.updated_at desc),'[]') into result from public.claims c
        left join public.mock_payments p on p.claim_id=c.id where c.citizen_id=person;
    when 'privacy' then
      result := jsonb_build_object(
        'helpers',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'status',coalesce(g.status,'missing'))
          order by p.full_name),'[]') from public.profiles p left join public.consents g on g.grantee_user_id=p.id
          and g.citizen_id=person and g.scope='claim_access' where p.role='helper'),
        'officers',(select coalesce(jsonb_agg(distinct p.full_name),'[]') from public.claims c
          join public.profiles p on c.assigned_officer_id=p.id where c.citizen_id=person),
        'corrections',(select coalesce(jsonb_agg(d order by d.created_at desc),'[]')
          from public.data_correction_requests d where d.citizen_id=person));
    when 'consent' then
      target_user := (args->>'helperId')::uuid;
      decision := args->>'consent';
      if decision not in ('granted','revoked') or not exists(select 1 from public.profiles where id=target_user and role='helper') then
        return relief_private.failure(400,'Choose a valid helper and consent status.');
      end if;
      insert into public.consents(citizen_id,grantee_user_id,status,granted_at,revoked_at)
      values(person,target_user,decision,case when decision='granted' then now() end,case when decision='revoked' then now() end)
      on conflict(citizen_id,grantee_user_id,scope) do update set status=excluded.status,
        granted_at=coalesce(excluded.granted_at,consents.granted_at),revoked_at=excluded.revoked_at;
      if decision='revoked' then delete from public.agent_sessions where user_id=target_user and citizen_id=person; end if;
      perform relief_private.audit(uid,profile.role,'consent_'||decision,'citizen',person::text,decision,
        detail=>jsonb_build_object('grantee',target_user));
      result := jsonb_build_object('consent',decision);
    when 'correction' then
      insert into public.data_correction_requests(citizen_id,requested_by,field_name,current_value,proposed_value)
      values(person,uid,args->>'field',coalesce(to_jsonb(citizen)->>(args->>'field'),''),args->>'value') returning to_jsonb(data_correction_requests) into result;
      perform relief_private.audit(uid,profile.role,action,'citizen',person::text,'received');
    when 'draft','submit','evidence' then
      if requested_claim_id is not null then
        select * into claim from public.claims where id=requested_claim_id and citizen_id=person for update;
        if not found then return relief_private.failure(404,'Claim does not exist for this family.'); end if;
        if claim.status not in ('draft','needs_proof') then return relief_private.failure(409,'The claim is already with an officer.'); end if;
      elsif action='evidence' then
        return relief_private.failure(400,'Save the draft before adding evidence.');
      else
        insert into public.claims(citizen_id,submitted_by) values(person,uid) returning * into claim;
      end if;

      if action='evidence' then
        evidence_data := coalesce(args->'analysis','{}');
        insert into public.claim_documents(claim_id,doc_type,ocr_json,blur_score,tamper_flag,tamper_reason,verified_status)
          values(claim.id,args->>'docType',evidence_data,(evidence_data->>'blurScore')::numeric,
            coalesce((evidence_data->>'tamper')::boolean,false),evidence_data->>'note',coalesce(evidence_data->>'status','unverified'))
          returning to_jsonb(claim_documents) into result;
        perform relief_private.audit(uid,profile.role,'evidence_checked','claim',claim.id::text,result->>'verified_status',
          rule.version,coalesce(evidence_data->>'model','manual-v1'));
      else
        payload := args->'payload';
        if action='draft' then
          update public.claims set payload_json=payload,updated_at=now() where id=claim.id returning * into claim;
        else
          eligible := relief_private.payload_eligible(payload,rule.config_json);
          score := 0.96;
          next_state := 'submitted';
          note := 'Submitted for officer review. Every payout requires an officer decision.';
          decision := 'officer_review';
          select d.verified_status into evidence from public.claim_documents d where d.claim_id=claim.id
            order by d.created_at desc,d.id desc limit 1;
          if exists(select 1 from (select distinct on (doc_type) * from public.claim_documents
              where claim_id=claim.id order by doc_type, created_at desc, id desc) current_docs where tamper_flag) then
            score := 0.45; next_state := 'in_review'; note := 'A synthetic document may have been altered. An officer will check it.';
          elsif evidence is null or evidence in ('unreadable','incomplete','unverified') then
            score := 0.35; next_state := 'needs_proof'; decision := 'request_proof';
            note := 'Please attach clearer synthetic evidence before the officer can finish the review.';
          elsif exists(select 1 from public.citizens c where c.id<>person and
              (c.cnic_mock=citizen.cnic_mock or c.phone=citizen.phone) and c.name_phonetic=citizen.name_phonetic) then
            score := 0.50; next_state := 'in_review'; note := 'The mock identity may match another family. An officer will verify both records.';
          elsif not eligible then
            score := 0.84; note := 'The claim falls outside the current income or household rule. An officer will check the details.';
          end if;
          update public.claims set payload_json=payload,status=next_state,
            amount_pkr=(rule.config_json->>'amount_pkr')::int,rule_version_used=rule.version,ai_confidence=score,
            ai_route=decision,handoff_notes=note,citizen_reason_en=note,
            citizen_reason_ur=case when next_state='needs_proof' then 'براہ کرم واضح ثبوت جمع کریں۔'
              else 'آپ کی درخواست افسر کے جائزے کے لیے بھیج دی گئی ہے۔' end,
            updated_at=now() where id=claim.id returning * into claim;
        end if;
        result := to_jsonb(claim);
        perform relief_private.audit(uid,profile.role,action,'claim',claim.id::text,claim.status,claim.rule_version_used,
          score=>claim.ai_confidence,detail=>jsonb_build_object('route',claim.ai_route));
      end if;
    when 'queue' then
      select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('citizen_name',p.full_name,'payment',to_jsonb(m),'documents',
        (select coalesce(jsonb_agg(d order by created_at),'[]') from public.claim_documents d where d.claim_id=c.id),
        'reports',(select count(*) from public.scam_checks s where s.claim_id=c.id and s.missing_payment_reported))
        order by case when c.status in ('submitted','in_review','needs_proof') then 0 else 1 end,
        coalesce(c.ai_confidence,1),c.updated_at desc),'[]') into result
        from public.claims c join public.citizens p on p.id=c.citizen_id left join public.mock_payments m on m.claim_id=c.id
        where c.status<>'draft';
    when 'review','disburse' then
      select * into claim from public.claims where id=requested_claim_id for update;
      if not found or claim.status='draft' then return relief_private.failure(404,'Claim is not in the review queue.'); end if;
      if claim.assigned_officer_id is not null and claim.assigned_officer_id<>uid then
        perform relief_private.audit(uid,profile.role,'access_denied','claim',claim.id::text,'assigned_elsewhere');
        return relief_private.failure(403,'Another officer is assigned to this claim.');
      end if;
      decision := args->>'decision';
      if action='disburse' then
        if claim.status<>'approved' or claim.payment_status='paid' then
          return relief_private.failure(409,'An unpaid, approved claim is required.');
        end if;
        update public.mock_payments set status='paid',disbursed_at=now() where mock_payments.claim_id=claim.id;
        update public.claims set payment_status='paid',updated_at=now() where id=claim.id returning * into claim;
      else
        if claim.status in ('approved','rejected') and decision is distinct from 'close' or claim.status='closed' then
          return relief_private.failure(409,'This case already has a final decision.');
        end if;
        if decision='close' and (claim.status not in ('approved','rejected') or
           (claim.status='approved' and claim.payment_status='pending')) then
          return relief_private.failure(409,'Finish the decision and payment before closing.');
        end if;
        if decision='approve' and claim.status='needs_proof' then
          return relief_private.failure(409,'The citizen must resubmit the requested proof before approval.');
        end if;
        next_state := case decision when 'assign' then 'in_review' when 'escalate' then 'in_review'
          when 'more_proof' then 'needs_proof' when 'approve' then 'approved'
          when 'reject' then 'rejected' when 'close' then 'closed' end;
        if next_state is null then return relief_private.failure(400,'Unknown review action.'); end if;
        if decision='assign' and claim.status='needs_proof' then next_state := 'needs_proof'; end if;
        if decision='escalate' and claim.status='needs_proof' then next_state := 'needs_proof'; end if;
        update public.claims set status=next_state,assigned_officer_id=uid,
          citizen_reason_en=args->>'reason',citizen_reason_ur=nullif(args->>'reasonUr',''),updated_at=now()
          where id=claim.id returning * into claim;
        if decision='approve' then
          insert into public.mock_payments(claim_id,raast_ref,amount_pkr,status)
            values(claim.id,'SIM-' || upper(substr(claim.id::text,1,8)),claim.amount_pkr,'pending');
        end if;
      end if;
      perform relief_private.audit(uid,profile.role,case when action='disburse' then 'mock_payment_paid' else 'officer_'||decision end,
        'claim',claim.id::text,case when action='disburse' then claim.payment_status else claim.status end,
        claim.rule_version_used,detail=>jsonb_build_object('reason',args->>'reason'));
      result := to_jsonb(claim);
    when 'raast','check','report' then
      ref := upper(trim(coalesce(args->>'reference','')));
      select p.* into payment from public.mock_payments p where p.raast_ref=ref or upper(p.claim_id::text)=ref;
      select c.* into claim from public.claims c where c.id=payment.claim_id or (ref<>'' and upper(c.id::text)=ref) limit 1;
      if profile.role in ('citizen','helper') and claim.id is not null and
          not relief_private.can_access(uid,profile.role,claim.citizen_id) then
        perform relief_private.audit(uid,profile.role,'access_denied','payment',claim.id::text,'denied');
        return relief_private.failure(403,'This payment is outside your permitted family.');
      end if;
      if action='raast' then
        result := coalesce(to_jsonb(payment),jsonb_build_object('status','unmatched'));
      else
        if action='report' and claim.id is null then return relief_private.failure(404,'Enter a known claim or payment reference.'); end if;
        decision := coalesce(args->'classification'->>'label','uncertain');
        score := coalesce((args->'classification'->>'confidence')::numeric,0);
        model := coalesce(args->'classification'->>'model','deterministic-v1');
        if decision='genuine' and payment.id is null then decision := 'uncertain'; end if;
        insert into public.scam_checks(submitted_by,claim_id,message_text,jev_label,jev_confidence,jev_route,
          rail_match_status,missing_payment_reported) values(uid,claim.id,coalesce(args->>'message',''),decision,score,
          coalesce(args->'classification'->>'route','rail_lookup'),coalesce(payment.status,'unmatched'),action='report')
          returning to_jsonb(scam_checks) into result;
        result := result || jsonb_build_object('payment',to_jsonb(payment),'model',model);
        perform relief_private.audit(uid,profile.role,action,'payment',claim.id::text,decision,rule.version,model,score,
          jsonb_build_object('rail',coalesce(payment.status,'unmatched')));
      end if;
    when 'rules' then
      select coalesce(jsonb_agg(r order by r.version desc),'[]') into result from public.eligibility_rules r;
    when 'simulate' then
      select coalesce(jsonb_agg(jsonb_build_object('claim_id',c.id,'rule_version',c.rule_version_used,
        'before',relief_private.payload_eligible(c.payload_json,prior.config_json),
        'after',relief_private.payload_eligible(c.payload_json,args->'config')) order by c.created_at desc),'[]')
        into result from public.claims c join public.eligibility_rules prior on prior.version=c.rule_version_used;
      perform relief_private.audit(uid,profile.role,action,'rule',rule.version::text,'dry_run',rule.version);
    when 'publish' then
      perform pg_advisory_xact_lock(97140312);
      select coalesce(max(version),0)+1 into score from public.eligibility_rules;
      update public.eligibility_rules set is_active=false where is_active;
      insert into public.eligibility_rules(version,name,config_json,is_active,created_by)
        values(score::int,args->>'name',args->'config',true,uid) returning * into rule;
      perform relief_private.audit(uid,profile.role,action,'rule',rule.version::text,'published',rule.version);
      result := to_jsonb(rule);
    when 'audit' then
      select coalesce(jsonb_agg(a order by a.id desc),'[]') into result from
        (select * from public.audit_logs order by id desc limit 200) a;
    when 'agent_guard','agent_load','agent_save','agent_trace' then
      if person is not null and not relief_private.can_access(uid,profile.role,person) then
        perform relief_private.audit(uid,profile.role,'tool_blocked','citizen',person::text,'denied',rule.version);
        return relief_private.failure(403,'Family consent is missing or has been revoked.');
      end if;
      session_scope := coalesce(person,'00000000-0000-0000-0000-000000000000'::uuid);
      if action='agent_load' then
        select entries_json into result from public.agent_sessions where user_id=uid and citizen_id=session_scope;
        result := coalesce(result,'[]');
      elsif action='agent_save' then
        insert into public.agent_sessions(user_id,citizen_id,entries_json) values(uid,session_scope,args->'entries')
          on conflict(user_id,citizen_id) do update set entries_json=excluded.entries_json,updated_at=now();
        result := jsonb_build_object('ok',true);
      else
        if action='agent_trace' then perform relief_private.audit(uid,profile.role,coalesce(args->>'event','agent_tool'),
          'assistant',person::text,coalesce(args->>'outcome','ok'),rule.version,coalesce(args->>'model','deterministic-v1'),
          (args->>'confidence')::numeric,coalesce(args->'detail','{}')); end if;
        result := jsonb_build_object('role',profile.role,'citizenId',person,'ruleVersion',rule.version);
      end if;
    else
      perform relief_private.audit(uid,profile.role,'access_denied','action',action,'denied');
      return relief_private.failure(403,'This operation is unavailable.');
  end case;

  if idem is not null and action in ('draft','submit','evidence','report','consent','correction') then
    insert into public.idempotency_keys(key,user_id,endpoint,request_json,response_json)
      values(idem,uid,action,replay_request,result);
  end if;
  return result;
end;
$$;
revoke all on function public.relief_action(text,jsonb) from public, anon, authenticated;
grant execute on function public.relief_action(text,jsonb) to authenticated;

-- Internal model results and session writes are accessible only with a server-held proof.
create table relief_private.server_credentials (name text primary key, secret_hash text not null);
create function public.relief_gateway(action text, args jsonb, proof text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from relief_private.server_credentials
    where name='gateway' and secret_hash=encode(sha256(convert_to(proof,'UTF8')),'hex')) then
    return relief_private.failure(403,'Server gateway authorization failed.');
  end if;
  return public.relief_action(action,args);
end;
$$;
revoke all on function public.relief_action(text,jsonb) from authenticated;
revoke all on function public.relief_gateway(text,jsonb,text) from public, anon, authenticated;
grant execute on function public.relief_gateway(text,jsonb,text) to authenticated;

create function public.relief_partner(action text, supplied_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  key_row public.api_keys%rowtype;
begin
  select * into key_row from public.api_keys
    where key_hash=encode(sha256(convert_to(supplied_key,'UTF8')),'hex') and is_active;
  if key_row.id is null then return relief_private.failure(401,'Invalid API key.'); end if;
  if not (action=any(key_row.scopes)) then return relief_private.failure(403,'This key has no scope for the operation.'); end if;
  perform relief_private.audit(null,'partner',action,'api_key',key_row.id::text,'read');
  return (select jsonb_build_object('scheme',name,'version',version,'rules',config_json,'simulated',true)
    from public.eligibility_rules where is_active);
end;
$$;
revoke all on function public.relief_partner(text,text) from public, anon, authenticated;
grant execute on function public.relief_partner(text,text) to anon, authenticated;
