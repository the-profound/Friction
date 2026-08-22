import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Toggle from "@/components/shared/Toggle";
import { Colors, Typography } from "@/constants/tokens";

export type SpaceBasicSettingsValues = {
  name: string;
  description: string;
  isAnonymous: boolean;
  spaceNickname?: string;
};

type SpaceBasicSettingsFormProps = {
  value: SpaceBasicSettingsValues;
  onChange: (value: SpaceBasicSettingsValues) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  showSpaceNickname?: boolean;
};

/**
 * Shared creation/edit inputs for the creation-time space settings. The caller
 * owns the form state so it can choose its own loading and save behavior.
 */
export default function SpaceBasicSettingsForm({
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  showSpaceNickname = true,
}: SpaceBasicSettingsFormProps) {
  const update = <K extends keyof SpaceBasicSettingsValues>(
    key: K,
    nextValue: SpaceBasicSettingsValues[K],
  ) => onChange({ ...value, [key]: nextValue });

  return (
    <View style={styles.container}>
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>공간 이름 *</Text>
        <TextInput
          testID="space-basic-settings-name"
          style={styles.input}
          placeholder="예: 2025 독서 모임"
          placeholderTextColor={Colors.zinc400}
          value={value.name}
          onChangeText={(next) => update("name", next)}
          maxLength={50}
          editable={!disabled}
          autoFocus={autoFocus}
          returnKeyType="next"
          accessibilityLabel="공간 이름"
        />
        <Text style={styles.charCount}>{value.name.length} / 50</Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>설명 (선택)</Text>
        <TextInput
          testID="space-basic-settings-description"
          style={[styles.input, styles.inputMulti]}
          placeholder="이 공간은 어떤 목적으로 운영되나요?"
          placeholderTextColor={Colors.zinc400}
          value={value.description}
          onChangeText={(next) => update("description", next)}
          multiline
          textAlignVertical="top"
          maxLength={300}
          editable={!disabled}
          accessibilityLabel="공간 설명"
        />
        <Text style={styles.charCount}>{value.description.length} / 300</Text>
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.toggleInfo}>
          <Text style={styles.fieldLabel}>익명 운영</Text>
          <Text style={styles.toggleDesc}>참여자 이름이 공개되지 않아요</Text>
          {value.isAnonymous ? (
            <Text style={styles.toggleNotice}>
              공간장도 익명으로 참여하며, 다른 참여자에게 공간장 표시가 보이지
              않습니다
            </Text>
          ) : null}
        </View>
        <Toggle
          value={value.isAnonymous}
          onValueChange={(next) => update("isAnonymous", next)}
          disabled={disabled}
          accessibilityLabel="익명 운영"
          testID="space-basic-settings-anonymous"
        />
      </View>

      {value.isAnonymous && showSpaceNickname ? (
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>이 공간에서 사용할 닉네임 *</Text>
          <TextInput
            testID="space-basic-settings-nickname"
            style={styles.input}
            placeholder="예: 달빛"
            placeholderTextColor={Colors.zinc400}
            value={value.spaceNickname ?? ""}
            onChangeText={(next) => update("spaceNickname", next)}
            maxLength={20}
            editable={!disabled}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            accessibilityLabel="공간 닉네임"
          />
          <Text style={styles.hint}>
            시작 전에는 모두 ‘참여자’로 표시되고, 시작 후 이 닉네임으로
            표시돼요.
          </Text>
          <Text style={styles.charCount}>
            {(value.spaceNickname ?? "").trim().length} / 20
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 24,
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
    color: Colors.zinc400, // typography-ok: secondary form guidance
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
});
