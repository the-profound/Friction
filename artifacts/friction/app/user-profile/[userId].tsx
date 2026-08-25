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
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ScalePressable from "@/components/shared/ScalePressable";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import CanonicalCardSlot from "@/components/ArticleCardItem/CanonicalCardSlot";
import CardSelectOverlay, { type ChainArticleMeta } from "@/components/CardSelectOverlay/CardSelectOverlay";
import { useAncestorChain } from "@/hooks/useAncestorChain";
import { Colors, Spacing, Typography, Sizing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { useToast } from "@/contexts/ToastContext";
import { useUser } from "@/contexts/UserContext";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  useGetUser,
  useListArticles,
  useListSpaces,
  useListSendRecords,
  useListNeighbors,
  useListNeighborRequests,
  useCreateNeighborRequest,
  useDeleteNeighborRequest,
  useRemoveNeighbor,
} from "@workspace/api-client-react";
import type {
  Article,
  SpaceListItem,
  SendRecordWithDetails,
  NeighborWithUser,
  NeighborRequestWithUser,
} from "@workspace/api-client-react";
import { spaceStatusLabel, spaceStatusStyle } from "@/lib/spaceStatusStyle";
import type { OriginLayout } from "@/components/CardSelectOverlay/CardSelectOverlay";

type ProfileTab = "letters" | "publications" | "spaces";

// Row types for the unified FlatList (avoids numColumns changes and header remount)
type LetterRowData = { _type: "lr"; items: Article[] };
type SpaceRowData = { _type: "sp"; item: SpaceListItem };
type ProfileListRow = LetterRowData | SpaceRowData;

const PROFILE_TABS: { key: ProfileTab; label: string }[] = [
  { key: "letters", label: "편지" },
  { key: "publications", label: "간행물" },
  { key: "spaces", label: "공간" },
];

const GRID_PAD = 12;
const GRID_GAP = 4;
const GRID_COLS = 3;

