import { Feather } from "@expo/vector-icons";
import React from "react";
import { Image, ImageSourcePropType, Keyboard, Platform, StyleSheet, Text, TouchableWithoutFeedback, useWindowDimensions, View, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ScalePressable from "@/components/shared/ScalePressable";
import HeaderButton, { type HeaderButtonVariant } from "@/components/shared/HeaderButton";
import { HeaderAccentLine } from "@/components/NavBar/HeaderAccentLine";

import { Colors, Shadows, Sizing, Spacing, Typography } from "@/constants/tokens";
import { useNavigation } from "@/contexts/NavigationContext";

// expo-linear-gradient's types don't line up with the RN style array pattern
// used throughout this file; the rest of the codebase casts it the same way
// (see app/(tabs)/on.tsx).
const Gradient = LinearGradient as unknown as React.ComponentType<any>;

/**
 * Height of the fading tail appended below a header block when it needs to
 * blend into scrolling content underneath it (see `HeaderFadeTail`).
 * Shared so every screen's overlap/reveal band feels the same size.
 */
export const HEADER_FADE_HEIGHT = 24;
const HEADER_OVERLAY_SEAM_OVERLAP = 2;

/** Converts a "#RRGGBB" (or "#RGB") hex color into an "rgba(r,g,b,alpha)" string. */
function hexToRgba(hex: string, alpha: number): string {
  let normalized = hex.replace("#", "");
  if (normalized.length === 3) {
    normalized = normalized.split("").map((c) => c + c).join("");
  }
  const int = parseInt(normalized, 16);
  if (normalized.length !== 6 || Number.isNaN(int)) {
    // Fall back gracefully for non-hex inputs (e.g. already an rgba/named color)
    // rather than rendering a broken gradient.
    return alpha <= 0 ? "transparent" : hex;
  }
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * A thin, non-interactive strip that fades a solid `backgroundColor` down to
 * fully transparent, then overlaps the next sibling by its own height (via a
 * matching negative margin) so scrolling content underneath is revealed
 * through the fade instead of being hard-cut by the header's bottom edge.
 *
 * Drop this in directly above whatever actually scrolls (a FlatList/
 * ScrollView) — not above static header chrome like filter rows or search
 * bars, since its zIndex would otherwise wash out over their content.
 */
export function HeaderFadeTail({
  backgroundColor = Colors.white,
  height = HEADER_FADE_HEIGHT,
}: {
  backgroundColor?: string;
  height?: number;
}) {
  return (
    <View
      pointerEvents="none"
      style={[styles.fadeTail, { height, marginBottom: -height }]}
    >
      <Gradient
        colors={[hexToRgba(backgroundColor, 1), hexToRgba(backgroundColor, 0)]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/**
 * Shared layout contract for controls floated above scrolling content.
 * The solid control band and fading tail are one absolute overlay, while every
 * non-control layer lets list scrolling and card presses pass through.
 */
export function HeaderFadeOverlay({
  controlHeight,
  children,
  backgroundColor = Colors.white,
  fadeHeight = HEADER_FADE_HEIGHT,
  fadeFromTop = false,
  style,
}: {
  controlHeight: number;
  children: React.ReactNode;
  backgroundColor?: string;
  fadeHeight?: number;
  /** Start the fade behind the control bar itself instead of below a solid band. */
  fadeFromTop?: boolean;
  style?: ViewStyle;
}) {
  const overlayHeight = controlHeight + fadeHeight + HEADER_OVERLAY_SEAM_OVERLAP;
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.fadeOverlay,
        {
          top: -HEADER_OVERLAY_SEAM_OVERLAP,
          height: overlayHeight,
        },
        style,
      ]}
    >
      {!fadeFromTop ? (
        <View
          pointerEvents="none"
          style={[
            styles.fadeOverlaySolid,
            {
              height: controlHeight + HEADER_OVERLAY_SEAM_OVERLAP,
              backgroundColor,
            },
          ]}
        />
      ) : null}
      <Gradient
        pointerEvents="none"
        colors={[hexToRgba(backgroundColor, 1), hexToRgba(backgroundColor, 0)]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[
          styles.fadeOverlayTail,
          fadeFromTop
            ? { top: 0, height: overlayHeight }
            : {
                top: controlHeight + HEADER_OVERLAY_SEAM_OVERLAP,
                height: fadeHeight,
              },
        ]}
      />
      <View pointerEvents="box-none" style={styles.fadeOverlayControls}>
        {children}
      </View>
    </View>
  );
}

interface PageHeaderProps {
  title: string;
  centeredBrandTitle?: boolean;
  showBack?: boolean;
  /** Override the header background. Defaults to Colors.white.
   *  Pass Colors.zinc50 (or any other color) to blend with a non-white screen. */
  backgroundColor?: string;
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
  /**
   * When true, appends a `HeaderFadeTail` right after this header so the
   * scrollable content immediately below fades in/out instead of getting
   * hard-cut. Only use this when NOTHING else (a filter row, a search bar)
   * sits between this PageHeader and the actual scrolling list — otherwise
   * place `HeaderFadeTail` manually right above the list instead.
   */
  fadeBottom?: boolean;
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
  backgroundColor = Colors.white,
  fadeBottom = false,
}: PageHeaderProps) {
  const { headerScrolled } = useNavigation();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const topInset = Platform.OS === "web" ? 67 : insets.top;

  // Shared header controls and the other circular actions use the same 36px row.
  const rowHeight = Sizing.headerButtonTouchSize;

  return (
    <>
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={[styles.shell, headerScrolled && Shadows.headerScrolled, { backgroundColor }]}>
        <View
          style={[
            styles.container,
            centeredBrandTitle && styles.centeredContainer,
            { paddingTop: topInset + Spacing.headerPt, backgroundColor },
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
          <HeaderAccentLine titleLineHeight={windowWidth * 0.065} rowHeight={rowHeight} />
        ) : null}
      </View>
    </TouchableWithoutFeedback>
    {fadeBottom ? <HeaderFadeTail backgroundColor={backgroundColor} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  fadeOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 5,
  },
  fadeOverlaySolid: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  fadeOverlayTail: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  fadeOverlayControls: {
    position: "absolute",
    top: HEADER_OVERLAY_SEAM_OVERLAP,
    left: 0,
    right: 0,
  },
  shell: {
    position: "relative",
    backgroundColor: Colors.white,
  },
  fadeTail: {
    zIndex: 5,
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
    // Row direction so the back button sits at the left edge of this side-slot.
    // In a column container the cross-axis is horizontal, so alignSelf:"center"
    // on the button would centre it horizontally — not what we want. Making
    // this a row means alignSelf:"center" now centres vertically (desired).
    flexDirection: "row",
    alignItems: "center",
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
