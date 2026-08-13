import { getSupabase } from "@/lib/supabase/client";

/**
 * The practice's time zone, as the database understands it.
 *
 * Read rather than configured in the bundle on purpose. The same value anchors every
 * reporting period inside `hours_summary()` and `create_invoice()`, and two sources for
 * one fact drift — here the drift would be silent and financial, with the browser
 * labelling a roster in one zone while invoices were totalled in another.
 *
 * It comes from a database setting, so an operator changes it without a deploy:
 *   alter database postgres set app.practice_timezone = 'America/Toronto';
 */
export async function getPracticeTimezone(): Promise<string> {
  const { data, error } = await getSupabase().rpc("practice_timezone");
  if (error) throw new Error(error.message);
  return (data as string | null) ?? "UTC";
}
