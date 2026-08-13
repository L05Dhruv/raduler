"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from "date-fns";
import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { PageTransition } from "@/components/PageTransition";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
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
        <PageTransition>
          <MySchedule />
        </PageTransition>
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
  const { run } = useToast();
  const [month, setMonth] = useState(() => new Date());

  const range = useMemo(
    () => ({ start: startOfMonth(month), end: endOfMonth(month) }),
    [month],
  );
  const monthKey = toDateInput(range.start);

  const shiftsQuery = useSWR(profile ? ["my-shifts", profile.id, monthKey] : null, () =>
    listMyShifts(profile!.id, range.start, addMonths(range.start, 1)),
  );

  // The same function the admin report uses; RLS trims it to this one person.
  const summaryQuery = useSWR(profile ? ["my-hours", profile.id, monthKey] : null, () =>
    getHoursSummary(range.start, range.end),
  );

  const rows = (shiftsQuery.data ?? []) as unknown as AssignmentRow[];
  const mine = summaryQuery.data?.find((s) => s.profile_id === profile?.id);
  const totals = summaryQuery.data
    ? { minutes: mine?.total_minutes ?? 0, cents: mine?.total_cents ?? 0 }
    : null;
  const loading = shiftsQuery.isLoading;

  const release = async (row: AssignmentRow) => {
    const ok = await run(
      () => releaseShift(row.shift_id),
      `Released ${row.shifts.title}.`,
    );
    if (ok) await Promise.all([shiftsQuery.mutate(), summaryQuery.mutate()]);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1">
        <button
          className="btn btn-ghost btn-sm btn-square"
          aria-label="Previous month"
          onClick={() => setMonth((m) => subMonths(m, 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-40 text-center text-lg font-semibold tracking-tight">
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

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Shifts" value={loading ? null : String(rows.length)} />
        <StatCard
          label="Hours"
          value={totals ? formatMinutes(totals.minutes) : null}
        />
        <StatCard
          label="Estimated earnings"
          value={totals ? formatCents(totals.cents) : null}
          hint="Before adjustments; not an invoice."
        />
      </div>

      <div className="surface overflow-hidden">
        {loading ? (
          <SkeletonRows rows={5} cols={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Nothing claimed this month"
            hint="Open shifts matching your role appear on the calendar. Claiming one puts it here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr className="border-base-300/60">
                  <th>Date</th>
                  <th>Shift</th>
                  <th>Time</th>
                  <th>Location</th>
                  <th className="text-right">Duration</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const start = row.actual_start ?? row.shifts.starts_at;
                  const end = row.actual_end ?? row.shifts.ends_at;
                  const adjusted = Boolean(row.actual_start || row.actual_end);
                  return (
                    <tr
                      key={row.id}
                      className="border-base-300/40 transition-colors hover:bg-base-300/25"
                    >
                      <td className="whitespace-nowrap font-medium">
                        {format(new Date(row.shifts.starts_at), "EEE d MMM")}
                      </td>
                      <td>
                        {row.shifts.title}
                        {adjusted && (
                          <span
                            className="badge badge-ghost badge-xs ml-2"
                            title="An administrator recorded different worked times"
                          >
                            adjusted
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap tabular-nums text-base-content/70">
                        {formatTimeRange(start, end)}
                      </td>
                      <td className="text-base-content/60">
                        {row.shifts.location || "—"}
                      </td>
                      <td className="whitespace-nowrap text-right tabular-nums">
                        {formatMinutes(minutesBetween(start, end))}
                      </td>
                      <td className="text-right">
                        <button
                          className="btn btn-ghost btn-xs opacity-60 transition-opacity hover:opacity-100"
                          onClick={() => void release(row)}
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
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | null;
  hint?: string;
}) {
  return (
    <div className="surface p-4">
      <p className="text-sm text-base-content/60">{label}</p>
      {value === null ? (
        <div className="shimmer mt-1.5 h-7 w-24 rounded-field bg-base-300/40" />
      ) : (
        <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight">
          {value}
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-base-content/45">{hint}</p>}
    </div>
  );
}
