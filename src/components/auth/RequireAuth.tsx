"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Activity, ShieldAlert } from "lucide-react";

/**
 * A convenience, not a control. There is no server to stop anyone loading this
 * bundle, so treat this purely as navigation polish — every table and RPC behind it
 * is gated by RLS, which is what actually keeps data from the wrong hands.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading, configured } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && configured && !user) router.replace("/login/");
  }, [loading, user, configured, router]);

  if (!configured) {
    return (
      <div className="grid min-h-dvh place-items-center p-4">
        <div className="surface max-w-lg p-6">
          <div className="flex gap-3">
            <ShieldAlert
              className="mt-0.5 h-5 w-5 shrink-0 text-warning"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-semibold">Backend not configured</h2>
              <p className="mt-1 text-sm text-base-content/70">
                Set <code className="rounded bg-base-300/60 px-1">
                  NEXT_PUBLIC_SUPABASE_URL
                </code>{" "}
                and{" "}
                <code className="rounded bg-base-300/60 px-1">
                  NEXT_PUBLIC_SUPABASE_ANON_KEY
                </code>
                , then rebuild. See the README.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !user) return <BootScreen />;

  return <>{children}</>;
}

/**
 * Shown while the session is restored. It carries the app's mark rather than a bare
 * spinner, so a cold load reads as the app starting rather than a blank page.
 */
export function BootScreen() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-selector bg-primary text-primary-content">
          <Activity className="h-5 w-5" aria-hidden="true" />
        </span>
        <span
          className="loading loading-dots loading-sm text-base-content/40"
          role="status"
          aria-label="Loading"
        />
      </div>
    </div>
  );
}