export default function UserProfileScreen() {
  const insets = useSafeAreaInsets();
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const { userId: currentUserId } = useUser();
  const { showToast } = useToast();
  const { userId: profileUserId } = useLocalSearchParams<{ userId: string }>();
  const queryClient = useQueryClient();
  const { width: windowWidth } = useWindowDimensions();

  const [profileTab, setProfileTab] = useState<ProfileTab>("letters");
  const [removeConfirmVisible, setRemoveConfirmVisible] = useState(false);

  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [selectedOrigin, setSelectedOrigin] = useState<OriginLayout | null>(null);
  const [isSelectedSourceHidden, setIsSelectedSourceHidden] = useState(false);
  const [selectedCollectionName, setSelectedCollectionName] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [selectedDateOverride, setSelectedDateOverride] = useState<string | null>(null);

  const userQuery = useGetUser(profileUserId ?? "");
  const articlesQuery = useListArticles({ authorId: profileUserId });
  const spacesQuery = useListSpaces({ userId: profileUserId });
  const sendRecordsQuery = useListSendRecords({ senderId: profileUserId });
  const neighborsQuery = useListNeighbors({ userId: currentUserId });
  const sentRequestsQuery = useListNeighborRequests({ requesterId: currentUserId });

  const createNeighborRequest = useCreateNeighborRequest();
  const deleteNeighborRequest = useDeleteNeighborRequest();
  const removeNeighbor = useRemoveNeighbor();
  const [optimisticPending, setOptimisticPending] = useState(false);
  const [cancelConfirmVisible, setCancelConfirmVisible] = useState(false);

  const refetchArticles = articlesQuery.refetch;
  const refetchSpaces = spacesQuery.refetch;
  const refetchSendRecords = sendRecordsQuery.refetch;
  const refetchNeighbors = neighborsQuery.refetch;
  const refetchSentRequests = sentRequestsQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      refetchArticles();
      refetchSpaces();
      refetchSendRecords();
      refetchNeighbors();
      refetchSentRequests();
    }, [refetchArticles, refetchSpaces, refetchSendRecords, refetchNeighbors, refetchSentRequests]),
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

  const spaces = useMemo<SpaceListItem[]>(() => {
    return ((spacesQuery.data ?? []) as SpaceListItem[]).filter(
      (s) => s.status !== "ARCHIVED",
    );
  }, [spacesQuery.data]);

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

  const pendingRequestId = useMemo<string | null>(() => {
    const list = (sentRequestsQuery.data ?? []) as NeighborRequestWithUser[];
    return list.find((r) => r.recipientId === profileUserId)?.id ?? null;
  }, [sentRequestsQuery.data, profileUserId]);

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
      showToast({ message: "이웃 요청을 보냈어요!", type: "success" });
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
        showToast({ message: msg, type: "error" });
      }
    }
  }, [profileUserId, currentUserId, createNeighborRequest, sentRequestsQuery, neighborsQuery, showToast]);

  const handleCancelNeighborRequest = useCallback(async () => {
    if (!pendingRequestId || deleteNeighborRequest.isPending) return;
    setCancelConfirmVisible(false);
    try {
      await deleteNeighborRequest.mutateAsync({ id: pendingRequestId });
      setOptimisticPending(false);
      sentRequestsQuery.refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "취소에 실패했습니다.";
      showToast({ message: msg, type: "error" });
    }
  }, [pendingRequestId, deleteNeighborRequest, sentRequestsQuery, showToast]);

  const handleRemoveNeighborConfirm = useCallback(async () => {
    if (!existingNeighbor || removeNeighbor.isPending) return;
    setRemoveConfirmVisible(false);
    try {
      await removeNeighbor.mutateAsync({ id: existingNeighbor.id });
      neighborsQuery.refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "삭제에 실패했습니다.";
      showToast({ message: msg, type: "error" });
    }
  }, [existingNeighbor, removeNeighbor, neighborsQuery, showToast]);

  const handleSendLetter = useCallback(() => {
    if (!profileUserId) return;
    router.push({ pathname: "/to-send", params: { neighborId: profileUserId } });
  }, [router, profileUserId]);

  const cellWidth = Math.floor(
    (windowWidth - GRID_PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS,
  );

  const cellHeight = cellWidth * Sizing.cardRatio;

  const cardSlotRefs = useRef<Map<string, View | null>>(new Map());

  const handleLetterPress = useCallback(
    (article: Article) => {
      setIsSelectedSourceHidden(false);
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
    setIsSelectedSourceHidden(false);
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

  // ── Article chain for the overlay (shared 편지 선택 모드 traversal) ────────
  const ancestorChain = useAncestorChain(selectedArticle?.sourceArticleId, queryClient);

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
              authorId: slot.article.authorId ?? null,
              collectionName: slot.article.collectionName ?? null,
              collectionId: slot.article.collectionId ?? null,
              date: slot.article.letterAt ?? null,
            }
          : {},
      );
    }

    const initIdx = artList.length;
    artList.push(selectedArticle);
    metaList.push({
      authorName: selectedArticle.authorNickname ?? user?.nickname ?? null,
      authorId: selectedArticle.authorId ?? null,
      collectionName: selectedCollectionName,
      collectionId: selectedCollectionId,
      date: selectedDateOverride,
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

  const handleSpacePress = useCallback(
    (space: SpaceListItem) => {
      router.push({ pathname: "/of-space-detail" as never, params: { id: space.id } });
    },
    [router],
  );


  const renderEmpty = useCallback(
    (message: string, subtitle?: string) => {
      const loading =
        (profileTab === "letters" && articlesQuery.isLoading) ||
        (profileTab === "spaces" && spacesQuery.isLoading);
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
    [profileTab, articlesQuery.isLoading, spacesQuery.isLoading],
  );

  const contentPadding = useMemo(
    () => ({ paddingTop: 8, paddingBottom: navBottom + 24 }),
    [navBottom],
  );

  // Build a flat data array for the single unified FlatList.
  // Letters are chunked into rows of GRID_COLS so we never need to change
  // numColumns (which would force a FlatList remount and header flicker).
  const listData = useMemo<ProfileListRow[]>(() => {
    if (profileTab === "letters") {
      const rows: LetterRowData[] = [];
      for (let i = 0; i < letters.length; i += GRID_COLS) {
        rows.push({ _type: "lr", items: letters.slice(i, i + GRID_COLS) });
      }
      return rows;
    }
    if (profileTab === "spaces") {
      return spaces.map((item) => ({ _type: "sp" as const, item }));
    }
    return [];
  }, [profileTab, letters, spaces]);

  const renderRow = useCallback(
    ({ item }: { item: ProfileListRow }) => {
      if (item._type === "lr") {
        return (
          <View style={styles.gridRow}>
            {item.items.map((article) => {
              const isHidden =
                isSelectedSourceHidden && selectedArticle?.id === article.id;
              const itemCollectionName =
                collectionNameByArticleId[article.id] ?? null;
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
      selectedArticle?.id,
      isSelectedSourceHidden,
      collectionNameByArticleId,
      cellWidth,
      cellHeight,
      user?.nickname,
      handleLetterPress,
      handleSpacePress,
    ],
  );

  const listEmpty =
    profileTab === "letters"
      ? renderEmpty("아직 보낸 편지가 없어요")
      : profileTab === "spaces"
        ? renderEmpty("참여 중인 공간이 없어요")
        : renderEmpty("아직 비어있어요", "간행물 기능은 곧 만나볼 수 있어요");

  // Shared back-button header JSX used in both the error state and the FlatList
  const navHeaderJsx = (
    <View style={styles.header}>
      <ScalePressable onPress={() => router.back()} hitSlop={12}>
        <Feather name="arrow-left" size={20} color={Colors.zinc600} />
      </ScalePressable>
    </View>
  );

  if (!profileUserId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {navHeaderJsx}
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>사용자를 찾을 수 없어요</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={listData as ProfileListRow[]}
        keyExtractor={(item, index) => {
          if (item._type === "lr") return `lr-${item.items[0]?.id ?? index}`;
          return `sp-${item.item.id}`;
        }}
        renderItem={renderRow}
        ListHeaderComponent={
          <View>
            {/* Top safe-area padding lives here so the background colour
                shows behind the notch while content still scrolls under it */}
            <View style={{ paddingTop: insets.top }}>
              {navHeaderJsx}
            </View>

            <View style={styles.profileSection}>
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
                <ScalePressable
                  style={styles.actionButton}
                  contentStyle={styles.actionButtonContent}
                  onPress={() => setCancelConfirmVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="이웃 신청 취소"
                >
                  <Text style={styles.actionButtonText}>이웃 신청 취소</Text>
                </ScalePressable>
              ) : (
                <ScalePressable
                  style={styles.actionButton}
                  contentStyle={styles.actionButtonContent}
                  onPress={handleSendNeighborRequest}
                  disabled={createNeighborRequest.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="이웃 신청"
                >
                  <Text style={styles.actionButtonText}>이웃 신청</Text>
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
      />

      <CardSelectOverlay
        articles={chainArticles}
        metas={chainMetas}
        initialIndex={chainInitialIndex}
        originLayout={selectedOrigin}
        onClose={handleOverlayClose}
        onRead={handleOverlayRead}
        onReady={() => setIsSelectedSourceHidden(true)}
        onNavigateToCollection={handleNavigateToCollection}
        onNavigateToAuthor={(id) => router.push(`/user-profile/${id}` as never)}
        currentAuthorId={profileUserId}
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
      <ConfirmModal
        visible={cancelConfirmVisible}
        title="이웃 신청 취소"
        description="이웃 신청을 취소할까요?"
        confirmLabel="취소하기"
        cancelLabel="돌아가기"
        onConfirm={handleCancelNeighborRequest}
        onCancel={() => setCancelConfirmVisible(false)}
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
    color: Colors.zinc500,
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
  },
  actionButtonDisabled: {
    backgroundColor: Colors.zinc50,
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
});
