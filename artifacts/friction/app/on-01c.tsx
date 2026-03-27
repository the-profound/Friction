import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import {
  useGetArticle,
  useUpdateArticle,
  useTransitionArticleStatus,
  TransitionArticleBodyTargetStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const BACKGROUND_COLORS = [
  { key: "default", label: "기본", color: Colors.zinc50 },
  { key: "warm", label: "따뜻한", color: "#FEF3C7" },
  { key: "cool", label: "시원한", color: "#DBEAFE" },
  { key: "nature", label: "자연", color: "#D1FAE5" },
  { key: "soft", label: "부드러운", color: "#FCE7F3" },
];

export default function ClosingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const articleQuery = useGetArticle(id ?? "");
  const article = id ? articleQuery.data : undefined;
  const articleLoading = id ? articleQuery.isLoading : false;

  const updateArticle = useUpdateArticle();
  const transitionStatus = useTransitionArticleStatus();

  const [title, setTitle] = useState("");
  const [pages, setPages] = useState<string[]>([]);
  const [previewPage, setPreviewPage] = useState(0);
  const [bgColorKey, setBgColorKey] = useState("default");
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (article && !initializedRef.current) {
      initializedRef.current = true;
      setTitle(article.title || "");
      setPages(article.pages || []);
      const styleKey = (article.style as Record<string, unknown>)?.bgColor;
      if (typeof styleKey === "string") setBgColorKey(styleKey);
    }
  }, [article]);

  const selectedBg = BACKGROUND_COLORS.find((b) => b.key === bgColorKey) || BACKGROUND_COLORS[0];

  const handleExport = useCallback(() => {
    if (!title.trim()) {
      Alert.alert("내보내기 불가", "제목을 입력해주세요.");
      return;
    }
    if (pages.length === 0) {
      Alert.alert("내보내기 불가", "페이지가 없습니다.");
      return;
    }
    setConfirmVisible(true);
  }, [title, pages]);

  const handleConfirmExport = useCallback(async () => {
    setConfirmVisible(false);
    try {
      await updateArticle.mutateAsync({
        id: id!,
        data: {
          title,
          pages,
          style: { bgColor: bgColorKey },
        },
      });
      await transitionStatus.mutateAsync({
        id: id!,
        data: { targetStatus: TransitionArticleBodyTargetStatus.LETTER },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      Alert.alert("완성!", "편지가 완성되었습니다.", [
        { text: "확인", onPress: () => router.back() },
      ]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "내보내기에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [id, title, pages, bgColorKey, updateArticle, transitionStatus, queryClient, router]);

  const handleBack = useCallback(async () => {
    if (!id) { router.back(); return; }
    try {
      await transitionStatus.mutateAsync({
        id,
        data: { targetStatus: TransitionArticleBodyTargetStatus.DIVIDING },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      router.back();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "상태 되돌리기에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [id, router, transitionStatus, queryClient]);

  const handleSaveTitle = useCallback(async () => {
    setTitleEditing(false);
    if (!id) return;
    try {
      await updateArticle.mutateAsync({ id, data: { title } });
    } catch (e: unknown) {
      console.warn("Failed to save title:", e instanceof Error ? e.message : e);
    }
  }, [id, title, updateArticle]);

  const currentPage = pages[previewPage] ?? null;

  if (!id || articleLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.zinc400} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>마감</Text>
          {pages.length > 0 && (
            <Text style={styles.pageIndicator}>
              {previewPage + 1} / {pages.length}
            </Text>
          )}
        </View>
        <Pressable onPress={handleExport} hitSlop={12}>
          <Text style={styles.exportButton}>내보내기</Text>
        </Pressable>
      </View>

      <View style={styles.titleSection}>
        {titleEditing ? (
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            onBlur={handleSaveTitle}
            onSubmitEditing={handleSaveTitle}
            autoFocus
            maxLength={100}
          />
        ) : (
          <Pressable style={styles.titleRow} onPress={() => setTitleEditing(true)}>
            <Text style={styles.titleText} numberOfLines={1}>
              {title || "제목 없음"}
            </Text>
            <Feather name="edit-2" size={14} color={Colors.zinc400} />
          </Pressable>
        )}
      </View>

      <View style={styles.bgColorSection}>
        <Text style={styles.sectionLabel}>배경 색상</Text>
        <View style={styles.bgColorRow}>
          {BACKGROUND_COLORS.map((bg) => (
            <Pressable
              key={bg.key}
              style={[
                styles.bgColorChip,
                { backgroundColor: bg.color },
                bgColorKey === bg.key && styles.bgColorChipActive,
              ]}
              onPress={() => setBgColorKey(bg.key)}
            >
              {bgColorKey === bg.key && (
                <Feather name="check" size={14} color={Colors.zinc700} />
              )}
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView style={styles.previewArea} contentContainerStyle={styles.previewInner}>
        {pages.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Feather name="eye" size={36} color={Colors.zinc300} />
            <Text style={styles.emptyTitle}>미리보기할 내용이 없어요</Text>
          </View>
        ) : (
          <View style={[styles.previewCard, { backgroundColor: selectedBg.color }]}>
            <Text style={styles.previewTitle}>{title || "제목 없음"}</Text>
            <Text style={styles.previewContent}>{currentPage}</Text>
          </View>
        )}
      </ScrollView>

      {pages.length > 1 && (
        <View style={[styles.pageNav, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable
            style={[styles.pageNavButton, previewPage === 0 && styles.pageNavButtonDisabled]}
            onPress={() => setPreviewPage((p) => Math.max(0, p - 1))}
            disabled={previewPage === 0}
          >
            <Feather
              name="chevron-left"
              size={20}
              color={previewPage === 0 ? Colors.zinc300 : Colors.zinc600}
            />
          </Pressable>
          <Text style={styles.pageNavText}>
            {previewPage + 1} / {pages.length}
          </Text>
          <Pressable
            style={[
              styles.pageNavButton,
              previewPage >= pages.length - 1 && styles.pageNavButtonDisabled,
            ]}
            onPress={() => setPreviewPage((p) => Math.min(pages.length - 1, p + 1))}
            disabled={previewPage >= pages.length - 1}
          >
            <Feather
              name="chevron-right"
              size={20}
              color={previewPage >= pages.length - 1 ? Colors.zinc300 : Colors.zinc600}
            />
          </Pressable>
        </View>
      )}

      <ConfirmModal
        visible={confirmVisible}
        title="편지로 내보내기"
        description="내보내면 더 이상 수정할 수 없어요. 진행할까요?"
        confirmLabel="내보내기"
        cancelLabel="취소"
        destructive
        onConfirm={handleConfirmExport}
        onCancel={() => setConfirmVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 12,
  },
  headerCenter: {
    alignItems: "center",
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  pageIndicator: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    marginTop: 2,
  },
  exportButton: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  titleSection: {
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  titleText: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.zinc900,
    flex: 1,
  },
  titleInput: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.zinc900,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc300,
  },
  bgColorSection: {
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 12,
  },
  sectionLabel: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    marginBottom: 8,
  },
  bgColorRow: {
    flexDirection: "row",
    gap: 10,
  },
  bgColorChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.zinc200,
  },
  bgColorChipActive: {
    borderWidth: 2,
    borderColor: Colors.zinc700,
  },
  previewArea: {
    flex: 1,
  },
  previewInner: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 16,
    paddingBottom: 40,
  },
  previewCard: {
    borderRadius: 16,
    padding: 24,
    minHeight: 400,
  },
  previewTitle: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
    marginBottom: 20,
  },
  previewContent: {
    ...Typography.body,
    fontSize: 16,
    lineHeight: 28,
    color: Colors.zinc800,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 80,
    gap: 8,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
    marginTop: 8,
  },
  pageNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 12,
    gap: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc100,
  },
  pageNavButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.zinc50,
    alignItems: "center",
    justifyContent: "center",
  },
  pageNavButtonDisabled: {
    opacity: 0.5,
  },
  pageNavText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc600,
  },
});
