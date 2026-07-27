import React, { useCallback, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";
import { ArticleScheduleSheet } from "@/components/ArticleScheduleSheet/ArticleScheduleSheet";
import {
  useListAllSpaceScheduledSends,
  useListSpaceRounds,
  useListSpaceLetters,
  useCreateSpaceScheduledSend,
  useUpdateSpaceScheduledSend,
  useListArticles,
  useGetSpaceJoinContext,
  getGetSpaceJoinContextQueryKey,
  getListAllSpaceScheduledSendsQueryKey,
  getListSpaceRoundsQueryKey,
  getListSpaceLettersQueryKey,
  getListArticlesQueryKey,
} from "@workspace/api-client-react";
import type {
  SpaceScheduledSendWithLetter,
  SpaceRound,
  SpaceLetter,
  Article,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/contexts/UserContext";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function sendStatusLabel(status: string): string {
  if (status === "PENDING") return "예약 중";
  if (status === "SENT") return "발송 완료";
  if (status === "CANCELLED") return "취소됨";
  if (status === "FAILED") return "발송 실패";
  return status;
}

function sendStatusColor(status: string): string {
  if (status === "PENDING") return Colors.noticeAccent;
  if (status === "SENT") return Colors.zinc400;
  if (status === "FAILED") return "#EF4444";
  return Colors.zinc300;
}

// ─── Scheduled Send Row ───────────────────────────────────────────────────────

function SendRow({
  send,
  onCancel,
  onResend,
  onChangePending,
  schedulingBlocked,
}: {
  send: SpaceScheduledSendWithLetter;
  onCancel: () => void;
  onResend: () => void;
  onChangePending: () => void;
  schedulingBlocked: boolean;
}) {
  const color = sendStatusColor(send.status);
  const isPending = send.status === "PENDING";
  const isSent = send.status === "SENT";
  const isFailed = send.status === "FAILED";

  return (
    <View style={[styles.sendRow, isFailed && styles.sendRowFailed]}>
      <View style={styles.sendRowTop}>
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <Text style={[styles.sendStatusText, { color }]}>{sendStatusLabel(send.status)}</Text>
        <Text style={styles.sendDateText}>{formatDateTime(send.scheduledAt)}</Text>
      </View>
      {isFailed && (
        <View style={styles.failedBanner}>
          <Feather name="alert-circle" size={12} color="#EF4444" />
          <Text style={styles.failedBannerText}>예약 시각에 발송되지 않았어요. 다시 예약하거나 취소하세요.</Text>
        </View>
      )}
      {send.articleTitle ? (
        <Text style={styles.sendArticleTitle} numberOfLines={1}>
          {send.articleTitle}
        </Text>
      ) : (
        <Text style={styles.sendArticleTitleEmpty}>제목 없음</Text>
      )}
      {send.authorNickname && (
        <Text style={styles.sendAuthor}>{send.authorNickname}</Text>
      )}
      {isSent && send.sentAt && (
        <Text style={styles.sentAtText}>발송: {formatDateTime(send.sentAt)}</Text>
      )}
      <View style={styles.sendRowActions}>
        {isPending && (
          <>
            <ScalePressable contentStyle={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelBtnText}>예약 취소</Text>
            </ScalePressable>
            {!schedulingBlocked && (
              <ScalePressable contentStyle={styles.changeBtn} onPress={onChangePending}>
                <Text style={styles.changeBtnText}>예약 변경</Text>
              </ScalePressable>
            )}
          </>
        )}
        {!schedulingBlocked && (isSent || send.status === "CANCELLED") && (
          <ScalePressable contentStyle={styles.resendBtn} onPress={onResend}>
            <Text style={styles.resendBtnText}>다시 예약</Text>
          </ScalePressable>
        )}
        {isFailed && (
          <>
            <ScalePressable contentStyle={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelBtnText}>취소</Text>
            </ScalePressable>
            {!schedulingBlocked && (
              <ScalePressable contentStyle={[styles.resendBtn, styles.resendBtnFailed]} onPress={onResend}>
                <Feather name="refresh-cw" size={12} color="#EF4444" />
                <Text style={[styles.resendBtnText, styles.resendBtnTextFailed]}>다시 예약</Text>
              </ScalePressable>
            )}
          </>
        )}
      </View>
    </View>
  );
}

// ─── Resend Sheet (reschedule from sent/cancelled) ────────────────────────────

function ResendSheet({
  send,
  spaceId,
  onClose,
  onSaved,
}: {
  send: SpaceScheduledSendWithLetter;
  spaceId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [scheduledAt, setScheduledAt] = useState(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const createSend = useCreateSpaceScheduledSend();

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await createSend.mutateAsync({
        id: spaceId,
        letterId: send.spaceLetterId,
        data: { scheduledAt: scheduledAt.toISOString() },
      });
      onSaved();
      onClose();
    } catch {
      Alert.alert("오류", "예약에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }, [scheduledAt, spaceId, send, createSend, onSaved, onClose]);

  return (
    <View style={sheetStyles.overlay}>
      <ScalePressable style={sheetStyles.backdrop} onPress={onClose} />
      <View style={sheetStyles.sheet}>
        <View style={sheetStyles.sheetHeader}>
          <Text style={sheetStyles.sheetTitle}>다시 예약하기</Text>
          <ScalePressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={20} color={Colors.zinc500} />
          </ScalePressable>
        </View>

        {send.articleTitle && (
          <Text style={sheetStyles.resendTitle} numberOfLines={2}>
            {send.articleTitle}
          </Text>
        )}

        <Text style={sheetStyles.fieldLabel}>새 발송 예약 일시</Text>
        <ScalePressable
          contentStyle={sheetStyles.dateBtn}
          onPress={() => setShowPicker(true)}
        >
          <Feather name="calendar" size={15} color={Colors.zinc500} />
          <Text style={sheetStyles.dateBtnText}>{formatDateTime(scheduledAt.toISOString())}</Text>
        </ScalePressable>

        {showPicker && (
          <DateTimePicker
            value={scheduledAt}
            mode="datetime"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={(_event, date) => {
              setShowPicker(Platform.OS === "ios");
              if (date) setScheduledAt(date);
            }}
            minimumDate={new Date()}
          />
        )}

        <ScalePressable
          style={sheetStyles.saveBtnOuter}
          contentStyle={[sheetStyles.saveBtn, saving && sheetStyles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={sheetStyles.saveBtnText}>{saving ? "예약 중..." : "예약 등록"}</Text>
        </ScalePressable>
      </View>
    </View>
  );
}

// ─── Change Sheet (reschedule an existing PENDING send) ───────────────────────

function ChangeSheet({
  send,
  spaceId,
  onClose,
  onSaved,
}: {
  send: SpaceScheduledSendWithLetter;
  spaceId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [scheduledAt, setScheduledAt] = useState(new Date(send.scheduledAt));
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const updateSend = useUpdateSpaceScheduledSend();

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await updateSend.mutateAsync({
        id: spaceId,
        letterId: send.spaceLetterId,
        sendId: send.id,
        data: { status: "PENDING", scheduledAt: scheduledAt.toISOString() },
      });
      onSaved();
      onClose();
    } catch {
      Alert.alert("오류", "예약 변경에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }, [scheduledAt, spaceId, send, updateSend, onSaved, onClose]);

  return (
    <View style={sheetStyles.overlay}>
      <ScalePressable style={sheetStyles.backdrop} onPress={onClose} />
      <View style={sheetStyles.sheet}>
        <View style={sheetStyles.sheetHeader}>
          <Text style={sheetStyles.sheetTitle}>예약 변경</Text>
          <ScalePressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={20} color={Colors.zinc500} />
          </ScalePressable>
        </View>

        {send.articleTitle && (
          <Text style={sheetStyles.resendTitle} numberOfLines={2}>
            {send.articleTitle}
          </Text>
        )}

        <Text style={sheetStyles.fieldLabel}>새 발송 예약 일시</Text>
        <ScalePressable
          contentStyle={sheetStyles.dateBtn}
          onPress={() => setShowPicker(true)}
        >
          <Feather name="calendar" size={15} color={Colors.zinc500} />
          <Text style={sheetStyles.dateBtnText}>{formatDateTime(scheduledAt.toISOString())}</Text>
        </ScalePressable>

        {showPicker && (
          <DateTimePicker
            value={scheduledAt}
            mode="datetime"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={(_event, date) => {
              setShowPicker(Platform.OS === "ios");
              if (date) setScheduledAt(date);
            }}
            minimumDate={new Date()}
          />
        )}

        <ScalePressable
          style={sheetStyles.saveBtnOuter}
          contentStyle={[sheetStyles.saveBtn, saving && sheetStyles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={sheetStyles.saveBtnText}>{saving ? "변경 중..." : "변경 저장"}</Text>
        </ScalePressable>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SpaceScheduleSendScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, slotId, scheduledDate } = useLocalSearchParams<{
    id: string;
    slotId?: string;
    scheduledDate?: string;
  }>();
  const { userId } = useUser();
  const queryClient = useQueryClient();

  const [showNewSheet, setShowNewSheet] = useState(() => !!slotId);
  const [resendTarget, setResendTarget] = useState<SpaceScheduledSendWithLetter | null>(null);
  const [changeTarget, setChangeTarget] = useState<SpaceScheduledSendWithLetter | null>(null);

  const joinContextQuery = useGetSpaceJoinContext(
    id,
    { userId },
    { query: { enabled: !!id && !!userId, queryKey: getGetSpaceJoinContextQueryKey(id, { userId }) } },
  );
  const spaceStatus = joinContextQuery.data?.space?.status ?? null;
  const isSpaceArchived = spaceStatus === "ARCHIVED";

  const sendsQuery = useListAllSpaceScheduledSends(id, { query: { enabled: !!id, queryKey: getListAllSpaceScheduledSendsQueryKey(id) } });
  const roundsQuery = useListSpaceRounds(id, { query: { enabled: !!id, queryKey: getListSpaceRoundsQueryKey(id) } });
  const lettersQuery = useListSpaceLetters(id, { query: { enabled: !!id, queryKey: getListSpaceLettersQueryKey(id) } });
  const articlesQuery = useListArticles(
    { authorId: userId, status: "LETTER" },
    { query: { enabled: !!userId, queryKey: getListArticlesQueryKey({ authorId: userId, status: "LETTER" }) } },
  );

  const updateSend = useUpdateSpaceScheduledSend();

  const sends = (sendsQuery.data ?? []) as SpaceScheduledSendWithLetter[];
  const rounds = (roundsQuery.data ?? []) as SpaceRound[];
  const letters = (lettersQuery.data ?? []) as SpaceLetter[];
  const articles = (articlesQuery.data ?? []) as Article[];

  // Derive round state: only block scheduling when all existing rounds are COMPLETED
  // (i.e., no ACTIVE and no UPCOMING rounds remain). UPCOMING rounds mean more rounds
  // are planned, so we should not treat that as a hard block.
  const hasAnyRound = rounds.length > 0;
  const isRoundCompleted =
    hasAnyRound &&
    rounds.every((r) => r.status === "COMPLETED");

  // Scheduling is blocked when space is archived or all rounds are completed
  const isSchedulingBlocked = isSpaceArchived || isRoundCompleted;
  const schedulingBlockReason = isSpaceArchived
    ? "종료된 공간이에요. 더 이상 글을 예약할 수 없어요."
    : isRoundCompleted
    ? "현재 진행 중인 회차가 없어요. 새 회차가 시작되면 예약할 수 있어요."
    : null;

  const isLoading = sendsQuery.isLoading;
  const isRefreshing = sendsQuery.isFetching;

  const refetchAll = useCallback(async () => {
    await Promise.all([
      sendsQuery.refetch(),
      roundsQuery.refetch(),
      lettersQuery.refetch(),
    ]);
  }, [sendsQuery, roundsQuery, lettersQuery]);

  const handleSaved = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListAllSpaceScheduledSendsQueryKey(id) });
    sendsQuery.refetch();
  }, [queryClient, id, sendsQuery]);

  const handleCancel = useCallback(
    async (send: SpaceScheduledSendWithLetter) => {
      Alert.alert("예약 취소", "이 예약 발송을 취소하시겠어요?", [
        { text: "돌아가기", style: "cancel" },
        {
          text: "취소",
          style: "destructive",
          onPress: async () => {
            try {
              await updateSend.mutateAsync({
                id,
                letterId: send.spaceLetterId,
                sendId: send.id,
                data: { status: "CANCELLED" },
              });
              sendsQuery.refetch();
            } catch {
              Alert.alert("오류", "취소에 실패했어요. 다시 시도해주세요.");
            }
          },
        },
      ]);
    },
    [id, updateSend, sendsQuery],
  );

  const handleGoToArchive = useCallback(() => {
    router.push("/(tabs)/on");
  }, [router]);

  const pendingSends = sends.filter((s) => s.status === "PENDING");
  const failedSends = sends.filter((s) => s.status === "FAILED");
  const completedSends = sends.filter((s) => s.status === "SENT" || s.status === "CANCELLED");

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ScalePressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </ScalePressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          글 예약 발송
        </Text>
        <ScalePressable
          onPress={() => {
            if (!isSchedulingBlocked) setShowNewSheet(true);
          }}
          hitSlop={8}
          style={isSchedulingBlocked ? { opacity: 0.35 } : undefined}
          disabled={isSchedulingBlocked}
        >
          <Feather name="plus" size={22} color={Colors.zinc700} />
        </ScalePressable>
      </View>

      {schedulingBlockReason && (
        <View style={styles.blockBanner}>
          <Feather name="lock" size={13} color={Colors.zinc500} />
          <Text style={styles.blockBannerText}>{schedulingBlockReason}</Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={Colors.zinc400} />
        </View>
      ) : (
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
          {sends.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="send" size={40} color={Colors.zinc300} />
              <Text style={styles.emptyTitle}>예약된 발송이 없어요</Text>
              <Text style={styles.emptySubtitle}>
                {isSchedulingBlocked
                  ? schedulingBlockReason
                  : "오른쪽 상단 + 버튼으로\n새 예약 발송을 등록하세요"}
              </Text>
            </View>
          ) : (
            <>
              {failedSends.length > 0 && (
                <>
                  <Text style={[styles.sectionHeader, styles.sectionHeaderFailed]}>
                    발송 실패 {failedSends.length}
                  </Text>
                  <View style={styles.sendList}>
                    {failedSends.map((send) => (
                      <SendRow
                        key={send.id}
                        send={send}
                        onCancel={() => handleCancel(send)}
                        onResend={() => setResendTarget(send)}
                        onChangePending={() => setChangeTarget(send)}
                        schedulingBlocked={isSchedulingBlocked}
                      />
                    ))}
                  </View>
                </>
              )}

              {pendingSends.length > 0 && (
                <>
                  <Text style={styles.sectionHeader}>예약 중 {pendingSends.length}</Text>
                  <View style={styles.sendList}>
                    {pendingSends.map((send) => (
                      <SendRow
                        key={send.id}
                        send={send}
                        onCancel={() => handleCancel(send)}
                        onResend={() => setResendTarget(send)}
                        onChangePending={() => setChangeTarget(send)}
                        schedulingBlocked={isSchedulingBlocked}
                      />
                    ))}
                  </View>
                </>
              )}

              {completedSends.length > 0 && (
                <>
                  <Text style={styles.sectionHeader}>완료·취소</Text>
                  <View style={styles.sendList}>
                    {completedSends.map((send) => (
                      <SendRow
                        key={send.id}
                        send={send}
                        onCancel={() => handleCancel(send)}
                        onResend={() => setResendTarget(send)}
                        onChangePending={() => setChangeTarget(send)}
                        schedulingBlocked={isSchedulingBlocked}
                      />
                    ))}
                  </View>
                </>
              )}
            </>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {showNewSheet && (
        <ArticleScheduleSheet
          mode="general"
          spaceId={id}
          userId={userId ?? ""}
          letters={letters}
          articles={articles}
          onClose={() => setShowNewSheet(false)}
          onSaved={handleSaved}
          onGoToArchive={handleGoToArchive}
          initialScheduledDate={scheduledDate || null}
          slotId={slotId || null}
        />
      )}

      {resendTarget && (
        <ResendSheet
          send={resendTarget}
          spaceId={id}
          onClose={() => setResendTarget(null)}
          onSaved={handleSaved}
        />
      )}

      {changeTarget && (
        <ChangeSheet
          send={changeTarget}
          spaceId={id}
          onClose={() => setChangeTarget(null)}
          onSaved={handleSaved}
        />
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
  blockBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: Colors.zinc50,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc200,
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 10,
  },
  blockBannerText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    flex: 1,
    lineHeight: 16,
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
  },
  sectionHeader: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
    fontWeight: "600",
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 20,
    paddingBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  sendList: {
    paddingHorizontal: Spacing.screenPx,
    gap: 10,
  },
  sendRow: {
    backgroundColor: Colors.zinc50,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    padding: 14,
    gap: 4,
  },
  sendRowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  sendStatusText: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: "600",
  },
  sendDateText: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc400,
    marginLeft: "auto",
  },
  sendArticleTitle: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc900,
  },
  sendArticleTitleEmpty: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
    fontStyle: "italic",
  },
  sendAuthor: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  sentAtText: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc400,
    marginTop: 2,
  },
  sendRowActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
    backgroundColor: Colors.white,
  },
  cancelBtnText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc600,
    fontWeight: "600",
  },
  changeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.noticeAccent,
    backgroundColor: Colors.white,
  },
  changeBtnText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.noticeAccent,
    fontWeight: "600",
  },
  resendBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.zinc900,
  },
  resendBtnText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.white,
    fontWeight: "600",
  },
  resendBtnFailed: {
    backgroundColor: "#FEF2F2",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  resendBtnTextFailed: {
    color: "#EF4444",
  },
  sendRowFailed: {
    borderColor: "#FECACA",
    backgroundColor: "#FFF7F7",
  },
  failedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#FEF2F2",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 2,
  },
  failedBannerText: {
    ...Typography.caption,
    fontSize: 11,
    color: "#EF4444",
    flex: 1,
    lineHeight: 15,
  },
  sectionHeaderFailed: {
    color: "#EF4444",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
    paddingHorizontal: Spacing.screenPx,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
    marginTop: 8,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
    textAlign: "center",
    lineHeight: 20,
  },
});

const sheetStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    zIndex: 100,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    maxHeight: "85%",
    gap: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sheetTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  fieldLabel: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "600",
    color: Colors.zinc500,
    marginTop: 12,
    marginBottom: 8,
  },
  letterList: {
    maxHeight: 200,
  },
  letterOptionOuter: {
    marginBottom: 6,
  },
  letterOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
  },
  letterOptionSelected: {
    borderColor: Colors.noticeAccent,
    backgroundColor: "#EFF6FF",
  },
  letterOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  letterOptionText: {
    flex: 1,
    gap: 2,
  },
  letterOptionTitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc900,
  },
  letterOptionRound: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc400,
  },
  emptyText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
    textAlign: "center",
    paddingVertical: 16,
  },
  emptyArticleState: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 10,
  },
  emptyArticleTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc700,
  },
  emptyArticleSubtitle: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc400,
    textAlign: "center",
    lineHeight: 19,
  },
  goToArchiveBtnOuter: {
    marginTop: 4,
  },
  goToArchiveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.zinc900,
  },
  goToArchiveBtnText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
  reservationInfo: {
    marginTop: 10,
    backgroundColor: Colors.zinc50,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    padding: 12,
    gap: 6,
  },
  reservationInfoTitle: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: "600",
    color: Colors.zinc400,
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  reservationInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  reservationInfoLabel: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    width: 60,
  },
  reservationInfoValue: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc800,
    flex: 1,
  },
  dateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  dateBtnText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc700,
  },
  resendTitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc700,
    marginBottom: 4,
  },
  saveBtnOuter: {
    marginTop: 16,
  },
  saveBtn: {
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
});
