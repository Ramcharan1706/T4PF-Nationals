-- Production integrity fixes for fields used by the API and atomic plan creation.
-- Safe to apply after migrations 001-007.
alter table public.children
  add column if not exists active boolean not null default true;

create index if not exists idx_children_org_active
  on public.children(organization_id, active);

create unique index if not exists users_email_lower_idx
  on public.users (lower(email));

create or replace function public.create_therapy_plan_transaction(p_plan jsonb, p_targets jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  target jsonb;
  resolved_ids uuid[];
begin
  update public.therapy_plans
  set active = false
  where child_id = (p_plan->>'child_id')::uuid and active = true;

  insert into public.therapy_plans(
    id, child_id, therapist_id, tier, cadence_per_week, review_date, cue,
    adaptive_recommended_tier, therapist_override_tier, active
  ) values (
    (p_plan->>'id')::uuid,
    (p_plan->>'child_id')::uuid,
    (p_plan->>'therapist_id')::uuid,
    (p_plan->>'tier')::public.practice_tier,
    (p_plan->>'cadence_per_week')::integer,
    (p_plan->>'review_date')::date,
    coalesce(p_plan->>'cue', ''),
    (p_plan->>'adaptive_recommended_tier')::public.practice_tier,
    case when nullif(p_plan->>'therapist_override_tier', '') is null then null else (p_plan->>'therapist_override_tier')::public.practice_tier end,
    true
  );

  for target in select * from jsonb_array_elements(p_targets)
  loop
    select coalesce(array_agg(w.id), '{}') into resolved_ids
    from public.words w
    where w.active
      and w.target_sound = target->>'target_sound'
      and w.word_position = target->>'position'
      and w.word = any (
        array(select jsonb_array_elements_text(target->'words'))
      );

    insert into public.therapy_plan_targets(therapy_plan_id, target_sound, position, word_ids)
    values (
      (p_plan->>'id')::uuid,
      target->>'target_sound',
      target->>'position',
      resolved_ids
    );
  end loop;
end;
$$;

revoke all on function public.create_therapy_plan_transaction(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_therapy_plan_transaction(jsonb, jsonb) to service_role;
