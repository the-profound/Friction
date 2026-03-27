import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";

type FilterMode = "all" | "favorites";

export default function SentenceCollectionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [filter, setFilter] = useState<FilterMode>("all");

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <Text style={styles.headerTitle}>문장 모음</Text>
        <View style={{ width: 20 }} />
      </View>
      <View style={styles.filterBar}>
        <Pressable
          style={[styles.filterChip, filter === "all" && styles.filterChipActive]}
          onPress={() => setFilter("all")}
        >
          <Text style={[styles.filterChipText, filter === "all" && styles.filterChipTextActive]}>
            전체
          </Text>
        </Pressable>
        <Pressable
          style={[styles.filterChip, filter === "favorites" && styles.filterChipActive]}
          onPress={() => setFilter("favorites")}
        >
          <Feather
            name="star"
            size={12}
            color={filter === "favorites" ? Colors.white : Colors.zinc500}
          />
          <Text
            style={[styles.filterChipText, filter === "favorites" && styles.filterChipTextActive]}
          >
            즐겨찾기
          </Text>
        </Pressable>
      </View>
      <View style={styles.emptyContainer}>
        <Feather name="bookmark" size={40} color={Colors.zinc300} />
        <Text style={styles.emptyTitle}>수집한 문장이 없어요</Text>
        <Text style={styles.emptySubtitle}>
          읽기 화면에서 마음에 드는 문장을{"\n"}길게 눌러 수집해보세요
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
  filterBar: {
    flexDirection: "row",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
    marginBottom: 8,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.zinc50,
  },
  filterChipActive: {
    backgroundColor: Colors.zinc900,
  },
  filterChipText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
  },
  filterChipTextActive: {
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
    lineHeight: 22,
  },
});
