"use client";

import { ViewTransition } from "react";

/**
 * Directional page transitions. Content slides left going deeper and right coming
 * back, which is the one convention strong enough that violating it feels wrong.
 *
 * `default: "none"` matters: without it this animates on every unrelated
 * transition, including browser back/forward and Suspense reveals, which have no
 * direction to express. It must wrap the content inside each `page.tsx` — layouts
 * persist across navigation, so enter and exit never fire there.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition
      enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
      exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}

/**
 * Wraps a loading placeholder and the content that replaces it, so the swap is a
 * handoff rather than a pop. Give the skeleton `mode="out"` and the content
 * `mode="in"`.
 */
export function Reveal({
  mode,
  children,
}: {
  mode: "in" | "out";
  children: React.ReactNode;
}) {
  return mode === "out" ? (
    <ViewTransition exit="reveal-out" default="none">
      {children}
    </ViewTransition>
  ) : (
    <ViewTransition enter="reveal-in" default="none">
      {children}
    </ViewTransition>
  );
}
