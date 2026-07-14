import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import ActionSheetModal from "@/components/ActionSheetModal/ActionSheetModal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { PageHeader } from "@/components/NavBar/PageHeader";
import ScalePressable from "@/components/shared/ScalePressable";
import RefreshableEmpty from "@/components/RefreshableEmpty";
import { useUser } from "@/contexts/UserContext";
import { isQueryStale } from "@/lib/useScreenFocused";
import { LIST_PERF_PRESET } from "@/lib/listPerf";
import DropdownFilter from "@/components/DropdownFilter/DropdownFilter";
import {
  useListSpaces,
  useListMySpaceInvitations,
  useListMySpaceCodeRequests,
  getListSpacesQueryKey,
  getListMySpaceInvitationsQueryKey,
  getListMySpaceCodeRequestsQueryKey,
} from "@workspace/api-client-react";
import type {
  SpaceListItem,
  SpaceInvitationWithSpace,
  SpaceCodeRequestWithSpace,
} from "@workspace/api-client-react";

const GRID_H_PADDING = Spacing.screenPx;
const GRID_COLUMN_GAP = 10;
const OPERATOR_CROWN_COLOR = "#92323D";

type RoleFilter = "all" | "OPERATOR" | "PARTICIPANT";
type StatusFilter = "all" | "ACTIVE";

const STATUS_PRIORITY: Record<string, number> = {
  ACTIVE: 0,
  RECRUITING: 1,
};

function spaceStatusLabel(status: string): string {
  if (status === "ACTIVE") return "진행 중";
  if (status === "RECRUITING") return "모집 중";
  return status;
}

function spaceStatusColor(status: string): string {
  if (status === "ACTIVE") return Colors.noticeAccent;
  if (status === "RECRUITING") return Colors.zinc500;
  return Colors.zinc300;
}

function roleLabel(role: string): string {
  return role === "OPERATOR" ? "운영자" : "참여자";
}

function sortSpaces(spaces: SpaceListItem[]): SpaceListItem[] {
  return [...spaces].sort((a, b) => {
    const pa = STATUS_PRIORITY[a.status] ?? 9;
    const pb = STATUS_PRIORITY[b.status] ?? 9;
    if (pa !== pb) return pa - pb;
    if (a.activeRound && !b.activeRound) return -1;
    if (!a.activeRound && b.activeRound) return 1;
    return a.name.localeCompare(b.name, "ko");
  });
}

function SpaceCard({
  item,
  onPress,
  cardSize,
}: {
  item: SpaceListItem;
  onPress: () => void;
  cardSize: number;
}) {
  const statusColor = spaceStatusColor(item.status);
  const statusText = spaceStatusLabel(item.status);
  const role = roleLabel(item.myRole);
  const avatarLetter = item.name.charAt(0);
  const isOperator = item.myRole === "OPERATOR";

  return (
    <ScalePressable
      style={[styles.card, { width: cardSize, height: cardSize }]}
      onPress={onPress}
      contentStyle={styles.cardContent}
    >
      {isOperator && (
        <View style={styles.crownRow}>
          <MaterialCommunityIcons name="crown" size={14} color={OPERATOR_CROWN_COLOR} />
        </View>
      )}
      <View style={styles.cardTopRow}>
        <View style={styles.cardAvatar}>
          <Text style={styles.cardAvatarText}>{avatarLetter}</Text>
        </View>
        <View style={styles.cardBadgeStack}>
          <View style={[styles.statusBadge, { borderColor: statusColor }]}>
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusText}</Text>
          </View>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>{role}</Text>
          </View>
        </View>
      </View>
      <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
      {item.description ? (
        <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
      ) : null}
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
        <View style={styles.metaDot} />
        <Text style={styles.cardMetaText}>
          {item.participantCount}
          {item.maxParticipants ? `/${item.maxParticipants}` : ""}명
        </Text>
      </View>
    </ScalePressable>
  );
}

const ROLE_FILTER_OPTIONS: { key: RoleFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "OPERATOR", label: "운영자" },
  { key: "PARTICIPANT", label: "참여자" },
];

const STATUS_FILTER_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "ACTIVE", label: "진행 중" },
];

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
          style={styles.inviteBar}
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
      <Text style={styles.inviteSectionLabel}>승인 대기</Text>
      {requests.map((item) => (
        <ScalePressable
          key={item.codeRequest.id}
          style={styles.codeRequestBar}
          onPress={() => onPress(item)}
        >
          <Feather name="clock" size={14} color={Colors.zinc400} style={styles.inviteIcon} />
          <Text style={styles.codeRequestSpaceName} numberOfLines={1}>{item.space.name}</Text>
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>승인 대기 중</Text>
          </View>
          <Feather name="chevron-right" size={15} color={Colors.zinc400} />
        </ScalePressable>
      ))}
    </View>
  );
}

