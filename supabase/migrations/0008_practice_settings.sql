-- Practice configuration in a table, because the database setting it used to live in
-- cannot be set on Supabase.
--
-- 0001 and 0006 both told an operator to run:
--
--   alter database postgres set app.practice_timezone = 'America/New_York';
--   alter database postgres set app.allowed_email_domains = 'yourpractice.com';
--
-- Neither works. `postgres` on Supabase owns the database but is not a superuser, and from
-- PostgreSQL 15 onwards setting an *unregistered* custom parameter at database level
-- requires superuser — ownership is not enough. The failure is
-- `42501: permission denied to set parameter`, and it happens in the SQL editor too, since
-- that connects as the same role. Verified against a live project on PostgreSQL 17.
--
-- The consequence was quiet and worth naming. `practice_timezone()` fell back to UTC, so
-- every reporting period ran on UTC days — the exact defect 0006 was written to fix was
-- still live, because the fix depended on a setting nobody could apply. And the signup
-- domain allowlist that SECURITY.md describes as a control could not be turned on at all.
--
-- So configuration moves into `private.practice_settings`: one row, invisible to PostgREST,
-- readable only through the functions below, writable only by an administrator through an
-- audited RPC. The old `current_setting()` lookups are kept as a fallback, so a project
-- where someone did manage to set them (self-hosted, with a real superuser) keeps working.
--
-- Run after 0007. Safe to re-run.

-- ---------------------------------------------------------------------------
-- The settings row
-- ---------------------------------------------------------------------------

create table if not exists private.practice_settings (
  -- A one-row table: the primary key can only ever hold true, so a second row is a
  -- constraint violation rather than a silent second source of truth.
  id                    boolean primary key default true check (id),
  -- Null means "not configured", which is what lets the current_setting fallback below
  -- still win on a project that had it set. A default of 'UTC' would shadow it.
  timezone              text,
  allowed_email_domains text,
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.profiles (id) on delete set null
);

insert into private.practice_settings (id) values (true) on conflict (id) do nothing;

-- No grants to anon or authenticated. `authenticated` holds USAGE on schema private
-- (0003), so the absence of a table grant is what keeps this unreadable directly; the
-- SECURITY DEFINER functions below are the only way in.
revoke all on private.practice_settings from anon, authenticated;

-- The zone has to be real. Only the RPC writes here, but a trigger guards every path
-- including a hand-written UPDATE, and a bad zone would silently move money.
create or replace function private.validate_practice_settings()
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

drop trigger if exists practice_settings_validate on private.practice_settings;
create trigger practice_settings_validate
  before insert or update on private.practice_settings
  for each row execute function private.validate_practice_settings();

-- ---------------------------------------------------------------------------
-- Reading it
--
-- SECURITY DEFINER now, because the caller cannot read the table. It returns a zone name,
-- which is not a secret — the browser needs it to label times — and takes no arguments, so
-- it reports on nothing but the practice.
-- ---------------------------------------------------------------------------

create or replace function public.practice_timezone()
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (select nullif(s.timezone, '') from private.practice_settings s where s.id),
    nullif(current_setting('app.practice_timezone', true), ''),
    'UTC'
  );
$$;

revoke execute on function public.practice_timezone() from public, anon;
grant execute on function public.practice_timezone() to authenticated;

-- ---------------------------------------------------------------------------
-- Writing it
-- ---------------------------------------------------------------------------

/*
 * Both arguments are required and null means "clear this". That is deliberate: a partial
 * update helper on a two-field settings row invites the caller to forget which field they
 * are not passing, and clearing the domain allowlist by accident opens signup.
 */
create or replace function public.set_practice_settings(
  p_timezone text,
  p_allowed_email_domains text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old private.practice_settings;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  select * into v_old from private.practice_settings where id;

  update private.practice_settings
  set timezone              = nullif(trim(p_timezone), ''),
      allowed_email_domains = nullif(trim(p_allowed_email_domains), ''),
      updated_at            = now(),
      updated_by            = (select auth.uid())
  where id;

  perform private.write_audit(
    'settings.update', 'practice_settings', 'singleton',
    jsonb_build_object(
      'old', jsonb_build_object('timezone', v_old.timezone,
                                'allowed_email_domains', v_old.allowed_email_domains),
      'new', jsonb_build_object('timezone', nullif(trim(p_timezone), ''),
                                'allowed_email_domains',
                                nullif(trim(p_allowed_email_domains), ''))
    )
  );

  return public.practice_timezone();
end;
$$;

revoke execute on function public.set_practice_settings(text, text) from public, anon;
grant execute on function public.set_practice_settings(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Signup domain allowlist, from the table
--
-- Otherwise identical to 0001; only the source of the allowlist changes. This is the half
-- that was not merely mis-documented but inert: with no way to set the parameter, the
-- trigger's allowlist was always empty and any address could register.
-- ---------------------------------------------------------------------------

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed text := coalesce(
    (select nullif(s.allowed_email_domains, '') from private.practice_settings s where s.id),
    nullif(current_setting('app.allowed_email_domains', true), ''),
    ''
  );
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

-- Verify: expect settings_rows = 1, and the configured zone or UTC.
select (select count(*) from private.practice_settings) as settings_rows,
       public.practice_timezone()                       as practice_zone,
       has_function_privilege('anon', 'public.set_practice_settings(text, text)', 'EXECUTE')
         as anon_can_configure;
