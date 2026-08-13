"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { addDays, addMonths, format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Activity, Ban, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { AppShell } from "@/components/AppShell";
import { PageTransition } from "@/components/PageTransition";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import {
  cancelShift,
  createShifts,
  deleteShift,
  listShifts,
} from "@/lib/repositories/shifts";
import { listTeams } from "@/lib/repositories/teams";
import { getPracticeDefaultLocation } from "@/lib/repositories/settings";
import {
  expandPattern,
  MAX_PATTERN_SHIFTS,
  type ShiftPattern,
} from "@/lib/shiftPattern";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { coverageGapMinutes } from "@/lib/shiftHours";
import { formatTimeRangeInZone, zoneAbbreviation } from "@/lib/timezone";
import { formatMinutes, toDateInput } from "@/lib/format";
import { USER_ROLES } from "@/types/db";

export default function AdminShiftsPage() {
  return (
    <RequireAdmin>
      <AppShell>
        <PageTransition>
          <AdminShifts />
        </PageTransition>
      </AppShell>
    </RequireAdmin>
  );
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const schema = z.object({
  title: z.string().min(2, "Give the shift a name"),
  location: z.string().max(120),
  modality: z.string().max(60),
  team_id: z.string(),
  required_role: z.enum(["radiologist", "tech", "assistant", "admin"]),
  notes: z.string().max(280, "Keep notes under 280 characters"),
  from: z.string().min(1),
  to: z.string().min(1),
  startTime: z.string().min(1),
  durationHours: z.coerce.number().min(0.5, "At least half an hour").max(24),
});

type FormValues = z.input<typeof schema>;

function AdminShifts() {
  /**
   * The roster is the practice's, so it is published and displayed in the practice's zone
   * regardless of where the administrator is sitting. Before this, `expandPattern` built
   * against the browser: publishing next month's roster from a conference in Vancouver
   * would have created a set of 05:00 shifts with nothing to indicate it.
   *
   * `displayZone` is the fallback only for the moment before the practice zone arrives,
   * and publishing is disabled until it does.
   */
  const { practiceZone, displayZone } = useTimeZone();
  const rosterZone = practiceZone ?? displayZone;
  const [month, setMonth] = useState(() => new Date());
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const { run, toast } = useToast();

  const range = useMemo(
    () => ({ start: startOfMonth(month), end: addDays(endOfMonth(month), 1) }),
    [month],
  );

  const teamsQuery = useSWR("teams", listTeams);
  // The practice's own location, pre-filling the common case rather than constraining it.
  const locationQuery = useSWR("practice-location", getPracticeDefaultLocation);
  const defaultLocation = locationQuery.data ?? "";
  const shiftsQuery = useSWR(["admin-shifts", toDateInput(range.start)], () =>
    listShifts(range.start, range.end),
  );

  const today = toDateInput(new Date());
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      location: "",
      modality: "",
      team_id: "",
      required_role: "radiologist",
      notes: "",
      from: today,
      to: toDateInput(addDays(new Date(), 13)),
      startTime: "08:00",
      durationHours: 8,
    },
  });

  // useWatch subscribes to the form; watch() would be read once and go stale, so the
  // preview count and the submit label would stop matching the inputs.
  const v = useWatch({ control });

  const preview = useMemo(() => {
    if (!v.from || !v.to) return [];
    return expandPattern({
      title: v.title || "Untitled shift",
      location: (v.location ?? "").trim() || defaultLocation,
      modality: v.modality ? v.modality : null,
      team_id: v.team_id || null,
      required_role: v.required_role ?? "radiologist",
      notes: v.notes ?? "",
      from: v.from,
      to: v.to,
      startTime: v.startTime ?? "08:00",
      durationHours: Number(v.durationHours ?? 0),
      weekdays,
      timezone: rosterZone,
    } satisfies ShiftPattern);
  }, [v, weekdays, rosterZone, defaultLocation]);

  const onSubmit = async (values: FormValues) => {
    const rows = expandPattern({
      title: values.title,
      location: values.location.trim() || defaultLocation,
      modality: values.modality || null,
      team_id: values.team_id || null,
      required_role: values.required_role,
      notes: values.notes,
      from: values.from,
      to: values.to,
      startTime: values.startTime,
      durationHours: Number(values.durationHours),
      weekdays,
      timezone: rosterZone,
    });

    if (rows.length === 0) {
      toast("error", "That pattern produces no shifts — check the dates and weekdays.");
      return;
    }
    // A mistyped year turns a fortnight into a decade; refuse rather than queue
    // thousands of inserts.
    if (rows.length > MAX_PATTERN_SHIFTS) {
      toast(
        "error",
        `That pattern would create ${rows.length} shifts. Narrow the date range (limit ${MAX_PATTERN_SHIFTS}).`,
      );
      return;
    }

    const ok = await run(
      () => createShifts(rows),
      `Published ${rows.length} shift${rows.length === 1 ? "" : "s"}.`,
    );
    if (ok) await shiftsQuery.mutate();
  };

  const remove = async (id: string, claimed: boolean) => {
    // A claimed shift is cancelled rather than deleted: someone has planned around
    // it, and the assignment and audit trail need to survive.
    const ok = await run(
      () => (claimed ? cancelShift(id) : deleteShift(id)),
      claimed ? "Shift cancelled; the assignment record is kept." : "Shift deleted.",
    );
    if (ok) await shiftsQuery.mutate();
  };

  const shifts = shiftsQuery.data ?? [];

  /**
   * Holders may narrow their hours inside a published shift, which leaves part of the
   * window unstaffed while the shift still reads `filled`. Nobody else can see that
   * from the calendar, so it is counted here.
   */
  const partlyUncovered = shifts.filter((shift) => {
    const held = shift.shift_assignments[0];
    return (
      held &&
      coverageGapMinutes(
        shift.starts_at,
        shift.ends_at,
        held.actual_start,
        held.actual_end,
      ) > 0
    );
  }).length;

  return (
    <div className="grid gap-6 xl:grid-cols-[26rem_1fr]">
      <section className="surface h-fit">
        <div className="p-5">
          <h2 className="text-base font-semibold">Publish shifts</h2>
          <p className="text-sm text-base-content/70">
            Create one shift or a repeating pattern. Everything published here is open
            for the matching role to claim. Times are the practice&rsquo;s own
            ({rosterZone}), whatever zone you happen to be in. Each person is paid
            their own rate, set under Teams.
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-3 space-y-3" noValidate>
            <Field label="Title" error={errors.title?.message}>
              <input
                className="input input-bordered w-full"
                placeholder="Day Read — Body"
                {...register("title")}
              />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Location">
                <input
                  className="input input-bordered w-full"
                  placeholder={defaultLocation || "Main Campus"}
                  {...register("location")}
                />
                {defaultLocation && (
                  <span className="mt-1 block text-xs text-base-content/45">
                    Blank uses {defaultLocation}.
                  </span>
                )}
              </Field>
              <Field label="Modality">
                <input
                  className="input input-bordered w-full"
                  placeholder="CT/MRI"
                  {...register("modality")}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Team">
                <select className="select select-bordered w-full" {...register("team_id")}>
                  <option value="">No team</option>
                  {(teamsQuery.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Role required">
                <select
                  className="select select-bordered w-full"
                  {...register("required_role")}
                >
                  {USER_ROLES.filter((r) => r !== "admin").map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Duration (hours)" error={errors.durationHours?.message}>
              <input
                type="number"
                step="0.5"
                className="input input-bordered w-full"
                {...register("durationHours")}
              />
            </Field>

            <div className="grid grid-cols-3 gap-2">
              <Field label="From">
                <input type="date" className="input input-bordered w-full" {...register("from")} />
              </Field>
              <Field label="To">
                <input type="date" className="input input-bordered w-full" {...register("to")} />
              </Field>
              <Field label={`Starts (${zoneAbbreviation(rosterZone)})`}>
                <input
                  type="time"
                  className="input input-bordered w-full"
                  {...register("startTime")}
                />
              </Field>
            </div>

            <fieldset className="form-control">
              <legend className="label-text mb-1">Repeat on</legend>
              <div className="flex flex-wrap gap-1">
                {WEEKDAY_LABELS.map((label, index) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={weekdays.includes(index)}
                    className={`btn btn-xs ${
                      weekdays.includes(index) ? "btn-primary" : "btn-outline"
                    }`}
                    onClick={() =>
                      setWeekdays((prev) =>
                        prev.includes(index)
                          ? prev.filter((d) => d !== index)
                          : [...prev, index].sort(),
                      )
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="mt-1 text-xs text-base-content/60">
                Select none to publish every day in the range.
              </span>
            </fieldset>

            <Field label="Notes" error={errors.notes?.message}>
              <textarea
                rows={2}
                className="textarea textarea-bordered w-full"
                placeholder="Scheduling context only"
                {...register("notes")}
              />
              <span className="mt-1 text-xs text-base-content/60">
                Never patient or clinical details.
              </span>
            </Field>

            <button
              type="submit"
              className="btn btn-primary lift w-full"
              disabled={isSubmitting || preview.length === 0 || !practiceZone}
            >
              {isSubmitting
                ? "Publishing…"
                : !practiceZone
                  ? "Reading the practice time zone…"
                  : `Publish ${preview.length} shift${preview.length === 1 ? "" : "s"}`}
            </button>
          </form>
        </div>
      </section>

      <section className="space-y-3">
        {/* Same controls and ordering as the calendar and my-schedule, so the roster
            is navigable rather than pinned to whichever month it was opened in — a
            pattern published into next month was previously impossible to review, and
            the uncovered count below only ever spoke for the current one. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              className="btn btn-ghost btn-sm btn-square"
              aria-label="Previous month"
              onClick={() => setMonth((m) => subMonths(m, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="min-w-40 text-center text-lg font-semibold tracking-tight">
              {format(month, "MMMM yyyy")}
            </h2>
            <button
              className="btn btn-ghost btn-sm btn-square"
              aria-label="Next month"
              onClick={() => setMonth((m) => addMonths(m, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              className="btn btn-ghost btn-sm ml-1"
              onClick={() => setMonth(new Date())}
            >
              Today
            </button>
          </div>

          <div className="flex items-center gap-2 pr-1 text-sm">
            <span
              className="text-base-content/55"
              title={`The roster is shown in the practice's zone, ${rosterZone}`}
            >
              {zoneAbbreviation(rosterZone)}
            </span>
            <span className="text-base-content/60">
              {shifts.length} shift{shifts.length === 1 ? "" : "s"}
            </span>
            {partlyUncovered > 0 && (
              <span className="text-warning">· {partlyUncovered} partly uncovered</span>
            )}
          </div>
        </div>
        <div className="surface overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr className="border-base-300/60">
                <th>Date</th>
                <th>Shift</th>
                <th>Time</th>
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shiftsQuery.isLoading && (
                <tr>
                  <td colSpan={6} className="p-0">
                    <SkeletonRows rows={6} cols={5} />
                  </td>
                </tr>
              )}
              {!shiftsQuery.isLoading && shifts.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-0">
                    <EmptyState
                      icon={Activity}
                      title="Nothing published this month"
                      hint="Fill in the pattern on the left to open shifts for claiming."
                    />
                  </td>
                </tr>
              )}
              {shifts.map((shift) => {
                const held = shift.shift_assignments[0];
                const claimed = Boolean(held);
                const gap = held
                  ? coverageGapMinutes(
                      shift.starts_at,
                      shift.ends_at,
                      held.actual_start,
                      held.actual_end,
                    )
                  : 0;
                return (
                  <tr key={shift.id} className="border-base-300/40 transition-colors hover:bg-base-300/25">
                    <td className="whitespace-nowrap">
                      {format(new Date(shift.starts_at), "EEE d MMM")}
                    </td>
                    <td>{shift.title}</td>
                    <td className="whitespace-nowrap">
                      {formatTimeRangeInZone(shift.starts_at, shift.ends_at, rosterZone)}
                    </td>
                    <td>{shift.required_role}</td>
                    <td className="whitespace-nowrap">
                      <span
                        className={`badge badge-sm ${claimed ? "badge-success" : "badge-ghost"}`}
                      >
                        {claimed ? "filled" : shift.status}
                      </span>
                      {held && gap > 0 && (
                        <span
                          className="badge badge-warning badge-sm ml-1 tabular-nums"
                          title={`Working ${formatTimeRangeInZone(
                            held.actual_start ?? shift.starts_at,
                            held.actual_end ?? shift.ends_at,
                            rosterZone,
                          )} — ${formatMinutes(gap)} of the published shift is unstaffed`}
                        >
                          {formatMinutes(gap)} open
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      <button
                        className="btn btn-ghost btn-xs"
                        aria-label={claimed ? "Cancel shift" : "Delete shift"}
                        title={claimed ? "Cancel (keeps the record)" : "Delete"}
                        onClick={() => void remove(shift.id, claimed)}
                      >
                        {claimed ? (
                          <Ban className="h-3.5 w-3.5" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="form-control block">
      <span className="label-text mb-1 block">{label}</span>
      {children}
      {error && <span className="mt-1 block text-sm text-error">{error}</span>}
    </label>
  );
}
