import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Modal,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";
import HeaderButton from "@/components/shared/HeaderButton";
import { useUser } from "@/contexts/UserContext";
import { getUserScopedSpaceJoinContextQueryKey } from "@/lib/spaceJoinContextQuery";
import { SpaceCopy } from "@/constants/spaceCopy";
import { isRecruitmentFull } from "@/lib/spaceRecruitment";
import {
  useGetSpaceJoinContext,
  useListSpaceMembers,
  getListSpaceMembersQueryKey,
  useUpdateSpaceParticipation,
  useListSpaceCodeRequests,
  getListSpaceCodeRequestsQueryKey,
  useUpdateSpaceCodeRequest,
  ListSpaceCodeRequestsStatus,
} from "@workspace/api-client-react";
import type {
  SpaceMember,
  SpaceCodeRequestWithRequester,
} from "@workspace/api-client-react";
import { getUserScopedOperatorPendingSpaceCodeRequestsQueryKey } from "@/lib/operatorPendingSpaceCodeRequestsQuery";

// ─── Code request item (moved from of-space-detail) ────────────────────────

function CodeRequestItem({
  item,
  onApprove,
  onReject,
  processing,
  recruitmentClosed,
}: {
  item: SpaceCodeRequestWithRequester;
  onApprove: () => void;
  onReject: () => void;
  processing: boolean;
  recruitmentClosed: boolean;
}) {
  return (
    <View style={styles.rowCard}>
      <View style={styles.rowCardLeft}>
        <View style={styles.avatarPlaceholder}>
          <Feather name="user" size={14} color={Colors.zinc500} />
        </View>
        <View style={styles.rowCardMeta}>
          <Text style={styles.rowCardTitle} numberOfLines={1}>
            {item.requesterNickname ?? "알 수 없음"}
          </Text>
          <Text style={styles.rowCardSubtitle}>
            {formatRequestDate(item.codeRequest.createdAt)} 신청
          </Text>
        </View>
      </View>
      <View style={styles.rowCardActions}>
        <ScalePressable
          contentStyle={[styles.actionBtn, styles.rejectBtn]}
          onPress={onReject}
          disabled={processing}
        >
          <Text style={styles.rejectBtnText}>거절</Text>
        </ScalePressable>
        <ScalePressable
          contentStyle={[
            styles.actionBtn,
            styles.approveBtn,
            recruitmentClosed && styles.approveBtnDisabled,
          ]}
          onPress={recruitmentClosed ? undefined : onApprove}
          disabled={processing || recruitmentClosed}
        >
          <Text style={styles.approveBtnText}>
            {processing ? "처리 중" : recruitmentClosed ? "마감" : "승인"}
          </Text>
        </ScalePressable>
      </View>
    </View>
  );
}

function formatRequestDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function getRequestActionErrorMessage(error: unknown, fallback: string): string {
  const responseError =
    error != null &&
    typeof error === "object" &&
    "data" in error &&
    (error as { data?: { error?: unknown } }).data?.error;
  return typeof responseError === "string" ? responseError : fallback;
}

// ─── Android Rejection Reason Modal ──────────────────────────────────────────

