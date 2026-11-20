create table public.todos (
  id bigint generated always as identity primary key,
  name text not null
);

alter table public.todos enable row level security;
revoke all on table public.todos from public, anon, authenticated;
grant select on table public.todos to anon, authenticated;

create policy "Demo todos are readable"
on public.todos
for select
to anon, authenticated
using (true);

insert into public.todos (name) values ('Supabase connection verified');
