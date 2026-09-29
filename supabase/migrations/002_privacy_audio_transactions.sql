-- Production additions for private practice recordings, consent, retention,
-- and server-side atomic attempt updates.
alter table public.children add column if not exists active boolean not null default true;
alter table public.attempts add column if not exists audio_path text;

create table if not exists public.tongue_placements (
  id uuid primary key default gen_random_uuid(),
  target_sound text not null,
  title text not null,
  tongue_position text not null,
  mouth_position text not null default '',
  airflow text not null,
  voice text not null,
  cue text not null,
  caution text,
  language text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tongue_placements_sound_language on public.tongue_placements(target_sound, language);
alter table public.tongue_placements enable row level security;
drop policy if exists "authenticated users can view guidance" on public.tongue_placements;
create policy "authenticated users can view guidance" on public.tongue_placements for select to authenticated using (true);
drop policy if exists "therapists can manage guidance" on public.tongue_placements;
create policy "therapists can manage guidance" on public.tongue_placements for all to authenticated using (public.current_user_role() in ('therapist','admin')) with check (public.current_user_role() in ('therapist','admin'));

create table if not exists public.consents (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  granted_by uuid not null references public.users(id),
  consent_type text not null,
  granted boolean not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.data_retention_events (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action text not null check (action in ('scheduled','deleted','exported','deactivated')),
  actor_user_id uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

alter table public.consents enable row level security;
alter table public.data_retention_events enable row level security;

drop policy if exists "care circle can view consent" on public.consents;
create policy "care circle can view consent" on public.consents for select using (public.can_access_child(child_id));
drop policy if exists "care team can record consent" on public.consents;
create policy "care team can record consent" on public.consents for insert with check (public.can_access_child(child_id) and granted_by = auth.uid());
drop policy if exists "care circle can view retention events" on public.data_retention_events;
create policy "care circle can view retention events" on public.data_retention_events for select using (public.can_access_child(child_id));

create or replace function public.record_attempt_transaction(
  p_attempt jsonb, p_child jsonb, p_plan jsonb, p_snapshot jsonb, p_audit jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.attempts select * from jsonb_populate_record(null::public.attempts, p_attempt);
  update public.children set mastery=(p_child->>'mastery')::numeric, adherence=(p_child->>'adherence')::numeric, last_practice=(p_child->>'last_practice')::timestamptz where id=(p_child->>'id')::uuid;
  update public.therapy_plans set tier=(p_plan->>'tier')::public.practice_tier, adaptive_recommended_tier=(p_plan->>'adaptive_recommended_tier')::public.practice_tier, therapist_override_tier=(p_plan->>'therapist_override_tier')::public.practice_tier, updated_at=(p_plan->>'updated_at')::timestamptz where id=(p_plan->>'id')::uuid;
  insert into public.progress_snapshots select * from jsonb_populate_record(null::public.progress_snapshots, p_snapshot);
  insert into public.audit_logs select * from jsonb_populate_record(null::public.audit_logs, p_audit);
end;
$$;
revoke all on function public.record_attempt_transaction(jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_attempt_transaction(jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='consents') then
    alter publication supabase_realtime add table public.consents;
  end if;
end $$;
