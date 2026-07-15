import React, { useState, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Switch,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ActivityIndicator,
  Modal,
  Pressable,
} from "react-native";
import { Calendar } from "react-native-calendars";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import ScalePressable from "@/components/shared/ScalePressable";
import SubmitButton from "@/components/SubmitButton/SubmitButton";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/contexts/ToastContext";
import {
  useCreateSpace,
  useCreateSpaceRound,
  getListSpacesQueryKey,
} from "@workspace/api-client-react";

type RoundDraft = { title: string; description: string };

type FormData = {
  name: string;
  description: string;
  isAnonymous: boolean;
  startsAt: string;
  roundCount: number;
  maxParticipants: string;
  rounds: RoundDraft[];
  defaultCenterInterval: number;
  defaultCenterCount: number;
  customizeRounds: boolean;
};

const DEFAULT_CENTER_INTERVAL = 1;
const DEFAULT_CENTER_COUNT = 1;

function getTodayDigits(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function getTomorrowDigits(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function getTomorrowIso(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function digitsToIso(digits: string): string {
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function buildSteps(roundCount: number, customizeRounds: boolean): string[] {
  const base = ["기본 설정", "운영 설정", "회차 구성 방식"];
  if (customizeRounds) {
    for (let i = 1; i <= roundCount; i++) {
      base.push(`${i}회차 구성`);
    }
  }
  base.push("고급 설정", "생성 확인");
  return base;
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

  const createSpace = useCreateSpace();
  const createSpaceRound = useCreateSpaceRound();

  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [roundCountRaw, setRoundCountRaw] = useState("1");
  const [roundCountError, setRoundCountError] = useState("");

  const [form, setForm] = useState<FormData>({
    name: "",
    description: "",
    isAnonymous: false,
    startsAt: getTomorrowDigits(),
    roundCount: 1,
    maxParticipants: "",
    rounds: [{ title: "", description: "" }],
    defaultCenterInterval: DEFAULT_CENTER_INTERVAL,
    defaultCenterCount: DEFAULT_CENTER_COUNT,
    customizeRounds: false,
  });

  const updateField = useCallback(<K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const updateRound = useCallback((index: number, field: keyof RoundDraft, value: string) => {
    setForm((prev) => {
      const rounds = prev.rounds.map((r, i) =>
        i === index ? { ...prev.rounds[i], [field]: value } : r,
      );
      return { ...prev, rounds };
    });
  }, []);

  const handleRoundCountChange = useCallback((text: string) => {
    const digits = text.replace(/\D/g, "");
    setRoundCountRaw(digits);
    if (roundCountError) setRoundCountError("");
  }, [roundCountError]);

  const steps = useMemo(
    () => buildSteps(form.roundCount, form.customizeRounds),
    [form.roundCount, form.customizeRounds],
  );
  const totalSteps = steps.length;

  const ROUND_MODE_STEP = 2;
  const roundIndex = step - 3;
  const isRoundStep = form.customizeRounds && roundIndex >= 0 && roundIndex < form.roundCount;
  const advancedStep = form.customizeRounds ? form.roundCount + 3 : 3;
  const confirmStep = form.customizeRounds ? form.roundCount + 4 : 4;

  const canProceed = useMemo(() => {
    if (step === 0) return form.name.trim().length > 0;
    if (step === ROUND_MODE_STEP) return false;
    return true;
  }, [step, form]);

  const handleNext = useCallback(() => {
    if (step === 1) {
      const n = parseInt(roundCountRaw, 10);
      if (isNaN(n) || n < 1 || n > 52) {
        setRoundCountError("1에서 52 사이의 양의 정수를 입력해주세요.");
        return;
      }
      setRoundCountError("");
      setForm((prev) => {
        const existing = prev.rounds;
        const rounds: RoundDraft[] = Array.from({ length: n }, (_, i) =>
          existing[i] ?? { title: "", description: "" },
        );
        return { ...prev, roundCount: n, rounds };
      });
    }
    if (step < totalSteps - 1) {
      setStep((s) => s + 1);
    }
  }, [step, totalSteps, roundCountRaw]);

  const handleSelectRoundMode = useCallback((customize: boolean) => {
    setForm((prev) => {
      const rounds = customize
        ? prev.rounds
        : prev.rounds.map(() => ({ title: "", description: "" }));
      return { ...prev, customizeRounds: customize, rounds };
    });
    setStep(3);
  }, []);

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
    setIsSubmitting(true);
    try {
      const startsAtStr = form.startsAt.trim() ? parseDateInput(form.startsAt) : null;
      const startsAtParsed = startsAtStr ? new Date(startsAtStr) : null;

      const maxParticipants = form.maxParticipants.trim()
        ? parseInt(form.maxParticipants, 10) || undefined
        : undefined;

      const space = await createSpace.mutateAsync({
        data: {
          name: form.name.trim(),
          description: form.description.trim() || null,
          isAnonymous: form.isAnonymous,
          startsAt: startsAtParsed ? startsAtParsed.toISOString() : null,
          roundCount: form.roundCount,
          maxParticipants: maxParticipants ?? null,
          defaultCenterInterval: form.defaultCenterInterval,
          defaultCenterCount: form.defaultCenterCount,
          creatorId: userId,
        },
      });

      for (let i = 0; i < form.roundCount; i++) {
        const round = form.customizeRounds
          ? (form.rounds[i] ?? { title: "", description: "" })
          : { title: "", description: "" };
        await createSpaceRound.mutateAsync({
          id: space.id,
          data: {
            roundNumber: i + 1,
            title: round.title.trim() || null,
            description: round.description.trim() || null,
          },
        });
      }

      queryClient.invalidateQueries({ queryKey: getListSpacesQueryKey() });

      showToast({ message: "공간을 만들었어요.", type: "success" });
      router.replace({
        pathname: "/of-space-detail" as never,
        params: { id: space.id, showInviteGuide: "1" },
      } as never);
    } catch {
      showToast({ message: "공간 생성에 실패했어요. 다시 시도해주세요.", type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, form, userId, createSpace, createSpaceRound, queryClient, showToast, router]);

  const renderStepContent = () => {
    if (step === 0) {
      return <BasicSettingsStep form={form} updateField={updateField} />;
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
    if (step === ROUND_MODE_STEP) {
      return (
        <RoundModeStep
          onSelect={handleSelectRoundMode}
        />
      );
    }
    if (isRoundStep) {
      return (
        <RoundConfigStep
          roundNumber={roundIndex + 1}
          round={form.rounds[roundIndex] ?? { title: "", description: "" }}
          onChange={(field, value) => updateRound(roundIndex, field, value)}
        />
      );
    }
    if (step === advancedStep) {
      return (
        <AdvancedSettingsStep
          form={form}
          updateField={updateField}
        />
      );
    }
    if (step === confirmStep) {
      return (
        <ConfirmStep
          form={form}
          onGoToStep={setStep}
          basicStep={0}
          operationStep={1}
          roundModeStep={ROUND_MODE_STEP}
          advancedStep={advancedStep}
        />
      );
    }
    return null;
  };

  const isLastStep = step === confirmStep;
  const isRoundModeStep = step === ROUND_MODE_STEP;

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
              { width: `${((step + 1) / totalSteps) * 100}%` },
            ]}
          />
        </View>

        <View style={styles.stepLabel}>
          <Text style={styles.stepLabelText}>
            {step + 1} / {totalSteps} — {steps[step]}
          </Text>
        </View>

        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {renderStepContent()}
          </ScrollView>
        </TouchableWithoutFeedback>

        {!isRoundModeStep && (
          <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
            {isLastStep ? (
              <SubmitButton
                style={styles.nextBtn}
                textStyle={styles.nextBtnText}
                onPress={handleCreate}
                pending={isSubmitting}
                label="공간 만들기"
                pendingLabel="만드는 중..."
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
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function BasicSettingsStep({
  form,
  updateField,
}: {
  form: FormData;
  updateField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
}) {
  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>기본 설정</Text>
      <Text style={stepStyles.stepDesc}>공간의 이름과 소개를 입력하세요.</Text>

      <View style={stepStyles.fieldGroup}>
        <Text style={stepStyles.fieldLabel}>공간 이름 *</Text>
        <TextInput
          style={stepStyles.input}
          placeholder="예: 2025 독서 모임"
          placeholderTextColor={Colors.zinc400}
          value={form.name}
          onChangeText={(v) => updateField("name", v)}
          maxLength={50}
          autoFocus
          returnKeyType="next"
        />
        <Text style={stepStyles.charCount}>{form.name.length} / 50</Text>
      </View>

      <View style={stepStyles.fieldGroup}>
        <Text style={stepStyles.fieldLabel}>설명 (선택)</Text>
        <TextInput
          style={[stepStyles.input, stepStyles.inputMulti]}
          placeholder="이 공간은 어떤 목적으로 운영되나요?"
          placeholderTextColor={Colors.zinc400}
          value={form.description}
          onChangeText={(v) => updateField("description", v)}
          multiline
          textAlignVertical="top"
          maxLength={300}
        />
        <Text style={stepStyles.charCount}>{form.description.length} / 300</Text>
      </View>

      <View style={stepStyles.toggleRow}>
        <View style={stepStyles.toggleInfo}>
          <Text style={stepStyles.fieldLabel}>익명 운영</Text>
          <Text style={stepStyles.toggleDesc}>참여자 이름이 공개되지 않아요</Text>
        </View>
        <Switch
          value={form.isAnonymous}
          onValueChange={(v) => updateField("isAnonymous", v)}
          trackColor={{ false: Colors.zinc200, true: Colors.zinc700 }}
          thumbColor={Colors.white}
        />
      </View>
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
  const [calendarVisible, setCalendarVisible] = useState(false);

  const selectedIso = form.startsAt.length === 8 ? digitsToIso(form.startsAt) : undefined;
  const markedDates = selectedIso
    ? { [selectedIso]: { selected: true, selectedColor: Colors.zinc900 } }
    : {};

  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>운영 설정</Text>
      <Text style={stepStyles.stepDesc}>공간 운영 조건을 설정하세요.</Text>

      <View style={stepStyles.fieldGroup}>
        <Text style={stepStyles.fieldLabel}>시작일 *</Text>
        <Pressable
          style={[stepStyles.input, operationStyles.datePressable]}
          onPress={() => setCalendarVisible(true)}
        >
          <Text style={form.startsAt ? stepStyles.inputText : stepStyles.inputPlaceholder}>
            {form.startsAt ? formatDateDisplay(form.startsAt) : "날짜를 선택하세요"}
          </Text>
        </Pressable>

        <Modal
          visible={calendarVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setCalendarVisible(false)}
        >
          <Pressable
            style={operationStyles.modalBackdrop}
            onPress={() => setCalendarVisible(false)}
          >
            <Pressable style={operationStyles.calendarContainer} onPress={() => {}}>
              <Calendar
                minDate={getTomorrowIso()}
                markedDates={markedDates}
                onDayPress={(day) => {
                  const digits = day.dateString.replace(/-/g, "");
                  updateField("startsAt", digits);
                  setCalendarVisible(false);
                }}
                theme={{
                  selectedDayBackgroundColor: Colors.zinc900,
                  todayTextColor: Colors.zinc500,
                  arrowColor: Colors.zinc900,
                }}
              />
            </Pressable>
          </Pressable>
        </Modal>
      </View>

      <View style={stepStyles.fieldGroup}>
        <Text style={stepStyles.fieldLabel}>전체 회차 수 *</Text>
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
        <Text style={stepStyles.hint}>비워두면 인원 제한 없이 운영돼요 (최소 1명)</Text>
      </View>
    </View>
  );
}

function RoundModeStep({ onSelect }: { onSelect: (customize: boolean) => void }) {
  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>회차 구성 방식</Text>
      <Text style={stepStyles.stepDesc}>회차별 제목과 설명을 직접 설정하시겠어요?</Text>

      <View style={roundModeStyles.cardList}>
        <ScalePressable style={roundModeStyles.card} onPress={() => onSelect(false)}>
          <View style={roundModeStyles.cardIcon}>
            <Feather name="check-circle" size={22} color={Colors.zinc700} />
          </View>
          <View style={roundModeStyles.cardBody}>
            <Text style={roundModeStyles.cardTitle}>기본값 적용</Text>
            <Text style={roundModeStyles.cardDesc}>
              회차 제목·설명 없이 바로 다음 단계로 넘어가요.
            </Text>
          </View>
        </ScalePressable>

        <ScalePressable style={roundModeStyles.card} onPress={() => onSelect(true)}>
          <View style={roundModeStyles.cardIcon}>
            <Feather name="edit-3" size={22} color={Colors.zinc700} />
          </View>
          <View style={roundModeStyles.cardBody}>
            <Text style={roundModeStyles.cardTitle}>직접 설정하기</Text>
            <Text style={roundModeStyles.cardDesc}>
              각 회차마다 제목과 설명을 직접 입력해요.
            </Text>
          </View>
        </ScalePressable>
      </View>
    </View>
  );
}

function RoundConfigStep({
  roundNumber,
  round,
  onChange,
}: {
  roundNumber: number;
  round: RoundDraft;
  onChange: (field: keyof RoundDraft, value: string) => void;
}) {
  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>{roundNumber}회차 구성</Text>
      <Text style={stepStyles.stepDesc}>
        {roundNumber}회차에 대한 이름과 짧은 소개를 적어두세요. 비워두어도 괜찮아요.
      </Text>

      <View style={stepStyles.fieldGroup}>
        <Text style={stepStyles.fieldLabel}>{roundNumber}회차 제목 (선택)</Text>
        <TextInput
          style={stepStyles.input}
          placeholder={`예: ${roundNumber}회차 — 봄 이야기`}
          placeholderTextColor={Colors.zinc400}
          value={round.title}
          onChangeText={(v) => onChange("title", v)}
          maxLength={100}
          autoFocus
          returnKeyType="next"
        />
      </View>

      <View style={stepStyles.fieldGroup}>
        <Text style={stepStyles.fieldLabel}>짧은 설명 (선택)</Text>
        <TextInput
          style={[stepStyles.input, stepStyles.inputMulti]}
          placeholder="이 회차에 대해 간단히 소개해주세요"
          placeholderTextColor={Colors.zinc400}
          value={round.description}
          onChangeText={(v) => onChange("description", v)}
          multiline
          textAlignVertical="top"
          maxLength={200}
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
        onPress={() => { if (value < max) onChange(value + 1); }}
        disabled={value >= max}
      >
        <Feather name="plus" size={18} color={value >= max ? Colors.zinc300 : Colors.zinc700} />
      </ScalePressable>
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
      <Text style={stepStyles.stepDesc}>중심글 전송 간격과 회차당 글 수를 조정해요.</Text>

      <View style={stepStyles.fieldGroup}>
        <Text style={stepStyles.fieldLabel}>중심글 전송 간격</Text>
        <Text style={stepStyles.hint}>각 회차 중심글 사이 전송 주기예요</Text>
        <Stepper
          value={form.defaultCenterInterval}
          min={1}
          max={30}
          onChange={(v) => updateField("defaultCenterInterval", v)}
          unit="일"
        />
      </View>

      <View style={stepStyles.fieldGroup}>
        <Text style={stepStyles.fieldLabel}>회차당 중심글 수</Text>
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

function ConfirmStep({
  form,
  onGoToStep,
  basicStep,
  operationStep,
  roundModeStep,
  advancedStep,
}: {
  form: FormData;
  onGoToStep: (step: number) => void;
  basicStep: number;
  operationStep: number;
  roundModeStep: number;
  advancedStep: number;
}) {
  const dateKorean = formatDateKorean(form.startsAt);
  const hasRoundTitles = form.customizeRounds && form.rounds.some((r) => r.title.trim());
  const roundTitleSummary = hasRoundTitles
    ? form.rounds
        .map((r, i) => (r.title.trim() ? `${i + 1}회차 '${r.title}'` : null))
        .filter(Boolean)
        .join(", ")
    : "";

  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>생성 확인</Text>
      <Text style={stepStyles.stepDesc}>입력한 내용을 확인하고 공간을 만들어요.</Text>

      <View style={confirmStyles.block}>
        <View style={confirmStyles.blockEditRow}>
          <ScalePressable onPress={() => onGoToStep(basicStep)}>
            <Text style={confirmStyles.editBtn}>수정</Text>
          </ScalePressable>
        </View>
        <Text style={confirmStyles.proseText}>
          <Text style={confirmStyles.proseBold}>{form.name}</Text>
          <Text> 공간이에요.</Text>
          {form.description.trim() ? (
            <Text> {form.description.trim()}</Text>
          ) : null}
          <Text>{form.isAnonymous ? " 익명으로 운영돼요." : " 기명으로 운영돼요."}</Text>
        </Text>
      </View>

      <View style={confirmStyles.block}>
        <View style={confirmStyles.blockEditRow}>
          <ScalePressable onPress={() => onGoToStep(operationStep)}>
            <Text style={confirmStyles.editBtn}>수정</Text>
          </ScalePressable>
        </View>
        <Text style={confirmStyles.proseText}>
          {dateKorean ? (
            <Text>{dateKorean}에 시작하는 </Text>
          ) : (
            <Text>시작일 미정의 </Text>
          )}
          <Text>
            {"총 "}
            <Text style={confirmStyles.proseBold}>{form.roundCount}회차</Text>
            {" 공간이에요."}
          </Text>
          {form.maxParticipants.trim() ? (
            <Text> 최대 {form.maxParticipants}명까지 참여할 수 있어요.</Text>
          ) : null}
        </Text>
      </View>

      <View style={confirmStyles.block}>
        <View style={confirmStyles.blockEditRow}>
          <ScalePressable onPress={() => onGoToStep(roundModeStep)}>
            <Text style={confirmStyles.editBtn}>수정</Text>
          </ScalePressable>
        </View>
        <Text style={confirmStyles.proseText}>
          {form.customizeRounds
            ? "회차를 직접 설정했어요."
            : "회차는 기본값으로 구성돼요."}
          {roundTitleSummary ? <Text> {roundTitleSummary}으로 구성돼요.</Text> : null}
        </Text>
      </View>

      <View style={confirmStyles.block}>
        <View style={confirmStyles.blockEditRow}>
          <ScalePressable onPress={() => onGoToStep(advancedStep)}>
            <Text style={confirmStyles.editBtn}>수정</Text>
          </ScalePressable>
        </View>
        <Text style={confirmStyles.proseText}>
          {"중심글은 "}
          <Text style={confirmStyles.proseBold}>{form.defaultCenterInterval}일</Text>
          {" 간격으로, 회차당 "}
          <Text style={confirmStyles.proseBold}>{form.defaultCenterCount}편</Text>
          {"씩 게시돼요."}
        </Text>
      </View>
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
  inputText: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc900,
  },
  inputPlaceholder: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc400,
  },
  inputMulti: {
    minHeight: 96,
    lineHeight: 22,
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
  },
  errorText: {
    ...Typography.caption,
    fontSize: 12,
    color: "#EF4444",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  toggleInfo: {
    flex: 1,
    gap: 2,
  },
  toggleDesc: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc400,
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

const operationStyles = StyleSheet.create({
  datePressable: {
    justifyContent: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  calendarContainer: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    overflow: "hidden",
    width: "100%",
  },
});

const roundModeStyles = StyleSheet.create({
  cardList: {
    gap: 12,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.zinc50,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.zinc100,
    gap: 14,
  },
  cardIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    flex: 1,
    gap: 3,
  },
  cardTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
  },
  cardDesc: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
    lineHeight: 18,
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
