import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";

import ScalePressable from "@/components/shared/ScalePressable";
import { PageHeader } from "@/components/NavBar/PageHeader";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import CanonicalCardSlot from "@/components/ArticleCardItem/CanonicalCardSlot";
import { Colors, Spacing, Typography, Sizing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { useUser } from "@/contexts/UserContext";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetUser,
  useListArticles,
  useListSpaces,
  useListSendRecords,
  useListNeighbors,
  useListUserArticleReads,
  getGetUserQueryKey,
  getListArticlesQueryKey,
  getListSpacesQueryKey,
  getListSendRecordsQueryKey,
  getListNeighborsQueryKey,
  getListUserSpaceLettersQueryKey,
} from "@workspace/api-client-react";
import { isQueryStale } from "@/lib/useScreenFocused";
import { useSelectionScrollRestoration } from "@/hooks/useSelectionScrollRestoration";
import type { Article, SpaceListItem, SendRecordWithDetails } from "@workspace/api-client-react";
import { spaceStatusLabel, spaceStatusStyle } from "@/lib/spaceStatusStyle";
import type { OriginLayout } from "@/components/CardSelectOverlay/CardSelectOverlay";
import { useLetterSelectionOverlay } from "@/hooks/useLetterSelectionOverlay";
import { useAuth } from "@/contexts/AuthContext";
import {
  buildSentLetterSourceMetadataByArticleId,
  isSpaceSendRecord,
  shouldDisplaySentLetter,
} from "@/lib/sentLetterVisibility";

// getListUserArticleReadsQueryKey is not in the compiled dist types — define locally.
// Key shape mirrors packages/api-client-react/src/user-article-reads.ts.
const getListUserArticleReadsQueryKey = (params: { userId: string }) =>
  ["/api/user-article-reads", params] as const;


type MyTab = "letters" | "publications" | "spaces";

// Row types for the unified FlatList (avoids numColumns changes and header remount)
type LetterRowData = { _type: "lr"; items: Article[] };
type SpaceRowData = { _type: "sp"; item: SpaceListItem };
type MyListRow = LetterRowData | SpaceRowData;

const MY_TABS: { key: MyTab; label: string }[] = [
  { key: "letters", label: "편지" },
  { key: "publications", label: "간행물" },
  { key: "spaces", label: "공간" },
];

const GRID_PAD = 12;
const GRID_GAP = 4;
const GRID_COLS = 3;