function RejectReasonModal({
  visible,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const insets = useSafeAreaInsets();

  const handleConfirm = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      Alert.alert("알림", "거절 사유를 입력해주세요.");
      return;
    }
    onConfirm(trimmed);
    setReason("");
  };

  const handleCancel = () => {
    setReason("");
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={modalStyles.backdrop}>
        <View style={[modalStyles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={modalStyles.title}>거절 사유 입력</Text>
          <Text style={modalStyles.subtitle}>
            사유를 입력해주세요. 현재는 공간장에게만 기록됩니다.
          </Text>
          <TextInput
            style={modalStyles.input}
            value={reason}
            onChangeText={setReason}
            placeholder="거절 사유를 입력하세요"
            placeholderTextColor={Colors.zinc400}
            multiline
            autoFocus
            maxLength={200}
          />
          <View style={modalStyles.btnRow}>
            <ScalePressable style={modalStyles.btnOuter} contentStyle={[modalStyles.btn, modalStyles.cancelBtn]} onPress={handleCancel}>
              <Text style={modalStyles.cancelBtnText}>취소</Text>
            </ScalePressable>
            <ScalePressable style={modalStyles.btnOuter} contentStyle={[modalStyles.btn, modalStyles.confirmBtn]} onPress={handleConfirm}>
              <Text style={modalStyles.confirmBtnText}>거절</Text>
            </ScalePressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Member row ───────────────────────────────────────────────────────────────

function MemberRow({
  member,
  isAnonymous,
  onRemove,
  removing,
  onNavigateToAuthor,
}: {
  member: SpaceMember;
  isAnonymous: boolean;
  onRemove: () => void;
  removing: boolean;
  onNavigateToAuthor?: (authorId: string) => void;
}) {
  const isOperatorRow = member.role === "OPERATOR";
  const label = isAnonymous
    ? (member.accountNickname ?? "알 수 없음")
    : (member.nickname ?? "알 수 없음");
  const canNavigateToProfile = !isAnonymous && !!member.userId && !!onNavigateToAuthor;
  const memberNameContent = (
    <>
      <Text style={styles.rowCardTitle} numberOfLines={1}>
        {label}
      </Text>
      {isOperatorRow && (
        <View style={styles.operatorTag}>
          <Text style={styles.operatorTagText}>공간장</Text>
        </View>
      )}
    </>
  );

  return (
    <View style={styles.rowCard}>
      <View style={styles.rowCardLeft}>
        <View style={styles.avatarPlaceholder}>
          <Feather name="user" size={14} color={Colors.zinc500} />
        </View>
        <View style={styles.rowCardMeta}>
          {canNavigateToProfile ? (
            <Pressable
              style={styles.memberNameRow}
              onPress={() => onNavigateToAuthor?.(member.userId)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`${label} 프로필 보기`}
              testID={`participant-profile-${member.userId}`}
            >
              {memberNameContent}
              <Feather name="chevron-right" size={12} color={Colors.zinc400} />
            </Pressable>
          ) : (
            <View style={styles.memberNameRow}>
              {memberNameContent}
            </View>
          )}
        </View>
      </View>
      {!isOperatorRow && (
        <ScalePressable
          contentStyle={[styles.actionBtn, styles.removeBtn]}
          onPress={onRemove}
          disabled={removing}
        >
          <Text style={styles.removeBtnText}>
            {removing ? "처리 중" : "내보내기"}
          </Text>
        </ScalePressable>
      )}
    </View>
  );
}

// ─── Main Screen ────────────────────────────────────────────────────────────

export default function SpaceParticipantsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, spaceName } = useLocalSearchParams<{ id: string; spaceName?: string }>();
  const { userId } = useUser();
  const queryClient = useQueryClient();

  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const joinContextQuery = useGetSpaceJoinContext(
    id,
    { query: { enabled: !!id && !!userId, queryKey: getUserScopedSpaceJoinContextQueryKey(id, userId) } },
  );
  const space = joinContextQuery.data?.space;
  const myParticipation = joinContextQuery.data?.participation;
  const isOperator = myParticipation?.status === "APPROVED" && myParticipation?.role === "OPERATOR";

  const membersQuery = useListSpaceMembers(
    id,
    { displayContext: "PARTICIPANT_MANAGEMENT" },
    {
      query: {
        enabled: !!id && isOperator,
        queryKey: getListSpaceMembersQueryKey(id, { displayContext: "PARTICIPANT_MANAGEMENT" }),
      },
    },
  );

  const codeRequestsQuery = useListSpaceCodeRequests(
    id,
    { status: ListSpaceCodeRequestsStatus.PENDING },
    {
      query: {
        enabled: !!id && isOperator,
        queryKey: getListSpaceCodeRequestsQueryKey(id, { status: ListSpaceCodeRequestsStatus.PENDING }),
      },
    },
  );

  const updateParticipation = useUpdateSpaceParticipation();
  const updateCodeRequest = useUpdateSpaceCodeRequest();

  const members = (membersQuery.data ?? []) as SpaceMember[];
  const codeRequests = (codeRequestsQuery.data ?? []) as SpaceCodeRequestWithRequester[];

  const isAnonymous = !!space?.isAnonymous;

  const handleNavigateToAuthor = useCallback(
    (authorId: string) => {
      router.push(`/user-profile/${authorId}` as never);
    },
    [router],
  );

  const recruitmentCapacity = space?.maxParticipants ?? null;

  const recruitmentClosed =
    space?.status !== "RECRUITING" ||
    isRecruitmentFull(recruitmentCapacity, space?.participantCount ?? 0);

  const isLoading = joinContextQuery.isLoading || membersQuery.isLoading;
  const isRefreshing =
    joinContextQuery.isFetching || membersQuery.isFetching || codeRequestsQuery.isFetching;

  const refetchAll = useCallback(async () => {
    await Promise.all([
      joinContextQuery.refetch(),
      membersQuery.refetch(),
      codeRequestsQuery.refetch(),
    ]);
  }, [joinContextQuery, membersQuery, codeRequestsQuery]);

  const handleRemoveMember = useCallback(
    (member: SpaceMember) => {
      const label = isAnonymous
        ? (member.accountNickname ?? "이 참여자")
        : (member.nickname ?? "이 참여자");
      Alert.alert(
        "참여자 내보내기",
        `${label}님을 공간에서 내보낼까요? 내보낸 참여자는 더 이상 이 공간에 접근할 수 없어요.`,
        [
          { text: "취소", style: "cancel" },
          {
            text: "내보내기",
            style: "destructive",
            onPress: async () => {
              setRemovingMemberId(member.id);
              try {
                await updateParticipation.mutateAsync({
                  id,
                  participationId: member.id,
                  data: { status: "WITHDRAWN" },
                });
                await Promise.all([membersQuery.refetch(), joinContextQuery.refetch()]);
              } catch {
                Alert.alert("오류", "내보내기에 실패했어요. 다시 시도해주세요.");
              } finally {
                setRemovingMemberId(null);
              }
            },
          },
        ],
      );
    },
    [isAnonymous, updateParticipation, id, membersQuery, joinContextQuery],
  );

  const handleApprove = useCallback(
    async (requestId: string) => {
      if (processingRequestId) return;
      setProcessingRequestId(requestId);
      try {
        await updateCodeRequest.mutateAsync({
          id,
          requestId,
          data: { status: "APPROVED" },
        });
        await Promise.all([
          codeRequestsQuery.refetch(),
          membersQuery.refetch(),
          joinContextQuery.refetch(),
          queryClient.invalidateQueries({
            queryKey: getUserScopedOperatorPendingSpaceCodeRequestsQueryKey(userId),
          }),
        ]);
      } catch (error) {
        Alert.alert(
          "오류",
          getRequestActionErrorMessage(error, "승인에 실패했어요. 다시 시도해주세요."),
        );
      } finally {
        setProcessingRequestId(null);
      }
    },
    [
      processingRequestId,
      updateCodeRequest,
      id,
      codeRequestsQuery,
      membersQuery,
      joinContextQuery,
      queryClient,
      userId,
    ],
  );

  const handleReject = useCallback(
    (requestId: string) => {
      if (processingRequestId) return;
      if (Platform.OS === "ios") {
        Alert.prompt(
          "거절 사유",
          "사유를 입력해주세요. 현재는 공간장에게만 기록됩니다.",
          async (reason) => {
            if (reason === undefined) return;
            const trimmed = reason.trim();
            if (!trimmed) {
              Alert.alert("알림", "거절 사유를 입력해주세요.");
              return;
            }
            setProcessingRequestId(requestId);
            try {
              await updateCodeRequest.mutateAsync({
                id,
                requestId,
                data: { status: "REJECTED", rejectionReason: trimmed },
              });
              await Promise.all([
                codeRequestsQuery.refetch(),
                queryClient.invalidateQueries({
                  queryKey: getUserScopedOperatorPendingSpaceCodeRequestsQueryKey(userId),
                }),
              ]);
            } catch {
              Alert.alert("오류", "거절에 실패했어요. 다시 시도해주세요.");
            } finally {
              setProcessingRequestId(null);
            }
          },
          "plain-text",
        );
      } else {
        setRejectTargetId(requestId);
      }
    },
    [processingRequestId, updateCodeRequest, id, codeRequestsQuery, queryClient, userId],
  );

  const handleRejectConfirm = useCallback(
    async (reason: string) => {
      const requestId = rejectTargetId;
      if (!requestId) return;
      setRejectTargetId(null);
      setProcessingRequestId(requestId);
      try {
        await updateCodeRequest.mutateAsync({
          id,
          requestId,
          data: { status: "REJECTED", rejectionReason: reason },
        });
        await Promise.all([
          codeRequestsQuery.refetch(),
          queryClient.invalidateQueries({
            queryKey: getUserScopedOperatorPendingSpaceCodeRequestsQueryKey(userId),
          }),
        ]);
      } catch {
        Alert.alert("오류", "거절에 실패했어요. 다시 시도해주세요.");
      } finally {
        setProcessingRequestId(null);
      }
    },
    [rejectTargetId, updateCodeRequest, id, codeRequestsQuery, queryClient, userId],
  );

  const headerTitle = spaceName ?? space?.name ?? "참여자 관리";

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <RejectReasonModal
        visible={!!rejectTargetId}
        onCancel={() => setRejectTargetId(null)}
        onConfirm={handleRejectConfirm}
      />

      <View style={styles.header}>
        <HeaderButton
          variant="back"
          onPress={() => router.back()}
          accessibilityLabel="참여자 관리에서 돌아가기"
        />
        <Text style={styles.headerTitle} numberOfLines={1}>
          {headerTitle}
        </Text>
        <View style={{ width: 44 }} />
      </View>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={Colors.zinc400} />
        </View>
      ) : !space ? (
        <View style={styles.centerContainer}>
          <Feather name="alert-circle" size={36} color={Colors.zinc300} />
          <Text style={styles.errorText}>정보를 불러오지 못했어요</Text>
          <ScalePressable style={styles.retryButtonOuter} contentStyle={styles.retryButton} onPress={refetchAll}>
            <Text style={styles.retryButtonText}>다시 시도</Text>
          </ScalePressable>
        </View>
      ) : !isOperator ? (
        <View style={styles.centerContainer}>
          <Feather name="lock" size={36} color={Colors.zinc300} />
          <Text style={styles.errorText}>공간장만 볼 수 있는 화면이에요</Text>
          <ScalePressable style={styles.retryButtonOuter} contentStyle={styles.retryButton} onPress={() => router.back()}>
            <Text style={styles.retryButtonText}>돌아가기</Text>
          </ScalePressable>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={refetchAll} tintColor={Colors.zinc400} />
          }
        >
          {/* ── Summary card ── */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Feather name="users" size={13} color={Colors.zinc400} />
              <Text style={styles.summaryText}>
                확정 인원 {space.participantCount}
                {recruitmentCapacity != null ? `/${recruitmentCapacity}` : ""}명
              </Text>
            </View>
            <View style={[styles.recruitmentBadge, recruitmentClosed ? styles.recruitmentBadgeClosed : styles.recruitmentBadgeOpen]}>
              <Text style={[styles.recruitmentBadgeText, recruitmentClosed ? styles.recruitmentBadgeTextClosed : styles.recruitmentBadgeTextOpen]}>
                {recruitmentClosed ? "모집 마감" : "모집 중"}
              </Text>
            </View>
          </View>

          {/* ── Confirmed participants ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>참여 확정</Text>
              {members.length > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{members.length}</Text>
                </View>
              )}
            </View>
            {membersQuery.isLoading ? (
              <View style={styles.sectionLoading}>
                <ActivityIndicator size="small" color={Colors.zinc400} />
              </View>
            ) : members.length === 0 ? (
              <View style={styles.emptySection}>
                <Text style={styles.emptySectionText}>참여자가 없어요</Text>
              </View>
            ) : (
              <View style={styles.rowList}>
                {members.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    isAnonymous={isAnonymous}
                    onRemove={() => handleRemoveMember(member)}
                    removing={removingMemberId === member.id}
                    onNavigateToAuthor={handleNavigateToAuthor}
                  />
                ))}
              </View>
            )}
          </View>

          {/* ── Code request queue ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>참여 신청</Text>
              {codeRequests.length > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{codeRequests.length}</Text>
                </View>
              )}
            </View>
            {recruitmentClosed && (
              <View style={styles.recruitmentClosedBanner}>
                <Feather name="slash" size={13} color={Colors.zinc500} />
                <Text style={styles.recruitmentClosedText}>모집이 마감되었어요</Text>
              </View>
            )}
            {codeRequestsQuery.isLoading ? (
              <View style={styles.sectionLoading}>
                <ActivityIndicator size="small" color={Colors.zinc400} />
              </View>
            ) : codeRequests.length === 0 ? (
              <View style={styles.emptySection}>
                <Text style={styles.emptySectionText}>대기 중인 요청이 없어요</Text>
              </View>
            ) : (
              <View style={styles.rowList}>
                {codeRequests.map((item) => (
                  <CodeRequestItem
                    key={item.codeRequest.id}
                    item={item}
                    onApprove={() => handleApprove(item.codeRequest.id)}
                    onReject={() => handleReject(item.codeRequest.id)}
                    processing={processingRequestId === item.codeRequest.id}
                    recruitmentClosed={recruitmentClosed}
                  />
                ))}
              </View>
            )}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc200,
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
    flex: 1,
    textAlign: "center",
    marginHorizontal: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  errorText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  retryButtonOuter: {
    marginTop: 4,
  },
  retryButton: {
    backgroundColor: Colors.zinc900,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.white,
  },

  // ─── Summary card ────────────────────────────────────────────────────────
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: Spacing.screenPx,
    marginTop: 16,
    marginBottom: 8,
    backgroundColor: Colors.zinc50,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  summaryText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc800,
  },
  recruitmentBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  recruitmentBadgeOpen: {
    backgroundColor: Colors.noticeAccentSoft,
  },
  recruitmentBadgeClosed: {
    backgroundColor: Colors.zinc200,
  },
  recruitmentBadgeText: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "600",
  },
  recruitmentBadgeTextOpen: {
    color: Colors.noticeAccent,
  },
  recruitmentBadgeTextClosed: {
    color: Colors.zinc500,
  },

  // ─── Sections ────────────────────────────────────────────────────────────
  section: {
    gap: 10,
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: Spacing.screenPx,
  },
  sectionLabel: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "600",
    color: Colors.zinc500,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  countBadge: {
    backgroundColor: Colors.noticeAccentSoft,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: "center",
  },
  countBadgeText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.noticeAccent,
    fontWeight: "600",
  },
  sectionLoading: {
    paddingVertical: 20,
    alignItems: "center",
  },
  emptySection: {
    marginHorizontal: Spacing.screenPx,
    paddingVertical: 16,
    alignItems: "center",
    backgroundColor: Colors.zinc50,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
  },
  emptySectionText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
  },
  recruitmentClosedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: Spacing.screenPx,
    backgroundColor: Colors.zinc100,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  recruitmentClosedText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
  },

  // ─── Row card (shared by member rows & code request rows) ────────────────
  rowList: {
    marginHorizontal: Spacing.screenPx,
    gap: 8,
  },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.zinc50,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    padding: 14,
    gap: 10,
  },
  rowCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCardMeta: {
    flex: 1,
    gap: 2,
  },
  rowCardTitle: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc800,
  },
  rowCardSubtitle: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  rowCardActions: {
    flexDirection: "row",
    gap: 6,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  rejectBtn: {
    backgroundColor: Colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
  },
  rejectBtnText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
    fontWeight: "600",
  },
  approveBtn: {
    backgroundColor: Colors.zinc900,
  },
  approveBtnDisabled: {
    backgroundColor: Colors.zinc300,
  },
  approveBtnText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.white,
    fontWeight: "600",
  },
  removeBtn: {
    backgroundColor: Colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
  },
  removeBtnText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
    fontWeight: "600",
  },

  // ─── Member row extras ─────────────────────────────────────────────────
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  operatorTag: {
    backgroundColor: Colors.zinc200,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  operatorTagText: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "600",
    color: Colors.zinc600,
  },
});

// ─── Modal Styles ─────────────────────────────────────────────────────────────

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingTop: 20,
    gap: 12,
  },
  title: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  subtitle: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
    lineHeight: 18,
    marginTop: -4,
  },
  input: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc800,
    borderWidth: 1,
    borderColor: Colors.zinc300,
    borderRadius: 10,
    padding: 12,
    minHeight: 80,
    textAlignVertical: "top",
    backgroundColor: Colors.zinc50,
  },
  btnRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  btnOuter: {
    flex: 1,
  },
  btn: {
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelBtn: {
    backgroundColor: Colors.zinc100,
  },
  cancelBtnText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc600,
  },
  confirmBtn: {
    backgroundColor: Colors.zinc900,
  },
  confirmBtnText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
});
