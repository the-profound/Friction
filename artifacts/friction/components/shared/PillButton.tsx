import React from "react";
import {
  Text,
  StyleSheet,
  Platform,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import ScalePressable, {
  type ScalePressableProps,
} from "@/components/shared/ScalePressable";
import { Colors, Typography } from "@/constants/tokens";

export type PillSize = "sm" | "md" | "lg";
export type PillVariant = "primary" | "secondary" | "outline";

const PILL_HEIGHT: Record<PillSize, number> = {
  sm: 33,
  md: 40,
  lg: 48,
};

const PILL_FONT_SIZE: Record<PillSize, number> = {
  sm: 13,
  md: 14,
  lg: 16,
};

const PILL_H_PADDING: Record<PillSize, number> = {
  sm: 14,
  md: 16,
  lg: 20,
};

export interface PillButtonProps extends Omit<ScalePressableProps, "contentStyle"> {
  size?: PillSize;
  variant?: PillVariant;
  label?: string;
  labelStyle?: StyleProp<TextStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}

export default function PillButton({
  size = "md",
  variant = "primary",
  label,
  labelStyle,
  style,
  contentStyle,
  children,
  ...rest
}: PillButtonProps) {
  const height = PILL_HEIGHT[size];
  const fontSize = PILL_FONT_SIZE[size];
  const paddingH = PILL_H_PADDING[size];

  return (
    <ScalePressable
      style={(state) => [
        styles.pill,
        { height },
        typeof style === "function" ? style(state) : style,
      ]}
      contentStyle={[
        styles.pillContent,
        { paddingHorizontal: paddingH },
        variantPillStyles[variant],
        contentStyle,
      ]}
      {...rest}
    >
      {children ?? (
        <Text
          style={[
            styles.label,
            { fontSize },
            variantLabelStyles[variant],
            labelStyle,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </ScalePressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: "center",
  },
  pillContent: {
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "auto",
    height: "100%",
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    ...Typography.bodySemiBold,
    fontFamily: Platform.select({
      ios: "Pretendard-SemiBold",
      default: "Pretendard-SemiBold",
    }),
  },
});

const variantPillStyles: Record<PillVariant, ViewStyle> = {
  primary: {
    backgroundColor: Colors.zinc900,
  },
  secondary: {
    backgroundColor: Colors.zinc100,
  },
  outline: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.zinc200,
  },
};

const variantLabelStyles: Record<PillVariant, TextStyle> = {
  primary: {
    color: Colors.white,
  },
  secondary: {
    color: Colors.zinc700,
  },
  outline: {
    color: Colors.zinc600,
  },
};
