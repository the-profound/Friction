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
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, ReaderTokens, cqiToPx, readerFontSize, readerLetterSpacing } from "@/constants/tokens";
import {
  splitContentToPages,
  validatePages,
  splitContentForDivision,
  splitPageContentForDivision,
  simulateGreedyJobs,
  resolveBSJob,
  runGreedy,
  bsCandidateKey,
  bsCandidatesForJob,
  type BSJob,
  type BSResult,
  type DivisionWarning,
} from "@/lib/pageDivision";
import { canTransitionForward, canStepBack } from "@/lib/articleStatusCycle";
import type { ArticleStatus } from "@/lib/policies";
import { MarkdownPolicy } from "@/lib/policies";
import {
  useGetArticle,
  useUpdateArticle,
  useTransitionArticleStatus,
  TransitionArticleBodyTargetStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import PretextMeasureLayer, {
  type MeasureRequest,
  type MeasureCandidate,
} from "@/components/PretextMeasureLayer/PretextMeasureLayer";

const PAGE_DIVIDER = MarkdownPolicy.PAGE_DIVIDER;

const PARA_KEY_PREFIX = "para_";
const PAGE_KEY_PREFIX = "page_";

function useReaderLayout(screenWidth: number, screenHeight: number) {
  return useMemo(() => {
    const widthFromHeight = screenHeight * ReaderTokens.aspectRatio;
    const containerWidth = widthFromHeight <= screenWidth ? widthFromHeight : screenWidth;
    const safeAreaWidth = cqiToPx(ReaderTokens.safeArea.widthCqi, containerWidth);
    const safeAreaHeight = cqiToPx(ReaderTokens.safeArea.heightCqi, containerWidth);
    const paddingX = cqiToPx(ReaderTokens.padding.xCqi, containerWidth);
    const paddingY = cqiToPx(ReaderTokens.padding.yCqi, containerWidth);
    const bodyFontSize = readerFontSize(ReaderTokens.typeScale.bodyCqi, containerWidth);
    const bodyLineHeight = bodyFontSize * ReaderTokens.lineHeight.relaxed;
    const bodyLetterSpacing = readerLetterSpacing(ReaderTokens.letterSpacing.relaxedEm, bodyFontSize);
    return { containerWidth, safeAreaWidth, safeAreaHeight, paddingX, paddingY, bodyFontSize, bodyLineHeight, bodyLetterSpacing };
  }, [screenWidth, screenHeight]);
}

export default function DividingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const articleQuery = useGetArticle(id ?? "");
  const article = id ? articleQuery.data : undefined;
  const articleLoading = id ? articleQuery.isLoading : false;

  const updateArticle = useUpdateArticle();
  const transitionStatus = useTransitionArticleStatus();

  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [stepBackConfirmVisible, setStepBackConfirmVisible] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (article && !initializedRef.current) {
      initializedRef.current = true;
      if (article.pages && Array.isArray(article.pages) && article.pages.length > 0) {
        setContent((article.pages as string[]).join(`\n${PAGE_DIVIDER}\n`));
      } else {
        setContent(article.content || "");
      }
    }
  }, [article]);

  const [debouncedContent, setDebouncedContent] = useState(content);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedContent(content), 600);
    return () => clearTimeout(timer);
  }, [content]);

  const pages = useMemo(() => splitContentToPages(content), [content]);
  const measurePages = useMemo(() => splitContentToPages(debouncedContent), [debouncedContent]);

  const baseWarnings = useMemo(() => validatePages(pages), [pages]);

  const readerLayout = useReaderLayout(screenWidth, screenHeight);
  const { containerWidth, safeAreaWidth, safeAreaHeight, paddingX, paddingY, bodyFontSize, bodyLineHeight, bodyLetterSpacing } = readerLayout;

  const pageContentHeight = safeAreaHeight;

  const [pageHeights, setPageHeights] = useState<Record<number, number>>({});

  // ─── Pretext 측정 레이어 ────────────────────────────────────────────────────
  // (1) 경고용 페이지 측정: debouncedContent 변경 시 measurePages 전체를 다시 측정
  // (2) 엔진용 BS 측정: handleAutoSplit/handleInsertDivider가 필요할 때 imperative하게 호출
  const warningRequest = useMemo<MeasureRequest | null>(() => {
    if (measurePages.length === 0) return null;
    return {
      candidates: measurePages.map((p) => ({
        key: `${PAGE_KEY_PREFIX}${p.pageIndex}`,
        content: p.content,
      })),
      width: safeAreaWidth,
      paddingX,
      paddingTop: paddingY,
      paddingBottom: insets.bottom + paddingY,
      fontSize: bodyFontSize,
      lineHeight: bodyLineHeight,
      letterSpacing: bodyLetterSpacing,
    };
  }, [measurePages, safeAreaWidth, paddingX, paddingY, insets.bottom, bodyFontSize, bodyLineHeight, bodyLetterSpacing]);

  const handleWarningMeasured = useCallback((heights: Record<string, number>) => {
    setPageHeights((prev) => {
      const next: Record<number, number> = {};
      for (const k in heights) {
        if (k.startsWith(PAGE_KEY_PREFIX)) {
          const idx = Number(k.slice(PAGE_KEY_PREFIX.length));
          if (Number.isFinite(idx)) next[idx] = heights[k];
        }
      }
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && nextKeys.every((k) => prev[Number(k)] === next[Number(k)])) {
        return prev;
      }
      return next;
    });
  }, []);

  const [engineRequest, setEngineRequest] = useState<MeasureRequest | null>(null);
  const engineResolveRef = useRef<((heights: Record<string, number>) => void) | null>(null);

  const measureEngine = useCallback(
    (candidates: MeasureCandidate[]): Promise<Record<string, number>> => {
      return new Promise((resolve) => {
        engineResolveRef.current = resolve;
        setEngineRequest({
          candidates,
          width: safeAreaWidth,
          paddingX,
          fontSize: bodyFontSize,
          lineHeight: bodyLineHeight,
          letterSpacing: bodyLetterSpacing,
        });
      });
    },
    [safeAreaWidth, paddingX, bodyFontSize, bodyLineHeight, bodyLetterSpacing],
  );

  const handleEngineMeasured = useCallback((heights: Record<string, number>) => {
    const r = engineResolveRef.current;
    engineResolveRef.current = null;
    setEngineRequest(null);
    if (r) r(heights);
  }, []);

  // 분할 임계값: 자동분할과 이 페이지 나누기 동일하게 사용
  const splitThreshold = useMemo(() => {
    const netH = safeAreaHeight - 2 * paddingY - insets.bottom;
    return (netH + bodyLineHeight) * 0.92;
  }, [safeAreaHeight, paddingY, insets.bottom, bodyLineHeight]);

  const heightWarnings = useMemo<DivisionWarning[]>(() => {
    return measurePages
      .filter((page) => {
        const h = pageHeights[page.pageIndex];
        return h !== undefined && h > pageContentHeight + bodyLineHeight;
      })
      .map((page) => ({
        pageIndex: page.pageIndex,
        paragraphIndex: -1,
        level: "red" as const,
        reason: "이 페이지는 읽기 화면에서 스크롤이 필요할 수 있습니다",
      }));
  }, [measurePages, pageHeights, pageContentHeight, bodyLineHeight]);

  const warnings = useMemo(() => [...baseWarnings, ...heightWarnings], [baseWarnings, heightWarnings]);
  const hasRedWarnings = warnings.some((w) => w.level === "red");

  // ─── 자동 분할 엔진 (lib/pageDivision) ──────────────────────────────────────
  /**
   * 단락 배열을 받아 (1) 단락 높이 측정, (2) BS 잡 큐 처리, (3) runGreedy
   * 순서로 페이지 배열을 만든다. BS는 한 paragraph의 후보 1..N을 한 번의
   * Pretext mount로 모두 측정한 뒤 JS에서 BS 수렴 → 화면 깜빡임을 줄인다.
   */
  const runDivisionEngine = useCallback(
    async (paragraphs: string[]): Promise<string[] | null> => {
      if (paragraphs.length < 1) return null;

      // Phase 1: 단락 높이 일괄 측정
      const paraCandidates: MeasureCandidate[] = paragraphs.map((p, i) => ({
        key: `${PARA_KEY_PREFIX}${i}`,
        content: p,
      }));
      const paraHeightMap = await measureEngine(paraCandidates);
      const paraHeights: Record<number, number> = {};
      paragraphs.forEach((_, i) => {
        paraHeights[i] = paraHeightMap[`${PARA_KEY_PREFIX}${i}`] ?? 0;
      });

      // Phase 2: BS 잡 결정 → 후보 일괄 측정 → JS BS → 잔여 cuts 반복
      const initialJobs = simulateGreedyJobs(paragraphs, paraHeights, splitThreshold);
      const splitResults: Record<number, BSResult[]> = {};
      let pendingJobs: BSJob[] = initialJobs;

      while (pendingJobs.length > 0) {
        const candidates: MeasureCandidate[] = [];
        for (const job of pendingJobs) {
          for (const c of bsCandidatesForJob(job)) {
            candidates.push({
              key: bsCandidateKey(job.paraIdx, job.wordOffset, c.count),
              content: c.content,
            });
          }
        }
        if (candidates.length === 0) break;

        const heights = await measureEngine(candidates);

        const nextPending: BSJob[] = [];
        for (const job of pendingJobs) {
          const result = resolveBSJob(job, heights);
          if (!splitResults[job.paraIdx]) splitResults[job.paraIdx] = [];
          splitResults[job.paraIdx].push({
            wordOffset: job.wordOffset,
            wordCount: result.wordCount,
          });
          if (result.hasRemaining) {
            nextPending.push({
              paraIdx: job.paraIdx,
              allWords: job.allWords,
              wordOffset: result.nextOffset,
              targetH: splitThreshold,
            });
          }
        }
        pendingJobs = nextPending;
      }

      // Phase 3: 그리디 컴팩션
      return runGreedy(paragraphs, paraHeights, splitResults, splitThreshold);
    },
    [measureEngine, splitThreshold],
  );

  const applyEngineResult = useCallback(
    (engineOutPages: string[], scope: "all" | { pageIndex: number }) => {
      if (scope === "all") {
        const joined = engineOutPages.join(`\n${PAGE_DIVIDER}\n`);
        setContent(joined);
        setDebouncedContent(joined);
      } else {
        const rawPages = content.split(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "m"));
        rawPages.splice(scope.pageIndex, 1, ...engineOutPages);
        const joined = rawPages.join(`\n${PAGE_DIVIDER}\n`);
        setContent(joined);
        setDebouncedContent(joined);
      }
      setPageHeights({});
    },
    [content],
  );

  const handleAutoSplit = useCallback(async () => {
    if (splitting) return;
    const paragraphs = splitContentForDivision(content);
    if (paragraphs.length < 2) {
      Alert.alert("자동 분할 불가", "단락이 부족하여 자동 분할할 수 없습니다.");
      return;
    }
    setSplitting(true);
    try {
      const out = await runDivisionEngine(paragraphs);
      if (out) applyEngineResult(out, "all");
    } finally {
      setSplitting(false);
    }
  }, [content, splitting, runDivisionEngine, applyEngineResult]);

  const handleInsertDivider = useCallback(
    async (afterPageIndex: number) => {
      if (splitting) return;
      const rawPages = content.split(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "m"));
      if (afterPageIndex < 0 || afterPageIndex >= rawPages.length) return;
      const paragraphs = splitPageContentForDivision(rawPages[afterPageIndex]);
      if (paragraphs.length < 2) {
        Alert.alert("분할 불가", "이 페이지에는 나눌 수 있는 단락이 부족합니다.");
        return;
      }
      setSplitting(true);
      try {
        const out = await runDivisionEngine(paragraphs);
        if (out) applyEngineResult(out, { pageIndex: afterPageIndex });
      } finally {
        setSplitting(false);
      }
    },
    [content, splitting, runDivisionEngine, applyEngineResult],
  );

  const handleRemoveDivider = useCallback(
    (pageBreakIndex: number) => {
      const parts = content.split(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "m"));
      if (pageBreakIndex < 0 || pageBreakIndex >= parts.length - 1) return;
      parts[pageBreakIndex] = parts[pageBreakIndex] + "\n\n" + parts[pageBreakIndex + 1];
      parts.splice(pageBreakIndex + 1, 1);
      setContent(parts.join(`\n${PAGE_DIVIDER}\n`));
    },
    [content],
  );

  const handleNext = useCallback(async () => {
    const result = canTransitionForward("DIVIDING" as ArticleStatus, {
      content,
      title: article?.title || "",
      pages: pages.map((p) => ({ pageIndex: p.pageIndex, content: p.content, charCount: p.charCount })),
      hasRedWarnings,
    });
    if (!result.allowed) {
      Alert.alert("전환 불가", result.reason);
      return;
    }

    try {
      const pagesJson = pages.map((p) => p.content);
      const updatedArticle = await updateArticle.mutateAsync({
        id: id!,
        data: { content, pages: pagesJson, layoutWidth: containerWidth },
      });
      // 캐시를 즉시 갱신하여 on-01c가 최신 pages를 받도록 함
      queryClient.setQueryData([`/api/articles/${id}`], updatedArticle);
      if (article?.status !== "CLOSING") {
        await transitionStatus.mutateAsync({
          id: id!,
          data: { targetStatus: TransitionArticleBodyTargetStatus.CLOSING },
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      router.push({ pathname: "/on-01c", params: { id } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "상태 전환에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [content, article, pages, hasRedWarnings, id, router, updateArticle, transitionStatus, queryClient, containerWidth]);

  const handleBack = useCallback(async () => {
    if (!id) { router.replace("/(tabs)/on"); return; }
    try {
      const pagesJson = pages.map((p) => p.content);
      const updatedArticle = await updateArticle.mutateAsync({
        id,
        data: { content, pages: pagesJson, layoutWidth: containerWidth },
      });
      queryClient.setQueryData([`/api/articles/${id}`], updatedArticle);
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      router.replace("/(tabs)/on");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "저장에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [id, content, pages, router, updateArticle, queryClient, containerWidth]);

  const handleConfirmStepBack = useCallback(async () => {
    setStepBackConfirmVisible(false);
    const result = canStepBack("DIVIDING");
    if (!result.allowed) return;
    if (!id) return;
    try {
      const pagesJson = pages.map((p) => p.content);
      const updatedArticle = await updateArticle.mutateAsync({
        id,
        data: { content, pages: pagesJson },
      });
      queryClient.setQueryData([`/api/articles/${id}`], updatedArticle);
      await transitionStatus.mutateAsync({
        id,
        data: { targetStatus: TransitionArticleBodyTargetStatus.DRAFT },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      router.replace({ pathname: "/on-01a", params: { id } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "상태 전환에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [id, content, pages, updateArticle, transitionStatus, queryClient, router]);

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
        <Pressable style={styles.headerCenter} onPress={() => setStepBackConfirmVisible(true)} hitSlop={8}>
          <Text style={[styles.headerTitle, styles.headerTitleTappable]}>분할</Text>
          <Text style={styles.pageCount}>{pages.length}페이지</Text>
        </Pressable>
        <Pressable onPress={handleNext} hitSlop={12}>
          <Text style={styles.nextButton}>다음</Text>
        </Pressable>
      </View>

      <View style={styles.toolbar}>
        <Pressable
          style={[styles.toolbarButton, mode === "preview" && styles.toolbarButtonActive]}
          onPress={() => setMode("preview")}
        >
          <Feather name="eye" size={14} color={mode === "preview" ? Colors.white : Colors.zinc600} />
          <Text style={[styles.toolbarText, mode === "preview" && styles.toolbarTextActive]}>미리보기</Text>
        </Pressable>
        <Pressable
          style={[styles.toolbarButton, mode === "edit" && styles.toolbarButtonActive]}
          onPress={() => setMode("edit")}
        >
          <Feather name="edit-2" size={14} color={mode === "edit" ? Colors.white : Colors.zinc600} />
          <Text style={[styles.toolbarText, mode === "edit" && styles.toolbarTextActive]}>편집</Text>
        </Pressable>
        <View style={styles.toolbarSpacer} />
        <Pressable style={styles.autoSplitButton} onPress={handleAutoSplit} disabled={splitting}>
          <Feather name="scissors" size={14} color={Colors.zinc600} />
          <Text style={styles.autoSplitText}>자동분할</Text>
        </Pressable>
      </View>

      {/* 단일 Pretext 측정 레이어 — (1) 페이지 경고용 측정 */}
      <PretextMeasureLayer request={warningRequest} onMeasured={handleWarningMeasured} />
      {/* 단일 Pretext 측정 레이어 — (2) 자동분할 엔진용 BS 측정 */}
      <PretextMeasureLayer request={engineRequest} onMeasured={handleEngineMeasured} />

      {mode === "edit" ? (
        <View style={styles.editContainer}>
          <Text style={styles.editHint}>
            "{PAGE_DIVIDER}" 를 줄 단위로 입력하면 페이지가 나뉩니다
          </Text>
          <TextInput
            style={styles.editInput}
            value={content}
            onChangeText={setContent}
            multiline
            textAlignVertical="top"
            scrollEnabled
            placeholder="내용을 편집하세요..."
            placeholderTextColor={Colors.zinc400}
          />
        </View>
      ) : (
        <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
          {pages.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Feather name="scissors" size={36} color={Colors.zinc300} />
              <Text style={styles.emptyTitle}>분할할 내용이 없어요</Text>
              <Text style={styles.emptySubtitle}>이전 단계에서 작성한 내용이 표시됩니다</Text>
            </View>
          ) : (
            pages.map((page, idx) => {
              const pageWarnings = warnings.filter((w) => w.pageIndex === idx);
              const isHeightOverflow = pageHeights[idx] !== undefined && pageHeights[idx] > pageContentHeight + bodyLineHeight;
              return (
                <View key={idx}>
                  <View style={[styles.pageCard, pageWarnings.length > 0 && styles.pageCardWarning]}>
                    <View style={styles.pageHeader}>
                      <Text style={styles.pageLabel}>페이지 {idx + 1}</Text>
                      <Text style={styles.charCount}>{page.charCount}자</Text>
                    </View>
                    <Text style={styles.pageContent} numberOfLines={6}>
                      {page.content}
                    </Text>
                    {pageWarnings.map((w, wi) => (
                      <Text key={wi} style={styles.warningText}>
                        {w.reason}
                      </Text>
                    ))}
                    {isHeightOverflow && (
                      <Pressable
                        style={styles.splitPageButton}
                        onPress={() => handleInsertDivider(idx)}
                        disabled={splitting}
                      >
                        <Feather name="scissors" size={14} color={Colors.zinc600} />
                        <Text style={styles.splitPageText}>이 페이지 나누기</Text>
                      </Pressable>
                    )}
                  </View>
                  {idx < pages.length - 1 ? (
                    <Pressable style={styles.dividerRow} onPress={() => handleRemoveDivider(idx)}>
                      <View style={styles.dividerLine} />
                      <View style={styles.dividerButton}>
                        <Feather name="x" size={12} color={Colors.zinc500} />
                      </View>
                      <View style={styles.dividerLine} />
                    </Pressable>
                  ) : idx < pages.length && (
                    <Pressable
                      style={styles.addDividerRow}
                      onPress={() => handleInsertDivider(idx)}
                      disabled={splitting}
                    >
                      <View style={styles.addDividerLine} />
                      <View style={styles.addDividerButton}>
                        <Feather name="plus" size={12} color={Colors.zinc500} />
                      </View>
                      <View style={styles.addDividerLine} />
                    </Pressable>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <ConfirmModal
        visible={stepBackConfirmVisible}
        title="작성 단계로 돌아가기"
        description="작성 단계로 돌아가겠습니까? 현재 분할 상태는 저장됩니다."
        confirmLabel="돌아가기"
        cancelLabel="취소"
        onConfirm={handleConfirmStepBack}
        onCancel={() => setStepBackConfirmVisible(false)}
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
  headerCenter: {
    alignItems: "center",
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  headerTitleTappable: {
    textDecorationLine: "underline",
    textDecorationColor: Colors.zinc400,
  },
  pageCount: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    marginTop: 2,
  },
  nextButton: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  toolbarButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.zinc50,
  },
  toolbarButtonActive: {
    backgroundColor: Colors.zinc900,
  },
  toolbarText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc600,
  },
  toolbarTextActive: {
    color: Colors.white,
  },
  toolbarSpacer: {
    flex: 1,
  },
  autoSplitButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.zinc200,
  },
  autoSplitText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc600,
  },
  editContainer: {
    flex: 1,
    paddingHorizontal: Spacing.screenPx,
  },
  editHint: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc400,
    paddingVertical: 8,
    textAlign: "center",
  },
  editInput: {
    flex: 1,
    ...Typography.body,
    fontSize: 15,
    lineHeight: 24,
    color: Colors.zinc800,
    paddingVertical: 0,
    textAlignVertical: "top",
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 0,
  },
  pageCard: {
    backgroundColor: Colors.zinc50,
    borderRadius: 12,
    padding: 16,
  },
  pageCardWarning: {
    borderWidth: 1,
    borderColor: "#ef4444",
  },
  pageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  pageLabel: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.zinc600,
  },
  charCount: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  pageContent: {
    ...Typography.body,
    fontSize: 14,
    lineHeight: 22,
    color: Colors.zinc800,
  },
  warningText: {
    ...Typography.caption,
    fontSize: 12,
    color: "#ef4444",
    marginTop: 8,
  },
  splitPageButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: Colors.zinc100,
    alignSelf: "flex-start",
  },
  splitPageText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc600,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.zinc200,
  },
  dividerButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 8,
  },
  addDividerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  addDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.zinc100,
    borderStyle: "dashed" as never,
  },
  addDividerButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.zinc50,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 8,
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
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
  },
});
