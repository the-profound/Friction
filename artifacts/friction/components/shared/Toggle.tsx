import React, { useEffect, useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  ViewStyle,
  StyleProp,
} from "react-native";
import { Colors } from "../../constants/tokens";

/**
 * 무채색 커스텀 토글.
 *
 * react-native `Switch`를 쓰지 않는 이유:
 * react-native-web의 Switch는 ON 상태 thumb에 `thumbColor`를 적용하지 않고
 * 자체 기본값(teal #009688)을 그대로 쓴다. 그래서 웹에서 흰색 thumb를 지정해도
 * 청록색으로 렌더된다. iOS/Android/웹에서 동일하게 보이도록 직접 구현한다.
 *
 * 스타일 규칙(friction-button-styles):
 * - 모든 레이어에 고정 width/height + flexGrow/flexShrink 0 (native 세로 stretch 방지)
 * - borderWidth + overflow:"hidden" 조합 사용 안 함
 * - Animated는 전부 non-native 드라이버로 통일 (native/non-native 혼용 금지)
 */

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 26;
const THUMB_SIZE = 22;
const PADDING = (TRACK_HEIGHT - THUMB_SIZE) / 2;
const TRAVEL = TRACK_WIDTH - THUMB_SIZE - PADDING * 2;
const DURATION = 180;

export interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  /** 접근성 라벨 (예: "익명 운영") */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export default function Toggle({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
  style,
  testID,
}: ToggleProps) {
  // backgroundColor 보간이 필요하므로 non-native 드라이버로 통일한다.
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: value ? 1 : 0,
      duration: DURATION,
      useNativeDriver: false,
    }).start();
  }, [value, progress]);

  const trackColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [Colors.zinc500, Colors.zinc900],
  });

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, TRAVEL],
  });

  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => onValueChange(!value)}
      style={[styles.pressable, disabled && styles.disabled, style]}
    >
      <Animated.View style={[styles.track, { backgroundColor: trackColor }]}>
        <Animated.View style={[styles.thumb, { transform: [{ translateX }] }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "flex-start",
  },
  disabled: {
    opacity: 0.4,
  },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: TRACK_HEIGHT / 2,
    padding: PADDING,
    justifyContent: "center",
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: Colors.white,
  },
});
