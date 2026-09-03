import { useRouter } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import HeaderButton from "@/components/shared/HeaderButton";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NeighborsInline } from "@/components/ToInline/NeighborsInline";
import { Colors, Spacing, Typography } from "@/constants/tokens";

export default function MyPageNeighborsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <HeaderButton
          variant="back"
          onPress={() => router.back()}
          accessibilityLabel="이웃 목록에서 돌아가기"
        />
        <Text style={styles.headerTitle}>이웃 목록</Text>
        <View style={styles.headerSpacer} />
      </View>
      <NeighborsInline />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    backgroundColor: Colors.white,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  headerSpacer: {
    width: 44,
  },
});
