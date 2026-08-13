const supabaseOrigin = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
})();

// Supabase realtime uses a websocket on the same host.
const connectSrc = ["'self'", supabaseOrigin, supabaseOrigin?.replace(/^https:/, "wss:")]
  .filter(Boolean)
  .join(" ");

/**
 * Next's static export inlines hydration scripts (`self.__next_f.push(...)`) and there
 * is no server to mint a per-request nonce, so 'unsafe-inline' for scripts is
 * unavoidable here. That is a real weakening, recorded in SECURITY.md rather than
 * quietly accepted.
 */
export const CSP_CONTENT = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");
