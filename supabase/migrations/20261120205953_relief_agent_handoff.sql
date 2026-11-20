create function relief_private.escalate_claim(args jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  uid uuid := auth.uid();
  actor text;
  person uuid := (args->>'citizenId')::uuid;
  requested_id uuid := (args->>'claimId')::uuid;
  note text := left(trim(args->>'reason'),300);
  item public.claims%rowtype;
begin
  select role into actor from public.profiles where id=uid;
  if actor is null then return relief_private.failure(401,'Sign in with a demo persona.'); end if;
  if not relief_private.can_access(uid,actor,person) then
    perform relief_private.audit(uid,actor,'tool_blocked','claim',requested_id::text,'denied');
    return relief_private.failure(403,'Family consent is missing or has been revoked.');
  end if;
  if note is null or length(note)<5 then return relief_private.failure(400,'Provide a handoff reason.'); end if;
  select * into item from public.claims where id=requested_id and citizen_id=person for update;
  if not found then return relief_private.failure(404,'Claim does not exist for this family.'); end if;
  if item.status not in ('submitted','in_review','needs_proof') then
    return relief_private.failure(409,'Only a claim awaiting officer review can be flagged.');
  end if;
  update public.claims set status=case when status='needs_proof' then status else 'in_review' end,
    handoff_notes=left(concat_ws(E'\n',handoff_notes,'Assistant handoff: '||note),800),
    ai_route='officer_review',updated_at=now()
    where id=item.id returning * into item;
  perform relief_private.audit(uid,actor,'assistant_handoff','claim',item.id::text,item.status,item.rule_version_used,
    detail=>jsonb_build_object('reason',note));
  return jsonb_build_object('claimId',item.id,'status',item.status);
end;
$$;

create or replace function public.relief_gateway(action text, args jsonb, proof text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from relief_private.server_credentials
    where name='gateway' and secret_hash=encode(sha256(convert_to(proof,'UTF8')),'hex')) then
    return relief_private.failure(403,'Server gateway authorization failed.');
  end if;
  if action='agent_escalate' then return relief_private.escalate_claim(args); end if;
  return public.relief_action(action,args);
end;
$$;
