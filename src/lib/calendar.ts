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
import { dayKeyInZone, wallClockToInstant } from "@/lib/timezone";

/** Sunday-first weeks, matching how the group reads a printed roster. */
const WEEK_OPTIONS = { weekStartsOn: 0 as const };

/**
 * A note on the two kinds of `Date` in this module, because mixing them is the bug this
 * convention exists to prevent:
 *
 *   * `days` are **plain dates** — a calendar square, carried as a `Date` at browser-local
 *     midnight. They have no zone and mean "the 3rd of September". Key them with
 *     `toDateInput`.
 *   * `rangeStart` / `rangeEnd` are **instants** — real moments, used as query bounds, and
 *     they depend entirely on which zone the grid is being read in. Midnight on the 3rd in
 *     Toronto is a different moment from midnight on the 3rd in Vancouver.
 */
export interface MonthGrid {
  /** Always whole weeks, so the grid is a clean 7 × n. Plain dates. */
  days: Date[];
  /** Query bounds as instants: the first cell's midnight, in `zone`. */
  rangeStart: Date;
  rangeEnd: Date;
}

export function buildMonthGrid(month: Date, zone: string): MonthGrid {
  const firstCell = startOfWeek(startOfMonth(month), WEEK_OPTIONS);
  const days = eachDayOfInterval({
    start: firstCell,
    end: endOfWeek(endOfMonth(month), WEEK_OPTIONS),
  });

  const dayAfterLast = addDays(days[days.length - 1], 1);
  return {
    days,
    // Built through the zone rather than from the plain date's own timestamp: a grid read
    // in Vancouver must query from Vancouver's midnight, or the first and last cells lose
    // shifts to the three-hour gap.
    rangeStart: wallClockToInstant(toDateInput(days[0]), "00:00", zone) ?? days[0],
    // Exclusive upper bound, derived from the day after the last cell rather than from
    // endOfWeek — that returns 23:59:59.999, which would stretch the query an extra day
    // and pull in shifts the grid has nowhere to draw.
    rangeEnd: wallClockToInstant(toDateInput(dayAfterLast), "00:00", zone) ?? dayAfterLast,
  };
}

/**
 * Buckets shifts by the calendar day they fall on *in `zone`*, so a cell lookup is O(1).
 *
 * The zone is what decides which square a shift lands in. A 21:00 Toronto shift is
 * Tuesday there and Wednesday in London, and someone reading the roster in London should
 * find it on Wednesday — that is the whole point of viewing in another zone.
 */
export function groupShiftsByDay(
  shifts: ShiftWithAssignment[],
  zone: string,
): Map<string, ShiftWithAssignment[]> {
  const byDay = new Map<string, ShiftWithAssignment[]>();
  for (const shift of shifts) {
    const key = dayKeyInZone(new Date(shift.starts_at), zone);
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
 *
 * No zone here, and that is deliberate: a day of leave is a calendar day, not an interval
 * of instants. "Away on the 3rd" means the 3rd wherever the roster is being read.
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

  /**
   * An empty assignment array does not mean nobody holds the shift. The
   * `assignments_select_own` policy shows a regular user only their *own* assignment
   * rows, so a shift claimed by a colleague arrives with the embed filtered away and
   * `status` is the only evidence left. Without this the calendar offers a Claim button
   * on a shift `claim_shift()` will refuse with "no longer open" — and the "open to
   * you" count is inflated by every shift the group has already covered.
   *
   * Checked after the role test so "My role only" keeps hiding other roles' work
   * whether or not it has been claimed.
   */
  if (shift.status === "filled") return "taken";

  return "open";
}
