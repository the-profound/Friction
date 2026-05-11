import { Feather } from "@expo/vector-icons";
import React from "react";
import { Keyboard, StyleSheet, Text, TouchableWithoutFeedback, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ScalePressable from "@/components/shared/ScalePressable";

import { Colors, Shadows, Sizing, Spacing, Typography } from "@/constants/tokens";
import { useNavigation } from "@/contexts/NavigationContext";

interface PageHeaderProps {
  title: string;
  showSearch?: boolean;
  showAdd?: boolean;
  showKebab?: boolean;
  showProfile?: boolean;
  showHistory?: boolean;
  onSearchPress?: () => void;
  onAddPress?: () => void;
  onKebabPress?: () => void;
  onProfilePress?: () => void;
  onHistoryPress?: () => void;
  searchActive?: boolean;
  addDisabled?: boolean;
  rightText?: string;
  onRightTextPress?: () => void;
  searchLast?: boolean;
}

export function PageHeader({
  title,
  showSearch = false,
  showAdd = false,
  showKebab = false,
  showProfile = false,
  showHistory = false,
  onSearchPress,
  onAddPress,
  onKebabPress,
  onProfilePress,
  onHistoryPress,
  searchActive = false,
  addDisabled = false,
  rightText,
  onRightTextPress,
  searchLast = false,
}: PageHeaderProps) {
  const insets = useSafeAreaInsets();
  const { headerScrolled } = useNavigation();

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={[styles.container, { paddingTop: 50 }, headerScrolled && Shadows.headerScrolled]}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.actions}>
          {rightText && (
            <ScalePressable onPress={onRightTextPress} hitSlop={8} style={styles.rightTextButton}>
              <Text style={styles.rightText}>{rightText}</Text>
            </ScalePressable>
          )}
          {showAdd && (
            <ScalePressable
              style={[styles.actionButton, addDisabled && styles.actionButtonDisabled]}
              contentStyle={styles.actionButtonContent}
              onPress={addDisabled ? undefined : onAddPress}
              hitSlop={8}
            >
              <Feather name="plus" size={Sizing.plusIconSize} color={addDisabled ? Colors.zinc300 : Colors.zinc700} />
            </ScalePressable>
          )}
          {showHistory && (
            <ScalePressable
              style={styles.actionButton}
              contentStyle={styles.actionButtonContent}
              onPress={onHistoryPress}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="발신 기록"
            >
              <Feather name="clock" size={Sizing.searchIconSize} color={Colors.zinc700} />
            </ScalePressable>
          )}
          {!searchLast && showSearch && (
            <ScalePressable
              style={[styles.actionButton, searchActive && styles.actionButtonActive]}
              contentStyle={styles.actionButtonContent}
              onPress={onSearchPress}
              hitSlop={8}
            >
              <Feather name="search" size={Sizing.searchIconSize} color={Colors.zinc700} />
            </ScalePressable>
          )}
          {showKebab && (
            <ScalePressable
              style={styles.actionButton}
              contentStyle={styles.actionButtonContent}
              onPress={onKebabPress}
              hitSlop={8}
            >
              <Feather name="check-square" size={20} color={Colors.zinc700} />
            </ScalePressable>
          )}
          {searchLast && showSearch && (
            <ScalePressable
              style={[styles.actionButton, searchActive && styles.actionButtonActive]}
              contentStyle={styles.actionButtonContent}
              onPress={onSearchPress}
              hitSlop={8}
            >
              <Feather name="search" size={Sizing.searchIconSize} color={Colors.zinc700} />
            </ScalePressable>
          )}
          {showProfile && (
            <ScalePressable
              style={styles.profileButton}
              contentStyle={styles.actionButtonContent}
              onPress={onProfilePress}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="설정 및 활동"
            >
              <Feather name="menu" size={16} color={Colors.zinc700} />
            </ScalePressable>
          )}
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 15,
    backgroundColor: Colors.white,
  },
  title: {
    ...Typography.headerTitle,
    color: Colors.zinc900,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
  actionButton: {
    width: Sizing.searchButtonSize,
    height: Sizing.searchButtonSize,
    borderRadius: Sizing.searchButtonSize / 2,
    backgroundColor: Colors.searchBgInactive,
  },
  actionButtonContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  actionButtonActive: {
    backgroundColor: Colors.searchBgActive,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  rightTextButton: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  rightText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc600,
  },
  profileButton: {
    width: Sizing.searchButtonSize,
    height: Sizing.searchButtonSize,
    borderRadius: Sizing.searchButtonSize / 2,
    backgroundColor: Colors.zinc100,
    borderWidth: 1.5,
    borderColor: Colors.zinc200,
  },
});
