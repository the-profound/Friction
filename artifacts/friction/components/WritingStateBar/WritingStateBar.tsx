import React, { useState } from "react";
import HeaderButton from "@/components/shared/HeaderButton";
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
      <HeaderButton
        testID="writing-stage-menu"
        variant="menu"
        label={label}
        onPress={() => {
          if (!menuDisabled) setVisible(true);
        }}
        disabled={menuDisabled}
        accessibilityLabel={`${label} 단계 메뉴`}
        accessibilityHint="현재 단계에서 할 수 있는 작업을 엽니다."
        busy={busy}
      />

      <ActionSheetModal
        visible={visible}
        actions={menuActions}
        onClose={closeMenu}
      />
    </>
  );
}
