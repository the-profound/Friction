import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityActionEvent,
  LayoutChangeEvent,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  getHsvFromHex,
  getHueAtPosition,
  getSpectrumAtPosition,
  hsvToHex,
  type HsvColor,
} from "@/lib/articleCoverColors";
import { Colors, Typography } from "@/constants/tokens";

// expo-linear-gradient's current SDK type is based on an older React base
// definition than the app's React 19 JSX setup. The runtime component is shared
// across platforms; this matches the existing expo-image compatibility bridge.
const Gradient = LinearGradient as unknown as React.ComponentType<any>;

const HUE_GRADIENT_COLORS = [
  "#FF0000",
  "#FFFF00",
  "#00FF00",
  "#00FFFF",
  "#0000FF",
  "#FF00FF",
  "#FF0000",
] as const;
const DEFAULT_HSV: HsvColor = { h: 0, s: 0, v: 1 };
const MARKER_SIZE = 22;
const TOUCH_HEIGHT = 44;

interface ColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  testID: string;
  disabled?: boolean;
  /**
   * Optional element rendered at the trailing end of the label/hex-code row,
   * vertically centered alongside it (e.g. the cover editor's "사진 추가"
   * button, which must sit on the same line as "배경 색상 #FAFAFA" rather
   * than in its own row above the picker).
   */
  accessory?: React.ReactNode;
}

interface PickerSize {
  width: number;
  height: number;
}

