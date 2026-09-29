-- Registration prerequisites. This is safe to run after 001-005 and is
-- intentionally idempotent so it can repair a project where seed.sql was not
-- executed without creating duplicate organizations.
alter table public.users add column if not exists username text;
create unique index if not exists users_username_lower_idx
  on public.users (lower(username)) where username is not null;

insert into public.organizations (id, name)
values ('11111111-1111-1111-1111-111111111111', 'Sound Buddy Demo Clinic')
on conflict (id) do nothing;