import { describe, expect, it } from "vitest";
import {
  addDaysToKey,
  dayKeyInZone,
  formatTimeRangeInZone,
  isValidTimezone,
  sameClock,
  wallClockToInstant,
  zoneAbbreviation,
  zoneCityLabel,
} from "@/lib/timezone";

/**
 * Every assertion here names its zone explicitly, so the suite gives the same answer on a
 * developer's machine in Toronto, a colleague's in Vancouver and CI's in UTC. Nothing
 * below may depend on the ambient zone.
 *
 * Toronto's 2026 transitions, which most of the awkward cases are built from:
 *   8 March      02:00 EST → 03:00 EDT   (an hour that does not exist)
 *   1 November   02:00 EDT → 01:00 EST   (an hour that happens twice)
 */

const TORONTO = "America/Toronto";
const VANCOUVER = "America/Vancouver";
const KOLKATA = "Asia/Kolkata"; // UTC+5:30 — a half-hour offset, and no DST

describe("dayKeyInZone", () => {
  it("gives the calendar day as the zone sees it, not as UTC does", () => {
    // 02:00 UTC on 1 September is still the evening of 31 August in North America.
    const instant = new Date("2026-09-01T02:00:00Z");
    expect(dayKeyInZone(instant, "UTC")).toBe("2026-09-01");
    expect(dayKeyInZone(instant, TORONTO)).toBe("2026-08-31");
    expect(dayKeyInZone(instant, VANCOUVER)).toBe("2026-08-31");
  });

  it("can land a day ahead as well as behind", () => {
    const instant = new Date("2026-09-01T20:00:00Z");
    expect(dayKeyInZone(instant, TORONTO)).toBe("2026-09-01");
    expect(dayKeyInZone(instant, KOLKATA)).toBe("2026-09-02");
  });

  it("handles midnight exactly, without rolling to the 24th hour", () => {
    // The h23 hour cycle matters here: h24 renders this as "24" and pushes the day on.
    expect(dayKeyInZone(new Date("2026-09-01T04:00:00Z"), TORONTO)).toBe("2026-09-01");
  });
});

