import { DISPLAY_LOCALE } from "@/lib/format";

/**
 * Time-zone primitives.
 *
 * Three zones exist in this application and they are not interchangeable:
 *
 *   * **The practice zone** — where the work happens. A shift published as 08:00 is
 *     08:00 here whoever is reading it, and a reporting period runs midnight to midnight
 *     here. It comes from the database (`practice_timezone()`), never from the browser.
 *   * **A person's home zone** — `profiles.timezone`. What they normally want to read.
 *   * **The display zone** — what they want to read *right now*, which differs from home
 *     while they are travelling. Session-scoped, browser-only.
 *
 * Everything below is built on `Intl`, so there is no dependency to add and no zone
 * database to keep current — the platform's is already correct and already updated.
 *
 * A note on the `Date` convention used with these helpers: a *plain date* (a calendar day
 * with no time zone, like "the 3rd of September") is carried as a `Date` at local
 * midnight, and an *instant* is a `Date` meaning a real moment. The two are never mixed
 * in one function. `dayKeyInZone` converts instant to plain date; `wallClockToInstant`
 * converts back.
 */

/** The zone the browser believes it is in. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Whether a string names a zone this browser can actually resolve. */
export function isValidTimezone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every zone the platform knows, for a picker. `supportedValuesOf` is recent enough that
 * a fallback is warranted; the short list covers the cases this practice plausibly needs
 * rather than pretending to be complete.
 */
export function supportedTimezones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  if (typeof supported === "function") {
    try {
      return supported("timeZone");
    } catch {
      /* fall through */
    }
  }
  return [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "America/Toronto",
    "America/Vancouver",
    "Europe/London",
    "Europe/Paris",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Sydney",
    "UTC",
  ];
}

/**
 * The parts of an instant as they read in a given zone.
 *
 * `hourCycle: "h23"` rather than `hour12: false`, which renders midnight as "24" on some
 * ICU versions and would silently push every midnight calculation to the wrong day.
 */
function partsInZone(instant: Date, zone: string) {
  // Deliberately NOT the display locale. This is parsing machinery — the numbers read back
  // here drive every day bucket and wall-clock conversion — so it stays pinned to one locale
  // whose numeric output is known, rather than following whatever the practice reads in.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const found: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") found[part.type] = Number(part.value);
  }
  return {
    year: found.year,
    month: found.month,
    day: found.day,
    hour: found.hour,
    minute: found.minute,
    second: found.second,
  };
}

