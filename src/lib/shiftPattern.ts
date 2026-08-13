import { addDays, eachDayOfInterval } from "date-fns";
import { fromDateInput, toDateInput } from "@/lib/format";
import { wallClockToInstant } from "@/lib/timezone";
import type { NewShift } from "@/lib/repositories/shifts";
import type { UserRole } from "@/types/db";

export interface ShiftPattern {
  title: string;
  location: string;
  modality: string | null;
  team_id: string | null;
  required_role: UserRole;
  notes: string;
  /** `yyyy-MM-dd`, inclusive. */
  from: string;
  to: string;
  /** `HH:mm` in the practice's zone, not the publisher's. */
  startTime: string;
  /** Whole or fractional hours; 8.5 is a valid shift. */
  durationHours: number;
  /** 0 = Sunday … 6 = Saturday. Empty means every day in the range. */
  weekdays: number[];
  /** The practice's IANA zone. An 08:00 shift means 08:00 here. */
  timezone: string;
}

/**
 * Expands a recurring pattern into concrete shift rows.
 *
 * Start times are wall-clock times **in the practice's zone**, resolved to instants
 * through it. That is the correction that matters: this used to build against the
 * browser's zone, so an administrator publishing next month's roster from a conference in
 * Vancouver would have created a set of 05:00 shifts without either of us noticing.
 *
 * Two consequences of resolving per day rather than adding 24-hour steps:
 *
 *   * A run crossing a daylight-saving boundary keeps its 08:00 start instead of drifting
 *     an hour, because each day is resolved independently.
 *   * `ends_at` is `starts_at` plus the elapsed duration, so an eight-hour shift is always
 *     eight hours of work — even the one spanning a transition, where the wall clock at
 *     the end will read an hour off. Paying for hours worked is the right behaviour; that
 *     shift genuinely was eight hours.
 */
export function expandPattern(pattern: ShiftPattern): NewShift[] {
  const start = fromDateInput(pattern.from);
  const end = fromDateInput(pattern.to);
  if (end < start) return [];

  const durationMs = Math.round(pattern.durationHours * 60) * 60_000;

  return eachDayOfInterval({ start, end })
    .filter(
      (day) => pattern.weekdays.length === 0 || pattern.weekdays.includes(day.getDay()),
    )
    .flatMap((day) => {
      const startsAt = wallClockToInstant(
        toDateInput(day),
        pattern.startTime,
        pattern.timezone,
      );
      // Only when startTime or the zone is malformed, which the form refuses first.
      if (!startsAt) return [];

      return [
        {
          title: pattern.title,
          location: pattern.location,
          modality: pattern.modality,
          team_id: pattern.team_id,
          required_role: pattern.required_role,
          notes: pattern.notes,
          starts_at: startsAt.toISOString(),
          ends_at: new Date(startsAt.getTime() + durationMs).toISOString(),
        },
      ];
    });
}

/** Rough guard so a mistyped date range cannot queue thousands of inserts. */
export const MAX_PATTERN_SHIFTS = 400;

export function patternDayCount(from: string, to: string): number {
  const start = fromDateInput(from);
  const end = fromDateInput(to);
  if (end < start) return 0;
  return eachDayOfInterval({ start, end: addDays(end, 0) }).length;
}
