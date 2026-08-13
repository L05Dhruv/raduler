import { getSupabase } from "@/lib/supabase/client";
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
    .select("*, shift_assignments(id, profile_id, status)")
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

export interface NewShift {
  title: string;
  location: string;
  modality: string | null;
  team_id: string | null;
  required_role: UserRole;
  hourly_rate_cents: number | null;
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
