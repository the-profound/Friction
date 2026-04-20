import React, { useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ArticleListItem from "@/components/ArticleListItem/ArticleListItem";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import { useListArticles, useDeleteArticle, useCreateArticle } from "@workspace/api-client-react";
import type { Article } from "@workspace/api-client-react";
import { useUser } from "@/contexts/UserContext";
import type { ArticleStatus } from "@/lib/policies";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/contexts/ToastContext";

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
  const { showToast } = useToast();
  const [isManageMode, setIsManageMode] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    setShowDeleteConfirm(true);
  }, [selectedIds]);

  const handleDeleteConfirm = useCallback(async () => {
    setShowDeleteConfirm(false);
    const ids = Array.from(selectedIds);
    let failCount = 0;
    for (const id of ids) {
      try {
        await deleteArticle.mutateAsync({ id });
      } catch {
        failCount++;
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
    setSelectedIds(new Set());
    setIsManageMode(false);
    if (failCount === 0) {
      showToast({ message: "삭제했어요.", type: "success" });
    } else {
      showToast({ message: "삭제에 실패했습니다.", type: "error" });
    }
  }, [selectedIds, deleteArticle, queryClient, showToast]);

  const handleDeleteCancel = useCallback(() => {
    setShowDeleteConfirm(false);
  }, []);

  const handleToggleManage = useCallback(() => {
    if (isManageMode) {
      setSelectedIds(new Set());
    }
    setIsManageMode(!isManageMode);
  }, [isManageMode]);

  const handleArticlePress = useCallback(
    (article: Article) => {
      if (isManageMode) {
        toggleSelect(article.id);
        return;
      }
      if (article.status === "LETTER") return;
      const screen = getScreenForStatus(article.status);
      router.push({ pathname: screen as never, params: { id: article.id } });
    },
    [isManageMode, toggleSelect, router],
  );

  const renderItem = useCallback(
    ({ item }: { item: Article }) => (
      <View style={styles.itemRow}>
        {isManageMode && (
          <Pressable
            style={styles.checkbox}
            onPress={() => toggleSelect(item.id)}
          >
            <Feather
              name={selectedIds.has(item.id) ? "check-square" : "square"}
              size={20}
              color={selectedIds.has(item.id) ? Colors.zinc900 : Colors.zinc300}
            />
          </Pressable>
        )}
        <View style={styles.itemContent}>
          <ArticleListItem
            title={item.title || "제목 없음"}
            preview={item.content?.substring(0, 60) || ""}
            statusBadge={item.status as ArticleStatus}
            timestamp={new Date(item.updatedAt)}
            onPress={() => handleArticlePress(item)}
          />
        </View>
      </View>
    ),
    [isManageMode, selectedIds, toggleSelect, handleArticlePress],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <Text style={styles.headerTitle}>메모 모음</Text>
        <Pressable onPress={handleToggleManage} hitSlop={12}>
          <Text style={styles.manageButton}>
            {isManageMode ? "완료" : "관리"}
          </Text>
        </Pressable>
      </View>
      <View style={styles.sortBar}>
        {SORT_OPTIONS.map((opt) => (
          <Pressable
            key={opt.key}
            style={[styles.sortChip, sortMode === opt.key && styles.sortChipActive]}
            onPress={() => setSortMode(opt.key)}
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
          <Pressable
            style={styles.writeButton}
            onPress={async () => {
              try {
                const article = await createArticle.mutateAsync({
                  data: { authorId: userId, title: "새 메모" },
                });
                router.push({ pathname: "/on-01a", params: { id: article.id } });
              } catch {
                showToast({ message: "메모 생성에 실패했습니다.", type: "error" });
              }
            }}
          >
            <Feather name="edit" size={16} color={Colors.white} />
            <Text style={styles.writeButtonText}>새 메모 쓰기</Text>
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

      {isManageMode && selectedIds.size > 0 && (
        <View style={[styles.deleteBar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable style={styles.deleteButton} onPress={handleDeleteSelected}>
            <Feather name="trash-2" size={16} color={Colors.white} />
            <Text style={styles.deleteButtonText}>
              {selectedIds.size}개 삭제
            </Text>
          </Pressable>
        </View>
      )}

      <ConfirmModal
        visible={showDeleteConfirm}
        title={`${selectedIds.size}개를 삭제할까요?`}
        description="선택한 메모가 영구적으로 삭제됩니다."
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
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
  listContent: {
    paddingBottom: 80,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  checkbox: {
    paddingLeft: Spacing.screenPx,
    paddingRight: 4,
  },
  itemContent: {
    flex: 1,
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
  deleteBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    backgroundColor: Colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc200,
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#DC2626",
    paddingVertical: 14,
    borderRadius: 12,
  },
  deleteButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
});
