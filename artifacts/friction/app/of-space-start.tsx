import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  Animated,
  PanResponder,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";
import { useUser } from "@/contexts/UserContext";
import {
  useGetSpaceJoinContext,
  getGetSpaceJoinContextQueryKey,
  useListSpaceMembers,
  useListSpaceCodeRequests,
  useListSpaceLetters,
  getListSpaceLettersQueryKey,
  useStartSpace,
  ListSpaceCodeRequestsStatus,
  getListSpaceMembersQueryKey,
} from "@workspace/api-client-react";
import type {
  SpaceMember,
  SpaceWithCreatorInfo,
  StartSpaceBodyScheduleType,
} from "@workspace/api-client-react";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const SLOT_ROW_H = 52;
const SLOT_ROW_GAP = 6;
const SLOT_ITEM_H = SLOT_ROW_H + SLOT_ROW_GAP;

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ number, title }: { number: number; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionNumberBadge}>
        <Text style={styles.sectionNumberText}>{number}</Text>
      </View>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────

function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
  loading,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  loading?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          <Text style={styles.modalMessage}>{message}</Text>
          <View style={styles.modalActions}>
            <ScalePressable contentStyle={styles.modalCancelBtn} onPress={onCancel} disabled={loading}>
              <Text style={styles.modalCancelText}>취소</Text>
            </ScalePressable>
            <ScalePressable
              contentStyle={[styles.modalConfirmBtn, loading && styles.btnOpacity]}
              onPress={onConfirm}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.modalConfirmText}>{confirmLabel}</Text>
              )}
            </ScalePressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Draggable Slot List ──────────────────────────────────────────────────────
// Each row has a drag handle. Long-press + pan vertically to reorder.
// Uses a single Animated.Value for the dragged row's Y offset.
// Other rows shift up/down to show where the dragged row will land.

interface SlotRowInfo {
  userId: string;
  nickname: string;
  isOperator: boolean;
}

