import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useQueryClient } from "@tanstack/react-query";
import ScalePressable from "@/components/shared/ScalePressable";
import { CollapsibleDatePicker, getMinSpaceStartDate, startOfDay } from "@/components/shared/CalendarGrid";
import SubmitButton from "@/components/SubmitButton/SubmitButton";
import SubmitProgressOverlay from "@/components/shared/SubmitProgressOverlay";
import Toggle from "@/components/shared/Toggle";
import SpaceBasicSettingsForm, {
  type SpaceBasicSettingsValues,
} from "@/components/SpaceBasicSettingsForm/SpaceBasicSettingsForm";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/contexts/ToastContext";
import {
  createSpace,
  createSpaceRound,
  recoverSpaceCreation,
  getListSpacesQueryKey,
} from "@workspace/api-client-react";
import { SpaceInfoNote } from "@/components/SpaceInfoNote/SpaceInfoNote";
import { SpaceCopy } from "@/constants/spaceCopy";
import {
  buildSpaceCreateSubmission,
  buildSpaceCreationDiagnosticHeaders,
  getSpaceCreationDiagnosticContext,
  getSpaceCreationFailureMessage,
  getRecoveredSpaceCreationDiagnostic,
  getSpaceCreationSubmissionDiagnostic,
  type SpaceCreationSubmissionDiagnostic,
} from "@/lib/spaceCreateSubmission";
import {
  clearPendingSpaceCreationKey,
  createSpaceCreationKey,
  getPendingSpaceCreationKey,
  savePendingSpaceCreationKey,
} from "@/lib/spaceCreationRecovery";

type ScheduleType = "N_DAY" | "WEEKDAY";

type FormData = {
  name: string;
  description: string;
  isAnonymous: boolean;
  startsAt: string;
  roundCount: number;
  maxParticipants: string;
  defaultCenterInterval: number;
  defaultCenterCount: number;
  scheduleType: ScheduleType;
  weekdays: number[];
  operatorParticipates: boolean;
  spaceNickname: string;
};

type PendingRoundCreation = {
  spaceId: string;
  completedRoundCount: number;
  totalRoundCount: number;
  diagnostic: SpaceCreationSubmissionDiagnostic;
  headers: Record<string, string>;
};

const DEFAULT_CENTER_INTERVAL = 1;
const DEFAULT_CENTER_COUNT = 1;

const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

const STEPS = ["기본 설정", "운영 설정", "고급 설정", "생성 확인"];
const TOTAL_STEPS = STEPS.length;

