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
  BackHandler,
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
  bsCandidateText,
  bsCandidatesForJob,
  findOverflowBlockIndex,
  cumulativeHeightBefore,
  paraToWords,
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
import { useToast } from "@/contexts/ToastContext";
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
  OnSelectionUpdatePayload,
  OverflowRange,
} from "@/components/WebViewMarkdownEditor/types";
import KeyboardToolbar from "@/components/KeyboardToolbar/KeyboardToolbar";
import BlockTypeSheet from "@/components/KeyboardToolbar/BlockTypeSheet";

const PAGE_DIVIDER = MarkdownPolicy.PAGE_DIVIDER;

const DEFAULT_SELECTION: OnSelectionUpdatePayload = {
  activeBlock: "paragraph",
  isBold: false,
  isItalic: false,
  isUnderline: false,
};

const PAGE_KEY_PREFIX = "page_";

/**
 * 자동분할 BS와 동일한 측정 입력(마크다운 source `content`)을 만들기 위해
 * 블록 type 별로 마크다운 prefix를 돌려준다. PretextMeasureLayer가
 * `parseMarkdownBlocks(content)` 로 다시 파싱하므로 prefix를 붙여 주면
 * 헤딩/목록/인용의 폰트·들여쓰기가 그대로 반영된 상태로 측정된다.
 */
function blockMarkdownPrefix(block: MarkdownBlockType): string {
  switch (block.type) {
    case "h1": return "# ";
    case "h2": return "## ";
    case "h3": return "### ";
    case "ul_item": return "- ";
    case "ol_item": return `${block.index}. `;
    case "blockquote": return "> ";
    case "paragraph": return "";
  }
}

