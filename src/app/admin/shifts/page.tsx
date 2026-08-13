"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { addDays, format, startOfMonth, endOfMonth } from "date-fns";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Activity, Ban, Trash2 } from "lucide-react";
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
import {
  expandPattern,
  MAX_PATTERN_SHIFTS,
  type ShiftPattern,
} from "@/lib/shiftPattern";
import { formatCents, formatTimeRange, toDateInput } from "@/lib/format";
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
  rate: z.coerce.number().min(0, "Rate cannot be negative").max(10_000),
  notes: z.string().max(280, "Keep notes under 280 characters"),
  from: z.string().min(1),
  to: z.string().min(1),
  startTime: z.string().min(1),
  durationHours: z.coerce.number().min(0.5, "At least half an hour").max(24),
});

type FormValues = z.input<typeof schema>;

function AdminShifts() {
  const [month] = useState(() => new Date());
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const { run, toast } = useToast();

  const range = useMemo(
    () => ({ start: startOfMonth(month), end: addDays(endOfMonth(month), 1) }),
    [month],
  );

  const teamsQuery = useSWR("teams", listTeams);
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
      rate: 260,
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
      location: v.location ?? "",
      modality: v.modality ? v.modality : null,
      team_id: v.team_id || null,
      required_role: v.required_role ?? "radiologist",
      hourly_rate_cents: Math.round(Number(v.rate ?? 0) * 100),
      notes: v.notes ?? "",
      from: v.from,
      to: v.to,
      startTime: v.startTime ?? "08:00",
      durationHours: Number(v.durationHours ?? 0),
      weekdays,
    } satisfies ShiftPattern);
  }, [v, weekdays]);

  const onSubmit = async (values: FormValues) => {
    const rows = expandPattern({
      title: values.title,
      location: values.location,
      modality: values.modality || null,
      team_id: values.team_id || null,
      required_role: values.required_role,
      hourly_rate_cents: Math.round(Number(values.rate) * 100),
      notes: values.notes,
      from: values.from,
      to: values.to,
      startTime: values.startTime,
      durationHours: Number(values.durationHours),
      weekdays,
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

  return (
    <div className="grid gap-6 xl:grid-cols-[26rem_1fr]">
      <section className="surface h-fit">
        <div className="p-5">
          <h2 className="text-base font-semibold">Publish shifts</h2>
          <p className="text-sm text-base-content/70">
            Create one shift or a repeating pattern. Everything published here is open
            for the matching role to claim.
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
                  placeholder="Main Campus"
                  {...register("location")}
                />
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

            <div className="grid grid-cols-2 gap-2">
              <Field label="Rate ($/hour)" error={errors.rate?.message}>
                <input
                  type="number"
                  step="0.01"
                  className="input input-bordered w-full"
                  {...register("rate")}
                />
              </Field>
              <Field label="Duration (hours)" error={errors.durationHours?.message}>
                <input
                  type="number"
                  step="0.5"
                  className="input input-bordered w-full"
                  {...register("durationHours")}
                />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Field label="From">
                <input type="date" className="input input-bordered w-full" {...register("from")} />
              </Field>
              <Field label="To">
                <input type="date" className="input input-bordered w-full" {...register("to")} />
              </Field>
              <Field label="Starts">
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
              disabled={isSubmitting || preview.length === 0}
            >
              {isSubmitting
                ? "Publishing…"
                : `Publish ${preview.length} shift${preview.length === 1 ? "" : "s"}`}
            </button>
          </form>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          {format(month, "MMMM yyyy")} roster
          <span className="ml-2 text-sm font-normal text-base-content/60">
            {shifts.length} shifts
          </span>
        </h2>
        <div className="surface overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr className="border-base-300/60">
                <th>Date</th>
                <th>Shift</th>
                <th>Time</th>
                <th>Role</th>
                <th>Rate</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shiftsQuery.isLoading && (
                <tr>
                  <td colSpan={7} className="p-0">
                    <SkeletonRows rows={6} cols={6} />
                  </td>
                </tr>
              )}
              {!shiftsQuery.isLoading && shifts.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-0">
                    <EmptyState
                      icon={Activity}
                      title="Nothing published this month"
                      hint="Fill in the pattern on the left to open shifts for claiming."
                    />
                  </td>
                </tr>
              )}
              {shifts.map((shift) => {
                const claimed = shift.shift_assignments.length > 0;
                return (
                  <tr key={shift.id} className="border-base-300/40 transition-colors hover:bg-base-300/25">
                    <td className="whitespace-nowrap">
                      {format(new Date(shift.starts_at), "EEE d MMM")}
                    </td>
                    <td>{shift.title}</td>
                    <td className="whitespace-nowrap">
                      {formatTimeRange(shift.starts_at, shift.ends_at)}
                    </td>
                    <td>{shift.required_role}</td>
                    <td className="whitespace-nowrap">
                      {shift.hourly_rate_cents == null
                        ? "person's rate"
                        : `${formatCents(shift.hourly_rate_cents)}/h`}
                    </td>
                    <td>
                      <span
                        className={`badge badge-sm ${claimed ? "badge-success" : "badge-ghost"}`}
                      >
                        {claimed ? "filled" : shift.status}
                      </span>
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
