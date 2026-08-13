import { addDays, eachDayOfInterval } from "date-fns";
import { fromDateInput } from "@/lib/format";
import type { NewShift } from "@/lib/repositories/shifts";
import type { UserRole } from "@/types/db";

export interface ShiftPattern {
  title: string;
  location: string;
  modality: string | null;
  team_id: string | null;
  required_role: UserRole;
  hourly_rate_cents: number | null;
  notes: string;
  /** `yyyy-MM-dd`, inclusive. */
  from: string;
  to: string;
  /** `HH:mm` local time. */
  startTime: string;
  /** Whole or fractional hours; 8.5 is a valid shift. */
  durationHours: number;
  /** 0 = Sunday … 6 = Saturday. Empty means every day in the range. */
  weekdays: number[];
}

/**
 * Expands a recurring pattern into concrete shift rows.
 *
 * Times are built in the browser's local zone and serialised to UTC, so an overnight
 * shift lands on the correct calendar day and a run that crosses a daylight-saving
 * boundary keeps its wall-clock start time rather than drifting an hour.
 */
export function expandPattern(pattern: ShiftPattern): NewShift[] {
  const start = fromDateInput(pattern.from);
  const end = fromDateInput(pattern.to);
  if (end < start) return [];

  const [hour, minute] = pattern.startTime.split(":").map(Number);
  const durationMs = Math.round(pattern.durationHours * 60) * 60_000;

  return eachDayOfInterval({ start, end })
    .filter(
      (day) => pattern.weekdays.length === 0 || pattern.weekdays.includes(day.getDay()),
    )
    .map((day) => {
      const startsAt = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        hour || 0,
        minute || 0,
      );
      return {
        title: pattern.title,
        location: pattern.location,
        modality: pattern.modality,
        team_id: pattern.team_id,
        required_role: pattern.required_role,
        hourly_rate_cents: pattern.hourly_rate_cents,
        notes: pattern.notes,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + durationMs).toISOString(),
      };
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
