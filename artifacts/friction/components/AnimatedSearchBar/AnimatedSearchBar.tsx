import { useEffect, useRef } from "react";
import { StyleSheet, TextInput, View } from "react-native";
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
  extraTopSpacing = false,
}: Props) {
  const progress = useSharedValue(active ? 1 : 0);
  const inputRef = useRef<TextInput>(null);

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
      <View style={[styles.searchBar, extraTopSpacing && styles.searchBarTopSpacing]}>
        <Feather name="search" size={Sizing.searchBarIconSize} color={Colors.searchIcon} />
        <TextInput
          ref={inputRef}
          style={styles.searchInput}
          placeholder={placeholder}
          placeholderTextColor={Colors.searchPlaceholder}
          value={value}
          onChangeText={onChangeText}
          returnKeyType="search"
        />
        {value.length > 0 && (
          <ScalePressable onPress={handleClear} hitSlop={8}>
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
});
