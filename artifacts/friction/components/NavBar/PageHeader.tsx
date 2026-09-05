import { Feather } from "@expo/vector-icons";
import React from "react";
import { Image, ImageSourcePropType, Keyboard, Platform, StyleSheet, Text, TouchableWithoutFeedback, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ScalePressable from "@/components/shared/ScalePressable";
import HeaderButton, { type HeaderButtonVariant } from "@/components/shared/HeaderButton";
import { HeaderAccentLine } from "@/components/NavBar/HeaderAccentLine";

import { Colors, Shadows, Sizing, Spacing, Typography } from "@/constants/tokens";
import { useNavigation } from "@/contexts/NavigationContext";

interface PageHeaderProps {
  title: string;
  centeredBrandTitle?: boolean;
  showBack?: boolean;
  onBackPress?: () => void;
  backAccessibilityLabel?: string;
  hideTitle?: boolean;
  titleImage?: ImageSourcePropType;
  showSearch?: boolean;
  showAdd?: boolean;
  showKebab?: boolean;
  showProfile?: boolean;
  profileButtonVariant?: Exclude<HeaderButtonVariant, "back">;
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
  centeredBrandTitle = false,
  showBack = false,
  onBackPress,
  backAccessibilityLabel = "뒤로 가기",
  hideTitle = false,
  titleImage,
  showSearch = false,
  showAdd = false,
  showKebab = false,
  showProfile = false,
  profileButtonVariant = "menu",
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
  const { width: windowWidth } = useWindowDimensions();
  const topInset = Platform.OS === "web" ? 67 : insets.top;

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={[styles.shell, headerScrolled && Shadows.headerScrolled]}>
        <View
          style={[
            styles.container,
            centeredBrandTitle && styles.centeredContainer,
            { paddingTop: topInset + Spacing.headerPt },
          ]}
        >
          {centeredBrandTitle ? (
            <View style={styles.headerSide}>
              {showBack ? (
                <HeaderButton
                  variant="back"
                  onPress={onBackPress}
                  accessibilityLabel={backAccessibilityLabel}
                />
              ) : null}
            </View>
          ) : null}
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
            <View style={centeredBrandTitle ? styles.centeredTitleContainer : undefined}>
              <Text
                style={[
                  styles.title,
                  centeredBrandTitle && styles.centeredBrandTitle,
                  centeredBrandTitle && {
                    fontSize: windowWidth * 0.045,
                    lineHeight: windowWidth * 0.065,
                  },
                ]}
              >
                {title}
              </Text>
            </View>
          )}
          <View style={[styles.actions, centeredBrandTitle && styles.centeredActions]}>
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
              variant={profileButtonVariant}
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
        {centeredBrandTitle ? (
          <HeaderAccentLine titleLineHeight={windowWidth * 0.065} />
        ) : null}
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: "relative",
    backgroundColor: Colors.white,
  },
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 15,
    backgroundColor: Colors.white,
  },
  centeredContainer: {
    justifyContent: "center",
  },
  headerSide: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...Typography.headerTitle,
    color: Colors.zinc900,
  },
  centeredTitleContainer: {
    flexShrink: 0,
    height: Sizing.searchButtonSize,
    alignItems: "center",
    justifyContent: "center",
  },
  centeredBrandTitle: {
    color: Colors.noticeAccent,
    fontFamily: "Eulyoo1945-SemiBold",
    fontWeight: "600",
    letterSpacing: 0,
    textAlign: "center",
  },
  titleImage: {
    height: 36,
    width: 108,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: Sizing.searchButtonSize,
    marginLeft: "auto",
    gap: 8,
  },
  centeredActions: {
    flex: 1,
    justifyContent: "flex-end",
    marginLeft: 0,
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
