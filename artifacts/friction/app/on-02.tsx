import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";

type SortMode = "latest" | "oldest" | "status";

export default function MemoCollectionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [isManageMode, setIsManageMode] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("latest");

  const sortOptions: { key: SortMode; label: string }[] = [
    { key: "latest", label: "최신순" },
    { key: "oldest", label: "오래된순" },
    { key: "status", label: "상태별" },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <Text style={styles.headerTitle}>메모 모음</Text>
        <Pressable onPress={() => setIsManageMode(!isManageMode)} hitSlop={12}>
          <Text style={styles.manageButton}>
            {isManageMode ? "완료" : "관리"}
          </Text>
        </Pressable>
      </View>
      <View style={styles.sortBar}>
        {sortOptions.map((opt) => (
          <Pressable
            key={opt.key}
            style={[styles.sortChip, sortMode === opt.key && styles.sortChipActive]}
            onPress={() => setSortMode(opt.key)}
          >
            <Text style={[styles.sortChipText, sortMode === opt.key && styles.sortChipTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.emptyContainer}>
        <Feather name="edit-3" size={40} color={Colors.zinc300} />
        <Text style={styles.emptyTitle}>아직 메모가 없어요</Text>
        <Text style={styles.emptySubtitle}>기록함에서 새 메모를 작성해보세요</Text>
        <Pressable style={styles.writeButton} onPress={() => router.push("/on-01a")}>
          <Feather name="edit" size={16} color={Colors.white} />
          <Text style={styles.writeButtonText}>새 메모 쓰기</Text>
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
  manageButton: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc600,
  },
  sortBar: {
    flexDirection: "row",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
    marginBottom: 8,
  },
  sortChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.zinc50,
  },
  sortChipActive: {
    backgroundColor: Colors.zinc900,
  },
  sortChipText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
  },
  sortChipTextActive: {
    color: Colors.white,
    fontWeight: "600",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.zinc900,
    marginTop: 12,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
  },
  writeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
  },
  writeButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
});
