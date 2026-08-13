import { getSupabase } from "@/lib/supabase/client";
import type { HoursSummaryRow } from "@/types/db";
import { toDateInput, toHours } from "@/lib/format";

/**
 * Hours and earnings come straight from `hours_summary()` in Postgres. The function
 * runs with invoker rights, so RLS scopes it automatically: a radiologist sees one
 * row (their own), an admin sees the whole group. No client-side filtering to get
 * wrong.
 */
export async function getHoursSummary(
  start: Date,
  end: Date,
): Promise<HoursSummaryRow[]> {
  const { data, error } = await getSupabase().rpc("hours_summary", {
    p_start: toDateInput(start),
    p_end: toDateInput(end),
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as HoursSummaryRow[];
}

export function summaryToCsv(rows: HoursSummaryRow[]): string {
  const header = ["Name", "Role", "Shifts", "Hours", "Earnings (CAD)"];
  const body = rows.map((r) => [
    r.full_name,
    r.role,
    String(r.shifts_count),
    String(toHours(r.total_minutes)),
    (r.total_cents / 100).toFixed(2),
  ]);
  return [header, ...body]
    .map((cells) => cells.map(escapeCsvCell).join(","))
    .join("\r\n");
}

/**
 * Quotes any cell that could break the file, and neutralises leading =, +, - and @
 * so a name typed into the app cannot become a live formula when the CSV is opened
 * in a spreadsheet.
 */
function escapeCsvCell(value: string): string {
  const injectionRisk = /^[=+\-@\t\r]/.test(value);
  const safe = injectionRisk ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
