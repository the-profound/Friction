import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";
import HeaderButton from "@/components/shared/HeaderButton";
import { SpaceInfoNote } from "@/components/SpaceInfoNote/SpaceInfoNote";
import { SpaceCopy } from "@/constants/spaceCopy";
import SubmitButton from "@/components/SubmitButton/SubmitButton";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import { useToast } from "@/contexts/ToastContext";
import { useUser } from "@/contexts/UserContext";
import { isRecruitmentFull } from "@/lib/spaceRecruitment";
import { getUserScopedSpaceJoinContextQueryKey } from "@/lib/spaceJoinContextQuery";
import {
  SPACE_NICKNAME_MAX_LENGTH,
  validateSpaceNickname,
} from "@/lib/spaceJoinValidation";
import {
  getSpaceByInviteCode,
  getSpaceJoinContext,
  getListSpacesQueryKey,
  useCreateSpaceCodeRequest,
  useUpdateSpaceCodeRequest,
  useUpdateSpaceInvitation,
} from "@workspace/api-client-react";
import type {
  SpaceWithCreatorInfo,
  SpaceJoinContext,
} from "@workspace/api-client-react";

type Step =
  | "code_input"
  | "code_lookup_loading"
  | "space_preview"
  | "context_loading"
  | "invitation"
  | "code_pending"
  | "code_rejected"
  | "already_member"
  | "space_full"
  | "space_archived"
  | "space_not_found"
  | "context_error";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

const WEEKDAY_LABELS_JOIN = ["일", "월", "화", "수", "목", "금", "토"];

function scheduleTypeLabelJoin(
  scheduleType: string | null | undefined,
  weekdays: number[] | null | undefined,
  centerInterval: number,
): string {
  if (scheduleType === "WEEKDAY") {
    if (weekdays && weekdays.length > 0) {
      return `요일 지정 (${weekdays.map((w) => WEEKDAY_LABELS_JOIN[w]).join(", ")})`;
    }
    return "요일 지정";
  }
  return `${centerInterval}일 간격`;
}

type JoinMutationErrorCode =
  | "INVITE_CODE_MISMATCH"
  | "DUPLICATE_CODE_REQUEST"
  | "MISSING_NICKNAME"
  | "NICKNAME_CONFLICT"
  | "ALREADY_PARTICIPATING"
  | "SPACE_FULL"
  | "SPACE_NOT_RECRUITING"
  | "ALREADY_RESPONDED";

function getJoinMutationErrorCode(error: unknown): JoinMutationErrorCode | null {
  const code =
    error != null &&
    typeof error === "object" &&
    "data" in error &&
    (error as { data?: { code?: unknown } }).data?.code;
  return typeof code === "string" ? code as JoinMutationErrorCode : null;
}

function getJoinMutationErrorMessage(error: unknown, fallback: string): string {
  const code = getJoinMutationErrorCode(error);
  const messages: Partial<Record<JoinMutationErrorCode, string>> = {
    INVITE_CODE_MISMATCH: "초대 문구가 이 공간과 일치하지 않아요. 다시 확인해주세요.",
    DUPLICATE_CODE_REQUEST: "이미 이 공간에 참여 신청을 보냈어요.",
    MISSING_NICKNAME: "공간 닉네임을 입력해주세요.",
    NICKNAME_CONFLICT: "이미 사용 중인 공간 닉네임이에요. 다른 이름을 입력해주세요.",
    ALREADY_PARTICIPATING: "이미 이 공간에 참여하고 있어요.",
    SPACE_FULL: "모집 인원이 모두 찼습니다.",
    SPACE_NOT_RECRUITING: "모집이 마감된 공간이에요.",
    ALREADY_RESPONDED: "이미 처리된 참여 요청이에요.",
  };
  if (code && messages[code]) return messages[code];
  const responseError =
    error != null &&
    typeof error === "object" &&
    "data" in error &&
    (error as { data?: { error?: unknown } }).data?.error;
  if (typeof responseError === "string") {
    return responseError;
  }
  return fallback;
}

function isSpaceNicknameConflict(error: unknown): boolean {
  return getJoinMutationErrorCode(error) === "NICKNAME_CONFLICT";
}

function shouldReloadJoinContext(error: unknown): boolean {
  const code = getJoinMutationErrorCode(error);
  return code === "DUPLICATE_CODE_REQUEST" ||
    code === "ALREADY_PARTICIPATING" ||
    code === "SPACE_FULL" ||
    code === "SPACE_NOT_RECRUITING" ||
    code === "ALREADY_RESPONDED";
}

