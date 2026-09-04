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
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";
import HeaderButton from "@/components/shared/HeaderButton";
import { SpaceInfoNote } from "@/components/SpaceInfoNote/SpaceInfoNote";
import { SpaceCopy } from "@/constants/spaceCopy";
import {
  CalendarGrid,
  CollapsibleDatePicker,
  WEEKDAY_LABELS,
  getMinSpaceStartDate,
  startOfDay,
} from "@/components/shared/CalendarGrid";
import SubmitButton from "@/components/SubmitButton/SubmitButton";
import SubmitProgressOverlay from "@/components/shared/SubmitProgressOverlay";
import { LetterPickerSheet } from "@/components/shared/LetterPickerSheet";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/contexts/ToastContext";
import {
  kstToday,
  kstTomorrow,
  minOpeningSendDate,
  kstDateAt6,
  toKstCalendarDate,
} from "@/lib/kstDate";
import { countRecruitmentParticipants } from "@/lib/spaceRecruitment";
import { getUserScopedSpaceJoinContextQueryKey } from "@/lib/spaceJoinContextQuery";
import {
  useGetSpaceJoinContext,
  useListSpaceMembers,
  useListSpaceCodeRequests,
  useListSpaceLetters,
  getListSpaceLettersQueryKey,
  useStartSpace,
  ListSpaceCodeRequestsStatus,
  getListSpaceMembersQueryKey,
  useListArticles,
  getListArticlesQueryKey,
  useListAllSpaceScheduledSends,
  getListAllSpaceScheduledSendsQueryKey,
  useCreateSpaceScheduledSend,
  useCreateSpaceLetter,
  useListSpaceRounds,
  getListSpaceRoundsQueryKey,
} from "@workspace/api-client-react";
import type {
  SpaceMember,
  SpaceWithCreatorInfo,
  StartSpaceBodyScheduleType,
  Article,
  SpaceLetter,
  SpaceScheduledSendWithLetter,
  SpaceRound,
} from "@workspace/api-client-react";

const SLOT_ROW_H = 52;
const SLOT_ROW_GAP = 6;
const SLOT_ITEM_H = SLOT_ROW_H + SLOT_ROW_GAP;

const STEPS = ["운영 설정 확정", "회차 구성", "중심글 순서 배정", "첫 여는 편지 보내기", "시작 확인"];
const TOTAL_STEPS = STEPS.length;
/**
 * Calculate the projected end date (last center article date) for display.
 * participantCount: number of participants in the space (use 1 if 0)
 * totalArticles = roundCount × participantCount
 * dailyCenterCount = centerCount (하루에 올라오는 중심글 수)
 * N_DAY: neededDays = ceil(totalArticles / dailyCenterCount), endDate = startDate + (neededDays − 1) × intervalDays
 * WEEKDAY: find the ceil(totalArticles / dailyCenterCount)-th occurrence of selected weekdays
 */
