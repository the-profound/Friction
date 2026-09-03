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
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, Typography, ZIndex } from "../../constants/tokens";

export interface ActionSheetAction {
  label: string;
  onPress: () => void;
  style?: "default" | "destructive" | "cancel";
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
}

interface ActionSheetModalProps {
  visible: boolean;
  title?: string;
  description?: string;
  actions: ActionSheetAction[];
  onClose: () => void;
}

export default function ActionSheetModal({
  visible,
  title,
  description,
  actions,
  onClose,
}: ActionSheetModalProps) {
  const insets = useSafeAreaInsets();
  const frozenTitle = useRef(title);
  const frozenDescription = useRef(description);
  const frozenActions = useRef(actions);

  if (visible) {
    frozenTitle.current = title;
    frozenDescription.current = description;
    frozenActions.current = actions;
  }

  const displayTitle = frozenTitle.current;
  const displayDescription = frozenDescription.current;
  const displayActions = frozenActions.current;

  const mainActions = displayActions.filter((a) => a.style !== "cancel");
  const cancelActions = displayActions.filter((a) => a.style === "cancel");

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
            {displayTitle || displayDescription ? (
              <View style={styles.header}>
                {displayTitle ? <Text style={styles.title}>{displayTitle}</Text> : null}
                {displayDescription ? (
                  <Text style={styles.description}>{displayDescription}</Text>
                ) : null}
              </View>
            ) : null}

            {mainActions.map((action, index) => (
              <React.Fragment key={index}>
                {index > 0 || displayTitle || displayDescription ? (
                  <View style={styles.divider} />
                ) : null}
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
                    <Text
                      style={[
                        styles.actionLabel,
                        action.style === "destructive" && styles.destructiveLabel,
                        action.disabled && styles.disabledLabel,
                      ]}
                    >
                      {action.label}
                    </Text>
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
  header: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  title: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.noticeAccent,
    textAlign: "center",
  },
  description: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
    textAlign: "center",
    marginTop: 4,
    lineHeight: 18,
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
