import React, { useState, useRef, useMemo, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  RefreshControl,
  ScrollView,
  Platform,
  Animated,
  PanResponder,
  Pressable,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import AnimatedSearchBar from "@/components/AnimatedSearchBar/AnimatedSearchBar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { PageHeader } from "@/components/NavBar/PageHeader";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import EnvelopeFrontCard from "@/components/EnvelopeCard/EnvelopeFrontCard";
import DotIndicator from "@/components/DotIndicator/DotIndicator";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import CardSelectOverlay, { type OriginLayout, type ChainArticleMeta, type EnvelopeInfo } from "@/components/CardSelectOverlay/CardSelectOverlay";
import { useQueryClient } from "@tanstack/react-query";
import { useListInbox, useMarkInboxOpened, useDeleteInboxItem, getListInboxQueryKey, getArticle, getGetArticleQueryKey } from "@workspace/api-client-react";
import { patchInboxItemInCache, removeInboxItemFromCache } from "@/lib/queryInvalidation";
import type { InboxItem, Article } from "@workspace/api-client-react";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/contexts/ToastContext";
import { isQueryStale } from "@/lib/useScreenFocused";
import { useRealtimeChannel } from "@/lib/useRealtimeChannel";
import { LIST_PERF_PRESET } from "@/lib/listPerf";

/** Recursively collect all inbox descendants of rootArticleId (oldest → newest BFS). */
function findAllDescendants(rootArticleId: string, allItems: InboxItem[]): InboxItem[] {
  const direct = allItems.filter((it) => (it as any).replyToArticleId === rootArticleId);
  return direct.flatMap((it) => [it, ...findAllDescendants(it.articleId, allItems)]);
}

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = Sizing.cardSlotW;
const CARD_H = Sizing.cardH;
const CARD_GAP = Spacing.cardGap;
const SNAP_INTERVAL = CARD_W + CARD_GAP;
const SNAP_THRESHOLD = 48;
const FLING_VELOCITY = 0.5;
const GROUP_ITEM_H = Sizing.groupH + 8;

const CENTER_OFFSET = (SCREEN_W - CARD_W) / 2;

function getBaseX(idx: number) {
  return -(idx * SNAP_INTERVAL) + CENTER_OFFSET;
}

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

/**
 * Web: PanResponder + Animated (mouse drag works via RN Web's mouse→touch mapping)
 * Native: horizontal ScrollView with snap (native touch scroll, no gesture conflict)
 */
function CarouselGroup({
  group,
  onCardPress,
  hiddenCardId,
  recipientName,
}: {
  group: DateGroup;
  onCardPress: (item: InboxItem, layout: OriginLayout) => void;
  hiddenCardId?: string | null;
  recipientName?: string | null;
}) {
  const itemCount = group.items.length;
  const [activeIndex, setActiveIndex] = useState(0);

  // Refs for each card slot — used to call measureInWindow on press
  const cardSlotRefs = useRef<(View | null)[]>([]);

  // ── Web: PanResponder state ─────────────────────────────────────────────
  const activeIndexRef = useRef(0);
  const itemCountRef = useRef(itemCount);
  const translateX = useRef(new Animated.Value(getBaseX(0))).current;
  // Tracks whether the current gesture was a drag — blocks onPress if true.
  // Reset on every new touch start so plain taps always work.
  const swipedRef = useRef(false);

  useEffect(() => {
    itemCountRef.current = itemCount;
    const clamped = Math.min(activeIndexRef.current, itemCount - 1);
    if (clamped !== activeIndexRef.current) {
      activeIndexRef.current = clamped;
      setActiveIndex(clamped);
      translateX.setValue(getBaseX(clamped));
    }
  }, [itemCount, translateX]);

  const snapToRef = useRef((_idx: number) => {});
  snapToRef.current = (idx: number) => {
    const clamped = Math.max(0, Math.min(idx, itemCountRef.current - 1));
    activeIndexRef.current = clamped;
    setActiveIndex(clamped);
    Animated.spring(translateX, {
      toValue: getBaseX(clamped),
      useNativeDriver: false,
      overshootClamping: true,
      tension: 100,
      friction: 20,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => {
        swipedRef.current = false;
        return false;
      },
      onMoveShouldSetPanResponder: (_, g) =>
        itemCountRef.current > 1 &&
        Math.abs(g.dx) > Math.abs(g.dy) &&
        Math.abs(g.dx) > 5,
      onPanResponderGrant: () => {
        translateX.setValue(getBaseX(activeIndexRef.current));
      },
      onPanResponderMove: (_, g) => {
        // Only treat as a deliberate swipe once the user has dragged >15px,
        // avoiding false-positives from slight trackpad/mouse micro-movements
        // that would block subsequent taps.
        if (Math.abs(g.dx) > 15) {
          swipedRef.current = true;
        }
        const baseX = getBaseX(activeIndexRef.current);
        const raw = baseX + g.dx;
        const maxX = getBaseX(0);
        const minX = getBaseX(itemCountRef.current - 1);
        const rubber =
          raw > maxX
            ? maxX + (raw - maxX) * 0.3
            : raw < minX
              ? minX + (raw - minX) * 0.3
              : raw;
        translateX.setValue(rubber);
      },
      onPanResponderRelease: (_, g) => {
        const { dx, vx } = g;
        const current = activeIndexRef.current;
        let next = current;
        if (Math.abs(vx) > FLING_VELOCITY) {
          next = vx < 0 ? current + 1 : current - 1;
        } else if (Math.abs(dx) >= SNAP_THRESHOLD) {
          next = dx < 0 ? current + 1 : current - 1;
        }
        snapToRef.current(next);
        // Reset after any spurious same-gesture click event has fired (web).
        // onStartShouldSetPanResponder is not reliably called for subsequent
        // mouse clicks once the responder has been granted, so we reset here.
        setTimeout(() => { swipedRef.current = false; }, 100);
      },
      onPanResponderTerminate: (_, g) => {
        const { dx, vx } = g;
        const current = activeIndexRef.current;
        let next = current;
        if (Math.abs(vx) > FLING_VELOCITY) {
          next = vx < 0 ? current + 1 : current - 1;
        } else if (Math.abs(dx) >= SNAP_THRESHOLD) {
          next = dx < 0 ? current + 1 : current - 1;
        }
        snapToRef.current(next);
        setTimeout(() => { swipedRef.current = false; }, 100);
      },
    }),
  ).current;

  // ── Native: ScrollView onScroll ─────────────────────────────────────────
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = e.nativeEvent.contentOffset.x;
      const index = Math.round(offsetX / SNAP_INTERVAL);
      setActiveIndex(Math.max(0, Math.min(index, itemCount - 1)));
    },
    [itemCount],
  );

  // ── Shared card list ────────────────────────────────────────────────────
  const cards = group.items.map((item, index) => {
    const isSealed = !!(item as any).isEnvelope && !item.openedAt;
    const handlePress = () => {
      if (Platform.OS === "web" && swipedRef.current) return;
      const slotRef = cardSlotRefs.current[index];
      if (slotRef) {
        slotRef.measureInWindow((x, y, width, height) => {
          onCardPress(item, { x, y, width, height });
        });
      } else {
        onCardPress(item, { x: 0, y: 0, width: CARD_W, height: CARD_H });
      }
    };
    return (
      <View
        key={item.id}
        ref={(ref) => { cardSlotRefs.current[index] = ref; }}
        style={[
          styles.cardSlot,
          index < group.items.length - 1 && { marginRight: CARD_GAP },
          item.id === hiddenCardId && styles.cardSlotHidden,
        ]}
      >
        {isSealed ? (
          <EnvelopeFrontCard
            senderName={item.sender?.nickname ?? item.sender?.id}
            senderLocation={item.collectionName}
            recipientName={recipientName}
            isActive={index === activeIndex}
            cardWidth={CARD_W}
          />
        ) : (
          <ArticleCardItem
            title={item.article?.title ?? "제목 없음"}
            onPress={handlePress}
            authorName={item.sender?.nickname ?? item.sender?.id}
            collectionName={item.collectionName}
            cover={item.article?.cover}
            isRead={item.isRead}
            isActive={index === activeIndex}
          />
        )}
        {isSealed ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={handlePress} />
        ) : null}
      </View>
    );
  });

  return (
    <View style={styles.groupContainer}>
      <View style={styles.dateHeader}>
        <Text style={styles.dateHeaderText}>{group.label}</Text>
        <Text style={styles.dateHeaderCount}>{group.items.length}편</Text>
      </View>

      {Platform.OS === "web" ? (
        // Web: PanResponder captures mouse drag events (RN Web maps mouse→touch)
        <View
          style={[
            styles.carouselWindow,
            // Prevent text-selection and browser native drag from firing
            // pointercancel mid-gesture (web-only CSS props)
            { userSelect: "none", cursor: "grab" } as object,
          ]}
          {...panResponder.panHandlers}
        >
          <Animated.View
            style={[styles.carouselTrack, { transform: [{ translateX }] }]}
          >
            {cards}
          </Animated.View>
        </View>
      ) : (
        // Native: horizontal ScrollView with snap — proper touch gesture handling
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={SNAP_INTERVAL}
          snapToAlignment="start"
          decelerationRate="fast"
          scrollEventThrottle={16}
          onScroll={handleScroll}
          contentContainerStyle={styles.carouselContent}
          style={styles.carouselScroll}
        >
          {cards}
        </ScrollView>
      )}

      <DotIndicator total={group.items.length} activeIndex={activeIndex} />
    </View>
  );
}

