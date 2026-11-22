-- Allow active review officers (and auditors) to read scheme_budget while keeping set_scheme_budget admin-only.

create or replace function relief_private.manage_scheme_budget(action text, args jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  uid uuid := auth.uid();
  actor public.profiles%rowtype;
  budget relief_private.scheme_budget%rowtype;
  requested bigint;
  expected bigint;
  reason text;
  remaining bigint;
  waiting record;
  funded integer := 0;
begin
  select * into actor from public.profiles where id = uid;
  if actor.id is null then return relief_private.failure(401, 'Sign in to view the scheme budget.'); end if;
  if actor.status is distinct from 'active' then
    perform relief_private.audit(uid, actor.role, 'access_denied', 'action', action, 'denied');
    return relief_private.failure(403, 'An active account is required.');
  end if;

  if action = 'set_scheme_budget' then
    if actor.role <> 'admin' then
      perform relief_private.audit(uid, actor.role, 'access_denied', 'action', action, 'denied');
      return relief_private.failure(403, 'An active administrator is required.');
    end if;
    reason := trim(coalesce(args->>'reason', ''));
    if coalesce(args->>'totalPkr', '') !~ '^[0-9]{1,12}$'
        or coalesce(args->>'expectedTotalPkr', '') !~ '^[0-9]{1,12}$'
        or length(reason) not between 5 and 300 then
      return relief_private.failure(400, 'Enter a whole PKR amount and a reason between 5 and 300 characters.');
    end if;
    requested := (args->>'totalPkr')::bigint;
    expected := (args->>'expectedTotalPkr')::bigint;
    select * into budget from relief_private.scheme_budget for update;
    if budget.total_pkr <> expected then
      return relief_private.failure(409, 'The budget changed before your update. Refresh and try again.');
    end if;
    if requested < budget.reserved_pkr + budget.paid_pkr then
      return relief_private.failure(409, 'Budget cannot be set below the PKR ' || (budget.reserved_pkr + budget.paid_pkr) || ' already reserved and paid.');
    end if;

    update relief_private.scheme_budget set total_pkr = requested where singleton is true;
    remaining := requested - budget.reserved_pkr - budget.paid_pkr;
    for waiting in
      select id, amount_pkr from public.claims
      where status = 'approved' and funding_status = 'awaiting_funds'
      order by updated_at asc, id asc
      for update
    loop
      exit when remaining < waiting.amount_pkr;
      update public.claims set funding_status = 'reserved' where id = waiting.id;
      remaining := remaining - waiting.amount_pkr;
      funded := funded + 1;
    end loop;

    perform relief_private.audit(uid, actor.role, 'scheme_budget_updated', 'scheme_budget', 'emergency-cash', 'updated',
      null, 'deterministic-v1', null,
      jsonb_build_object('previous_total_pkr', budget.total_pkr, 'total_pkr', requested, 'reason', reason, 'funded_claims', funded));
  else
    if actor.role not in ('admin', 'officer', 'auditor') then
      perform relief_private.audit(uid, actor.role, 'access_denied', 'action', action, 'denied');
      return relief_private.failure(403, 'Your role cannot view the scheme budget.');
    end if;
  end if;

  return (select jsonb_build_object(
    'total_pkr', total_pkr,
    'reserved_pkr', reserved_pkr,
    'paid_pkr', paid_pkr,
    'available_pkr', greatest(total_pkr - reserved_pkr - paid_pkr, 0),
    'awaiting_claims', (select count(*)::int from public.claims where status = 'approved' and funding_status = 'awaiting_funds'),
    'funded_claims', funded
  ) from relief_private.scheme_budget);
end;
$$;
