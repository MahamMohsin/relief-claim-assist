-- Complete, authoritative replacement for public.relief_action
-- Includes all original operations + profile, staff_queue, decide_staff, status guards.

CREATE OR REPLACE FUNCTION public.relief_action(
  action text,
  args   jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid                 uuid := auth.uid();
  profile             public.profiles%ROWTYPE;
  citizen             public.citizens%ROWTYPE;
  claim               public.claims%ROWTYPE;
  rule                public.eligibility_rules%ROWTYPE;
  person              uuid := nullif(args->>'citizenId', '')::uuid;
  requested_claim_id  uuid := nullif(args->>'claimId', '')::uuid;
  idem                uuid := nullif(args->>'key', '')::uuid;
  session_scope       uuid;
  cached              public.idempotency_keys%ROWTYPE;
  replay_request      jsonb;
  payment             public.mock_payments%ROWTYPE;
  payload             jsonb;
  result              jsonb;
  note                text;
  evidence            text;
  evidence_data       jsonb;
  score               numeric;
  eligible            boolean;
  next_state          text;
  ref                 text;
  decision            text;
  target_user         uuid;
  target_role         text;
  model               text;
BEGIN
  -- 1. Authentication check
  SELECT * INTO profile FROM public.profiles WHERE id = uid;
  IF profile.id IS NULL THEN
    RETURN relief_private.failure(401, 'Sign in with a valid account.');
  END IF;

  -- 2. Staff approval status gate
  IF profile.status = 'pending_approval' THEN
    RETURN relief_private.failure(403, 'Your account is pending administrator approval. Please wait for an administrator to verify your credentials.');
  END IF;

  IF profile.status IN ('rejected', 'suspended') THEN
    RETURN relief_private.failure(403, 'Your account has been deactivated or rejected.');
  END IF;

  -- 3. Fetch current active eligibility rule
  SELECT * INTO rule FROM public.eligibility_rules WHERE is_active;

  -- 4. Fast-path: profile query (critical for app loading)
  IF action = 'profile' THEN
    RETURN to_jsonb(profile) || jsonb_build_object(
      'citizen_id', (SELECT id FROM public.citizens WHERE owner_id = uid ORDER BY id LIMIT 1)
    );
  END IF;

  -- 5. Scope resolution & family consent checks for citizen-scoped operations
  IF action IN ('claims', 'draft', 'submit', 'evidence', 'correction', 'privacy', 'nadra') THEN
    IF person IS NULL AND profile.role = 'citizen' THEN
      SELECT id INTO person FROM public.citizens WHERE owner_id = uid ORDER BY id LIMIT 1;
    END IF;
    IF NOT relief_private.can_access(uid, profile.role, person) THEN
      PERFORM relief_private.audit(uid, profile.role, 'access_denied', 'citizen', person::text, 'denied', rule.version,
        detail => jsonb_build_object('action', action));
      RETURN relief_private.failure(403, 'This family has not granted you access.');
    END IF;
    SELECT * INTO citizen FROM public.citizens WHERE id = person;
  END IF;

  -- 6. Role permission checks
  IF (action IN ('families', 'switch_family') AND profile.role <> 'helper')
    OR (action = 'consent' AND profile.role <> 'citizen')
    OR (action IN ('queue', 'review', 'disburse') AND profile.role <> 'officer')
    OR (action IN ('rules', 'simulate', 'publish', 'staff_queue', 'decide_staff') AND profile.role <> 'admin')
    OR (action = 'audit' AND profile.role NOT IN ('admin', 'auditor'))
    OR (action IN ('check', 'report', 'raast') AND profile.role NOT IN ('citizen', 'helper', 'shopkeeper', 'officer')) THEN
    PERFORM relief_private.audit(uid, profile.role, 'access_denied', 'action', action, 'denied', rule.version);
    RETURN relief_private.failure(403, 'Your role does not have access to this operation.');
  END IF;

  -- 7. Idempotency management for mutating operations
  IF action IN ('draft', 'submit', 'evidence', 'report', 'consent', 'correction') THEN
    IF idem IS NULL THEN RETURN relief_private.failure(400, 'An idempotency key is required.'); END IF;
    IF action = 'consent' AND NOT relief_private.can_access(uid, profile.role, person) THEN
      PERFORM relief_private.audit(uid, profile.role, 'access_denied', 'consent', person::text, 'denied');
      RETURN relief_private.failure(403, 'Only the citizen can manage this consent.');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(uid::text || action || idem::text, 0));
    replay_request := args - 'analysis' - 'classification';
    SELECT * INTO cached FROM public.idempotency_keys WHERE user_id = uid AND endpoint = action AND key = idem;
    IF FOUND THEN
      IF cached.request_json <> replay_request THEN
        RETURN relief_private.failure(409, 'This retry key was already used for a different request.');
      END IF;
      RETURN cached.response_json;
    END IF;
  END IF;

  -- 8. Core Operations
  CASE action

    -- ========== ADMIN: staff verification ====================
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

    -- ========== Core Platform Actions ========================
    WHEN 'policy' THEN
      SELECT coalesce(jsonb_agg(s ORDER BY s.section_code), '[]') INTO result
      FROM public.policy_sections s WHERE s.policy_version = (SELECT policy_version FROM public.policy_sections
        WHERE effective_date <= current_date ORDER BY effective_date DESC, policy_version DESC LIMIT 1);

    WHEN 'policy_trace' THEN
      PERFORM relief_private.audit(uid, profile.role, 'policy_rag', 'policy', args->>'version', args->>'outcome', rule.version,
        detail => jsonb_build_object('citations', args->'citations'));
      result := jsonb_build_object('ok', true);

    WHEN 'scheme' THEN
      result := jsonb_build_object('name', rule.name, 'version', rule.version, 'config', rule.config_json);

    WHEN 'nadra' THEN
      result := to_jsonb(citizen) - 'owner_id';

    WHEN 'families' THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'full_name', c.full_name, 'village_area', c.village_area,
        'consent', coalesce(g.status, 'missing')) ORDER BY c.full_name), '[]') INTO result
      FROM public.citizens c LEFT JOIN public.consents g ON g.citizen_id = c.id AND g.grantee_user_id = uid AND g.scope = 'claim_access';

    WHEN 'switch_family' THEN
      SELECT * INTO citizen FROM public.citizens WHERE id = person;
      IF citizen.id IS NULL THEN RETURN relief_private.failure(404, 'Family not found.'); END IF;
      IF NOT EXISTS(SELECT 1 FROM public.consents WHERE citizen_id = person AND grantee_user_id = uid AND scope = 'claim_access' AND status = 'granted') THEN
        PERFORM relief_private.audit(uid, profile.role, 'access_denied', 'family', person::text, 'denied');
        RETURN relief_private.failure(403, 'Consent has not been granted for this family.');
      END IF;
      DELETE FROM public.claims WHERE citizen_id = person AND submitted_by = uid AND status = 'draft';
      DELETE FROM public.agent_sessions WHERE user_id = uid;
      PERFORM relief_private.audit(uid, profile.role, 'family_switch', 'family', person::text, 'switched');
      result := jsonb_build_object('ok', true, 'citizenId', person);

    WHEN 'privacy' THEN
      result := jsonb_build_object(
        'helpers', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'status', coalesce(g.status, 'missing'))
          ORDER BY p.full_name), '[]') FROM public.profiles p LEFT JOIN public.consents g ON g.grantee_user_id = p.id
          AND g.citizen_id = person AND g.scope = 'claim_access' WHERE p.role = 'helper'),
        'officers', (SELECT coalesce(jsonb_agg(DISTINCT p.full_name), '[]') FROM public.claims c
          JOIN public.profiles p ON p.id = c.assigned_officer_id WHERE c.citizen_id = person),
        'corrections', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'field_name', r.field_name,
          'proposed_value', r.proposed_value, 'status', r.status) ORDER BY r.created_at DESC), '[]') FROM public.data_correction_requests r WHERE r.citizen_id = person)
      );

    WHEN 'consent' THEN
      target_user := nullif(args->>'helperId', '')::uuid;
      IF target_user IS NULL THEN RETURN relief_private.failure(400, 'Specify a helper.'); END IF;
      INSERT INTO public.consents(citizen_id, grantee_user_id, status, granted_at, revoked_at)
      VALUES(person, target_user, args->>'consent',
        CASE WHEN args->>'consent' = 'granted' THEN now() END,
        CASE WHEN args->>'consent' = 'revoked' THEN now() END)
      ON CONFLICT (citizen_id, grantee_user_id, scope) DO UPDATE
        SET status = excluded.status,
            granted_at = coalesce(excluded.granted_at, public.consents.granted_at),
            revoked_at = coalesce(excluded.revoked_at, public.consents.revoked_at);
      PERFORM relief_private.audit(uid, profile.role, args->>'consent', 'consent', target_user::text, args->>'consent',
        detail => jsonb_build_object('citizen', person));
      result := jsonb_build_object('ok', true, 'status', args->>'consent');

    WHEN 'correction' THEN
      INSERT INTO public.data_correction_requests(citizen_id, requested_by, field_name, current_value, proposed_value)
      VALUES(person, uid, args->>'field', coalesce(to_jsonb(citizen)->>(args->>'field'), ''), args->>'value');
      PERFORM relief_private.audit(uid, profile.role, 'correction_request', 'citizen', person::text, 'queued',
        detail => jsonb_build_object('field', args->>'field', 'value', args->>'value'));
      result := jsonb_build_object('ok', true);

    WHEN 'claims' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object(
        'payment', (SELECT to_jsonb(m) FROM public.mock_payments m WHERE m.claim_id = c.id),
        'reports', (SELECT count(*) FROM public.scam_checks sc WHERE sc.claim_id = c.id),
        'documents', coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM public.claim_documents d WHERE d.claim_id = c.id), '[]'::jsonb)
      ) ORDER BY c.updated_at DESC), '[]') INTO result
      FROM public.claims c WHERE c.citizen_id = person;

    WHEN 'draft' THEN
      payload := args->'payload';
      IF requested_claim_id IS NOT NULL THEN
        SELECT * INTO claim FROM public.claims WHERE id = requested_claim_id AND citizen_id = person;
        IF claim.id IS NULL THEN RETURN relief_private.failure(404, 'Claim not found.'); END IF;
        IF claim.status <> 'draft' THEN RETURN relief_private.failure(409, 'Only draft claims can be updated.'); END IF;
        UPDATE public.claims SET payload_json = payload, updated_at = now() WHERE id = claim.id;
      ELSE
        INSERT INTO public.claims(citizen_id, submitted_by, status, payload_json, rule_version_used)
        VALUES(person, uid, 'draft', payload, rule.version) RETURNING * INTO claim;
      END IF;
      PERFORM relief_private.audit(uid, profile.role, 'draft_saved', 'claim', claim.id::text, 'draft', rule.version);
      result := to_jsonb(claim);

    WHEN 'submit' THEN
      payload := args->'payload';
      IF requested_claim_id IS NOT NULL THEN
        SELECT * INTO claim FROM public.claims WHERE id = requested_claim_id AND citizen_id = person;
        IF claim.id IS NULL THEN RETURN relief_private.failure(404, 'Claim not found.'); END IF;
      ELSE
        INSERT INTO public.claims(citizen_id, submitted_by, status, payload_json, rule_version_used)
        VALUES(person, uid, 'draft', payload, rule.version) RETURNING * INTO claim;
      END IF;
      eligible := relief_private.payload_eligible(payload, rule.config_json);
      score := coalesce(nullif(args->>'confidence', '')::numeric, 0.91);
      next_state := CASE
        WHEN NOT eligible THEN 'rejected'
        WHEN score < (rule.config_json->>'confidence_threshold')::numeric THEN 'in_review'
        ELSE 'submitted'
      END;
      note := CASE
        WHEN NOT eligible THEN 'Income or household size did not meet emergency cash assistance criteria.'
        WHEN next_state = 'in_review' THEN 'Flagged for officer verification due to low AI confidence threshold.'
        ELSE 'Pre-checks passed. Mock officer queue review pending.'
      END;
      UPDATE public.claims SET
        status = next_state,
        payload_json = payload,
        amount_pkr = CASE WHEN next_state = 'rejected' THEN 0 ELSE (rule.config_json->>'amount_pkr')::int END,
        rule_version_used = rule.version,
        ai_confidence = score,
        ai_route = next_state,
        citizen_reason_en = note,
        citizen_reason_ur = CASE WHEN NOT eligible THEN 'آمدنی یا گھر کے افراد کی تعداد مقررہ معیار کے مطابق نہیں ہے۔' ELSE 'درخواست جمع ہو گئی۔ افسر کی جانچ باقی ہے۔' END,
        updated_at = now()
      WHERE id = claim.id RETURNING * INTO claim;
      PERFORM relief_private.audit(uid, profile.role, 'submit_claim', 'claim', claim.id::text, next_state, rule.version, score => score,
        detail => jsonb_build_object('eligible', eligible, 'route', next_state));
      result := to_jsonb(claim);

    WHEN 'evidence' THEN
      SELECT * INTO claim FROM public.claims WHERE id = requested_claim_id AND citizen_id = person;
      IF claim.id IS NULL THEN RETURN relief_private.failure(404, 'Claim not found.'); END IF;
      evidence := args->>'docType';
      evidence_data := coalesce(args->'analysis', '{}'::jsonb);
      INSERT INTO public.claim_documents(claim_id, doc_type, file_url, ocr_json, blur_score, tamper_flag, tamper_reason, verified_status)
      VALUES(claim.id, evidence, args->>'fileUrl',
        coalesce(evidence_data->'ocr', '{}'::jsonb),
        nullif(evidence_data->>'blur_score', '')::numeric,
        coalesce((evidence_data->>'tamper_flag')::boolean, false),
        evidence_data->>'tamper_reason',
        CASE WHEN coalesce((evidence_data->>'tamper_flag')::boolean, false) THEN 'tampered'
             WHEN (evidence_data->>'blur_score')::numeric < 0.4 THEN 'unverified' ELSE 'verified' END);
      IF coalesce((evidence_data->>'tamper_flag')::boolean, false) THEN
        UPDATE public.claims SET status = 'needs_proof', updated_at = now(),
          citizen_reason_en = 'Attached document flagged for manual review: ' || coalesce(evidence_data->>'tamper_reason', 'suspected alteration.'),
          citizen_reason_ur = 'دستاویز میں ردوبدل کا شبہ ہے۔ اصل ثبوت درکار ہے۔'
        WHERE id = claim.id;
        PERFORM relief_private.audit(uid, profile.role, 'tamper_detected', 'claim_document', claim.id::text, 'flagged', rule.version,
          detail => evidence_data);
      END IF;
      result := jsonb_build_object('ok', true, 'docType', evidence, 'tamper', coalesce((evidence_data->>'tamper_flag')::boolean, false));

    WHEN 'queue' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object(
        'citizen_name', ct.full_name,
        'village_area', ct.village_area,
        'documents', coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM public.claim_documents d WHERE d.claim_id = c.id), '[]'::jsonb),
        'payment', (SELECT to_jsonb(m) FROM public.mock_payments m WHERE m.claim_id = c.id)
      ) ORDER BY CASE c.status WHEN 'needs_proof' THEN 1 WHEN 'in_review' THEN 2 WHEN 'submitted' THEN 3 ELSE 4 END,
        coalesce(c.ai_confidence, 0) ASC, c.updated_at ASC), '[]') INTO result
      FROM public.claims c
      JOIN public.citizens ct ON ct.id = c.citizen_id
      WHERE c.status IN ('submitted', 'needs_proof', 'in_review', 'approved');

    WHEN 'review' THEN
      SELECT * INTO claim FROM public.claims WHERE id = requested_claim_id;
      IF claim.id IS NULL THEN RETURN relief_private.failure(404, 'Claim not found.'); END IF;
      decision := args->>'decision';
      next_state := CASE decision
        WHEN 'approve' THEN 'approved'
        WHEN 'reject' THEN 'rejected'
        WHEN 'more_proof' THEN 'needs_proof'
        WHEN 'escalate' THEN 'in_review'
        WHEN 'close' THEN 'closed'
        WHEN 'assign' THEN claim.status
        ELSE NULL
      END;
      IF next_state IS NULL THEN RETURN relief_private.failure(400, 'Unknown review decision.'); END IF;
      UPDATE public.claims SET
        status = next_state,
        assigned_officer_id = uid,
        handoff_notes = args->>'reason',
        citizen_reason_en = args->>'reason',
        citizen_reason_ur = coalesce(args->>'reasonUr', args->>'reason'),
        amount_pkr = CASE WHEN next_state = 'approved' AND amount_pkr = 0 THEN (rule.config_json->>'amount_pkr')::int ELSE amount_pkr END,
        updated_at = now()
      WHERE id = claim.id RETURNING * INTO claim;
      PERFORM relief_private.audit(uid, profile.role, 'officer_decision', 'claim', claim.id::text, decision, rule.version,
        detail => jsonb_build_object('notes', args->>'reason'));
      result := to_jsonb(claim);

    WHEN 'disburse' THEN
      SELECT * INTO claim FROM public.claims WHERE id = requested_claim_id;
      IF claim.id IS NULL THEN RETURN relief_private.failure(404, 'Claim not found.'); END IF;
      IF claim.status <> 'approved' THEN RETURN relief_private.failure(409, 'Only approved claims can be disbursed.'); END IF;
      ref := 'RAAST-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 12));
      INSERT INTO public.mock_payments(claim_id, raast_ref, amount_pkr, status, disbursed_at)
      VALUES(claim.id, ref, claim.amount_pkr, 'paid', now())
      ON CONFLICT (claim_id) DO UPDATE SET status = 'paid', disbursed_at = now() RETURNING * INTO payment;
      UPDATE public.claims SET payment_status = 'paid', updated_at = now() WHERE id = claim.id;
      PERFORM relief_private.audit(uid, profile.role, 'disburse_payment', 'mock_payment', payment.id::text, 'paid', rule.version,
        detail => jsonb_build_object('raast_ref', ref, 'amount', claim.amount_pkr));
      result := to_jsonb(payment);

    WHEN 'check' THEN
      ref := upper(trim(coalesce(args->>'reference', '')));
      SELECT * INTO payment FROM public.mock_payments WHERE raast_ref = ref;
      score := coalesce(nullif(args->>'confidence', '')::numeric, 0.88);
      model := coalesce(args->>'model', 'mock-jev-v1');
      decision := CASE
        WHEN payment.id IS NOT NULL THEN 'legitimate'
        WHEN ref LIKE 'FAKE%' OR ref LIKE 'SCAM%' THEN 'scam'
        WHEN length(coalesce(args->>'message', '')) > 0 AND (args->>'message') ~* '(win|won|prize|lottery|urgent|transfer fee|pin code|otp)' THEN 'scam'
        ELSE 'unverified'
      END;
      INSERT INTO public.scam_checks(submitted_by, claim_id, message_text, jev_label, jev_confidence, jev_route, rail_match_status, created_at)
      VALUES(uid, payment.claim_id, coalesce(args->>'message', ref), decision, score,
        CASE WHEN decision = 'scam' THEN 'alert' WHEN decision = 'legitimate' THEN 'verified' ELSE 'officer_review' END,
        CASE WHEN payment.id IS NOT NULL THEN 'matched' ELSE 'not_found' END, now()) RETURNING * INTO cached;
      PERFORM relief_private.audit(uid, profile.role, 'scam_check', 'scam_check', cached.id::text, decision, rule.version,
        model => model, score => score, detail => jsonb_build_object('reference', ref, 'rail_status', cached.rail_match_status));
      result := jsonb_build_object(
        'id', cached.id, 'claim_id', payment.claim_id, 'jev_label', decision, 'jev_confidence', score,
        'jev_route', cached.jev_route, 'rail_match_status', cached.rail_match_status,
        'payment', CASE WHEN payment.id IS NOT NULL THEN to_jsonb(payment) ELSE NULL END, 'model', model
      );

    WHEN 'report' THEN
      ref := upper(trim(args->>'reference'));
      SELECT * INTO payment FROM public.mock_payments WHERE raast_ref = ref;
      IF payment.id IS NULL THEN RETURN relief_private.failure(404, 'Raast payment reference was not found in mock settlement ledger.'); END IF;
      INSERT INTO public.scam_checks(submitted_by, claim_id, message_text, jev_label, jev_confidence, jev_route, rail_match_status, missing_payment_reported, created_at)
      VALUES(uid, payment.claim_id, coalesce(args->>'message', 'Missing payment reported at shop'), 'shop_dispute', 0.99, 'officer_queue', 'matched', true, now())
      RETURNING * INTO cached;
      UPDATE public.claims SET status = 'in_review', updated_at = now(),
        handoff_notes = 'Shopkeeper dispute reported for reference ' || ref || '. Requires officer reconciliation.'
      WHERE id = payment.claim_id;
      PERFORM relief_private.audit(uid, profile.role, 'missing_payment_reported', 'scam_check', cached.id::text, 'reported', rule.version,
        detail => jsonb_build_object('raast_ref', ref, 'claim_id', payment.claim_id));
      result := jsonb_build_object('ok', true, 'reportId', cached.id, 'claim_id', payment.claim_id);

    WHEN 'rules' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.version DESC), '[]') INTO result
      FROM public.eligibility_rules r;

    WHEN 'publish' THEN
      payload := args->'config';
      SELECT coalesce(max(version), 0) + 1 INTO score FROM public.eligibility_rules;
      UPDATE public.eligibility_rules SET is_active = false WHERE is_active;
      INSERT INTO public.eligibility_rules(version, name, config_json, is_active, created_by)
      VALUES(score::int, args->>'name', payload, true, uid) RETURNING * INTO rule;
      PERFORM relief_private.audit(uid, profile.role, 'publish_rule', 'eligibility_rule', rule.id::text, 'published', rule.version,
        detail => rule.config_json);
      result := to_jsonb(rule);

    WHEN 'simulate' THEN
      payload := args->'config';
      SELECT jsonb_build_object(
        'total_tested', count(*),
        'would_approve', count(*) FILTER (WHERE relief_private.payload_eligible(c.payload_json, payload)),
        'would_reject', count(*) FILTER (WHERE NOT relief_private.payload_eligible(c.payload_json, payload)),
        'estimated_pkr', count(*) FILTER (WHERE relief_private.payload_eligible(c.payload_json, payload)) * (payload->>'amount_pkr')::int,
        'simulated_rule', payload
      ) INTO result FROM public.claims c WHERE c.payload_json <> '{}'::jsonb;
      PERFORM relief_private.audit(uid, profile.role, 'rule_simulation', 'eligibility_rule', NULL, 'simulated',
        detail => result);

    WHEN 'audit' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO result
      FROM (
        SELECT * FROM public.audit_logs
        ORDER BY created_at DESC
        LIMIT 200
      ) a;

    ELSE
      RETURN relief_private.failure(400, 'Unsupported relief operation: ' || coalesce(action, 'null'));
  END CASE;

  IF idem IS NOT NULL AND action IN ('draft', 'submit', 'evidence', 'report', 'consent', 'correction') THEN
    INSERT INTO public.idempotency_keys(user_id, endpoint, key, request_json, response_json)
    VALUES(uid, action, idem, replay_request, result);
  END IF;

  RETURN result;
END;
$$;
