import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Platform, Animated, Easing } from "react-native";
import { MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import ScalePressable from "@/components/shared/ScalePressable";
import type { OnSelectionUpdatePayload } from "@/components/WebViewMarkdownEditor/types";
import type { InlineMenuMode } from "@/components/InlineMenuPanel/InlineMenuPanel";

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
  onOpenAddMenu?: () => void;
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
  keyboardVisible?: boolean;
}

// 모든 버튼은 고정 크기이므로 직접 계산한다.
// btn: 36, blockTypeBtn: 44, divider: width(1) + marginHorizontal(4×2) = 9
// gap: 2 (flexbox gap between items)
const BTN = 36;
const BLOCK_BTN = 44;
const DIVIDER_W = 9; // width:1 + marginHorizontal:4
const GAP = 2;
const CAPSULE_H_PADDING = 16; // paddingHorizontal:8 × 2

function rowWidth(...items: number[]): number {
  return items.reduce((sum, w) => sum + w, 0) + (items.length - 1) * GAP;
}

const FORMAT_ROW_W = rowWidth(BTN, DIVIDER_W, BTN, BTN, BTN, DIVIDER_W, BTN);
// ← | B I U | ⌨️  = 36+9+36+36+36+9+36 + 6×2 = 210

function mainRowW(hasInsertDivider: boolean, hasShiftEnter: boolean): number {
  // 본문 Aa + | ↩️ ↪️ [✂️] [↵] | ⌨️/X
  const items = [BLOCK_BTN, BTN, BTN, DIVIDER_W, BTN, BTN];
  if (hasInsertDivider) items.push(BTN);
  if (hasShiftEnter) items.push(BTN);
  items.push(DIVIDER_W, BTN);
  return rowWidth(...items);
}

const DEFAULT_SELECTION: OnSelectionUpdatePayload = {
  activeBlock: "paragraph",
  isBold: false,
  isItalic: false,
  isUnderline: false,
};

const ANIM_DURATION = 200;
const FADE_DURATION = 150;
const ANIM_EASING = Easing.out(Easing.ease);

export default function MemoToolbar({
  onDismissKeyboard,
  onFormat,
  activeFormats,
  onOpenAddMenu,
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
  keyboardVisible = false,
}: MemoToolbarProps) {
  const [isFormat, setIsFormat] = useState(false);

  const mainW = mainRowW(onInsertDivider != null, onShiftEnter != null);
  const formatW = FORMAT_ROW_W;

  const capsuleWidth = useRef(
    new Animated.Value(mainW + CAPSULE_H_PADDING)
  ).current;
  const mainOpacity = useRef(new Animated.Value(1)).current;
  const formatOpacity = useRef(new Animated.Value(0)).current;

  // onInsertDivider / onShiftEnter 변경 시 너비 재동기화
  useEffect(() => {
    if (!isFormat) {
      capsuleWidth.setValue(mainW + CAPSULE_H_PADDING);
    }
  }, [mainW]);

  // 키보드가 닫혔다 다시 열릴 때 항상 layer 1(main)으로 초기화
  const prevKeyboardVisible = useRef(keyboardVisible);
  useEffect(() => {
    if (keyboardVisible && !prevKeyboardVisible.current) {
      setIsFormat(false);
      capsuleWidth.setValue(mainW + CAPSULE_H_PADDING);
      mainOpacity.setValue(1);
      formatOpacity.setValue(0);
    }
    prevKeyboardVisible.current = keyboardVisible;
  }, [keyboardVisible]);

  const goFormat = () => {
    setIsFormat(true);
    onAaPress?.();
    Animated.parallel([
      Animated.timing(capsuleWidth, {
        toValue: formatW + CAPSULE_H_PADDING,
        duration: ANIM_DURATION,
        easing: ANIM_EASING,
        useNativeDriver: false,
      }),
      Animated.timing(mainOpacity, {
        toValue: 0,
        duration: FADE_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(formatOpacity, {
        toValue: 1,
        duration: FADE_DURATION,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const goMain = () => {
    setIsFormat(false);
    Animated.parallel([
      Animated.timing(capsuleWidth, {
        toValue: mainW + CAPSULE_H_PADDING,
        duration: ANIM_DURATION,
        easing: ANIM_EASING,
        useNativeDriver: false,
      }),
      Animated.timing(formatOpacity, {
        toValue: 0,
        duration: FADE_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(mainOpacity, {
        toValue: 1,
        duration: FADE_DURATION,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const isBoldActive = selectionState.isBold || activeFormats?.has("bold");
  const isItalicActive = selectionState.isItalic || activeFormats?.has("italic");
  const isUnderlineActive = selectionState.isUnderline || activeFormats?.has("underline");

  const blockLabel = BLOCK_LABELS[selectionState.activeBlock] ?? "본문";

  return (
    <View style={styles.outerWrap}>
      <Animated.View style={[styles.capsule, { width: capsuleWidth }]}>
        {/* overflow: hidden은 그림자를 자르므로 안쪽 뷰에서만 처리 */}
        <View style={styles.clipper}>

          {/* ── Main layer ── */}
          <Animated.View
            style={[styles.row, isFormat && styles.absolutePos, { opacity: mainOpacity }]}
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
              onPress={goFormat}
              hitSlop={6}
            >
              <Text style={styles.aaLabel}>Aa</Text>
            </ScalePressable>

            <ScalePressable
              style={[styles.btn, inlineMenuMode === "addMenu" && styles.btnActive]}
              contentStyle={styles.btnContent}
              onPress={onOpenAddMenu}
              hitSlop={6}
            >
              <Feather name="plus" size={18} color={inlineMenuMode === "addMenu" ? "#ffffff" : "#3f3f46"} />
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

            {inlineMenuMode !== null && inlineMenuMode !== "addMenu" ? (
              <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={onAaPress} hitSlop={8}>
                <Feather name="x" size={18} color="#3f3f46" />
              </ScalePressable>
            ) : (
              <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={onDismissKeyboard} hitSlop={8}>
                <MaterialCommunityIcons name="keyboard-off-outline" size={20} color="#3f3f46" />
              </ScalePressable>
            )}
          </Animated.View>

          {/* ── Format sub-layer (Aa 탭 후) ── */}
          <Animated.View
            style={[styles.formatRow, !isFormat && styles.absolutePos, { opacity: formatOpacity }]}
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
              <MaterialCommunityIcons name="format-italic" size={18} color={isItalicActive ? "#ffffff" : "#3f3f46"} />
            </ScalePressable>

            <ScalePressable style={[styles.btn, isUnderlineActive && styles.btnActive]} contentStyle={styles.btnContent} onPress={() => onFormat?.("underline")} hitSlop={6}>
              <Text style={[styles.fmtLabel, styles.underline, isUnderlineActive && styles.fmtLabelActive]}>U</Text>
            </ScalePressable>

            <View style={styles.divider} />

            <ScalePressable style={styles.btn} contentStyle={styles.btnContent} onPress={onDismissKeyboard} hitSlop={8}>
              <MaterialCommunityIcons name="keyboard-off-outline" size={20} color="#3f3f46" />
            </ScalePressable>
          </Animated.View>

        </View>{/* clipper */}
      </Animated.View>
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
  clipper: {
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  formatRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  absolutePos: {
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
