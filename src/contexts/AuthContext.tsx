"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { absoluteUrl } from "@/lib/paths";
import type { Profile } from "@/types/db";

/** Reading rooms are shared workstations, so an unattended session gets closed. */
const IDLE_LIMIT_MS = 15 * 60 * 1000;
const IDLE_WARNING_MS = 60 * 1000;

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  configured: boolean;
  /** Seconds left before an idle sign-out, or null when the user is active. */
  idleCountdown: number | null;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  stayActive: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // With no backend configured there is nothing to wait for, so we are never loading.
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [idleCountdown, setIdleCountdown] = useState<number | null>(null);
  // Seeded in the idle effect rather than during render — Date.now() is impure.
  const lastActivity = useRef(0);

  const loadProfile = useCallback(async (session: Session | null) => {
    if (!session) {
      setProfile(null);
      return;
    }
    const { data, error } = await getSupabase()
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .maybeSingle();
    if (error) {
      console.error("Failed to load profile", error.message);
      setProfile(null);
      return;
    }
    setProfile(data as Profile | null);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();

    // onAuthStateChange fires once on mount with the restored session, so it doubles
    // as the initial session check — no separate /api/auth/session round trip.
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        void loadProfile(session).finally(() => setLoading(false));
      },
    );

    // Guard against the callback never firing (e.g. storage blocked).
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) setLoading(false);
    });

    return () => subscription.subscription.unsubscribe();
  }, [loadProfile]);

  const signIn = useCallback(async (email: string) => {
    const { error } = await getSupabase().auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: absoluteUrl("/auth/callback/"),
        // No implicit account creation: an unknown address should be an admin's
        // decision, not a side effect of typing it into the login box.
        shouldCreateUser: true,
      },
    });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured) await getSupabase().auth.signOut();
    setUser(null);
    setProfile(null);
    setIdleCountdown(null);
  }, []);

  const stayActive = useCallback(() => {
    lastActivity.current = Date.now();
    setIdleCountdown(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data } = await getSupabase().auth.getSession();
    await loadProfile(data.session);
  }, [loadProfile]);

  // Idle tracking. Only runs while signed in, so the login page has no timers.
  useEffect(() => {
    if (!user) return;

    const bump = () => {
      lastActivity.current = Date.now();
    };
    bump();
    const events = ["mousedown", "keydown", "touchstart", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));

    const tick = window.setInterval(() => {
      const idleFor = Date.now() - lastActivity.current;
      const remaining = IDLE_LIMIT_MS - idleFor;
      if (remaining <= 0) {
        void signOut();
      } else if (remaining <= IDLE_WARNING_MS) {
        setIdleCountdown(Math.ceil(remaining / 1000));
      } else {
        setIdleCountdown((prev) => (prev === null ? null : null));
      }
    }, 1000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(tick);
    };
  }, [user, signOut]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      isAdmin: profile?.role === "admin",
      configured: isSupabaseConfigured,
      idleCountdown,
      signIn,
      signOut,
      stayActive,
      refreshProfile,
    }),
    [user, profile, loading, idleCountdown, signIn, signOut, stayActive, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
