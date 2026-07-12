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
} from "react-native";
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
};

const DEFAULT_CENTER_INTERVAL = 7;
const DEFAULT_CENTER_COUNT = 1;

function getTodayDigits(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function buildSteps(roundCount: number): string[] {
  const base = ["기본 설정", "운영 설정"];
  for (let i = 1; i <= roundCount; i++) {
    base.push(`${i}회차 구성`);
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

export default function SpaceCreateScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId } = useUser();
  const { showToast } = useToast();

  const createSpace = useCreateSpace();
  const createSpaceRound = useCreateSpaceRound();

  const [step, setStep] = useState(0);
  const [advancedCustomized, setAdvancedCustomized] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [roundCountRaw, setRoundCountRaw] = useState("1");
  const [roundCountError, setRoundCountError] = useState("");

  const [form, setForm] = useState<FormData>({
    name: "",
    description: "",
    isAnonymous: false,
    startsAt: getTodayDigits(),
    roundCount: 1,
    maxParticipants: "",
    rounds: [{ title: "", description: "" }],
    defaultCenterInterval: DEFAULT_CENTER_INTERVAL,
    defaultCenterCount: DEFAULT_CENTER_COUNT,
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

  const steps = useMemo(() => buildSteps(form.roundCount), [form.roundCount]);
  const totalSteps = steps.length;

  const canProceed = useMemo(() => {
    if (step === 0) return form.name.trim().length > 0;
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

  const handleBack = useCallback(() => {
    if (step > 0) {
      setStep((s) => s - 1);
    } else {
      router.back();
    }
  }, [step, router]);

  const handleCreate = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const startsAtParsed = form.startsAt.trim()
        ? parseDateInput(form.startsAt) ?? undefined
        : undefined;

      const maxParticipants = form.maxParticipants.trim()
        ? parseInt(form.maxParticipants, 10) || undefined
        : undefined;

      const space = await createSpace.mutateAsync({
        data: {
          name: form.name.trim(),
          description: form.description.trim() || null,
          isAnonymous: form.isAnonymous,
          startsAt: startsAtParsed ?? null,
          roundCount: form.roundCount,
          maxParticipants: maxParticipants ?? null,
          defaultCenterInterval: form.defaultCenterInterval,
          defaultCenterCount: form.defaultCenterCount,
          creatorId: userId,
        },
      });

      for (let i = 0; i < form.roundCount; i++) {
        const round = form.rounds[i] ?? { title: "", description: "" };
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
      router.replace({ pathname: "/(tabs)/of" });
    } catch {
      showToast({ message: "공간 생성에 실패했어요. 다시 시도해주세요.", type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, form, userId, createSpace, createSpaceRound, queryClient, showToast, router]);

  const roundIndex = step - 2;
  const isRoundStep = roundIndex >= 0 && roundIndex < form.roundCount;
  const advancedStep = form.roundCount + 2;
  const confirmStep = form.roundCount + 3;

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
          customized={advancedCustomized}
          onCustomize={() => setAdvancedCustomized(true)}
        />
      );
    }
    if (step === confirmStep) {
      return <ConfirmStep form={form} />;
    }
    return null;
  };

  const isLastStep = step === confirmStep;

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
  const [dateRaw, setDateRaw] = useState(formatDateDisplay(form.startsAt));

  const handleDateChange = (text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, 8);
    const formatted = formatDateDisplay(digits);
    setDateRaw(formatted);
    updateField("startsAt", digits);
  };

  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>운영 설정</Text>
      <Text style={stepStyles.stepDesc}>공간 운영 조건을 설정하세요.</Text>

      <View style={stepStyles.fieldGroup}>
        <Text style={stepStyles.fieldLabel}>시작일 *</Text>
        <TextInput
          style={stepStyles.input}
          placeholder="YYYY.MM.DD"
          placeholderTextColor={Colors.zinc400}
          value={dateRaw}
          onChangeText={handleDateChange}
          keyboardType="numeric"
          maxLength={10}
        />
        {form.startsAt.length > 0 && parseDateInput(form.startsAt) === null && (
          <Text style={stepStyles.errorText}>올바른 날짜를 입력해주세요 (예: 20250101)</Text>
        )}
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
        <Text style={stepStyles.fieldLabel}>모집 인원 (선택)</Text>
        <TextInput
          style={stepStyles.input}
          placeholder="제한 없음"
          placeholderTextColor={Colors.zinc400}
          value={form.maxParticipants}
          onChangeText={(v) => updateField("maxParticipants", v.replace(/\D/g, ""))}
          keyboardType="number-pad"
          maxLength={4}
        />
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

function AdvancedSettingsStep({
  form,
  updateField,
  customized,
  onCustomize,
}: {
  form: FormData;
  updateField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
  customized: boolean;
  onCustomize: () => void;
}) {
  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>고급 설정</Text>
      <Text style={stepStyles.stepDesc}>중심글 전송 주기와 개수를 설정해요.</Text>

      {!customized ? (
        <View style={stepStyles.defaultCard}>
          <View style={stepStyles.defaultCardRow}>
            <Feather name="clock" size={18} color={Colors.zinc500} />
            <Text style={stepStyles.defaultCardText}>
              중심글 전송 간격: <Text style={stepStyles.defaultCardValue}>{form.defaultCenterInterval}일</Text>
            </Text>
          </View>
          <View style={stepStyles.defaultCardRow}>
            <Feather name="file-text" size={18} color={Colors.zinc500} />
            <Text style={stepStyles.defaultCardText}>
              회차당 중심글 수: <Text style={stepStyles.defaultCardValue}>{form.defaultCenterCount}편</Text>
            </Text>
          </View>
          <Text style={stepStyles.defaultCardHint}>기본값으로 진행해요. 아래 버튼으로 변경할 수 있어요.</Text>
          <ScalePressable style={stepStyles.customizeBtn} onPress={onCustomize}>
            <Text style={stepStyles.customizeBtnText}>직접 설정하기</Text>
          </ScalePressable>
        </View>
      ) : (
        <>
          <View style={stepStyles.fieldGroup}>
            <Text style={stepStyles.fieldLabel}>중심글 전송 간격 (일)</Text>
            <TextInput
              style={stepStyles.input}
              placeholder={String(DEFAULT_CENTER_INTERVAL)}
              placeholderTextColor={Colors.zinc400}
              value={String(form.defaultCenterInterval)}
              onChangeText={(v) => {
                const n = parseInt(v, 10);
                if (!isNaN(n) && n >= 1) updateField("defaultCenterInterval", n);
              }}
              keyboardType="number-pad"
              maxLength={3}
              autoFocus
            />
            <Text style={stepStyles.hint}>각 회차 중심글 사이 전송 주기예요</Text>
          </View>

          <View style={stepStyles.fieldGroup}>
            <Text style={stepStyles.fieldLabel}>회차당 중심글 수</Text>
            <TextInput
              style={stepStyles.input}
              placeholder={String(DEFAULT_CENTER_COUNT)}
              placeholderTextColor={Colors.zinc400}
              value={String(form.defaultCenterCount)}
              onChangeText={(v) => {
                const n = parseInt(v, 10);
                if (!isNaN(n) && n >= 1) updateField("defaultCenterCount", n);
              }}
              keyboardType="number-pad"
              maxLength={2}
            />
          </View>
        </>
      )}
    </View>
  );
}

function ConfirmStep({ form }: { form: FormData }) {
  const hasRoundTitles = form.rounds.some((r) => r.title.trim());

  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.stepTitle}>생성 확인</Text>
      <Text style={stepStyles.stepDesc}>입력한 내용을 확인하고 공간을 만들어요.</Text>

      <View style={confirmStyles.section}>
        <Text style={confirmStyles.sectionTitle}>기본 설정</Text>
        <ConfirmRow label="공간 이름" value={form.name} />
        {form.description.trim() ? (
          <ConfirmRow label="설명" value={form.description} />
        ) : null}
        <ConfirmRow label="익명 운영" value={form.isAnonymous ? "예" : "아니요"} />
      </View>

      <View style={confirmStyles.section}>
        <Text style={confirmStyles.sectionTitle}>운영 설정</Text>
        {form.startsAt.trim() && parseDateInput(form.startsAt) ? (
          <ConfirmRow label="시작일" value={formatDateDisplay(form.startsAt)} />
        ) : (
          <ConfirmRow label="시작일" value="미정" muted />
        )}
        <ConfirmRow label="전체 회차" value={`${form.roundCount}회차`} />
        {form.maxParticipants.trim() ? (
          <ConfirmRow label="모집 인원" value={`${form.maxParticipants}명`} />
        ) : (
          <ConfirmRow label="모집 인원" value="제한 없음" muted />
        )}
      </View>

      {hasRoundTitles && (
        <View style={confirmStyles.section}>
          <Text style={confirmStyles.sectionTitle}>회차 구성</Text>
          {form.rounds.map((r, i) =>
            r.title.trim() ? (
              <ConfirmRow key={i} label={`${i + 1}회차`} value={r.title} />
            ) : null,
          )}
        </View>
      )}

      <View style={confirmStyles.section}>
        <Text style={confirmStyles.sectionTitle}>고급 설정</Text>
        <ConfirmRow label="중심글 간격" value={`${form.defaultCenterInterval}일`} />
        <ConfirmRow label="회차당 중심글" value={`${form.defaultCenterCount}편`} />
      </View>
    </View>
  );
}

function ConfirmRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <View style={confirmStyles.row}>
      <Text style={confirmStyles.rowLabel}>{label}</Text>
      <Text style={[confirmStyles.rowValue, muted && confirmStyles.rowValueMuted]}>
        {value}
      </Text>
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
  defaultCard: {
    backgroundColor: Colors.zinc50,
    borderRadius: 14,
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.zinc100,
  },
  defaultCardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  defaultCardText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc600,
  },
  defaultCardValue: {
    ...Typography.bodySemiBold,
    color: Colors.zinc900,
  },
  defaultCardHint: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc400,
    marginTop: 4,
  },
  customizeBtn: {
    marginTop: 4,
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: Colors.zinc900,
  },
  customizeBtnText: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.white,
  },
});

const confirmStyles = StyleSheet.create({
  section: {
    gap: 8,
  },
  sectionTitle: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.zinc400,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
    gap: 16,
  },
  rowLabel: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc500,
    flex: 0,
    minWidth: 90,
  },
  rowValue: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
    flex: 1,
    textAlign: "right",
  },
  rowValueMuted: {
    color: Colors.zinc400,
    fontWeight: "normal",
  },
});
