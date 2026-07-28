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
import DateTimePicker from "@react-native-community/datetimepicker";
import { ArticleScheduleSheet } from "@/components/ArticleScheduleSheet/ArticleScheduleSheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";
import SubmitButton from "@/components/SubmitButton/SubmitButton";
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
  useListArticles,
  getListArticlesQueryKey,
  useListAllSpaceScheduledSends,
  getListAllSpaceScheduledSendsQueryKey,
} from "@workspace/api-client-react";
import type {
  SpaceMember,
  SpaceWithCreatorInfo,
  StartSpaceBodyScheduleType,
  Article,
  SpaceLetter,
  SpaceScheduledSendWithLetter,
} from "@workspace/api-client-react";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const SLOT_ROW_H = 52;
const SLOT_ROW_GAP = 6;
const SLOT_ITEM_H = SLOT_ROW_H + SLOT_ROW_GAP;

const STEPS = ["운영 설정 확정", "회차 구성", "중심글 순서 배정", "첫 여는 편지 보내기", "시작 확인"];
const TOTAL_STEPS = STEPS.length;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calculate the projected end date (last center article date) for display.
 * N_DAY: startDate + (roundCount − 1) × interval × centerCount days
 * WEEKDAY: the (roundCount × centerCount)-th occurrence of selected weekdays
 */