export default function DividingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { id, returnPage, returnBlock } = useLocalSearchParams<{ id: string; returnPage?: string; returnBlock?: string }>();
  const returnPageIndex = returnPage !== undefined ? parseInt(returnPage, 10) : undefined;
  const returnBlockIndex = returnBlock !== undefined ? parseInt(returnBlock, 10) : undefined;

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
  // `initialized` mirrors initializedRef as state so effects can re-run when
  // article data finishes loading. initializedRef is still used for synchronous
  // guards that must not trigger re-renders.
  const [initialized, setInitialized] = useState(false);
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

  const [selectionState, setSelectionState] = useState<OnSelectionUpdatePayload>(DEFAULT_SELECTION);
  const [blockTypeSheetVisible, setBlockTypeSheetVisible] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const pageStripRef = useRef<ScrollView>(null);
  const chipOffsetsRef = useRef<Record<number, number>>({});
  const returnScrollDoneRef = useRef(false);
  const returnBlockScrollDoneRef = useRef(false);
  // 칩 레이아웃이 완료될 때마다 카운트를 올려 복원 effect를 확정적으로 트리거한다.
  const [chipLayoutCount, setChipLayoutCount] = useState(0);

  // Force a fresh fetch on mount so stale cache never initializes the editor
  // with outdated divider positions.
  useEffect(() => {
    if (id) {
      queryClient.invalidateQueries({ queryKey: [`/api/articles/${id}`] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 마감 화면에서 복귀 시 page strip을 마지막으로 보던 페이지로 스크롤 복원.
  // chipLayoutCount가 바뀔 때(=칩 레이아웃 완료)마다 확인하여 최초 1회만 실행한다.
  useEffect(() => {
    if (returnPageIndex === undefined || returnScrollDoneRef.current) return;
    const offset = chipOffsetsRef.current[returnPageIndex];
    if (offset === undefined) return;
    returnScrollDoneRef.current = true;
    pageStripRef.current?.scrollTo({ x: Math.max(0, offset - 16), animated: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chipLayoutCount]);

  // 마감 화면에서 복귀 시 본문 에디터를 해당 페이지·블록으로 스크롤 + 하이라이트.
  // editorReady(state)와 initialized(state) 두 조건이 모두 충족된 시점에 최초 1회 실행한다.
  // 두 값 모두 의존 배열에 포함해 어느 쪽이 늦게 충족되더라도 반드시 재실행된다.
  useEffect(() => {
    if (returnPageIndex === undefined || returnBlockIndex === undefined) return;
    if (returnBlockScrollDoneRef.current) return;
    if (!editorReady || !initialized) return;
    returnBlockScrollDoneRef.current = true;
    // 레이아웃 안정화를 위해 짧게 지연 후 명령을 전달한다.
    const timer = setTimeout(() => {
      editorRef.current?.scrollToBlock(returnPageIndex, returnBlockIndex);
    }, 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorReady, initialized]);

  useEffect(() => {
    // Gate initialization on data being NEWER than this component's mount time.
    // This is more reliable than checking isFetching alone, which can be false
    // for a brief window between mount and when invalidateQueries triggers the
    // refetch, potentially letting stale cached data initialize the editor.
    const isDataFresh = articleQuery.dataUpdatedAt >= mountedAtRef.current;
    if (article && !initializedRef.current && isDataFresh) {
      initializedRef.current = true;
      setInitialized(true);
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
  const { containerWidth, safeAreaWidth, safeAreaHeight, paddingX, paddingY, textColumnWidth, bodyFontSize, bodyLineHeight, bodyLetterSpacing, titleFontSize } = editorLayout;

  // Step 5(B) — layoutWidth 선저장:
  // 분할 화면 진입 시 containerWidth는 useEditorLayout에서 즉시 결정되므로,
  // article을 받아 stored layoutWidth와 다르면 백그라운드에서 PATCH로 미리 저장한다.
  // "다음" 버튼을 눌러 on-01c로 이동할 때는 이미 저장돼 있으면 또 보내지 않는다.
  const savedLayoutWidthRef = useRef<number | null>(null);
  useEffect(() => {
    if (!id || !article || !containerWidth) return;
    const stored = (article as { layoutWidth?: number | null }).layoutWidth ?? null;
    if (stored === containerWidth) {
      savedLayoutWidthRef.current = containerWidth;
      return;
    }
    if (savedLayoutWidthRef.current === containerWidth) return;
    savedLayoutWidthRef.current = containerWidth;
    updateArticle
      .mutateAsync({ id, data: { layoutWidth: containerWidth } })
      .catch((e: unknown) => {
        // Background save — failure is non-fatal; handleNext will retry on Next.
        savedLayoutWidthRef.current = null;
        console.warn("[on-01b] background layoutWidth pre-save failed:", e);
      });
  }, [id, article, containerWidth, updateArticle]);

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

  const prevPageOverflowInfoRef = useRef<Record<number, { totalHeight: number; overflowBlockIdx: number }>>({});

  // 페이지별 합산 높이(컨텐츠 + 패딩 + insets) 및 오버플로 시작 블록 인덱스
  const pageOverflowInfo = useMemo(() => {
    const info: Record<number, { totalHeight: number; overflowBlockIdx: number }> = {};
    let anyPending = false;
    const currentPageIndices = new Set(measurePages.map((p) => p.pageIndex));
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
      if (!allMeasured) {
        anyPending = true;
        continue;
      }
      const blockSum = heights.reduce((a, b) => a + b, 0);
      const totalHeight = blockSum + 2 * paddingY + insets.bottom;
      const overflowBlockIdx = findOverflowBlockIndex(heights, availableContentHeight, bodyLineHeight);
      info[p.pageIndex] = { totalHeight, overflowBlockIdx };
    }
    if (anyPending) {
      const cached: Record<number, { totalHeight: number; overflowBlockIdx: number }> = {};
      for (const idx of currentPageIndices) {
        const prev = prevPageOverflowInfoRef.current[idx];
        if (prev) cached[idx] = prev;
      }
      return cached;
    }
    prevPageOverflowInfoRef.current = info;
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

  // ─────────────────────────────────────────────────────────────────────────
  // 오버플로 빨간 배경 시작 위치 — 에디터 직접 측정.
  //
  // RN 측정 레이어(WebViewMeasureLayer) 의 margin/padding 가정은 에디터의
  // 실제 CSS(.ProseMirror p {margin-bottom:1em} 등) 와 다르므로 그 위에서
  // 한 줄 정밀도의 강조 시작 위치를 계산하면 항상 작은 단위 부정합이 남는다.
  // 그래서 "에디터에 직접 묻기" 방식으로 통일한다 — RN 은 안전 영역 높이만
  // 알려주고, 에디터가 자기 ProseMirror DOM 의 view.coordsAtPos 를 binary
  // search 해서 각 페이지에서 안전 영역을 처음 벗어나는 PM position 을 찾고
  // 거기서부터 페이지 끝까지를 강조한다.
  //
  // 이 방식은 에디터의 실제 시각 레이아웃(폰트 메트릭·블록 마진 모두 포함)
  // 위에서 동작하므로 "딱 그 줄부터" 강조가 항상 보장된다. 자동분할 BS 와는
  // 측정 목적·정밀도 요구가 다르므로 별도 경로로 둔다 (자동분할은 단락 단위
  // 분할이라 측정 레이어의 단위 부정합이 0.92 안전 계수 내에서 흡수된다).
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editorReady || !editorRef.current) return;
    editorRef.current.setOverflowProbeConfig(availableContentHeight);
  }, [editorReady, availableContentHeight]);

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
      showToast({ message: "분량을 초과하는 페이지가 없어요.", type: "info" });
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
        showToast({
          message: "초과된 페이지를 더 잘게 나눌 수 없어요. 본문을 직접 편집해 주세요.",
          type: "info",
        });
        return;
      }
      applyEngineResult(next);
    } finally {
      setSplitting(false);
    }
  }, [splitting, hasOverflowPages, overflowPageIndices, getEditorContent, runDivisionEngine, applyEngineResult, showToast]);

  const handleSplitPage = useCallback(
    async (pageIndex: number) => {
      if (splitting) return;
      const cur = await getEditorContent();
      const rawPages = cur.split(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "m"));
      if (pageIndex < 0 || pageIndex >= rawPages.length) return;
      const paragraphs = splitPageContentForDivision(rawPages[pageIndex]);
      if (paragraphs.length < 2) {
        showToast({ message: "이 페이지에는 나눌 수 있는 단락이 부족해요.", type: "info" });
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

    editorRef.current?.blur();
    Keyboard.dismiss();

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
      showToast({ message: result.reason, type: "info" });
      return;
    }

    const pagesJson = pgs.map((p) => p.content);
    if (!id) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      return;
    }

    // Optimistically prime the cache so on-01c renders immediately with the
    // freshly split pages, layoutWidth, and CLOSING status — no spinner, no
    // stale-state flash.
    queryClient.setQueryData([`/api/articles/${id}`], (old: unknown) => {
      if (!old || typeof old !== "object") return old;
      return {
        ...old,
        title: titleRef.current,
        content: cur,
        pages: pagesJson,
        layoutWidth: containerWidth,
        status: "CLOSING",
      };
    });

    // Navigate first for a natural stack-push animation. flush() above already
    // saved title/content/pages via handleSave; only layoutWidth and the status
    // transition still need to hit the server, and they can run in parallel
    // behind the navigation animation.
    router.push({ pathname: "/on-01c", params: { id } });
    isNavigatingRef.current = false;
    setIsNavigating(false);

    // Step 5(B) — pre-save 효과: layoutWidth가 이미 저장됐으면 PATCH 생략.
    const layoutWidthAlreadySaved = savedLayoutWidthRef.current === containerWidth;
    const layoutWidthSave = layoutWidthAlreadySaved
      ? Promise.resolve()
      : updateArticle
          .mutateAsync({
            id,
            data: { layoutWidth: containerWidth },
          })
          .then(() => {
            savedLayoutWidthRef.current = containerWidth;
          })
          .catch((e: unknown) => {
            console.warn("[on-01b] background layoutWidth save failed:", e);
          });

    const statusChange =
      article?.status !== "CLOSING"
        ? transitionStatus
            .mutateAsync({
              id,
              data: { targetStatus: TransitionArticleBodyTargetStatus.CLOSING },
            })
            .catch((e: unknown) => {
              const status = (e as { status?: number } | null)?.status;
              if (status === 400) return;
              console.warn("[on-01b] background status transition failed:", e);
            })
        : Promise.resolve();

    Promise.all([layoutWidthSave, statusChange]).finally(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
    });
  }, [getEditorContent, markDirty, flush, hasRedWarnings, id, router, updateArticle, transitionStatus, queryClient, containerWidth, article, showToast]);

  const handleBack = useCallback(async () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);

    editorRef.current?.blur();
    Keyboard.dismiss();

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

  const handleStepBack = useCallback(async () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);

    editorRef.current?.blur();
    Keyboard.dismiss();

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
    queryClient.setQueryData([`/api/articles/${id}`], (old: any) => {
      if (!old || typeof old !== "object") return old;
      return { ...old, title: titleRef.current, content: cur, status: "DRAFT" };
    });

    isNavigatingRef.current = false;
    setIsNavigating(false);
    router.replace({ pathname: "/on-01a", params: { id } });

    transitionStatus.mutateAsync({
      id,
      data: { targetStatus: TransitionArticleBodyTargetStatus.DRAFT },
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      queryClient.invalidateQueries({ queryKey: [`/api/articles/${id}`] });
    }).catch(() => {
      showToast({ message: "상태 전환에 실패했어요. 새로고침해주세요.", type: "error" });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      queryClient.invalidateQueries({ queryKey: [`/api/articles/${id}`] });
    });
  }, [id, getEditorContent, markDirty, flush, transitionStatus, queryClient, router, showToast]);

  const handleSelectionUpdate = useCallback((payload: OnSelectionUpdatePayload) => {
    setSelectionState(payload);
  }, []);

  const handleToolbarFormat = useCallback(() => {
    setBlockTypeSheetVisible(true);
  }, []);

  const handleBlockTypeSelect = useCallback((blockType: string) => {
    editorRef.current?.setBlockType(blockType);
  }, []);

  const handleToolbarBold = useCallback(() => {
    editorRef.current?.toggleMark("bold");
  }, []);

  const handleToolbarItalic = useCallback(() => {
    editorRef.current?.toggleMark("italic");
  }, []);

  const handleToolbarUnderline = useCallback(() => {
    editorRef.current?.toggleMark("underline");
  }, []);

  const handleInsertDivider = useCallback(() => {
    editorRef.current?.insertDivider();
  }, []);

  const handleShiftEnter = useCallback(() => {
    editorRef.current?.insertHardBreak();
  }, []);

  const handleDismissKeyboard = useCallback(() => {
    editorRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  const handleStateBarPress = useCallback((target: WritingStage) => {
    if (target === "DIVIDING") return;
    if (target === "DRAFT") {
      handleStepBack();
      return;
    }
    if (target === "CLOSING") {
      handleNext();
    }
  }, [handleNext, handleStepBack]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      // 아직 article 데이터가 초기화되지 않았다면 refs가 비어있어
      // 빈 title/content/pages를 기존 article에 덮어쓸 수 있다.
      // 이 경우 저장 로직을 건너뛰고 단순히 뒤로 이동한다.
      if (!initializedRef.current) {
        router.replace("/(tabs)/on");
        return true;
      }
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [handleBack, router]);

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
            ref={pageStripRef}
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
                onLayout={(e) => {
                  chipOffsetsRef.current[idx] = e.nativeEvent.layout.x;
                  setChipLayoutCount((c) => c + 1);
                }}
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
                onSelectionUpdate={handleSelectionUpdate}
                bodyFontSize={bodyFontSize}
                bodyLetterSpacing={bodyLetterSpacing}
                titleFontSize={titleFontSize}
              />
            </View>
            <View style={styles.editorFooter}>
              <Text style={styles.charCountText}>{charCount}자</Text>
            </View>
          </View>
          {keyboardVisible && Platform.OS !== "web" && selectionState.activeBlock !== "horizontalRule" && (
            <KeyboardToolbar
              selectionState={selectionState}
              onFormatPress={handleToolbarFormat}
              onBoldPress={handleToolbarBold}
              onItalicPress={handleToolbarItalic}
              onUnderlinePress={handleToolbarUnderline}
              onInsertDivider={handleInsertDivider}
              onShiftEnter={handleShiftEnter}
            />
          )}
        </KeyboardAvoidingView>

        <BlockTypeSheet
          visible={blockTypeSheetVisible}
          activeBlock={selectionState.activeBlock}
          onClose={() => setBlockTypeSheetVisible(false)}
          onSelect={handleBlockTypeSelect}
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
