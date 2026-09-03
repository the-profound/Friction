import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Platform, ScrollView } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors } from "@/constants/tokens";
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

// 스크롤 영역 폭 계산:
//   blockTypeBtn(44) + marginRight(2) + Aa(W) + marginRight(2) + [애니 영역] + +(W) + ... + enter(W)
// calcBtnW: 고정 요소 제외 후 6개 버튼(Aa, +, undo, redo, scissors, enter)이 남은 폭을 균등분
// blockType(44) + 6×gap + 6×btnW = scrollAreaWidth  →  btnW = (scrollAreaWidth - 44 - 12) / 6
const BLOCK_BTN_W = 44;
const BTN_GAP = 2;
const ROUND_BTN_COUNT = 6;

// 애니 영역 폭: B + I + U + 인용 버튼 4개, 각 36px, 사이 gap 2px × 3 + trailing padding 2px
const EXPANDED_BTN_W = 36;
const EXPANDED_GROUP_W = EXPANDED_BTN_W * 4 + BTN_GAP * 3 + BTN_GAP; // 152

function calcBtnW(scrollAreaWidth: number): number {
  if (scrollAreaWidth <= 0) return 36;
  return Math.max(36, Math.floor(
    (scrollAreaWidth - BLOCK_BTN_W - BTN_GAP * ROUND_BTN_COUNT) / ROUND_BTN_COUNT
  ));
}

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
  keyboardVisible?: boolean;
  addMenuBtnRef?: React.RefObject<View | null>;
}

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
  keyboardVisible = false,
  addMenuBtnRef,
}: MemoToolbarProps) {
  const [aaActive, setAaActive] = useState(false);
  const [scrollAreaWidth, setScrollAreaWidth] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);

  // Aa 활성화 시 B/I/U/인용 그룹 슬라이드인 애니메이션
  const expandWidth = useSharedValue(0);
  useEffect(() => {
    expandWidth.value = withTiming(aaActive ? EXPANDED_GROUP_W : 0, {
      duration: 230,
      easing: Easing.out(Easing.cubic),
    });
    // 접힐 때 스크롤 위치 초기화
    if (!aaActive) {
      scrollViewRef.current?.scrollTo({ x: 0, animated: false });
    }
  }, [aaActive]);

  const expandedStyle = useAnimatedStyle(() => ({
    width: expandWidth.value,
    // 거의 닫힌 구간(4px 미만)에서 opacity를 0으로 끊어 active 배경 삐져나옴 방지
    opacity: expandWidth.value < 4 ? 0 : 1,
  }));

  // 키보드가 다시 열릴 때 Aa 해제
  const prevKeyboardVisible = useRef(keyboardVisible);
  useEffect(() => {
    if (keyboardVisible && !prevKeyboardVisible.current) {
      setAaActive(false);
    }
    prevKeyboardVisible.current = keyboardVisible;
  }, [keyboardVisible]);

  const normalBtnW = calcBtnW(scrollAreaWidth);
  const btnW = aaActive ? EXPANDED_BTN_W : normalBtnW;
  const btn = { width: btnW, height: 36, marginRight: BTN_GAP };

  const isBoldActive = selectionState.isBold || activeFormats?.has("bold");
  const isItalicActive = selectionState.isItalic || activeFormats?.has("italic");
  const isUnderlineActive = selectionState.isUnderline || activeFormats?.has("underline");
  const isQuoteActive =
    selectionState.activeBlock === "blockquote" || activeFormats?.has("quote");
  const blockLabel = BLOCK_LABELS[selectionState.activeBlock] ?? "본문";

  return (
    <View style={styles.outerWrap}>
      <View style={styles.capsule}>
        {/* ── 스크롤 가능한 버튼 영역 ── */}
        <ScrollView
          ref={scrollViewRef}
          horizontal
          scrollEnabled={aaActive}
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
          style={styles.scrollArea}
          onLayout={(e) => setScrollAreaWidth(e.nativeEvent.layout.width)}
        >
          {/* 블록 타입 */}
          <ScalePressable
            style={styles.blockTypeBtn}
            contentStyle={[styles.btnContent, inlineMenuMode === "blockType" && styles.btnActive]}
            onPress={onFormatPress}
            hitSlop={6}
          >
            <Text
              style={[styles.blockTypeLabel, inlineMenuMode === "blockType" && styles.blockTypeLabelActive]}
              numberOfLines={1}
            >
              {blockLabel}
            </Text>
          </ScalePressable>

          {/* Aa */}
          <ScalePressable
            style={btn}
            contentStyle={[styles.btnContent, aaActive && styles.btnActive]}
            onPress={() => setAaActive((v) => !v)}
            hitSlop={6}
          >
            <Text style={[styles.aaLabel, aaActive && styles.aaLabelActive]}>Aa</Text>
          </ScalePressable>

          {/* B / I / U / 인용 — ease 슬라이드인 */}
          <Animated.View style={[styles.expandedGroup, expandedStyle]}>
            <ScalePressable
              style={styles.expandBtn}
              contentStyle={styles.btnContent}
              onPress={() => onFormat?.("bold")}
              hitSlop={6}
            >
              <View style={[styles.fmtCircle, isBoldActive && styles.fmtCircleActive]}>
                <Text style={[styles.fmtLabel, styles.bold, isBoldActive && styles.fmtLabelActive]}>B</Text>
              </View>
            </ScalePressable>

            <ScalePressable
              style={styles.expandBtn}
              contentStyle={styles.btnContent}
              onPress={() => onFormat?.("italic")}
              hitSlop={6}
            >
              <View style={[styles.fmtCircle, isItalicActive && styles.fmtCircleActive]}>
                <MaterialCommunityIcons
                  name="format-italic"
                  size={18}
                  color={isItalicActive ? "#ffffff" : "#3f3f46"}
                />
              </View>
            </ScalePressable>

            <ScalePressable
              style={styles.expandBtn}
              contentStyle={styles.btnContent}
              onPress={() => onFormat?.("underline")}
              hitSlop={6}
            >
              <View style={[styles.fmtCircle, isUnderlineActive && styles.fmtCircleActive]}>
                <Text style={[styles.fmtLabel, styles.underline, isUnderlineActive && styles.fmtLabelActive]}>U</Text>
              </View>
            </ScalePressable>

            {/* 인용 — 마지막 버튼은 marginRight 없음 (trailing padding으로 대체) */}
            <ScalePressable
              style={styles.expandBtnLast}
              contentStyle={styles.btnContent}
              onPress={() => onFormat?.("quote")}
              hitSlop={6}
            >
              <View style={[styles.fmtCircle, isQuoteActive && styles.fmtCircleActive]}>
                <MaterialCommunityIcons
                  name="format-quote-open"
                  size={18}
                  color={isQuoteActive ? "#ffffff" : "#3f3f46"}
                />
              </View>
            </ScalePressable>
          </Animated.View>

          {/* + */}
          <View ref={addMenuBtnRef} collapsable={false}>
            <ScalePressable
              style={btn}
              contentStyle={[styles.btnContent, inlineMenuMode === "addMenu" && styles.btnActive]}
              onPress={onOpenAddMenu}
              hitSlop={6}
            >
              <Feather
                name="plus"
                size={18}
                color={inlineMenuMode === "addMenu" ? "#ffffff" : "#3f3f46"}
              />
            </ScalePressable>
          </View>

          {/* undo */}
          <ScalePressable
            style={btn}
            contentStyle={styles.btnContent}
            onPress={canUndo ? onUndo : undefined}
            hitSlop={6}
          >
            <MaterialCommunityIcons name="undo" size={18} color={canUndo ? "#3f3f46" : "#d4d4d8"} />
          </ScalePressable>

          {/* redo */}
          <ScalePressable
            style={btn}
            contentStyle={styles.btnContent}
            onPress={canRedo ? onRedo : undefined}
            hitSlop={6}
          >
            <MaterialCommunityIcons name="redo" size={18} color={canRedo ? "#3f3f46" : "#d4d4d8"} />
          </ScalePressable>

          {/* scissors */}
          {onInsertDivider != null && (
            <ScalePressable
              style={btn}
              contentStyle={styles.btnContent}
              onPress={onInsertDivider}
              hitSlop={6}
            >
              <Feather name="scissors" size={15} color="#3f3f46" />
            </ScalePressable>
          )}

          {/* enter */}
          {onShiftEnter != null && (
            <ScalePressable
              style={{ width: btnW, height: 36 }}
              contentStyle={styles.btnContent}
              onPress={onShiftEnter}
              hitSlop={6}
            >
              <Feather name="corner-down-left" size={15} color="#3f3f46" />
            </ScalePressable>
          )}
        </ScrollView>

        {/* ── 구분선 + 키보드 해제 버튼 ── */}
        <View style={styles.keyboardSeparator} />
        <ScalePressable
          style={styles.keyboardBtn}
          contentStyle={styles.btnContent}
          onPress={onDismissKeyboard}
          hitSlop={8}
        >
          <MaterialCommunityIcons name="keyboard-off-outline" size={20} color="#3f3f46" />
        </ScalePressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerWrap: {
    alignItems: "stretch",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "transparent",
  },
  capsule: {
    backgroundColor:"#ffffff",
    borderRadius: 24,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 8,
    paddingRight: 8,
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
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  blockTypeBtn: {
    width: BLOCK_BTN_W,
    height: 36,
    marginRight: BTN_GAP,
  },
  // B / I / U / 인용 그룹 컨테이너
  expandedGroup: {
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    // paddingRight은 trailing gap 역할 (trailing 2px = BTN_GAP)
    paddingRight: BTN_GAP,
  },
  // B, I, U — marginRight로 다음 버튼과 간격
  // overflow:"hidden" 사용 금지 — active border가 clip되고 아이콘이 가려짐
  expandBtn: {
    width: EXPANDED_BTN_W,
    height: 36,
    marginRight: BTN_GAP,
  },
  // 인용 — 마지막 버튼, marginRight 없음 (컨테이너 paddingRight이 gap 담당)
  expandBtnLast: {
    width: EXPANDED_BTN_W,
    height: 36,
  },
  keyboardSeparator: {
    width: StyleSheet.hairlineWidth,
    height: 20,
    backgroundColor: "#d4d4d8",
    marginHorizontal: 4,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: -3, height: 0 },
        shadowOpacity: 0.14,
        shadowRadius: 3,
      },
    }),
  },
  keyboardBtn: {
    width: 36,
    height: 36,
  },
  btnContent: {
    width: "100%",
    height: "100%",
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  // Aa / 본문 / + 버튼 활성화 — 빨간 채움
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
  aaLabelActive: {
    color: "#ffffff",
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
  // B/I/U/인용 활성 표시용 — 다른 버튼(36px)보다 작은 원(28px)
  fmtCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  fmtCircleActive: {
    backgroundColor: "#92323D",
  },
  bold: { fontWeight: "700" },
  underline: { textDecorationLine: "underline" },
});
