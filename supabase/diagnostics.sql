-- Privilege diagnostics. Read-only — safe to run any time.
-- Paste into the Supabase SQL editor and check the `expected` column against `actual`.

select 'authenticated USAGE on schema private' as check,
       true as expected,
       has_schema_privilege('authenticated', 'private', 'USAGE') as actual
union all
select 'anon USAGE on schema private',
       false,
       has_schema_privilege('anon', 'private', 'USAGE')
union all
select 'authenticated EXECUTE on private.is_admin()',
       true,
       has_function_privilege('authenticated', 'private.is_admin()', 'EXECUTE')
union all
select 'anon EXECUTE on claim_shift',
       false,
       has_function_privilege('anon', 'public.claim_shift(uuid)', 'EXECUTE')
union all
select 'anon EXECUTE on admin_update_profile',
       false,
       has_function_privilege(
         'anon',
         'public.admin_update_profile(uuid, public.user_role, integer, boolean)',
         'EXECUTE')
union all
select 'anon EXECUTE on create_invoice',
       false,
       has_function_privilege('anon', 'public.create_invoice(uuid, date, date)', 'EXECUTE')
union all
select 'authenticated EXECUTE on claim_shift',
       true,
       has_function_privilege('authenticated', 'public.claim_shift(uuid)', 'EXECUTE')
union all
select 'anon SELECT on profiles',
       false,
       has_table_privilege('anon', 'public.profiles', 'SELECT')
union all
select 'authenticated SELECT on profiles',
       true,
       has_table_privilege('authenticated', 'public.profiles', 'SELECT')
union all
select 'authenticated UPDATE on profiles.hourly_rate_cents',
       false,
       has_column_privilege('authenticated', 'public.profiles', 'hourly_rate_cents', 'UPDATE')
union all
select 'authenticated UPDATE on profiles.full_name',
       true,
       has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE')
union all
select 'authenticated INSERT on shift_assignments',
       false,
       has_table_privilege('authenticated', 'public.shift_assignments', 'INSERT');

-- The raw grants, if any row above disagrees. `=X/postgres` means EXECUTE granted to
-- PUBLIC; `anon=X/postgres` means granted directly to anon. Neither should appear.
select p.proname, pg_catalog.array_to_string(p.proacl, E'\n') as acl
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('claim_shift', 'release_shift', 'hours_summary',
                    'create_invoice', 'decide_time_off', 'admin_update_profile')
order by p.proname;

-- Confirms every table is actually protected, not merely ungranted.
select tablename, rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
order by tablename;