function calculateProjectedEndDate(
  startDate: Date,
  scheduleType: "N_DAY" | "WEEKDAY",
  intervalDays: number,
  weekdays: number[],
  roundCount: number,
  centerCount: number,
): Date | null {
  if (scheduleType === "N_DAY") {
    const result = new Date(startDate);
    result.setDate(result.getDate() + (roundCount - 1) * intervalDays * centerCount);
    return result;
  }
  if (scheduleType === "WEEKDAY" && weekdays.length > 0) {
    const sorted = [...weekdays].sort((a, b) => a - b);
    const total = roundCount * centerCount;
    const cursor = new Date(startDate);
    cursor.setHours(0, 0, 0, 0);
    let found = 0;
    for (let attempt = 0; attempt < 3650; attempt++) {
      if (sorted.includes(cursor.getDay())) {
        found++;
        if (found === total) return new Date(cursor);
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

/** Returns the deadline for sending an opening letter: the day before startDate at 06:00 */
function getOpeningLetterDeadline(startDate: Date): Date {
  const d = new Date(startDate);
  d.setDate(d.getDate() - 1);
  d.setHours(6, 0, 0, 0);
  return d;
}

function buildMonthGrid(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
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
                {item.nickname}
              </Text>
              {item.isOperator && (
                <View style={styles.slotRoleTag}>
                  <Text style={styles.slotRoleTagText}>운영자</Text>
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
  const [showDatePicker, setShowDatePicker] = useState(false);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDay = new Date(startDate);
  startDay.setHours(0, 0, 0, 0);
  const isStartDatePast = startDay < today;

  const endDate = useMemo(
    () => calculateProjectedEndDate(startDate, scheduleType as "N_DAY" | "WEEKDAY", interval, weekdays, roundCount, centerCount),
    [startDate, scheduleType, interval, weekdays, roundCount, centerCount],
  );

  const effectiveRecruitCount =
    maxParticipants != null
      ? (operatorParticipates ? maxParticipants - 1 : maxParticipants)
      : null;

  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>운영 설정 확정</Text>
      <Text style={stepStyles.stepDesc}>공간 생성 시 입력한 설정을 최종 확인하고 조정해요.</Text>

      {/* 참여 인원 요약 */}
      <View style={opStyles.participantRow}>
        <Feather name="users" size={14} color={Colors.zinc500} />
        <Text style={opStyles.participantText}>
          {"확정 "}
          <Text style={opStyles.participantEmphasis}>{confirmedCount}명</Text>
          {effectiveRecruitCount != null && (
            <>
              {" / 모집 인원 "}
              <Text style={opStyles.participantEmphasis}>{maxParticipants}명</Text>
              {operatorParticipates && (
                <Text style={opStyles.participantHint}>{` (운영자 참여로 실제 모집 ${effectiveRecruitCount}명)`}</Text>
              )}
            </>
          )}
        </Text>
      </View>

      <View style={stepStyles.fieldGroup}>
        <Text style={stepStyles.fieldLabel}>회차 수</Text>
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
        <Text style={stepStyles.fieldLabel}>진행 방식</Text>
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
        <Text style={stepStyles.fieldLabel}>회차당 중심글 수</Text>
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
      </View>

      <View style={stepStyles.fieldGroup}>
        <Text style={stepStyles.fieldLabel}>운영자 참여</Text>
        <View style={[stepStyles.readonlyBox]}>
          <Feather
            name={operatorParticipates ? "check-circle" : "circle"}
            size={16}
            color={operatorParticipates ? Colors.zinc700 : Colors.zinc400}
          />
          <Text style={stepStyles.readonlyText}>
            {operatorParticipates ? "운영자가 회차에 직접 참여해요" : "운영자는 회차에 참여하지 않아요"}
          </Text>
          <Text style={stepStyles.readonlyHint}>(수정 불가)</Text>
        </View>
      </View>

      {/* 시작 날짜 선택 */}
      <View style={stepStyles.fieldGroup}>
        <Text style={stepStyles.fieldLabel}>시작 예정일</Text>
        {Platform.OS === "ios" ? (
          <View style={[opStyles.datePickerWrapper, isStartDatePast && opStyles.datePickerWrapperError]}>
            <DateTimePicker
              value={startDate}
              mode="date"
              display="spinner"
              onChange={(_event, date) => {
                if (date) setStartDate(date);
              }}
              locale="ko-KR"
              style={opStyles.datePicker}
            />
          </View>
        ) : (
          <>
            <ScalePressable
              contentStyle={[opStyles.dateBtn, isStartDatePast && opStyles.dateBtnError]}
              onPress={() => setShowDatePicker(true)}
            >
              <Feather name="calendar" size={15} color={isStartDatePast ? "#ef4444" : Colors.zinc600} />
              <Text style={[opStyles.dateBtnText, isStartDatePast && opStyles.dateBtnTextError]}>
                {formatDate(startDate)}
              </Text>
            </ScalePressable>
            {showDatePicker && (
              <DateTimePicker
                value={startDate}
                mode="date"
                display="default"
                onChange={(_event, date) => {
                  setShowDatePicker(false);
                  if (date) setStartDate(date);
                }}
              />
            )}
          </>
        )}
        {isStartDatePast && (
          <Text style={opStyles.datePastWarning}>선택한 날짜가 오늘보다 이전이에요.</Text>
        )}
      </View>

      {/* 종료 예정일 */}
      <View style={stepStyles.fieldGroup}>
        <Text style={stepStyles.fieldLabel}>종료 예정일 (자동 계산)</Text>
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
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={stepStyles.container}>
        <Text style={stepStyles.stepTitle}>{roundIdx + 1}회차 구성</Text>
        <Text style={stepStyles.stepDesc}>
          {roundCount}회차 중 {roundIdx + 1}번째 회차의 제목과 설명을 입력해요. (선택)
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
    </TouchableWithoutFeedback>
  );
}

function RoundConfigModeStep({
  onSelectDefault,
  onSelectCustom,
}: {
  onSelectDefault: () => void;
  onSelectCustom: () => void;
}) {
  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>회차 구성</Text>
      <Text style={stepStyles.stepDesc}>각 회차의 제목과 설명을 어떻게 설정할까요?</Text>

      <View style={{ gap: 12, marginTop: 8 }}>
        <ScalePressable contentStyle={modeStyles.option} onPress={onSelectDefault}>
          <View style={modeStyles.optionInner}>
            <View style={modeStyles.optionIconWrap}>
              <Feather name="zap" size={20} color={Colors.zinc700} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={modeStyles.optionTitle}>기본으로 사용</Text>
              <Text style={modeStyles.optionDesc}>회차 번호만 사용하고, 바로 다음 단계로 넘어가요.</Text>
            </View>
            <Feather name="chevron-right" size={18} color={Colors.zinc400} />
          </View>
        </ScalePressable>

        <ScalePressable contentStyle={modeStyles.option} onPress={onSelectCustom}>
          <View style={modeStyles.optionInner}>
            <View style={modeStyles.optionIconWrap}>
              <Feather name="edit-3" size={20} color={Colors.zinc700} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={modeStyles.optionTitle}>직접 설정</Text>
              <Text style={modeStyles.optionDesc}>각 회차마다 제목과 설명을 직접 입력해요.</Text>
            </View>
            <Feather name="chevron-right" size={18} color={Colors.zinc400} />
          </View>
        </ScalePressable>
      </View>
    </View>
  );
}

const modeStyles = StyleSheet.create({
  option: {
    borderWidth: 1,
    borderColor: Colors.zinc200,
    borderRadius: 12,
    backgroundColor: Colors.white,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  optionInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  optionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  optionTitle: {
    ...Typography.body,
    fontWeight: "600",
    color: Colors.zinc800,
    marginBottom: 2,
  },
  optionDesc: {
    ...Typography.caption,
    color: Colors.zinc500,
    lineHeight: 18,
  },
});

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
      <Text style={stepStyles.stepTitle}>중심글 작성 순서</Text>
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
}: {
  items: SlotRowInfo[];
  roundCount: number;
  scheduleType: StartSpaceBodyScheduleType;
  interval: number;
  weekdays: number[];
  roundConfigs: Array<{ title: string; description: string }>;
  centerCount: number;
  startDate: Date;
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
      ),
    [startDate, scheduleType, interval, weekdays, roundCount, centerCount],
  );

  const startMonthYear = { year: startDate.getFullYear(), month: startDate.getMonth() };
  const endMonthYear = endDate
    ? { year: endDate.getFullYear(), month: endDate.getMonth() }
    : startMonthYear;

  const [viewYear, setViewYear] = useState(startMonthYear.year);
  const [viewMonth, setViewMonth] = useState(startMonthYear.month);

  const dates = useMemo(
    () => calculateScheduleDates(scheduleType, interval, weekdays, roundCount, startDate),
    [scheduleType, interval, weekdays, roundCount, startDate],
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

  const cells = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

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

      {/* 달력 */}
      <View style={calGridStyles.calCard}>
        {/* 월 이동 헤더 */}
        <View style={calGridStyles.monthNav}>
          <ScalePressable
            contentStyle={[calGridStyles.monthNavBtn, !canGoPrev && calGridStyles.monthNavBtnDisabled]}
            onPress={handlePrevMonth}
            disabled={!canGoPrev}
          >
            <Feather name="chevron-left" size={18} color={canGoPrev ? Colors.zinc700 : Colors.zinc300} />
          </ScalePressable>
          <Text style={calGridStyles.monthNavTitle}>
            {viewYear}년 {viewMonth + 1}월
          </Text>
          <ScalePressable
            contentStyle={[calGridStyles.monthNavBtn, !canGoNext && calGridStyles.monthNavBtnDisabled]}
            onPress={handleNextMonth}
            disabled={!canGoNext}
          >
            <Feather name="chevron-right" size={18} color={canGoNext ? Colors.zinc700 : Colors.zinc300} />
          </ScalePressable>
        </View>

        {/* 요일 헤더 */}
        <View style={calGridStyles.weekRow}>
          {WEEKDAY_LABELS.map((label, i) => (
            <Text key={i} style={[calGridStyles.weekLabel, i === 0 && calGridStyles.sunLabel]}>
              {label}
            </Text>
          ))}
        </View>

        {/* 날짜 그리드 */}
        <View style={calGridStyles.grid}>
          {cells.map((date, idx) => {
            if (!date) {
              return <View key={`empty-${idx}`} style={calGridStyles.cell} />;
            }
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
            const assignments = assignmentMap[key] ?? [];
            const isSun = date.getDay() === 0;
            const hasMark = assignments.length > 0;
            return (
              <View key={key} style={[calGridStyles.cell, hasMark && calGridStyles.cellMarked]}>
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
              </View>
            );
          })}
        </View>
      </View>

      <Text style={stepStyles.hint}>
        * 순서는 참여자 수 기준으로 순환 배정돼요. 실제 슬롯은 공간 시작 후 회차마다 동일 순서가 적용돼요.
      </Text>
    </View>
  );
}

function OpeningLetterStep({
  isLoading,
  openingLetterExists,
  openingScheduledSend,
  startDate,
  onOpenSheet,
}: {
  isLoading: boolean;
  openingLetterExists: boolean;
  openingScheduledSend: { scheduledAt: string; articleTitle?: string | null } | null;
  startDate: Date;
  onOpenSheet: () => void;
}) {
  const articleTitle = openingScheduledSend?.articleTitle ?? null;
  const scheduledDate = openingScheduledSend ? new Date(openingScheduledSend.scheduledAt) : null;
  const deadline = getOpeningLetterDeadline(startDate);
  const isLate = scheduledDate != null && scheduledDate > deadline;

  let buttonLabel: string;
  if (openingLetterExists && scheduledDate) {
    const title = articleTitle ?? "편지 선택됨";
    buttonLabel = `${title} · ${formatMonthDay(scheduledDate)} 발송 예정`;
  } else if (openingLetterExists) {
    buttonLabel = articleTitle ?? "편지 선택됨";
  } else {
    buttonLabel = "보낼 편지를 선택하세요";
  }

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

      {/* 편지 선택 — SendInline 스타일 */}
      <View style={olStyles.section}>
        <Text style={olStyles.sectionTitle}>편지 선택</Text>
        {isLoading ? (
          <View style={olStyles.selectButton}>
            <ActivityIndicator size="small" color={Colors.zinc400} />
          </View>
        ) : (
          <ScalePressable
            style={olStyles.selectButton}
            contentStyle={olStyles.selectButtonContent}
            onPress={onOpenSheet}
          >
            <Feather
              name="file-text"
              size={18}
              color={openingLetterExists ? Colors.zinc900 : Colors.zinc500}
            />
            <Text
              style={[olStyles.selectButtonText, openingLetterExists && olStyles.selectButtonTextActive]}
              numberOfLines={1}
            >
              {buttonLabel}
            </Text>
            <Feather name="chevron-right" size={18} color={Colors.zinc400} />
          </ScalePressable>
        )}
      </View>

      {/* 발송일 초과 경고 */}
      {isLate && (
        <View style={olStyles.lateWarning}>
          <Feather name="alert-triangle" size={13} color="#d97706" />
          <Text style={olStyles.lateWarningText}>
            현재 예약 발송일({formatMonthDay(scheduledDate!)})이 허용 기한을 초과해요. 편지를 다시 선택하면 발송일이 자동으로 {formatMonthDay(deadline)} 06:00으로 조정돼요.
          </Text>
        </View>
      )}

      {!openingLetterExists && !isLoading && (
        <View style={stepStyles.infoBox}>
          <Feather name="info" size={13} color={Colors.zinc400} />
          <Text style={stepStyles.infoBoxText}>
            여는 편지 없이도 다음 단계로 이동할 수 있지만, 공간 시작에는 여는 편지가 필요해요.
          </Text>
        </View>
      )}
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
  );

  const openingTitle = openingScheduledSend?.articleTitle ?? null;
  const openingScheduledDate = openingScheduledSend ? new Date(openingScheduledSend.scheduledAt) : null;

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
            <Text style={confirmStyles.summaryKey}>중심글</Text>
            <Text style={confirmStyles.summaryVal}>회차당 {centerCount}편</Text>
          </View>
          <View style={confirmStyles.summaryRow}>
            <Text style={confirmStyles.summaryKey}>운영자 참여</Text>
            <Text style={confirmStyles.summaryVal}>{operatorParticipates ? "참여" : "불참"}</Text>
          </View>
          <View style={confirmStyles.summaryRow}>
            <Text style={confirmStyles.summaryKey}>첫 중심글</Text>
            <Text style={confirmStyles.summaryVal}>{formatMonthDay(startDate)}</Text>
          </View>
          <View style={confirmStyles.summaryRow}>
            <Text style={confirmStyles.summaryKey}>마지막 중심글</Text>
            <Text style={confirmStyles.summaryVal}>{lastDate ? formatMonthDay(lastDate) : "—"}</Text>
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
            <Text style={openingLetterExists ? confirmStyles.summaryVal : confirmStyles.summaryWarning}>
              {openingLetterExists ? "작성 완료" : "미작성"}
            </Text>
          </View>
          {openingLetterExists && openingTitle && (
            <View style={confirmStyles.summaryRow}>
              <Text style={confirmStyles.summaryKey}>편지 제목</Text>
              <Text style={confirmStyles.summaryVal} numberOfLines={1}>{openingTitle}</Text>
            </View>
          )}
          {openingLetterExists && openingScheduledDate && (
            <View style={confirmStyles.summaryRow}>
              <Text style={confirmStyles.summaryKey}>발송 예정일</Text>
              <Text style={confirmStyles.summaryVal}>{formatMonthDay(openingScheduledDate)} 06:00</Text>
            </View>
          )}
        </View>
      </View>

      <View style={confirmStyles.noticeBlock}>
        <View style={confirmStyles.noticeRow}>
          <Feather name="info" size={13} color={Colors.zinc400} />
          <Text style={confirmStyles.noticeText}>시작과 동시에 모집이 마감돼요.</Text>
        </View>
        {hasPendingRequests && (
          <View style={confirmStyles.noticeRow}>
            <Feather name="info" size={13} color={Colors.zinc400} />
            <Text style={confirmStyles.noticeText}>
              승인 대기 중인 코드 신청자({pendingCount}명)가 자동으로 거절 처리돼요.
            </Text>
          </View>
        )}
        <View style={confirmStyles.noticeRow}>
          <Feather name="info" size={13} color={Colors.zinc400} />
          <Text style={confirmStyles.noticeText}>
            시작 후 회차 수·진행 방식·규칙은 수정할 수 없어요.
          </Text>
        </View>
      </View>
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
  const openingLetter = letters.find((l) => l.letterType === "OPENING") ?? null;
  const openingLetterExists = openingLetter !== null;

  const sendsQuery = useListAllSpaceScheduledSends(id, {
    query: { enabled: !!id, queryKey: getListAllSpaceScheduledSendsQueryKey(id) },
  });
  const sends = (sendsQuery.data ?? []) as SpaceScheduledSendWithLetter[];
  const openingScheduledSend = openingLetter
    ? (sends.find((s) => s.spaceLetterId === openingLetter.id && s.status === "PENDING") ?? null)
    : null;

  const articlesQuery = useListArticles(
    { authorId: userId ?? "", status: "LETTER" },
    { query: { enabled: !!userId, queryKey: getListArticlesQueryKey({ authorId: userId ?? "", status: "LETTER" }) } },
  );
  const articles = (articlesQuery.data ?? []) as Article[];

  const [showOpeningSheet, setShowOpeningSheet] = useState(false);

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
  const [startDate, setStartDate] = useState<Date>(() => new Date());

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
      const d = new Date((space as any).plannedStartsAt);
      if (!isNaN(d.getTime())) setStartDate(d);
    }
  }, [space]);

  // ── Section 2: 회차 구성 ─────────────────────────────────────────────────

  const [roundConfigs, setRoundConfigs] = useState<Array<{ title: string; description: string }>>([]);

  useEffect(() => {
    setRoundConfigs((prev) =>
      Array.from({ length: roundCount }, (_, i) => ({
        title: prev[i]?.title ?? "",
        description: prev[i]?.description ?? "",
      })),
    );
  }, [roundCount]);

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
          nickname: m?.nickname ?? uid.slice(0, 8),
          isOperator: m?.role === "OPERATOR",
        };
      }),
    [slotOrder, memberById],
  );

  const handleReorder = useCallback((newOrder: string[]) => {
    setSlotOrder(newOrder);
  }, []);

  // ── Start logic ───────────────────────────────────────────────────────────

  const hasEnoughParticipants = slotOrder.length >= 1;
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
      const isDefaultMode = roundConfigMode !== "custom";
      const rounds = Array.from({ length: roundCount }, (_, i) => {
        const rc = roundConfigs[i];
        return {
          title: isDefaultMode ? undefined : (rc?.title?.trim() || undefined),
          description: isDefaultMode ? undefined : (rc?.description?.trim() || undefined),
          slots: slotOrder,
        };
      });

      await startSpace.mutateAsync({
        id,
        data: {
          roundCount,
          scheduleType,
          interval: scheduleType === "N_DAY" ? interval : undefined,
          weekdays: scheduleType === "WEEKDAY" ? weekdays : undefined,
          defaultCenterCount: centerCount,
          rounds,
          operatorParticipates: space?.operatorParticipates ?? true,
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
    roundConfigs, roundConfigMode, slotOrder, roundCount, scheduleType, interval, weekdays,
    centerCount, space, startSpace, id, queryClient, userId, router,
  ]);

  const handleAutoRejectContinue = useCallback(() => {
    setShowAutoRejectModal(false);
    const effectiveMaxStart = space?.maxParticipants != null
      ? (space.operatorParticipates ? space.maxParticipants - 1 : space.maxParticipants)
      : null;
    const confirmedCount = slotOrder.length;
    if (effectiveMaxStart != null && confirmedCount < effectiveMaxStart) {
      setShowUnderCapacityModal(true);
    } else {
      doStart();
    }
  }, [space, slotOrder, doStart]);

  const handleStartPress = useCallback(() => {
    if (!openingLetterExists) {
      Alert.alert("여는 편지 필요", "여는 편지를 먼저 작성해주세요.");
      return;
    }
    if (!hasEnoughParticipants) {
      Alert.alert("참여자 필요", "확정 참여자가 1명 이상 있어야 해요.");
      return;
    }
    if (scheduleType === "WEEKDAY" && weekdays.length === 0) {
      Alert.alert("알림", "요일을 하나 이상 선택해주세요.");
      return;
    }
    if (hasPendingRequests) {
      setShowAutoRejectModal(true);
    } else {
      const effectiveMaxStart = space?.maxParticipants != null
        ? (space.operatorParticipates ? space.maxParticipants - 1 : space.maxParticipants)
        : null;
      const confirmedCount = slotOrder.length;
      if (effectiveMaxStart != null && confirmedCount < effectiveMaxStart) {
        setShowUnderCapacityModal(true);
      } else {
        doStart();
      }
    }
  }, [
    openingLetterExists, hasEnoughParticipants, scheduleType, weekdays,
    hasPendingRequests, space, slotOrder, doStart,
  ]);

  // ── Step navigation logic ─────────────────────────────────────────────────

  const canProceed = useMemo(() => {
    if (step === 0) return hasValidSchedule;
    if (step === 1) return roundConfigMode === "custom"; // selection screen uses its own buttons; custom mode allows 다음
    if (step === 2 && slotSubStep === 0) return slotItems.length >= 1;
    if (step === 2 && slotSubStep === 1) return true;
    if (step === 3) return true;
    if (step === 4) return canStart;
    return true;
  }, [step, slotSubStep, hasValidSchedule, slotItems, canStart, roundConfigMode]);

  const handleNext = useCallback(() => {
    if (step === 0) {
      setCurrentRoundIdx(0);
      setStep(1);
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
      if (roundConfigMode === "custom") {
        if (currentRoundIdx > 0) {
          setCurrentRoundIdx((i) => i - 1);
        } else {
          setRoundConfigMode(null);
        }
      } else {
        // null or "default": go back to step 0
        setStep(0);
      }
    } else if (step === 2) {
      if (slotSubStep === 1) {
        setSlotSubStep(0);
      } else if (roundConfigMode === "default") {
        setRoundConfigMode(null);
        setStep(1);
      } else {
        setCurrentRoundIdx(roundCount - 1);
        setStep(1);
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
      const nonOperatorConfirmed = confirmedMembers.filter((m) => m.role !== "OPERATOR").length;
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
          confirmedCount={nonOperatorConfirmed}
          maxParticipants={space.maxParticipants}
          startDate={startDate}
          setStartDate={setStartDate}
        />
      );
    }
    if (step === 1) {
      if (roundConfigMode !== "custom") {
        return (
          <RoundConfigModeStep
            onSelectDefault={() => {
              setRoundConfigMode("default");
              setSlotSubStep(0);
              setStep(2);
            }}
            onSelectCustom={() => {
              setRoundConfigMode("custom");
              setCurrentRoundIdx(0);
            }}
          />
        );
      }
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
        />
      );
    }
    if (step === 3) {
      return (
        <OpeningLetterStep
          isLoading={lettersQuery.isLoading}
          openingLetterExists={openingLetterExists}
          openingScheduledSend={openingScheduledSend}
          startDate={startDate}
          onOpenSheet={() => setShowOpeningSheet(true)}
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
  if (step === 1 && roundConfigMode === "custom") stepLabelSuffix = `회차 구성 (${currentRoundIdx + 1}/${roundCount})`;
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
          <ScalePressable style={styles.backBtn} onPress={handleBack} hitSlop={8}>
            <Feather name="chevron-left" size={24} color={Colors.zinc700} />
          </ScalePressable>
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

        {/* Step label */}
        <View style={styles.stepLabel}>
          <Text style={styles.stepLabelText}>
            {displayStep + 1} / {TOTAL_STEPS} — {stepLabelSuffix}
          </Text>
        </View>

        {/* Content */}
        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEnabled={scrollEnabled}
        >
          {renderStepContent()}
        </ScrollView>

        {/* Footer */}
        {!(step === 1 && roundConfigMode !== "custom") && (
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
        )}
      </View>

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
        message={`모집 인원(${space.operatorParticipates ? (space.maxParticipants ?? 0) - 1 : space.maxParticipants}명)보다 적은 ${slotOrder.length}명으로 시작할까요?`}
        confirmLabel={`${slotOrder.length}명으로 시작`}
        onCancel={() => setShowUnderCapacityModal(false)}
        onConfirm={doStart}
        loading={isStarting}
      />

      {/* ── 여는 편지 글 선택 시트 ── */}
      {showOpeningSheet && (
        <ArticleScheduleSheet
          mode="opening-letter"
          spaceId={id}
          userId={userId ?? ""}
          letters={letters}
          articles={articles}
          isArticlesLoading={articlesQuery.isLoading}
          isArticlesError={articlesQuery.isError}
          onRefetchArticles={() => articlesQuery.refetch()}
          allSends={sends}
          maxScheduledAt={getOpeningLetterDeadline(startDate)}
          onClose={() => setShowOpeningSheet(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: getListSpaceLettersQueryKey(id) });
            queryClient.invalidateQueries({ queryKey: getListAllSpaceScheduledSendsQueryKey(id) });
          }}
        />
      )}
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
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  headerRight: {
    width: 36,
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
    color: Colors.zinc400,
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
    color: Colors.zinc400,
    textAlign: "right",
  },
  hint: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
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
    color: Colors.zinc400,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    padding: 12,
    borderRadius: 8,
    backgroundColor: Colors.zinc50,
    borderWidth: 1,
    borderColor: Colors.zinc100,
    marginTop: 4,
  },
  infoBoxText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    flex: 1,
    lineHeight: 17,
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
    ...Typography.bodySemiBold,
    color: Colors.zinc800,
  },
  participantHint: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc400,
  },
  datePickerWrapper: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    overflow: "hidden",
    backgroundColor: Colors.zinc50,
  },
  datePickerWrapperError: {
    borderColor: "#ef4444",
  },
  datePicker: {
    height: 120,
  },
  dateBtn: {
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
  dateBtnError: {
    borderColor: "#ef4444",
  },
  dateBtnText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc800,
  },
  dateBtnTextError: {
    color: "#ef4444",
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
    color: Colors.zinc400,
    flex: 1,
    textAlign: "right",
  },
});

const olStyles = StyleSheet.create({
  section: {
    gap: 10,
  },
  sectionTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
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
    ...Typography.bodySemiBold,
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
    fontSize: 11,
    color: Colors.zinc400,
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
  calCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.zinc100,
    backgroundColor: Colors.white,
    overflow: "hidden",
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
  },
  monthNavBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  monthNavBtnDisabled: {
    opacity: 0.4,
  },
  monthNavTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc800,
  },
  weekRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
    backgroundColor: Colors.zinc50,
  },
  weekLabel: {
    flex: 1,
    textAlign: "center",
    paddingVertical: 6,
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc500,
  },
  sunLabel: {
    color: "#ef4444",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: `${100 / 7}%` as any,
    minHeight: 52,
    paddingTop: 4,
    paddingBottom: 4,
    paddingHorizontal: 2,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc50,
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
    fontSize: 9,
    color: Colors.white,
  },
  assignMore: {
    ...Typography.caption,
    fontSize: 9,
    color: Colors.zinc400,
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
});

