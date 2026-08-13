import { describe, expect, it } from "vitest";
import {
  buildMonthGrid,
  groupShiftsByDay,
  shiftAvailability,
  timeOffOnDay,
} from "@/lib/calendar";
import { toDateInput } from "@/lib/format";
import type { ShiftWithAssignment, TimeOff } from "@/types/db";

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
      expect(buildMonthGrid(month).days.length % 7).toBe(0);
    }
  });

  it("starts on the Sunday on or before the first of the month", () => {
    // 1 March 2026 is a Sunday, so the grid starts exactly there.
    const grid = buildMonthGrid(new Date(2026, 2, 15));
    expect(grid.days[0].getDay()).toBe(0);
    expect(toDateInput(grid.days[0])).toBe("2026-03-01");
  });

  it("ends one day past the final visible cell so the range is exclusive", () => {
    const grid = buildMonthGrid(new Date(2026, 2, 15));
    const lastDay = grid.days[grid.days.length - 1];
    expect(grid.rangeEnd.getTime() - lastDay.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("handles a February that fits in exactly four weeks", () => {
    // February 2027 starts on a Monday and has 28 days, the tightest case.
    const grid = buildMonthGrid(new Date(2027, 1, 10));
    expect(grid.days.length % 7).toBe(0);
    expect(grid.days.some((d) => toDateInput(d) === "2027-02-28")).toBe(true);
  });
});

describe("groupShiftsByDay", () => {
  it("buckets by local calendar day", () => {
    const local = new Date(2026, 2, 2, 9, 0).toISOString();
    const grouped = groupShiftsByDay([shift({ id: "a", starts_at: local })]);
    expect(grouped.get("2026-03-02")?.map((s) => s.id)).toEqual(["a"]);
  });

  it("keeps several shifts on the same day together", () => {
    const day = new Date(2026, 2, 2, 8, 0).toISOString();
    const later = new Date(2026, 2, 2, 17, 0).toISOString();
    const grouped = groupShiftsByDay([
      shift({ id: "a", starts_at: day }),
      shift({ id: "b", starts_at: later }),
    ]);
    expect(grouped.get("2026-03-02")).toHaveLength(2);
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
