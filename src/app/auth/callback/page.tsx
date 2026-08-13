"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { TriangleAlert } from "lucide-react";

/**
 * Landing point for the magic link. The Supabase client is created with
 * `detectSessionInUrl`, so it exchanges the PKCE code as soon as it initialises —
 * this page only has to report the outcome and move the user along.
 */

/** Supabase reports failures on the query string or the fragment, depending on flow. */
function readLinkError(): string | null {
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return query.get("error_description") ?? fragment.get("error_description");
}

const subscribeToNothing = () => () => {};

export default function AuthCallbackPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // `window.location` is browser-only state. useSyncExternalStore reads it without a
  // hydration mismatch: the prerendered HTML uses the null snapshot, the browser
  // swaps in the real one.
  const linkError = useSyncExternalStore(
    subscribeToNothing,
    readLinkError,
    () => null,
  );

  useEffect(() => {
    if (!linkError && !loading && user) router.replace("/calendar/");
  }, [user, loading, linkError, router]);

  if (linkError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base-200 p-4">
        <div className="card w-full max-w-md bg-base-100 shadow-xl">
          <div className="card-body">
            <div role="alert" className="alert alert-error">
              <TriangleAlert className="h-5 w-5" aria-hidden="true" />
              <span className="text-sm">{linkError}</span>
            </div>
            <p className="mt-2 text-sm text-base-content/70">
              Sign-in links expire quickly and only work in the browser that requested
              them. Request a fresh one to continue.
            </p>
            <Link href="/login/" className="btn btn-primary mt-4">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <span className="loading loading-spinner loading-lg" aria-label="Signing in" />
      <p className="text-sm text-base-content/70">Signing you in…</p>
    </div>
  );
}
