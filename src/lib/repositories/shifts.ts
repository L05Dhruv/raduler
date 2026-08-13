import { getSupabase } from "@/lib/supabase/client";
import type { HourWindow } from "@/lib/shiftHours";
import type { Shift, ShiftWithAssignment, UserRole } from "@/types/db";

/**
 * Every Supabase call lives in a repository module; components import these, never the
 * client. That keeps the query surface small enough to audit, and leaves one place to
 * change when the backend moves.
 */

/** Shifts overlapping a window, with any confirmed assignment embedded. */
export async function listShifts(from: Date, to: Date): Promise<ShiftWithAssignment[]> {
  const { data, error } = await getSupabase()
    .from("shifts")
    .select("*, shift_assignments(id, profile_id, status, actual_start, actual_end)")
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .neq("status", "cancelled")
    .order("starts_at");

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    ...(row as ShiftWithAssignment),
    shift_assignments: (row.shift_assignments ?? []).filter(
      (a: { status: string }) => a.status === "confirmed",
    ),
  }));
}

/** Confirmed shifts for one person, newest first. */
export async function listMyShifts(profileId: string, from?: Date, to?: Date) {
  let query = getSupabase()
    .from("shift_assignments")
    .select("*, shifts(*)")
    .eq("profile_id", profileId)
    .eq("status", "confirmed");

  if (from) query = query.gte("shifts.starts_at", from.toISOString());
  if (to) query = query.lt("shifts.starts_at", to.toISOString());

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((row) => row.shifts)
    .sort(
      (a, b) =>
        new Date(a.shifts.starts_at).getTime() - new Date(b.shifts.starts_at).getTime(),
    );
}

/**
 * Claiming goes through the RPC, never a direct insert — the overlap, role and
 * time-off checks all live inside it, under a row lock.
 */
export async function claimShift(shiftId: string): Promise<void> {
  const { error } = await getSupabase().rpc("claim_shift", { p_shift_id: shiftId });
  if (error) throw new Error(error.message);
}

export async function releaseShift(shiftId: string): Promise<void> {
  const { error } = await getSupabase().rpc("release_shift", { p_shift_id: shiftId });
  if (error) throw new Error(error.message);
}

/**
 * Sets the hours actually worked on a shift, within the published window. `null`
 * restores the published hours.
 *
 * The RPC re-checks the window, the invoice freeze and the overlap rule; the caller
 * validating first with `resolveHours()` is a courtesy, not the control.
 */
export async function setShiftHours(
  shiftId: string,
  window: HourWindow | null,
): Promise<void> {
  const { error } = await getSupabase().rpc("set_shift_hours", {
    p_shift_id: shiftId,
    p_start: window ? window.start.toISOString() : null,
    p_end: window ? window.end.toISOString() : null,
  });
  if (error) throw new Error(error.message);
}

/** One row per shift submitted — a refusal names the rule that stopped it. */
export interface BulkHoursResult {
  shift_id: string;
  applied: boolean;
  reason: string | null;
}

/**
 * Applies one window to many shifts — "I work 12-7 most days".
 *
 * Timestamps are built by the caller because only the browser knows the user's time
 * zone. Shifts are reported individually rather than all-or-nothing, so an already
 * invoiced day does not discard the rest of the month.
 */
export async function setShiftHoursBulk(
  entries: { shiftId: string; window: HourWindow }[],
): Promise<BulkHoursResult[]> {
  const { data, error } = await getSupabase().rpc("set_shift_hours_bulk", {
    p_entries: entries.map((e) => ({
      shift_id: e.shiftId,
      start: e.window.start.toISOString(),
      end: e.window.end.toISOString(),
    })),
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as BulkHoursResult[];
}

export interface NewShift {
  title: string;
  location: string;
  modality: string | null;
  team_id: string | null;
  required_role: UserRole;
  notes: string;
  starts_at: string;
  ends_at: string;
}

export async function createShifts(shifts: NewShift[]): Promise<Shift[]> {
  const { data, error } = await getSupabase().from("shifts").insert(shifts).select();
  if (error) throw new Error(error.message);
  return (data ?? []) as Shift[];
}

export async function cancelShift(shiftId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("shifts")
    .update({ status: "cancelled" })
    .eq("id", shiftId);
  if (error) throw new Error(error.message);
}

export async function deleteShift(shiftId: string): Promise<void> {
  const { error } = await getSupabase().from("shifts").delete().eq("id", shiftId);
  if (error) throw new Error(error.message);
}
