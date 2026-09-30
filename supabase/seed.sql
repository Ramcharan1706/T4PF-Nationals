insert into public.organizations (id, name)
values ('11111111-1111-1111-1111-111111111111', 'Sound Buddy Demo Clinic')
on conflict (id) do nothing;

-- Supabase Auth users should be created through Supabase Auth.
-- After creation, insert matching public.users rows and organization membership.
-- The FastAPI demo mode supplies equivalent fictional seed users locally when Supabase is unavailable.

insert into public.sounds (symbol, name) values
('/s/', 'S'),('/r/', 'R'),('/l/', 'L'),('/th/', 'TH')
on conflict (symbol) do nothing;

insert into public.words (word, phonemes, target_sound, word_position, syllable_count, difficulty, age_band, tier)
values
('sun', array['/s/'], '/s/', 'Initial', 1, 'Everyday', '5-7', 'Whole Word'),
('sock', array['/s/'], '/s/', 'Initial', 1, 'Everyday', '5-7', 'Whole Word'),
('soap', array['/s/'], '/s/', 'Initial', 1, 'Everyday', '5-7', 'Whole Word'),
('snake', array['/s/'], '/s/', 'Initial', 1, 'Challenge', '6-8', 'Whole Word'),
('red', array['/r/'], '/r/', 'Initial', 1, 'Everyday', '6-8', 'Whole Word'),
('leaf', array['/l/'], '/l/', 'Initial', 1, 'Everyday', '5-7', 'Whole Word'),
('thumb', array['/th/'], '/th/', 'Initial', 1, 'Everyday', '6-8', 'Whole Word')
on conflict (word, target_sound, word_position) do nothing;
