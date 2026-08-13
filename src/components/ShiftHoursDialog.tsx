"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Clock, RotateCcw } from "lucide-react";

/**
 * Collects a start and end time. Used for one shift and for a whole month, which differ
 * only in their copy and in what the caller does with the pair.
 *
 * The dialog does not know the rules. `onSubmit` resolves the times against the shift
 * and talks to the database, then either returns a reason — shown here, beside the
 * inputs the user is still looking at — or nothing, which closes the dialog. Keeping
 * refusals in the form rather than in a toast matters because most of them are
 * corrigible: "outside the published shift" is an instruction, not a notification.
 */

const TIME_MESSAGE = "Use a 24-hour time, like 13:00.";
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const schema = z.object({
  startTime: z.string().regex(TIME_PATTERN, TIME_MESSAGE),
  endTime: z.string().regex(TIME_PATTERN, TIME_MESSAGE),
});

type FormValues = z.infer<typeof schema>;

export function ShiftHoursDialog({
  title,
  description,
  initialStart,
  initialEnd,
  submitLabel,
  resetLabel,
  onSubmit,
  onReset,
  onClose,
}: {
  title: string;
  description: React.ReactNode;
  initialStart: string;
  initialEnd: string;
  submitLabel: string;
  /** Omitted when there is nothing to restore. */
  resetLabel?: string;
  /** Returns a reason to show, or null once the change has gone through. */
  onSubmit: (startTime: string, endTime: string) => Promise<string | null>;
  onReset?: () => Promise<string | null>;
  onClose: () => void;
}) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { startTime: initialStart, endTime: initialEnd },
  });

  // Escape closes. A dialog that traps someone mid-edit is worse than one that lets
  // them out, and nothing here is destructive enough to need confirming.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const submit = async (values: FormValues) => {
    const reason = await onSubmit(values.startTime, values.endTime);
    if (reason) setError("root", { message: reason });
    else onClose();
  };

  const reset = async () => {
    if (!onReset) return;
    const reason = await onReset();
    if (reason) setError("root", { message: reason });
    else onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-base-300/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hours-title"
      onClick={onClose}
    >
      <div
        className="surface dialog-enter w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-base-300/60">
            <Clock className="h-4 w-4 text-base-content/60" aria-hidden="true" />
          </span>
          <div>
            <h2 id="hours-title" className="text-lg font-semibold">
              {title}
            </h2>
            <p className="mt-1 text-sm text-base-content/70">{description}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit(submit)} className="mt-5 space-y-3" noValidate>
          <div className="grid grid-cols-2 gap-2">
            <label className="form-control block">
              <span className="label-text mb-1 block">Start</span>
              <input
                type="time"
                autoFocus
                className="input input-bordered w-full tabular-nums"
                {...register("startTime")}
              />
              {errors.startTime && (
                <span className="mt-1 block text-sm text-error">
                  {errors.startTime.message}
                </span>
              )}
            </label>
            <label className="form-control block">
              <span className="label-text mb-1 block">End</span>
              <input
                type="time"
                className="input input-bordered w-full tabular-nums"
                {...register("endTime")}
              />
              {errors.endTime && (
                <span className="mt-1 block text-sm text-error">
                  {errors.endTime.message}
                </span>
              )}
            </label>
          </div>

          {errors.root && (
            <p className="text-sm text-error" role="alert">
              {errors.root.message}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            {resetLabel && onReset && (
              <button
                type="button"
                className="btn btn-ghost btn-sm mr-auto gap-1.5"
                disabled={isSubmitting}
                onClick={() => void reset()}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {resetLabel}
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={isSubmitting}
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={isSubmitting}>
              {isSubmitting ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                submitLabel
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
