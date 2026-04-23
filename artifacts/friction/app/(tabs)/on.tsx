import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import { PageHeader } from "@/components/NavBar/PageHeader";
import ArticleListItem from "@/components/ArticleListItem/ArticleListItem";
import SwipeableRow, { SwipeableRowHandle } from "@/components/SwipeableRow/SwipeableRow";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import { useQueryClient } from "@tanstack/react-query";
import { useListArticles, useCreateArticle, useDeleteArticle } from "@workspace/api-client-react";
import type { Article } from "@workspace/api-client-react";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/contexts/ToastContext";
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
  const queryClient = useQueryClient();
  const { userId } = useUser();
  const { showToast } = useToast();

  const [filter, setFilter] = useState<FilterMode>("all");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [tapArticle, setTapArticle] = useState<Article | null>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const openRowRef = useRef<SwipeableRowHandle | null>(null);
  const rowRefs = useRef<Map<string, SwipeableRowHandle>>(new Map());

  const { data: articles, isLoading, refetch, isRefetching } = useListArticles({
    authorId: userId,
  });

  const createArticle = useCreateArticle();
  const deleteArticle = useDeleteArticle();

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

  const closeOpenRow = useCallback(() => {
    if (openRowRef.current) {
      openRowRef.current.close();
      openRowRef.current = null;
    }
  }, []);

  const enterSelectionMode = useCallback(() => {
    closeOpenRow();
    setSelectedIds(new Set());
    setSelectionMode(true);
  }, [closeOpenRow]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

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

  const handleNewMemo = useCallback(async () => {
    if (createArticle.isPending) return;
    closeOpenRow();
    try {
      const article = await createArticle.mutateAsync({
        data: { authorId: userId, title: "새 메모" },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      router.push({ pathname: "/on-01a", params: { id: article.id } });
    } catch {
      showToast({ message: "메모 생성에 실패했습니다.", type: "error" });
    }
  }, [createArticle, userId, router, queryClient, closeOpenRow, showToast]);

  const handleViewAll = useCallback(() => {
    closeOpenRow();
    router.push("/on-02");
  }, [router, closeOpenRow]);

  const handleArticlePress = useCallback(
    (article: Article) => {
      closeOpenRow();
      setTapArticle(article);
    },
    [closeOpenRow],
  );

  const handleTapModalClose = useCallback(() => {
    setTapArticle(null);
  }, []);

  const handleTapWrite = useCallback(() => {
    if (!tapArticle) return;
    const article = tapArticle;
    setTapArticle(null);
    const screen = getScreenForStatus(article.status as ArticleStatus);
    router.push({ pathname: screen as never, params: { id: article.id } });
  }, [tapArticle, router]);

  const handleTapDelete = useCallback(async () => {
    if (!tapArticle) return;
    const id = tapArticle.id;
    setTapArticle(null);
    try {
      await deleteArticle.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      showToast({ message: "삭제했어요.", type: "success" });
    } catch {
      showToast({ message: "삭제에 실패했습니다.", type: "error" });
    }
  }, [tapArticle, deleteArticle, queryClient, showToast]);

  const handleDeletePress = useCallback((articleId: string) => {
    setDeleteTargetId(articleId);
  }, []);

  const handleDeleteCancel = useCallback(() => {
    setDeleteTargetId(null);
    closeOpenRow();
  }, [closeOpenRow]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTargetId) return;
    const id = deleteTargetId;
    setDeleteTargetId(null);
    closeOpenRow();
    try {
      await deleteArticle.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      showToast({ message: "삭제했어요.", type: "success" });
    } catch {
      showToast({ message: "삭제에 실패했습니다.", type: "error" });
    }
  }, [deleteTargetId, deleteArticle, queryClient, closeOpenRow, showToast]);

  const handleSwipeOpen = useCallback((articleId: string) => {
    const currentOpen = openRowRef.current;
    const newRef = rowRefs.current.get(articleId) ?? null;
    if (currentOpen && currentOpen !== newRef) {
      currentOpen.close();
    }
    openRowRef.current = newRef;
  }, []);

  const handleBulkDeletePress = useCallback(() => {
    if (selectedIds.size === 0) return;
    setShowBulkDeleteConfirm(true);
  }, [selectedIds]);

  const handleBulkDeleteConfirm = useCallback(async () => {
    setShowBulkDeleteConfirm(false);
    setIsBulkDeleting(true);
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
    setIsBulkDeleting(false);
    exitSelectionMode();
    if (failCount === 0) {
      showToast({ message: "삭제했어요.", type: "success" });
    } else if (failCount < ids.length) {
      showToast({ message: `일부 삭제에 실패했습니다. (${failCount}개)`, type: "error" });
    } else {
      showToast({ message: "삭제에 실패했습니다.", type: "error" });
    }
  }, [selectedIds, deleteArticle, queryClient, exitSelectionMode, showToast]);

  const handleBulkDeleteCancel = useCallback(() => {
    setShowBulkDeleteConfirm(false);
  }, []);

  const renderNormalItem = useCallback(
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
          rightMeta={formatRelativeDate(item.updatedAt)}
          onPress={() => handleArticlePress(item)}
        />
      </SwipeableRow>
    ),
    [handleArticlePress, handleDeletePress, handleSwipeOpen],
  );

  const renderSelectionItem = useCallback(
    ({ item }: { item: Article }) => {
      const isSelected = selectedIds.has(item.id);
      return (
        <Pressable
          style={styles.selectionRow}
          onPress={() => toggleSelect(item.id)}
        >
          <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
            {isSelected && <Feather name="check" size={14} color={Colors.white} />}
          </View>
          <View style={styles.selectionItemContent}>
            <ArticleListItem
              title={item.title || "제목 없음"}
              preview={item.content?.substring(0, 60) || ""}
              statusBadge={item.status as ArticleStatus}
              timestamp={new Date(item.updatedAt)}
              rightMeta={formatRelativeDate(item.updatedAt)}
              onPress={() => toggleSelect(item.id)}
            />
          </View>
        </Pressable>
      );
    },
    [selectedIds, toggleSelect],
  );

  const listFooter = useCallback(
    () => <Pressable style={styles.listFooterTouchArea} onPress={closeOpenRow} />,
    [closeOpenRow],
  );

  const selectedCount = selectedIds.size;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {selectionMode ? (
        <PageHeader
          title={selectedCount > 0 ? `${selectedCount}개 선택됨` : ""}
          rightText="취소"
          onRightTextPress={exitSelectionMode}
        />
      ) : (
        <PageHeader
          title="기록함"
          showAdd
          onAddPress={handleNewMemo}
          addDisabled={createArticle.isPending}
          showSearch
          onSearchPress={handleViewAll}
          showKebab
          onKebabPress={enterSelectionMode}
        />
      )}

      {!selectionMode && (
        <View style={styles.filterBar}>
          {FILTER_OPTIONS.map((opt) => (
            <Pressable
              key={opt.key}
              style={[styles.filterChip, filter === opt.key && styles.filterChipActive]}
              onPress={() => {
                closeOpenRow();
                setFilter(opt.key);
              }}
            >
              <Text style={[styles.filterChipText, filter === opt.key && styles.filterChipTextActive]}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

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
          renderItem={selectionMode ? renderSelectionItem : renderNormalItem}
          refreshControl={
            !selectionMode ? (
              <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
            ) : undefined
          }
          contentContainerStyle={[
            styles.listContent,
            selectionMode && { paddingBottom: insets.bottom + Spacing.navBarBottom + Sizing.navBarHeight + 80 },
          ]}
          onScrollBeginDrag={selectionMode ? undefined : closeOpenRow}
          ListFooterComponent={selectionMode ? undefined : listFooter}
        />
      )}

      {selectionMode && (
        <View style={[styles.selectionBar, { paddingBottom: insets.bottom + Spacing.navBarBottom + Sizing.navBarHeight + 12 }]}>
          <Pressable
            style={[styles.bulkDeleteButton, selectedCount === 0 && styles.bulkDeleteButtonDisabled]}
            onPress={handleBulkDeletePress}
            disabled={selectedCount === 0 || isBulkDeleting}
          >
            {isBulkDeleting ? (
              <Text style={styles.bulkDeleteText}>삭제 중...</Text>
            ) : (
              <Text style={styles.bulkDeleteText}>
                {selectedCount > 0 ? `${selectedCount}개 선택 삭제` : "선택 삭제"}
              </Text>
            )}
          </Pressable>
        </View>
      )}

      <ConfirmModal
        visible={tapArticle !== null}
        title={tapArticle?.title || "제목 없음"}
        description={tapArticle?.content?.substring(0, 60) || ""}
        onCancel={handleTapModalClose}
        actionButton={{
          emoji: "✏️",
          label: "쓰기",
          onPress: handleTapWrite,
        }}
        deleteButton={{
          onPress: handleTapDelete,
        }}
      />

      <ConfirmModal
        visible={deleteTargetId !== null}
        title="삭제하시겠습니까?"
        description="이 메모는 영구적으로 삭제됩니다."
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />

      <ConfirmModal
        visible={showBulkDeleteConfirm}
        title={`${selectedCount}개를 삭제할까요?`}
        description="선택한 메모가 영구적으로 삭제됩니다."
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onConfirm={handleBulkDeleteConfirm}
        onCancel={handleBulkDeleteCancel}
      />
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
    paddingBottom: 0,
  },
  listFooterTouchArea: {
    height: 200,
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
  selectionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: Spacing.screenPx,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: Colors.zinc300,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.white,
    marginRight: 12,
    flexShrink: 0,
  },
  checkboxSelected: {
    backgroundColor: Colors.zinc900,
    borderColor: Colors.zinc900,
  },
  selectionItemContent: {
    flex: 1,
  },
  selectionBar: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.zinc100,
    backgroundColor: Colors.white,
  },
  bulkDeleteButton: {
    height: 52,
    backgroundColor: "#DC2626",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  bulkDeleteButtonDisabled: {
    backgroundColor: Colors.zinc200,
  },
  bulkDeleteText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
});
