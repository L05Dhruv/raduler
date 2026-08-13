"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { listMyShifts, releaseShift } from "@/lib/repositories/shifts";
import { getHoursSummary } from "@/lib/repositories/reports";
import {
  formatCents,
  formatMinutes,
  formatTimeRange,
  minutesBetween,
  toDateInput,
} from "@/lib/format";
import type { Shift } from "@/types/db";

export default function MySchedulePage() {
  return (
    <RequireAuth>
      <AppShell>
        <MySchedule />
      </AppShell>
    </RequireAuth>
  );
}

interface AssignmentRow {
  id: string;
  shift_id: string;
  actual_start: string | null;
  actual_end: string | null;
  shifts: Shift;
}

function MySchedule() {
  const { profile } = useAuth();
  const [month, setMonth] = useState(() => new Date());
  const [actionError, setActionError] = useState<string | null>(null);

  const range = useMemo(
    () => ({ start: startOfMonth(month), end: endOfMonth(month) }),
    [month],
  );
  const monthKey = toDateInput(range.start);

  const shiftsQuery = useSWR(
    profile ? ["my-shifts", profile.id, monthKey] : null,
    () => listMyShifts(profile!.id, range.start, addMonths(range.start, 1)),
  );

  // The same function the admin report uses; RLS trims it to this one person.
  const summaryQuery = useSWR(
    profile ? ["my-hours", profile.id, monthKey] : null,
    () => getHoursSummary(range.start, range.end),
  );

  const rows = (shiftsQuery.data ?? []) as unknown as AssignmentRow[];
  const mine = summaryQuery.data?.find((s) => s.profile_id === profile?.id);
  const totals = summaryQuery.data
    ? { minutes: mine?.total_minutes ?? 0, cents: mine?.total_cents ?? 0 }
    : null;
  const loading = shiftsQuery.isLoading;

  const error =
    actionError ??
    (shiftsQuery.error as Error | undefined)?.message ??
    (summaryQuery.error as Error | undefined)?.message ??
    null;

  const release = async (shiftId: string) => {
    setActionError(null);
    try {
      await releaseShift(shiftId);
      await Promise.all([shiftsQuery.mutate(), summaryQuery.mutate()]);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not release that shift.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            className="btn btn-ghost btn-sm btn-square"
            aria-label="Previous month"
            onClick={() => setMonth((m) => subMonths(m, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h1 className="min-w-44 text-center text-xl font-semibold tracking-tight">
            {format(month, "MMMM yyyy")}
          </h1>
          <button
            className="btn btn-ghost btn-sm btn-square"
            aria-label="Next month"
            onClick={() => setMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="alert alert-error">
          <span className="text-sm">{error}</span>
        </div>
      )}

      <div className="stats w-full bg-base-100 shadow-sm">
        <div className="stat">
          <div className="stat-title">Shifts</div>
          <div className="stat-value text-2xl">{rows.length}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Hours</div>
          <div className="stat-value text-2xl">
            {totals ? formatMinutes(totals.minutes) : "—"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Estimated earnings</div>
          <div className="stat-value text-2xl">
            {totals ? formatCents(totals.cents) : "—"}
          </div>
          <div className="stat-desc">Before adjustments; not an invoice.</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-box bg-base-100 shadow-sm">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Shift</th>
              <th>Time</th>
              <th>Location</th>
              <th className="text-right">Duration</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="py-8 text-center">
                  <span className="loading loading-spinner" aria-label="Loading" />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-base-content/60">
                  No shifts claimed this month.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const start = row.actual_start ?? row.shifts.starts_at;
              const end = row.actual_end ?? row.shifts.ends_at;
              const adjusted = Boolean(row.actual_start || row.actual_end);
              return (
                <tr key={row.id}>
                  <td className="whitespace-nowrap">
                    {format(new Date(row.shifts.starts_at), "EEE d MMM")}
                  </td>
                  <td>
                    {row.shifts.title}
                    {adjusted && (
                      <span className="badge badge-ghost badge-xs ml-2">adjusted</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap">{formatTimeRange(start, end)}</td>
                  <td className="text-base-content/70">{row.shifts.location || "—"}</td>
                  <td className="text-right whitespace-nowrap">
                    {formatMinutes(minutesBetween(start, end))}
                  </td>
                  <td className="text-right">
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => void release(row.shift_id)}
                    >
                      Release
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
