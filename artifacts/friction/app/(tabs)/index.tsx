import React, { useState, useRef, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ScrollView,
  Pressable,
} from "react-native";
import AnimatedSearchBar from "@/components/AnimatedSearchBar/AnimatedSearchBar";
import { useRouter, useFocusEffect } from "expo-router";
import { useReaderTransition } from "@/contexts/ReaderTransitionContext";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { PageHeader } from "@/components/NavBar/PageHeader";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import EnvelopeFrontCard from "@/components/EnvelopeCard/EnvelopeFrontCard";
import { DateGroupCarousel } from "@/components/DateGroupCarousel/DateGroupCarousel";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import CardSelectOverlay, { type OriginLayout, type ChainArticleMeta, type EnvelopeInfo } from "@/components/CardSelectOverlay/CardSelectOverlay";
import { useAncestorChain } from "@/hooks/useAncestorChain";
import { useQueryClient } from "@tanstack/react-query";
import { useListInbox, useMarkInboxOpened, useDeleteInboxItem, getListInboxQueryKey } from "@workspace/api-client-react";
import { patchInboxItemInCache, removeInboxItemFromCache } from "@/lib/queryInvalidation";
import type { InboxItem, Article } from "@workspace/api-client-react";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/contexts/ToastContext";
import { isQueryStale } from "@/lib/useScreenFocused";
import { useRealtimeChannel } from "@/lib/useRealtimeChannel";
import { LIST_PERF_PRESET } from "@/lib/listPerf";
import { useScrollPressGuard } from "@/hooks/useScrollPressGuard";

/** Recursively collect all inbox descendants of rootArticleId (oldest → newest BFS). */
function findAllDescendants(rootArticleId: string, allItems: InboxItem[]): InboxItem[] {
  const direct = allItems.filter((it) => (it as any).replyToArticleId === rootArticleId);
  return direct.flatMap((it) => [it, ...findAllDescendants(it.articleId, allItems)]);
}

function getInboxSenderName(item: InboxItem): string {
  return item.senderDisplayName ?? item.sender?.nickname ?? item.sender?.id ?? "참여자";
}

const CARD_W = Sizing.cardSlotW;
const CARD_H = Sizing.cardH;

