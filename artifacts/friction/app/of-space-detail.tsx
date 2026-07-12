import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  Alert,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";
import { useUser } from "@/contexts/UserContext";
import {
  useGetSpaceJoinContext,
  getGetSpaceJoinContextQueryKey,
  useListSpaceRounds,
  useListSpaceLetters,
  useListSpaceCodeRequests,
  useUpdateSpaceCodeRequest,
  useUpdateSpace,
  ListSpaceCodeRequestsStatus,
} from "@workspace/api-client-react";
import type {
  SpaceRound,
  SpaceLetter,
  SpaceCodeRequestWithRequester,
  SpaceWithCreatorInfo,
} from "@workspace/api-client-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function roundStatusLabel(status: string): string {
  if (status === "ACTIVE") return "진행 중";
  if (status === "UPCOMING") return "예정";
  if (status === "COMPLETED") return "완료";
  return status;
}

function roundStatusColor(status: string): string {
  if (status === "ACTIVE") return Colors.noticeAccent;
  if (status === "UPCOMING") return Colors.zinc400;
  return Colors.zinc300;
}

// ─── Round Card ──────────────────────────────────────────────────────────────

const LETTER_TYPE_LABEL: Record<string, string> = {
  OPENING: "오프닝",
  CENTER: "센터",
  REPLY: "답장",
};

function LetterChip({ type }: { type: string }) {
  const isOpening = type === "OPENING";
  return (
    <View
      style={[
        styles.letterChip,
        isOpening ? styles.letterChipOpening : styles.letterChipCenter,
      ]}
    >
      <Feather
        name={isOpening ? "mail" : "edit-3"}
        size={9}
        color={isOpening ? Colors.noticeAccent : Colors.zinc500}
      />
      <Text
        style={[
          styles.letterChipText,
          { color: isOpening ? Colors.noticeAccent : Colors.zinc500 },
        ]}
      >
        {LETTER_TYPE_LABEL[type] ?? type}
      </Text>
    </View>
  );
}

function RoundCard({
  round,
  letters,
}: {
  round: SpaceRound;
  letters: SpaceLetter[];
}) {
  const color = roundStatusColor(round.status);
  const openingLetters = letters.filter((l) => l.letterType === "OPENING");
  const centerLetters = letters.filter((l) => l.letterType === "CENTER");
  const hasLetters = letters.length > 0;

  return (
    <View style={styles.roundCard}>
      <View style={styles.roundCardTop}>
        <View style={[styles.roundStatusDot, { backgroundColor: color }]} />
        <Text style={[styles.roundStatusText, { color }]}>
          {roundStatusLabel(round.status)}
        </Text>
      </View>
      <Text style={styles.roundNumber}>{round.roundNumber}회차</Text>
      {round.title ? (
        <Text style={styles.roundTitle} numberOfLines={1}>
          {round.title}
        </Text>
      ) : (
        <Text style={styles.roundTitleEmpty} numberOfLines={1}>
          제목 없음
        </Text>
      )}
      {/* Letter cards */}
      {hasLetters ? (
        <View style={styles.letterChipRow}>
          {openingLetters.length > 0 && <LetterChip type="OPENING" />}
          {centerLetters.length > 0 && (
            <View style={[styles.letterChip, styles.letterChipCenter]}>
              <Feather name="edit-3" size={9} color={Colors.zinc500} />
              <Text style={[styles.letterChipText, { color: Colors.zinc500 }]}>
                센터 {centerLetters.length}
              </Text>
            </View>
          )}
        </View>
      ) : round.status === "UPCOMING" ? (
        <Text style={styles.letterPlaceholder}>편지 준비 중</Text>
      ) : round.status === "ACTIVE" ? (
        <Text style={styles.letterPlaceholder}>편지 작성 가능</Text>
      ) : (
        <Text style={styles.letterPlaceholder}>편지 없음</Text>
      )}
    </View>
  );
}

// ─── Code Request Item ────────────────────────────────────────────────────────

