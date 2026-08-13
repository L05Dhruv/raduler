"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Activity, ArrowRight, MailCheck, ShieldCheck, TriangleAlert } from "lucide-react";

const schema = z.object({
  email: z.email("Enter a valid work email address"),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const { signIn, user, loading, configured } = useAuth();
  const router = useRouter();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!loading && user) router.replace("/calendar/");
  }, [user, loading, router]);

  const onSubmit = async ({ email }: FormValues) => {
    setError(null);
    try {
      await signIn(email);
      setSentTo(email);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the sign-in link.");
    }
  };

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden p-4">
      {/* A single soft light source behind the card. Static — decorative motion on
          a login screen is noise, and this page is often the first thing seen at
          the start of a night shift. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-primary/12 blur-3xl"
      />

      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="surface dialog-enter relative w-full max-w-md p-7">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-selector bg-primary text-primary-content">
            <Activity className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Raduler</h1>
            <p className="text-sm text-base-content/60">
              Shift scheduling for the radiology group
            </p>
          </div>
        </div>

        {!configured && (
          <div role="alert" className="alert alert-warning mt-5">
            <TriangleAlert className="h-5 w-5" aria-hidden="true" />
            <span className="text-sm">
              Backend not configured — set the Supabase environment variables.
            </span>
          </div>
        )}

        {sentTo ? (
          <div className="dialog-enter mt-6 rounded-box border border-success/30 bg-success/8 p-4">
            <div className="flex gap-3">
              <MailCheck
                className="mt-0.5 h-5 w-5 shrink-0 text-success"
                aria-hidden="true"
              />
              <div role="status">
                <p className="font-medium">Check your email</p>
                <p className="mt-1 text-sm text-base-content/70">
                  A sign-in link is on its way to{" "}
                  <span className="font-medium text-base-content">{sentTo}</span>. It
                  expires shortly and only opens in this browser.
                </p>
                <button
                  className="btn btn-ghost btn-xs mt-3"
                  onClick={() => setSentTo(null)}
                >
                  Use a different address
                </button>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Work email</span>
              <input
                type="email"
                autoComplete="email"
                autoFocus
                placeholder="you@yourpractice.com"
                className={`input input-bordered w-full transition-colors ${
                  errors.email ? "input-error" : ""
                }`}
                aria-invalid={Boolean(errors.email)}
                {...register("email")}
              />
              {errors.email && (
                <span className="mt-1.5 block text-sm text-error">
                  {errors.email.message}
                </span>
              )}
            </label>

            {error && (
              <div role="alert" className="alert alert-error py-2">
                <span className="text-sm">{error}</span>
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary lift group w-full"
              disabled={isSubmitting || !configured}
            >
              {isSubmitting ? (
                <>
                  <span className="loading loading-spinner loading-sm" />
                  Sending…
                </>
              ) : (
                <>
                  Email me a sign-in link
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </>
              )}
            </button>
          </form>
        )}

        <div className="mt-6 flex gap-2.5 rounded-box bg-base-200/70 p-3 text-xs leading-relaxed text-base-content/60">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            Passwordless sign-in, so there is no password to reuse or leak. Access to
            each record is enforced in the database, not in this page. This prototype
            holds staff scheduling data only — never patient information.
          </p>
        </div>
      </div>
    </div>
  );
}
