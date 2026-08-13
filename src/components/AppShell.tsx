"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TimeZoneMenu } from "@/components/TimeZoneMenu";
import { SessionZoneNotice, TravelBanner } from "@/components/TravelBanner";
import {
  Activity,
  BarChart3,
  CalendarClock,
  CalendarDays,
  FileText,
  LogOut,
  Plane,
  Timer,
  UserRound,
  Users,
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
  const pathname = usePathname() ?? "";

  const links = isAdmin ? [...USER_LINKS, ...ADMIN_LINKS] : USER_LINKS;
  const currentIndex = links.findIndex((l) => pathname.startsWith(l.href));

  /**
   * Direction comes from position in the nav, so moving rightwards through the
   * tabs slides content left and moving back slides it right. Without this every
   * navigation looks identical and the motion carries no information.
   */
  const directionTo = (index: number) =>
    index > currentIndex ? ["nav-forward"] : ["nav-back"];

  return (
    <div className="min-h-dvh">
      <header
        className="glass sticky top-0 z-40 border-b border-base-300/60"
        // Anchors the header during directional slides: content moves, the user's
        // frame of reference does not.
        style={{ viewTransitionName: "site-header" }}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link
            href="/calendar/"
            transitionTypes={["nav-back"]}
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <span className="grid h-7 w-7 place-items-center rounded-selector bg-primary text-primary-content">
              <Activity className="h-4 w-4" aria-hidden="true" />
            </span>
            Raduler
          </Link>

          <nav className="hidden flex-1 items-center gap-0.5 md:flex" aria-label="Main">
            {links.map((link, index) => (
              <NavLink
                key={link.href}
                {...link}
                active={index === currentIndex}
                transitionTypes={directionTo(index)}
              />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1 md:ml-0">
            <ThemeToggle />
            {profile && <UserMenu onSignOut={signOut} />}
          </div>
        </div>

        {/* Compact nav keeps the same ordering, so direction stays consistent. */}
        <nav
          className="flex gap-1 overflow-x-auto border-t border-base-300/60 px-3 py-1.5 md:hidden"
          aria-label="Main (compact)"
        >
          {links.map((link, index) => (
            <NavLink
              key={link.href}
              {...link}
              compact
              active={index === currentIndex}
              transitionTypes={directionTo(index)}
            />
          ))}
        </nav>
      </header>

      <TravelBanner />
      <SessionZoneNotice />

      <main className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>

      {idleCountdown !== null && (
        <IdleDialog
          seconds={idleCountdown}
          onStay={stayActive}
          onSignOut={() => void signOut()}
        />
      )}
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  compact,
  transitionTypes,
}: {
  href: string;
  label: string;
  icon: typeof Activity;
  active: boolean;
  compact?: boolean;
  transitionTypes: string[];
}) {
  return (
    <Link
      href={href}
      transitionTypes={transitionTypes}
      aria-current={active ? "page" : undefined}
      className={`relative flex shrink-0 items-center gap-1.5 rounded-field px-2.5 transition-colors duration-150 ${
        compact ? "py-1 text-xs" : "py-1.5 text-sm"
      } ${
        active
          ? "text-base-content"
          : "text-base-content/60 hover:bg-base-300/40 hover:text-base-content"
      }`}
    >
      <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
      {label}
      {active && (
        <span
          // A single named element exists at a time, so the browser morphs it
          // from the old tab's position to the new one — the indicator slides
          // rather than blinking out and back in.
          style={{ viewTransitionName: "nav-indicator" }}
          className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-primary"
        />
      )}
    </Link>
  );
}

function UserMenu({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const { profile } = useAuth();
  if (!profile) return null;

  const initials =
    (profile.full_name || profile.email)
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?";

  return (
    <div className="dropdown dropdown-end">
      <button
        tabIndex={0}
        className="btn btn-ghost btn-sm gap-2 px-1.5"
        aria-label="Account menu"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-base-300 text-[10px] font-semibold">
          {initials}
        </span>
        <span className="hidden max-w-32 truncate text-sm font-normal lg:inline">
          {profile.full_name || profile.email}
        </span>
      </button>
      <div
        tabIndex={0}
        className="dropdown-content surface dialog-enter z-50 mt-2 w-64 p-1"
      >
        <div className="border-b border-base-300/60 px-3 py-2.5">
          <p className="truncate text-sm font-medium">
            {profile.full_name || "Unnamed"}
          </p>
          <p className="truncate text-xs text-base-content/60">{profile.email}</p>
          <span className="badge badge-ghost badge-sm mt-2 capitalize">
            {profile.role}
          </span>
        </div>
        <Link
          href="/profile/"
          transitionTypes={["nav-forward"]}
          className="btn btn-ghost btn-sm w-full justify-start gap-2"
        >
          <UserRound className="h-4 w-4" aria-hidden="true" />
          Your profile
        </Link>
        <TimeZoneMenu />
        <button
          className="btn btn-ghost btn-sm mt-1 w-full justify-start gap-2 text-error"
          onClick={() => void onSignOut()}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </div>
  );
}

const IDLE_WARNING_SECONDS = 60;

function IdleDialog({
  seconds,
  onStay,
  onSignOut,
}: {
  seconds: number;
  onStay: () => void;
  onSignOut: () => void;
}) {
  const fraction = Math.max(0, Math.min(1, seconds / IDLE_WARNING_SECONDS));

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-base-300/50 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-title"
    >
      <div className="surface dialog-enter w-full max-w-sm p-6">
        <div className="flex items-start gap-4">
          {/* The ring drains as the countdown does — readable at a glance from
              across a reading room, which a number alone is not. */}
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full"
            style={{
              background: `conic-gradient(var(--color-warning) ${fraction * 360}deg, var(--color-base-300) 0deg)`,
            }}
            aria-hidden="true"
          >
            <span className="grid h-9 w-9 place-items-center rounded-full bg-base-100">
              <Timer className="h-4 w-4 text-warning" />
            </span>
          </span>
          <div>
            <h2 id="idle-title" className="text-lg font-semibold">
              Still there?
            </h2>
            <p className="mt-1 text-sm text-base-content/70">
              Signing out in {seconds} second{seconds === 1 ? "" : "s"} — this
              workstation has been idle.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-ghost btn-sm" onClick={onSignOut}>
            Sign out now
          </button>
          <button className="btn btn-primary btn-sm" onClick={onStay} autoFocus>
            Keep me signed in
          </button>
        </div>
      </div>
    </div>
  );
}
