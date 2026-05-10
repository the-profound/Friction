import React, { useMemo } from "react";
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";

export interface ScalePressableProps extends PressableProps {
  scaleTo?: number;
}

const PRESS_DURATION = 80;
const RELEASE_DURATION = 80;
const EASING = Easing.inOut(Easing.ease);

// Properties that control how an element is sized and positioned within its
// parent container. These must live on the outer Animated.View wrapper so
// that flex parents (e.g. a row NavBar or a column form) size the element
// correctly. Visual props (background, border, padding) and internal layout
// props (flexDirection, alignItems) stay exclusively on the Pressable.
export const OUTER_LAYOUT_KEYS = new Set<string>([
  "flex",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "alignSelf",
  "position",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "top",
  "bottom",
  "left",
  "right",
]);

type FlatStyle = Partial<Record<string, unknown>>;

/**
 * Extracts parent-facing layout properties from the user's style.
 *
 * For function styles (pressed-state callbacks), the function is evaluated
 * with `pressed: false` to obtain the base layout. Pressed-state overrides
 * are always visual (opacity, background) — never layout — so this is safe.
 *
 * Margins are intentionally excluded: they stay on the inner Pressable and
 * the Animated.View auto-expands to contain them, producing identical visual
 * spacing in all real call sites.
 */
type StyleFn = (state: Parameters<Extract<PressableProps["style"], (...args: unknown[]) => unknown>>[0]) => StyleProp<ViewStyle>;

export function extractOuterStyle(style: PressableProps["style"]): FlatStyle {
  const base: StyleProp<ViewStyle> =
    typeof style === "function"
      ? (style as StyleFn)({ pressed: false } as Parameters<StyleFn>[0])
      : style;
  const flat = (StyleSheet.flatten(base) ?? {}) as FlatStyle;
  const outer: FlatStyle = {};
  for (const key of OUTER_LAYOUT_KEYS) {
    if (flat[key] !== undefined) {
      outer[key] = flat[key];
    }
  }
  return outer;
}

/**
 * Computes the style to pass to the inner Pressable by stripping out any
 * OUTER_LAYOUT_KEYS that have already been hoisted to the Animated.View
 * wrapper. This breaks the circular flex/height dependency that causes Yoga
 * to resolve the Pressable's height to ~0 in row containers.
 *
 * For function styles the wrapper is preserved so pressed-state visuals
 * (opacity, background changes) still work correctly — only the flat keys
 * in OUTER_LAYOUT_KEYS are omitted from the returned object/array.
 */
export function computeInnerStyle(style: PressableProps["style"]): PressableProps["style"] {
  if (style == null) return style;

  if (typeof style === "function") {
    return (state: Parameters<StyleFn>[0]): StyleProp<ViewStyle> => {
      const resolved = (style as StyleFn)(state);
      return stripOuterKeys(resolved);
    };
  }

  return stripOuterKeys(style);
}

function stripOuterKeys(style: StyleProp<ViewStyle>): StyleProp<ViewStyle> {
  const flat = (StyleSheet.flatten(style) ?? {}) as FlatStyle;
  const inner: FlatStyle = {};
  for (const [key, value] of Object.entries(flat)) {
    if (!OUTER_LAYOUT_KEYS.has(key)) {
      inner[key] = value;
    }
  }
  return inner as ViewStyle;
}

export default function ScalePressable({
  scaleTo = 0.95,
  onPressIn,
  onPressOut,
  style,
  children,
  ...rest
}: ScalePressableProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = (
    e: Parameters<NonNullable<PressableProps["onPressIn"]>>[0],
  ) => {
    scale.value = withTiming(scaleTo, { duration: PRESS_DURATION, easing: EASING });
    onPressIn?.(e);
  };

  const handlePressOut = (
    e: Parameters<NonNullable<PressableProps["onPressOut"]>>[0],
  ) => {
    scale.value = withTiming(1, { duration: RELEASE_DURATION, easing: EASING });
    onPressOut?.(e);
  };

  // Re-extract whenever the style reference changes (e.g. when canSubmit
  // toggles and a new function is passed by the caller).
  const outerStyle = useMemo(() => extractOuterStyle(style), [style]);

  // Strip OUTER_LAYOUT_KEYS from the inner Pressable's style so that
  // hoisted layout props (e.g. flex: 1) don't create a circular height
  // dependency inside the Animated.View wrapper.
  //
  // When the caller passes a function style (pressed-state callback), we must
  // compose a new function rather than placing the callback inside an array,
  // because Pressable only accepts a function OR an array of objects — not an
  // array containing a function.
  const innerStyle = useMemo<PressableProps["style"]>(() => {
    const stripped = computeInnerStyle(style);
    if (typeof stripped === "function") {
      const fn = stripped as StyleFn;
      return (state: Parameters<StyleFn>[0]) => [styles.innerBase, fn(state)];
    }
    return [styles.innerBase, stripped];
  }, [style]);

  return (
    <Animated.View style={[outerStyle, animatedStyle, styles.wrapper]}>
      <Pressable
        style={innerStyle}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        {...rest}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

export const styles = StyleSheet.create({
  wrapper: {
    overflow: "visible",
  },
  innerBase: {
    alignSelf: "stretch",
  },
});