function dateToDigits(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function digitsToDate(digits: string): Date | null {
  const iso = parseDateInput(digits);
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  return new Date(y, m - 1, d);
}

function parseDateInput(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const y = digits.slice(0, 4);
  const m = digits.slice(4, 6);
  const d = digits.slice(6, 8);
  const date = new Date(`${y}-${m}-${d}`);
  if (isNaN(date.getTime())) return null;
  return `${y}-${m}-${d}`;
}

function formatDateDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}.${digits.slice(4)}`;
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
}

function formatDateKorean(raw: string): string | null {
  const parsed = parseDateInput(raw);
  if (!parsed) return null;
  const [y, m, d] = parsed.split("-");
  return `${y}년 ${parseInt(m)}월 ${parseInt(d)}일`;
}

export default function SpaceCreateScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId } = useUser();
  const { showToast } = useToast();

  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [roundCountRaw, setRoundCountRaw] = useState("1");
  const [roundCountError, setRoundCountError] = useState("");
  const [pendingRoundCreation, setPendingRoundCreation] =
    useState<PendingRoundCreation | null>(null);
  const [pendingSpaceCreationKey, setPendingSpaceCreationKey] = useState<string | null>(null);

  const [form, setForm] = useState<FormData>({
    name: "",
    description: "",
    isAnonymous: false,
    startsAt: dateToDigits(getMinSpaceStartDate()),
    roundCount: 1,
    maxParticipants: "",
    defaultCenterInterval: DEFAULT_CENTER_INTERVAL,
    defaultCenterCount: DEFAULT_CENTER_COUNT,
    scheduleType: "N_DAY",
    weekdays: [],
    operatorParticipates: true,
    spaceNickname: "",
  });

  const updateField = useCallback(<K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    if (!userId || pendingRoundCreation) return;
    let cancelled = false;
    void (async () => {
      const creationKey = await getPendingSpaceCreationKey();
      if (!creationKey || cancelled) return;
      setPendingSpaceCreationKey(creationKey);
      try {
        const space = await recoverSpaceCreation({ creationKey });
        if (cancelled) return;
        const diagnostic = getRecoveredSpaceCreationDiagnostic(
          space.isAnonymous,
          getSpaceCreationDiagnosticContext(
            Constants.expoConfig?.extra?.releaseDiagnostics,
            Platform.OS,
          ),
        );
        setPendingRoundCreation({
          spaceId: space.id,
          completedRoundCount: 0,
          totalRoundCount: space.roundCount,
          diagnostic,
          headers: buildSpaceCreationDiagnosticHeaders(diagnostic),
        });
        setStep(TOTAL_STEPS - 1);
        showToast({
          message: "이전에 만든 공간을 찾았어요. 회차 생성을 다시 시도해주세요.",
          type: "error",
        });
      } catch {
        // A 404 means the original request did not commit. Keep the key so a
        // corrected retry is still idempotent if the user resumes this form.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, pendingRoundCreation, showToast]);

  const updateBasicSettings = useCallback((value: SpaceBasicSettingsValues) => {
    setForm((prev) => ({
      ...prev,
      name: value.name,
      description: value.description,
      isAnonymous: value.isAnonymous,
      spaceNickname: value.spaceNickname ?? prev.spaceNickname,
    }));
  }, []);

  const handleRoundCountChange = useCallback((text: string) => {
    const digits = text.replace(/\D/g, "");
    setRoundCountRaw(digits);
    if (roundCountError) setRoundCountError("");
  }, [roundCountError]);

  const canProceed = useMemo(() => {
    if (step === 0) {
      const nickname = form.spaceNickname.trim();
      return form.name.trim().length > 0 &&
        (!form.isAnonymous || (nickname.length > 0 && nickname.length <= 20));
    }
    return true;
  }, [step, form.name, form.isAnonymous, form.spaceNickname]);

  const handleNext = useCallback(() => {
    if (step === 1) {
      const n = parseInt(roundCountRaw, 10);
      if (isNaN(n) || n < 1 || n > 52) {
        setRoundCountError("1에서 52 사이의 양의 정수를 입력해주세요.");
        return;
      }
      setRoundCountError("");
      setForm((prev) => ({ ...prev, roundCount: n }));
    }
    if (step < TOTAL_STEPS - 1) {
      setStep((s) => s + 1);
    }
  }, [step, roundCountRaw]);

  const handleBack = useCallback(() => {
    if (step > 0) {
      setStep((s) => s - 1);
    } else {
      router.back();
    }
  }, [step, router]);

  const handleCreate = useCallback(async () => {
    if (isSubmitting) return;
    if (!userId) {
      showToast({ message: "로그인이 필요합니다.", type: "error" });
      return;
    }
    const spaceNickname = form.spaceNickname.trim();
    if (!pendingRoundCreation && form.isAnonymous && (!spaceNickname || spaceNickname.length > 20)) {
      showToast({ message: "공간 닉네임은 1~20자로 입력해주세요.", type: "error" });
      return;
    }
    setIsSubmitting(true);
    let roundCreation = pendingRoundCreation;
    try {
      if (!roundCreation) {
        const creationKey = pendingSpaceCreationKey ?? createSpaceCreationKey();
        if (!pendingSpaceCreationKey) {
          await savePendingSpaceCreationKey(creationKey);
          setPendingSpaceCreationKey(creationKey);
        }
        const startsAtStr = form.startsAt.trim() ? parseDateInput(form.startsAt) : null;
        const startsAtParsed = startsAtStr ? new Date(startsAtStr) : null;

        const maxParticipants = form.maxParticipants.trim()
          ? parseInt(form.maxParticipants, 10) || undefined
          : undefined;

        // UI weekday indices: 0=월,1=화,2=수,3=목,4=금,5=토,6=일
        // Backend weekday convention: date.getDay() — 0=일,1=월,...,6=토
        const toJsWeekday = (uiIdx: number) => (uiIdx + 1) % 7;
        const backendWeekdays =
          form.scheduleType === "WEEKDAY"
            ? form.weekdays.map(toJsWeekday).sort((a, b) => a - b)
            : undefined;

        const submission = buildSpaceCreateSubmission({
          name: form.name,
          description: form.description,
          isAnonymous: form.isAnonymous,
          plannedStartsAt: startsAtParsed ? startsAtParsed.toISOString() : null,
          roundCount: form.roundCount,
          maxParticipants: maxParticipants ?? null,
          defaultCenterInterval: form.defaultCenterInterval,
          defaultCenterCount: form.defaultCenterCount,
          spaceNickname,
          scheduleType: form.scheduleType,
          weekdays: backendWeekdays ?? null,
          operatorParticipates: form.operatorParticipates,
          creationKey,
        });
        const diagnostic = getSpaceCreationSubmissionDiagnostic(
          submission,
          getSpaceCreationDiagnosticContext(
            Constants.expoConfig?.extra?.releaseDiagnostics,
            Platform.OS,
          ),
        );
        const headers = buildSpaceCreationDiagnosticHeaders(diagnostic);
        console.info("[space-create]", { stage: "space", outcome: "started", ...diagnostic });

        let space;
        try {
          space = await createSpace(submission, { headers });
        } catch (error) {
          console.info("[space-create]", { stage: "space", outcome: "failed", ...diagnostic });
          const status = error && typeof error === "object" && "status" in error
            ? (error as { status?: unknown }).status
            : undefined;
          showToast({
            message: getSpaceCreationFailureMessage(
              "space",
              typeof status === "number" ? status : undefined,
            ),
            type: "error",
          });
          return;
        }

        console.info("[space-create]", { stage: "space", outcome: "succeeded", ...diagnostic });
        roundCreation = {
          spaceId: space.id,
          completedRoundCount: 0,
          totalRoundCount: form.roundCount,
          diagnostic,
          headers,
        };
        setPendingRoundCreation(roundCreation);
      }

      let completedRoundCount = roundCreation.completedRoundCount;
      try {
        for (let i = completedRoundCount; i < roundCreation.totalRoundCount; i++) {
          console.info("[space-create]", {
            stage: "round",
            outcome: "started",
            ...roundCreation.diagnostic,
          });
          await createSpaceRound(
            roundCreation.spaceId,
            {
            roundNumber: i + 1,
            title: null,
            description: null,
            },
            { headers: roundCreation.headers },
          );
          completedRoundCount = i + 1;
          roundCreation = { ...roundCreation, completedRoundCount };
          setPendingRoundCreation(roundCreation);
          console.info("[space-create]", {
            stage: "round",
            outcome: "succeeded",
            ...roundCreation.diagnostic,
          });
        }
      } catch {
        const failedCreation = { ...roundCreation, completedRoundCount };
        setPendingRoundCreation(failedCreation);
        await queryClient.invalidateQueries({ queryKey: getListSpacesQueryKey() });
        console.info("[space-create]", {
          stage: "round",
          outcome: "failed",
          ...failedCreation.diagnostic,
        });
        showToast({
          message: getSpaceCreationFailureMessage("round"),
          type: "error",
        });
        return;
      }

      queryClient.invalidateQueries({ queryKey: getListSpacesQueryKey() });

      await clearPendingSpaceCreationKey();
      setPendingRoundCreation(null);
      setPendingSpaceCreationKey(null);
      showToast({ message: "공간을 만들었어요.", type: "success" });
      router.replace({
        pathname: "/of-space-detail" as never,
        params: { id: roundCreation.spaceId, showInviteGuide: "1" },
      } as never);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    form,
    userId,
    pendingRoundCreation,
    pendingSpaceCreationKey,
    queryClient,
    showToast,
    router,
  ]);

  const renderStepContent = () => {
    if (step === 0) {
      return <BasicSettingsStep form={form} onChange={updateBasicSettings} />;
    }
    if (step === 1) {
      return (
        <OperationSettingsStep
          form={form}
          updateField={updateField}
          roundCountRaw={roundCountRaw}
          roundCountError={roundCountError}
          onRoundCountChange={handleRoundCountChange}
        />
      );
    }
    if (step === 2) {
      return <AdvancedSettingsStep form={form} updateField={updateField} />;
    }
    if (step === 3) {
      return (
        <ConfirmStep
          form={form}
          onGoToStep={setStep}
        />
      );
    }
    return null;
  };

  const isLastStep = step === 3;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <ScalePressable style={styles.backBtn} onPress={handleBack} hitSlop={8}>
            <Feather name="chevron-left" size={24} color={Colors.zinc700} />
          </ScalePressable>
          <Text style={styles.headerTitle}>공간 만들기</Text>
          <View style={styles.headerRight} />
        </View>

        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${((step + 1) / TOTAL_STEPS) * 100}%` },
            ]}
          />
        </View>

        <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {renderStepContent()}
          </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          {isLastStep ? (
            <SubmitButton
              style={styles.nextBtn}
              textStyle={styles.nextBtnText}
              onPress={handleCreate}
              pending={isSubmitting}
              label={pendingRoundCreation ? "회차 만들기 다시 시도" : "공간 만들기"}
              pendingLabel={pendingRoundCreation ? "회차 만드는 중..." : "만드는 중..."}
            />
          ) : (
            <SubmitButton
              style={[styles.nextBtn, !canProceed && styles.nextBtnDisabled]}
              disabledStyle={styles.nextBtnDisabled}
              textStyle={styles.nextBtnText}
              onPress={handleNext}
              pending={false}
              disabled={!canProceed}
              label="다음"
            />
          )}
        </View>
      </View>

      <SubmitProgressOverlay
        visible={isSubmitting}
        message={pendingRoundCreation ? "회차를 만드는 중이에요" : "공간을 만드는 중이에요"}
        subMessage="잠시만 기다려주세요"
      />
    </KeyboardAvoidingView>
  );
}

