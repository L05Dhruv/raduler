"use client";

import { useState } from "react";
import useSWR from "swr";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Trash2 } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppShell } from "@/components/AppShell";
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
        <TimeOffManager />
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

const STATUS_BADGE: Record<TimeOff["status"], string> = {
  requested: "badge-ghost",
  approved: "badge-success",
  denied: "badge-error",
};

function TimeOffManager() {
  const { profile } = useAuth();
  const [error, setError] = useState<string | null>(null);

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
  const loading = query.isLoading;
  const loadError = (query.error as Error | undefined)?.message ?? null;

  const onSubmit = async (values: FormValues) => {
    if (!profile) return;
    setError(null);
    try {
      await requestTimeOff(profile.id, values);
      reset({ starts_on: today, ends_on: today, kind: "vacation", note: "" });
      await query.mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit the request.");
    }
  };

  const withdraw = async (id: string) => {
    setError(null);
    try {
      await withdrawTimeOff(id);
      await query.mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not withdraw the request.");
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <section className="card h-fit bg-base-100 shadow-sm">
        <div className="card-body">
          <h2 className="card-title text-lg">Block off dates</h2>
          <p className="text-sm text-base-content/70">
            Approved dates take precedence: you cannot claim a shift that falls inside
            them, and neither can an admin assign one.
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-3 space-y-3" noValidate>
            <div className="grid grid-cols-2 gap-2">
              <div className="form-control">
                <label className="label" htmlFor="starts_on">
                  <span className="label-text">From</span>
                </label>
                <input
                  id="starts_on"
                  type="date"
                  className="input input-bordered"
                  {...register("starts_on")}
                />
              </div>
              <div className="form-control">
                <label className="label" htmlFor="ends_on">
                  <span className="label-text">To</span>
                </label>
                <input
                  id="ends_on"
                  type="date"
                  className="input input-bordered"
                  {...register("ends_on")}
                />
              </div>
            </div>
            {errors.ends_on && (
              <p className="text-sm text-error">{errors.ends_on.message}</p>
            )}

            <div className="form-control">
              <label className="label" htmlFor="kind">
                <span className="label-text">Reason</span>
              </label>
              <select id="kind" className="select select-bordered" {...register("kind")}>
                {TIME_OFF_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k[0].toUpperCase() + k.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-control">
              <label className="label" htmlFor="note">
                <span className="label-text">Note (optional)</span>
              </label>
              <textarea
                id="note"
                rows={2}
                className="textarea textarea-bordered"
                placeholder="Scheduling context only"
                {...register("note")}
              />
              <span className="mt-1 text-xs text-base-content/60">
                Scheduling context only — never patient or clinical details.
              </span>
              {errors.note && (
                <span className="text-sm text-error">{errors.note.message}</span>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Submitting…" : "Request time off"}
            </button>
          </form>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Your requests</h2>
        {(error ?? loadError) && (
          <div role="alert" className="alert alert-error">
            <span className="text-sm">{error ?? loadError}</span>
          </div>
        )}
        <div className="overflow-x-auto rounded-box bg-base-100 shadow-sm">
          <table className="table">
            <thead>
              <tr>
                <th>Dates</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="py-8 text-center">
                    <span className="loading loading-spinner" aria-label="Loading" />
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-base-content/60">
                    No time off requested yet.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap">
                    {format(fromDateInput(row.starts_on), "d MMM yyyy")} –{" "}
                    {format(fromDateInput(row.ends_on), "d MMM yyyy")}
                  </td>
                  <td className="capitalize">{row.kind}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[row.status]} badge-sm`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="max-w-xs truncate text-base-content/70">
                    {row.note || "—"}
                  </td>
                  <td className="text-right">
                    {/* Only pending rows can be withdrawn — matching the RLS policy,
                        which rejects deletes once a decision has been recorded. */}
                    {row.status === "requested" && (
                      <button
                        className="btn btn-ghost btn-xs"
                        aria-label="Withdraw request"
                        onClick={() => void withdraw(row.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
