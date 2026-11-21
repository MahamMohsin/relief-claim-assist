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
  target_role text;
begin
  select * into profile from public.profiles where id=uid;
  if profile.id is null then return relief_private.failure(401,'Sign in with a demo persona.'); end if;
  if profile.status is distinct from 'active' then
    perform relief_private.audit(uid,profile.role,'access_denied','account',uid::text,profile.status);
    return relief_private.failure(403,case when profile.status='pending_approval' then 'Your staff account is pending administrator approval.' else 'This account is inactive.' end);
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
    or (action='overview' and profile.role not in ('officer','admin','auditor'))
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
    WHEN 'staff_queue' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(p) - 'email' ORDER BY p.created_at DESC), '[]'::jsonb)
        INTO result
      FROM public.profiles p
      WHERE p.status = 'pending_approval';

    WHEN 'decide_staff' THEN
      target_user := (args->>'userId')::uuid;
      decision := args->>'decision';
      IF decision NOT IN ('active', 'rejected') THEN
        RETURN relief_private.failure(400, 'Decision must be active or rejected.');
      END IF;

      UPDATE public.profiles
         SET status      = decision,
             approved_by = uid,
             approved_at = now()
       WHERE id = target_user
         AND status = 'pending_approval';

      IF NOT FOUND THEN
        RETURN relief_private.failure(404, 'No pending account with that id.');
      END IF;

      SELECT role INTO target_role FROM public.profiles WHERE id = target_user;
      PERFORM relief_private.audit(
        uid, profile.role, 'staff_approval', 'profile', target_user::text, decision,
        detail => jsonb_build_object('target_role', target_role, 'decision', decision)
      );

      result := jsonb_build_object('ok', true, 'userId', target_user, 'status', decision);


    when 'overview' then
      select jsonb_build_object(
        'active',count(*) filter(where status in ('submitted','in_review','needs_proof')),
        'review',count(*) filter(where status in ('submitted','in_review')),
        'proof',count(*) filter(where status='needs_proof'),
        'approved',count(*) filter(where status='approved'),
        'rejected',count(*) filter(where status='rejected'),
        'closed',count(*) filter(where status='closed'),
        'paid',count(*) filter(where payment_status='paid'),
        'new_this_month',count(*) filter(where created_at>=date_trunc('month',now())),
        'priority',count(*) filter(where status in ('submitted','in_review','needs_proof') and ai_confidence<=0.55)
      ) into result from public.claims where status<>'draft';
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
          if next_state='submitted' and score<(rule.config_json->>'confidence_threshold')::numeric then
            next_state := 'in_review';
            note := note || ' Confidence is below the active review threshold.';
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
        case when c.status in ('submitted','in_review','needs_proof') and c.ai_confidence<=0.55 then 0 else 1 end,
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
        next_state := coalesce(args->>'outcome','paid');
        if next_state not in ('paid','failed') then return relief_private.failure(400,'Invalid simulated outcome.'); end if;
        insert into public.mock_payments(claim_id,raast_ref,amount_pkr,status,disbursed_at)
          values(claim.id,'SIM-'||upper(substr(claim.id::text,1,8)),claim.amount_pkr,next_state,case when next_state='paid' then now() end)
          on conflict (claim_id) do update set status=excluded.status,disbursed_at=excluded.disbursed_at;
        update public.claims set payment_status=next_state,updated_at=now() where id=claim.id returning * into claim;
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
      perform relief_private.audit(uid,profile.role,case when action='disburse' then 'mock_payment_'||claim.payment_status else 'officer_'||decision end,
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

-- Apply account status to the gateway paths that run outside relief_action.
do $$
declare
  definition text := pg_get_functiondef('public.relief_gateway(text,jsonb,text)'::regprocedure);
  boundary text := $anchor$  if action='agent_escalate' then$anchor$;
  guard text := $guard$  if action in ('agent_escalate','evidence_file') and exists
    (select 1 from public.profiles where id=auth.uid() and status<>'active') then
    perform relief_private.audit(auth.uid(),(select role from public.profiles where id=auth.uid()),
      'access_denied','account',auth.uid()::text,'inactive');
    return relief_private.failure(403,'Your account is pending approval or inactive.');
  end if;
$guard$;
begin
  if position(boundary in definition)=0 then raise exception 'Unexpected relief gateway definition'; end if;
  execute replace(definition,boundary,guard || boundary);
end;
$$;
