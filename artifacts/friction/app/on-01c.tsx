import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
  TextInput,
  LayoutChangeEvent,
  BackHandler,
  Platform,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, ReaderTokens, Shadows } from "@/constants/tokens";
import { computeBodyLayout } from "@/lib/bodyLayout";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import CoverPreview from "@/components/CoverPreview/CoverPreview";
import CoverEditor from "@/components/CoverEditor/CoverEditor";
import WebViewMarkdownReader from "@/components/WebViewMarkdownReader";
import { resolveArticleCover, getDefaultCover } from "@/utils/articleCover";
import { canStepBack } from "@/lib/articleStatusCycle";
import WritingStateBar, { type WritingStage } from "@/components/WritingStateBar/WritingStateBar";
import { trackArticlePublished } from "@/lib/analytics";
import {
  useGetArticle,
  useGetUser,
  useUpdateArticle,
  useTransitionArticleStatus,
  useFinalizeArticle,
  TransitionArticleBodyTargetStatus,
  getGetArticleQueryKey,
} from "@workspace/api-client-react";
import type { ArticleCover } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  invalidateArticleLists,
  invalidateArticleAndLists,
  invalidateArticleDetail,
  patchArticleInRecordCaches,
} from "@/lib/queryInvalidation";
import { useToast } from "@/contexts/ToastContext";

