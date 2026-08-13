import { minutesBetween } from "@/lib/format";
import {
  addDaysToKey,
  dayKeyInZone,
  formatTimeRangeInZone,
  wallClockToInstant,
} from "@/lib/timezone";

/**
 * Resolving a chosen `HH:mm` pair against a published shift.
 *
 * The database has the final say — `set_shift_hours()` re-checks every rule here. This
 * exists so the refusal arrives in the form the user is looking at rather than as a
 * toast after a round trip, and so the awkward cases have somewhere to be tested.
 *
 * Two of those cases are the reason this is not a one-liner:
 *
 *   * **Shifts that cross midnight.** A time input yields a bare `HH:mm`, which is
 *     ambiguous for a 22:00-06:00 shift: "02:00" means the following day. Each time is
 *     resolved to the first candidate day on which it lands inside the window.
 *   * **Daylight saving.** Times are resolved through an explicit zone rather than the
 *     browser's, so a window keeps its wall-clock hour across a transition instead of
 *     drifting — the same reason `expandPattern()` works that way.
 */

export interface HourWindow {
  start: Date;
  end: Date;
}

export type ResolvedHours =
  | { ok: true; window: HourWindow }
  | { ok: false; reason: string };

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The day the shift starts and the day after it, resolved in `zone`.
 *
 * Any time a `<input type="time">` can express falls inside a window of up to 24 hours on
 * one of those two days. Resolving each through `wallClockToInstant` rather than adding
 * milliseconds is what keeps the wall clock intact across a daylight-saving boundary.
 */
function candidateTimes(anchor: Date, time: string, zone: string): Date[] {
  const anchorKey = dayKeyInZone(anchor, zone);
  return [0, 1]
    .map((offset) => wallClockToInstant(addDaysToKey(anchorKey, offset), time, zone))
    .filter((instant): instant is Date => instant !== null);
}

/**
 * Turns a chosen `HH:mm` pair into concrete instants inside the published window, or
 * explains why it does not fit. Endpoints are inclusive: working a shift exactly as
 * published is valid.
 *
 * `zone` is the zone the person is *reading in*, not the practice's. Someone looking at
 * their roster from Vancouver sees a Toronto shift as 09:00–16:00 and will type "10:00"
 * meaning ten in Vancouver. Interpreting that against the practice's clock would move
 * their hours three hours from what they asked for. The database still checks the result
 * against the published window, so no zone confusion can widen it.
 */
export function resolveHours(
  shiftStartIso: string,
  shiftEndIso: string,
  startTime: string,
  endTime: string,
  zone: string,
): ResolvedHours {
  if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
    return { ok: false, reason: "Use a 24-hour time, like 13:00." };
  }

  const shiftStart = new Date(shiftStartIso);
  const shiftEnd = new Date(shiftEndIso);
  const published = formatTimeRangeInZone(shiftStartIso, shiftEndIso, zone);

  const start = candidateTimes(shiftStart, startTime, zone).find(
    (c) => c >= shiftStart && c <= shiftEnd,
  );
  if (!start) {
    return {
      ok: false,
      reason: `Start time has to be within the published shift (${published}).`,
    };
  }

  // Strictly after the start, so a zero-length window is refused here rather than by
  // the table's assignment_actuals_order constraint.
  const end = candidateTimes(shiftStart, endTime, zone).find(
    (c) => c > start && c <= shiftEnd,
  );
  if (!end) {
    return {
      ok: false,
      reason: `End time has to be after the start and within the published shift (${published}).`,
    };
  }

  return { ok: true, window: { start, end } };
}

/**
 * Minutes of a published shift nobody is covering, once the holder has narrowed their
 * hours. Someone taking 1-5pm of a 12-7pm shift leaves two hours unstaffed while the
 * shift still reads `filled`, so the admin roster surfaces this; it is the one thing
 * flexible hours can hide that an administrator needs to see.
 */
export function coverageGapMinutes(
  scheduledStartIso: string,
  scheduledEndIso: string,
  actualStartIso: string | null,
  actualEndIso: string | null,
): number {
  if (!actualStartIso && !actualEndIso) return 0;
  const scheduled = minutesBetween(scheduledStartIso, scheduledEndIso);
  const worked = minutesBetween(
    actualStartIso ?? scheduledStartIso,
    actualEndIso ?? scheduledEndIso,
  );
  return Math.max(0, scheduled - worked);
}