function CodeRequestItem({
  item,
  onApprove,
  onReject,
  processing,
}: {
  item: SpaceCodeRequestWithRequester;
  onApprove: () => void;
  onReject: () => void;
  processing: boolean;
}) {
  return (
    <View style={styles.codeRequestItem}>
      <View style={styles.codeRequestLeft}>
        <View style={styles.codeRequestAvatarPlaceholder}>
          <Feather name="user" size={14} color={Colors.zinc500} />
        </View>
        <View style={styles.codeRequestMeta}>
          <Text style={styles.codeRequestNickname} numberOfLines={1}>
            {item.requesterNickname ?? "알 수 없음"}
          </Text>
          <Text style={styles.codeRequestCode}>
            코드: {item.codeRequest.code}
          </Text>
        </View>
      </View>
      <View style={styles.codeRequestActions}>
        <ScalePressable
          style={[styles.actionBtn, styles.rejectBtn]}
          onPress={onReject}
          disabled={processing}
        >
          <Text style={styles.rejectBtnText}>거절</Text>
        </ScalePressable>
        <ScalePressable
          style={[styles.actionBtn, styles.approveBtn]}
          onPress={onApprove}
          disabled={processing}
        >
          <Text style={styles.approveBtnText}>
            {processing ? "처리 중" : "승인"}
          </Text>
        </ScalePressable>
      </View>
    </View>
  );
}

// ─── Description section ──────────────────────────────────────────────────────

