import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import WritingStateBar, { type WritingStage } from "@/components/WritingStateBar/WritingStateBar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useAutoSave } from "@/lib/useAutoSave";
import { useEditorLayout } from "@/lib/useEditorLayout";
import {
  splitContentToPages,
  splitPageContentForDivision,
  validatePages,
  simulateGreedyJobs,
  resolveBSJob,
  runGreedy,
  bsCandidateKey,
  bsCandidatesForJob,
  findOverflowBlockIndex,
  cumulativeHeightBefore,
  findOverflowCharOffsetInBlock,
  type BSJob,
  type BSResult,
  type DivisionWarning,
} from "@/lib/pageDivision";
import { parseMarkdownBlocks, tokensToPlainText, type MarkdownBlockType } from "@/utils/markdownParser";
import { canTransitionForward, canStepBack } from "@/lib/articleStatusCycle";
import type { ArticleStatus } from "@/lib/policies";
import { MarkdownPolicy } from "@/lib/policies";
import {
  useGetArticle,
  useUpdateArticle,
  useTransitionArticleStatus,
  TransitionArticleBodyTargetStatus,
  ApiError,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import WebViewMeasureLayer from "@/components/WebViewMeasureLayer";
import type {
  MeasureRequest,
  MeasureCandidate,
} from "@/components/PretextMeasureLayer/PretextMeasureLayer";
import WebViewMarkdownEditor from "@/components/WebViewMarkdownEditor/WebViewMarkdownEditorCompat";
import type {
  WebViewMarkdownEditorRef,
  OnChangePayload,
  OnExportMarkdownPayload,
  OverflowRange,
} from "@/components/WebViewMarkdownEditor/types";

const PAGE_DIVIDER = MarkdownPolicy.PAGE_DIVIDER;

const PAGE_KEY_PREFIX = "page_";

export default function DividingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const articleQuery = useGetArticle(id ?? "");
  const article = id ? articleQuery.data : undefined;
  const articleLoading = id ? articleQuery.isLoading : false;

  const updateArticle = useUpdateArticle();
  const transitionStatus = useTransitionArticleStatus();

  const editorRef = useRef<WebViewMarkdownEditorRef>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [charCount, setCharCount] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const titleRef = useRef("");
  const contentRef = useRef("");
  const initializedRef = useRef(false);
  // Capture mount time so we can verify fresh data (dataUpdatedAt >= mountedAt)
  // before initializing the editor, avoiding stale-cache initialization.
  const mountedAtRef = useRef(Date.now());
  const initialContentRef = useRef("");
  const initialTitleRef = useRef("");
  const isNavigatingRef = useRef(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const pendingExportRef = useRef<{
    resolve: (md: string) => void;
    requestId: string;
  } | null>(null);

  const [stepBackConfirmVisible, setStepBackConfirmVisible] = useState(false);
  const [splitting, setSplitting] = useState(false);

  // Force a fresh fetch on mount so stale cache never initializes the editor
  // with outdated divider positions.
  useEffect(() => {
    if (id) {
      queryClient.invalidateQueries({ queryKey: [`/api/articles/${id}`] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Gate initialization on data being NEWER than this component's mount time.
    // This is more reliable than checking isFetching alone, which can be false
    // for a brief window between mount and when invalidateQueries triggers the
    // refetch, potentially letting stale cached data initialize the editor.
    const isDataFresh = articleQuery.dataUpdatedAt >= mountedAtRef.current;
    if (article && !initializedRef.current && isDataFresh) {
      initializedRef.current = true;
      const t = article.title || "";
      let c = article.content || "";
      if (article.pages && Array.isArray(article.pages) && article.pages.length > 0) {
        c = (article.pages as string[]).join(`\n${PAGE_DIVIDER}\n`);
      }
      setTitle(t);
      titleRef.current = t;
      setContent(c);
      contentRef.current = c;
      initialContentRef.current = c;
      initialTitleRef.current = t;
      setCharCount(c.length);
      if (editorReady) {
        editorRef.current?.setMarkdown(c);
        editorRef.current?.setTitle(t);
      }
    }
  }, [article, editorReady, articleQuery.dataUpdatedAt]);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleEditorReady = useCallback(() => {
    setEditorReady(true);
    editorRef.current?.setMarkdown(initialContentRef.current);
    editorRef.current?.setTitle(initialTitleRef.current);
  }, []);

  const getEditorContent = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      if (!editorRef.current || !editorReady) {
        resolve(contentRef.current);
        return;
      }
      const requestId = `export_${Date.now()}`;
      pendingExportRef.current = { resolve, requestId };
      editorRef.current.requestExportMarkdown(requestId);
      setTimeout(() => {
        if (pendingExportRef.current?.requestId === requestId) {
          pendingExportRef.current = null;
          resolve(contentRef.current);
        }
      }, 2000);
    });
  }, [editorReady]);

  const handleExportMarkdown = useCallback((payload: OnExportMarkdownPayload) => {
    contentRef.current = payload.markdown;
    setContent(payload.markdown);

    // 분할 화면에서는 모든 편집(분할선 추가/삭제/이동, 내용 수정) 이후
    // 스크롤 필요 여부가 즉시 재계산돼야 하므로 디바운스를 건너뛰고
    // debouncedContent를 항상 즉시 갱신한다.
    // PretextMeasureLayer는 request 참조 동등성으로 중복 측정을 방지하므로
    // 잦은 갱신에도 불필요한 remount가 발생하지 않는다.
    setDebouncedContent(payload.markdown);

    if (pendingExportRef.current?.requestId === payload.requestId) {
      pendingExportRef.current.resolve(payload.markdown);
      pendingExportRef.current = null;
    }
  }, []);

  const handleSave = useCallback(
    async (data: { title: string; content: string }) => {
      if (!id) return;
      const pgs = splitContentToPages(data.content).map((p) => p.content);
      await updateArticle.mutateAsync({
        id,
        data: { title: data.title, content: data.content, pages: pgs },
      });
    },
    [id, updateArticle],
  );

  const { markDirty, flush } = useAutoSave({
    onSave: handleSave,
    storageKey: id ? `dividing_${id}` : undefined,
  });

  const handleEditorChange = useCallback(
    (_payload: OnChangePayload) => {
      if (_payload.charCount !== undefined) {
        setCharCount(_payload.charCount);
      }
      if (_payload.isDirty && editorRef.current) {
        const requestId = `autosave_${Date.now()}`;
        pendingExportRef.current = {
          resolve: (md: string) => {
            contentRef.current = md;
            setContent(md);
            markDirty(titleRef.current, md);
          },
          requestId,
        };
        editorRef.current.requestExportMarkdown(requestId);
      }
    },
    [markDirty],
  );

  const handleTitleChange = useCallback(
    (text: string) => {
      setTitle(text);
      titleRef.current = text;
      markDirty(text, contentRef.current);
    },
    [markDirty],
  );

  const pages = useMemo(() => splitContentToPages(content), [content]);

  const [debouncedContent, setDebouncedContent] = useState(content);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedContent(content), 600);
    return () => clearTimeout(timer);
  }, [content]);

  const measurePages = useMemo(() => splitContentToPages(debouncedContent), [debouncedContent]);

  const baseWarnings = useMemo(() => validatePages(pages), [pages]);

  const editorLayout = useEditorLayout();
  const { containerWidth, safeAreaWidth, safeAreaHeight, paddingX, paddingY, textColumnWidth, bodyFontSize, bodyLineHeight, bodyLetterSpacing } = editorLayout;

  // NOTE — 측정/분할/읽기 화면 렌더링 엔진 정합:
  // 편집기(WebViewMarkdownEditor), 측정 레이어(WebViewMeasureLayer), 읽기 화면(WebViewMarkdownReader)
  // 모두 동일한 HTML/CSS/폰트를 사용하는 WebView 기반이다.
  // 따라서 오버플로 경고·자동분할 경계·읽기 화면 페이지 경계가 동일한 WebKit 렌더링 결과에 기반한다.

  const pageContentHeight = safeAreaHeight;
  const blockGap = bodyLineHeight * 0.6;
  const availableContentHeight = safeAreaHeight - 2 * paddingY - insets.bottom;

  // 페이지별 파싱된 블록 캐시 — 측정 키와 시각 렌더 모두 같은 블록 배열을 사용한다.
  const pageBlockMap = useMemo(() => {
    const map: Record<number, MarkdownBlockType[]> = {};
    for (const p of measurePages) {
      map[p.pageIndex] = parseMarkdownBlocks(p.content);
    }
    return map;
  }, [measurePages]);

  const [blockHeights, setBlockHeights] = useState<Record<string, number>>({});

  // debouncedContent가 바뀔 때마다 blockHeights 캐시를 초기화해 재측정을 강제한다.
  // applyEngineResult/handleMergeWithPrevious처럼 즉시 갱신하는 경로에서도
  // debouncedContent가 바뀌므로 여기서 한 번 더 정리해줘도 중복 없이 안전하다.
  useEffect(() => {
    setBlockHeights({});
  }, [debouncedContent]);

  // 블록 단위 측정 요청. 페이지 padding 없이 블록 단독 높이만 잰다.
  const warningRequest = useMemo<MeasureRequest | null>(() => {
    if (measurePages.length === 0) return null;
    const candidates: MeasureCandidate[] = [];
    for (const p of measurePages) {
      const blocks = pageBlockMap[p.pageIndex] ?? [];
      blocks.forEach((b, bi) => {
        candidates.push({
          key: `${PAGE_KEY_PREFIX}${p.pageIndex}_b_${bi}`,
          blocks: [b],
        });
      });
    }
    if (candidates.length === 0) return null;
    return {
      candidates,
      width: safeAreaWidth,
      paddingX,
      textColumnWidth,
      blockGap,
      fontSize: bodyFontSize,
      lineHeight: bodyLineHeight,
      letterSpacing: bodyLetterSpacing,
    };
  }, [measurePages, pageBlockMap, safeAreaWidth, paddingX, textColumnWidth, blockGap, bodyFontSize, bodyLineHeight, bodyLetterSpacing]);

  const handleWarningMeasured = useCallback((heights: Record<string, number>) => {
    setBlockHeights((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(heights);
      if (prevKeys.length === nextKeys.length && nextKeys.every((k) => prev[k] === heights[k])) {
        return prev;
      }
      return heights;
    });
  }, []);

  // 페이지별 합산 높이(컨텐츠 + 패딩 + insets) 및 오버플로 시작 블록 인덱스
  const pageOverflowInfo = useMemo(() => {
    const info: Record<number, { totalHeight: number; overflowBlockIdx: number }> = {};
    for (const p of measurePages) {
      const blocks = pageBlockMap[p.pageIndex] ?? [];
      const heights: number[] = [];
      let allMeasured = true;
      for (let bi = 0; bi < blocks.length; bi++) {
        const h = blockHeights[`${PAGE_KEY_PREFIX}${p.pageIndex}_b_${bi}`];
        if (h === undefined) {
          allMeasured = false;
          break;
        }
        heights.push(h);
      }
      if (!allMeasured) continue;
      const blockSum = heights.reduce((a, b) => a + b, 0);
      const totalHeight = blockSum + 2 * paddingY + insets.bottom;
      const overflowBlockIdx = findOverflowBlockIndex(heights, availableContentHeight, bodyLineHeight);
      info[p.pageIndex] = { totalHeight, overflowBlockIdx };
    }
    return info;
  }, [measurePages, pageBlockMap, blockHeights, paddingY, insets.bottom, availableContentHeight, bodyLineHeight]);

  // 호환을 위해 pageHeights 유지 — handleNext에서 사용된다.
  const pageHeights = useMemo<Record<number, number>>(() => {
    const map: Record<number, number> = {};
    for (const k in pageOverflowInfo) {
      map[Number(k)] = pageOverflowInfo[Number(k)].totalHeight;
    }
    return map;
  }, [pageOverflowInfo]);

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
          textColumnWidth,
          fontSize: bodyFontSize,
          lineHeight: bodyLineHeight,
          letterSpacing: bodyLetterSpacing,
        });
      });
    },
    [safeAreaWidth, paddingX, textColumnWidth, bodyFontSize, bodyLineHeight, bodyLetterSpacing],
  );

  const handleEngineMeasured = useCallback((heights: Record<string, number>) => {
    const r = engineResolveRef.current;
    engineResolveRef.current = null;
    setEngineRequest(null);
    if (r) r(heights);
  }, []);

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

  // 자동 분할은 안전 영역을 초과한 페이지에만 적용하므로, 초과 페이지 인덱스를 따로 추린다.
  // baseWarnings(빈 페이지 등)는 자동 분할로 해결할 수 없으므로 대상에서 제외한다.
  const overflowPageIndices = useMemo(() => {
    const set = new Set<number>();
    for (const w of heightWarnings) set.add(w.pageIndex);
    return Array.from(set).sort((a, b) => a - b);
  }, [heightWarnings]);
  const hasOverflowPages = overflowPageIndices.length > 0;

  // 오버플로 하이라이트(글자 단위)를 모든 초과 페이지에 대해 에디터에 전달한다.
  // 각 페이지에 대해 "초과가 시작된 글자 위치" 를 페이지 내부 글자 오프셋으로 계산해
  // 보낸다. 빈 배열/null 이면 모든 강조가 해제된다.
  useEffect(() => {
    if (!editorReady || !editorRef.current) return;
    if (overflowPageIndices.length === 0) {
      editorRef.current.setOverflowRanges(null);
      return;
    }

    const ranges: OverflowRange[] = [];
    for (const pageIdx of overflowPageIndices) {
      const info = pageOverflowInfo[pageIdx];
      if (!info || info.overflowBlockIdx < 0) continue;
      const blocks = pageBlockMap[pageIdx] ?? [];
      const obi = info.overflowBlockIdx;

      // 0..obi-1 블록의 plain text 길이 합
      let baseTextOffset = 0;
      for (let i = 0; i < obi && i < blocks.length; i++) {
        baseTextOffset += tokensToPlainText(blocks[i].tokens).length;
      }

      // 오버플로 블록 내부에서 안전 영역을 처음 벗어나는 글자 위치를 근사 산출
      let charOffsetInBlock = 0;
      const overflowBlock = blocks[obi];
      if (overflowBlock) {
        const overflowBlockHeight =
          blockHeights[`${PAGE_KEY_PREFIX}${pageIdx}_b_${obi}`] ?? 0;
        const cumBefore = cumulativeHeightBefore(
          blocks.map((_, i) =>
            blockHeights[`${PAGE_KEY_PREFIX}${pageIdx}_b_${i}`] ?? 0,
          ),
          obi,
        );
        const remaining = availableContentHeight - cumBefore;
        const overflowBlockText = tokensToPlainText(overflowBlock.tokens);
        charOffsetInBlock = findOverflowCharOffsetInBlock(
          overflowBlockHeight,
          bodyLineHeight,
          remaining,
          overflowBlockText.length,
        );
      }

      ranges.push({
        pageIndex: pageIdx,
        startCharOffset: baseTextOffset + charOffsetInBlock,
      });
    }

    editorRef.current.setOverflowRanges(ranges.length > 0 ? ranges : null);
  }, [
    editorReady,
    overflowPageIndices,
    pageOverflowInfo,
    pageBlockMap,
    blockHeights,
    availableContentHeight,
    bodyLineHeight,
  ]);

  const runDivisionEngine = useCallback(
    async (paragraphs: string[]): Promise<string[] | null> => {
      if (paragraphs.length < 1) return null;

      const paraCandidates: MeasureCandidate[] = paragraphs.map((p, i) => ({
        key: `para_${i}`,
        content: p,
      }));
      const paraHeightMap = await measureEngine(paraCandidates);
      const paraHeights: Record<number, number> = {};
      paragraphs.forEach((_, i) => {
        paraHeights[i] = paraHeightMap[`para_${i}`] ?? 0;
      });

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

      return runGreedy(paragraphs, paraHeights, splitResults, splitThreshold);
    },
    [measureEngine, splitThreshold],
  );

  const applyEngineResult = useCallback(
    (engineOutPages: string[]) => {
      const joined = engineOutPages.join(`\n${PAGE_DIVIDER}\n`);
      contentRef.current = joined;
      setContent(joined);
      setDebouncedContent(joined);
      setBlockHeights({});
      if (editorRef.current && editorReady) {
        editorRef.current.setMarkdown(joined);
      }
      markDirty(titleRef.current, joined);
      // Flush immediately after a structural change so navigating away before
      // the debounce fires does not lose the new divider positions.
      flush().catch((err) => {
        console.warn("[on-01b] Immediate flush failed after structural change:", err);
      });
    },
    [editorReady, markDirty, flush],
  );

  // SSOT [PD] — 자동 분할 적용 범위 규칙
  // 자동 분할 버튼은 "안전 영역을 초과한 페이지 구간"에만 분할 엔진을 적용한다.
  // 초과되지 않은 사용자 분할 경계는 그대로 보존하며, 자동 분할 직후에도
  // 사용자가 페이지 chip의 합치기/나누기 버튼으로 미세 조정할 수 있다.
  // 초과 페이지가 없으면 버튼은 비활성 상태로 유지된다.
  const handleAutoSplit = useCallback(async () => {
    if (splitting) return;
    if (!hasOverflowPages) return;
    const cur = await getEditorContent();
    const rawPages = cur.split(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "m"));
    // 인덱스 보존을 위해 높은 인덱스부터 순서대로 처리한다.
    const targets = [...overflowPageIndices]
      .filter((i) => i >= 0 && i < rawPages.length)
      .sort((a, b) => b - a);
    if (targets.length === 0) {
      Alert.alert("자동 분할 불필요", "분량을 초과하는 페이지가 없습니다.");
      return;
    }
    setSplitting(true);
    try {
      const next = [...rawPages];
      let appliedAny = false;
      for (const idx of targets) {
        const paragraphs = splitPageContentForDivision(next[idx]);
        if (paragraphs.length < 2) continue;
        const out = await runDivisionEngine(paragraphs);
        if (out && out.length > 0) {
          next.splice(idx, 1, ...out);
          appliedAny = true;
        }
      }
      if (!appliedAny) {
        Alert.alert(
          "자동 분할 불가",
          "초과된 페이지를 더 잘게 나눌 수 없습니다. 본문을 직접 편집해 주세요.",
        );
        return;
      }
      applyEngineResult(next);
    } finally {
      setSplitting(false);
    }
  }, [splitting, hasOverflowPages, overflowPageIndices, getEditorContent, runDivisionEngine, applyEngineResult]);

  const handleSplitPage = useCallback(
    async (pageIndex: number) => {
      if (splitting) return;
      const cur = await getEditorContent();
      const rawPages = cur.split(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "m"));
      if (pageIndex < 0 || pageIndex >= rawPages.length) return;
      const paragraphs = splitPageContentForDivision(rawPages[pageIndex]);
      if (paragraphs.length < 2) {
        Alert.alert("분할 불가", "이 페이지에는 나눌 수 있는 단락이 부족합니다.");
        return;
      }
      setSplitting(true);
      try {
        const out = await runDivisionEngine(paragraphs);
        if (out) {
          const before = rawPages.slice(0, pageIndex);
          const after = rawPages.slice(pageIndex + 1);
          const newPages = [...before, ...out, ...after];
          applyEngineResult(newPages);
        }
      } finally {
        setSplitting(false);
      }
    },
    [splitting, getEditorContent, runDivisionEngine, applyEngineResult],
  );

  const handleMergeWithPrevious = useCallback(
    async (pageIndex: number) => {
      if (pageIndex <= 0) return;
      const cur = await getEditorContent();
      const parts = cur.split(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "m"));
      const breakIndex = pageIndex - 1;
      if (breakIndex < 0 || breakIndex >= parts.length - 1) return;
      parts[breakIndex] = parts[breakIndex] + "\n\n" + parts[breakIndex + 1];
      parts.splice(breakIndex + 1, 1);
      const joined = parts.join(`\n${PAGE_DIVIDER}\n`);
      contentRef.current = joined;
      setContent(joined);
      setDebouncedContent(joined);
      setBlockHeights({});
      if (editorRef.current && editorReady) {
        editorRef.current.setMarkdown(joined);
      }
      markDirty(titleRef.current, joined);
      // Flush immediately so the merged state is persisted before the user
      // can navigate away within the debounce window.
      flush().catch((err) => {
        console.warn("[on-01b] Immediate flush failed after merge:", err);
      });
    },
    [getEditorContent, editorReady, markDirty, flush],
  );

  const handleNext = useCallback(async () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);

    const cur = await getEditorContent();
    markDirty(titleRef.current, cur);
    const flushResult = await flush();
    if (!flushResult.ok) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      Alert.alert("저장 실패", "저장이 완료되지 않았습니다. 다시 시도해주세요.");
      return;
    }

    const pgs = splitContentToPages(cur);
    const liveBaseWarnings = validatePages(pgs);
    const liveHeightWarnings = pgs
      .filter((p) => {
        const h = pageHeights[p.pageIndex];
        return h !== undefined && h > pageContentHeight + bodyLineHeight;
      })
      .map((p): DivisionWarning => ({
        pageIndex: p.pageIndex,
        paragraphIndex: -1,
        level: "red",
        reason: "이 페이지는 읽기 화면에서 스크롤이 필요할 수 있습니다",
      }));
    const liveHasRedWarnings =
      [...liveBaseWarnings, ...liveHeightWarnings].some((w) => w.level === "red");
    const result = canTransitionForward("DIVIDING" as ArticleStatus, {
      content: cur,
      title: titleRef.current,
      pages: pgs.map((p) => ({ pageIndex: p.pageIndex, content: p.content, charCount: p.charCount })),
      hasRedWarnings: liveHasRedWarnings,
    });
    if (!result.allowed) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      Alert.alert("전환 불가", result.reason);
      return;
    }

    const pagesJson = pgs.map((p) => p.content);
    if (!id) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      return;
    }
    try {
      const updatedArticle = await updateArticle.mutateAsync({
        id,
        data: { title: titleRef.current, content: cur, pages: pagesJson, layoutWidth: containerWidth },
      });
      queryClient.setQueryData([`/api/articles/${id}`], updatedArticle);
      if (article?.status !== "CLOSING") {
        try {
          await transitionStatus.mutateAsync({
            id,
            data: { targetStatus: TransitionArticleBodyTargetStatus.CLOSING },
          });
        } catch (e: unknown) {
          if (!(e instanceof ApiError && e.status === 400)) throw e;
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      router.push({ pathname: "/on-01c", params: { id } });
    } catch (e: unknown) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      const msg = e instanceof Error ? e.message : "상태 전환에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [getEditorContent, markDirty, flush, hasRedWarnings, id, router, updateArticle, transitionStatus, queryClient, containerWidth, article]);

  const handleBack = useCallback(async () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);

    if (!id) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      router.replace("/(tabs)/on");
      return;
    }
    const cur = await getEditorContent();
    markDirty(titleRef.current, cur);
    const flushResult = await flush();
    if (!flushResult.ok) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      Alert.alert("오류", "저장에 실패했습니다. 다시 시도해주세요.");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
    isNavigatingRef.current = false;
    setIsNavigating(false);
    router.replace("/(tabs)/on");
  }, [id, getEditorContent, markDirty, flush, router, queryClient]);

  const handleConfirmStepBack = useCallback(async () => {
    setStepBackConfirmVisible(false);
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);

    const result = canStepBack("DIVIDING");
    if (!result.allowed) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      return;
    }
    if (!id) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      return;
    }
    const cur = await getEditorContent();
    markDirty(titleRef.current, cur);
    const flushResult = await flush();
    if (!flushResult.ok) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      Alert.alert("오류", "저장에 실패했습니다.");
      return;
    }
    try {
      await transitionStatus.mutateAsync({
        id,
        data: { targetStatus: TransitionArticleBodyTargetStatus.DRAFT },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      isNavigatingRef.current = false;
      setIsNavigating(false);
      router.replace({ pathname: "/on-01a", params: { id } });
    } catch (e: unknown) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      const msg = e instanceof Error ? e.message : "상태 전환에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [id, getEditorContent, markDirty, flush, transitionStatus, queryClient, router]);

  const handleDismissKeyboard = useCallback(() => {
    editorRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  const handleStateBarPress = useCallback((target: WritingStage) => {
    if (target === "DIVIDING") return;
    if (target === "DRAFT") {
      setStepBackConfirmVisible(true);
      return;
    }
    if (target === "CLOSING") {
      handleNext();
    }
  }, [handleNext]);

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
            current="DIVIDING"
            onPress={handleStateBarPress}
            disabled={isNavigating}
          />
          {keyboardVisible ? (
            <Pressable onPress={handleDismissKeyboard} hitSlop={12}>
              <MaterialCommunityIcons name="keyboard-off-outline" size={22} color={Colors.zinc600} />
            </Pressable>
          ) : isNavigating ? (
            <ActivityIndicator size="small" color={Colors.zinc400} />
          ) : (
            <View style={styles.headerRight} />
          )}
        </View>

        <View style={styles.toolbar}>
          <Text style={styles.pageCountLabel}>{pages.length}페이지</Text>
          <View style={styles.toolbarSpacer} />
          <Pressable
            style={[
              styles.autoSplitButton,
              (splitting || !hasOverflowPages) && styles.autoSplitButtonDisabled,
            ]}
            onPress={handleAutoSplit}
            disabled={splitting || !hasOverflowPages}
            accessibilityState={{ disabled: splitting || !hasOverflowPages }}
            accessibilityHint={
              hasOverflowPages
                ? "분량을 초과한 페이지만 다시 나눕니다. 다른 페이지 분할은 그대로 유지됩니다."
                : "초과된 페이지가 없어 자동 분할을 사용할 수 없습니다."
            }
          >
            <Feather name="scissors" size={14} color={Colors.zinc600} />
            <Text style={styles.autoSplitText}>{splitting ? "분할 중…" : "자동분할"}</Text>
          </Pressable>
        </View>

        {warnings.length > 0 ? (
          <View style={styles.warningBanner}>
            <Feather name="alert-triangle" size={14} color="#ef4444" />
            <Text style={styles.warningBannerText} numberOfLines={2}>
              {warnings.length === 1
                ? warnings[0].reason
                : `${warnings.length}개 페이지가 한 페이지 분량을 초과합니다. 자동분할을 사용하거나 본문을 직접 편집해 주세요.`}
            </Text>
          </View>
        ) : null}

        <View style={styles.pageStripWrapper}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.pageStrip}
            contentContainerStyle={styles.pageStripContent}
          >
          {pages.map((p) => {
            const idx = p.pageIndex;
            const hasWarning = warnings.some((w) => w.pageIndex === idx);
            return (
              <View
                key={`page-chip-${idx}`}
                style={[styles.pageChip, hasWarning && styles.pageChipWarning]}
              >
                {idx > 0 ? (
                  <Pressable
                    onPress={() => handleMergeWithPrevious(idx)}
                    hitSlop={6}
                    style={styles.chipMergeButton}
                    accessibilityLabel={`페이지 ${idx + 1} 이전 페이지와 합치기`}
                  >
                    <Feather name="x" size={12} color={Colors.zinc600} />
                  </Pressable>
                ) : null}
                <Text style={styles.chipPageNumber}>{idx + 1}쪽</Text>
                <Text style={styles.chipCharCount}>{p.charCount}자</Text>
                <Pressable
                  onPress={() => handleSplitPage(idx)}
                  disabled={splitting}
                  hitSlop={6}
                  style={[styles.chipSplitButton, splitting && styles.chipSplitButtonDisabled]}
                  accessibilityLabel={`페이지 ${idx + 1} 나누기`}
                >
                  <Feather name="scissors" size={11} color={Colors.zinc600} />
                  <Text style={styles.chipSplitText}>나누기</Text>
                </Pressable>
              </View>
            );
          })}
          </ScrollView>
        </View>

        <WebViewMeasureLayer request={warningRequest} onMeasured={handleWarningMeasured} />
        <WebViewMeasureLayer request={engineRequest} onMeasured={handleEngineMeasured} />

        <KeyboardAvoidingView
          style={styles.editorOuter}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={[styles.editorInner, { width: safeAreaWidth, paddingHorizontal: paddingX }]}>
            <View style={styles.markdownEditorContainer}>
              <WebViewMarkdownEditor
                ref={editorRef}
                initialMarkdown={contentRef.current}
                titleValue={title}
                placeholder="떠오르는 생각을 자유롭게 적어보세요..."
                editable
                onReady={handleEditorReady}
                onChange={handleEditorChange}
                onExportMarkdown={handleExportMarkdown}
                onTitleChange={handleTitleChange}
                onKeyboardVisibilityChange={setKeyboardVisible}
                bodyFontSize={bodyFontSize}
                bodyLetterSpacing={bodyLetterSpacing}
              />
            </View>
            <View style={styles.editorFooter}>
              <Text style={styles.charCountText}>{charCount}자</Text>
            </View>
          </View>
        </KeyboardAvoidingView>

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
  headerRight: {
    width: 22,
    height: 22,
  },
  pageCountLabel: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
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
  autoSplitButtonDisabled: {
    opacity: 0.5,
  },
  autoSplitText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc600,
  },
  editorOuter: {
    flex: 1,
    alignItems: "center",
  },
  editorInner: {
    flex: 1,
    paddingTop: 8,
  },
  markdownEditorContainer: {
    flex: 1,
  },
  editorFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc100,
  },
  charCountText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 8,
    backgroundColor: "#fef2f2",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#fecaca",
  },
  warningBannerText: {
    ...Typography.caption,
    flex: 1,
    fontSize: 12,
    color: "#b91c1c",
  },
  pageStripWrapper: {
    // 일반 View에 height를 명시해야 Yoga가 확실하게 높이를 결정한다.
    // (horizontal ScrollView에 직접 height를 주면 cross-axis 동작이 버전마다 달라 신뢰할 수 없다)
    // chip 콘텐츠 max=21pt + paddingVertical(4×2)=8 + border(1×2)=2 → chip=31pt
    // stripContent paddingVertical(6×2)=12 → wrapper=43pt. 여유 1pt 포함 44pt.
    height: 44,
    overflow: "hidden",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  pageStrip: {
    flex: 1,
  },
  pageStripContent: {
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 6,
    gap: 8,
    alignItems: "flex-start",
  },
  pageChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.zinc50,
  },
  pageChipWarning: {
    borderColor: "#ef4444",
    backgroundColor: "#fef2f2",
  },
  chipMergeButton: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.zinc200,
  },
  chipPageNumber: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc700,
    fontWeight: "600",
  },
  chipCharCount: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc500,
  },
  chipSplitButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: Colors.zinc200,
  },
  chipSplitButtonDisabled: {
    opacity: 0.5,
  },
  chipSplitText: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc700,
  },
});
