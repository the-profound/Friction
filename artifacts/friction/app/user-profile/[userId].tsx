import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  Alert,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ScalePressable from "@/components/shared/ScalePressable";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import CardSelectOverlay, { type ChainArticleMeta } from "@/components/CardSelectOverlay/CardSelectOverlay";
import { Colors, Spacing, Typography, Sizing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { useUser } from "@/contexts/UserContext";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  useGetUser,
  useListArticles,
  useListTeamCollections,
  useListSendRecords,
  useListNeighbors,
  useListNeighborRequests,
  useCreateNeighborRequest,
  useRemoveNeighbor,
  getArticle,
  getGetArticleQueryKey,
} from "@workspace/api-client-react";
import type {
  Article,
  TeamCollectionWithRole,
  SendRecordWithDetails,
  NeighborWithUser,
  NeighborRequestWithUser,
} from "@workspace/api-client-react";
import type { OriginLayout } from "@/components/CardSelectOverlay/CardSelectOverlay";

type ProfileTab = "letters" | "publications" | "groups";

const PROFILE_TABS: { key: ProfileTab; label: string }[] = [
  { key: "letters", label: "편지" },
  { key: "publications", label: "간행물" },
  { key: "groups", label: "모임" },
];

const GRID_PAD = 12;
const GRID_GAP = 4;
const GRID_COLS = 3;

