-- Background job queue for slow work (evidence OCR, claim triage, notifications).
-- Plain Postgres table + FOR UPDATE SKIP LOCKED (no pgmq dependency).
-- All access goes through public.relief_jobs(), which requires the server gateway secret,
-- so browsers cannot read or run jobs directly. relief_action is not modified.

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('evidence_ocr', 'claim_triage', 'notify')),
  claim_id uuid references public.claims(id),
  dedupe_key text not null,
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'dead')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  last_error text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (type, dedupe_key)
);
create index if not exists jobs_status_run_after_idx on public.jobs (status, run_after);
create index if not exists jobs_claim_idx on public.jobs (claim_id, created_at);
alter table public.jobs enable row level security;
revoke all on table public.jobs from public, anon, authenticated;

create or replace function public.relief_jobs(action text, args jsonb, proof text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  job public.jobs%rowtype;
  claim public.claims%rowtype;
  citizen public.citizens%rowtype;
  rule public.eligibility_rules%rowtype;
  doc public.claim_documents%rowtype;
  result jsonb;
  analysis jsonb;
  eligible boolean;
  score numeric;
  next_state text;
  note text;
  decision text;
  evidence text;
  worker_actor constant text := 'system/worker';
  human_note constant text := 'Automatic check failed — needs human review';
begin
  if not exists (
    select 1 from relief_private.server_credentials
    where (name = 'gateway' or name like 'gateway:%')
      and secret_hash = encode(sha256(convert_to(proof, 'UTF8')), 'hex')
  ) then
    return relief_private.failure(403, 'Server job authorization failed.');
  end if;

  case action
    when 'ping' then
      return jsonb_build_object('ok', true);

    -- Idempotent enqueue: the same (type, dedupe_key) never creates a second job.
    when 'enqueue' then
      insert into public.jobs (type, claim_id, dedupe_key, payload, run_after)
      values (args->>'type', nullif(args->>'claimId', '')::uuid, args->>'dedupeKey', coalesce(args->'payload', '{}'),
        now() + make_interval(secs => coalesce((args->>'delaySeconds')::int, 0)))
      on conflict (type, dedupe_key) do nothing
      returning * into job;
      if found then
        perform relief_private.audit(null, worker_actor, 'job_queued', 'job', job.id::text, 'queued', null, 'job-queue-v1', null,
          jsonb_build_object('type', job.type, 'claim_id', job.claim_id, 'attempts', job.attempts));
        return jsonb_build_object('queued', true, 'id', job.id);
      end if;
      return jsonb_build_object('queued', false);

    -- Show "Checking documents" while automation owns the claim.
    when 'mark_checking' then
      update public.claims set ai_route = 'checking',
        citizen_reason_en = 'Received. Checking your documents…',
        citizen_reason_ur = 'درخواست موصول ہو گئی۔ آپ کے کاغذات کی جانچ ہو رہی ہے۔',
        updated_at = now()
      where id = (args->>'claimId')::uuid and status in ('submitted', 'in_review', 'needs_proof') and assigned_officer_id is null;
      return jsonb_build_object('ok', true);

    -- Claim up to N due jobs. Stale running jobs (worker died) are picked up again after 5 minutes.
    when 'claim' then
      with picked as (
        select id from public.jobs
        where (status = 'queued' and run_after <= now()) or (status = 'running' and locked_at < now() - interval '5 minutes')
        order by run_after
        limit greatest(1, least(coalesce((args->>'limit')::int, 5), 20))
        for update skip locked
      ), locked as (
        update public.jobs j set status = 'running', locked_at = now(), attempts = j.attempts + 1, updated_at = now()
        from picked where j.id = picked.id
        returning j.*
      )
      select coalesce(jsonb_agg(to_jsonb(l) order by l.run_after), '[]') into result from locked l;
      insert into public.audit_logs (actor_id, actor_role, event_type, entity_type, entity_id, outcome, model_version, metadata_json)
      select null, worker_actor, 'job_started', 'job', (x->>'id'), 'running', 'job-queue-v1',
        jsonb_build_object('type', x->>'type', 'claim_id', x->>'claim_id', 'attempts', (x->>'attempts')::int)
      from jsonb_array_elements(result) x;
      return result;

    when 'evidence_input' then
      select * into doc from public.claim_documents where id = (args->>'documentId')::uuid;
      if not found then return relief_private.failure(404, 'Document not found.'); end if;
      select * into claim from public.claims where id = doc.claim_id;
      return jsonb_build_object('documentId', doc.id, 'claimId', doc.claim_id, 'docType', doc.doc_type,
        'image', (select image_data from relief_private.claim_images where document_id = doc.id),
        'notes', coalesce(claim.payload_json->>'notes', ''));

    when 'evidence_result' then
      analysis := coalesce(args->'analysis', '{}');
      update public.claim_documents set ocr_json = analysis,
        blur_score = (analysis->>'blurScore')::numeric,
        tamper_flag = coalesce((analysis->>'tamper')::boolean, false),
        tamper_reason = analysis->>'note',
        verified_status = coalesce(analysis->>'status', 'unverified')
      where id = (args->>'documentId')::uuid
      returning * into doc;
      if not found then return relief_private.failure(404, 'Document not found.'); end if;
      perform relief_private.audit(null, worker_actor, 'evidence_checked', 'claim', doc.claim_id::text, doc.verified_status,
        null, coalesce(analysis->>'model', 'manual-v1'), null, jsonb_build_object('document_id', doc.id, 'source', 'evidence_ocr'));
      return to_jsonb(doc);

    -- Same routing rules as relief_action('submit'), re-run once every document has been checked.
    when 'triage' then
      select * into claim from public.claims where id = (args->>'claimId')::uuid for update;
      if not found then return relief_private.failure(404, 'Claim not found.'); end if;
      if exists (select 1 from public.claim_documents where claim_id = claim.id and verified_status = 'processing') then
        return jsonb_build_object('waiting', true);
      end if;
      if claim.status not in ('submitted', 'in_review', 'needs_proof') or claim.assigned_officer_id is not null
         or coalesce(claim.ai_route, '') <> 'checking' then
        return jsonb_build_object('skipped', true, 'status', claim.status);
      end if;
      select * into rule from public.eligibility_rules where is_active;
      select * into citizen from public.citizens where id = claim.citizen_id;
      eligible := relief_private.payload_eligible(claim.payload_json, rule.config_json);
      score := 0.96;
      next_state := 'submitted';
      note := 'Submitted for officer review. Every payout requires an officer decision.';
      decision := 'officer_review';
      select d.verified_status into evidence from public.claim_documents d where d.claim_id = claim.id
        order by d.created_at desc, d.id desc limit 1;
      if exists (select 1 from (select distinct on (doc_type) * from public.claim_documents
          where claim_id = claim.id order by doc_type, created_at desc, id desc) current_docs where tamper_flag) then
        score := 0.45; next_state := 'in_review'; note := 'A synthetic document may have been altered. An officer will check it.';
      elsif evidence is null or evidence in ('unreadable', 'incomplete', 'unverified') then
        score := 0.35; next_state := 'needs_proof'; decision := 'request_proof';
        note := 'Please attach clearer synthetic evidence before the officer can finish the review.';
      elsif exists (select 1 from public.citizens c where c.id <> citizen.id and
          (c.cnic_mock = citizen.cnic_mock or c.phone = citizen.phone) and c.name_phonetic = citizen.name_phonetic) then
        score := 0.50; next_state := 'in_review'; note := 'The mock identity may match another family. An officer will verify both records.';
      elsif not eligible then
        score := 0.84; note := 'The claim falls outside the current income or household rule. An officer will check the details.';
      end if;
      if next_state = 'submitted' and score < (rule.config_json->>'confidence_threshold')::numeric then
        next_state := 'in_review';
        note := note || ' Confidence is below the active review threshold.';
      end if;
      update public.claims set status = next_state, ai_confidence = score, ai_route = decision,
        handoff_notes = note, citizen_reason_en = note,
        citizen_reason_ur = case when next_state = 'needs_proof' then 'براہ کرم واضح ثبوت جمع کریں۔'
          else 'آپ کی درخواست افسر کے جائزے کے لیے بھیج دی گئی ہے۔' end,
        updated_at = now()
      where id = claim.id returning * into claim;
      perform relief_private.audit(null, worker_actor, 'claim_triage', 'claim', claim.id::text, claim.status, rule.version,
        'job-queue-v1', claim.ai_confidence, jsonb_build_object('route', claim.ai_route));
      return jsonb_build_object('status', claim.status, 'route', claim.ai_route);

    when 'notify' then
      select * into claim from public.claims where id = (args->>'claimId')::uuid;
      if not found then return relief_private.failure(404, 'Claim not found.'); end if;
      perform relief_private.audit(null, worker_actor, 'notify', 'claim', claim.id::text, 'mock_sms_sent', null, 'mock-sms-v1', null,
        jsonb_build_object('status', claim.status, 'message', claim.citizen_reason_en));
      return jsonb_build_object('sent', true, 'status', claim.status);

    -- Finish a job: done / waiting (re-check soon, does not use an attempt) / failed with backoff / dead.
    when 'finish' then
      select * into job from public.jobs where id = (args->>'jobId')::uuid for update;
      if not found then return relief_private.failure(404, 'Job not found.'); end if;
      if coalesce((args->>'ok')::boolean, false) then
        update public.jobs set status = 'done', last_error = null, locked_at = null, updated_at = now() where id = job.id;
        perform relief_private.audit(null, worker_actor, 'job_done', 'job', job.id::text, 'done', null, 'job-queue-v1', null,
          jsonb_build_object('type', job.type, 'claim_id', job.claim_id, 'attempts', job.attempts));
        return jsonb_build_object('status', 'done');
      end if;
      if coalesce((args->>'waiting')::boolean, false) and job.created_at > now() - interval '30 minutes' then
        update public.jobs set status = 'queued', attempts = greatest(job.attempts - 1, 0), locked_at = null,
          run_after = now() + interval '10 seconds', updated_at = now() where id = job.id;
        return jsonb_build_object('status', 'queued', 'waiting', true);
      end if;
      if job.attempts < job.max_attempts then
        update public.jobs set status = 'queued', locked_at = null, last_error = left(coalesce(args->>'error', 'Unknown error'), 500),
          run_after = now() + make_interval(secs => 30 * power(2, job.attempts)::int), updated_at = now()
        where id = job.id;
        perform relief_private.audit(null, worker_actor, 'job_failed', 'job', job.id::text, 'retry_scheduled', null, 'job-queue-v1', null,
          jsonb_build_object('type', job.type, 'claim_id', job.claim_id, 'attempts', job.attempts, 'error', left(coalesce(args->>'error', ''), 200)));
        return jsonb_build_object('status', 'queued');
      end if;
      update public.jobs set status = 'dead', locked_at = null, last_error = left(coalesce(args->>'error', 'Unknown error'), 500), updated_at = now()
      where id = job.id;
      -- Never auto-approve: hand the claim to an officer, and stop documents showing as "processing".
      if job.claim_id is not null then
        update public.claim_documents set verified_status = 'unverified'
        where claim_id = job.claim_id and verified_status = 'processing';
        -- Low confidence so the case is flagged Urgent and sorts ahead of routine reviews.
        update public.claims set status = 'in_review', ai_route = 'human_review', handoff_notes = human_note, ai_confidence = 0.30,
          citizen_reason_en = 'An officer will check your documents.',
          citizen_reason_ur = 'ایک افسر آپ کے کاغذات کی جانچ کرے گا۔',
          updated_at = now()
        where id = job.claim_id and status in ('submitted', 'in_review', 'needs_proof') and assigned_officer_id is null;
      end if;
      perform relief_private.audit(null, worker_actor, 'job_dead', 'job', job.id::text, 'dead', null, 'job-queue-v1', null,
        jsonb_build_object('type', job.type, 'claim_id', job.claim_id, 'attempts', job.attempts, 'error', left(coalesce(args->>'error', ''), 200)));
      return jsonb_build_object('status', 'dead');

    when 'history' then
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', type, 'status', status, 'attempts', attempts,
        'max_attempts', max_attempts, 'last_error', last_error, 'created_at', created_at, 'updated_at', updated_at)
        order by created_at), '[]') into result
      from public.jobs where claim_id = (args->>'claimId')::uuid;
      return result;

    when 'stats' then
      select jsonb_build_object(
        'queued', count(*) filter (where status = 'queued'),
        'running', count(*) filter (where status = 'running'),
        'done', count(*) filter (where status = 'done'),
        'failed', count(*) filter (where status = 'failed'),
        'dead', count(*) filter (where status = 'dead')) into result
      from public.jobs;
      return result;

    else
      return relief_private.failure(400, 'Unknown job action.');
  end case;
end;
$$;

revoke all on function public.relief_jobs(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.relief_jobs(text, jsonb, text) to anon, authenticated;

-- Claims that already failed automatic checks before this rule: flag them too.
update public.claims set ai_confidence = 0.30
where ai_route = 'human_review' and handoff_notes = 'Automatic check failed — needs human review'
  and status = 'in_review' and coalesce(ai_confidence, 1) > 0.30;

-- Make the new function visible to the Supabase API immediately.
notify pgrst, 'reload schema';
