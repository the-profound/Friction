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
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, ReaderTokens, cqiToPx, readerFontSize, readerLetterSpacing } from "@/constants/tokens";
import {
  splitContentToPages,
  validatePages,
} from "@/lib/pageDivision";
import type { DivisionWarning } from "@/lib/pageDivision";
import { canTransitionForward } from "@/lib/articleStatusCycle";
import type { ArticleStatus } from "@/lib/policies";
import { MarkdownPolicy } from "@/lib/policies";
import {
  useGetArticle,
  useUpdateArticle,
  useTransitionArticleStatus,
  TransitionArticleBodyTargetStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { parseMarkdownBlocks } from "@/utils/markdownParser";
import MarkdownBlock from "@/components/MarkdownBlock/MarkdownBlock";

const PAGE_DIVIDER = MarkdownPolicy.PAGE_DIVIDER;

const SECTION_BOUNDARY_RE = /^(#{1,3}\s|-\s)/;

// ─── 그리디 분할 엔진 타입 ────────────────────────────────────────────────────
type BSJob = {
  paraIdx: number;
  allWords: string[];    // 원본 단락의 전체 단어 배열
  wordOffset: number;    // 이 job이 탐색을 시작하는 단어 인덱스
  lo: number;
  hi: number;
  best: number;
  targetH: number;       // 이 job의 목표 높이 (소제목 잔여 또는 전체 threshold)
};

// 분할 결과: 단락 인덱스 → [{단어 시작 오프셋, 단어 수}]
type BSResult = { wordOffset: number; wordCount: number };

type SplitEngineState =
  | {
      phase: 'para';
      paragraphs: string[];
      scope: 'all' | { pageIndex: number };
      threshold: number;
      paraKey: number;
    }
  | {
      phase: 'bs';
      paragraphs: string[];
      scope: 'all' | { pageIndex: number };
      threshold: number;
      paraHeights: Record<number, number>;
      bsJobs: BSJob[];
      currentJobIdx: number;
      bsKey: number;
      splitResults: Record<number, BSResult[]>; // 완료된 분할 결과 누적
    };

/**
 * Greedy 분할 알고리즘 (순수 함수)
 *
 * 규칙 1: 소제목(###/-) → 무조건 앞에서 페이지 분할
 * 규칙 2: 소제목 페이지에 본문 결합 — 소제목만 남기지 않는다.
 *   currentParas가 소제목만 있고 다음 문단이 넘칠 경우 BS로 소제목 뒤를 채움.
 * 규칙 3: 일반 문단 — 넘칠 때 이전 \n\n에서 자름 (Case A).
 *   페이지 첫 문단이라 이전 \n\n이 없으면 BS 단어 단위로 자름 (Case B).
 *
 * splitResults: 각 단락의 다단(多段) 분할 정보. 한 문단이 3~4페이지가 되더라도
 * 결과 배열의 각 entry를 순서대로 적용해 모두 별도 페이지로 분리한다.
 */
function runGreedy(
  paragraphs: string[],
  paraHeights: Record<number, number>,
  splitResults: Record<number, BSResult[]>,
  threshold: number,
): string[] {
  const pages: string[] = [];
  let currentParas: string[] = [];
  let currentH = 0;

  /**
   * BS 분할 적용: splitResults[paraIdx]의 청크들을 순서대로 페이지에 올린다.
   * - 첫 번째 청크: 현재 페이지(currentParas)에 이어 붙인 뒤 flush
   * - 이후 청크: 각각 독립 페이지
   * - 마지막 남은 단어: 다음 페이지의 시작(currentParas)에 넣음
   */
  const applyBSSplit = (para: string, paraH: number, paraIdx: number) => {
    const results = splitResults[paraIdx];
    const allWords = para.split(/ +/).filter((w) => w);

    if (!results || results.length === 0) {
      // BS 결과 없음 → 단락 전체를 현재 페이지에 올리고 flush
      pages.push([...currentParas, para].join('\n\n'));
      currentParas = [];
      currentH = 0;
      return;
    }

    let offset = 0;
    for (let ri = 0; ri < results.length; ri++) {
      const { wordOffset, wordCount } = results[ri];
      // wordOffset은 항상 offset과 같아야 하지만 방어적으로 사용
      const chunk = allWords.slice(wordOffset, wordOffset + wordCount).join(' ');
      offset = wordOffset + wordCount;

      if (ri === 0) {
        // 첫 청크: 현재 페이지(소제목 등)에 이어 붙임
        if (chunk) currentParas.push(chunk);
        pages.push(currentParas.join('\n\n'));
        currentParas = [];
        currentH = 0;
      } else {
        // 이후 청크: 각각 독립 페이지
        if (chunk) pages.push(chunk);
      }
    }

    // 마지막 남은 단어 → 다음 페이지의 첫 요소로
    if (offset < allWords.length) {
      const remaining = allWords.slice(offset).join(' ');
      currentParas = [remaining];
      currentH = paraH * (allWords.length - offset) / allWords.length;
    }
  };

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const paraH = paraHeights[i] ?? 0;
    const firstLine = para.split('\n')[0] ?? '';
    const isHeading = SECTION_BOUNDARY_RE.test(firstLine);

    // 규칙 1: 소제목 → 무조건 앞에서 페이지 분할
    if (isHeading && currentParas.length > 0) {
      pages.push(currentParas.join('\n\n'));
      currentParas = [];
      currentH = 0;
    }

    if (currentH + paraH <= threshold) {
      // 제한 이내: 계속 추가
      currentParas.push(para);
      currentH += paraH;
    } else if (currentParas.length > 0) {
      const isHeadingOnlyPage = currentParas.every(
        (p) => SECTION_BOUNDARY_RE.test(p.split('\n')[0] ?? ''),
      );
      if (isHeadingOnlyPage) {
        // 규칙 2: 소제목만 있는 페이지 → BS 결과로 잔여 공간 채움
        applyBSSplit(para, paraH, i);
      } else {
        // 규칙 3 Case A: 이전 \n\n에서 자름
        pages.push(currentParas.join('\n\n'));
        currentParas = [];
        currentH = 0;
        // 이동된 단락 자체가 threshold 초과이고 BS 결과가 있으면 분할 적용
        if (paraH > threshold && splitResults[i]?.length) {
          applyBSSplit(para, paraH, i);
        } else {
          currentParas = [para];
          currentH = paraH;
        }
      }
    } else {
      // 규칙 3 Case B: 페이지 첫 문단 초과 → BS 단어 단위 분할
      applyBSSplit(para, paraH, i);
    }
  }

  if (currentParas.length > 0) pages.push(currentParas.join('\n\n'));
  return pages.filter((p) => p.trim());
}

function splitAtSectionBoundaries(para: string): string[] {
  const lines = para.split('\n');
  const result: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (SECTION_BOUNDARY_RE.test(line) && current.some((l) => l.trim())) {
      result.push(current.join('\n').trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.some((l) => l.trim())) {
    result.push(current.join('\n').trim());
  }
  return result.filter((c) => c.trim());
}

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
    return { safeAreaWidth, safeAreaHeight, paddingX, paddingY, bodyFontSize, bodyLineHeight, bodyLetterSpacing };
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
  const { safeAreaWidth, safeAreaHeight, paddingX, paddingY, bodyFontSize, bodyLineHeight, bodyLetterSpacing } = readerLayout;

  const pageContentHeight = safeAreaHeight;

  const [pageHeights, setPageHeights] = useState<Record<number, number>>({});
  const handleMeasureHeight = useCallback((idx: number, height: number) => {
    setPageHeights((prev) => {
      if (prev[idx] === height) return prev;
      return { ...prev, [idx]: height };
    });
  }, []);

  // ─── 그리디 분할 엔진 상태 ───────────────────────────────────────────────────
  const [splitEngine, setSplitEngine] = useState<SplitEngineState | null>(null);
  const [splitParaHeights, setSplitParaHeights] = useState<Record<number, number>>({});
  const [bsMeasuredH, setBsMeasuredH] = useState<number | null>(null);
  const splitKeyRef = useRef(0);

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
  }, [measurePages, pageHeights, pageContentHeight]);

  const warnings = useMemo(() => [...baseWarnings, ...heightWarnings], [baseWarnings, heightWarnings]);
  const hasRedWarnings = warnings.some((w) => w.level === "red");

  const handleInsertDivider = useCallback((afterPageIndex: number) => {
    const rawPages = content.split(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "m"));
    if (afterPageIndex < 0 || afterPageIndex >= rawPages.length) return;
    const pageContent = rawPages[afterPageIndex];
    const rawParas = pageContent.split("\n\n").filter((p) => p.trim());
    const paragraphs = rawParas.flatMap(splitAtSectionBoundaries);
    if (paragraphs.length < 2) {
      Alert.alert("분할 불가", "이 페이지에는 나눌 수 있는 단락이 부족합니다.");
      return;
    }
    setSplitParaHeights({});
    setBsMeasuredH(null);
    setSplitEngine({
      phase: 'para',
      paragraphs,
      scope: { pageIndex: afterPageIndex },
      threshold: splitThreshold,
      paraKey: ++splitKeyRef.current,
    });
  }, [content, splitThreshold]);

  const handleRemoveDivider = useCallback((pageBreakIndex: number) => {
    const parts = content.split(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "m"));
    if (pageBreakIndex < 0 || pageBreakIndex >= parts.length - 1) return;
    parts[pageBreakIndex] = parts[pageBreakIndex] + "\n\n" + parts[pageBreakIndex + 1];
    parts.splice(pageBreakIndex + 1, 1);
    setContent(parts.join(`\n${PAGE_DIVIDER}\n`));
  }, [content]);

  const handleAutoSplit = useCallback(() => {
    const plain = content.replace(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "gm"), "\n\n");
    const rawParagraphs = plain.split("\n\n").filter((p) => p.trim());
    const paragraphs = rawParagraphs.flatMap(splitAtSectionBoundaries);
    if (paragraphs.length < 2) {
      Alert.alert("자동 분할 불가", "단락이 부족하여 자동 분할할 수 없습니다.");
      return;
    }
    setSplitParaHeights({});
    setBsMeasuredH(null);
    setSplitEngine({
      phase: 'para',
      paragraphs,
      scope: 'all',
      threshold: splitThreshold,
      paraKey: ++splitKeyRef.current,
    });
  }, [content, splitThreshold]);

  // ─── 그리디 엔진: 단락 측정 완료 후 처리 ────────────────────────────────────
  useEffect(() => {
    if (!splitEngine || splitEngine.phase !== 'para') return;
    const allMeasured = splitEngine.paragraphs.every((_, i) => splitParaHeights[i] !== undefined);
    if (!allMeasured) return;

    // 그리디 시뮬레이션: 어떤 단락이 BS가 필요한지, targetH는 얼마인지 파악
    const { paragraphs, threshold } = splitEngine;
    const bsJobs: BSJob[] = [];
    let simParaIdxs: number[] = [];
    let simH = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const paraH = splitParaHeights[i] ?? 0;
      const isHeading = SECTION_BOUNDARY_RE.test(para.split('\n')[0] ?? '');

      if (isHeading && simParaIdxs.length > 0) {
        simParaIdxs = [];
        simH = 0;
      }

      if (simH + paraH <= threshold) {
        simParaIdxs.push(i);
        simH += paraH;
      } else if (simParaIdxs.length > 0) {
        const isHeadingOnlyPage = simParaIdxs.every(
          (pi) => SECTION_BOUNDARY_RE.test(paragraphs[pi].split('\n')[0] ?? ''),
        );
        if (isHeadingOnlyPage) {
          // 규칙 2: 소제목 페이지 잔여 공간 채우기 (targetH = 소제목 높이 제외한 나머지)
          const remainingH = Math.max(0, threshold - simH);
          const allWords = para.split(/ +/).filter((w) => w);
          if (allWords.length > 1 && remainingH > 0) {
            bsJobs.push({ paraIdx: i, allWords, wordOffset: 0, lo: 1, hi: allWords.length, best: 1, targetH: remainingH });
          }
          simParaIdxs = [i];
          simH = paraH * 0.5;
        } else {
          // 규칙 3 Case A: 이전 \n\n에서 자름, 현재 단락 다음 페이지
          simParaIdxs = [i];
          simH = paraH;
          // 이동된 단락 자체가 threshold를 초과하면 BSJob 추가 (마지막 단락 분할 누락 방지)
          if (paraH > threshold) {
            const allWords = para.split(/ +/).filter((w) => w);
            if (allWords.length > 1) {
              bsJobs.push({ paraIdx: i, allWords, wordOffset: 0, lo: 1, hi: allWords.length, best: 1, targetH: threshold });
              simH = paraH * 0.5;
            }
          }
        }
      } else {
        // 규칙 3 Case B: 페이지 첫 단락 초과 → 전체 threshold 기준 BS
        const allWords = para.split(/ +/).filter((w) => w);
        if (allWords.length > 1) {
          bsJobs.push({ paraIdx: i, allWords, wordOffset: 0, lo: 1, hi: allWords.length, best: 1, targetH: threshold });
        }
        simParaIdxs = [i];
        simH = paraH * 0.5;
      }
    }

    if (bsJobs.length > 0) {
      setSplitEngine({
        phase: 'bs',
        paragraphs: splitEngine.paragraphs,
        scope: splitEngine.scope,
        threshold: splitEngine.threshold,
        paraHeights: { ...splitParaHeights },
        bsJobs,
        currentJobIdx: 0,
        bsKey: ++splitKeyRef.current,
        splitResults: {},
      });
    } else {
      const resultPages = runGreedy(splitEngine.paragraphs, splitParaHeights, {}, splitEngine.threshold);
      const { scope } = splitEngine;
      if (scope === 'all') {
        const joined = resultPages.join(`\n${PAGE_DIVIDER}\n`);
        setContent(joined);
        setDebouncedContent(joined);
      } else {
        const rawPages = content.split(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "m"));
        rawPages.splice(scope.pageIndex, 1, ...resultPages);
        const joined = rawPages.join(`\n${PAGE_DIVIDER}\n`);
        setContent(joined);
        setDebouncedContent(joined);
      }
      setPageHeights({});
      setSplitEngine(null);
      setSplitParaHeights({});
    }
  }, [splitEngine, splitParaHeights, content]);

  // ─── 그리디 엔진: binary search 측정 스텝 처리 ───────────────────────────────
  // 한 문단이 여러 페이지에 걸칠 경우, job 완료 후 남은 단어가 있으면
  // 자동으로 다음 BSJob을 큐에 추가하여 끝까지 분할한다.
  useEffect(() => {
    if (!splitEngine || splitEngine.phase !== 'bs') return;
    if (bsMeasuredH === null) return;

    const { bsJobs, currentJobIdx, threshold, splitResults } = splitEngine;
    const job = { ...bsJobs[currentJobIdx] };
    const mid = Math.floor((job.lo + job.hi) / 2);

    if (bsMeasuredH <= job.targetH) {
      job.best = mid;
      job.lo = mid + 1;
    } else {
      job.hi = mid - 1;
    }

    const newBsJobs = [...bsJobs];
    newBsJobs[currentJobIdx] = job;
    setBsMeasuredH(null);

    if (job.lo > job.hi) {
      // ── 이 job 완료: 결과를 splitResults에 기록 ──
      const newSplitResults: Record<number, BSResult[]> = { ...splitResults };
      const entry: BSResult = { wordOffset: job.wordOffset, wordCount: job.best };
      newSplitResults[job.paraIdx] = [...(newSplitResults[job.paraIdx] ?? []), entry];

      // ── 남은 단어 확인: 있으면 새 BSJob 추가 (연속 분할 루프) ──
      const nextWordOffset = job.wordOffset + job.best;
      if (nextWordOffset < job.allWords.length) {
        const remainingWords = job.allWords.slice(nextWordOffset);
        const nextJob: BSJob = {
          paraIdx: job.paraIdx,
          allWords: job.allWords,
          wordOffset: nextWordOffset,
          lo: 1,
          hi: remainingWords.length, // 모든 남은 단어가 맞으면 best = length (분할 없음)
          best: Math.min(1, remainingWords.length),
          targetH: threshold, // 다음 페이지는 항상 전체 threshold
        };
        // 현재 job 다음에 삽입
        newBsJobs.splice(currentJobIdx + 1, 0, nextJob);
      }

      const nextJobIdx = currentJobIdx + 1;
      if (nextJobIdx < newBsJobs.length) {
        // 다음 job으로 이동
        setSplitEngine({
          ...splitEngine,
          bsJobs: newBsJobs,
          currentJobIdx: nextJobIdx,
          bsKey: ++splitKeyRef.current,
          splitResults: newSplitResults,
        });
      } else {
        // 모든 job 완료 → runGreedy 실행
        const resultPages = runGreedy(splitEngine.paragraphs, splitEngine.paraHeights, newSplitResults, threshold);
        const { scope } = splitEngine;
        if (scope === 'all') {
          const joined = resultPages.join(`\n${PAGE_DIVIDER}\n`);
          setContent(joined);
          setDebouncedContent(joined);
        } else {
          const rawPages = content.split(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "m"));
          rawPages.splice(scope.pageIndex, 1, ...resultPages);
          const joined = rawPages.join(`\n${PAGE_DIVIDER}\n`);
          setContent(joined);
          setDebouncedContent(joined);
        }
        setPageHeights({});
        setSplitEngine(null);
        setSplitParaHeights({});
      }
    } else {
      setSplitEngine({ ...splitEngine, bsJobs: newBsJobs, bsKey: ++splitKeyRef.current });
    }
  }, [bsMeasuredH, splitEngine, content]);

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
        data: { content, pages: pagesJson },
      });
      // 캐시를 즉시 갱신하여 on-01c가 최신 pages를 받도록 함
      queryClient.setQueryData([`/api/articles/${id}`], updatedArticle);
      await transitionStatus.mutateAsync({
        id: id!,
        data: { targetStatus: TransitionArticleBodyTargetStatus.CLOSING },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      router.push({ pathname: "/on-01c", params: { id } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "상태 전환에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [content, article, pages, hasRedWarnings, id, router, updateArticle, transitionStatus, queryClient]);

  const handleBack = useCallback(async () => {
    if (!id) { router.back(); return; }
    try {
      const pagesJson = pages.map((p) => p.content);
      const updatedArticle = await updateArticle.mutateAsync({
        id,
        data: { content, pages: pagesJson },
      });
      queryClient.setQueryData([`/api/articles/${id}`], updatedArticle);
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      router.back();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "저장에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [id, content, pages, router, updateArticle, queryClient]);

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
          <Text style={styles.headerTitle}>분할</Text>
          <Text style={styles.pageCount}>{pages.length}페이지</Text>
        </View>
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
        <Pressable style={styles.autoSplitButton} onPress={handleAutoSplit}>
          <Feather name="scissors" size={14} color={Colors.zinc600} />
          <Text style={styles.autoSplitText}>자동분할</Text>
        </Pressable>
      </View>

      {/* 경고 표시용: 현재 페이지들의 전체 높이 측정 (패딩 포함) */}
      {measurePages.map((page, idx) => {
        const blocks = parseMarkdownBlocks(page.content);
        return (
          <View
            key={`measure-${idx}`}
            pointerEvents="none"
            style={{
              position: "absolute",
              opacity: 0,
              width: safeAreaWidth,
              paddingHorizontal: paddingX,
              paddingTop: paddingY,
              paddingBottom: insets.bottom + paddingY,
            }}
            onLayout={(e) => handleMeasureHeight(idx, e.nativeEvent.layout.height)}
          >
            {blocks.map((block, bi) => (
              <View key={bi} style={{ marginBottom: bodyLineHeight * 0.6 }}>
                <MarkdownBlock block={block} onCollect={() => {}} fontSize={bodyFontSize} lineHeight={bodyLineHeight} letterSpacing={bodyLetterSpacing} />
              </View>
            ))}
          </View>
        );
      })}

      {/* 그리디 엔진: 단락별 높이 측정 (패딩 없음 → netHeight와 직접 비교) */}
      {splitEngine?.phase === 'para' && splitEngine.paragraphs.map((para, i) => {
        const blocks = parseMarkdownBlocks(para);
        return (
          <View
            key={`split-para-${splitEngine.paraKey}-${i}`}
            pointerEvents="none"
            style={{ position: "absolute", opacity: 0, width: safeAreaWidth, paddingHorizontal: paddingX }}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              setSplitParaHeights((prev) => {
                if (prev[i] === h) return prev;
                return { ...prev, [i]: h };
              });
            }}
          >
            {blocks.map((block, bi) => (
              <View key={bi} style={{ marginBottom: bodyLineHeight * 0.6 }}>
                <MarkdownBlock block={block} onCollect={() => {}} fontSize={bodyFontSize} lineHeight={bodyLineHeight} letterSpacing={bodyLetterSpacing} />
              </View>
            ))}
          </View>
        );
      })}

      {/* 그리디 엔진: binary search 후보 텍스트 측정 (1개씩) */}
      {(() => {
        if (!splitEngine || splitEngine.phase !== 'bs') return null;
        const job = splitEngine.bsJobs[splitEngine.currentJobIdx];
        if (!job || job.lo > job.hi) return null;
        const mid = Math.floor((job.lo + job.hi) / 2);
        // wordOffset 이후 mid개의 단어만 측정 (allWords 기반)
        const candidateText = job.allWords.slice(job.wordOffset, job.wordOffset + mid).join(' ');
        const blocks = parseMarkdownBlocks(candidateText);
        return (
          <View
            key={`split-bs-${splitEngine.bsKey}`}
            pointerEvents="none"
            style={{ position: "absolute", opacity: 0, width: safeAreaWidth, paddingHorizontal: paddingX }}
            onLayout={(e) => setBsMeasuredH(e.nativeEvent.layout.height)}
          >
            {blocks.map((block, bi) => (
              <View key={bi} style={{ marginBottom: bodyLineHeight * 0.6 }}>
                <MarkdownBlock block={block} onCollect={() => {}} fontSize={bodyFontSize} lineHeight={bodyLineHeight} letterSpacing={bodyLetterSpacing} />
              </View>
            ))}
          </View>
        );
      })()}

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