/** How far ahead of UTC `zone` is at `instant`, in milliseconds. */
function zoneOffsetMs(instant: Date, zone: string): number {
  const p = partsInZone(instant, zone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Instants carry milliseconds the formatter drops; ignoring them would introduce a
  // sub-second error into every conversion.
  return asIfUtc - (instant.getTime() - instant.getMilliseconds());
}

function dayKeyFromParts(p: { year: number; month: number; day: number }): string {
  const month = String(p.month).padStart(2, "0");
  const day = String(p.day).padStart(2, "0");
  return `${p.year}-${month}-${day}`;
}

/** `yyyy-MM-dd` — the calendar day an instant falls on, in a given zone. */
export function dayKeyInZone(instant: Date, zone: string): string {
  return dayKeyFromParts(partsInZone(instant, zone));
}

/** Today's calendar day in a given zone. */
export function todayKeyInZone(zone: string, now: Date = new Date()): string {
  return dayKeyInZone(now, zone);
}

/** `HH:mm` — the wall clock an instant reads as in a zone, for a `<input type="time">`. */
export function timeKeyInZone(instant: Date, zone: string): string {
  const p = partsInZone(instant, zone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/**
 * The instant at which a wall-clock time occurs in a given zone.
 *
 * This is the awkward direction. There is no `Date` constructor that takes a zone, so it
 * is solved by guessing and correcting: interpret the wall clock as if it were UTC, ask
 * what the zone's offset is around then, and shift by it. The second probe matters
 * because the offset can differ either side of a daylight-saving transition, and the
 * first guess may land on the wrong side of one.
 *
 * The two pathological cases both resolve sensibly rather than throwing:
 *
 *   * A time that **does not exist** — 02:30 on a spring-forward morning — shifts forward
 *     by the length of the gap, becoming 03:30. An hour cannot be invented, and moving
 *     forward is the convention every other date library settles on.
 *   * A time that happens **twice** — 01:30 on a fall-back morning — resolves to its
 *     first occurrence, which is the one a person scheduling a shift means.
 */
export function wallClockToInstant(
  dayKey: string,
  time: string,
  zone: string,
): Date | null {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!dayMatch || !timeMatch) return null;

  const [, y, m, d] = dayMatch.map(Number) as unknown as number[];
  const [, hour, minute] = timeMatch.map(Number) as unknown as number[];

  const asIfUtc = Date.UTC(y, m - 1, d, hour, minute);

  // Two probes: interpret the wall clock as UTC and shift by the zone's offset around
  // then, and again by the offset at the result. Across a transition they disagree, and
  // picking between them by comparing timestamps gets it wrong — a valid time just after
  // a spring-forward is reachable only by the second probe, while a nonexistent one is
  // reachable by neither. So each candidate is checked by formatting it back.
  const firstGuess = asIfUtc - zoneOffsetMs(new Date(asIfUtc), zone);
  const candidates = [firstGuess, asIfUtc - zoneOffsetMs(new Date(firstGuess), zone)].sort(
    (a, b) => a - b,
  );

  const readsBackCorrectly = (candidate: number) => {
    const p = partsInZone(new Date(candidate), zone);
    return dayKeyFromParts(p) === dayKey && p.hour === hour && p.minute === minute;
  };

  // Earliest that reads back correctly: for an ambiguous time that is its first
  // occurrence, which is what someone scheduling a shift means.
  const valid = candidates.find(readsBackCorrectly);
  if (valid !== undefined) return new Date(valid);

  // Nothing reads back, so the wall clock does not exist on that day — a spring-forward
  // gap. The later candidate is the one that has moved past the missing hour.
  return new Date(candidates[candidates.length - 1]);
}

/** Adds whole days to a `yyyy-MM-dd` key, staying in plain-date arithmetic. */
export function addDaysToKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return dayKeyInZone(shifted, "UTC");
}

const TIME_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function timeFormatter(zone: string): Intl.DateTimeFormat {
  let cached = TIME_FORMATTERS.get(zone);
  if (!cached) {
    cached = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
    });
    TIME_FORMATTERS.set(zone, cached);
  }
  return cached;
}

/** A single time, rendered in a zone. */
export function formatTimeInZone(iso: string, zone: string): string {
  return timeFormatter(zone).format(new Date(iso));
}

/** `1:00 p.m.–5:00 p.m.`, rendered in a zone. */
export function formatTimeRangeInZone(
  startIso: string,
  endIso: string,
  zone: string,
): string {
  return `${formatTimeInZone(startIso, zone)}–${formatTimeInZone(endIso, zone)}`;
}

/**
 * The short name a zone goes by at a given instant — "EDT", "PST", "GMT+5:30".
 * Instant-dependent on purpose: the same zone is EST in January and EDT in July, and
 * labelling a summer shift "EST" is worse than not labelling it.
 */
export function zoneAbbreviation(zone: string, instant: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
      timeZone: zone,
      timeZoneName: "short",
    }).formatToParts(instant);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? zone;
  } catch {
    return zone;
  }
}

/** `America/Toronto` → `Toronto`, for a picker where the region is already grouped. */
export function zoneCityLabel(zone: string): string {
  const city = zone.split("/").pop() ?? zone;
  return city.replace(/_/g, " ");
}

/**
 * Whether two zones show the same wall clock at a given instant. Comparing offsets rather
 * than names keeps the travel banner quiet for someone whose browser reports
 * `America/Detroit` against a practice in `America/Toronto` — different zone, identical
 * clock, nothing worth telling them about.
 */
export function sameClock(a: string, b: string, instant: Date = new Date()): boolean {
  if (a === b) return true;
  try {
    return zoneOffsetMs(instant, a) === zoneOffsetMs(instant, b);
  } catch {
    return false;
  }
}
