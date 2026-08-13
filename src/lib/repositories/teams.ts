import { getSupabase } from "@/lib/supabase/client";
import type { Profile, Team, UserRole } from "@/types/db";

export interface TeamWithMembers extends Team {
  team_members: { profile_id: string; role_in_team: string }[];
}

export async function listTeams(): Promise<TeamWithMembers[]> {
  const { data, error } = await getSupabase()
    .from("teams")
    .select("*, team_members(profile_id, role_in_team)")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as TeamWithMembers[];
}

export async function createTeam(name: string, description: string): Promise<Team> {
  const { data, error } = await getSupabase()
    .from("teams")
    .insert({ name, description })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Team;
}

export async function deleteTeam(id: string): Promise<void> {
  const { error } = await getSupabase().from("teams").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function addTeamMember(teamId: string, profileId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("team_members")
    .insert({ team_id: teamId, profile_id: profileId });
  if (error) throw new Error(error.message);
}

export async function removeTeamMember(
  teamId: string,
  profileId: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("profile_id", profileId);
  if (error) throw new Error(error.message);
}

/** Admins get everyone; a regular user gets a one-element array of themselves. */
export async function listProfiles(): Promise<Profile[]> {
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("*")
    .order("full_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

/** Role, pay band and active flag are admin-only, so they move through an RPC. */
export async function updateProfileAsAdmin(
  profileId: string,
  role: UserRole,
  hourlyRateCents: number,
  active: boolean,
): Promise<void> {
  const { error } = await getSupabase().rpc("admin_update_profile", {
    p_profile_id: profileId,
    p_role: role,
    p_hourly_rate_cents: hourlyRateCents,
    p_active: active,
  });
  if (error) throw new Error(error.message);
}

/** A user renaming themselves — among the few columns they hold an UPDATE grant on. */
export async function updateOwnProfile(
  profileId: string,
  fields: { full_name: string; modality: string | null },
): Promise<void> {
  const { error } = await getSupabase()
    .from("profiles")
    .update(fields)
    .eq("id", profileId);
  if (error) throw new Error(error.message);
}

/**
 * The person's preferred display zone. Null restores "follow the practice".
 *
 * A trigger validates the name against `pg_timezone_names`, so a typo is refused here
 * rather than quietly rendering every time in the week wrong.
 */
export async function updateOwnTimezone(
  profileId: string,
  timezone: string | null,
): Promise<void> {
  const { error } = await getSupabase()
    .from("profiles")
    .update({ timezone })
    .eq("id", profileId);
  if (error) throw new Error(error.message);
}
