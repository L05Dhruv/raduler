"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { addMonths, format, isSameMonth, subMonths } from "date-fns";
import { CalendarX2, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { PageTransition, Reveal } from "@/components/PageTransition";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCalendar } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/contexts/AuthContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { listShifts, claimShift, releaseShift } from "@/lib/repositories/shifts";
import { listTimeOff } from "@/lib/repositories/timeOff";
import {
  buildMonthGrid,
  groupShiftsByDay,
  shiftAvailability,
  timeOffOnDay,
  type ShiftAvailability,
} from "@/lib/calendar";
import { formatCents, toDateInput } from "@/lib/format";
import {
  formatTimeRangeInZone,
  todayKeyInZone,
  zoneAbbreviation,
} from "@/lib/timezone";
import type { ShiftWithAssignment } from "@/types/db";

export default function CalendarPage() {
  return (
    <RequireAuth>
      <AppShell>
        <PageTransition>
          <Calendar />
        </PageTransition>
      </AppShell>
    </RequireAuth>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Calendar() {
  const { profile } = useAuth();
  const { displayZone, practiceZone, viewingElsewhere } = useTimeZone();
  const { run } = useToast();
  const [month, setMonth] = useState(() => new Date());
  const [busyShiftId, setBusyShiftId] = useState<string | null>(null);
  const [justClaimedId, setJustClaimedId] = useState<string | null>(null);
  const [onlyEligible, setOnlyEligible] = useState(true);

  // The zone decides both the query bounds and which square a shift lands in, so it is
  // part of the grid and part of the cache key. Switching zones re-buckets rather than
  // showing yesterday's arrangement with today's labels.
  const grid = useMemo(() => buildMonthGrid(month, displayZone), [month, displayZone]);
  const monthKey = toDateInput(grid.days[0]);

  const shiftsQuery = useSWR(["shifts", monthKey, displayZone], () =>
    listShifts(grid.rangeStart, grid.rangeEnd),
  );
  const timeOffQuery = useSWR(profile ? ["time-off", profile.id] : null, () =>
    listTimeOff(profile!.id),
  );

  const shifts = useMemo(() => shiftsQuery.data ?? [], [shiftsQuery.data]);
  const shiftsByDay = useMemo(
    () => groupShiftsByDay(shifts, displayZone),
    [shifts, displayZone],
  );
  const todayKey = todayKeyInZone(displayZone);

  const act = async (shift: ShiftWithAssignment, action: "claim" | "release") => {
    setBusyShiftId(shift.id);
    const ok = await run(
      () => (action === "claim" ? claimShift(shift.id) : releaseShift(shift.id)),
      action === "claim"
        ? `Claimed ${shift.title} on ${format(new Date(shift.starts_at), "d MMM")}.`
        : `Released ${shift.title}.`,
    );
    setBusyShiftId(null);
    if (ok) {
      if (action === "claim") {
        setJustClaimedId(shift.id);
        window.setTimeout(() => setJustClaimedId(null), 700);
      }
      await shiftsQuery.mutate();
    }
  };

  const openCount = shifts.filter(
    (s) => shiftAvailability(s, profile?.id ?? null, profile?.role ?? null) === "open",
  ).length;
  const mineCount = shifts.filter(
    (s) => shiftAvailability(s, profile?.id ?? null, profile?.role ?? null) === "mine",
  ).length;

  const loading = shiftsQuery.isLoading;

  return (
    <div className="space-y-4">
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
          <button
            className="btn btn-ghost btn-sm ml-1"
            onClick={() => setMonth(new Date())}
          >
            Today
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Which clock these times are on. Always stated, because a roster with
              unlabelled times is only unambiguous until somebody travels. */}
          <span
            className={`rounded-field px-2 py-1 text-xs ${
              viewingElsewhere
                ? "bg-warning/15 text-warning"
                : "text-base-content/55"
            }`}
            title={
              viewingElsewhere && practiceZone
                ? `Times shown in ${displayZone}. The practice publishes in ${practiceZone}.`
                : `Times shown in ${displayZone}`
            }
          >
            times in {zoneAbbreviation(displayZone)}
          </span>
          <Stat label="open to you" value={openCount} tone="primary" />
          <Stat label="yours" value={mineCount} tone="success" />
          <label className="flex cursor-pointer items-center gap-2 rounded-field px-2 py-1 text-sm text-base-content/70 transition-colors hover:bg-base-300/40">
            <input
              type="checkbox"
              className="toggle toggle-xs"
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
              className={`h-4 w-4 transition-transform ${
                shiftsQuery.isValidating ? "animate-spin" : ""
              }`}
            />
          </button>
        </div>
      </div>

      <Legend />

      <div className="surface overflow-x-auto p-2">
        {loading ? (
          <Reveal mode="out">
            <div className="min-w-[52rem]">
              <SkeletonCalendar />
            </div>
          </Reveal>
        ) : shifts.length === 0 ? (
          <EmptyState
            icon={CalendarX2}
            title="No shifts published this month"
            hint="An administrator publishes the roster from Admin → Shifts. Check a neighbouring month, or ask them to open this one."
          />
        ) : (
          <Reveal mode="in">
            <div className="grid min-w-[52rem] grid-cols-7 gap-px">
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  className="pb-2 text-center text-[11px] font-medium uppercase tracking-wider text-base-content/45"
                >
                  {d}
                </div>
              ))}

              {grid.days.map((day) => {
                const key = toDateInput(day);
                const dayShifts = shiftsByDay.get(key) ?? [];
                const away = timeOffOnDay(day, timeOffQuery.data ?? []);
                const outsideMonth = !isSameMonth(day, month);
                const approvedAway = away.some((a) => a.status === "approved");
                // "Today" is a question about a calendar, so it has to be asked in the
                // zone the calendar is drawn in.
                const today = key === todayKey;

                return (
                  <div
                    key={key}
                    className={`day-cell rounded-field border p-1.5 transition-colors ${
                      outsideMonth
                        ? "border-transparent bg-base-200/40"
                        : "border-base-300/40 bg-base-100"
                    } ${today ? "ring-1 ring-primary/50" : ""} ${
                      approvedAway ? "bg-warning/5" : ""
                    }`}
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <span
                        className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-xs font-medium ${
                          today
                            ? "bg-primary text-primary-content"
                            : outsideMonth
                              ? "text-base-content/30"
                              : "text-base-content/70"
                        }`}
                      >
                        {format(day, "d")}
                      </span>
                      {away.length > 0 && (
                        <span
                          className={`badge badge-xs ${
                            approvedAway ? "badge-warning" : "badge-ghost"
                          }`}
                          title={away.map((a) => `${a.kind} (${a.status})`).join(", ")}
                        >
                          {approvedAway ? "Away" : "Pending"}
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
                            zone={displayZone}
                            busy={busyShiftId === shift.id}
                            justClaimed={justClaimedId === shift.id}
                            onClaim={() => void act(shift, "claim")}
                            onRelease={() => void act(shift, "release")}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Reveal>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "primary" | "success";
}) {
  return (
    <span className="flex items-baseline gap-1.5 rounded-field bg-base-100 px-2.5 py-1 text-sm">
      <span
        className={`font-semibold tabular-nums ${
          tone === "primary" ? "text-primary" : "text-success"
        }`}
      >
        {value}
      </span>
      <span className="text-base-content/60">{label}</span>
    </span>
  );
}

function Legend() {
  const items = [
    ["bg-primary/20 border-primary/50", "Open to you"],
    ["bg-success/20 border-success/50", "Yours"],
    ["bg-base-300/60 border-base-300", "Taken"],
    ["bg-transparent border-base-300/60", "Other role"],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-base-content/55">
      {items.map(([cls, label]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-[3px] border ${cls}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

const CHIP_STYLES: Record<ShiftAvailability, string> = {
  open: "bg-primary/12 border-primary/40 hover:border-primary/70",
  mine: "bg-success/15 border-success/50",
  taken: "bg-base-300/40 border-base-300 opacity-70",
  ineligible: "border-base-300/50 opacity-45",
};

function ShiftChip({
  shift,
  state,
  zone,
  busy,
  justClaimed,
  onClaim,
  onRelease,
}: {
  shift: ShiftWithAssignment;
  state: ShiftAvailability;
  zone: string;
  busy: boolean;
  justClaimed: boolean;
  onClaim: () => void;
  onRelease: () => void;
}) {
  const interactive = state === "open" || state === "mine";

  return (
    <div
      className={`group rounded-field border p-1.5 text-left text-[11px] ${
        CHIP_STYLES[state]
      } ${interactive ? "lift" : ""} ${justClaimed ? "claimed" : ""}`}
    >
      <div className="truncate font-medium text-base-content" title={shift.title}>
        {shift.title}
      </div>
      <div className="tabular-nums text-base-content/65">
        {formatTimeRangeInZone(shift.starts_at, shift.ends_at, zone)}
      </div>
      {shift.location && (
        <div className="truncate text-base-content/50" title={shift.location}>
          {shift.location}
        </div>
      )}
      {shift.hourly_rate_cents != null && (
        <div className="tabular-nums text-base-content/50">
          {formatCents(shift.hourly_rate_cents)}/h
        </div>
      )}

      {interactive && (
        <button
          className={`btn btn-xs mt-1.5 w-full ${
            state === "open" ? "btn-primary" : "btn-ghost border-success/30"
          }`}
          disabled={busy}
          onClick={state === "open" ? onClaim : onRelease}
        >
          {busy ? (
            <span className="loading loading-spinner loading-xs" />
          ) : state === "open" ? (
            "Claim"
          ) : (
            "Release"
          )}
        </button>
      )}
      {state === "taken" && (
        <div className="mt-1 text-base-content/40">Filled</div>
      )}
    </div>
  );
}
