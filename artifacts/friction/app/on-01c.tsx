import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  TextInput,
  LayoutChangeEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, ReaderTokens, Shadows, cqiToPx, readerFontSize } from "@/constants/tokens";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import CoverPreview from "@/components/CoverPreview/CoverPreview";
import CoverEditor from "@/components/CoverEditor/CoverEditor";
import MarkdownBlock from "@/components/MarkdownBlock/MarkdownBlock";
import { parseMarkdownBlocks } from "@/utils/markdownParser";
import MyCollectionsModal from "@/components/MyCollectionsModal/MyCollectionsModal";
import { resolveArticleCover, getDefaultCover } from "@/utils/articleCover";
import { canStepBack } from "@/lib/articleStatusCycle";
import WritingStateBar, { type WritingStage } from "@/components/WritingStateBar/WritingStateBar";
import { useUser } from "@/contexts/UserContext";
import { trackArticlePublished } from "@/lib/analytics";
import {
  useGetArticle,
  useGetUser,
  useUpdateArticle,
  useTransitionArticleStatus,
  useListMyCollections,
  useAddArticleToMyCollection,
  useCreateMyCollection,
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

  const authorQuery = useGetUser(article?.authorId ?? "");
  const authorName = article?.authorId
    ? (authorQuery.data?.nickname ?? authorQuery.data?.email ?? undefined)
    : undefined;

  const { refetch: refetchArticle } = articleQuery;

  // Capture mount time so we can verify fresh data (dataUpdatedAt >= mountedAt)
  // before initializing title/cover, avoiding stale-cache initialization.
  const mountedAtRef = useRef(Date.now());

  // Force a fresh fetch on mount so stale cache never initializes the screen
  // with outdated title or cover.
  useEffect(() => {
    if (id) {
      queryClient.invalidateQueries({ queryKey: [`/api/articles/${id}`] });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateArticle = useUpdateArticle();
  const transitionStatus = useTransitionArticleStatus();
  const addArticleToMyCollection = useAddArticleToMyCollection();
  const createMyCollection = useCreateMyCollection();

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
  const [stepBackConfirmVisible, setStepBackConfirmVisible] = useState(false);
  const [collectionPickerVisible, setCollectionPickerVisible] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const isActionInProgressRef = useRef(false);
  const [previewCardWidth, setPreviewCardWidth] = useState(0);
  const storedLayoutWidth = (article?.layoutWidth != null && article.layoutWidth > 0) ? article.layoutWidth : null;
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
    // title·cover는 이 화면에서 편집하므로 최초 1회만 초기화.
    // Gate initialization on data being NEWER than this component's mount time.
    // This prevents stale cached data from initializing before the fresh fetch
    // triggered by invalidateQueries on mount has resolved.
    const isDataFresh = articleQuery.dataUpdatedAt >= mountedAtRef.current;
    if (!initializedRef.current && isDataFresh) {
      initializedRef.current = true;
      setTitle(article.title || "");
      setCover(resolveArticleCover(article.cover));
    }
  }, [article, articleQuery.dataUpdatedAt]);

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
    if (isActionInProgressRef.current) return;
    isActionInProgressRef.current = true;
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
      exportedArticleIdRef.current = id!;
      setCollectionPickerVisible(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "내보내기에 실패했습니다.";
      Alert.alert("내보내기 실패", msg);
    } finally {
      setIsExporting(false);
      isActionInProgressRef.current = false;
    }
  }, [id, title, pages, cover, updateArticle]);

  const finalizeExport = useCallback(
    async (collectionId: string) => {
      const articleId = exportedArticleIdRef.current;
      if (!articleId) return;
      const { data: freshArticle } = await refetchArticle();
      const currentStatus = freshArticle?.status ?? article?.status;
      if (currentStatus !== "LETTER") {
        const updated = await transitionStatus.mutateAsync({
          id: articleId,
          data: { targetStatus: TransitionArticleBodyTargetStatus.LETTER },
        });
        queryClient.setQueryData([`/api/articles/${articleId}`], updated);
      }
      trackArticlePublished({
        articleId,
        charCount: pages.reduce((sum, p) => sum + p.length, 0),
        pageCount: pages.length,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      await addArticleToMyCollection.mutateAsync({
        id: collectionId,
        data: { articleId },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/my-collections"] });
      router.dismissAll();
      router.push({ pathname: "/of-01" });
    },
    [article, pages, refetchArticle, transitionStatus, addArticleToMyCollection, queryClient, router],
  );

  const handleCollectionSelect = useCallback(
    async (collection: { id: string; name: string }) => {
      if (isActionInProgressRef.current) return;
      isActionInProgressRef.current = true;
      setCollectionPickerVisible(false);
      try {
        await finalizeExport(collection.id);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "모음 저장에 실패했습니다.";
        Alert.alert("저장 실패", msg);
      } finally {
        isActionInProgressRef.current = false;
      }
    },
    [finalizeExport],
  );

  const handleCreateAndSelect = useCallback(
    async (name: string, description: string) => {
      if (isActionInProgressRef.current) return;
      isActionInProgressRef.current = true;
      let created: { id: string };
      try {
        created = await createMyCollection.mutateAsync({
          data: { ownerId: userId, name, description, isPublic: false },
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "모음 생성에 실패했습니다.";
        Alert.alert("생성 실패", msg);
        isActionInProgressRef.current = false;
        return;
      }
      setCollectionPickerVisible(false);
      try {
        await finalizeExport(created.id);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "모음 저장에 실패했습니다.";
        Alert.alert("저장 실패", msg);
      } finally {
        isActionInProgressRef.current = false;
      }
    },
    [userId, createMyCollection, finalizeExport],
  );

  const handleBack = useCallback(async () => {
    if (isActionInProgressRef.current) return;
    isActionInProgressRef.current = true;
    await flushCoverSave();
    queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
    isActionInProgressRef.current = false;
    router.replace("/(tabs)/on");
  }, [router, queryClient, flushCoverSave]);

  const handleConfirmStepBack = useCallback(async () => {
    setStepBackConfirmVisible(false);
    if (isActionInProgressRef.current) return;
    isActionInProgressRef.current = true;
    const result = canStepBack("CLOSING");
    if (!result.allowed) {
      isActionInProgressRef.current = false;
      return;
    }
    if (!id) {
      isActionInProgressRef.current = false;
      return;
    }
    try {
      await flushCoverSave();
      await transitionStatus.mutateAsync({
        id,
        data: { targetStatus: TransitionArticleBodyTargetStatus.DIVIDING },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      isActionInProgressRef.current = false;
      router.replace({ pathname: "/on-01b", params: { id } });
    } catch (e: unknown) {
      isActionInProgressRef.current = false;
      const msg = e instanceof Error ? e.message : "상태 전환에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [id, flushCoverSave, transitionStatus, queryClient, router]);

  const handleSaveTitle = useCallback(async () => {
    setTitleEditing(false);
    if (!id) return;
    try {
      await updateArticle.mutateAsync({ id, data: { title } });
    } catch (e: unknown) {
      console.warn("Failed to save title:", e instanceof Error ? e.message : e);
    }
  }, [id, title, updateArticle]);

  const handleStateBarPress = useCallback((target: WritingStage) => {
    if (target === "CLOSING") return;
    if (target === "DIVIDING") {
      setStepBackConfirmVisible(true);
      return;
    }
    Alert.alert("이동 불가", "분할 단계를 거쳐 작성 단계로 이동할 수 있습니다.");
  }, []);

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

  const handlePreviewCardLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setPreviewCardWidth((prev) => (prev === w ? prev : w));
  }, []);

  const previewBlocks = useMemo(() => {
    if (!currentPage) return [];
    return parseMarkdownBlocks(currentPage);
  }, [currentPage]);

  const totalVirtualPagesRef = useRef(totalVirtualPages);
  totalVirtualPagesRef.current = totalVirtualPages;

  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-15, 15])
    .runOnJS(true)
    .onEnd((e) => {
      const total = totalVirtualPagesRef.current;
      if (total < 1) return;
      if (e.translationX < -40) {
        setPreviewPage((p) => Math.min(total - 1, Math.max(0, p + 1)));
      } else if (e.translationX > 40) {
        setPreviewPage((p) => Math.max(0, Math.min(total - 1, p - 1)));
      }
    });

  if (!id || articleLoading) {
    return (
      <>
        <Stack.Screen options={{ gestureEnabled: false }} />
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.zinc400} />
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <WritingStateBar
          current="CLOSING"
          onPress={handleStateBarPress}
          disabled={isExporting}
        />
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

      <GestureDetector gesture={swipeGesture}>
        <View style={styles.previewArea}>
          <View style={styles.previewInner}>
            {totalVirtualPages === 0 ? (
              <View style={styles.emptyContainer}>
                <Feather name="eye" size={36} color={Colors.zinc300} />
                <Text style={styles.emptyTitle}>미리보기할 내용이 없어요</Text>
              </View>
            ) : isCoverPage ? (
              <View style={styles.coverPreviewWrapper}>
                <CoverPreview cover={cover} title={title} author={authorName} borderRadius={2} />
              </View>
            ) : (
              <View style={styles.previewCardShadow}>
              <View style={styles.previewCard} onLayout={handlePreviewCardLayout}>
                {previewCardWidth > 0 && storedLayoutWidth !== null ? (
                  <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    <View style={{
                      width: storedLayoutWidth,
                      height: storedLayoutWidth / ReaderTokens.aspectRatio,
                      transform: [{ scale: Math.min(previewCardWidth / storedLayoutWidth, 1.0) }],
                      alignItems: "center",
                      justifyContent: "center",
                    }}>
                      {/* Mirror reader structure: centered safe-area box → padded content.
                          Scale is capped at 1.0 so the preview never zooms in beyond the
                          original dividing-stage dimensions — matching read.tsx behaviour.
                          textColumnWidth is the same integer-pixel value used by read.tsx
                          PageView and PretextMeasureLayer, preventing Yoga pixel-snap drift. */}
                      <View style={{ width: cqiToPx(ReaderTokens.safeArea.widthCqi, storedLayoutWidth) }}>
                        <View
                          pointerEvents="none"
                          style={{
                            paddingHorizontal: cqiToPx(ReaderTokens.padding.xCqi, storedLayoutWidth),
                            paddingVertical: cqiToPx(ReaderTokens.padding.yCqi, storedLayoutWidth),
                          }}
                        >
                          {/* Explicit integer-pixel text column width — must match the
                              textColumnWidth used by read.tsx/PageView and PretextMeasureLayer. */}
                          <View style={{ width: Math.round(cqiToPx(ReaderTokens.safeArea.widthCqi, storedLayoutWidth) - 2 * cqiToPx(ReaderTokens.padding.xCqi, storedLayoutWidth)) }}>
                            {previewBlocks.map((block, i) => (
                              <View key={i} style={{ marginBottom: readerFontSize(ReaderTokens.typeScale.bodyCqi, storedLayoutWidth) * ReaderTokens.lineHeight.relaxed * 0.6 }}>
                                <MarkdownBlock
                                  block={block}
                                  onCollect={() => {}}
                                  fontSize={readerFontSize(ReaderTokens.typeScale.bodyCqi, storedLayoutWidth)}
                                  lineHeight={readerFontSize(ReaderTokens.typeScale.bodyCqi, storedLayoutWidth) * ReaderTokens.lineHeight.relaxed}
                                  letterSpacing={readerFontSize(ReaderTokens.typeScale.bodyCqi, storedLayoutWidth) * ReaderTokens.letterSpacing.relaxedEm}
                                />
                              </View>
                            ))}
                          </View>
                        </View>
                      </View>
                    </View>
                  </View>
                ) : previewCardWidth > 0 ? (
                  <View
                    style={{
                      flex: 1,
                      paddingHorizontal: cqiToPx(ReaderTokens.padding.xCqi, previewCardWidth),
                      paddingVertical: cqiToPx(ReaderTokens.padding.yCqi, previewCardWidth),
                    }}
                    pointerEvents="none"
                  >
                    {/* Explicit integer-pixel text column width (fallback path without storedLayoutWidth) */}
                    <View style={{ width: Math.round(cqiToPx(ReaderTokens.safeArea.widthCqi, previewCardWidth) - 2 * cqiToPx(ReaderTokens.padding.xCqi, previewCardWidth)) }}>
                      {previewBlocks.map((block, i) => (
                        <View key={i} style={{ marginBottom: readerFontSize(ReaderTokens.typeScale.bodyCqi, previewCardWidth) * ReaderTokens.lineHeight.relaxed * 0.6 }}>
                          <MarkdownBlock
                            block={block}
                            onCollect={() => {}}
                            fontSize={readerFontSize(ReaderTokens.typeScale.bodyCqi, previewCardWidth)}
                            lineHeight={readerFontSize(ReaderTokens.typeScale.bodyCqi, previewCardWidth) * ReaderTokens.lineHeight.relaxed}
                            letterSpacing={readerFontSize(ReaderTokens.typeScale.bodyCqi, previewCardWidth) * ReaderTokens.letterSpacing.relaxedEm}
                          />
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>
              </View>
            )}
          </View>
        </View>
      </GestureDetector>

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
        author={authorName}
        articleId={id ?? ""}
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

      <ConfirmModal
        visible={stepBackConfirmVisible}
        title="분할 단계로 돌아가기"
        description="분할 단계로 돌아가겠습니까? 표지와 스타일 설정은 유지됩니다."
        confirmLabel="돌아가기"
        cancelLabel="취소"
        onConfirm={handleConfirmStepBack}
        onCancel={() => setStepBackConfirmVisible(false)}
      />

      <MyCollectionsModal
        visible={collectionPickerVisible}
        onClose={() => setCollectionPickerVisible(false)}
        collections={myCollections}
        onSelect={handleCollectionSelect}
        onCreateAndSelect={handleCreateAndSelect}
        isLoading={myCollectionsQuery.isLoading}
      />
    </View>
    </>
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
    overflow: "hidden",
  },
  previewInner: {
    flex: 1,
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 16,
    paddingBottom: 16,
    justifyContent: "center",
    backgroundColor: ReaderTokens.bodyBg,
  },
  coverPreviewWrapper: {
    borderRadius: 2,
    width: "100%",
    aspectRatio: 5 / 8,
    maxHeight: 480,
    alignSelf: "center",
    ...Shadows.previewPage,
  },
  previewCardShadow: {
    borderRadius: 2,
    width: "100%",
    aspectRatio: 5 / 8,
    maxHeight: 480,
    alignSelf: "center",
    ...Shadows.previewPage,
  },
  previewCard: {
    borderRadius: 2,
    flex: 1,
    backgroundColor: ReaderTokens.bodyBg,
    overflow: "hidden",
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
