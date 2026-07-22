import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import AnimatedSearchBar from "@/components/AnimatedSearchBar/AnimatedSearchBar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { PageHeader } from "@/components/NavBar/PageHeader";
import ArticleListItem from "@/components/ArticleListItem/ArticleListItem";
import ThoughtListItem from "@/components/ThoughtListItem/ThoughtListItem";
import ThoughtDetailModal from "@/components/ThoughtDetailModal/ThoughtDetailModal";
import SwipeableRow, { SwipeableRowHandle } from "@/components/SwipeableRow/SwipeableRow";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import RefreshableEmpty from "@/components/RefreshableEmpty";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListArticles,
  useCreateArticle,
  useDeleteArticle,
  getGetArticleQueryKey,
  useListSendRecords,
  useListMyCollections,
  useAddArticleToMyCollection,
  useListThoughts,
} from "@workspace/api-client-react";
import { invalidateArticleLists } from "@/lib/queryInvalidation";
import type { Article, MyCollection, Thought } from "@workspace/api-client-react";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/contexts/ToastContext";
import { useNavigation } from "@/contexts/NavigationContext";
import type { ArticleStatus } from "@/lib/policies";
import { LIST_PERF_PRESET } from "@/lib/listPerf";

type TopTab = "memo" | "my_article" | "thought";
type FilterMode = "all" | "DRAFT" | "DIVIDING" | "CLOSING";

const FILTER_OPTIONS: { key: FilterMode; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "DRAFT", label: "작성 중" },
  { key: "DIVIDING", label: "검토 중" },
  { key: "CLOSING", label: "마감 중" },
];

