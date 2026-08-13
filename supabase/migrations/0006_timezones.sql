-- Time zones.
--
-- Three of them, kept deliberately distinct, because conflating them is how scheduling
-- software gets this wrong:
--
--   * **The practice zone.** Where the work physically happens. A Main Campus shift is
--     an 08:00 shift whoever is looking at it, and a reporting period runs midnight to
--     midnight here. Authoritative, and the only one this file cares about.
--   * **A person's home zone.** `profiles.timezone`, added below. It decides what they
--     see and nothing else.
--   * **The zone someone is reading in right now**, which may be neither of the above.
--     That lives in the browser for the length of a session and the database never
--     hears about it — a total that moved because its reader boarded a plane would be
--     indefensible, so the reporting boundary cannot be a client input.
--
-- The defect this fixes
-- ---------------------
-- `timestamptz::date` resolves in the *session* time zone, and a PostgREST connection
-- runs in UTC. So a shift worked 20:00-23:00 on 31 August in Toronto was cast to
-- 1 September and counted in the wrong month — by `hours_summary()`, by
-- `create_invoice()`, and by the approved-leave check inside `claim_shift()`. Three
-- hours of work billed to the wrong period, with nothing in the UI to suggest it.
--
-- Every one of those casts is now anchored to the practice zone. Note what this means
-- for existing data: reports and invoices covering a shift near a month boundary will
-- not match figures issued before this ran. That is the bug being fixed, not a new one,
-- but it is visible and worth expecting.
--
-- Run after 0005. Safe to re-run.

-- ---------------------------------------------------------------------------
-- The practice zone
-- ---------------------------------------------------------------------------

-- A database setting, like app.allowed_email_domains, so it changes without a deploy:
--   alter database postgres set app.practice_timezone = 'America/Toronto';
--
-- Left unset every function below behaves exactly as it did before — UTC — so applying
-- this migration on its own changes no number until the setting is made.
--
-- The browser reads this through the same function rather than carrying its own copy.
-- Two sources for one fact drift, and the direction of the drift here would be silent
-- and financial.
create or replace function public.practice_timezone()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('app.practice_timezone', true), ''), 'UTC');
$$;

revoke execute on function public.practice_timezone() from public, anon;
grant execute on function public.practice_timezone() to authenticated;

-- ---------------------------------------------------------------------------
-- A person's home zone
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists timezone text;

-- Joins full_name and modality as a field a user may set on themselves. It governs
-- presentation only: nothing in the money path reads it, by design.
grant update (timezone) on public.profiles to authenticated;

-- pg_timezone_names is a view, so this cannot be a CHECK constraint — those must be
-- immutable. A trigger is the only server-side guard available, and it has to exist:
-- users hold a direct column grant here, so without it a typo is the only thing between
-- someone and a profile that renders every time in their week incorrectly.
create or replace function private.validate_profile_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.timezone is not null
     and not exists (
       select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone
     )
  then
    raise exception 'Unknown time zone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

grant execute on function private.validate_profile_timezone() to authenticated;

drop trigger if exists profiles_validate_timezone on public.profiles;
create trigger profiles_validate_timezone
  before insert or update of timezone on public.profiles
  for each row execute function private.validate_profile_timezone();

-- ---------------------------------------------------------------------------
-- Anchor every date boundary to the practice zone
--
-- Replaced in full rather than patched, since a function body cannot be edited in
-- place. The only change in each is `x::date` becoming
-- `(x at time zone public.practice_timezone())::date`.
-- ---------------------------------------------------------------------------

create or replace function public.claim_shift(p_shift_id uuid)
returns public.shift_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_profile    public.profiles;
  v_shift      public.shifts;
  v_assignment public.shift_assignments;
  v_zone       text := public.practice_timezone();
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found or not v_profile.active then
    raise exception 'No active profile for this account.' using errcode = '42501';
  end if;

  -- Row lock: two simultaneous claims serialise here instead of racing.
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'Shift not found.' using errcode = 'P0002';
  end if;

  if v_shift.status <> 'open' then
    raise exception 'That shift is no longer open.' using errcode = 'P0001';
  end if;

  if v_shift.required_role <> v_profile.role then
    raise exception 'This shift requires the % role.', v_shift.required_role
      using errcode = '42501';
  end if;

  -- Time off is stored as zone-less calendar dates, so the shift has to be reduced to
  -- calendar dates in the practice zone to be comparable. In UTC an evening shift
  -- landed on the following day and could be claimed straight through the last day of
  -- someone's approved leave.
  if exists (
    select 1 from public.time_off t
    where t.profile_id = v_uid
      and t.status = 'approved'
      and daterange(t.starts_on, t.ends_on, '[]')
          && daterange(
               (v_shift.starts_at at time zone v_zone)::date,
               (v_shift.ends_at at time zone v_zone)::date,
               '[]'
             )
  ) then
    raise exception 'That shift falls inside your approved time off.' using errcode = 'P0001';
  end if;

  -- Overlap is compared on absolute instants, which need no zone at all.
  if exists (
    select 1
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
    where a.profile_id = v_uid
      and a.status = 'confirmed'
      and tstzrange(s.starts_at, s.ends_at, '[)')
          && tstzrange(v_shift.starts_at, v_shift.ends_at, '[)')
  ) then
    raise exception 'You already have a shift that overlaps this one.' using errcode = 'P0001';
  end if;

  insert into public.shift_assignments (shift_id, profile_id)
  values (p_shift_id, v_uid)
  returning * into v_assignment;

  update public.shifts set status = 'filled' where id = p_shift_id;

  perform private.write_audit('shift.claim', 'shifts', p_shift_id::text,
    jsonb_build_object('assignment_id', v_assignment.id));

  return v_assignment;
