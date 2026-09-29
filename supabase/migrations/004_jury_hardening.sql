-- Jury/production hardening: preserve target position in attempts and make plan updates atomic.
alter table public.attempts add column if not exists word_position text not null default 'Initial';
create index if not exists idx_attempts_session_target on public.attempts(session_id, target_sound, word_position, word);

create or replace function public.update_therapy_plan_transaction(p_plan jsonb, p_targets jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.therapy_plans
  set tier=(p_plan->>'tier')::public.practice_tier,
      cadence_per_week=(p_plan->>'cadence_per_week')::integer,
      review_date=(p_plan->>'review_date')::date,
      cue=coalesce(p_plan->>'cue',''),
      adaptive_recommended_tier=(p_plan->>'adaptive_recommended_tier')::public.practice_tier,
      therapist_override_tier=case when nullif(p_plan->>'therapist_override_tier','') is null then null else (p_plan->>'therapist_override_tier')::public.practice_tier end,
      updated_at=(p_plan->>'updated_at')::timestamptz
  where id=(p_plan->>'id')::uuid;

  if not found then raise exception 'Therapy plan not found'; end if;

  delete from public.therapy_plan_targets where therapy_plan_id=(p_plan->>'id')::uuid;
  insert into public.therapy_plan_targets(therapy_plan_id, target_sound, position, word_ids)
  select (p_plan->>'id')::uuid, x.target_sound, x.position,
         coalesce((select array_agg(w.id) from public.words w where w.active and w.target_sound=x.target_sound and w.word_position=x.position and w.word = any(x.words)), '{}')
  from jsonb_to_recordset(p_targets) as x(target_sound text, position text, words text[]);
end;
$$;
revoke all on function public.update_therapy_plan_transaction(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.update_therapy_plan_transaction(jsonb,jsonb) to service_role;
