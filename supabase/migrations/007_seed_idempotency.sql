-- Prevent repeated seed execution from creating duplicate curriculum rows.
-- Remap references from legacy duplicates to the first row in each group.
with ranked_words as (
  select id,
         first_value(id) over (
           partition by word, target_sound, word_position
           order by created_at, id
         ) as canonical_id,
         row_number() over (
           partition by word, target_sound, word_position
           order by created_at, id
         ) as row_number
  from public.words
)
update public.exercises e
set word_id = ranked_words.canonical_id
from ranked_words
where e.word_id = ranked_words.id
  and ranked_words.row_number > 1;

with ranked_words as (
  select id,
         first_value(id) over (
           partition by word, target_sound, word_position
           order by created_at, id
         ) as canonical_id,
         row_number() over (
           partition by word, target_sound, word_position
           order by created_at, id
         ) as row_number
  from public.words
)
update public.word_targets wt
set word_id = ranked_words.canonical_id
from ranked_words
where wt.word_id = ranked_words.id
  and ranked_words.row_number > 1;

with ranked_words as (
  select id,
         row_number() over (
           partition by word, target_sound, word_position
           order by created_at, id
         ) as row_number
  from public.words
)
delete from public.words
where id in (select id from ranked_words where row_number > 1);

create unique index if not exists words_curriculum_natural_key_idx
  on public.words (word, target_sound, word_position);