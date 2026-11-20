create table relief_private.claim_images (
  document_id uuid primary key references public.claim_documents(id),
  image_data text not null check (length(image_data) between 25 and 2800000)
);
revoke all on table relief_private.claim_images from public, anon, authenticated;

create function relief_private.evidence_file(args jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  uid uuid := auth.uid();
  actor text;
  document uuid := (args->>'documentId')::uuid;
  item public.claims%rowtype;
  image text;
begin
  select role into actor from public.profiles where id=uid;
  if actor is null then return relief_private.failure(401,'Sign in with a demo persona.'); end if;
  select c.* into item from public.claims c join public.claim_documents d on d.claim_id=c.id where d.id=document;
  if item.id is null then return relief_private.failure(404,'The synthetic document could not be found.'); end if;
  if not (relief_private.can_access(uid,actor,item.citizen_id) or
    (actor='officer' and item.status<>'draft' and (item.assigned_officer_id is null or item.assigned_officer_id=uid))) then
    perform relief_private.audit(uid,actor,'access_denied','document',document::text,'denied',item.rule_version_used);
    return relief_private.failure(403,'Your role or family consent does not allow you to open this document.');
  end if;
  select image_data into image from relief_private.claim_images where document_id=document;
  if image is null then return relief_private.failure(404,'This sample has no attached image.'); end if;
  perform relief_private.audit(uid,actor,'evidence_viewed','document',document::text,'read',item.rule_version_used);
  return jsonb_build_object('image',image);
end;
$$;

create or replace function public.relief_gateway(action text, args jsonb, proof text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
  document uuid;
  file_path text;
begin
  if not exists (select 1 from relief_private.server_credentials
    where name='gateway' and secret_hash=encode(sha256(convert_to(proof,'UTF8')),'hex')) then
    return relief_private.failure(403,'Server gateway authorization failed.');
  end if;
  if action='agent_escalate' then return relief_private.escalate_claim(args); end if;
  if action='evidence_file' then return relief_private.evidence_file(args); end if;
  result := public.relief_action(action,args - 'image');
  if action='evidence' and args->>'image' is not null and result->>'id' is not null then
    document := (result->>'id')::uuid;
    file_path := '/api/relief/evidence-file/'||document::text;
    insert into relief_private.claim_images(document_id,image_data) values(document,args->>'image') on conflict(document_id) do nothing;
    update public.claim_documents set file_url=file_path where id=document and file_url is null;
    result := result || jsonb_build_object('file_url',file_path);
  elsif action in ('check','report') and result->'payment'->>'id' is null and result ? 'payment' then
    result := result || '{"payment":null}'::jsonb;
  elsif action='raast' and result->>'id' is null and not result ? 'error' then
    result := jsonb_build_object('status','unmatched');
  end if;
  return result;
end;
$$;
