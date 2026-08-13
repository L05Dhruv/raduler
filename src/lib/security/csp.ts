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
 * The policy is applied to production builds only — see `CSP_ENABLED` below.
 *
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

/**
 * Emitted in production builds only.
 *
 * The dev server needs what this policy exists to forbid: React's development build
 * calls `eval()`, Turbopack streams the RSC payload through inline scripts, and HMR
 * runs over a websocket. With the meta tag present, hydration never completes and the
 * whole app renders as dead HTML whose only symptom is one console line — which is
 * exactly how it went unnoticed until someone tried to click something locally.
 *
 * Nothing is lost by skipping it: a meta CSP on localhost protects nothing, and the
 * policy that ships is unchanged and verified against the built output.
 */
export const CSP_ENABLED = process.env.NODE_ENV === "production";
