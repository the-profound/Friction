import React, { useRef, useState } from "react";
import { View, Text, StyleSheet, Platform, Animated } from "react-native";
import { MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import ScalePressable from "@/components/shared/ScalePressable";

export type FormatType = "bold" | "italic" | "underline" | "quote";

interface MemoToolbarProps {
  onDismissKeyboard: () => void;
  onFormat?: (type: FormatType) => void;
  activeFormats?: Set<FormatType>;
  onOpenQuotePicker?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

const CROSS_FADE_MS = 80;

export default function MemoToolbar({
  onDismissKeyboard,
  onFormat,
  activeFormats,
  onOpenQuotePicker,
  onUndo,
  onRedo,
}: MemoToolbarProps) {
  // true = format layer on top; controls pointerEvents immediately on press
  const [isFormat, setIsFormat] = useState(false);
  // 0 = main fully visible, 1 = format fully visible
  const transition = useRef(new Animated.Value(0)).current;

  const mainOpacity = transition.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const formatOpacity = transition;

  const goFormat = () => {
    setIsFormat(true);
    Animated.timing(transition, {
      toValue: 1,
      duration: CROSS_FADE_MS,
      useNativeDriver: true,
    }).start();
  };

  const goMain = () => {
    setIsFormat(false);
    Animated.timing(transition, {
      toValue: 0,
      duration: CROSS_FADE_MS,
      useNativeDriver: true,
    }).start();
  };

  const isBoldActive = activeFormats?.has("bold");
  const isItalicActive = activeFormats?.has("italic");
  const isUnderlineActive = activeFormats?.has("underline");
  const isQuoteActive = activeFormats?.has("quote");

  return (
    <View style={styles.outerWrap}>
      <View style={styles.capsule}>
        {/*
         * Both layers are always mounted and stacked.
         * Main layer sits in normal flow → sizes the capsule.
         * Format layer is absolutely positioned on top → same footprint.
         * pointerEvents flips instantly on press so touches are never lost.
         */}

        {/* ── Main layer ── */}
        <Animated.View
          style={[styles.row, { opacity: mainOpacity }]}
          pointerEvents={isFormat ? "none" : "auto"}
        >
          <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={goFormat} hitSlop={6}>
            <Text style={styles.aaLabel}>Aa</Text>
          </ScalePressable>

          <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={onOpenQuotePicker} hitSlop={6}>
            <Feather name="message-square" size={16} color="#3f3f46" />
          </ScalePressable>

          <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={undefined} hitSlop={6}>
            <Feather name="image" size={16} color="#3f3f46" />
          </ScalePressable>

          <View style={styles.divider} />

          <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={onUndo} hitSlop={6}>
            <Feather name="corner-up-left" size={16} color="#3f3f46" />
          </ScalePressable>

          <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={onRedo} hitSlop={6}>
            <Feather name="corner-up-right" size={16} color="#3f3f46" />
          </ScalePressable>

          <View style={styles.divider} />

          <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={onDismissKeyboard} hitSlop={8}>
            <MaterialCommunityIcons name="keyboard-off-outline" size={20} color="#3f3f46" />
          </ScalePressable>
        </Animated.View>

        {/* ── Format layer (absolute, same footprint as main) ── */}
        <Animated.View
          style={[styles.row, styles.absoluteLayer, { opacity: formatOpacity }]}
          pointerEvents={isFormat ? "auto" : "none"}
        >
          <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={goMain} hitSlop={6}>
            <Feather name="arrow-left" size={16} color="#3f3f46" />
          </ScalePressable>

          <View style={styles.divider} />

          <ScalePressable style={[styles.btn, isBoldActive && styles.btnActive]} contentStyle={styles.btnContent} onPress={() => onFormat?.("bold")} hitSlop={6}>
            <Text style={[styles.fmtLabel, styles.bold, isBoldActive && styles.fmtLabelActive]}>B</Text>
          </ScalePressable>

          <ScalePressable style={[styles.btn, isItalicActive && styles.btnActive]} contentStyle={styles.btnContent} onPress={() => onFormat?.("italic")} hitSlop={6}>
            <Text style={[styles.fmtLabel, styles.italic, isItalicActive && styles.fmtLabelActive]}>I</Text>
          </ScalePressable>

          <ScalePressable style={[styles.btn, isUnderlineActive && styles.btnActive]} contentStyle={styles.btnContent} onPress={() => onFormat?.("underline")} hitSlop={6}>
            <Text style={[styles.fmtLabel, styles.underline, isUnderlineActive && styles.fmtLabelActive]}>U</Text>
          </ScalePressable>

          <ScalePressable style={[styles.btn, isQuoteActive && styles.btnActive]} contentStyle={styles.btnContent} onPress={() => onFormat?.("quote")} hitSlop={6}>
            <Text style={[styles.quoteIcon, isQuoteActive && styles.fmtLabelActive]}>{"\u201C\u201D"}</Text>
          </ScalePressable>

          <View style={styles.divider} />

          <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={onDismissKeyboard} hitSlop={8}>
            <MaterialCommunityIcons name="keyboard-off-outline" size={20} color="#3f3f46" />
          </ScalePressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerWrap: {
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  capsule: {
    position: "relative",
    backgroundColor: "#ffffff",
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingVertical: 4,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
      },
      android: { elevation: 6 },
    }),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  absoluteLayer: {
    position: "absolute",
    top: 4,
    left: 8,
    right: 8,
    bottom: 4,
  },
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  btnContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  btnActive: {
    backgroundColor: "#92323D",
  },
  aaLabel: {
    fontSize: 14,
    color: "#3f3f46",
    fontFamily: Platform.select({
      ios: "Pretendard-SemiBold",
      default: "Pretendard-SemiBold",
    }),
    fontWeight: "600",
  },
  fmtLabel: {
    fontSize: 15,
    color: "#3f3f46",
    fontFamily: Platform.select({
      ios: "Pretendard-Regular",
      default: "Pretendard",
    }),
  },
  fmtLabelActive: {
    color: "#ffffff",
  },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  underline: { textDecorationLine: "underline" },
  quoteIcon: {
    fontSize: 18,
    color: "#3f3f46",
    lineHeight: 20,
    fontFamily: Platform.select({
      ios: "Georgia",
      default: "serif",
    }),
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: "#e4e4e7",
    marginHorizontal: 4,
  },
});