function BasicSettingsStep({
  form,
  onChange,
}: {
  form: Pick<FormData, "name" | "description" | "isAnonymous" | "spaceNickname">;
  onChange: (value: SpaceBasicSettingsValues) => void;
}) {
  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>기본 설정</Text>
      <Text style={stepStyles.stepDesc}>공간의 이름과 소개를 입력하세요.</Text>
      <SpaceBasicSettingsForm value={form} onChange={onChange} autoFocus />
    </View>
  );
}

function OperationSettingsStep({
  form,
  updateField,
  roundCountRaw,
  roundCountError,
  onRoundCountChange,
}: {
  form: FormData;
  updateField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
  roundCountRaw: string;
  roundCountError: string;
  onRoundCountChange: (text: string) => void;
}) {
  const minStartDate = useMemo(() => getMinSpaceStartDate(), []);
  const selectedDate = useMemo(() => {
    const parsed = digitsToDate(form.startsAt);
    return parsed ?? minStartDate;
  }, [form.startsAt, minStartDate]);

  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>운영 설정</Text>
      <Text style={stepStyles.stepDesc}>공간 운영 조건을 설정하세요.</Text>

      <View style={stepStyles.fieldGroup}>
        <View style={stepStyles.labelRow}>
          <Text style={stepStyles.fieldLabel}>시작 예정일 *</Text>
          <SpaceInfoNote variant="popup" text={SpaceCopy.startsAt_what} />
        </View>
        <CollapsibleDatePicker
          value={selectedDate}
          onChange={(date) => updateField("startsAt", dateToDigits(date))}
          isDateDisabled={(date) => startOfDay(date) < minStartDate}
          formatButtonLabel={(date) => formatDateDisplay(dateToDigits(date))}
        />
        <Text style={stepStyles.hint}>시작 예정일은 오늘로부터 3일 후부터 선택할 수 있어요</Text>
      </View>

      <View style={stepStyles.fieldGroup}>
        <View style={stepStyles.labelRow}>
          <Text style={stepStyles.fieldLabel}>전체 회차 수 *</Text>
          <SpaceInfoNote variant="popup" text={SpaceCopy.round_what} />
        </View>
        <TextInput
          style={stepStyles.input}
          placeholder="예: 12"
          placeholderTextColor={Colors.zinc400}
          value={roundCountRaw}
          onChangeText={onRoundCountChange}
          keyboardType="number-pad"
          maxLength={2}
        />
        {roundCountError ? (
          <Text style={stepStyles.errorText}>{roundCountError}</Text>
        ) : (
          <Text style={stepStyles.hint}>최대 52회차까지 설정할 수 있어요</Text>
        )}
      </View>

      <View style={stepStyles.fieldGroup}>
        <Text style={stepStyles.fieldLabel}>몇 명까지 참여할 수 있나요? (선택)</Text>
        <TextInput
          style={stepStyles.input}
          placeholder="제한 없음"
          placeholderTextColor={Colors.zinc400}
          value={form.maxParticipants}
          onChangeText={(v) => {
            const digits = v.replace(/\D/g, "");
            if (digits === "" || parseInt(digits, 10) > 0) {
              updateField("maxParticipants", digits);
            }
          }}
          keyboardType="number-pad"
          maxLength={4}
        />
        <Text style={stepStyles.hint}>
          {form.maxParticipants.trim()
            ? `공간장 참여 여부와 관계없이 참여자를 ${form.maxParticipants}명까지 모집해요`
            : "비워두면 인원 제한 없이 운영돼요"}
        </Text>
      </View>

      <View style={stepStyles.toggleRow}>
        <View style={stepStyles.toggleInfo}>
          <View style={stepStyles.labelRow}>
            <Text style={stepStyles.fieldLabel}>공간장 참여</Text>
            <SpaceInfoNote variant="popup" text={SpaceCopy.operatorParticipates_what} />
          </View>
          <Text style={stepStyles.toggleDesc}>공간장도 회차에 글을 직접 제출해요</Text>
        </View>
        <Toggle
          value={form.operatorParticipates}
          onValueChange={(v) => updateField("operatorParticipates", v)}
          accessibilityLabel="공간장 참여"
        />
      </View>
    </View>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
  unit,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  unit: string;
}) {
  return (
    <View style={stepperStyles.row}>
      <ScalePressable
        style={[stepperStyles.btn, value <= min && stepperStyles.btnDisabled]}
        contentStyle={stepperStyles.btnContent}
        onPress={() => { if (value > min) onChange(value - 1); }}
        disabled={value <= min}
      >
        <Feather name="minus" size={18} color={value <= min ? Colors.zinc300 : Colors.zinc700} />
      </ScalePressable>
      <View style={stepperStyles.valueBox}>
        <Text style={stepperStyles.valueText}>{value}</Text>
        <Text style={stepperStyles.unitText}>{unit}</Text>
      </View>
      <ScalePressable
        style={[stepperStyles.btn, value >= max && stepperStyles.btnDisabled]}
        contentStyle={stepperStyles.btnContent}
        onPress={() => { if (value < max) onChange(value + 1); }}
        disabled={value >= max}
      >
        <Feather name="plus" size={18} color={value >= max ? Colors.zinc300 : Colors.zinc700} />
      </ScalePressable>
    </View>
  );
}

