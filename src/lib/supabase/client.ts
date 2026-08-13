import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * The anon key is compiled into the bundle and the repository is public. That is the
 * intended deployment: it is a *publishable* key that authorises nothing by itself.
 * Postgres RLS decides what each signed-in JWT may read or write. The `service_role`
 * key bypasses RLS entirely and must never appear in this project.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  if (!cached) {
    cached = createClient(url!, anonKey!, {
      auth: {
        // PKCE keeps the code verifier in this browser, so an intercepted magic link
        // cannot be redeemed anywhere else.
        flowType: "pkce",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return cached;
}
