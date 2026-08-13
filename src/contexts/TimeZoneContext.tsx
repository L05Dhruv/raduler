"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import useSWR from "swr";
import { useAuth } from "@/contexts/AuthContext";
import { getPracticeTimezone } from "@/lib/repositories/settings";
import { updateOwnTimezone } from "@/lib/repositories/teams";
import { browserTimezone, isValidTimezone, sameClock } from "@/lib/timezone";

/**
 * Resolves which zone times are rendered in.
 *
 *   displayZone = session override ?? saved home zone ?? practice zone
 *
 * The practice zone is the fallback rather than the browser's, which is the decision
 * worth explaining. Defaulting to the browser would mean a radiologist who flew to
 * Vancouver opened the app to a roster that had silently moved three hours, with nothing
 * to say so. Defaulting to the practice means the roster always reads the way it was
 * published, and travelling is something you are offered and accept — see the banner in
 * AppShell.
 *
 * The override is deliberately session-scoped. A persisted "I am in Vancouver" is a
 * setting someone forgets to change back, and a stale one is worse than none: it is wrong
 * in a way that looks deliberate. sessionStorage keeps it across a reload during a trip
 * and drops it when the tab closes.
 */

const SESSION_ZONE_KEY = "raduler-session-timezone";
const DISMISSED_KEY = "raduler-travel-dismissed";

interface TimeZoneContextValue {
  /** Where the work happens. Null only while it is still being read. */
  practiceZone: string | null;
  /** The saved preference. Null means "follow the practice". */
  homeZone: string | null;
  /** What to render times in. Never null. */
  displayZone: string;
  /** Whether the display zone differs from the practice's clock. */
  viewingElsewhere: boolean;
  /** The zone the browser reports, whether or not it is in use. */
  deviceZone: string;
  /** A zone worth offering because the device is somewhere else, or null. */
  travelSuggestion: string | null;
  /** Applies a zone for this session only; null returns to the saved preference. */
  setSessionZone: (zone: string | null) => void;
  dismissTravelSuggestion: () => void;
  /** Persists a home zone on the profile; null means "follow the practice". */
  saveHomeZone: (zone: string | null) => Promise<void>;
}

const TimeZoneContext = createContext<TimeZoneContextValue | null>(null);

function readStored(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Private browsing or blocked storage — the choice just won't survive a reload.
  }
}

export function TimeZoneProvider({ children }: { children: React.ReactNode }) {
  const { user, profile, configured, refreshProfile } = useAuth();

  /**
   * Seeded through lazy initialisers rather than an effect. `readStored` already returns
   * null without a `window`, so a prerender simply gets the defaults, and nothing
   * zone-dependent reaches the prerendered markup: every page that renders a time sits
   * behind an auth guard showing the boot screen until a session exists.
   */
  const [sessionZone, setSessionZoneState] = useState<string | null>(() => {
    const stored = readStored(SESSION_ZONE_KEY);
    return stored && isValidTimezone(stored) ? stored : null;
  });
  const [dismissed, setDismissed] = useState(() => readStored(DISMISSED_KEY) === "1");
  // Fixed for the session. Someone whose device changes zone mid-flight gets the offer on
  // their next load, which is soon enough.
  const [deviceZone] = useState(browserTimezone);

  // The RPC is granted to signed-in users only, so there is nothing to ask for until
  // there is a session.
  const practiceQuery = useSWR(
    configured && user ? "practice-timezone" : null,
    getPracticeTimezone,
    { revalidateOnFocus: false },
  );

  const practiceZone = practiceQuery.data ?? null;
  const homeZone = profile?.timezone ?? null;

  const displayZone = sessionZone ?? homeZone ?? practiceZone ?? deviceZone;

  const setSessionZone = useCallback((zone: string | null) => {
    if (zone !== null && !isValidTimezone(zone)) return;
    setSessionZoneState(zone);
    writeStored(SESSION_ZONE_KEY, zone);
    // Accepting or rejecting an offer answers it either way.
    setDismissed(true);
    writeStored(DISMISSED_KEY, "1");
  }, []);

  const dismissTravelSuggestion = useCallback(() => {
    setDismissed(true);
    writeStored(DISMISSED_KEY, "1");
  }, []);

  const saveHomeZone = useCallback(
    async (zone: string | null) => {
      if (!profile) return;
      await updateOwnTimezone(profile.id, zone);
      // A session override would otherwise mask the change the user just made.
      setSessionZoneState(null);
      writeStored(SESSION_ZONE_KEY, null);
      await refreshProfile();
    },
    [profile, refreshProfile],
  );

  /**
   * Offered only when the device's clock genuinely differs. Comparing offsets rather than
   * zone names keeps this quiet for someone whose browser reports `America/Detroit`
   * against a practice in `America/Toronto` — a different zone showing an identical clock,
   * which is not news.
   */
  const travelSuggestion = useMemo(() => {
    if (dismissed || sessionZone) return null;
    if (!practiceZone) return null;
    if (sameClock(deviceZone, displayZone)) return null;
    return deviceZone;
  }, [dismissed, sessionZone, practiceZone, deviceZone, displayZone]);

  const value = useMemo<TimeZoneContextValue>(
    () => ({
      practiceZone,
      homeZone,
      displayZone,
      viewingElsewhere: practiceZone ? !sameClock(displayZone, practiceZone) : false,
      deviceZone,
      travelSuggestion,
      setSessionZone,
      dismissTravelSuggestion,
      saveHomeZone,
    }),
    [
      practiceZone,
      homeZone,
      displayZone,
      deviceZone,
      travelSuggestion,
      setSessionZone,
      dismissTravelSuggestion,
      saveHomeZone,
    ],
  );

  return <TimeZoneContext.Provider value={value}>{children}</TimeZoneContext.Provider>;
}

export function useTimeZone(): TimeZoneContextValue {
  const ctx = useContext(TimeZoneContext);
  if (!ctx) throw new Error("useTimeZone must be used within a TimeZoneProvider");
  return ctx;
}