function calculateProjectedEndDate(
  startDate: Date,
  scheduleType: "N_DAY" | "WEEKDAY",
  intervalDays: number,
  weekdays: number[],
  roundCount: number,
  centerCount: number,
  participantCount: number,
): Date | null {
  const safeParticipantCount = Math.max(1, participantCount);
  const totalArticles = roundCount * safeParticipantCount;
  const neededDays = Math.ceil(totalArticles / Math.max(1, centerCount));

  if (scheduleType === "N_DAY") {
    const result = new Date(startDate);
    result.setDate(result.getDate() + (neededDays - 1) * intervalDays);
    return result;
  }
  if (scheduleType === "WEEKDAY" && weekdays.length > 0) {
    const sorted = [...weekdays].sort((a, b) => a - b);
    const cursor = new Date(startDate);
    cursor.setHours(0, 0, 0, 0);
    let found = 0;
    for (let attempt = 0; attempt < 3650; attempt++) {
      if (sorted.includes(cursor.getDay())) {
        found++;
        if (found === neededDays) return new Date(cursor);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return null;
}

function calculateScheduleDates(
  scheduleType: "N_DAY" | "WEEKDAY",
  intervalDays: number,
  weekdays: number[],
  count: number,
  startDateOverride?: Date,
): Date[] {
  const results: Date[] = [];
  const base = startDateOverride ? new Date(startDateOverride) : new Date();
  base.setHours(0, 0, 0, 0);

  if (scheduleType === "N_DAY") {
    for (let i = 0; i < count; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i * intervalDays);
      results.push(d);
    }
    return results;
  }

  if (scheduleType === "WEEKDAY" && weekdays.length > 0) {
    const sorted = [...weekdays].sort((a, b) => a - b);
    const cursor = new Date(base);
    let found = 0;
    for (let attempt = 0; attempt < 3650 && found < count; attempt++) {
      if (sorted.includes(cursor.getDay())) {
        results.push(new Date(cursor));
        found++;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return results;
  }

  return results;
}

function formatDateShort(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${m}/${day} (${weekday})`;
}

function formatMonthDay(d: Date): string {
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function formatCalendarDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Returns the deadline calendar date for sending an opening letter: the day
 * before startDate (local-midnight calendar Date). The actual send moment on
 * that date is always KST 06:00 — build it with `kstDateAt6` when needed.
 */
function getOpeningLetterDeadline(startDate: Date): Date {
  const d = new Date(startDate);
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}
function ConfirmModal({
  visible,
  title,
  message,
  cancelLabel = "취소",
  confirmLabel,
  onCancel,
  onConfirm,
  loading,
}: {
  visible: boolean;
  title: string;
  message: string;
  cancelLabel?: string;
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
            <ScalePressable
              style={styles.modalCancelBtn}
              contentStyle={[styles.modalBtnContent, styles.modalCancelBtnContent]}
              onPress={onCancel}
              disabled={loading}
            >
              <Text style={styles.modalCancelText}>{cancelLabel}</Text>
            </ScalePressable>
            <ScalePressable
              style={styles.modalConfirmBtn}
              contentStyle={[styles.modalBtnContent, styles.modalConfirmBtnContent, loading && styles.btnOpacity]}
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

interface SlotRowInfo {
  userId: string;
  nickname: string;
  isOperator: boolean;
  isMine: boolean;
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

  const dragY = useRef(new Animated.Value(0)).current;

  const buildPanResponder = useCallback(
    (index: number) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
        onPanResponderGrant: () => {
          dragY.setValue(0);
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
              { transform: [{ translateY: translateY as any }] },
            ]}
          >
            <Text style={styles.slotOrder}>{i + 1}</Text>
            <View style={styles.slotInfo}>
              <Text style={styles.slotNickname} numberOfLines={1}>
                {item.isMine ? `(나) ${item.nickname}` : item.nickname}
              </Text>
              {item.isOperator && (
                <View style={styles.slotRoleTag}>
                  <Text style={styles.slotRoleTagText}>공간장</Text>
                </View>
              )}
            </View>
            <View style={styles.dragHandle} {...panResponders[i].panHandlers}>
              <Feather name="menu" size={18} color={Colors.zinc400} />
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

// ─── Step Components ──────────────────────────────────────────────────────────

function OperationSettingsStep({
  roundCount,
  setRoundCount,
  scheduleType,
  setScheduleType,
  interval,
  setIntervalVal,
  weekdays,
  setWeekdays,
  centerCount,
  setCenterCount,
  operatorParticipates,
  confirmedCount,
  maxParticipants,
  startDate,
  setStartDate,
}: {
  roundCount: number;
  setRoundCount: (v: number) => void;
  scheduleType: StartSpaceBodyScheduleType;
  setScheduleType: (v: StartSpaceBodyScheduleType) => void;
  interval: number;
  setIntervalVal: (v: number) => void;
  weekdays: number[];
  setWeekdays: (v: number[]) => void;
  centerCount: number;
  setCenterCount: (v: number) => void;
  operatorParticipates: boolean;
  confirmedCount: number;
  maxParticipants: number | null | undefined;
  startDate: Date;
  setStartDate: (v: Date) => void;
}) {
  const minStartDate = useMemo(() => getMinSpaceStartDate(), []);
  const isStartDatePast = startOfDay(startDate) < minStartDate;

  const endDate = useMemo(
    () => calculateProjectedEndDate(startDate, scheduleType as "N_DAY" | "WEEKDAY", interval, weekdays, roundCount, centerCount, confirmedCount),
    [startDate, scheduleType, interval, weekdays, roundCount, centerCount, confirmedCount],
  );

  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>운영 설정 확정</Text>
      <Text style={stepStyles.stepDesc}>공간 생성 시 입력한 설정을 최종 확인하고 조정해요.</Text>

      {/* 참여 인원 요약 */}
      <View style={opStyles.participantRow}>
        <Feather name="users" size={14} color={Colors.zinc500} />
        <Text style={opStyles.participantText}>
          {"모집 인원 "}
          <Text style={opStyles.participantEmphasis}>{maxParticipants != null ? `${maxParticipants}명` : "—"}</Text>
          {" / 참여 인원 "}
          <Text style={opStyles.participantEmphasis}>{confirmedCount}명</Text>
        </Text>
      </View>

      <View style={stepStyles.fieldGroup}>
        <View style={stepStyles.labelRow}>
          <Text style={stepStyles.fieldLabel}>회차 수</Text>
          <SpaceInfoNote variant="popup" text={SpaceCopy.round_what} />
        </View>
        <View style={stepStyles.stepperRow}>
          <ScalePressable
            contentStyle={styles.stepperBtn}
            onPress={() => setRoundCount(Math.max(1, roundCount - 1))}
          >
            <Feather name="minus" size={14} color={Colors.zinc600} />
          </ScalePressable>
          <Text style={styles.stepperValue}>{roundCount}회</Text>
          <ScalePressable
            contentStyle={styles.stepperBtn}
            onPress={() => setRoundCount(Math.min(52, roundCount + 1))}
          >
            <Feather name="plus" size={14} color={Colors.zinc600} />
          </ScalePressable>
        </View>
      </View>

      <View style={stepStyles.fieldGroup}>
        <View style={stepStyles.labelRow}>
          <Text style={stepStyles.fieldLabel}>진행 방식</Text>
          <SpaceInfoNote variant="popup" text={SpaceCopy.scheduleType_what} />
        </View>
        <View style={stepStyles.optionList}>
          <ScalePressable
            contentStyle={[stepStyles.option, scheduleType === "N_DAY" && stepStyles.optionSelected]}
            onPress={() => setScheduleType("N_DAY")}
          >
            <View style={[stepStyles.optionRadio, scheduleType === "N_DAY" && stepStyles.optionRadioActive]}>
              {scheduleType === "N_DAY" && <View style={stepStyles.optionRadioDot} />}
            </View>
            <Text style={stepStyles.optionLabel}>N일 간격</Text>
          </ScalePressable>
          <ScalePressable
            contentStyle={[stepStyles.option, scheduleType === "WEEKDAY" && stepStyles.optionSelected]}
            onPress={() => setScheduleType("WEEKDAY")}
          >
            <View style={[stepStyles.optionRadio, scheduleType === "WEEKDAY" && stepStyles.optionRadioActive]}>
              {scheduleType === "WEEKDAY" && <View style={stepStyles.optionRadioDot} />}
            </View>
            <Text style={stepStyles.optionLabel}>요일 지정</Text>
          </ScalePressable>
        </View>

        {scheduleType === "N_DAY" && (
          <View style={stepStyles.subField}>
            <Text style={stepStyles.subFieldLabel}>간격 (일)</Text>
            <View style={stepStyles.stepperRow}>
              <ScalePressable
                contentStyle={styles.stepperBtn}
                onPress={() => setIntervalVal(Math.max(1, interval - 1))}
              >
                <Feather name="minus" size={14} color={Colors.zinc600} />
              </ScalePressable>
              <Text style={styles.stepperValue}>{interval}일</Text>
              <ScalePressable
                contentStyle={styles.stepperBtn}
                onPress={() => setIntervalVal(Math.min(365, interval + 1))}
              >
                <Feather name="plus" size={14} color={Colors.zinc600} />
              </ScalePressable>
            </View>
          </View>
        )}

        {scheduleType === "WEEKDAY" && (
          <View style={stepStyles.subField}>
            <Text style={stepStyles.subFieldLabel}>요일 선택</Text>
            <View style={styles.weekdayRow}>
              {WEEKDAY_LABELS.map((label, idx) => {
                const selected = weekdays.includes(idx);
                return (
                  <ScalePressable
                    key={idx}
                    contentStyle={[styles.weekdayChip, selected && styles.weekdayChipActive]}
                    onPress={() =>
                      setWeekdays(
                        selected
                          ? weekdays.filter((d) => d !== idx)
                          : [...weekdays, idx].sort((a, b) => a - b),
                      )
                    }
                  >
                    <Text style={[styles.weekdayChipText, selected && styles.weekdayChipTextActive]}>
                      {label}
                    </Text>
                  </ScalePressable>
                );
              })}
            </View>
            {weekdays.length === 0 && (
              <Text style={stepStyles.warningText}>요일을 하나 이상 선택해주세요.</Text>
            )}
          </View>
        )}
      </View>

      <View style={stepStyles.fieldGroup}>
        {/* centerCount prop의 의미 = "한 번에 올라오는 중심글 수" (일별 발행 편수) */}
        <View style={stepStyles.labelRow}>
          <Text style={stepStyles.fieldLabel}>한 번에 올라오는 중심글 수</Text>
          <SpaceInfoNote variant="popup" text={SpaceCopy.centerCount_what} />
        </View>
        <View style={stepStyles.stepperRow}>
          <ScalePressable
            contentStyle={styles.stepperBtn}
            onPress={() => setCenterCount(Math.max(1, centerCount - 1))}
          >
            <Feather name="minus" size={14} color={Colors.zinc600} />
          </ScalePressable>
          <Text style={styles.stepperValue}>{centerCount}편</Text>
          <ScalePressable
            contentStyle={styles.stepperBtn}
            onPress={() => setCenterCount(Math.min(10, centerCount + 1))}
          >
            <Feather name="plus" size={14} color={Colors.zinc600} />
          </ScalePressable>
        </View>
        <Text style={stepStyles.hint}>
          1회차 = 참여자 전원이 한 번씩 → 총 {Math.max(1, confirmedCount)}편 / 하루 {centerCount}편씩 수신
        </Text>
      </View>

      <View style={stepStyles.fieldGroup}>
        <Text style={stepStyles.fieldLabel}>공간장 참여</Text>
        <View style={[stepStyles.readonlyBox]}>
          <Feather
            name={operatorParticipates ? "check-circle" : "circle"}
            size={16}
            color={operatorParticipates ? Colors.zinc700 : Colors.zinc400}
          />
          <Text style={stepStyles.readonlyText}>
            {operatorParticipates ? "공간장도 회차에 직접 참여해요" : "공간장은 회차에 참여하지 않아요"}
          </Text>
          <Text style={stepStyles.readonlyHint}>(수정 불가)</Text>
        </View>
      </View>

      {/* 시작 날짜 선택 — 기본은 텍스트로 접혀 있고, 탭하면 달력이 펼쳐져요 */}
      <View style={stepStyles.fieldGroup}>
        <Text style={stepStyles.fieldLabel}>시작 예정일</Text>
        <CollapsibleDatePicker
          value={startDate}
          onChange={(date) => setStartDate(date)}
          isDateDisabled={(date) => startOfDay(date) < minStartDate}
          onOpen={() => {
            // 저장된 날짜가 이미 과거가 됐다면 달력을 열 때 오늘로 스냅
            if (isStartDatePast) return new Date(minStartDate);
          }}
          formatButtonLabel={(date) => formatDate(date)}
          triggerStyle={isStartDatePast ? opStyles.datePastTrigger : undefined}
        />
        {isStartDatePast && (
          <Text style={opStyles.datePastWarning}>선택한 날짜가 지났어요. 오늘 이후 날짜를 선택해주세요.</Text>
        )}
      </View>

      {/* 종료 예정일 */}
      <View style={stepStyles.fieldGroup}>
        <Text style={stepStyles.fieldLabel}>종료 예정일</Text>
        <View style={opStyles.endDateBox}>
          <Feather name="flag" size={14} color={Colors.zinc400} />
          <Text style={opStyles.endDateText}>
            {endDate ? formatDate(endDate) : "—"}
          </Text>
          <Text style={opStyles.endDateHint}>마지막 중심글 예정일</Text>
        </View>
      </View>
    </View>
  );
}

function RoundConfigStep({
  roundIdx,
  roundCount,
  config,
  onChange,
}: {
  roundIdx: number;
  roundCount: number;
  config: { title: string; description: string };
  onChange: (title: string, description: string) => void;
}) {
  return (
    <View style={stepStyles.container}>
        <Text style={stepStyles.stepTitle}>{roundIdx + 1}회차 구성</Text>
        <Text style={stepStyles.stepDesc}>
          {roundCount}회차 중 {roundIdx + 1}번째 회차의 제목과 설명을 입력해요.
        </Text>

        <View style={stepStyles.fieldGroup}>
          <Text style={stepStyles.fieldLabel}>제목 (선택)</Text>
          <TextInput
            style={stepStyles.input}
            value={config.title}
            onChangeText={(t) => onChange(t, config.description)}
            placeholder={`예: ${roundIdx + 1}회차`}
            placeholderTextColor={Colors.zinc400}
            maxLength={100}
            returnKeyType="next"
          />
          <Text style={stepStyles.charCount}>{config.title.length} / 100</Text>
        </View>

        <View style={stepStyles.fieldGroup}>
          <Text style={stepStyles.fieldLabel}>짧은 설명 (선택)</Text>
          <TextInput
            style={[stepStyles.input, stepStyles.inputMulti]}
            value={config.description}
            onChangeText={(t) => onChange(config.title, t)}
            placeholder="이 회차에서 다룰 내용을 간단히 설명해주세요"
            placeholderTextColor={Colors.zinc400}
            multiline
            textAlignVertical="top"
            maxLength={300}
          />
          <Text style={stepStyles.charCount}>{config.description.length} / 300</Text>
        </View>
    </View>
  );
}
function SlotOrderStep({
  items,
  onReorder,
  onScrollLock,
}: {
  items: SlotRowInfo[];
  onReorder: (newOrder: string[]) => void;
  onScrollLock: (locked: boolean) => void;
}) {
  return (
    <View style={stepStyles.container}>
      <View style={stepStyles.labelRow}>
        <Text style={stepStyles.stepTitle}>중심글 발신 순서</Text>
      </View>
      <Text style={stepStyles.stepDesc}>
        오른쪽 핸들({"\u2630"})을 드래그해 순서를 조정해요.
      </Text>
      <DraggableSlotList items={items} onReorder={onReorder} onScrollLock={onScrollLock} />
    </View>
  );
}

function ScheduleCalendarStep({
  items,
  roundCount,
  scheduleType,
  interval,
  weekdays,
  roundConfigs: _roundConfigs,
  centerCount,
  startDate,
  participantCount,
}: {
  items: SlotRowInfo[];
  roundCount: number;
  scheduleType: StartSpaceBodyScheduleType;
  interval: number;
  weekdays: number[];
  roundConfigs: Array<{ title: string; description: string }>;
  centerCount: number;
  startDate: Date;
  participantCount: number;
}) {
  const endDate = useMemo(
    () =>
      calculateProjectedEndDate(
        startDate,
        scheduleType as "N_DAY" | "WEEKDAY",
        interval,
        weekdays,
        roundCount,
        centerCount,
        participantCount,
      ),
    [startDate, scheduleType, interval, weekdays, roundCount, centerCount, participantCount],
  );

  const startMonthYear = { year: startDate.getFullYear(), month: startDate.getMonth() };
  const endMonthYear = endDate
    ? { year: endDate.getFullYear(), month: endDate.getMonth() }
    : startMonthYear;

  const [viewYear, setViewYear] = useState(startMonthYear.year);
  const [viewMonth, setViewMonth] = useState(startMonthYear.month);

  // Under the new model: neededDays = ceil(totalArticles / dailyCenterCount)
  // where totalArticles = roundCount × participantCount
  const neededDays = useMemo(
    () => Math.ceil((roundCount * Math.max(1, participantCount)) / Math.max(1, centerCount)),
    [roundCount, participantCount, centerCount],
  );

  const dates = useMemo(
    () => calculateScheduleDates(scheduleType, interval, weekdays, neededDays, startDate),
    [scheduleType, interval, weekdays, neededDays, startDate],
  );

  const assignmentMap = useMemo(() => {
    const map: Record<string, SlotRowInfo[]> = {};
    dates.forEach((date, i) => {
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      if (!map[key]) map[key] = [];
      const baseIdx = i % (items.length || 1);
      for (let c = 0; c < centerCount; c++) {
        const w = items[(baseIdx + c) % (items.length || 1)];
        if (w && !map[key].find((x) => x.userId === w.userId)) map[key].push(w);
      }
    });
    return map;
  }, [dates, items, centerCount]);

  const canGoPrev =
    viewYear > startMonthYear.year ||
    (viewYear === startMonthYear.year && viewMonth > startMonthYear.month);
  const canGoNext =
    viewYear < endMonthYear.year ||
    (viewYear === endMonthYear.year && viewMonth < endMonthYear.month);

  const handlePrevMonth = useCallback(() => {
    if (!canGoPrev) return;
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }, [canGoPrev, viewMonth]);

  const handleNextMonth = useCallback(() => {
    if (!canGoNext) return;
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }, [canGoNext, viewMonth]);

  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>일정 확인</Text>
      <Text style={stepStyles.stepDesc}>
        시작일 기준 예상 배정 일정이에요. 실제 날짜는 시작 시점에 확정돼요.
      </Text>

      {/* 시작일 / 종료일 */}
      <View style={calGridStyles.dateRange}>
        <View style={calGridStyles.dateRangeItem}>
          <Text style={calGridStyles.dateRangeLabel}>시작일</Text>
          <Text style={calGridStyles.dateRangeValue}>{formatDate(startDate)}</Text>
        </View>
        <View style={calGridStyles.dateRangeDivider} />
        <View style={calGridStyles.dateRangeItem}>
          <Text style={calGridStyles.dateRangeLabel}>종료일</Text>
          <Text style={calGridStyles.dateRangeValue}>{endDate ? formatDate(endDate) : "—"}</Text>
        </View>
      </View>

      {/* 달력 — 읽기 전용 (배정 미리보기) */}
      <CalendarGrid
        year={viewYear}
        month={viewMonth}
        onPrevMonth={handlePrevMonth}
        onNextMonth={handleNextMonth}
        canGoPrev={canGoPrev}
        canGoNext={canGoNext}
        cellContainerStyle={(date) => {
          const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
          const hasMark = (assignmentMap[key]?.length ?? 0) > 0;
          return [calGridStyles.cellSize, hasMark && calGridStyles.cellMarked];
        }}
        renderCellContent={(date, { isSun }) => {
          const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
          const assignments = assignmentMap[key] ?? [];
          const hasMark = assignments.length > 0;
          return (
            <>
              <Text style={[calGridStyles.dayNum, isSun && calGridStyles.sunDay, hasMark && calGridStyles.dayNumMarked]}>
                {date.getDate()}
              </Text>
              <View style={calGridStyles.bubbleRow}>
                {assignments.slice(0, 2).map((a, ai) => (
                  <View key={ai} style={calGridStyles.assignBubble}>
                    <Text style={calGridStyles.assignInitial}>{a.nickname.charAt(0)}</Text>
                  </View>
                ))}
                {assignments.length > 2 && (
                  <Text style={calGridStyles.assignMore}>+{assignments.length - 2}</Text>
                )}
              </View>
            </>
          );
        }}
      />

      <Text style={stepStyles.hint}>
        * 순서는 참여자 수 기준으로 순환 배정돼요. 실제 슬롯은 공간 시작 후 회차마다 동일 순서가 적용돼요.
      </Text>
    </View>
  );
}

function OpeningLetterStep({
  isLoading,
  isArticlesLoading,
  isArticlesError,
  onRefetchArticles,
  openingLetterExists,
  openingScheduledSend,
  startDate,
  articles,
  letters,
  spaceId,
  userId,
  onSaved,
}: {
  isLoading: boolean;
  isArticlesLoading: boolean;
  isArticlesError: boolean;
  onRefetchArticles: () => void;
  openingLetterExists: boolean;
  openingScheduledSend: { scheduledAt: string; articleTitle?: string | null } | null;
  startDate: Date;
  articles: Article[];
  letters: SpaceLetter[];
  spaceId: string;
  userId: string;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const router = useRouter();
  const createSend = useCreateSpaceScheduledSend();
  const createLetter = useCreateSpaceLetter();

  const handleWriteNew = useCallback(() => {
    router.push({
      pathname: "/on-01a",
      params: { mode: "local-draft", spaceId, letterType: "OPENING" },
    });
  }, [router, spaceId]);

  const deadline = getOpeningLetterDeadline(startDate);
  const maxScheduledAt = deadline;

  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  // Show article list when: no letter registered yet, OR letter exists but has no active pending send
  const [showArticleList, setShowArticleList] = useState(() => !openingLetterExists || openingScheduledSend === null);
  const [pickerVisible, setPickerVisible] = useState(false);

  // KST 기준: 06:00 이전이면 오늘, 이후면 내일부터 발송 예약 가능
  const minSendDate = useMemo(() => minOpeningSendDate(), []);
  const hasReservableOpeningDate = minSendDate <= maxScheduledAt;

  const [scheduledDate, setScheduledDate] = useState<Date>(() => {
    const d = minSendDate;
    return d > maxScheduledAt ? maxScheduledAt : d;
  });


  const [saving, setSaving] = useState(false);

  const existingArticleTitle = openingScheduledSend?.articleTitle ?? null;
  // 저장된 발송 instant를 KST 달력 날짜로 변환해 표시 (기기 시간대 무관)
  const existingScheduledDate = openingScheduledSend
    ? toKstCalendarDate(new Date(openingScheduledSend.scheduledAt))
    : null;

  const selectedTitle = useMemo(() => {
    if (!selectedArticleId) return null;
    return articles.find(a => a.id === selectedArticleId)?.title ?? "제목 없음";
  }, [selectedArticleId, articles]);

  const handleSave = useCallback(async () => {
    if (!hasReservableOpeningDate) {
      const message = `여는 편지는 ${formatMonthDay(deadline)} 06:00까지 보내야 하지만, 지금 예약 가능한 가장 빠른 날짜보다 이전이에요. 시작 예정일을 늦춰주세요.`;
      if (Platform.OS === "web") {
        showToast({ message, type: "error", duration: 5000, position: "top" });
      } else {
        Alert.alert("예약할 수 없는 일정", message);
      }
      return;
    }
    if (!selectedArticleId) {
      if (Platform.OS === "web") {
        showToast({ message: "발송할 글을 선택해주세요.", type: "error", duration: 5000, position: "top" });
      } else {
        Alert.alert("알림", "발송할 글을 선택해주세요.");
      }
      return;
    }
    setSaving(true);
    try {
      const letterType = "OPENING";
      const existingLetter = letters.find(l => l.sourceArticleId === selectedArticleId && l.letterType === letterType);
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

      const chosenDate = scheduledDate > maxScheduledAt ? maxScheduledAt : scheduledDate;
      // 발송 시각은 기기 시간대와 무관하게 항상 "해당 날짜의 KST 06:00"
      const finalScheduledAt = kstDateAt6(chosenDate);
      await createSend.mutateAsync({ id: spaceId, letterId: spaceLetterId, data: { scheduledAt: finalScheduledAt.toISOString() } });
      queryClient.invalidateQueries({ queryKey: getListAllSpaceScheduledSendsQueryKey(spaceId) });

      setSelectedArticleId(null);
      setShowArticleList(false);
      onSaved();
    } catch {
      if (Platform.OS === "web") {
        showToast({ message: "예약에 실패했어요. 다시 시도해주세요.", type: "error", duration: 5000, position: "top" });
      } else {
        Alert.alert("오류", "예약에 실패했어요. 다시 시도해주세요.");
      }
    } finally {
      setSaving(false);
    }
  }, [hasReservableOpeningDate, deadline, selectedArticleId, scheduledDate, maxScheduledAt, letters, spaceId, userId, createLetter, createSend, queryClient, onSaved, showToast]);

  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>첫 여는 편지 보내기</Text>
      <Text style={stepStyles.stepDesc}>공간 시작과 함께 전송될 1회차 여는 편지를 선택해요.</Text>

      {/* 발송 가능 기간 안내 */}
      <View style={olStyles.deadlineInfo}>
        <Feather name="calendar" size={13} color={Colors.zinc400} />
        <Text style={olStyles.deadlineInfoText}>
          발송 예정일은 첫 중심글 시작일({formatMonthDay(startDate)}) 하루 전인{" "}
          <Text style={olStyles.deadlineEmphasis}>{formatMonthDay(deadline)} 06:00</Text>
          까지 설정할 수 있어요.
        </Text>
      </View>
      {!hasReservableOpeningDate && (
        <Text style={opStyles.datePastWarning}>
          여는 편지를 예약할 수 있는 날짜가 없어요. 시작 예정일을 늦춰주세요.
        </Text>
      )}

      {/* 이미 등록된 편지 정보 — 변경 중에도 현재 등록된 편지가 항상 보이도록 유지 */}
      {openingLetterExists && existingScheduledDate && (
        <View style={olStyles.savedCard}>
          <View style={olStyles.savedCardHeader}>
            <Feather name="check-circle" size={15} color={Colors.noticeAccent} />
            <Text style={olStyles.savedCardTitle}>여는 편지 등록됨</Text>
          </View>
          <Text style={olStyles.savedCardArticle} numberOfLines={1}>
            {existingArticleTitle ?? "제목 없음"}
          </Text>
          <Text style={olStyles.savedCardDate}>{formatMonthDay(existingScheduledDate)} 06:00 발송 예정</Text>
          {!showArticleList && (
            <ScalePressable
              contentStyle={olStyles.reSelectBtn}
              onPress={() => { setSelectedArticleId(null); setShowArticleList(true); }}
            >
              <Text style={olStyles.reSelectBtnText}>여는 편지 추가 등록</Text>
            </ScalePressable>
          )}
        </View>
      )}

      {/* 글 목록 인라인 */}
      {showArticleList ? (
        <View style={olStyles.section}>
          <Text style={olStyles.sectionTitle}>보낼 편지 선택</Text>
          <ScalePressable
            contentStyle={olStyles.articleSelectBtn}
            onPress={() => setPickerVisible(true)}
          >
            <Feather
              name="file-text"
              size={16}
              color={selectedArticleId ? Colors.zinc800 : Colors.zinc400}
            />
            <Text
              style={[olStyles.articleSelectBtnText, selectedArticleId && olStyles.articleSelectBtnTextActive]}
              numberOfLines={1}
            >
              {selectedTitle ?? "선택된 편지 없음"}
            </Text>
            <Feather name="chevron-right" size={16} color={Colors.zinc400} />
          </ScalePressable>

          {/* 새로 작성하기 — 기존 편지가 없을 때 직접 작성으로 이동 */}
          <ScalePressable
            contentStyle={olStyles.writeNewBtn}
            onPress={handleWriteNew}
          >
            <Feather name="edit-2" size={13} color={Colors.zinc500} />
            <Text style={olStyles.writeNewBtnText}>새로 작성하기</Text>
          </ScalePressable>

          {/* 선택된 글 — 발송일 선택 */}
          {selectedArticleId && hasReservableOpeningDate && (
            <View style={olStyles.sendDateSection}>
              <Text style={olStyles.sendDateLabel}>발송 예정일 (06:00 발송)</Text>
              <CollapsibleDatePicker
                value={scheduledDate}
                onChange={(date) => setScheduledDate(date)}
                isDateDisabled={(date) => {
                  const d0 = new Date(date); d0.setHours(0, 0, 0, 0);
                  const mx = new Date(maxScheduledAt); mx.setHours(0, 0, 0, 0);
                  const mn = new Date(minSendDate); mn.setHours(0, 0, 0, 0);
                  return d0 < mn || d0 > mx;
                }}
                formatButtonLabel={(date) => `${formatMonthDay(date)} 06:00`}
                triggerStyle={olStyles.sendDateBtn}
                triggerTextStyle={olStyles.sendDateBtnText}
              />

              <ScalePressable
                contentStyle={[olStyles.saveBtn, saving && olStyles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={saving}
              >
                <Text style={olStyles.saveBtnText}>{saving ? "등록 중..." : "여는 편지로 등록"}</Text>
              </ScalePressable>
            </View>
          )}
        </View>
      ) : null}

      <LetterPickerSheet
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        articles={articles}
        isLoading={isLoading || isArticlesLoading}
        isError={isArticlesError}
        onRefetch={onRefetchArticles}
        selectedId={selectedArticleId}
        onSelect={(article) => setSelectedArticleId(article.id)}
      />
    </View>
  );
}

function StartConfirmStep({
  roundCount,
  scheduleType,
  interval,
  weekdays,
  centerCount,
  startDate,
  operatorParticipates,
  slotItems,
  openingLetterExists,
  openingScheduledSend,
  hasPendingRequests,
  pendingCount,
  onGoToStep,
  participantCount,
  hasEnoughParticipants,
}: {
  roundCount: number;
  scheduleType: StartSpaceBodyScheduleType;
  interval: number;
  weekdays: number[];
  centerCount: number;
  startDate: Date;
  operatorParticipates: boolean;
  slotItems: SlotRowInfo[];
  openingLetterExists: boolean;
  openingScheduledSend: { scheduledAt: string; articleTitle?: string | null } | null;
  hasPendingRequests: boolean;
  pendingCount: number;
  onGoToStep: (step: number) => void;
  participantCount: number;
  hasEnoughParticipants: boolean;
}) {
  const scheduleSummary =
    scheduleType === "N_DAY"
      ? `${interval}일 간격`
      : weekdays.length > 0
        ? weekdays.map((d) => WEEKDAY_LABELS[d]).join(", ") + "요일"
        : "요일 미지정";

  const lastDate = calculateProjectedEndDate(
    startDate,
    scheduleType as "N_DAY" | "WEEKDAY",
    interval,
    weekdays,
    roundCount,
    centerCount,
    participantCount,
  );

  const openingTitle = openingScheduledSend?.articleTitle ?? null;
  const openingScheduledDate = openingScheduledSend
    ? toKstCalendarDate(new Date(openingScheduledSend.scheduledAt))
    : null;

  const dateRangeText = lastDate
    ? `${formatMonthDay(startDate)} ~ ${formatMonthDay(lastDate)}`
    : formatMonthDay(startDate);

  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>시작 확인</Text>
      <Text style={stepStyles.stepDesc}>입력한 내용을 확인하고 공간을 시작해요.</Text>

      <View style={confirmStyles.block}>
        <View style={confirmStyles.blockHeader}>
          <Text style={confirmStyles.blockTitle}>운영 설정</Text>
          <ScalePressable onPress={() => onGoToStep(0)}>
            <Text style={confirmStyles.editBtn}>수정</Text>
          </ScalePressable>
        </View>
        <View style={confirmStyles.summaryRows}>
          <View style={confirmStyles.summaryRow}>
            <Text style={confirmStyles.summaryKey}>회차 수</Text>
            <Text style={confirmStyles.summaryVal}>{roundCount}회</Text>
          </View>
          <View style={confirmStyles.summaryRow}>
            <Text style={confirmStyles.summaryKey}>진행 방식</Text>
            <Text style={confirmStyles.summaryVal}>{scheduleSummary}</Text>
          </View>
          <View style={confirmStyles.summaryRow}>
            <Text style={confirmStyles.summaryKey}>하루 중심글</Text>
            <Text style={confirmStyles.summaryVal}>하루 {centerCount}편</Text>
          </View>
          <View style={confirmStyles.summaryRow}>
            <Text style={confirmStyles.summaryKey}>공간장 참여</Text>
            <Text style={confirmStyles.summaryVal}>{operatorParticipates ? "참여" : "불참"}</Text>
          </View>
          <View style={confirmStyles.summaryRow}>
            <Text style={confirmStyles.summaryKey}>시작일</Text>
            <Text style={confirmStyles.summaryVal}>{dateRangeText}</Text>
          </View>
        </View>
      </View>

      <View style={confirmStyles.block}>
        <View style={confirmStyles.blockHeader}>
          <Text style={confirmStyles.blockTitle}>중심글 순서</Text>
          <ScalePressable onPress={() => onGoToStep(2)}>
            <Text style={confirmStyles.editBtn}>수정</Text>
          </ScalePressable>
        </View>
        {slotItems.length > 0 ? (
          <Text style={confirmStyles.summaryProse}>
            {slotItems.map((s) => s.nickname).join(" → ")}
          </Text>
        ) : (
          <Text style={confirmStyles.summaryWarning}>확정 참여자가 없어요.</Text>
        )}
        {/* Warn when only the operator is in slotItems — server requires
            at least one non-operator APPROVED participant to start */}
        {!hasEnoughParticipants && slotItems.length > 0 && (
          <Text style={confirmStyles.summaryWarning}>
            비운영자 참여자가 없어요. 참여 신청을 수락해야 시작할 수 있어요.
          </Text>
        )}
      </View>

      <View style={confirmStyles.block}>
        <View style={confirmStyles.blockHeader}>
          <Text style={confirmStyles.blockTitle}>여는 편지</Text>
          <ScalePressable onPress={() => onGoToStep(3)}>
            <Text style={confirmStyles.editBtn}>확인</Text>
          </ScalePressable>
        </View>
        <View style={confirmStyles.summaryRows}>
          <View style={confirmStyles.summaryRow}>
            <Feather
              name={openingLetterExists ? "check-circle" : "circle"}
              size={15}
              color={openingLetterExists ? Colors.noticeAccent : Colors.zinc400}
            />
            <Text
              style={openingLetterExists ? confirmStyles.summaryVal : confirmStyles.summaryWarning}
              numberOfLines={1}
            >
              {openingLetterExists ? (openingTitle ?? "제목 없음") : "미작성"}
            </Text>
          </View>
          {openingLetterExists && openingScheduledDate && (
            <View style={confirmStyles.summaryRow}>
              <Text style={confirmStyles.summaryKey}>발송 예정일</Text>
              <Text style={confirmStyles.summaryVal}>{formatMonthDay(openingScheduledDate)} 06:00</Text>
            </View>
          )}
        </View>
      </View>

      <View style={confirmStyles.noticeBlock}>
        <SpaceInfoNote variant="bare" text={SpaceCopy.spaceStart_recruitCloses} />
        {hasPendingRequests && (
          <SpaceInfoNote
            variant="bare"
            text={SpaceCopy.spaceStart_pendingReject(pendingCount)}
          />
        )}
        <SpaceInfoNote variant="bare" text={SpaceCopy.spaceStart_noEdit} />
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SpaceStartScreen() {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const [scrollEnabled, setScrollEnabled] = useState(true);

  // ── Step navigation ────────────────────────────────────────────────────────
  // step 0: 운영 설정 확정
  // step 1: 회차 구성 (먼저 기본/직접 선택, 직접 선택 시 sub-stepped by currentRoundIdx)
  // step 2: 중심글 순서 배정 (sub-stepped: 0=order, 1=calendar)
  // step 3: 여는 편지 준비
  // step 4: 시작 확인

  const [step, setStep] = useState(0);
  const [currentRoundIdx, setCurrentRoundIdx] = useState(0);
  const [slotSubStep, setSlotSubStep] = useState(0); // 0=order, 1=calendar
  const [roundConfigMode, setRoundConfigMode] = useState<"default" | "custom" | null>(null);
  // Whether the user has answered the "회차 구성을 변경하시겠습니까?" gate for
  // this session. Reset whenever they step back out of the round-config step.
  const [roundConfigConfirmed, setRoundConfigConfirmed] = useState(false);
  const [showRoundConfigConfirm, setShowRoundConfigConfirm] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);

  // ── Data queries ──────────────────────────────────────────────────────────

  const joinContextQuery = useGetSpaceJoinContext(
    id,
    { query: { enabled: !!id && !!userId, queryKey: getUserScopedSpaceJoinContextQueryKey(id, userId) } },
  );
  const space = joinContextQuery.data?.space as SpaceWithCreatorInfo | undefined;

  const membersQuery = useListSpaceMembers(
    id,
    { displayContext: "START_ORDER" },
    {
      query: {
        enabled: !!id,
        queryKey: getListSpaceMembersQueryKey(id, { displayContext: "START_ORDER" }),
      },
    },
  );
  const confirmedMembers = useMemo(
    () => ((membersQuery.data ?? []) as SpaceMember[]).filter((m) => m.status === "APPROVED"),
    [membersQuery.data],
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
  const letters = (lettersQuery.data ?? []) as SpaceLetter[];
  const openingLetters = letters.filter((l) => l.letterType === "OPENING");
  const openingLetter = openingLetters[0] ?? null;
  const openingLetterExists = openingLetters.length > 0;

  const sendsQuery = useListAllSpaceScheduledSends(id, {
    query: { enabled: !!id, queryKey: getListAllSpaceScheduledSendsQueryKey(id) },
  });
  const sends = (sendsQuery.data ?? []) as SpaceScheduledSendWithLetter[];
  // Find a PENDING send for ANY opening letter — the user may have changed
  // their article selection, creating a new letter row each time, so we must
  // not lock the search to only the first letter in the array.
  const openingScheduledSend = openingLetterExists
    ? (sends.find((s) => openingLetters.some((l) => l.id === s.spaceLetterId) && s.status === "PENDING") ?? null)
    : null;

  const articlesQuery = useListArticles(
    { authorId: userId ?? "", status: "LETTER" },
    { query: { enabled: !!userId, queryKey: getListArticlesQueryKey({ authorId: userId ?? "", status: "LETTER" }) } },
  );
  const articles = (articlesQuery.data ?? []) as Article[];

  useFocusEffect(
    useCallback(() => {
      if (id) {
        queryClient.invalidateQueries({ queryKey: getListSpaceLettersQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListAllSpaceScheduledSendsQueryKey(id) });
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
  const [startDate, setStartDate] = useState<Date>(() => getMinSpaceStartDate());

  useEffect(() => {
    if (!space) return;
    setRoundCount(space.roundCount ?? 1);
    if (space.scheduleType) setScheduleType(space.scheduleType as StartSpaceBodyScheduleType);
    setIntervalVal(space.defaultCenterInterval ?? 7);
    if (space.weekdays && (space.weekdays as number[]).length > 0) {
      setWeekdays(space.weekdays as number[]);
    }
    setCenterCount(space.defaultCenterCount ?? 1);
    if ((space as any).plannedStartsAt) {
      const d = toKstCalendarDate(new Date((space as any).plannedStartsAt));
      if (!isNaN(d.getTime())) setStartDate(d);
    }
  }, [space]);

  // ── Section 2: 회차 구성 ─────────────────────────────────────────────────
  // 공간 생성 시 회차 수만큼 SpaceRound가 이미 만들어져 있고(운영자가 회차
  // 관리 화면에서 제목/설명을 미리 채워뒀을 수 있음), 이 화면에 진입했을 때
  // 그 초안을 "회차 구성 초안"으로 사용한다.
  const roundsQuery = useListSpaceRounds(id, {
    query: { enabled: !!id, queryKey: getListSpaceRoundsQueryKey(id) },
  });
  const existingRounds = useMemo(
    () => [...((roundsQuery.data ?? []) as SpaceRound[])].sort((a, b) => a.roundNumber - b.roundNumber),
    [roundsQuery.data],
  );

  const [roundConfigs, setRoundConfigs] = useState<Array<{ title: string; description: string }>>([]);

  useEffect(() => {
    setRoundConfigs((prev) =>
      Array.from({ length: roundCount }, (_, i) => {
        if (prev[i] && (prev[i].title || prev[i].description)) return prev[i];
        const draft = existingRounds[i];
        return {
          title: draft?.title ?? prev[i]?.title ?? "",
          description: draft?.description ?? prev[i]?.description ?? "",
        };
      }),
    );
  }, [roundCount, existingRounds]);

  // ── Section 3: 중심글 순서 배정 ──────────────────────────────────────────

  const [slotOrder, setSlotOrder] = useState<string[]>([]);

  useEffect(() => {
    setSlotOrder((prev) => {
      const opParticipates = space?.operatorParticipates ?? true;
      const eligible = opParticipates
        ? confirmedMembers.map((m) => m.userId)
        : confirmedMembers.filter((m) => m.role !== "OPERATOR").map((m) => m.userId);
      const kept = prev.filter((uid) => eligible.includes(uid));
      const added = eligible.filter((uid) => !kept.includes(uid));
      const next = [...kept, ...added];
      if (next.length === prev.length && next.every((uid, i) => uid === prev[i])) return prev;
      return next;
    });
  }, [confirmedMembers, space?.operatorParticipates]);

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
          nickname: space?.isAnonymous
            ? (m?.spaceNickname ?? "참여자")
            : (m?.nickname ?? uid.slice(0, 8)),
          isOperator: m?.role === "OPERATOR",
          isMine: uid === userId,
        };
      }),
    [slotOrder, memberById],
  );

  const handleReorder = useCallback((newOrder: string[]) => {
    setSlotOrder(newOrder);
  }, []);

  // ── Start logic ───────────────────────────────────────────────────────────

  // Mirror the server's check: at least one APPROVED non-operator participant
  // must exist before the space can be started. Counting only slotOrder.length
  // was incorrect because slotOrder includes the operator when
  // operatorParticipates=true, making the check pass even when the operator
  // is the sole approved member.
  const hasEnoughParticipants = confirmedMembers.some((m) => m.role !== "OPERATOR");
  const recruitParticipantCount = useMemo(
    () => countRecruitmentParticipants(confirmedMembers),
    [confirmedMembers],
  );
  const hasValidSchedule =
    scheduleType === "N_DAY" || (scheduleType === "WEEKDAY" && weekdays.length > 0);
  const canStart = openingLetterExists && hasEnoughParticipants && hasValidSchedule;

  const [showAutoRejectModal, setShowAutoRejectModal] = useState(false);
  const [showUnderCapacityModal, setShowUnderCapacityModal] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const doStart = useCallback(async () => {
    setShowUnderCapacityModal(false);
    setIsStarting(true);
    try {
      // roundConfigs is always pre-populated from the existing round draft
      // (see the effect above) and only further edited when the user opts
      // into "회차 구성 변경" — so it already reflects "draft as-is" in the
      // keep-draft path and the user's edits in the custom-edit path. No
      // branching on roundConfigMode is needed here.
      const rounds = Array.from({ length: roundCount }, (_, i) => {
        const rc = roundConfigs[i];
        return {
          title: rc?.title?.trim() || undefined,
          description: rc?.description?.trim() || undefined,
          slots: slotOrder,
        };
      });

      await startSpace.mutateAsync({
        id,
        data: {
          roundCount,
          plannedStartsAt: formatCalendarDateKey(startDate),
          scheduleType,
          interval: scheduleType === "N_DAY" ? interval : undefined,
          weekdays: scheduleType === "WEEKDAY" ? weekdays : undefined,
          defaultCenterCount: centerCount,
          rounds,
          operatorParticipates: space?.operatorParticipates ?? true,
        },
      });

      queryClient.invalidateQueries({ queryKey: getUserScopedSpaceJoinContextQueryKey(id, userId) });
      showToast({ message: "공간이 시작되었습니다", type: "success" });
      router.back();
    } catch (err: unknown) {
      // AbortError is thrown when the 15-second customFetch timeout fires.
      // TimeoutError is the reason name set by AbortSignal.timeout().
      const isTimeout =
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError");
      // Extract the server's Korean error string from ApiError.data when
      // present, so the Alert shows e.g. "확정된 참여자가 없습니다." rather
      // than the raw "HTTP 400 Bad Request: …" prefix.
      const serverMsg: string | null =
        err != null && typeof err === "object" && "data" in err
          ? (() => {
              const d = (err as { data: unknown }).data;
              return d != null &&
                typeof d === "object" &&
                "error" in d &&
                typeof (d as Record<string, unknown>).error === "string"
                ? ((d as Record<string, unknown>).error as string)
                : null;
            })()
          : null;
      const msg = isTimeout
        ? "시간이 초과됐어요. 다시 시도해주세요."
        : serverMsg ??
          (err instanceof Error ? err.message : "공간 시작에 실패했어요. 다시 시도해주세요.");
      // web 프리뷰는 cross-origin iframe이라 window.alert()가 차단됨 → showToast 사용
      if (Platform.OS === "web") {
        showToast({ message: msg, type: "error", duration: 5000, position: "top" });
      } else {
        Alert.alert("오류", msg);
      }
    } finally {
      setIsStarting(false);
    }
  }, [
    roundConfigs, slotOrder, roundCount, scheduleType, interval, weekdays,
    centerCount, startDate, space, startSpace, id, queryClient, userId, router, showToast,
  ]);

  const handleAutoRejectContinue = useCallback(() => {
    setShowAutoRejectModal(false);
    if (
      space?.maxParticipants != null &&
      recruitParticipantCount < space.maxParticipants
    ) {
      setShowUnderCapacityModal(true);
    } else {
      doStart();
    }
  }, [space, recruitParticipantCount, doStart]);

  const handleStartPress = useCallback(() => {
    if (!openingLetterExists) {
      if (Platform.OS === "web") {
        showToast({ message: "여는 편지를 먼저 작성해주세요.", type: "error", duration: 5000, position: "top" });
      } else {
        Alert.alert("여는 편지 필요", "여는 편지를 먼저 작성해주세요.");
      }
      return;
    }
    if (!hasEnoughParticipants) {
      if (Platform.OS === "web") {
        showToast({ message: "확정 참여자가 1명 이상 있어야 해요.", type: "error", duration: 5000, position: "top" });
      } else {
        Alert.alert("참여자 필요", "확정 참여자가 1명 이상 있어야 해요.");
      }
      return;
    }
    if (scheduleType === "WEEKDAY" && weekdays.length === 0) {
      if (Platform.OS === "web") {
        showToast({ message: "요일을 하나 이상 선택해주세요.", type: "error", duration: 5000, position: "top" });
      } else {
        Alert.alert("알림", "요일을 하나 이상 선택해주세요.");
      }
      return;
    }
    if (hasPendingRequests) {
      setShowAutoRejectModal(true);
    } else {
      if (
        space?.maxParticipants != null &&
        recruitParticipantCount < space.maxParticipants
      ) {
        setShowUnderCapacityModal(true);
      } else {
        doStart();
      }
    }
  }, [
    openingLetterExists, hasEnoughParticipants, scheduleType, weekdays,
    hasPendingRequests, space, recruitParticipantCount, doStart, showToast,
  ]);

  // ── Step navigation logic ─────────────────────────────────────────────────

  // 시작 예정일이 오늘보다 이르면 다음 단계로 진행 불가
  const isStartDatePast = useMemo(() => startOfDay(startDate) < getMinSpaceStartDate(), [startDate]);
  const openingScheduleIsValid = useMemo(() => {
    if (!openingScheduledSend) return false;
    const scheduledDate = toKstCalendarDate(new Date(openingScheduledSend.scheduledAt));
    return scheduledDate >= minOpeningSendDate() && scheduledDate <= getOpeningLetterDeadline(startDate);
  }, [openingScheduledSend, startDate]);

  const canProceed = useMemo(() => {
    if (step === 0) return hasValidSchedule && !isStartDatePast;
    if (step === 1) return true; // only reached in custom-edit mode; fields are optional
    if (step === 2 && slotSubStep === 0) return slotItems.length >= 1;
    if (step === 2 && slotSubStep === 1) return true;
    if (step === 3) return openingLetterExists && openingScheduleIsValid;
    if (step === 4) return canStart;
    return true;
  }, [step, slotSubStep, hasValidSchedule, isStartDatePast, slotItems, canStart, openingLetterExists, openingScheduleIsValid]);

  // Entering the 회차 구성 step always asks whether to change the draft that
  // already exists (created with the space / edited from the rounds screen)
  // before showing any editing UI. Answering "아니오" adopts the draft as-is
  // and skips straight to the next step.
  const handleRoundConfigKeepDraft = useCallback(() => {
    setShowRoundConfigConfirm(false);
    setRoundConfigMode("default");
    setRoundConfigConfirmed(true);
    setSlotSubStep(0);
    setStep(2);
  }, []);

  const handleRoundConfigWantChange = useCallback(() => {
    setShowRoundConfigConfirm(false);
    setRoundConfigMode("custom");
    setRoundConfigConfirmed(true);
    setCurrentRoundIdx(0);
    setStep(1);
  }, []);

  const handleNext = useCallback(() => {
    if (step === 0) {
      setCurrentRoundIdx(0);
      setShowRoundConfigConfirm(true);
    } else if (step === 1) {
      if (currentRoundIdx < roundCount - 1) {
        setCurrentRoundIdx((i) => i + 1);
      } else {
        setSlotSubStep(0);
        setStep(2);
      }
    } else if (step === 2) {
      if (slotSubStep === 0) {
        setSlotSubStep(1);
      } else {
        setStep(3);
      }
    } else if (step === 3) {
      setStep(4);
    } else if (step === 4) {
      handleStartPress();
    }
  }, [step, currentRoundIdx, roundCount, slotSubStep, handleStartPress]);

  const handleBack = useCallback(() => {
    if (step === 0) {
      router.back();
    } else if (step === 1) {
      // Step 1 is only ever shown in "custom" mode (the draft-keep path skips
      // straight to step 2), so stepping back out of round 0 returns to step 0
      // and resets the gate so it's asked again if they advance a second time.
      if (currentRoundIdx > 0) {
        setCurrentRoundIdx((i) => i - 1);
      } else {
        setRoundConfigMode(null);
        setRoundConfigConfirmed(false);
        setStep(0);
      }
    } else if (step === 2) {
      if (slotSubStep === 1) {
        setSlotSubStep(0);
      } else if (roundConfigMode === "custom") {
        setCurrentRoundIdx(roundCount - 1);
        setStep(1);
      } else {
        // "default" (draft kept as-is): step 1 was skipped entirely.
        setRoundConfigMode(null);
        setRoundConfigConfirmed(false);
        setStep(0);
      }
    } else if (step === 3) {
      setSlotSubStep(1);
      setStep(2);
    } else if (step === 4) {
      setStep(3);
    }
  }, [step, currentRoundIdx, roundCount, slotSubStep, roundConfigMode, router]);

  const goToStep = useCallback((targetStep: number) => {
    if (targetStep === 2) {
      setSlotSubStep(0);
    }
    setStep(targetStep);
  }, []);

  // Reset scroll position to the top whenever the visible step (or sub-step)
  // changes, so a new step never appears mid-scroll from wherever the
  // previous step's content happened to leave off.
  useEffect(() => {
    scrollViewRef.current?.scrollTo({ y: 0, animated: false });
  }, [step, currentRoundIdx, slotSubStep]);

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

  // ── Step content ──────────────────────────────────────────────────────────

  const renderStepContent = () => {
    if (step === 0) {
      return (
        <OperationSettingsStep
          roundCount={roundCount}
          setRoundCount={setRoundCount}
          scheduleType={scheduleType}
          setScheduleType={setScheduleType}
          interval={interval}
          setIntervalVal={setIntervalVal}
          weekdays={weekdays}
          setWeekdays={setWeekdays}
          centerCount={centerCount}
          setCenterCount={setCenterCount}
          operatorParticipates={space.operatorParticipates ?? true}
          confirmedCount={recruitParticipantCount}
          maxParticipants={space.maxParticipants}
          startDate={startDate}
          setStartDate={setStartDate}
        />
      );
    }
    if (step === 1) {
      // Only ever reached after the user answers "변경할게요" to the
      // round-config confirm gate — the draft-keep path skips straight to
      // step 2, so no mode-selection screen is needed here.
      const config = roundConfigs[currentRoundIdx] ?? { title: "", description: "" };
      return (
        <RoundConfigStep
          roundIdx={currentRoundIdx}
          roundCount={roundCount}
          config={config}
          onChange={(title, description) =>
            setRoundConfigs((prev) =>
              prev.map((c, idx) => (idx === currentRoundIdx ? { title, description } : c)),
            )
          }
        />
      );
    }
    if (step === 2 && slotSubStep === 0) {
      return (
        <SlotOrderStep
          items={slotItems}
          onReorder={handleReorder}
          onScrollLock={setScrollEnabled}
        />
      );
    }
    if (step === 2 && slotSubStep === 1) {
      return (
        <ScheduleCalendarStep
          items={slotItems}
          roundCount={roundCount}
          scheduleType={scheduleType}
          interval={interval}
          weekdays={weekdays}
          roundConfigs={roundConfigs}
          centerCount={centerCount}
          startDate={startDate}
          participantCount={confirmedMembers.length}
        />
      );
    }
    if (step === 3) {
      return (
        <OpeningLetterStep
          isLoading={lettersQuery.isLoading}
          isArticlesLoading={articlesQuery.isLoading}
          isArticlesError={articlesQuery.isError}
          onRefetchArticles={() => articlesQuery.refetch()}
          openingLetterExists={openingLetterExists}
          openingScheduledSend={openingScheduledSend}
          startDate={startDate}
          articles={articles}
          letters={letters}
          spaceId={id}
          userId={userId ?? ""}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: getListSpaceLettersQueryKey(id) });
            queryClient.invalidateQueries({ queryKey: getListAllSpaceScheduledSendsQueryKey(id) });
          }}
        />
      );
    }
    if (step === 4) {
      return (
        <StartConfirmStep
          roundCount={roundCount}
          scheduleType={scheduleType}
          interval={interval}
          weekdays={weekdays}
          centerCount={centerCount}
          startDate={startDate}
          operatorParticipates={space.operatorParticipates ?? true}
          slotItems={slotItems}
          openingLetterExists={openingLetterExists}
          openingScheduledSend={openingScheduledSend}
          hasPendingRequests={hasPendingRequests}
          pendingCount={pendingRequests.length}
          onGoToStep={goToStep}
          participantCount={recruitParticipantCount}
          hasEnoughParticipants={hasEnoughParticipants}
        />
      );
    }
    return null;
  };

  // Display step index for progress bar (step 2 sub-steps both count as step 2)
  const displayStep = step;
  const isLastStep = step === 4;

  // Step label suffix
  let stepLabelSuffix = STEPS[step];
  if (step === 1) stepLabelSuffix = `회차 구성 (${currentRoundIdx + 1}/${roundCount})`;
  if (step === 2 && slotSubStep === 1) stepLabelSuffix = "일정 확인";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <HeaderButton
            variant="back"
            onPress={handleBack}
            accessibilityLabel="공간 시작하기에서 돌아가기"
          />
          <Text style={styles.headerTitle}>공간 시작하기</Text>
          <View style={styles.headerRight} />
        </View>

        {/* Progress bar */}
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${((displayStep + 1) / TOTAL_STEPS) * 100}%` },
            ]}
          />
        </View>

        {/* Content */}
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEnabled={scrollEnabled}
        >
          {renderStepContent()}
        </ScrollView>

        {/* Footer */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <SubmitButton
            style={[styles.nextBtn, !canProceed && styles.nextBtnDisabled]}
            disabledStyle={styles.nextBtnDisabled}
            textStyle={styles.nextBtnText}
            onPress={handleNext}
            pending={isLastStep && isStarting}
            disabled={!canProceed || (isLastStep && isStarting)}
            label={isLastStep ? "공간 시작하기" : "다음"}
            pendingLabel="시작하는 중..."
          />
        </View>
      </View>

      {/* 회차 구성 변경 여부 확인 모달 */}
      <ConfirmModal
        visible={showRoundConfigConfirm}
        title="회차 구성"
        message="공간을 만들 때 작성해 둔 회차 구성 초안이 있어요. 회차 구성을 변경하시겠습니까? 변경하지 않으면 초안 그대로 다음 단계로 진행돼요."
        cancelLabel="아니오"
        confirmLabel="변경할게요"
        onCancel={handleRoundConfigKeepDraft}
        onConfirm={handleRoundConfigWantChange}
      />

      {/* 자동 거절 안내 모달 */}
      <ConfirmModal
        visible={showAutoRejectModal}
        title="코드 신청자 자동 거절"
        message={`승인 대기 중인 신청자 ${pendingRequests.length}명이 자동으로 거절 처리돼요. 계속 진행할까요?`}
        confirmLabel="계속하기"
        onCancel={() => setShowAutoRejectModal(false)}
        onConfirm={handleAutoRejectContinue}
      />

      {/* 인원 미달 확인 모달 */}
      <ConfirmModal
        visible={showUnderCapacityModal}
        title="인원 미달"
        message={`모집 인원(${space.maxParticipants ?? 0}명)보다 적은 ${recruitParticipantCount}명으로 시작할까요?`}
        confirmLabel={`${recruitParticipantCount}명으로 시작`}
        onCancel={() => setShowUnderCapacityModal(false)}
        onConfirm={doStart}
        loading={isStarting}
      />

      <SubmitProgressOverlay
        visible={isStarting}
        message="공간을 시작하는 중이에요"
        subMessage="잠시만 기다려주세요"
      />

    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.white,
  },
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
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    paddingBottom: 8,
    justifyContent: "space-between",
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  headerRight: {
    width: 44,
  },
  progressBar: {
    height: 3,
    backgroundColor: Colors.zinc100,
    marginHorizontal: Spacing.screenPx,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: Colors.zinc900,
    borderRadius: 2,
  },
  stepLabel: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 10,
    paddingBottom: 4,
  },
  stepLabelText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 24,
  },
  footer: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.zinc100,
    backgroundColor: Colors.white,
  },
  nextBtn: {
    backgroundColor: Colors.zinc900,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  nextBtnDisabled: {
    backgroundColor: Colors.zinc200,
  },
  nextBtnText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
  // Start blockers — reasons shown above the disabled "공간 시작하기" button
  startBlockers: {
    gap: 6,
    paddingBottom: 10,
  },
  startBlockerRow: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 6,
  },
  startBlockerText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.noticeAccent,
    flex: 1,
    lineHeight: 18,
  },
  // Slot list
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
    color: Colors.zinc500,
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
    fontSize: 12,
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
    color: Colors.zinc500,
  },
  // Misc
  weekdayRow: {
    flexDirection: "row",
    gap: 4,
    marginTop: 8,
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
    minWidth: 42,
    textAlign: "center",
  },
  // Modals
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
    height: 48,
  },
  modalCancelBtnContent: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.zinc200,
  },
  modalCancelText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc600,
  },
  modalConfirmBtn: {
    flex: 1,
    height: 48,
  },
  modalConfirmBtnContent: {
    borderRadius: 10,
    backgroundColor: Colors.zinc900,
  },
  modalConfirmText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
  // Fixed height on both the outer (flexed) wrapper above and this content
  // layer avoids ScalePressable's inner Animated.View (flexGrow:1,
  // alignSelf:"stretch") collapsing/misrendering the button — see
  // .agents/skills/friction-button-styles/SKILL.md pitfall #1.
  modalBtnContent: {
    height: "100%",
    width: "100%",
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  btnOpacity: {
    opacity: 0.6,
  },
  // Error/back
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
});

