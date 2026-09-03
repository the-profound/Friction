import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import HeaderButton from "@/components/shared/HeaderButton";
import { Colors, Spacing, Typography } from "@/constants/tokens";

export default function ActivityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <HeaderButton
          variant="back"
          onPress={() => router.back()}
          accessibilityLabel="프로필 관리에서 돌아가기"
        />
        <Text style={styles.title} allowFontScaling={false}>
          프로필 관리
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.emptyWrap}>
        <Feather name="clock" size={48} color={Colors.zinc300} />
        <Text style={styles.emptyTitle}>준비 중이에요</Text>
        <Text style={styles.emptySubtitle}>
          프로필 관리 기능은 곧 만나볼 수 있어요
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
  headerSpacer: {
    width: 44,
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
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 20,
  },
});