export default function SpacesScreen() {
  const insets = useSafeAreaInsets();
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const { width: screenWidth } = useWindowDimensions();
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const cardSize = Math.floor((screenWidth - GRID_H_PADDING * 2 - GRID_COLUMN_GAP) / 2);

  const spacesQuery = useListSpaces({ userId });
  const invitationsQuery = useListMySpaceInvitations({ userId });
  const codeRequestsQuery = useListMySpaceCodeRequests({ userId });

  const allSpaces = useMemo(
    () =>
      sortSpaces(
        ((spacesQuery.data ?? []) as SpaceListItem[]).filter(
          (s) => s.status !== "ARCHIVED",
        ),
      ),
    [spacesQuery.data],
  );

  const spaces = useMemo(() => {
    let result = allSpaces;
    if (roleFilter !== "all") result = result.filter((s) => s.myRole === roleFilter);
    if (statusFilter !== "all") result = result.filter((s) => s.status === statusFilter);
    return result;
  }, [allSpaces, roleFilter, statusFilter]);

  const invitations = (invitationsQuery.data ?? []) as SpaceInvitationWithSpace[];
  const codeRequests = (codeRequestsQuery.data ?? []) as SpaceCodeRequestWithSpace[];

  const isLoading =
    spacesQuery.isLoading || invitationsQuery.isLoading || codeRequestsQuery.isLoading;
  const isError =
    spacesQuery.isError || invitationsQuery.isError || codeRequestsQuery.isError;

  const refetchAll = useCallback(async () => {
    await Promise.all([
      spacesQuery.refetch(),
      invitationsQuery.refetch(),
      codeRequestsQuery.refetch(),
    ]);
  }, [spacesQuery, invitationsQuery, codeRequestsQuery]);

  const handleRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await refetchAll();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [refetchAll]);

  useFocusEffect(
    useCallback(() => {
      const spaceStale = isQueryStale(queryClient, getListSpacesQueryKey({ userId }));
      const invStale = isQueryStale(queryClient, getListMySpaceInvitationsQueryKey({ userId }));
      const codeStale = isQueryStale(queryClient, getListMySpaceCodeRequestsQueryKey({ userId }));
      if (spaceStale) spacesQuery.refetch();
      if (invStale) invitationsQuery.refetch();
      if (codeStale) codeRequestsQuery.refetch();
    }, [queryClient, userId, spacesQuery.refetch, invitationsQuery.refetch, codeRequestsQuery.refetch]),
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

  const renderSpaceItem = useCallback(
    ({ item }: { item: SpaceListItem }) => (
      <SpaceCard
        item={item}
        cardSize={cardSize}
        onPress={() =>
          router.push({ pathname: "/of-space-detail" as never, params: { id: item.id } })
        }
      />
    ),
    [router, cardSize],
  );

  const hasRawContent =
    allSpaces.length > 0 || invitations.length > 0 || codeRequests.length > 0;

  const filterBars = (
    <View style={styles.filterRow}>
      <DropdownFilter
        label="참여 방법"
        value={roleFilter}
        options={ROLE_FILTER_OPTIONS}
        onChange={setRoleFilter}
      />
      <DropdownFilter
        label="공간 상태"
        value={statusFilter}
        options={STATUS_FILTER_OPTIONS}
        onChange={setStatusFilter}
      />
    </View>
  );

  const listHeaderComponent = (
    <>
      {filterBars}
      <InvitationBar
        invitations={invitations}
        onPress={handleInvitationBarPress}
      />
      <CodeRequestBar requests={codeRequests} onPress={handleCodeRequestBarPress} />
      {spaces.length > 0 && <View style={styles.gridTopSpacer} />}
    </>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PageHeader
        title="공간"
        showAdd
        onAddPress={() => setShowAddSheet(true)}
        showArchive
        onArchivePress={() => router.push("/of-space-archived-list" as never)}
      />
      <ActionSheetModal
        visible={showAddSheet}
        onClose={() => setShowAddSheet(false)}
        actions={[
          {
            label: "공간 만들기",
            onPress: () => router.push("/space-create" as never),
          },
          {
            label: "초대 코드로 참여",
            onPress: () => router.push("/space-join" as never),
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
          <ScalePressable style={styles.retryButton} onPress={handleRefresh}>
            <Text style={styles.retryButtonText}>다시 시도</Text>
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
          <Text style={styles.emptySubtitle}>함께 편지를 나눌 공간을 만들거나{"\n"}초대 코드로 참여해보세요</Text>
        </RefreshableEmpty>
      ) : invitations.length > 0 || codeRequests.length > 0 ? (
        spaces.length === 0 ? (
          <ScrollView
            contentContainerStyle={{ paddingBottom: navBottom }}
            refreshControl={
              <RefreshControl
                refreshing={isManualRefreshing}
                onRefresh={handleRefresh}
                tintColor={Colors.zinc400}
              />
            }
            showsVerticalScrollIndicator={false}
          >
            {filterBars}
            <InvitationBar
              invitations={invitations}
              onPress={handleInvitationBarPress}
            />
            <CodeRequestBar requests={codeRequests} onPress={handleCodeRequestBarPress} />
            {allSpaces.length > 0 && (
              <View style={[styles.centerContainer, styles.filteredEmptyInline]}>
                <Text style={styles.filteredEmptyText}>해당하는 공간이 없어요</Text>
              </View>
            )}
          </ScrollView>
        ) : (
          <FlatList
            {...LIST_PERF_PRESET}
            data={spaces}
            keyExtractor={(item) => item.id}
            renderItem={renderSpaceItem}
            numColumns={2}
            columnWrapperStyle={styles.columnWrapper}
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
            ListEmptyComponent={
              <View style={styles.filteredEmptyInline}>
                <Text style={styles.filteredEmptyText}>해당하는 공간이 없어요</Text>
              </View>
            }
          />
        )
      ) : (
        <FlatList
          {...LIST_PERF_PRESET}
          data={spaces}
          keyExtractor={(item) => item.id}
          renderItem={renderSpaceItem}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={[styles.listContent, { paddingBottom: navBottom }]}
          refreshControl={
            <RefreshControl
              refreshing={isManualRefreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.zinc400}
            />
          }
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              {filterBars}
              {spaces.length > 0 && <View style={styles.gridTopSpacer} />}
            </>
          }
          ListEmptyComponent={
            <View style={styles.filteredEmptyInline}>
              <Text style={styles.filteredEmptyText}>해당하는 공간이 없어요</Text>
            </View>
          }
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
    color: Colors.zinc400,
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
    color: Colors.zinc400,
    textAlign: "center",
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Colors.zinc900,
    borderRadius: 10,
  },
  retryButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
  listContent: {
    paddingTop: 4,
  },
  gridTopSpacer: {
    height: 4,
  },
  columnWrapper: {
    paddingHorizontal: Spacing.screenPx,
    gap: GRID_COLUMN_GAP,
    marginBottom: GRID_COLUMN_GAP,
  },
  filteredEmptyInline: {
    paddingVertical: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  filteredEmptyText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
  },
  // ─── Filter row ──────────────────────────────────────────────────────────────
  filterRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
    paddingVertical: 10,
  },
  // ─── Space card ─────────────────────────────────────────────────────────────
  card: {
    borderRadius: 16,
    backgroundColor: Colors.zinc50,
    overflow: "hidden",
  },
  cardContent: {
    flex: 1,
    padding: 14,
  },
  crownRow: {
    marginBottom: 4,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  cardAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.zinc200,
    alignItems: "center",
    justifyContent: "center",
  },
  cardAvatarText: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.zinc700,
  },
  cardBadgeStack: {
    alignItems: "flex-end",
    gap: 4,
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusBadgeText: {
    ...Typography.caption,
    fontSize: 10,
    fontWeight: "600",
  },
  roleBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: Colors.zinc100,
  },
  roleBadgeText: {
    ...Typography.caption,
    fontSize: 10,
    color: Colors.zinc500,
    fontWeight: "500",
  },
  cardName: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc900,
  },
  cardDesc: {
    ...Typography.body,
    fontSize: 12,
    color: Colors.zinc500,
    lineHeight: 16,
    marginTop: 2,
  },
  cardSpacer: {
    flex: 1,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
  },
  cardMetaText: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc400,
  },
  metaDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: Colors.zinc300,
  },
  // ─── Invitation bar ──────────────────────────────────────────────────────────
  inviteSection: {
    paddingTop: 12,
    paddingBottom: 4,
  },
  inviteSectionLabel: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: "600",
    color: Colors.zinc400,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingHorizontal: Spacing.screenPx,
    marginBottom: 6,
  },
  inviteBar: {
    marginHorizontal: Spacing.screenPx,
    marginVertical: 4,
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
  // ─── Code request bar ────────────────────────────────────────────────────────
  codeRequestSection: {
    paddingTop: 8,
    paddingBottom: 4,
  },
  codeRequestBar: {
    marginHorizontal: Spacing.screenPx,
    marginVertical: 4,
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
    fontSize: 11,
    color: Colors.zinc500,
    fontWeight: "600",
  },
});
