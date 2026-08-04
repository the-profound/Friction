import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";
import { LetterPickerSheet } from "@/components/shared/LetterPickerSheet";
import {
  useCreateSpaceScheduledSend,
  useCreateSpaceLetter,
  useUpdateSpaceScheduledSend,
  getListSpaceLettersQueryKey,
  getListAllSpaceScheduledSendsQueryKey,
  ApiError,
} from "@workspace/api-client-react";
import type {
  Article,
  SpaceLetter,
  SpaceScheduledSendWithLetter,
} from "@workspace/api-client-react";
import { kstDateAt6 } from "@/lib/kstDate";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(date: Date): string {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function formatShortDate(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${m}/${d}`;
}

function parseYmdToLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((v) => parseInt(v, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

function getMinOpeningDate(): Date {
  const now = new Date();
  const min = new Date(now);
  min.setHours(0, 0, 0, 0);
  if (now.getHours() >= 6) {
    min.setDate(min.getDate() + 1);
  }
  return min;
}

function buildOpeningScheduledAt(date: Date): Date {
  const d = new Date(date);
  d.setHours(6, 0, 0, 0);
  return d;
}

/** Duplicate-pending-reservation conflict from the backend (409). */
function isDuplicateReservationError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

const DUPLICATE_RESERVATION_MESSAGE =
  "이미 같은 회차·역할로 대기 중인 예약이 있어요. 기존 예약을 변경하거나 취소한 뒤 다시 시도해주세요.";

// ─── Props ────────────────────────────────────────────────────────────────────

export type ArticleScheduleSheetMode = "general" | "opening-letter";

export type ArticleScheduleSheetProps = {
  mode: ArticleScheduleSheetMode;
  spaceId: string;
  userId: string;
  letters: SpaceLetter[];
  articles: Article[];
  isArticlesLoading?: boolean;
  isArticlesError?: boolean;
  onRefetchArticles?: () => void;
  onClose: () => void;
  onSaved: () => void;
  slotId?: string | null;
  initialScheduledDate?: string | null;
  allSends?: SpaceScheduledSendWithLetter[];
  onGoToArchive?: () => void;
  /** Opening-letter mode only: latest allowed scheduled date (inclusive). Saves are clamped to this. */
  maxScheduledAt?: Date | null;
  /**
   * General (CENTER) mode only: the set of "내 차례" round-slot dates the user
   * is allowed to pick from, each tied to the round it belongs to.
   * `undefined` means still loading; an empty array means the user has no
   * assigned CENTER slot yet.
   */
  assignedCenterSlots?: { date: string; roundId: string }[];
  /** General (CENTER) mode only: true while assigned slot dates are being resolved. */
  isLoadingCenterDates?: boolean;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ArticleScheduleSheet({
  mode,
  spaceId,
  userId,
  letters,
  articles,
  isArticlesLoading = false,
  isArticlesError = false,
  onRefetchArticles,
  onClose,
  onSaved,
  slotId,
  initialScheduledDate,
  allSends,
  onGoToArchive,
  maxScheduledAt,
  assignedCenterSlots,
  isLoadingCenterDates = false,
}: ArticleScheduleSheetProps) {
  const isOpeningLetter = mode === "opening-letter";

  const minDate = useMemo(
    () => (isOpeningLetter ? getMinOpeningDate() : new Date()),
    [isOpeningLetter],
  );

  const maxDate = isOpeningLetter && maxScheduledAt ? maxScheduledAt : undefined;

  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  // Open the picker immediately on mount so the user lands directly in the
  // OUT-style article list without an extra tap.
  const [letterPickerVisible, setLetterPickerVisible] = useState(true);
  const [scheduledAt, setScheduledAt] = useState<Date>(() => {
    if (isOpeningLetter) return minDate;
    return new Date(Date.now() + 24 * 60 * 60 * 1000);
  });
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  // ─── CENTER (general mode) date restriction ────────────────────────────────
  // Only the author's assigned "내 차례" round-slot dates are selectable.
  const sortedCenterSlots = useMemo(
    () =>
      assignedCenterSlots
        ? [...assignedCenterSlots].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        : [],
    [assignedCenterSlots],
  );
  const sortedCenterDatesKey = sortedCenterSlots.map((s) => s.date).join(",");
  const [selectedCenterDate, setSelectedCenterDate] = useState<string | null>(
    () => initialScheduledDate ?? null,
  );
  // Keep the selection in sync once assigned dates resolve: default to the
  // pre-filled slot date if it's still valid, otherwise the first available one.
  const centerDatesReady = !isOpeningLetter && assignedCenterSlots !== undefined;
  React.useEffect(() => {
    if (isOpeningLetter || !centerDatesReady) return;
    setSelectedCenterDate((prev) => {
      const dates = sortedCenterSlots.map((s) => s.date);
      if (prev && dates.includes(prev)) return prev;
      return dates[0] ?? null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerDatesReady, sortedCenterDatesKey]);

  const selectedCenterSlot = useMemo(
    () => sortedCenterSlots.find((s) => s.date === selectedCenterDate) ?? null,
    [sortedCenterSlots, selectedCenterDate],
  );

  const createSend = useCreateSpaceScheduledSend();
  const createLetter = useCreateSpaceLetter();
  const updateSend = useUpdateSpaceScheduledSend();
  const queryClient = useQueryClient();

  const pickerArticles = useMemo(
    () =>
      articles.map((a) => ({
        id: a.id,
        title: a.title ?? null,
        content: (a as unknown as { content?: string | null }).content ?? null,
      })),
    [articles],
  );

  const selectedArticleTitle = useMemo(() => {
    if (!selectedArticleId) return null;
    return pickerArticles.find((a) => a.id === selectedArticleId)?.title ?? "제목 없음";
  }, [selectedArticleId, pickerArticles]);

  const handleSave = useCallback(async () => {
    if (!selectedArticleId) {
      Alert.alert("알림", "발송할 글을 선택해주세요.");
      return;
    }
    if (!isOpeningLetter && !selectedCenterSlot) {
      Alert.alert("알림", "배정된 중심글 차례 날짜를 선택해주세요.");
      return;
    }
    setSaving(true);
    try {
      if (isOpeningLetter) {
        const letterType = "OPENING";

        const existingLetter = letters.find(
          (l) => l.sourceArticleId === selectedArticleId && l.letterType === letterType,
        );
        let spaceLetterId: string;
        if (existingLetter) {
          spaceLetterId = existingLetter.id;
        } else {
          const newLetter = await createLetter.mutateAsync({
            id: spaceId,
            data: { authorId: userId, sourceArticleId: selectedArticleId, letterType },
          });
          spaceLetterId = newLetter.id;
          queryClient.invalidateQueries({ queryKey: getListSpaceLettersQueryKey(spaceId) });
        }

        const openingLetterIds = new Set(
          letters.filter((l) => l.letterType === "OPENING").map((l) => l.id),
        );
        if (existingLetter) openingLetterIds.add(spaceLetterId);

        const pendingOpeningSends = (allSends ?? []).filter(
          (s) => s.status === "PENDING" && openingLetterIds.has(s.spaceLetterId),
        );
        await Promise.all(
          pendingOpeningSends.map((s) =>
            updateSend.mutateAsync({
              id: spaceId,
              letterId: s.spaceLetterId,
              sendId: s.id,
              data: { status: "CANCELLED" },
            }),
          ),
        );

        let chosenDate = scheduledAt;
        if (maxDate && chosenDate > maxDate) {
          chosenDate = maxDate;
        }
        const finalScheduledAt = buildOpeningScheduledAt(chosenDate);
        await createSend.mutateAsync({
          id: spaceId,
          letterId: spaceLetterId,
          data: { scheduledAt: finalScheduledAt.toISOString() },
        });
        queryClient.invalidateQueries({ queryKey: getListAllSpaceScheduledSendsQueryKey(spaceId) });
      } else {
        // selectedCenterSlot is guaranteed non-null here (checked above).
        const centerSlot = selectedCenterSlot!;
        const existingLetter = letters.find(
          (l) => l.sourceArticleId === selectedArticleId && l.spaceRoundId === centerSlot.roundId,
        );
        let spaceLetterId: string;
        if (existingLetter) {
          spaceLetterId = existingLetter.id;
        } else {
          const newLetter = await createLetter.mutateAsync({
            id: spaceId,
            data: {
              authorId: userId,
              sourceArticleId: selectedArticleId,
              letterType: "CENTER",
              spaceRoundId: centerSlot.roundId,
            },
          });
          spaceLetterId = newLetter.id;
          queryClient.invalidateQueries({ queryKey: getListSpaceLettersQueryKey(spaceId) });
        }
        const finalScheduledAt = kstDateAt6(parseYmdToLocalDate(centerSlot.date));
        await createSend.mutateAsync({
          id: spaceId,
          letterId: spaceLetterId,
          data: {
            scheduledAt: finalScheduledAt.toISOString(),
            ...(slotId != null ? { slotId } : {}),
          },
        });
        queryClient.invalidateQueries({ queryKey: getListAllSpaceScheduledSendsQueryKey(spaceId) });
      }

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
  }, [
    selectedArticleId, selectedCenterSlot, scheduledAt, isOpeningLetter, spaceId, letters, userId,
    slotId, allSends, createLetter, createSend, updateSend, queryClient, onSaved, onClose,
  ]);

  const title = isOpeningLetter ? "여는 편지 글 선택" : "글 예약 발송";
  const saveLabel = isOpeningLetter ? "여는 편지로 등록" : "예약 등록";
  const dateLabel = isOpeningLetter ? "발송 예약 날짜 (06:00 발송)" : "발송 예약 일시";
  const dateBtnText = isOpeningLetter
    ? `${formatDate(scheduledAt)} 06:00`
    : formatDateTime(scheduledAt);

  return (
    <View style={styles.overlay}>
      <ScalePressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <ScalePressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={20} color={Colors.zinc500} />
          </ScalePressable>
        </View>

        <Text style={styles.fieldLabel}>발송할 글 선택</Text>

        <ScalePressable
          style={styles.selectBtnOuter}
          contentStyle={styles.selectBtn}
          onPress={() => setLetterPickerVisible(true)}
        >
          <Feather
            name="file-text"
            size={16}
            color={selectedArticleId ? Colors.zinc900 : Colors.zinc400}
          />
          <Text
            style={[
              styles.selectBtnText,
              selectedArticleId ? styles.selectBtnTextActive : null,
            ]}
            numberOfLines={1}
          >
            {selectedArticleId ? (selectedArticleTitle ?? "제목 없음") : "보낼 편지를 선택하세요"}
          </Text>
          <Feather name="chevron-right" size={16} color={Colors.zinc300} />
        </ScalePressable>

        <LetterPickerSheet
          visible={letterPickerVisible}
          onClose={() => setLetterPickerVisible(false)}
          articles={pickerArticles}
          isLoading={isArticlesLoading}
          isError={isArticlesError}
          onRefetch={onRefetchArticles ?? (() => {})}
          selectedId={selectedArticleId}
          onSelect={(article) => setSelectedArticleId(article.id)}
          emptyAction={
            onGoToArchive
              ? {
                  label: "기록함으로 이동",
                  onPress: () => {
                    setLetterPickerVisible(false);
                    onClose();
                    onGoToArchive();
                  },
                }
              : undefined
          }
        />

        {selectedArticleId && isOpeningLetter && (
          <>
            <Text style={styles.fieldLabel}>{dateLabel}</Text>
            <ScalePressable
              contentStyle={styles.dateBtn}
              onPress={() => setShowPicker(true)}
            >
              <Feather name="calendar" size={15} color={Colors.zinc500} />
              <Text style={styles.dateBtnText}>{dateBtnText}</Text>
            </ScalePressable>

            {showPicker && (
              <DateTimePicker
                value={scheduledAt}
                mode="date"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                minimumDate={minDate}
                maximumDate={maxDate}
                onChange={(_event: unknown, date?: Date) => {
                  setShowPicker(Platform.OS === "ios");
                  if (date) {
                    const clamped = maxDate && date > maxDate ? maxDate : date;
                    setScheduledAt(clamped);
                  }
                }}
              />
            )}

            <ScalePressable
              style={styles.saveBtnOuter}
              contentStyle={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={styles.saveBtnText}>
                {saving ? "등록 중..." : saveLabel}
              </Text>
            </ScalePressable>
          </>
        )}

        {selectedArticleId && !isOpeningLetter && (
          <>
            <Text style={styles.fieldLabel}>발송 예정일 (06:00 고정 발송)</Text>

            {isLoadingCenterDates ? (
              <View style={styles.centerDatesLoading}>
                <ActivityIndicator size="small" color={Colors.zinc400} />
                <Text style={styles.centerDatesLoadingText}>배정된 차례를 확인하는 중이에요</Text>
              </View>
            ) : sortedCenterSlots.length === 0 ? (
              <View style={styles.noSlotNotice}>
                <Feather name="info" size={14} color={Colors.zinc400} />
                <Text style={styles.noSlotNoticeText}>
                  아직 배정된 중심글 차례가 없어요. 회차가 시작되고 차례가 배정되면 예약할 수 있어요.
                </Text>
              </View>
            ) : (
              <View style={styles.centerDateChipRow}>
                {sortedCenterSlots.map((slot) => {
                  const isSelected = slot.date === selectedCenterDate;
                  return (
                    <ScalePressable
                      key={`${slot.roundId}:${slot.date}`}
                      contentStyle={[
                        styles.centerDateChip,
                        isSelected && styles.centerDateChipSelected,
                      ]}
                      onPress={() => setSelectedCenterDate(slot.date)}
                    >
                      <Text
                        style={[
                          styles.centerDateChipText,
                          isSelected && styles.centerDateChipTextSelected,
                        ]}
                      >
                        {formatShortDate(slot.date)} 06:00
                      </Text>
                    </ScalePressable>
                  );
                })}
              </View>
            )}

            <ScalePressable
              style={styles.saveBtnOuter}
              contentStyle={[
                styles.saveBtn,
                (saving || !selectedCenterSlot) && styles.saveBtnDisabled,
              ]}
              onPress={handleSave}
              disabled={saving || !selectedCenterSlot}
            >
              <Text style={styles.saveBtnText}>
                {saving ? "등록 중..." : saveLabel}
              </Text>
            </ScalePressable>
          </>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
  selectBtnOuter: {
    marginBottom: 4,
  },
  selectBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: Colors.zinc50,
  },
  selectBtnText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
    flex: 1,
  },
  selectBtnTextActive: {
    color: Colors.zinc900,
    fontWeight: "600",
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
  noSlotNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: Colors.zinc50,
    borderRadius: 10,
    padding: 12,
  },
  noSlotNoticeText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
    flex: 1,
    lineHeight: 19,
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