export default function ClosingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const articleQuery = useGetArticle(id ?? "");
  const article = id ? articleQuery.data : undefined;
  const articleLoading = id ? articleQuery.isLoading : false;

  const authorQuery = useGetUser(article?.authorId ?? "");
  const authorName = article?.authorId
    ? (authorQuery.data?.nickname ?? authorQuery.data?.email ?? undefined)
    : undefined;

  // Skip mount-time invalidate when cache is fresh (≤30s) — avoids a wasted
  // refetch on every 분할→마감 navigation. Cold entries still refresh.
  useEffect(() => {
    if (!id) return;
    const cached = queryClient.getQueryState(getGetArticleQueryKey(id));
    const fresh = !!cached && Date.now() - cached.dataUpdatedAt < 30_000;
    if (!fresh) {
      invalidateArticleDetail(queryClient, id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateArticle = useUpdateArticle();
  const transitionStatus = useTransitionArticleStatus();
  const finalizeArticle = useFinalizeArticle();

  const [title, setTitle] = useState("");
  const [pages, setPages] = useState<string[]>([]);
  const [previewPage, setPreviewPage] = useState(0);
  const [cover, setCover] = useState<ArticleCover>(getDefaultCover());
  const [coverEditorVisible, setCoverEditorVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const isActionInProgressRef = useRef(false);
  const [previewCardWidth, setPreviewCardWidth] = useState(0);
  const storedLayoutWidth = (article?.layoutWidth != null && article.layoutWidth > 0) ? article.layoutWidth : null;
  const exportedArticleIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const saveCoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Step 3(E) — pages 변경 여부 추적: 분할 화면에서 이미 저장된 pages를 다시
  // 보내지 않도록, 서버에서 받은 초기 pages 스냅샷을 저장해 둔다. on-01c는
  // 현재 pages를 편집하지 않으므로 거의 항상 변경되지 않은 상태로 남는다.
  const initialPagesRef = useRef<string[] | null>(null);

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
    // C1 fix: removed isDataFresh gate — initialize on first data regardless of
    // cache age. initializedRef ensures title/cover are only set once (user edits
    // these fields, so we must not overwrite on background refetch).
    // initialPagesRef also snapshotted on first data to keep diff detection accurate.
    if (initialPagesRef.current === null) {
      initialPagesRef.current = incoming;
    }
    if (!initializedRef.current) {
      initializedRef.current = true;
      setTitle(article.title || "");
      setCover(resolveArticleCover(article.cover));
      console.log("[on-01 init] on-01c cached?=true dirty?=false title injected:", (article.title || "").slice(0, 30));
    }
  }, [article]);

  const pendingCoverRef = useRef<ArticleCover | null>(null);
  // 마감→분할 복귀 시 전달할 콘텐츠 페이지 인덱스를 렌더마다 갱신한다.
  const returnPageIdxRef = useRef(0);
  // 마감 화면은 페이지 단위 스와이프만 지원하므로 블록 인덱스는 항상 0(첫 블록)으로 고정.
  // 향후 미리보기 내 블록 탭 추적이 구현되면 이 ref를 갱신한다.
  const returnBlockIdxRef = useRef(0);

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
      patchArticleInRecordCaches(queryClient, id, { cover: pending });
    } catch (e: unknown) {
      console.warn("Failed to save cover:", e instanceof Error ? e.message : e);
    }
  }, [id, queryClient, updateArticle]);

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
          patchArticleInRecordCaches(queryClient, id, { cover: toSave });
        } catch (e: unknown) {
          console.warn("Failed to save cover:", e instanceof Error ? e.message : e);
        }
      }, 500);
    },
    [id, queryClient, updateArticle],
  );

  useEffect(() => {
    return () => {
      if (saveCoverTimerRef.current) clearTimeout(saveCoverTimerRef.current);
    };
  }, []);

  const handleExport = useCallback(() => {
    if (!title.trim()) {
      showToast({ message: "제목을 입력해주세요.", type: "info" });
      return;
    }
    if (pages.length === 0) {
      showToast({ message: "페이지가 없어요.", type: "info" });
      return;
    }
    setConfirmVisible(true);
  }, [title, pages, showToast]);

  const finalizeExport = useCallback(
    async () => {
      const articleId = exportedArticleIdRef.current;
      if (!articleId) return;
      const updated = await finalizeArticle.mutateAsync({
        id: articleId,
        data: {},
      });
      queryClient.setQueryData(getGetArticleQueryKey(articleId), updated);
      trackArticlePublished({
        articleId,
        charCount: pages.reduce((sum, p) => sum + p.length, 0),
        pageCount: pages.length,
      });
      invalidateArticleLists(queryClient);
      router.replace({ pathname: "/(tabs)/on", params: { tab: "my_article" } });
    },
    [pages, finalizeArticle, queryClient, router],
  );

  const handleConfirmExport = useCallback(async () => {
    setConfirmVisible(false);
    if (isActionInProgressRef.current) return;
    isActionInProgressRef.current = true;
    if (saveCoverTimerRef.current) {
      clearTimeout(saveCoverTimerRef.current);
      saveCoverTimerRef.current = null;
    }
    const coverToSave = pendingCoverRef.current ?? cover;
    pendingCoverRef.current = null;
    setIsExporting(true);
    try {
      // Step 3(E) — PATCH 페이로드 최소화:
      // pages는 분할 화면(on-01b)에서 이미 저장됐고 이 화면에서는 편집되지 않으므로,
      // 초기 스냅샷과 다를 때만 포함한다 (실질적으로 거의 항상 생략된다).
      // title/cover는 변경 여부와 무관하게 보내 최신 상태를 확정한다 — debounce로
      // 아직 서버에 반영되지 않은 cover나, blur 전인 title을 한 번에 확정한다.
      const patchData: { title?: string; pages?: string[]; cover?: typeof cover } = {
        title,
        cover: coverToSave,
      };
      const initialPages = initialPagesRef.current;
      const pagesChanged =
        initialPages === null || JSON.stringify(initialPages) !== JSON.stringify(pages);
      if (pagesChanged) {
        patchData.pages = pages;
      }
      await updateArticle.mutateAsync({
        id: id!,
        data: patchData,
      });
      exportedArticleIdRef.current = id!;
      await finalizeExport();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "내보내기에 실패했습니다.";
      showToast({ message: msg, type: "error" });
    } finally {
      setIsExporting(false);
      isActionInProgressRef.current = false;
    }
  }, [id, title, pages, cover, updateArticle, finalizeExport]);

  const flushTitleSave = useCallback(async () => {
    if (!id) return;
    if (!titleEditing) return;
    setTitleEditing(false);
    try {
      await updateArticle.mutateAsync({ id, data: { title } });
      patchArticleInRecordCaches(queryClient, id, { title });
    } catch (e: unknown) {
      console.warn("Failed to save title:", e instanceof Error ? e.message : e);
    }
  }, [id, queryClient, title, titleEditing, updateArticle]);

  const handleBack = useCallback(async () => {
    if (isActionInProgressRef.current) return;
    isActionInProgressRef.current = true;
    Keyboard.dismiss();
    await flushTitleSave();
    await flushCoverSave();
    invalidateArticleLists(queryClient);
    isActionInProgressRef.current = false;
    router.replace("/(tabs)/on");
  }, [router, queryClient, flushCoverSave, flushTitleSave]);

  const handleStepBack = useCallback(async () => {
    if (isActionInProgressRef.current) return;
    isActionInProgressRef.current = true;
    Keyboard.dismiss();
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
      await flushTitleSave();
      await flushCoverSave();

      // Optimistic navigation. updatedAt bump lets on-01b's freshness gate
      // accept this cache immediately, avoiding a needless refetch wait.
      queryClient.setQueryData(
        getGetArticleQueryKey(id),
        (old: any) => (old ? { ...old, status: "DIVIDING" } : old),
        { updatedAt: Date.now() },
      );

      // 마감 화면에서 보던 콘텐츠 페이지 인덱스 및 블록 인덱스를 분할 화면에 전달해
      // page strip과 본문 에디터가 해당 위치로 스크롤 복원되도록 한다.
      const returnPageIdx = returnPageIdxRef.current;
      const returnBlockIdx = returnBlockIdxRef.current;
      isActionInProgressRef.current = false;
      router.replace({ pathname: "/on-01b", params: { id, returnPage: String(returnPageIdx), returnBlock: String(returnBlockIdx) } });

      // Background transition
      transitionStatus
        .mutateAsync({
          id,
          data: { targetStatus: TransitionArticleBodyTargetStatus.DIVIDING },
        })
        .then(() => {
          invalidateArticleLists(queryClient);
        })
        .catch(() => {
          showToast({ message: "상태 전환에 실패했어요. 새로고침해주세요.", type: "error" });
          invalidateArticleAndLists(queryClient, id);
        });
    } catch (e: unknown) {
      isActionInProgressRef.current = false;
      const msg = e instanceof Error ? e.message : "저장에 실패했습니다.";
      showToast({ message: msg, type: "error" });
    }
  }, [id, flushCoverSave, flushTitleSave, transitionStatus, queryClient, router, showToast]);

  const handleSaveTitle = useCallback(async () => {
    setTitleEditing(false);
    if (!id) return;
    try {
      await updateArticle.mutateAsync({ id, data: { title } });
      patchArticleInRecordCaches(queryClient, id, { title });
    } catch (e: unknown) {
      console.warn("Failed to save title:", e instanceof Error ? e.message : e);
    }
  }, [id, queryClient, title, updateArticle]);

  const handleStateBarPress = useCallback((target: WritingStage) => {
    if (target === "CLOSING") return;
    if (target === "DIVIDING") {
      handleStepBack();
      return;
    }
    showToast({ message: "검토 단계를 거쳐 작성 단계로 이동할 수 있어요.", type: "info" });
  }, [showToast, handleStepBack]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [handleBack]);

  const hasCoverPage = true;
  const totalVirtualPages = pages.length > 0
    ? (hasCoverPage ? pages.length + 1 : pages.length)
    : 0;

  const clampedPreviewPage = totalVirtualPages > 0
    ? Math.min(previewPage, totalVirtualPages - 1)
    : 0;
  const isCoverPage = hasCoverPage && clampedPreviewPage === 0;
  const contentPageIndex = hasCoverPage ? clampedPreviewPage - 1 : clampedPreviewPage;
  const currentPage = isCoverPage ? null : (pages[contentPageIndex] ?? null);
  // 렌더마다 최신 복귀 페이지 인덱스를 ref에 반영한다.
  returnPageIdxRef.current = isCoverPage ? 0 : Math.max(0, contentPageIndex);

  const handlePreviewCardLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setPreviewCardWidth((prev) => (prev === w ? prev : w));
  }, []);


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
        <View style={styles.headerSide}>
          <ScalePressable onPress={handleBack} hitSlop={12}>
            <Feather name="arrow-left" size={20} color={Colors.zinc600} />
          </ScalePressable>
        </View>
        <WritingStateBar
          current="CLOSING"
          onPress={handleStateBarPress}
          disabled={isExporting}
        />
        <View style={styles.headerSideRight}>
          <ScalePressable onPress={handleExport} hitSlop={12} disabled={isExporting}>
            {isExporting ? (
              <ActivityIndicator size="small" color={Colors.zinc400} />
            ) : (
              <Text style={styles.exportButton}>내보내기</Text>
            )}
          </ScalePressable>
        </View>
      </View>

      <View style={styles.titleSection}>
        {titleEditing ? (
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            onBlur={handleSaveTitle}
            autoFocus
            maxLength={100}
            multiline
            scrollEnabled={false}
            textAlignVertical="top"
          />
        ) : (
          <ScalePressable style={styles.titleRow} onPress={() => setTitleEditing(true)}
          contentStyle={styles.titleRowContent}
          >
            <Text style={styles.titleText}>
              {title || "제목 없음"}
            </Text>
            <Feather name="edit-2" size={14} color={Colors.zinc400} />
          </ScalePressable>
        )}
      </View>

      <View style={styles.coverActionSection}>
        <ScalePressable
          style={styles.coverActionButton}
          onPress={() => setCoverEditorVisible(true)}
        contentStyle={styles.coverActionButtonContent}
        >
          <Feather name="image" size={16} color={Colors.zinc600} />
          <Text style={styles.coverActionLabel}>
            {cover.type === "default" ? "표지 만들기" : "표지 수정"}
          </Text>
          <Feather name="chevron-right" size={16} color={Colors.zinc400} />
        </ScalePressable>
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
                  // storedLayoutWidth를 알 때: 원래 분할 단계의 치수로 렌더링 후 scale 축소.
                  // 4개 화면(작성/분할/마감/읽기)이 모두 lib/bodyLayout.ts의 computeBodyLayout을
                  // 거쳐 같은 정수 픽셀 textColumnWidth를 자식 View의 width에 직접 사용한다 →
                  // PretextMeasureLayer / read.tsx PageView와 픽셀 단위로 일치하는 줄넘김.
                  (() => {
                    const storedBody = computeBodyLayout(storedLayoutWidth);
                    return (
                      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                        <View style={{
                          width: storedLayoutWidth,
                          height: storedLayoutWidth / ReaderTokens.aspectRatio,
                          transform: [{ scale: Math.min(previewCardWidth / storedLayoutWidth, 1.0) }],
                          alignItems: "center",
                          justifyContent: "center",
                        }}>
                          <View style={{
                            width: storedBody.pageWidth,
                            flex: 1,
                            paddingHorizontal: storedBody.paddingX,
                            paddingTop: storedBody.paddingY,
                            paddingBottom: storedBody.paddingY + insets.bottom + storedBody.titleBarHeight,
                          }}>
                            <View style={{ width: storedBody.textColumnWidth, flex: 1 }}>
                              <WebViewMarkdownReader
                                markdown={currentPage!}
                                bodyFontSize={storedBody.bodyFontSize}
                                bodyLetterSpacing={storedBody.bodyLetterSpacing}
                              />
                            </View>
                          </View>
                        </View>
                      </View>
                    );
                  })()
                ) : previewCardWidth > 0 ? (
                  // storedLayoutWidth 없는 폴백: previewCardWidth 자체를 컨테이너 폭으로 보고
                  // 동일한 computeBodyLayout으로 텍스트 컬럼을 산출한다 (정수 textColumnWidth 사용).
                  (() => {
                    const fallbackBody = computeBodyLayout(previewCardWidth);
                    return (
                      <View style={{
                        width: fallbackBody.pageWidth,
                        flex: 1,
                        paddingHorizontal: fallbackBody.paddingX,
                        paddingTop: fallbackBody.paddingY,
                        paddingBottom: fallbackBody.paddingY + insets.bottom + fallbackBody.titleBarHeight,
                        alignSelf: "center",
                      }}>
                        <View style={{ width: fallbackBody.textColumnWidth, flex: 1 }}>
                          <WebViewMarkdownReader
                            markdown={currentPage!}
                            bodyFontSize={fallbackBody.bodyFontSize}
                            bodyLetterSpacing={fallbackBody.bodyLetterSpacing}
                          />
                        </View>
                      </View>
                    );
                  })()
                ) : null}
              </View>
              </View>
            )}
          </View>
        </View>
      </GestureDetector>

      {totalVirtualPages > 1 && (
        <View style={[styles.pageNav, { paddingBottom: insets.bottom + 16 }]}>
          <ScalePressable
            style={styles.pageNavButton}
            onPress={() => setPreviewPage((p) => Math.max(0, p - 1))}
            disabled={clampedPreviewPage === 0}
          contentStyle={[styles.pageNavButtonContent, clampedPreviewPage === 0 && styles.pageNavButtonDisabled]}
          >
            <Feather
              name="chevron-left"
              size={20}
              color={clampedPreviewPage === 0 ? Colors.zinc300 : Colors.zinc600}
            />
          </ScalePressable>
          <Text style={styles.pageNavText}>
            {isCoverPage ? "표지" : `${Math.max(0, contentPageIndex) + 1} / ${pages.length}`}
          </Text>
          <ScalePressable
            style={styles.pageNavButton}
            onPress={() => setPreviewPage((p) => Math.min(totalVirtualPages - 1, p + 1))}
            disabled={clampedPreviewPage >= totalVirtualPages - 1}
          contentStyle={[
              styles.pageNavButtonContent,
              clampedPreviewPage >= totalVirtualPages - 1 && styles.pageNavButtonDisabled,
            ]}
          >
            <Feather
              name="chevron-right"
              size={20}
              color={clampedPreviewPage >= totalVirtualPages - 1 ? Colors.zinc300 : Colors.zinc600}
            />
          </ScalePressable>
        </View>
      )}

      <CoverEditor
        visible={coverEditorVisible}
        onClose={() => setCoverEditorVisible(false)}
        cover={cover}
        onChange={handleCoverChange}
        title={title}
        author={authorName}
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
  headerSide: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  headerSideRight: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
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
  },
  titleRowContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,},
  titleText: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    lineHeight: 24,
    color: Colors.zinc900,
    flex: 1,
  },
  titleInput: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    lineHeight: 24,
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
  coverActionButton: {},
  coverActionButtonContent: {
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,},
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
  },
  pageNavButtonContent: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.zinc50,
    alignItems: "center",
    justifyContent: "center",},
  pageNavButtonDisabled: {
    opacity: 0.5,
  },
  pageNavText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc600,
  },
});
