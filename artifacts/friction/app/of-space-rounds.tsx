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
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";
import {
  useListSpaceRounds,
  useUpdateSpaceRound,
  useListSpaceLetters,
  useListSpaceRoundSlots,
  useCreateSpaceRoundSlot,
  useUpdateSpaceRoundSlot,
  useDeleteSpaceRoundSlot,
  useListSpaceMembers,
  getListSpaceRoundsQueryKey,
  getListSpaceLettersQueryKey,
  getListSpaceRoundSlotsQueryKey,
  getListSpaceMembersQueryKey,
} from "@workspace/api-client-react";
import type { SpaceRound, SpaceLetter, SpaceRoundSlotWithUser, SpaceMember } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  roundStatusLabel,
  sortSpaceRoundsNewestFirst,
} from "@/lib/spaceRoundPresentation";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function roundStatusColor(status: string): string {
  if (status === "ACTIVE") return Colors.noticeAccent;
  if (status === "UPCOMING") return Colors.zinc400;
  return Colors.zinc300;
}

const STATUS_OPTIONS: { value: "UPCOMING" | "ACTIVE" | "COMPLETED"; label: string }[] = [
  { value: "UPCOMING", label: "예정" },
  { value: "ACTIVE", label: "진행 중" },
  { value: "COMPLETED", label: "종료" },
];

// ─── Edit Sheet ───────────────────────────────────────────────────────────────

