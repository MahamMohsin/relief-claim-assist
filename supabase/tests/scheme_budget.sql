begin;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-a000-000000000005';
  officer_id constant uuid := '00000000-0000-4000-a000-000000000004';
  shopkeeper_id constant uuid := '00000000-0000-4000-a000-000000000003';
  applicant_id constant uuid := '00000000-0000-4000-a000-000000000001';
  citizen_id constant uuid := '10000000-0000-4000-a000-000000000001';
  first_claim uuid;
  second_claim uuid;
  closed_claim uuid;
  budget relief_private.scheme_budget%rowtype;
  total bigint;
  response jsonb;
  receipt_reference text;
begin
  select * into budget from relief_private.scheme_budget for update;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  response := relief_private.manage_scheme_budget('set_scheme_budget', jsonb_build_object(
    'totalPkr', budget.reserved_pkr + budget.paid_pkr, 'expectedTotalPkr', budget.total_pkr,
    'reason', 'Verify the minimum allowed budget'));
  if response->>'available_pkr' is distinct from '0' then
    raise exception 'Admin could not save a total equal to committed funds: %', response;
  end if;
  total := budget.reserved_pkr + budget.paid_pkr + 25000;
  update relief_private.scheme_budget set total_pkr = total where singleton is true;

  insert into public.claims (citizen_id, submitted_by, status, amount_pkr)
  values (citizen_id, applicant_id, 'submitted', 25000)
  returning id into first_claim;
  insert into public.claims (citizen_id, submitted_by, status, amount_pkr)
  values (citizen_id, applicant_id, 'submitted', 25000)
  returning id into second_claim;

  perform set_config('request.jwt.claim.sub', officer_id::text, true);
  response := relief_private.manage_scheme_budget('scheme_budget', '{}');
  if response->>'status' is distinct from '403' then raise exception 'Non-admin saw budget'; end if;

  response := public.relief_action('review', jsonb_build_object('claimId', first_claim, 'decision', 'approve', 'reason', 'Verified test evidence'));
  if response->>'funding_status' is distinct from 'reserved' then raise exception 'Approval did not reserve funds: %', response; end if;
  response := public.relief_action('review', jsonb_build_object('claimId', second_claim, 'decision', 'approve', 'reason', 'Verified test evidence'));
  if response->>'funding_status' is distinct from 'awaiting_funds' then raise exception 'An approval overcommitted the budget: %', response; end if;

  begin
    perform public.relief_action('disburse', jsonb_build_object('claimId', second_claim));
    raise exception 'Unfunded disbursement succeeded';
  exception when sqlstate 'PT409' then null;
  end;
  if (select status from public.mock_payments where claim_id = second_claim) is distinct from 'pending' then
    raise exception 'Blocked disbursement changed the payment rail';
  end if;

  perform set_config('request.jwt.claim.sub', applicant_id::text, true);
  select item into response from jsonb_array_elements(public.relief_action('claims', '{}')) item
  where item->>'id' = second_claim::text;
  if response->>'funding_status' is distinct from 'awaiting_funds' then
    raise exception 'Applicant could not see Awaiting funds: %', response;
  end if;

  perform set_config('request.jwt.claim.sub', officer_id::text, true);
  response := public.relief_action('disburse', jsonb_build_object('claimId', first_claim, 'outcome', 'failed'));
  if response->>'funding_status' is distinct from 'reserved' or response->>'payment_status' is distinct from 'failed' then
    raise exception 'Failed disbursement lost its reservation: %', response;
  end if;
  response := public.relief_action('disburse', jsonb_build_object('claimId', first_claim));
  if response->>'funding_status' is distinct from 'paid' then raise exception 'Retry did not record payment: %', response; end if;
  response := public.relief_action('disburse', jsonb_build_object('claimId', first_claim));
  if response->>'status' is distinct from '409' then raise exception 'Repeat disbursement was not blocked'; end if;

  if (select reserved_pkr from relief_private.scheme_budget) <> budget.reserved_pkr
    or (select paid_pkr from relief_private.scheme_budget) <> budget.paid_pkr + 25000 then
    raise exception 'Paid and reserved balances double counted the claim';
  end if;

  insert into public.claims (id, citizen_id, submitted_by, status, payment_status, amount_pkr)
  values (first_claim, citizen_id, applicant_id, 'approved', 'paid', 25000)
  on conflict (id) do nothing;

  -- Make this synthetic case first regardless of any waiting claims in the test database.
  update public.claims set updated_at = '-infinity' where id = second_claim;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  response := relief_private.manage_scheme_budget('set_scheme_budget', jsonb_build_object('totalPkr', total, 'expectedTotalPkr', total + 1, 'reason', 'Stale admin edit'));
  if response->>'status' is distinct from '409' then raise exception 'Stale admin edit was accepted'; end if;
  response := relief_private.manage_scheme_budget('set_scheme_budget', jsonb_build_object('totalPkr', total - 1, 'expectedTotalPkr', total, 'reason', 'Insufficient budget limit'));
  if response->>'status' is distinct from '409' then raise exception 'Budget dropped below commitments'; end if;
  response := relief_private.manage_scheme_budget('set_scheme_budget', jsonb_build_object('totalPkr', total + 25000, 'expectedTotalPkr', total, 'reason', 'Add funding for waiting claims'));
  if response->>'funded_claims' is distinct from '1' or response->>'available_pkr' is distinct from '0'
    or (select funding_status from public.claims where id = second_claim) is distinct from 'reserved' then
    raise exception 'Top-up did not reserve funds for the waiting claim: %', response;
  end if;
  if not exists (select 1 from public.audit_logs where actor_id = admin_id and event_type = 'scheme_budget_updated'
      and metadata_json->>'reason' = 'Add funding for waiting claims') then
    raise exception 'Administrator budget change missing from audit';
  end if;

  perform set_config('request.jwt.claim.sub', officer_id::text, true);
  response := public.relief_action('disburse', jsonb_build_object('claimId', second_claim));
  if response->>'funding_status' is distinct from 'paid' or response->>'payment_status' is distinct from 'paid' then
    raise exception 'Waiting claim could not be paid after funding: %', response;
  end if;
  if (select reserved_pkr from relief_private.scheme_budget) <> budget.reserved_pkr
    or (select paid_pkr from relief_private.scheme_budget) <> budget.paid_pkr + 50000 then
    raise exception 'Final payout did not move its reservation to Paid';
  end if;

  perform set_config('request.jwt.claim.sub', applicant_id::text, true);
  select item into response from jsonb_array_elements(public.relief_action('claims', '{}')) item
  where item->>'id' = second_claim::text;
  receipt_reference := response->'payment'->>'raast_ref';
  if receipt_reference is null or response->'payment'->>'status' is distinct from 'paid' then
    raise exception 'Applicant did not receive the paid receipt: %', response;
  end if;

  perform set_config('request.jwt.claim.sub', shopkeeper_id::text, true);
  response := public.relief_action('raast', jsonb_build_object('reference', receipt_reference));
  if response->>'status' is distinct from 'paid' or response->>'amount_pkr' is distinct from '25000' then
    raise exception 'Shopkeeper could not verify the paid receipt: %', response;
  end if;

  update relief_private.scheme_budget set total_pkr = reserved_pkr + paid_pkr + 25000 where singleton is true;
  insert into public.claims (citizen_id, submitted_by, status, amount_pkr)
  values (citizen_id, applicant_id, 'submitted', 25000) returning id into closed_claim;
  perform set_config('request.jwt.claim.sub', officer_id::text, true);
  perform public.relief_action('review', jsonb_build_object('claimId', closed_claim, 'decision', 'approve', 'reason', 'Verify reservation release'));
  perform public.relief_action('disburse', jsonb_build_object('claimId', closed_claim, 'outcome', 'failed'));
  response := public.relief_action('review', jsonb_build_object('claimId', closed_claim, 'decision', 'close', 'reason', 'Close the failed test payment'));
  if response->>'status' is distinct from 'closed' or response->>'funding_status' is not null
    or (select reserved_pkr from relief_private.scheme_budget) <> budget.reserved_pkr then
    raise exception 'Closing an unpaid claim did not release its reservation: %', response;
  end if;
end;
$$;

rollback;
select 'scheme_budget_verified_rolled_back' as result;
