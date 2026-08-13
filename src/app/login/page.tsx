"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { MailCheck, ShieldCheck, TriangleAlert } from "lucide-react";

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
    <div className="flex min-h-screen items-center justify-center bg-base-200 p-4">
      <div className="card w-full max-w-md bg-base-100 shadow-xl">
        <div className="card-body">
          <h1 className="text-2xl font-semibold tracking-tight">Raduler</h1>
          <p className="text-sm text-base-content/70">
            Shift scheduling for the radiology group.
          </p>

          {!configured && (
            <div role="alert" className="alert alert-warning mt-4">
              <TriangleAlert className="h-5 w-5" aria-hidden="true" />
              <span className="text-sm">
                Backend not configured — set the Supabase environment variables.
              </span>
            </div>
          )}

          {sentTo ? (
            <div role="status" className="alert alert-success mt-6">
              <MailCheck className="h-5 w-5" aria-hidden="true" />
              <div>
                <p className="font-medium">Check your email</p>
                <p className="text-sm">
                  A sign-in link is on its way to {sentTo}. It expires shortly and can
                  only be opened in this browser.
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4" noValidate>
              <div className="form-control">
                <label className="label" htmlFor="email">
                  <span className="label-text">Work email</span>
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@yourpractice.com"
                  className={`input input-bordered w-full ${errors.email ? "input-error" : ""}`}
                  aria-invalid={Boolean(errors.email)}
                  {...register("email")}
                />
                {errors.email && (
                  <span className="mt-1 text-sm text-error">{errors.email.message}</span>
                )}
              </div>

              {error && (
                <div role="alert" className="alert alert-error">
                  <span className="text-sm">{error}</span>
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary w-full"
                disabled={isSubmitting || !configured}
              >
                {isSubmitting ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>
          )}

          <div className="mt-6 flex gap-2 rounded-lg bg-base-200 p-3 text-xs text-base-content/70">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              Passwordless sign-in, so there is no password to reuse or leak. Access to
              each record is enforced in the database, not in this page. This prototype
              holds staff scheduling data only — never patient information.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