const stepStyles = StyleSheet.create({
  container: {
    gap: 24,
    paddingTop: 8,
  },
  stepTitle: {
    ...Typography.bodySemiBold,
    fontSize: 22,
    color: Colors.zinc900,
  },
  stepDesc: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc500,
    lineHeight: 22,
    marginTop: -16,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc700,
  },
  input: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc900,
    backgroundColor: Colors.zinc50,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.zinc100,
  },
  inputMulti: {
    minHeight: 96,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  charCount: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    textAlign: "right",
  },
  hint: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400, // typography-ok: form hint text
    lineHeight: 17,
  },
  warningText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.noticeAccent,
    marginTop: 4,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  optionList: {
    gap: 8,
    marginTop: 4,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.zinc50,
  },
  optionSelected: {
    borderColor: Colors.zinc700,
    backgroundColor: Colors.white,
  },
  optionRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: Colors.zinc400,
    alignItems: "center",
    justifyContent: "center",
  },
  optionRadioActive: {
    borderColor: Colors.zinc900,
  },
  optionRadioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.zinc900,
  },
  optionLabel: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc800,
  },
  subField: {
    marginTop: 8,
    paddingLeft: 4,
    gap: 4,
  },
  subFieldLabel: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  readonlyBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: Colors.zinc50,
    borderWidth: 1,
    borderColor: Colors.zinc100,
  },
  readonlyText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc600,
    flex: 1,
  },
  readonlyHint: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400, // typography-ok: read-only field hint
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
});


