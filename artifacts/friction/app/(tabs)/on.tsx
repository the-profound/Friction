import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { PageHeader } from "@/components/NavBar/PageHeader";
import ArticleListItem from "@/components/ArticleListItem/ArticleListItem";
import { useListArticles, useCreateArticle } from "@workspace/api-client-react";
import type { Article } from "@workspace/api-client-react";
import { useUser } from "@/contexts/UserContext";
import { getStatusLabel } from "@/lib/articleStatusCycle";
import type { ArticleStatus } from "@/lib/policies";

type FilterMode = "all" | "DRAFT" | "DIVIDING" | "CLOSING";

const FILTER_OPTIONS: { key: FilterMode; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "DRAFT", label: "작성 중" },
  { key: "DIVIDING", label: "분할 중" },
  { key: "CLOSING", label: "마감 중" },
];

function getScreenForStatus(status: ArticleStatus): string {
  switch (status) {
    case "DRAFT":
      return "/on-01a";
    case "DIVIDING":
      return "/on-01b";
    case "CLOSING":
      return "/on-01c";
    default:
      return "/on-01a";
  }
}

function formatRelativeDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}시간 전`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}일 전`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function OnScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useUser();
  const [filter, setFilter] = useState<FilterMode>("all");

  const { data: articles, isLoading, refetch, isRefetching } = useListArticles({
    authorId: userId,
  });

  const createArticle = useCreateArticle();

  const filteredArticles = useMemo(() => {
    if (!articles) return [];
    const list = articles.filter((a) => a.status !== "LETTER");
    if (filter === "all") return list;
    return list.filter((a) => a.status === filter);
  }, [articles, filter]);

  const sortedArticles = useMemo(() => {
    return [...filteredArticles].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [filteredArticles]);

  const handleNewMemo = useCallback(async () => {
    try {
      const article = await createArticle.mutateAsync({
        data: { authorId: userId, title: "새 메모" },
      });
      router.push({ pathname: "/on-01a", params: { id: article.id } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "메모 생성에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [createArticle, userId, router]);

  const handleViewAll = useCallback(() => {
    router.push("/on-02");
  }, [router]);

  const handleArticlePress = useCallback(
    (article: Article) => {
      const screen = getScreenForStatus(article.status as ArticleStatus);
      router.push({ pathname: screen as never, params: { id: article.id } });
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: Article }) => (
      <ArticleListItem
        title={item.title || "제목 없음"}
        preview={item.content?.substring(0, 60) || ""}
        statusBadge={item.status as ArticleStatus}
        timestamp={new Date(item.updatedAt)}
        rightMeta={formatRelativeDate(item.updatedAt)}
        onPress={() => handleArticlePress(item)}
      />
    ),
    [handleArticlePress],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PageHeader
        title="기록함"
        showAdd
        onAddPress={handleNewMemo}
        showSearch
        onSearchPress={handleViewAll}
      />
      <View style={styles.filterBar}>
        {FILTER_OPTIONS.map((opt) => (
          <Pressable
            key={opt.key}
            style={[styles.filterChip, filter === opt.key && styles.filterChipActive]}
            onPress={() => setFilter(opt.key)}
          >
            <Text style={[styles.filterChipText, filter === opt.key && styles.filterChipTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptySubtitle}>불러오는 중...</Text>
        </View>
      ) : sortedArticles.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Feather name="edit-3" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>메모를 작성해보세요</Text>
          <Text style={styles.emptySubtitle}>
            떠오르는 생각을 기록하고{"\n"}편지로 완성할 수 있어요
          </Text>
          <Pressable style={styles.createButton} onPress={handleNewMemo}>
            <Feather name="edit-3" size={16} color={Colors.white} />
            <Text style={styles.createButtonText}>새 메모</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={sortedArticles}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  filterBar: {
    flexDirection: "row",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
    paddingVertical: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
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
  listContent: {
    paddingBottom: 40,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 60,
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
  createButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.zinc900,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  createButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
});
