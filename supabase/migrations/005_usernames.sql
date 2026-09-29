-- Keep the application username in the Supabase profile table.
alter table public.users add column if not exists username text;
create unique index if not exists users_username_lower_idx
  on public.users (lower(username)) where username is not null;