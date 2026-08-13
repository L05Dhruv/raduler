"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { ShieldAlert } from "lucide-react";

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
      <div className="mx-auto max-w-lg p-8">
        <div role="alert" className="alert alert-warning">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          <div>
            <h2 className="font-semibold">Backend not configured</h2>
            <p className="text-sm">
              Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then rebuild. See the README.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <span className="loading loading-spinner loading-lg" aria-label="Loading" />
      </div>
    );
  }

  return <>{children}</>;
}
