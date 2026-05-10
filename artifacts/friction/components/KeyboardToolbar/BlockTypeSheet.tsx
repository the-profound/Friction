import React from "react";
import { View, Text, StyleSheet, ScrollView, Platform } from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import { Colors, Typography } from "@/constants/tokens";

interface BlockTypeOption {
  key: string;
  label: string;
  description?: string;
}

const BLOCK_TYPES: BlockTypeOption[] = [
  { key: "paragraph", label: "본문" },
  { key: "heading1", label: "제목 1" },
  { key: "heading2", label: "제목 2" },
  { key: "heading3", label: "제목 3" },
  { key: "blockquote", label: "인용" },
  { key: "bulletList", label: "글머리 기호" },
  { key: "orderedList", label: "숫자 목록" },
];

interface BlockTypeSheetProps {
  visible: boolean;
  activeBlock: string;
  onClose: () => void;
  onSelect: (blockType: string) => void;
}

export default function BlockTypeSheet({
  visible,
  activeBlock,
  onClose,
  onSelect,
}: BlockTypeSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="서식 선택"
      snapPoints={[0.55]}
      enableDragDown
      dismissable
    >
      <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
        {BLOCK_TYPES.map((item) => {
          const isActive = item.key === activeBlock;
          return (
            <ScalePressable
              key={item.key}
              style={[styles.row, isActive && styles.activeRow]}
              onPress={() => {
                onSelect(item.key);
                onClose();
              }}
            >
              <Text style={[styles.label, isActive && styles.activeLabel]}>
                {item.label}
              </Text>
              {isActive && (
                <Text style={styles.checkmark}>✓</Text>
              )}
            </ScalePressable>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  activeRow: {
    backgroundColor: "transparent",
  },
  pressedRow: {
    opacity: 0.6,
  },
  label: {
    ...Typography.body,
    color: Colors.zinc700,
    fontFamily: Platform.select({ ios: "Pretendard-Regular", default: "Pretendard" }),
  },
  activeLabel: {
    color: Colors.zinc900,
    fontFamily: Platform.select({ ios: "Pretendard-SemiBold", default: "Pretendard-SemiBold" }),
    fontWeight: "600",
  },
  checkmark: {
    fontSize: 16,
    color: Colors.zinc900,
  },
});