function WeekdayToggle({
  weekdays,
  onChange,
}: {
  weekdays: number[];
  onChange: (next: number[]) => void;
}) {
  const toggle = (idx: number) => {
    if (weekdays.includes(idx)) {
      onChange(weekdays.filter((d) => d !== idx));
    } else {
      onChange([...weekdays, idx].sort((a, b) => a - b));
    }
  };

  return (
    <View style={weekdayStyles.row}>
      {WEEKDAY_LABELS.map((label, idx) => {
        const selected = weekdays.includes(idx);
        return (
          <ScalePressable
            key={idx}
            style={[weekdayStyles.pill, selected && weekdayStyles.pillSelected]}
            contentStyle={weekdayStyles.pillContent}
            onPress={() => toggle(idx)}
          >
            <Text style={[weekdayStyles.pillText, selected && weekdayStyles.pillTextSelected]}>
              {label}
            </Text>
          </ScalePressable>
        );
      })}
    </View>
  );
}

function AdvancedSettingsStep({
  form,
  updateField,
}: {
  form: FormData;
  updateField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
}) {
  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>고급 설정</Text>
      <Text style={stepStyles.stepDesc}>진행 방식과 중심글 설정을 조정해요.</Text>

      <View style={stepStyles.fieldGroup}>
        <View style={stepStyles.labelRow}>
          <Text style={stepStyles.fieldLabel}>진행 방식</Text>
          <SpaceInfoNote variant="popup" text={SpaceCopy.scheduleType_what} />
        </View>
        <View style={scheduleStyles.optionList}>
          <ScalePressable
            contentStyle={[
              scheduleStyles.option,
              form.scheduleType === "N_DAY" && scheduleStyles.optionSelected,
            ]}
            onPress={() => updateField("scheduleType", "N_DAY")}
          >
            <View style={scheduleStyles.optionRadio}>
              {form.scheduleType === "N_DAY" && (
                <View style={scheduleStyles.optionRadioDot} />
              )}
            </View>
            <Text style={scheduleStyles.optionLabel}>N일 간격</Text>
          </ScalePressable>

          <ScalePressable
            contentStyle={[
              scheduleStyles.option,
              form.scheduleType === "WEEKDAY" && scheduleStyles.optionSelected,
            ]}
            onPress={() => updateField("scheduleType", "WEEKDAY")}
          >
            <View style={scheduleStyles.optionRadio}>
              {form.scheduleType === "WEEKDAY" && (
                <View style={scheduleStyles.optionRadioDot} />
              )}
            </View>
            <Text style={scheduleStyles.optionLabel}>요일 지정</Text>
          </ScalePressable>
        </View>

        {form.scheduleType === "N_DAY" && (
          <View style={scheduleStyles.subSection}>
            <Text style={stepStyles.hint}>중심글을 보낼 간격을 설정해요</Text>
            <Stepper
              value={form.defaultCenterInterval}
              min={1}
              max={30}
              onChange={(v) => updateField("defaultCenterInterval", v)}
              unit="일"
            />
          </View>
        )}

        {form.scheduleType === "WEEKDAY" && (
          <View style={scheduleStyles.subSection}>
            <Text style={stepStyles.hint}>중심글을 보낼 요일을 선택해요</Text>
            <WeekdayToggle
              weekdays={form.weekdays}
              onChange={(v) => updateField("weekdays", v)}
            />
          </View>
        )}
      </View>

      <View style={stepStyles.fieldGroup}>
        <View style={stepStyles.labelRow}>
          <Text style={stepStyles.fieldLabel}>한 번에 올라오는 중심글 수</Text>
          <SpaceInfoNote variant="popup" text={SpaceCopy.centerCount_what} />
        </View>
        <Stepper
          value={form.defaultCenterCount}
          min={1}
          max={10}
          onChange={(v) => updateField("defaultCenterCount", v)}
          unit="편"
        />
      </View>
    </View>
  );
}

