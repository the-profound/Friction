import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import React, { useState, useRef } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { PageHeader } from "@/components/NavBar/PageHeader";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import ProgressIndicator from "@/components/ProgressIndicator/ProgressIndicator";
import { useToast } from "@/contexts/ToastContext";
import { Colors, Spacing, Typography } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import { useAuth } from "@/contexts/AuthContext";
import { useGetUser, useDeleteUser } from "@workspace/api-client-react";
import {
  AuthSessionUnavailableError,
  createSubmissionLock,
  runAuthenticatedMutation,
} from "@/lib/authenticatedMutation";

const PRIVACY_URL = "https://friction.app/privacy";
const FEEDBACK_URL = "https://open.kakao.com/o/g8fT9bsi";

function resolveAppVersion(): string {
  const v = Constants.expoConfig?.version;
  if (typeof v === "string" && v.length > 0) return v;
  return "—";
}

const appVersion = resolveAppVersion();

export default function MyPageScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useUser();
  const { prepareAuthSession, signOut } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const logoutInflightRef = useRef(false);
  const deleteSubmissionLockRef = useRef(createSubmissionLock());
  const deleteRequestDispatchedRef = useRef(false);

  const {
    data: user,
    isLoading: userLoading,
    isError: userError,
    refetch: refetchUser,
  } = useGetUser(userId);

  const deleteUserMutation = useDeleteUser();

  async function handleLogout() {
    if (logoutInflightRef.current) return;
    logoutInflightRef.current = true;
    try {
      await signOut();
      queryClient.clear();
    } catch {
      showToast({ message: "로그아웃에 실패했습니다.", type: "error" });
    } finally {
      logoutInflightRef.current = false;
    }
  }

  async function handleDeleteConfirm() {
    // State updates are asynchronous; this lock closes the gap before the
    // disabled confirm button is rendered after a fast double tap.
    if (!deleteSubmissionLockRef.current.tryAcquire()) return;

    setIsDeleting(true);
    setDeleteError(null);
    try {
      await runAuthenticatedMutation({
        prepareSession: prepareAuthSession,
        mutate: () => {
          deleteRequestDispatchedRef.current = true;
          return deleteUserMutation.mutateAsync({ id: userId });
        },
      });
      // The server has already removed the Supabase auth identity. signOut
      // clears local state first, but its remote logout can therefore reject.
      // That must not turn a completed account deletion into a retry prompt.
      await signOut().catch(() => undefined);
      queryClient.clear();
      setDeleteModalVisible(false);
      router.replace("/login" as never);
    } catch (error) {
      if (
        error instanceof AuthSessionUnavailableError &&
        deleteRequestDispatchedRef.current
      ) {
        // A previous request may have committed and lost its response. Once
        // the deleted auth identity can no longer authenticate, converge the
        // local app to logged-out state instead of offering an impossible
        // retry. This does not claim whether the ambiguous request committed.
        await signOut().catch(() => undefined);
        queryClient.clear();
        setDeleteModalVisible(false);
        router.replace("/login" as never);
        return;
      }
      setDeleteError(
        error instanceof AuthSessionUnavailableError
          ? "로그인 상태를 확인할 수 없어요. 잠시 후 탈퇴하기를 다시 시도해주세요."
          : "탈퇴 처리에 실패했습니다. 인터넷 연결을 확인한 뒤 탈퇴하기를 다시 눌러주세요.",
      );
    } finally {
      deleteSubmissionLockRef.current.release();
      setIsDeleting(false);
    }
  }

  function openUrl(url: string) {
    Linking.openURL(url).catch(() => {
      showToast({ message: "링크를 열 수 없습니다.", type: "error" });
    });
  }

  return (
    <View style={styles.container}>
      <PageHeader
        title="설정"
        centeredBrandTitle
        showBack
        onBackPress={() => router.back()}
        backAccessibilityLabel="설정에서 돌아가기"
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Section title="활동">
          <SettingRow
            label="수신자 공개 처리한 편지"
            onPress={() => router.push("/user-profile/recipient-only-letters" as never)}
            showChevron
            isLast
          />
        </Section>

        <Section title="내 정보">
          {userLoading ? (
            <View style={styles.loadingRow}>
              <ProgressIndicator type="spinner" size="small" />
              <Text style={styles.loadingText}>불러오는 중...</Text>
            </View>
          ) : userError ? (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>정보를 불러오지 못했습니다.</Text>
              <ScalePressable style={styles.retryButton} contentStyle={styles.retryButtonContent} onPress={() => refetchUser()}>
                <Text style={styles.retryText}>다시 시도</Text>
              </ScalePressable>
            </View>
          ) : (
            <>
              <InfoRow label="표시 이름" value={user?.nickname ?? "—"} />
              <InfoRow label="이메일" value={user?.email ?? "—"} isLast />
            </>
          )}
        </Section>

        <Section title="정책">
          <SettingRow
            label="이용약관"
            onPress={() => router.push("/terms" as never)}
            showChevron
          />
          <SettingRow
            label="개인정보 처리방침"
            onPress={() => openUrl(PRIVACY_URL)}
            showChevron
            isLast
          />
        </Section>

        <Section title="앱 정보">
          <InfoRow label="버전" value={appVersion} />
          <SettingRow
            label="피드백 보내기"
            onPress={() => openUrl(FEEDBACK_URL)}
            showChevron
            isLast
          />
        </Section>

        <Section title="계정">
          <SettingRow
            label="로그아웃"
            onPress={handleLogout}
          />
          <SettingRow
            label="탈퇴하기"
            onPress={() => setDeleteModalVisible(true)}
            textStyle={styles.destructiveText}
            isLast
          />
        </Section>

      </ScrollView>

      <ConfirmModal
        visible={deleteModalVisible}
        title="정말 탈퇴하시겠습니까?"
        description={
          isDeleting
            ? "탈퇴 처리 중입니다..."
            : deleteError ?? "탈퇴하면 모든 데이터가 삭제되며 복구할 수 없습니다."
        }
        confirmLabel={isDeleting ? "처리 중..." : "탈퇴하기"}
        cancelLabel="취소"
        destructive
        confirmDisabled={isDeleting}
        cancelDisabled={isDeleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeleteError(null);
          setDeleteModalVisible(false);
        }}
        onBackdropPress={() => {
          setDeleteError(null);
          setDeleteModalVisible(false);
        }}
      />

    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function SettingRow({
  label,
  onPress,
  textStyle,
  showChevron = false,
  isLast = false,
}: {
  label: string;
  onPress: () => void;
  textStyle?: object;
  showChevron?: boolean;
  isLast?: boolean;
}) {
  return (
    <ScalePressable
      style={[
        styles.rowOuter,
        !isLast && styles.rowBorder,
      ]}
      contentStyle={styles.rowContent}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[styles.rowLabel, textStyle]}>{label}</Text>
      {showChevron && (
        <Feather name="chevron-right" size={18} color={Colors.zinc400} />
      )}
    </ScalePressable>
  );
}

function InfoRow({
  label,
  value,
  isLast = false,
}: {
  label: string;
  value: string;
  isLast?: boolean;
}) {
  return (
    <View style={[styles.row, styles.infoRow, !isLast && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.zinc50,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: 8,
    gap: 24,
  },
  section: {
    gap: 6,
  },
  sectionTitle: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "600",
    color: Colors.zinc500,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 4,
  },
  sectionCard: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.zinc200,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.xl,
    paddingVertical: 15,
    minHeight: 52,
  },
  rowOuter: {
  },
  rowContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 15,
    minHeight: 52,
  },
  infoRow: {
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
  },
  rowLabel: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc900,
  },
  destructiveText: {
    color: "#DC2626",
  },
  infoValue: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc500,
    flex: 1,
    textAlign: "right",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 16,
  },
  loadingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  errorRow: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: 16,
    gap: 8,
  },
  errorText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  retryButton: {
    alignSelf: "flex-start",
  },
  retryButtonContent: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.zinc100,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: {
    ...Typography.caption,
    fontSize: 13,
    fontWeight: "600",
    color: Colors.zinc700,
  },
});