type ListItem =
  | { type: "memo"; article: Article }
  | { type: "my_article"; article: Article }
  | { type: "thought"; thought: Thought };

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
  const { showToast } = useToast();
  const { setShowRecordFab } = useNavigation();

  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();

  const [topTab, setTopTab] = useState<TopTab>("memo");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteTargetType, setDeleteTargetType] = useState<"memo" | "my_article">("memo");

  const [archiveSheetVisible, setArchiveSheetVisible] = useState(false);
  const [archiveArticleId, setArchiveArticleId] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [scrollEnabled, setScrollEnabled] = useState(true);
  const openRowRef = useRef<SwipeableRowHandle | null>(null);
  const rowRefs = useRef<Map<string, SwipeableRowHandle>>(new Map());

  const [selectedThought, setSelectedThought] = useState<Thought | null>(null);

  const { data: articles, isLoading, refetch, isRefetching } = useListArticles({
    authorId: userId,
  });

  const { data: thoughts, isLoading: isThoughtsLoading, refetch: refetchThoughts, isRefetching: isThoughtsRefetching } = useListThoughts();

  const { data: sendRecords } = useListSendRecords({ senderId: userId });

  const deliveryStatusMap = useMemo((): Map<string, "sent" | "scheduled"> => {
    const map = new Map<string, "sent" | "scheduled">();
    if (!sendRecords) return map;
    for (const record of sendRecords) {
      const existing = map.get(record.articleId);
      if (record.isDelivered) {
        map.set(record.articleId, "sent");
      } else if (existing !== "sent") {
        map.set(record.articleId, "scheduled");
      }
    }
    return map;
  }, [sendRecords]);

  const createArticle = useCreateArticle();
  const deleteArticle = useDeleteArticle();
  const collectionsQuery = useListMyCollections({ ownerId: userId });
  const addToCollection = useAddArticleToMyCollection();

  useEffect(() => {
    if (!articles) return;
    for (const article of articles) {
      queryClient.setQueryData(getGetArticleQueryKey(article.id), article);
    }
  }, [articles, queryClient]);

  useEffect(() => {
    if (tabParam === "my_article") {
      setTopTab("my_article");
    }
  }, [tabParam]);

  useFocusEffect(
    useCallback(() => {
      setShowRecordFab(topTab === "memo" && !selectionMode);
      return () => {
        setShowRecordFab(false);
      };
    }, [topTab, selectionMode, setShowRecordFab]),
  );

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

  const sortedCollections = useMemo(() => {
    const list = (collectionsQuery.data ?? []) as MyCollection[];
    return [...list]
      .filter((c) => !c.isArchive)
      .sort((a, b) => {
        if (a.isImpression && !b.isImpression) return -1;
        if (!a.isImpression && b.isImpression) return 1;
        return (b.articleCount ?? 0) - (a.articleCount ?? 0);
      });
  }, [collectionsQuery.data]);

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
    if (topTab === "thought") {
      return (thoughts ?? []).map((t: Thought) => ({ type: "thought" as const, thought: t }));
    }
    return displayedArticles.map((a) => ({ type: "memo", article: a }));
  }, [topTab, displayedArticles, displayedMyArticles, thoughts]);

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
      invalidateArticleLists(queryClient);
      router.push({ pathname: "/on-01a", params: { id: article.id } });
    } catch {
      showToast({ message: "메모 생성에 실패했습니다.", type: "error" });
    }
  }, [createArticle, userId, router, queryClient, closeOpenRow, showToast]);

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

  const handleSendAction = useCallback(
    (articleId: string) => {
      closeOpenRow();
      router.push({ pathname: "/to-send", params: { prefillArticleId: articleId } });
    },
    [closeOpenRow, router],
  );

  const handleArchiveAction = useCallback(
    (articleId: string) => {
      closeOpenRow();
      setArchiveArticleId(articleId);
      setSelectedCollectionId(null);
      setArchiveSheetVisible(true);
    },
    [closeOpenRow],
  );

  const handleArchiveConfirm = useCallback(async () => {
    if (!archiveArticleId || !selectedCollectionId || isArchiving) return;
    setIsArchiving(true);
    const collectionId = selectedCollectionId;
    const collectionName =
      sortedCollections.find((c) => c.id === collectionId)?.name ?? "폴더";
    try {
      await addToCollection.mutateAsync({
        id: collectionId,
        data: { articleId: archiveArticleId },
      });
      await collectionsQuery.refetch();
      setArchiveSheetVisible(false);
      setArchiveArticleId(null);
      setSelectedCollectionId(null);
      showToast({
        message: "보관했어요",
        type: "success",
        duration: 4000,
        action: {
          label: "폴더 보기",
          onPress: () =>
            router.push({
              pathname: "/of-01-detail",
              params: { id: collectionId, name: collectionName },
            }),
        },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "보관에 실패했습니다.";
      showToast({ message: msg, type: "error" });
    } finally {
      setIsArchiving(false);
    }
  }, [archiveArticleId, selectedCollectionId, isArchiving, addToCollection, sortedCollections, collectionsQuery, showToast, router]);

  const handleDeletePress = useCallback((articleId: string, type: "memo" | "my_article" = "memo") => {
    setDeleteTargetType(type);
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
      invalidateArticleLists(queryClient);
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
    await invalidateArticleLists(queryClient);
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

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === "my_article") {
        if (selectionMode) {
          const isSelected = selectedIds.has(item.article.id);
          return (
            <ScalePressable
              style={styles.selectionRow}
              onPress={() => toggleSelect(item.article.id)}
            contentStyle={styles.selectionRowContent}
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
            </ScalePressable>
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
            actions={[
              {
                label: "보내기",
                color: Colors.zinc900,
                onPress: () => handleSendAction(item.article.id),
              },
              {
                label: "보관",
                color: "#10B981",
                onPress: () => handleArchiveAction(item.article.id),
              },
              {
                label: "삭제",
                color: "#EF4444",
                onPress: () => handleDeletePress(item.article.id, "my_article"),
              },
            ]}
            onSwipeOpen={() => handleSwipeOpen(item.article.id)}
            onScrollLock={(locked) => setScrollEnabled(!locked)}
          >
            <ArticleListItem
              title={item.article.title || "제목 없음"}
              preview={item.article.content?.substring(0, 60) || ""}
              rightMeta={formatRelativeDate(item.article.updatedAt)}
              timestamp={new Date(item.article.updatedAt)}
              deliveryBadge={deliveryStatusMap.get(item.article.id)}
              onPress={() => handleMyArticlePress(item.article)}
            />
          </SwipeableRow>
        );
      }

      if (item.type === "memo") {
        if (selectionMode) {
          const isSelected = selectedIds.has(item.article.id);
          return (
            <ScalePressable
              style={styles.selectionRow}
              onPress={() => toggleSelect(item.article.id)}
            contentStyle={styles.selectionRowContent}
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
            </ScalePressable>
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

      if (item.type === "thought") {
        return (
          <ThoughtListItem
            content={item.thought.content}
            createdFrom={item.thought.createdFrom}
            rightMeta={formatRelativeDate(item.thought.createdAt)}
            onPress={() => setSelectedThought(item.thought)}
          />
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
      handleSendAction,
      handleArchiveAction,
      handleSwipeOpen,
      userId,
      deliveryStatusMap,
    ],
  );

  const keyExtractor = useCallback((item: ListItem) => {
    if (item.type === "thought") return `thought-${item.thought.id}`;
    return `${item.type}-${item.article.id}`;
  }, []);

  const listFooter = useCallback(
    () => <ScalePressable style={styles.listFooterTouchArea} onPress={closeOpenRow} />,
    [closeOpenRow],
  );

  const selectedCount = selectedIds.size;
  const hasMemos = sortedArticles.length > 0;

  const showMemoEmpty =
    topTab === "memo" &&
    !isLoading &&
    searchQuery.trim().length === 0 &&
    !hasMemos;

  const showFilterEmpty =
    topTab === "memo" &&
    !isLoading &&
    searchQuery.trim().length === 0 &&
    filter !== "all" &&
    displayedArticles.length === 0 &&
    hasMemos;

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

  const showThoughtEmpty =
    topTab === "thought" &&
    !isThoughtsLoading &&
    (thoughts ?? []).length === 0;

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
          title="기록"
          titleImage={require("@/assets/images/wordmark_maroon.png")}
          showSearch
          onSearchPress={handleSearchPress}
          searchActive={searchActive}
          searchLast
          showKebab
          onKebabPress={enterSelectionMode}
        />
      )}

      {!selectionMode && (
        <View style={styles.topTabBar}>
          <View style={{ flex: 1 }}>
            <ScalePressable
              style={[styles.topTabItem, { paddingLeft: 16, paddingRight: 8 }]}
              onPress={() => switchTopTab("memo")}
              contentStyle={styles.topTabItemContent}
            >
              <Text
                style={[styles.topTabText, topTab === "memo" && styles.topTabTextActive]}
                allowFontScaling={false}
                numberOfLines={1}
              >
                메모
              </Text>
              {topTab === "memo" && <View style={styles.topTabUnderline} />}
            </ScalePressable>
          </View>
          <View style={{ flex: 1 }}>
            <ScalePressable
              style={[styles.topTabItem, { paddingHorizontal: 8 }]}
              onPress={() => switchTopTab("my_article")}
              contentStyle={styles.topTabItemContent}
            >
              <Text
                style={[styles.topTabText, topTab === "my_article" && styles.topTabTextActive]}
                allowFontScaling={false}
                numberOfLines={1}
              >
                편지
              </Text>
              {topTab === "my_article" && <View style={styles.topTabUnderline} />}
            </ScalePressable>
          </View>
          <View style={{ flex: 1 }}>
            <ScalePressable
              style={[styles.topTabItem, { paddingLeft: 8, paddingRight: 16 }]}
              onPress={() => switchTopTab("thought")}
              contentStyle={styles.topTabItemContent}
            >
              <Text
                style={[styles.topTabText, topTab === "thought" && styles.topTabTextActive]}
                allowFontScaling={false}
                numberOfLines={1}
              >
                단상
              </Text>
              {topTab === "thought" && <View style={styles.topTabUnderline} />}
            </ScalePressable>
          </View>
        </View>
      )}

      {!selectionMode && (
        <AnimatedSearchBar
          active={searchActive}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="제목으로 검색"
        />
      )}

      {!selectionMode && topTab === "memo" && (
        <View style={styles.filterBar}>
          {FILTER_OPTIONS.map((opt) => (
            <ScalePressable
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
            </ScalePressable>
          ))}
        </View>
      )}

      {(isLoading && topTab !== "thought") || (isThoughtsLoading && topTab === "thought") ? (
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
          <ScalePressable style={styles.createButton} onPress={handleNewMemo}
          contentStyle={styles.createButtonContent}
          >
            <Feather name="edit-3" size={16} color={Colors.white} />
            <Text style={styles.createButtonText}>새 메모</Text>
          </ScalePressable>
        </RefreshableEmpty>
      ) : showFilterEmpty ? (
        <RefreshableEmpty
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
        >
          <Feather name="edit-3" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>
            {filter === "DRAFT"
              ? "작성 중인 메모가 없어요"
              : filter === "DIVIDING"
                ? "검토 중인 메모가 없어요"
                : "마감 중인 메모가 없어요"}
          </Text>
          <ScalePressable
            style={styles.createButton}
            onPress={handleNewMemo}
            contentStyle={styles.createButtonContent}
          >
            <Feather name="edit-3" size={16} color={Colors.white} />
            <Text style={styles.createButtonText}>새 메모</Text>
          </ScalePressable>
        </RefreshableEmpty>
      ) : showMyArticleEmpty ? (
        <RefreshableEmpty
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
        >
          <Feather name="book-open" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>아직 내보낸 편지가 없어요</Text>
          <Text style={styles.emptySubtitle}>
            메모를 완성해 편지로 내보내면{"\n"}여기에 모아볼 수 있어요
          </Text>
        </RefreshableEmpty>
      ) : showThoughtEmpty ? (
        <RefreshableEmpty
          refreshing={isThoughtsRefetching}
          onRefresh={refetchThoughts}
          contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
        >
          <Feather name="feather" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>단상이 없어요</Text>
          <Text style={styles.emptySubtitle}>
            독서 중 떠오른 생각들이{"\n"}여기에 모아집니다
          </Text>
        </RefreshableEmpty>
      ) : (
        <FlatList
          {...LIST_PERF_PRESET}
          data={listData}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          refreshControl={
            !selectionMode ? (
              <RefreshControl
                refreshing={topTab === "thought" ? isThoughtsRefetching : isRefetching}
                onRefresh={topTab === "thought" ? refetchThoughts : refetch}
              />
            ) : undefined
          }
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: selectionMode ? insets.bottom + Spacing.navBarBottom + Sizing.navBarHeight + 80 : navBottom + 52 },
          ]}
          onScrollBeginDrag={selectionMode ? undefined : closeOpenRow}
          ListFooterComponent={selectionMode ? undefined : listFooter}
          scrollEnabled={scrollEnabled}
        />
      )}

      {selectionMode && (
        <View style={[styles.selectionBar, { paddingBottom: insets.bottom + Spacing.navBarBottom + Sizing.navBarHeight + 12 }]}>
          <ScalePressable
            style={[styles.bulkDeleteButton, selectedCount === 0 && styles.bulkDeleteButtonDisabled]}
            onPress={handleBulkDeletePress}
            disabled={selectedCount === 0 || isBulkDeleting}
          contentStyle={styles.bulkDeleteButtonContent}
          >
            {isBulkDeleting ? (
              <Text style={styles.bulkDeleteText}>삭제 중...</Text>
            ) : (
              <Text style={styles.bulkDeleteText}>
                {selectedCount > 0 ? `${selectedCount}개 선택 삭제` : "선택 삭제"}
              </Text>
            )}
          </ScalePressable>
        </View>
      )}

      <ConfirmModal
        visible={deleteTargetId !== null}
        title="삭제하시겠습니까?"
        description={deleteTargetType === "my_article" ? "이 편지는 영구적으로 삭제됩니다." : "이 메모는 영구적으로 삭제됩니다."}
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />

      <BottomSheet
        visible={archiveSheetVisible}
        onClose={() => {
          setArchiveSheetVisible(false);
          setArchiveArticleId(null);
          setSelectedCollectionId(null);
        }}
        snapPoints={[0.6]}
        enableDragDown
        dismissable
      >
        <View style={styles.archiveSheetContainer}>
          <Text style={styles.archiveSheetTitle}>보관할 폴더 선택</Text>
          {collectionsQuery.isLoading ? (
            <View style={styles.archiveSheetEmpty}>
              <Text style={styles.archiveSheetEmptyText}>불러오는 중...</Text>
            </View>
          ) : sortedCollections.length === 0 ? (
            <View style={styles.archiveSheetEmpty}>
              <Text style={styles.archiveSheetEmptyText}>보관할 폴더가 없어요</Text>
            </View>
          ) : (
            <FlatList
              data={sortedCollections}
              keyExtractor={(c) => c.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.archiveSheetList}
              ItemSeparatorComponent={() => <View style={styles.archiveSeparator} />}
              renderItem={({ item }) => {
                const isSelected = item.id === selectedCollectionId;
                return (
                  <ScalePressable
                    style={[styles.archiveItem, isSelected && styles.archiveItemSelected]}
                    onPress={() => setSelectedCollectionId(item.id)}
                  contentStyle={styles.archiveItemContent}
                  >
                    <View style={styles.archiveItemLeft}>
                      <Feather
                        name={item.isImpression ? "heart" : "folder"}
                        size={18}
                        color={isSelected ? Colors.zinc900 : Colors.zinc500}
                      />
                      <Text
                        style={[styles.archiveItemName, isSelected && styles.archiveItemNameSelected]}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                    </View>
                    <View style={styles.archiveItemRight}>
                      {item.articleCount !== undefined && (
                        <Text style={styles.archiveItemCount}>{item.articleCount}편</Text>
                      )}
                      {isSelected && <Feather name="check" size={16} color={Colors.zinc900} />}
                    </View>
                  </ScalePressable>
                );
              }}
            />
          )}
          <ScalePressable
            style={[
              styles.archiveConfirmButton,
              (!selectedCollectionId || isArchiving) && styles.archiveConfirmButtonDisabled,
            ]}
            onPress={handleArchiveConfirm}
            disabled={!selectedCollectionId || isArchiving}
          contentStyle={styles.archiveConfirmButtonContent}
          >
            <Text style={styles.archiveConfirmButtonText}>
              {isArchiving ? "보관 중..." : "보관하기"}
            </Text>
          </ScalePressable>
        </View>
      </BottomSheet>

      <ConfirmModal
        visible={showBulkDeleteConfirm}
        title={`${selectedCount}개를 삭제할까요?`}
        description={topTab === "my_article" ? "선택한 편지가 영구적으로 삭제됩니다." : "선택한 메모가 영구적으로 삭제됩니다."}
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onConfirm={handleBulkDeleteConfirm}
        onCancel={handleBulkDeleteCancel}
      />

      <ThoughtDetailModal
        thought={selectedThought}
        onClose={() => setSelectedThought(null)}
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
    marginBottom: 8,
  },
  topTabItem: {
    paddingHorizontal: 0,
    paddingTop: 12,
    paddingBottom: 0,
  },
  topTabItemContent: {
    alignItems: "center",},
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
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: Colors.zinc900,
    borderRadius: 1,
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
    backgroundColor: Colors.zinc900,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  createButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexGrow: 0,
  },
  createButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
  selectionRow: {
    paddingLeft: Spacing.screenPx,
  },
  selectionRowContent: {
    flexDirection: "row",
    alignItems: "center",},
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
  },
  bulkDeleteButtonContent: {
    alignItems: "center",
    justifyContent: "center",},
  bulkDeleteButtonDisabled: {
    backgroundColor: Colors.zinc200,
  },
  bulkDeleteText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
  archiveSheetContainer: {
    flex: 1,
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 16,
  },
  archiveSheetTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
    textAlign: "center",
    paddingVertical: 12,
  },
  archiveSheetEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  archiveSheetEmptyText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  archiveSheetList: {
    paddingVertical: 4,
  },
  archiveSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.zinc100,
  },
  archiveItem: {
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  archiveItemContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",},
  archiveItemSelected: {
    backgroundColor: Colors.zinc50,
  },
  archiveItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  archiveItemName: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc600,
    flex: 1,
  },
  archiveItemNameSelected: {
    ...Typography.bodySemiBold,
    color: Colors.zinc900,
  },
  archiveItemRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  archiveItemCount: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc400,
  },
  archiveConfirmButton: {
    backgroundColor: Colors.zinc900,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 12,
  },
  archiveConfirmButtonContent: {
    alignItems: "center",},
  archiveConfirmButtonDisabled: {
    opacity: 0.4,
  },
  archiveConfirmButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
});
