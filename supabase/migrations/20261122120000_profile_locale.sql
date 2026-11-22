-- Let a signed-in user save their app language (the voice dock pill) on their own profile.
-- Server-checked: the row is chosen by auth.uid(), never by a client-supplied id.
create or replace function public.relief_set_locale(p_locale text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('status', 401, 'error', 'Sign in to save your language.');
  end if;
  if p_locale not in ('en', 'ur') then
    return jsonb_build_object('status', 400, 'error', 'Unsupported language.');
  end if;
  update public.profiles set locale = p_locale where id = auth.uid();
  return jsonb_build_object('ok', true, 'locale', p_locale);
end;
$$;

revoke all on function public.relief_set_locale(text) from public, anon, authenticated;
grant execute on function public.relief_set_locale(text) to authenticated;

notify pgrst, 'reload schema';
