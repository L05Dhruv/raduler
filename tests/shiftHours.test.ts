import { describe, expect, it } from "vitest";
import { coverageGapMinutes, resolveHours, toTimeInput } from "@/lib/shiftHours";

/** Local-time ISO helper, so these cases read as wall-clock times. */
function at(y: number, m: number, d: number, h: number, min = 0): string {
  return new Date(y, m, d, h, min).toISOString();
}

// A 12:00-19:00 shift, the example the requirement was written from.
const DAY_SHIFT = { start: at(2026, 8, 14, 12), end: at(2026, 8, 14, 19) };

function resolve(startTime: string, endTime: string, shift = DAY_SHIFT) {
  return resolveHours(shift.start, shift.end, startTime, endTime);
}

describe("resolveHours", () => {
  it("accepts a window inside the published shift", () => {
    const result = resolve("13:00", "17:00");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toTimeInput(result.window.start)).toBe("13:00");
    expect(toTimeInput(result.window.end)).toBe("17:00");
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

  describe("shifts that cross midnight", () => {
    // 22:00 Friday through 06:00 Saturday.
    const overnight = { start: at(2026, 8, 14, 22), end: at(2026, 8, 15, 6) };

    it("reads an end time before the start time as the following day", () => {
      const result = resolve("23:00", "02:00", overnight);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.window.start.getDate()).toBe(14);
      expect(result.window.end.getDate()).toBe(15);
      expect(result.window.end.getTime() - result.window.start.getTime()).toBe(
        3 * 60 * 60 * 1000,
      );
    });

    it("resolves a start time that only fits on the second day", () => {
      const result = resolve("01:00", "05:00", overnight);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.window.start.getDate()).toBe(15);
      expect(result.window.end.getDate()).toBe(15);
    });

    it("still refuses a time that falls in neither day's window", () => {
      // 12:00 exists on both candidate days and is outside the window on each.
      expect(resolve("12:00", "02:00", overnight).ok).toBe(false);
    });
  });

  describe("daylight saving", () => {
    // North American DST forward jump: 8 March 2026, 02:00 -> 03:00 local.
    const acrossSpringForward = { start: at(2026, 2, 8, 0), end: at(2026, 2, 8, 8) };

    it("keeps the chosen wall-clock hours rather than drifting", () => {
      const result = resolve("01:00", "07:00", acrossSpringForward);
      // The window is only valid where 01:00 and 07:00 both exist on that date; in a
      // zone without this transition the arithmetic is unremarkable, which is the
      // point — the assertion is on wall-clock time, not on elapsed milliseconds.
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(toTimeInput(result.window.start)).toBe("01:00");
      expect(toTimeInput(result.window.end)).toBe("07:00");
    });
  });
});

describe("coverageGapMinutes", () => {
  const scheduled = { start: at(2026, 8, 14, 12), end: at(2026, 8, 14, 19) };

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
      at(2026, 8, 14, 13),
      at(2026, 8, 14, 17),
    );
    expect(gap).toBe(180);
  });

  it("counts only one end when only one was moved", () => {
    expect(
      coverageGapMinutes(scheduled.start, scheduled.end, at(2026, 8, 14, 13), null),
    ).toBe(60);
  });

  it("never goes negative when an admin records an overrun", () => {
    expect(
      coverageGapMinutes(
        scheduled.start,
        scheduled.end,
        at(2026, 8, 14, 11),
        at(2026, 8, 14, 21),
      ),
    ).toBe(0);
  });
});