function formatSlotDate(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function RoundEditSheet({
  round,
  onClose,
  onSaved,
}: {
  round: SpaceRound;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(round.title ?? "");
  const [description, setDescription] = useState(round.description ?? "");
  const [status, setStatus] = useState<"UPCOMING" | "ACTIVE" | "COMPLETED">(
    round.status as "UPCOMING" | "ACTIVE" | "COMPLETED",
  );
  const [saving, setSaving] = useState(false);
  const updateRound = useUpdateSpaceRound();

  // ── Slot management (shown for UPCOMING rounds) ────────────────────────────
  const isUpcoming = round.status === "UPCOMING";
  const [showAddSlot, setShowAddSlot] = useState(false);
  const [newSlotMember, setNewSlotMember] = useState<SpaceMember | null>(null);
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [newSlotDate, setNewSlotDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [addingSlot, setAddingSlot] = useState(false);

  // ── Slot edit state ────────────────────────────────────────────────────────
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [editSlotMember, setEditSlotMember] = useState<SpaceMember | null>(null);
  const [editSlotDate, setEditSlotDate] = useState<Date | null>(null);
  const [showEditMemberPicker, setShowEditMemberPicker] = useState(false);
  const [showEditDatePicker, setShowEditDatePicker] = useState(false);
  const [savingSlot, setSavingSlot] = useState(false);

  const slotsQuery = useListSpaceRoundSlots(round.spaceId, round.id, {
    query: {
      enabled: isUpcoming,
      queryKey: getListSpaceRoundSlotsQueryKey(round.spaceId, round.id),
    },
  });
  const slots = (slotsQuery.data ?? []) as SpaceRoundSlotWithUser[];

  const needsMembers = isUpcoming && (showAddSlot || editingSlotId !== null);
  const membersQuery = useListSpaceMembers(round.spaceId, {
    query: {
      enabled: needsMembers,
      queryKey: getListSpaceMembersQueryKey(round.spaceId),
    },
  });
  const members = (membersQuery.data ?? []) as SpaceMember[];

  const createSlot = useCreateSpaceRoundSlot();
  const updateSlot = useUpdateSpaceRoundSlot();
  const deleteSlot = useDeleteSpaceRoundSlot();

  const handleAddSlot = useCallback(async () => {
    if (!newSlotMember) {
      Alert.alert("알림", "멤버를 선택해주세요.");
      return;
    }
    setAddingSlot(true);
    try {
      await createSlot.mutateAsync({
        id: round.spaceId,
        roundId: round.id,
        data: {
          assignedUserId: newSlotMember.userId,
          slotOrder: slots.length + 1,
          scheduledDate: newSlotDate ? newSlotDate.toISOString().split("T")[0] : null,
        },
      });
      queryClient.invalidateQueries({
        queryKey: getListSpaceRoundSlotsQueryKey(round.spaceId, round.id),
      });
      slotsQuery.refetch();
      setNewSlotMember(null);
      setNewSlotDate(null);
      setShowAddSlot(false);
    } catch {
      Alert.alert("오류", "슬롯 추가에 실패했어요.");
    } finally {
      setAddingSlot(false);
    }
  }, [newSlotMember, newSlotDate, round, slots.length, createSlot, queryClient, slotsQuery]);

  const handleOpenEdit = useCallback(
    (slot: SpaceRoundSlotWithUser) => {
      setEditingSlotId(slot.id);
      const m = members.find((m) => m.userId === slot.assignedUserId);
      setEditSlotMember(
        m ?? { userId: slot.assignedUserId, nickname: slot.assignedUserNickname ?? null, role: "", status: "" },
      );
      setEditSlotDate(slot.scheduledDate ? new Date(slot.scheduledDate) : null);
      setShowEditMemberPicker(false);
      setShowEditDatePicker(false);
    },
    [members],
  );

  const handleSaveSlot = useCallback(async () => {
    if (!editingSlotId) return;
    setSavingSlot(true);
    try {
      await updateSlot.mutateAsync({
        id: round.spaceId,
        roundId: round.id,
        slotId: editingSlotId,
        data: {
          assignedUserId: editSlotMember?.userId,
          scheduledDate: editSlotDate ? editSlotDate.toISOString().split("T")[0] : null,
        },
      });
      queryClient.invalidateQueries({
        queryKey: getListSpaceRoundSlotsQueryKey(round.spaceId, round.id),
      });
      slotsQuery.refetch();
      setEditingSlotId(null);
    } catch {
      Alert.alert("오류", "슬롯 저장에 실패했어요.");
    } finally {
      setSavingSlot(false);
    }
  }, [editingSlotId, editSlotMember, editSlotDate, round, updateSlot, queryClient, slotsQuery]);

  const handleDeleteSlot = useCallback(
    (slotId: string) => {
      Alert.alert("슬롯 삭제", "이 슬롯을 삭제하시겠어요?", [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteSlot.mutateAsync({
                id: round.spaceId,
                roundId: round.id,
                slotId,
              });
              queryClient.invalidateQueries({
                queryKey: getListSpaceRoundSlotsQueryKey(round.spaceId, round.id),
              });
              slotsQuery.refetch();
            } catch {
              Alert.alert("오류", "슬롯 삭제에 실패했어요.");
            }
          },
        },
      ]);
    },
    [round, deleteSlot, queryClient, slotsQuery],
  );

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
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={editStyles.sheetScrollContent}
        >
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

          {isUpcoming && (
            <>
              <View style={editStyles.slotSectionHeader}>
                <Text style={editStyles.fieldLabel}>슬롯 관리</Text>
                <ScalePressable
                  contentStyle={editStyles.addSlotBtn}
                  onPress={() => setShowAddSlot((v) => !v)}
                >
                  <Feather
                    name={showAddSlot ? "minus" : "plus"}
                    size={13}
                    color={Colors.zinc600}
                  />
                  <Text style={editStyles.addSlotBtnText}>슬롯 추가</Text>
                </ScalePressable>
              </View>

              {showAddSlot && (
                <View style={editStyles.addSlotForm}>
                  {/* Member picker */}
                  <ScalePressable
                    contentStyle={editStyles.memberPickerBtn}
                    onPress={() => setShowMemberPicker((v) => !v)}
                  >
                    <Feather name="user" size={13} color={Colors.zinc500} />
                    <Text style={editStyles.memberPickerBtnText} numberOfLines={1}>
                      {newSlotMember
                        ? (newSlotMember.nickname ?? newSlotMember.userId.slice(0, 8))
                        : "멤버 선택"}
                    </Text>
                    <Feather
                      name={showMemberPicker ? "chevron-up" : "chevron-down"}
                      size={13}
                      color={Colors.zinc400}
                    />
                  </ScalePressable>
                  {showMemberPicker && (
                    <View style={editStyles.memberList}>
                      {membersQuery.isLoading ? (
                        <ActivityIndicator size="small" color={Colors.zinc400} style={{ margin: 8 }} />
                      ) : members.length === 0 ? (
                        <Text style={editStyles.noMembersText}>멤버가 없어요</Text>
                      ) : (
                        members.map((m) => (
                          <ScalePressable
                            key={m.userId}
                            contentStyle={[
                              editStyles.memberRow,
                              newSlotMember?.userId === m.userId && editStyles.memberRowSelected,
                            ]}
                            onPress={() => {
                              setNewSlotMember(m);
                              setShowMemberPicker(false);
                            }}
                          >
                            <Text
                              style={[
                                editStyles.memberRowText,
                                newSlotMember?.userId === m.userId && editStyles.memberRowTextSelected,
                              ]}
                              numberOfLines={1}
                            >
                              {m.nickname ?? m.userId.slice(0, 8)}
                            </Text>
                            {m.role === "OPERATOR" && (
                              <Text style={editStyles.memberRoleTag}>운영자</Text>
                            )}
                          </ScalePressable>
                        ))
                      )}
                    </View>
                  )}
                  <ScalePressable
                    contentStyle={editStyles.dateBtnSmall}
                    onPress={() => setShowDatePicker(true)}
                  >
                    <Feather name="calendar" size={13} color={Colors.zinc500} />
                    <Text style={editStyles.dateBtnSmallText}>
                      {newSlotDate
                        ? formatSlotDate(newSlotDate.toISOString())
                        : "예정일 선택 (선택)"}
                    </Text>
                  </ScalePressable>
                  {showDatePicker && (
                    <DateTimePicker
                      value={newSlotDate ?? new Date()}
                      mode="date"
                      display={Platform.OS === "ios" ? "spinner" : "default"}
                      onChange={(_e, d) => {
                        setShowDatePicker(Platform.OS === "ios");
                        if (d) setNewSlotDate(d);
                      }}
                    />
                  )}
                  <ScalePressable
                    contentStyle={[
                      editStyles.addSlotConfirmBtn,
                      addingSlot && editStyles.saveBtnDisabled,
                    ]}
                    onPress={handleAddSlot}
                    disabled={addingSlot}
                  >
                    <Text style={editStyles.addSlotConfirmBtnText}>
                      {addingSlot ? "추가 중..." : "슬롯 등록"}
                    </Text>
                  </ScalePressable>
                </View>
              )}

              {slotsQuery.isLoading ? (
                <ActivityIndicator
                  size="small"
                  color={Colors.zinc400}
                  style={{ marginVertical: 8 }}
                />
              ) : slots.length === 0 ? (
                <Text style={editStyles.noSlotsText}>슬롯이 없어요</Text>
              ) : (
                <View style={editStyles.slotList}>
                  {slots
                    .slice()
                    .sort((a, b) => {
                      if (a.scheduledDate && b.scheduledDate) {
                        return a.scheduledDate < b.scheduledDate ? -1 : a.scheduledDate > b.scheduledDate ? 1 : 0;
                      }
                      if (a.scheduledDate) return -1;
                      if (b.scheduledDate) return 1;
                      return a.slotOrder - b.slotOrder;
                    })
                    .map((slot) => {
                      const isEditing = editingSlotId === slot.id;
                      return (
                        <View key={slot.id} style={editStyles.slotRow}>
                          {isEditing ? (
                            // ── Inline edit panel ──────────────────────────
                            <View style={editStyles.slotEditPanel}>
                              {/* Member picker */}
                              <ScalePressable
                                contentStyle={editStyles.memberPickerBtn}
                                onPress={() => setShowEditMemberPicker((v) => !v)}
                              >
                                <Feather name="user" size={13} color={Colors.zinc500} />
                                <Text style={editStyles.memberPickerBtnText} numberOfLines={1}>
                                  {editSlotMember?.nickname ?? editSlotMember?.userId.slice(0, 8) ?? "멤버 선택"}
                                </Text>
                                <Feather
                                  name={showEditMemberPicker ? "chevron-up" : "chevron-down"}
                                  size={13}
                                  color={Colors.zinc400}
                                />
                              </ScalePressable>
                              {showEditMemberPicker && (
                                <View style={editStyles.memberList}>
                                  {membersQuery.isLoading ? (
                                    <ActivityIndicator size="small" color={Colors.zinc400} style={{ margin: 8 }} />
                                  ) : (
                                    members.map((m) => (
                                      <ScalePressable
                                        key={m.userId}
                                        contentStyle={[
                                          editStyles.memberRow,
                                          editSlotMember?.userId === m.userId && editStyles.memberRowSelected,
                                        ]}
                                        onPress={() => {
                                          setEditSlotMember(m);
                                          setShowEditMemberPicker(false);
                                        }}
                                      >
                                        <Text
                                          style={[
                                            editStyles.memberRowText,
                                            editSlotMember?.userId === m.userId && editStyles.memberRowTextSelected,
                                          ]}
                                          numberOfLines={1}
                                        >
                                          {m.nickname ?? m.userId.slice(0, 8)}
                                        </Text>
                                        {m.role === "OPERATOR" && (
                                          <Text style={editStyles.memberRoleTag}>운영자</Text>
                                        )}
                                      </ScalePressable>
                                    ))
                                  )}
                                </View>
                              )}
                              {/* Date picker */}
                              <ScalePressable
                                contentStyle={editStyles.dateBtnSmall}
                                onPress={() => setShowEditDatePicker(true)}
                              >
                                <Feather name="calendar" size={13} color={Colors.zinc500} />
                                <Text style={editStyles.dateBtnSmallText}>
                                  {editSlotDate ? formatSlotDate(editSlotDate.toISOString()) : "예정일 선택 (선택)"}
                                </Text>
                              </ScalePressable>
                              {showEditDatePicker && (
                                <DateTimePicker
                                  value={editSlotDate ?? new Date()}
                                  mode="date"
                                  display={Platform.OS === "ios" ? "spinner" : "default"}
                                  onChange={(_e, d) => {
                                    setShowEditDatePicker(Platform.OS === "ios");
                                    if (d) setEditSlotDate(d);
                                  }}
                                />
                              )}
                              {/* Save / Cancel row */}
                              <View style={editStyles.slotEditActions}>
                                <ScalePressable
                                  contentStyle={editStyles.slotEditCancelBtn}
                                  onPress={() => setEditingSlotId(null)}
                                >
                                  <Text style={editStyles.slotEditCancelText}>취소</Text>
                                </ScalePressable>
                                <ScalePressable
                                  contentStyle={[
                                    editStyles.slotEditSaveBtn,
                                    savingSlot && editStyles.saveBtnDisabled,
                                  ]}
                                  onPress={handleSaveSlot}
                                  disabled={savingSlot}
                                >
                                  <Text style={editStyles.slotEditSaveText}>
                                    {savingSlot ? "저장 중..." : "저장"}
                                  </Text>
                                </ScalePressable>
                              </View>
                            </View>
                          ) : (
                            // ── Normal row ─────────────────────────────────
                            <>
                              <View style={editStyles.slotRowLeft}>
                                <Text style={editStyles.slotOrder}>{slot.slotOrder}</Text>
                                <View style={editStyles.slotMeta}>
                                  <Text style={editStyles.slotNickname} numberOfLines={1}>
                                    {slot.assignedUserNickname ?? slot.assignedUserId.slice(0, 8) + "…"}
                                  </Text>
                                  {slot.scheduledDate ? (
                                    <Text style={editStyles.slotDateText}>
                                      {formatSlotDate(slot.scheduledDate)}
                                    </Text>
                                  ) : null}
                                </View>
                              </View>
                              <View style={editStyles.slotRowActions}>
                                <ScalePressable onPress={() => handleOpenEdit(slot)} hitSlop={8}>
                                  <Feather name="edit-2" size={14} color={Colors.zinc400} />
                                </ScalePressable>
                                <ScalePressable onPress={() => handleDeleteSlot(slot.id)} hitSlop={8}>
                                  <Feather name="trash-2" size={14} color={Colors.zinc400} />
                                </ScalePressable>
                              </View>
                            </>
                          )}
                        </View>
                      );
                    })}
                </View>
              )}
            </>
          )}

          <ScalePressable
            style={editStyles.saveBtnOuter}
            contentStyle={[editStyles.saveBtn, saving && editStyles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={editStyles.saveBtnText}>{saving ? "저장 중..." : "저장"}</Text>
          </ScalePressable>
        </ScrollView>
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
              {sortSpaceRoundsNewestFirst(rounds).map((round) => (
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
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 4,
    maxHeight: "90%",
  },
  sheetScrollContent: {
    paddingTop: 24,
    paddingBottom: 24,
    gap: 0,
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

  // ── Slot management ───────────────────────────────────────────────────────
  slotSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
  },
  addSlotBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
    backgroundColor: Colors.zinc50,
  },
  addSlotBtnText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc600,
    fontWeight: "600",
  },
  addSlotForm: {
    marginTop: 8,
    gap: 8,
    backgroundColor: Colors.zinc50,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    padding: 12,
  },
  memberPickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: Colors.white,
  },
  memberPickerBtnText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc600,
    flex: 1,
  },
  memberList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    borderRadius: 8,
    backgroundColor: Colors.white,
    overflow: "hidden",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  memberRowSelected: {
    backgroundColor: Colors.zinc100,
  },
  memberRowText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc700,
    flex: 1,
  },
  memberRowTextSelected: {
    color: Colors.zinc900,
    fontWeight: "600" as const,
  },
  memberRoleTag: {
    ...Typography.body,
    fontSize: 11,
    color: Colors.zinc400,
  },
  noMembersText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc400,
    textAlign: "center" as const,
    padding: 12,
  },
  dateBtnSmall: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: Colors.white,
  },
  dateBtnSmallText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc600,
  },
  addSlotConfirmBtn: {
    backgroundColor: Colors.zinc800,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  addSlotConfirmBtnText: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.white,
  },
  noSlotsText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc400,
    marginTop: 8,
    marginBottom: 4,
    textAlign: "center",
    paddingVertical: 8,
  },
  slotList: {
    marginTop: 6,
    gap: 6,
  },
  slotRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.zinc50,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  slotRowLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  slotOrder: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.zinc400,
    width: 18,
    textAlign: "center",
  },
  slotMeta: {
    flex: 1,
    gap: 1,
  },
  slotNickname: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc800,
  },
  slotDateText: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc400,
  },
  slotRowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  slotEditPanel: {
    flex: 1,
    gap: 8,
  },
  slotEditActions: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
  },
  slotEditCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
  },
  slotEditCancelText: {
    ...Typography.body,
    fontSize: 12,
    color: Colors.zinc600,
  },
  slotEditSaveBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 7,
    backgroundColor: Colors.zinc800,
  },
  slotEditSaveText: {
    ...Typography.bodySemiBold,
    fontSize: 12,
    color: Colors.white,
  },
});
