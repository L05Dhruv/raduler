"use client";

import { useState } from "react";
import useSWR from "swr";
import { Plus, Trash2, UserMinus } from "lucide-react";
import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { AppShell } from "@/components/AppShell";
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  listProfiles,
  listTeams,
  removeTeamMember,
  updateProfileAsAdmin,
} from "@/lib/repositories/teams";
import { formatCents } from "@/lib/format";
import { USER_ROLES, type Profile, type UserRole } from "@/types/db";

export default function AdminTeamsPage() {
  return (
    <RequireAdmin>
      <AppShell>
        <AdminTeams />
      </AppShell>
    </RequireAdmin>
  );
}

function AdminTeams() {
  const teamsQuery = useSWR("teams", listTeams);
  const peopleQuery = useSWR("profiles", listProfiles);
  const [error, setError] = useState<string | null>(null);
  const [newTeam, setNewTeam] = useState({ name: "", description: "" });

  const people = peopleQuery.data ?? [];
  const byId = new Map(people.map((p) => [p.id, p]));

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await Promise.all([teamsQuery.mutate(), peopleQuery.mutate()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That change did not go through.");
    }
  };

  return (
    <div className="space-y-8">
      {error && (
        <div role="alert" className="alert alert-error">
          <span className="text-sm">{error}</span>
        </div>
      )}

      <section className="space-y-3">
        <h1 className="text-xl font-semibold tracking-tight">Teams</h1>

        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newTeam.name.trim()) return;
            void run(async () => {
              await createTeam(newTeam.name.trim(), newTeam.description.trim());
              setNewTeam({ name: "", description: "" });
            });
          }}
        >
          <input
            className="input input-bordered input-sm w-56"
            placeholder="Team name"
            aria-label="Team name"
            value={newTeam.name}
            onChange={(e) => setNewTeam((t) => ({ ...t, name: e.target.value }))}
          />
          <input
            className="input input-bordered input-sm w-80"
            placeholder="Description"
            aria-label="Team description"
            value={newTeam.description}
            onChange={(e) => setNewTeam((t) => ({ ...t, description: e.target.value }))}
          />
          <button type="submit" className="btn btn-primary btn-sm gap-1">
            <Plus className="h-4 w-4" />
            Add team
          </button>
        </form>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(teamsQuery.data ?? []).map((team) => {
            const memberIds = new Set(team.team_members.map((m) => m.profile_id));
            const candidates = people.filter((p) => !memberIds.has(p.id));
            return (
              <div key={team.id} className="card bg-base-100 shadow-sm">
                <div className="card-body gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="card-title text-base">{team.name}</h2>
                      <p className="text-sm text-base-content/70">
                        {team.description || "No description"}
                      </p>
                    </div>
                    <button
                      className="btn btn-ghost btn-xs"
                      aria-label={`Delete ${team.name}`}
                      onClick={() => void run(() => deleteTeam(team.id))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <ul className="space-y-1">
                    {team.team_members.length === 0 && (
                      <li className="text-sm text-base-content/50">No members yet</li>
                    )}
                    {team.team_members.map((m) => (
                      <li
                        key={m.profile_id}
                        className="flex items-center justify-between rounded bg-base-200 px-2 py-1 text-sm"
                      >
                        <span>
                          {byId.get(m.profile_id)?.full_name ?? "Unknown"}
                          <span className="ml-2 text-xs text-base-content/60">
                            {byId.get(m.profile_id)?.role}
                          </span>
                        </span>
                        <button
                          className="btn btn-ghost btn-xs"
                          aria-label="Remove from team"
                          onClick={() =>
                            void run(() => removeTeamMember(team.id, m.profile_id))
                          }
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>

                  <select
                    className="select select-bordered select-sm"
                    aria-label={`Add a member to ${team.name}`}
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      void run(() => addTeamMember(team.id, e.target.value));
                    }}
                  >
                    <option value="">Add a member…</option>
                    {candidates.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || p.email} ({p.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">People</h2>
        <p className="text-sm text-base-content/70">
          Role and rate changes go through an admin-only database function, which
          records who made them in the audit log. Nobody can edit their own.
        </p>
        <div className="overflow-x-auto rounded-box bg-base-100 shadow-sm">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Rate</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  onSave={(role, cents, active) =>
                    run(() => updateProfileAsAdmin(person.id, role, cents, active))
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function PersonRow({
  person,
  onSave,
}: {
  person: Profile;
  onSave: (role: UserRole, hourlyRateCents: number, active: boolean) => Promise<void>;
}) {
  const [rate, setRate] = useState((person.hourly_rate_cents / 100).toFixed(2));
  const dirty = Math.round(Number(rate) * 100) !== person.hourly_rate_cents;

  return (
    <tr>
      <td>{person.full_name || "—"}</td>
      <td className="text-base-content/70">{person.email}</td>
      <td>
        <select
          className="select select-bordered select-xs"
          aria-label={`Role for ${person.full_name || person.email}`}
          value={person.role}
          onChange={(e) =>
            void onSave(e.target.value as UserRole, person.hourly_rate_cents, person.active)
          }
        >
          {USER_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </td>
      <td className="whitespace-nowrap">
        <div className="flex items-center gap-1">
          <input
            type="number"
            step="0.01"
            className="input input-bordered input-xs w-24"
            aria-label={`Hourly rate for ${person.full_name || person.email}`}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          {dirty ? (
            <button
              className="btn btn-primary btn-xs"
              onClick={() =>
                void onSave(person.role, Math.round(Number(rate) * 100), person.active)
              }
            >
              Save
            </button>
          ) : (
            <span className="text-xs text-base-content/50">
              {formatCents(person.hourly_rate_cents)}/h
            </span>
          )}
        </div>
      </td>
      <td>
        <label className="label cursor-pointer justify-start gap-2">
          <input
            type="checkbox"
            className="toggle toggle-xs"
            checked={person.active}
            aria-label={`Active status for ${person.full_name || person.email}`}
            onChange={(e) =>
              void onSave(person.role, person.hourly_rate_cents, e.target.checked)
            }
          />
          <span className="text-xs">{person.active ? "active" : "disabled"}</span>
        </label>
      </td>
    </tr>
  );
}
