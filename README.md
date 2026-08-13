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
2. `supabase/migrations/0005_flexible_hours.sql` — per-day hours within a published shift
3. `supabase/seed.sql` — four teams and eight weeks of open shifts (optional)

(`0002`–`0004` fix privileges on projects created before those defects were found. `0001`
was corrected in place, so a fresh install skips them — see the header of each file.)

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
│  ├─ my-schedule/           claimed shifts, chosen hours and running hours
│  ├─ time-off/              request and withdraw blackout dates
│  └─ admin/                 shifts · time-off queue · teams · reports · invoices
├─ components/               AppShell and the auth guards
├─ contexts/AuthContext.tsx  session, profile, and the idle sign-out
├─ lib/
│  ├─ repositories/          the only modules that talk to Supabase
│  ├─ calendar.ts            month-grid maths
│  ├─ shiftPattern.ts        expands a recurring pattern into shifts
│  ├─ shiftHours.ts          resolves chosen hours inside a published shift
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

**Hours are the radiologist's to choose, within the published window.** A 12–7 posting
can be worked 1–5; `shift_assignments.actual_start / actual_end` hold the choice and
every hours and money expression reads `coalesce(actual, scheduled)`, so reports and
invoices follow automatically. The window is the boundary that matters: pay derives from
these columns, so an unbounded self-service edit would be a self-service pay rise.
`set_shift_hours()` enforces it, refuses any shift already carried onto an invoice, and
the admin roster counts shifts left partly unstaffed — narrowing your hours does not
reopen the remainder, and somebody has to notice the hole.

**Time zones.** Recurring shifts and chosen hours are both built from local wall-clock
times, so a pattern that crosses a daylight-saving boundary keeps its 08:00 start
instead of drifting, and an overnight shift's "02:00" resolves to the following day.
There are tests for both.

## Licence

Proprietary — all rights reserved. The repository is public only because GitHub Pages
requires it on the free plan; that visibility grants no right to use the code. Use
requires prior written authorization from [L05Dhruv](https://github.com/L05Dhruv). See
[LICENSE](./LICENSE).
