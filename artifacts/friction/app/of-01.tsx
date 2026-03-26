import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";

type MiniTab = "mine" | "subscribed";

export default function PersonalCollectionListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<MiniTab>("mine");

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <Text style={styles.headerTitle}>개인 모음</Text>
        <Pressable hitSlop={12}>
          <Feather name="plus" size={20} color={Colors.zinc600} />
        </Pressable>
      </View>
      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tab, activeTab === "mine" && styles.tabActive]}
          onPress={() => setActiveTab("mine")}
        >
          <Text style={[styles.tabText, activeTab === "mine" && styles.tabTextActive]}>
            나의 개인 모음
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === "subscribed" && styles.tabActive]}
          onPress={() => setActiveTab("subscribed")}
        >
          <Text style={[styles.tabText, activeTab === "subscribed" && styles.tabTextActive]}>
            구독 중
          </Text>
        </Pressable>
      </View>
      {activeTab === "mine" ? (
        <View style={styles.emptyContainer}>
          <Feather name="folder-plus" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>아직 모음이 없어요</Text>
          <Text style={styles.emptySubtitle}>편지를 모아둘 모음을 만들어보세요</Text>
          <Pressable style={styles.createButton}>
            <Text style={styles.createButtonText}>새 모음 만들기</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.emptyContainer}>
          <Feather name="rss" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>구독 중인 모음이 없어요</Text>
          <Text style={styles.emptySubtitle}>다른 사람의 공개 모음을 구독해보세요</Text>
        </View>
      )}
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
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
    marginBottom: 8,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.zinc50,
  },
  tabActive: {
    backgroundColor: Colors.zinc900,
  },
  tabText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
  },
  tabTextActive: {
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
  createButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
  },
  createButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
});
