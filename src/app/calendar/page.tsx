"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { addMonths, format, isSameMonth, subMonths } from "date-fns";
import { CalendarX2, ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
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
  chunkIntoWeeks,
  groupShiftsByDay,
  shiftAvailability,
  timeOffOnDay,
  type ShiftAvailability,
} from "@/lib/calendar";
import { toDateInput } from "@/lib/format";
import {
  formatTimeRangeInZone,
  todayKeyInZone,
  zoneAbbreviation,
} from "@/lib/timezone";
import type { ShiftWithAssignment, TimeOff } from "@/types/db";

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
  const [openDayKey, setOpenDayKey] = useState<string | null>(null);

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

  // Weeks rather than one flat grid: the panel for an expanded day is drawn between rows.
  const weeks = useMemo(() => chunkIntoWeeks(grid.days), [grid.days]);

  /**
   * Derived rather than reset in an effect. Changing month or zone rebuilds the grid, and
   * a key left over from the month before would either open nothing or, worse, open the
   * same date in a different month.
   */
  const expandedKey =
    openDayKey && grid.days.some((day) => toDateInput(day) === openDayKey)
      ? openDayKey
      : null;

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
            <div className="min-w-[52rem] space-y-px">
              <div className="grid grid-cols-7 gap-px">
                {WEEKDAYS.map((d) => (
                  <div
                    key={d}
                    className="pb-2 text-center text-[11px] font-medium uppercase tracking-wider text-base-content/45"
                  >
                    {d}
                  </div>
                ))}
              </div>

              {weeks.map((week) => {
                const openDay = week.find((day) => toDateInput(day) === expandedKey);
                return (
                  <div key={toDateInput(week[0])} className="space-y-px">
                    <div className="grid grid-cols-7 gap-px">
                      {week.map((day) => {
                        const key = toDateInput(day);
                        const dayShifts = (shiftsByDay.get(key) ?? []).filter(
                          (shift) =>
                            !onlyEligible ||
                            shiftAvailability(
                              shift,
                              profile?.id ?? null,
                              profile?.role ?? null,
                            ) !== "ineligible",
                        );
                        return (
                          <DayCell
                            key={key}
                            day={day}
                            dayKey={key}
                            shifts={dayShifts}
                            away={timeOffOnDay(day, timeOffQuery.data ?? [])}
                            outsideMonth={!isSameMonth(day, month)}
                            today={key === todayKey}
                            expanded={key === expandedKey}
                            viewerId={profile?.id ?? null}
                            viewerRole={profile?.role ?? null}
                            onToggle={() =>
                              setOpenDayKey((current) => (current === key ? null : key))
                            }
                          />
                        );
                      })}
                    </div>

                    {openDay && (
                      <DayDetail
                        day={openDay}
                        dayKey={toDateInput(openDay)}
                        shifts={(shiftsByDay.get(toDateInput(openDay)) ?? []).filter(
                          (shift) =>
                            !onlyEligible ||
                            shiftAvailability(
                              shift,
                              profile?.id ?? null,
                              profile?.role ?? null,
                            ) !== "ineligible",
                        )}
                        away={timeOffOnDay(openDay, timeOffQuery.data ?? [])}
                        zone={displayZone}
                        viewerId={profile?.id ?? null}
                        viewerRole={profile?.role ?? null}
                        busyShiftId={busyShiftId}
                        justClaimedId={justClaimedId}
                        onClaim={(shift) => void act(shift, "claim")}
                        onRelease={(shift) => void act(shift, "release")}
                        onClose={() => setOpenDayKey(null)}
                      />
                    )}
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
/**
 * One calendar square, at a fixed height whatever the day holds.
 *
 * The month grid used to stack every shift inline, so a Tuesday with five of them made its
 * whole week twice as tall as the others and the calendar lost the even rhythm that makes a
 * month readable at a glance. The square now shows at most two titles and a count; the rest
 * lives in the panel that expands beneath the week, which costs no height until asked for.
 *
 * It is a button only when there is something to open — otherwise a month of empty squares
 * would add forty-two stops to the tab order for nothing.
 */
function DayCell({
  day,
  dayKey,
  shifts,
  away,
  outsideMonth,
  today,
  expanded,
  viewerId,
  viewerRole,
  onToggle,
}: {
  day: Date;
  dayKey: string;
  shifts: ShiftWithAssignment[];
  away: TimeOff[];
  outsideMonth: boolean;
  today: boolean;
  expanded: boolean;
  viewerId: string | null;
  viewerRole: string | null;
  onToggle: () => void;
}) {
  const approvedAway = away.some((a) => a.status === "approved");
  const interactive = shifts.length > 0 || away.length > 0;
  const mineCount = shifts.filter(
    (s) => shiftAvailability(s, viewerId, viewerRole) === "mine",
  ).length;
  const openCount = shifts.filter(
    (s) => shiftAvailability(s, viewerId, viewerRole) === "open",
  ).length;

  const shown = shifts.slice(0, 2);
  const hidden = shifts.length - shown.length;

  const body = (
    <>
      <div className="mb-1 flex items-center justify-between">
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
            className={`badge badge-xs ${approvedAway ? "badge-warning" : "badge-ghost"}`}
          >
            {approvedAway ? "Away" : "Pending"}
          </span>
        )}
      </div>

      <div className="space-y-0.5">
        {shown.map((shift) => (
          <span
            key={shift.id}
            className={`block truncate rounded-[3px] border px-1 py-px text-[10px] text-base-content ${
              CHIP_STYLES[shiftAvailability(shift, viewerId, viewerRole)]
            }`}
          >
            {shift.title}
          </span>
        ))}
      </div>

      {shifts.length > 0 && (
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-base-content/50">
          {hidden > 0 && <span>+{hidden} more</span>}
          {openCount > 0 && <span className="text-primary">{openCount} open</span>}
          {mineCount > 0 && <span className="text-success">{mineCount} yours</span>}
        </div>
      )}
    </>
  );

  const shell = `day-cell rounded-field border p-1.5 text-left transition-colors ${
    outsideMonth ? "border-transparent bg-base-200/40" : "border-base-300/40 bg-base-100"
  } ${today ? "ring-1 ring-primary/50" : ""} ${approvedAway ? "bg-warning/5" : ""} ${
    expanded ? "border-primary/50 bg-base-300/25" : ""
  }`;

  if (!interactive) return <div className={shell}>{body}</div>;

  return (
    <button
      type="button"
      id={`day-${dayKey}`}
      aria-expanded={expanded}
      aria-controls={`day-panel-${dayKey}`}
      onClick={onToggle}
      className={`${shell} w-full cursor-pointer hover:border-base-300 hover:bg-base-300/30`}
    >
      {body}
    </button>
  );
}

/**
 * The expanded day. Full width beneath its own week, so opening one never changes the size
 * of a square or moves the days around it — only what sits below them.
 *
 * Claim and release live here rather than in the square. Nesting a button inside a button
 * is invalid, and a target that small was never a good place for the one irreversible
 * action on this page.
 */
function DayDetail({
  day,
  dayKey,
  shifts,
  away,
  zone,
  viewerId,
  viewerRole,
  busyShiftId,
  justClaimedId,
  onClaim,
  onRelease,
  onClose,
}: {
  day: Date;
  dayKey: string;
  shifts: ShiftWithAssignment[];
  away: TimeOff[];
  zone: string;
  viewerId: string | null;
  viewerRole: string | null;
  busyShiftId: string | null;
  justClaimedId: string | null;
  onClaim: (shift: ShiftWithAssignment) => void;
  onRelease: (shift: ShiftWithAssignment) => void;
  onClose: () => void;
}) {
  return (
    <section
      id={`day-panel-${dayKey}`}
      role="region"
      aria-labelledby={`day-${dayKey}`}
      className="day-detail surface rounded-field border-primary/30 p-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold">{format(day, "EEEE d MMMM")}</h3>
        {away.map((a) => (
          <span
            key={a.id}
            className={`badge badge-sm ${
              a.status === "approved" ? "badge-warning" : "badge-ghost"
            }`}
          >
            {a.kind} ({a.status})
          </span>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-square ml-auto"
          aria-label="Collapse day"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {shifts.length === 0 ? (
        <p className="text-sm text-base-content/55">Nothing scheduled on this day.</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {shifts.map((shift) => {
            const state = shiftAvailability(shift, viewerId, viewerRole);
            const interactive = state === "open" || state === "mine";
            return (
              <li
                key={shift.id}
                className={`flex items-center gap-2 rounded-field border p-2 ${
                  CHIP_STYLES[state]
                } ${justClaimedId === shift.id ? "claimed" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{shift.title}</p>
                  <p className="tabular-nums text-xs text-base-content/65">
                    {formatTimeRangeInZone(shift.starts_at, shift.ends_at, zone)}
                  </p>
                  {shift.location && (
                    <p className="truncate text-xs text-base-content/45">
                      {shift.location}
                    </p>
                  )}
                  {shift.modality && (
                    <p className="text-xs text-base-content/45">{shift.modality}</p>
                  )}
                </div>

                {interactive ? (
                  <button
                    className={`btn btn-xs shrink-0 ${
                      state === "open" ? "btn-primary" : "btn-ghost border-success/30"
                    }`}
                    disabled={busyShiftId === shift.id}
                    onClick={() =>
                      state === "open" ? onClaim(shift) : onRelease(shift)
                    }
                  >
                    {busyShiftId === shift.id ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : state === "open" ? (
                      "Claim"
                    ) : (
                      "Release"
                    )}
                  </button>
                ) : (
                  <span className="shrink-0 text-xs text-base-content/40">
                    {state === "taken" ? "Filled" : "Other role"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
