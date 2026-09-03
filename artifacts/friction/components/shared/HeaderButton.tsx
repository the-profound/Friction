import React from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  type PressableProps,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, Shadows, Sizing } from "@/constants/tokens";

export type HeaderButtonVariant = "back" | "menu";

export interface HeaderButtonProps
  extends Omit<PressableProps, "children" | "style" | "accessibilityLabel"> {
  variant: HeaderButtonVariant;
  accessibilityLabel?: string;
  busy?: boolean;
}

const DEFAULT_LABELS: Record<HeaderButtonVariant, string> = {
  back: "뒤로가기",
  menu: "메뉴",
};

/**
 * Fixed-size circular controls for writing-flow headers.
 *
 * The 44px outer frame is the layout/touch contract. Its 40px circular
 * surface is intentionally kept on a separately sized inner layer because
 * ScalePressable animates that layer on press.
 */
export default function HeaderButton({
  variant,
  accessibilityLabel,
  busy = false,
  disabled = false,
  onPress,
  accessibilityState,
  ...rest
}: HeaderButtonProps) {
  const unavailable = disabled || busy;
  const iconName = variant === "back" ? "arrow-left" : "more-horizontal";
  const iconColor = unavailable ? Colors.zinc400 : Colors.backButtonIcon;

  return (
    <ScalePressable
      {...rest}
      style={styles.button}
      contentStyle={styles.surface}
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
        <ActivityIndicator size="small" color={iconColor} />
      ) : (
        <Feather
          name={iconName}
          size={Sizing.headerButtonIconSize}
          color={iconColor}
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
    alignSelf: "flex-start",
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
    backgroundColor: Colors.backButtonBg,
    alignItems: "center",
    justifyContent: "center",
    // Reanimated's web content layer can drop boxShadow. The native shadow
    // styles remain on the surface; web receives the same token on the outer
    // frame below.
    ...(Platform.OS === "web" ? {} : Shadows.navBar),
  },
});