const opStyles = StyleSheet.create({
  participantRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: Colors.zinc50,
    borderWidth: 1,
    borderColor: Colors.zinc100,
  },
  participantText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc600,
    flex: 1,
    flexWrap: "wrap",
  },
  participantEmphasis: {
    // 부모 텍스트의 fontSize를 그대로 상속 — 색/굵기만으로 강조
    fontFamily: Typography.bodySemiBold.fontFamily,
    fontWeight: "600",
    color: Colors.zinc800,
  },
  participantHint: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc400, // typography-ok: participant count hint
  },
  datePastTrigger: {
    borderColor: "#ef4444",
    borderWidth: 1.5,
  },
  datePastWarning: {
    ...Typography.caption,
    fontSize: 12,
    color: "#ef4444",
    marginTop: 2,
  },
  endDateBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: Colors.zinc50,
    borderWidth: 1,
    borderColor: Colors.zinc100,
  },
  endDateText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc800,
  },
  endDateHint: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400, // typography-ok: end-date hint
    flex: 1,
    textAlign: "right",
  },
});

const olStyles = StyleSheet.create({
  writeNewBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  writeNewBtnText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  articleSelectBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.zinc50,
  },
  articleSelectBtnText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc400, // typography-ok: unselected article placeholder
    flex: 1,
  },
  articleSelectBtnTextActive: {
    color: Colors.zinc800,
    fontWeight: "600",
  },
  sendDateSection: {
    gap: 8,
    paddingTop: 4,
  },
  sendDateLabel: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    fontWeight: "600",
  },
  sendDateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.zinc50,
  },
  sendDateBtnText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc700,
    flex: 1,
  },
  saveBtn: {
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
  savedCard: {
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.zinc50,
  },
  savedCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  savedCardTitle: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc800,
  },
  savedCardArticle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc700,
  },
  savedCardDate: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  reSelectBtn: {
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    alignItems: "center",
  },
  reSelectBtnText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc600,
  },
  selectButton: {
    backgroundColor: Colors.zinc50,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
  },
  selectButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  selectButtonText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    flex: 1,
  },
  selectButtonTextActive: {
    color: Colors.zinc900,
    fontWeight: "600",
  },
  deadlineInfo: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: Colors.zinc50,
    borderWidth: 1,
    borderColor: Colors.zinc100,
  },
  deadlineInfoText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    flex: 1,
    lineHeight: 17,
  },
  deadlineEmphasis: {
    // 부모 텍스트의 fontSize를 그대로 상속 — 색/굵기만으로 강조
    fontFamily: Typography.bodySemiBold.fontFamily,
    fontWeight: "600",
    color: Colors.zinc700,
  },
  lateWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fde68a",
  },
  lateWarningText: {
    ...Typography.caption,
    fontSize: 12,
    color: "#92400e",
    flex: 1,
    lineHeight: 17,
  },
});

