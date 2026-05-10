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

  it("inner style has flex:1 so Animated.View expands to fill the Pressable", async () => {
    const { styles } = await import("../ScalePressable");
    expect(styles.inner).toHaveProperty("flex", 1);
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
