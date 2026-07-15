import React, { useRef, useState } from "react";
import { View, Text, StyleSheet, Platform, Animated } from "react-native";
import { MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import ScalePressable from "@/components/shared/ScalePressable";
import type { OnSelectionUpdatePayload } from "@/components/WebViewMarkdownEditor/types";

export type FormatType = "bold" | "italic" | "underline" | "quote";

const BLOCK_LABELS: Record<string, string> = {
  paragraph: "본문",
  heading1: "제목 1",
  heading2: "제목 2",
  heading3: "제목 3",
  blockquote: "인용",
  bulletList: "글머리",
  orderedList: "번호",
};

interface MemoToolbarProps {
  onDismissKeyboard: () => void;
  onFormat?: (type: FormatType) => void;
  activeFormats?: Set<FormatType>;
  onOpenQuotePicker?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  selectionState?: OnSelectionUpdatePayload;
  onFormatPress?: () => void;
  onInsertDivider?: () => void;
  onShiftEnter?: () => void;
}

const CROSS_FADE_MS = 80;

const DEFAULT_SELECTION: OnSelectionUpdatePayload = {
  activeBlock: "paragraph",
  isBold: false,
  isItalic: false,
  isUnderline: false,
};

export default function MemoToolbar({
  onDismissKeyboard,
  onFormat,
  activeFormats,
  onOpenQuotePicker,
  onUndo,
  onRedo,
  selectionState = DEFAULT_SELECTION,
  onFormatPress,
  onInsertDivider,
  onShiftEnter,
}: MemoToolbarProps) {
  const [isFormat, setIsFormat] = useState(false);
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

  const isBoldActive = selectionState.isBold || activeFormats?.has("bold");
  const isItalicActive = selectionState.isItalic || activeFormats?.has("italic");
  const isUnderlineActive = selectionState.isUnderline || activeFormats?.has("underline");

  const blockLabel = BLOCK_LABELS[selectionState.activeBlock] ?? "본문";

  return (
    <View style={styles.outerWrap}>
      <View style={styles.capsule}>
        {/* ── Main layer ── */}
        <Animated.View
          style={[styles.row, { opacity: mainOpacity }]}
          pointerEvents={isFormat ? "none" : "auto"}
        >
          <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={goFormat} hitSlop={6}>
            <Text style={styles.aaLabel}>Aa</Text>
          </ScalePressable>

          <ScalePressable style={styles.blockTypeBtn} contentStyle={styles.btnContent} onPress={onFormatPress} hitSlop={6}>
            <Text style={styles.blockTypeLabel} numberOfLines={1}>{blockLabel}</Text>
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

          {onInsertDivider != null && (
            <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={onInsertDivider} hitSlop={6}>
              <Feather name="scissors" size={15} color="#3f3f46" />
            </ScalePressable>
          )}

          {onShiftEnter != null && (
            <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={onShiftEnter} hitSlop={6}>
              <Feather name="corner-down-left" size={15} color="#3f3f46" />
            </ScalePressable>
          )}

          <View style={styles.divider} />

          <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={onDismissKeyboard} hitSlop={8}>
            <MaterialCommunityIcons name="keyboard-off-outline" size={20} color="#3f3f46" />
          </ScalePressable>
        </Animated.View>

        {/* ── Format sub-layer (Aa 탭 후) ── */}
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
  blockTypeBtn: {
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 8,
    minWidth: 36,
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
  blockTypeLabel: {
    fontSize: 13,
    color: "#3f3f46",
    fontFamily: Platform.select({
      ios: "Pretendard-Regular",
      default: "Pretendard",
    }),
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
  divider: {
    width: 1,
    height: 20,
    backgroundColor: "#e4e4e7",
    marginHorizontal: 4,
  },
});
