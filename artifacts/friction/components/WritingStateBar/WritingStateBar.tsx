import React, { useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Colors, Typography, Shadows } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";
import ActionSheetModal, {
  type ActionSheetAction,
} from "@/components/ActionSheetModal/ActionSheetModal";

export type WritingStage = "DRAFT" | "DIVIDING" | "CLOSING";

const STAGE_LABELS: Record<WritingStage, string> = {
  DRAFT: "단상",
  DIVIDING: "검토",
  CLOSING: "마감",
};

export type WritingStageAction = ActionSheetAction;

interface WritingStateBarProps {
  current: WritingStage;
  actions: WritingStageAction[];
  disabled?: boolean;
  busy?: boolean;
}

export default function WritingStateBar({
  current,
  actions,
  disabled = false,
  busy = false,
}: WritingStateBarProps) {
  const [visible, setVisible] = useState(false);
  const label = STAGE_LABELS[current];
  const menuDisabled = disabled || busy;
  const menuActions = actions.some((action) => action.style === "cancel")
    ? actions
    : [
        ...actions,
        {
          label: "취소",
          style: "cancel" as const,
          onPress: () => {},
        },
      ];

  const closeMenu = () => setVisible(false);

  return (
    <>
      <ScalePressable
        testID="writing-stage-menu"
        style={styles.menuButton}
        contentStyle={styles.menuButtonContent}
        onPress={() => {
          if (!menuDisabled) setVisible(true);
        }}
        disabled={menuDisabled}
        accessibilityRole="button"
        accessibilityLabel={`${label} 단계 메뉴`}
        accessibilityHint="현재 단계에서 할 수 있는 작업을 엽니다."
        accessibilityState={{ disabled: menuDisabled, busy }}
      >
        {busy ? (
          <View style={styles.indicatorFrame}>
            <ActivityIndicator color={Colors.white} size="small" />
          </View>
        ) : (
          <Text style={styles.menuLabel}>{label}</Text>
        )}
      </ScalePressable>

      <ActionSheetModal
        visible={visible}
        title={`${label} 단계`}
        actions={menuActions}
        onClose={closeMenu}
      />
    </>
  );
}

const styles = StyleSheet.create({
  menuButton: {
    width: 44,
    height: 44,
    alignSelf: "flex-start",
    flexGrow: 0,
    flexShrink: 0,
  },
  menuButtonContent: {
    width: 40,
    height: 40,
    alignSelf: "center",
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: Colors.noticeAccent,
    ...Shadows.navBar,
  },
  menuLabel: {
    ...Typography.caption,
    fontSize: 13,
    fontWeight: "600",
    color: Colors.white,
  },
  indicatorFrame: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
});
