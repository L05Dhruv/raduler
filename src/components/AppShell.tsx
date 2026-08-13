"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import {
  CalendarDays,
  CalendarClock,
  Plane,
  BarChart3,
  Users,
  FileText,
  LogOut,
  Activity,
} from "lucide-react";

const USER_LINKS = [
  { href: "/calendar/", label: "Calendar", icon: CalendarDays },
  { href: "/my-schedule/", label: "My schedule", icon: CalendarClock },
  { href: "/time-off/", label: "Time off", icon: Plane },
];

const ADMIN_LINKS = [
  { href: "/admin/shifts/", label: "Shifts", icon: Activity },
  { href: "/admin/time-off/", label: "Requests", icon: Plane },
  { href: "/admin/teams/", label: "Teams", icon: Users },
  { href: "/admin/reports/", label: "Reports", icon: BarChart3 },
  { href: "/admin/invoices/", label: "Invoices", icon: FileText },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { profile, isAdmin, signOut, idleCountdown, stayActive } = useAuth();
  const pathname = usePathname();

  const links = isAdmin ? [...USER_LINKS, ...ADMIN_LINKS] : USER_LINKS;

  return (
    <div className="min-h-screen bg-base-200">
      <header className="navbar bg-base-100 shadow-sm">
        <div className="flex-1 gap-3">
          <Link href="/calendar/" className="text-lg font-semibold tracking-tight">
            Raduler
          </Link>
          <nav className="hidden gap-1 md:flex" aria-label="Main">
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`btn btn-ghost btn-sm gap-2 ${
                  pathname?.startsWith(href) ? "btn-active" : ""
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex-none gap-2">
          {profile && (
            <span className="hidden text-sm text-base-content/70 sm:inline">
              {profile.full_name || profile.email}
              <span className="badge badge-ghost badge-sm ml-2">{profile.role}</span>
            </span>
          )}
          <button className="btn btn-ghost btn-sm gap-2" onClick={() => void signOut()}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </header>

      {/* Mobile nav */}
      <nav
        className="flex gap-1 overflow-x-auto bg-base-100 px-2 pb-2 md:hidden"
        aria-label="Main (compact)"
      >
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`btn btn-ghost btn-xs gap-1 whitespace-nowrap ${
              pathname?.startsWith(href) ? "btn-active" : ""
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>

      <main className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>

      {idleCountdown !== null && (
        <div className="modal modal-open" role="alertdialog" aria-modal="true">
          <div className="modal-box">
            <h3 className="text-lg font-semibold">Still there?</h3>
            <p className="py-3">
              You will be signed out in {idleCountdown} second
              {idleCountdown === 1 ? "" : "s"} because this workstation has been idle.
            </p>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => void signOut()}>
                Sign out now
              </button>
              <button className="btn btn-primary" onClick={stayActive}>
                Keep me signed in
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
