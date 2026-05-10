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
  };
});

vi.mock("react-native-reanimated", () => ({
  useSharedValue: () => ({ value: 1 }),
  useAnimatedStyle: () => ({}),
  withTiming: (v: unknown) => v,
  Easing: { inOut: () => null, ease: null },
}));

vi.mock("react", () => ({
  useMemo: <T>(fn: () => T) => fn(),
  default: { createElement: () => null },
  createElement: () => null,
}));

const { extractOuterStyle, computeInnerStyle, OUTER_LAYOUT_KEYS } = await import("../ScalePressable");

describe("ScalePressable.extractOuterStyle", () => {
  it("hoists flex layout props to the outer wrapper", () => {
    const out = extractOuterStyle({ flex: 1, alignItems: "center", padding: 12 });
    expect(out).toEqual({ flex: 1 });
  });

  it("hoists width/height and absolute positioning props", () => {
    const out = extractOuterStyle({
      width: 100,
      height: 40,
      position: "absolute",
      top: 0,
      left: 8,
      backgroundColor: "#fff",
    });
    expect(out).toEqual({ width: 100, height: 40, position: "absolute", top: 0, left: 8 });
  });

  it("hoists alignSelf so flex parents can size the wrapper", () => {
    const out = extractOuterStyle({ alignSelf: "stretch", borderRadius: 8 });
    expect(out).toEqual({ alignSelf: "stretch" });
  });

  it("does NOT hoist margins (they stay on the inner Pressable)", () => {
    const out = extractOuterStyle({ margin: 4, marginTop: 8, marginHorizontal: 12, flex: 1 });
    expect(out).toEqual({ flex: 1 });
  });

  it("does NOT hoist visual or inner-layout props", () => {
    const out = extractOuterStyle({
      backgroundColor: "red",
      borderWidth: 1,
      padding: 8,
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: 4,
    });
    expect(out).toEqual({});
  });

  it("flattens style arrays before extraction (NavBar tabItem pattern)", () => {
    const tabItemStyle = { alignItems: "center" as const, justifyContent: "center" as const, gap: 2 };
    const out = extractOuterStyle([tabItemStyle, { flex: 1 }]);
    expect(out).toEqual({ flex: 1 });
  });

  it("evaluates function styles with pressed:false to read base layout", () => {
    const styleFn = ({ pressed }: { pressed: boolean }) => ({
      flex: 1,
      width: 200,
      opacity: pressed ? 0.5 : 1,
    });
    const out = extractOuterStyle(styleFn);
    expect(out).toEqual({ flex: 1, width: 200 });
  });

  it("returns an empty object for null/undefined style", () => {
    expect(extractOuterStyle(undefined)).toEqual({});
    expect(extractOuterStyle(null)).toEqual({});
  });

  it("OUTER_LAYOUT_KEYS does not include margin keys (intentional)", () => {
    expect(OUTER_LAYOUT_KEYS.has("margin")).toBe(false);
    expect(OUTER_LAYOUT_KEYS.has("marginTop")).toBe(false);
    expect(OUTER_LAYOUT_KEYS.has("marginHorizontal")).toBe(false);
  });

  it("OUTER_LAYOUT_KEYS does not include inner-layout keys (intentional)", () => {
    expect(OUTER_LAYOUT_KEYS.has("flexDirection")).toBe(false);
    expect(OUTER_LAYOUT_KEYS.has("justifyContent")).toBe(false);
    expect(OUTER_LAYOUT_KEYS.has("alignItems")).toBe(false);
    expect(OUTER_LAYOUT_KEYS.has("padding")).toBe(false);
  });
});

describe("ScalePressable.computeInnerStyle", () => {
  it("removes OUTER_LAYOUT_KEYS from plain object styles", () => {
    const inner = computeInnerStyle({ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center" });
    expect(inner).not.toHaveProperty("flex");
    expect(inner).toMatchObject({ paddingVertical: 14, borderRadius: 12, alignItems: "center" });
  });

  it("removes width and height from plain object styles", () => {
    const inner = computeInnerStyle({ width: 52, height: 52, borderRadius: 12, backgroundColor: "#DC2626" });
    expect(inner).not.toHaveProperty("width");
    expect(inner).not.toHaveProperty("height");
    expect(inner).toMatchObject({ borderRadius: 12, backgroundColor: "#DC2626" });
  });

  it("removes position and absolute coords from plain object styles", () => {
    const inner = computeInnerStyle({ position: "absolute", top: 0, left: 0, backgroundColor: "red" });
    expect(inner).not.toHaveProperty("position");
    expect(inner).not.toHaveProperty("top");
    expect(inner).not.toHaveProperty("left");
    expect(inner).toMatchObject({ backgroundColor: "red" });
  });

  it("preserves visual and inner-layout props intact", () => {
    const style = {
      backgroundColor: "#F4F4F5",
      borderRadius: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 14,
      gap: 8,
    };
    const inner = computeInnerStyle(style);
    expect(inner).toMatchObject(style);
  });

  it("returns null/undefined as-is", () => {
    expect(computeInnerStyle(null)).toBeNull();
    expect(computeInnerStyle(undefined)).toBeUndefined();
  });

  it("wraps function styles so OUTER_LAYOUT_KEYS are absent from resolved result", () => {
    const styleFn = ({ pressed }: { pressed: boolean }) => ({
      flex: 1,
      paddingVertical: 14,
      opacity: pressed ? 0.5 : 1,
    });
    const innerFn = computeInnerStyle(styleFn) as typeof styleFn;
    expect(typeof innerFn).toBe("function");

    const resolvedUnpressed = innerFn({ pressed: false });
    expect(resolvedUnpressed).not.toHaveProperty("flex");
    expect(resolvedUnpressed).toMatchObject({ paddingVertical: 14, opacity: 1 });

    const resolvedPressed = innerFn({ pressed: true });
    expect(resolvedPressed).not.toHaveProperty("flex");
    expect(resolvedPressed).toMatchObject({ paddingVertical: 14, opacity: 0.5 });
  });

  it("ConfirmModal button pattern: flex:1 removed, visual props preserved", () => {
    const buttonStyle = [
      { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
      { backgroundColor: "#18181B" },
    ];
    const inner = computeInnerStyle(buttonStyle);
    expect(inner).not.toHaveProperty("flex");
    expect(inner).toMatchObject({ paddingVertical: 14, borderRadius: 12, alignItems: "center", backgroundColor: "#18181B" });
  });
});

describe("ScalePressable styles: wrapper overflow", () => {
  it("actual wrapper style exported from ScalePressable has overflow:visible", async () => {
    const { styles } = await import("../ScalePressable");
    expect(styles.wrapper).toHaveProperty("overflow", "visible");
  });

  it("actual innerBase style exported from ScalePressable has alignSelf:stretch", async () => {
    const { styles } = await import("../ScalePressable");
    expect(styles.innerBase).toHaveProperty("alignSelf", "stretch");
  });
});
