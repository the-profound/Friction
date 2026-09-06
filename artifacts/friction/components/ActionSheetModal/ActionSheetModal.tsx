import React, { useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, Typography, ZIndex } from "../../constants/tokens";

/**
 * "leading" renders a left chevron before the label (moving back to a
 * previous stage); "trailing" renders a right chevron after the label
 * (moving forward to the next stage).
 */
export type ActionSheetDirectionIcon = "leading" | "trailing";

export interface ActionSheetAction {
  label: string;
  onPress: () => void;
  style?: "default" | "destructive" | "cancel";
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  directionIcon?: ActionSheetDirectionIcon;
}

interface ActionSheetModalProps {
  visible: boolean;
  actions: ActionSheetAction[];
  onClose: () => void;
}

// This modal intentionally never renders a title/description header — a menu
// list opens straight into its selectable actions. Do not add title props
// back; see task #2045 for why every entry point was made consistent.
export default function ActionSheetModal({
  visible,
  actions,
  onClose,
}: ActionSheetModalProps) {
  const insets = useSafeAreaInsets();
  const frozenActions = useRef(actions);

  if (visible) {
    frozenActions.current = actions;
  }

  const displayActions = frozenActions.current;

  const mainActions = displayActions.filter((a) => a.style !== "cancel");
  const cancelActions = displayActions.filter((a) => a.style === "cancel");

  const getActionColor = (action: ActionSheetAction) => {
    if (action.disabled) return Colors.zinc500;
    if (action.style === "destructive") return Colors.noticeAccent;
    return Colors.zinc900;
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable
        style={[
          styles.overlay,
          {
            paddingTop: Math.max(insets.top, 24),
            paddingBottom: Math.max(insets.bottom, 24),
          },
        ]}
        onPress={onClose}
        accessibilityLabel="메뉴 닫기"
      >
        <View style={styles.contentWrapper}>
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            {mainActions.map((action, index) => (
              <React.Fragment key={index}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <ScalePressable
                  style={styles.actionRow}
                  contentStyle={styles.actionRowContent}
                  disabled={action.disabled || action.busy}
                  accessibilityRole="button"
                  accessibilityLabel={action.accessibilityLabel ?? action.label}
                  accessibilityState={{
                    disabled: action.disabled || action.busy,
                    busy: action.busy,
                  }}
                  onPress={() => {
                    onClose();
                    if (!action.disabled && !action.busy) action.onPress();
                  }}
                >
                  {action.busy ? (
                    <ActivityIndicator
                      size="small"
                      color={action.style === "destructive" ? Colors.noticeAccent : Colors.zinc500}
                    />
                  ) : (
                    <View style={styles.actionLabelRow}>
                      {action.directionIcon === "leading" ? (
                        <Feather
                          name="chevron-left"
                          size={18}
                          color={getActionColor(action)}
                          style={styles.chevronLeading}
                        />
                      ) : null}
                      <Text
                        style={[
                          styles.actionLabel,
                          action.style === "destructive" && styles.destructiveLabel,
                          action.disabled && styles.disabledLabel,
                        ]}
                      >
                        {action.label}
                      </Text>
                      {action.directionIcon === "trailing" ? (
                        <Feather
                          name="chevron-right"
                          size={18}
                          color={getActionColor(action)}
                          style={styles.chevronTrailing}
                        />
                      ) : null}
                    </View>
                  )}
                </ScalePressable>
              </React.Fragment>
            ))}

            {cancelActions.length > 0 && (
              <>
                <View style={styles.cancelDivider} />
                {cancelActions.map((action, index) => (
                  <ScalePressable
                    key={`cancel-${index}`}
                    style={styles.actionRow}
                    contentStyle={styles.actionRowContent}
                    disabled={action.disabled || action.busy}
                    accessibilityRole="button"
                    accessibilityLabel={action.accessibilityLabel ?? action.label}
                    accessibilityState={{
                      disabled: action.disabled || action.busy,
                      busy: action.busy,
                    }}
                    onPress={() => {
                      onClose();
                      if (!action.disabled && !action.busy) action.onPress();
                    }}
                  >
                    {action.busy ? (
                      <ActivityIndicator size="small" color={Colors.zinc500} />
                    ) : (
                      <Text style={[styles.cancelLabel, action.disabled && styles.disabledLabel]}>
                        {action.label}
                      </Text>
                    )}
                  </ScalePressable>
                ))}
              </>
            )}
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: ZIndex.modal,
    paddingHorizontal: 40,
    paddingVertical: 24,
  },
  contentWrapper: {
    width: "100%",
    alignItems: "center",
  },
  card: {
    width: "100%",
    backgroundColor: Colors.white,
    borderRadius: 16,
    overflow: "hidden",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.zinc200,
    marginHorizontal: 0,
  },
  cancelDivider: {
    height: 6,
    backgroundColor: Colors.zinc100,
  },
  actionRow: {
    height: 56,
    alignSelf: "stretch",
    flexGrow: 0,
    flexShrink: 0,
  },
  actionRowContent: {
    height: 56,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  actionLabelRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  chevronLeading: {
    marginRight: 4,
  },
  chevronTrailing: {
    marginLeft: 4,
  },
  actionLabel: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc900,
  },
  destructiveLabel: {
    color: Colors.noticeAccent,
  },
  disabledLabel: {
    color: Colors.zinc500,
  },
  cancelLabel: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.noticeAccent,
  },
});
