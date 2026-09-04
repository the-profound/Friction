import React, { useRef } from "react";
import { View, Text, StyleSheet, Modal, Pressable } from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, ZIndex, Spacing } from "../../constants/tokens";

interface ActionButton {
  emoji: string;
  label: string;
  onPress: () => void;
}

interface DeleteButton {
  onPress: () => void;
  /**
   * Visual-only: reduces button opacity to indicate restricted access.
   * The onPress handler still fires so callers can show an explanatory message.
   */
  disabled?: boolean;
}

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  onCancel: () => void;
  description?: string;
  actionButton?: ActionButton;
  deleteButton?: DeleteButton;
  hint?: string;
  onConfirm?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Prevents duplicate submissions while a mutation is in flight. */
  confirmDisabled?: boolean;
  /** Keeps a destructive dialog open while its mutation is in flight. */
  cancelDisabled?: boolean;
  /**
   * Optional handler for backdrop / outside tap. When omitted, backdrop press
   * falls through to `onCancel` (the previous default). Provide this when the
   * cancel button has a side effect that should NOT fire on accidental
   * backdrop dismiss.
   */
  onBackdropPress?: () => void;
}

export default function ConfirmModal({
  visible,
  title,
  onCancel,
  description,
  actionButton,
  deleteButton,
  hint,
  onConfirm,
  confirmLabel = "확인",
  cancelLabel = "취소",
  destructive = false,
  confirmDisabled = false,
  cancelDisabled = false,
  onBackdropPress,
}: ConfirmModalProps) {
  // Freeze content while the modal is fading out so the last real values
  // remain visible instead of flashing the empty/fallback state.
  const frozenTitle = useRef(title);
  const frozenDescription = useRef(description);
  const frozenActionButton = useRef(actionButton);
  const frozenDeleteButton = useRef(deleteButton);
  const frozenHint = useRef(hint);
  const frozenConfirmLabel = useRef(confirmLabel);
  const frozenCancelLabel = useRef(cancelLabel);
  const frozenDestructive = useRef(destructive);

  if (visible) {
    frozenTitle.current = title;
    frozenDescription.current = description;
    frozenActionButton.current = actionButton;
    frozenDeleteButton.current = deleteButton;
    frozenHint.current = hint;
    frozenConfirmLabel.current = confirmLabel;
    frozenCancelLabel.current = cancelLabel;
    frozenDestructive.current = destructive;
  }

  const displayTitle = frozenTitle.current;
  const displayDescription = frozenDescription.current;
  const displayActionButton = frozenActionButton.current;
  const displayDeleteButton = frozenDeleteButton.current;
  const displayHint = frozenHint.current;
  const displayConfirmLabel = frozenConfirmLabel.current;
  const displayCancelLabel = frozenCancelLabel.current;
  const displayDestructive = frozenDestructive.current;

  const isNewLayout = !!displayActionButton;

  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent>
        <Pressable style={styles.overlay} onPress={cancelDisabled ? undefined : (onBackdropPress ?? onCancel)}>
        <View style={styles.contentWrapper}>
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>{displayTitle}</Text>
            {displayDescription ? <Text style={styles.description}>{displayDescription}</Text> : null}

            {isNewLayout ? (
              <View style={styles.actionRow}>
                <ScalePressable
                  style={styles.actionButton}
                  contentStyle={styles.actionButtonContent}
                  onPress={displayActionButton.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={displayActionButton.label}
                >
                  <Text style={styles.actionButtonEmoji}>{displayActionButton.emoji}</Text>
                  <Text style={styles.actionButtonLabel}>{displayActionButton.label}</Text>
                </ScalePressable>

                {displayDeleteButton && (
                  <ScalePressable
                    style={styles.deleteButton}
                    contentStyle={[
                      styles.deleteButtonContent,
                      displayDeleteButton.disabled && styles.deleteButtonDisabled,
                    ]}
                    onPress={displayDeleteButton.onPress}
                    accessibilityRole="button"
                    accessibilityLabel="삭제"
                  >
                    <Feather name="trash-2" size={20} color={Colors.white} />
                  </ScalePressable>
                )}
              </View>
            ) : (
              <View style={styles.buttons}>
                <ScalePressable
                  style={styles.button}
                  contentStyle={[styles.buttonContent, styles.cancelButton]}
                  onPress={onCancel}
                  disabled={cancelDisabled}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: cancelDisabled }}
                >
                  <Text style={styles.cancelText}>{displayCancelLabel}</Text>
                </ScalePressable>
                {onConfirm != null && (
                  <ScalePressable
                    style={styles.button}
                    contentStyle={[
                      styles.buttonContent,
                      displayDestructive ? styles.destructiveButton : styles.confirmButton,
                      confirmDisabled && styles.buttonDisabled,
                    ]}
                    onPress={onConfirm}
                    disabled={confirmDisabled}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: confirmDisabled, busy: confirmDisabled }}
                  >
                    <Text style={[styles.confirmText, displayDestructive && styles.destructiveText]}>
                      {displayConfirmLabel}
                    </Text>
                  </ScalePressable>
                )}
              </View>
            )}
          </Pressable>

          {displayHint ? (
            <Text style={styles.hint}>{displayHint}</Text>
          ) : null}
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
  },
  contentWrapper: {
    width: "100%",
    alignItems: "center",
  },
  hint: {
    marginTop: 14,
    fontSize: 13,
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
    lineHeight: 18,
  },
  card: {
    width: "100%",
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  title: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
    textAlign: "center",
  },
  description: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: "row",
    marginTop: 20,
    gap: 10,
    alignItems: "center",
  },
  actionButton: {
    flex: 1,
  },
  actionButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.zinc100,
  },
  actionButtonEmoji: {
    fontSize: 18,
  },
  actionButtonLabel: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc700,
  },
  deleteButton: {
    width: 52,
    height: 52,
  },
  deleteButtonContent: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteButtonDisabled: {
    opacity: 0.35,
  },
  buttons: {
    flexDirection: "row",
    marginTop: 20,
    gap: 10,
  },
  button: {
    flex: 1,
    height: 48,
  },
  buttonContent: {
    height: 48,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  cancelButton: {
    backgroundColor: Colors.zinc100,
  },
  confirmButton: {
    backgroundColor: Colors.primaryAction,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  destructiveButton: {
    backgroundColor: "#FEE2E2",
  },
  cancelText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc600,
  },
  confirmText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.primaryActionForeground,
  },
  destructiveText: {
    color: "#DC2626",
  },
});