// Module-level keyExtractor — stable identity across renders so FlatList
// can correctly skip per-row reconciliation when only parent state changes.
const groupKeyExtractor = (group: DateGroup) => group.dateKey;

export default function InboxScreen() {
  const insets = useSafeAreaInsets();
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId, nickname } = useUser();
  const { showToast } = useToast();
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tapItem, setTapItem] = useState<InboxItem | null>(null);
  const [tapItemOrigin, setTapItemOrigin] = useState<OriginLayout | null>(null);

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
      const senderName = item.sender?.nickname?.toLowerCase() ?? "";
      return title.includes(q) || senderName.includes(q);
    });
  }, [visibleItems, searchQuery]);

  const groups = useMemo(() => groupBySlot(filteredItems), [filteredItems]);

  const handleSearchPress = useCallback(() => {
    setSearchActive((prev) => {
      if (prev) setSearchQuery("");
      return !prev;
    });
  }, []);

  const handleCardPress = useCallback((item: InboxItem, layout: OriginLayout) => {
    setTapItemOrigin(layout);
    setTapItem(item);
  }, []);

  // Stable renderItem for the carousel FlatList — avoids re-creating the
  // function (and triggering row-level reconciliation) on every parent render.
  const renderGroupItem = useCallback(
    ({ item: group }: { item: DateGroup }) => (
      <CarouselGroup
        group={group}
        onCardPress={handleCardPress}
        hiddenCardId={tapItem?.id ?? null}
        recipientName={nickname}
      />
    ),
    [handleCardPress, tapItem?.id, nickname],
  );

  const handleModalClose = useCallback(() => {
    setTapItem(null);
    setTapItemOrigin(null);
  }, []);

  const handleNavigateToCollection = useCallback((collectionId: string) => {
    router.push({ pathname: "/of-02-detail", params: { id: collectionId } });
  }, [router]);

  const navigateToReply = useCallback(async (item: InboxItem) => {
    if (!item.openedAt) {
      // 낙관적 업데이트: openedAt 만 즉시 캐시에 반영하고, invalidate 로 인한
      // 재요청+로딩 깜빡임을 생략한다. 서버 호출이 실패해도 다음 focus 시
      // refetch 가 다시 정상화한다.
      const openedAt = new Date().toISOString();
      patchInboxItemInCache(queryClient, item.id, { openedAt });
      try {
        await markOpened.mutateAsync({ id: item.id });
      } catch (e: unknown) {
        console.warn("Failed to mark inbox opened:", e instanceof Error ? e.message : e);
      }
    }
    const mode = (item.isRead || item.hasReadBefore) ? "re_read" : "basic";
    router.push({
      pathname: "/read",
      params: {
        articleId: item.articleId,
        inboxId: item.id,
        mode,
      },
    });
  }, [markOpened, router, queryClient]);

  const handleRead = useCallback(async (chainIdx: number) => {
    // Look up which article and inbox item correspond to the active carousel slot.
    // chainArticles / inboxItemByArticleId are captured via refs so the callback
    // stays stable even after setTapItem(null) clears the overlay.
    const article = chainArticlesRef.current[chainIdx];
    const inboxItem = article
      ? inboxItemByArticleIdRef.current.get(article.id) ?? null
      : null;
    setTapItem(null);
    if (inboxItem) {
      const isReply = inboxItem.isReplyToMe === true || !!inboxItem.replyToArticleId;
      if (isReply && inboxItem.hasReadSourceArticle === false) {
        setSourcePromptItem(inboxItem);
        return;
      }
      await navigateToReply(inboxItem);
    } else if (article) {
      router.push({
        pathname: "/read",
        params: { articleId: article.id, mode: "re_read" },
      });
    }
  }, [navigateToReply, router]);

  const handleSourcePromptClose = useCallback(() => {
    setSourcePromptItem(null);
  }, []);

  const handleReadSourceFirst = useCallback(() => {
    const item = sourcePromptItem;
    if (!item || !item.replyToArticleId) {
      setSourcePromptItem(null);
      return;
    }
    setSourcePromptItem(null);
    // 원글에 대응하는 (현재 사용자의) 미독 인박스 행이 있다면 함께 전달.
    // 없으면 inboxId 없이 진입 — read.tsx가 inboxId 없이도 동작한다.
    const sourceInboxId = (inboxData as InboxItem[] | undefined)?.find(
      (it) => it.articleId === item.replyToArticleId,
    )?.id;
    router.push({
      pathname: "/read",
      params: {
        articleId: item.replyToArticleId,
        ...(sourceInboxId ? { inboxId: sourceInboxId } : {}),
        mode: "basic",
      },
    });
  }, [sourcePromptItem, inboxData, router]);

  const handleSkipToReply = useCallback(async () => {
    const item = sourcePromptItem;
    setSourcePromptItem(null);
    if (!item) return;
    await navigateToReply(item);
  }, [sourcePromptItem, navigateToReply]);

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

  // ── Ancestor chain — truly recursive fetch ───────────────────────────────
  // Each tap starts a new traversal: follow InboxItem.replyToArticleId, then
  // recursively follow Article.sourceArticleId until the root. Results are
  // accumulated in state so each discovered slot is shown immediately as a
  // skeleton and replaced with the real article once it loads.

  interface AncestorSlot { id: string; article: Article | null }
  const [ancestorChain, setAncestorChain] = useState<AncestorSlot[]>([]);

  useEffect(() => {
    const startId = (tapItem as any)?.replyToArticleId as string | null | undefined;
    if (!startId) {
      setAncestorChain([]);
      return;
    }
    let cancelled = false;
    setAncestorChain([{ id: startId, article: null }]);

    async function traverse(id: string) {
      if (cancelled) return;
      let article: Article | null = null;
      try {
        article = await queryClient.fetchQuery({
          queryKey: getGetArticleQueryKey(id),
          queryFn: () => getArticle(id),
          staleTime: 5 * 60 * 1000,
        }) as Article;
      } catch {
        return;
      }
      if (cancelled || !article) return;

      setAncestorChain((prev) => {
        const idx = prev.findIndex((s) => s.id === id);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { id, article };
        return next;
      });

      const nextId = (article as any).sourceArticleId as string | null | undefined;
      if (nextId && !cancelled) {
        setAncestorChain((prev) => [{ id: nextId, article: null }, ...prev]);
        await traverse(nextId);
      }
    }

    traverse(startId);
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(tapItem as any)?.replyToArticleId]);

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
                inboxItem?.sender?.nickname ??
                slot.article.authorNickname ??
                null,
              authorId: inboxItem?.sender?.id ?? inboxItem?.senderId ?? slot.article.authorId ?? null,
              collectionName: inboxItem?.collectionName ?? slot.article.collectionName ?? null,
              collectionId: inboxItem?.sourceTeamCollectionId ?? slot.article.collectionId ?? null,
              date: inboxItem?.visibleAt ?? slot.article.createdAt ?? null,
            }
          : {},
      );
    }

    const initIdx = artList.length; // tapped article goes here

    // Tapped article
    artList.push(tapItem.article);
    metaList.push({
      authorName: tapItem.sender?.nickname ?? tapItem.sender?.id ?? null,
      authorId: tapItem.sender?.id ?? tapItem.senderId ?? null,
      collectionName: tapItem.collectionName ?? tapItem.article?.collectionName ?? null,
      collectionId: tapItem.sourceTeamCollectionId ?? tapItem.article?.collectionId ?? null,
      date: tapItem.visibleAt ?? null,
    });

    // Descendants — recursively collected from all inbox data
    const allInboxItems = (inboxData as InboxItem[] | undefined) ?? [];
    const descendants = findAllDescendants(tapItem.articleId, allInboxItems);
    for (const desc of descendants) {
      if (!desc.article) continue;
      artList.push(desc.article);
      metaList.push({
        authorName: desc.sender?.nickname ?? desc.article.authorNickname ?? null,
        authorId: desc.sender?.id ?? desc.senderId ?? desc.article?.authorId ?? null,
        collectionName: desc.collectionName ?? desc.article.collectionName ?? null,
        collectionId: desc.sourceTeamCollectionId ?? desc.article?.collectionId ?? null,
        date: desc.visibleAt ?? desc.article.createdAt ?? null,
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PageHeader
        title="수신함"
        titleImage={require("@/assets/images/wordmark_maroon.png")}
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
          extraData={tapItem?.id ?? null}
          keyExtractor={groupKeyExtractor}
          renderItem={renderGroupItem}
          refreshControl={
            <RefreshControl refreshing={isManualRefreshing} onRefresh={handleRefresh} tintColor={Colors.zinc400} />
          }
          contentContainerStyle={[styles.listContent, { paddingBottom: navBottom }]}
          showsVerticalScrollIndicator={false}
          snapToInterval={GROUP_ITEM_H}
          snapToAlignment="start"
          decelerationRate="fast"
          getItemLayout={(_data, index) => ({
            length: GROUP_ITEM_H,
            offset: GROUP_ITEM_H * index,
            index,
          })}
        />
      )}

      <CardSelectOverlay
        articles={chainArticles}
        metas={chainMetas}
        initialIndex={chainInitialIndex}
        originLayout={tapItemOrigin}
        onClose={handleModalClose}
        onRead={handleRead}
        onNavigateToCollection={handleNavigateToCollection}
        onNavigateToAuthor={(authorId) => router.push(`/user-profile/${authorId}` as never)}
        envelopeInfo={
          tapItem && (tapItem as any).isEnvelope && !tapItem.openedAt
            ? {
                senderName: tapItem.sender?.nickname ?? tapItem.sender?.id ?? null,
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
  groupContainer: {
    marginBottom: 8,
  },
  dateHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingTop: Spacing.dateHeaderPt,
    paddingBottom: Spacing.dateHeaderPb,
    height: Sizing.dateHeaderH,
  },
  dateHeaderText: {
    ...Typography.dateHeader,
    color: Colors.zinc600,
  },
  dateHeaderCount: {
    ...Typography.caption,
    color: Colors.zinc400,
  },
  // Web carousel (PanResponder + Animated)
  carouselWindow: {
    width: SCREEN_W,
    height: CARD_H,
    overflow: "hidden",
  },
  carouselTrack: {
    flexDirection: "row",
    height: CARD_H,
  },
  // Native carousel (horizontal ScrollView)
  carouselScroll: {
    height: CARD_H,
  },
  carouselContent: {
    paddingHorizontal: CENTER_OFFSET,
  },
  cardSlot: {
    width: CARD_W,
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
