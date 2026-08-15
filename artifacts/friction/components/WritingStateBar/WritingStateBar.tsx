import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Colors, Typography } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";

export type WritingStage = "DRAFT" | "DIVIDING" | "CLOSING";

const TABS: { stage: WritingStage; label: string }[] = [
  { stage: "DRAFT", label: "작성" },
  { stage: "DIVIDING", label: "검토" },
  { stage: "CLOSING", label: "마감" },
];

const STAGE_ORDER: Record<WritingStage, number> = {
  DRAFT: 0,
  DIVIDING: 1,
  CLOSING: 2,
};

interface WritingStateBarProps {
  current: WritingStage;
  onPress: (target: WritingStage) => void;
  disabled?: boolean;
}

export default function WritingStateBar({
  current,
  onPress,
  disabled = false,
}: WritingStateBarProps) {
  const currentOrder = STAGE_ORDER[current];

  return (
    <View style={styles.bar}>
      {TABS.map(({ stage, label }) => {
        const isCurrent = stage === current;
        const targetOrder = STAGE_ORDER[stage];
        const distance = Math.abs(targetOrder - currentOrder);
        const isIndirectlyReachable = distance > 1;
        const isDirectlyReachable = distance === 1;

        return (
          <ScalePressable
            key={stage}
            contentStyle={isIndirectlyReachable ? styles.tabIndirect : undefined}
            onPress={() => !isCurrent && !disabled && onPress(stage)}
            disabled={disabled}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${label} 단계로 이동`}
            accessibilityState={{ selected: isCurrent, disabled: disabled }}
          >
            <View style={[styles.tab, isCurrent && styles.tabActive]}>
              <Text
                style={[
                  styles.tabText,
                  isCurrent && styles.tabTextActive,
                  isDirectlyReachable && styles.tabTextReachable,
                  isIndirectlyReachable && styles.tabTextIndirect,
                ]}
              >
                {label}
              </Text>
            </View>
          </ScalePressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: Colors.zinc100,
    borderRadius: 10,
    padding: 3,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 48,
  },
  tabActive: {
    backgroundColor: Colors.white,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  tabIndirect: {
    opacity: 0.4,
  },
  tabText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
    fontWeight: "500",
  },
  tabTextActive: {
    color: Colors.zinc900,
    fontWeight: "600",
  },
  tabTextReachable: {
    color: Colors.zinc700,
  },
  tabTextIndirect: {
    color: Colors.zinc400,
  },
});
