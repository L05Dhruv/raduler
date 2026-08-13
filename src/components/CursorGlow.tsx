"use client";

import { useEffect, useRef } from "react";
import { easeToward, GLOW_EASING } from "@/lib/easing";

/**
 * An ambient light source that follows the pointer across the login screen.
 *
 * Position is written to CSS custom properties from a single rAF loop rather than
 * React state — a pointermove handler calling setState would re-render the page on
 * every mouse event, which is how this kind of effect usually ends up costing more
 * than it looks like it should.
 *
 * If the loop never starts (coarse pointer, reduced motion, no JS) the CSS defaults
 * leave the glow parked behind the card, exactly as it was before.
 */
export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // No pointer to follow on touch, and chasing the cursor is precisely the kind of
    // ambient movement prefers-reduced-motion exists to suppress.
    const finePointer = window.matchMedia("(pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!finePointer.matches || reducedMotion.matches) return;

    const rest = () => ({ x: window.innerWidth / 2, y: window.innerHeight * 0.28 });

    let target = rest();
    // Mutated in place each frame, never reassigned.
    const current = rest();
    let frame = 0;

    const onMove = (event: PointerEvent) => {
      target = { x: event.clientX, y: event.clientY };
    };
    // Drift home when the pointer leaves, so the glow never sticks to an edge.
    const onLeave = () => {
      target = rest();
    };

    const tick = () => {
      // Easing toward the pointer instead of snapping to it: the lag is what makes
      // this read as a light in the room rather than an object glued to the cursor.
      current.x = easeToward(current.x, target.x, GLOW_EASING);
      current.y = easeToward(current.y, target.y, GLOW_EASING);
      el.style.setProperty("--glow-x", `${current.x}px`);
      el.style.setProperty("--glow-y", `${current.y}px`);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", onLeave);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", onLeave);
    };
  }, []);

  return <div ref={ref} className="cursor-glow" aria-hidden="true" />;
}
