import React from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, Spacing, Typography } from "@/constants/tokens";

export interface SelectionModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  testID?: string;
}

/**
 * A centered, platform-neutral selection modal.
 *
 * This intentionally does not use BottomSheet: send-flow selectors can be
 * composed independently without inheriting a sheet's snap or drag state.
 */
export function SelectionModal({
  visible,
  onClose,
  title,
  children,
  testID,
}: SelectionModalProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const horizontalMargin = Math.max(16, Math.min(32, width * 0.08));
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
  const verticalMargin = Math.max(16, Math.min(32, height * 0.06));
  const maxCardHeight = Math.max(
    260,
    height - topInset - bottomInset - verticalMargin * 2,
  );

  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}
      testID={testID}
    >
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="선택 모달 닫기"
          style={styles.backdrop}
          onPress={close}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.card,
            {
              width: Math.min(480, Math.max(0, width - horizontalMargin * 2)),
              maxHeight: maxCardHeight,
              marginTop: topInset + verticalMargin,
              marginBottom: bottomInset + verticalMargin,
            },
          ]}
        >
          <View style={styles.header}>
            <View style={styles.headerSide} />
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <ScalePressable
              style={styles.closeButton}
              contentStyle={styles.closeButtonContent}
              onPress={close}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="닫기"
            >
              <Feather name="x" size={20} color={Colors.zinc600} />
            </ScalePressable>
          </View>
          <View style={styles.body}>{children}</View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export interface SelectionModalStateProps {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  emptyIcon: React.ComponentProps<typeof Feather>["name"];
  emptyTitle: string;
  emptyMessage?: string;
}

/**
 * Shared loading, error and empty presentation for all send selectors.
 */
export function SelectionModalState({
  isLoading,
  isError,
  onRetry,
  emptyIcon,
  emptyTitle,
  emptyMessage,
}: SelectionModalStateProps) {
  if (isLoading) {
    return (
      <View style={styles.stateContainer} accessibilityLabel="불러오는 중">
        <ActivityIndicator size="small" color={Colors.zinc500} />
        <Text style={styles.stateMessage}>불러오는 중...</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.stateContainer}>
        <Feather name="alert-circle" size={32} color={Colors.zinc400} />
        <Text style={styles.stateTitle}>불러오지 못했어요</Text>
        <Text style={styles.stateMessage}>네트워크를 확인하고 다시 시도해주세요</Text>
        <ScalePressable
          style={styles.retryButton}
          contentStyle={styles.retryButtonContent}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="다시 시도"
        >
          <Text style={styles.retryButtonText}>다시 시도</Text>
        </ScalePressable>
      </View>
    );
  }

  return (
    <View style={styles.stateContainer}>
      <Feather name={emptyIcon} size={32} color={Colors.zinc400} />
      <Text style={styles.stateTitle}>{emptyTitle}</Text>
      {emptyMessage ? <Text style={styles.stateMessage}>{emptyMessage}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0, 0, 0, 0.42)",
  },
  card: {
    flex: 1,
    minHeight: 260,
    overflow: "hidden",
    borderRadius: 18,
    backgroundColor: Colors.white,
    ...Platform.select({
      ios: {
        shadowColor: Colors.black,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius: 18,
      },
      android: {
        elevation: 8,
      },
      web: {
        boxShadow: "0px 6px 18px rgba(0,0,0,0.18)",
      } as object,
      default: {},
    }),
  },
  header: {
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    paddingHorizontal: Spacing.lg,
  },
  headerSide: {
    width: 36,
    height: 36,
  },
  title: {
    ...Typography.bodySemiBold,
    flex: 1,
    color: Colors.zinc900,
    textAlign: "center",
  },
  closeButton: {
    width: 36,
    height: 36,
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "center",
  },
  closeButtonContent: {
    width: 36,
    height: 36,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  stateContainer: {
    flex: 1,
    minHeight: 190,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  stateTitle: {
    ...Typography.bodySemiBold,
    color: Colors.zinc900,
    textAlign: "center",
  },
  stateMessage: {
    ...Typography.caption,
    color: Colors.zinc500,
    textAlign: "center",
  },
  retryButton: {
    height: 44,
    alignSelf: "center",
    flexGrow: 0,
    flexShrink: 0,
  },
  retryButtonContent: {
    height: 44,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
    borderRadius: 10,
    backgroundColor: Colors.zinc900,
  },
  retryButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
});

export default SelectionModal;