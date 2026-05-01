import React, { useState, useCallback, useMemo, useRef } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ArticleListItem from "@/components/ArticleListItem/ArticleListItem";
import SubmitButton from "@/components/SubmitButton/SubmitButton";
import SwipeableRow, { SwipeableRowHandle } from "@/components/SwipeableRow/SwipeableRow";
import { useListArticles, useDeleteArticle, useCreateArticle } from "@workspace/api-client-react";
import type { Article, ArticleCover } from "@workspace/api-client-react";
import { useUser } from "@/contexts/UserContext";
import type { ArticleStatus } from "@/lib/policies";
import { useQueryClient } from "@tanstack/react-query";

type SortMode = "latest" | "oldest" | "status";

const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: "latest", label: "최신순" },
  { key: "oldest", label: "오래된순" },
  { key: "status", label: "상태별" },
];

const STATUS_SORT_ORDER: Record<string, number> = {
  DRAFT: 0,
  DIVIDING: 1,
  CLOSING: 2,
};

function getScreenForStatus(status: string): string {
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

export default function MemoCollectionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId } = useUser();
  const [sortMode, setSortMode] = useState<SortMode>("latest");

  const openRowRef = useRef<SwipeableRowHandle | null>(null);
  const rowRefs = useRef<Map<string, SwipeableRowHandle>>(new Map());

  const { data: articles, isLoading, refetch, isRefetching } = useListArticles({
    authorId: userId,
  });

  const deleteArticle = useDeleteArticle();
  const createArticle = useCreateArticle();

  const sortedArticles = useMemo(() => {
    if (!articles) return [];
    const list = articles.filter((a) => a.status !== "LETTER");
    switch (sortMode) {
      case "latest":
        return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      case "oldest":
        return list.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
      case "status":
        return list.sort((a, b) => (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99));
      default:
        return list;
    }
  }, [articles, sortMode]);

  const closeOpenRow = useCallback(() => {
    if (openRowRef.current) {
      openRowRef.current.close();
      openRowRef.current = null;
    }
  }, []);

  const handleSwipeOpen = useCallback((articleId: string) => {
    const currentOpen = openRowRef.current;
    const newRef = rowRefs.current.get(articleId) ?? null;
    if (currentOpen && currentOpen !== newRef) {
      currentOpen.close();
    }
    openRowRef.current = newRef;
  }, []);

  const handleDeletePress = useCallback(async (articleId: string) => {
    if (deleteArticle.isPending) return;
    closeOpenRow();
    try {
      await deleteArticle.mutateAsync({ id: articleId });
      await queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      Alert.alert("완료", "삭제했어요.");
    } catch {
      Alert.alert("오류", "삭제에 실패했습니다.");
    }
  }, [deleteArticle, queryClient, closeOpenRow]);

  const handleArticlePress = useCallback(
    (article: Article) => {
      closeOpenRow();
      if (article.status === "LETTER") return;
      const screen = getScreenForStatus(article.status);
      router.push({ pathname: screen as never, params: { id: article.id } });
    },
    [router, closeOpenRow],
  );

  const getCoverImageUrl = useCallback((article: Article): string | undefined => {
    const cover = article.cover as ArticleCover | null | undefined;
    if (cover?.type === "image" && cover.imageUrl) return cover.imageUrl;
    return undefined;
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Article }) => (
      <SwipeableRow
        ref={(r) => {
          if (r) {
            rowRefs.current.set(item.id, r);
          } else {
            rowRefs.current.delete(item.id);
          }
        }}
        onDeletePress={() => handleDeletePress(item.id)}
        onSwipeOpen={() => handleSwipeOpen(item.id)}
      >
        <ArticleListItem
          title={item.title || "제목 없음"}
          preview={item.content?.substring(0, 60) || ""}
          statusBadge={item.status as ArticleStatus}
          timestamp={new Date(item.updatedAt)}
          onPress={() => handleArticlePress(item)}
          coverImageUrl={getCoverImageUrl(item)}
        />
      </SwipeableRow>
    ),
    [handleArticlePress, handleDeletePress, handleSwipeOpen, getCoverImageUrl],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <Text style={styles.headerTitle}>메모 모음</Text>
        <View style={{ width: 20 }} />
      </View>
      <View style={styles.sortBar}>
        {SORT_OPTIONS.map((opt) => (
          <Pressable
            key={opt.key}
            style={[styles.sortChip, sortMode === opt.key && styles.sortChipActive]}
            onPress={() => {
              closeOpenRow();
              setSortMode(opt.key);
            }}
          >
            <Text
              style={[styles.sortChipText, sortMode === opt.key && styles.sortChipTextActive]}
            >
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
          <Text style={styles.emptyTitle}>아직 메모가 없어요</Text>
          <Text style={styles.emptySubtitle}>기록함에서 새 메모를 작성해보세요</Text>
          <SubmitButton
            style={styles.writeButton}
            textStyle={styles.writeButtonText}
            onPress={async () => {
              try {
                const article = await createArticle.mutateAsync({
                  data: { authorId: userId, title: "" },
                });
                router.push({ pathname: "/on-01a", params: { id: article.id } });
              } catch {
                Alert.alert("오류", "메모 생성에 실패했습니다.");
              }
            }}
            pending={createArticle.isPending}
            label="새 메모 쓰기"
            pendingLabel="만드는 중..."
            renderIcon={({ disabled }) => (
              <Feather name="edit" size={16} color={disabled ? Colors.zinc300 : Colors.white} />
            )}
          />
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
          onScrollBeginDrag={closeOpenRow}
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
  listContent: {
    paddingBottom: 80,
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
