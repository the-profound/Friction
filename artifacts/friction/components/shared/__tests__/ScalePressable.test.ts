import { describe, it, expect, vi } from "vitest";

vi.mock("react-native", () => {
  const flatten = (style: unknown): Record<string, unknown> => {
    if (style == null || style === false) return {};
    if (Array.isArray(style)) {
      return style.reduce<Record<string, unknown>>((acc, s) => ({ ...acc, ...flatten(s) }), {});
    }
    if (typeof style === "object") return style as Record<string, unknown>;
    return {};
  };
  return {
    StyleSheet: {
      flatten,
      create: <T extends Record<string, unknown>>(s: T): T => s,
    },
    Pressable: ({ children, onPressIn, onPressOut, style }: Record<string, unknown>) => ({
      type: "Pressable",
      props: { children, onPressIn, onPressOut, style },
    }),
  };
});

vi.mock("react-native-reanimated", () => ({
  useSharedValue: (init: number) => ({ value: init }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withTiming: (v: unknown) => v,
  Easing: { inOut: () => null, ease: null },
  default: {
    View: ({ children, style }: Record<string, unknown>) => ({
      type: "Animated.View",
      props: { children, style },
    }),
  },
}));

vi.mock("react", () => ({
  default: { createElement: () => null },
  createElement: () => null,
}));

describe("ScalePressable styles: inner animation wrapper", () => {
  it("inner style has overflow:visible so scale does not clip children", async () => {
    const { styles } = await import("../ScalePressable");
    expect(styles.inner).toHaveProperty("overflow", "visible");
  });

  it("inner style has alignSelf:stretch so Animated.View fills the Pressable", async () => {
    const { styles } = await import("../ScalePressable");
    expect(styles.inner).toHaveProperty("alignSelf", "stretch");
  });

  it("inner style has flexShrink:0 and flexGrow:1 so fixed-size buttons fill their height", async () => {
    const { styles } = await import("../ScalePressable");
    expect(styles.inner).toHaveProperty("flexShrink", 0);
    expect(styles.inner).toHaveProperty("flexGrow", 1);
    expect((styles.inner as Record<string, unknown>)["flex"]).toBeUndefined();
  });
});

describe("ScalePressable: module exports", () => {
  it("exports a default function (the component)", async () => {
    const mod = await import("../ScalePressable");
    expect(typeof mod.default).toBe("function");
  });

  it("exports a styles object with the inner key", async () => {
    const { styles } = await import("../ScalePressable");
    expect(styles).toHaveProperty("inner");
    expect(typeof styles.inner).toBe("object");
  });

  it("does NOT export OUTER_LAYOUT_KEYS (workaround removed)", async () => {
    const mod = await import("../ScalePressable") as Record<string, unknown>;
    expect(mod["OUTER_LAYOUT_KEYS"]).toBeUndefined();
  });

  it("does NOT export extractOuterStyle (workaround removed)", async () => {
    const mod = await import("../ScalePressable") as Record<string, unknown>;
    expect(mod["extractOuterStyle"]).toBeUndefined();
  });

  it("does NOT export computeInnerStyle (workaround removed)", async () => {
    const mod = await import("../ScalePressable") as Record<string, unknown>;
    expect(mod["computeInnerStyle"]).toBeUndefined();
  });
});

describe("computeAdaptiveScale: adaptive press scale calculation", () => {
  it("returns DEFAULT_SCALE (0.95) when maxDimension is 0 (not yet measured)", async () => {
    const { computeAdaptiveScale } = await import("../ScalePressable");
    expect(computeAdaptiveScale(0)).toBe(0.95);
  });

  it("returns DEFAULT_SCALE (0.95) when maxDimension is negative", async () => {
    const { computeAdaptiveScale } = await import("../ScalePressable");
    expect(computeAdaptiveScale(-1)).toBe(0.95);
  });

  it("applies scale floor (0.90) for small elements (32px icon button)", async () => {
    const { computeAdaptiveScale } = await import("../ScalePressable");
    // 32 * 0.025 = 0.8px < 2px minimum → clamp to 2px
    // raw scale = 1 - (2 * 2) / 32 = 0.875 → floored to 0.90
    expect(computeAdaptiveScale(32)).toBeCloseTo(0.9, 5);
  });

  it("applies scale floor (0.90) for 40px pill button (edge movement below minimum)", async () => {
    const { computeAdaptiveScale } = await import("../ScalePressable");
    // 40 * 0.025 = 1px < 2px → clamp to 2px
    // scale = 1 - 4/40 = 0.90 exactly (right at the floor)
    expect(computeAdaptiveScale(40)).toBeCloseTo(0.9, 5);
  });

  it("returns 0.95 for mid-size elements (120px), matching current default behaviour", async () => {
    const { computeAdaptiveScale } = await import("../ScalePressable");
    // 120 * 0.025 = 3px ∈ [2, 5] → no clamping
    // scale = 1 - (2 * 3) / 120 = 0.95 exactly
    expect(computeAdaptiveScale(120)).toBeCloseTo(0.95, 5);
  });

  it("returns 0.95 for any size in the 80–200px neutral zone", async () => {
    const { computeAdaptiveScale } = await import("../ScalePressable");
    // In [80, 200], rawEdge = size * 0.025 ∈ [2, 5] → no clamping
    // scale = 1 - 2 * 0.025 = 0.95 regardless of size
    expect(computeAdaptiveScale(80)).toBeCloseTo(0.95, 5);
    expect(computeAdaptiveScale(160)).toBeCloseTo(0.95, 5);
    expect(computeAdaptiveScale(200)).toBeCloseTo(0.95, 5);
  });

  it("returns a scale noticeably closer to 1 for large elements (350px space card)", async () => {
    const { computeAdaptiveScale } = await import("../ScalePressable");
    // 350 * 0.025 = 8.75px > 5px → clamp to 5px
    // scale = 1 - (2 * 5) / 350 ≈ 0.9714
    const result = computeAdaptiveScale(350);
    expect(result).toBeGreaterThan(0.95);
    expect(result).toBeCloseTo(1 - 10 / 350, 5);
  });

  it("returns a scale very close to 1 for very large elements (600px full-width card)", async () => {
    const { computeAdaptiveScale } = await import("../ScalePressable");
    // 600 * 0.025 = 15px > 5px → clamp to 5px
    // scale = 1 - (2 * 5) / 600 ≈ 0.9833
    const result = computeAdaptiveScale(600);
    expect(result).toBeGreaterThan(0.97);
    expect(result).toBeCloseTo(1 - 10 / 600, 5);
  });

  it("never returns a scale below SCALE_FLOOR (0.90)", async () => {
    const { computeAdaptiveScale } = await import("../ScalePressable");
    // Very small elements would compute < 0.90 without the floor
    expect(computeAdaptiveScale(1)).toBeCloseTo(0.9, 5);
    expect(computeAdaptiveScale(10)).toBeCloseTo(0.9, 5);
    expect(computeAdaptiveScale(20)).toBeCloseTo(0.9, 5);
  });
});

describe("ScalePressable: props type compatibility", () => {
  it("accepts function children (pressed-state render prop)", async () => {
    const mod = await import("../ScalePressable");
    type Props = Parameters<typeof mod.default>[0];
    type Children = Props["children"];
    type FnChild = (state: { pressed: boolean }) => null;
    const isFnAssignable: FnChild extends Children ? true : false = true;
    expect(isFnAssignable).toBe(true);
  });

  it("accepts ReactNode children", async () => {
    const mod = await import("../ScalePressable");
    type Props = Parameters<typeof mod.default>[0];
    type Children = Props["children"];
    type NodeChild = null;
    const isNodeAssignable: NodeChild extends Children ? true : false = true;
    expect(isNodeAssignable).toBe(true);
  });

  it("accepts function style (pressed-state callback)", async () => {
    const mod = await import("../ScalePressable");
    type Props = Parameters<typeof mod.default>[0];
    type StyleProp = Props["style"];
    type FnStyle = (state: { pressed: boolean }) => object;
    const isFnStyleAssignable: FnStyle extends StyleProp ? true : false = true;
    expect(isFnStyleAssignable).toBe(true);
  });
});
