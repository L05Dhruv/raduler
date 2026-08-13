-- One rate per person, not per shift.
--
-- Pay was `coalesce(s.hourly_rate_cents, p.hourly_rate_cents)`: a shift could carry its
-- own rate and override the person holding it. It now comes from the profile alone, so
-- there is one number per person and one place an administrator sets it
-- (`admin_update_profile()`), which is the same place their role and active flag live.
--
-- Two consequences, both visible:
--
--   * **Figures change wherever a shift's rate differed from its holder's.** Reports and
--     invoices generated after this will not match ones issued before, for those shifts.
--     Invoices already issued are unaffected: `invoice_lines.rate_cents` is a snapshot
--     taken at the time, which is exactly why it is stored rather than recomputed.
--   * **Shift differentials are gone.** There is no longer any way to pay more for
--     overnight call than for a day read. If the practice wants that back it belongs on
--     the person or the role, not on the posting — or as a deliberate admin-only override,
--     which this migration removes rather than keeps dormant.
--
-- Run after 0006. The DROP at the end is not reversible.

-- ---------------------------------------------------------------------------
-- Money reads the profile only.
--
-- Otherwise identical to 0006 — the practice-zone anchoring on every date boundary is
-- preserved, since these bodies are replaced wholesale rather than patched.
-- ---------------------------------------------------------------------------

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
        * p.hourly_rate_cents
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

  -- rate_cents is still written per line. The rate now comes from one place, but an
  -- invoice must still record what it charged: a rate that changes next month cannot be
  -- allowed to rewrite what was billed last month.
  insert into public.invoice_lines (invoice_id, shift_id, description, worked_on, minutes, rate_cents, amount_cents)
  select
    v_invoice.id,
    s.id,
    s.title || case when s.location <> '' then ' — ' || s.location else '' end,
    (s.starts_at at time zone v_zone)::date,
    (extract(epoch from (coalesce(a.actual_end, s.ends_at) - coalesce(a.actual_start, s.starts_at))) / 60)::integer,
    p.hourly_rate_cents,
    round(
      (extract(epoch from (coalesce(a.actual_end, s.ends_at) - coalesce(a.actual_start, s.starts_at))) / 3600)
      * p.hourly_rate_cents
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
-- Drop the column.
--
-- Deliberately after the functions above, so nothing reads it at the moment it goes.
-- Left in place it would be a money column no expression consults, which the next person
-- reading this schema would reasonably assume was live — the same shape of mistake as a
-- table whose grants were never revoked.
--
-- NOT REVERSIBLE. Per-shift rates in an existing project are discarded here.
-- ---------------------------------------------------------------------------

alter table public.shifts drop column if exists hourly_rate_cents;

-- Verify: expect rate_column_gone = true.
select not exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'shifts'
    and column_name = 'hourly_rate_cents'
) as rate_column_gone;
