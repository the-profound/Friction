import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";
import { SpaceInfoNote } from "@/components/SpaceInfoNote/SpaceInfoNote";
import { SpaceCopy } from "@/constants/spaceCopy";
import { LetterPickerSheet } from "@/components/shared/LetterPickerSheet";
import { CollapsibleDatePicker, startOfDay } from "@/components/shared/CalendarGrid";
import {
  useCreateSpaceScheduledSend,
  useCreateSpaceLetter,
  getListSpaceLettersQueryKey,
  getListAllSpaceScheduledSendsQueryKey,
  getListSpaceRoundSlotsQueryKey,
  ApiError,
} from "@workspace/api-client-react";
import type {
  Article,
  SpaceLetter,
} from "@workspace/api-client-react";
import { kstDateAt6, minOpeningSendDate } from "@/lib/kstDate";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// Earliest selectable date and KST-06:00 send-instant construction for
// opening letters both come from lib/kstDate.ts (minOpeningSendDate /
// kstDateAt6) — the project's single KST-safe SSOT — rather than any
// device-local-time computation, so this sheet's rule matches exactly what
// the API enforces (computeDeliverySlot on the server) regardless of the
// device's timezone.

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
  onGoToArchive?: () => void;
  /** Opening-letter mode only: latest allowed scheduled date (inclusive). Saves are clamped to this. */
  maxScheduledAt?: Date | null;
  /** Opening-letter mode only: the round this opening letter belongs to. Persisted
   * as the new letter's spaceRoundId, and used to scope article-reuse matching
   * and pending-reservation cancellation to this round only. */
  openingRoundId?: string | null;
  /**
   * General (CENTER) mode only: the set of "내 차례" round-slot dates the user
   * is allowed to pick from, each tied to the round it belongs to.
   * `undefined` means still loading; an empty array means the user has no
   * assigned CENTER slot yet.
   */
  assignedCenterSlots?: { slotId: string; date: string; roundId: string }[];
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
  onGoToArchive,
  maxScheduledAt,
  openingRoundId = null,
  assignedCenterSlots,
  isLoadingCenterDates = false,
}: ArticleScheduleSheetProps) {
  const isOpeningLetter = mode === "opening-letter";

  const minDate = useMemo(
    () => (isOpeningLetter ? minOpeningSendDate() : new Date()),
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
  const sortedCenterSlotsKey = sortedCenterSlots.map((s) => s.slotId).join(",");
  const [selectedCenterSlotId, setSelectedCenterSlotId] = useState<string | null>(
    () => slotId ?? null,
  );
  // Keep the selection in sync once assigned dates resolve: default to the
  // pre-filled slot date if it's still valid, otherwise the first available one.
  const centerDatesReady = !isOpeningLetter && assignedCenterSlots !== undefined;
  React.useEffect(() => {
    if (isOpeningLetter || !centerDatesReady) return;
    setSelectedCenterSlotId((prev) => {
      if (prev && sortedCenterSlots.some((slot) => slot.slotId === prev)) return prev;
      return sortedCenterSlots.find((slot) => slot.date === initialScheduledDate)?.slotId ??
        sortedCenterSlots[0]?.slotId ??
        null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerDatesReady, sortedCenterSlotsKey, initialScheduledDate]);

  const selectedCenterSlot = useMemo(
    () => sortedCenterSlots.find((s) => s.slotId === selectedCenterSlotId) ?? null,
    [sortedCenterSlots, selectedCenterSlotId],
  );

  const createSend = useCreateSpaceScheduledSend();
  const createLetter = useCreateSpaceLetter();
  const queryClient = useQueryClient();

  const pickerArticles = useMemo(
    () =>
      articles.map((a) => ({
        id: a.id,
        title: a.title ?? null,
        content: (a as unknown as { content?: string | null }).content ?? null,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
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
    // Guard against a stale selection landing outside the valid window (e.g.
    // the sheet stayed open across a day boundary): never silently clamp a
    // date, since that could silently create a past-dated or post-round
    // reservation the user never actually chose — block the save instead.
    if (isOpeningLetter) {
      const d0 = startOfDay(scheduledAt);
      if (d0 < startOfDay(minDate) || (maxDate && d0 > startOfDay(maxDate))) {
        Alert.alert("알림", "선택한 날짜가 더 이상 유효하지 않아요. 날짜를 다시 선택해주세요.");
        return;
      }
    }
    setSaving(true);
    try {
      if (isOpeningLetter) {
        const letterType = "OPENING";

        // Reuse matching (and the cancellation scope right below) is keyed
        // to the specific round this opening letter belongs to, so reusing
        // the same article for a different round's opening letter never
        // picks up another round's letter row.
        const existingLetter = letters.find(
          (l) =>
            l.sourceArticleId === selectedArticleId &&
            l.letterType === letterType &&
            (!openingRoundId || l.spaceRoundId === openingRoundId),
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
              letterType,
              spaceRoundId: openingRoundId ?? null,
            },
          });
          spaceLetterId = newLetter.id;
          queryClient.invalidateQueries({ queryKey: getListSpaceLettersQueryKey(spaceId) });
        }

        // scheduledAt is already validated above to be within [minDate, maxDate].
        const finalScheduledAt = kstDateAt6(scheduledAt);
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
          (l) =>
            l.sourceArticleId === selectedArticleId &&
            l.letterType === "CENTER" &&
            l.spaceRoundId === centerSlot.roundId,
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
            slotId: centerSlot.slotId,
          },
        });
        queryClient.invalidateQueries({ queryKey: getListAllSpaceScheduledSendsQueryKey(spaceId) });
        queryClient.invalidateQueries({
          queryKey: getListSpaceRoundSlotsQueryKey(spaceId, centerSlot.roundId),
        });
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
    slotId, createLetter, createSend, queryClient, onSaved, onClose,
    openingRoundId, maxDate, minDate,
  ]);

  const title = isOpeningLetter ? "여는 편지 글 선택" : "글 예약 발송";
  const saveLabel = isOpeningLetter ? "여는 편지로 등록" : "예약 등록";
  const dateLabel = isOpeningLetter ? "발송 예약 날짜 (06:00 발송)" : "발송 예약 일시";

  return (
    <View style={styles.overlay}>
      <ScalePressable style={styles.backdrop} contentStyle={styles.backdropContent} onPress={onClose} />
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

        {selectedArticleId && isOpeningLetter ? (
          <>
            <Text style={styles.fieldLabel}>{dateLabel}</Text>
            <CollapsibleDatePicker
              value={scheduledAt}
              onChange={setScheduledAt}
              isDateDisabled={(date) => {
                const d0 = startOfDay(date);
                if (d0 < startOfDay(minDate)) return true;
                if (maxDate && d0 > startOfDay(maxDate)) return true;
                return false;
              }}
              onOpen={() => {
                // 최소/최대 범위를 벗어난 채로 열리면 최소 허용일로 스냅한다.
                const d0 = startOfDay(scheduledAt);
                if (d0 < startOfDay(minDate) || (maxDate && d0 > startOfDay(maxDate))) {
                  return minDate;
                }
              }}
              formatButtonLabel={(date) => `${formatDate(date)} 06:00`}
              triggerStyle={styles.dateBtn}
              triggerTextStyle={styles.dateBtnText}
            />

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
        ) : null}

        {selectedArticleId && !isOpeningLetter ? (
          <>
            <Text style={styles.fieldLabel}>발송 예정일 (06:00 고정 발송)</Text>

            {isLoadingCenterDates ? (
              <View style={styles.centerDatesLoading}>
                <ActivityIndicator size="small" color={Colors.zinc400} />
                <Text style={styles.centerDatesLoadingText}>배정된 차례를 확인하는 중이에요</Text>
              </View>
            ) : sortedCenterSlots.length === 0 ? (
              <SpaceInfoNote
                variant="inline"
                text={SpaceCopy.centerArticle_noSlot}
              />
            ) : (
              <View style={styles.centerDateChipRow}>
                {sortedCenterSlots.map((slot) => {
                  const isSelected = slot.slotId === selectedCenterSlotId;
                  return (
                    <ScalePressable
                      key={slot.slotId}
                      contentStyle={[
                        styles.centerDateChip,
                        isSelected && styles.centerDateChipSelected,
                      ]}
                      onPress={() => setSelectedCenterSlotId(slot.slotId)}
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
        ) : null}
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
  },
  backdropContent: {
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
    color: Colors.zinc400, // typography-ok: unselected picker placeholder
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
