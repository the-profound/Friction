import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useReaderTransition } from "@/contexts/ReaderTransitionContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ScalePressable from "@/components/shared/ScalePressable";
import { PageHeader } from "@/components/NavBar/PageHeader";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import CardSelectOverlay, { type ChainArticleMeta } from "@/components/CardSelectOverlay/CardSelectOverlay";
import { Colors, Spacing, Typography, Sizing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { useUser } from "@/contexts/UserContext";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetUser,
  useListArticles,
  useListTeamCollections,
  useListSendRecords,
  useListNeighbors,
  useListUserArticleReads,
  getArticle,
  getGetArticleQueryKey,
  getGetUserQueryKey,
  getListArticlesQueryKey,
  getListTeamCollectionsQueryKey,
  getListSendRecordsQueryKey,
  getListNeighborsQueryKey,
} from "@workspace/api-client-react";
import { isQueryStale } from "@/lib/useScreenFocused";
import type { Article, TeamCollectionWithRole, SendRecordWithDetails } from "@workspace/api-client-react";
import type { OriginLayout } from "@/components/CardSelectOverlay/CardSelectOverlay";

// getListUserArticleReadsQueryKey is not in the compiled dist types — define locally.
// Key shape mirrors packages/api-client-react/src/user-article-reads.ts.
const getListUserArticleReadsQueryKey = (params: { userId: string }) =>
  ["/api/user-article-reads", params] as const;


type MyTab = "letters" | "publications" | "groups";

const MY_TABS: { key: MyTab; label: string }[] = [
  { key: "letters", label: "편지" },
  { key: "publications", label: "간행물" },
  { key: "groups", label: "모임" },
];

const GRID_PAD = 12;
const GRID_GAP = 4;
const GRID_COLS = 3;

