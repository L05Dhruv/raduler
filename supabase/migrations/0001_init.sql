-- Raduler — initial schema.
--
-- Design rule for this file: the browser holds a publishable anon key in a public
-- repository, so *nothing* here may assume the client is honest. Every read is gated by
-- RLS, every privileged write goes through a SECURITY DEFINER function, and the checks
-- that protect scheduling integrity (one person per shift, no double-booking, no
-- claiming through approved leave) are database constraints rather than UI logic.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('radiologist', 'tech', 'assistant', 'admin');
create type public.shift_status as enum ('open', 'filled', 'cancelled');
create type public.assignment_status as enum ('confirmed', 'released');
create type public.time_off_kind as enum ('vacation', 'conference', 'sick', 'other');
create type public.time_off_status as enum ('requested', 'approved', 'denied');
create type public.invoice_status as enum ('draft', 'sent', 'paid');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             text not null,
  full_name         text not null default '',
  role              public.user_role not null default 'radiologist',
  modality          text,
  hourly_rate_cents integer not null default 0 check (hourly_rate_cents >= 0),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text not null default '',
  created_at  timestamptz not null default now()
);

create table public.team_members (
  team_id      uuid not null references public.teams (id) on delete cascade,
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  role_in_team text not null default 'member',
  created_at   timestamptz not null default now(),
  primary key (team_id, profile_id)
);

create table public.shifts (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid references public.teams (id) on delete set null,
  title             text not null,
  location          text not null default '',
  modality          text,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  required_role     public.user_role not null default 'radiologist',
  -- Null means "fall back to the person's own rate".
  hourly_rate_cents integer check (hourly_rate_cents is null or hourly_rate_cents >= 0),
  notes             text not null default '',
  status            public.shift_status not null default 'open',
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint shifts_time_order check (ends_at > starts_at)
);

create index shifts_starts_at_idx on public.shifts (starts_at);
create index shifts_status_idx on public.shifts (status);

create table public.shift_assignments (
  id           uuid primary key default gen_random_uuid(),
  shift_id     uuid not null references public.shifts (id) on delete cascade,
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  status       public.assignment_status not null default 'confirmed',
  claimed_at   timestamptz not null default now(),
  released_at  timestamptz,
  -- Set by an admin when the worked time differed from the scheduled time.
  actual_start timestamptz,
  actual_end   timestamptz,
  constraint assignment_actuals_order
    check (actual_start is null or actual_end is null or actual_end > actual_start)
);

-- The line that makes double-booking a shift impossible, even if two radiologists
-- click "claim" in the same millisecond.
create unique index shift_assignments_one_confirmed
  on public.shift_assignments (shift_id) where status = 'confirmed';
create index shift_assignments_profile_idx on public.shift_assignments (profile_id);

create table public.time_off (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  starts_on  date not null,
  ends_on    date not null,
  kind       public.time_off_kind not null default 'vacation',
  status     public.time_off_status not null default 'requested',
  note       text not null default '',
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint time_off_date_order check (ends_on >= starts_on)
);

create index time_off_profile_idx on public.time_off (profile_id);

create table public.invoices (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique,
  profile_id    uuid not null references public.profiles (id) on delete restrict,
  period_start  date not null,
  period_end    date not null,
  total_minutes integer not null default 0,
  total_cents   bigint not null default 0,
  status        public.invoice_status not null default 'draft',
  issued_by     uuid references public.profiles (id) on delete set null,
  issued_at     timestamptz not null default now(),
  constraint invoice_period_order check (period_end >= period_start)
);

create table public.invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  shift_id     uuid references public.shifts (id) on delete set null,
  description  text not null,
  worked_on    date not null,
  minutes      integer not null check (minutes >= 0),
  rate_cents   integer not null check (rate_cents >= 0),
  amount_cents bigint not null check (amount_cents >= 0)
);

create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id);

