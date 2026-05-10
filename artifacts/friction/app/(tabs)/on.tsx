import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  TextInput,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { PageHeader } from "@/components/NavBar/PageHeader";
import ArticleListItem from "@/components/ArticleListItem/ArticleListItem";
import SwipeableRow, { SwipeableRowHandle } from "@/components/SwipeableRow/SwipeableRow";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import RefreshableEmpty from "@/components/RefreshableEmpty";
import { useQueryClient } from "@tanstack/react-query";
import { useListArticles, useCreateArticle, useDeleteArticle, getGetArticleQueryKey } from "@workspace/api-client-react";
import type { Article } from "@workspace/api-client-react";
import { useUser } from "@/contexts/UserContext";
import type { ArticleStatus } from "@/lib/policies";

type TopTab = "memo" | "my_article";
type FilterMode = "all" | "DRAFT" | "DIVIDING" | "CLOSING";

const FILTER_OPTIONS: { key: FilterMode; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "DRAFT", label: "작성 중" },
  { key: "DIVIDING", label: "분할 중" },
  { key: "CLOSING", label: "마감 중" },
];

type ListItem =
  | { type: "memo"; article: Article }
  | { type: "my_article"; article: Article };

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
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId } = useUser();

  const [topTab, setTopTab] = useState<TopTab>("memo");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [scrollEnabled, setScrollEnabled] = useState(true);
  const openRowRef = useRef<SwipeableRowHandle | null>(null);
  const rowRefs = useRef<Map<string, SwipeableRowHandle>>(new Map());

  const { data: articles, isLoading, refetch, isRefetching } = useListArticles({
    authorId: userId,
  });

  const createArticle = useCreateArticle();
  const deleteArticle = useDeleteArticle();

  useEffect(() => {
    if (!articles) return;
    for (const article of articles) {
      queryClient.setQueryData(getGetArticleQueryKey(article.id), article);
    }
  }, [articles, queryClient]);

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

  const displayedArticles = useMemo(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return sortedArticles;
    const q = trimmed.toLowerCase();
    return sortedArticles.filter((a) => (a.title ?? "").toLowerCase().includes(q));
  }, [sortedArticles, searchQuery]);

  const myLetterArticles = useMemo(() => {
    if (!articles) return [];
    return [...articles.filter((a) => a.status === "LETTER")].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [articles]);

  const displayedMyArticles = useMemo(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return myLetterArticles;
    const q = trimmed.toLowerCase();
    return myLetterArticles.filter((a) => (a.title ?? "").toLowerCase().includes(q));
  }, [myLetterArticles, searchQuery]);

  const listData = useMemo((): ListItem[] => {
    if (topTab === "my_article") {
      return displayedMyArticles.map((a) => ({ type: "my_article", article: a }));
    }
    return displayedArticles.map((a) => ({ type: "memo", article: a }));
  }, [topTab, displayedArticles, displayedMyArticles]);

  const closeOpenRow = useCallback(() => {
    if (openRowRef.current) {
      openRowRef.current.close();
      openRowRef.current = null;
    }
  }, []);

  const switchTopTab = useCallback((tab: TopTab) => {
    closeOpenRow();
    setTopTab(tab);
    setFilter("all");
    setSearchActive(false);
    setSearchQuery("");
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, [closeOpenRow]);

  const enterSelectionMode = useCallback(() => {
    closeOpenRow();
    setSelectedIds(new Set());
    setSelectionMode(true);
    setSearchActive(false);
    setSearchQuery("");
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
        data: { authorId: userId, title: "" },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      router.push({ pathname: "/on-01a", params: { id: article.id } });
    } catch {
      Alert.alert("오류", "메모 생성에 실패했습니다.");
    }
  }, [createArticle, userId, router, queryClient, closeOpenRow]);

  const handleSearchPress = useCallback(() => {
    closeOpenRow();
    setSearchActive((prev) => {
      if (prev) setSearchQuery("");
      return !prev;
    });
  }, [closeOpenRow]);

  const handleMemoPress = useCallback(
    (article: Article) => {
      closeOpenRow();
      if (article.status === "LETTER") return;
      const screen = getScreenForStatus(article.status as ArticleStatus);
      router.push({ pathname: screen as never, params: { id: article.id } });
    },
    [closeOpenRow, router],
  );

  const handleMyArticlePress = useCallback(
    (article: Article) => {
      closeOpenRow();
      router.push({ pathname: "/read" as never, params: { articleId: article.id, mode: "re_read" } });
    },
    [closeOpenRow, router],
  );

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
      Alert.alert("완료", "삭제했어요.");
    } catch {
      Alert.alert("오류", "삭제에 실패했습니다.");
    }
  }, [deleteTargetId, deleteArticle, queryClient, closeOpenRow]);

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
      Alert.alert("완료", "삭제했어요.");
    } else if (failCount < ids.length) {
      Alert.alert("오류", `일부 삭제에 실패했습니다. (${failCount}개)`);
    } else {
      Alert.alert("오류", "삭제에 실패했습니다.");
    }
  }, [selectedIds, deleteArticle, queryClient, exitSelectionMode]);

  const handleBulkDeleteCancel = useCallback(() => {
    setShowBulkDeleteConfirm(false);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === "my_article") {
        if (selectionMode) {
          const isSelected = selectedIds.has(item.article.id);
          return (
            <Pressable
              style={styles.selectionRow}
              onPress={() => toggleSelect(item.article.id)}
            >
              <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                {isSelected && <Feather name="check" size={14} color={Colors.white} />}
              </View>
              <View style={styles.selectionItemContent}>
                <ArticleListItem
                  title={item.article.title || "제목 없음"}
                  preview={item.article.content?.substring(0, 60) || ""}
                  rightMeta={formatRelativeDate(item.article.updatedAt)}
                  timestamp={new Date(item.article.updatedAt)}
                  onPress={() => toggleSelect(item.article.id)}
                />
              </View>
            </Pressable>
          );
        }

        return (
          <ArticleListItem
            title={item.article.title || "제목 없음"}
            preview={item.article.content?.substring(0, 60) || ""}
            rightMeta={formatRelativeDate(item.article.updatedAt)}
            timestamp={new Date(item.article.updatedAt)}
            onPress={() => handleMyArticlePress(item.article)}
          />
        );
      }

      if (item.type === "memo") {
        if (selectionMode) {
          const isSelected = selectedIds.has(item.article.id);
          return (
            <Pressable
              style={styles.selectionRow}
              onPress={() => toggleSelect(item.article.id)}
            >
              <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                {isSelected && <Feather name="check" size={14} color={Colors.white} />}
              </View>
              <View style={styles.selectionItemContent}>
                <ArticleListItem
                  title={item.article.title || "제목 없음"}
                  preview={item.article.content?.substring(0, 60) || ""}
                  author={
                    item.article.authorId !== userId && item.article.authorNickname
                      ? { name: item.article.authorNickname }
                      : undefined
                  }
                  statusBadge={item.article.status as ArticleStatus}
                  timestamp={new Date(item.article.updatedAt)}
                  rightMeta={formatRelativeDate(item.article.updatedAt)}
                  onPress={() => toggleSelect(item.article.id)}
                />
              </View>
            </Pressable>
          );
        }

        return (
          <SwipeableRow
            ref={(r) => {
              if (r) {
                rowRefs.current.set(item.article.id, r);
              } else {
                rowRefs.current.delete(item.article.id);
              }
            }}
            onDeletePress={() => handleDeletePress(item.article.id)}
            onSwipeOpen={() => handleSwipeOpen(item.article.id)}
            onScrollLock={(locked) => setScrollEnabled(!locked)}
          >
            <ArticleListItem
              title={item.article.title || "제목 없음"}
              preview={item.article.content?.substring(0, 60) || ""}
              author={
                item.article.authorId !== userId && item.article.authorNickname
                  ? { name: item.article.authorNickname }
                  : undefined
              }
              statusBadge={item.article.status as ArticleStatus}
              timestamp={new Date(item.article.updatedAt)}
              rightMeta={formatRelativeDate(item.article.updatedAt)}
              onPress={() => handleMemoPress(item.article)}
            />
          </SwipeableRow>
        );
      }

      return null;
    },
    [
      selectionMode,
      selectedIds,
      toggleSelect,
      handleMemoPress,
      handleMyArticlePress,
      handleDeletePress,
      handleSwipeOpen,
      userId,
    ],
  );

  const keyExtractor = useCallback((item: ListItem) => {
    return `${item.type}-${item.article.id}`;
  }, []);

  const listFooter = useCallback(
    () => <Pressable style={styles.listFooterTouchArea} onPress={closeOpenRow} />,
    [closeOpenRow],
  );

  const selectedCount = selectedIds.size;
  const hasMemos = sortedArticles.length > 0;

  const showMemoEmpty =
    topTab === "memo" &&
    !isLoading &&
    searchQuery.trim().length === 0 &&
    !hasMemos;

  const showSearchEmpty =
    !isLoading &&
    searchQuery.trim().length > 0 &&
    ((topTab === "memo" && displayedArticles.length === 0) ||
      (topTab === "my_article" && displayedMyArticles.length === 0));

  const showMyArticleEmpty =
    topTab === "my_article" &&
    !isLoading &&
    searchQuery.trim().length === 0 &&
    myLetterArticles.length === 0;

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
          showSearch
          onSearchPress={handleSearchPress}
          searchActive={searchActive}
          showKebab
          onKebabPress={enterSelectionMode}
          showProfile
          onProfilePress={() => router.push("/mypage" as never)}
        />
      )}

      {!selectionMode && (
        <View style={styles.topTabBar}>
          <Pressable
            style={styles.topTabItem}
            onPress={() => switchTopTab("memo")}
          >
            <Text style={[styles.topTabText, topTab === "memo" && styles.topTabTextActive]}>
              메모
            </Text>
            {topTab === "memo" && <View style={styles.topTabUnderline} />}
          </Pressable>
          <Pressable
            style={styles.topTabItem}
            onPress={() => switchTopTab("my_article")}
          >
            <Text style={[styles.topTabText, topTab === "my_article" && styles.topTabTextActive]}>
              내 글
            </Text>
            {topTab === "my_article" && <View style={styles.topTabUnderline} />}
          </Pressable>
        </View>
      )}

      {!selectionMode && searchActive && (
        <View style={styles.searchBar}>
          <Feather name="search" size={Sizing.searchBarIconSize} color={Colors.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="제목으로 검색"
            placeholderTextColor={Colors.searchPlaceholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
              <Feather name="x" size={16} color={Colors.zinc400} />
            </Pressable>
          )}
        </View>
      )}

      {!selectionMode && topTab === "memo" && (
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
        <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
          <Text style={styles.emptySubtitle}>불러오는 중...</Text>
        </View>
      ) : showSearchEmpty ? (
        <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
          <Feather name="search" size={40} color={Colors.zinc300} />
          <Text style={styles.emptySubtitle}>검색 결과가 없습니다</Text>
        </View>
      ) : showMemoEmpty ? (
        <RefreshableEmpty
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
        >
          <Feather name="edit-3" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>메모를 작성해보세요</Text>
          <Text style={styles.emptySubtitle}>
            떠오르는 생각을 기록하고{"\n"}편지로 완성할 수 있어요
          </Text>
          <Pressable style={styles.createButton} onPress={handleNewMemo}>
            <Feather name="edit-3" size={16} color={Colors.white} />
            <Text style={styles.createButtonText}>새 메모</Text>
          </Pressable>
        </RefreshableEmpty>
      ) : showMyArticleEmpty ? (
        <RefreshableEmpty
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
        >
          <Feather name="book-open" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>아직 내보낸 글이 없어요</Text>
          <Text style={styles.emptySubtitle}>
            메모를 완성해 편지로 내보내면{"\n"}여기에 모아볼 수 있어요
          </Text>
        </RefreshableEmpty>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          refreshControl={
            !selectionMode ? (
              <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
            ) : undefined
          }
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: selectionMode ? insets.bottom + Spacing.navBarBottom + Sizing.navBarHeight + 80 : navBottom + 64 },
          ]}
          onScrollBeginDrag={selectionMode ? undefined : closeOpenRow}
          ListFooterComponent={selectionMode ? undefined : listFooter}
          scrollEnabled={scrollEnabled}
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

      {!selectionMode && topTab === "memo" && (
        <Pressable
          style={[styles.fab, { bottom: insets.bottom + Spacing.navBarBottom + Sizing.navBarHeight + Spacing.xl }]}
          onPress={handleNewMemo}
          accessibilityRole="button"
          accessibilityLabel="메모 추가"
        >
          <Feather name="edit-3" size={20} color={Colors.white} />
        </Pressable>
      )}

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
        description={topTab === "my_article" ? "선택한 글이 영구적으로 삭제됩니다." : "선택한 메모가 영구적으로 삭제됩니다."}
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
  topTabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
  },
  topTabItem: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 10,
    paddingBottom: 0,
    alignItems: "center",
  },
  topTabText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc400,
    paddingBottom: 10,
  },
  topTabTextActive: {
    ...Typography.bodySemiBold,
    color: Colors.zinc900,
  },
  topTabUnderline: {
    height: 2,
    width: "100%",
    backgroundColor: Colors.zinc900,
    borderRadius: 1,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: Spacing.screenPx,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.zinc100,
    borderRadius: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc900,
    padding: 0,
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
  fab: {
    position: "absolute",
    right: Spacing.screenPx,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.zinc900,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
});
