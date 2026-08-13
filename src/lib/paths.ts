const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Absolute URL for a route, including the GitHub Pages basePath.
 * Needed anywhere a URL leaves the app — magic-link redirects, in particular, where
 * Next's own basePath handling does not apply because we build the string ourselves.
 */
export function absoluteUrl(path: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${BASE_PATH}${normalized}`;
}
