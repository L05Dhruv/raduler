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
3. `supabase/migrations/0006_timezones.sql` — time zones, and the reporting-period anchor
4. `supabase/migrations/0007_person_rates.sql` — one rate per person; drops the shift rate
5. `supabase/migrations/0008_practice_settings.sql` — practice configuration, in a table
6. `supabase/seed.sql` — four teams and eight weeks of open shifts (optional)

(`0002`–`0004` fix privileges on projects created before those defects were found. `0001`
was corrected in place, so a fresh install skips them — see the header of each file.)

**Re-seeding an existing project?** Run `supabase/reset_seed.sql` first. `seed.sql` adds rows
rather than replacing them, so running it twice leaves the old roster beside the new one —
including a stale `Breast Imaging` team and its shifts. The reset is scoped to the titles the
seed publishes, so anything an administrator created is left alone, but it does destroy
claims against demo shifts. Read its header before running it.

Then under **Authentication → URL Configuration**, add both redirect URLs:

```
http://localhost:3000/**
https://l05dhruv.github.io/raduler/**
```

**Configure the practice.** Both of these are unset after a fresh install, and the first
one matters immediately: until the zone is set, every reporting period runs on UTC days
rather than the practice's.

```sql
update private.practice_settings
set timezone = 'America/New_York', allowed_email_domains = 'yourpractice.com'
where id;
```

The zone is what shifts are published in and what a month boundary falls on. It is read by
`hours_summary()` and `create_invoice()`, and served to the browser through
`practice_timezone()`, so there is one source for it rather than two that can drift. The
allowlist is what stops anyone registering; left null, signup is open.

These used to be `alter database postgres set app.…` parameters, and that **cannot work on
Supabase**. `postgres` owns the database but is not a superuser, and from PostgreSQL 15 a
custom parameter at database level needs superuser — the SQL editor fails with `42501:
permission denied to set parameter` just as the CLI does. `0008` moved them into
`private.practice_settings`, one row, invisible to PostgREST. The old parameters are still
read as a fallback, so a self-hosted project with a real superuser keeps working.

An administrator signed into the app changes them through `set_practice_settings()`, which
checks the caller and writes an audit row. From the SQL editor use the `update` above — a
direct connection has no `auth.uid()`, so the RPC's admin check would refuse it.

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
| `pnpm test:sql` | Just the migration tests — runs the schema on real Postgres |
| `pnpm lint` | ESLint, including the React Compiler rules |

## Layout

```
src/
├─ app/                      routes; every data-touching page is a client component
│  ├─ calendar/              month grid, claim and release
│  ├─ my-schedule/           claimed shifts, chosen hours and running hours
│  ├─ profile/               own details, time zone, and the rate assigned to you
│  ├─ time-off/              request and withdraw blackout dates
│  └─ admin/                 shifts · time-off queue · teams · reports · invoices
├─ components/               AppShell, auth guards, travel banner, zone picker
├─ contexts/
│  ├─ AuthContext.tsx        session, profile, and the idle sign-out
│  └─ TimeZoneContext.tsx    resolves which zone times are rendered in
├─ lib/
│  ├─ repositories/          the only modules that talk to Supabase
│  ├─ timezone.ts            zone maths: day keys, wall clock ↔ instant, DST
│  ├─ calendar.ts            month-grid maths
│  ├─ shiftPattern.ts        expands a recurring pattern into shifts
│  ├─ shiftHours.ts          resolves chosen hours inside a published shift
│  └─ pdf/invoice.ts         browser-side invoice rendering
└─ types/db.ts               mirrors the migration
supabase/                    migrations, seed, reset and privilege diagnostics
tests/
├─ migrations.test.ts        applies the schema to real Postgres and probes the rules
└─ *.test.ts                 unit tests for the date, pattern and CSV logic
```

**The migration tests are the important ones.** Authorisation lives in Postgres, so the
checks that matter cannot be written in TypeScript: which column a user holds `UPDATE`
on, whether an RPC refuses the wrong caller, whether one radiologist can read another's
invoice. `tests/migrations.test.ts` runs `0001`, `0005` and `0006` against PostgreSQL compiled to
WebAssembly ([PGlite](https://pglite.dev)) — the real engine, not a mock — with
Supabase's `auth` schema stubbed, then asserts each rule.

Crucially it does not stay a superuser. `SET ROLE authenticated` drops the session to a
real grantee, so row-level security applies exactly as it does for a signed-in user, and
the policies are tested rather than bypassed. That makes the manual console checklist in
[SECURITY.md](./SECURITY.md) automatic. Two seconds, and part of `pnpm test:run`.

It cannot reach PostgREST, JWT issuance or Supabase's own `auth` implementation. Green
means the SQL is right, not that the round trip is.

## Notes on the design

**Money is computed in SQL.** `hours_summary()` and `create_invoice()` derive hours and
amounts from the same expression, so a report and an invoice for the same period cannot
disagree, and no total is ever supplied by the client. `src/lib/format.ts` only renders
numbers the database has already decided on.

**One rate per person, not per shift.** Pay comes from `profiles.hourly_rate_cents` and
nowhere else. An administrator sets it under Teams; the person sees it, read-only, on their
own profile page, which is honest rather than decorative — they hold `UPDATE` on
`full_name`, `modality` and `timezone` and on nothing else, so there is no hidden path to
editing it. Shifts carried their own rate until `0007` dropped the column, and the
consequence is worth knowing: there is no longer any way to pay more for overnight call
than for a day read. A differential now belongs on the person or the role, not the posting.
Invoices already issued are unaffected — `invoice_lines.rate_cents` is a snapshot taken
when the invoice was raised, which is why it is stored rather than recomputed.

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

**Three time zones, kept apart.** Conflating them is how scheduling software gets this
wrong, so each has one job:

- **The practice zone** — where the work happens, held as a database setting. A shift
  published as 08:00 is 08:00 here whoever reads it, and a reporting period runs midnight
  to midnight here. `expandPattern()` builds against it, so an administrator publishing
  next month's roster from a conference elsewhere produces the same roster.
- **A person's home zone** — `profiles.timezone`, which they set themselves. Presentation
  only; nothing in the money path reads it.
- **The zone someone is reading in right now.** Session-scoped, browser-only, and never
  sent to the database — a total that moved because its reader boarded a plane would be
  indefensible.

Travelling is offered rather than applied. If the device's clock differs from the one in
use, a banner asks; accepting sets a session override that expires with the tab, because a
persisted "I am in Vancouver" is a setting people forget to change back, and a stale one is
worse than none.

**The reporting boundary was wrong, and 0006 fixes it.** `timestamptz::date` resolves in
the session's zone, and a PostgREST connection runs in UTC — so a shift worked 20:00–23:00
on 31 August in Toronto was counted in September, by the report, the invoice and the
approved-leave check alike. Expect figures near a month boundary to differ from ones issued
before that migration ran. There is a test that demonstrates the defect by removing the
anchor.

**Daylight saving is handled where it happens.** `wallClockToInstant()` resolves each day
independently rather than stepping in 24-hour increments, so a run across a transition
keeps its 08:00 start; a time that does not exist (02:30 on a spring-forward morning) moves
forward past the gap, and one that happens twice resolves to its first occurrence. An
eight-hour shift spanning a transition stays eight elapsed hours, because that is what was
worked and what gets paid.

## Licence

Proprietary — all rights reserved. The repository is public only because GitHub Pages
requires it on the free plan; that visibility grants no right to use the code. Use
requires prior written authorization from [L05Dhruv](https://github.com/L05Dhruv). See
[LICENSE](./LICENSE).
