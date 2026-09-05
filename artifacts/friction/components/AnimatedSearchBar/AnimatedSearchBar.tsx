import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, Sizing, Spacing, Typography } from "@/constants/tokens";

type Props = {
  active: boolean;
  value: string;
  onChangeText: (s: string) => void;
  placeholder: string;
  onClear?: () => void;
  onDismiss?: () => void;
  backgroundColor?: string;
  removeFocusOutline?: boolean;
  /**
   * When true, the bar reserves an extra 8px of top spacing (used by the
   * archive tab where the search bar sits below a sub-tab bar).
   */
  extraTopSpacing?: boolean;
};

export default function AnimatedSearchBar({
  active,
  value,
  onChangeText,
  placeholder,
  onClear,
  onDismiss,
  backgroundColor,
  removeFocusOutline = false,
  extraTopSpacing = false,
}: Props) {
  const progress = useSharedValue(active ? 1 : 0);
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const expandedHeight = Sizing.searchBarHeight + 8 + (extraTopSpacing ? 8 : 0);

  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, {
      duration: 200,
      easing: Easing.out(Easing.ease),
    });
    if (active) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    } else {
      inputRef.current?.blur();
    }
  }, [active, progress]);

  const containerStyle = useAnimatedStyle(() => ({
    height: progress.value * expandedHeight,
    opacity: progress.value,
  }));

  const handleClear = () => {
    onChangeText("");
    onClear?.();
  };

  return (
    <Animated.View style={[styles.container, containerStyle]}>
      <View style={[styles.searchBar, backgroundColor ? { backgroundColor } : null, extraTopSpacing && styles.searchBarTopSpacing]}>
        <Feather name="search" size={Sizing.searchBarIconSize} color={focused ? Colors.noticeAccent : Colors.searchIcon} />
        <TextInput
          ref={inputRef}
          style={[
            styles.searchInput,
            removeFocusOutline && Platform.OS === "web"
              ? ({ outlineStyle: "none", borderWidth: 0 } as object)
              : null,
          ]}
          placeholder={placeholder}
          placeholderTextColor={Colors.searchPlaceholder}
          cursorColor={Colors.cursorAccent}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          returnKeyType="search"
          accessibilityLabel={placeholder}
        />
        {(value.length > 0 || onDismiss) && (
          <ScalePressable
            style={styles.clearButton}
            contentStyle={styles.clearButtonContent}
            onPress={onDismiss ?? handleClear}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={onDismiss ? "검색 닫기" : "검색어 지우기"}
          >
            <Feather name="x" size={16} color={Colors.zinc400} />
          </ScalePressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.searchBarBg,
    marginHorizontal: Spacing.screenPx,
    borderRadius: Sizing.searchBarHeight / 2,
    height: Sizing.searchBarHeight,
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 8,
  },
  searchBarTopSpacing: {
    marginTop: 8,
  },
  searchInput: {
    flex: 1,
    ...Typography.searchInput,
    color: Colors.searchText,
    padding: 0,
  },
  clearButton: { width: 32, height: 32, flexGrow: 0, flexShrink: 0 },
  clearButtonContent: { width: 32, height: 32, flexGrow: 0, flexShrink: 0, alignItems: "center", justifyContent: "center" },
});
