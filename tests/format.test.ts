import { describe, expect, it } from "vitest";
import {
  formatMinutes,
  fromDateInput,
  minutesBetween,
  toDateInput,
  toHours,
} from "@/lib/format";

describe("minutesBetween", () => {
  it("measures a normal day shift", () => {
    expect(
      minutesBetween("2026-03-02T08:00:00.000Z", "2026-03-02T16:00:00.000Z"),
    ).toBe(480);
  });

  it("measures an overnight shift that crosses midnight", () => {
    expect(
      minutesBetween("2026-03-02T23:00:00.000Z", "2026-03-03T07:00:00.000Z"),
    ).toBe(480);
  });

  it("handles a half-hour tail", () => {
    expect(
      minutesBetween("2026-03-02T08:00:00.000Z", "2026-03-02T15:30:00.000Z"),
    ).toBe(450);
  });
});

describe("formatMinutes", () => {
  it("drops the minutes on whole hours", () => {
    expect(formatMinutes(480)).toBe("8h");
  });

  it("shows both parts on a partial hour", () => {
    expect(formatMinutes(450)).toBe("7h 30m");
  });

  it("shows minutes alone under an hour", () => {
    expect(formatMinutes(45)).toBe("45m");
  });

  it("never renders a negative duration", () => {
    expect(formatMinutes(-30)).toBe("0m");
  });
});

describe("toHours", () => {
  it("rounds to two decimals", () => {
    expect(toHours(450)).toBe(7.5);
    expect(toHours(455)).toBe(7.58);
  });
});

describe("date input round-tripping", () => {
  it("parses yyyy-MM-dd as a local date, not UTC", () => {
    // `new Date("2026-03-02")` is midnight UTC, which is the previous day in any
    // western timezone — the bug this helper exists to avoid.
    const parsed = fromDateInput("2026-03-02");
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(2);
    expect(parsed.getDate()).toBe(2);
  });

  it("round-trips through toDateInput", () => {
    expect(toDateInput(fromDateInput("2026-12-31"))).toBe("2026-12-31");
  });

  it("zero-pads single-digit months and days", () => {
    expect(toDateInput(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
