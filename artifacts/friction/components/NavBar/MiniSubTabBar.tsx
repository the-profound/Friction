import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Animation, Colors, Shadows, Sizing, Spacing, TabConfig, Typography } from "@/constants/tokens";
import { useNavigation } from "@/contexts/NavigationContext";
import type { OfMiniSubTabKey } from "@/types/navigation";

export function MiniSubTabBar() {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const visibleAnim = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shouldShow =
    nav.activeTab === "OF" &&
    nav.layer === "sub" &&
    TabConfig.ofMiniSubTabs[nav.ofSubTab] !== null;

  const miniTabs = shouldShow ? TabConfig.ofMiniSubTabs[nav.ofSubTab] : null;
  const activeMini = nav.ofMiniSubTab[nav.ofSubTab];

  useEffect(() => {
    if (shouldShow) {
      Animated.timing(visibleAnim, {
        toValue: 1,
        duration: Animation.miniSubTabDuration,
        useNativeDriver: true,
      }).start();

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        Animated.timing(visibleAnim, {
          toValue: 0,
          duration: Animation.miniSubTabDuration,
          useNativeDriver: true,
        }).start();
      }, 3000);
    } else {
      Animated.timing(visibleAnim, {
        toValue: 0,
        duration: Animation.miniSubTabDuration,
        useNativeDriver: true,
      }).start();
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [shouldShow, nav.ofSubTab, visibleAnim]);

  if (!miniTabs) return null;

  const translateY = visibleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [Animation.miniSubTabTranslateYFrom, 0],
  });

  return (
    <Animated.View
      style={[
        styles.container,
        {
          bottom: Spacing.miniSubTabBottom + insets.bottom,
          opacity: visibleAnim,
          transform: [{ translateY }],
        },
      ]}
      pointerEvents={shouldShow ? "auto" : "none"}
    >
      <View style={[styles.bar, Shadows.navBar]}>
        {miniTabs.map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.miniTab, activeMini === tab.key && styles.miniTabActive]}
            onPress={() => nav.setOfMiniSubTab(nav.ofSubTab, tab.key as OfMiniSubTabKey)}
          >
            <Text style={[styles.miniTabText, activeMini === tab.key && styles.miniTabTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: Sizing.miniSubTabZIndex,
  },
  bar: {
    flexDirection: "row",
    backgroundColor: Colors.white,
    borderRadius: Sizing.navBarRadius,
    paddingHorizontal: 4,
    paddingVertical: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.navBarBorder,
  },
  miniTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Sizing.navBarRadius,
  },
  miniTabActive: {
    backgroundColor: Colors.zinc100,
  },
  miniTabText: {
    ...Typography.caption,
    color: Colors.zinc400,
  },
  miniTabTextActive: {
    color: Colors.zinc900,
    fontWeight: "600",
  },
});
