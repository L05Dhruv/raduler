"use client";

import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BadgeDollarSign, Globe, Lock, UserRound } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { PageTransition } from "@/components/PageTransition";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/contexts/AuthContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { updateOwnProfile } from "@/lib/repositories/teams";
import { formatCents } from "@/lib/format";
import {
  supportedTimezones,
  zoneAbbreviation,
  zoneCityLabel,
} from "@/lib/timezone";

export default function ProfilePage() {
  return (
    <RequireAuth>
      <AppShell>
        <PageTransition>
          <Profile />
        </PageTransition>
      </AppShell>
    </RequireAuth>
  );
}

const schema = z.object({
  full_name: z.string().min(1, "Give the roster a name to show").max(120),
  modality: z.string().max(60),
});

type FormValues = z.infer<typeof schema>;

/**
 * What a person can see and change about themselves.
 *
 * The split down the middle is the point: the fields on the left are theirs to edit, and
 * the rate on the right is not. That is not a UI convention — it is what the database
 * grants. A user holds `UPDATE` on `full_name`, `modality` and `timezone` and on nothing
 * else, so an attempt to write their own rate is refused by the column privilege before
 * RLS is even consulted. Showing the rate read-only here is therefore honest rather than
 * decorative: there is no hidden path to editing it.
 */
function Profile() {
  const { profile, refreshProfile } = useAuth();
  const { run } = useToast();

  if (!profile) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-base-300 text-sm font-semibold">
          {initialsFor(profile.full_name, profile.email)}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {profile.full_name || "Unnamed"}
          </h1>
          <p className="truncate text-sm text-base-content/60">{profile.email}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="badge badge-ghost badge-sm capitalize">{profile.role}</span>
          {!profile.active && <span className="badge badge-warning badge-sm">inactive</span>}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <RateCard cents={profile.hourly_rate_cents} />
        <TimeZoneCard />
      </div>

      <DetailsForm
        key={`${profile.full_name}|${profile.modality ?? ""}`}
        initial={{ full_name: profile.full_name, modality: profile.modality ?? "" }}
        onSave={async (values) => {
          const ok = await run(
            () =>
              updateOwnProfile(profile.id, {
                full_name: values.full_name.trim(),
                modality: values.modality.trim() || null,
              }),
            "Profile updated.",
          );
          if (ok) await refreshProfile();
        }}
      />

      <p className="text-xs text-base-content/45">
        Role, pay rate and whether your account is active are set by an administrator. Ask
        one if any of them looks wrong — and if you think an hours total is wrong, check{" "}
        <span className="text-base-content/70">My schedule</span> first: hours follow the
        times worked, which you can adjust yourself within a published shift.
      </p>
    </div>
  );
}

/**
 * The rate is per person now, so there is exactly one number to show. A rate of zero means
 * nobody has set one yet rather than "works for free", and saying so is more useful than
 * rendering $0.00.
 */
function RateCard({ cents }: { cents: number }) {
  return (
    <div className="surface p-4">
      <p className="flex items-center gap-1.5 text-sm text-base-content/60">
        <BadgeDollarSign className="h-3.5 w-3.5" aria-hidden="true" />
        Your rate
      </p>
      {cents > 0 ? (
        <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight">
          {formatCents(cents)}
          <span className="text-base font-normal text-base-content/55">/hour</span>
        </p>
      ) : (
        <p className="mt-1 text-lg font-medium text-base-content/70">Not set yet</p>
      )}
      <p className="mt-2 flex items-start gap-1.5 text-xs text-base-content/45">
        <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        {cents > 0
          ? "This applies to every shift you work. Only an administrator can change it, and every change is recorded."
          : "An administrator sets this. Until they do, your reported earnings will show as zero."}
      </p>
    </div>
  );
}

function TimeZoneCard() {
  const { homeZone, practiceZone, displayZone, deviceZone, saveHomeZone } = useTimeZone();
  const { run } = useToast();

  const zones = useMemo(() => {
    const all = supportedTimezones();
    const preferred = [practiceZone, deviceZone].filter(
      (z): z is string => z !== null && all.includes(z),
    );
    const rest = all
      .filter((z) => !preferred.includes(z))
      .sort((a, b) => zoneCityLabel(a).localeCompare(zoneCityLabel(b)));
    return [...new Set([...preferred, ...rest])];
  }, [practiceZone, deviceZone]);

  return (
    <div className="surface p-4">
      <label
        className="flex items-center gap-1.5 text-sm text-base-content/60"
        htmlFor="profile-timezone"
      >
        <Globe className="h-3.5 w-3.5" aria-hidden="true" />
        Show times in
      </label>
      <select
        id="profile-timezone"
        className="select select-bordered select-sm mt-1.5 w-full"
        value={homeZone ?? ""}
        onChange={(e) =>
          void run(
            () => saveHomeZone(e.target.value === "" ? null : e.target.value),
            "Time zone saved.",
          )
        }
      >
        <option value="">
          {practiceZone
            ? `The practice — ${zoneCityLabel(practiceZone)} (${zoneAbbreviation(practiceZone)})`
            : "The practice"}
        </option>
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zoneCityLabel(zone)} ({zoneAbbreviation(zone)})
          </option>
        ))}
      </select>
      <p className="mt-2 text-xs text-base-content/45">
        Currently reading in {zoneAbbreviation(displayZone)}. Travelling is offered
        separately and lasts only for the session, so this stays right when you get back.
      </p>
    </div>
  );
}

function DetailsForm({
  initial,
  onSave,
}: {
  initial: FormValues;
  onSave: (values: FormValues) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: initial });

  return (
    <form
      onSubmit={handleSubmit(onSave)}
      className="surface space-y-3 p-5"
      noValidate
    >
      <h2 className="flex items-center gap-1.5 text-base font-semibold">
        <UserRound className="h-4 w-4 text-base-content/60" aria-hidden="true" />
        Your details
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="form-control block">
          <span className="label-text mb-1 block">Name</span>
          <input className="input input-bordered w-full" {...register("full_name")} />
          {errors.full_name && (
            <span className="mt-1 block text-sm text-error">
              {errors.full_name.message}
            </span>
          )}
        </label>
        <label className="form-control block">
          <span className="label-text mb-1 block">Modality</span>
          <input
            className="input input-bordered w-full"
            placeholder="CT/MRI"
            {...register("modality")}
          />
          <span className="mt-1 block text-xs text-base-content/45">
            What you usually read. Shown to administrators when they build the roster.
          </span>
        </label>
      </div>

      <button
        type="submit"
        className="btn btn-primary btn-sm lift"
        disabled={isSubmitting || !isDirty}
      >
        {isSubmitting ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

function initialsFor(fullName: string, email: string): string {
  return (
    (fullName || email)
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}
