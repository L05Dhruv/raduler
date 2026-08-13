-- Two privilege defects in 0001, both found by probing a live project.
--
-- Run this against any database that already has 0001 applied. 0001 has been
-- corrected in place, so a fresh install gets the right result without this file;
-- it is written to be idempotent either way.

-- ---------------------------------------------------------------------------
-- 1. RLS policies could not call private.is_admin()
--
-- Policy expressions run with the privileges of the *querying* user. SECURITY
-- DEFINER governs what the function body may touch, not who may invoke it — so the
-- caller still needs USAGE on the schema and EXECUTE on the function. `authenticated`
-- had neither (a new schema grants nothing to anyone but its owner), which would have
-- failed every admin policy with "permission denied for schema private" the first
-- time a real user signed in.
--
-- Granting these is not a loosening: is_admin() takes no arguments and reports only
-- on the caller. The `private` schema is not in Supabase's exposed-schemas list, so
-- PostgREST will not route to it regardless.
-- ---------------------------------------------------------------------------

grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

-- Trigger functions fire during ordinary DML by ordinary users.
grant execute on function private.audit_trigger() to authenticated;
grant execute on function private.touch_updated_at() to authenticated;

-- anon stays locked out entirely — it has no reason to reach this schema.
revoke all on schema private from anon;

-- ---------------------------------------------------------------------------
-- 2. anon held EXECUTE on every RPC
--
-- 0001 revokes function privileges in its "privilege baseline" section, but the RPCs
-- are created further down the file, so each one picked up PostgreSQL's default grant
-- of EXECUTE to PUBLIC. Probing the deployed project confirmed it: an anonymous
-- request reached the inside of admin_update_profile() and was turned away by the
-- function's own check rather than by a privilege.
--
-- Nothing was exploitable — every function re-validates the caller, which is why the
-- probe came back "Administrator access required." But an unauthenticated request
-- should never get far enough to be told that.
-- ---------------------------------------------------------------------------

revoke execute on function public.claim_shift(uuid) from public, anon;
revoke execute on function public.release_shift(uuid) from public, anon;
revoke execute on function public.hours_summary(date, date) from public, anon;
revoke execute on function public.create_invoice(uuid, date, date) from public, anon;
revoke execute on function public.decide_time_off(uuid, boolean) from public, anon;
revoke execute on function public.admin_update_profile(uuid, public.user_role, integer, boolean)
  from public, anon;

grant execute on function public.claim_shift(uuid) to authenticated;
grant execute on function public.release_shift(uuid) to authenticated;
grant execute on function public.hours_summary(date, date) to authenticated;
grant execute on function public.create_invoice(uuid, date, date) to authenticated;
grant execute on function public.decide_time_off(uuid, boolean) to authenticated;
grant execute on function public.admin_update_profile(uuid, public.user_role, integer, boolean)
  to authenticated;

-- The helper functions are called only from SECURITY DEFINER code and triggers, never
-- by a client, so PUBLIC has no business executing them directly.
revoke execute on function private.write_audit(text, text, text, jsonb) from public, anon;
