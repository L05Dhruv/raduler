-- Clears the demo roster so seed.sql can be re-run cleanly.
--
-- Why this is needed: seed.sql is `on conflict (name) do nothing` for teams and a plain
-- insert for shifts, so running it twice leaves the old rows in place beside the new ones.
-- After the Breast Imaging → Paediatrics change that means a stale team and a set of
-- Screening Clinic shifts sitting alongside the Peds Clinic ones.
--
-- WHAT THIS DESTROYS
-- -----------------
-- Every shift whose title matches one the seed has ever published, and — through
-- `on delete cascade` — every assignment against them. If anyone has claimed a demo shift,
-- that claim goes with it. Shift IDs are regenerated on re-seed, so nothing can be
-- reconnected afterwards.
--
-- WHAT SURVIVES
-- -------------
--   * **Anything an administrator published under a different title.** The scope is the
--     title list below, not "all shifts", precisely so a real roster entry cannot be caught
--     by a demo cleanup.
--   * **Profiles, roles and rates.** Untouched.
--   * **Time off.** Not seeded, so not seeded data.
--   * **Invoices.** `invoice_lines.shift_id` is `on delete set null`, so lines keep their
--     description, minutes, rate and amount. An invoice cannot silently change value here.
--   * **The audit log.** Append-only, and the delete trigger records every removal.
--
-- ONE CONSEQUENCE WORTH EXPECTING
-- -------------------------------
-- If you have issued an invoice covering demo shifts, the invoice keeps its figures but the
-- assignments behind them are gone, so `hours_summary()` for that period will now report
-- less than the invoice says. That is the one case where this leaves a report and an invoice
-- disagreeing, and re-seeding does not repair it — the new shifts are different rows.
-- Void such invoices first if the numbers matter.
--
-- HOW TO RUN
-- ----------
--   1. This file, in the Supabase SQL editor. Each statement reports what it changed.
--   2. Then `supabase/seed.sql`.
--
-- Safe to run twice; the second time removes nothing.

-- ---------------------------------------------------------------------------
-- 1. Remove the seeded shifts.
--
-- Titles cover every version of the seed: `Mammo Clinic` became `Screening Clinic` and then
-- `Peds Clinic`, and a project seeded before either rename still holds the older rows.
--
-- Written as one statement rather than a delete followed by a count, so the report is of
-- what actually went rather than of what was there a moment earlier.
-- ---------------------------------------------------------------------------

with removed as (
  delete from public.shifts
  where title in (
    'Day Read — Body',
    'Day Read — Neuro',
    'Evening Read',
    'Overnight Call',
    'Peds Clinic',
    'Screening Clinic',
    'Mammo Clinic',
    'CT Tech — Days',
    'MRI Tech — Days',
    'MRI Tech — Evenings',
    'Front Desk / Intake'
  )
  returning title
)
select title, count(*) as shifts_removed
from removed
group by title
order by title;

-- ---------------------------------------------------------------------------
-- 2. Retire Breast Imaging, if nothing is left in it.
--
-- It owned the mammography sessions and the Westside front desk. Both are now Paediatrics,
-- so the team has no work in it — but the guards matter: if anyone was added to it by hand,
-- or an administrator pointed a real shift at it, it stays and this reports nothing.
-- ---------------------------------------------------------------------------

with retired as (
  delete from public.teams t
  where t.name = 'Breast Imaging'
    and not exists (select 1 from public.shifts s where s.team_id = t.id)
    and not exists (select 1 from public.team_members m where m.team_id = t.id)
  returning t.name
)
select name as team_retired from retired;

-- ---------------------------------------------------------------------------
-- 3. Confirm the state before re-seeding.
--
-- Expect zero seeded shifts. `other_shifts` is whatever an administrator published, which
-- should be exactly what it was before this ran.
-- ---------------------------------------------------------------------------

select
  count(*) filter (
    where title in (
      'Day Read — Body', 'Day Read — Neuro', 'Evening Read', 'Overnight Call',
      'Peds Clinic', 'Screening Clinic', 'Mammo Clinic', 'CT Tech — Days',
      'MRI Tech — Days', 'MRI Tech — Evenings', 'Front Desk / Intake'
    )
  ) as seeded_shifts_remaining,
  count(*) filter (
    where title not in (
      'Day Read — Body', 'Day Read — Neuro', 'Evening Read', 'Overnight Call',
      'Peds Clinic', 'Screening Clinic', 'Mammo Clinic', 'CT Tech — Days',
      'MRI Tech — Days', 'MRI Tech — Evenings', 'Front Desk / Intake'
    )
  ) as other_shifts
from public.shifts;