export default function MyScreen() {
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const { userId } = useUser();
  const { isLoading: authIsLoading } = useAuth();
  const queryClient = useQueryClient();
  const { width: windowWidth } = useWindowDimensions();

  const [myTab, setMyTab] = useState<MyTab>("letters");

  // Shared "내 편지 선택 오버레이" hook.
  // cancelScrollRestorationRef breaks the hook-ordering cycle: the hook's
  // onBeforeRead calls it, but cancelScrollRestoration only becomes known
  // after useSelectionScrollRestoration runs below.
  const cancelScrollRestorationRef = useRef<(() => void) | null>(null);
  const { isOverlayActive, isSourceHidden, openLetterOverlay, renderLetterOverlay, spaceLetterByArticleId } =
    useLetterSelectionOverlay(userId, {
      onBeforeRead: () => cancelScrollRestorationRef.current?.(),
    });

  const userQuery = useGetUser(userId);
  const articlesQuery = useListArticles(
    { authorId: userId },
    { query: { enabled: !authIsLoading } },
  );
  const spacesQuery = useListSpaces({ userId });
  const sendRecordsQuery = useListSendRecords({ senderId: userId });
  const neighborsQuery = useListNeighbors({ userId });
  const userReadsQuery = useListUserArticleReads({ userId });

  const refetchUser = userQuery.refetch;
  const refetchArticles = articlesQuery.refetch;
  const refetchSpaces = spacesQuery.refetch;
  const refetchSendRecords = sendRecordsQuery.refetch;
  const refetchNeighbors = neighborsQuery.refetch;
  const refetchUserReads = userReadsQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      if (isQueryStale(queryClient, getGetUserQueryKey(userId))) {
        refetchUser();
      }
      if (isQueryStale(queryClient, getListArticlesQueryKey({ authorId: userId }))) {
        refetchArticles();
      }
      if (isQueryStale(queryClient, getListSpacesQueryKey({ userId }))) {
        refetchSpaces();
      }
      if (isQueryStale(queryClient, getListSendRecordsQueryKey({ senderId: userId }))) {
        refetchSendRecords();
      }
      if (isQueryStale(queryClient, getListNeighborsQueryKey({ userId }))) {
        refetchNeighbors();
      }
      if (isQueryStale(queryClient, getListUserArticleReadsQueryKey({ userId }))) {
        refetchUserReads();
      }
      // Safety net: ensure space letters (owned by useLetterSelectionOverlay) are
      // fresh when this tab is focused. Without this, a cached empty result from
      // an unauthenticated early fetch would persist across navigations.
      if (userId && isQueryStale(queryClient, getListUserSpaceLettersQueryKey(userId))) {
        void queryClient.refetchQueries({
          queryKey: getListUserSpaceLettersQueryKey(userId),
        });
      }
    }, [queryClient, userId, refetchUser, refetchArticles, refetchSpaces, refetchSendRecords, refetchNeighbors, refetchUserReads]),
  );

  const sendRecordByArticleId = useMemo(
    () =>
      buildSentLetterSourceMetadataByArticleId(
        (sendRecordsQuery.data ?? []) as SendRecordWithDetails[],
      ),
    [sendRecordsQuery.data],
  );

  const user = userQuery.data;
  const displayName = user?.nickname?.trim() || "이름 없음";
  const handle = user?.nickname?.trim() ? `@${user.nickname.trim()}` : "";

  // Total count of sent letters (regardless of visibility) — used in profile stats.
  const sentLetterCount = useMemo<number>(() => {
    return ((articlesQuery.data ?? []) as Article[]).filter(
      (a) => a.status === "LETTER" && sendRecordByArticleId[a.id] !== undefined,
    ).length;
  }, [articlesQuery.data, sendRecordByArticleId]);

  const nonSpaceSentArticleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const record of (sendRecordsQuery.data ?? []) as SendRecordWithDetails[]) {
      if (!isSpaceSendRecord(record)) ids.add(record.articleId);
    }
    return ids;
  }, [sendRecordsQuery.data]);

  const letters = useMemo<Article[]>(() => {
    // Person/reply sends have no SpaceLetter and remain visible. Only articles
    // sent exclusively to spaces depend on PUBLIC space-letter visibility.
    const list = ((articlesQuery.data ?? []) as Article[]).filter((a) => {
      if (a.status !== "LETTER") return false;
      if (sendRecordByArticleId[a.id] === undefined) return false;
      const sl = spaceLetterByArticleId.get(a.id);
      return shouldDisplaySentLetter(
        nonSpaceSentArticleIds.has(a.id),
        sl?.visibility,
      );
    });
    return [...list].sort((a, b) => {
      const slotA = sendRecordByArticleId[a.id]?.deliverySlot ?? "";
      const slotB = sendRecordByArticleId[b.id]?.deliverySlot ?? "";
      return slotB.localeCompare(slotA);
    });
  }, [articlesQuery.data, nonSpaceSentArticleIds, sendRecordByArticleId, spaceLetterByArticleId]);

  const spaces = useMemo<SpaceListItem[]>(() => {
    return ((spacesQuery.data ?? []) as SpaceListItem[]).filter(
      (s) => s.status !== "ARCHIVED",
    );
  }, [spacesQuery.data]);

  const neighborCount = (neighborsQuery.data ?? []).length;
  const readCount = (userReadsQuery.data ?? []).length;

  const cellWidth = Math.floor(
    (windowWidth - GRID_PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS,
  );

  const cellHeight = cellWidth * Sizing.cardRatio;

  const cardSlotRefs = useRef<Map<string, View | null>>(new Map());
  const myListRef = useRef<FlatList<MyListRow>>(null);
  const restoreMyScrollOffset = useCallback((offset: number) => {
    myListRef.current?.scrollToOffset({ offset, animated: false });
  }, []);
  const {
    handleScroll: handleSelectionScroll,
    captureScrollOffset,
    cancelScrollRestoration,
  } = useSelectionScrollRestoration(
    isOverlayActive,
    restoreMyScrollOffset,
  );
  // Wire cancelScrollRestoration into the hook's onBeforeRead without circular ordering.
  cancelScrollRestorationRef.current = cancelScrollRestoration;

  const handleLetterPress = useCallback(
    (article: Article) => {
      captureScrollOffset();
      const rec = sendRecordByArticleId[article.id];
      const slotRef = cardSlotRefs.current.get(article.id);
      const open = (origin: OriginLayout) => {
        openLetterOverlay(article, {
          fallbackOrigin: origin,
          meta: {
            collectionName: rec?.name ?? null,
             collectionId: rec?.collectionId ?? null,
            date: rec?.deliverySlot ?? null,
          },
          currentAuthorId: userId,
        });
      };
      if (slotRef) {
        slotRef.measureInWindow((x, y, w, h) => open({ x, y, width: w, height: h }));
      } else {
        open({ x: 0, y: 0, width: cellWidth, height: cellHeight });
      }
    },
    [cellWidth, cellHeight, sendRecordByArticleId, captureScrollOffset, openLetterOverlay, userId],
  );

  const handleSpacePress = useCallback(
    (space: SpaceListItem) => {
      router.push({ pathname: "/of-space-detail" as never, params: { id: space.id } });
    },
    [router],
  );


  const renderEmpty = useCallback(
    (message: string, subtitle?: string) => {
      const loading =
        authIsLoading ||
        (myTab === "letters" && articlesQuery.isLoading) ||
        (myTab === "spaces" && spacesQuery.isLoading);
      if (loading) {
        return (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>불러오는 중...</Text>
          </View>
        );
      }
      return (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>{message}</Text>
          {subtitle ? <Text style={styles.emptyText}>{subtitle}</Text> : null}
        </View>
      );
    },
    [myTab, authIsLoading, articlesQuery.isLoading, spacesQuery.isLoading],
  );

  const renderError = useCallback(
    (onRetry: () => void) => (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>편지를 불러오지 못했어요</Text>
        <ScalePressable
          style={styles.retryButton}
          contentStyle={styles.retryButtonContent}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="다시 시도"
        >
          <Text style={styles.retryButtonText}>다시 시도</Text>
        </ScalePressable>
      </View>
    ),
    [],
  );

  const contentPadding = useMemo(
    () => ({ paddingTop: 8, paddingBottom: navBottom + 24 }),
    [navBottom],
  );

  // Build a flat data array for the single unified FlatList.
  // Letters are chunked into rows of GRID_COLS so we never need to change
  // numColumns (which would force a FlatList remount and header flicker).
  const listData = useMemo<MyListRow[]>(() => {
    if (myTab === "letters") {
      const rows: LetterRowData[] = [];
      for (let i = 0; i < letters.length; i += GRID_COLS) {
        rows.push({ _type: "lr", items: letters.slice(i, i + GRID_COLS) });
      }
      return rows;
    }
    if (myTab === "spaces") {
      return spaces.map((item) => ({ _type: "sp" as const, item }));
    }
    return [];
  }, [myTab, letters, spaces]);

  const renderRow = useCallback(
    ({ item }: { item: MyListRow }) => {
      if (item._type === "lr") {
        return (
          <View style={styles.gridRow}>
            {item.items.map((article) => {
              const isHidden = isSourceHidden(article.id);
              const itemCollectionName =
                sendRecordByArticleId[article.id]?.name ?? null;
              return (
                <View
                  key={article.id}
                  ref={(ref) => {
                    cardSlotRefs.current.set(article.id, ref);
                  }}
                  style={[
                    styles.gridCell,
                    { width: cellWidth, opacity: isHidden ? 0 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={article.title || "제목 없음"}
                >
                  <CanonicalCardSlot width={cellWidth} height={cellHeight}>
                    <ArticleCardItem
                      title={article.title || "제목 없음"}
                      authorName={
                        article.authorNickname ?? user?.nickname ?? undefined
                      }
                      collectionName={itemCollectionName}
                      cover={article.cover}
                      isActive
                      onPress={() => handleLetterPress(article)}
                    />
                  </CanonicalCardSlot>
                </View>
              );
            })}
            {/* Filler views keep the last incomplete row left-aligned */}
            {Array.from({ length: GRID_COLS - item.items.length }).map(
              (_, i) => (
                <View key={`filler-${i}`} style={{ width: cellWidth }} />
              ),
            )}
          </View>
        );
      }
      // Space row
      const space = item.item;
      const statusStyle = spaceStatusStyle(space.status);
      const statusText = spaceStatusLabel(space.status);
      return (
        <ScalePressable
          style={styles.groupRow}
          contentStyle={styles.groupRowContent}
          onPress={() => handleSpacePress(space)}
          accessibilityRole="button"
          accessibilityLabel={space.name}
        >
          <View style={styles.groupIcon}>
            <Feather name="layers" size={20} color={Colors.zinc500} />
          </View>
          <View style={styles.groupTextWrap}>
            <Text style={styles.groupTitle} numberOfLines={1}>
              {space.name}
            </Text>
            <Text style={styles.groupMeta} numberOfLines={1}>
              참여자 {space.participantCount}명
            </Text>
          </View>
          <View
            style={[
              styles.groupTag,
              {
                backgroundColor: statusStyle.backgroundColor,
                borderColor: statusStyle.borderColor,
                borderWidth: statusStyle.borderWidth,
              },
            ]}
          >
            <Text
              style={[styles.groupTagText, { color: statusStyle.textColor }]}
            >
              {statusText}
            </Text>
          </View>
        </ScalePressable>
      );
    },
    [
      isSourceHidden,
      sendRecordByArticleId,
      cellWidth,
      cellHeight,
      user?.nickname,
      handleLetterPress,
      handleSpacePress,
    ],
  );

  const listEmpty =
    myTab === "letters"
      ? articlesQuery.isError
        ? renderError(() => articlesQuery.refetch())
        : renderEmpty("아직 보낸 편지가 없어요")
      : myTab === "spaces"
        ? renderEmpty("참여 중인 공간이 없어요")
        : renderEmpty("아직 비어있어요", "간행물 기능은 곧 만나볼 수 있어요");

  return (
    <View style={styles.container}>
      <FlatList
        ref={myListRef}
        data={listData as MyListRow[]}
        keyExtractor={(item, index) => {
          if (item._type === "lr") return `lr-${item.items[0]?.id ?? index}`;
          return `sp-${item.item.id}`;
        }}
        renderItem={renderRow}
        ListHeaderComponent={
          <View>
            <PageHeader
              title="마이"
              hideTitle
              showProfile
              onProfilePress={() => router.push("/mypage" as never)}
            />

            <View style={styles.profileSection} pointerEvents="none">
              {user?.avatarUrl ? (
                <Image
                  source={{ uri: user.avatarUrl }}
                  style={styles.avatar}
                />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Feather name="user" size={34} color={Colors.zinc500} />
                </View>
              )}
              <Text style={styles.profileName} numberOfLines={1}>
                {displayName}
              </Text>
              {handle ? (
                <Text style={styles.profileHandle} numberOfLines={1}>
                  {handle}
                </Text>
              ) : null}
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{sentLetterCount}</Text>
                <Text style={styles.statLabel}>발신한 편지</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{neighborCount}</Text>
                <Text style={styles.statLabel}>이웃</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{readCount}</Text>
                <Text style={styles.statLabel}>완독한 편지</Text>
              </View>
            </View>

            <View style={styles.actionRow}>
              <ScalePressable
                style={styles.actionButton}
                contentStyle={styles.actionButtonContent}
                onPress={() => router.push("/mypage-neighbors" as never)}
                accessibilityRole="button"
                accessibilityLabel="이웃 관리"
              >
                <Text style={styles.actionButtonText}>이웃 관리</Text>
              </ScalePressable>
              <ScalePressable
                style={styles.actionButton}
                contentStyle={styles.actionButtonContent}
                onPress={() => router.push("/activity" as never)}
                accessibilityRole="button"
                accessibilityLabel="프로필 관리"
              >
                <Text style={styles.actionButtonText}>프로필 관리</Text>
              </ScalePressable>
            </View>

            <View style={styles.subTabBar}>
              {MY_TABS.map((t) => {
                const active = myTab === t.key;
                return (
                  <ScalePressable
                    key={t.key}
                    style={styles.subTabItem}
                    contentStyle={styles.subTabItemContent}
                    onPress={() => setMyTab(t.key)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      style={[
                        styles.subTabText,
                        active && styles.subTabTextActive,
                      ]}
                      allowFontScaling={false}
                    >
                      {t.label}
                    </Text>
                    <View
                      style={[
                        styles.subTabUnderline,
                        active && styles.subTabUnderlineActive,
                      ]}
                    />
                  </ScalePressable>
                );
              })}
            </View>
          </View>
        }
        ListEmptyComponent={listEmpty}
        contentContainerStyle={contentPadding}
        showsVerticalScrollIndicator={false}
        onScroll={handleSelectionScroll}
        scrollEventThrottle={16}
        scrollEnabled={!isOverlayActive}
      />

      {renderLetterOverlay()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  profileSection: {
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 20,
    marginTop: -57,
  },
  avatar: {
    width: 78,
    height: 78,
    borderRadius: 39,
    marginBottom: 14,
    backgroundColor: Colors.zinc100,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  profileName: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
    letterSpacing: -0.5,
  },
  profileHandle: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 12,
    gap: 0,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  statNumber: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
    letterSpacing: -0.5,
  },
  statLabel: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    letterSpacing: -0.1,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.zinc100,
  },
  actionRow: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingBottom: 12,
    gap: 8,
  },
  actionButton: {
    flex: 1,
    height: 38,
  },
  actionButtonContent: {
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.white,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  actionButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc700,
    letterSpacing: -0.2,
  },
  subTabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
    paddingHorizontal: GRID_PAD,
    marginBottom: 8,
  },
  subTabItem: {
    flex: 1,
  },
  subTabItemContent: {
    alignItems: "center",
  },
  subTabText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    letterSpacing: -0.2,
    paddingVertical: 12,
  },
  subTabTextActive: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc900,
  },
  subTabUnderline: {
    height: 2,
    alignSelf: "stretch",
    backgroundColor: Colors.transparent,
    marginBottom: -1,
  },
  subTabUnderlineActive: {
    backgroundColor: Colors.zinc900,
  },
  gridContent: {
    paddingTop: 4,
  },
  gridRow: {
    flexDirection: "row",
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
    paddingHorizontal: GRID_PAD,
  },
  gridCell: {
    overflow: "hidden",
  },
  groupRow: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
  },
  groupRowContent: {
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  groupIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  groupTextWrap: {
    flex: 1,
    gap: 4,
  },
  groupTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
    letterSpacing: -0.3,
  },
  groupMeta: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  groupTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  groupTagOwner: {
    backgroundColor: Colors.noticeAccentSoft,
  },
  groupTagMember: {
    backgroundColor: Colors.zinc100,
  },
  groupTagText: {
    fontSize: 12,
    fontWeight: "600",
  },
  groupTagTextOwner: {
    color: Colors.noticeAccent,
  },
  groupTagTextMember: {
    color: Colors.zinc500,
  },
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 80,
    gap: 8,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc500,
  },
  emptyText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 4,
    height: 36,
    borderRadius: 10,
  },
  retryButtonContent: {
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.white,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  retryButtonText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc600,
    letterSpacing: -0.2,
  },
});