function formatScheduleSummary(form: FormData): string {
  if (form.scheduleType === "N_DAY") {
    return `${form.defaultCenterInterval}일 간격`;
  }
  if (form.weekdays.length === 0) {
    return "요일 미지정";
  }
  return form.weekdays.map((d) => WEEKDAY_LABELS[d]).join(", ") + "요일";
}

function ConfirmStep({
  form,
  onGoToStep,
}: {
  form: FormData;
  onGoToStep: (step: number) => void;
}) {
  const dateKorean = formatDateKorean(form.startsAt);
  const scheduleSummary = formatScheduleSummary(form);

  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>생성 확인</Text>
      <Text style={stepStyles.stepDesc}>입력한 내용을 확인하고 공간을 만들어요.</Text>

      <View style={confirmStyles.block}>
        <View style={confirmStyles.blockEditRow}>
          <ScalePressable onPress={() => onGoToStep(0)}>
            <Text style={confirmStyles.editBtn}>수정</Text>
          </ScalePressable>
        </View>
        <Text style={confirmStyles.proseText}>
          <Text style={confirmStyles.proseBold}>{form.name}</Text>
          <Text>{" 공간이에요."}</Text>
          {form.description.trim() ? (
            <Text>{` ${form.description.trim()}`}</Text>
          ) : (
            <Text>{""}</Text>
          )}
          <Text>{form.isAnonymous ? " 익명으로 운영돼요." : " 기명으로 운영돼요."}</Text>
        </Text>
      </View>

      <View style={confirmStyles.block}>
        <View style={confirmStyles.blockEditRow}>
          <ScalePressable onPress={() => onGoToStep(1)}>
            <Text style={confirmStyles.editBtn}>수정</Text>
          </ScalePressable>
        </View>
        <Text style={confirmStyles.proseText}>
          {dateKorean ? (
            <Text>{`${dateKorean}에 시작 예정인 `}</Text>
          ) : (
            <Text>{"시작 예정일 미정의 "}</Text>
          )}
          <Text>
            {"총 "}
            <Text style={confirmStyles.proseBold}>{form.roundCount}회차</Text>
            {" 공간이에요."}
          </Text>
          {form.maxParticipants.trim() ? (
            <Text>{` 최대 ${form.maxParticipants}명까지 참여할 수 있어요.`}</Text>
          ) : (
            <Text>{""}</Text>
          )}
          <Text>
            {form.operatorParticipates
               ? " 공간장도 회차에 참여해요."
               : " 공간장은 회차에 참여하지 않아요."}
          </Text>
        </Text>
      </View>

      <View style={confirmStyles.block}>
        <View style={confirmStyles.blockEditRow}>
          <ScalePressable onPress={() => onGoToStep(2)}>
            <Text style={confirmStyles.editBtn}>수정</Text>
          </ScalePressable>
        </View>
        <Text style={confirmStyles.proseText}>
          <Text>{"진행 방식: "}</Text>
          <Text style={confirmStyles.proseBold}>{scheduleSummary}</Text>
          <Text>{", 한 번에 올라오는 중심글 "}</Text>
          <Text style={confirmStyles.proseBold}>{form.defaultCenterCount}편</Text>
          <Text>{"씩 게시돼요."}</Text>
        </Text>
      </View>

      <SpaceInfoNote variant="inline" text={SpaceCopy.create_afterCreate} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.white,
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
  },
  errorText: {
    ...Typography.caption,
    fontSize: 12,
    color: "#EF4444",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingVertical: 6,
    gap: 12,
  },
  toggleInfo: {
    flex: 1,
    gap: 2,
  },
  toggleDesc: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
  },
  toggleNotice: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    lineHeight: 18,
    marginTop: 4,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
});

const stepperStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 10,
  },
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: {
    borderColor: Colors.zinc100,
    backgroundColor: Colors.zinc50,
  },
  btnContent: {
    height: "100%",
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "auto",
    justifyContent: "center",
    alignItems: "center",
  },
  valueBox: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 3,
    minWidth: 60,
    justifyContent: "center",
  },
  valueText: {
    ...Typography.bodySemiBold,
    fontSize: 22,
    color: Colors.zinc900,
  },
  unitText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc500,
  },
});

const scheduleStyles = StyleSheet.create({
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
  subSection: {
    gap: 6,
    paddingTop: 4,
    paddingLeft: 4,
  },
});

const weekdayStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
    flexWrap: "wrap",
  },
  pill: {
    width: 40,
    height: 40,
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.zinc50,
  },
  pillContent: {
    width: "100%",
    height: "100%",
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  pillSelected: {
    borderColor: Colors.zinc900,
    backgroundColor: Colors.zinc900,
  },
  pillText: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.zinc500,
  },
  pillTextSelected: {
    color: Colors.white,
  },
});

const confirmStyles = StyleSheet.create({
  block: {
    gap: 6,
  },
  blockEditRow: {
    alignItems: "flex-end",
  },
  editBtn: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.zinc500,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  proseText: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc800,
    lineHeight: 26,
  },
  proseBold: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
  },
});
