"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { readTheme, writeTheme, THEME_CHANGE_EVENT, type Theme } from "@/lib/theme";

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
}

/**
 * The theme lives on `<html data-theme>`, written by the inline script before
 * paint. useSyncExternalStore reads that DOM state without a hydration mismatch —
 * the prerender uses the dark snapshot, the browser corrects it on mount.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore<Theme>(subscribe, readTheme, () => "raduler");
  const isDark = theme === "raduler";

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm btn-square"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light theme" : "Dark theme"}
      onClick={() => writeTheme(isDark ? "raduler-light" : "raduler")}
    >
      {/* Both icons stay mounted and cross-rotate, so the swap reads as one
          control changing rather than two icons replacing each other. */}
      <span className="relative block h-4 w-4">
        <Sun
          className={`absolute inset-0 h-4 w-4 transition-all duration-200 ${
            isDark ? "scale-50 rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100"
          }`}
          aria-hidden="true"
        />
        <Moon
          className={`absolute inset-0 h-4 w-4 transition-all duration-200 ${
            isDark ? "scale-100 rotate-0 opacity-100" : "scale-50 -rotate-90 opacity-0"
          }`}
          aria-hidden="true"
        />
      </span>
    </button>
  );
}
