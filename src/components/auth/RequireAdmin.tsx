"use client";

import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "./RequireAuth";
import { Lock } from "lucide-react";

/**
 * Hides admin screens from non-admins. Again: cosmetic. A determined user can render
 * these pages, and will simply get empty results and permission errors, because
 * `private.is_admin()` gates the data in Postgres.
 */
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AdminGate>{children}</AdminGate>
    </RequireAuth>
  );
}

function AdminGate({ children }: { children: React.ReactNode }) {
  const { isAdmin, profile } = useAuth();

  if (!profile) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <span className="loading loading-spinner loading-lg" aria-label="Loading" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <div role="alert" className="alert">
          <Lock className="h-5 w-5" aria-hidden="true" />
          <div>
            <h2 className="font-semibold">Administrators only</h2>
            <p className="text-sm">
              Your account has the <strong>{profile.role}</strong> role. Ask an
              administrator if you need access to reporting and invoicing.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