export default function UserProfileScreen() {
  const insets = useSafeAreaInsets();
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const { userId: currentUserId } = useUser();
  const { userId: profileUserId } = useLocalSearchParams<{ userId: string }>();
  const queryClient = useQueryClient();
  const { width: windowWidth } = useWindowDimensions();

  const [profileTab, setProfileTab] = useState<ProfileTab>("letters");
  const [removeConfirmVisible, setRemoveConfirmVisible] = useState(false);

  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [selectedOrigin, setSelectedOrigin] = useState<OriginLayout | null>(null);
  const [selectedCollectionName, setSelectedCollectionName] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [selectedDateOverride, setSelectedDateOverride] = useState<string | null>(null);

  const userQuery = useGetUser(profileUserId ?? "");
  const articlesQuery = useListArticles({ authorId: profileUserId });
  const teamsQuery = useListTeamCollections({ userId: profileUserId });
  const sendRecordsQuery = useListSendRecords({ senderId: profileUserId });
  const neighborsQuery = useListNeighbors({ userId: currentUserId });
  const sentRequestsQuery = useListNeighborRequests({ requesterId: currentUserId });

  const createNeighborRequest = useCreateNeighborRequest();
  const removeNeighbor = useRemoveNeighbor();
  const [optimisticPending, setOptimisticPending] = useState(false);

  const refetchArticles = articlesQuery.refetch;
  const refetchTeams = teamsQuery.refetch;
  const refetchSendRecords = sendRecordsQuery.refetch;
  const refetchNeighbors = neighborsQuery.refetch;
  const refetchSentRequests = sentRequestsQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      refetchArticles();
      refetchTeams();
      refetchSendRecords();
      refetchNeighbors();
      refetchSentRequests();
    }, [refetchArticles, refetchTeams, refetchSendRecords, refetchNeighbors, refetchSentRequests]),
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

  // ── Neighbor relationship state ───────────────────────────────────────────
  const existingNeighbor = useMemo<NeighborWithUser | null>(() => {
    const list = (neighborsQuery.data ?? []) as NeighborWithUser[];
    return list.find((n) => n.neighborUserId === profileUserId) ?? null;
  }, [neighborsQuery.data, profileUserId]);

  const isNeighbor = !!existingNeighbor;

  const isPending = useMemo(() => {
    if (optimisticPending) return true;
    const list = (sentRequestsQuery.data ?? []) as NeighborRequestWithUser[];
    return list.some((r) => r.recipientId === profileUserId);
  }, [sentRequestsQuery.data, profileUserId, optimisticPending]);

  useEffect(() => {
    // Clear the optimistic flag once the server-side request is confirmed
    // (so we don't keep showing pending after the relationship resolves).
    if (!optimisticPending) return;
    const list = (sentRequestsQuery.data ?? []) as NeighborRequestWithUser[];
    if (list.some((r) => r.recipientId === profileUserId) || existingNeighbor) {
      setOptimisticPending(false);
    }
  }, [sentRequestsQuery.data, profileUserId, existingNeighbor, optimisticPending]);

  const handleSendNeighborRequest = useCallback(async () => {
    if (!profileUserId || createNeighborRequest.isPending) return;
    setOptimisticPending(true);
    try {
      await createNeighborRequest.mutateAsync({
        data: { requesterId: currentUserId, recipientId: profileUserId },
      });
      sentRequestsQuery.refetch();
      Alert.alert("완료", "이웃 요청을 보냈어요!");
    } catch (e: unknown) {
      const isDuplicate =
        e instanceof ApiError &&
        typeof e.data === "object" &&
        e.data !== null &&
        "error" in e.data &&
        ((e.data as { error?: string }).error === "Already neighbors" ||
          (e.data as { error?: string }).error === "Request already exists");
      if (isDuplicate) {
        sentRequestsQuery.refetch();
        neighborsQuery.refetch();
      } else {
        setOptimisticPending(false);
        const msg = e instanceof Error ? e.message : "요청에 실패했습니다.";
        Alert.alert("오류", msg);
      }
    }
  }, [profileUserId, currentUserId, createNeighborRequest, sentRequestsQuery, neighborsQuery]);

  const handleRemoveNeighborConfirm = useCallback(async () => {
    if (!existingNeighbor || removeNeighbor.isPending) return;
    setRemoveConfirmVisible(false);
    try {
      await removeNeighbor.mutateAsync({ id: existingNeighbor.id });
      neighborsQuery.refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "삭제에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [existingNeighbor, removeNeighbor, neighborsQuery]);

  const handleSendLetter = useCallback(() => {
    if (!profileUserId) return;
    router.push({ pathname: "/to-send", params: { neighborId: profileUserId } });
  }, [router, profileUserId]);

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

  // ── Article chain for the overlay (recursive ancestor traversal) ──────────
  interface AncestorSlot { id: string; article: Article | null }
  const [ancestorChain, setAncestorChain] = useState<AncestorSlot[]>([]);

  useEffect(() => {
    const startId = selectedArticle?.sourceArticleId;
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
  }, [selectedArticle?.sourceArticleId]);

  const { chainArticles, chainMetas, chainInitialIndex } = useMemo(() => {
    if (!selectedArticle) {
      return {
        chainArticles: [] as (Article | null)[],
        chainMetas: [] as ChainArticleMeta[],
        chainInitialIndex: 0,
      };
    }

    const artList: (Article | null)[] = [];
    const metaList: ChainArticleMeta[] = [];

    for (const slot of ancestorChain) {
      artList.push(slot.article);
      metaList.push(
        slot.article
          ? {
              authorName: (slot.article as any).authorNickname ?? null,
              collectionName: null,
              collectionId: null,
              date: slot.article.letterAt ?? null,
              isNotice: (slot.article as any).isNotice ?? false,
            }
          : {},
      );
    }

    const initIdx = artList.length;
    artList.push(selectedArticle);
    metaList.push({
      authorName: (selectedArticle as any).authorNickname ?? user?.nickname ?? null,
      collectionName: selectedCollectionName,
      collectionId: selectedCollectionId,
      date: selectedDateOverride,
      isNotice: (selectedArticle as any).isNotice ?? false,
    });

    return { chainArticles: artList, chainMetas: metaList, chainInitialIndex: initIdx };
  }, [selectedArticle, ancestorChain, selectedCollectionName, selectedCollectionId, selectedDateOverride, user?.nickname]);

  const handleOverlayRead = useCallback((chainIdx: number) => {
    const article = chainArticles[chainIdx];
    if (!article) return;
    setSelectedArticle(null);
    setSelectedOrigin(null);
    setSelectedCollectionName(null);
    setSelectedCollectionId(null);
    setSelectedDateOverride(null);
    router.push({
      pathname: "/read" as never,
      params: { articleId: article.id, mode: "re_read" },
    });
  }, [chainArticles, router]);

  const handleGroupPress = useCallback(
    (team: TeamCollectionWithRole) => {
      router.push({ pathname: "/of-02-detail", params: { id: team.id } });
    },
    [router],
  );

  const ListHeader = useMemo(
    () => (
      <View>
        <View style={styles.profileSection}>
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

        <View style={styles.actionRow}>
          {isNeighbor ? (
            <ScalePressable
              style={styles.actionButton}
              contentStyle={styles.actionButtonContent}
              onPress={() => setRemoveConfirmVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="이웃 맺음"
            >
              <Text style={styles.actionButtonText}>이웃 맺음</Text>
            </ScalePressable>
          ) : isPending ? (
            <View style={[styles.actionButton, styles.actionButtonDisabled, styles.actionButtonContent]}>
              <Text style={[styles.actionButtonText, { color: Colors.zinc400 }]}>요청 중</Text>
            </View>
          ) : (
            <ScalePressable
              style={styles.actionButton}
              contentStyle={styles.actionButtonContent}
              onPress={handleSendNeighborRequest}
              disabled={createNeighborRequest.isPending}
              accessibilityRole="button"
              accessibilityLabel="이웃 요청"
            >
              <Text style={styles.actionButtonText}>이웃 요청</Text>
            </ScalePressable>
          )}
          <ScalePressable
            style={styles.actionButton}
            contentStyle={styles.actionButtonContent}
            onPress={handleSendLetter}
            accessibilityRole="button"
            accessibilityLabel="편지 발신"
          >
            <Text style={styles.actionButtonText}>편지 발신</Text>
          </ScalePressable>
        </View>

        <View style={styles.subTabBar}>
          {PROFILE_TABS.map((t) => {
            const active = profileTab === t.key;
            return (
              <ScalePressable
                key={t.key}
                style={styles.subTabItem}
                contentStyle={styles.subTabItemContent}
                onPress={() => setProfileTab(t.key)}
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
    ),
    [
      user?.avatarUrl,
      displayName,
      handle,
      profileTab,
      isNeighbor,
      isPending,
      createNeighborRequest.isPending,
      handleSendNeighborRequest,
      handleSendLetter,
    ],
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
        (profileTab === "letters" && articlesQuery.isLoading) ||
        (profileTab === "groups" && teamsQuery.isLoading);
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
    [profileTab, articlesQuery.isLoading, teamsQuery.isLoading],
  );

  const contentPadding = { paddingBottom: navBottom + 24 };

  const Header = (
    <View style={styles.header}>
      <ScalePressable onPress={() => router.back()} hitSlop={12}>
        <Feather name="arrow-left" size={20} color={Colors.zinc600} />
      </ScalePressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {displayName}
      </Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  if (!profileUserId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {Header}
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>사용자를 찾을 수 없어요</Text>
        </View>
      </View>
    );
  }

  if (profileTab === "letters") {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {Header}
        <FlatList
          key="profile-letters"
          data={letters}
          keyExtractor={(item) => item.id}
          renderItem={renderLetter}
          numColumns={GRID_COLS}
          columnWrapperStyle={styles.gridRow}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={renderEmpty("아직 보낸 편지가 없어요")}
          contentContainerStyle={[styles.gridContent, contentPadding]}
          showsVerticalScrollIndicator={false}
        />
        <CardSelectOverlay
          articles={chainArticles}
          metas={chainMetas}
          initialIndex={chainInitialIndex}
          originLayout={selectedOrigin}
          onClose={handleOverlayClose}
          onRead={handleOverlayRead}
          onNavigateToCollection={handleNavigateToCollection}
        />
        <ConfirmModal
          visible={removeConfirmVisible}
          title="이웃 삭제"
          description={`'${displayName}'님과의 이웃 관계를 해제하시겠어요?`}
          confirmLabel="해제"
          cancelLabel="취소"
          destructive
          onConfirm={handleRemoveNeighborConfirm}
          onCancel={() => setRemoveConfirmVisible(false)}
        />
      </View>
    );
  }

  if (profileTab === "groups") {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {Header}
        <FlatList
          key="profile-groups"
          data={teams}
          keyExtractor={(item) => item.id}
          renderItem={renderGroup}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={renderEmpty(
            "참여 중인 모임이 없어요",
          )}
          contentContainerStyle={contentPadding}
          showsVerticalScrollIndicator={false}
        />
        <ConfirmModal
          visible={removeConfirmVisible}
          title="이웃 삭제"
          description={`'${displayName}'님과의 이웃 관계를 해제하시겠어요?`}
          confirmLabel="해제"
          cancelLabel="취소"
          destructive
          onConfirm={handleRemoveNeighborConfirm}
          onCancel={() => setRemoveConfirmVisible(false)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {Header}
      <FlatList
        key="profile-publications"
        data={[]}
        keyExtractor={() => "none"}
        renderItem={null}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={renderEmpty(
          "아직 비어있어요",
          "간행물 기능은 곧 만나볼 수 있어요",
        )}
        contentContainerStyle={contentPadding}
        showsVerticalScrollIndicator={false}
      />
      <ConfirmModal
        visible={removeConfirmVisible}
        title="이웃 삭제"
        description={`'${displayName}'님과의 이웃 관계를 해제하시겠어요?`}
        confirmLabel="해제"
        cancelLabel="취소"
        destructive
        onConfirm={handleRemoveNeighborConfirm}
        onCancel={() => setRemoveConfirmVisible(false)}
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
    flex: 1,
    textAlign: "center",
    marginHorizontal: 8,
  },
  headerSpacer: {
    width: 20,
  },
  profileSection: {
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 20,
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
  actionRow: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingBottom: 12,
    gap: 8,
  },
  actionButton: {
    flex: 1,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.white,
  },
  actionButtonDisabled: {
    backgroundColor: Colors.zinc50,
  },
  actionButtonContent: {
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
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
  },
  groupRowContent: {
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
