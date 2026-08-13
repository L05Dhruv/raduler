import { describe, expect, it } from "vitest";
import { expandPattern, type ShiftPattern } from "@/lib/shiftPattern";
import { summaryToCsv } from "@/lib/repositories/reports";
import { dayKeyInZone, timeKeyInZone } from "@/lib/timezone";
import type { HoursSummaryRow } from "@/types/db";

/**
 * Assertions are made in the practice's zone rather than the machine's, so these pass
 * identically on a laptop in Toronto, one in Vancouver and CI in UTC. The old versions of
 * these tests read `getHours()`, which quietly asserted the runner's zone.
 */
const TORONTO = "America/Toronto";

function pattern(overrides: Partial<ShiftPattern> = {}): ShiftPattern {
  return {
    title: "Day Read",
    location: "Main Campus",
    modality: "CT",
    team_id: null,
    required_role: "radiologist",
    notes: "",
    from: "2026-03-02",
    to: "2026-03-08",
    startTime: "08:00",
    durationHours: 8,
    weekdays: [1, 2, 3, 4, 5],
    timezone: TORONTO,
    ...overrides,
  };
}

describe("expandPattern", () => {
  it("emits one shift per selected weekday in the range", () => {
    // 2–8 March 2026 is Mon–Sun, so weekdays give exactly five.
    expect(expandPattern(pattern())).toHaveLength(5);
  });

  it("treats an empty weekday list as every day", () => {
    expect(expandPattern(pattern({ weekdays: [] }))).toHaveLength(7);
  });

  it("keeps the practice's wall-clock start time on each day", () => {
    for (const shift of expandPattern(pattern())) {
      expect(timeKeyInZone(new Date(shift.starts_at), TORONTO)).toBe("08:00");
    }
  });

  it("carries an overnight shift into the next calendar day", () => {
    const [shift] = expandPattern(
      pattern({ from: "2026-03-02", to: "2026-03-02", startTime: "23:00", weekdays: [] }),
    );
    expect(dayKeyInZone(new Date(shift.starts_at), TORONTO)).toBe("2026-03-02");
    expect(dayKeyInZone(new Date(shift.ends_at), TORONTO)).toBe("2026-03-03");
    expect(
      new Date(shift.ends_at).getTime() - new Date(shift.starts_at).getTime(),
    ).toBe(8 * 60 * 60 * 1000);
  });

  it("supports a fractional duration", () => {
    const [shift] = expandPattern(
      pattern({ from: "2026-03-02", to: "2026-03-02", durationHours: 8.5, weekdays: [] }),
    );
    expect(
      new Date(shift.ends_at).getTime() - new Date(shift.starts_at).getTime(),
    ).toBe(8.5 * 60 * 60 * 1000);
  });

  it("returns nothing when the range runs backwards", () => {
    expect(expandPattern(pattern({ from: "2026-03-08", to: "2026-03-02" }))).toEqual([]);
  });

  it("holds the start hour across a daylight-saving change", () => {
    // Toronto's clocks go forward on 8 March 2026. Stepping in 24-hour increments would
    // move every shift after it by an hour.
    const shifts = expandPattern(
      pattern({ from: "2026-03-06", to: "2026-03-10", weekdays: [] }),
    );
    expect(shifts.map((s) => timeKeyInZone(new Date(s.starts_at), TORONTO))).toEqual([
      "08:00",
      "08:00",
      "08:00",
      "08:00",
      "08:00",
    ]);
  });

  it("keeps the elapsed duration honest over the transition", () => {
    // The 8 March shift starts 08:00 EST and ends 16:00 EDT — the wall clock reads eight
    // hours but so does the clock on the wall of the reading room. Eight hours were
    // worked, and eight hours are what gets paid.
    const [shift] = expandPattern(
      pattern({ from: "2026-03-08", to: "2026-03-08", weekdays: [] }),
    );
    expect(
      new Date(shift.ends_at).getTime() - new Date(shift.starts_at).getTime(),
    ).toBe(8 * 60 * 60 * 1000);
  });

  it("publishes the same instants whatever zone the administrator is in", () => {
    // The correction this rework exists for. The pattern names the practice's zone, so an
    // admin publishing from a conference elsewhere produces an identical roster rather
    // than a set of shifts three hours out.
    const asPublished = expandPattern(pattern({ from: "2026-06-01", to: "2026-06-01", weekdays: [] }));
    expect(asPublished[0].starts_at).toBe("2026-06-01T12:00:00.000Z"); // 08:00 EDT
  });

  it("resolves a start time that does not exist on the day", () => {
    // 02:30 is skipped on 8 March. Rather than dropping the shift or inventing an hour,
    // it moves forward past the gap.
    const [shift] = expandPattern(
      pattern({
        from: "2026-03-08",
        to: "2026-03-08",
        startTime: "02:30",
        weekdays: [],
      }),
    );
    expect(shift.starts_at).toBe("2026-03-08T07:30:00.000Z"); // 03:30 EDT
  });
});

describe("summaryToCsv", () => {
  const row = (overrides: Partial<HoursSummaryRow> = {}): HoursSummaryRow => ({
    profile_id: "p1",
    full_name: "Dana Patel",
    role: "radiologist",
    shifts_count: 3,
    total_minutes: 1440,
    total_cents: 624000,
    ...overrides,
  });

  it("writes a header and one row per person", () => {
    const lines = summaryToCsv([row()]).split("\r\n");
    expect(lines[0]).toBe("Name,Role,Shifts,Hours,Earnings (CAD)");
    expect(lines[1]).toBe("Dana Patel,radiologist,3,24,6240.00");
  });

  it("quotes a name containing a comma", () => {
    expect(summaryToCsv([row({ full_name: "Patel, Dana" })])).toContain('"Patel, Dana"');
  });

  it("defuses a name that would otherwise run as a spreadsheet formula", () => {
    const csv = summaryToCsv([row({ full_name: "=HYPERLINK(\"http://evil\")" })]);
    expect(csv).toContain("'=HYPERLINK");
  });

  it("escapes embedded double quotes by doubling them", () => {
    expect(summaryToCsv([row({ full_name: 'Dana "Dee" Patel' })])).toContain(
      '"Dana ""Dee"" Patel"',
    );
  });
});
