import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Animation, Colors, Shadows, Sizing, Spacing, TabConfig, Typography } from "@/constants/tokens";
import { useNavigation } from "@/contexts/NavigationContext";
import type { OfSubTabKey } from "@/constants/tokens";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

export function NavBar() {
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const layerAnim = useRef(new Animated.Value(nav.layer === "main" ? 0 : 1)).current;

  useEffect(() => {
    Animated.timing(layerAnim, {
      toValue: nav.layer === "sub" ? 1 : 0,
      duration: Animation.crossFadeDuration,
      useNativeDriver: true,
    }).start();
  }, [nav.layer, layerAnim]);

  const mainOpacity = layerAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const mainScale = layerAnim.interpolate({ inputRange: [0, 1], outputRange: [1, Animation.subTabScaleFrom] });
  const subOpacity = layerAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const subScale = layerAnim.interpolate({ inputRange: [0, 1], outputRange: [Animation.subTabScaleFrom, 1] });
  const subTranslateY = layerAnim.interpolate({ inputRange: [0, 1], outputRange: [Animation.subTabTranslateYFrom, 0] });

  const subItems = TabConfig.ofSubTabs;
  const activeSubTab = nav.ofSubTab;
  const onSubTabPress = (key: string) => nav.setOfSubTab(key as OfSubTabKey);

  return (
    <View style={[styles.container, { bottom: Spacing.navBarBottom + insets.bottom }]} pointerEvents="box-none">
      <View style={[styles.dockShadow, Shadows.navBarIos]}>
      <View style={[styles.dock, Shadows.navBarAndroid]}>
        <Animated.View
          style={[styles.layerAbsolute, { opacity: mainOpacity, transform: [{ scale: mainScale }] }]}
          pointerEvents={nav.layer === "main" ? "auto" : "none"}
        >
          {TabConfig.mainTabs.map((tab) => (
            <TabItem
              key={tab.key}
              icon={tab.icon as FeatherIconName}
              label={tab.label}
              active={nav.activeTab === tab.key}
              onPress={() => nav.setActiveTab(tab.key)}
            />
          ))}
        </Animated.View>

        <Animated.View
          style={[
            styles.layerAbsolute,
            { opacity: subOpacity, transform: [{ scale: subScale }, { translateY: subTranslateY }] },
          ]}
          pointerEvents={nav.layer === "sub" ? "auto" : "none"}
        >
          <Pressable style={styles.backButton} onPress={nav.goBackToMainLayer}>
            <Feather name="chevron-left" size={Sizing.backButtonIconSize} color={Colors.backButtonIcon} />
          </Pressable>
          {subItems.map((item) => (
            <TabItem
              key={item.key}
              icon={item.icon as FeatherIconName}
              label={item.label}
              active={activeSubTab === item.key}
              onPress={() => onSubTabPress(item.key)}
            />
          ))}
        </Animated.View>
      </View>
      </View>
    </View>
  );
}

function TabItem({
  icon,
  label,
  active,
  onPress,
}: {
  icon: FeatherIconName;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.tabItem}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={`${label} 탭`}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
    >
      <Animated.View style={{ transform: [{ scale: active ? Animation.scaleActive : 1 }] }}>
        <Feather
          name={icon}
          size={Sizing.tabIconSize}
          color={active ? Colors.tabActive : Colors.tabInactive}
        />
      </Animated.View>
      <Text
        style={[
          styles.tabLabel,
          { color: active ? Colors.tabActive : Colors.tabInactiveAlt },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: Sizing.navBarZIndex,
  },
  dockShadow: {
    borderRadius: Sizing.navBarRadius,
  },
  dock: {
    width: Sizing.navBarWidth,
    height: Sizing.navBarHeight,
    borderRadius: Sizing.navBarRadius,
    backgroundColor: Colors.navBarBg,
    borderWidth: 1,
    borderColor: Colors.navBarBorder,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  layerAbsolute: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingHorizontal: Spacing.md,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    minHeight: Sizing.touchTargetMin,
  },
  tabLabel: {
    ...Typography.tabLabel,
  },
  backButton: {
    width: Sizing.backButtonW,
    height: Sizing.backButtonH,
    borderRadius: Sizing.navBarRadius,
    backgroundColor: Colors.backButtonBg,
    alignItems: "center",
    justifyContent: "center",
  },
});
