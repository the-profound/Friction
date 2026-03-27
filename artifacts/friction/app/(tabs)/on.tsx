import React, { useCallback } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { PageHeader } from "@/components/NavBar/PageHeader";

export default function OnScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleNewMemo = useCallback(() => {
    router.push("/on-01a");
  }, [router]);

  const handleViewAll = useCallback(() => {
    router.push("/on-02");
  }, [router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PageHeader
        title="기록함"
        showAdd
        onAddPress={handleNewMemo}
        showSearch
        onSearchPress={handleViewAll}
      />
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>메모를 작성해보세요</Text>
        <Text style={styles.emptySubtitle}>떠오르는 생각을 기록하고{"\n"}편지로 완성할 수 있어요</Text>
        <Pressable style={styles.createButton} onPress={handleNewMemo}>
          <Feather name="edit-3" size={16} color={Colors.white} />
          <Text style={styles.createButtonText}>새 메모</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: Spacing.navBarPaddingBottom,
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
    lineHeight: 22,
    marginBottom: 24,
  },
  createButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.zinc900,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  createButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
});
