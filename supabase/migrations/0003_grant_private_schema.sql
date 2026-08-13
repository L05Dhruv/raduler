-- The essential half of 0002, on its own.
--
-- 0002 rolled back in full (the Supabase SQL editor runs a pasted script as one
-- transaction, so one failing statement silently undoes the rest). These two
-- statements are the ones that matter: without them, every RLS policy that calls
-- private.is_admin() fails for signed-in users.
--
-- Run this alone. If it errors, the message names the cause directly.

grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;