describe("wallClockToInstant", () => {
  it("resolves a summer morning against the zone's daylight offset", () => {
    // 8 August is EDT, UTC-4.
    expect(wallClockToInstant("2026-08-08", "08:00", TORONTO)?.toISOString()).toBe(
      "2026-08-08T12:00:00.000Z",
    );
  });

  it("resolves a winter morning against the standard offset", () => {
    // 15 January is EST, UTC-5. Same wall clock, different instant.
    expect(wallClockToInstant("2026-01-15", "08:00", TORONTO)?.toISOString()).toBe(
      "2026-01-15T13:00:00.000Z",
    );
  });

  it("handles a half-hour offset", () => {
    expect(wallClockToInstant("2026-08-08", "08:00", KOLKATA)?.toISOString()).toBe(
      "2026-08-08T02:30:00.000Z",
    );
  });

  it("round-trips with dayKeyInZone", () => {
    for (const zone of [TORONTO, VANCOUVER, KOLKATA, "UTC", "Australia/Sydney"]) {
      for (const key of ["2026-01-15", "2026-06-30", "2026-12-31"]) {
        const instant = wallClockToInstant(key, "13:00", zone);
        expect(instant).not.toBeNull();
        expect(dayKeyInZone(instant!, zone)).toBe(key);
      }
    }
  });

  it("rejects malformed input rather than guessing", () => {
    expect(wallClockToInstant("2026-8-8", "08:00", TORONTO)).toBeNull();
    expect(wallClockToInstant("2026-08-08", "8:00", TORONTO)).toBeNull();
    expect(wallClockToInstant("2026-08-08", "25:00", TORONTO)).toBeNull();
    expect(wallClockToInstant("", "08:00", TORONTO)).toBeNull();
  });

  describe("across a spring-forward gap", () => {
    it("moves a nonexistent time forward past the missing hour", () => {
      // 02:30 never happens on 8 March; the clocks go 01:59 → 03:00. Resolving it as
      // 03:30 EDT (07:30Z) is the convention — going backwards to 01:30 would quietly
      // move a shift an hour earlier than anyone asked for.
      const instant = wallClockToInstant("2026-03-08", "02:30", TORONTO);
      expect(instant?.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    });

    it("leaves the times either side of the gap alone", () => {
      expect(wallClockToInstant("2026-03-08", "01:30", TORONTO)?.toISOString()).toBe(
        "2026-03-08T06:30:00.000Z", // 01:30 EST
      );
      expect(wallClockToInstant("2026-03-08", "03:30", TORONTO)?.toISOString()).toBe(
        "2026-03-08T07:30:00.000Z", // 03:30 EDT
      );
    });

    it("keeps a whole shift on the same calendar day", () => {
      // The case shiftPattern cares about: an 08:00 start must stay 08:00 across the
      // boundary rather than drifting to 07:00 or 09:00.
      const before = wallClockToInstant("2026-03-07", "08:00", TORONTO);
      const after = wallClockToInstant("2026-03-09", "08:00", TORONTO);
      expect(dayKeyInZone(before!, TORONTO)).toBe("2026-03-07");
      expect(dayKeyInZone(after!, TORONTO)).toBe("2026-03-09");
      // A real 47-hour gap between them, not 48 — the hour the clocks took.
      expect(after!.getTime() - before!.getTime()).toBe(47 * 60 * 60 * 1000);
    });
  });

  describe("across a fall-back overlap", () => {
    it("resolves an ambiguous time to its first occurrence", () => {
      // 01:30 happens twice on 1 November: once as EDT (05:30Z), again as EST (06:30Z).
      // The earlier is the one a person means.
      expect(wallClockToInstant("2026-11-01", "01:30", TORONTO)?.toISOString()).toBe(
        "2026-11-01T05:30:00.000Z",
      );
    });

    it("still resolves unambiguous times on that day correctly", () => {
      expect(wallClockToInstant("2026-11-01", "08:00", TORONTO)?.toISOString()).toBe(
        "2026-11-01T13:00:00.000Z", // 08:00 EST
      );
    });

    it("gives that day 25 hours", () => {
      const start = wallClockToInstant("2026-11-01", "00:00", TORONTO)!;
      const next = wallClockToInstant("2026-11-02", "00:00", TORONTO)!;
      expect(next.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
    });
  });
});

describe("addDaysToKey", () => {
  it("walks forwards and backwards", () => {
    expect(addDaysToKey("2026-09-01", 1)).toBe("2026-09-02");
    expect(addDaysToKey("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("crosses month and year boundaries", () => {
    expect(addDaysToKey("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToKey("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("knows February 2028 has 29 days", () => {
    expect(addDaysToKey("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("is unaffected by daylight saving, being plain-date arithmetic", () => {
    expect(addDaysToKey("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDaysToKey("2026-11-01", 1)).toBe("2026-11-02");
  });
});

describe("formatTimeRangeInZone", () => {
  const start = "2026-09-01T16:00:00Z";
  const end = "2026-09-01T23:00:00Z";

  it("renders the same instants differently per zone", () => {
    const toronto = formatTimeRangeInZone(start, end, TORONTO);
    const vancouver = formatTimeRangeInZone(start, end, VANCOUVER);
    expect(toronto).not.toBe(vancouver);
    expect(toronto).toMatch(/12/); // noon EDT
    expect(vancouver).toMatch(/9/); // 09:00 PDT
  });
});

describe("zoneAbbreviation", () => {
  it("reflects daylight saving at the given instant", () => {
    const summer = zoneAbbreviation(TORONTO, new Date("2026-07-01T12:00:00Z"));
    const winter = zoneAbbreviation(TORONTO, new Date("2026-01-01T12:00:00Z"));
    expect(summer).not.toBe(winter);
  });

  it("falls back to the zone name it was given when asked for nonsense", () => {
    expect(zoneAbbreviation("Not/AZone")).toBe("Not/AZone");
  });
});

describe("isValidTimezone", () => {
  it("accepts real zones and refuses the rest", () => {
    expect(isValidTimezone(TORONTO)).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});

describe("sameClock", () => {
  it("is true for a zone against itself", () => {
    expect(sameClock(TORONTO, TORONTO)).toBe(true);
  });

  it("is true for distinct zones that read the same", () => {
    // Detroit and Toronto are separate IANA zones on an identical clock. Someone whose
    // browser reports one against a practice on the other is not travelling.
    expect(sameClock(TORONTO, "America/Detroit", new Date("2026-07-01T12:00:00Z"))).toBe(
      true,
    );
  });

  it("is false across a genuine difference", () => {
    expect(sameClock(TORONTO, VANCOUVER, new Date("2026-07-01T12:00:00Z"))).toBe(false);
  });
});

describe("zoneCityLabel", () => {
  it("reduces an IANA name to something readable", () => {
    expect(zoneCityLabel("America/Toronto")).toBe("Toronto");
    expect(zoneCityLabel("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(zoneCityLabel("UTC")).toBe("UTC");
  });
});
