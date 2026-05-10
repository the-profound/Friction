import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NeighborsInline } from "@/components/ToInline/NeighborsInline";
import { Colors, Spacing, Typography } from "@/constants/tokens";

export default function MyPageNeighborsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ScalePressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}
        contentStyle={styles.backButtonContent}
        >
          <Feather name="chevron-left" size={24} color={Colors.zinc700} />
        </ScalePressable>
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
  backButton: {
    width: 36,
    height: 36,
  },
  backButtonContent: {
    alignItems: "center",
    justifyContent: "center",},
  headerTitle: {
    flex: 1,
    textAlign: "center",
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  headerSpacer: {
    width: 36,
  },
});
