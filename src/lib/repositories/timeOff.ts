import { getSupabase } from "@/lib/supabase/client";
import type { TimeOff, TimeOffKind } from "@/types/db";

/** RLS narrows this to the caller's own rows unless they are an admin. */
export async function listTimeOff(profileId?: string): Promise<TimeOff[]> {
  let query = getSupabase().from("time_off").select("*").order("starts_on", {
    ascending: false,
  });
  if (profileId) query = query.eq("profile_id", profileId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as TimeOff[];
}

export async function listPendingTimeOff(): Promise<
  (TimeOff & { profiles: { full_name: string; email: string } | null })[]
> {
  const { data, error } = await getSupabase()
    .from("time_off")
    .select("*, profiles(full_name, email)")
    .eq("status", "requested")
    .order("starts_on");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export interface NewTimeOff {
  starts_on: string;
  ends_on: string;
  kind: TimeOffKind;
  note: string;
}

export async function requestTimeOff(
  profileId: string,
  input: NewTimeOff,
): Promise<TimeOff> {
  // `status` is omitted deliberately: the insert policy only accepts 'requested', so
  // the default is the sole value that can get through.
  const { data, error } = await getSupabase()
    .from("time_off")
    .insert({ ...input, profile_id: profileId })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as TimeOff;
}

export async function withdrawTimeOff(id: string): Promise<void> {
  const { error } = await getSupabase().from("time_off").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function decideTimeOff(id: string, approve: boolean): Promise<void> {
  const { error } = await getSupabase().rpc("decide_time_off", {
    p_id: id,
    p_approve: approve,
  });
  if (error) throw new Error(error.message);
}
