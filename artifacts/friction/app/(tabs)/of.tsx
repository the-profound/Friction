import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { PageHeader } from "@/components/NavBar/PageHeader";
import ScalePressable from "@/components/shared/ScalePressable";
import RefreshableEmpty from "@/components/RefreshableEmpty";
import { useUser } from "@/contexts/UserContext";
import { isQueryStale } from "@/lib/useScreenFocused";
import { LIST_PERF_PRESET } from "@/lib/listPerf";
import {
  useListSpaces,
  useListMySpaceInvitations,
  useListMySpaceCodeRequests,
  useUpdateSpaceInvitation,
  getListSpacesQueryKey,
  getListMySpaceInvitationsQueryKey,
  getListMySpaceCodeRequestsQueryKey,
} from "@workspace/api-client-react";
import type {
  SpaceListItem,
  SpaceInvitationWithSpace,
  SpaceCodeRequestWithSpace,
} from "@workspace/api-client-react";

const STATUS_PRIORITY: Record<string, number> = {
  ACTIVE: 0,
  RECRUITING: 1,
  ARCHIVED: 2,
};

function spaceStatusLabel(status: string): string {
  if (status === "ACTIVE") return "진행 중";
  if (status === "RECRUITING") return "모집 중";
  if (status === "ARCHIVED") return "종료";
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
}: {
  item: SpaceListItem;
  onPress: () => void;
}) {
  const statusColor = spaceStatusColor(item.status);
  const statusText = spaceStatusLabel(item.status);
  const role = roleLabel(item.myRole);

  return (
    <ScalePressable style={styles.card} onPress={onPress} contentStyle={styles.cardContent}>
      <View style={styles.cardHeader}>
        <View style={[styles.statusBadge, { borderColor: statusColor }]}>
          <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusText}</Text>
        </View>
        <Text style={styles.roleBadge}>{role}</Text>
      </View>
      <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
      {item.description ? (
        <Text style={styles.cardDesc} numberOfLines={1}>{item.description}</Text>
      ) : null}
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

function InvitationBar({
  invitations,
  onAccept,
  onDecline,
  accepting,
}: {
  invitations: SpaceInvitationWithSpace[];
  onAccept: (item: SpaceInvitationWithSpace) => void;
  onDecline: (item: SpaceInvitationWithSpace) => void;
  accepting: string | null;
}) {
  if (invitations.length === 0) return null;
  return (
    <View style={styles.inviteSection}>
      <Text style={styles.inviteSectionLabel}>초대</Text>
      {invitations.map((item) => (
        <View key={item.invitation.id} style={styles.inviteBar}>
          <View style={styles.inviteBarInfo}>
            <Feather name="mail" size={14} color={Colors.noticeAccent} style={styles.inviteIcon} />
            <Text style={styles.inviteSpaceName} numberOfLines={1}>{item.space.name}</Text>
            <Text style={styles.inviteSubtext}>에서 초대가 왔어요</Text>
          </View>
          <View style={styles.inviteActions}>
            <ScalePressable
              style={[styles.inviteBtn, styles.inviteDeclineBtn]}
              onPress={() => onDecline(item)}
              disabled={accepting === item.invitation.id}
            >
              <Text style={styles.inviteDeclineBtnText}>거절</Text>
            </ScalePressable>
            <ScalePressable
              style={[styles.inviteBtn, styles.inviteAcceptBtn]}
              onPress={() => onAccept(item)}
              disabled={accepting === item.invitation.id}
            >
              <Text style={styles.inviteAcceptBtnText}>
                {accepting === item.invitation.id ? "처리 중" : "수락"}
              </Text>
            </ScalePressable>
          </View>
        </View>
      ))}
    </View>
  );
}

function CodeRequestBar({ requests }: { requests: SpaceCodeRequestWithSpace[] }) {
  if (requests.length === 0) return null;
  return (
    <View style={styles.codeRequestSection}>
      <Text style={styles.inviteSectionLabel}>승인 대기</Text>
      {requests.map((item) => (
        <View key={item.codeRequest.id} style={styles.codeRequestBar}>
          <Feather name="clock" size={14} color={Colors.zinc400} style={styles.inviteIcon} />
          <Text style={styles.codeRequestSpaceName} numberOfLines={1}>{item.space.name}</Text>
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>승인 대기 중</Text>
          </View>
        </View>
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
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);

  const spacesQuery = useListSpaces({ userId });
  const invitationsQuery = useListMySpaceInvitations({ userId });
  const codeRequestsQuery = useListMySpaceCodeRequests({ userId });
  const updateInvitation = useUpdateSpaceInvitation();

  const spaces = useMemo(
    () => sortSpaces((spacesQuery.data ?? []) as SpaceListItem[]),
    [spacesQuery.data],
  );
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

  const handleAcceptInvitation = useCallback(
    async (item: SpaceInvitationWithSpace) => {
      if (accepting) return;
      setAccepting(item.invitation.id);
      try {
        await updateInvitation.mutateAsync({
          id: item.space.id,
          invitationId: item.invitation.id,
          data: { status: "ACCEPTED" },
        });
        await refetchAll();
      } catch {
        await invitationsQuery.refetch();
      } finally {
        setAccepting(null);
      }
    },
    [accepting, updateInvitation, refetchAll, invitationsQuery],
  );

  const handleDeclineInvitation = useCallback(
    async (item: SpaceInvitationWithSpace) => {
      if (accepting) return;
      setAccepting(item.invitation.id);
      try {
        await updateInvitation.mutateAsync({
          id: item.space.id,
          invitationId: item.invitation.id,
          data: { status: "DECLINED" },
        });
        await invitationsQuery.refetch();
      } catch {
        await invitationsQuery.refetch();
      } finally {
        setAccepting(null);
      }
    },
    [accepting, updateInvitation, invitationsQuery],
  );

  const renderSpaceItem = useCallback(
    ({ item }: { item: SpaceListItem }) => (
      <SpaceCard
        item={item}
        onPress={() =>
          router.push({ pathname: "/of-space-detail" as never, params: { id: item.id } })
        }
      />
    ),
    [router],
  );

  const hasAnyContent =
    spaces.length > 0 || invitations.length > 0 || codeRequests.length > 0;

  const listHeader = (
    <>
      <InvitationBar
        invitations={invitations}
        onAccept={handleAcceptInvitation}
        onDecline={handleDeclineInvitation}
        accepting={accepting}
      />
      <CodeRequestBar requests={codeRequests} />
      {spaces.length > 0 && <View style={styles.spaceListHeader} />}
    </>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PageHeader title="공간" />

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
      ) : !hasAnyContent ? (
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
            <InvitationBar
              invitations={invitations}
              onAccept={handleAcceptInvitation}
              onDecline={handleDeclineInvitation}
              accepting={accepting}
            />
            <CodeRequestBar requests={codeRequests} />
          </ScrollView>
        ) : (
          <FlatList
            {...LIST_PERF_PRESET}
            data={spaces}
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
            ListHeaderComponent={listHeader}
          />
        )
      ) : (
        <FlatList
          {...LIST_PERF_PRESET}
          data={spaces}
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
    paddingTop: 8,
  },
  spaceListHeader: {
    height: 4,
  },
  // ─── Space card ─────────────────────────────────────────────────────────────
  card: {
    marginHorizontal: Spacing.screenPx,
    marginVertical: 6,
    borderRadius: 14,
    backgroundColor: Colors.zinc50,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
  },
  cardContent: {
    padding: 16,
    gap: 4,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  statusBadgeText: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: "600",
  },
  roleBadge: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc400,
  },
  cardName: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
  },
  cardDesc: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
    lineHeight: 18,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  cardMetaText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
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
  inviteActions: {
    flexDirection: "row",
    gap: 6,
  },
  inviteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  inviteDeclineBtn: {
    backgroundColor: Colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
  },
  inviteDeclineBtnText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
    fontWeight: "600",
  },
  inviteAcceptBtn: {
    backgroundColor: Colors.noticeAccent,
  },
  inviteAcceptBtnText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.white,
    fontWeight: "600",
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
