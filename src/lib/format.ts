/**
 * Presentation helpers only.
 *
 * Money and hours are computed in SQL (`hours_summary`, `create_invoice`) so the
 * report and the invoice can never drift apart. Nothing here recomputes a total —
 * these functions render numbers the database already decided on.
 */

export function minutesBetween(startIso: string, endIso: string): number {
  return Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000,
  );
}

/** 450 → "7h 30m". Whole hours drop the minutes: 480 → "8h". */
export function formatMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** Decimal hours for reports and CSV, rounded to two places. */
export function toHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

const currency = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});

export function formatCents(cents: number): string {
  return currency.format((cents ?? 0) / 100);
}

/**
 * There is deliberately no zone-free time formatter here.
 *
 * One used to live in this file and rendered in whatever zone the browser happened to be
 * in, which is exactly the assumption `src/lib/timezone.ts` exists to remove. Use
 * `formatTimeInZone` / `formatTimeRangeInZone` and name the zone — the display zone for
 * anything a person reads, the practice zone for anything canonical.
 *
 * Durations below need no zone: elapsed time is elapsed time.
 */

/** `yyyy-MM-dd` in local time — the format Postgres `date` columns expect. */
export function toDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parses `yyyy-MM-dd` as a *local* date; `new Date(str)` would read it as UTC. */
export function fromDateInput(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
