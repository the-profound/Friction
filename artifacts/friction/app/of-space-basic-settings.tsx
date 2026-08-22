import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSpaceBasicSettingsQueryKey,
  getGetSpaceJoinContextQueryKey,
  getListSpacesQueryKey,
  useGetSpaceBasicSettings,
  useUpdateSpaceBasicSettings,
} from "@workspace/api-client-react";
import type {
  SpaceJoinContext,
  SpaceListItem,
} from "@workspace/api-client-react";
import SpaceBasicSettingsForm, {
  type SpaceBasicSettingsValues,
} from "@/components/SpaceBasicSettingsForm/SpaceBasicSettingsForm";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import ScalePressable from "@/components/shared/ScalePressable";
import SubmitButton from "@/components/SubmitButton/SubmitButton";
import SubmitProgressOverlay from "@/components/shared/SubmitProgressOverlay";
import { Colors, Spacing, Typography } from "@/constants/tokens";
import { useToast } from "@/contexts/ToastContext";
import { useUser } from "@/contexts/UserContext";

function getServerErrorMessage(error: unknown): string | null {
  const data = (error as { data?: unknown })?.data;
  if (!data || typeof data !== "object") return null;
  const message = (data as { error?: unknown }).error;
  return typeof message === "string" && message.trim() ? message : null;
}

export default function SpaceBasicSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { userId } = useUser();
  const { showToast } = useToast();
  const updateSettings = useUpdateSpaceBasicSettings();
  const [form, setForm] = useState<SpaceBasicSettingsValues | null>(null);
  const initializedSpaceIdRef = useRef<string | null>(null);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const settingsQuery = useGetSpaceBasicSettings(id, {
    query: {
      enabled: !!id && !!userId,
      queryKey: getGetSpaceBasicSettingsQueryKey(id),
    },
  });

  useEffect(() => {
    initializedSpaceIdRef.current = null;
    setForm(null);
  }, [id]);

  useEffect(() => {
    if (!settingsQuery.data || initializedSpaceIdRef.current === id) return;
    initializedSpaceIdRef.current = id;
    setForm({
      name: settingsQuery.data.name,
      description: settingsQuery.data.description ?? "",
      isAnonymous: settingsQuery.data.isAnonymous,
    });
  }, [id, settingsQuery.data]);

  const isValid = useMemo(() => {
    if (!form) return false;
    const nameLength = form.name.trim().length;
    return (
      nameLength >= 1 && nameLength <= 50 && form.description.length <= 300
    );
  }, [form]);

  const handleSave = useCallback(async () => {
    if (!form || updateSettings.isPending) return;
    if (!userId) {
      showToast({ message: "로그인이 필요합니다.", type: "error" });
      return;
    }

    const name = form.name.trim();
    const description = form.description.trim();
    if (!name || name.length > 50) {
      showToast({
        message: "공간 이름은 1~50자로 입력해주세요.",
        type: "error",
      });
      return;
    }
    if (description.length > 300) {
      showToast({
        message: "공간 설명은 최대 300자로 입력해주세요.",
        type: "error",
      });
      return;
    }
    try {
      const updated = await updateSettings.mutateAsync({
        id,
        data: {
          name,
          description: description || null,
          isAnonymous: form.isAnonymous,
        },
      });

      const detailKey = getGetSpaceJoinContextQueryKey(id, { userId });
      queryClient.setQueryData<SpaceJoinContext>(detailKey, (previous) =>
        previous
          ? {
              ...previous,
              space: {
                ...previous.space,
                name: updated.name,
                description: updated.description,
                isAnonymous: updated.isAnonymous,
              },
            }
          : previous,
      );
      queryClient.setQueriesData<SpaceListItem[]>(
        { queryKey: getListSpacesQueryKey() },
        (previous) =>
          previous?.map((space) =>
            space.id === id
              ? {
                  ...space,
                  name: updated.name,
                  description: updated.description,
                  isAnonymous: updated.isAnonymous,
                }
              : space,
          ),
      );
      queryClient.setQueryData(getGetSpaceBasicSettingsQueryKey(id), updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: detailKey }),
        queryClient.invalidateQueries({ queryKey: getListSpacesQueryKey() }),
      ]);

      showToast({ message: "기본 설정을 저장했어요.", type: "success" });
      router.back();
    } catch (error) {
      showToast({
        message:
          getServerErrorMessage(error) ??
          "기본 설정 저장에 실패했어요. 다시 시도해주세요.",
        type: "error",
      });
    }
  }, [form, id, queryClient, router, showToast, updateSettings, userId]);

  const renderBody = () => {
    if (settingsQuery.isLoading || !form) {
      if (settingsQuery.isError) {
        return (
          <View style={styles.centerContent}>
            <Feather name="alert-circle" size={36} color={Colors.zinc300} />
            <Text style={styles.errorTitle}>기본 설정을 불러오지 못했어요</Text>
            <Text style={styles.errorDescription}>
              {getServerErrorMessage(settingsQuery.error) ??
                "잠시 후 다시 시도해주세요."}
            </Text>
            <ScalePressable
              testID="space-basic-settings-retry"
              style={styles.retryButton}
              contentStyle={styles.retryButtonContent}
              onPress={() => settingsQuery.refetch()}
            >
              <Text style={styles.retryButtonText}>다시 시도</Text>
            </ScalePressable>
          </View>
        );
      }
      return (
        <View style={styles.centerContent}>
          <ActivityIndicator color={Colors.zinc400} />
        </View>
      );
    }

    return (
      <KeyboardAwareScrollViewCompat
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.screenTitle}>기본 설정</Text>
        <Text style={styles.screenDescription}>
          공간을 시작하기 전까지 이름과 소개, 익명 운영 여부를 바꿀 수 있어요.
        </Text>
        <SpaceBasicSettingsForm
          value={form}
          onChange={setForm}
          disabled={updateSettings.isPending}
          showSpaceNickname={false}
        />
      </KeyboardAwareScrollViewCompat>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.container, { paddingTop: topInset }]}>
        <View style={styles.header}>
          <ScalePressable
            testID="space-basic-settings-back"
            style={styles.backButton}
            contentStyle={styles.backButtonContent}
            onPress={() => router.back()}
            disabled={updateSettings.isPending}
            hitSlop={8}
          >
            <Feather name="chevron-left" size={24} color={Colors.zinc700} />
          </ScalePressable>
          <Text style={styles.headerTitle}>기본 설정</Text>
          <View style={styles.headerRight} />
        </View>

        {renderBody()}

        {!settingsQuery.isLoading && !settingsQuery.isError && form ? (
          <View style={[styles.footer, { paddingBottom: bottomInset + 16 }]}>
            <SubmitButton
              testID="space-basic-settings-save"
              style={styles.saveButton}
              contentStyle={styles.saveButtonContent}
              disabledStyle={styles.saveButtonDisabled}
              textStyle={styles.saveButtonText}
              disabledTextStyle={styles.saveButtonTextDisabled}
              onPress={handleSave}
              pending={updateSettings.isPending}
              pendingLabel="저장 중..."
              disabled={!isValid}
              label="저장하기"
            />
          </View>
        ) : null}
      </View>

      <SubmitProgressOverlay
        visible={updateSettings.isPending}
        message="기본 설정을 저장하는 중이에요"
        subMessage="잠시만 기다려주세요"
      />
    </KeyboardAvoidingView>
  );
}