end;
$$;

create or replace function public.hours_summary(p_start date, p_end date)
returns table (
  profile_id     uuid,
  full_name      text,
  role           public.user_role,
  shifts_count   bigint,
  total_minutes  bigint,
  total_cents    bigint
)
language sql
stable
set search_path = ''
as $$
  select
    p.id,
    p.full_name,
    p.role,
    count(*) as shifts_count,
    sum(
      (extract(epoch from (coalesce(a.actual_end, s.ends_at) - coalesce(a.actual_start, s.starts_at))) / 60)::bigint
    ) as total_minutes,
    sum(
      round(
        (extract(epoch from (coalesce(a.actual_end, s.ends_at) - coalesce(a.actual_start, s.starts_at))) / 3600)
        * coalesce(s.hourly_rate_cents, p.hourly_rate_cents)
      )::bigint
    ) as total_cents
  from public.shift_assignments a
  join public.shifts s on s.id = a.shift_id
  join public.profiles p on p.id = a.profile_id
  where a.status = 'confirmed'
    and (s.starts_at at time zone public.practice_timezone())::date
        between p_start and p_end
  group by p.id, p.full_name, p.role
  order by p.full_name;
$$;

create or replace function public.create_invoice(
  p_profile_id uuid,
  p_start date,
  p_end date
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_number  text;
  v_zone    text := public.practice_timezone();
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if p_end < p_start then
    raise exception 'Period end precedes period start.' using errcode = '22023';
  end if;

  v_number := 'INV-' || to_char(p_start, 'YYYYMM') || '-' || upper(substr(replace(p_profile_id::text, '-', ''), 1, 6));

  insert into public.invoices (number, profile_id, period_start, period_end, issued_by)
  values (v_number, p_profile_id, p_start, p_end, (select auth.uid()))
  returning * into v_invoice;

  -- `worked_on` is the calendar day the practice worked, not the UTC day it happened to
  -- fall on, so an evening shift appears on the invoice under its own date.
  insert into public.invoice_lines (invoice_id, shift_id, description, worked_on, minutes, rate_cents, amount_cents)
  select
    v_invoice.id,
    s.id,
    s.title || case when s.location <> '' then ' — ' || s.location else '' end,
    (s.starts_at at time zone v_zone)::date,
    (extract(epoch from (coalesce(a.actual_end, s.ends_at) - coalesce(a.actual_start, s.starts_at))) / 60)::integer,
    coalesce(s.hourly_rate_cents, p.hourly_rate_cents),
    round(
      (extract(epoch from (coalesce(a.actual_end, s.ends_at) - coalesce(a.actual_start, s.starts_at))) / 3600)
      * coalesce(s.hourly_rate_cents, p.hourly_rate_cents)
    )::bigint
  from public.shift_assignments a
  join public.shifts s on s.id = a.shift_id
  join public.profiles p on p.id = a.profile_id
  where a.profile_id = p_profile_id
    and a.status = 'confirmed'
    and (s.starts_at at time zone v_zone)::date between p_start and p_end
  order by s.starts_at;

  update public.invoices i
  set total_minutes = coalesce(t.minutes, 0),
      total_cents   = coalesce(t.cents, 0)
  from (
    select sum(minutes)::integer as minutes, sum(amount_cents)::bigint as cents
    from public.invoice_lines where invoice_id = v_invoice.id
  ) t
  where i.id = v_invoice.id
  returning i.* into v_invoice;

  perform private.write_audit('invoice.create', 'invoices', v_invoice.id::text,
    jsonb_build_object('profile_id', p_profile_id, 'total_cents', v_invoice.total_cents,
                       'practice_timezone', v_zone));

  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- Re-assert privileges.
--
-- `create or replace` keeps an existing function's ACL, so strictly these are already
-- correct. Stated anyway: the cost of being wrong about that is an RPC silently open to
-- PUBLIC, which is the defect 0002 exists to record.
-- ---------------------------------------------------------------------------

revoke execute on function public.claim_shift(uuid) from public, anon;
revoke execute on function public.hours_summary(date, date) from public, anon;
revoke execute on function public.create_invoice(uuid, date, date) from public, anon;

grant execute on function public.claim_shift(uuid) to authenticated;
grant execute on function public.hours_summary(date, date) to authenticated;
grant execute on function public.create_invoice(uuid, date, date) to authenticated;

-- Verify: expect the configured zone (or UTC if unset), and false for anon.
select public.practice_timezone() as practice_zone,
       has_function_privilege('anon', 'public.practice_timezone()', 'EXECUTE') as anon_can_read;
