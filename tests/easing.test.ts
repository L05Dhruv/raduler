import { describe, expect, it } from "vitest";
import { easeToward, GLOW_EASING } from "@/lib/easing";

describe("easeToward", () => {
  it("moves toward the target", () => {
    expect(easeToward(0, 100, 0.5)).toBe(50);
  });

  it("moves toward a target behind it", () => {
    expect(easeToward(100, 0, 0.5)).toBe(50);
  });

  it("never overshoots", () => {
    let position = 0;
    for (let i = 0; i < 200; i++) {
      position = easeToward(position, 100, GLOW_EASING);
      expect(position).toBeLessThanOrEqual(100);
    }
  });

  it("settles exactly on the target rather than creeping forever", () => {
    let position = 0;
    for (let i = 0; i < 400; i++) position = easeToward(position, 100, GLOW_EASING);
    expect(position).toBe(100);
  });

  it("stays put once it has arrived", () => {
    expect(easeToward(100, 100, GLOW_EASING)).toBe(100);
  });

  it("covers most of the gap within half a second at 60fps", () => {
    // 30 frames ≈ 500ms. The glow should have caught up enough to read as
    // following the pointer rather than lagging behind it.
    let position = 0;
    for (let i = 0; i < 30; i++) position = easeToward(position, 100, GLOW_EASING);
    expect(position).toBeGreaterThan(80);
  });
});
