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
('sand', array['/s/'], '/s/', 'Initial', 1, 'Everyday', '5-7', 'Whole Word'),
('messy', array['/s/'], '/s/', 'Medial', 2, 'Everyday', '5-7', 'Whole Word'),
('pencil', array['/s/'], '/s/', 'Medial', 2, 'Everyday', '5-7', 'Whole Word'),
('bus', array['/s/'], '/s/', 'Final', 1, 'Everyday', '5-7', 'Whole Word'),
('house', array['/s/'], '/s/', 'Final', 1, 'Everyday', '5-7', 'Whole Word'),
('mouse', array['/s/'], '/s/', 'Final', 1, 'Everyday', '5-7', 'Whole Word'),
('red', array['/r/'], '/r/', 'Initial', 1, 'Everyday', '6-8', 'Whole Word'),
('rain', array['/r/'], '/r/', 'Initial', 1, 'Everyday', '6-8', 'Whole Word'),
('rocket', array['/r/'], '/r/', 'Initial', 2, 'Challenge', '6-8', 'Whole Word'),
('run', array['/r/'], '/r/', 'Initial', 1, 'Everyday', '5-7', 'Whole Word'),
('rabbit', array['/r/'], '/r/', 'Initial', 2, 'Challenge', '6-8', 'Whole Word'),
('carrot', array['/r/'], '/r/', 'Medial', 2, 'Everyday', '5-7', 'Whole Word'),
('cereal', array['/r/'], '/r/', 'Medial', 2, 'Everyday', '5-7', 'Whole Word'),
('car', array['/r/'], '/r/', 'Final', 1, 'Everyday', '5-7', 'Whole Word'),
('door', array['/r/'], '/r/', 'Final', 1, 'Everyday', '5-7', 'Whole Word'),
('floor', array['/r/'], '/r/', 'Final', 1, 'Everyday', '6-8', 'Whole Word'),
('leaf', array['/l/'], '/l/', 'Initial', 1, 'Everyday', '5-7', 'Whole Word'),
('lamp', array['/l/'], '/l/', 'Initial', 1, 'Everyday', '5-7', 'Whole Word'),
('lion', array['/l/'], '/l/', 'Initial', 2, 'Everyday', '5-7', 'Whole Word'),
('yellow', array['/l/'], '/l/', 'Medial', 2, 'Everyday', '5-7', 'Whole Word'),
('ball', array['/l/'], '/l/', 'Final', 1, 'Everyday', '5-7', 'Whole Word'),
('bell', array['/l/'], '/l/', 'Final', 1, 'Everyday', '5-7', 'Whole Word'),
('thumb', array['/th/'], '/th/', 'Initial', 1, 'Everyday', '6-8', 'Whole Word'),
('three', array['/th/'], '/th/', 'Initial', 1, 'Everyday', '6-8', 'Whole Word'),
('think', array['/th/'], '/th/', 'Initial', 1, 'Everyday', '6-8', 'Whole Word'),
('birthday', array['/th/'], '/th/', 'Medial', 2, 'Challenge', '6-8', 'Whole Word'),
('bath', array['/th/'], '/th/', 'Final', 1, 'Everyday', '6-8', 'Whole Word'),
('teeth', array['/th/'], '/th/', 'Final', 1, 'Everyday', '6-8', 'Whole Word'),
('earth', array['/th/'], '/th/', 'Final', 1, 'Challenge', '6-8', 'Whole Word')
on conflict (word, target_sound, word_position) do nothing;
