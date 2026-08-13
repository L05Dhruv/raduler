import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { ShiftWithAssignment, TimeOff } from "@/types/db";
import { fromDateInput, toDateInput } from "@/lib/format";

/** Sunday-first weeks, matching how the group reads a printed roster. */
const WEEK_OPTIONS = { weekStartsOn: 0 as const };

export interface MonthGrid {
  /** Always whole weeks, so the grid is a clean 7 × n. */
  days: Date[];
  /** Query bounds — the first cell through the day after the last cell. */
  rangeStart: Date;
  rangeEnd: Date;
}

export function buildMonthGrid(month: Date): MonthGrid {
  const rangeStart = startOfWeek(startOfMonth(month), WEEK_OPTIONS);
  const days = eachDayOfInterval({
    start: rangeStart,
    end: endOfWeek(endOfMonth(month), WEEK_OPTIONS),
  });
  return {
    days,
    rangeStart,
    // Exclusive upper bound, derived from the last cell's midnight rather than from
    // endOfWeek — that returns 23:59:59.999, which would stretch the query an extra
    // day and pull in shifts the grid has nowhere to draw.
    rangeEnd: addDays(days[days.length - 1], 1),
  };
}

/** Buckets shifts by local calendar day so a cell lookup is O(1). */
export function groupShiftsByDay(
  shifts: ShiftWithAssignment[],
): Map<string, ShiftWithAssignment[]> {
  const byDay = new Map<string, ShiftWithAssignment[]>();
  for (const shift of shifts) {
    const key = toDateInput(new Date(shift.starts_at));
    const bucket = byDay.get(key);
    if (bucket) bucket.push(shift);
    else byDay.set(key, [shift]);
  }
  return byDay;
}

/**
 * Time off is stored as inclusive date ranges, so a single day can be covered by a
 * request that started weeks earlier — this walks the ranges rather than indexing on
 * a start date.
 */
export function timeOffOnDay(day: Date, requests: TimeOff[]): TimeOff[] {
  return requests.filter((r) =>
    isWithinInterval(day, {
      start: fromDateInput(r.starts_on),
      end: fromDateInput(r.ends_on),
    }),
  );
}

export type ShiftAvailability = "mine" | "taken" | "open" | "ineligible";

export function shiftAvailability(
  shift: ShiftWithAssignment,
  viewerId: string | null,
  viewerRole: string | null,
): ShiftAvailability {
  const confirmed = shift.shift_assignments?.[0];
  if (confirmed) return confirmed.profile_id === viewerId ? "mine" : "taken";
  if (viewerRole && viewerRole !== "admin" && shift.required_role !== viewerRole) {
    return "ineligible";
  }
  return "open";
}
