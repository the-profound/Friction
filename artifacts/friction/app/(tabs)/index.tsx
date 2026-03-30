import React, { useState, useCallback, useRef, useMemo } from "react";
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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import { PageHeader } from "@/components/NavBar/PageHeader";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import DotIndicator from "@/components/DotIndicator/DotIndicator";
import { useQueryClient } from "@tanstack/react-query";
import { useListInbox, useMarkInboxOpened } from "@workspace/api-client-react";
import type { InboxItem } from "@workspace/api-client-react";
import { useUser } from "@/contexts/UserContext";

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = Sizing.cardSlotW;
const CARD_GAP = Spacing.cardGap;
const SNAP_INTERVAL = CARD_W + CARD_GAP;

interface DateGroup {
  dateKey: string;
  label: string;
  items: InboxItem[];
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "어제";
  if (diffDays < 7) return `${diffDays}일 전`;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function groupByDate(items: InboxItem[]): DateGroup[] {
  const map = new Map<string, InboxItem[]>();
  const sorted = [...items].sort(
    (a, b) => new Date(b.visibleAt).getTime() - new Date(a.visibleAt).getTime(),
  );

  for (const item of sorted) {
    const d = new Date(item.visibleAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }

  return Array.from(map.entries()).map(([dateKey, groupItems]) => ({
    dateKey,
    label: formatDateLabel(groupItems[0].visibleAt),
    items: groupItems,
  }));
}

function CarouselGroup({
  group,
  onCardPress,
}: {
  group: DateGroup;
  onCardPress: (item: InboxItem) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<FlatList>(null);

  const handleScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      const x = event.nativeEvent.contentOffset.x;
      const idx = Math.round(x / SNAP_INTERVAL);
      setActiveIndex(Math.max(0, Math.min(idx, group.items.length - 1)));
    },
    [group.items.length],
  );

  return (
    <View style={styles.groupContainer}>
      <View style={styles.dateHeader}>
        <Text style={styles.dateHeaderText}>{group.label}</Text>
        <Text style={styles.dateHeaderCount}>{group.items.length}편</Text>
      </View>

      <FlatList
        ref={scrollRef}
        data={group.items}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled={false}
        snapToInterval={SNAP_INTERVAL}
        snapToAlignment="start"
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.carouselContent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        renderItem={({ item, index }) => (
          <View style={[styles.cardSlot, index < group.items.length - 1 && { marginRight: CARD_GAP }]}>
            <ArticleCardItem
              title={item.article?.title ?? "제목 없음"}
              onPress={() => onCardPress(item)}
              preview={item.article?.content?.substring(0, 80)}
              author={item.sender ? { name: item.sender.nickname ?? item.sender.id } : undefined}
              timestamp={new Date(item.visibleAt)}
              isRead={item.isRead}
              isActive={index === activeIndex}
            />
          </View>
        )}
      />

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

  const { data: inboxData, isLoading, refetch, isRefetching } = useListInbox({ recipientId: userId });
  const markOpened = useMarkInboxOpened();

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

  const groups = useMemo(() => groupByDate(filteredItems), [filteredItems]);

  const handleSearchPress = useCallback(() => {
    setSearchActive((prev) => {
      if (prev) setSearchQuery("");
      return !prev;
    });
  }, []);

  const handleCardPress = useCallback(
    async (item: InboxItem) => {
      if (!item.openedAt) {
        try {
          await markOpened.mutateAsync({ id: item.id });
          queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
        } catch (e: unknown) {
          console.warn("Failed to mark inbox opened:", e instanceof Error ? e.message : e);
        }
      }
      const mode = item.isRead ? "re_read" : "basic";
      router.push({
        pathname: "/read",
        params: {
          articleId: item.articleId,
          inboxId: item.id,
          mode,
        },
      });
    },
    [markOpened, router, queryClient],
  );

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

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
          snapToInterval={Sizing.groupH}
          snapToAlignment="start"
          decelerationRate="fast"
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
  carouselContent: {
    paddingHorizontal: (SCREEN_W - CARD_W) / 2,
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
