-- Supabase's safe-update guard requires an explicit predicate even on a singleton table.
do $$
declare
  funding text := pg_get_functiondef('relief_private.track_claim_funding()'::regprocedure);
  management text := pg_get_functiondef('relief_private.manage_scheme_budget(text,jsonb)'::regprocedure);
  payout text := 'set reserved_pkr = reserved_pkr - new.amount_pkr, paid_pkr = paid_pkr + new.amount_pkr;';
  release text := 'set reserved_pkr = reserved_pkr - old.amount_pkr;';
  edit text := 'update relief_private.scheme_budget set total_pkr = requested;';
begin
  if position(payout in funding) = 0 or position(release in funding) = 0 or position(edit in management) = 0 then
    raise exception 'Unexpected scheme budget function definition';
  end if;

  funding := replace(funding, payout, trim(trailing ';' from payout) || ' where singleton is true;');
  funding := replace(funding, release, trim(trailing ';' from release) || ' where singleton is true;');
  management := replace(management, edit, trim(trailing ';' from edit) || ' where singleton is true;');
  execute funding;
  execute management;
end;
$$;
