"use client";

import { useMemo, useState } from "react";
import { Globe } from "lucide-react";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { useToast } from "@/components/ui/Toast";
import {
  supportedTimezones,
  zoneAbbreviation,
  zoneCityLabel,
} from "@/lib/timezone";

/**
 * Home-zone picker, for the account menu.
 *
 * "Follow the practice" is the default and the first option rather than a blank. It is the
 * right answer for almost everyone — nobody working at the practice needs to state their
 * zone, and leaving it unset means a change to the practice's zone reaches them without
 * anyone editing profiles one by one.
 *
 * Saving clears any session override, since otherwise the user's own change would appear
 * to do nothing.
 */
export function TimeZoneMenu() {
  const { homeZone, practiceZone, displayZone, deviceZone, saveHomeZone } = useTimeZone();
  const { run } = useToast();
  const [saving, setSaving] = useState(false);

  // Sorted by the label shown, so the list reads alphabetically by city rather than by
  // the region prefix the user does not see.
  const zones = useMemo(() => {
    const all = supportedTimezones();
    const preferred = [practiceZone, deviceZone].filter(
      (z): z is string => Boolean(z) && all.includes(z!),
    );
    const rest = all
      .filter((z) => !preferred.includes(z))
      .sort((a, b) => zoneCityLabel(a).localeCompare(zoneCityLabel(b)));
    return [...new Set([...preferred, ...rest])];
  }, [practiceZone, deviceZone]);

  const onChange = async (value: string) => {
    setSaving(true);
    await run(
      () => saveHomeZone(value === "" ? null : value),
      value === ""
        ? "Your times will follow the practice."
        : `Your times will show in ${zoneCityLabel(value)}.`,
    );
    setSaving(false);
  };

  return (
    <div className="border-b border-base-300/60 px-3 py-2.5">
      <label className="flex items-center gap-1.5 text-xs text-base-content/60">
        <Globe className="h-3.5 w-3.5" aria-hidden="true" />
        Show times in
      </label>
      <select
        className="select select-bordered select-sm mt-1.5 w-full"
        value={homeZone ?? ""}
        disabled={saving}
        onChange={(e) => void onChange(e.target.value)}
      >
        <option value="">
          {practiceZone
            ? `The practice — ${zoneCityLabel(practiceZone)} (${zoneAbbreviation(practiceZone)})`
            : "The practice"}
        </option>
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zoneCityLabel(zone)} ({zoneAbbreviation(zone)})
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-xs text-base-content/45">
        {homeZone
          ? `Currently reading in ${zoneAbbreviation(displayZone)}.`
          : "Travelling is offered separately, and only for the session."}
      </p>
    </div>
  );
}
