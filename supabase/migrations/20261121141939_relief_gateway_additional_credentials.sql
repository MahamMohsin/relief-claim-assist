-- Allow each preview server to use its own scoped gateway credential.
do $$
declare
  definition text := pg_get_functiondef('public.relief_gateway(text,jsonb,text)'::regprocedure);
  current_check text := $predicate$where name='gateway' and secret_hash=$predicate$;
  multiple_check text := $predicate$where (name='gateway' or name like 'gateway:%') and secret_hash=$predicate$;
begin
  if position(current_check in definition) = 0 then
    raise exception 'Unexpected relief gateway authorization rule';
  end if;
  execute replace(definition, current_check, multiple_check);
end;
$$;