export default function MyScreen() {
  const { startFadeToBlack } = useReaderTransition();
  const insets = useSafeAreaInsets();
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const { width: windowWidth } = useWindowDimensions();

  const [myTab, setMyTab] = useState<MyTab>("letters");

  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [selectedOrigin, setSelectedOrigin] = useState<OriginLayout | null>(null);
  const [selectedCollectionName, setSelectedCollectionName] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [selectedDateOverride, setSelectedDateOverride] = useState<string | null>(null);

  const userQuery = useGetUser(userId);
  const articlesQuery = useListArticles({ authorId: userId });
  const teamsQuery = useListTeamCollections({ userId });
  const sendRecordsQuery = useListSendRecords({ senderId: userId });
  const neighborsQuery = useListNeighbors({ userId });
  const userReadsQuery = useListUserArticleReads({ userId });

  const refetchUser = userQuery.refetch;
  const refetchArticles = articlesQuery.refetch;
  const refetchTeams = teamsQuery.refetch;
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
      if (isQueryStale(queryClient, getListTeamCollectionsQueryKey({ userId }))) {
        refetchTeams();
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
    }, [queryClient, userId, refetchUser, refetchArticles, refetchTeams, refetchSendRecords, refetchNeighbors, refetchUserReads]),
  );

  const sendRecordByArticleId = useMemo<
    Record<string, { name: string | null; id: string | null; deliverySlot: string | null }>
  >(() => {
    const records = (sendRecordsQuery.data ?? []) as SendRecordWithDetails[];
    const map: Record<string, { name: string | null; id: string | null; deliverySlot: string | null }> = {};
    for (const r of records) {
      if (r.articleId) {
        map[r.articleId] = {
          name: r.collectionName ?? null,
          id: r.collectionId ?? null,
          deliverySlot: r.deliverySlot ?? null,
        };
      }
    }
    return map;
  }, [sendRecordsQuery.data]);

  const collectionNameByArticleId = useMemo<Record<string, string | null>>(() => {
    const result: Record<string, string | null> = {};
    for (const [articleId, rec] of Object.entries(sendRecordByArticleId)) {
      result[articleId] = rec.name;
    }
    return result;
  }, [sendRecordByArticleId]);

  const user = userQuery.data;
  const displayName = user?.nickname?.trim() || "이름 없음";
  const handle = user?.nickname?.trim() ? `@${user.nickname.trim()}` : "";

  const letters = useMemo<Article[]>(() => {
    const list = (articlesQuery.data ?? []).filter(
      (a) => a.status === "LETTER" && sendRecordByArticleId[a.id] !== undefined,
    );
    return [...list].sort((a, b) => {
      const slotA = sendRecordByArticleId[a.id]?.deliverySlot ?? "";
      const slotB = sendRecordByArticleId[b.id]?.deliverySlot ?? "";
      return slotB.localeCompare(slotA);
    });
  }, [articlesQuery.data, sendRecordByArticleId]);

  const teams = useMemo<TeamCollectionWithRole[]>(() => {
    return (teamsQuery.data ?? []) as TeamCollectionWithRole[];
  }, [teamsQuery.data]);

  const neighborCount = (neighborsQuery.data ?? []).length;
  const readCount = (userReadsQuery.data ?? []).length;
  const sentLetterCount = letters.length;

  const cellWidth = Math.floor(
    (windowWidth - GRID_PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS,
  );

  const cellHeight = Math.floor(cellWidth * Sizing.cardRatio);

  const cardSlotRefs = useRef<Map<string, View | null>>(new Map());

  const handleLetterPress = useCallback(
    (article: Article) => {
      const rec = sendRecordByArticleId[article.id];
      const colName = rec?.name ?? null;
      const colId = rec?.id ?? null;
      const deliverySlot = rec?.deliverySlot ?? null;
      const slotRef = cardSlotRefs.current.get(article.id);
      if (slotRef) {
        slotRef.measureInWindow((x, y, width, height) => {
          setSelectedOrigin({ x, y, width, height });
          setSelectedArticle(article);
          setSelectedCollectionName(colName);
          setSelectedCollectionId(colId);
          setSelectedDateOverride(deliverySlot);
        });
      } else {
        setSelectedOrigin({ x: 0, y: 0, width: cellWidth, height: cellHeight });
        setSelectedArticle(article);
        setSelectedCollectionName(colName);
        setSelectedCollectionId(colId);
        setSelectedDateOverride(deliverySlot);
      }
    },
    [cellWidth, cellHeight, sendRecordByArticleId],
  );

  const handleOverlayClose = useCallback(() => {
    setSelectedArticle(null);
    setSelectedOrigin(null);
    setSelectedCollectionName(null);
    setSelectedCollectionId(null);
    setSelectedDateOverride(null);
  }, []);

  const handleNavigateToCollection = useCallback(
    (id: string) => {
      router.push({ pathname: "/of-02-detail", params: { id } });
    },
    [router],
  );

  const handleNavigateToAuthor = useCallback(
    (id: string) => {
      router.push(`/user-profile/${id}` as never);
    },
    [router],
  );

  // ── Article chain for the My-tab overlay (recursive ancestor traversal) ──
  // Follow selectedArticle.sourceArticleId → Article.sourceArticleId → …
  // until null, collecting ancestors oldest→newest with skeleton placeholders.
  // Navigating to recipients' replies from the My tab is out of scope.

  interface ToAncestorSlot { id: string; article: Article | null }
  const [toAncestorChain, setToAncestorChain] = useState<ToAncestorSlot[]>([]);

  useEffect(() => {
    const startId = selectedArticle?.sourceArticleId;
    if (!startId) {
      setToAncestorChain([]);
      return;
    }
    let cancelled = false;
    setToAncestorChain([{ id: startId, article: null }]);

    const MAX_DEPTH = 20;

    async function bfsTraverse() {
      let currentIds = [startId as string];

      for (let depth = 0; depth < MAX_DEPTH && currentIds.length > 0; depth++) {
        if (cancelled) return;

        const results = await Promise.all(
          currentIds.map(async (id) => {
            try {
              return (await queryClient.fetchQuery({
                queryKey: getGetArticleQueryKey(id),
                queryFn: () => getArticle(id),
                staleTime: 5 * 60 * 1000,
              })) as Article;
            } catch {
              return null;
            }
          }),
        );

        if (cancelled) return;

        setToAncestorChain((prev) => {
          const next = [...prev];
          for (let i = 0; i < currentIds.length; i++) {
            const id = currentIds[i];
            const article = results[i];
            const idx = next.findIndex((s) => s.id === id);
            if (idx !== -1 && article) {
              next[idx] = { id, article };
            }
          }
          return next;
        });

        const nextIds: string[] = [];
        for (const article of results) {
          if (article) {
            const nextId = (article as any).sourceArticleId as string | null | undefined;
            if (nextId) nextIds.push(nextId);
          }
        }

        if (nextIds.length > 0 && !cancelled) {
          setToAncestorChain((prev) => [
            ...nextIds.map((id) => ({ id, article: null })),
            ...prev,
          ]);
        }

        currentIds = nextIds;
      }
    }

    bfsTraverse();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedArticle?.sourceArticleId]);

  const { toChainArticles, toChainMetas, toChainInitialIndex } = useMemo(() => {
    if (!selectedArticle) {
      return {
        toChainArticles: [] as (Article | null)[],
        toChainMetas: [] as ChainArticleMeta[],
        toChainInitialIndex: 0,
      };
    }

    const artList: (Article | null)[] = [];
    const metaList: ChainArticleMeta[] = [];

    // Ancestors — oldest first (toAncestorChain is ordered oldest→newest)
    for (const slot of toAncestorChain) {
      artList.push(slot.article);
      metaList.push(
        slot.article
          ? {
              authorName: slot.article.authorNickname ?? null,
              authorId: slot.article.authorId ?? null,
              collectionName: slot.article.collectionName ?? null,
              collectionId: slot.article.collectionId ?? null,
              date: slot.article.letterAt ?? slot.article.createdAt ?? null,
            }
          : {},
      );
    }

    const initIdx = artList.length; // selectedArticle goes here
    artList.push(selectedArticle);
    metaList.push({
      authorName: selectedArticle.authorNickname ?? user?.nickname ?? null,
      authorId: selectedArticle.authorId ?? null,
      collectionName: selectedCollectionName,
      collectionId: selectedCollectionId,
      date: selectedDateOverride,
    });

    return { toChainArticles: artList, toChainMetas: metaList, toChainInitialIndex: initIdx };
  }, [selectedArticle, toAncestorChain, selectedCollectionName, selectedCollectionId, selectedDateOverride, user?.nickname]);

  const handleOverlayRead = useCallback((chainIdx: number) => {
    const article = toChainArticles[chainIdx];
    if (!article) return; // still loading
    startFadeToBlack(() => {
      setSelectedArticle(null);
      setSelectedOrigin(null);
      setSelectedCollectionName(null);
      setSelectedCollectionId(null);
      setSelectedDateOverride(null);
      router.push({
        pathname: "/read" as never,
        params: { articleId: article.id, mode: "re_read" },
      });
    });
  }, [toChainArticles, startFadeToBlack, router]);

  const handleGroupPress = useCallback(
    (team: TeamCollectionWithRole) => {
      router.push({ pathname: "/of-02-detail", params: { id: team.id } });
    },
    [router],
  );


  const renderLetter = useCallback(
    ({ item }: { item: Article }) => {
      const isHidden = selectedArticle?.id === item.id;
      const itemCollectionName = collectionNameByArticleId[item.id] ?? null;
      return (
        <View
          ref={(ref) => { cardSlotRefs.current.set(item.id, ref); }}
          style={[styles.gridCell, { width: cellWidth, opacity: isHidden ? 0 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={item.title || "제목 없음"}
        >
          <ArticleCardItem
            title={item.title || "제목 없음"}
            authorName={item.authorNickname ?? user?.nickname ?? undefined}
            collectionName={itemCollectionName}
            cover={item.cover}
            cardWidth={cellWidth}
            isActive
            onPress={() => handleLetterPress(item)}
          />
        </View>
      );
    },
    [cellWidth, handleLetterPress, selectedArticle?.id, collectionNameByArticleId, user?.nickname],
  );

  const renderGroup = useCallback(
    ({ item }: { item: TeamCollectionWithRole }) => (
      <ScalePressable
        style={styles.groupRow}
        contentStyle={styles.groupRowContent}
        onPress={() => handleGroupPress(item)}
        accessibilityRole="button"
        accessibilityLabel={item.name}
      >
        <View style={styles.groupIcon}>
          <Feather name="share-2" size={20} color={Colors.zinc500} />
        </View>
        <View style={styles.groupTextWrap}>
          <Text style={styles.groupTitle} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.groupMeta} numberOfLines={1}>
            참여자 {item.memberCount ?? 0}명
          </Text>
        </View>
        <View
          style={[
            styles.groupTag,
            item.role === "OWNER" ? styles.groupTagOwner : styles.groupTagMember,
          ]}
        >
          <Text
            style={[
              styles.groupTagText,
              item.role === "OWNER"
                ? styles.groupTagTextOwner
                : styles.groupTagTextMember,
            ]}
          >
            {item.role === "OWNER" ? "소유자" : "멤버"}
          </Text>
        </View>
      </ScalePressable>
    ),
    [handleGroupPress],
  );

  const renderEmpty = useCallback(
    (message: string, subtitle?: string) => {
      const loading =
        (myTab === "letters" && articlesQuery.isLoading) ||
        (myTab === "groups" && teamsQuery.isLoading);
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
    [myTab, articlesQuery.isLoading, teamsQuery.isLoading],
  );

  const contentPadding = { paddingBottom: navBottom + 24 };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PageHeader
        title="마이"
        hideTitle
        showProfile
        onProfilePress={() => router.push("/mypage" as never)}
      />

      {/* Fixed header — lives outside FlatList so it never re-layouts on tab switch */}
      <View>
        <View style={styles.profileSection} pointerEvents="none">
          {user?.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
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
                  style={[styles.subTabText, active && styles.subTabTextActive]}
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

      {myTab === "letters" && (
        <FlatList
          key="my-letters"
          data={letters}
          keyExtractor={(item) => item.id}
          renderItem={renderLetter}
          numColumns={GRID_COLS}
          columnWrapperStyle={styles.gridRow}
          ListEmptyComponent={renderEmpty("아직 보낸 편지가 없어요")}
          contentContainerStyle={contentPadding}
          showsVerticalScrollIndicator={false}
        />
      )}
      {myTab === "groups" && (
        <FlatList
          key="my-groups"
          data={teams}
          keyExtractor={(item) => item.id}
          renderItem={renderGroup}
          ListEmptyComponent={renderEmpty(
            "참여 중인 모임이 없어요",
            "모임 탭에서 모임을 만들거나 참여해보세요",
          )}
          contentContainerStyle={contentPadding}
          showsVerticalScrollIndicator={false}
        />
      )}
      {myTab === "publications" && (
        <FlatList
          key="my-publications"
          data={[]}
          keyExtractor={() => "none"}
          renderItem={null}
          ListEmptyComponent={renderEmpty(
            "아직 비어있어요",
            "간행물 기능은 곧 만나볼 수 있어요",
          )}
          contentContainerStyle={contentPadding}
          showsVerticalScrollIndicator={false}
        />
      )}

      <CardSelectOverlay
        articles={toChainArticles}
        metas={toChainMetas}
        initialIndex={toChainInitialIndex}
        originLayout={selectedOrigin}
        onClose={handleOverlayClose}
        onRead={handleOverlayRead}
        onNavigateToCollection={handleNavigateToCollection}
        onNavigateToAuthor={handleNavigateToAuthor}
      />
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
    color: Colors.zinc400,
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
    fontSize: 11,
    color: Colors.zinc400,
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
    marginBottom: 12,
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
    color: Colors.zinc400,
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
    color: Colors.zinc400,
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
    fontSize: 11,
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
    color: Colors.zinc400,
    textAlign: "center",
    lineHeight: 20,
  },
});