function DraggableSlotList({
  items,
  onReorder,
  onScrollLock,
}: {
  items: SlotRowInfo[];
  onReorder: (newOrder: string[]) => void;
  onScrollLock: (locked: boolean) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Animated Y value of the dragged row relative to its natural position
  const dragY = useRef(new Animated.Value(0)).current;
  const startDragY = useRef(0);

  const buildPanResponder = useCallback(
    (index: number) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
        onPanResponderGrant: () => {
          dragY.setValue(0);
          startDragY.current = 0;
          dragIndexRef.current = index;
          hoverIndexRef.current = index;
          setDragIndex(index);
          setHoverIndex(index);
          onScrollLock(true);
        },
        onPanResponderMove: (_e, g) => {
          dragY.setValue(g.dy);
          const count = itemsRef.current.length;
          const rawHover = index + Math.round(g.dy / SLOT_ITEM_H);
          const clamped = Math.max(0, Math.min(count - 1, rawHover));
          if (clamped !== hoverIndexRef.current) {
            hoverIndexRef.current = clamped;
            setHoverIndex(clamped);
          }
        },
        onPanResponderRelease: () => {
          const from = dragIndexRef.current ?? index;
          const to = hoverIndexRef.current ?? from;
          dragY.setValue(0);
          dragIndexRef.current = null;
          hoverIndexRef.current = null;
          setDragIndex(null);
          setHoverIndex(null);
          onScrollLock(false);
          if (from !== to) {
            const current = itemsRef.current.map((i) => i.userId);
            const next = [...current];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            onReorder(next);
          }
        },
        onPanResponderTerminate: () => {
          dragY.setValue(0);
          dragIndexRef.current = null;
          hoverIndexRef.current = null;
          setDragIndex(null);
          setHoverIndex(null);
          onScrollLock(false);
        },
      }),
    [dragY, onReorder, onScrollLock],
  );

  // Pre-build one PanResponder per slot position (index stable per render)
  // We rebuild whenever items.length changes.
  const panResponders = useMemo(
    () => items.map((_, i) => buildPanResponder(i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.length, buildPanResponder],
  );

  if (items.length === 0) {
    return (
      <View style={styles.emptyBox}>
        <Text style={styles.emptyBoxText}>확정된 참여자가 없어요.</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: SLOT_ROW_GAP }}>
      {items.map((item, i) => {
        const isDragging = dragIndex === i;
        // Shift non-dragged rows to visually indicate the drop zone
        let shift = 0;
        if (dragIndex !== null && hoverIndex !== null && !isDragging) {
          const from = dragIndex;
          const to = hoverIndex;
          if (from < to && i > from && i <= to) shift = -SLOT_ITEM_H;
          if (from > to && i >= to && i < from) shift = SLOT_ITEM_H;
        }

        const translateY = isDragging ? dragY : shift;

        return (
          <Animated.View
            key={item.userId}
            style={[
              styles.slotRow,
              isDragging && styles.slotRowDragging,
              typeof translateY === "number"
                ? { transform: [{ translateY }] }
                : { transform: [{ translateY }] },
            ]}
          >
            <Text style={styles.slotOrder}>{i + 1}</Text>
            <View style={styles.slotInfo}>
              <Text style={styles.slotNickname} numberOfLines={1}>
                {item.nickname}
              </Text>
              {item.isOperator && (
                <View style={styles.slotRoleTag}>
                  <Text style={styles.slotRoleTagText}>운영자</Text>
                </View>
              )}
            </View>
            {/* Drag handle */}
            <View
              style={styles.dragHandle}
              {...panResponders[i].panHandlers}
            >
              <Feather name="menu" size={18} color={Colors.zinc400} />
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SpaceStartScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const [scrollEnabled, setScrollEnabled] = useState(true);

  // ── Data queries ──────────────────────────────────────────────────────────

  const joinContextQuery = useGetSpaceJoinContext(
    id,
    { userId },
    { query: { enabled: !!id && !!userId, queryKey: getGetSpaceJoinContextQueryKey(id, { userId }) } },
  );
  const space = joinContextQuery.data?.space as SpaceWithCreatorInfo | undefined;

  const membersQuery = useListSpaceMembers(id, {
    query: {
      enabled: !!id,
      queryKey: getListSpaceMembersQueryKey(id),
    },
  });
  const allMembers = (membersQuery.data ?? []) as SpaceMember[];
  const confirmedMembers = useMemo(
    () => allMembers.filter((m) => m.status === "APPROVED"),
    [allMembers],
  );

  const codeRequestsQuery = useListSpaceCodeRequests(
    id,
    { status: ListSpaceCodeRequestsStatus.PENDING },
    {
      query: {
        enabled: !!id,
        queryKey: ["/api/spaces", id, "code-requests", "PENDING"],
      },
    },
  );
  const pendingRequests = (codeRequestsQuery.data ?? []) as unknown[];
  const hasPendingRequests = pendingRequests.length > 0;

  const lettersQuery = useListSpaceLetters(id, {
    query: {
      enabled: !!id,
      queryKey: getListSpaceLettersQueryKey(id),
    },
  });
  const letters = lettersQuery.data ?? [];
  const openingLetterExists = (letters as any[]).some((l: any) => l.letterType === "OPENING");

  useFocusEffect(
    useCallback(() => {
      if (id) {
        queryClient.invalidateQueries({ queryKey: getListSpaceLettersQueryKey(id) });
      }
    }, [queryClient, id]),
  );

  const startSpace = useStartSpace();

  // ── Section 1: 운영 설정 확정 ─────────────────────────────────────────────

  const [roundCount, setRoundCount] = useState(1);
  const [scheduleType, setScheduleType] = useState<StartSpaceBodyScheduleType>("N_DAY");
  const [interval, setIntervalVal] = useState(7);
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [centerCount, setCenterCount] = useState(1);

  useEffect(() => {
    if (!space) return;
    setRoundCount(space.roundCount ?? 1);
    if (space.scheduleType) setScheduleType(space.scheduleType as StartSpaceBodyScheduleType);
    setIntervalVal(space.defaultCenterInterval ?? 7);
    if (space.weekdays && (space.weekdays as number[]).length > 0) {
      setWeekdays(space.weekdays as number[]);
    }
    setCenterCount(space.defaultCenterCount ?? 1);
  }, [space]);

  // ── Section 2: 운영자 참여 여부 ──────────────────────────────────────────

  const [operatorParticipates, setOperatorParticipates] = useState(true);

  // ── Section 3: 회차 구성 ─────────────────────────────────────────────────

  const [roundConfigs, setRoundConfigs] = useState<Array<{ title: string; description: string }>>([]);

  useEffect(() => {
    setRoundConfigs((prev) =>
      Array.from({ length: roundCount }, (_, i) => ({
        title: prev[i]?.title ?? "",
        description: prev[i]?.description ?? "",
      })),
    );
  }, [roundCount]);

  // ── Section 4: 중심글 순서 배정 ──────────────────────────────────────────

  const [slotOrder, setSlotOrder] = useState<string[]>([]);

  useEffect(() => {
    setSlotOrder((prev) => {
      const eligible = operatorParticipates
        ? confirmedMembers.map((m) => m.userId)
        : confirmedMembers.filter((m) => m.role !== "OPERATOR").map((m) => m.userId);
      const kept = prev.filter((uid) => eligible.includes(uid));
      const added = eligible.filter((uid) => !kept.includes(uid));
      return [...kept, ...added];
    });
  }, [confirmedMembers, operatorParticipates]);

  const memberById = useMemo<Record<string, SpaceMember>>(() => {
    const map: Record<string, SpaceMember> = {};
    for (const m of confirmedMembers) map[m.userId] = m;
    return map;
  }, [confirmedMembers]);

  const slotItems = useMemo<SlotRowInfo[]>(
    () =>
      slotOrder.map((uid) => {
        const m = memberById[uid];
        return {
          userId: uid,
          nickname: m?.nickname ?? uid.slice(0, 8),
          isOperator: m?.role === "OPERATOR",
        };
      }),
    [slotOrder, memberById],
  );

  const handleReorder = useCallback((newOrder: string[]) => {
    setSlotOrder(newOrder);
  }, []);

  // ── Activation & modal state ──────────────────────────────────────────────

  const hasEnoughParticipants = slotOrder.length >= 1;
  const hasValidSchedule =
    scheduleType === "N_DAY" || (scheduleType === "WEEKDAY" && weekdays.length > 0);
  const canStart = openingLetterExists && hasEnoughParticipants && hasValidSchedule;

  const [showAutoRejectModal, setShowAutoRejectModal] = useState(false);
  const [showUnderCapacityModal, setShowUnderCapacityModal] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const handleStartPress = useCallback(() => {
    if (!openingLetterExists) return;
    if (!hasEnoughParticipants) return;
    if (scheduleType === "WEEKDAY" && weekdays.length === 0) {
      Alert.alert("알림", "요일을 하나 이상 선택해주세요.");
      return;
    }
    if (hasPendingRequests) {
      setShowAutoRejectModal(true);
    } else {
      const maxParticipants = space?.maxParticipants;
      const confirmedCount = slotOrder.length;
      if (maxParticipants && confirmedCount < maxParticipants) {
        setShowUnderCapacityModal(true);
      } else {
        doStart();
      }
    }
  }, [
    openingLetterExists, hasEnoughParticipants, scheduleType, weekdays,
    hasPendingRequests, space, slotOrder,
  ]);

  const handleAutoRejectContinue = useCallback(() => {
    setShowAutoRejectModal(false);
    const maxParticipants = space?.maxParticipants;
    const confirmedCount = slotOrder.length;
    if (maxParticipants && confirmedCount < maxParticipants) {
      setShowUnderCapacityModal(true);
    } else {
      doStart();
    }
  }, [space, slotOrder]);

  const doStart = useCallback(async () => {
    setShowUnderCapacityModal(false);
    setIsStarting(true);
    try {
      const rounds = roundConfigs.map((rc) => ({
        title: rc.title.trim() || undefined,
        description: rc.description.trim() || undefined,
        slots: slotOrder,
      }));

      await startSpace.mutateAsync({
        id,
        data: {
          roundCount,
          scheduleType,
          interval: scheduleType === "N_DAY" ? interval : undefined,
          weekdays: scheduleType === "WEEKDAY" ? weekdays : undefined,
          defaultCenterCount: centerCount,
          rounds,
          operatorParticipates,
        },
      });

      queryClient.invalidateQueries({ queryKey: getGetSpaceJoinContextQueryKey(id, { userId }) });
      router.back();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "공간 시작에 실패했어요. 다시 시도해주세요.";
      Alert.alert("오류", msg);
    } finally {
      setIsStarting(false);
    }
  }, [
    roundConfigs, slotOrder, roundCount, scheduleType, interval, weekdays,
    centerCount, operatorParticipates, startSpace, id, queryClient, userId, router,
  ]);

  // ── Loading / error states ────────────────────────────────────────────────

  if (joinContextQuery.isLoading || membersQuery.isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }, styles.center]}>
        <ActivityIndicator size="large" color={Colors.zinc400} />
      </View>
    );
  }

  if (!space) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }, styles.center]}>
        <Text style={styles.errorText}>공간 정보를 불러올 수 없어요.</Text>
        <ScalePressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={styles.backLink}>돌아가기</Text>
        </ScalePressable>
      </View>
    );
  }

  // Hint for start button
  let startHint: string | null = null;
  if (!openingLetterExists) startHint = "여는 편지를 작성해야 시작할 수 있어요.";
  else if (!hasEnoughParticipants) startHint = "확정 참여자가 1명 이상 필요해요.";
  else if (scheduleType === "WEEKDAY" && weekdays.length === 0) startHint = "요일을 하나 이상 선택해주세요.";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <ScalePressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </ScalePressable>
        <Text style={styles.headerTitle}>공간 시작하기</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
      >
        {/* ── Section 1: 운영 설정 확정 ── */}
        <View style={styles.section}>
          <SectionHeader number={1} title="운영 설정 확정" />

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>회차 수</Text>
            <View style={styles.stepperRow}>
              <ScalePressable contentStyle={styles.stepperBtn} onPress={() => setRoundCount((v) => Math.max(1, v - 1))}>
                <Feather name="minus" size={14} color={Colors.zinc600} />
              </ScalePressable>
              <Text style={styles.stepperValue}>{roundCount}</Text>
              <ScalePressable contentStyle={styles.stepperBtn} onPress={() => setRoundCount((v) => Math.min(99, v + 1))}>
                <Feather name="plus" size={14} color={Colors.zinc600} />
              </ScalePressable>
            </View>
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>진행 방식</Text>
            <View style={styles.chipRow}>
              <ScalePressable
                contentStyle={[styles.chip, scheduleType === "N_DAY" && styles.chipActive]}
                onPress={() => setScheduleType("N_DAY")}
              >
                <Text style={[styles.chipText, scheduleType === "N_DAY" && styles.chipTextActive]}>N일 간격</Text>
              </ScalePressable>
              <ScalePressable
                contentStyle={[styles.chip, scheduleType === "WEEKDAY" && styles.chipActive]}
                onPress={() => setScheduleType("WEEKDAY")}
              >
                <Text style={[styles.chipText, scheduleType === "WEEKDAY" && styles.chipTextActive]}>요일 지정</Text>
              </ScalePressable>
            </View>
          </View>

          {scheduleType === "N_DAY" && (
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>간격 (일)</Text>
              <View style={styles.stepperRow}>
                <ScalePressable contentStyle={styles.stepperBtn} onPress={() => setIntervalVal((v) => Math.max(1, v - 1))}>
                  <Feather name="minus" size={14} color={Colors.zinc600} />
                </ScalePressable>
                <Text style={styles.stepperValue}>{interval}일</Text>
                <ScalePressable contentStyle={styles.stepperBtn} onPress={() => setIntervalVal((v) => Math.min(365, v + 1))}>
                  <Feather name="plus" size={14} color={Colors.zinc600} />
                </ScalePressable>
              </View>
            </View>
          )}

          {scheduleType === "WEEKDAY" && (
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>요일</Text>
              <View style={styles.weekdayRow}>
                {WEEKDAY_LABELS.map((label, idx) => {
                  const selected = weekdays.includes(idx);
                  return (
                    <ScalePressable
                      key={idx}
                      contentStyle={[styles.weekdayChip, selected && styles.weekdayChipActive]}
                      onPress={() =>
                        setWeekdays((prev) =>
                          selected
                            ? prev.filter((d) => d !== idx)
                            : [...prev, idx].sort((a, b) => a - b),
                        )
                      }
                    >
                      <Text style={[styles.weekdayChipText, selected && styles.weekdayChipTextActive]}>{label}</Text>
                    </ScalePressable>
                  );
                })}
              </View>
            </View>
          )}

          {scheduleType === "WEEKDAY" && weekdays.length === 0 && (
            <Text style={styles.inlineWarning}>요일을 하나 이상 선택해주세요.</Text>
          )}

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>중심글 수</Text>
            <View style={styles.stepperRow}>
              <ScalePressable contentStyle={styles.stepperBtn} onPress={() => setCenterCount((v) => Math.max(1, v - 1))}>
                <Feather name="minus" size={14} color={Colors.zinc600} />
              </ScalePressable>
              <Text style={styles.stepperValue}>{centerCount}</Text>
              <ScalePressable contentStyle={styles.stepperBtn} onPress={() => setCenterCount((v) => Math.min(99, v + 1))}>
                <Feather name="plus" size={14} color={Colors.zinc600} />
              </ScalePressable>
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        {/* ── Section 2: 운영자 참여 여부 ── */}
        <View style={styles.section}>
          <SectionHeader number={2} title="운영자 참여 여부" />
          <Text style={styles.sectionDesc}>운영자가 중심글 작성 순서에 포함될지 여부를 설정해요.</Text>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>순번에 포함</Text>
            <ScalePressable
              contentStyle={[styles.toggleTrack, operatorParticipates && styles.toggleTrackOn]}
              onPress={() => setOperatorParticipates((v) => !v)}
            >
              <View style={[styles.toggleThumb, operatorParticipates && styles.toggleThumbOn]} />
            </ScalePressable>
          </View>
        </View>

        <View style={styles.divider} />

        {/* ── Section 3: 회차 구성 ── */}
        <View style={styles.section}>
          <SectionHeader number={3} title="회차 구성" />
          <Text style={styles.sectionDesc}>각 회차의 제목과 설명을 입력해요. (선택)</Text>
          {roundConfigs.map((rc, i) => (
            <View key={i} style={styles.roundConfig}>
              <Text style={styles.roundConfigLabel}>{i + 1}회차</Text>
              <TextInput
                style={styles.textInput}
                value={rc.title}
                onChangeText={(text) =>
                  setRoundConfigs((prev) => prev.map((c, idx) => (idx === i ? { ...c, title: text } : c)))
                }
                placeholder="제목 (선택)"
                placeholderTextColor={Colors.zinc400}
                maxLength={100}
              />
              <TextInput
                style={[styles.textInput, styles.textArea, { marginTop: 6 }]}
                value={rc.description}
                onChangeText={(text) =>
                  setRoundConfigs((prev) => prev.map((c, idx) => (idx === i ? { ...c, description: text } : c)))
                }
                placeholder="짧은 설명 (선택)"
                placeholderTextColor={Colors.zinc400}
                multiline
                maxLength={300}
              />
            </View>
          ))}
        </View>

        <View style={styles.divider} />

        {/* ── Section 4: 중심글 작성 순서 배정 ── */}
        <View style={styles.section}>
          <SectionHeader number={4} title="중심글 작성 순서 배정" />
          <Text style={styles.sectionDesc}>
            오른쪽 핸들({"\u2630"})을 드래그해 순서를 조정해요.
          </Text>
          <DraggableSlotList
            items={slotItems}
            onReorder={handleReorder}
            onScrollLock={setScrollEnabled}
          />
        </View>

        <View style={styles.divider} />

        {/* ── Section 5: 1회차 여는 편지 준비 ── */}
        <View style={styles.section}>
          <SectionHeader number={5} title="1회차 여는 편지 준비" />
          <Text style={styles.sectionDesc}>공간을 시작하기 전에 1회차 여는 편지를 작성해주세요.</Text>

          <View style={styles.openingLetterBox}>
            {lettersQuery.isLoading ? (
              <ActivityIndicator size="small" color={Colors.zinc400} />
            ) : openingLetterExists ? (
              <View style={styles.openingLetterReady}>
                <Feather name="check-circle" size={18} color={Colors.noticeAccent} />
                <Text style={styles.openingLetterReadyText}>여는 편지 작성 완료</Text>
              </View>
            ) : (
              <View style={styles.openingLetterPending}>
                <View style={styles.openingLetterPendingTop}>
                  <Feather name="circle" size={18} color={Colors.zinc300} />
                  <Text style={styles.openingLetterPendingText}>아직 작성하지 않았어요</Text>
                </View>
                <ScalePressable
                  style={styles.writeOpeningBtnOuter}
                  contentStyle={styles.writeOpeningBtn}
                  onPress={() =>
                    router.push({
                      pathname: "/of-space-schedule-send" as never,
                      params: { id },
                    })
                  }
                >
                  <Feather name="edit-3" size={14} color={Colors.zinc600} />
                  <Text style={styles.writeOpeningBtnText}>여는 편지 작성하기</Text>
                </ScalePressable>
              </View>
            )}
          </View>
        </View>

        <View style={styles.divider} />

        {/* ── 하단 안내 ── */}
        <View style={styles.noticeSection}>
          <View style={styles.noticeRow}>
            <Feather name="info" size={13} color={Colors.zinc400} />
            <Text style={styles.noticeText}>시작과 동시에 모집이 마감돼요.</Text>
          </View>
          {hasPendingRequests && (
            <View style={styles.noticeRow}>
              <Feather name="info" size={13} color={Colors.zinc400} />
              <Text style={styles.noticeText}>
                승인 대기 중인 코드 신청자({pendingRequests.length}명)가 자동으로 거절 처리돼요.
              </Text>
            </View>
          )}
          <View style={styles.noticeRow}>
            <Feather name="info" size={13} color={Colors.zinc400} />
            <Text style={styles.noticeText}>시작 후 회차 수·진행 방식은 수정할 수 없어요.</Text>
          </View>
        </View>

        {!hasEnoughParticipants && (
          <View style={styles.warningBox}>
            <Feather name="alert-triangle" size={14} color={Colors.zinc500} />
            <Text style={styles.warningText}>확정 참여자가 1명 이상이어야 시작할 수 있어요.</Text>
          </View>
        )}
      </ScrollView>

      {/* ── 시작 버튼 ── */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <ScalePressable
          style={styles.startBtnOuter}
          contentStyle={[styles.startBtn, !canStart && styles.startBtnDisabled]}
          onPress={handleStartPress}
          disabled={!canStart || isStarting}
        >
          {isStarting ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Text style={[styles.startBtnText, !canStart && styles.startBtnDisabledText]}>
              공간 시작하기
            </Text>
          )}
        </ScalePressable>
        {startHint && <Text style={styles.startBtnHint}>{startHint}</Text>}
      </View>

      {/* ── 자동 거절 안내 모달 ── */}
      <ConfirmModal
        visible={showAutoRejectModal}
        title="코드 신청자 자동 거절"
        message={`승인 대기 중인 신청자 ${pendingRequests.length}명이 자동으로 거절 처리돼요. 계속 진행할까요?`}
        confirmLabel="계속하기"
        onCancel={() => setShowAutoRejectModal(false)}
        onConfirm={handleAutoRejectContinue}
      />

      {/* ── 인원 미달 확인 모달 ── */}
      <ConfirmModal
        visible={showUnderCapacityModal}
        title="인원 미달"
        message={`모집 인원(${space.maxParticipants}명)보다 적은 ${slotOrder.length}명으로 시작할까요?`}
        confirmLabel={`${slotOrder.length}명으로 시작`}
        onCancel={() => setShowUnderCapacityModal(false)}
        onConfirm={doStart}
        loading={isStarting}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
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
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
  },
  section: {
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  sectionNumberBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.zinc900,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionNumberText: {
    ...Typography.bodySemiBold,
    fontSize: 11,
    color: Colors.white,
  },
  sectionTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  sectionDesc: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
    marginBottom: 16,
    lineHeight: 18,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.zinc100,
    marginHorizontal: Spacing.screenPx,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  fieldLabel: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc700,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc800,
    minWidth: 36,
    textAlign: "center",
  },
  chipRow: {
    flexDirection: "row",
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.zinc200,
  },
  chipActive: {
    backgroundColor: Colors.zinc900,
    borderColor: Colors.zinc900,
  },
  chipText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc600,
  },
  chipTextActive: {
    color: Colors.white,
  },
  weekdayRow: {
    flexDirection: "row",
    gap: 4,
  },
  weekdayChip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    alignItems: "center",
    justifyContent: "center",
  },
  weekdayChipActive: {
    backgroundColor: Colors.zinc900,
    borderColor: Colors.zinc900,
  },
  weekdayChipText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc600,
  },
  weekdayChipTextActive: {
    color: Colors.white,
  },
  inlineWarning: {
    ...Typography.body,
    fontSize: 12,
    color: Colors.noticeAccent,
    marginTop: -6,
    marginBottom: 12,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.zinc200,
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  toggleTrackOn: {
    backgroundColor: Colors.zinc900,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.white,
    alignSelf: "flex-start",
  },
  toggleThumbOn: {
    alignSelf: "flex-end",
  },
  roundConfig: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
  },
  roundConfigLabel: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.zinc600,
    marginBottom: 8,
  },
  textInput: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc900,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  textArea: {
    minHeight: 64,
    textAlignVertical: "top",
  },
  slotRow: {
    flexDirection: "row",
    alignItems: "center",
    height: SLOT_ROW_H,
    paddingHorizontal: 12,
    backgroundColor: Colors.zinc50,
    borderRadius: 10,
    gap: 10,
  },
  slotRowDragging: {
    backgroundColor: Colors.zinc100,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 99,
  },
  slotOrder: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.zinc400,
    width: 18,
    textAlign: "center",
  },
  slotInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  slotNickname: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc800,
    flexShrink: 1,
  },
  slotRoleTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: Colors.zinc200,
  },
  slotRoleTagText: {
    ...Typography.body,
    fontSize: 11,
    color: Colors.zinc600,
  },
  dragHandle: {
    width: 32,
    height: SLOT_ROW_H,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyBox: {
    paddingVertical: 24,
    alignItems: "center",
  },
  emptyBoxText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
  },
  openingLetterBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    padding: 16,
  },
  openingLetterReady: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  openingLetterReadyText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc800,
  },
  openingLetterPending: {
    gap: 12,
  },
  openingLetterPendingTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  openingLetterPendingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  writeOpeningBtnOuter: {},
  writeOpeningBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.zinc300,
    backgroundColor: Colors.zinc50,
  },
  writeOpeningBtnText: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.zinc700,
  },
  noticeSection: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 20,
    gap: 8,
  },
  noticeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  noticeText: {
    ...Typography.body,
    fontSize: 12,
    color: Colors.zinc500,
    flex: 1,
    lineHeight: 17,
  },
  warningBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginHorizontal: Spacing.screenPx,
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: Colors.zinc100,
  },
  warningText: {
    ...Typography.body,
    fontSize: 12,
    color: Colors.zinc600,
    flex: 1,
    lineHeight: 17,
  },
  bottomBar: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.zinc100,
    backgroundColor: Colors.white,
    alignItems: "center",
    gap: 6,
  },
  startBtnOuter: {
    width: "100%",
  },
  startBtn: {
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  startBtnDisabled: {
    backgroundColor: Colors.zinc200,
  },
  startBtnText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
  startBtnDisabledText: {
    color: Colors.zinc400,
  },
  startBtnHint: {
    ...Typography.body,
    fontSize: 12,
    color: Colors.zinc400,
  },
  errorText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc500,
  },
  backLink: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc600,
  },
  btnOpacity: {
    opacity: 0.6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  modalCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 24,
    width: "100%",
  },
  modalTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
    marginBottom: 8,
  },
  modalMessage: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc600,
    lineHeight: 20,
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: "row",
    gap: 8,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc600,
  },
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.zinc900,
    alignItems: "center",
    justifyContent: "center",
  },
  modalConfirmText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
});
