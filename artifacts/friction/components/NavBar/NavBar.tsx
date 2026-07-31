import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Animation, Colors, Shadows, Sizing, Spacing, TabConfig, Typography } from "@/constants/tokens";
import { useNavigation } from "@/contexts/NavigationContext";
import type { OfSubTabKey } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

export function NavBar() {
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const { width: screenWidth } = useWindowDimensions();
  const layerAnim = useRef(new Animated.Value(nav.layer === "main" ? 0 : 1)).current;

  const dockWidth = Platform.OS === "web"
    ? Sizing.navBarWidth
    : Math.min(screenWidth - 48, 340);

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
      <View style={[styles.dockShadow, Shadows.navBarIos, { width: dockWidth }]}>
      <View style={[styles.dock, Shadows.navBarAndroid, { width: dockWidth }]}>
        <Animated.View
          style={[styles.layerAbsolute, { width: dockWidth, height: Sizing.navBarHeight, opacity: mainOpacity }]}
          pointerEvents={nav.layer === "main" ? "auto" : "none"}
        >
          <Animated.View style={[styles.layerAbsolute, { width: dockWidth, height: Sizing.navBarHeight, transform: [{ scale: mainScale }] }]}>
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
        </Animated.View>

        <Animated.View
          style={[
            styles.layerAbsolute,
            { width: dockWidth, height: Sizing.navBarHeight, opacity: subOpacity },
          ]}
          pointerEvents={nav.layer === "sub" ? "auto" : "none"}
        >
          <Animated.View style={[styles.layerAbsolute, { width: dockWidth, height: Sizing.navBarHeight, transform: [{ scale: subScale }, { translateY: subTranslateY }] }]}>
          <ScalePressable
            style={styles.backButton}
            contentStyle={styles.backButtonContent}
            onPress={nav.goBackToMainLayer}
          >
            <Feather name="chevron-left" size={Sizing.backButtonIconSize} color={Colors.backButtonIcon} />
          </ScalePressable>
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
  const scale = useSharedValue(active ? Animation.scaleActive : 1);

  useEffect(() => {
    scale.value = withTiming(active ? Animation.scaleActive : 1, { duration: Animation.crossFadeDuration });
  }, [active, scale]);

  const animatedIconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <ScalePressable
      style={[styles.tabItem, { flex: 1 }]}
      contentStyle={styles.tabItemContent}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={`${label} 탭`}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
    >
      <Reanimated.View style={animatedIconStyle}>
        <Feather
          name={icon}
          size={Sizing.tabIconSize}
          color={active ? Colors.tabActive : Colors.tabInactive}
        />
      </Reanimated.View>
      <Text
        style={[
          styles.tabLabel,
          { color: active ? Colors.tabActive : Colors.tabInactiveAlt },
        ]}
        allowFontScaling={false}
        numberOfLines={1}
      >
        {label}
      </Text>
    </ScalePressable>
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
    backgroundColor: Colors.navBarBg,
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
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingHorizontal: Spacing.md,
  },
  tabItem: {
    flex: 1,
    minHeight: Sizing.touchTargetMin,
  },
  tabItemContent: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  tabLabel: {
    ...Typography.tabLabel,
  },
  backButton: {
    width: Sizing.backButtonW,
    height: Sizing.backButtonH,
    borderRadius: Sizing.navBarRadius,
    backgroundColor: Colors.backButtonBg,
  },
  backButtonContent: {
    alignItems: "center",
    justifyContent: "center",
  },
});
