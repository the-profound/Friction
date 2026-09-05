import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  useWindowDimensions,
} from "react-native";
import ActionSheetModal from "@/components/ActionSheetModal/ActionSheetModal";
import { useFocusEffect, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { keepPreviousData, useQueries, useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { PageHeader } from "@/components/NavBar/PageHeader";
import ScalePressable from "@/components/shared/ScalePressable";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import CanonicalCardSlot from "@/components/ArticleCardItem/CanonicalCardSlot";
import RefreshableEmpty from "@/components/RefreshableEmpty";
import { useAuth } from "@/contexts/AuthContext";
import { useUser } from "@/contexts/UserContext";
import { isQueryStale } from "@/lib/useScreenFocused";
import { LIST_PERF_PRESET } from "@/lib/listPerf";
import { spaceLetterToViewModel } from "@/hooks/useSpaceLetterCards";
import {
  useListSpaces,
  useListMySpaceInvitations,
  useListMySpaceCodeRequests,
  useListOperatorPendingSpaceCodeRequests,
  getListSpacesQueryKey,
  getListSpaceLettersQueryKey,
  listSpaceLetters,
  getListMySpaceInvitationsQueryKey,
  getListMySpaceCodeRequestsQueryKey,
} from "@workspace/api-client-react";
import type {
  SpaceListItem,
  SpaceLetter,
  SpaceInvitationWithSpace,
  SpaceCodeRequestWithSpace,
  SpacePendingCodeRequestSummary,
} from "@workspace/api-client-react";
import { spaceStatusLabel, spaceStatusStyle } from "@/lib/spaceStatusStyle";
import {
  getUserScopedOperatorPendingSpaceCodeRequestsQueryKey,
  runOperatorPendingRetry,
} from "@/lib/operatorPendingSpaceCodeRequestsQuery";

const GRID_H_PADDING = Spacing.screenPx;
const GRID_COLUMN_GAP = 10;

const SPACE_CARD_MIN_HEIGHT = 132;
const OPERATOR_CROWN_COLOR = "#92323D";
function isOverduePlannedStart(item: SpaceListItem): boolean {
  if (item.status !== "RECRUITING" || !item.plannedStartsAt) return false;
  return new Date(item.plannedStartsAt) < new Date();
}

function sortSpaces(spaces: SpaceListItem[]): SpaceListItem[] {
  const getPriority = (s: SpaceListItem): number => {
    if (s.status === "ACTIVE") return 0;
    if (s.status === "RECRUITING") return isOverduePlannedStart(s) ? 1 : 2;
    return 9;
  };
  return [...spaces].sort((a, b) => {
    const pa = getPriority(a);
    const pb = getPriority(b);
    if (pa !== pb) return pa - pb;
    if (a.activeRound && !b.activeRound) return -1;
    if (!a.activeRound && b.activeRound) return 1;
    return a.name.localeCompare(b.name, "ko");
  });
}

function sortRecentLetters(letters: SpaceLetter[]): SpaceLetter[] {
  return [...letters]
    .filter((letter) => letter.articleTitle || letter.articleExcerpt)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 3);
}
function SpaceCard({
  item,
  onPress,
  cardWidth,
  recentLetters,
}: {
  item: SpaceListItem;
  onPress: () => void;
  cardWidth: number;
  recentLetters: SpaceLetter[];
}) {
  const statusStyle = spaceStatusStyle(item.status);
  const statusText = spaceStatusLabel(item.status);
  const isOperator = item.myRole === "OPERATOR";
  const isOverdue = isOverduePlannedStart(item);
  const titleFontSize = cardWidth * 0.064;
  const descriptionFontSize = cardWidth * 0.04;

  return (
    <ScalePressable
      style={[styles.cardWrapper, { width: cardWidth }]}
      onPress={onPress}
      contentStyle={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`${item.name} 공간 열기`}
    >
      {isOperator && (
        <View style={styles.crownBadge}>
          <MaterialCommunityIcons name="crown" size={14} color={OPERATOR_CROWN_COLOR} />
        </View>
      )}
      <View style={styles.cardContent}>
        <View style={styles.cardTopRow}>
          <Text
            style={[
              styles.cardName,
              { fontSize: titleFontSize, lineHeight: titleFontSize * 1.3 },
            ]}
          >
            {item.name}
          </Text>
          <View style={styles.cardBadgeGroup}>
            {isOverdue && (
              <View style={styles.overdueBadge}>
                <Text style={styles.overdueBadgeText}>예정일 경과</Text>
              </View>
            )}
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor: statusStyle.backgroundColor,
                  borderColor: statusStyle.borderColor,
                  borderWidth: statusStyle.borderWidth,
                },
              ]}
            >
              <Text style={[styles.statusBadgeText, { color: statusStyle.textColor }]}>
                {statusText}
              </Text>
            </View>
          </View>
        </View>
        {item.description ? (
          <Text
            style={[
              styles.cardDesc,
              {
                fontSize: descriptionFontSize,
                lineHeight: descriptionFontSize * 1.45,
              },
            ]}
            numberOfLines={4}
          >
            {item.description}
          </Text>
        ) : null}
        <RecentPostCards
          letters={recentLetters}
          space={item}
          cardWidth={cardWidth}
        />
        <View style={styles.cardSpacer} />
        <View style={styles.cardMeta}>
          {item.activeRound ? (
            <Text style={styles.cardMetaText}>
              {item.activeRound.roundNumber}회차 진행 중
            </Text>
          ) : (
            <Text style={styles.cardMetaText}>
              {item.roundCount}회차 계획
            </Text>
          )}
          <View style={styles.cardMetaRight}>
            <Feather name="user" size={11} color={Colors.zinc400} />
            <Text style={styles.cardMetaText}>
              {item.participantCount}
              {item.maxParticipants ? `/${item.maxParticipants}` : ""}명
            </Text>
          </View>
        </View>
      </View>
    </ScalePressable>
  );
}
function InvitationBar({
  invitations,
  onPress,
}: {
  invitations: SpaceInvitationWithSpace[];
  onPress: (item: SpaceInvitationWithSpace) => void;
}) {
  if (invitations.length === 0) return null;
  return (
    <View style={styles.inviteSection}>
      <Text style={styles.inviteSectionLabel}>초대</Text>
      {invitations.map((item) => (
        <ScalePressable
          key={item.invitation.id}
          style={styles.inviteBarOuter}
          contentStyle={styles.inviteBar}
          onPress={() => onPress(item)}
        >
          <View style={styles.inviteBarInfo}>
            <Feather name="mail" size={14} color={Colors.noticeAccent} style={styles.inviteIcon} />
            <Text style={styles.inviteSpaceName} numberOfLines={1}>{item.space.name}</Text>
            <Text style={styles.inviteSubtext}>에서 초대가 왔어요</Text>
          </View>
          <Feather name="chevron-right" size={16} color={Colors.noticeAccent} />
        </ScalePressable>
      ))}
    </View>
  );
}

