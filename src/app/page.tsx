"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { BootScreen } from "@/components/auth/RequireAuth";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/calendar/" : "/login/");
  }, [user, loading, router]);

  return <BootScreen />;
}
