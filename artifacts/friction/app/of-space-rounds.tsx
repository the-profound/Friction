import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";
import {
  useListSpaceRounds,
  useUpdateSpaceRound,
  useListSpaceLetters,
  getListSpaceRoundsQueryKey,
  getListSpaceLettersQueryKey,
} from "@workspace/api-client-react";
import type { SpaceRound, SpaceLetter } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

const STATUS_OPTIONS: { value: "UPCOMING" | "ACTIVE" | "COMPLETED"; label: string }[] = [
  { value: "UPCOMING", label: "예정" },
  { value: "ACTIVE", label: "진행 중" },
  { value: "COMPLETED", label: "완료" },
];

// ─── Edit Sheet ───────────────────────────────────────────────────────────────

function RoundEditSheet({
  round,
  onClose,
  onSaved,
}: {
  round: SpaceRound;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(round.title ?? "");
  const [description, setDescription] = useState(round.description ?? "");
  const [status, setStatus] = useState<"UPCOMING" | "ACTIVE" | "COMPLETED">(
    round.status as "UPCOMING" | "ACTIVE" | "COMPLETED",
  );
  const [saving, setSaving] = useState(false);
  const updateRound = useUpdateSpaceRound();

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await updateRound.mutateAsync({
        id: round.spaceId,
        roundId: round.id,
        data: {
          title: title.trim() || null,
          description: description.trim() || null,
          status,
        },
      });
      onSaved();
      onClose();
    } catch {
      Alert.alert("오류", "저장에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }, [round, title, description, status, updateRound, onSaved, onClose]);

  return (
    <View style={editStyles.overlay}>
      <ScalePressable style={editStyles.backdrop} onPress={onClose} />
      <View style={editStyles.sheet}>
        <View style={editStyles.sheetHeader}>
          <Text style={editStyles.sheetTitle}>{round.roundNumber}회차 편집</Text>
          <ScalePressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={20} color={Colors.zinc500} />
          </ScalePressable>
        </View>

        <Text style={editStyles.fieldLabel}>제목</Text>
        <TextInput
          style={editStyles.textInput}
          value={title}
          onChangeText={setTitle}
          placeholder="회차 제목 (선택)"
          placeholderTextColor={Colors.zinc400}
          maxLength={100}
        />

        <Text style={editStyles.fieldLabel}>설명</Text>
        <TextInput
          style={[editStyles.textInput, editStyles.textArea]}
          value={description}
          onChangeText={setDescription}
          placeholder="회차 설명 (선택)"
          placeholderTextColor={Colors.zinc400}
          multiline
          maxLength={300}
        />

        <Text style={editStyles.fieldLabel}>상태</Text>
        <View style={editStyles.statusRow}>
          {STATUS_OPTIONS.map((opt) => (
            <ScalePressable
              key={opt.value}
              contentStyle={[
                editStyles.statusChip,
                status === opt.value && editStyles.statusChipActive,
              ]}
              onPress={() => setStatus(opt.value)}
            >
              <Text
                style={[
                  editStyles.statusChipText,
                  status === opt.value && editStyles.statusChipTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </ScalePressable>
          ))}
        </View>

        <ScalePressable
          style={editStyles.saveBtnOuter}
          contentStyle={[editStyles.saveBtn, saving && editStyles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={editStyles.saveBtnText}>{saving ? "저장 중..." : "저장"}</Text>
        </ScalePressable>
      </View>
    </View>
  );
}

// ─── Round Row ────────────────────────────────────────────────────────────────

function RoundRow({
  round,
  letters,
  onEdit,
}: {
  round: SpaceRound;
  letters: SpaceLetter[];
  onEdit: () => void;
}) {
  const color = roundStatusColor(round.status);
  const openingCount = letters.filter((l) => l.letterType === "OPENING").length;
  const centerCount = letters.filter((l) => l.letterType === "CENTER").length;

  return (
    <View style={styles.roundRow}>
      <View style={styles.roundRowLeft}>
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <View style={styles.roundMeta}>
          <View style={styles.roundTopLine}>
            <Text style={styles.roundNumber}>{round.roundNumber}회차</Text>
            <View style={[styles.roundStatusBadge, { borderColor: color }]}>
              <Text style={[styles.roundStatusText, { color }]}>
                {roundStatusLabel(round.status)}
              </Text>
            </View>
          </View>
          {round.title ? (
            <Text style={styles.roundTitle} numberOfLines={1}>
              {round.title}
            </Text>
          ) : (
            <Text style={styles.roundTitleEmpty}>제목 없음</Text>
          )}
          <View style={styles.roundLetterInfo}>
            {openingCount > 0 && (
              <Text style={styles.roundLetterText}>오프닝 {openingCount}</Text>
            )}
            {centerCount > 0 && (
              <Text style={styles.roundLetterText}>센터 {centerCount}</Text>
            )}
            {openingCount === 0 && centerCount === 0 && (
              <Text style={styles.roundLetterTextEmpty}>편지 없음</Text>
            )}
          </View>
        </View>
      </View>
      <ScalePressable style={styles.editIconBtn} onPress={onEdit} hitSlop={8}>
        <Feather name="edit-2" size={15} color={Colors.zinc400} />
      </ScalePressable>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SpaceRoundsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, spaceName } = useLocalSearchParams<{ id: string; spaceName?: string }>();
  const queryClient = useQueryClient();
  const [editingRound, setEditingRound] = useState<SpaceRound | null>(null);

  const roundsQuery = useListSpaceRounds(id, { query: { enabled: !!id, queryKey: getListSpaceRoundsQueryKey(id) } });
  const lettersQuery = useListSpaceLetters(id, { query: { enabled: !!id, queryKey: getListSpaceLettersQueryKey(id) } });

  const rounds = (roundsQuery.data ?? []) as SpaceRound[];
  const letters = (lettersQuery.data ?? []) as SpaceLetter[];

  const lettersByRound = React.useMemo<Record<string, SpaceLetter[]>>(() => {
    const map: Record<string, SpaceLetter[]> = {};
    for (const letter of letters) {
      const key = letter.spaceRoundId ?? "__none__";
      (map[key] ??= []).push(letter);
    }
    return map;
  }, [letters]);

  const isLoading = roundsQuery.isLoading;
  const isRefreshing = roundsQuery.isFetching || lettersQuery.isFetching;

  const refetchAll = useCallback(async () => {
    await Promise.all([roundsQuery.refetch(), lettersQuery.refetch()]);
  }, [roundsQuery, lettersQuery]);

  const handleSaved = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListSpaceRoundsQueryKey(id) });
    roundsQuery.refetch();
  }, [queryClient, id, roundsQuery]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ScalePressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </ScalePressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {spaceName ?? "회차 관리"}
        </Text>
        <View style={{ width: 28 }} />
      </View>

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
          <Text style={styles.sectionHeader}>
            전체 {rounds.length}개 회차
          </Text>

          {rounds.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="layers" size={36} color={Colors.zinc300} />
              <Text style={styles.emptyText}>아직 회차가 없어요</Text>
            </View>
          ) : (
            <View style={styles.roundList}>
              {rounds
                .slice()
                .sort((a, b) => a.roundNumber - b.roundNumber)
                .map((round) => (
                  <RoundRow
                    key={round.id}
                    round={round}
                    letters={lettersByRound[round.id] ?? []}
                    onEdit={() => setEditingRound(round)}
                  />
                ))}
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {editingRound && (
        <RoundEditSheet
          round={editingRound}
          onClose={() => setEditingRound(null)}
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
    paddingBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  roundList: {
    paddingHorizontal: Spacing.screenPx,
    gap: 10,
  },
  roundRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.zinc50,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    padding: 14,
    gap: 12,
  },
  roundRowLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
  roundMeta: {
    flex: 1,
    gap: 2,
  },
  roundTopLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  roundNumber: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  roundStatusBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  roundStatusText: {
    ...Typography.caption,
    fontSize: 10,
    fontWeight: "600",
  },
  roundTitle: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc600,
    marginTop: 2,
  },
  roundTitleEmpty: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc400,
    fontStyle: "italic",
    marginTop: 2,
  },
  roundLetterInfo: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  roundLetterText: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc500,
    backgroundColor: Colors.zinc100,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  roundLetterTextEmpty: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc300,
  },
  editIconBtn: {
    padding: 4,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    gap: 12,
  },
  emptyText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc400,
  },
});

const editStyles = StyleSheet.create({
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
    gap: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
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
    marginBottom: 6,
  },
  textInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc900,
  },
  textArea: {
    height: 80,
    textAlignVertical: "top",
  },
  statusRow: {
    flexDirection: "row",
    gap: 8,
  },
  statusChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
    backgroundColor: Colors.white,
  },
  statusChipActive: {
    backgroundColor: Colors.zinc900,
    borderColor: Colors.zinc900,
  },
  statusChipText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
    fontWeight: "600",
  },
  statusChipTextActive: {
    color: Colors.white,
  },
  saveBtnOuter: {
    marginTop: 20,
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
