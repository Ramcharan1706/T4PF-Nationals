create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('therapist','caregiver','child','admin');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.practice_tier as enum ('Isolation','Whole Word','Sentence');
exception when duplicate_object then null;
end $$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  role public.app_role not null,
  organization_id uuid not null references public.organizations(id),
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (organization_id, user_id)
);

create table if not exists public.children (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  age integer not null check (age between 1 and 18),
  organization_id uuid not null references public.organizations(id),
  therapist_id uuid not null references public.users(id),
  user_id uuid references public.users(id),
  mastery numeric(5,2) not null default 0 check (mastery between 0 and 100),
  adherence numeric(5,2) not null default 0 check (adherence between 0 and 100),
  last_practice timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.therapist_child (
  therapist_id uuid not null references public.users(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  primary key (therapist_id, child_id)
);

create table if not exists public.caregiver_child (
  caregiver_id uuid not null references public.users(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  primary key (caregiver_id, child_id)
);

create table if not exists public.sounds (
  id uuid primary key default gen_random_uuid(),
  symbol text unique not null,
  name text,
  created_at timestamptz not null default now()
);

create table if not exists public.words (
  id uuid primary key default gen_random_uuid(),
  word text not null,
  phonemes text[] not null default '{}',
  target_sound text not null,
  word_position text not null,
  syllable_count integer not null default 1,
  difficulty text not null default 'Everyday',
  age_band text not null default '5-9',
  tier public.practice_tier not null default 'Whole Word',
  child_friendly boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.word_targets (
  id uuid primary key default gen_random_uuid(),
  word_id uuid not null references public.words(id) on delete cascade,
  target_sound text not null,
  word_position text not null
);

create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  word_id uuid references public.words(id),
  title text not null,
  tier public.practice_tier not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.therapy_plans (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  therapist_id uuid not null references public.users(id),
  tier public.practice_tier not null,
  cadence_per_week integer not null check (cadence_per_week between 1 and 7),
  review_date date not null,
  cue text not null default '',
  adaptive_recommended_tier public.practice_tier not null,
  therapist_override_tier public.practice_tier,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.therapy_plan_targets (
  id uuid primary key default gen_random_uuid(),
  therapy_plan_id uuid not null references public.therapy_plans(id) on delete cascade,
  target_sound text not null,
  position text not null,
  word_ids uuid[] not null default '{}'
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  word text not null,
  target_sound text not null,
  score numeric(5,2) not null check (score between 0 and 100),
  transcription text,
  transcription_status text not null default 'pending',
  scoring_status text not null default 'pending',
  duration_ms integer,
  audio_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.progress_snapshots (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  mastery numeric(5,2) not null,
  average_score numeric(5,2) not null,
  recent_average numeric(5,2) not null,
  current_tier public.practice_tier not null,
  recommended_tier public.practice_tier not null,
  created_at timestamptz not null default now()
);

create table if not exists public.review_queue (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  priority text not null,
  reason text not null,
  status text not null default 'open',
  due_date date,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz
);

create table if not exists public.therapist_notes (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  therapist_id uuid not null references public.users(id),
  note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  sender_user_id uuid not null references public.users(id),
  recipient_user_id uuid not null references public.users(id),
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  actor_user_id uuid not null references public.users(id),
  action text not null,
  resource_type text not null,
  resource_id uuid,
  timestamp timestamptz not null default now(),
  metadata jsonb not null default '{}'
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  child_id uuid references public.children(id),
  event_type text not null,
  quantity numeric not null default 1,
  estimated_cost numeric(12,4) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.cost_rates (
  id uuid primary key default gen_random_uuid(),
  event_type text unique not null,
  unit_cost numeric(12,6) not null default 0
);

create index if not exists idx_children_org on public.children(organization_id);
create index if not exists idx_children_therapist on public.children(therapist_id);
create index if not exists idx_therapist_child_child on public.therapist_child(child_id);
create index if not exists idx_caregiver_child_child on public.caregiver_child(child_id);
create index if not exists idx_messages_child_created on public.messages(child_id, created_at desc);
create index if not exists idx_attempts_child_created on public.attempts(child_id, created_at desc);
create index if not exists idx_attempts_session on public.attempts(session_id);
create index if not exists idx_plans_child_active on public.therapy_plans(child_id, active);
create index if not exists idx_review_status on public.review_queue(status, due_date);
create index if not exists idx_audit_org_timestamp on public.audit_logs(organization_id, timestamp desc);

alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.children enable row level security;
alter table public.therapist_child enable row level security;
alter table public.caregiver_child enable row level security;
alter table public.therapy_plans enable row level security;
alter table public.sessions enable row level security;
alter table public.attempts enable row level security;
alter table public.progress_snapshots enable row level security;
alter table public.therapist_notes enable row level security;
alter table public.messages enable row level security;
alter table public.audit_logs enable row level security;
alter table public.review_queue enable row level security;

create or replace function public.current_user_role() returns public.app_role
language sql stable security definer set search_path = public
as $$ select role from public.users where id = auth.uid() $$;

create or replace function public.current_org_id() returns uuid
language sql stable security definer set search_path = public
as $$ select organization_id from public.users where id = auth.uid() $$;

-- A user can access a child only through an explicit care-circle relationship.
create or replace function public.can_access_child(p_child_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.children c
    where c.id = p_child_id
      and c.organization_id = public.current_org_id()
      and (
        c.therapist_id = auth.uid()
        or c.user_id = auth.uid()
        or exists (select 1 from public.caregiver_child cc where cc.child_id = c.id and cc.caregiver_id = auth.uid())
        or public.current_user_role() = 'admin'
      )
  )
$$;

drop policy if exists "organization members can view their organization" on public.organizations;
create policy "organization members can view their organization" on public.organizations
for select using (id = public.current_org_id());

drop policy if exists "users can view same organization" on public.users;
create policy "users can view same organization" on public.users
for select using (organization_id = public.current_org_id());

drop policy if exists "linked users can view children" on public.children;
create policy "linked users can view children" on public.children
for select using (public.can_access_child(id));

drop policy if exists "therapists can view assignments" on public.therapist_child;
create policy "therapists can view assignments" on public.therapist_child
for select using (therapist_id = auth.uid() or public.current_user_role() = 'admin');

drop policy if exists "caregivers can view assignments" on public.caregiver_child;
create policy "caregivers can view assignments" on public.caregiver_child
for select using (caregiver_id = auth.uid() or public.current_user_role() = 'admin');

drop policy if exists "therapists can manage assigned plans" on public.therapy_plans;
create policy "therapists can manage assigned plans" on public.therapy_plans
for all using (therapist_id = auth.uid() or public.current_user_role() = 'admin')
with check (therapist_id = auth.uid() or public.current_user_role() = 'admin');

drop policy if exists "linked users can view plans" on public.therapy_plans;
create policy "linked users can view plans" on public.therapy_plans
for select using (public.can_access_child(child_id));

drop policy if exists "linked users can access attempts" on public.attempts;
create policy "linked users can access attempts" on public.attempts
for select using (public.can_access_child(child_id));

drop policy if exists "linked practice users can create attempts" on public.attempts;
create policy "linked practice users can create attempts" on public.attempts
for insert with check (
  public.can_access_child(child_id)
  and (
    exists (select 1 from public.children c where c.id = child_id and c.user_id = auth.uid())
    or exists (select 1 from public.caregiver_child cc where cc.child_id = child_id and cc.caregiver_id = auth.uid())
  )
);

drop policy if exists "linked users can view sessions" on public.sessions;
create policy "linked users can view sessions" on public.sessions
for select using (public.can_access_child(child_id));
drop policy if exists "linked practice users can create sessions" on public.sessions;
create policy "linked practice users can create sessions" on public.sessions
for insert with check (
  public.can_access_child(child_id)
  and (
    exists (select 1 from public.children c where c.id = child_id and c.user_id = auth.uid())
    or exists (select 1 from public.caregiver_child cc where cc.child_id = child_id and cc.caregiver_id = auth.uid())
  )
);
drop policy if exists "linked practice users can complete sessions" on public.sessions;
create policy "linked practice users can complete sessions" on public.sessions
for update using (
  public.can_access_child(child_id)
  and (exists (select 1 from public.children c where c.id = child_id and c.user_id = auth.uid())
       or exists (select 1 from public.caregiver_child cc where cc.child_id = child_id and cc.caregiver_id = auth.uid()))
) with check (
  public.can_access_child(child_id)
  and (exists (select 1 from public.children c where c.id = child_id and c.user_id = auth.uid())
       or exists (select 1 from public.caregiver_child cc where cc.child_id = child_id and cc.caregiver_id = auth.uid()))
);

drop policy if exists "linked users can view progress" on public.progress_snapshots;
create policy "linked users can view progress" on public.progress_snapshots
for select using (public.can_access_child(child_id));
drop policy if exists "linked users can view notes" on public.therapist_notes;
create policy "linked users can view notes" on public.therapist_notes
for select using (therapist_id = auth.uid() or public.current_user_role() = 'admin');
drop policy if exists "therapists can manage notes" on public.therapist_notes;
create policy "therapists can manage notes" on public.therapist_notes
for all using (therapist_id = auth.uid() or public.current_user_role() = 'admin')
with check (therapist_id = auth.uid() or public.current_user_role() = 'admin');

drop policy if exists "participants can access messages" on public.messages;
create policy "participants can access messages" on public.messages
for select using (
  (sender_user_id = auth.uid() or recipient_user_id = auth.uid() or public.current_user_role() = 'admin')
  and public.can_access_child(child_id)
);
drop policy if exists "participants can send messages" on public.messages;
create policy "participants can send messages" on public.messages
for insert with check (
  sender_user_id = auth.uid()
  and public.can_access_child(child_id)
  and (recipient_user_id = (select therapist_id from public.children where id = child_id)
       or exists (select 1 from public.caregiver_child cc where cc.child_id = child_id and cc.caregiver_id = recipient_user_id))
);

drop policy if exists "admins can read audit" on public.audit_logs;
create policy "admins can read audit" on public.audit_logs
for select using (public.current_user_role() = 'admin' and organization_id = public.current_org_id());

drop policy if exists "therapists can view review queue" on public.review_queue;
create policy "therapists can view review queue" on public.review_queue
for select using (public.can_access_child(child_id) and public.current_user_role() in ('therapist','admin'));

insert into storage.buckets (id, name, public) values ('practice-audio', 'practice-audio', false) on conflict (id) do nothing;

-- Enable Supabase Realtime for live UI updates. The browser subscribes with the
-- authenticated user's JWT; RLS remains the authorization boundary.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'children') then
    alter publication supabase_realtime add table public.children;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'therapy_plans') then
    alter publication supabase_realtime add table public.therapy_plans;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attempts') then
    alter publication supabase_realtime add table public.attempts;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sessions') then
    alter publication supabase_realtime add table public.sessions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'progress_snapshots') then
    alter publication supabase_realtime add table public.progress_snapshots;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'therapist_notes') then
    alter publication supabase_realtime add table public.therapist_notes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'review_queue') then
    alter publication supabase_realtime add table public.review_queue;
  end if;
end $$;

-- Harden normalized plan-target access and include it in realtime. Plan targets
-- inherit authorization from their parent therapy plan/child relationship.
alter table public.therapy_plan_targets enable row level security;
alter table public.organization_members enable row level security;

drop policy if exists "linked users can view plan targets" on public.therapy_plan_targets;
create policy "linked users can view plan targets" on public.therapy_plan_targets
for select using (
  exists (
    select 1 from public.therapy_plans p
    where p.id = therapy_plan_id and public.can_access_child(p.child_id)
  )
);

drop policy if exists "therapists can manage plan targets" on public.therapy_plan_targets;
create policy "therapists can manage plan targets" on public.therapy_plan_targets
for all using (
  exists (
    select 1 from public.therapy_plans p
    where p.id = therapy_plan_id
      and (p.therapist_id = auth.uid() or public.current_user_role() = 'admin')
  )
) with check (
  exists (
    select 1 from public.therapy_plans p
    where p.id = therapy_plan_id
      and (p.therapist_id = auth.uid() or public.current_user_role() = 'admin')
  )
);

drop policy if exists "members can view organization memberships" on public.organization_members;
create policy "members can view organization memberships" on public.organization_members
for select using (organization_id = public.current_org_id() and (user_id = auth.uid() or public.current_user_role() = 'admin'));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'therapy_plan_targets') then
    alter publication supabase_realtime add table public.therapy_plan_targets;
  end if;
end $$;
