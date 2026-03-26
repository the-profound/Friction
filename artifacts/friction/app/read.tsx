import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ProgressIndicator from "@/components/ProgressIndicator/ProgressIndicator";

export default function ReadScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [currentPage, setCurrentPage] = useState(0);
  const totalPages = 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <View style={styles.progressContainer}>
          <ProgressIndicator
            type="linear"
            progress={totalPages > 0 ? (currentPage + 1) / totalPages : 0}
            size="small"
          />
        </View>
        <Text style={styles.pageIndicator}>
          {totalPages > 0 ? `${currentPage + 1}/${totalPages}` : ""}
        </Text>
      </View>
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>읽기 화면</Text>
        <Text style={styles.emptySubtitle}>편지를 선택하면 여기서 읽을 수 있어요</Text>
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
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 12,
    gap: 12,
  },
  progressContainer: {
    flex: 1,
  },
  pageIndicator: {
    ...Typography.caption,
    color: Colors.zinc400,
    minWidth: 32,
    textAlign: "right",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.zinc900,
    marginBottom: 8,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
  },
});
