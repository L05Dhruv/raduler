-- The defence-in-depth half of 0002. Run only after 0003 has succeeded.
--
-- Each statement is independent, so run them one at a time if the batch fails —
-- REVOKE only removes grants made by the *current* role, and silently does nothing
-- (with a notice, not an error) when the grantor differs. If `anon` still holds
-- EXECUTE afterwards, that is the cause, and the fix is to re-run as the grantor.
--
-- Nothing here is load-bearing for correctness: every function re-checks its caller,
-- which is why an anonymous call to admin_update_profile already comes back
-- "Administrator access required." This is about refusing the request earlier.

revoke execute on function public.claim_shift(uuid) from anon;
revoke execute on function public.release_shift(uuid) from anon;
revoke execute on function public.hours_summary(date, date) from anon;
revoke execute on function public.create_invoice(uuid, date, date) from anon;
revoke execute on function public.decide_time_off(uuid, boolean) from anon;
revoke execute on function public.admin_update_profile(uuid, public.user_role, integer, boolean) from anon;

revoke execute on function public.claim_shift(uuid) from public;
revoke execute on function public.release_shift(uuid) from public;
revoke execute on function public.hours_summary(date, date) from public;
revoke execute on function public.create_invoice(uuid, date, date) from public;
revoke execute on function public.decide_time_off(uuid, boolean) from public;
revoke execute on function public.admin_update_profile(uuid, public.user_role, integer, boolean) from public;

-- Re-assert the intended grant; the revokes above may have taken it too.
grant execute on function public.claim_shift(uuid) to authenticated;
grant execute on function public.release_shift(uuid) to authenticated;
grant execute on function public.hours_summary(date, date) to authenticated;
grant execute on function public.create_invoice(uuid, date, date) to authenticated;
grant execute on function public.decide_time_off(uuid, boolean) to authenticated;
grant execute on function public.admin_update_profile(uuid, public.user_role, integer, boolean) to authenticated;

-- Verify: expect can_use_private = true, anon_can_call = false.
select has_schema_privilege('authenticated', 'private', 'USAGE')             as can_use_private,
       has_function_privilege('anon', 'public.claim_shift(uuid)', 'EXECUTE') as anon_can_call;
