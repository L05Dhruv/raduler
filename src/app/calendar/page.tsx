"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { addMonths, format, isSameMonth, isToday, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { listShifts, claimShift, releaseShift } from "@/lib/repositories/shifts";
import { listTimeOff } from "@/lib/repositories/timeOff";
import {
  buildMonthGrid,
  groupShiftsByDay,
  shiftAvailability,
  timeOffOnDay,
  type ShiftAvailability,
} from "@/lib/calendar";
import { formatCents, formatTimeRange, toDateInput } from "@/lib/format";
import type { ShiftWithAssignment } from "@/types/db";

export default function CalendarPage() {
  return (
    <RequireAuth>
      <AppShell>
        <Calendar />
      </AppShell>
    </RequireAuth>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Calendar() {
  const { profile } = useAuth();
  const [month, setMonth] = useState(() => new Date());
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyShiftId, setBusyShiftId] = useState<string | null>(null);
  const [onlyEligible, setOnlyEligible] = useState(true);

  const grid = useMemo(() => buildMonthGrid(month), [month]);
  const monthKey = toDateInput(grid.rangeStart);

  const shiftsQuery = useSWR(["shifts", monthKey], () =>
    listShifts(grid.rangeStart, grid.rangeEnd),
  );
  const timeOffQuery = useSWR(profile ? ["time-off", profile.id] : null, () =>
    listTimeOff(profile!.id),
  );

  const shifts = useMemo(() => shiftsQuery.data ?? [], [shiftsQuery.data]);
  const shiftsByDay = useMemo(() => groupShiftsByDay(shifts), [shifts]);

  const act = async (shiftId: string, action: "claim" | "release") => {
    setBusyShiftId(shiftId);
    setActionError(null);
    try {
      if (action === "claim") await claimShift(shiftId);
      else await releaseShift(shiftId);
      await shiftsQuery.mutate();
    } catch (e) {
      // These messages come from the RPC's own RAISE statements — the database
      // explaining exactly why it refused, which is what the user needs to see.
      setActionError(e instanceof Error ? e.message : "That action did not go through.");
    } finally {
      setBusyShiftId(null);
    }
  };

  const error =
    actionError ??
    (shiftsQuery.error as Error | undefined)?.message ??
    (timeOffQuery.error as Error | undefined)?.message ??
    null;

  const openCount = shifts.filter(
    (s) => shiftAvailability(s, profile?.id ?? null, profile?.role ?? null) === "open",
  ).length;

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
          <button className="btn btn-ghost btn-sm" onClick={() => setMonth(new Date())}>
            Today
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="badge badge-primary badge-outline">
            {openCount} open for you
          </span>
          <label className="label cursor-pointer gap-2 text-sm">
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={onlyEligible}
              onChange={(e) => setOnlyEligible(e.target.checked)}
            />
            My role only
          </label>
          <button
            className="btn btn-ghost btn-sm btn-square"
            aria-label="Refresh"
            onClick={() => void shiftsQuery.mutate()}
          >
            <RefreshCw
              className={`h-4 w-4 ${shiftsQuery.isValidating ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="alert alert-error">
          <span className="text-sm">{error}</span>
        </div>
      )}

      <Legend />

      <div className="overflow-x-auto rounded-box bg-base-100 p-2 shadow-sm">
        <div className="grid min-w-[52rem] grid-cols-7 gap-px">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="bg-base-100 pb-2 text-center text-xs font-medium uppercase tracking-wide text-base-content/60"
            >
              {d}
            </div>
          ))}

          {grid.days.map((day) => {
            const key = toDateInput(day);
            const dayShifts = shiftsByDay.get(key) ?? [];
            const away = timeOffOnDay(day, timeOffQuery.data ?? []);
            const outsideMonth = !isSameMonth(day, month);

            return (
              <div
                key={key}
                className={`day-cell rounded-md border border-base-200 p-1.5 ${
                  outsideMonth ? "bg-base-200/40" : "bg-base-100"
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={`text-xs font-medium ${
                      isToday(day)
                        ? "badge badge-primary badge-sm"
                        : outsideMonth
                          ? "text-base-content/40"
                          : ""
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                  {away.length > 0 && (
                    <span
                      className={`badge badge-xs ${
                        away.some((a) => a.status === "approved")
                          ? "badge-warning"
                          : "badge-ghost"
                      }`}
                      title={away.map((a) => `${a.kind} (${a.status})`).join(", ")}
                    >
                      {away.some((a) => a.status === "approved") ? "Away" : "Pending"}
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  {dayShifts.map((shift) => {
                    const state = shiftAvailability(
                      shift,
                      profile?.id ?? null,
                      profile?.role ?? null,
                    );
                    if (onlyEligible && state === "ineligible") return null;
                    return (
                      <ShiftChip
                        key={shift.id}
                        shift={shift}
                        state={state}
                        busy={busyShiftId === shift.id}
                        onClaim={() => void act(shift.id, "claim")}
                        onRelease={() => void act(shift.id, "release")}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    ["bg-primary/15 border-primary/40", "Open to you"],
    ["bg-success/20 border-success/50", "Yours"],
    ["bg-base-200 border-base-300", "Taken"],
    ["bg-base-100 border-base-300 opacity-60", "Other role"],
  ];
  return (
    <div className="flex flex-wrap gap-4 text-xs text-base-content/70">
      {items.map(([cls, label]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 rounded border ${cls}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

const CHIP_STYLES: Record<ShiftAvailability, string> = {
  open: "bg-primary/15 border-primary/40 hover:bg-primary/25",
  mine: "bg-success/20 border-success/50",
  taken: "bg-base-200 border-base-300 opacity-70",
  ineligible: "bg-base-100 border-base-300 opacity-50",
};

function ShiftChip({
  shift,
  state,
  busy,
  onClaim,
  onRelease,
}: {
  shift: ShiftWithAssignment;
  state: ShiftAvailability;
  busy: boolean;
  onClaim: () => void;
  onRelease: () => void;
}) {
  const interactive = state === "open" || state === "mine";

  return (
    <div className={`rounded border p-1.5 text-left text-[11px] ${CHIP_STYLES[state]}`}>
      <div className="truncate font-medium" title={shift.title}>
        {shift.title}
      </div>
      <div className="text-base-content/70">
        {formatTimeRange(shift.starts_at, shift.ends_at)}
      </div>
      {shift.location && (
        <div className="truncate text-base-content/60" title={shift.location}>
          {shift.location}
        </div>
      )}
      {shift.hourly_rate_cents != null && (
        <div className="text-base-content/60">
          {formatCents(shift.hourly_rate_cents)}/h
        </div>
      )}

      {interactive && (
        <button
          className={`btn btn-xs mt-1 w-full ${state === "open" ? "btn-primary" : "btn-ghost"}`}
          disabled={busy}
          onClick={state === "open" ? onClaim : onRelease}
        >
          {busy ? "…" : state === "open" ? "Claim" : "Release"}
        </button>
      )}
      {state === "taken" && <div className="mt-1 text-base-content/50">Filled</div>}
    </div>
  );
}
