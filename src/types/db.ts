// Hand-maintained mirror of supabase/migrations/0001_init.sql.
// Regenerate with `pnpm supabase gen types typescript --project-id <ref>` once the
// Supabase CLI is linked; until then keep this file in step with the migration.

export type UserRole = "radiologist" | "tech" | "assistant" | "admin";
export type ShiftStatus = "open" | "filled" | "cancelled";
export type AssignmentStatus = "confirmed" | "released";
export type TimeOffKind = "vacation" | "conference" | "sick" | "other";
export type TimeOffStatus = "requested" | "approved" | "denied";
export type InvoiceStatus = "draft" | "sent" | "paid";

export const USER_ROLES: UserRole[] = ["radiologist", "tech", "assistant", "admin"];
export const TIME_OFF_KINDS: TimeOffKind[] = ["vacation", "conference", "sick", "other"];

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  modality: string | null;
  /** The one rate that applies to this person. Admin-set, via admin_update_profile(). */
  hourly_rate_cents: number;
  /**
   * IANA zone the person prefers to read times in. Null means "follow the practice".
   * Presentation only — nothing in the hours or money path reads it.
   */
  timezone: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface TeamMember {
  team_id: string;
  profile_id: string;
  role_in_team: string;
  created_at: string;
}

export interface Shift {
  id: string;
  team_id: string | null;
  title: string;
  location: string;
  modality: string | null;
  starts_at: string;
  ends_at: string;
  required_role: UserRole;
  notes: string;
  status: ShiftStatus;
  created_by: string | null;
  created_at: string;
}

export interface ShiftAssignment {
  id: string;
  shift_id: string;
  profile_id: string;
  status: AssignmentStatus;
  claimed_at: string;
  released_at: string | null;
  actual_start: string | null;
  actual_end: string | null;
}

export interface TimeOff {
  id: string;
  profile_id: string;
  starts_on: string;
  ends_on: string;
  kind: TimeOffKind;
  status: TimeOffStatus;
  note: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface Invoice {
  id: string;
  number: string;
  profile_id: string;
  period_start: string;
  period_end: string;
  total_minutes: number;
  total_cents: number;
  status: InvoiceStatus;
  issued_by: string | null;
  issued_at: string;
}

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  shift_id: string | null;
  description: string;
  worked_on: string;
  minutes: number;
  rate_cents: number;
  amount_cents: number;
}

/** Row shape returned by the `hours_summary(date, date)` RPC. */
export interface HoursSummaryRow {
  profile_id: string;
  full_name: string;
  role: UserRole;
  shifts_count: number;
  total_minutes: number;
  total_cents: number;
}

/** A shift joined to its confirmed assignment, as the calendar consumes it. */
export interface ShiftWithAssignment extends Shift {
  shift_assignments: Pick<
    ShiftAssignment,
    "id" | "profile_id" | "status" | "actual_start" | "actual_end"
  >[];
}
