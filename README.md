# Sound Buddy — Supabase Production Build

Sound Buddy is a therapist-guided speech-practice application with persistent storage and real-time updates. Local development can use SQLite; production configuration must use Supabase/PostgreSQL.

## Architecture

- `frontend/` — React + TypeScript + Vite UI
- `backend/` — FastAPI API, business logic, Supabase Auth integration, PostgreSQL persistence and WebSocket realtime
- `backend/data/soundbuddy.db` — local SQLite database created on first run with the word library only
- `supabase/` — PostgreSQL schema, policies, and cloud deployment assets

## Run

### Backend

```bash
python -m pip install -r backend/requirements.txt
python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
```

Run the command from the repository root. If you first change into `backend`, omit `--app-dir backend` because `app` is then on Python's import path.

The backend creates/uses `backend/data/soundbuddy.db` automatically. The included database is already seeded.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Runtime data

Only the 30-word curriculum library is seeded. There are no runtime users,
children, plans, attempts, notes, messages, or progress records. Create accounts
through the application and create child accounts through therapist provisioning.

For an existing local database created by an earlier build, back it up first and
run the explicit cleanup utility from the repository root:

`python backend/scripts/clean_runtime_database.py backend/data/soundbuddy.db`

These are fictional development accounts included so the competition build works offline and without external identity configuration.

## Realtime

The browser connects to `ws://localhost:8000/ws` after login for local development.
Production writes go through the backend's Supabase repository and clients receive
authorized WebSocket events from the API, then re-read authoritative Supabase data.

## Data preserved from the previous build

The complete 30-word curriculum library is preserved. No word-library entries are
replaced with a smaller demo list.

## Speech provider

Configure a validated speech provider before enabling production practice scoring.
The provider boundary remains replaceable, and clinical progression must remain
server-authoritative.

## Production direction

Set `DATABASE_BACKEND=sqlite` for local development or
`DATABASE_BACKEND=supabase` for production. Production also requires an explicit
strong `JWT_SECRET`, Supabase credentials, and a production CORS origin.

Before deploying Render, run migrations `001_mvp_schema.sql` through
`008_production_integrity.sql` in Supabase SQL Editor, in order. Render does not execute
these migration files automatically.

Vercel must define `VITE_API_URL` as the deployed Render URL; otherwise browser
API requests will be sent to Vercel instead of the backend.

Practice audio is private: SQLite stores it below `data/audio`, while Supabase
uses the private `practice-audio` bucket and short-lived authorized signed URLs.
The `002_privacy_audio_transactions.sql` migration installs consent records and
the atomic attempt RPC; `003_storage_policies.sql` prevents public audio access.

Therapists can assign and remove caregivers through the relationship endpoints,
and authorized care-team users can record and retrieve child-data consent. The
browser uses the backend WebSocket at `wss://<render-service>/ws` for realtime
because the backend issues its own JWT. Never pass that custom JWT to Supabase
Realtime, and never expose `SUPABASE_SERVICE_ROLE_KEY` or `JWT_SECRET` to the browser.

## Production verification

After deployment, check `/api/health/live` and `/api/health/ready` on the Render URL. The
liveness check must not require the database; readiness must report
`"database": "supabase"` and `"demo_mode": false`. Then verify registration,
login, child creation, an attempt submission, and a care-team message. Public
registration creates caregiver and therapist accounts; child and admin accounts
must be provisioned through authorized workflows.