-- Append-only. No role is ever granted UPDATE or DELETE, and only SECURITY DEFINER
-- code inserts, so an attacker holding a user session cannot rewrite their tracks.
create table public.audit_log (
  id         bigserial primary key,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Privilege baseline: revoke Supabase's permissive defaults, then grant back only
-- what each table genuinely needs. RLS narrows further; grants come first.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke all on schema private from anon, authenticated;

grant select on public.profiles to authenticated;
-- Column-level grant: a user may rename themselves, never re-band their own pay or
-- promote themselves to admin. Those go through admin_update_profile().
grant update (full_name, modality) on public.profiles to authenticated;

grant select, insert, update, delete on public.teams to authenticated;
grant select, insert, update, delete on public.team_members to authenticated;
grant select, insert, update, delete on public.shifts to authenticated;
grant select, insert, update, delete on public.time_off to authenticated;
grant select, insert, update, delete on public.invoices to authenticated;
grant select, insert, update, delete on public.invoice_lines to authenticated;

-- Deliberately SELECT-only: assignments are created and retired exclusively by
-- claim_shift() / release_shift(), which enforce the rules.
grant select on public.shift_assignments to authenticated;

grant select on public.audit_log to authenticated;

-- ---------------------------------------------------------------------------
-- Helper functions (private schema — never exposed through PostgREST)
-- ---------------------------------------------------------------------------

-- A policy on `profiles` that queried `profiles` would recurse forever. SECURITY
-- DEFINER breaks the cycle by running outside RLS.
create or replace function private.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
      and p.active
  );
$$;

create or replace function private.write_audit(
  p_action text,
  p_entity text,
  p_entity_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, metadata)
  values ((select auth.uid()), p_action, p_entity, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
$$;

create or replace function private.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (actor_id, action, entity, entity_id, metadata)
  values (
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id'),
    case tg_op
      when 'INSERT' then jsonb_build_object('new', to_jsonb(new))
      when 'DELETE' then jsonb_build_object('old', to_jsonb(old))
      else jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
    end
  );
  return coalesce(new, old);
end;
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- New signups: enforce the practice's email domain and mint the profile row.
-- The allowlist is a database setting so it can change without a deploy:
--   alter database postgres set app.allowed_email_domains = 'yourpractice.com';
-- Left empty, any address may sign up — acceptable for a demo, not for go-live.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed text := coalesce(current_setting('app.allowed_email_domains', true), '');
begin
  if v_allowed <> '' and not exists (
    select 1
    from unnest(string_to_array(v_allowed, ',')) as d
    where lower(new.email) like '%@' || lower(trim(d))
  ) then
    raise exception 'Email domain is not permitted for this application.';
  end if;

  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

create trigger audit_profiles
  after insert or update or delete on public.profiles
  for each row execute function private.audit_trigger();
create trigger audit_shifts
  after insert or update or delete on public.shifts
  for each row execute function private.audit_trigger();
create trigger audit_time_off
  after insert or update or delete on public.time_off
  for each row execute function private.audit_trigger();
create trigger audit_teams
  after insert or update or delete on public.teams
  for each row execute function private.audit_trigger();
create trigger audit_team_members
  after insert or update or delete on public.team_members
  for each row execute function private.audit_trigger();
create trigger audit_invoices
  after insert or update or delete on public.invoices
  for each row execute function private.audit_trigger();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.teams             enable row level security;
alter table public.team_members      enable row level security;
alter table public.shifts            enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.time_off          enable row level security;
alter table public.invoices          enable row level security;
alter table public.invoice_lines     enable row level security;
alter table public.audit_log         enable row level security;

-- auth.uid() is wrapped in a sub-select throughout: Postgres then evaluates it once
-- per statement instead of once per row.

-- profiles ------------------------------------------------------------------
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- teams / team_members ------------------------------------------------------
create policy teams_select_all on public.teams
  for select to authenticated using (true);
create policy teams_admin_write on public.teams
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy team_members_select_all on public.team_members
  for select to authenticated using (true);
create policy team_members_admin_write on public.team_members
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- shifts --------------------------------------------------------------------
-- Everyone sees the whole board; that is the point of an open-shift calendar.
create policy shifts_select_all on public.shifts
  for select to authenticated using (true);
create policy shifts_admin_write on public.shifts
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- shift_assignments ---------------------------------------------------------
-- Read-only to everyone; there is no INSERT/UPDATE grant at all, so no write policy
-- would help an attacker even if one existed.
create policy assignments_select_own on public.shift_assignments
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select private.is_admin()));

-- time_off ------------------------------------------------------------------
create policy time_off_select_own on public.time_off
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select private.is_admin()));

-- `status = 'requested'` in the WITH CHECK is what stops a user approving their own
-- leave, on both insert and update.
create policy time_off_insert_own on public.time_off
  for insert to authenticated
  with check (profile_id = (select auth.uid()) and status = 'requested');

