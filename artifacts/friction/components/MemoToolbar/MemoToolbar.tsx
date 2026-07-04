import React, { useRef } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import ScalePressable from "@/components/shared/ScalePressable";
import type { FormatType } from "@/components/MemoPageView/MemoPageView";

export interface AttachMenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MemoToolbarProps {
  currentPage: number;
  totalPages: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  onDismissKeyboard: () => void;
  onFormat?: (type: FormatType) => void;
  activeFormats?: Set<FormatType>;
  /**
   * 클립(첨부) 버튼을 눌렀을 때 호출된다. 버튼의 화면 좌표(anchor)를 전달하므로
   * 부모가 키보드를 유지한 채 그 위에 첨부 메뉴를 띄운다.
   */
  onOpenAttachMenu?: (anchor: AttachMenuAnchor) => void;
}

export default function MemoToolbar({
  currentPage,
  totalPages,
  onPrevPage,
  onNextPage,
  onDismissKeyboard,
  onFormat,
  activeFormats,
  onOpenAttachMenu,
}: MemoToolbarProps) {
  const clipBtnRef = useRef<View>(null);
  const canGoPrev = currentPage > 0;
  const isLastPage = currentPage >= totalPages - 1;
  const isBoldActive = activeFormats?.has("bold");
  const isItalicActive = activeFormats?.has("italic");
  const isUnderlineActive = activeFormats?.has("underline");
  const isQuoteActive = activeFormats?.has("quote");

  const openAttachMenu = () => {
    clipBtnRef.current?.measureInWindow((x, y, width, height) => {
      onOpenAttachMenu?.({ x, y, width, height });
    });
  };

  return (
    <View style={styles.outerWrap}>
      <View style={styles.capsule}>
        {/* ── 포맷 버튼 ── */}
        <ScalePressable
          style={[styles.btn, isBoldActive && styles.btnActive]}
          contentStyle={styles.btnContent}
          onPress={() => onFormat?.("bold")}
          hitSlop={6}
        >
          <Text style={[styles.fmtLabel, styles.bold, isBoldActive && styles.fmtLabelActive]}>B</Text>
        </ScalePressable>

        <ScalePressable
          style={[styles.btn, isItalicActive && styles.btnActive]}
          contentStyle={styles.btnContent}
          onPress={() => onFormat?.("italic")}
          hitSlop={6}
        >
          <Text style={[styles.fmtLabel, styles.italic, isItalicActive && styles.fmtLabelActive]}>I</Text>
        </ScalePressable>

        <ScalePressable
          style={[styles.btn, isUnderlineActive && styles.btnActive]}
          contentStyle={styles.btnContent}
          onPress={() => onFormat?.("underline")}
          hitSlop={6}
        >
          <Text style={[styles.fmtLabel, styles.underline, isUnderlineActive && styles.fmtLabelActive]}>U</Text>
        </ScalePressable>

        <ScalePressable
          style={[styles.btn, isQuoteActive && styles.btnActive]}
          contentStyle={styles.btnContent}
          onPress={() => onFormat?.("quote")}
          hitSlop={6}
        >
          <Text style={[styles.quoteIcon, isQuoteActive && styles.fmtLabelActive]}>{"\u201C\u201D"}</Text>
        </ScalePressable>

        <View ref={clipBtnRef} collapsable={false}>
          <ScalePressable
            style={styles.btn}
            contentStyle={styles.btnContent}
            onPress={openAttachMenu}
            hitSlop={6}
          >
            <Feather name="paperclip" size={15} color="#3f3f46" />
          </ScalePressable>
        </View>

        <View style={styles.divider} />

        {/* ── 페이지 이동 ── */}
        <ScalePressable
          style={[styles.btn, !canGoPrev && styles.btnDisabled]}
          contentStyle={styles.btnContent}
          onPress={onPrevPage}
          hitSlop={8}
          disabled={!canGoPrev}
        >
          <Feather name="chevron-up" size={18} color={canGoPrev ? "#3f3f46" : "#d4d4d8"} />
        </ScalePressable>

        <ScalePressable
          style={styles.btn}
          contentStyle={styles.btnContent}
          onPress={onNextPage}
          hitSlop={8}
        >
          <Feather name="chevron-down" size={18} color={isLastPage ? "#a1a1aa" : "#3f3f46"} />
        </ScalePressable>

        <View style={styles.divider} />

        {/* ── 키보드 닫기 ── */}
        <ScalePressable
          style={styles.btn}
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
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  capsule: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 2,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
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
  btnDisabled: {
    opacity: 0.35,
  },
  btnActive: {
    backgroundColor: "#92323D",
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
  bold: {
    fontWeight: "700",
  },
  italic: {
    fontStyle: "italic",
  },
  underline: {
    textDecorationLine: "underline",
  },
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
