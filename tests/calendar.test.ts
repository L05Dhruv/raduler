import { describe, expect, it } from "vitest";
import {
  buildMonthGrid,
  groupShiftsByDay,
  shiftAvailability,
  timeOffOnDay,
} from "@/lib/calendar";
import { toDateInput } from "@/lib/format";
import { addDaysToKey, dayKeyInZone, wallClockToInstant } from "@/lib/timezone";
import type { ShiftWithAssignment, TimeOff } from "@/types/db";

const TORONTO = "America/Toronto";
const VANCOUVER = "America/Vancouver";

function shift(partial: Partial<ShiftWithAssignment>): ShiftWithAssignment {
  return {
    id: "s1",
    team_id: null,
    title: "Day Read",
    location: "",
    modality: null,
    starts_at: "2026-03-02T08:00:00.000Z",
    ends_at: "2026-03-02T16:00:00.000Z",
    required_role: "radiologist",
    hourly_rate_cents: null,
    notes: "",
    status: "open",
    created_by: null,
    created_at: "2026-01-01T00:00:00.000Z",
    shift_assignments: [],
    ...partial,
  };
}

describe("buildMonthGrid", () => {
  it("always covers whole weeks", () => {
    for (const month of [new Date(2026, 1, 15), new Date(2026, 7, 1), new Date(2026, 10, 30)]) {
      expect(buildMonthGrid(month, TORONTO).days.length % 7).toBe(0);
    }
  });

  it("starts on the Sunday on or before the first of the month", () => {
    // 1 March 2026 is a Sunday, so the grid starts exactly there.
    const grid = buildMonthGrid(new Date(2026, 2, 15), TORONTO);
    expect(grid.days[0].getDay()).toBe(0);
    expect(toDateInput(grid.days[0])).toBe("2026-03-01");
  });

  it("handles a February that fits in exactly four weeks", () => {
    // February 2027 starts on a Monday and has 28 days, the tightest case.
    const grid = buildMonthGrid(new Date(2027, 1, 10), TORONTO);
    expect(grid.days.length % 7).toBe(0);
    expect(grid.days.some((d) => toDateInput(d) === "2027-02-28")).toBe(true);
  });

  describe("query bounds", () => {
    it("starts at the first cell's midnight in the grid's zone", () => {
      const grid = buildMonthGrid(new Date(2026, 2, 15), TORONTO);
      // 1 March 2026, 00:00 EST is 05:00 UTC.
      expect(grid.rangeStart.toISOString()).toBe("2026-03-01T05:00:00.000Z");
      expect(dayKeyInZone(grid.rangeStart, TORONTO)).toBe("2026-03-01");
    });

    it("shifts with the zone, because midnight is not one moment", () => {
      const month = new Date(2026, 2, 15);
      const toronto = buildMonthGrid(month, TORONTO);
      const vancouver = buildMonthGrid(month, VANCOUVER);
      expect(vancouver.rangeStart.getTime() - toronto.rangeStart.getTime()).toBe(
        3 * 60 * 60 * 1000,
      );
      // The squares themselves are the same calendar days either way.
      expect(vancouver.days.map(toDateInput)).toEqual(toronto.days.map(toDateInput));
    });

    it("ends one day past the final cell so the range is exclusive", () => {
      const grid = buildMonthGrid(new Date(2026, 2, 15), TORONTO);
      const lastCell = toDateInput(grid.days[grid.days.length - 1]);
      expect(dayKeyInZone(grid.rangeEnd, TORONTO)).toBe(addDaysToKey(lastCell, 1));
    });

    it("spans an hour less than its day count over a spring-forward", () => {
      // March 2026 contains Toronto's transition, so the window really is an hour short
      // of a whole number of days. Stepping the bound in 24-hour increments instead of
      // through the zone would put it an hour into the next day and pull in extra shifts.
      const grid = buildMonthGrid(new Date(2026, 2, 15), TORONTO);
      const span = grid.rangeEnd.getTime() - grid.rangeStart.getTime();
      expect(span).toBe((grid.days.length * 24 - 1) * 60 * 60 * 1000);
    });
  });
});

