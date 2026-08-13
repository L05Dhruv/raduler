"use client";

import { useAuth } from "@/contexts/AuthContext";
import { BootScreen, RequireAuth } from "./RequireAuth";
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

  if (!profile) return <BootScreen />;

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <div className="surface dialog-enter p-6">
          <div className="flex gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-base-300/60">
              <Lock className="h-4 w-4 text-base-content/60" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold">Administrators only</h2>
              <p className="mt-1 text-sm text-base-content/70">
                Your account has the{" "}
                <span className="badge badge-ghost badge-sm capitalize">
                  {profile.role}
                </span>{" "}
                role. Ask an administrator if you need access to reporting and
                invoicing.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