function SpaceNicknameField({
  value,
  error,
  onChangeText,
}: {
  value: string;
  error: string | null;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.nicknameField}>
      <Text style={styles.nicknameLabel}>이 공간에서 사용할 닉네임 *</Text>
      <TextInput
        style={[styles.codeInput, !!error && styles.codeInputError]}
        placeholder="예: 달빛"
        placeholderTextColor={Colors.zinc400}
        value={value}
        onChangeText={onChangeText}
        maxLength={SPACE_NICKNAME_MAX_LENGTH}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="공간 닉네임"
      />
      <Text style={styles.nicknameHint}>
        시작 전에는 모두 ‘참여자’로 표시되고, 시작 후 이 닉네임으로 표시돼요.
      </Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function SpaceInfoCard({ space }: { space: SpaceWithCreatorInfo }) {
  const isRecruiting = space.status === "RECRUITING";
  const isActive = space.status === "ACTIVE";
  const recruitmentCapacity = space.maxParticipants ?? null;
  const isFull = isRecruitmentFull(recruitmentCapacity, space.participantCount);

  return (
    <View style={styles.infoCard}>
      <View style={styles.infoCardIconWrap}>
        <Feather name="book-open" size={28} color="#7C3AED" />
      </View>
      <Text style={styles.infoCardName}>{space.name}</Text>
      {space.description ? (
        <Text style={styles.infoCardDesc}>{space.description}</Text>
      ) : null}
      <View style={styles.infoCardDivider} />
      <View style={styles.infoRows}>
        <InfoRow icon="repeat" label="예정 회차 수" value={`${space.roundCount}회`} />
        {(space as any).plannedStartsAt ? (
          <InfoRow icon="calendar" label="시작 예정일" value={formatDate((space as any).plannedStartsAt)} />
        ) : null}
        <InfoRow
          icon="clock"
          label="진행 방식"
          value={scheduleTypeLabelJoin(
            (space as any).scheduleType,
            (space as any).weekdays,
            space.defaultCenterInterval,
          )}
        />
        <InfoRow
          icon="users"
          label="모집 인원"
          value={
            recruitmentCapacity != null
              ? `${space.participantCount} / ${recruitmentCapacity}명`
              : `${space.participantCount}명 참여 중`
          }
          accent={isFull ? "red" : undefined}
        />
        <InfoRow
          icon="user"
          label="익명 여부"
          value={space.isAnonymous ? "익명 참여" : "실명 참여"}
        />
        {space.isAnonymous ? (
          <InfoRow icon="shield" label="공간장" value="익명 공간장" />
        ) : space.creatorNickname ? (
          <InfoRow icon="shield" label="공간장" value={space.creatorNickname} />
        ) : null}
        {space.isAnonymous && (
          <View style={styles.anonymousNoteRow}>
            <SpaceInfoNote variant="popup" text={SpaceCopy.join_anonymous} />
            <Text style={styles.anonymousNoteText}>익명 참여 공간이에요</Text>
          </View>
        )}
        <InfoRow
          icon="activity"
          label="모집 상태"
          value={
            isRecruiting
              ? "모집 중"
              : isActive
              ? "진행 중 (모집 마감)"
              : "종료됨"
          }
          accent={!isRecruiting ? "gray" : undefined}
        />
      </View>
      {!isActive && (
        <View style={styles.roundsDisclaimerRow}>
          <SpaceInfoNote variant="bare" text={SpaceCopy.round_notFinalizedYet} />
        </View>
      )}
    </View>
  );
}

function InfoRow({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  value: string;
  accent?: "red" | "gray";
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoRowIcon}>
        <Feather name={icon} size={14} color={Colors.zinc400} />
      </View>
      <Text style={styles.infoRowLabel}>{label}</Text>
      <Text
        style={[
          styles.infoRowValue,
          accent === "red" && styles.infoRowValueRed,
          accent === "gray" && styles.infoRowValueGray,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

export default function SpaceJoinScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId } = useUser();
  const { showToast } = useToast();
  const params = useLocalSearchParams<{
    spaceId?: string;
    inviteCode?: string;
    invitationId?: string;
    codeRequestId?: string;
  }>();

  const hasDeepLink = !!(params.spaceId || params.invitationId || params.codeRequestId);
  const cameFromList = hasDeepLink;

  const [step, setStep] = useState<Step>(
    hasDeepLink ? "context_loading" : "code_input",
  );
  const [inviteCode, setInviteCode] = useState(params.inviteCode ?? "");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [spaceNickname, setSpaceNickname] = useState("");
  const [spaceNicknameError, setSpaceNicknameError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(params.spaceId ?? null);
  const [foundSpace, setFoundSpace] = useState<SpaceWithCreatorInfo | null>(null);
  const [joinContext, setJoinContext] = useState<SpaceJoinContext | null>(null);
  const [declineConfirmVisible, setDeclineConfirmVisible] = useState(false);
  const [cancelConfirmVisible, setCancelConfirmVisible] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const createCodeRequest = useCreateSpaceCodeRequest();
  const updateCodeRequest = useUpdateSpaceCodeRequest();
  const updateInvitation = useUpdateSpaceInvitation();

  const refreshJoinCaches = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListSpacesQueryKey() }),
      spaceId
        ? queryClient.invalidateQueries({
            queryKey: getUserScopedSpaceJoinContextQueryKey(spaceId, userId),
          })
        : Promise.resolve(),
    ]);
  }, [queryClient, spaceId, userId]);

  const loadJoinContext = useCallback(
    async (
      sid: string,
      opts?: { invitationId?: string; codeRequestId?: string },
    ) => {
      try {
        const ctx = await getSpaceJoinContext(sid);
        setJoinContext(ctx);
        const { space, participation, invitation, codeRequest } = ctx;

        if (participation?.status === "APPROVED") {
          setStep("already_member");
          return;
        }
        if (space.status === "ARCHIVED") {
          setStep("space_archived");
          return;
        }
        const isFull = isRecruitmentFull(
          space.maxParticipants,
          space.participantCount,
        );

        // When entering via invitationId, only treat the matching invitation as valid.
        const targetInvitation =
          opts?.invitationId != null
            ? invitation?.id === opts.invitationId
              ? invitation
              : null
            : invitation;

        // When entering via codeRequestId, only treat the matching request as valid.
        const targetCodeRequest =
          opts?.codeRequestId != null
            ? codeRequest?.id === opts.codeRequestId
              ? codeRequest
              : null
            : codeRequest;

        if (targetInvitation?.status === "PENDING") {
          setStep("invitation");
          return;
        }
        if (targetCodeRequest?.status === "PENDING") {
          setStep("code_pending");
          return;
        }
        if (targetCodeRequest?.status === "REJECTED") {
          setStep("code_rejected");
          return;
        }
        if (isFull) {
          setStep("space_full");
          return;
        }
        setFoundSpace(space);
        setStep("space_preview");
      } catch (e: unknown) {
        const status = (e as { status?: number }).status;
        if (status === 404) {
          setStep("space_not_found");
        } else {
          setStep("context_error");
        }
      }
    },
    [userId],
  );

  useEffect(() => {
    if (step === "context_loading") {
      if (spaceId) {
        loadJoinContext(spaceId, {
          invitationId: params.invitationId,
          codeRequestId: params.codeRequestId,
        });
      } else {
        // Deep-link without spaceId: cannot resolve — show error.
        setStep("context_error");
      }
    }
  }, [step, spaceId, loadJoinContext, params.invitationId, params.codeRequestId]);

  useEffect(() => {
    if (step === "code_pending" && spaceId) {
      pollTimerRef.current = setInterval(async () => {
        try {
          const ctx = await getSpaceJoinContext(spaceId);
          setJoinContext(ctx);
          const req = ctx.codeRequest;
          if (req?.status === "APPROVED") {
            clearInterval(pollTimerRef.current!);
            await refreshJoinCaches();
            showToast({ message: "참여가 승인되었어요!", type: "success" });
            router.replace("/(tabs)/of");
          } else if (req?.status === "REJECTED") {
            clearInterval(pollTimerRef.current!);
            setJoinContext(ctx);
            setStep("code_rejected");
          }
        } catch {
          // ignore poll errors
        }
      }, 15000);
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [step, spaceId, userId, showToast, router, refreshJoinCaches]);

  const handleCodeLookup = useCallback(async () => {
    const raw = inviteCode.trim();
    if (!raw) {
      setCodeError("초대 문구를 입력해주세요.");
      return;
    }
    setCodeError(null);
    setActionError(null);
    setStep("code_lookup_loading");
    try {
      const space = await getSpaceByInviteCode(raw);
      setFoundSpace(space);
      setSpaceId(space.id);
      const ctx = await getSpaceJoinContext(space.id);
      setJoinContext(ctx);
      const { participation, invitation, codeRequest } = ctx;

      if (participation?.status === "APPROVED") {
        setStep("already_member");
        return;
      }
      if (space.status === "ARCHIVED") {
        setStep("space_archived");
        return;
      }
      if (invitation?.status === "PENDING") {
        setStep("invitation");
        return;
      }
      if (codeRequest?.status === "PENDING") {
        setStep("code_pending");
        return;
      }
      if (codeRequest?.status === "REJECTED") {
        setStep("code_rejected");
        return;
      }
      if (isRecruitmentFull(space.maxParticipants, space.participantCount)) {
        setStep("space_full");
        return;
      }
      setStep("space_preview");
    } catch (e: unknown) {
      const status = (e as { status?: number }).status;
      if (status === 404) {
        setCodeError("존재하지 않는 코드예요. 다시 확인해주세요.");
      } else {
        setCodeError("코드를 확인하는 중 오류가 발생했어요.");
      }
      setStep("code_input");
    }
  }, [inviteCode, userId]);

  const handleApply = useCallback(async () => {
    if (!foundSpace || !spaceId || actionLoading) return;
    const nicknameError = foundSpace.isAnonymous
      ? validateSpaceNickname(spaceNickname)
      : null;
    if (nicknameError) {
      setSpaceNicknameError(nicknameError);
      return;
    }
    setActionError(null);
    setActionLoading(true);
    try {
      await createCodeRequest.mutateAsync({
        id: spaceId,
        data: {
          code: inviteCode.trim(),
          ...(foundSpace.isAnonymous ? { spaceNickname: spaceNickname.trim() } : {}),
        },
      });
      const ctx = await getSpaceJoinContext(spaceId);
      setJoinContext(ctx);
      await refreshJoinCaches();
      setStep("code_pending");
    } catch (error) {
      if (foundSpace.isAnonymous && isSpaceNicknameConflict(error)) {
        setSpaceNicknameError(getJoinMutationErrorMessage(error, "신청에 실패했어요. 다시 시도해주세요."));
        return;
      }
      if (getJoinMutationErrorCode(error) === "INVITE_CODE_MISMATCH") {
        setCodeError(getJoinMutationErrorMessage(error, "초대 문구를 다시 확인해주세요."));
        setFoundSpace(null);
        setJoinContext(null);
        setStep("code_input");
        return;
      }
      if (shouldReloadJoinContext(error)) {
        await loadJoinContext(spaceId);
        return;
      }
      setActionError(getJoinMutationErrorMessage(error, "신청에 실패했어요. 다시 시도해주세요."));
    } finally {
      setActionLoading(false);
    }
  }, [foundSpace, spaceId, actionLoading, inviteCode, spaceNickname, createCodeRequest, userId, refreshJoinCaches, loadJoinContext]);

  const handleCancelRequest = useCallback(async () => {
    if (!spaceId || !joinContext?.codeRequest || actionLoading) return;
    setActionLoading(true);
    setCancelConfirmVisible(false);
    try {
      await updateCodeRequest.mutateAsync({
        id: spaceId,
        requestId: joinContext.codeRequest.id,
        data: { status: "CANCELLED" },
      });
      if (cameFromList) {
        router.back();
      } else {
        setInviteCode("");
        setFoundSpace(null);
        setJoinContext(null);
        setStep("code_input");
      }
    } catch {
      showToast({ message: "취소에 실패했어요. 다시 시도해주세요.", type: "error" });
    } finally {
      setActionLoading(false);
    }
  }, [spaceId, joinContext, actionLoading, updateCodeRequest, showToast, cameFromList, router]);

  const handleAcceptInvitation = useCallback(async () => {
    if (!spaceId || !joinContext?.invitation || actionLoading) return;
    const nicknameError = joinContext.space.isAnonymous
      ? validateSpaceNickname(spaceNickname)
      : null;
    if (nicknameError) {
      setSpaceNicknameError(nicknameError);
      return;
    }
    setActionError(null);
    setActionLoading(true);
    try {
      await updateInvitation.mutateAsync({
        id: spaceId,
        invitationId: joinContext.invitation.id,
        data: {
          status: "ACCEPTED",
          ...(joinContext.space.isAnonymous ? { spaceNickname: spaceNickname.trim() } : {}),
        },
      });
      await refreshJoinCaches();
      showToast({ message: "공간에 참여했어요!", type: "success" });
      router.replace("/(tabs)/of");
    } catch (error) {
      if (joinContext.space.isAnonymous && isSpaceNicknameConflict(error)) {
        setSpaceNicknameError(getJoinMutationErrorMessage(error, "수락에 실패했어요. 다시 시도해주세요."));
        return;
      }
      if (shouldReloadJoinContext(error)) {
        await loadJoinContext(spaceId);
        return;
      }
      setActionError(getJoinMutationErrorMessage(error, "수락에 실패했어요. 다시 시도해주세요."));
    } finally {
      setActionLoading(false);
    }
  }, [spaceId, joinContext, actionLoading, spaceNickname, updateInvitation, showToast, router, refreshJoinCaches, loadJoinContext]);

  const handleDeclineInvitation = useCallback(async () => {
    if (!spaceId || !joinContext?.invitation) return;
    setActionLoading(true);
    setDeclineConfirmVisible(false);
    try {
      await updateInvitation.mutateAsync({
        id: spaceId,
        invitationId: joinContext.invitation.id,
        data: { status: "DECLINED" },
      });
      showToast({ message: "초대를 거절했어요.", type: "success" });
      router.back();
    } catch {
      showToast({ message: "거절에 실패했어요. 다시 시도해주세요.", type: "error" });
    } finally {
      setActionLoading(false);
    }
  }, [spaceId, joinContext, updateInvitation, showToast, router]);

  const renderContent = () => {
    if (step === "code_input") {
      return (
        <View style={styles.codeInputContainer}>
          <Text style={styles.codeInputTitle}>초대 문구로 신청</Text>
          <Text style={styles.codeInputSubtitle}>
            공간장에게 받은 초대 문구를 입력하면{"\n"}공간장의 승인 후 공간에 참여할 수 있어요
          </Text>
          <TextInput
            style={[styles.codeInput, !!codeError && styles.codeInputError]}
            placeholder="초대 문구 입력"
            placeholderTextColor={Colors.zinc400}
            value={inviteCode}
            onChangeText={(v) => {
              setInviteCode(v);
              setCodeError(null);
              setActionError(null);
            }}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleCodeLookup}
          />
          {codeError ? (
            <Text style={styles.errorText}>{codeError}</Text>
          ) : null}
        </View>
      );
    }

    if (step === "code_lookup_loading" || step === "context_loading") {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={Colors.zinc400} />
          <Text style={styles.loadingText}>공간 정보를 불러오는 중...</Text>
        </View>
      );
    }

    if (step === "space_not_found") {
      return (
        <BoundaryView
          icon="slash"
          title="찾을 수 없는 공간이에요"
          subtitle="삭제되었거나 존재하지 않는 공간이에요."
          action={{ label: "돌아가기", onPress: () => router.back() }}
        />
      );
    }

    if (step === "context_error") {
      return (
        <BoundaryView
          icon="alert-circle"
          title="불러오기에 실패했어요"
          subtitle="잠시 후 다시 시도해주세요."
          action={{
            label: "다시 시도",
            onPress: () => {
              if (spaceId) {
                setStep("context_loading");
              } else {
                setStep("code_input");
              }
            },
          }}
        />
      );
    }

    if (step === "already_member") {
      const space = joinContext?.space ?? foundSpace;
      return (
        <BoundaryView
          icon="check-circle"
          title="이미 참여 중인 공간이에요"
          subtitle={space ? `'${space.name}'에 이미 참여하고 있어요.` : "이미 참여 중이에요."}
          action={{ label: "돌아가기", onPress: () => router.back() }}
        />
      );
    }

    if (step === "space_archived") {
      const space = joinContext?.space ?? foundSpace;
      return (
        <BoundaryView
          icon="archive"
          title="종료된 공간이에요"
          subtitle={space ? `'${space.name}'은(는) 이미 종료된 공간이에요.` : "종료된 공간이에요."}
          action={{ label: "돌아가기", onPress: () => router.back() }}
        />
      );
    }

    if (step === "space_full") {
      const space = joinContext?.space ?? foundSpace;
      return (
        <>
          {space ? <SpaceInfoCard space={space} /> : null}
          <BoundaryView
            icon="user-x"
            title="모집이 마감된 공간이에요"
            subtitle="최대 참여 인원에 도달했어요."
            action={{ label: "돌아가기", onPress: () => router.back() }}
            inline
          />
        </>
      );
    }

    if (step === "space_preview" && foundSpace) {
      const isClosed = foundSpace.status === "ACTIVE";
      const canApply =
        !foundSpace.isAnonymous || validateSpaceNickname(spaceNickname) === null;
      return (
        <View style={styles.spacePreviewContainer}>
          <SpaceInfoCard space={foundSpace} />
          {foundSpace.isAnonymous ? (
            <SpaceNicknameField
              value={spaceNickname}
              error={spaceNicknameError}
              onChangeText={(value) => {
                setSpaceNickname(value);
                setSpaceNicknameError(null);
                setActionError(null);
              }}
            />
          ) : null}
          {isClosed ? (
            <View style={styles.closedNoticeBanner}>
              <Feather name="slash" size={14} color={Colors.zinc500} />
              <Text style={styles.closedNoticeText}>
                공간이 이미 시작되어 모집이 마감됐어요.
              </Text>
            </View>
          ) : (
            <SubmitButton
              style={styles.primaryButton}
              contentStyle={styles.primaryButtonContent}
              disabledStyle={styles.primaryButtonDisabled}
              textStyle={styles.primaryButtonText}
              onPress={handleApply}
              pending={actionLoading}
              disabled={!canApply}
              label="참여 신청하기"
              pendingLabel="신청 중..."
            />
          )}
          {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
          <ScalePressable
            style={styles.secondaryButton}
            contentStyle={styles.secondaryButtonContent}
            onPress={() => {
              setStep("code_input");
              setFoundSpace(null);
            }}
          >
            <Text style={styles.secondaryButtonText}>다른 코드 입력</Text>
          </ScalePressable>
        </View>
      );
    }

    if (step === "invitation" && joinContext) {
      const isClosed = joinContext.space.status === "ACTIVE";
      const canAccept =
        !joinContext.space.isAnonymous ||
        validateSpaceNickname(spaceNickname) === null;
      return (
        <View style={styles.spacePreviewContainer}>
          <View style={styles.invitationBanner}>
            <Feather name="mail" size={16} color="#7C3AED" />
            <Text style={styles.invitationBannerText}>
              {joinContext.space.isAnonymous
                ? "익명 공간장님이 초대했어요"
                : joinContext.space.creatorNickname
                ? `${joinContext.space.creatorNickname}님이 초대했어요`
                : "초대받은 공간이에요"}
            </Text>
          </View>
          <SpaceInfoCard space={joinContext.space} />
          {joinContext.space.isAnonymous ? (
            <SpaceNicknameField
              value={spaceNickname}
              error={spaceNicknameError}
              onChangeText={(value) => {
                setSpaceNickname(value);
                setSpaceNicknameError(null);
                setActionError(null);
              }}
            />
          ) : null}
          {isClosed ? (
            <View style={styles.closedNoticeBanner}>
              <Feather name="slash" size={14} color={Colors.zinc500} />
              <Text style={styles.closedNoticeText}>
                공간이 이미 시작되어 수락할 수 없어요.
              </Text>
            </View>
          ) : (
            <SubmitButton
              style={styles.primaryButton}
              contentStyle={styles.primaryButtonContent}
              disabledStyle={styles.primaryButtonDisabled}
              textStyle={styles.primaryButtonText}
              onPress={handleAcceptInvitation}
              pending={actionLoading}
              disabled={!canAccept}
              label="수락하기"
              pendingLabel="처리 중..."
            />
          )}
          {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
          {!isClosed && (
            <ScalePressable
              style={styles.secondaryButton}
              contentStyle={styles.secondaryButtonContent}
              onPress={() => setDeclineConfirmVisible(true)}
            >
              <Text style={styles.secondaryButtonTextDestructive}>거절하기</Text>
            </ScalePressable>
          )}
        </View>
      );
    }

    if (step === "code_pending" && joinContext) {
      return (
        <View style={styles.pendingContainer}>
          <View style={styles.pendingIcon}>
            <Feather name="clock" size={32} color="#D97706" />
          </View>
          <Text style={styles.pendingTitle}>
            {joinContext.space.name} 가입 신청 완료!
          </Text>
          <Text style={styles.pendingSubtitle}>
            공간장이 신청을 확인한 후 참여 여부를 결정해요.{"\n"}
            승인되면 바로 알려드릴게요.
          </Text>
          <ScalePressable
            style={styles.cancelRequestButton}
            contentStyle={styles.cancelRequestButtonContent}
            onPress={() => setCancelConfirmVisible(true)}
            disabled={actionLoading}
            accessibilityRole="button"
            accessibilityLabel="신청 취소하기"
            accessibilityState={{ disabled: actionLoading }}
          >
            <Text style={styles.cancelRequestText}>신청 취소하기</Text>
          </ScalePressable>
          <ScalePressable
            style={styles.pendingBackButton}
            contentStyle={styles.pendingBackButtonContent}
            onPress={() => router.replace("/(tabs)/of")}
            disabled={actionLoading}
            accessibilityRole="button"
            accessibilityLabel="목록으로 돌아가기"
            accessibilityState={{ disabled: actionLoading }}
          >
            <Text style={styles.pendingBackButtonText}>목록으로 돌아가기</Text>
          </ScalePressable>
        </View>
      );
    }

    if (step === "code_rejected" && joinContext) {
      return (
        <View style={styles.rejectedContainer}>
          <View style={styles.rejectedIcon}>
            <Feather name="x-circle" size={32} color={Colors.zinc400} />
          </View>
          <Text style={styles.rejectedTitle}>신청이 거절되었어요</Text>
          <View style={styles.rejectionReasonBox}>
            <Text style={styles.rejectionReasonLabel}>거절 사유</Text>
            <Text style={styles.rejectionReasonText}>
              {joinContext.codeRequest?.rejectionReason
                ? joinContext.codeRequest.rejectionReason
                : "공간장이 별도의 사유를 남기지 않았어요."}
            </Text>
          </View>
          <SpaceInfoCard space={joinContext.space} />
          <ScalePressable style={styles.secondaryButton} contentStyle={styles.secondaryButtonContent} onPress={() => router.back()}>
            <Text style={styles.secondaryButtonText}>돌아가기</Text>
          </ScalePressable>
        </View>
      );
    }

    return null;
  };

  const title =
    step === "invitation"
      ? "공간 초대"
      : step === "code_pending"
      ? "승인 대기"
      : step === "code_rejected"
      ? "신청 결과"
      : "공간 참여";

  return (
    <View style={[
      styles.container,
      { paddingTop: Platform.OS === "web" ? 67 : insets.top },
    ]}>
      <View style={styles.header}>
        <HeaderButton
          variant="back"
          onPress={() => router.back()}
          accessibilityLabel="공간 참여에서 돌아가기"
        />
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 32 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {renderContent()}
      </ScrollView>
      {step === "code_input" && (
        <View
          style={[
            styles.bottomButtonArea,
            { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 16 },
          ]}
        >
          <SubmitButton
            style={styles.primaryButton}
            contentStyle={styles.primaryButtonContent}
            disabledStyle={styles.primaryButtonDisabled}
            textStyle={styles.primaryButtonText}
            onPress={handleCodeLookup}
            disabled={!inviteCode.trim()}
            label="다음"
            pendingLabel="확인 중..."
            pending={false}
          />
        </View>
      )}

      <ConfirmModal
        visible={declineConfirmVisible}
        title="초대 거절"
        description="초대를 거절하시겠어요?"
        confirmLabel="거절"
        destructive
        onConfirm={handleDeclineInvitation}
        onCancel={() => setDeclineConfirmVisible(false)}
      />
      <ConfirmModal
        visible={cancelConfirmVisible}
        title="신청 취소"
        description="참여 신청을 취소하시겠어요?"
        confirmLabel="취소하기"
        destructive
        onConfirm={handleCancelRequest}
        onCancel={() => setCancelConfirmVisible(false)}
      />
    </View>
  );
}

function BoundaryView({
  icon,
  title,
  subtitle,
  action,
  inline,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  subtitle: string;
  action?: { label: string; onPress: () => void };
  inline?: boolean;
}) {
  return (
    <View style={inline ? styles.boundaryInline : styles.boundaryCenter}>
      <View style={styles.boundaryIconWrap}>
        <Feather name={icon} size={40} color={Colors.zinc300} />
      </View>
      <Text style={styles.boundaryTitle}>{title}</Text>
      <Text style={styles.boundarySubtitle}>{subtitle}</Text>
      {action ? (
        <ScalePressable style={styles.boundaryButton} contentStyle={styles.boundaryButtonContent} onPress={action.onPress}>
          <Text style={styles.boundaryButtonText}>{action.label}</Text>
        </ScalePressable>
      ) : null}
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  headerSpacer: {
    width: 44,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 16,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingVertical: 80,
  },
  loadingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  codeInputContainer: {
    flex: 1,
    alignItems: "center",
    paddingTop: 40,
    gap: 12,
  },
  codeInputIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: "#EDE9FE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  codeInputTitle: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
  },
  codeInputSubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 8,
  },
  codeInputSubtitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
    marginBottom: 8,
  },
  anonymousNoteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingTop: 2,
  },
  anonymousNoteText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  codeInput: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc900,
    backgroundColor: Colors.zinc50,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    width: "100%",
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  codeInputError: {
    borderColor: "#DC2626",
  },
  nicknameField: {
    width: "100%",
    gap: 6,
  },
  nicknameLabel: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc700,
  },
  nicknameHint: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    lineHeight: 18,
  },
  errorText: {
    ...Typography.body,
    fontSize: 13,
    color: "#DC2626",
    alignSelf: "flex-start",
    marginTop: -4,
  },
  bottomButtonArea: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc100,
    backgroundColor: Colors.white,
  },
  primaryButton: {
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    height: 52,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    width: "100%",
    marginTop: 0,
  },
  primaryButtonContent: {
    width: "100%",
    height: 52,
    flexGrow: 0,
    flexShrink: 0,
  },
  primaryButtonDisabled: {
    backgroundColor: Colors.zinc300,
  },
  primaryButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
  secondaryButton: {
    width: "100%",
    height: 48,
    flexGrow: 0,
    flexShrink: 0,
  },
  secondaryButtonContent: {
    height: 48,
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc500,
  },
  secondaryButtonTextDestructive: {
    ...Typography.body,
    fontSize: 15,
    color: "#DC2626",
  },
  pendingBackButton: {
    width: "100%",
    height: 48,
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: 12,
    backgroundColor: Colors.noticeAccent,
  },
  pendingBackButtonContent: {
    width: "100%",
    height: 48,
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: 12,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.noticeAccent,
  },
  pendingBackButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
  roundsDisclaimerRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc200,
  },
  closedNoticeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.zinc100,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  closedNoticeText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    flex: 1,
    lineHeight: 20,
  },
  infoCard: {
    backgroundColor: Colors.zinc50,
    borderRadius: 16,
    padding: 20,
    gap: 4,
    marginBottom: 8,
  },
  infoCardIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "#EDE9FE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    alignSelf: "center",
  },
  infoCardName: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
    textAlign: "center",
  },
  infoCardDesc: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc600,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 4,
  },
  infoCardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.zinc200,
    marginVertical: 12,
  },
  infoRows: {
    gap: 10,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  infoRowIcon: {
    width: 20,
    alignItems: "center",
  },
  infoRowLabel: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
    width: 64,
  },
  infoRowValue: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.zinc800,
    flex: 1,
  },
  infoRowValueRed: {
    color: "#DC2626",
  },
  infoRowValueGray: {
    color: Colors.zinc500,
  },
  spacePreviewContainer: {
    flex: 1,
    gap: 4,
  },
  invitationBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#EDE9FE",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },
  invitationBannerText: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: "#7C3AED",
  },
  pendingContainer: {
    flex: 1,
    gap: 4,
  },
  pendingIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 4,
    marginTop: 8,
  },
  pendingTitle: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
    textAlign: "center",
  },
  pendingSubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 8,
  },
  cancelRequestButton: {
    marginTop: 8,
    height: 48,
    flexGrow: 0,
    flexShrink: 0,
  },
  cancelRequestButtonContent: {
    height: 48,
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelRequestText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textDecorationLine: "underline",
  },
  rejectedContainer: {
    flex: 1,
    gap: 4,
  },
  rejectedIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 4,
    marginTop: 8,
  },
  rejectedTitle: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
    textAlign: "center",
    marginBottom: 4,
  },
  rejectionReasonBox: {
    backgroundColor: Colors.zinc50,
    borderRadius: 12,
    padding: 16,
    gap: 4,
    borderLeftWidth: 3,
    borderLeftColor: Colors.zinc300,
    marginBottom: 8,
  },
  rejectionReasonLabel: {
    ...Typography.bodySemiBold,
    fontSize: 12,
    color: Colors.zinc500,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  rejectionReasonText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc700,
    lineHeight: 22,
  },
  boundaryCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 80,
    gap: 8,
  },
  boundaryInline: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 8,
  },
  boundaryIconWrap: {
    marginBottom: 8,
  },
  boundaryTitle: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.zinc900,
    textAlign: "center",
  },
  boundarySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 22,
  },
  boundaryButton: {
    marginTop: 16,
  },
  boundaryButtonContent: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  boundaryButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
});