function CodeRequestBar({
  requests,
  onPress,
}: {
  requests: SpaceCodeRequestWithSpace[];
  onPress: (item: SpaceCodeRequestWithSpace) => void;
}) {
  if (requests.length === 0) return null;
  return (
    <View style={styles.codeRequestSection}>
      <Text style={styles.inviteSectionLabel}>신청 중</Text>
      {requests.map((item) => (
        <ScalePressable
          key={item.codeRequest.id}
          style={styles.codeRequestBarOuter}
          contentStyle={styles.codeRequestBar}
          onPress={() => onPress(item)}
        >
          <Feather name="clock" size={14} color={Colors.zinc400} style={styles.inviteIcon} />
          <Text style={styles.codeRequestSpaceName} numberOfLines={1}>{item.space.name}</Text>
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>신청 중</Text>
          </View>
          <Feather name="chevron-right" size={15} color={Colors.zinc400} />
        </ScalePressable>
      ))}
    </View>
  );
}

function OperatorPendingBar({
  summaries,
  onPress,
}: {
  summaries: SpacePendingCodeRequestSummary[];
  onPress: (summary: SpacePendingCodeRequestSummary) => void;
}) {
  if (summaries.length === 0) return null;
  return (
    <View style={styles.operatorPendingSection}>
      <Text style={styles.inviteSectionLabel}>승인 대기</Text>
      {summaries.map((summary) => (
        <ScalePressable
          key={summary.space.id}
          style={styles.operatorPendingBarOuter}
          contentStyle={styles.operatorPendingBar}
          onPress={() => onPress(summary)}
        >
          <View style={styles.operatorPendingInfo}>
            <Feather name="user-check" size={14} color={Colors.noticeAccent} style={styles.inviteIcon} />
            <Text style={styles.operatorPendingSpaceName} numberOfLines={1}>
              {summary.space.name}
            </Text>
            <Text style={styles.operatorPendingSubtext}>
              {summary.pendingCount}건 처리 필요
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={Colors.noticeAccent} />
        </ScalePressable>
      ))}
    </View>
  );
}