const calGridStyles = StyleSheet.create({
  dateRange: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.zinc100,
    backgroundColor: Colors.zinc50,
    gap: 0,
  },
  dateRangeItem: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  dateRangeLabel: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  dateRangeValue: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc800,
  },
  dateRangeDivider: {
    width: 1,
    height: 32,
    backgroundColor: Colors.zinc200,
    marginHorizontal: 4,
  },
  cellSize: {
    minHeight: 52,
    paddingHorizontal: 2,
    gap: 2,
  },
  cellMarked: {
    backgroundColor: Colors.zinc50,
  },
  dayNum: {
    ...Typography.body,
    fontSize: 12,
    color: Colors.zinc700,
    lineHeight: 16,
  },
  dayNumMarked: {
    ...Typography.bodySemiBold,
    color: Colors.zinc900,
  },
  sunDay: {
    color: "#ef4444",
  },
  bubbleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 1,
  },
  assignBubble: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.zinc800,
    alignItems: "center",
    justifyContent: "center",
  },
  assignInitial: {
    ...Typography.bodySemiBold,
    fontSize: 9, // typography-ok: initial letter in 18x18 avatar chip, space-constrained
    color: Colors.white,
  },
  assignMore: {
    ...Typography.caption,
    fontSize: 9, // typography-ok: overflow count in 18x18 avatar chip, space-constrained
    color: Colors.zinc400, // typography-ok: overflow count in 18x18 avatar chip
  },
});

const confirmStyles = StyleSheet.create({
  block: {
    gap: 8,
  },
  blockHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  blockTitle: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.zinc500,
  },
  editBtn: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.zinc500,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  summaryRows: {
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.zinc50,
    borderWidth: 1,
    borderColor: Colors.zinc100,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  summaryKey: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
    width: 72,
  },
  summaryVal: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc800,
    flex: 1,
  },
  summaryProse: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc700,
    lineHeight: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.zinc50,
    borderWidth: 1,
    borderColor: Colors.zinc100,
  },
  summaryWarning: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.noticeAccent,
  },
  noticeBlock: {
    gap: 8,
    paddingTop: 4,
  },
});
