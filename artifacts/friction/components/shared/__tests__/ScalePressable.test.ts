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
  return { StyleSheet: { flatten } };
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

const { extractOuterStyle, OUTER_LAYOUT_KEYS } = await import("../ScalePressable");

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
