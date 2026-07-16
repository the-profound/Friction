import React, { useRef, useState } from "react";
import { View, Text, StyleSheet, Platform, Animated, LayoutAnimation, UIManager } from "react-native";
import { MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import ScalePressable from "@/components/shared/ScalePressable";
import type { OnSelectionUpdatePayload } from "@/components/WebViewMarkdownEditor/types";
import type { InlineMenuMode } from "@/components/InlineMenuPanel/InlineMenuPanel";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
  canUndo?: boolean;
  canRedo?: boolean;
  selectionState?: OnSelectionUpdatePayload;
  onFormatPress?: () => void;
  onInsertDivider?: () => void;
  onShiftEnter?: () => void;
  inlineMenuMode?: InlineMenuMode | null;
  onAaPress?: () => void;
}

const CROSS_FADE_MS = 150;

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
  canUndo = true,
  canRedo = true,
  selectionState = DEFAULT_SELECTION,
  onFormatPress,
  onInsertDivider,
  onShiftEnter,
  inlineMenuMode,
  onAaPress,
}: MemoToolbarProps) {
  const [isFormat, setIsFormat] = useState(false);
  const transition = useRef(new Animated.Value(0)).current;

  const mainOpacity = transition.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const formatOpacity = transition;

  // opacity 페이드를 먼저 완료한 뒤 레이어를 스왑한다.
  // 스왑 시점에 departing 레이어는 이미 opacity 0이므로
  // 캡슐 폭 변화가 사용자 눈에 띄지 않는다.
  const goFormat = () => {
    Animated.timing(transition, {
      toValue: 1,
      duration: CROSS_FADE_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        LayoutAnimation.configureNext({
          duration: 60,
          update: { type: LayoutAnimation.Types.easeInEaseOut },
        });
        setIsFormat(true);
      }
    });
  };

  const goMain = () => {
    Animated.timing(transition, {
      toValue: 0,
      duration: CROSS_FADE_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        LayoutAnimation.configureNext({
          duration: 60,
          update: { type: LayoutAnimation.Types.easeInEaseOut },
        });
        setIsFormat(false);
      }
    });
  };

  const isBoldActive = selectionState.isBold || activeFormats?.has("bold");
  const isItalicActive = selectionState.isItalic || activeFormats?.has("italic");
  const isUnderlineActive = selectionState.isUnderline || activeFormats?.has("underline");

  const blockLabel = BLOCK_LABELS[selectionState.activeBlock] ?? "본문";

  return (
    <View style={styles.outerWrap}>
      <View style={styles.capsule}>
        {/* ── Main layer ──
            Normal flow when !isFormat (drives capsule width).
            Absolute (invisible) when isFormat so the narrower format layer drives the width. */}
        <Animated.View
          style={[styles.row, isFormat && styles.absoluteHidden, { opacity: mainOpacity }]}
          pointerEvents={isFormat ? "none" : "auto"}
        >
          <ScalePressable
            style={[styles.blockTypeBtn, inlineMenuMode === "blockType" && styles.btnActive]}
            contentStyle={styles.btnContent}
            onPress={onFormatPress}
            hitSlop={6}
          >
            <Text style={[styles.blockTypeLabel, inlineMenuMode === "blockType" && styles.blockTypeLabelActive]} numberOfLines={1}>{blockLabel}</Text>
          </ScalePressable>

          <ScalePressable
            style={styles.btn}
            contentStyle={styles.btnContent}
            onPress={() => { goFormat(); onAaPress?.(); }}
            hitSlop={6}
          >
            <Text style={styles.aaLabel}>Aa</Text>
          </ScalePressable>

          <ScalePressable
            style={[styles.btn, inlineMenuMode === "quotePicker" && styles.btnActive]}
            contentStyle={styles.btnContent}
            onPress={onOpenQuotePicker}
            hitSlop={6}
          >
            <Feather name="message-square" size={16} color={inlineMenuMode === "quotePicker" ? "#ffffff" : "#3f3f46"} />
          </ScalePressable>

          <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={undefined} hitSlop={6}>
            <Feather name="image" size={16} color="#3f3f46" />
          </ScalePressable>

          <View style={styles.divider} />

          <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={canUndo ? onUndo : undefined} hitSlop={6}>
            <MaterialCommunityIcons name="undo" size={18} color={canUndo ? "#3f3f46" : "#d4d4d8"} />
          </ScalePressable>

          <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={canRedo ? onRedo : undefined} hitSlop={6}>
            <MaterialCommunityIcons name="redo" size={18} color={canRedo ? "#3f3f46" : "#d4d4d8"} />
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

          {inlineMenuMode !== null ? (
            <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={onAaPress} hitSlop={8}>
              <Feather name="x" size={18} color="#3f3f46" />
            </ScalePressable>
          ) : (
            <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={onDismissKeyboard} hitSlop={8}>
              <MaterialCommunityIcons name="keyboard-off-outline" size={20} color="#3f3f46" />
            </ScalePressable>
          )}
        </Animated.View>

        {/* ── Format sub-layer (Aa 탭 후) ──
            Normal flow when isFormat (drives capsule to content width).
            Absolute (invisible) when !isFormat. */}
        <Animated.View
          style={[styles.row, !isFormat && styles.absoluteHidden, { opacity: formatOpacity }]}
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
  absoluteHidden: {
    position: "absolute",
    top: 4,
    left: 8,
  },
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  blockTypeBtn: {
    width: 44,
    height: 36,
    borderRadius: 18,
    overflow: "hidden",
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
    textAlign: "center",
    fontFamily: Platform.select({
      ios: "Pretendard-Regular",
      default: "Pretendard",
    }),
  },
  blockTypeLabelActive: {
    color: "#ffffff",
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
