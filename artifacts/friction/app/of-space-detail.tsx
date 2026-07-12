import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";

export default function SpaceDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ScalePressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </ScalePressable>
        <Text style={styles.headerTitle}>공간 상세</Text>
        <View style={{ width: 28 }} />
      </View>
      <View style={styles.body}>
        <Feather name="grid" size={40} color={Colors.zinc300} />
        <Text style={styles.label}>공간 상세 화면</Text>
        <Text style={styles.sublabel}>준비 중이에요</Text>
        {id ? <Text style={styles.idText}>{id}</Text> : null}
      </View>
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
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 12,
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: Spacing.screenPx,
  },
  label: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
    marginTop: 12,
  },
  sublabel: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
  },
  idText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc300,
    marginTop: 8,
  },
});
