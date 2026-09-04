import { Feather } from "@expo/vector-icons";
import React from "react";
import { Image, ImageSourcePropType, Keyboard, Platform, StyleSheet, Text, TouchableWithoutFeedback, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ScalePressable from "@/components/shared/ScalePressable";
import HeaderButton from "@/components/shared/HeaderButton";

import { Colors, Shadows, Sizing, Spacing, Typography } from "@/constants/tokens";
import { useNavigation } from "@/contexts/NavigationContext";

interface PageHeaderProps {
  title: string;
  hideTitle?: boolean;
  titleImage?: ImageSourcePropType;
  showSearch?: boolean;
  showAdd?: boolean;
  showKebab?: boolean;
  showProfile?: boolean;
  showHistory?: boolean;
  showArchive?: boolean;
  onSearchPress?: () => void;
  onAddPress?: () => void;
  onKebabPress?: () => void;
  onProfilePress?: () => void;
  onHistoryPress?: () => void;
  onArchivePress?: () => void;
  kebabDisabled?: boolean;
  profileDisabled?: boolean;
  kebabAccessibilityLabel?: string;
  profileAccessibilityLabel?: string;
  searchActive?: boolean;
  addDisabled?: boolean;
  rightText?: string;
  onRightTextPress?: () => void;
  searchLast?: boolean;
}

export function PageHeader({
  title,
  hideTitle = false,
  titleImage,
  showSearch = false,
  showAdd = false,
  showKebab = false,
  showProfile = false,
  showHistory = false,
  showArchive = false,
  onSearchPress,
  onAddPress,
  onKebabPress,
  onProfilePress,
  onHistoryPress,
  onArchivePress,
  kebabDisabled = false,
  profileDisabled = false,
  kebabAccessibilityLabel = "메뉴 열기",
  profileAccessibilityLabel = "설정 및 활동 열기",
  searchActive = false,
  addDisabled = false,
  rightText,
  onRightTextPress,
  searchLast = false,
}: PageHeaderProps) {
  const { headerScrolled } = useNavigation();
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={[styles.container, { paddingTop: topInset + Spacing.headerPt }, headerScrolled && Shadows.headerScrolled]}>
        {hideTitle ? (
          <View />
        ) : titleImage ? (
          <Image
            source={titleImage}
            style={styles.titleImage}
            resizeMode="contain"
            accessibilityLabel={title}
          />
        ) : (
          <Text style={styles.title}>{title}</Text>
        )}
        <View style={styles.actions}>
          {rightText ? (
            <ScalePressable onPress={onRightTextPress} hitSlop={8} contentStyle={styles.rightTextButtonContent}>
              <Text style={styles.rightText}>{rightText}</Text>
            </ScalePressable>
          ) : null}
          {showAdd && (
            <ScalePressable
              style={styles.actionButton}
              contentStyle={[styles.actionButtonContent, addDisabled && styles.actionButtonDisabled]}
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
          {showArchive && (
            <ScalePressable
              style={styles.actionButton}
              contentStyle={styles.actionButtonContent}
              onPress={onArchivePress}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="보관된 공간"
            >
              <Feather name="archive" size={Sizing.searchIconSize} color={Colors.zinc700} />
            </ScalePressable>
          )}
          {!searchLast && showSearch && (
            <ScalePressable
              style={styles.actionButton}
              contentStyle={[styles.actionButtonContent, searchActive && styles.actionButtonActive]}
              onPress={onSearchPress}
              hitSlop={8}
            >
              <Feather name="search" size={Sizing.searchIconSize} color={Colors.zinc700} />
            </ScalePressable>
          )}
          {showKebab && (
            <HeaderButton
              variant="menu"
              onPress={onKebabPress}
              disabled={kebabDisabled || !onKebabPress}
              accessibilityLabel={kebabAccessibilityLabel}
            />
          )}
          {searchLast && showSearch && (
            <ScalePressable
              style={styles.actionButton}
              contentStyle={[styles.actionButtonContent, searchActive && styles.actionButtonActive]}
              onPress={onSearchPress}
              hitSlop={8}
            >
              <Feather name="search" size={Sizing.searchIconSize} color={Colors.zinc700} />
            </ScalePressable>
          )}
          {showProfile && (
            <HeaderButton
              variant="menu"
              onPress={onProfilePress}
              disabled={profileDisabled || !onProfilePress}
              accessibilityLabel={profileAccessibilityLabel}
            />
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
  titleImage: {
    height: 36,
    width: 108,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
  actionButton: {
    width: Sizing.searchButtonSize,
    height: Sizing.searchButtonSize,
  },
  actionButtonContent: {
    width: "100%",
    height: "100%",
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
  rightTextButtonContent: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  rightText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc600,
  },
});
