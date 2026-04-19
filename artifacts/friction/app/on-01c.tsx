import React, { useState, useCallback, useEffect, useRef } from "react";
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
import CoverPreview from "@/components/CoverPreview/CoverPreview";
import CoverEditor from "@/components/CoverEditor/CoverEditor";
import MyCollectionsModal from "@/components/MyCollectionsModal/MyCollectionsModal";
import { resolveArticleCover, getDefaultCover } from "@/utils/articleCover";
import { useUser } from "@/contexts/UserContext";
import {
  useGetArticle,
  useUpdateArticle,
  useTransitionArticleStatus,
  useListMyCollections,
  useAddArticleToMyCollection,
  TransitionArticleBodyTargetStatus,
} from "@workspace/api-client-react";
import type { ArticleCover } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

export default function ClosingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useUser();

  const articleQuery = useGetArticle(id ?? "");
  const article = id ? articleQuery.data : undefined;
  const articleLoading = id ? articleQuery.isLoading : false;

  const { refetch: refetchArticle } = articleQuery;
  useEffect(() => {
    if (id) refetchArticle();
  // Run once on mount to ensure fresh data when navigating here without going home first
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateArticle = useUpdateArticle();
  const transitionStatus = useTransitionArticleStatus();
  const addArticleToMyCollection = useAddArticleToMyCollection();

  const myCollectionsQuery = useListMyCollections({ ownerId: userId });
  const myCollections = (myCollectionsQuery.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    articleCount: (c as { articleCount?: number }).articleCount,
  }));

  const [title, setTitle] = useState("");
  const [pages, setPages] = useState<string[]>([]);
  const [previewPage, setPreviewPage] = useState(0);
  const [cover, setCover] = useState<ArticleCover>(getDefaultCover());
  const [coverEditorVisible, setCoverEditorVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [collectionPickerVisible, setCollectionPickerVisible] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const exportedArticleIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const saveCoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!article) return;
    // pages는 이 화면에서 편집하지 않으므로 항상 서버 데이터로 동기화
    const incoming = article.pages || [];
    setPages((prev) => {
      // 실제로 변경된 경우에만 previewPage 초기화 + 상태 업데이트
      if (JSON.stringify(prev) === JSON.stringify(incoming)) return prev;
      setPreviewPage(0);
      return incoming;
    });
    // title·cover는 이 화면에서 편집하므로 최초 1회만 초기화
    if (!initializedRef.current) {
      initializedRef.current = true;
      setTitle(article.title || "");
      setCover(resolveArticleCover(article.cover));
    }
  }, [article]);

  const pendingCoverRef = useRef<ArticleCover | null>(null);

  const flushCoverSave = useCallback(async () => {
    if (saveCoverTimerRef.current) {
      clearTimeout(saveCoverTimerRef.current);
      saveCoverTimerRef.current = null;
    }
    const pending = pendingCoverRef.current;
    if (!pending || !id) return;
    pendingCoverRef.current = null;
    try {
      await updateArticle.mutateAsync({
        id,
        data: { cover: pending },
      });
    } catch (e: unknown) {
      console.warn("Failed to save cover:", e instanceof Error ? e.message : e);
    }
  }, [id, updateArticle]);

  const handleCoverChange = useCallback(
    (next: ArticleCover) => {
      setCover(next);
      pendingCoverRef.current = next;
      if (!id) return;
      if (saveCoverTimerRef.current) clearTimeout(saveCoverTimerRef.current);
      saveCoverTimerRef.current = setTimeout(async () => {
        saveCoverTimerRef.current = null;
        const toSave = pendingCoverRef.current;
        if (!toSave) return;
        pendingCoverRef.current = null;
        try {
          await updateArticle.mutateAsync({
            id,
            data: { cover: toSave },
          });
        } catch (e: unknown) {
          console.warn("Failed to save cover:", e instanceof Error ? e.message : e);
        }
      }, 500);
    },
    [id, updateArticle],
  );

  useEffect(() => {
    return () => {
      if (saveCoverTimerRef.current) clearTimeout(saveCoverTimerRef.current);
    };
  }, []);

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
    if (saveCoverTimerRef.current) {
      clearTimeout(saveCoverTimerRef.current);
      saveCoverTimerRef.current = null;
    }
    pendingCoverRef.current = null;
    setIsExporting(true);
    try {
      await updateArticle.mutateAsync({
        id: id!,
        data: { title, pages, cover },
      });
      const { data: freshArticle } = await refetchArticle();
      const currentStatus = freshArticle?.status ?? article?.status;
      if (currentStatus !== "LETTER") {
        const updated = await transitionStatus.mutateAsync({
          id: id!,
          data: { targetStatus: TransitionArticleBodyTargetStatus.LETTER },
        });
        queryClient.setQueryData([`/api/articles/${id}`], updated);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      exportedArticleIdRef.current = id!;
      setCollectionPickerVisible(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "내보내기에 실패했습니다.";
      Alert.alert("내보내기 실패", msg);
    } finally {
      setIsExporting(false);
    }
  }, [id, title, pages, cover, article, refetchArticle, updateArticle, transitionStatus, queryClient]);

  const handleCollectionSelect = useCallback(
    async (collection: { id: string; name: string }) => {
      setCollectionPickerVisible(false);
      const articleId = exportedArticleIdRef.current;
      if (!articleId) return;
      try {
        await addArticleToMyCollection.mutateAsync({
          id: collection.id,
          data: { articleId },
        });
        queryClient.invalidateQueries({ queryKey: ["/api/my-collections"] });
        router.dismissAll();
        router.push({ pathname: "/of-01" });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "모음 저장에 실패했습니다.";
        Alert.alert("저장 실패", msg);
      }
    },
    [addArticleToMyCollection, queryClient, router],
  );

  const handleBack = useCallback(async () => {
    await flushCoverSave();
    queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
    router.replace("/(tabs)/on");
  }, [router, queryClient, flushCoverSave]);

  const handleSaveTitle = useCallback(async () => {
    setTitleEditing(false);
    if (!id) return;
    try {
      await updateArticle.mutateAsync({ id, data: { title } });
    } catch (e: unknown) {
      console.warn("Failed to save title:", e instanceof Error ? e.message : e);
    }
  }, [id, title, updateArticle]);

  const hasCoverPage = cover.type !== "default";
  const totalVirtualPages = pages.length > 0
    ? (hasCoverPage ? pages.length + 1 : pages.length)
    : 0;

  const clampedPreviewPage = totalVirtualPages > 0
    ? Math.min(previewPage, totalVirtualPages - 1)
    : 0;
  const isCoverPage = hasCoverPage && clampedPreviewPage === 0;
  const contentPageIndex = hasCoverPage ? clampedPreviewPage - 1 : clampedPreviewPage;
  const currentPage = isCoverPage ? null : (pages[contentPageIndex] ?? null);

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
          {totalVirtualPages > 0 && (
            <Text style={styles.pageIndicator}>
              {isCoverPage ? "표지" : `${Math.max(0, contentPageIndex) + 1} / ${pages.length}`}
            </Text>
          )}
        </View>
        <Pressable onPress={handleExport} hitSlop={12} disabled={isExporting}>
          {isExporting ? (
            <ActivityIndicator size="small" color={Colors.zinc400} />
          ) : (
            <Text style={styles.exportButton}>내보내기</Text>
          )}
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

      <View style={styles.coverActionSection}>
        <Pressable
          style={styles.coverActionButton}
          onPress={() => setCoverEditorVisible(true)}
        >
          <Feather name="image" size={16} color={Colors.zinc600} />
          <Text style={styles.coverActionLabel}>
            {cover.type === "default" ? "표지 만들기" : "표지 수정"}
          </Text>
          <Feather name="chevron-right" size={16} color={Colors.zinc400} />
        </Pressable>
      </View>

      <ScrollView style={styles.previewArea} contentContainerStyle={styles.previewInner}>
        {totalVirtualPages === 0 ? (
          <View style={styles.emptyContainer}>
            <Feather name="eye" size={36} color={Colors.zinc300} />
            <Text style={styles.emptyTitle}>미리보기할 내용이 없어요</Text>
          </View>
        ) : isCoverPage ? (
          <View style={styles.coverPreviewWrapper}>
            <CoverPreview cover={cover} title={title} author={article?.authorId} />
          </View>
        ) : (
          <View
            style={[
              styles.previewCard,
              {
                backgroundColor:
                  cover.type === "color" && cover.bgColor ? cover.bgColor : Colors.zinc50,
              },
            ]}
          >
            <Text style={styles.previewTitle}>{title || "제목 없음"}</Text>
            <Text style={styles.previewContent}>{currentPage}</Text>
          </View>
        )}
      </ScrollView>

      {totalVirtualPages > 1 && (
        <View style={[styles.pageNav, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable
            style={[styles.pageNavButton, clampedPreviewPage === 0 && styles.pageNavButtonDisabled]}
            onPress={() => setPreviewPage((p) => Math.max(0, p - 1))}
            disabled={clampedPreviewPage === 0}
          >
            <Feather
              name="chevron-left"
              size={20}
              color={clampedPreviewPage === 0 ? Colors.zinc300 : Colors.zinc600}
            />
          </Pressable>
          <Text style={styles.pageNavText}>
            {isCoverPage ? "표지" : `${Math.max(0, contentPageIndex) + 1} / ${pages.length}`}
          </Text>
          <Pressable
            style={[
              styles.pageNavButton,
              clampedPreviewPage >= totalVirtualPages - 1 && styles.pageNavButtonDisabled,
            ]}
            onPress={() => setPreviewPage((p) => Math.min(totalVirtualPages - 1, p + 1))}
            disabled={clampedPreviewPage >= totalVirtualPages - 1}
          >
            <Feather
              name="chevron-right"
              size={20}
              color={clampedPreviewPage >= totalVirtualPages - 1 ? Colors.zinc300 : Colors.zinc600}
            />
          </Pressable>
        </View>
      )}

      <CoverEditor
        visible={coverEditorVisible}
        onClose={() => setCoverEditorVisible(false)}
        cover={cover}
        onChange={handleCoverChange}
        title={title}
        author={article?.authorId}
      />

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

      <MyCollectionsModal
        visible={collectionPickerVisible}
        onClose={() => setCollectionPickerVisible(false)}
        collections={myCollections}
        onSelect={handleCollectionSelect}
        isLoading={myCollectionsQuery.isLoading}
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
  coverActionSection: {
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  coverActionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  coverActionLabel: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc700,
    flex: 1,
  },
  previewArea: {
    flex: 1,
  },
  previewInner: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 16,
    paddingBottom: 40,
  },
  coverPreviewWrapper: {
    alignItems: "center",
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
