import React from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  type PressableProps,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, Shadows, Sizing } from "@/constants/tokens";

export type HeaderButtonVariant = "back" | "menu" | "settings";

export interface HeaderButtonProps
  extends Omit<PressableProps, "children" | "style" | "accessibilityLabel"> {
  variant: HeaderButtonVariant;
  accessibilityLabel?: string;
  label?: string;
  busy?: boolean;
}

const DEFAULT_LABELS: Record<HeaderButtonVariant, string> = {
  back: "뒤로가기",
  menu: "메뉴",
  settings: "설정 열기",
};

/**
 * Fixed-size circular controls for shared and writing-flow headers.
 *
 * The 36px circular frame is both the layout/touch and visual contract.
 * The surface remains a separately styled inner layer because ScalePressable
 * animates that layer on press, but it fills the frame so no halo is exposed.
 */
export default function HeaderButton({
  variant,
  accessibilityLabel,
  label,
  busy = false,
  disabled = false,
  onPress,
  accessibilityState,
  ...rest
}: HeaderButtonProps) {
  const unavailable = disabled || busy;
  const iconName =
    variant === "back"
      ? "arrow-left"
      : variant === "settings"
        ? "settings"
        : "more-horizontal";
  const isRightAction = variant === "menu" || variant === "settings";
  const foregroundColor = unavailable
    ? Colors.zinc400
    : isRightAction
      ? Colors.noticeAccent
      : Colors.backButtonIcon;

  return (
    <ScalePressable
      {...rest}
      style={styles.button}
      contentStyle={[
        styles.surface,
        isRightAction
          ? [styles.rightActionSurface, unavailable && styles.rightActionSurfaceDisabled]
          : styles.backSurface,
      ]}
      onPress={onPress}
      disabled={unavailable}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? DEFAULT_LABELS[variant]}
      accessibilityState={{
        ...accessibilityState,
        disabled: unavailable,
        busy,
      }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={foregroundColor} />
      ) : variant === "menu" && label ? (
        <Text style={[styles.menuLabel, unavailable && styles.menuLabelDisabled]}>
          {label}
        </Text>
      ) : (
        <Feather
          name={iconName}
          size={Sizing.headerButtonIconSize}
          color={foregroundColor}
        />
      )}
    </ScalePressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: Sizing.headerButtonTouchSize,
    height: Sizing.headerButtonTouchSize,
    borderRadius: Sizing.headerButtonTouchSize / 2,
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "center",
    // Reanimated's web content layer can drop boxShadow, so keep the web
    // shadow on the non-scaled outer frame.
    ...(Platform.OS === "web" ? Shadows.navBar : {}),
  },
  surface: {
    width: Sizing.headerButtonSurfaceSize,
    height: Sizing.headerButtonSurfaceSize,
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "center",
    borderRadius: Sizing.headerButtonSurfaceSize / 2,
    backgroundColor: Colors.white,
    alignItems: "center",
    justifyContent: "center",
    // Reanimated's web content layer can drop boxShadow. The native shadow
    // styles remain on the surface; web receives the same token on the outer
    // frame below.
    ...(Platform.OS === "web" ? {} : Shadows.navBar),
  },
  backSurface: {
    backgroundColor: Colors.white,
  },
  rightActionSurface: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.noticeAccent,
  },
  rightActionSurfaceDisabled: {
    borderColor: Colors.zinc300,
  },
  menuLabel: {
    color: Colors.noticeAccent,
    fontFamily: "Pretendard-SemiBold",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
    textAlign: "center",
  },
  menuLabelDisabled: {
    color: Colors.zinc500,
  },
});