export default function SpacesScreen() {
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const { userId } = useUser();
  const { prepareAuthSession, isLoading: authIsLoading } = useAuth();
  const queryClient = useQueryClient();
  const { width: screenWidth } = useWindowDimensions();
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const refreshLockRef = useRef(false);
  const [isOperatorRetrying, setIsOperatorRetrying] = useState(false);
  const operatorRetryLockRef = useRef(false);
  const [showMenuSheet, setShowMenuSheet] = useState(false);

  const cardWidth = Math.floor(screenWidth - GRID_H_PADDING * 2);

  const spacesQuery = useListSpaces({ userId }, {
    query: {
      queryKey: getListSpacesQueryKey({ userId }),
      staleTime: 30_000,
      placeholderData: keepPreviousData,
    },
  });
  const invitationsQuery = useListMySpaceInvitations({ userId });
  const codeRequestsQuery = useListMySpaceCodeRequests({ userId });
  const operatorPendingQueryKey = useMemo(
    () => getUserScopedOperatorPendingSpaceCodeRequestsQueryKey(userId),
    [userId],
  );
  const operatorPendingQuery = useListOperatorPendingSpaceCodeRequests({
    query: {
      enabled: !!userId,
      queryKey: operatorPendingQueryKey,
    },
  });

  const allSpaces = useMemo(
    () =>
      sortSpaces(
        ((spacesQuery.data ?? []) as SpaceListItem[]).filter(
          (s) => s.status !== "ARCHIVED",
        ),
      ),
    [spacesQuery.data],
  );

  const spaceLetterQueryKeys = useMemo(
    () =>
      allSpaces.map((space) => [
        ...getListSpaceLettersQueryKey(space.id),
        { userId },
      ]),
    [allSpaces, userId],
  );
  const spaceLettersQueries = useQueries({
    queries: allSpaces.map((space, index) => ({
      queryKey: spaceLetterQueryKeys[index],
      queryFn: async ({ signal }: { signal?: AbortSignal }) => {
        const session = await prepareAuthSession();
        if (!session) {
          throw new Error("로그인 상태를 확인할 수 없어요.");
        }
        return listSpaceLetters(space.id, { signal });
      },
      enabled: !!userId && !authIsLoading,
      staleTime: 30_000,
    })),
  });
  const recentLettersBySpaceId = useMemo(
    () =>
      new Map(
        allSpaces.map((space, index) => [
          space.id,
          sortRecentLetters(spaceLettersQueries[index]?.data ?? []),
        ]),
      ),
    [allSpaces, spaceLettersQueries],
  );

  const invitations = (invitationsQuery.data ?? []) as SpaceInvitationWithSpace[];
  const codeRequests = (codeRequestsQuery.data ?? []) as SpaceCodeRequestWithSpace[];
  const operatorPending = (operatorPendingQuery.data ?? []) as SpacePendingCodeRequestSummary[];

  const isLoading =
    spacesQuery.isLoading ||
    invitationsQuery.isLoading ||
    codeRequestsQuery.isLoading;
  const isError =
    spacesQuery.isError ||
    invitationsQuery.isError ||
    codeRequestsQuery.isError;

  const refetchAll = useCallback(async () => {
    await Promise.all([
      spacesQuery.refetch(),
      invitationsQuery.refetch(),
      codeRequestsQuery.refetch(),
      operatorPendingQuery.refetch(),
      ...spaceLettersQueries.map((query) => query.refetch()),
    ]);
  }, [
    spacesQuery,
    invitationsQuery,
    codeRequestsQuery,
    operatorPendingQuery,
    spaceLettersQueries,
  ]);

  const handleRefresh = useCallback(async () => {
    if (refreshLockRef.current) return;
    refreshLockRef.current = true;
    setIsManualRefreshing(true);
    try {
      await refetchAll();
    } finally {
      refreshLockRef.current = false;
      setIsManualRefreshing(false);
    }
  }, [refetchAll]);

  const handleOperatorRetry = useCallback(async () => {
    const started = !operatorRetryLockRef.current;
    if (started) setIsOperatorRetrying(true);
    try {
      await runOperatorPendingRetry(
        operatorRetryLockRef,
        operatorPendingQuery.refetch,
      );
    } finally {
      if (started) setIsOperatorRetrying(false);
    }
  }, [operatorPendingQuery.refetch]);

  useFocusEffect(
    useCallback(() => {
      const spaceStale = isQueryStale(queryClient, getListSpacesQueryKey({ userId }));
      const invStale = isQueryStale(queryClient, getListMySpaceInvitationsQueryKey({ userId }));
      const codeStale = isQueryStale(queryClient, getListMySpaceCodeRequestsQueryKey({ userId }));
      const operatorPendingStale = isQueryStale(
        queryClient,
        operatorPendingQueryKey,
      );
      const operatorPendingIsFetching =
        queryClient.getQueryState(operatorPendingQueryKey)?.fetchStatus ===
        "fetching";
      if (spaceStale) spacesQuery.refetch();
      if (invStale) invitationsQuery.refetch();
      if (codeStale) codeRequestsQuery.refetch();
      if (
        userId &&
        operatorPendingStale &&
        !operatorPendingIsFetching
      ) {
        operatorPendingQuery.refetch();
      }
      for (const queryKey of spaceLetterQueryKeys) {
        const queryState = queryClient.getQueryState(queryKey);
        if (
          isQueryStale(queryClient, queryKey) &&
          queryState?.fetchStatus !== "fetching"
        ) {
          void queryClient.refetchQueries({ queryKey, exact: true });
        }
      }
    }, [
      queryClient,
      userId,
      operatorPendingQueryKey,
      spaceLetterQueryKeys,
      spacesQuery.refetch,
      invitationsQuery.refetch,
      codeRequestsQuery.refetch,
      operatorPendingQuery.refetch,
    ]),
  );

  const handleInvitationBarPress = useCallback(
    (item: SpaceInvitationWithSpace) => {
      router.push({
        pathname: "/space-join" as never,
        params: { spaceId: item.space.id, invitationId: item.invitation.id },
      });
    },
    [router],
  );

  const handleCodeRequestBarPress = useCallback(
    (item: SpaceCodeRequestWithSpace) => {
      router.push({
        pathname: "/space-join" as never,
        params: { spaceId: item.space.id, codeRequestId: item.codeRequest.id },
      });
    },
    [router],
  );

  const handleOperatorPendingBarPress = useCallback(
    (summary: SpacePendingCodeRequestSummary) => {
      router.push({
        pathname: "/of-space-participants" as never,
        params: { id: summary.space.id, spaceName: summary.space.name },
      });
    },
    [router],
  );

  const renderSpaceItem = useCallback(
    ({ item }: { item: SpaceListItem }) => (
      <SpaceCard
        item={item}
        cardWidth={cardWidth}
        recentLetters={recentLettersBySpaceId.get(item.id) ?? []}
        onPress={() =>
          router.push({ pathname: "/of-space-detail" as never, params: { id: item.id } })
        }
      />
    ),
    [router, cardWidth, recentLettersBySpaceId],
  );

  const hasPrimaryContent =
    allSpaces.length > 0 ||
    invitations.length > 0 ||
    codeRequests.length > 0;
  const hasRawContent = hasPrimaryContent || operatorPending.length > 0;
  const isOperatorSummaryOnlyLoading =
    !hasPrimaryContent &&
    operatorPending.length === 0 &&
    operatorPendingQuery.isLoading;
  const isOperatorSummaryOnlyError =
    !hasPrimaryContent &&
    operatorPending.length === 0 &&
    operatorPendingQuery.isError;

  const listHeaderComponent = (
    <>
      <OperatorPendingBar
        summaries={operatorPending}
        onPress={handleOperatorPendingBarPress}
      />
      <InvitationBar
        invitations={invitations}
        onPress={handleInvitationBarPress}
      />
      <CodeRequestBar requests={codeRequests} onPress={handleCodeRequestBarPress} />
      {allSpaces.length > 0 && <View style={styles.gridTopSpacer} />}
    </>
  );

  return (
    <View style={styles.container}>
      <PageHeader
        title="공간 목록"
        centeredBrandTitle
      />
      <View style={styles.headerActionRow}>
        <ScalePressable
          style={styles.headerMenuButton}
          contentStyle={styles.headerMenuButtonContent}
          onPress={() => setShowMenuSheet(true)}
          accessibilityRole="button"
          accessibilityLabel="공간 메뉴 열기"
        >
          <Feather
            name="more-horizontal"
            size={Sizing.searchIconSize}
            color={Colors.zinc700}
          />
        </ScalePressable>
      </View>
      <ActionSheetModal
        visible={showMenuSheet}
        onClose={() => setShowMenuSheet(false)}
        actions={[
          {
            label: "공간 만들기",
            onPress: () => router.push("/space-create" as never),
          },
          {
            label: "초대 문구로 참여",
            onPress: () => router.push("/space-join" as never),
          },
          {
            label: "보관된 공간",
            onPress: () => router.push("/of-space-archived-list" as never),
          },
          { label: "취소", style: "cancel", onPress: () => {} },
        ]}
      />

      {isLoading ? (
        <View style={[styles.centerContainer, { paddingBottom: navBottom }]}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      ) : isError ? (
        <View style={[styles.centerContainer, { paddingBottom: navBottom }]}>
          <Feather name="alert-circle" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>불러오기에 실패했어요</Text>
          <ScalePressable
            style={styles.retryButtonOuter}
            contentStyle={styles.retryButton}
            onPress={handleRefresh}
            disabled={isManualRefreshing}
            accessibilityRole="button"
            accessibilityLabel="다시 시도"
            accessibilityState={{
              disabled: isManualRefreshing,
              busy: isManualRefreshing,
            }}
          >
            {isManualRefreshing ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={styles.retryButtonText}>다시 시도</Text>
            )}
          </ScalePressable>
        </View>
      ) : isOperatorSummaryOnlyLoading ? (
        <View style={[styles.centerContainer, { paddingBottom: navBottom }]}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      ) : isOperatorSummaryOnlyError ? (
        <View style={[styles.centerContainer, { paddingBottom: navBottom }]}>
          <Feather name="alert-circle" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>승인 대기 목록을 불러오지 못했어요</Text>
          <ScalePressable
            style={styles.retryButtonOuter}
            contentStyle={styles.retryButton}
            onPress={handleOperatorRetry}
            disabled={isOperatorRetrying}
            accessibilityRole="button"
            accessibilityLabel="승인 대기 목록 다시 시도"
            accessibilityState={{
              disabled: isOperatorRetrying,
              busy: isOperatorRetrying,
            }}
          >
            {isOperatorRetrying ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={styles.retryButtonText}>다시 시도</Text>
            )}
          </ScalePressable>
        </View>
      ) : !hasRawContent ? (
        <RefreshableEmpty
          refreshing={isManualRefreshing}
          onRefresh={handleRefresh}
          contentContainerStyle={[styles.centerContainer, { paddingBottom: navBottom }]}
        >
          <Feather name="grid" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>공간이 없어요</Text>
          <Text style={styles.emptySubtitle}>함께 편지를 나눌 공간을 만들거나{"\n"}초대 문구로 참여해보세요</Text>
        </RefreshableEmpty>
      ) : (
        <FlatList
          {...LIST_PERF_PRESET}
          data={allSpaces}
          keyExtractor={(item) => item.id}
          renderItem={renderSpaceItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: navBottom }]}
          refreshControl={
            <RefreshControl
              refreshing={isManualRefreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.zinc400}
            />
          }
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={listHeaderComponent}
          extraData={recentLettersBySpaceId}
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
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
  },
  loadingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
    marginTop: 12,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 20,
  },
  retryButtonOuter: {
    marginTop: 16,
    width: 104,
    height: 44,
    flexGrow: 0,
    flexShrink: 0,
  },
  retryButton: {
    width: 104,
    height: 44,
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: 20,
    backgroundColor: Colors.zinc900,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
  listContent: {
    paddingTop: 4,
  },
  headerActionRow: {
    minHeight: Sizing.searchButtonSize,
    marginTop: 4,
    marginBottom: 16,
    paddingHorizontal: Spacing.screenPx,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  headerMenuButton: {
    width: Sizing.searchButtonSize,
    height: Sizing.searchButtonSize,
    flexGrow: 0,
    flexShrink: 0,
  },
  headerMenuButtonContent: {
    width: Sizing.searchButtonSize,
    height: Sizing.searchButtonSize,
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: Sizing.searchButtonSize / 2,
    backgroundColor: Colors.searchBgInactive,
    alignItems: "center",
    justifyContent: "center",
  },
  gridTopSpacer: {
    height: 4,
  },
  // ─── Space card ─────────────────────────────────────────────────────────────
  cardWrapper: {
    minHeight: SPACE_CARD_MIN_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
    marginHorizontal: GRID_H_PADDING,
    marginBottom: GRID_COLUMN_GAP,
  },
  card: {
    minHeight: SPACE_CARD_MIN_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: 16,
    backgroundColor: Colors.white,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardContent: {
    minHeight: SPACE_CARD_MIN_HEIGHT,
    padding: 16,
    position: "relative",
    flexDirection: "column",
    justifyContent: "flex-start",
    borderRadius: 16,
    overflow: "hidden",
  },
  crownBadge: {
    position: "absolute",
    top: -8,
    left: 10,
    zIndex: 1,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
    gap: 8,
  },
  cardBadgeGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  overdueBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: "#FEF3C7",
  },
  overdueBadgeText: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "600",
    color: "#B45309",
  },
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  statusBadgeText: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "600",
  },
  cardName: {
    ...Typography.bodySemiBold,
    fontWeight: "700",
    color: Colors.zinc900,
    flex: 1,
  },
  cardDesc: {
    ...Typography.caption,
    color: Colors.zinc600,
    marginTop: 2,
  },
  recentPosts: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 10,
    minHeight: 119,
    pointerEvents: "none",
  },
  cardSpacer: {
    flex: 1,
    minHeight: 8,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  cardMetaRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  cardMetaText: {
    ...Typography.captionMedium,
    fontSize: 12,
    color: Colors.zinc500,
  },
  // ─── Invitation bar ──────────────────────────────────────────────────────────
  inviteSection: {
    paddingTop: 12,
    paddingBottom: 4,
  },
  inviteSectionLabel: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "600",
    color: Colors.zinc500,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingHorizontal: Spacing.screenPx,
    marginBottom: 6,
  },
  inviteBarOuter: {
    marginHorizontal: Spacing.screenPx,
    marginVertical: 4,
  },
  inviteBar: {
    backgroundColor: Colors.noticeAccentSoft,
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  inviteBarInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    overflow: "hidden",
    gap: 4,
  },
  inviteIcon: {
    marginRight: 2,
  },
  inviteSpaceName: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.noticeAccent,
    flexShrink: 1,
    maxWidth: 120,
  },
  inviteSubtext: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc700,
  },
  // ─── Operator pending bar ────────────────────────────────────────────────────
  operatorPendingSection: {
    paddingTop: 12,
    paddingBottom: 4,
  },
  operatorPendingBarOuter: {
    marginHorizontal: Spacing.screenPx,
    marginVertical: 4,
  },
  operatorPendingBar: {
    backgroundColor: Colors.noticeAccentSoft,
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  operatorPendingInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    overflow: "hidden",
    gap: 4,
  },
  operatorPendingSpaceName: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.noticeAccent,
    flexShrink: 1,
    maxWidth: 160,
  },
  operatorPendingSubtext: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc700,
  },
  // ─── Code request bar ────────────────────────────────────────────────────────
  codeRequestSection: {
    paddingTop: 8,
    paddingBottom: 4,
  },
  codeRequestBarOuter: {
    marginHorizontal: Spacing.screenPx,
    marginVertical: 4,
  },
  codeRequestBar: {
    backgroundColor: Colors.zinc50,
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
  },
  codeRequestSpaceName: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc700,
    flex: 1,
  },
  pendingBadge: {
    backgroundColor: Colors.zinc200,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pendingBadgeText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    fontWeight: "600",
  },
});

function RecentPostCards({
  letters,
  space,
  cardWidth,
}: {
  letters: SpaceLetter[];
  space: SpaceListItem;
  cardWidth: number;
}) {
  if (letters.length === 0) return null;

  const availableWidth = cardWidth - 32;
  const coverWidth = Math.min(
    90,
    Math.floor((availableWidth - 16) / 3),
  );
  const coverHeight = coverWidth * Sizing.cardRatio;

  return (
    <View style={styles.recentPosts}>
      {letters.map((letter) => {
        const card = spaceLetterToViewModel(
          letter,
          space.name,
          space.isAnonymous,
        );
        return (
          <CanonicalCardSlot
            key={letter.id}
            width={coverWidth}
            height={coverHeight}
          >
            <ArticleCardItem
              title={letter.articleTitle || "제목 없음"}
              authorName={card.authorName}
              spaceName={card.spaceName}
              cover={card.cover}
              disabled
              onPress={() => {}}
            />
          </CanonicalCardSlot>
        );
      })}
    </View>
  );
}
