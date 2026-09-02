import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
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
const Gradient = LinearGradient as unknown as React.ComponentType<any>;

interface WritingStateBarProps {
  current: WritingStage;
  onPress: (target: WritingStage) => void;
  disabled?: boolean;
  /** The first stage is a thought before it has been promoted to an article. */
  draftLabel?: string;
}

export default function WritingStateBar({
  current,
  onPress,
  disabled = false,
  draftLabel = "작성",
}: WritingStateBarProps) {
  const tabs = TABS.map((tab) =>
    tab.stage === "DRAFT" ? { ...tab, label: draftLabel } : tab,
  );
  const currentOrder = STAGE_ORDER[current];

  return (
    <Gradient
      colors={["rgba(255,255,255,1)", "rgba(255,255,255,0)"]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.bar}
    >
      {tabs.map(({ stage, label }) => {
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
    </Gradient>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "transparent",
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
    color: Colors.zinc400, // typography-ok: indirect/inactive tab text
  },
});