create policy time_off_update_own on public.time_off
  for update to authenticated
  using (profile_id = (select auth.uid()) and status = 'requested')
  with check (profile_id = (select auth.uid()) and status = 'requested');

create policy time_off_delete_own on public.time_off
  for delete to authenticated
  using (profile_id = (select auth.uid()) and status = 'requested');

create policy time_off_admin_all on public.time_off
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- invoices ------------------------------------------------------------------
create policy invoices_select_own on public.invoices
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select private.is_admin()));
create policy invoices_admin_write on public.invoices
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy invoice_lines_select_own on public.invoice_lines
  for select to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_lines.invoice_id
      and (i.profile_id = (select auth.uid()) or (select private.is_admin()))
  ));
create policy invoice_lines_admin_write on public.invoice_lines
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- audit_log -----------------------------------------------------------------
create policy audit_admin_read on public.audit_log
  for select to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- RPCs — the only path to a privileged write
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

  if exists (
    select 1 from public.time_off t
    where t.profile_id = v_uid
      and t.status = 'approved'
      and daterange(t.starts_on, t.ends_on, '[]')
          && daterange(v_shift.starts_at::date, v_shift.ends_at::date, '[]')
  ) then
    raise exception 'That shift falls inside your approved time off.' using errcode = 'P0001';
  end if;

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

create or replace function public.release_shift(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_assignment public.shift_assignments;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;

  select * into v_assignment
  from public.shift_assignments
  where shift_id = p_shift_id and status = 'confirmed'
  for update;

  if not found then
    raise exception 'No confirmed assignment for that shift.' using errcode = 'P0002';
  end if;

  if v_assignment.profile_id <> v_uid and not (select private.is_admin()) then
    raise exception 'You can only release your own shifts.' using errcode = '42501';
  end if;

  update public.shift_assignments
  set status = 'released', released_at = now()
  where id = v_assignment.id;

  update public.shifts set status = 'open'
  where id = p_shift_id and status = 'filled';

  perform private.write_audit('shift.release', 'shifts', p_shift_id::text,
    jsonb_build_object('assignment_id', v_assignment.id, 'was_held_by', v_assignment.profile_id));
end;
$$;

-- Admin-only edits to the fields a user cannot grant themselves.
create or replace function public.admin_update_profile(
  p_profile_id uuid,
  p_role public.user_role,
  p_hourly_rate_cents integer,
  p_active boolean
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if p_hourly_rate_cents < 0 then
    raise exception 'Rate cannot be negative.' using errcode = '22023';
  end if;

  update public.profiles
  set role = p_role,
      hourly_rate_cents = p_hourly_rate_cents,
      active = p_active
  where id = p_profile_id
  returning * into v_profile;

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  return v_profile;
end;
$$;

-- Hours and earnings live in SQL so the report and the invoice can never disagree.
-- SECURITY INVOKER (the default) means RLS applies: a user sees only their own row,
-- an admin sees everyone.
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
    and s.starts_at::date between p_start and p_end
  group by p.id, p.full_name, p.role
  order by p.full_name;
$$;

-- Invoice totals are computed here, from the same expression as hours_summary, and
-- stored as line items. The client never supplies an amount.
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

  insert into public.invoice_lines (invoice_id, shift_id, description, worked_on, minutes, rate_cents, amount_cents)
  select
    v_invoice.id,
    s.id,
    s.title || case when s.location <> '' then ' — ' || s.location else '' end,
    s.starts_at::date,
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
    and s.starts_at::date between p_start and p_end
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
    jsonb_build_object('profile_id', p_profile_id, 'total_cents', v_invoice.total_cents));

  return v_invoice;
end;
$$;

create or replace function public.decide_time_off(p_id uuid, p_approve boolean)
returns public.time_off
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.time_off;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  update public.time_off
  set status = case when p_approve then 'approved'::public.time_off_status
                    else 'denied'::public.time_off_status end,
      decided_by = (select auth.uid()),
      decided_at = now()
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

-- Functions are callable only by signed-in users; each one re-checks authorisation
-- internally rather than trusting the grant alone.
grant execute on function public.claim_shift(uuid) to authenticated;
grant execute on function public.release_shift(uuid) to authenticated;
grant execute on function public.admin_update_profile(uuid, public.user_role, integer, boolean) to authenticated;
grant execute on function public.hours_summary(date, date) to authenticated;
grant execute on function public.create_invoice(uuid, date, date) to authenticated;
grant execute on function public.decide_time_off(uuid, boolean) to authenticated;
