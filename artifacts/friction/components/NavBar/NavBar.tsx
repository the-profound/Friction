import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, StyleSheet, View, useWindowDimensions } from "react-native";
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Animation, Colors, Shadows, Sizing, Spacing, TabConfig } from "@/constants/tokens";
import { useNavigation } from "@/contexts/NavigationContext";
import { useThoughtComposer } from "@/contexts/ThoughtComposerContext";
import type { OfSubTabKey } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

const MIN_MENU_WIDTH = 220;

export function NavBar() {
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const { createDirectThought, isCreatingThought } = useThoughtComposer();
  const { width: screenWidth } = useWindowDimensions();
  const layerAnim = useRef(new Animated.Value(nav.layer === "main" ? 0 : 1)).current;

  const availableMenuWidth =
    screenWidth - Spacing.screenPx * 2 - Sizing.navBarHeight - Spacing.lg;
  const dockWidth = Math.min(
    Sizing.navBarWidth,
    Math.max(MIN_MENU_WIDTH, availableMenuWidth),
  );

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
      <View style={styles.navRow}>
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
        <ScalePressable
          style={styles.addButton}
          contentStyle={styles.addButtonContent}
          onPress={createDirectThought}
          disabled={isCreatingThought}
          accessibilityRole="button"
          accessibilityLabel={isCreatingThought ? "새 단상을 만드는 중" : "새 단상 작성"}
          accessibilityState={{ busy: isCreatingThought, disabled: isCreatingThought }}
        >
          {isCreatingThought ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Feather name="plus" size={Sizing.tabIconSize} color={Colors.white} />
          )}
        </ScalePressable>
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
  navRow: {
    height: Sizing.navBarHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.lg,
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
  },
  tabItemContent: {
    minHeight: Sizing.touchTargetMin,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  backButton: {
    width: Sizing.backButtonW,
    height: Sizing.backButtonH,
  },
  backButtonContent: {
    width: "100%",
    height: "100%",
    borderRadius: Sizing.navBarRadius,
    backgroundColor: Colors.backButtonBg,
    alignItems: "center",
    justifyContent: "center",
  },
  addButton: {
    width: Sizing.navBarHeight,
    height: Sizing.navBarHeight,
    flexGrow: 0,
    flexShrink: 0,
  },
  addButtonContent: {
    width: "100%",
    height: "100%",
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: Sizing.navBarRadius,
    backgroundColor: Colors.zinc900,
    alignItems: "center",
    justifyContent: "center",
    ...Shadows.navBarIos,
    ...Shadows.navBarAndroid,
  },
});
