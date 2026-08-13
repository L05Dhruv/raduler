import { getSupabase } from "@/lib/supabase/client";

/**
 * The practice's time zone, as the database understands it.
 *
 * Read rather than configured in the bundle on purpose. The same value anchors every
 * reporting period inside `hours_summary()` and `create_invoice()`, and two sources for
 * one fact drift — here the drift would be silent and financial, with the browser
 * labelling a roster in one zone while invoices were totalled in another.
 *
 * It lives in `private.practice_settings`, so an operator changes it without a deploy. Not a
 * database parameter: `alter database … set app.practice_timezone` cannot be run on Supabase,
 * where `postgres` owns the database but is not a superuser — see 0008 for the whole story.
 */
export async function getPracticeTimezone(): Promise<string> {
  const { data, error } = await getSupabase().rpc("practice_timezone");
  if (error) throw new Error(error.message);
  return (data as string | null) ?? "UTC";
}

/**
 * Where the practice is, used to pre-fill a published shift's location. Null when nobody has
 * configured one, in which case the form falls back to its own placeholder.
 *
 * A default, not a constraint: `shifts.location` stays free text, because one practice reads
 * in several rooms.
 */
export async function getPracticeDefaultLocation(): Promise<string | null> {
  const { data, error } = await getSupabase().rpc("practice_default_location");
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}
