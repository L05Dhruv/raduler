-- The practice's own location, as the default for a published shift.
--
-- Sits beside the time zone in `private.practice_settings` for the same reason: it is a
-- fact about the practice rather than about any one shift, and an operator should be able
-- to change it without a deploy.
--
-- It is a default rather than a constraint. `shifts.location` is still free text and still
-- says what it says — "Main Campus, Reading Room 2", "Remote" — because a practice in one
-- city still reads in several rooms. What this removes is retyping the common case.
--
-- Run after 0008. Safe to re-run.

alter table private.practice_settings
  add column if not exists default_location text;

-- ---------------------------------------------------------------------------
-- Reading it
--
-- SECURITY DEFINER, like practice_timezone(), because the caller cannot read the table.
-- Returns a place name, which is not a secret and which the publish form needs.
-- ---------------------------------------------------------------------------

create or replace function public.practice_default_location()
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select (select nullif(s.default_location, '') from private.practice_settings s where s.id);
$$;

revoke execute on function public.practice_default_location() from public, anon;
grant execute on function public.practice_default_location() to authenticated;

-- ---------------------------------------------------------------------------
-- Writing it
--
-- The two-argument form has to go rather than sit alongside: adding a parameter creates a
-- second function, and leaving both means a caller can silently reach the one that ignores
-- the location. Dropping loses the ACL, so the grants are re-stated below.
-- ---------------------------------------------------------------------------

drop function if exists public.set_practice_settings(text, text);

create or replace function public.set_practice_settings(
  p_timezone text,
  p_allowed_email_domains text,
  p_default_location text
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
      default_location      = nullif(trim(p_default_location), ''),
      updated_at            = now(),
      updated_by            = (select auth.uid())
  where id;

  perform private.write_audit(
    'settings.update', 'practice_settings', 'singleton',
    jsonb_build_object(
      'old', jsonb_build_object('timezone', v_old.timezone,
                                'allowed_email_domains', v_old.allowed_email_domains,
                                'default_location', v_old.default_location),
      'new', jsonb_build_object('timezone', nullif(trim(p_timezone), ''),
                                'allowed_email_domains',
                                nullif(trim(p_allowed_email_domains), ''),
                                'default_location', nullif(trim(p_default_location), ''))
    )
  );

  return public.practice_timezone();
end;
$$;

revoke execute on function public.set_practice_settings(text, text, text) from public, anon;
grant execute on function public.set_practice_settings(text, text, text) to authenticated;

-- Verify: expect the configured location, and false for anon.
select public.practice_default_location() as default_location,
       has_function_privilege('anon', 'public.practice_default_location()', 'EXECUTE')
         as anon_can_read;
