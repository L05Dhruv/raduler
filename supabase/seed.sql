-- Demo data for the prototype. Run this in the Supabase SQL editor after 0001_init.sql.
--
-- It seeds teams and a rolling eight weeks of open shifts. It deliberately does NOT
-- create users: accounts come from real magic-link signups, so profiles are minted by
-- the on_auth_user_created trigger with real auth.users rows behind them.
--
-- Bootstrap the first administrator by hand once you have signed in:
--   update public.profiles set role = 'admin' where email = 'you@yourpractice.com';

insert into public.teams (name, description) values
  ('Body Imaging',        'CT and MRI abdominal/pelvic coverage'),
  ('Neuro',               'Head CT, MRI brain and spine'),
  ('Breast Imaging',      'Mammography, ultrasound and biopsy sessions'),
  ('Emergency Radiology', 'Overnight and weekend acute coverage')
on conflict (name) do nothing;

-- Eight weeks of shifts starting from the most recent Monday, so the calendar always
-- has something to show whenever the demo is opened.
with base as (
  select date_trunc('week', now())::date as week_start
),
days as (
  select (select week_start from base) + d as day
  from generate_series(0, 55) as d
),
templates (title, location, modality, required_role, start_hour, duration_hours, rate_cents, team_name, weekday_only) as (
  values
    ('Day Read — Body',      'Main Campus, Reading Room 2', 'CT/MRI',        'radiologist'::public.user_role,  8, 8, 26000, 'Body Imaging',        true),
    ('Day Read — Neuro',     'Main Campus, Reading Room 4', 'MRI',           'radiologist'::public.user_role,  8, 8, 27500, 'Neuro',               true),
    ('Evening Read',         'Remote',                      'CT',            'radiologist'::public.user_role, 16, 8, 30000, 'Emergency Radiology', false),
    ('Overnight Call',       'Remote',                      'CT/XR',         'radiologist'::public.user_role,  0, 8, 36000, 'Emergency Radiology', false),
    ('Screening Clinic',     'Westside Clinic',             'Mammography',   'radiologist'::public.user_role,  9, 6, 28000, 'Breast Imaging',      true),
    ('CT Tech — Days',       'Main Campus, CT Suite',       'CT',            'tech'::public.user_role,         7, 10, 6500, 'Body Imaging',        true),
    ('MRI Tech — Days',      'Main Campus, MRI Suite',      'MRI',           'tech'::public.user_role,         7, 10, 6800, 'Neuro',               true),
    ('MRI Tech — Evenings',  'Main Campus, MRI Suite',      'MRI',           'tech'::public.user_role,        17, 8,  7400, 'Neuro',               false),
    ('Front Desk / Intake',  'Westside Clinic',             null,            'assistant'::public.user_role,    8, 8,  3200, 'Breast Imaging',      true)
)
insert into public.shifts (team_id, title, location, modality, starts_at, ends_at, required_role, hourly_rate_cents, status)
select
  t.id,
  tpl.title,
  tpl.location,
  tpl.modality,
  (d.day + make_interval(hours => tpl.start_hour))::timestamptz,
  (d.day + make_interval(hours => tpl.start_hour + tpl.duration_hours))::timestamptz,
  tpl.required_role,
  tpl.rate_cents,
  'open'
from days d
cross join templates tpl
left join public.teams t on t.name = tpl.team_name
where not (tpl.weekday_only and extract(isodow from d.day) > 5)
  -- Keep the seed sparse enough to read: skip a scattering of slots so the calendar
  -- looks like a real roster rather than a solid block.
  and (extract(doy from d.day)::int + length(tpl.title)) % 3 <> 0;
