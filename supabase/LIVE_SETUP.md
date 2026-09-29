# Sound Buddy — Live Supabase Setup

This build intentionally removes the in-browser demo role switch and uses real Supabase Auth + PostgreSQL + Realtime.

## 1. Create the Supabase project

Create a Supabase project and copy:

- Project URL
- anon/public key
- service-role key (backend only)

## 2. Run the database migrations

In the Supabase SQL Editor, copy and run these files in order:

1. `migrations/001_mvp_schema.sql`
2. `migrations/002_privacy_audio_transactions.sql`
3. `migrations/003_storage_policies.sql`
4. `migrations/004_jury_hardening.sql`
5. `migrations/005_usernames.sql`
6. `migrations/006_registration_hardening.sql`

These create the relational schema, username support, registration organization,
RLS policies, private `practice-audio` storage policies, transaction RPCs, and
realtime publication. The browser receives realtime events from the backend
WebSocket because the backend issues its own JWT.
Render does not run these files automatically.

## 3. Create real Auth users

In Supabase Dashboard → Authentication → Users, create your therapist/caregiver/child accounts.

The authenticated UUID must match the UUID used in `public.users.id`.

Example:

```sql
insert into public.users (id, name, email, role, organization_id)
values (
  '<AUTH_USER_UUID>',
  'Dr. Priya Patel',
  'priya@yourclinic.example',
  'therapist',
  (select id from public.organizations limit 1)
)
on conflict (id) do update set name = excluded.name, email = excluded.email, role = excluded.role;

insert into public.organization_members (organization_id, user_id)
select organization_id, id from public.users where id = '<AUTH_USER_UUID>'
on conflict do nothing;
```

For a caregiver, use `role = 'caregiver'` and add a `caregiver_child` relationship. For a child account, create a child row with `user_id = '<AUTH_USER_UUID>'` and `role = 'child'` in `public.users`.

## 4. Create relationships

Therapist → child:

```sql
insert into public.therapist_child (therapist_id, child_id)
values ('<THERAPIST_UUID>', '<CHILD_UUID>')
on conflict do nothing;
```

Caregiver → child:

```sql
insert into public.caregiver_child (caregiver_id, child_id)
values ('<CAREGIVER_UUID>', '<CHILD_UUID>')
on conflict do nothing;
```

Keep `children.therapist_id` aligned with the primary therapist used by your application.

## 5. Configure backend

Create `backend/.env`:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
GEMINI_API_KEY=YOUR_OPTIONAL_GEMINI_KEY
CORS_ORIGINS=http://localhost:5173
DATABASE_BACKEND=supabase
ENVIRONMENT=development
DEMO_MODE=false
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` to the frontend.

## 6. Configure frontend

Create `frontend/.env` for direct local development:

```env
VITE_API_URL=http://localhost:8000
```

The frontend talks to Supabase through the FastAPI backend. Never put the
service-role key, anon key, or JWT secret in Vercel or frontend source.

When opening the frontend through an ngrok URL, leave `VITE_API_URL` unset (or
remove the local value before rebuilding). The frontend then uses the current
origin and the Vite proxy, so API and WebSocket requests also travel through
ngrok instead of trying to reach `localhost` on the visitor's computer.

## 7. Start

Backend:

```bash
python -m pip install -r backend/requirements.txt
uvicorn app.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
```

Frontend:

```bash
npm install --prefix frontend
npm run dev --prefix frontend
```

## 8. Verify the live loop

1. Sign in as therapist.
2. Confirm the real child appears in the caseload.
3. Create/update a therapy plan.
4. Sign in as caregiver/child in another browser session.
5. Start practice and submit a recording.
6. Watch the therapist/caregiver workspace update without a page refresh.
7. Send a care-team message and verify it appears in the other session in real time.

## 9. Render and Vercel deployment

Render uses `render.yaml`. Add these values in the Render service environment:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `CORS_ORIGINS` set to the Vercel production URL

In Vercel, add:

- `VITE_API_URL` set to the Render service URL

Redeploy both services after changing environment variables.

## Important

The current pronunciation provider is still explicitly a development/mock scorer. The live database/auth/realtime infrastructure is real, but the speech-assessment model is not yet a clinically validated pronunciation assessment system.
