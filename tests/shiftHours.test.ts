import { describe, expect, it } from "vitest";
import { coverageGapMinutes, resolveHours } from "@/lib/shiftHours";
import { timeKeyInZone, wallClockToInstant } from "@/lib/timezone";

/**
 * Windows are built and asserted in named zones, never the machine's, so this suite gives
 * the same answer wherever it runs.
 */
const TORONTO = "America/Toronto";
const VANCOUVER = "America/Vancouver";

/** An instant, from a wall-clock time in the practice's zone. */
function at(dayKey: string, time: string, zone = TORONTO): string {
  return wallClockToInstant(dayKey, time, zone)!.toISOString();
}

// A 12:00-19:00 shift in Toronto, the example the requirement was written from.
const DAY_SHIFT = { start: at("2026-09-14", "12:00"), end: at("2026-09-14", "19:00") };

function resolve(startTime: string, endTime: string, shift = DAY_SHIFT, zone = TORONTO) {
  return resolveHours(shift.start, shift.end, startTime, endTime, zone);
}

describe("resolveHours", () => {
  it("accepts a window inside the published shift", () => {
    const result = resolve("13:00", "17:00");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(timeKeyInZone(result.window.start, TORONTO)).toBe("13:00");
    expect(timeKeyInZone(result.window.end, TORONTO)).toBe("17:00");
  });

  it("accepts the published window exactly — the endpoints are inclusive", () => {
    const result = resolve("12:00", "19:00");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.window.start.toISOString()).toBe(DAY_SHIFT.start);
    expect(result.window.end.toISOString()).toBe(DAY_SHIFT.end);
  });

  it("refuses a start before the shift opens", () => {
    const result = resolve("11:00", "17:00");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/within the published shift/);
  });

  it("refuses an end after the shift closes", () => {
    expect(resolve("13:00", "20:00").ok).toBe(false);
  });

  it("refuses an end that precedes the start", () => {
    expect(resolve("17:00", "13:00").ok).toBe(false);
  });

  it("refuses a zero-length window", () => {
    expect(resolve("13:00", "13:00").ok).toBe(false);
  });

  it("rejects anything that is not a 24-hour time", () => {
    expect(resolve("1pm", "17:00").ok).toBe(false);
    expect(resolve("25:00", "17:00").ok).toBe(false);
    expect(resolve("13:60", "17:00").ok).toBe(false);
    expect(resolve("", "17:00").ok).toBe(false);
  });

  describe("read from another zone", () => {
    it("interprets the typed times in the zone the person is reading in", () => {
      // The Toronto 12:00-19:00 shift reads as 09:00-16:00 in Vancouver. Someone there
      // typing 10:00-14:00 means ten o'clock their time, which is 13:00-17:00 in Toronto.
      const result = resolve("10:00", "14:00", DAY_SHIFT, VANCOUVER);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(timeKeyInZone(result.window.start, VANCOUVER)).toBe("10:00");
      expect(timeKeyInZone(result.window.start, TORONTO)).toBe("13:00");
      expect(timeKeyInZone(result.window.end, TORONTO)).toBe("17:00");
    });

    it("bounds against the same window, so the zone cannot be used to widen it", () => {
      // 08:00 Vancouver is 11:00 Toronto — an hour before the shift opens. Refused, as it
      // would be for someone typing 11:00 at the practice.
      expect(resolve("08:00", "14:00", DAY_SHIFT, VANCOUVER).ok).toBe(false);
    });

    it("states the published window in the reader's own zone when refusing", () => {
      const result = resolve("08:00", "14:00", DAY_SHIFT, VANCOUVER);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toMatch(/9/); // 09:00 PDT, not 12:00 EDT
    });
  });

  describe("shifts that cross midnight", () => {
    // 22:00 Monday through 06:00 Tuesday, Toronto.
    const overnight = { start: at("2026-09-14", "22:00"), end: at("2026-09-15", "06:00") };

    it("reads an end time before the start time as the following day", () => {
      const result = resolve("23:00", "02:00", overnight);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.window.end.getTime() - result.window.start.getTime()).toBe(
        3 * 60 * 60 * 1000,
      );
      expect(timeKeyInZone(result.window.start, TORONTO)).toBe("23:00");
      expect(timeKeyInZone(result.window.end, TORONTO)).toBe("02:00");
    });

    it("resolves a start time that only fits on the second day", () => {
      const result = resolve("01:00", "05:00", overnight);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(timeKeyInZone(result.window.start, TORONTO)).toBe("01:00");
      expect(timeKeyInZone(result.window.end, TORONTO)).toBe("05:00");
    });

    it("still refuses a time that falls in neither day's window", () => {
      expect(resolve("12:00", "02:00", overnight).ok).toBe(false);
    });
  });

  describe("across a daylight-saving change", () => {
    // Midnight to 08:00 on 8 March 2026 in Toronto — the morning the clocks jump.
    const springForward = { start: at("2026-03-08", "00:00"), end: at("2026-03-08", "08:00") };

    it("keeps the chosen wall-clock hours rather than drifting", () => {
      const result = resolve("01:00", "07:00", springForward);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(timeKeyInZone(result.window.start, TORONTO)).toBe("01:00");
      expect(timeKeyInZone(result.window.end, TORONTO)).toBe("07:00");
      // 01:00 EST to 07:00 EDT is five elapsed hours, not six. The shift really was five.
      expect(result.window.end.getTime() - result.window.start.getTime()).toBe(
        5 * 60 * 60 * 1000,
      );
    });

    it("handles a start inside the missing hour by moving past it", () => {
      const result = resolve("02:30", "07:00", springForward);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(timeKeyInZone(result.window.start, TORONTO)).toBe("03:30");
    });
  });
});

describe("coverageGapMinutes", () => {
  const scheduled = { start: at("2026-09-14", "12:00"), end: at("2026-09-14", "19:00") };

  it("is zero when the holder works the shift as published", () => {
    expect(coverageGapMinutes(scheduled.start, scheduled.end, null, null)).toBe(0);
    expect(
      coverageGapMinutes(scheduled.start, scheduled.end, scheduled.start, scheduled.end),
    ).toBe(0);
  });

  it("reports the hours left unstaffed when the holder narrows their window", () => {
    // 12-7 published, 1-5 worked: an hour at the front, two at the back.
    const gap = coverageGapMinutes(
      scheduled.start,
      scheduled.end,
      at("2026-09-14", "13:00"),
      at("2026-09-14", "17:00"),
    );
    expect(gap).toBe(180);
  });

  it("counts only one end when only one was moved", () => {
    expect(
      coverageGapMinutes(scheduled.start, scheduled.end, at("2026-09-14", "13:00"), null),
    ).toBe(60);
  });

  it("never goes negative when an admin records an overrun", () => {
    expect(
      coverageGapMinutes(
        scheduled.start,
        scheduled.end,
        at("2026-09-14", "11:00"),
        at("2026-09-14", "21:00"),
      ),
    ).toBe(0);
  });

  it("needs no zone, being a difference between two durations", () => {
    // Same window expressed from Vancouver's side; the gap is identical.
    const gap = coverageGapMinutes(
      scheduled.start,
      scheduled.end,
      at("2026-09-14", "10:00", VANCOUVER),
      at("2026-09-14", "14:00", VANCOUVER),
    );
    expect(gap).toBe(180);
  });
});
