"use client";

import { useState } from "react";
import useSWR from "swr";
import { differenceInCalendarDays, format } from "date-fns";
import { Check, Inbox, X } from "lucide-react";
import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { AppShell } from "@/components/AppShell";
import { PageTransition } from "@/components/PageTransition";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { decideTimeOff, listPendingTimeOff } from "@/lib/repositories/timeOff";
import { fromDateInput } from "@/lib/format";

export default function AdminTimeOffPage() {
  return (
    <RequireAdmin>
      <AppShell>
        <PageTransition>
          <TimeOffQueue />
        </PageTransition>
      </AppShell>
    </RequireAdmin>
  );
}

function TimeOffQueue() {
  const query = useSWR("pending-time-off", listPendingTimeOff);
  const { run } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const decide = async (id: string, name: string, approve: boolean) => {
    setBusyId(id);
    const ok = await run(
      () => decideTimeOff(id, approve),
      `${approve ? "Approved" : "Denied"} time off for ${name}.`,
    );
    setBusyId(null);
    if (ok) await query.mutate();
  };

  const rows = query.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">
          Time-off requests
          {rows.length > 0 && (
            <span className="badge badge-primary badge-sm ml-2 align-middle">
              {rows.length}
            </span>
          )}
        </h1>
        <p className="mt-1 text-sm text-base-content/60">
          Approving blocks those dates: the person can no longer claim a shift that
          overlaps them, and the calendar marks them away.
        </p>
      </div>

      <div className="surface overflow-hidden">
        {query.isLoading ? (
          <SkeletonRows rows={3} cols={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Nothing waiting on you"
            hint="New requests appear here as soon as they're submitted."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr className="border-base-300/60">
                  <th>Person</th>
                  <th>Dates</th>
                  <th>Length</th>
                  <th>Reason</th>
                  <th>Note</th>
                  <th className="text-right">Decision</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const name =
                    row.profiles?.full_name || row.profiles?.email || "Unknown";
                  const days =
                    differenceInCalendarDays(
                      fromDateInput(row.ends_on),
                      fromDateInput(row.starts_on),
                    ) + 1;
                  return (
                    <tr
                      key={row.id}
                      className="border-base-300/40 transition-colors hover:bg-base-300/25"
                    >
                      <td className="font-medium">{name}</td>
                      <td className="whitespace-nowrap">
                        {format(fromDateInput(row.starts_on), "d MMM")} –{" "}
                        {format(fromDateInput(row.ends_on), "d MMM yyyy")}
                      </td>
                      <td className="whitespace-nowrap tabular-nums text-base-content/60">
                        {days} day{days === 1 ? "" : "s"}
                      </td>
                      <td className="capitalize text-base-content/70">{row.kind}</td>
                      <td className="max-w-sm truncate text-base-content/55">
                        {row.note || "—"}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          <button
                            className="btn btn-success btn-xs gap-1"
                            disabled={busyId === row.id}
                            onClick={() => void decide(row.id, name, true)}
                          >
                            <Check className="h-3.5 w-3.5" />
                            Approve
                          </button>
                          <button
                            className="btn btn-ghost btn-xs gap-1"
                            disabled={busyId === row.id}
                            onClick={() => void decide(row.id, name, false)}
                          >
                            <X className="h-3.5 w-3.5" />
                            Deny
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