interface DateGroup {
  dateKey: string;
  label: string;
  items: InboxItem[];
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function getSlotKey(visibleAt: string): string {
  const utcMs = new Date(visibleAt).getTime();
  const kstDate = new Date(utcMs + KST_OFFSET_MS);
  const yyyy = kstDate.getUTCFullYear();
  const mm = String(kstDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kstDate.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatSlotLabel(slotKey: string): string {
  const [, mm, dd] = slotKey.split("-");
  const month = parseInt(mm, 10);
  const day = parseInt(dd, 10);
  return `${month}월 ${day}일`;
}

function groupBySlot(items: InboxItem[]): DateGroup[] {
  const map = new Map<string, InboxItem[]>();
  const sorted = [...items].sort(
    (a, b) => new Date(b.visibleAt).getTime() - new Date(a.visibleAt).getTime(),
  );

  for (const item of sorted) {
    const key = getSlotKey(item.visibleAt);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }

  return Array.from(map.entries()).map(([dateKey, groupItems]) => {
    // Sort order within a group: replies → regular letters.
    // Items in the same tier keep their original visibleAt order.
    const ordered = [...groupItems].sort((a, b) => {
      const aIsReply = a.isReplyToMe === true;
      const bIsReply = b.isReplyToMe === true;
      if (aIsReply && !bIsReply) return -1;
      if (!aIsReply && bIsReply) return 1;
      return 0;
    });
    return {
      dateKey,
      label: formatSlotLabel(dateKey),
      items: ordered,
    };
  });
}

// Module-level keyExtractor — stable identity across renders so FlatList
// can correctly skip per-row reconciliation when only parent state changes.
const groupKeyExtractor = (group: DateGroup) => group.dateKey;
const inboxItemKey = (item: InboxItem) => item.id;

export default function InboxScreen() {
  const { startFadeToBlack } = useReaderTransition();
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId, nickname } = useUser();
  const { showToast } = useToast();
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tapItem, setTapItem] = useState<InboxItem | null>(null);
  const [tapItemOrigin, setTapItemOrigin] = useState<OriginLayout | null>(null);
  const [isTappedSourceHidden, setIsTappedSourceHidden] = useState(false);

  const [sourcePromptItem, setSourcePromptItem] = useState<InboxItem | null>(null);

  const { data: inboxData, isLoading, refetch } = useListInbox(
    // isRead=false tells the server to return only unread items, keeping the
    // response payload small as read letters accumulate over time.
    // The picker (SourceArticlePickerSheet) omits this param to see all visible items.
    { recipientId: userId, isRead: false } as Parameters<typeof useListInbox>[0],
  );
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  useRealtimeChannel(
    userId ? `inbox:${userId}` : null,
    [{ table: "inbox", filter: `recipient_id=eq.${userId}` }],
    () => {
      refetch();
    },
  );
  const markOpened = useMarkInboxOpened();
  const deleteInboxItem = useDeleteInboxItem();

  const visibleItems = useMemo(() => {
    if (!inboxData) return [];
    const now = new Date();
    return (inboxData as InboxItem[]).filter(
      (item) => new Date(item.visibleAt) <= now && item.isRead !== true,
    );
  }, [inboxData]);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return visibleItems;
    const q = searchQuery.toLowerCase();
    return visibleItems.filter((item) => {
      const title = item.article?.title?.toLowerCase() ?? "";
      const senderName = getInboxSenderName(item).toLowerCase();
      return title.includes(q) || senderName.includes(q);
    });
  }, [visibleItems, searchQuery]);

  const groups = useMemo(() => groupBySlot(filteredItems), [filteredItems]);
  const scrollPressGuard = useScrollPressGuard();

  const handleSearchPress = useCallback(() => {
    setSearchActive((prev) => {
      if (prev) setSearchQuery("");
      return !prev;
    });
  }, []);

  const handleCardPress = useCallback((item: InboxItem, layout: OriginLayout) => {
    setIsTappedSourceHidden(false);
    setTapItemOrigin(layout);
    setTapItem(item);
  }, []);

  // Stable renderItem for the carousel FlatList — avoids re-creating the
  // function (and triggering row-level reconciliation) on every parent render.
  const renderGroupItem = useCallback(
    ({ item: group }: { item: DateGroup }) => (
      <View>
        <DateGroupCarousel
          dateLabel={group.label}
          countLabel={`${group.items.length}편`}
          items={group.items}
          itemKey={inboxItemKey}
          cardWidth={CARD_W}
          cardHeight={CARD_H}
          shouldIgnoreVerticalPress={scrollPressGuard.shouldIgnoreVerticalPress}
          renderCard={(item, context) => {
            const isSealed = Boolean((item as any).isEnvelope) && !item.openedAt;
            const handlePress = () => {
              if (context.shouldIgnorePress()) return;
              context.measureOrigin((layout) => handleCardPress(item, layout));
            };
            return (
              <View
                style={
                  isTappedSourceHidden && item.id === tapItem?.id
                    ? styles.cardSlotHidden
                    : undefined
                }
              >
                {isSealed ? (
                  <EnvelopeFrontCard
                    senderName={getInboxSenderName(item)}
                    senderLocation={item.collectionName}
                    recipientName={nickname}
                    isActive={context.isActive}
                    cardWidth={CARD_W}
                    carouselShadow
                  />
                ) : (
                  <ArticleCardItem
                    title={item.article?.title ?? "제목 없음"}
                    onPress={handlePress}
                    authorName={getInboxSenderName(item)}
                    collectionName={item.collectionName}
                    cover={item.article?.cover}
                    isRead={item.isRead}
                    isActive={context.isActive}
                    carouselShadow
                  />
                )}
                {isSealed ? (
                  <Pressable style={StyleSheet.absoluteFill} onPress={handlePress} />
                ) : null}
              </View>
            );
          }}
        />
      </View>
    ),
    [
      scrollPressGuard.shouldIgnoreVerticalPress,
      handleCardPress,
      isTappedSourceHidden,
      nickname,
      tapItem?.id,
    ],
  );

  const handleModalClose = useCallback(() => {
    setIsTappedSourceHidden(false);
    setTapItem(null);
    setTapItemOrigin(null);
  }, []);

  const handleNavigateToCollection = useCallback((collectionId: string) => {
    router.push({ pathname: "/of-02-detail", params: { id: collectionId } });
  }, [router]);

  const prepareInboxItem = useCallback((item: InboxItem) => {
    if (!item.openedAt) {
      const openedAt = new Date().toISOString();
      patchInboxItemInCache(queryClient, item.id, { openedAt });
      markOpened.mutateAsync({ id: item.id }).catch((e: unknown) => {
        console.warn("Failed to mark inbox opened:", e instanceof Error ? e.message : e);
      });
    }
  }, [markOpened, queryClient]);

  const handleRead = useCallback((chainIdx: number) => {
    // Look up which article and inbox item correspond to the active carousel slot.
    // chainArticles / inboxItemByArticleId are captured via refs so the callback
    // stays stable even after setTapItem(null) clears the overlay.
    const article = chainArticlesRef.current[chainIdx];
    const inboxItem = article
      ? inboxItemByArticleIdRef.current.get(article.id) ?? null
      : null;

    if (inboxItem) {
      const isReply = inboxItem.isReplyToMe === true || !!inboxItem.replyToArticleId;
      if (isReply && inboxItem.hasReadSourceArticle === false) {
        setTapItem(null);
        setSourcePromptItem(inboxItem);
        return;
      }
      // CardSelectOverlay handles the fade-to-black internally (Modal renders above global overlay).
      // Here we just navigate immediately after the fade calls back.
      prepareInboxItem(inboxItem);
      const mode = (inboxItem.isRead || inboxItem.hasReadBefore) ? "re_read" : "basic";
      setTapItem(null);
      router.push({
        pathname: "/read",
        params: { articleId: inboxItem.articleId, inboxId: inboxItem.id, mode },
      });
    } else if (article) {
      setTapItem(null);
      router.push({
        pathname: "/read",
        params: { articleId: article.id, mode: "re_read" },
      });
    }
  }, [prepareInboxItem, router]);

  const handleSourcePromptClose = useCallback(() => {
    setSourcePromptItem(null);
  }, []);

  const handleReadSourceFirst = useCallback(() => {
    const item = sourcePromptItem;
    if (!item || !item.replyToArticleId) {
      setSourcePromptItem(null);
      return;
    }
    // 원글에 대응하는 (현재 사용자의) 미독 인박스 행이 있다면 함께 전달.
    // 없으면 inboxId 없이 진입 — read.tsx가 inboxId 없이도 동작한다.
    const sourceInboxId = (inboxData as InboxItem[] | undefined)?.find(
      (it) => it.articleId === item.replyToArticleId,
    )?.id;
    startFadeToBlack(() => {
      setSourcePromptItem(null);
      router.push({
        pathname: "/read",
        params: {
          articleId: item.replyToArticleId!,
          ...(sourceInboxId ? { inboxId: sourceInboxId } : {}),
          mode: "basic",
        },
      });
    });
  }, [sourcePromptItem, inboxData, startFadeToBlack, router]);

  const handleSkipToReply = useCallback(() => {
    const item = sourcePromptItem;
    if (!item) { setSourcePromptItem(null); return; }
    prepareInboxItem(item);
    const mode = (item.isRead || item.hasReadBefore) ? "re_read" : "basic";
    startFadeToBlack(() => {
      setSourcePromptItem(null);
      router.push({
        pathname: "/read",
        params: { articleId: item.articleId, inboxId: item.id, mode },
      });
    });
  }, [sourcePromptItem, prepareInboxItem, startFadeToBlack, router]);

  const handleDelete = useCallback(async () => {
    if (!tapItem) return;
    const item = tapItem;
    setTapItem(null);
    try {
      await deleteInboxItem.mutateAsync({ id: item.id });
      // 낙관적 제거 — 캐시에서 곧장 빼서 목록이 다시 fetch 되며 깜빡이지 않게 한다.
      removeInboxItemFromCache(queryClient, item.id);
      showToast({ message: "수신함에서 삭제되었습니다.", type: "success" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "삭제에 실패했습니다.";
      showToast({ message: msg, type: "error" });
    }
  }, [tapItem, deleteInboxItem, queryClient, showToast]);

  const handleRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [refetch]);

  // ── Ancestor chain — shared 편지 선택 모드 traversal ──────────────────────
  // Each tap starts a new traversal: follow InboxItem.replyToArticleId, then
  // recursively follow Article.sourceArticleId until the root.
  const ancestorChain = useAncestorChain(
    (tapItem as any)?.replyToArticleId as string | null | undefined,
    queryClient,
  );

  // ── Fast lookup: articleId → InboxItem ───────────────────────────────────
  const inboxItemByArticleId = useMemo(() => {
    const map = new Map<string, InboxItem>();
    for (const item of (inboxData as InboxItem[] | undefined) ?? []) {
      if (item.articleId) map.set(item.articleId, item);
    }
    return map;
  }, [inboxData]);

  // ── Build full ordered chain ──────────────────────────────────────────────
  // Layout: [oldest ancestor … immediate parent] → tapped → [descendants…]
  // Null entries in articles[] = still-loading skeleton slots.
  const { chainArticles, chainMetas, chainInitialIndex } = useMemo(() => {
    if (!tapItem?.article) {
      return {
        chainArticles: [] as (Article | null)[],
        chainMetas: [] as ChainArticleMeta[],
        chainInitialIndex: 0,
      };
    }

    const artList: (Article | null)[] = [];
    const metaList: ChainArticleMeta[] = [];

    // Ancestors — oldest first (ancestorChain is ordered oldest→newest)
    for (const slot of ancestorChain) {
      const inboxItem = slot.article ? inboxItemByArticleId.get(slot.article.id) : null;
      artList.push(slot.article);
      metaList.push(
        slot.article
          ? {
              authorName:
                inboxItem?.senderDisplayName ??
                inboxItem?.sender?.nickname ??
                slot.article.authorNickname ??
                null,
              authorId: inboxItem?.sender?.id ?? inboxItem?.senderId ?? slot.article.authorId ?? null,
              collectionName: inboxItem?.collectionName ?? slot.article.collectionName ?? null,
              collectionId: inboxItem?.sourceTeamCollectionId ?? slot.article.collectionId ?? null,
              date: inboxItem?.visibleAt ?? slot.article.createdAt ?? null,
              isRead: inboxItem?.isRead ?? false,
            }
          : {},
      );
    }

    const initIdx = artList.length; // tapped article goes here

    // Tapped article
    artList.push(tapItem.article);
    metaList.push({
      authorName: tapItem.senderDisplayName ?? tapItem.sender?.nickname ?? tapItem.sender?.id ?? null,
      authorId: tapItem.sender?.id ?? tapItem.senderId ?? null,
      collectionName: tapItem.collectionName ?? tapItem.article?.collectionName ?? null,
      collectionId: tapItem.sourceTeamCollectionId ?? tapItem.article?.collectionId ?? null,
      date: tapItem.visibleAt ?? null,
      isRead: tapItem.isRead,
    });

    // Descendants — recursively collected from all inbox data
    const allInboxItems = (inboxData as InboxItem[] | undefined) ?? [];
    const descendants = findAllDescendants(tapItem.articleId, allInboxItems);
    for (const desc of descendants) {
      if (!desc.article) continue;
      artList.push(desc.article);
      metaList.push({
        authorName: desc.senderDisplayName ?? desc.sender?.nickname ?? desc.article.authorNickname ?? null,
        authorId: desc.sender?.id ?? desc.senderId ?? desc.article?.authorId ?? null,
        collectionName: desc.collectionName ?? desc.article.collectionName ?? null,
        collectionId: desc.sourceTeamCollectionId ?? desc.article?.collectionId ?? null,
        date: desc.visibleAt ?? desc.article.createdAt ?? null,
        isRead: desc.isRead,
      });
    }

    return { chainArticles: artList, chainMetas: metaList, chainInitialIndex: initIdx };
  }, [tapItem, ancestorChain, inboxItemByArticleId, inboxData]);

  // Stable refs so the handleRead callback can read the latest chain
  // even after tapItem has been cleared (setTapItem(null)).
  const chainArticlesRef = useRef<(Article | null)[]>([]);
  const inboxItemByArticleIdRef = useRef<Map<string, InboxItem>>(new Map());
  chainArticlesRef.current = chainArticles;
  inboxItemByArticleIdRef.current = inboxItemByArticleId;

  // Refetch the inbox when this tab regains focus ONLY if the cached data
  // is stale (older than FOCUS_STALE_THRESHOLD_MS / the global staleTime).
  // Skipping the refetch when data is fresh avoids the full-screen loading
  // spinner and scroll-position jump that users see on quick tab switches.
  // Realtime subscriptions handle near-instant updates while focused.
  const refetchInbox = refetch;
  useFocusEffect(
    useCallback(() => {
      if (isQueryStale(queryClient, getListInboxQueryKey({ recipientId: userId, isRead: false } as Parameters<typeof getListInboxQueryKey>[0]))) {
        refetchInbox();
      }
    }, [refetchInbox, queryClient, userId]),
  );

  return (
    <View style={styles.container}>
      <PageHeader
        title="수신"
        showSearch
        onSearchPress={handleSearchPress}
        searchActive={searchActive}
      />

      <AnimatedSearchBar
        active={searchActive}
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="제목, 이웃 이름으로 검색"
      />

      {isLoading ? (
        <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
          <Text style={styles.emptyText}>불러오는 중...</Text>
        </View>
      ) : groups.length === 0 ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
          refreshControl={
            <RefreshControl refreshing={isManualRefreshing} onRefresh={handleRefresh} />
          }
        >
          <Feather name="inbox" size={48} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>수신함이 비어 있어요</Text>
          <Text style={styles.emptyText}>이웃이 보낸 편지가 도착하면 여기에 표시됩니다</Text>
        </ScrollView>
      ) : (
        <FlatList
          {...LIST_PERF_PRESET}
          data={groups}
          extraData={`${tapItem?.id ?? ""}:${isTappedSourceHidden}`}
          keyExtractor={groupKeyExtractor}
          renderItem={renderGroupItem}
          refreshControl={
            <RefreshControl refreshing={isManualRefreshing} onRefresh={handleRefresh} tintColor={Colors.zinc400} />
          }
          contentContainerStyle={[styles.listContent, { paddingBottom: navBottom }]}
          showsVerticalScrollIndicator={false}
          onScroll={scrollPressGuard.onScroll}
          scrollEventThrottle={16}
        />
      )}

      <CardSelectOverlay
        articles={chainArticles}
        metas={chainMetas}
        initialIndex={chainInitialIndex}
        originLayout={tapItemOrigin}
        onClose={handleModalClose}
        onRead={handleRead}
        onReady={() => setIsTappedSourceHidden(true)}
        originUsesCarouselShadow
        onCardTap={handleRead}
        onNavigateToCollection={handleNavigateToCollection}
        onNavigateToAuthor={(authorId) => router.push(`/user-profile/${authorId}` as never)}
        envelopeInfo={
          tapItem && (tapItem as any).isEnvelope && !tapItem.openedAt
            ? {
                senderName: tapItem.senderDisplayName ?? tapItem.sender?.nickname ?? tapItem.sender?.id ?? null,
                senderLocation: tapItem.collectionName ?? null,
                recipientName: nickname ?? null,
                onOpen: async () => {
                  const openedAt = new Date().toISOString();
                  patchInboxItemInCache(queryClient, tapItem.id, { openedAt });
                  try {
                    await markOpened.mutateAsync({ id: tapItem.id });
                  } catch (e) {
                    console.warn("Failed to mark envelope opened:", e instanceof Error ? e.message : e);
                  }
                },
              }
            : null
        }
      />

      <ConfirmModal
        visible={sourcePromptItem !== null}
        title="원래 편지를 먼저 읽어보시겠어요?"
        description="맥락 파악을 위해 원래 편지를 먼저 읽는 것을 추천합니다."
        cancelLabel="건너뛰고 답장 읽기"
        confirmLabel="원래 편지 먼저 읽기"
        onCancel={handleSkipToReply}
        onConfirm={handleReadSourceFirst}
        onBackdropPress={handleSourcePromptClose}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  listContent: {
    paddingBottom: Spacing.navBarPaddingBottom,
  },
  cardSlotHidden: {
    opacity: 0,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    gap: 12,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.zinc900,
  },
  emptyText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
  },
});
