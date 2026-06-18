import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, Spacing, Typography } from "@/constants/tokens";

export default function ActivityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <ScalePressable
          style={styles.backButton}
          contentStyle={styles.backButtonContent}
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="뒤로가기"
        >
          <Feather name="arrow-left" size={22} color={Colors.zinc700} />
        </ScalePressable>
        <Text style={styles.title} allowFontScaling={false}>
          활동 내역
        </Text>
        <View style={styles.backButton} />
      </View>

      <View style={styles.emptyWrap}>
        <Feather name="clock" size={48} color={Colors.zinc300} />
        <Text style={styles.emptyTitle}>준비 중이에요</Text>
        <Text style={styles.emptySubtitle}>
          활동 내역 기능은 곧 만나볼 수 있어요
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    height: 52,
  },
  backButton: {
    width: 36,
    height: 36,
  },
  backButtonContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
    letterSpacing: -0.3,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.screenPx,
    gap: 12,
    paddingBottom: 60,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc600,
    letterSpacing: -0.3,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
    textAlign: "center",
    lineHeight: 20,
  },
});
