export const THEMES = ["raduler", "raduler-light"] as const;
export type Theme = (typeof THEMES)[number];

export const STORAGE_KEY = "raduler-theme";

/**
 * Runs before first paint, inlined in <head>. Without it the dark default paints
 * first and a light-mode user watches the page flash before their choice applies.
 *
 * `raduler` (dark) is daisyUI's `default: true`, so an absent attribute already
 * means dark and only a light preference needs writing.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});if(t==="raduler-light"||t==="raduler"){document.documentElement.dataset.theme=t}}catch(e){}})()`;

export const THEME_CHANGE_EVENT = "raduler:themechange";

export function readTheme(): Theme {
  if (typeof document === "undefined") return "raduler";
  const value = document.documentElement.dataset.theme;
  return value === "raduler-light" ? "raduler-light" : "raduler";
}

export function writeTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing or blocked storage — the choice just won't persist.
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}
