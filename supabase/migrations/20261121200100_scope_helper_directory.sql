-- The shared-device directory may show labeled demo fixtures and explicitly granted families.
do $$
declare
  definition text := pg_get_functiondef('public.relief_action(text,jsonb)'::regprocedure);
  old_directory text := $anchor$from public.citizens c left join public.consents g on g.citizen_id=c.id and g.grantee_user_id=uid and g.scope='claim_access';$anchor$;
  scoped_directory text := $rule$from public.citizens c left join public.consents g
        on g.citizen_id=c.id and g.grantee_user_id=uid and g.scope='claim_access'
      where g.status='granted' or c.id between
        '10000000-0000-4000-a000-000000000001'::uuid and '10000000-0000-4000-a000-000000000040'::uuid;$rule$;
begin
  if position(old_directory in definition)=0 then raise exception 'Unexpected helper directory rule'; end if;
  execute replace(definition,old_directory,scoped_directory);
end;
$$;
