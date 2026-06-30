import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import ScalePressable from "@/components/shared/ScalePressable";

interface MemoToolbarProps {
  currentPage: number;
  totalPages: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  onDismissKeyboard: () => void;
}

export default function MemoToolbar({
  currentPage,
  totalPages,
  onPrevPage,
  onNextPage,
  onDismissKeyboard,
}: MemoToolbarProps) {
  const canGoPrev = currentPage > 0;
  const isLastPage = currentPage >= totalPages - 1;

  return (
    <View style={styles.container}>
      <View style={styles.leftGroup}>
        <View style={styles.fmtButton}>
          <Text style={styles.fmtLabel}>B</Text>
        </View>
        <View style={styles.fmtButton}>
          <Text style={[styles.fmtLabel, styles.italic]}>I</Text>
        </View>
        <View style={styles.fmtButton}>
          <Text style={[styles.fmtLabel, styles.underline]}>U</Text>
        </View>
        <View style={styles.fmtButton}>
          <Feather name="message-square" size={15} color="#71717a" />
        </View>
        <View style={styles.fmtButton}>
          <Feather name="image" size={15} color="#71717a" />
        </View>
        <View style={styles.divider} />
      </View>

      <View style={styles.rightGroup}>
        <ScalePressable
          style={[styles.navButton, !canGoPrev && styles.navButtonDisabled]}
          contentStyle={styles.navButtonContent}
          onPress={onPrevPage}
          hitSlop={10}
          disabled={!canGoPrev}
        >
          <Feather name="chevron-up" size={18} color={canGoPrev ? "#3f3f46" : "#d4d4d8"} />
        </ScalePressable>

        <ScalePressable
          style={styles.navButton}
          contentStyle={styles.navButtonContent}
          onPress={onNextPage}
          hitSlop={10}
        >
          <Feather
            name="chevron-down"
            size={18}
            color={isLastPage ? "#a1a1aa" : "#3f3f46"}
          />
        </ScalePressable>

        <ScalePressable
          style={styles.closeButton}
          contentStyle={styles.closeButtonContent}
          onPress={onDismissKeyboard}
          hitSlop={10}
        >
          <Feather name="chevron-down" size={18} color="#3f3f46" />
          <View style={styles.closeBar} />
        </ScalePressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f4f4f5",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#d4d4d8",
    height: 44,
    paddingHorizontal: 8,
  },
  leftGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  rightGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  fmtButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  fmtLabel: {
    fontSize: 15,
    color: "#71717a",
    fontFamily: Platform.select({
      ios: "Pretendard-Regular",
      default: "Pretendard",
    }),
  },
  italic: {
    fontStyle: "italic",
  },
  underline: {
    textDecorationLine: "underline",
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: "#d4d4d8",
    marginHorizontal: 4,
  },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: 6,
  },
  navButtonDisabled: {
    opacity: 0.4,
  },
  navButtonContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 6,
    marginLeft: 2,
  },
  closeButtonContent: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  closeBar: {
    position: "absolute",
    bottom: 4,
    left: 8,
    right: 8,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#3f3f46",
  },
});
