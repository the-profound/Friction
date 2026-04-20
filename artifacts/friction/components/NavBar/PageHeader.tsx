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
  onSearchPress?: () => void;
  onAddPress?: () => void;
  onKebabPress?: () => void;
  searchActive?: boolean;
  rightText?: string;
  onRightTextPress?: () => void;
}

export function PageHeader({
  title,
  showSearch = false,
  showAdd = false,
  showKebab = false,
  onSearchPress,
  onAddPress,
  onKebabPress,
  searchActive = false,
  rightText,
  onRightTextPress,
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
          <Pressable style={styles.actionButton} onPress={onAddPress} hitSlop={8}>
            <Feather name="plus" size={Sizing.plusIconSize} color={Colors.zinc700} />
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
            <Feather name="more-vertical" size={20} color={Colors.zinc700} />
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
  rightTextButton: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  rightText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc600,
  },
});
