-- Add ai_summary column to claims and support persisting it on review and via claim_save_summary

ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS ai_summary TEXT;

create or replace function relief_private.claim_ai_context(args jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cid uuid := (args->>'claimId')::uuid;
  c public.claims%rowtype;
  cit public.citizens%rowtype;
  claim_docs jsonb;
  cit_docs jsonb;
  rule_cfg jsonb;
  rule_ver int;
  reports_cnt int;
begin
  select * into c from public.claims where id = cid;
  if not found then return relief_private.failure(404, 'Claim not found.'); end if;

  select * into cit from public.citizens where id = c.citizen_id;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at), '[]'::jsonb) into claim_docs
  from public.claim_documents d where d.claim_id = cid;

  select coalesce(jsonb_agg(to_jsonb(cd) order by cd.created_at desc), '[]'::jsonb) into cit_docs
  from public.citizen_documents cd where cd.citizen_id = c.citizen_id;

  rule_ver := coalesce(c.rule_version_used, (select version from public.eligibility_rules where is_active limit 1));
  select config_json into rule_cfg from public.eligibility_rules where version = rule_ver;

  select count(*) into reports_cnt from public.scam_checks where claim_id = cid and missing_payment_reported;

  return jsonb_build_object(
    'claim', to_jsonb(c),
    'citizen', to_jsonb(cit) - 'owner_id',
    'claim_documents', claim_docs,
    'citizen_documents', cit_docs,
    'rule_version', rule_ver,
    'rule_config', rule_cfg,
    'reports', reports_cnt
  );
end;
$$;

DO $$
DECLARE
  def text := pg_get_functiondef('public.relief_gateway(text,jsonb,text)'::regprocedure);
BEGIN
  IF def NOT LIKE '%claim_ai_context%' THEN
    def := replace(
      def,
      'if action=''citizen_doc_file'' then return relief_private.citizen_doc_file(args); end if;',
      'if action=''citizen_doc_file'' then return relief_private.citizen_doc_file(args); end if;' || E'\n  if action=''claim_ai_context'' then return relief_private.claim_ai_context(args); end if;'
    );
    EXECUTE def;
  END IF;
END $$;

DO $$
DECLARE
  def text := pg_get_functiondef('public.relief_action(text,jsonb)'::regprocedure);
BEGIN
  IF def NOT LIKE '%ai_summary%' THEN
    def := replace(
      def,
      'citizen_reason_en=args->>''reason'',citizen_reason_ur=nullif(args->>''reasonUr'',''''),updated_at=now()',
      'citizen_reason_en=args->>''reason'',citizen_reason_ur=nullif(args->>''reasonUr'',''''),ai_summary=coalesce(args->>''aiSummary'',args->>''ai_summary'',ai_summary),updated_at=now()'
    );
    EXECUTE def;
  END IF;
END $$;

DO $$
DECLARE
  def text := pg_get_functiondef('public.relief_action(text,jsonb)'::regprocedure);
BEGIN
  IF def NOT LIKE '%claim_save_summary%' THEN
    def := replace(
      def,
      'when ''rules'' then',
      'when ''claim_save_summary'' then' || E'\n      update public.claims set ai_summary=args->>''aiSummary'', updated_at=now() where id=requested_claim_id returning * into claim;' || E'\n      result := to_jsonb(claim);' || E'\n    when ''rules'' then'
    );
    EXECUTE def;
  END IF;
END $$;
