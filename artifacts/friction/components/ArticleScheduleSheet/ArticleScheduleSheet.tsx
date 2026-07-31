import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Platform,
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
} from "@workspace/api-client-react";
import type {
  Article,
  SpaceLetter,
  SpaceScheduledSendWithLetter,
} from "@workspace/api-client-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(date: Date): string {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
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
    if (!isOpeningLetter && initialScheduledDate) {
      const d = new Date(initialScheduledDate);
      if (!isNaN(d.getTime())) return d;
    }
    if (isOpeningLetter) return minDate;
    return new Date(Date.now() + 24 * 60 * 60 * 1000);
  });
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);

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
        const existingLetter = letters.find((l) => l.sourceArticleId === selectedArticleId);
        let spaceLetterId: string;
        if (existingLetter) {
          spaceLetterId = existingLetter.id;
        } else {
          const newLetter = await createLetter.mutateAsync({
            id: spaceId,
            data: { authorId: userId, sourceArticleId: selectedArticleId, letterType: "CENTER" },
          });
          spaceLetterId = newLetter.id;
          queryClient.invalidateQueries({ queryKey: getListSpaceLettersQueryKey(spaceId) });
        }
        await createSend.mutateAsync({
          id: spaceId,
          letterId: spaceLetterId,
          data: {
            scheduledAt: scheduledAt.toISOString(),
            ...(slotId != null ? { slotId } : {}),
          },
        });
        queryClient.invalidateQueries({ queryKey: getListAllSpaceScheduledSendsQueryKey(spaceId) });
      }

      onSaved();
      onClose();
    } catch {
      Alert.alert("오류", "예약에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }, [
    selectedArticleId, scheduledAt, isOpeningLetter, spaceId, letters, userId,
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

        {selectedArticleId && (
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
                mode={isOpeningLetter ? "date" : "datetime"}
                display={Platform.OS === "ios" ? "spinner" : "default"}
                minimumDate={minDate}
                maximumDate={maxDate}
                onChange={(_event, date) => {
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
});
