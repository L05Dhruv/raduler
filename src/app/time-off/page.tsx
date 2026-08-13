"use client";

import useSWR from "swr";
import { differenceInCalendarDays, format } from "date-fns";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plane, Trash2 } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { PageTransition } from "@/components/PageTransition";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  listTimeOff,
  requestTimeOff,
  withdrawTimeOff,
} from "@/lib/repositories/timeOff";
import { fromDateInput, toDateInput } from "@/lib/format";
import { TIME_OFF_KINDS, type TimeOff } from "@/types/db";

export default function TimeOffPage() {
  return (
    <RequireAuth>
      <AppShell>
        <PageTransition>
          <TimeOffManager />
        </PageTransition>
      </AppShell>
    </RequireAuth>
  );
}

const schema = z
  .object({
    starts_on: z.string().min(1, "Pick a start date"),
    ends_on: z.string().min(1, "Pick an end date"),
    kind: z.enum(["vacation", "conference", "sick", "other"]),
    // Free text is where patient details would leak in, so it stays short and is
    // labelled accordingly in the UI.
    note: z.string().max(280, "Keep the note under 280 characters"),
  })
  .refine((v) => fromDateInput(v.ends_on) >= fromDateInput(v.starts_on), {
    message: "The end date cannot be before the start date",
    path: ["ends_on"],
  });

type FormValues = z.infer<typeof schema>;

const STATUS_STYLES: Record<TimeOff["status"], string> = {
  requested: "bg-base-300/60 text-base-content/70",
  approved: "bg-success/15 text-success",
  denied: "bg-error/15 text-error",
};

function TimeOffManager() {
  const { profile } = useAuth();
  const { run } = useToast();
  const today = toDateInput(new Date());

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { starts_on: today, ends_on: today, kind: "vacation", note: "" },
  });

  const query = useSWR(profile ? ["time-off", profile.id] : null, () =>
    listTimeOff(profile!.id),
  );
  const rows = query.data ?? [];

  const onSubmit = async (values: FormValues) => {
    if (!profile) return;
    const ok = await run(
      () => requestTimeOff(profile.id, values),
      "Time-off request submitted for approval.",
    );
    if (ok) {
      reset({ starts_on: today, ends_on: today, kind: "vacation", note: "" });
      await query.mutate();
    }
  };

  const withdraw = async (id: string) => {
    if (await run(() => withdrawTimeOff(id), "Request withdrawn.")) {
      await query.mutate();
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
      <section className="surface h-fit p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Plane className="h-4 w-4 text-primary" aria-hidden="true" />
          Block off dates
        </h2>
        <p className="mt-1.5 text-sm text-base-content/60">
          Approved dates take precedence: you cannot claim a shift that falls inside
          them, and neither can an admin assign one.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3.5" noValidate>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">From</span>
              <input
                type="date"
                className="input input-bordered w-full"
                {...register("starts_on")}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">To</span>
              <input
                type="date"
                className="input input-bordered w-full"
                {...register("ends_on")}
              />
            </label>
          </div>
          {errors.ends_on && (
            <p className="text-sm text-error">{errors.ends_on.message}</p>
          )}

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Reason</span>
            <select className="select select-bordered w-full" {...register("kind")}>
              {TIME_OFF_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k[0].toUpperCase() + k.slice(1)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Note (optional)</span>
            <textarea
              rows={2}
              className="textarea textarea-bordered w-full"
              placeholder="Scheduling context only"
              {...register("note")}
            />
            <span className="mt-1 block text-xs text-base-content/50">
              Scheduling context only — never patient or clinical details.
            </span>
            {errors.note && (
              <span className="text-sm text-error">{errors.note.message}</span>
            )}
          </label>

          <button
            type="submit"
            className="btn btn-primary lift w-full"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span className="loading loading-spinner loading-sm" />
                Submitting…
              </>
            ) : (
              "Request time off"
            )}
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Your requests</h2>
        <div className="surface overflow-hidden">
          {query.isLoading ? (
            <SkeletonRows rows={4} cols={4} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Plane}
              title="No time off requested"
              hint="Blocked dates keep you off the roster and stop overlapping shifts being claimed by mistake."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr className="border-base-300/60">
                    <th>Dates</th>
                    <th>Length</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Note</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const days =
                      differenceInCalendarDays(
                        fromDateInput(row.ends_on),
                        fromDateInput(row.starts_on),
                      ) + 1;
                    return (
                      <tr
                        key={row.id}
                        className="border-base-300/40 transition-colors hover:bg-base-300/25"
                      >
                        <td className="whitespace-nowrap font-medium">
                          {format(fromDateInput(row.starts_on), "d MMM")} –{" "}
                          {format(fromDateInput(row.ends_on), "d MMM yyyy")}
                        </td>
                        <td className="whitespace-nowrap tabular-nums text-base-content/60">
                          {days} day{days === 1 ? "" : "s"}
                        </td>
                        <td className="capitalize text-base-content/70">{row.kind}</td>
                        <td>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[row.status]}`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="max-w-xs truncate text-base-content/55">
                          {row.note || "—"}
                        </td>
                        <td className="text-right">
                          {/* Only pending rows can be withdrawn — matching the RLS
                              policy, which rejects deletes once a decision exists. */}
                          {row.status === "requested" && (
                            <button
                              className="btn btn-ghost btn-xs opacity-60 transition-opacity hover:opacity-100"
                              aria-label="Withdraw request"
                              onClick={() => void withdraw(row.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
