import React, { useCallback, useState, useMemo, useEffect, useRef } from "react";
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
import { SpaceInfoNote } from "@/components/SpaceInfoNote/SpaceInfoNote";
import { SpaceCopy } from "@/constants/spaceCopy";
import { ArticleScheduleSheet } from "@/components/ArticleScheduleSheet/ArticleScheduleSheet";
import { SlotPickerSheet, type EmptySlot } from "@/components/ArticleScheduleSheet/SlotPickerSheet";
import { CollapsibleDatePicker, startOfDay } from "@/components/shared/CalendarGrid";
import {
  useListAllSpaceScheduledSends,
  useListSpaceRounds,
  useListSpaceLetters,
  useCreateSpaceScheduledSend,
  useUpdateSpaceScheduledSend,
  useListArticles,
  useGetSpaceJoinContext,
  getListAllSpaceScheduledSendsQueryKey,
  getListSpaceRoundsQueryKey,
  getListSpaceLettersQueryKey,
  getListSpaceRoundSlotsQueryKey,
  getListArticlesQueryKey,
  listSpaceRoundSlots,
} from "@workspace/api-client-react";
import type {
  SpaceScheduledSendWithLetter,
  SpaceRound,
  SpaceLetter,
  Article,
  SpaceRoundSlotWithUser,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/contexts/UserContext";
import { getUserScopedSpaceJoinContextQueryKey } from "@/lib/spaceJoinContextQuery";
import { ApiError } from "@workspace/api-client-react";
import { kstDateAt6, minOpeningSendDate, toKstCalendarDate } from "@/lib/kstDate";
import {
  getSpaceRoundPresentationStatus,
  isKstSlotReservable,
  isOpeningSlotReservable,
} from "@/lib/spaceRoundPresentation";

function dateToYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseYmdToLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((v) => parseInt(v, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Duplicate-pending-reservation conflict from the backend (409). */
function isDuplicateReservationError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

const DUPLICATE_RESERVATION_MESSAGE =
  "이미 같은 회차·역할로 대기 중인 예약이 있어요. 기존 예약을 변경하거나 취소한 뒤 다시 시도해주세요.";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatShortDate(dateOrYmd: string): string {
  // Plain "YYYY-MM-DD" strings (round-slot dates) must be read as calendar
  // fields, not parsed as a UTC instant, to avoid an off-by-one day shift.
  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOrYmd);
  if (ymdMatch) {
    return `${ymdMatch[2]}/${ymdMatch[3]}`;
  }
  const d = new Date(dateOrYmd);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function letterTypeLabel(type: string | null | undefined): string {
  if (type === "OPENING") return "여는 편지";
  if (type === "CENTER") return "중심글";
  if (type === "REPLY") return "답장";
  return "글";
}

/** e.g. "01/04 중심글" — built from the slot's assigned date (falls back to scheduledAt). */
function slotLabel(send: SpaceScheduledSendWithLetter): string {
  const dateSource = send.slotScheduledDate ?? send.scheduledAt;
  return `${formatShortDate(String(dateSource))} ${letterTypeLabel(send.letterType)}`;
}

function sendStatusLabel(status: string): string {
  if (status === "PENDING") return "대기 중";
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
  // A letter that references a source article but whose title cannot be
  // resolved has had that article deleted — the reservation itself is now
  // invalid. Use strict null/undefined here (not falsy) so a legitimately
  // blank-titled article isn't mistaken for a deleted one.
  const isArticleDeleted =
    !!send.letter?.sourceArticleId &&
    (send.articleTitle === null || send.articleTitle === undefined);

  return (
    <View style={[styles.sendRow, (isFailed || isArticleDeleted) && styles.sendRowFailed]}>
      <Text style={styles.slotLabelText}>{slotLabel(send)}</Text>
      <View style={styles.sendRowTop}>
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <Text style={[styles.sendStatusText, { color }]}>{sendStatusLabel(send.status)}</Text>
        <Text style={styles.sendDateText}>{formatDateTime(send.scheduledAt)}</Text>
      </View>
      {isFailed && (
        <View style={styles.failedBanner}>
          <Feather name="alert-circle" size={12} color="#EF4444" />
          <Text style={styles.failedBannerText}>
            {send.failureReason ?? "예약 시각에 발송되지 않았어요."} 다시 예약하거나 취소하세요.
          </Text>
        </View>
      )}
      {isArticleDeleted && isPending && (
        <View style={styles.failedBanner}>
          <Feather name="alert-circle" size={12} color="#EF4444" />
          <Text style={styles.failedBannerText}>예약된 글이 삭제됐어요. 예약을 취소하고 다른 글로 다시 예약해주세요.</Text>
        </View>
      )}
      {send.articleTitle ? (
        <Text style={styles.sendArticleTitle} numberOfLines={1}>
          {send.articleTitle}
        </Text>
      ) : (
        <Text style={styles.sendArticleTitleEmpty}>
          {isArticleDeleted ? "삭제된 글" : "제목 없음"}
        </Text>
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
            {!schedulingBlocked && !isArticleDeleted && (
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

/** Shared date-selection body used by both resend and change sheets. Time is
 * always fixed at 06:00 — the user only ever picks a calendar date. CENTER
 * letters are further restricted to the assigned slots (chip picker);
 * OPENING letters use the shared calendar grid, capped at the round's start
 * date; anything else falls back to the shared calendar grid unbounded. */
function FixedTimeDatePicker({
  send,
  selectedDate,
  onSelectDate,
  centerSlots,
  rounds,
}: {
  send: SpaceScheduledSendWithLetter;
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  /** Every round the user is assigned a CENTER slot in — this component
   * narrows it down to the round the being-edited `send` actually belongs
   * to, so it never offers a date from an unrelated round that the backend
   * would reject. */
  centerSlots: { date: string; roundId: string }[] | undefined;
  /** All space rounds — used to resolve an OPENING letter's round start date
   * (the upper bound for its reservation date). */
  rounds: SpaceRound[];
}) {
  const isCenter = send.letterType === "CENTER";
  const isOpening = send.letterType === "OPENING";
  const ownRoundId = send.letter?.spaceRoundId ?? null;
  const ownRoundSlots = centerSlots?.filter((s) => !ownRoundId || s.roundId === ownRoundId);
  const ownRound = ownRoundId ? rounds.find((r) => r.id === ownRoundId) : null;
  const maxDate = isOpening && ownRound?.startsAt ? toKstCalendarDate(new Date(ownRound.startsAt)) : undefined;

  if (isOpening) {
    return (
      <CollapsibleDatePicker
        value={selectedDate}
        onChange={onSelectDate}
        isDateDisabled={(date) => {
          const d0 = startOfDay(date);
          if (d0 < startOfDay(minOpeningSendDate())) return true;
          if (maxDate && d0 > startOfDay(maxDate)) return true;
          return false;
        }}
        formatButtonLabel={(date) => `${formatShortDate(date.toISOString())} 06:00`}
        triggerStyle={sheetStyles.dateBtn}
        triggerTextStyle={sheetStyles.dateBtnText}
      />
    );
  }

  if (isCenter) {
    if (ownRoundSlots === undefined) {
      return (
        <View style={sheetStyles.centerDatesLoading}>
          <ActivityIndicator size="small" color={Colors.zinc400} />
          <Text style={sheetStyles.centerDatesLoadingText}>배정된 차례를 확인하는 중이에요</Text>
        </View>
      );
    }
    if (ownRoundSlots.length === 0) {
      return (
        <SpaceInfoNote
          variant="inline"
          text={SpaceCopy.centerArticle_noSlotContext}
        />
      );
    }
    const selectedYmd = dateToYmd(selectedDate);
    return (
      <View style={sheetStyles.centerDateChipRow}>
        {ownRoundSlots.map((slot) => {
          const isSelected = slot.date === selectedYmd;
          return (
            <ScalePressable
              key={`${slot.roundId}:${slot.date}`}
              contentStyle={[
                sheetStyles.centerDateChip,
                isSelected && sheetStyles.centerDateChipSelected,
              ]}
              onPress={() => onSelectDate(parseYmdToLocalDate(slot.date))}
            >
              <Text
                style={[
                  sheetStyles.centerDateChipText,
                  isSelected && sheetStyles.centerDateChipTextSelected,
                ]}
              >
                {formatShortDate(slot.date)} 06:00
              </Text>
            </ScalePressable>
          );
        })}
      </View>
    );
  }

  return <FallbackNativeDatePicker selectedDate={selectedDate} onSelectDate={onSelectDate} />;
}

/** Native date picker fallback used only for letter types with no dedicated
 * calendar UI (currently none in practice — CENTER uses chips, OPENING uses
 * the shared CalendarGrid). Kept for forward-compat with any future letter
 * type that reaches this component. */
function FallbackNativeDatePicker({
  selectedDate,
  onSelectDate,
}: {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  return (
    <>
      <ScalePressable contentStyle={sheetStyles.dateBtn} onPress={() => setShowPicker(true)}>
        <Feather name="calendar" size={15} color={Colors.zinc500} />
        <Text style={sheetStyles.dateBtnText}>{formatShortDate(selectedDate.toISOString())} 06:00</Text>
      </ScalePressable>
      {showPicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(_event: unknown, date?: Date) => {
            setShowPicker(Platform.OS === "ios");
            if (date) onSelectDate(date);
          }}
          minimumDate={new Date()}
        />
      )}
    </>
  );
}
function ResendSheet({
  send,
  spaceId,
  centerSlots,
  rounds,
  onClose,
  onSaved,
}: {
  send: SpaceScheduledSendWithLetter;
  spaceId: string;
  centerSlots: { date: string; roundId: string }[] | undefined;
  rounds: SpaceRound[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selectedDate, setSelectedDate] = useState(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const [saving, setSaving] = useState(false);
  const createSend = useCreateSpaceScheduledSend();
  const isCenter = send.letterType === "CENTER";
  const isOpening = send.letterType === "OPENING";

  const ownRoundSlots = useMemo(
    () => centerSlots?.filter((s) => !send.letter?.spaceRoundId || s.roundId === send.letter.spaceRoundId),
    [centerSlots, send.letter?.spaceRoundId],
  );
  const ownRound = send.letter?.spaceRoundId ? rounds.find((r) => r.id === send.letter!.spaceRoundId) : null;
  const openingMaxDate = isOpening && ownRound?.startsAt ? toKstCalendarDate(new Date(ownRound.startsAt)) : undefined;

  // For CENTER letters, the selection must always land exactly on one of the
  // user's assigned slot dates — auto-select the first valid one as soon as
  // slots resolve, and re-snap if the current selection ever falls outside
  // the assigned set (e.g. slots reload with different data).
  useEffect(() => {
    if (!isCenter || !ownRoundSlots || ownRoundSlots.length === 0) return;
    const selectedYmd = dateToYmd(selectedDate);
    if (!ownRoundSlots.some((s) => s.date === selectedYmd)) {
      setSelectedDate(parseYmdToLocalDate(ownRoundSlots[0].date));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCenter, ownRoundSlots]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const finalScheduledAt = kstDateAt6(selectedDate);
      await createSend.mutateAsync({
        id: spaceId,
        letterId: send.spaceLetterId,
        data: { scheduledAt: finalScheduledAt.toISOString() },
      });
      onSaved();
      onClose();
    } catch (err) {
      if (isDuplicateReservationError(err)) {
        Alert.alert("이미 예약이 있어요", DUPLICATE_RESERVATION_MESSAGE);
      } else {
        Alert.alert("오류", "예약에 실패했어요. 다시 시도해주세요.");
      }
    } finally {
      setSaving(false);
    }
  }, [selectedDate, spaceId, send, createSend, onSaved, onClose]);

  const isValidCenterSelection =
    isCenter && !!ownRoundSlots?.some((s) => s.date === dateToYmd(selectedDate));
  const isValidOpeningSelection =
    !isOpening || startOfDay(selectedDate) >= startOfDay(minOpeningSendDate()) &&
      (!openingMaxDate || startOfDay(selectedDate) <= startOfDay(openingMaxDate));
  const canSave = isCenter ? isValidCenterSelection : isValidOpeningSelection;

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

        <Text style={sheetStyles.fieldLabel}>새 발송 예정일 (06:00 고정 발송)</Text>
        <FixedTimeDatePicker
          send={send}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          centerSlots={centerSlots}
          rounds={rounds}
        />

        <ScalePressable
          style={sheetStyles.saveBtnOuter}
          contentStyle={[sheetStyles.saveBtn, (saving || !canSave) && sheetStyles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving || !canSave}
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
  centerSlots,
  rounds,
  onClose,
  onSaved,
}: {
  send: SpaceScheduledSendWithLetter;
  spaceId: string;
  centerSlots: { date: string; roundId: string }[] | undefined;
  rounds: SpaceRound[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selectedDate, setSelectedDate] = useState(new Date(send.scheduledAt));
  const [saving, setSaving] = useState(false);
  const updateSend = useUpdateSpaceScheduledSend();
  const isCenter = send.letterType === "CENTER";
  const isOpening = send.letterType === "OPENING";

  const ownRoundSlots = useMemo(
    () => centerSlots?.filter((s) => !send.letter?.spaceRoundId || s.roundId === send.letter.spaceRoundId),
    [centerSlots, send.letter?.spaceRoundId],
  );
  const ownRound = send.letter?.spaceRoundId ? rounds.find((r) => r.id === send.letter!.spaceRoundId) : null;
  const openingMaxDate = isOpening && ownRound?.startsAt ? toKstCalendarDate(new Date(ownRound.startsAt)) : undefined;

  // For CENTER letters, the selection must always land exactly on one of the
  // user's assigned slot dates — snap to the first valid one (or to the
  // send's current date if it's still valid) as soon as slots resolve.
  useEffect(() => {
    if (!isCenter || !ownRoundSlots || ownRoundSlots.length === 0) return;
    const selectedYmd = dateToYmd(selectedDate);
    if (!ownRoundSlots.some((s) => s.date === selectedYmd)) {
      setSelectedDate(parseYmdToLocalDate(ownRoundSlots[0].date));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCenter, ownRoundSlots]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const finalScheduledAt = kstDateAt6(selectedDate);
      await updateSend.mutateAsync({
        id: spaceId,
        letterId: send.spaceLetterId,
        sendId: send.id,
        data: { status: "PENDING", scheduledAt: finalScheduledAt.toISOString() },
      });
      onSaved();
      onClose();
    } catch (err) {
      if (isDuplicateReservationError(err)) {
        Alert.alert("이미 예약이 있어요", DUPLICATE_RESERVATION_MESSAGE);
      } else {
        Alert.alert("오류", "예약 변경에 실패했어요. 다시 시도해주세요.");
      }
    } finally {
      setSaving(false);
    }
  }, [selectedDate, spaceId, send, updateSend, onSaved, onClose]);

  const isValidCenterSelection =
    isCenter && !!ownRoundSlots?.some((s) => s.date === dateToYmd(selectedDate));
  const isValidOpeningSelection =
    !isOpening || startOfDay(selectedDate) >= startOfDay(minOpeningSendDate()) &&
      (!openingMaxDate || startOfDay(selectedDate) <= startOfDay(openingMaxDate));
  const canSave = isCenter ? isValidCenterSelection : isValidOpeningSelection;

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

        <Text style={sheetStyles.fieldLabel}>새 발송 예정일 (06:00 고정 발송)</Text>
        <FixedTimeDatePicker
          send={send}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          centerSlots={centerSlots}
          rounds={rounds}
        />

        <ScalePressable
          style={sheetStyles.saveBtnOuter}
          contentStyle={[sheetStyles.saveBtn, (saving || !canSave) && sheetStyles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving || !canSave}
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
  const { id, slotId, roundId, scheduledDate, openingRoundId } = useLocalSearchParams<{
    id: string;
    slotId?: string;
    roundId?: string;
    scheduledDate?: string;
    openingRoundId?: string;
  }>();
  const { userId } = useUser();
  const queryClient = useQueryClient();

  const [showNewSheet, setShowNewSheet] = useState(false);
  const [resendTarget, setResendTarget] = useState<SpaceScheduledSendWithLetter | null>(null);
  const [changeTarget, setChangeTarget] = useState<SpaceScheduledSendWithLetter | null>(null);
  // "새 글 예약하기" flow: pick an empty slot first, then the article to fill it.
  const [showSlotPicker, setShowSlotPicker] = useState(false);
  const [pickedSlot, setPickedSlot] = useState<EmptySlot | null>(null);

  const joinContextQuery = useGetSpaceJoinContext(
    id,
    { query: { enabled: !!id && !!userId, queryKey: getUserScopedSpaceJoinContextQueryKey(id, userId) } },
  );
  const space = joinContextQuery.data?.space ?? null;
  const spaceStatus = space?.status ?? null;
  const isSpaceArchived = spaceStatus === "ARCHIVED";
  const isOperator = joinContextQuery.data?.participation?.role === "OPERATOR";

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
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const presentationRounds = useMemo<SpaceRound[]>(
    () =>
      rounds.map((round) => ({
        ...round,
        status: getSpaceRoundPresentationStatus(round, now) as SpaceRound["status"],
      })),
    [rounds, now],
  );

  // The round being highlighted in the header: the one the user navigated in
  // for (roundId param), otherwise the current ACTIVE round, otherwise the
  // nearest UPCOMING one.
  const currentRound = useMemo(() => {
    if (roundId) {
      const match = presentationRounds.find((r) => r.id === roundId);
      if (match) return match;
    }
    return (
      presentationRounds.find((r) => r.status === "ACTIVE") ??
      presentationRounds.find((r) => r.status === "UPCOMING") ??
      null
    );
  }, [presentationRounds, roundId]);

  // ─── "내 차례" CENTER slot dates, gathered across ACTIVE/UPCOMING rounds ────
  // `allCenterSlots` always includes every round the user is assigned a CENTER
  // slot in (regardless of existing reservations) — it's the source of truth
  // used to resolve "which date belongs to which round" for editing an
  // existing reservation. `newReservationCenterSlots` (derived below) narrows
  // that down to rounds that don't already have a pending reservation, and is
  // only used when creating a brand-new reservation.
  const [allCenterSlots, setAllCenterSlots] = useState<
    { date: string; roundId: string }[] | undefined
  >(undefined);
  // Rounds where the user IS the assigned CENTER slot (same criterion the
  // space detail screen uses: `assignedUserId === userId`, independent of
  // whether `scheduledDate` is set) but the slot has no date yet — leftover
  // data from before slot dates were assigned at space-start time. These
  // must NOT be treated as "no assignment": surface a distinct message
  // instead of the generic "already posted everything" one.
  const [unresolvedCenterRoundIds, setUnresolvedCenterRoundIds] = useState<Set<string> | undefined>(
    undefined,
  );
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!id || !userId) {
        setAllCenterSlots([]);
        setUnresolvedCenterRoundIds(new Set());
        return;
      }
      // The rounds query hasn't resolved yet — `rounds` is just the `?? []`
      // fallback, not a real "no rounds" answer. Stay in the loading state
      // (undefined) instead of prematurely deciding there's nothing assigned.
      if (roundsQuery.isLoading) {
        setAllCenterSlots(undefined);
        setUnresolvedCenterRoundIds(undefined);
        return;
      }
      const targetRounds = presentationRounds.filter(
        (r) => r.status === "ACTIVE" || r.status === "UPCOMING",
      );
      if (targetRounds.length === 0) {
        setAllCenterSlots([]);
        setUnresolvedCenterRoundIds(new Set());
        return;
      }
      setAllCenterSlots(undefined);
      setUnresolvedCenterRoundIds(undefined);
      const results = await Promise.all(
        targetRounds.map((r) =>
          listSpaceRoundSlots(id, r.id).catch(() => [] as SpaceRoundSlotWithUser[]),
        ),
      );
      if (cancelled) return;
      const mine: { date: string; roundId: string }[] = [];
      const unresolved = new Set<string>();
      targetRounds.forEach((r, idx) => {
        const mySlot = results[idx].find((s) => s.assignedUserId === userId);
        if (mySlot?.scheduledDate && isKstSlotReservable(mySlot.scheduledDate, now)) {
          mine.push({ date: mySlot.scheduledDate, roundId: r.id });
        } else if (mySlot) {
          unresolved.add(r.id);
        }
      });
      setAllCenterSlots(mine);
      setUnresolvedCenterRoundIds(unresolved);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [id, userId, presentationRounds, roundsQuery.isLoading, now]);

  // Rounds where the user already has a PENDING CENTER reservation — picking
  // one of these again for a *new* reservation would just trigger the
  // backend's duplicate-slot rejection, so exclude them from that flow only.
  const pendingCenterRoundIds = useMemo(
    () =>
      new Set(
        sends
          .filter(
            (s) =>
              s.status === "PENDING" &&
              s.letterType === "CENTER" &&
              s.letter?.authorId === userId,
          )
          .map((s) => s.letter?.spaceRoundId)
          .filter((v): v is string => !!v),
      ),
    [sends, userId],
  );
  // Rounds where the user's CENTER letter has already been sent — that slot
  // is used up and shouldn't be offered again for a *new* reservation either.
  const sentCenterRoundIds = useMemo(
    () =>
      new Set(
        sends
          .filter(
            (s) =>
              s.status === "SENT" &&
              s.letterType === "CENTER" &&
              s.letter?.authorId === userId,
          )
          .map((s) => s.letter?.spaceRoundId)
          .filter((v): v is string => !!v),
      ),
    [sends, userId],
  );
  const newReservationCenterSlots = useMemo(
    () =>
      allCenterSlots?.filter(
        (s) =>
          isKstSlotReservable(s.date, now) &&
          !pendingCenterRoundIds.has(s.roundId) &&
          !sentCenterRoundIds.has(s.roundId),
      ),
    [allCenterSlots, pendingCenterRoundIds, sentCenterRoundIds, now],
  );
  // Assigned CENTER slots that still have no `scheduledDate` and aren't
  // already covered by a pending/sent reservation — these are the ones the
  // "이미 글을 모두 올렸어요!" check must NOT silently swallow.
  const hasUnresolvedCenterAssignment = useMemo(
    () =>
      !!unresolvedCenterRoundIds &&
      [...unresolvedCenterRoundIds].some(
        (rid) => !pendingCenterRoundIds.has(rid) && !sentCenterRoundIds.has(rid),
      ),
    [unresolvedCenterRoundIds, pendingCenterRoundIds, sentCenterRoundIds],
  );

  // Opening letters are reservable per-round: only an operator may add them
  // and only while the round's KST 06:00 opening deadline is still ahead.
  // Existing opening reservations do not consume the round; multiple sends
  // may coexist for the same round and date.
  const openingEligibleRounds = useMemo(
    () =>
      isOperator
        ? presentationRounds.filter((r) => {
            if (r.status === "COMPLETED") return false;
            return isOpeningSlotReservable(r.startsAt, now);
          })
        : [],
    [isOperator, presentationRounds, now],
  );

  // ─── Empty slots available for a brand-new reservation ─────────────────────
  // `undefined` while the assigned CENTER slot dates are still resolving.
  const emptySlots = useMemo((): EmptySlot[] | undefined => {
    if (newReservationCenterSlots === undefined) return undefined;
    const list: EmptySlot[] = [];
    openingEligibleRounds.forEach((r) => {
      list.push({
        kind: "opening",
        roundId: r.id,
        roundNumber: r.roundNumber,
        maxDate: r.startsAt ?? null,
      });
    });
    newReservationCenterSlots.forEach((s) => {
      list.push({
        kind: "center",
        date: s.date,
        roundId: s.roundId,
        roundNumber: presentationRounds.find((r) => r.id === s.roundId)?.roundNumber ?? null,
      });
    });
    return list;
  }, [newReservationCenterSlots, openingEligibleRounds, presentationRounds]);

  // Derive round state: only block scheduling when all existing rounds are COMPLETED
  // (i.e., no ACTIVE and no UPCOMING rounds remain). UPCOMING rounds mean more rounds
  // are planned, so we should not treat that as a hard block.
  const hasAnyRound = presentationRounds.length > 0;
  const isRoundCompleted =
    hasAnyRound &&
    presentationRounds.every((r) => r.status === "COMPLETED");

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
    queryClient.invalidateQueries({ queryKey: getListSpaceLettersQueryKey(id) });
    rounds.forEach((round) => {
      queryClient.invalidateQueries({
        queryKey: getListSpaceRoundSlotsQueryKey(id, round.id),
      });
    });
  }, [queryClient, id, rounds]);

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
              handleSaved();
            } catch {
              Alert.alert("오류", "취소에 실패했어요. 다시 시도해주세요.");
            }
          },
        },
      ]);
    },
    [id, updateSend, handleSaved],
  );

  const handleGoToArchive = useCallback(() => {
    router.push("/(tabs)/on");
  }, [router]);

  const handleStartNewReservation = useCallback(() => {
    if (isSchedulingBlocked || emptySlots === undefined) return;
    if (emptySlots.length === 0) {
      // Don't tell an assigned-but-undated member "you already posted
      // everything" — that's only true when there really is no open slot.
      // A leftover slot with no `scheduledDate` (pre-fix data) still means
      // they have a turn; they just can't self-serve a date here.
      if (hasUnresolvedCenterAssignment) {
        Alert.alert(
          "알림",
          "배정된 자리가 있지만 날짜가 아직 설정되지 않았어요. 공간장에게 문의해주세요.",
        );
        return;
      }
      Alert.alert("알림", "이미 글을 모두 올렸어요!");
      return;
    }
    setShowSlotPicker(true);
  }, [isSchedulingBlocked, emptySlots, hasUnresolvedCenterAssignment]);

  const handlePickSlot = useCallback((slot: EmptySlot) => {
    setShowSlotPicker(false);
    setPickedSlot(slot);
  }, []);

  // Deep-link from the round card's "여는 편지 작성" button: preselect that
  // round's opening slot and jump straight into article/date selection,
  // skipping the slot picker sheet entirely. Re-validated against the same
  // eligibility list the slot picker itself uses (operator role, round
  // status, feasible date window) so this entry point can never bypass
  // those checks — if the
  // round isn't eligible, tell the user why instead of silently leaving
  // them stranded on the reservation-list screen. The space-detail button
  // should normally always succeed; the alert only fires for the narrow
  // race where the round started between navigation and data resolution.
  //
  // This is a one-shot action, consumed via `consumedOpeningRoundIdRef`: once
  // it has auto-picked (or attempted to, for a given value), it never fires
  // again for that value — otherwise, since the `openingRoundId` route param
  // persists after the user closes the compose sheet (pickedSlot resets to
  // null on close), this effect would immediately reopen the sheet in a loop.
  const consumedOpeningRoundIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openingRoundId) return;
    if (consumedOpeningRoundIdRef.current === openingRoundId) return;
    // `openingEligibleRounds` is only trustworthy once every data source it
    // (transitively) depends on has finished loading:
    //   - roundsQuery / sendsQuery: rounds + existing opening sends
    //   - joinContextQuery: the operator role check (`isOperator`) — without
    //     this, isOperator defaults to false and every round looks
    //     ineligible, so an operator's deep link would be wrongly
    //     "consumed" as a no-op before their role ever loads.
    // While any of these are still loading, bail WITHOUT marking this
    // openingRoundId as consumed, so the effect re-runs and gets a real
    // shot once all the data is in — instead of only ever getting one
    // (premature) attempt.
    if (roundsQuery.isLoading || sendsQuery.isLoading || joinContextQuery.isLoading) return;
    consumedOpeningRoundIdRef.current = openingRoundId;
    const round = openingEligibleRounds.find((r) => r.id === openingRoundId);
    if (round) {
      setPickedSlot({
        kind: "opening",
        roundId: round.id,
        roundNumber: round.roundNumber,
        maxDate: round.startsAt ?? null,
      });
      return;
    }
    // Not eligible after all — figure out the most likely reason so the
    // message isn't a generic dead end.
    const targetRound = presentationRounds.find((r) => r.id === openingRoundId);
    const message =
      targetRound && targetRound.status === "COMPLETED"
        ? "이미 회차가 끝나 여는 편지를 예약할 수 없어요."
        : "지금은 이 회차에 여는 편지를 예약할 수 없어요.";
    Alert.alert("예약할 수 없어요", message);
  }, [
    openingRoundId,
    roundsQuery.isLoading,
    sendsQuery.isLoading,
    joinContextQuery.isLoading,
    openingEligibleRounds,
    presentationRounds,
  ]);

  // A direct route from a slot card is only a shortcut. It must wait for the
  // same resolved, still-reservable slot list used by the regular picker so a
  // stale link can never open a past slot's reservation sheet.
  const consumedSlotIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!slotId || consumedSlotIdRef.current === slotId) return;
    if (roundsQuery.isLoading || allCenterSlots === undefined) return;
    consumedSlotIdRef.current = slotId;
    const target = newReservationCenterSlots?.find(
      (slot) => slot.roundId === roundId && slot.date === scheduledDate,
    );
    if (target) {
      setShowNewSheet(true);
      return;
    }
    Alert.alert("예약할 수 없어요", "이 슬롯의 예약 가능 시간이 지났거나 이미 사용되었어요.");
  }, [
    slotId,
    roundId,
    scheduledDate,
    roundsQuery.isLoading,
    allCenterSlots,
    newReservationCenterSlots,
  ]);

  const pendingSends = sends.filter((s) => s.status === "PENDING");
  const failedSends = sends.filter((s) => s.status === "FAILED");

  const handleBackToSpaceDetail = useCallback(() => {
    router.push({ pathname: "/of-space-detail", params: { id } });
  }, [router, id]);

  // Slot label for the header sub-line — prefer the slot the user navigated
  // here for; otherwise fall back to the most relevant pending reservation.
  const headerSlotSource =
    (slotId && pendingSends.find((s) => s.slotId === slotId)) || pendingSends[0] || null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ScalePressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </ScalePressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          예약 목록
        </Text>
        <SpaceInfoNote variant="popup" text={SpaceCopy.scheduledSend_slotRelation} />
      </View>

      {space && (
        <View style={styles.contextHeader}>
          <Text style={styles.contextSpaceName} numberOfLines={1}>
            {space.name}
          </Text>
          <View style={styles.contextMetaRow}>
            {currentRound && (
              <Text style={styles.contextMetaText}>
                {currentRound.roundNumber}/{space.roundCount}회차
              </Text>
            )}
            {headerSlotSource && (
              <>
                {currentRound && <Text style={styles.contextMetaDot}>·</Text>}
                <Text style={styles.contextMetaText}>{slotLabel(headerSlotSource)}</Text>
              </>
            )}
          </View>
        </View>
      )}

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

          {pendingSends.length > 0 ? (
            <>
              <Text style={styles.sectionHeader}>대기 중 {pendingSends.length}</Text>
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
          ) : (
            failedSends.length === 0 && (
              <View style={styles.emptyState}>
                <Feather name="send" size={40} color={Colors.zinc300} />
                <Text style={styles.emptyTitle}>현재 대기 중인 예약이 없어요</Text>
                <Text style={styles.emptySubtitle}>
                  {isSchedulingBlocked
                    ? schedulingBlockReason
                    : "아래 버튼으로\n새 예약을 등록하세요"}
                </Text>
                <ScalePressable
                  style={styles.footerBtnOuter}
                  contentStyle={[
                    styles.footerBtn,
                    (isSchedulingBlocked || emptySlots === undefined) && styles.footerBtnDisabled,
                  ]}
                  onPress={handleStartNewReservation}
                  disabled={isSchedulingBlocked || emptySlots === undefined}
                >
                  <Text style={styles.footerBtnText}>새 글 예약하기</Text>
                </ScalePressable>
              </View>
            )
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <ScalePressable
          style={styles.footerBtnOuter}
          contentStyle={[
            styles.footerBtn,
            (isSchedulingBlocked || emptySlots === undefined) && styles.footerBtnDisabled,
          ]}
          onPress={handleStartNewReservation}
          disabled={isSchedulingBlocked || emptySlots === undefined}
        >
          <Text style={styles.footerBtnText}>새 글 예약하기</Text>
        </ScalePressable>
      </View>

      <SlotPickerSheet
        visible={showSlotPicker}
        isLoading={emptySlots === undefined}
        slots={emptySlots ?? []}
        onSelect={handlePickSlot}
        onClose={() => setShowSlotPicker(false)}
      />

      {pickedSlot && (
        <ArticleScheduleSheet
          mode={pickedSlot.kind === "opening" ? "opening-letter" : "general"}
          spaceId={id}
          userId={userId ?? ""}
          letters={letters}
          articles={articles}
          isArticlesLoading={articlesQuery.isLoading}
          isArticlesError={articlesQuery.isError}
          onRefetchArticles={() => articlesQuery.refetch()}
          onClose={() => setPickedSlot(null)}
          onSaved={handleSaved}
          onGoToArchive={handleGoToArchive}
          assignedCenterSlots={pickedSlot.kind === "center" ? [pickedSlot] : undefined}
          initialScheduledDate={pickedSlot.kind === "center" ? pickedSlot.date : null}
          isLoadingCenterDates={false}
          openingRoundId={pickedSlot.kind === "opening" ? pickedSlot.roundId : null}
          maxScheduledAt={
            pickedSlot.kind === "opening" && pickedSlot.maxDate
              ? toKstCalendarDate(new Date(pickedSlot.maxDate))
              : null
          }
        />
      )}

      {showNewSheet && (
        <ArticleScheduleSheet
          mode="general"
          spaceId={id}
          userId={userId ?? ""}
          letters={letters}
          articles={articles}
          isArticlesLoading={articlesQuery.isLoading}
          isArticlesError={articlesQuery.isError}
          onRefetchArticles={() => articlesQuery.refetch()}
          onClose={() => setShowNewSheet(false)}
          onSaved={handleSaved}
          onGoToArchive={handleGoToArchive}
          initialScheduledDate={scheduledDate || null}
          slotId={slotId || null}
          assignedCenterSlots={newReservationCenterSlots}
          isLoadingCenterDates={allCenterSlots === undefined}
        />
      )}

      {resendTarget && (
        <ResendSheet
          send={resendTarget}
          spaceId={id}
          centerSlots={allCenterSlots}
          rounds={presentationRounds}
          onClose={() => setResendTarget(null)}
          onSaved={handleSaved}
        />
      )}

      {changeTarget && (
        <ChangeSheet
          send={changeTarget}
          spaceId={id}
          centerSlots={allCenterSlots}
          rounds={presentationRounds}
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
  contextHeader: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    gap: 4,
  },
  contextSpaceName: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  contextMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  contextMetaText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  contextMetaDot: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc300, // typography-ok: decorative metadata dot
  },
  slotLabelText: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "700",
    color: Colors.zinc500,
    marginBottom: 2,
  },
  footer: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc200,
    backgroundColor: Colors.white,
  },
  footerBtnOuter: {},
  footerBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
    backgroundColor: Colors.white,
  },
  footerBtnDisabled: {
    opacity: 0.4,
  },
  footerBtnText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc700,
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
    color: Colors.zinc500,
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
    fontSize: 12,
    fontWeight: "600",
  },
  sendDateText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
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
    color: Colors.zinc400, // typography-ok: unselected/placeholder text
    fontStyle: "italic",
  },
  sendAuthor: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  sentAtText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
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
    fontSize: 12,
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
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 20,
  },
});

const sheetStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
    zIndex: 100,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
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
    fontSize: 12,
    color: Colors.zinc500,
  },
  emptyText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
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
    color: Colors.zinc500,
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
    fontSize: 12,
    fontWeight: "600",
    color: Colors.zinc500,
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
  centerDatesLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
  },
  centerDatesLoadingText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
  },
  centerDateChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  centerDateChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
    backgroundColor: Colors.white,
  },
  centerDateChipSelected: {
    borderColor: Colors.zinc900,
    backgroundColor: Colors.zinc900,
  },
  centerDateChipText: {
    ...Typography.body,
    fontSize: 13,
    fontWeight: "600",
    color: Colors.zinc600,
  },
  centerDateChipTextSelected: {
    color: Colors.white,
  },
});
