import React, { useCallback, useRef } from "react";
import {
  Text,
  StyleProp,
  ViewStyle,
  TextStyle,
  type PressableProps,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";

export type SubmitButtonState = {
  pending: boolean;
  disabled: boolean;
};

export type SubmitButtonProps = {
  onPress: () => void | Promise<void>;
  pending: boolean;
  disabled?: boolean;
  label: string;
  pendingLabel?: string;
  style?: StyleProp<ViewStyle>;
  disabledStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  disabledTextStyle?: StyleProp<TextStyle>;
  renderIcon?: (state: SubmitButtonState) => React.ReactNode;
  hitSlop?: PressableProps["hitSlop"];
  testID?: string;
};

export default function SubmitButton({
  onPress,
  pending,
  disabled = false,
  label,
  pendingLabel,
  style,
  disabledStyle,
  textStyle,
  disabledTextStyle,
  renderIcon,
  hitSlop,
  testID,
}: SubmitButtonProps) {
  const inflightRef = useRef(false);
  const effectivelyDisabled = disabled || pending;
  const currentLabel = pending && pendingLabel ? pendingLabel : label;

  const handlePress = useCallback(async () => {
    if (effectivelyDisabled || inflightRef.current) return;
    inflightRef.current = true;
    try {
      await onPress();
    } finally {
      inflightRef.current = false;
    }
  }, [onPress, effectivelyDisabled]);

  return (
    <ScalePressable
      onPress={handlePress}
      disabled={effectivelyDisabled}
      style={[style, effectivelyDisabled && disabledStyle]}
      hitSlop={hitSlop}
      testID={testID}
    >
      {renderIcon ? renderIcon({ pending, disabled: effectivelyDisabled }) : null}
      <Text style={[textStyle, effectivelyDisabled && disabledTextStyle]}>
        {currentLabel}
      </Text>
    </ScalePressable>
  );
}
