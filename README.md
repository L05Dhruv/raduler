# Raduler

Shift scheduling for a radiology group. Radiologists, techs and assistants browse a
calendar of open shifts, claim the ones they want, and block off dates for vacation.
Administrators publish shifts, manage teams, review hours worked and issue invoices.

**Prototype.** It holds staff scheduling data only — no patient information. See
[SECURITY.md](./SECURITY.md) for what that means and what would have to change first.

Live: <https://l05dhruv.github.io/raduler/>

## How it fits together

```
Browser (static bundle on GitHub Pages)
  └─ supabase-js ──HTTPS──▶ Supabase (Postgres + Auth + Row-Level Security)
```

GitHub Pages serves static files and nothing else — there is no server, no API route,
no middleware, no session cookie. That shapes the whole design:

- **Postgres RLS is the security boundary.** The route guards in
  `src/components/auth/` only tidy up navigation; anyone can load the JavaScript. What
  stops them seeing another person's pay rate is a policy in the database.
- **Privileged writes go through SECURITY DEFINER functions**, not table writes.
  Claiming a shift calls `claim_shift()`, which takes a row lock and checks the rules
  before it inserts anything.
- **The anon key is published on purpose.** It is a *publishable* key that authorises
  nothing by itself. The `service_role` key bypasses RLS and appears nowhere in this
  repository.

## Stack

Next.js 16 (App Router, static export) · React 19 · TypeScript · Tailwind 4 + daisyUI 5
· SWR · react-hook-form + zod · date-fns · Recharts · jsPDF · Vitest · Supabase.

Derived from [praram](https://github.com/L05Dhruv/praram), with the server-dependent
parts replaced: its `/api/auth/*` routes and `middleware.ts` cannot run on a static
host, so authentication moved into the browser and authorisation moved into Postgres.

## Setup

### 1. Supabase

Create a project at [supabase.com](https://supabase.com) (free tier is enough), then in
the SQL editor run, in order:

1. `supabase/migrations/0001_init.sql` — tables, grants, RLS policies, RPCs, audit log
2. `supabase/seed.sql` — four teams and eight weeks of open shifts (optional)

Then under **Authentication → URL Configuration**, add both redirect URLs:

```
http://localhost:3000/**
https://l05dhruv.github.io/raduler/**
```

Restrict who may sign up (recommended before showing this to anyone):

```sql
alter database postgres set app.allowed_email_domains = 'yourpractice.com';
```

### 2. Local development

```bash
cp .env.local.example .env.local   # fill in the project URL and anon key
pnpm install
pnpm dev
```

Sign in with a magic link, then promote yourself to administrator — the first admin has
to be made by hand, since nobody can grant themselves the role:

```sql
update public.profiles set role = 'admin' where email = 'you@yourpractice.com';
```

### 3. Deploy

In the repository settings:

- **Settings → Pages → Source:** GitHub Actions
- **Settings → Secrets and variables → Actions → Variables**, add
  `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Variables, not secrets: both values ship inside the JS bundle regardless, and marking
them secret would only mask them in build logs while implying a protection that is not
there.

Pushing to `main` builds and deploys. `.github/workflows/deploy.yml` pins every action
to a commit SHA.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server on :3000 |
| `pnpm build` | Static export to `out/` |
| `pnpm test` | Vitest in watch mode |
| `pnpm test:run` | Vitest once (what CI runs) |
| `pnpm lint` | ESLint, including the React Compiler rules |

## Layout

```
src/
├─ app/                      routes; every data-touching page is a client component
│  ├─ calendar/              month grid, claim and release
│  ├─ my-schedule/           claimed shifts and running hours
│  ├─ time-off/              request and withdraw blackout dates
│  └─ admin/                 shifts · time-off queue · teams · reports · invoices
├─ components/               AppShell and the auth guards
├─ contexts/AuthContext.tsx  session, profile, and the idle sign-out
├─ lib/
│  ├─ repositories/          the only modules that talk to Supabase
│  ├─ calendar.ts            month-grid maths
│  ├─ shiftPattern.ts        expands a recurring pattern into shifts
│  └─ pdf/invoice.ts         browser-side invoice rendering
└─ types/db.ts               mirrors the migration
supabase/                    migration and seed
tests/                       unit tests for the date, pattern and CSV logic
```

## Notes on the design

**Money is computed in SQL.** `hours_summary()` and `create_invoice()` derive hours and
amounts from the same expression, so a report and an invoice for the same period cannot
disagree, and no total is ever supplied by the client. `src/lib/format.ts` only renders
numbers the database has already decided on.

**One person per shift is a database constraint**, not a check in the UI: a partial
unique index on confirmed assignments. Two people clicking "claim" in the same
millisecond cannot both win.

**Time zones.** Recurring shifts are built from local wall-clock times, so a pattern
that crosses a daylight-saving boundary keeps its 08:00 start instead of drifting; there
is a test for it.
