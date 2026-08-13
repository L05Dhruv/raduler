-- Flexible per-day hours within a published shift.
--
-- Most of this already existed. `shift_assignments.actual_start / actual_end` were in
-- 0001, and both money functions already read
-- `coalesce(a.actual_end, s.ends_at) - coalesce(a.actual_start, s.starts_at)`, so
-- hours_summary() and create_invoice() pick these up with no change here. What was
-- missing was any way to *write* them: the table carries no INSERT or UPDATE grant for
-- anyone, deliberately, so the only paths in are SECURITY DEFINER functions.
--
-- The rules this file enforces, in the order they bite:
--
--   * You may only change hours on a shift you hold. Admins may change anyone's.
--   * Chosen hours must fall inside the published window. Pay is derived from these
--     columns, so an unbounded self-service edit would be a self-service pay rise.
--     Administrators are exempt — recording a genuine overrun is their job, and the
--     audit log names them.
--   * A shift that already appears on an invoice is frozen. `create_invoice()`
--     snapshots minutes and amounts into `invoice_lines`; letting the source hours move
--     afterwards is exactly how a report and an invoice for the same period come to
--     disagree, which the design says cannot happen.
--   * The new window may not overlap another shift the same person holds, so no hour
--     is ever billed twice. Unreachable for a regular user (narrowing inside a window
--     that claim_shift() already proved conflict-free cannot create a conflict) but
--     reachable through the administrator exemption above.
--
-- Run after 0001. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Shared body for both entry points.
--
-- Returns null when the change was applied, otherwise the reason it was refused.
-- Returning text rather than raising is what lets the bulk caller skip one shift and
-- carry on: a RAISE would abort the statement and roll back the whole batch.
-- ---------------------------------------------------------------------------

