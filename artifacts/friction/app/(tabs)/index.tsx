import React, { useState, useRef, useMemo, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  RefreshControl,
  ScrollView,
  TextInput,
  Pressable,
  Platform,
  Animated,
  PanResponder,
  Alert,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import { PageHeader } from "@/components/NavBar/PageHeader";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import DotIndicator from "@/components/DotIndicator/DotIndicator";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import { useQueryClient } from "@tanstack/react-query";
import { useListInbox, useMarkInboxOpened, useDeleteInboxItem, getListInboxQueryKey } from "@workspace/api-client-react";
import type { InboxItem } from "@workspace/api-client-react";
import { useUser } from "@/contexts/UserContext";
import { INCOMING_FALLBACK_POLL_INTERVAL_MS, useFocusPollingOptions, isQueryStale } from "@/lib/useScreenFocused";
import { useRealtimeChannel } from "@/lib/useRealtimeChannel";

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = Sizing.cardSlotW;
const CARD_H = Sizing.cardH;
const CARD_GAP = Spacing.cardGap;
const CARD_PEEK = Spacing.cardPeek;
const SNAP_INTERVAL = CARD_W + CARD_GAP;
const SNAP_THRESHOLD = 48;
const FLING_VELOCITY = 0.5;
const GROUP_ITEM_H = Sizing.groupH + 8;

function getBaseX(idx: number) {
  return -(idx * SNAP_INTERVAL) + CARD_PEEK;
}

interface DateGroup {
  dateKey: string;
  label: string;
  items: InboxItem[];
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const AFTERNOON_HOUR_KST = 18;

function getSlotKey(visibleAt: string): string {
  const utcMs = new Date(visibleAt).getTime();
  const kstDate = new Date(utcMs + KST_OFFSET_MS);
  const yyyy = kstDate.getUTCFullYear();
  const mm = String(kstDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kstDate.getUTCDate()).padStart(2, "0");
  const slot = kstDate.getUTCHours() < AFTERNOON_HOUR_KST ? "am" : "pm";
  return `${yyyy}-${mm}-${dd}-${slot}`;
}

function formatSlotLabel(slotKey: string): string {
  const [yyyy, mm, dd, slot] = slotKey.split("-");
  const month = parseInt(mm, 10);
  const day = parseInt(dd, 10);
  const period = slot === "am" ? "오전" : "오후";
  return `${month}월 ${day}일 ${period}`;
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
    const datePart = dateKey.slice(0, 10);
    // Sort order within a group: notices → replies → regular letters.
    // Items in the same tier keep their original visibleAt order.
    const ordered = [...groupItems].sort((a, b) => {
      const aIsNoticeForKey =
        a.article?.isNotice === true && a.article?.noticeDate === datePart;
      const bIsNoticeForKey =
        b.article?.isNotice === true && b.article?.noticeDate === datePart;
      if (aIsNoticeForKey && !bIsNoticeForKey) return -1;
      if (!aIsNoticeForKey && bIsNoticeForKey) return 1;
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
}: {
  group: DateGroup;
  onCardPress: (item: InboxItem) => void;
}) {
  const itemCount = group.items.length;
  const [activeIndex, setActiveIndex] = useState(0);

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
  const cards = group.items.map((item, index) => (
    <View
      key={item.id}
      style={[
        styles.cardSlot,
        index < group.items.length - 1 && { marginRight: CARD_GAP },
      ]}
    >
      <ArticleCardItem
        title={item.article?.title ?? "제목 없음"}
        onPress={() => {
          // On web: block the click that fires after a mouse drag swipe
          if (Platform.OS === "web" && swipedRef.current) return;
          onCardPress(item);
        }}
        authorName={item.sender?.nickname ?? item.sender?.id}
        collectionName={item.collectionName}
        cover={item.article?.cover}
        isRead={item.isRead}
        isActive={index === activeIndex}
        noticeDate={
          item.article?.isNotice === true &&
          item.article?.noticeDate === group.dateKey.slice(0, 10)
            ? item.article.noticeDate
            : null
        }
        isReply={item.isReplyToMe === true}
      />
    </View>
  ));

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

export default function InboxScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId } = useUser();
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tapItem, setTapItem] = useState<InboxItem | null>(null);

  // Realtime subscription is the primary mechanism for surfacing freshly-
  // delivered letters — sub-second push without background HTTP traffic.
  // The slower focus-gated poll (60s) stays as a safety net for environments
  // where the realtime channel is unavailable. Both stop automatically when
  // the screen is blurred or unmounted.
  const pollOpts = useFocusPollingOptions(INCOMING_FALLBACK_POLL_INTERVAL_MS);
  const { data: inboxData, isLoading, refetch, isRefetching } = useListInbox(
    { recipientId: userId },
    pollOpts,
  );

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

  const handleCardPress = useCallback((item: InboxItem) => {
    setTapItem(item);
  }, []);

  const handleModalClose = useCallback(() => {
    setTapItem(null);
  }, []);

  const handleRead = useCallback(async () => {
    if (!tapItem) return;
    const item = tapItem;
    setTapItem(null);
    if (!item.openedAt) {
      try {
        await markOpened.mutateAsync({ id: item.id });
        queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
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
  }, [tapItem, markOpened, router, queryClient]);

  const handleDelete = useCallback(async () => {
    if (!tapItem) return;
    const item = tapItem;
    setTapItem(null);
    try {
      await deleteInboxItem.mutateAsync({ id: item.id });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
Alert.alert("완료", "수신함에서 삭제되었습니다.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "삭제에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [tapItem, deleteInboxItem, queryClient]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  // Refetch the inbox when this tab regains focus ONLY if the cached data
  // is stale (older than FOCUS_STALE_THRESHOLD_MS / the global staleTime).
  // Skipping the refetch when data is fresh avoids the full-screen loading
  // spinner and scroll-position jump that users see on quick tab switches.
  // Realtime + 60 s polling handle near-instant updates while focused.
  const refetchInbox = refetch;
  useFocusEffect(
    useCallback(() => {
      if (isQueryStale(queryClient, getListInboxQueryKey({ recipientId: userId }))) {
        refetchInbox();
      }
    }, [refetchInbox, queryClient, userId]),
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PageHeader
        title="수신함"
        showSearch
        onSearchPress={handleSearchPress}
        searchActive={searchActive}
      />

      {searchActive && (
        <View style={styles.searchBar}>
          <Feather name="search" size={Sizing.searchBarIconSize} color={Colors.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="제목, 이웃 이름으로 검색"
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

      {isLoading ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>불러오는 중...</Text>
        </View>
      ) : groups.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
        >
          <Feather name="inbox" size={48} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>수신함이 비어 있어요</Text>
          <Text style={styles.emptyText}>이웃이 보낸 편지가 도착하면 여기에 표시됩니다</Text>
        </ScrollView>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(group) => group.dateKey}
          renderItem={({ item: group }) => (
            <CarouselGroup group={group} onCardPress={handleCardPress} />
          )}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor={Colors.zinc400} />
          }
          contentContainerStyle={styles.listContent}
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

      <ConfirmModal
        visible={tapItem !== null}
        title={tapItem?.article?.title ?? "제목 없음"}
        description={tapItem?.sender?.nickname ?? tapItem?.sender?.id ?? ""}
        onCancel={handleModalClose}
        actionButton={{
          emoji: "📖",
          label: "읽기",
          onPress: handleRead,
        }}
        deleteButton={{
          onPress: handleDelete,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.searchBarBg,
    marginHorizontal: Spacing.screenPx,
    borderRadius: Sizing.searchBarHeight / 2,
    height: Sizing.searchBarHeight,
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    ...Typography.searchInput,
    color: Colors.searchText,
    padding: 0,
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
    paddingLeft: CARD_PEEK,
    paddingRight: CARD_PEEK,
  },
  cardSlot: {
    width: CARD_W,
  },
  emptyContainer: {
    flex: 1,
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