export default function ColorPicker({
  value,
  onChange,
  label,
  testID,
  disabled = false,
  accessory,
}: ColorPickerProps) {
  const [hsv, setHsv] = useState<HsvColor>(() =>
    getHsvFromHex(value, DEFAULT_HSV),
  );
  const [spectrumSize, setSpectrumSize] = useState<PickerSize>({
    width: 0,
    height: 0,
  });
  const [hueSize, setHueSize] = useState<PickerSize>({ width: 0, height: 0 });
  const lastValueRef = useRef(value);

  useEffect(() => {
    if (value === lastValueRef.current) return;
    const next = getHsvFromHex(value, DEFAULT_HSV);
    setHsv(next);
    lastValueRef.current = value;
  }, [value]);

  const commit = useCallback(
    (next: HsvColor) => {
      if (disabled) return;
      const nextValue = hsvToHex(next);
      setHsv(next);
      lastValueRef.current = nextValue;
      onChange(nextValue);
    },
    [disabled, onChange],
  );

  const updateSpectrum = useCallback(
    (x: number, y: number) => {
      const width = spectrumSize.width;
      const height = spectrumSize.height;
      if (width <= 0 || height <= 0) return;
      commit(getSpectrumAtPosition(hsv, x, y, width, height));
    },
    [commit, hsv, spectrumSize],
  );

  const updateHue = useCallback(
    (x: number) => {
      const width = hueSize.width;
      if (width <= 0) return;
      commit({
        ...hsv,
        h: getHueAtPosition(x, width),
      });
    },
    [commit, hueSize, hsv],
  );

  const handleSpectrumLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSpectrumSize((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  }, []);

  const handleHueLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setHueSize((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  }, []);

  const handleSpectrumTouch = useCallback(
    (event: { nativeEvent: { locationX: number; locationY: number } }) => {
      updateSpectrum(event.nativeEvent.locationX, event.nativeEvent.locationY);
    },
    [updateSpectrum],
  );

  const handleHueTouch = useCallback(
    (event: { nativeEvent: { locationX: number } }) => {
      updateHue(event.nativeEvent.locationX);
    },
    [updateHue],
  );

  const handleSpectrumAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const { actionName } = event.nativeEvent;
      if (actionName === "increment") {
        commit({ ...hsv, s: Math.min(1, hsv.s + 0.05) });
      } else if (actionName === "decrement") {
        commit({ ...hsv, s: Math.max(0, hsv.s - 0.05) });
      } else if (actionName === "increase-brightness") {
        commit({ ...hsv, v: Math.min(1, hsv.v + 0.05) });
      } else if (actionName === "decrease-brightness") {
        commit({ ...hsv, v: Math.max(0, hsv.v - 0.05) });
      }
    },
    [commit, hsv],
  );

  const handleHueAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const step = event.nativeEvent.actionName === "increment" ? 5 : -5;
      if (
        event.nativeEvent.actionName !== "increment" &&
        event.nativeEvent.actionName !== "decrement"
      ) {
        return;
      }
      commit({ ...hsv, h: (hsv.h + step + 360) % 360 });
    },
    [commit, hsv],
  );

  const spectrumWidth = spectrumSize.width || 1;
  const spectrumHeight = spectrumSize.height || 1;
  const normalizedValue = hsvToHex(hsv);

  return (
    <View
      style={[styles.container, disabled && styles.disabled]}
      testID={testID}
      pointerEvents={disabled ? "none" : "auto"}
      accessibilityState={{ disabled }}
    >
      <View style={styles.valueRow}>
        <View style={styles.valueMain}>
          <View
            style={[styles.valueSwatch, { backgroundColor: normalizedValue }]}
            accessible
            accessibilityLabel={`${label} 미리보기 ${normalizedValue}`}
          />
          <View style={styles.valueTextGroup}>
            <Text style={styles.valueLabel}>{label}</Text>
            <Text style={styles.valueText}>{normalizedValue}</Text>
          </View>
        </View>
        {accessory ? <View style={styles.valueAccessory}>{accessory}</View> : null}
      </View>

      <View
        style={styles.spectrumTouchTarget}
        onLayout={handleSpectrumLayout}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={handleSpectrumTouch}
        onResponderMove={handleSpectrumTouch}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`${label} 채도와 명도`}
        accessibilityHint="색상 영역을 탭하거나 드래그해 채도와 명도를 선택하세요."
        accessibilityValue={{
          min: 0,
          max: 100,
          now: Math.round(hsv.s * 100),
          text: normalizedValue,
        }}
        accessibilityActions={[
          { name: "increment", label: "채도를 높입니다" },
          { name: "decrement", label: "채도를 낮춥니다" },
          { name: "increase-brightness", label: "명도를 높입니다" },
          { name: "decrease-brightness", label: "명도를 낮춥니다" },
        ]}
        onAccessibilityAction={handleSpectrumAccessibilityAction}
        testID={`${testID}-spectrum`}
      >
        <View style={styles.spectrum}>
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }) }]}
          />
          <Gradient
            colors={["#FFFFFF", "rgba(255,255,255,0)"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <Gradient
            colors={["rgba(0,0,0,0)", "#000000"]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View
            pointerEvents="none"
            style={[
              styles.spectrumMarker,
              {
                left: Math.min(
                  Math.max(0, hsv.s * spectrumWidth - MARKER_SIZE / 2),
                  Math.max(0, spectrumWidth - MARKER_SIZE),
                ),
                top: Math.min(
                  Math.max(0, (1 - hsv.v) * spectrumHeight - MARKER_SIZE / 2),
                  Math.max(0, spectrumHeight - MARKER_SIZE),
                ),
              },
            ]}
          />
        </View>
      </View>

      <View
        style={styles.hueTouchTarget}
        onLayout={handleHueLayout}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={handleHueTouch}
        onResponderMove={handleHueTouch}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`${label} 색조`}
        accessibilityHint="색조 막대를 탭하거나 드래그해 색조를 선택하세요."
        accessibilityValue={{
          min: 0,
          max: 360,
          now: Math.round(hsv.h),
          text: normalizedValue,
        }}
        accessibilityActions={[
          { name: "increment", label: "다음 색조" },
          { name: "decrement", label: "이전 색조" },
        ]}
        onAccessibilityAction={handleHueAccessibilityAction}
        testID={`${testID}-hue`}
      >
        <Gradient
          colors={HUE_GRADIENT_COLORS}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.hue}
          pointerEvents="none"
        />
        <View
          pointerEvents="none"
          style={[
            styles.hueMarker,
            {
              left: Math.min(
                Math.max(
                  0,
                  (hsv.h / 360) * (hueSize.width || 1) - MARKER_SIZE / 2,
                ),
                Math.max(0, (hueSize.width || 1) - MARKER_SIZE),
              ),
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    gap: 10,
  },
  disabled: {
    opacity: 0.55,
  },
  valueRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  valueMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 1,
  },
  valueAccessory: {
    flexShrink: 0,
  },
  valueSwatch: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.zinc200,
  },
  valueTextGroup: {
    gap: 1,
  },
  valueLabel: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  valueText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc800,
    letterSpacing: 0.4,
  },
  spectrumTouchTarget: {
    width: "100%",
    height: 184,
  },
  spectrum: {
    flex: 1,
    borderRadius: 10,
    position: "relative",
  },
  spectrumMarker: {
    position: "absolute",
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderRadius: MARKER_SIZE / 2,
    borderWidth: 3,
    borderColor: Colors.white,
    backgroundColor: "transparent",
    ...Platform.select({
      ios: {
        shadowColor: Colors.black,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.45,
        shadowRadius: 2,
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  hueTouchTarget: {
    width: "100%",
    height: TOUCH_HEIGHT,
    justifyContent: "center",
    position: "relative",
  },
  hue: {
    width: "100%",
    height: TOUCH_HEIGHT,
    borderRadius: 14,
  },
  hueMarker: {
    position: "absolute",
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    top: (TOUCH_HEIGHT - MARKER_SIZE) / 2,
    borderRadius: MARKER_SIZE / 2,
    borderWidth: 3,
    borderColor: Colors.white,
    backgroundColor: "transparent",
    ...Platform.select({
      ios: {
        shadowColor: Colors.black,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.45,
        shadowRadius: 2,
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
});