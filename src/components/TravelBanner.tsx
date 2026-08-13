"use client";

import { Plane, X } from "lucide-react";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { zoneAbbreviation, zoneCityLabel } from "@/lib/timezone";

/**
 * Offers to read the roster in the zone the device is actually in.
 *
 * The alternative designs are both worse. Switching automatically means a roster that
 * silently moved three hours overnight, which is indistinguishable from the schedule
 * having changed. Doing nothing means someone reads 12:00 and turns up at 09:00. So it is
 * offered, once, and the answer is remembered for the session.
 *
 * Accepting sets a session-scoped override — not a saved preference. Someone flying home
 * on Sunday should not have to remember to undo a setting on Monday, and a stale zone is
 * worse than no zone because it looks deliberate. Anyone who genuinely relocates can set
 * their home zone from the account menu.
 */
export function TravelBanner() {
  const {
    travelSuggestion,
    displayZone,
    practiceZone,
    setSessionZone,
    dismissTravelSuggestion,
  } = useTimeZone();

  if (!travelSuggestion) return null;

  const there = zoneAbbreviation(travelSuggestion);
  const here = zoneAbbreviation(displayZone);
  const city = zoneCityLabel(travelSuggestion);
  const showingPracticeTime = practiceZone === displayZone;

  return (
    <div
      className="border-b border-warning/30 bg-warning/10"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
        <Plane className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <p className="text-sm">
          This device looks like it is in {city} ({there}), but times are shown in{" "}
          {here}
          {showingPracticeTime ? ", the practice's own zone" : ""}.
        </p>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            className="btn btn-sm btn-warning"
            onClick={() => setSessionZone(travelSuggestion)}
          >
            Show {there} for now
          </button>
          <button
            className="btn btn-ghost btn-sm btn-square"
            aria-label="Keep current times"
            title={`Keep showing ${here}`}
            onClick={dismissTravelSuggestion}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shown while a session override is in force, so the state is never invisible. Without it
 * the only clue that times have been shifted is a three-letter abbreviation elsewhere on
 * the page.
 */
export function SessionZoneNotice() {
  const { displayZone, homeZone, practiceZone, setSessionZone, travelSuggestion } =
    useTimeZone();
  const savedZone = homeZone ?? practiceZone;

  // Nothing to say when no override is in force: displayZone would equal the saved zone.
  if (!savedZone || displayZone === savedZone || travelSuggestion) return null;

  return (
    <div className="border-b border-base-300/60 bg-base-200/60">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs sm:px-6">
        <span className="text-base-content/70">
          Showing {zoneCityLabel(displayZone)} time ({zoneAbbreviation(displayZone)}) for
          this session.
        </span>
        <button
          className="btn btn-ghost btn-xs ml-auto"
          onClick={() => setSessionZone(null)}
        >
          Back to {zoneAbbreviation(savedZone)}
        </button>
      </div>
    </div>
  );
}