describe("groupShiftsByDay", () => {
  it("buckets by the calendar day in the given zone", () => {
    const instant = wallClockToInstant("2026-03-02", "09:00", TORONTO)!.toISOString();
    const grouped = groupShiftsByDay([shift({ id: "a", starts_at: instant })], TORONTO);
    expect(grouped.get("2026-03-02")?.map((s) => s.id)).toEqual(["a"]);
  });

  it("keeps several shifts on the same day together", () => {
    const morning = wallClockToInstant("2026-03-02", "08:00", TORONTO)!.toISOString();
    const evening = wallClockToInstant("2026-03-02", "17:00", TORONTO)!.toISOString();
    const grouped = groupShiftsByDay(
      [shift({ id: "a", starts_at: morning }), shift({ id: "b", starts_at: evening })],
      TORONTO,
    );
    expect(grouped.get("2026-03-02")).toHaveLength(2);
  });

  it("moves a late shift to the next square when read far enough east", () => {
    // 21:00 Toronto on the 2nd is 02:00 London on the 3rd. Someone reading the roster in
    // London should find it on the 3rd — that is what viewing in another zone means.
    const instant = wallClockToInstant("2026-03-02", "21:00", TORONTO)!.toISOString();
    const s = [shift({ id: "late", starts_at: instant })];
    expect(groupShiftsByDay(s, TORONTO).get("2026-03-02")?.[0].id).toBe("late");
    expect(groupShiftsByDay(s, "Europe/London").get("2026-03-03")?.[0].id).toBe("late");
    expect(groupShiftsByDay(s, "Europe/London").get("2026-03-02")).toBeUndefined();
  });

  it("moves an early shift to the previous square when read far enough west", () => {
    // 01:00 Toronto on the 3rd is 22:00 Vancouver on the 2nd.
    const instant = wallClockToInstant("2026-03-03", "01:00", TORONTO)!.toISOString();
    const s = [shift({ id: "early", starts_at: instant })];
    expect(groupShiftsByDay(s, TORONTO).get("2026-03-03")?.[0].id).toBe("early");
    expect(groupShiftsByDay(s, VANCOUVER).get("2026-03-02")?.[0].id).toBe("early");
  });
});

describe("timeOffOnDay", () => {
  const request: TimeOff = {
    id: "t1",
    profile_id: "p1",
    starts_on: "2026-03-02",
    ends_on: "2026-03-06",
    kind: "vacation",
    status: "approved",
    note: "",
    decided_by: null,
    decided_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };

  it("includes both endpoints — the range is inclusive", () => {
    expect(timeOffOnDay(new Date(2026, 2, 2), [request])).toHaveLength(1);
    expect(timeOffOnDay(new Date(2026, 2, 6), [request])).toHaveLength(1);
  });

  it("covers a day in the middle that no start date points at", () => {
    expect(timeOffOnDay(new Date(2026, 2, 4), [request])).toHaveLength(1);
  });

  it("excludes days outside the range", () => {
    expect(timeOffOnDay(new Date(2026, 2, 7), [request])).toHaveLength(0);
    expect(timeOffOnDay(new Date(2026, 2, 1), [request])).toHaveLength(0);
  });
});

describe("shiftAvailability", () => {
  it("marks a shift the viewer holds as theirs", () => {
    const s = shift({
      shift_assignments: [
        {
          id: "a1",
          profile_id: "me",
          status: "confirmed",
          actual_start: null,
          actual_end: null,
        },
      ],
    });
    expect(shiftAvailability(s, "me", "radiologist")).toBe("mine");
  });

  it("marks a shift someone else holds as taken", () => {
    const s = shift({
      shift_assignments: [
        {
          id: "a1",
          profile_id: "other",
          status: "confirmed",
          actual_start: null,
          actual_end: null,
        },
      ],
    });
    expect(shiftAvailability(s, "me", "radiologist")).toBe("taken");
  });

  it("marks a mismatched role as ineligible", () => {
    expect(shiftAvailability(shift({}), "me", "tech")).toBe("ineligible");
  });

  it("leaves an admin able to see every open shift", () => {
    expect(shiftAvailability(shift({}), "me", "admin")).toBe("open");
  });

  it("reports open when the role matches and nobody holds it", () => {
    expect(shiftAvailability(shift({}), "me", "radiologist")).toBe("open");
  });

  /**
   * A regular user cannot read other people's assignment rows, so the embed comes back
   * empty for a shift a colleague holds. `status` is the only thing left to go on.
   */
  describe("when RLS has hidden the holder", () => {
    const heldByAnother = shift({ status: "filled", shift_assignments: [] });

    it("reads a filled shift as taken rather than offering it", () => {
      expect(shiftAvailability(heldByAnother, "me", "radiologist")).toBe("taken");
    });

    it("still marks another role's work ineligible, so the role filter holds", () => {
      expect(shiftAvailability(heldByAnother, "me", "tech")).toBe("ineligible");
    });

    it("leaves a genuinely open shift claimable", () => {
      expect(
        shiftAvailability(shift({ status: "open", shift_assignments: [] }), "me", "radiologist"),
      ).toBe("open");
    });

    it("prefers the visible assignment when there is one", () => {
      const mine = shift({
        status: "filled",
        shift_assignments: [
          {
            id: "a1",
            profile_id: "me",
            status: "confirmed",
            actual_start: null,
            actual_end: null,
          },
        ],
      });
      expect(shiftAvailability(mine, "me", "radiologist")).toBe("mine");
    });
  });
});