create or replace function private.apply_shift_hours(
  p_shift_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_is_admin   boolean := (select private.is_admin());
  v_shift      public.shifts;
  v_assignment public.shift_assignments;
  v_invoice    text;
begin
  -- Checked here and not only in the wrappers. In plpgsql `if null then` takes the
  -- false branch, so an unauthenticated caller reaching the ownership test below
  -- would compare against a null uid, fall through, and write. Fail closed instead.
  if v_uid is null then
    return 'Not authenticated.';
  end if;

  -- Lock the assignment: two edits to the same row serialise here rather than racing.
  select * into v_assignment
  from public.shift_assignments
  where shift_id = p_shift_id and status = 'confirmed'
  for update;

  if not found then
    return 'Nobody holds that shift.';
  end if;

  if v_assignment.profile_id <> v_uid and not v_is_admin then
    return 'You can only change the hours on your own shifts.';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id;
  if not found then
    return 'Shift not found.';
  end if;

  if v_shift.status = 'cancelled' then
    return 'That shift has been cancelled.';
  end if;

  select i.number into v_invoice
  from public.invoice_lines l
  join public.invoices i on i.id = l.invoice_id
  where l.shift_id = p_shift_id
  limit 1;

  if v_invoice is not null then
    return format(
      'Already invoiced on %s. An administrator has to void that invoice first.',
      v_invoice
    );
  end if;

  -- Both null clears the override and restores the published hours; validation below
  -- is skipped, since there is nothing left to check.
  if p_start is not null or p_end is not null then
    if p_start is null or p_end is null then
      return 'Give both a start and an end time.';
    end if;

    if p_end <= p_start then
      return 'The end time has to be after the start time.';
    end if;

    -- No times in this message: to_char would render them in the session's time zone,
    -- which for a PostgREST connection is UTC, and a radiologist reading "must fall
    -- between 17:00 and 01:00" about their 12-7 shift is worse than no detail at all.
    -- The client knows the window and states it in local time.
    if not v_is_admin
       and (p_start < v_shift.starts_at or p_end > v_shift.ends_at) then
      return 'Those hours fall outside the published shift.';
    end if;

    if exists (
      select 1
      from public.shift_assignments a
      join public.shifts s on s.id = a.shift_id
      where a.profile_id = v_assignment.profile_id
        and a.status = 'confirmed'
        and a.id <> v_assignment.id
        and tstzrange(
              coalesce(a.actual_start, s.starts_at),
              coalesce(a.actual_end, s.ends_at),
              '[)'
            ) && tstzrange(p_start, p_end, '[)')
    ) then
      return 'Those hours overlap another shift the same person holds.';
    end if;
  end if;

  update public.shift_assignments
  set actual_start = p_start,
      actual_end   = p_end
  where id = v_assignment.id;

  -- shift_assignments carries no audit trigger (0001 puts them on the tables users
  -- write directly), so the RPCs record their own history, as claim/release do.
  perform private.write_audit(
    'assignment.hours',
    'shift_assignments',
    v_assignment.id::text,
    jsonb_build_object(
      'shift_id', p_shift_id,
      'profile_id', v_assignment.profile_id,
      'by_admin', v_is_admin and v_assignment.profile_id <> v_uid,
      'old', jsonb_build_object('start', v_assignment.actual_start,
                                'end',   v_assignment.actual_end),
      'new', jsonb_build_object('start', p_start, 'end', p_end)
    )
  );

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- One shift. Pass both timestamps null to go back to the published hours.
-- ---------------------------------------------------------------------------

create or replace function public.set_shift_hours(
  p_shift_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns public.shift_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_row    public.shift_assignments;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;

  v_reason := private.apply_shift_hours(p_shift_id, p_start, p_end);
  if v_reason is not null then
    raise exception '%', v_reason using errcode = 'P0001';
  end if;

  select * into v_row
  from public.shift_assignments
  where shift_id = p_shift_id and status = 'confirmed';

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Many shifts at once — "I work 12-7 most days".
--
-- Takes `[{ "shift_id": uuid, "start": timestamptz, "end": timestamptz }, ...]`.
-- The client builds the concrete timestamps because only the browser knows the user's
-- time zone, and building them from local wall-clock time is what keeps a window
-- steady across a daylight-saving boundary — the same reason expandPattern() works
-- that way.
--
-- Reports per shift rather than raising, so one frozen or ill-fitting shift does not
-- discard the other nineteen.
-- ---------------------------------------------------------------------------

create or replace function public.set_shift_hours_bulk(p_entries jsonb)
returns table (shift_id uuid, applied boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;

  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Expected an array of { shift_id, start, end } objects.'
      using errcode = '22023';
  end if;

  -- Same spirit as MAX_PATTERN_SHIFTS: a mistyped range should be refused, not
  -- chewed through.
  if jsonb_array_length(p_entries) > 400 then
    raise exception 'Too many shifts in one request (limit 400).' using errcode = '22023';
  end if;

  for v_entry in select value from jsonb_array_elements(p_entries) as t(value) loop
    shift_id := (v_entry ->> 'shift_id')::uuid;
    reason   := private.apply_shift_hours(
                  shift_id,
                  (v_entry ->> 'start')::timestamptz,
                  (v_entry ->> 'end')::timestamptz
                );
    applied  := reason is null;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges.
--
-- PostgreSQL grants EXECUTE to PUBLIC on every new function, so a fresh function is
-- open until said otherwise — the lesson 0002 was written to record. `authenticated`
-- holds USAGE on schema `private` (0003), so the revoke on apply_shift_hours is the
-- only thing keeping it from being called directly. Nothing is exploitable if it were:
-- it authenticates and checks ownership itself. This refuses the call earlier.
-- ---------------------------------------------------------------------------

revoke execute on function private.apply_shift_hours(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

revoke execute on function public.set_shift_hours(uuid, timestamptz, timestamptz)
  from public, anon;
revoke execute on function public.set_shift_hours_bulk(jsonb) from public, anon;

grant execute on function public.set_shift_hours(uuid, timestamptz, timestamptz)
  to authenticated;
grant execute on function public.set_shift_hours_bulk(jsonb) to authenticated;

-- Verify: expect holder_can_set = true, anon_can_set = false, helper_is_private = false.
select has_function_privilege('authenticated',
         'public.set_shift_hours(uuid, timestamptz, timestamptz)', 'EXECUTE') as holder_can_set,
       has_function_privilege('anon',
         'public.set_shift_hours(uuid, timestamptz, timestamptz)', 'EXECUTE') as anon_can_set,
       has_function_privilege('authenticated',
         'private.apply_shift_hours(uuid, timestamptz, timestamptz)', 'EXECUTE') as helper_is_private;
