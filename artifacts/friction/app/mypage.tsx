import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import React, { useState, useRef } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Alert,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import ProgressIndicator from "@/components/ProgressIndicator/ProgressIndicator";
import { Colors, Spacing, Typography } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import { useAuth } from "@/contexts/AuthContext";
import { useGetUser, useDeleteUser } from "@workspace/api-client-react";

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
  const { signOut } = useAuth();
  const queryClient = useQueryClient();

  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const logoutInflightRef = useRef(false);

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
      Alert.alert("오류", "로그아웃에 실패했습니다.");
    } finally {
      logoutInflightRef.current = false;
    }
  }

  async function handleDeleteConfirm() {
    setIsDeleting(true);
    try {
      await deleteUserMutation.mutateAsync({ id: userId });
      await signOut();
      queryClient.clear();
      setDeleteModalVisible(false);
    } catch {
      Alert.alert("오류", "탈퇴 처리에 실패했습니다. 다시 시도해주세요.");
      setDeleteModalVisible(false);
    } finally {
      setIsDeleting(false);
    }
  }

  function openUrl(url: string) {
    Linking.openURL(url).catch(() => {
      Alert.alert("오류", "링크를 열 수 없습니다.");
    });
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ScalePressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}
        contentStyle={styles.backButtonContent}
        >
          <Feather name="chevron-left" size={24} color={Colors.zinc700} />
        </ScalePressable>
        <Text style={styles.headerTitle}>설정 및 활동</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Section title="내 정보">
          {userLoading ? (
            <View style={styles.loadingRow}>
              <ProgressIndicator type="spinner" size="small" />
              <Text style={styles.loadingText}>불러오는 중...</Text>
            </View>
          ) : userError ? (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>정보를 불러오지 못했습니다.</Text>
              <ScalePressable style={styles.retryButton} onPress={() => refetchUser()}>
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

        <Section title="활동">
          <SettingRow
            label="이웃 목록"
            onPress={() => router.push("/mypage-neighbors" as never)}
            showChevron
            isLast
          />
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
            : "탈퇴하면 모든 데이터가 삭제되며 복구할 수 없습니다."
        }
        confirmLabel={isDeleting ? "처리 중..." : "탈퇴하기"}
        cancelLabel="취소"
        destructive
        onConfirm={isDeleting ? () => {} : handleDeleteConfirm}
        onCancel={isDeleting ? () => {} : () => setDeleteModalVisible(false)}
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
      style={({ pressed }) => [
        styles.row,
        !isLast && styles.rowBorder,
        pressed && styles.rowPressed,
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    backgroundColor: Colors.zinc50,
  },
  backButton: {
    width: 36,
    height: 36,
  },
  backButtonContent: {
    alignItems: "center",
    justifyContent: "center",},
  headerTitle: {
    flex: 1,
    textAlign: "center",
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  headerSpacer: {
    width: 36,
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
  rowContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flex: 1,
  },
  infoRow: {
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
  },
  rowPressed: {
    backgroundColor: Colors.zinc50,
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
    color: Colors.zinc400,
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
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.zinc100,
    borderRadius: 8,
  },
  retryText: {
    ...Typography.caption,
    fontSize: 13,
    fontWeight: "600",
    color: Colors.zinc700,
  },
});
