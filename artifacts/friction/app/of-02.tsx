import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";

type MiniTab = "mine" | "joined" | "subscribed";

export default function TeamCollectionListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<MiniTab>("mine");

  const tabs: { key: MiniTab; label: string }[] = [
    { key: "mine", label: "나의 단체 모음" },
    { key: "joined", label: "참여 중" },
    { key: "subscribed", label: "구독 중" },
  ];

  const renderEmpty = () => {
    switch (activeTab) {
      case "mine":
        return (
          <View style={styles.emptyContainer}>
            <Feather name="users" size={40} color={Colors.zinc300} />
            <Text style={styles.emptyTitle}>단체 모음이 없어요</Text>
            <Text style={styles.emptySubtitle}>함께 글을 나눌 모임을 만들어보세요</Text>
            <Pressable style={styles.createButton}>
              <Text style={styles.createButtonText}>새 단체 모음 만들기</Text>
            </Pressable>
          </View>
        );
      case "joined":
        return (
          <View style={styles.emptyContainer}>
            <Feather name="user-check" size={40} color={Colors.zinc300} />
            <Text style={styles.emptyTitle}>참여 중인 모음이 없어요</Text>
            <Text style={styles.emptySubtitle}>초대를 받거나 신청해서 참여하세요</Text>
          </View>
        );
      case "subscribed":
        return (
          <View style={styles.emptyContainer}>
            <Feather name="rss" size={40} color={Colors.zinc300} />
            <Text style={styles.emptyTitle}>구독 중인 단체 모음이 없어요</Text>
            <Text style={styles.emptySubtitle}>공개된 단체 모음을 구독해보세요</Text>
          </View>
        );
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <Text style={styles.headerTitle}>단체 모음</Text>
        <Pressable hitSlop={12}>
          <Feather name="plus" size={20} color={Colors.zinc600} />
        </Pressable>
      </View>
      <View style={styles.tabBar}>
        {tabs.map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {renderEmpty()}
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
