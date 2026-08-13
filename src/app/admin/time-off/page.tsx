"use client";

import { useState } from "react";
import useSWR from "swr";
import { format } from "date-fns";
import { Check, X } from "lucide-react";
import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { AppShell } from "@/components/AppShell";
import { decideTimeOff, listPendingTimeOff } from "@/lib/repositories/timeOff";
import { fromDateInput } from "@/lib/format";

export default function AdminTimeOffPage() {
  return (
    <RequireAdmin>
      <AppShell>
        <TimeOffQueue />
      </AppShell>
    </RequireAdmin>
  );
}

function TimeOffQueue() {
  const query = useSWR("pending-time-off", listPendingTimeOff);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const decide = async (id: string, approve: boolean) => {
    setBusyId(id);
    setError(null);
    try {
      await decideTimeOff(id, approve);
      await query.mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record that decision.");
    } finally {
      setBusyId(null);
    }
  };

  const rows = query.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Time-off requests</h1>
        <p className="text-sm text-base-content/70">
          Approving a request blocks those dates: the person can no longer claim a shift
          that overlaps them, and the calendar marks them away.
        </p>
      </div>

      {error && (
        <div role="alert" className="alert alert-error">
          <span className="text-sm">{error}</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-box bg-base-100 shadow-sm">
        <table className="table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Dates</th>
              <th>Reason</th>
              <th>Note</th>
              <th className="text-right">Decision</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr>
                <td colSpan={5} className="py-8 text-center">
                  <span className="loading loading-spinner" aria-label="Loading" />
                </td>
              </tr>
            )}
            {!query.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-base-content/60">
                  Nothing waiting on you.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.profiles?.full_name || row.profiles?.email || "Unknown"}
                </td>
                <td className="whitespace-nowrap">
                  {format(fromDateInput(row.starts_on), "d MMM yyyy")} –{" "}
                  {format(fromDateInput(row.ends_on), "d MMM yyyy")}
                </td>
                <td className="capitalize">{row.kind}</td>
                <td className="max-w-sm truncate text-base-content/70">
                  {row.note || "—"}
                </td>
                <td>
                  <div className="flex justify-end gap-1">
                    <button
                      className="btn btn-success btn-xs gap-1"
                      disabled={busyId === row.id}
                      onClick={() => void decide(row.id, true)}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Approve
                    </button>
                    <button
                      className="btn btn-ghost btn-xs gap-1"
                      disabled={busyId === row.id}
                      onClick={() => void decide(row.id, false)}
                    >
                      <X className="h-3.5 w-3.5" />
                      Deny
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