function DescriptionSection({
  space,
  isOperator,
  userId,
  onSaved,
}: {
  space: SpaceWithCreatorInfo;
  isOperator: boolean;
  userId: string;
  onSaved: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const updateSpace = useUpdateSpace();

  const handleStart = useCallback(() => {
    setDraft(space.description ?? "");
    setIsEditing(true);
  }, [space.description]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await updateSpace.mutateAsync({
        id: space.id,
        data: { description: draft.trim() || null },
      });
      setIsEditing(false);
      onSaved();
    } catch {
      Alert.alert("오류", "저장에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }, [space.id, draft, updateSpace, userId, onSaved]);

  if (isEditing) {
    return (
      <View style={styles.descEditContainer}>
        <TextInput
          style={styles.descInput}
          value={draft}
          onChangeText={setDraft}
          multiline
          placeholder="공간 설명을 입력해주세요"
          placeholderTextColor={Colors.zinc400}
          autoFocus
          maxLength={200}
        />
        <View style={styles.descEditButtons}>
          <ScalePressable
            style={[styles.descEditBtn, styles.descCancelBtn]}
            onPress={() => setIsEditing(false)}
            disabled={saving}
          >
            <Text style={styles.descCancelBtnText}>취소</Text>
          </ScalePressable>
          <ScalePressable
            style={[styles.descEditBtn, styles.descSaveBtn]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.descSaveBtnText}>
              {saving ? "저장 중..." : "저장"}
            </Text>
          </ScalePressable>
        </View>
      </View>
    );
  }

  return (
    <ScalePressable
      style={styles.descRow}
      onPress={isOperator ? handleStart : undefined}
      disabled={!isOperator}
    >
      {space.description ? (
        <Text style={styles.spaceDesc}>{space.description}</Text>
      ) : (
        <Text style={styles.spaceDescEmpty}>
          {isOperator ? "+ 설명 추가하기" : "설명 없음"}
        </Text>
      )}
      {isOperator && (
        <Feather
          name="edit-2"
          size={13}
          color={Colors.zinc400}
          style={styles.descEditIcon}
        />
      )}
    </ScalePressable>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SpaceDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useUser();
  const queryClient = useQueryClient();

  const [processingRequestId, setProcessingRequestId] = useState<string | null>(
    null,
  );

  const joinContextQuery = useGetSpaceJoinContext(
    id,
    { userId },
    { query: { enabled: !!id && !!userId } },
  );

  const roundsQuery = useListSpaceRounds(id, {
    query: { enabled: !!id },
  });

  const lettersQuery = useListSpaceLetters(id, {
    query: { enabled: !!id },
  });

  const joinContext = joinContextQuery.data;
  const space = joinContext?.space;
  const myParticipation = joinContext?.participation;
  const isOperator = myParticipation?.role === "OPERATOR";

  const codeRequestsQuery = useListSpaceCodeRequests(
    id,
    { status: ListSpaceCodeRequestsStatus.PENDING },
    { query: { enabled: !!id && isOperator } },
  );

  const updateCodeRequest = useUpdateSpaceCodeRequest();

  const rounds = (roundsQuery.data ?? []) as SpaceRound[];
  const letters = (lettersQuery.data ?? []) as SpaceLetter[];
  const codeRequests = (
    codeRequestsQuery.data ?? []
  ) as SpaceCodeRequestWithRequester[];

  // Group letters by round id for O(1) lookup in carousel
  const lettersByRound = useMemo<Record<string, SpaceLetter[]>>(() => {
    const map: Record<string, SpaceLetter[]> = {};
    for (const letter of letters) {
      const key = letter.spaceRoundId ?? "__none__";
      (map[key] ??= []).push(letter);
    }
    return map;
  }, [letters]);

  const isLoading = joinContextQuery.isLoading;
  const isError = joinContextQuery.isError;
  const isRefreshing =
    joinContextQuery.isFetching ||
    roundsQuery.isFetching ||
    lettersQuery.isFetching ||
    (isOperator && codeRequestsQuery.isFetching);

  const refetchAll = useCallback(async () => {
    await Promise.all([
      joinContextQuery.refetch(),
      roundsQuery.refetch(),
      lettersQuery.refetch(),
      isOperator ? codeRequestsQuery.refetch() : Promise.resolve(),
    ]);
  }, [joinContextQuery, roundsQuery, lettersQuery, codeRequestsQuery, isOperator]);

  const handleDescriptionSaved = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: getGetSpaceJoinContextQueryKey(id, { userId }),
    });
  }, [queryClient, id, userId]);

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
        await codeRequestsQuery.refetch();
      } catch {
        Alert.alert("오류", "승인에 실패했어요. 다시 시도해주세요.");
      } finally {
        setProcessingRequestId(null);
      }
    },
    [processingRequestId, updateCodeRequest, id, userId, codeRequestsQuery],
  );

  const handleReject = useCallback(
    (requestId: string) => {
      if (processingRequestId) return;
      Alert.alert("참여 거절", "이 코드 요청을 거절하시겠어요?", [
        { text: "취소", style: "cancel" },
        {
          text: "거절",
          style: "destructive",
          onPress: async () => {
            setProcessingRequestId(requestId);
            try {
              await updateCodeRequest.mutateAsync({
                id,
                requestId,
                data: { status: "REJECTED" },
              });
              await codeRequestsQuery.refetch();
            } catch {
              Alert.alert("오류", "거절에 실패했어요. 다시 시도해주세요.");
            } finally {
              setProcessingRequestId(null);
            }
          },
        },
      ]);
    },
    [processingRequestId, updateCodeRequest, id, userId, codeRequestsQuery],
  );

  // ─── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <ScalePressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={20} color={Colors.zinc600} />
          </ScalePressable>
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator color={Colors.zinc400} />
        </View>
      </View>
    );
  }

  // ─── Error ──────────────────────────────────────────────────────────────────
  if (isError || !space) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <ScalePressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={20} color={Colors.zinc600} />
          </ScalePressable>
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.centerContainer}>
          <Feather name="alert-circle" size={36} color={Colors.zinc300} />
          <Text style={styles.errorText}>공간을 불러오지 못했어요</Text>
          <ScalePressable style={styles.retryButton} onPress={refetchAll}>
            <Text style={styles.retryButtonText}>다시 시도</Text>
          </ScalePressable>
        </View>
      </View>
    );
  }

  // ─── Non-participant ────────────────────────────────────────────────────────
  if (!myParticipation) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <ScalePressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={20} color={Colors.zinc600} />
          </ScalePressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {space.name}
          </Text>
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.centerContainer}>
          <Feather name="lock" size={36} color={Colors.zinc300} />
          <Text style={styles.errorText}>참여하지 않은 공간이에요</Text>
          <Text style={styles.errorSubText}>
            초대 코드로 참여 신청 후 운영자 승인을 받으세요
          </Text>
          <ScalePressable style={styles.retryButton} onPress={() => router.back()}>
            <Text style={styles.retryButtonText}>돌아가기</Text>
          </ScalePressable>
        </View>
      </View>
    );
  }

  const statusColor = spaceStatusColor(space.status);
  const statusText = spaceStatusLabel(space.status);

  // ─── Main content ───────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <ScalePressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </ScalePressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {space.name}
        </Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refetchAll}
            tintColor={Colors.zinc400}
          />
        }
      >
        {/* ── Space info card ── */}
        <View style={styles.infoCard}>
          <View style={styles.badgeRow}>
            <View style={[styles.statusBadge, { borderColor: statusColor }]}>
              <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                {statusText}
              </Text>
            </View>
            <Text style={styles.roleBadge}>
              {isOperator ? "운영자" : "참여자"}
            </Text>
            {space.isAnonymous && (
              <View style={styles.anonBadge}>
                <Feather name="eye-off" size={10} color={Colors.zinc400} />
                <Text style={styles.anonBadgeText}>익명</Text>
              </View>
            )}
          </View>

          <Text style={styles.spaceName}>{space.name}</Text>

          <DescriptionSection
            space={space}
            isOperator={isOperator}
            userId={userId}
            onSaved={handleDescriptionSaved}
          />

          <View style={styles.metaRow}>
            <Feather name="users" size={13} color={Colors.zinc400} />
            <Text style={styles.metaText}>
              {space.participantCount}
              {space.maxParticipants ? `/${space.maxParticipants}` : ""}명
            </Text>
            <View style={styles.metaDot} />
            <Feather name="repeat" size={13} color={Colors.zinc400} />
            <Text style={styles.metaText}>{space.roundCount}회차 계획</Text>
          </View>
        </View>

        {/* ── Round carousel ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>회차</Text>
          {roundsQuery.isLoading ? (
            <View style={styles.sectionLoading}>
              <ActivityIndicator size="small" color={Colors.zinc400} />
            </View>
          ) : rounds.length === 0 ? (
            <View style={styles.emptySection}>
              <Text style={styles.emptySectionText}>
                {isOperator
                  ? "아직 회차가 없어요"
                  : "진행 중인 회차가 없어요"}
              </Text>
            </View>
          ) : (
            <FlatList
              data={rounds}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <RoundCard
                  round={item}
                  letters={lettersByRound[item.id] ?? []}
                />
              )}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.roundsListContent}
              ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
              scrollEnabled
            />
          )}
        </View>

        {/* ── Code requests (operator only) ── */}
        {isOperator && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>참여 요청</Text>
              {codeRequests.length > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{codeRequests.length}</Text>
                </View>
              )}
            </View>
            {codeRequestsQuery.isLoading ? (
              <View style={styles.sectionLoading}>
                <ActivityIndicator size="small" color={Colors.zinc400} />
              </View>
            ) : codeRequests.length === 0 ? (
              <View style={styles.emptySection}>
                <Text style={styles.emptySectionText}>
                  대기 중인 요청이 없어요
                </Text>
              </View>
            ) : (
              <View style={styles.codeRequestList}>
                {codeRequests.map((item) => (
                  <CodeRequestItem
                    key={item.codeRequest.id}
                    item={item}
                    onApprove={() => handleApprove(item.codeRequest.id)}
                    onReject={() => handleReject(item.codeRequest.id)}
                    processing={processingRequestId === item.codeRequest.id}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        {/* ── Invite code (operator only) ── */}
        {isOperator && space.inviteCode && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>초대 코드</Text>
            <View style={styles.inviteCodeCard}>
              <Text style={styles.inviteCode}>{space.inviteCode}</Text>
              <Text style={styles.inviteCodeHint}>
                참여자에게 이 코드를 공유하세요
              </Text>
            </View>
          </View>
        )}

        {/* ── Operator management actions ── */}
        {isOperator && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>운영 관리</Text>
            <View style={styles.operatorActions}>
              <ScalePressable
                style={styles.operatorActionRow}
                onPress={() =>
                  router.push({
                    pathname: "/of-space-rounds" as never,
                    params: { id, spaceName: space.name },
                  })
                }
              >
                <View style={styles.operatorActionLeft}>
                  <View style={styles.operatorActionIcon}>
                    <Feather name="layers" size={15} color={Colors.zinc600} />
                  </View>
                  <Text style={styles.operatorActionText}>회차 관리</Text>
                </View>
                <Feather name="chevron-right" size={16} color={Colors.zinc400} />
              </ScalePressable>

              <View style={styles.operatorDivider} />

              <ScalePressable
                style={styles.operatorActionRow}
                onPress={() =>
                  router.push({
                    pathname: "/of-space-schedule-send" as never,
                    params: { id },
                  })
                }
              >
                <View style={styles.operatorActionLeft}>
                  <View style={styles.operatorActionIcon}>
                    <Feather name="send" size={15} color={Colors.zinc600} />
                  </View>
                  <Text style={styles.operatorActionText}>글 예약 발송</Text>
                </View>
                <Feather name="chevron-right" size={16} color={Colors.zinc400} />
              </ScalePressable>

              {space.status !== "ARCHIVED" && (
                <>
                  <View style={styles.operatorDivider} />
                  <ScalePressable
                    style={styles.operatorActionRow}
                    onPress={() =>
                      router.push({
                        pathname: "/of-space-archive" as never,
                        params: { id, spaceName: space.name },
                      })
                    }
                  >
                    <View style={styles.operatorActionLeft}>
                      <View style={styles.operatorActionIcon}>
                        <Feather name="archive" size={15} color={Colors.zinc400} />
                      </View>
                      <Text style={[styles.operatorActionText, { color: Colors.zinc400 }]}>
                        공간 보관
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={16} color={Colors.zinc300} />
                  </ScalePressable>
                </>
              )}
            </View>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
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
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
    flex: 1,
    textAlign: "center",
    marginHorizontal: 8,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: Spacing.screenPx,
  },
  errorText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc500,
  },
  errorSubText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc400,
    textAlign: "center",
    lineHeight: 18,
    marginTop: -4,
  },
  retryButton: {
    marginTop: 4,
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },

  // ─── Info card ─────────────────────────────────────────────────────────────
  infoCard: {
    marginHorizontal: Spacing.screenPx,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: Colors.zinc50,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    padding: 20,
    gap: 10,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
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
  anonBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: Colors.zinc100,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  anonBadgeText: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc400,
  },
  spaceName: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
    lineHeight: 26,
  },

  // ─── Description ───────────────────────────────────────────────────────────
  descRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    minHeight: 20,
  },
  spaceDesc: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc600,
    flex: 1,
    lineHeight: 20,
  },
  spaceDescEmpty: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
    flex: 1,
  },
  descEditIcon: {
    marginTop: 2,
  },
  descEditContainer: {
    gap: 8,
  },
  descInput: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc700,
    borderWidth: 1,
    borderColor: Colors.zinc300,
    borderRadius: 10,
    padding: 12,
    minHeight: 80,
    textAlignVertical: "top",
    backgroundColor: Colors.white,
  },
  descEditButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  descEditBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  descCancelBtn: {
    backgroundColor: Colors.zinc100,
  },
  descCancelBtnText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc600,
    fontWeight: "600",
  },
  descSaveBtn: {
    backgroundColor: Colors.zinc900,
  },
  descSaveBtnText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.white,
    fontWeight: "600",
  },

  // ─── Meta row ──────────────────────────────────────────────────────────────
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexWrap: "wrap",
    marginTop: 2,
  },
  metaText: {
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

  // ─── Section ───────────────────────────────────────────────────────────────
  section: {
    marginTop: 20,
    gap: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: Spacing.screenPx,
  },
  sectionLabel: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: "600",
    color: Colors.zinc400,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingHorizontal: Spacing.screenPx,
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
    color: Colors.zinc400,
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
    fontSize: 11,
    color: Colors.noticeAccent,
    fontWeight: "600",
  },

  // ─── Round cards ───────────────────────────────────────────────────────────
  roundsListContent: {
    paddingHorizontal: Spacing.screenPx,
  },
  roundCard: {
    width: 130,
    backgroundColor: Colors.zinc50,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    padding: 14,
    gap: 6,
  },
  roundCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  roundStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  roundStatusText: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: "600",
  },
  roundNumber: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
  },
  roundTitle: {
    ...Typography.body,
    fontSize: 12,
    color: Colors.zinc500,
    lineHeight: 16,
  },
  roundTitleEmpty: {
    ...Typography.body,
    fontSize: 12,
    color: Colors.zinc300,
  },
  letterChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
  },
  letterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  letterChipOpening: {
    backgroundColor: Colors.noticeAccentSoft,
  },
  letterChipCenter: {
    backgroundColor: Colors.zinc100,
  },
  letterChipText: {
    ...Typography.caption,
    fontSize: 10,
    fontWeight: "600",
  },
  letterPlaceholder: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc300,
    marginTop: 4,
  },

  // ─── Code request items ────────────────────────────────────────────────────
  codeRequestList: {
    marginHorizontal: Spacing.screenPx,
    gap: 8,
  },
  codeRequestItem: {
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
  codeRequestLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  codeRequestAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  codeRequestMeta: {
    flex: 1,
    gap: 2,
  },
  codeRequestNickname: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc800,
  },
  codeRequestCode: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc400,
  },
  codeRequestActions: {
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
  approveBtnText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.white,
    fontWeight: "600",
  },

  // ─── Operator actions ──────────────────────────────────────────────────────
  operatorActions: {
    marginHorizontal: Spacing.screenPx,
    backgroundColor: Colors.zinc50,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    overflow: "hidden",
  },
  operatorActionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  operatorActionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  operatorActionIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: Colors.zinc200,
    alignItems: "center",
    justifyContent: "center",
  },
  operatorActionText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc800,
  },
  operatorDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.zinc200,
    marginLeft: 58,
  },

  // ─── Invite code card ──────────────────────────────────────────────────────
  inviteCodeCard: {
    marginHorizontal: Spacing.screenPx,
    backgroundColor: Colors.zinc50,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    padding: 16,
    alignItems: "center",
    gap: 6,
  },
  inviteCode: {
    ...Typography.bodySemiBold,
    fontSize: 24,
    color: Colors.zinc900,
    letterSpacing: 3,
  },
  inviteCodeHint: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
});
