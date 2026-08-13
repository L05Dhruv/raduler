/**
 * Per-frame exponential easing: move a fraction of the remaining distance toward the
 * target each frame. Pure, so the motion can be tested without a browser — animation
 * frames are paused in hidden tabs, which makes the effect itself awkward to assert on.
 */
export function easeToward(current: number, target: number, factor: number): number {
  const next = current + (target - current) * factor;
  // Below a subpixel the easing would creep toward the target forever, keeping an
  // animation frame scheduled for movement nobody can see.
  return Math.abs(target - next) < 0.01 ? target : next;
}

/** ~5.5% of the gap per frame: settles in about half a second at 60fps. */
export const GLOW_EASING = 0.055;
