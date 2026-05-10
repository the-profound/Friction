import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Shadows, Sizing, Spacing, Typography } from "@/constants/tokens";
import { useNavigation } from "@/contexts/NavigationContext";

interface PageHeaderProps {
  title: string;
  showSearch?: boolean;
  showAdd?: boolean;
  showKebab?: boolean;
  showProfile?: boolean;
  onSearchPress?: () => void;
  onAddPress?: () => void;
  onKebabPress?: () => void;
  onProfilePress?: () => void;
  searchActive?: boolean;
  addDisabled?: boolean;
  rightText?: string;
  onRightTextPress?: () => void;
  userInitial?: string;
}

export function PageHeader({
  title,
  showSearch = false,
  showAdd = false,
  showKebab = false,
  showProfile = false,
  onSearchPress,
  onAddPress,
  onKebabPress,
  onProfilePress,
  searchActive = false,
  addDisabled = false,
  rightText,
  onRightTextPress,
  userInitial,
}: PageHeaderProps) {
  const insets = useSafeAreaInsets();
  const { headerScrolled } = useNavigation();

  return (
    <View style={[styles.container, { paddingTop: 50 }, headerScrolled && Shadows.headerScrolled]}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.actions}>
        {rightText && (
          <Pressable onPress={onRightTextPress} hitSlop={8} style={styles.rightTextButton}>
            <Text style={styles.rightText}>{rightText}</Text>
          </Pressable>
        )}
        {showAdd && (
          <Pressable style={[styles.actionButton, addDisabled && styles.actionButtonDisabled]} onPress={addDisabled ? undefined : onAddPress} hitSlop={8}>
            <Feather name="plus" size={Sizing.plusIconSize} color={addDisabled ? Colors.zinc300 : Colors.zinc700} />
          </Pressable>
        )}
        {showSearch && (
          <Pressable
            style={[styles.actionButton, searchActive && styles.actionButtonActive]}
            onPress={onSearchPress}
            hitSlop={8}
          >
            <Feather name="search" size={Sizing.searchIconSize} color={Colors.zinc700} />
          </Pressable>
        )}
        {showKebab && (
          <Pressable style={styles.actionButton} onPress={onKebabPress} hitSlop={8}>
            <Feather name="check-square" size={20} color={Colors.zinc700} />
          </Pressable>
        )}
        {showProfile && (
          <Pressable
            style={styles.profileButton}
            onPress={onProfilePress}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="마이페이지"
          >
            {userInitial ? (
              <Text style={styles.profileInitial}>{userInitial}</Text>
            ) : (
              <Feather name="user" size={16} color={Colors.zinc700} />
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 20,
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
    alignItems: "center",
    justifyContent: "center",
  },
  profileInitial: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.zinc600,
    lineHeight: 17,
  },
});