const HEADER_BUTTON_SIZE = 36;
const SAVE_BUTTON_HEIGHT = 52;
const RETRY_BUTTON_HEIGHT = 40;

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
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backButton: {
    width: HEADER_BUTTON_SIZE,
    height: HEADER_BUTTON_SIZE,
    flexGrow: 0,
    flexShrink: 0,
  },
  backButtonContent: {
    width: HEADER_BUTTON_SIZE,
    height: HEADER_BUTTON_SIZE,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  headerRight: {
    width: HEADER_BUTTON_SIZE,
    height: HEADER_BUTTON_SIZE,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 24,
  },
  screenTitle: {
    ...Typography.bodySemiBold,
    fontSize: 22,
    color: Colors.zinc900,
  },
  screenDescription: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc500,
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 24,
  },
  footer: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.zinc100,
    backgroundColor: Colors.white,
  },
  saveButton: {
    height: SAVE_BUTTON_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: 14,
    backgroundColor: Colors.zinc900,
  },
  saveButtonContent: {
    height: SAVE_BUTTON_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
  },
  saveButtonDisabled: {
    backgroundColor: Colors.zinc200,
  },
  saveButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
  saveButtonTextDisabled: {
    color: Colors.white,
  },
  centerContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.screenPx,
    gap: 10,
  },
  errorTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc700,
    marginTop: 4,
  },
  errorDescription: {
    ...Typography.body,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.zinc500,
    textAlign: "center",
  },
  retryButton: {
    height: RETRY_BUTTON_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: 10,
    backgroundColor: Colors.zinc900,
    marginTop: 8,
  },
  retryButtonContent: {
    height: RETRY_BUTTON_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  retryButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
});
