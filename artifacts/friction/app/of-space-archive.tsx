import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";
import HeaderButton from "@/components/shared/HeaderButton";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import { useToast } from "@/contexts/ToastContext";
import {
  useUpdateSpace,
  getListSpacesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/contexts/UserContext";
import { getUserScopedSpaceJoinContextQueryKey } from "@/lib/spaceJoinContextQuery";

export default function SpaceArchiveScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, spaceName } = useLocalSearchParams<{ id: string; spaceName?: string }>();
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [archiving, setArchiving] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  const updateSpace = useUpdateSpace();

  const handleArchive = useCallback(() => {
    setShowArchiveConfirm(true);
  }, []);

  const confirmArchive = useCallback(async () => {
    setArchiving(true);
    try {
      await updateSpace.mutateAsync({
        id,
        data: { status: "ARCHIVED" },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListSpacesQueryKey({ userId }) }),
        queryClient.invalidateQueries({
          queryKey: getUserScopedSpaceJoinContextQueryKey(id, userId),
        }),
      ]);
      setShowArchiveConfirm(false);
      router.back();
    } catch {
      setShowArchiveConfirm(false);
      showToast({ message: "보관 처리에 실패했어요. 다시 시도해주세요.", type: "error" });
    } finally {
      setArchiving(false);
    }
  }, [id, userId, updateSpace, queryClient, router, showToast]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <HeaderButton
          variant="back"
          onPress={() => router.back()}
          accessibilityLabel="공간 상세로 돌아가기"
        />
        <Text style={styles.headerTitle} numberOfLines={1}>
          공간 보관
        </Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={[styles.content, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.title}>공간을 보관하시겠어요?</Text>
        <Text style={styles.subtitle}>
          {spaceName ? `'${spaceName}'` : "이 공간"}을 보관 상태로 전환합니다.
        </Text>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Feather name="check" size={14} color={Colors.zinc500} />
            <Text style={styles.infoText}>공간과 모든 회차 기록은 유지돼요</Text>
          </View>
          <View style={styles.infoRow}>
            <Feather name="check" size={14} color={Colors.zinc500} />
            <Text style={styles.infoText}>참여자 목록과 편지는 그대로 볼 수 있어요</Text>
          </View>
          <View style={styles.infoRow}>
            <Feather name="x" size={14} color={Colors.zinc400} />
            <Text style={styles.infoTextDisabled}>새 편지나 참여자 추가가 불가해요</Text>
          </View>
          <View style={styles.infoRow}>
            <Feather name="x" size={14} color={Colors.zinc400} />
            <Text style={styles.infoTextDisabled}>보관 후에는 되돌릴 수 없어요</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <ScalePressable
            style={styles.cancelButtonOuter}
            contentStyle={styles.cancelButton}
            onPress={() => router.back()}
            disabled={archiving}
          >
            <Text style={styles.cancelButtonText}>취소</Text>
          </ScalePressable>
          <ScalePressable
            style={styles.archiveButtonOuter}
            contentStyle={[styles.archiveButton, archiving && styles.archiveButtonDisabled]}
            onPress={handleArchive}
            disabled={archiving}
          >
            <Text style={styles.archiveButtonText}>
              {archiving ? "처리 중..." : "보관하기"}
            </Text>
          </ScalePressable>
        </View>
      </View>

      <ConfirmModal
        visible={showArchiveConfirm}
        title="공간 보관"
        description={`'${spaceName ?? "이 공간"}'을 보관 상태로 전환하시겠어요?\n보관 후에는 새 편지나 참여자를 추가할 수 없어요.`}
        onCancel={() => setShowArchiveConfirm(false)}
        onConfirm={confirmArchive}
        confirmLabel="보관하기"
        destructive
        confirmDisabled={archiving}
        cancelDisabled={archiving}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc200,
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
    flex: 1,
    textAlign: "center",
    marginHorizontal: 8,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 48,
    alignItems: "center",
  },
  title: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
    marginBottom: 8,
  },
  subtitle: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 32,
  },
  infoCard: {
    width: "100%",
    backgroundColor: Colors.zinc50,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    padding: 16,
    gap: 10,
    marginBottom: 40,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  infoText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc700,
  },
  infoTextDisabled: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400, // typography-ok: explicitly disabled info text
  },
  actions: {
    width: "100%",
    flexDirection: "row",
    gap: 12,
    marginTop: "auto",
    alignItems: "stretch",
  },
  cancelButtonOuter: {
    flex: 1,
    height: 52,
    flexGrow: 1,
    flexShrink: 0,
  },
  cancelButton: {
    height: "100%",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.white,
  },
  cancelButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc700,
  },
  archiveButtonOuter: {
    flex: 2,
    height: 52,
    flexGrow: 1,
    flexShrink: 0,
  },
  archiveButton: {
    height: "100%",
    borderRadius: 12,
    backgroundColor: Colors.zinc900,
    alignItems: "center",
    justifyContent: "center",
  },
  archiveButtonDisabled: {
    opacity: 0.5,
  },
  archiveButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
});
