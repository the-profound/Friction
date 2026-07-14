import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";
import SubmitButton from "@/components/SubmitButton/SubmitButton";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import { useToast } from "@/contexts/ToastContext";
import { useUser } from "@/contexts/UserContext";
import {
  getSpaceByInviteCode,
  getSpaceJoinContext,
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

function SpaceInfoCard({ space }: { space: SpaceWithCreatorInfo }) {
  const isRecruiting = space.status === "RECRUITING";
  const isFull =
    space.maxParticipants != null &&
    space.participantCount >= space.maxParticipants;

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
        <InfoRow icon="repeat" label="회차 수" value={`${space.roundCount}회`} />
        {space.startsAt ? (
          <InfoRow icon="calendar" label="시작일" value={formatDate(space.startsAt)} />
        ) : null}
        <InfoRow
          icon="users"
          label="모집 인원"
          value={
            space.maxParticipants
              ? `${space.participantCount} / ${space.maxParticipants}명`
              : `${space.participantCount}명 참여 중`
          }
          accent={isFull ? "red" : undefined}
        />
        <InfoRow
          icon="user"
          label="익명 여부"
          value={space.isAnonymous ? "익명 참여" : "실명 참여"}
        />
        {space.creatorNickname ? (
          <InfoRow icon="shield" label="운영자" value={space.creatorNickname} />
        ) : null}
        <InfoRow
          icon="activity"
          label="모집 상태"
          value={
            space.status === "RECRUITING"
              ? "모집 중"
              : space.status === "ACTIVE"
              ? "진행 중"
              : "종료됨"
          }
          accent={!isRecruiting ? "gray" : undefined}
        />
      </View>
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

  const loadJoinContext = useCallback(
    async (
      sid: string,
      opts?: { invitationId?: string; codeRequestId?: string },
    ) => {
      try {
        const ctx = await getSpaceJoinContext(sid, { userId });
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
        const isFull =
          space.maxParticipants != null &&
          space.participantCount >= space.maxParticipants &&
          space.status !== "RECRUITING";

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

        if (isFull && !targetInvitation && !targetCodeRequest) {
          setStep("space_full");
          return;
        }
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
          const ctx = await getSpaceJoinContext(spaceId, { userId });
          setJoinContext(ctx);
          const req = ctx.codeRequest;
          if (req?.status === "APPROVED") {
            clearInterval(pollTimerRef.current!);
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
  }, [step, spaceId, userId, showToast, router]);

  const handleCodeLookup = useCallback(async () => {
    const raw = inviteCode.trim();
    if (!raw) {
      setCodeError("초대 문구를 입력해주세요.");
      return;
    }
    setCodeError(null);
    setStep("code_lookup_loading");
    try {
      const space = await getSpaceByInviteCode(raw);
      setFoundSpace(space);
      setSpaceId(space.id);
      const ctx = await getSpaceJoinContext(space.id, { userId });
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
      const isFull =
        space.maxParticipants != null &&
        space.participantCount >= space.maxParticipants &&
        space.status !== "RECRUITING";
      if (isFull) {
        setStep("space_full");
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
    if (!foundSpace || !spaceId) return;
    setActionLoading(true);
    try {
      await createCodeRequest.mutateAsync({
        id: spaceId,
        data: { requesterId: userId, code: inviteCode.trim() },
      });
      const ctx = await getSpaceJoinContext(spaceId, { userId });
      setJoinContext(ctx);
      setStep("code_pending");
    } catch {
      showToast({ message: "신청에 실패했어요. 다시 시도해주세요.", type: "error" });
    } finally {
      setActionLoading(false);
    }
  }, [foundSpace, spaceId, userId, inviteCode, createCodeRequest, showToast]);

  const handleCancelRequest = useCallback(async () => {
    if (!spaceId || !joinContext?.codeRequest) return;
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
  }, [spaceId, joinContext, updateCodeRequest, showToast, cameFromList, router]);

  const handleAcceptInvitation = useCallback(async () => {
    if (!spaceId || !joinContext?.invitation) return;
    setActionLoading(true);
    try {
      await updateInvitation.mutateAsync({
        id: spaceId,
        invitationId: joinContext.invitation.id,
        data: { status: "ACCEPTED" },
      });
      showToast({ message: "공간에 참여했어요!", type: "success" });
      router.replace("/(tabs)/of");
    } catch {
      showToast({ message: "수락에 실패했어요. 다시 시도해주세요.", type: "error" });
    } finally {
      setActionLoading(false);
    }
  }, [spaceId, joinContext, updateInvitation, showToast, router]);

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
          <View style={styles.codeInputIcon}>
            <Feather name="hash" size={32} color="#7C3AED" />
          </View>
          <Text style={styles.codeInputTitle}>초대 문구로 신청</Text>
          <Text style={styles.codeInputSubtitle}>
            운영자에게 받은 초대 문구를 입력하면{"\n"}운영자의 승인 후 공간에 참여할 수 있어요
          </Text>
          <TextInput
            style={[styles.codeInput, !!codeError && styles.codeInputError]}
            placeholder="초대 문구 입력"
            placeholderTextColor={Colors.zinc400}
            value={inviteCode}
            onChangeText={(v) => {
              setInviteCode(v);
              setCodeError(null);
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
          <SubmitButton
            style={styles.primaryButton}
            disabledStyle={styles.primaryButtonDisabled}
            textStyle={styles.primaryButtonText}
            onPress={handleCodeLookup}
            disabled={!inviteCode.trim()}
            label="다음"
            pendingLabel="확인 중..."
            pending={false}
          />
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
      return (
        <View style={styles.spacePreviewContainer}>
          <SpaceInfoCard space={foundSpace} />
          <SubmitButton
            style={styles.primaryButton}
            disabledStyle={styles.primaryButtonDisabled}
            textStyle={styles.primaryButtonText}
            onPress={handleApply}
            pending={actionLoading}
            label="참여 신청하기"
            pendingLabel="신청 중..."
          />
          <ScalePressable
            style={styles.secondaryButton}
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
      return (
        <View style={styles.spacePreviewContainer}>
          <View style={styles.invitationBanner}>
            <Feather name="mail" size={16} color="#7C3AED" />
            <Text style={styles.invitationBannerText}>
              {joinContext.space.creatorNickname
                ? `${joinContext.space.creatorNickname}님이 초대했어요`
                : "초대받은 공간이에요"}
            </Text>
          </View>
          <SpaceInfoCard space={joinContext.space} />
          <SubmitButton
            style={styles.primaryButton}
            disabledStyle={styles.primaryButtonDisabled}
            textStyle={styles.primaryButtonText}
            onPress={handleAcceptInvitation}
            pending={actionLoading}
            label="수락하기"
            pendingLabel="처리 중..."
          />
          <ScalePressable
            style={styles.secondaryButton}
            onPress={() => setDeclineConfirmVisible(true)}
          >
            <Text style={styles.secondaryButtonTextDestructive}>거절하기</Text>
          </ScalePressable>
        </View>
      );
    }

    if (step === "code_pending" && joinContext) {
      return (
        <View style={styles.pendingContainer}>
          <View style={styles.pendingIcon}>
            <Feather name="clock" size={32} color="#D97706" />
          </View>
          <Text style={styles.pendingTitle}>승인 대기 중이에요</Text>
          <Text style={styles.pendingSubtitle}>
            운영자가 신청을 확인한 후 참여 여부를 결정해요.{"\n"}
            승인되면 바로 알려드릴게요.
          </Text>
          <SpaceInfoCard space={joinContext.space} />
          <ScalePressable
            style={styles.cancelRequestButton}
            onPress={() => setCancelConfirmVisible(true)}
          >
            <Text style={styles.cancelRequestText}>신청 취소하기</Text>
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
                : "운영자가 별도의 사유를 남기지 않았어요."}
            </Text>
          </View>
          <SpaceInfoCard space={joinContext.space} />
          <ScalePressable style={styles.secondaryButton} onPress={() => router.back()}>
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ScalePressable style={styles.backButton} onPress={() => router.back()} hitSlop={8} contentStyle={styles.backButtonContent}>
          <Feather name="chevron-left" size={24} color={Colors.zinc700} />
        </ScalePressable>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {renderContent()}
      </ScrollView>

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
        <ScalePressable style={styles.boundaryButton} onPress={action.onPress}>
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
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  backButtonContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  headerSpacer: {
    width: 36,
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
    color: Colors.zinc400,
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
  errorText: {
    ...Typography.body,
    fontSize: 13,
    color: "#DC2626",
    alignSelf: "flex-start",
    marginTop: -4,
  },
  primaryButton: {
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    width: "100%",
    marginTop: 8,
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
    paddingVertical: 12,
    alignItems: "center",
    width: "100%",
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
    color: Colors.zinc400,
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
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  cancelRequestText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
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
    color: Colors.zinc400,
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
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
  },
  boundaryButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
});
