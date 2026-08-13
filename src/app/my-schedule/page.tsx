"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from "date-fns";
import { CalendarClock, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { PageTransition } from "@/components/PageTransition";
import { ShiftHoursDialog } from "@/components/ShiftHoursDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/contexts/AuthContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import {
  listMyShifts,
  releaseShift,
  setShiftHours,
  setShiftHoursBulk,
} from "@/lib/repositories/shifts";
import { getHoursSummary } from "@/lib/repositories/reports";
import { resolveHours, type HourWindow } from "@/lib/shiftHours";
import {
  formatTimeRangeInZone,
  timeKeyInZone,
  zoneAbbreviation,
} from "@/lib/timezone";
import {
  formatCents,
  formatMinutes,
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
  const { displayZone, practiceZone, viewingElsewhere } = useTimeZone();
  const { run, toast } = useToast();
  const [month, setMonth] = useState(() => new Date());
  const [editing, setEditing] = useState<AssignmentRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

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

  // Memoised so the `usual` fallback below is not recomputed on every render — the
  // `?? []` would otherwise hand it a fresh array each time.
  const rows = useMemo(
    () => (shiftsQuery.data ?? []) as unknown as AssignmentRow[],
    [shiftsQuery.data],
  );
  const mine = summaryQuery.data?.find((s) => s.profile_id === profile?.id);
  const totals = summaryQuery.data
    ? { minutes: mine?.total_minutes ?? 0, cents: mine?.total_cents ?? 0 }
    : null;
  const loading = shiftsQuery.isLoading;

  /**
   * Seeds the bulk dialog. A window already chosen this month is the best guess at
   * someone's usual hours; failing that, the first shift's published times, so the
   * dialog opens on something plausible rather than an arbitrary 09:00.
   */
  const usual = useMemo(() => {
    const chosen = rows.find((r) => r.actual_start && r.actual_end);
    if (chosen) {
      return {
        start: timeKeyInZone(new Date(chosen.actual_start!), displayZone),
        end: timeKeyInZone(new Date(chosen.actual_end!), displayZone),
      };
    }
    if (rows[0]) {
      return {
        start: timeKeyInZone(new Date(rows[0].shifts.starts_at), displayZone),
        end: timeKeyInZone(new Date(rows[0].shifts.ends_at), displayZone),
      };
    }
    return { start: "08:00", end: "16:00" };
  }, [rows, displayZone]);

  /** Both the roster and the hours total move whenever an assignment changes. */
  const refresh = () => Promise.all([shiftsQuery.mutate(), summaryQuery.mutate()]);

  const release = async (row: AssignmentRow) => {
    const ok = await run(
      () => releaseShift(row.shift_id),
      `Released ${row.shifts.title}.`,
    );
    if (ok) await refresh();
  };

  /**
   * The dialog handlers return a reason instead of toasting it: a refused window is
   * something to correct in the form that is still open, not a notice to acknowledge
   * after it has closed. Successes toast and close, as everywhere else.
   */
  const saveHours = async (row: AssignmentRow, startTime: string, endTime: string) => {
    // Resolved in the zone the person is reading, which is what they typed against.
    const resolved = resolveHours(
      row.shifts.starts_at,
      row.shifts.ends_at,
      startTime,
      endTime,
      displayZone,
    );
    if (!resolved.ok) return resolved.reason;

    try {
      await setShiftHours(row.shift_id, resolved.window);
    } catch (e) {
      return e instanceof Error ? e.message : "That did not go through.";
    }
    await refresh();
    toast(
      "success",
      `${row.shifts.title} set to ${formatTimeRangeInZone(
        resolved.window.start.toISOString(),
        resolved.window.end.toISOString(),
        displayZone,
      )} ${zoneAbbreviation(displayZone)}.`,
    );
    return null;
  };

  const resetHours = async (row: AssignmentRow) => {
    try {
      await setShiftHours(row.shift_id, null);
    } catch (e) {
      return e instanceof Error ? e.message : "That did not go through.";
    }
    await refresh();
    toast("success", `${row.shifts.title} is back to its published hours.`);
    return null;
  };

  /**
   * "I do 12-7 most of the days" — one window across every shift held this month.
   * Shifts the window cannot fit are counted and skipped rather than failing the batch,
   * and the database skips any day already carried onto an invoice.
   */
  const applyToMonth = async (startTime: string, endTime: string) => {
    const entries: { shiftId: string; window: HourWindow }[] = [];
    let unfitted = 0;

    for (const row of rows) {
      const resolved = resolveHours(
        row.shifts.starts_at,
        row.shifts.ends_at,
        startTime,
        endTime,
        displayZone,
      );
      if (resolved.ok) entries.push({ shiftId: row.shift_id, window: resolved.window });
      else unfitted += 1;
    }

    if (entries.length === 0) {
      return "Those hours do not fit any shift you hold this month.";
    }

    let results;
    try {
      results = await setShiftHoursBulk(entries);
    } catch (e) {
      return e instanceof Error ? e.message : "That did not go through.";
    }
    await refresh();

    const applied = results.filter((r) => r.applied).length;
    const refused = results.filter((r) => !r.applied);

    // Nothing changed at all: keep the dialog open and say why, rather than closing on
    // a success-shaped toast that reports zero.
    if (applied === 0) {
      return refused[0]?.reason ?? "None of those shifts could be changed.";
    }

    toast("success", `Applied to ${applied} shift${applied === 1 ? "" : "s"}.`);
    const untouched = refused.length + unfitted;
    if (untouched > 0) {
      toast(
        "info",
        `${untouched} left unchanged — ${
          refused[0]?.reason ?? "the window does not fit the published hours"
        }`,
      );
    }
    return null;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
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

        <div className="flex items-center gap-2">
          <span
            className={`rounded-field px-2 py-1 text-xs ${
              viewingElsewhere ? "bg-warning/15 text-warning" : "text-base-content/55"
            }`}
            title={
              viewingElsewhere && practiceZone
                ? `Times shown in ${displayZone}. The practice publishes in ${practiceZone}.`
                : `Times shown in ${displayZone}`
            }
          >
            times in {zoneAbbreviation(displayZone)}
          </span>
          {rows.length > 0 && (
          <button className="btn btn-sm lift gap-1.5" onClick={() => setBulkOpen(true)}>
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            Set my usual hours
          </button>
          )}
        </div>
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
                            title={`Published ${formatTimeRangeInZone(
                              row.shifts.starts_at,
                              row.shifts.ends_at,
                              displayZone,
                            )}`}
                          >
                            adjusted
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap tabular-nums text-base-content/70">
                        {formatTimeRangeInZone(start, end, displayZone)}
                      </td>
                      <td className="text-base-content/60">
                        {row.shifts.location || "—"}
                      </td>
                      <td className="whitespace-nowrap text-right tabular-nums">
                        {formatMinutes(minutesBetween(start, end))}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <button
                          className="btn btn-ghost btn-xs gap-1 opacity-60 transition-opacity hover:opacity-100"
                          onClick={() => setEditing(row)}
                        >
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          Hours
                        </button>
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

      {editing && (
        <ShiftHoursDialog
          title="Your hours"
          description={
            <>
              {editing.shifts.title} is published{" "}
              <span className="tabular-nums text-base-content">
                {formatTimeRangeInZone(
                  editing.shifts.starts_at,
                  editing.shifts.ends_at,
                  displayZone,
                )}{" "}
              {zoneAbbreviation(displayZone)}
              </span>
              . Choose the hours you are actually working — anything inside that window.
              {viewingElsewhere && practiceZone && (
                <>
                  {" "}
                  That is{" "}
                  <span className="tabular-nums text-base-content">
                    {formatTimeRangeInZone(
                      editing.shifts.starts_at,
                      editing.shifts.ends_at,
                      practiceZone,
                    )}
                  </span>{" "}
                  {zoneAbbreviation(practiceZone)} at the practice, and your times are
                  read as {zoneAbbreviation(displayZone)}.
                </>
              )}
            </>
          }
          initialStart={timeKeyInZone(
            new Date(editing.actual_start ?? editing.shifts.starts_at),
            displayZone,
          )}
          initialEnd={timeKeyInZone(
            new Date(editing.actual_end ?? editing.shifts.ends_at),
            displayZone,
          )}
          submitLabel="Save hours"
          resetLabel={
            editing.actual_start || editing.actual_end ? "Published hours" : undefined
          }
          onSubmit={(startTime, endTime) => saveHours(editing, startTime, endTime)}
          onReset={
            editing.actual_start || editing.actual_end
              ? () => resetHours(editing)
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      )}

      {bulkOpen && (
        <ShiftHoursDialog
          title="Your usual hours"
          description={`Applied to all ${rows.length} shift${
            rows.length === 1 ? "" : "s"
          } you hold in ${format(month, "MMMM")}. Shifts these hours do not fit, and days already invoiced, are left as they are.`}
          initialStart={usual.start}
          initialEnd={usual.end}
          submitLabel="Apply to month"
          onSubmit={applyToMonth}
          onClose={() => setBulkOpen(false)}
        />
      )}
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
