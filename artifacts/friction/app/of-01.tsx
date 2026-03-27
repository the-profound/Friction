import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Alert, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";

type MiniTab = "mine" | "subscribed";

const DEMO_ARTICLES = [
  { id: "a1", title: "봄의 시작", preview: "따뜻한 바람이 불어오는 날...", author: { name: "나" }, timestamp: new Date(2026, 2, 26, 10, 0) },
  { id: "a2", title: "겨울의 끝", preview: "마지막 눈이 녹아가고 있었다", author: { name: "나" }, timestamp: new Date(2026, 2, 20, 15, 30), isRead: true },
];

export default function PersonalCollectionListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<MiniTab>("mine");

  const handleArticlePress = useCallback((articleId: string) => {
    router.push({ pathname: "/read", params: { id: articleId } });
  }, [router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <Text style={styles.headerTitle}>개인 모음</Text>
        <Pressable hitSlop={12} onPress={() => Alert.alert("새 모음", "새 개인 모음 만들기 기능은 준비 중입니다.")}>
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
        <ScrollView contentContainerStyle={styles.cardGrid}>
          {DEMO_ARTICLES.map((item) => (
            <ArticleCardItem
              key={item.id}
              title={item.title}
              preview={item.preview}
              author={item.author}
              timestamp={item.timestamp}
              isRead={item.isRead}
              onPress={() => handleArticlePress(item.id)}
            />
          ))}
          <Pressable style={styles.createCard} onPress={() => Alert.alert("새 모음", "새 개인 모음 만들기 기능은 준비 중입니다.")}>
            <Feather name="plus" size={24} color={Colors.zinc400} />
            <Text style={styles.createCardText}>새 모음 만들기</Text>
          </Pressable>
        </ScrollView>
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
  cardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 8,
    gap: 12,
  },
  createCard: {
    width: 140,
    height: 180,
    borderRadius: 16,
    backgroundColor: Colors.zinc50,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  createCardText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
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
});
