-- One simulated pool for the emergency relief scheme. Lock its single row for
-- reservations, disbursements, and budget edits so concurrent approvals cannot overspend.
create table relief_private.scheme_budget (
  singleton boolean primary key default true check (singleton),
  total_pkr bigint not null,
  reserved_pkr bigint not null default 0 check (reserved_pkr >= 0),
  paid_pkr bigint not null default 0 check (paid_pkr >= 0),
  check (total_pkr >= reserved_pkr + paid_pkr)
);

alter table public.claims add column funding_status text
  check (funding_status in ('awaiting_funds', 'reserved', 'paid'));

update public.claims
set funding_status = case when payment_status = 'paid' then 'paid' else 'reserved' end
where (status = 'approved' or payment_status = 'paid') and amount_pkr > 0;

insert into relief_private.scheme_budget (total_pkr, reserved_pkr, paid_pkr)
select greatest(1000000, reserved + paid), reserved, paid from (
  select coalesce(sum(amount_pkr) filter (where funding_status = 'reserved'), 0) as reserved,
         coalesce(sum(amount_pkr) filter (where funding_status = 'paid'), 0) as paid
  from public.claims
) as historical;

create function relief_private.track_claim_funding() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  previous text := old.funding_status;
  uid uuid := auth.uid();
begin
  if tg_op = 'DELETE' then
    if previous in ('reserved', 'paid') then
      raise sqlstate 'PT409' using message = 'A funded claim must retain its budget history.';
    end if;
    return old;
  end if;

  if previous in ('reserved', 'paid') and new.amount_pkr <> old.amount_pkr then
    raise sqlstate 'PT409' using message = 'The amount is fixed after funds are reserved.';
  end if;

  new.funding_status := null;
  if previous = 'paid' then
    if new.payment_status <> 'paid' then
      raise sqlstate 'PT409' using message = 'The budget already records this payment.';
    end if;
    new.funding_status := 'paid';
  elsif new.payment_status = 'paid' then
    if new.amount_pkr <= 0 or new.status not in ('approved', 'closed') then
      raise sqlstate 'PT409' using message = 'Payment requires an approved, positive payout amount.';
    end if;
    if previous = 'reserved' then
      update relief_private.scheme_budget
      set reserved_pkr = reserved_pkr - new.amount_pkr, paid_pkr = paid_pkr + new.amount_pkr;
    else
      update relief_private.scheme_budget set paid_pkr = paid_pkr + new.amount_pkr
      where total_pkr - reserved_pkr - paid_pkr >= new.amount_pkr;
      if not found then
        raise sqlstate 'PT409' using message = 'This claim is awaiting funds. Ask an administrator to add budget.';
      end if;
    end if;
    new.funding_status := 'paid';
  elsif new.status = 'approved' then
    if new.amount_pkr <= 0 then
      raise sqlstate 'PT409' using message = 'Approval requires a positive payout amount.';
    end if;
    if previous = 'reserved' then
      new.funding_status := 'reserved';
    else
      update relief_private.scheme_budget set reserved_pkr = reserved_pkr + new.amount_pkr
      where total_pkr - reserved_pkr - paid_pkr >= new.amount_pkr;
      if found then
        new.funding_status := 'reserved';
      elsif new.payment_status is distinct from old.payment_status then
        raise sqlstate 'PT409' using message = 'This claim is awaiting funds. Ask an administrator to add budget.';
      else
        new.funding_status := 'awaiting_funds';
      end if;
    end if;
  elsif previous = 'reserved' then
    update relief_private.scheme_budget set reserved_pkr = reserved_pkr - old.amount_pkr;
  end if;

  if uid is not null and previous is distinct from new.funding_status then
    perform relief_private.audit(uid, (select role from public.profiles where id = uid),
      'claim_funding_changed', 'claim', new.id::text, coalesce(new.funding_status, 'released'),
      new.rule_version_used, detail => jsonb_build_object('previous', previous, 'amount_pkr', new.amount_pkr));
  end if;
  return new;
end;
$$;

create trigger claim_budget_transition before update of status, payment_status, amount_pkr, funding_status or delete
on public.claims for each row execute function relief_private.track_claim_funding();

-- Fixture seeds may insert already approved or paid records. An AFTER trigger
-- counts only inserted rows, including when the seed is run again with ON CONFLICT.
create function relief_private.track_inserted_claim_funding() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' or new.payment_status = 'paid' then
    update public.claims set funding_status = null where id = new.id;
  end if;
  return new;
end;
$$;

create trigger claim_budget_seed after insert on public.claims
for each row execute function relief_private.track_inserted_claim_funding();

create function relief_private.manage_scheme_budget(action text, args jsonb) returns jsonb
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
  if actor.status is distinct from 'active' or actor.role <> 'admin' then
    perform relief_private.audit(uid, actor.role, 'access_denied', 'action', action, 'denied');
    return relief_private.failure(403, 'An active administrator is required.');
  end if;

  if action = 'set_scheme_budget' then
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
      return relief_private.failure(409, 'The budget changed. Refresh to review the current amounts.');
    end if;
    if requested < budget.reserved_pkr + budget.paid_pkr then
      return relief_private.failure(409, 'The total must cover funds already reserved or paid.');
    end if;

    update relief_private.scheme_budget set total_pkr = requested;
    remaining := requested - budget.reserved_pkr - budget.paid_pkr;
    -- Review Desk locks the claim first. Skip claims handled concurrently to
    -- avoid a deadlock. A later payment attempt still checks the same pool.
    for waiting in select id, amount_pkr from public.claims where funding_status = 'awaiting_funds'
        order by updated_at, id for update skip locked loop
      exit when waiting.amount_pkr > remaining;
      update public.claims set funding_status = 'reserved', updated_at = now() where id = waiting.id;
      remaining := remaining - waiting.amount_pkr;
      funded := funded + 1;
    end loop;
    perform relief_private.audit(uid, actor.role, 'scheme_budget_updated', 'scheme_budget', 'emergency-cash', 'updated',
      detail => jsonb_build_object('previous_total_pkr', budget.total_pkr, 'total_pkr', requested,
        'funded_claims', funded, 'reason', reason));
  end if;

  return (select jsonb_build_object(
    'total_pkr', total_pkr, 'reserved_pkr', reserved_pkr, 'paid_pkr', paid_pkr,
    'available_pkr', total_pkr - reserved_pkr - paid_pkr,
    'awaiting_claims', (select count(*) from public.claims where funding_status = 'awaiting_funds'),
    'funded_claims', funded
  ) from relief_private.scheme_budget);
end;
$$;

revoke all on relief_private.scheme_budget from public, anon, authenticated;
revoke all on function relief_private.track_claim_funding() from public, anon, authenticated;
revoke all on function relief_private.track_inserted_claim_funding() from public, anon, authenticated;
revoke all on function relief_private.manage_scheme_budget(text,jsonb) from public, anon, authenticated;

-- Retain the current server-proof check and all existing gateway operations.
do $$
declare
  definition text := pg_get_functiondef('public.relief_gateway(text,jsonb,text)'::regprocedure);
  anchor text := $anchor$  result := public.relief_action(action,args - 'image');$anchor$;
  addition text := $addition$  if action in ('scheme_budget', 'set_scheme_budget') then
    return relief_private.manage_scheme_budget(action, args);
  end if;
$addition$;
begin
  if position(anchor in definition) = 0 then raise exception 'Unexpected relief gateway definition'; end if;
  execute replace(definition, anchor, addition || anchor);
end;
$$;
