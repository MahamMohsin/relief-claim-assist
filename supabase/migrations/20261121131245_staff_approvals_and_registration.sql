-- Migration: 20261121131245_staff_approvals_and_registration.sql
-- Enables open registration with approval gates for helpers, officers, and auditors.

-- 1. Add status and approval tracking to profiles
alter table public.profiles
  add column if not exists status text not null default 'active'
    check (status in ('active', 'pending_approval', 'suspended', 'rejected')),
  add column if not exists approved_by uuid references public.profiles(id),
  add column if not exists approved_at timestamptz;

create index if not exists idx_profiles_status on public.profiles(status);

-- 2. Update relief_action function to:
--    a) Block users whose status is pending_approval, suspended, or rejected.
--    b) Provide admin actions 'staff_queue' and 'decide_staff'.
create or replace function public.relief_action(action text, args jsonb default '{}') returns jsonb
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
  if profile.id is null then return relief_private.failure(401,'Sign in with a valid account.'); end if;

  -- Block unapproved or suspended staff
  if profile.status = 'pending_approval' then
    return relief_private.failure(403, 'Your account is pending administrator approval. Please wait for an administrator to verify your credentials.');
  end if;
  if profile.status in ('suspended', 'rejected') then
    return relief_private.failure(403, 'Your account has been deactivated or rejected.');
  end if;

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
    or (action in ('rules','simulate','publish','staff_queue','decide_staff') and profile.role<>'admin')
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
    when 'staff_queue' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'email', p.email,
        'full_name', p.full_name,
        'role', p.role,
        'phone', p.phone,
        'status', p.status,
        'created_at', p.created_at
      ) order by p.created_at desc), '[]'::jsonb) into result
      from public.profiles p
      where p.status = 'pending_approval';

    when 'decide_staff' then
      target_user := nullif(args->>'userId', '')::uuid;
      decision := args->>'decision';
      if target_user is null or decision not in ('active', 'rejected', 'suspended') then
        return relief_private.failure(400, 'Specify a valid target userId and decision.');
      end if;

      update public.profiles
      set status = decision,
          approved_by = uid,
          approved_at = now()
      where id = target_user;

      perform relief_private.audit(uid, profile.role, 'staff_approval', 'profile', target_user::text, decision,
        detail => jsonb_build_object(
          'target_role', (select role from public.profiles where id = target_user),
          'decision', decision
        ));

      result := jsonb_build_object('ok', true, 'userId', target_user, 'status', decision);

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
      from public.citizens c
      left join public.consents g on g.citizen_id=c.id and g.grantee_user_id=uid and g.scope='claim_access'
      where c.owner_id is null or c.owner_id<>uid;
    when 'switch_family' then
      select * into citizen from public.citizens where id=person;
      if citizen.id is null then return relief_private.failure(404,'Family not found.'); end if;
      if not exists(select 1 from public.consents where citizen_id=person and grantee_user_id=uid and scope='claim_access' and status='granted') then
        perform relief_private.audit(uid,profile.role,'access_denied','family',person::text,'denied');
        return relief_private.failure(403,'Consent has not been granted for this family.');
      end if;
      delete from public.claims where citizen_id=person and submitted_by=uid and status='draft';
      delete from public.agent_sessions where user_id=uid;
      perform relief_private.audit(uid,profile.role,'family_switch','family',person::text,'switched');
      result := jsonb_build_object('ok',true,'citizenId',person);
    when 'privacy' then
      result := jsonb_build_object(
        'helpers',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'status',g.status))
          from public.consents g join public.profiles p on p.id=g.grantee_user_id where g.citizen_id=person),'[]'::jsonb),
        'officers',coalesce((select jsonb_agg(distinct p.full_name) from public.claims c
          join public.profiles p on p.id=c.assigned_officer_id where c.citizen_id=person),'[]'::jsonb),
        'corrections',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'field_name',r.field_name,
          'proposed_value',r.proposed_value,'status',r.status)) from public.data_correction_requests r where r.citizen_id=person),'[]'::jsonb)
      );
    when 'consent' then
      target_user := nullif(args->>'helperId','')::uuid;
      if target_user is null then return relief_private.failure(400,'Specify a helper.'); end if;
      insert into public.consents(citizen_id,grantee_user_id,status,granted_at,revoked_at)
      values(person,target_user,args->>'consent',
        case when args->>'consent'='granted' then now() end,
        case when args->>'consent'='revoked' then now() end)
      on conflict (citizen_id,grantee_user_id,scope) do update
        set status=excluded.status,
            granted_at=coalesce(excluded.granted_at,public.consents.granted_at),
            revoked_at=coalesce(excluded.revoked_at,public.consents.revoked_at);
      perform relief_private.audit(uid,profile.role,args->>'consent','consent',target_user::text,args->>'consent',
        detail=>jsonb_build_object('citizen',person));
      result := jsonb_build_object('ok',true,'status',args->>'consent');
    when 'correction' then
      insert into public.data_correction_requests(citizen_id,requested_by,field_name,current_value,proposed_value)
      values(person,uid,args->>'field',coalesce(to_jsonb(citizen)->>(args->>'field'),''),args->>'value');
      perform relief_private.audit(uid,profile.role,'correction_request','citizen',person::text,'queued',
        detail=>jsonb_build_object('field',args->>'field','value',args->>'value'));
      result := jsonb_build_object('ok',true);
    when 'claims' then
      select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object(
        'payment',(select to_jsonb(m) from public.mock_payments m where m.claim_id=c.id),
        'reports',(select count(*) from public.scam_checks sc where sc.claim_id=c.id),
        'documents',coalesce((select jsonb_agg(to_jsonb(d)) from public.claim_documents d where d.claim_id=c.id),'[]'::jsonb)
      ) order by c.updated_at desc),'[]') into result
      from public.claims c where c.citizen_id=person;
    when 'draft' then
      payload := args->'payload';
      if requested_claim_id is not null then
        select * into claim from public.claims where id=requested_claim_id and citizen_id=person;
        if claim.id is null then return relief_private.failure(404,'Claim not found.'); end if;
        if claim.status<>'draft' then return relief_private.failure(409,'Only draft claims can be updated.'); end if;
        update public.claims set payload_json=payload,updated_at=now() where id=claim.id;
      else
        insert into public.claims(citizen_id,submitted_by,status,payload_json,rule_version_used)
        values(person,uid,'draft',payload,rule.version) returning * into claim;
      end if;
      perform relief_private.audit(uid,profile.role,'draft_saved','claim',claim.id::text,'draft',rule.version);
      result := to_jsonb(claim);
    when 'submit' then
      payload := args->'payload';
      if requested_claim_id is not null then
        select * into claim from public.claims where id=requested_claim_id and citizen_id=person;
        if claim.id is null then return relief_private.failure(404,'Claim not found.'); end if;
      else
        insert into public.claims(citizen_id,submitted_by,status,payload_json,rule_version_used)
        values(person,uid,'draft',payload,rule.version) returning * into claim;
      end if;
      eligible := relief_private.payload_eligible(payload,rule.config_json);
      score := coalesce(nullif(args->>'confidence','')::numeric, 0.91);
      next_state := case
        when not eligible then 'rejected'
        when score < (rule.config_json->>'confidence_threshold')::numeric then 'in_review'
        else 'submitted'
      end;
      note := case
        when not eligible then 'Income or household size did not meet emergency cash assistance criteria.'
        when next_state='in_review' then 'Flagged for officer verification due to low AI confidence threshold.'
        else 'Pre-checks passed. Mock officer queue review pending.'
      end;
      update public.claims set
        status=next_state,
        payload_json=payload,
        amount_pkr=case when next_state='rejected' then 0 else (rule.config_json->>'amount_pkr')::int end,
        rule_version_used=rule.version,
        ai_confidence=score,
        ai_route=next_state,
        citizen_reason_en=note,
        citizen_reason_ur=case when not eligible then 'آمدنی یا گھر کے افراد کی تعداد مقررہ معیار کے مطابق نہیں ہے۔' else 'درخواست جمع ہو گئی۔ افسر کی جانچ باقی ہے۔' end,
        updated_at=now()
      where id=claim.id returning * into claim;
      perform relief_private.audit(uid,profile.role,'submit_claim','claim',claim.id::text,next_state,rule.version,score=>score,
        detail=>jsonb_build_object('eligible',eligible,'route',next_state));
      result := to_jsonb(claim);
    when 'evidence' then
      select * into claim from public.claims where id=requested_claim_id and citizen_id=person;
      if claim.id is null then return relief_private.failure(404,'Claim not found.'); end if;
      evidence := args->>'docType';
      evidence_data := coalesce(args->'analysis','{}'::jsonb);
      insert into public.claim_documents(claim_id,doc_type,file_url,ocr_json,blur_score,tamper_flag,tamper_reason,verified_status)
      values(claim.id,evidence,args->>'fileUrl',
        coalesce(evidence_data->'ocr','{}'::jsonb),
        nullif(evidence_data->>'blur_score','')::numeric,
        coalesce((evidence_data->>'tamper_flag')::boolean,false),
        evidence_data->>'tamper_reason',
        case when coalesce((evidence_data->>'tamper_flag')::boolean,false) then 'tampered'
             when (evidence_data->>'blur_score')::numeric < 0.4 then 'unverified' else 'verified' end);
      if coalesce((evidence_data->>'tamper_flag')::boolean,false) then
        update public.claims set status='needs_proof',updated_at=now(),
          citizen_reason_en='Attached document flagged for manual review: ' || coalesce(evidence_data->>'tamper_reason','suspected alteration.'),
          citizen_reason_ur='دستاویز میں ردوبدل کا شبہ ہے۔ اصل ثبوت درکار ہے۔'
        where id=claim.id;
        perform relief_private.audit(uid,profile.role,'tamper_detected','claim_document',claim.id::text,'flagged',rule.version,
          detail=>evidence_data);
      end if;
      result := jsonb_build_object('ok',true,'docType',evidence,'tamper',coalesce((evidence_data->>'tamper_flag')::boolean,false));
    when 'queue' then
      select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object(
        'citizen_name',ct.full_name,
        'village_area',ct.village_area,
        'documents',coalesce((select jsonb_agg(to_jsonb(d)) from public.claim_documents d where d.claim_id=c.id),'[]'::jsonb),
        'payment',(select to_jsonb(m) from public.mock_payments m where m.claim_id=c.id)
      ) order by case c.status when 'needs_proof' then 1 when 'in_review' then 2 when 'submitted' then 3 else 4 end,
        coalesce(c.ai_confidence,0) asc, c.updated_at asc),'[]') into result
      from public.claims c
      join public.citizens ct on ct.id=c.citizen_id
      where c.status in ('submitted','needs_proof','in_review','approved');
    when 'review' then
      select * into claim from public.claims where id=requested_claim_id;
      if claim.id is null then return relief_private.failure(404,'Claim not found.'); end if;
      decision := args->>'decision';
      next_state := case decision
        when 'approve' then 'approved'
        when 'reject' then 'rejected'
        when 'more_proof' then 'needs_proof'
        when 'escalate' then 'in_review'
        when 'close' then 'closed'
        when 'assign' then claim.status
        else null
      end;
      if next_state is null then return relief_private.failure(400,'Unknown review decision.'); end if;
      update public.claims set
        status=next_state,
        assigned_officer_id=uid,
        handoff_notes=args->>'reason',
        citizen_reason_en=args->>'reason',
        citizen_reason_ur=coalesce(args->>'reasonUr',args->>'reason'),
        amount_pkr=case when next_state='approved' and amount_pkr=0 then (rule.config_json->>'amount_pkr')::int else amount_pkr end,
        updated_at=now()
      where id=claim.id returning * into claim;
      perform relief_private.audit(uid,profile.role,'officer_decision','claim',claim.id::text,decision,rule.version,
        detail=>jsonb_build_object('notes',args->>'reason'));
      result := to_jsonb(claim);
    when 'disburse' then
      select * into claim from public.claims where id=requested_claim_id;
      if claim.id is null then return relief_private.failure(404,'Claim not found.'); end if;
      if claim.status<>'approved' then return relief_private.failure(409,'Only approved claims can be disbursed.'); end if;
      ref := 'RAAST-' || upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 12));
      insert into public.mock_payments(claim_id,raast_ref,amount_pkr,status,disbursed_at)
      values(claim.id,ref,claim.amount_pkr,'paid',now())
      on conflict (claim_id) do update set status='paid',disbursed_at=now() returning * into payment;
      update public.claims set payment_status='paid',updated_at=now() where id=claim.id;
      perform relief_private.audit(uid,profile.role,'disburse_payment','mock_payment',payment.id::text,'paid',rule.version,
        detail=>jsonb_build_object('raast_ref',ref,'amount',claim.amount_pkr));
      result := to_jsonb(payment);
    when 'check' then
      ref := upper(trim(coalesce(args->>'reference','')));
      select * into payment from public.mock_payments where raast_ref=ref;
      score := coalesce(nullif(args->>'confidence','')::numeric, 0.88);
      model := coalesce(args->>'model','mock-jev-v1');
      decision := case
        when payment.id is not null then 'legitimate'
        when ref like 'FAKE%' or ref like 'SCAM%' then 'scam'
        when length(coalesce(args->>'message','')) > 0 and (args->>'message') ~* '(win|won|prize|lottery|urgent|transfer fee|pin code|otp)' then 'scam'
        else 'unverified'
      end;
      insert into public.scam_checks(submitted_by,claim_id,message_text,jev_label,jev_confidence,jev_route,rail_match_status,created_at)
      values(uid,payment.claim_id,coalesce(args->>'message',ref),decision,score,
        case when decision='scam' then 'alert' when decision='legitimate' then 'verified' else 'officer_review' end,
        case when payment.id is not null then 'matched' else 'not_found' end,now()) returning * into cached;
      perform relief_private.audit(uid,profile.role,'scam_check','scam_check',cached.id::text,decision,rule.version,
        model=>model,score=>score,detail=>jsonb_build_object('reference',ref,'rail_status',cached.rail_match_status));
      result := jsonb_build_object(
        'id',cached.id,'claim_id',payment.claim_id,'jev_label',decision,'jev_confidence',score,
        'jev_route',cached.jev_route,'rail_match_status',cached.rail_match_status,
        'payment',case when payment.id is not null then to_jsonb(payment) else null end,'model',model
      );
    when 'report' then
      ref := upper(trim(args->>'reference'));
      select * into payment from public.mock_payments where raast_ref=ref;
      if payment.id is null then return relief_private.failure(404,'Raast payment reference was not found in mock settlement ledger.'); end if;
      insert into public.scam_checks(submitted_by,claim_id,message_text,jev_label,jev_confidence,jev_route,rail_match_status,missing_payment_reported,created_at)
      values(uid,payment.claim_id,coalesce(args->>'message','Missing payment reported at shop'),'shop_dispute',0.99,'officer_queue','matched',true,now())
      returning * into cached;
      update public.claims set status='in_review',updated_at=now(),
        handoff_notes='Shopkeeper dispute reported for reference ' || ref || '. Requires officer reconciliation.'
      where id=payment.claim_id;
      perform relief_private.audit(uid,profile.role,'missing_payment_reported','scam_check',cached.id::text,'reported',rule.version,
        detail=>jsonb_build_object('raast_ref',ref,'claim_id',payment.claim_id));
      result := jsonb_build_object('ok',true,'reportId',cached.id,'claim_id',payment.claim_id);
    when 'rules' then
      select coalesce(jsonb_agg(to_jsonb(r) order by r.version desc),'[]') into result
      from public.eligibility_rules r;
    when 'publish' then
      payload := args->'config';
      select coalesce(max(version),0)+1 into score from public.eligibility_rules;
      update public.eligibility_rules set is_active=false where is_active;
      insert into public.eligibility_rules(version,name,config_json,is_active,created_by)
      values(score::int,args->>'name',payload,true,uid) returning * into rule;
      perform relief_private.audit(uid,profile.role,'publish_rule','eligibility_rule',rule.id::text,'published',rule.version,
        detail=>rule.config_json);
      result := to_jsonb(rule);
    when 'simulate' then
      payload := args->'config';
      select jsonb_build_object(
        'total_tested',count(*),
        'would_approve',count(*) filter (where relief_private.payload_eligible(c.payload_json,payload)),
        'would_reject',count(*) filter (where not relief_private.payload_eligible(c.payload_json,payload)),
        'estimated_pkr',count(*) filter (where relief_private.payload_eligible(c.payload_json,payload)) * (payload->>'amount_pkr')::int,
        'simulated_rule',payload
      ) into result from public.claims c where c.payload_json<>'{}'::jsonb;
      perform relief_private.audit(uid,profile.role,'rule_simulation','eligibility_rule',null,'simulated',
        detail=>result);
    when 'audit' then
      select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc limit 200),'[]') into result
      from public.audit_logs a;
    else
      return relief_private.failure(400,'Unsupported relief operation.');
  end case;

  if idem is not null and action in ('draft','submit','evidence','report','consent','correction') then
    insert into public.idempotency_keys(user_id,endpoint,key,request_json,response_json)
    values(uid,action,idem,replay_request,result);
  end if;

  return result;
end;
$$;
