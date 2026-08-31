import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  BackHandler,
  AppState,
  useWindowDimensions,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Stack, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/build/react-navigation/core";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useAutoSave } from "@/lib/useAutoSave";
import { useEditorLayout } from "@/lib/useEditorLayout";
import { bodyTypographyMetrics, getBodyContentHeight } from "@/lib/bodyLayout";
import {
  getNativeBodyFontMode,
  subscribeNativeBodyFontMode,
} from "@/lib/nativeBodyFontMode";
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
  type BSJob,
  type BSResult,
  type DivisionWarning,
} from "@/lib/pageDivision";
import { parseMarkdownBlocks, type MarkdownBlockType } from "@/utils/markdownParser";
import { canTransitionForward } from "@/lib/articleStatusCycle";
import type { ArticleStatus } from "@/lib/policies";
import { MarkdownPolicy } from "@/lib/policies";
import WebViewMarkdownEditor from "@/components/WebViewMarkdownEditor/WebViewMarkdownEditorCompat";
import type {
  WebViewMarkdownEditorRef,
  OnChangePayload,
  OnExportMarkdownPayload,
  OnSelectionUpdatePayload,
} from "@/components/WebViewMarkdownEditor/types";
import WebViewMeasureLayer from "@/components/WebViewMeasureLayer";
import type {
  MeasureRequest,
  MeasureCandidate,
} from "@/components/PretextMeasureLayer/PretextMeasureLayer";
import { removeUnpersistableInlineImages } from "@/lib/inlineImages";
import {
  useGetArticle,
  useCreateThought,
  useUpdateArticle,
  useDeleteThought,
  useTransitionArticleStatus,
  TransitionArticleBodyTargetStatus,
  getGetArticleQueryKey,
  getGetThoughtQueryKey,
  getListThoughtsQueryKey,
  useGetThought,
  useUpdateThought,
  usePromoteThought,
  type Thought,
  type StoredSentence,
  type SpellChange,
  spellCheck as apiSpellCheck,
} from "@workspace/api-client-react";
import { isMeaningfulThoughtMarkdown } from "@workspace/api-zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  invalidateArticleLists,
  invalidateArticleDetail,
  invalidateDirectThoughtCreation,
  insertThoughtInRecordCache,
  patchArticleInRecordCaches,
  patchThoughtInRecordCaches,
  removeRecordFromCache,
  restoreRecordListCaches,
  snapshotRecordListCaches,
} from "@/lib/queryInvalidation";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/contexts/ToastContext";
import { useThoughtComposer } from "@/contexts/ThoughtComposerContext";
import SourceArticlePickerSheet from "@/components/SourceArticlePickerSheet/SourceArticlePickerSheet";
import WritingStateBar, { type WritingStage } from "@/components/WritingStateBar/WritingStateBar";
import MemoToolbar, { type FormatType } from "@/components/MemoToolbar/MemoToolbar";
import AddMenuPopup from "@/components/MemoToolbar/AddMenuPopup";
import InlineMenuPanel, { type InlineMenuMode } from "@/components/InlineMenuPanel/InlineMenuPanel";

const PAGE_DIVIDER = MarkdownPolicy.PAGE_DIVIDER;

const DEFAULT_SELECTION: OnSelectionUpdatePayload = {
  activeBlock: "paragraph",
  isBold: false,
  isItalic: false,
  isUnderline: false,
};

const PAGE_KEY_PREFIX = "page_";
const EXPORT_DEBOUNCE_MS = 1200;
const DIRECT_THOUGHT_INITIAL_MARKDOWN = "# \n\n";

function createThoughtClientId(): string {
  const randomNibble = () => Math.floor(Math.random() * 16);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const value = token === "x" ? randomNibble() : (randomNibble() & 0x3) | 0x8;
    return value.toString(16);
  });
}

type EditorMode = "draft" | "dividing";

interface PendingEditorExport {
  editorSessionId: string;
  resolve: (markdown: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 작성·분할 통합 화면.
 *
 * URL id 는 PRELIMINARY thought(단상 작성 모드) 또는 DIVIDING article(분할 모드)
 * 중 하나를 가리킨다.  두 쿼리를 모두 안전하게 시도하여 어느 쪽이 활성인지 파악한다.
 *
 * - draft 모드: thought를 통한 단상 작성. 자동저장은 updateThought(완전한 Markdown).
 *   서식 툴바·이미지 업로드.  원본 글 연결은 승격 후 article에서만.
 * - dividing 모드: DIVIDING article 분할. 페이지 칩 스트립·경고 배너·맞춤법 패널.
 *
 * 승격(promoteThought)은 flush 완료 후 1회만 호출하며, 반환된 article id로
 * 캐시를 갱신하고 라우트를 새 id/mode=dividing 으로 교체한다.
 * 승격 이후에는 DIVIDING → draft/thought 전환 없음.
 */
export default function WritingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { id, source, mode: modeParam, returnPage, returnBlock, spaceId, spaceRoundId, letterType } = useLocalSearchParams<{
    id?: string;
    source?: string;
    mode?: string;
    returnPage?: string;
    returnBlock?: string;
    spaceId?: string;
    spaceRoundId?: string;
    letterType?: string;
  }>();
  const isLocalDirectDraft = modeParam === "local-draft";
  const returnPageIndex = returnPage !== undefined ? parseInt(returnPage, 10) : undefined;
  const returnBlockIndex = returnBlock !== undefined ? parseInt(returnBlock, 10) : undefined;
  const { userId } = useUser();
  const { showToast } = useToast();
  const { releaseDirectThoughtDraft } = useThoughtComposer();
  const editorLayout = useEditorLayout();
  const {
    pageWidth: containerWidth,
    pageHeight,
    paddingX,
    paddingY,
    textColumnWidth,
    bodyFontSize,
    bodyLineHeight,
    bodyLetterSpacing,
    titleFontSize,
  } = editorLayout;
  const typography = useMemo(() => bodyTypographyMetrics(editorLayout), [editorLayout]);

  // ── 데이터 fetching ─────────────────────────────────────────────────────────
  //
  // Routes identify their entity type: draft routes fetch only their thought,
  // dividing routes fetch only their article. A direct local draft has neither
  // until its first meaningful save.

  const thoughtQuery = useGetThought(id ?? "", {
    query: {
      queryKey: getGetThoughtQueryKey(id ?? ""),
      enabled: !!id && !isLocalDirectDraft && modeParam !== "dividing",
      retry: false,
    },
  });

  const articleQuery = useGetArticle(id ?? "", {
    query: {
      queryKey: getGetArticleQueryKey(id ?? ""),
      enabled: !!id && !isLocalDirectDraft && modeParam === "dividing",
      retry: false,
    },
  });

  // Determine active entity.
  // A thought is active when its query succeeded (status PRELIMINARY).
  // An article is active when its query succeeds after a promotion.
  const thought = thoughtQuery.data;
  const article = articleQuery.data;

  // isThoughtMode: the id refers to a thought (draft writing stage).
  // A non-dividing writing route is always a thought route. Decide this from
  // the URL before data arrives so a restored persisted thought can never
  // briefly autosave against the article endpoint during its first render.
  const isThoughtMode = isLocalDirectDraft || (!!id && modeParam !== "dividing");

  // Active article for dividing mode.
  const dividingArticle = article && article.status === "DIVIDING" ? article : undefined;

  const isThoughtModeRef = useRef(false);
  isThoughtModeRef.current = isThoughtMode;

  const dataLoading = !!id && !isLocalDirectDraft &&
    (modeParam === "dividing" ? articleQuery.isLoading : thoughtQuery.isLoading);

  // Mutations
  const updateArticle = useUpdateArticle();
  const updateThought = useUpdateThought();
  const createThought = useCreateThought();
  const deleteThought = useDeleteThought();
  const promoteThought = usePromoteThought();
  const transitionStatus = useTransitionArticleStatus();

  const editorRef = useRef<WebViewMarkdownEditorRef>(null);
  const addMenuBtnRef = useRef<View>(null);

  // ── 모드 ──────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<EditorMode>(
    modeParam === "dividing" ? "dividing" : "draft",
  );
  // modeRef: 콜백 안에서 동기적으로 현재 모드를 읽기 위한 미러.
  const modeRef = useRef<EditorMode>(mode);
  modeRef.current = mode;
  const setModeBoth = useCallback((next: EditorMode) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  // ── 공통 상태 ─────────────────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [charCount, setCharCount] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const editorReadyRef = useRef(false);
  const shouldFocusInitialH1Ref = useRef(isLocalDirectDraft);
  const [initialized, setInitialized] = useState(false);
  const [selectionState, setSelectionState] = useState<OnSelectionUpdatePayload>(DEFAULT_SELECTION);
  const [isNavigating, setIsNavigating] = useState(false);

  // ── 서식 툴바 인라인 메뉴 시스템 (read.tsx 메모 모드와 동일 구조) ─────────
  const { height: screenHeight } = useWindowDimensions();
  const [inlineMenuMode, setInlineMenuMode] = useState<InlineMenuMode | null>(null);
  const [keyboardRestorePending, setKeyboardRestorePending] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [plusBtnCenterX, setPlusBtnCenterX] = useState<number | null>(null);
  const lastKeyboardHeightRef = useRef(0);
  const addMenuPendingRef = useRef(false);

  // 키보드 높이 추적 — 툴바·팝업·패널 위치 계산에 사용
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (e) => {
      const h = e.endCoordinates.height;
      lastKeyboardHeightRef.current = h;
      setKeyboardHeight(h);
      setKeyboardRestorePending(false); // 키보드가 실제로 올라오면 플래그 해제
      if (addMenuPendingRef.current) {
        addMenuPendingRef.current = false;
        setInlineMenuMode("addMenu");
      }
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // 패널을 닫고 에디터 포커스를 복귀시키는 공통 헬퍼.
  // keyboardRestorePending을 세워 키보드가 올라오는 동안 툴바가 언마운트되지 않게 한다.
  const closePanelRestoreKeyboard = useCallback(() => {
    setKeyboardRestorePending(true);
    setInlineMenuMode(null);
    editorRef.current?.focus();
  }, []);

  // 키보드 이벤트가 없는 환경(웹 등)에서 플래그가 영구히 남지 않도록 타임아웃 폴백
  useEffect(() => {
    if (!keyboardRestorePending) return;
    const t = setTimeout(() => setKeyboardRestorePending(false), 1000);
    return () => clearTimeout(t);
  }, [keyboardRestorePending]);

  // 인라인 메뉴 패널 높이: 키보드가 한 번이라도 올라왔으면 그 높이를,
  // 아직 키보드 이벤트가 없었으면 화면의 40%로 폴백한다.
  const inlinePanelHeight =
    lastKeyboardHeightRef.current > 0
      ? lastKeyboardHeightRef.current
      : Math.min(320, Math.round(screenHeight * 0.4));

  const contentRef = useRef("");
  const titleRef = useRef("");
  const initializedRef = useRef(false);
  const articleContentRef = useRef("");
  // 마지막으로 서버에서 본 content. 사용자 편집 발생 여부 감지에 사용.
  const serverContentRef = useRef("");
  const isNavigatingRef = useRef(false);
  // Native Stack requires usePreventRemove instead of a bare beforeRemove
  // listener for reliable interactive iOS swipe cancellation. Intentional
  // navigation waits until this guard has been disabled before dispatching.
  const [shouldPreventRemoval, setShouldPreventRemoval] = useState(true);
  const pendingNavigationRef = useRef<(() => void) | null>(null);
  const thoughtIdRef = useRef<string | undefined>(id);
  const thoughtCreationIdRef = useRef<string | undefined>(
    isLocalDirectDraft ? createThoughtClientId() : undefined,
  );
  const createThoughtPromiseRef = useRef<Promise<string> | null>(null);
  const firstCreatedContentRef = useRef<string | null>(null);
  const localDraftExitedRef = useRef(false);
  const hasPersistedLocalDraftRouteRef = useRef(false);
  const bindAutosaveEntityRef = useRef<
    (entityId: string, nextStorageKey: string) => Promise<void>
  >(async () => {});

  // Map 기반 export 추적: 진행 중인 각 requestExportMarkdown 이 자체 슬롯을 가져
  // autosave export 와 getEditorContent() export 가 서로의 resolver 를 덮어쓰지 않는다.
  const pendingExportsRef = useRef<Map<string, PendingEditorExport>>(new Map());
  const exportRequestSeqRef = useRef(0);
  const exportDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportPendingRef = useRef(false);
  const lastSeenDocVersionRef = useRef(-1);
  const currentEditorSessionIdRef = useRef<string | undefined>(undefined);
  // setMarkdown() can produce a synthetic WebView onChange/onExport pair.
  // Mark server injections so their matching export is not mistaken for an
  // edit. This is intentionally cleared only for an exact match: a real edit
  // that happens before the export still needs to be autosaved.
  const serverInjectionPendingRef = useRef(false);

  const nextExportRequestId = useCallback((kind: "export" | "autosave") => {
    exportRequestSeqRef.current += 1;
    return `${kind}_${Date.now()}_${exportRequestSeqRef.current}`;
  }, []);

  // ── 원본 글 연결 (dividing article 전용) ─────────────────────────────────
  const [sourceArticleId, setSourceArticleId] = useState<string | null>(null);
  const [sourceArticleTitle, setSourceArticleTitle] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  const sourceArticleQuery = useGetArticle(sourceArticleId ?? "", {
    query: { queryKey: getGetArticleQueryKey(sourceArticleId ?? ""), enabled: !!sourceArticleId },
  });

  useEffect(() => {
    if (sourceArticleQuery.data) {
      setSourceArticleTitle(sourceArticleQuery.data.title || null);
    }
  }, [sourceArticleQuery.data]);

  // ── 분할 상태 (dividing) ───────────────────────────────────────────────────
  const [splitting, setSplitting] = useState(false);
  const [nativeBodyFontMode, setNativeBodyFontMode] = useState(getNativeBodyFontMode);
  const pageStripRef = useRef<ScrollView>(null);

  useEffect(
    () => subscribeNativeBodyFontMode(setNativeBodyFontMode),
    [],
  );

  type SpellState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "reviewing"; items: SpellChange[]; index: number; occurrenceIndices: number[] }
    | { status: "done" }
    | { status: "empty" }
    | { status: "error"; message: string };
  const [spellState, setSpellState] = useState<SpellState>({ status: "idle" });
  const spellAppliedCountRef = useRef<Record<string, number>>({});
  const [spellTabVisible, setSpellTabVisible] = useState(false);
  const chipOffsetsRef = useRef<Record<number, number>>({});
  const returnScrollDoneRef = useRef(false);
  const returnBlockScrollDoneRef = useRef(false);
  const [chipLayoutCount, setChipLayoutCount] = useState(0);

  // ── 마운트 시 캐시가 신선하면(≤30s) invalidate 생략 ──────────────────────────
  useEffect(() => {
    if (!id || isLocalDirectDraft) return;
    if (modeParam === "dividing") {
      const articleCached = queryClient.getQueryState(getGetArticleQueryKey(id));
      const articleFresh = !!articleCached && Date.now() - articleCached.dataUpdatedAt < 30_000;
      if (!articleFresh) {
        invalidateArticleDetail(queryClient, id);
      }
    } else {
      const thoughtCached = queryClient.getQueryState(getGetThoughtQueryKey(id));
      const thoughtFresh = !!thoughtCached && Date.now() - thoughtCached.dataUpdatedAt < 30_000;
      if (!thoughtFresh) {
        queryClient.invalidateQueries({ queryKey: getGetThoughtQueryKey(id) });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isLocalDirectDraft, modeParam, queryClient]);

  // ── 데이터 초기화 ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Use thought content when in thought mode, article content for dividing.
    const activeContent = isLocalDirectDraft
      ? DIRECT_THOUGHT_INITIAL_MARKDOWN
      : isThoughtMode
      ? thought?.content ?? ""
      : article?.content ?? "";
    const activeTitle = isThoughtMode ? "" : article?.title ?? "";

    if (!activeContent && !activeTitle && !isThoughtMode) return;
    if (!activeContent && isThoughtMode && !thought && !isLocalDirectDraft) return;

    if (!initializedRef.current) {
      initializedRef.current = true;
      setInitialized(true);
      const c = activeContent;
      const t = activeTitle;
      serverContentRef.current = c;
      setTitle(t);
      titleRef.current = t;
      contentRef.current = c;
      articleContentRef.current = c;
      setContent(c);
      setCharCount(c.length);
      // 초기 모드 결정: mode 파라미터 또는 서버 status(DIVIDING) 기준.
      const initialMode: EditorMode =
        modeParam === "dividing" || (!isThoughtMode && article?.status === "DIVIDING") ? "dividing" : "draft";
      setModeBoth(initialMode);
      if (editorReady) {
        serverInjectionPendingRef.current = true;
        editorRef.current?.setMarkdown(c);
        editorRef.current?.setTitle(t);
        if (shouldFocusInitialH1Ref.current) {
          shouldFocusInitialH1Ref.current = false;
          setTimeout(() => editorRef.current?.focusStart(), 0);
        }
      }
      // Source article linking is only available on a real article.
      if (!isThoughtMode && article?.sourceArticleId) {
        setSourceArticleId(article.sourceArticleId);
      }
      console.log("[on-01 init] cached?=true dirty?=false injected:", JSON.stringify(c.slice(0, 60)));
    } else if (contentRef.current === serverContentRef.current) {
      // 백그라운드 refetch: 사용자가 편집하지 않았을 때만 서버 값 재주입.
      const c = activeContent;
      const t = activeTitle;
      if (c !== serverContentRef.current) {
        serverContentRef.current = c;
        contentRef.current = c;
        articleContentRef.current = c;
        setContent(c);
        setTitle(t);
        titleRef.current = t;
        setCharCount(c.length);
        if (editorReady) {
          serverInjectionPendingRef.current = true;
          editorRef.current?.setMarkdown(c);
          editorRef.current?.setTitle(t);
        }
        console.log("[on-01 init] re-inject from server dirty?=false injected:", JSON.stringify(c.slice(0, 60)));
      }
    }
  }, [thought, article, isThoughtMode, isLocalDirectDraft, editorReady, modeParam, setModeBoth]);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // ── 마감 화면에서 복귀 시 page strip 스크롤 복원 (dividing) ──────────────────
  useEffect(() => {
    if (returnPageIndex === undefined || returnScrollDoneRef.current) return;
    const offset = chipOffsetsRef.current[returnPageIndex];
    if (offset === undefined) return;
    returnScrollDoneRef.current = true;
    pageStripRef.current?.scrollTo({ x: Math.max(0, offset - 16), animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chipLayoutCount]);

  // ── 마감 화면에서 복귀 시 본문 에디터 스크롤 + 하이라이트 (dividing) ──────────
  useEffect(() => {
    if (returnPageIndex === undefined || returnBlockIndex === undefined) return;
    if (returnBlockScrollDoneRef.current) return;
    if (!editorReady || !initialized) return;
    returnBlockScrollDoneRef.current = true;
    const delay = Platform.OS === "android" ? 600 : 300;
    const timer = setTimeout(() => {
      editorRef.current?.scrollToBlock(returnPageIndex, returnBlockIndex);
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorReady, initialized]);

  const rejectPendingExports = useCallback((reason: string) => {
    const error = new Error(reason);
    const pending = Array.from(pendingExportsRef.current.values());
    pendingExportsRef.current.clear();
    for (const entry of pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }, []);

  const handleEditorReload = useCallback((editorSessionId: string) => {
    currentEditorSessionIdRef.current = editorSessionId;
    editorReadyRef.current = false;
    setEditorReady(false);
    lastSeenDocVersionRef.current = -1;
    rejectPendingExports("Editor reloaded before export completed");
  }, [rejectPendingExports]);

  const handleEditorReady = useCallback((editorSessionId?: string) => {
    // WebView 가 (재)로드될 때마다 WebView 쪽 docChangeCounter 는 0 으로 리셋된다.
    // lastSeenDocVersionRef 를 함께 리셋하지 않으면 이전 세션의 높은 버전 번호가
    // 남아 새 export 응답이 stale 로 판정·폐기되고 contentRef 가 갱신되지 않는다.
    if (
      editorSessionId
      && currentEditorSessionIdRef.current
      && editorSessionId !== currentEditorSessionIdRef.current
    ) {
      return;
    }
    if (editorSessionId) currentEditorSessionIdRef.current = editorSessionId;
    lastSeenDocVersionRef.current = -1;
    editorReadyRef.current = true;
    setEditorReady(true);
    console.log("[handleEditorReady] editorReady=true, lastSeenDocVersion reset to -1, initializedRef=", initializedRef.current);
    if (initializedRef.current) {
      serverInjectionPendingRef.current = true;
      // A reload must hydrate from the newest snapshot acknowledged by RN,
      // not from the older server snapshot that originally opened the screen.
      editorRef.current?.setMarkdown(contentRef.current || articleContentRef.current);
      editorRef.current?.setTitle(titleRef.current);
    }
    if (shouldFocusInitialH1Ref.current) {
      shouldFocusInitialH1Ref.current = false;
      setTimeout(() => editorRef.current?.focusStart(), 0);
    }
  }, []);

  const getEditorContent = useCallback((): Promise<string> => {
    return new Promise((resolve, reject) => {
      const doExport = () => {
        const editorSessionId = currentEditorSessionIdRef.current;
        if (!editorRef.current || !editorReadyRef.current || !editorSessionId) {
          reject(new Error("Editor is not ready to export the latest document"));
          return;
        }
        const requestId = nextExportRequestId("export");
        console.log(
          "[getEditorContent] requestExportMarkdown id=", requestId,
          "lastSeenDocVersion=", lastSeenDocVersionRef.current,
          "contentRef.len=", contentRef.current.length,
        );
        const timer = setTimeout(() => {
          const pending = pendingExportsRef.current.get(requestId);
          if (!pending) return;
          pendingExportsRef.current.delete(requestId);
          pending.reject(new Error("Editor export timed out"));
        }, 2000);
        pendingExportsRef.current.set(requestId, {
          editorSessionId,
          resolve,
          reject,
          timer,
        });
        editorRef.current.requestExportMarkdown(requestId);
      };

      // 에디터가 아직 준비되지 않은 경우 최대 5초까지 50ms 간격으로 폴링한 뒤 export한다.
      // 이 대기 없이 바로 fallback을 반환하면 새 글에서 contentRef / serverContentRef 가
      // 모두 ""인 상태이므로 "본문이 비어있습니다" 오류가 즉시 발생한다.
      if (editorReadyRef.current) {
        doExport();
      } else {
        console.warn("[getEditorContent] editorNotReady — polling start");
        const POLL_INTERVAL_MS = 50;
        const MAX_WAIT_MS = 5000;
        let elapsed = 0;
        const poll = setInterval(() => {
          elapsed += POLL_INTERVAL_MS;
          if (editorReadyRef.current || elapsed >= MAX_WAIT_MS) {
            clearInterval(poll);
            console.log("[getEditorContent] polling done elapsed=", elapsed, "ready=", editorReadyRef.current);
            doExport();
          }
        }, POLL_INTERVAL_MS);
      }
    });
  }, [nextExportRequestId]);

  const acceptEditorSnapshot = useCallback((payload: {
    markdown: string;
    docVersion?: number;
    editorSessionId?: string;
  }): string | null => {
    const currentSessionId = currentEditorSessionIdRef.current;
    if (
      payload.editorSessionId
      && currentSessionId
      && payload.editorSessionId !== currentSessionId
    ) {
      return null;
    }
    const incomingVer = payload.docVersion ?? 0;
    if (incomingVer < lastSeenDocVersionRef.current) {
      return null;
    }
    lastSeenDocVersionRef.current = incomingVer;
    const persistableMarkdown = removeUnpersistableInlineImages(payload.markdown);
    contentRef.current = persistableMarkdown;
    if (modeRef.current === "dividing") {
      setContent(persistableMarkdown);
      setDebouncedContent(persistableMarkdown);
    }
    return persistableMarkdown;
  }, []);

  const handleExportMarkdown = useCallback((payload: OnExportMarkdownPayload) => {
    // stale 응답 폐기: 더 새로운 docVersion 응답을 이미 처리했다면 즉시 버린다.
    const incomingVer = payload.docVersion ?? 0;
    const pending = pendingExportsRef.current.get(payload.requestId);
    console.log(
      "[handleExportMarkdown] reqId=", payload.requestId,
      "incomingVer=", incomingVer,
      "lastSeenVer=", lastSeenDocVersionRef.current,
      "md.len=", payload.markdown?.length ?? 0,
      "hasPendingCb=", !!pending,
    );
    if (
      pending
      && payload.editorSessionId
      && payload.editorSessionId !== pending.editorSessionId
    ) {
      pendingExportsRef.current.delete(payload.requestId);
      clearTimeout(pending.timer);
      pending.reject(new Error("Editor export belongs to a stale reload session"));
      return;
    }
    if (payload.error || payload.markdown === undefined) {
      if (pending) {
        pendingExportsRef.current.delete(payload.requestId);
        clearTimeout(pending.timer);
        pending.reject(new Error(payload.error?.message || "Editor export failed"));
      }
      return;
    }
    const persistableMarkdown = acceptEditorSnapshot({
      markdown: payload.markdown,
      docVersion: payload.docVersion,
      editorSessionId: payload.editorSessionId,
    });
    if (persistableMarkdown == null) {
      if (pending) {
        pendingExportsRef.current.delete(payload.requestId);
        clearTimeout(pending.timer);
        pending.reject(new Error("Editor export response was stale"));
      }
      return;
    }
    if (pending) {
      pendingExportsRef.current.delete(payload.requestId);
      clearTimeout(pending.timer);
      pending.resolve(persistableMarkdown);
    }
  }, [acceptEditorSnapshot]);

  const handleSave = useCallback(
    async (data: { title: string; content: string }) => {
      if (isThoughtModeRef.current && modeRef.current === "draft") {
        if (!isMeaningfulThoughtMarkdown(data.content)) return;
        let thoughtId = thoughtIdRef.current;
        if (!thoughtId) {
          if (!createThoughtPromiseRef.current) {
            firstCreatedContentRef.current = data.content;
            const now = new Date().toISOString();
            const optimisticThought: Thought = {
              id: `optimistic-thought-${Date.now()}`,
              authorId: userId ?? "",
              content: data.content,
              createdFrom: "direct",
              status: "PRELIMINARY",
              createdAt: now,
              updatedAt: now,
            };
            const recordListSnapshot = snapshotRecordListCaches(queryClient);
            insertThoughtInRecordCache(queryClient, optimisticThought);
            const creatingThought = createThought
              .mutateAsync({
                data: {
                  clientId: thoughtCreationIdRef.current ?? createThoughtClientId(),
                  content: data.content,
                  createdFrom: "direct",
                  status: "PRELIMINARY",
                },
              })
              .then(async (created: Thought) => {
                if (!created.id) {
                  throw new Error("Thought creation did not return an id");
                }
                thoughtIdRef.current = created.id;
                if (localDraftExitedRef.current) return created.id;
                await bindAutosaveEntityRef.current(created.id, `draft_${created.id}`);
                // This create owns exactly the payload snapshotted by
                // useAutoSave. If the editor changed while POST was in flight,
                // the dirty epoch schedules a later PATCH with that newer
                // snapshot instead of mixing editor exports into this request.
                queryClient.setQueryData(getGetThoughtQueryKey(created.id), {
                  ...created,
                  content: data.content,
                });
                removeRecordFromCache(queryClient, { id: optimisticThought.id, kind: "thought" });
                insertThoughtInRecordCache(queryClient, {
                  ...created,
                  content: data.content,
                });
                void invalidateDirectThoughtCreation(queryClient);
                if (isLocalDirectDraft && !hasPersistedLocalDraftRouteRef.current) {
                  hasPersistedLocalDraftRouteRef.current = true;
                  router.setParams({ id: created.id, mode: undefined });
                }
                return created.id;
              })
              .catch((error: unknown) => {
                restoreRecordListCaches(queryClient, recordListSnapshot);
                throw error;
              })
              .finally(() => {
                createThoughtPromiseRef.current = null;
              });
            createThoughtPromiseRef.current = creatingThought;
          }
          const createdThoughtId = await createThoughtPromiseRef.current;
          if (!createdThoughtId) throw new Error("Thought creation did not return an id");
          thoughtId = createdThoughtId;
        }
        if (!thoughtId) throw new Error("Thought creation did not return an id");
        // A user can erase a draft and leave while its first POST is in
        // flight. The exit path will delete that created id; never append a
        // stale update after it has declared the local draft discarded.
        if (localDraftExitedRef.current) return;
        // Thought title is the Markdown H1 — send the complete Markdown including H1.
        const createdContent = firstCreatedContentRef.current;
        firstCreatedContentRef.current = null;
        // Only the exact payload that was POSTed is already durable. Clear
        // the sentinel immediately so A → B → A still PATCHes the final A.
        if (createdContent !== data.content) {
          await updateThought.mutateAsync({ id: thoughtId, data: { content: data.content } });
          queryClient.setQueryData(
            getGetThoughtQueryKey(thoughtId),
            (old: unknown) => {
              if (!old || typeof old !== "object") return old;
              return { ...old, content: data.content };
            },
            { updatedAt: Date.now() },
          );
          patchThoughtInRecordCaches(queryClient, thoughtId, { content: data.content });
          void invalidateDirectThoughtCreation(queryClient);
        }
      } else if (modeRef.current === "dividing") {
        if (!id) return;
        if (!data.title.trim()) return;
        const pgs = splitContentToPages(data.content).map((p) => p.content);
        await updateArticle.mutateAsync({
          id,
          data: { title: data.title, content: data.content, pages: pgs },
        });
        patchArticleInRecordCaches(queryClient, id, {
          title: data.title,
          content: data.content,
          pages: pgs,
        });
        void invalidateArticleLists(queryClient);
      } else {
        if (!id) return;
        await updateArticle.mutateAsync({
          id,
          data: { title: data.title, content: data.content },
        });
        patchArticleInRecordCaches(queryClient, id, {
          title: data.title,
          content: data.content,
        });
        void invalidateArticleLists(queryClient);
      }
    },
    [id, createThought, queryClient, updateThought, updateArticle, isLocalDirectDraft, router, userId],
  );

  const handleAutosaveRestore = useCallback((data: {
    title: string;
    content: string;
    entityId?: string;
    creationId?: string;
  }) => {
    if (data.creationId) thoughtCreationIdRef.current = data.creationId;
    if (data.entityId) {
      thoughtIdRef.current = data.entityId;
      if (isLocalDirectDraft && !hasPersistedLocalDraftRouteRef.current) {
        hasPersistedLocalDraftRouteRef.current = true;
        router.setParams({ id: data.entityId, mode: undefined });
      }
    }
    titleRef.current = data.title;
    contentRef.current = data.content;
    articleContentRef.current = data.content;
    setTitle(data.title);
    setContent(data.content);
    setCharCount(data.content.length);
    if (editorReadyRef.current) {
      editorRef.current?.setTitle(data.title);
      editorRef.current?.setMarkdown(data.content);
    }
  }, [isLocalDirectDraft, router]);

  const {
    markDirty,
    markTitleDirty,
    flush,
    reportFailure: reportAutosaveFailure,
    discard: discardAutosave,
    bindEntity: bindAutosaveEntity,
  } = useAutoSave({
    onSave: handleSave,
    onRestore: handleAutosaveRestore,
    creationId: thoughtCreationIdRef.current,
    storageKey: isLocalDirectDraft ? "direct_thought_local_draft" : id ? `draft_${id}` : undefined,
  });
  bindAutosaveEntityRef.current = bindAutosaveEntity;

  const handleAutosaveExport = useCallback(
    (md: string) => {
      if (serverInjectionPendingRef.current) {
        serverInjectionPendingRef.current = false;
        if (md === serverContentRef.current) {
          console.log("[on-01] ignored initial server export — content unchanged");
          return;
        }
      }
      md = removeUnpersistableInlineImages(md);
      if (!isThoughtModeRef.current || isMeaningfulThoughtMarkdown(md)) {
        markDirty(titleRef.current, md);
      } else {
        void discardAutosave();
      }
    },
    [discardAutosave, markDirty],
  );

  const handleEditorError = useCallback(
    (error: { code: string; message: string }) => {
      if (
        error.code !== "MARKDOWN_EXPORT_FAIL"
        && error.code !== "WEBVIEW_LOAD_FAIL"
      ) {
        return;
      }
      // Keep the last confirmed snapshot recoverable, but never leave a prior
      // "saved" state visible when the editor could not export newer input.
      markDirty(
        isThoughtModeRef.current ? "" : titleRef.current,
        contentRef.current || serverContentRef.current,
      );
      void reportAutosaveFailure();
      showToast({
        message: "최신 내용을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.",
        type: "error",
      });
    },
    [markDirty, reportAutosaveFailure, showToast],
  );

  const handleEditorChange = useCallback(
    (_payload: OnChangePayload) => {
      if (_payload.charCount !== undefined) {
        setCharCount(_payload.charCount);
      }
      if (!_payload.isDirty) return;

      if (_payload.markdown !== undefined) {
        const markdown = acceptEditorSnapshot({
          markdown: _payload.markdown,
          docVersion: _payload.docVersion,
          editorSessionId: _payload.editorSessionId,
        });
        if (markdown != null) handleAutosaveExport(markdown);
        return;
      }

      if (modeRef.current === "dividing") {
        // 분할 모드: 즉시 export 하여 페이지 재계산·측정을 트리거한다.
        if (!editorRef.current) return;
        const requestId = nextExportRequestId("autosave");
        const editorSessionId = currentEditorSessionIdRef.current;
        if (!editorSessionId) return;
        const timer = setTimeout(() => {
          const pending = pendingExportsRef.current.get(requestId);
          if (!pending) return;
          pendingExportsRef.current.delete(requestId);
          pending.reject(new Error("Autosave export timed out"));
        }, 2000);
        pendingExportsRef.current.set(requestId, {
          editorSessionId,
          resolve: handleAutosaveExport,
          reject: () => {
            markDirty(titleRef.current, contentRef.current);
            void reportAutosaveFailure();
          },
          timer,
        });
        editorRef.current.requestExportMarkdown(requestId);
        return;
      }

      // 작성 모드: 매 onChange 마다 export 하면 한글 IME 합성 중 화면이 멈추므로
      // 입력이 잠시 멈춘 뒤 1회만 export 하도록 디바운스한다.
      exportPendingRef.current = true;
      if (exportDebounceTimerRef.current) clearTimeout(exportDebounceTimerRef.current);
      exportDebounceTimerRef.current = setTimeout(() => {
        exportDebounceTimerRef.current = null;
        if (!exportPendingRef.current) return;
        exportPendingRef.current = false;
        if (!editorRef.current) return;
        const requestId = nextExportRequestId("autosave");
        const editorSessionId = currentEditorSessionIdRef.current;
        if (!editorSessionId) return;
        const timer = setTimeout(() => {
          const pending = pendingExportsRef.current.get(requestId);
          if (!pending) return;
          pendingExportsRef.current.delete(requestId);
          pending.reject(new Error("Autosave export timed out"));
        }, 2000);
        pendingExportsRef.current.set(requestId, {
          editorSessionId,
          resolve: handleAutosaveExport,
          reject: () => {
            markDirty(titleRef.current, contentRef.current);
            void reportAutosaveFailure();
          },
          timer,
        });
        editorRef.current.requestExportMarkdown(requestId);
      }, EXPORT_DEBOUNCE_MS);
    },
    [
      acceptEditorSnapshot,
      handleAutosaveExport,
      markDirty,
      nextExportRequestId,
      reportAutosaveFailure,
    ],
  );

  const latestFlushTailRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    return () => {
      rejectPendingExports("Writing screen unmounted before export completed");
    };
  }, [rejectPendingExports]);

  const flushLatestEditorSnapshot = useCallback(() => {
    const run = async () => {
      if (exportDebounceTimerRef.current) {
        clearTimeout(exportDebounceTimerRef.current);
        exportDebounceTimerRef.current = null;
      }
      exportPendingRef.current = false;

      let latest: string;
      try {
        latest = await getEditorContent();
      } catch {
        const confirmedSnapshot = contentRef.current || serverContentRef.current;
        markDirty(isThoughtModeRef.current ? "" : titleRef.current, confirmedSnapshot);
        await reportAutosaveFailure();
        return {
          ok: false,
          content: confirmedSnapshot,
          meaningful: isMeaningfulThoughtMarkdown(confirmedSnapshot),
        };
      }
      const meaningful = !isThoughtModeRef.current || isMeaningfulThoughtMarkdown(latest);
      if (!meaningful) {
        await discardAutosave();
        return { ok: true, content: latest, meaningful: false };
      }

      markDirty(isThoughtModeRef.current ? "" : titleRef.current, latest);
      const result = await flush();
      return { ...result, content: latest, meaningful: true };
    };

    // Do not coalesce distinct lifecycle/navigation boundaries. Each caller
    // waits for the previous flush and then exports again, so a back action
    // that follows keyboard dismissal cannot navigate using its older snapshot.
    const task = latestFlushTailRef.current.then(run, run);
    latestFlushTailRef.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }, [discardAutosave, flush, getEditorContent, markDirty, reportAutosaveFailure]);

  const handleTitleChange = useCallback(
    (text: string) => {
      setTitle(text);
      titleRef.current = text;
      markTitleDirty(text, contentRef.current);
    },
    [markTitleDirty],
  );

  // ── 분할 측정/검증 (dividing) ──────────────────────────────────────────────
  const pages = useMemo(() => splitContentToPages(content), [content]);

  const [debouncedContent, setDebouncedContent] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedContent(content), 600);
    return () => clearTimeout(timer);
  }, [content]);

  const measurePages = useMemo(() => splitContentToPages(debouncedContent), [debouncedContent]);
  const baseWarnings = useMemo(() => validatePages(pages), [pages]);

  // 새로 분할하는 페이지는 최종 리더와 같은 하단 예약을
  // 적용해, 수동 경계와 자동 분할이 이후 화면에서 넘치지 않게 한다.
  const readerBottomReservation = insets.bottom + editorLayout.titleBarHeight;
  const pageContentHeight = pageHeight;
  const availableContentHeight = getBodyContentHeight(editorLayout, readerBottomReservation);

  const pageBlockMap = useMemo(() => {
    const map: Record<number, MarkdownBlockType[]> = {};
    for (const p of measurePages) {
      map[p.pageIndex] = parseMarkdownBlocks(p.content);
    }
    return map;
  }, [measurePages]);

  const [warningMeasurement, setWarningMeasurement] = useState<{
    request: MeasureRequest | null;
    heights: Record<string, number>;
  }>({ request: null, heights: {} });
  const warningRequestRef = useRef<MeasureRequest | null>(null);

  const warningRequest = useMemo<MeasureRequest | null>(() => {
    if (mode !== "dividing") return null;
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
      typography,
      fontMode: nativeBodyFontMode,
    };
  }, [mode, measurePages, pageBlockMap, typography, nativeBodyFontMode]);
  warningRequestRef.current = warningRequest;

  const handleWarningMeasured = useCallback((
    heights: Record<string, number>,
    measuredRequest: MeasureRequest,
  ) => {
    if (measuredRequest !== warningRequestRef.current) return;
    setWarningMeasurement((prev) => {
      const prevHeights = prev.request === measuredRequest ? prev.heights : {};
      const prevKeys = Object.keys(prevHeights);
      const nextKeys = Object.keys(heights);
      if (
        prev.request === measuredRequest &&
        prevKeys.length === nextKeys.length &&
        nextKeys.every((k) => prevHeights[k] === heights[k])
      ) {
        return prev;
      }
      return { request: measuredRequest, heights };
    });
  }, []);

  const prevPageOverflowInfoRef = useRef<{
    request: MeasureRequest | null;
    info: Record<number, { totalHeight: number; overflowBlockIdx: number }>;
  }>({ request: null, info: {} });

  const pageOverflowInfo = useMemo(() => {
    const info: Record<number, { totalHeight: number; overflowBlockIdx: number }> = {};
    let anyPending = false;
    const blockHeights =
      warningMeasurement.request === warningRequest ? warningMeasurement.heights : {};
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
      const totalHeight = blockSum + pageContentHeight - availableContentHeight;
      const overflowBlockIdx = findOverflowBlockIndex(heights, availableContentHeight, bodyLineHeight);
      info[p.pageIndex] = { totalHeight, overflowBlockIdx };
    }
    if (anyPending) {
      if (prevPageOverflowInfoRef.current.request !== warningRequest) return {};
      const cached: Record<number, { totalHeight: number; overflowBlockIdx: number }> = {};
      for (const idx of currentPageIndices) {
        const prev = prevPageOverflowInfoRef.current.info[idx];
        if (prev) cached[idx] = prev;
      }
      return cached;
    }
    prevPageOverflowInfoRef.current = { request: warningRequest, info };
    return info;
  }, [
    measurePages,
    pageBlockMap,
    warningMeasurement,
    warningRequest,
    pageContentHeight,
    availableContentHeight,
    bodyLineHeight,
  ]);

  const pageHeights = useMemo<Record<number, number>>(() => {
    const map: Record<number, number> = {};
    for (const k in pageOverflowInfo) {
      map[Number(k)] = pageOverflowInfo[Number(k)].totalHeight;
    }
    return map;
  }, [pageOverflowInfo]);

  const [engineRequest, setEngineRequest] = useState<MeasureRequest | null>(null);
  const engineResolveRef = useRef<{
    request: MeasureRequest;
    resolve: (heights: Record<string, number>) => void;
  } | null>(null);

  const measureEngine = useCallback(
    (candidates: MeasureCandidate[]): Promise<Record<string, number>> => {
      return new Promise((resolve) => {
        const request: MeasureRequest = {
          candidates,
          typography,
          fontMode: nativeBodyFontMode,
        };
        engineResolveRef.current = { request, resolve };
        setEngineRequest(request);
      });
    },
    [typography, nativeBodyFontMode],
  );

  useEffect(() => {
    const pending = engineResolveRef.current;
    if (!pending || pending.request.fontMode === nativeBodyFontMode) return;
    const replacement: MeasureRequest = {
      ...pending.request,
      fontMode: nativeBodyFontMode,
    };
    engineResolveRef.current = {
      request: replacement,
      resolve: pending.resolve,
    };
    setEngineRequest(replacement);
  }, [nativeBodyFontMode]);

  const handleEngineMeasured = useCallback((
    heights: Record<string, number>,
    measuredRequest: MeasureRequest,
  ) => {
    const pending = engineResolveRef.current;
    if (
      !pending ||
      pending.request !== measuredRequest ||
      measuredRequest.fontMode !== getNativeBodyFontMode()
    ) return;
    engineResolveRef.current = null;
    setEngineRequest(null);
    pending.resolve(heights);
  }, []);

  const splitThreshold = availableContentHeight;

  const heightWarnings = useMemo<DivisionWarning[]>(() => {
    return measurePages
      .filter((page) => {
        const h = pageHeights[page.pageIndex];
        return h !== undefined && h > pageContentHeight;
      })
      .map((page) => ({
        pageIndex: page.pageIndex,
        paragraphIndex: -1,
        level: "red" as const,
        reason: "이 페이지는 읽기 화면에서 스크롤이 필요할 수 있습니다",
      }));
  }, [measurePages, pageHeights, pageContentHeight]);

  const warnings = useMemo(() => [...baseWarnings, ...heightWarnings], [baseWarnings, heightWarnings]);

  const overflowPageIndices = useMemo(() => {
    const set = new Set<number>();
    for (const w of heightWarnings) set.add(w.pageIndex);
    return Array.from(set).sort((a, b) => a - b);
  }, [heightWarnings]);
  const hasOverflowPages = overflowPageIndices.length > 0;

  // layoutWidth 선저장 — 분할 모드에서만. on-01c 이동 시 PATCH 중복을 막는다.
  const savedLayoutWidthRef = useRef<number | null>(null);
  useEffect(() => {
    if (mode !== "dividing") return;
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
        savedLayoutWidthRef.current = null;
        console.warn("[on-01] background layoutWidth pre-save failed:", e);
      });
  }, [mode, id, article, containerWidth, updateArticle]);

  // 오버플로 강조 — 분할 모드에서만 에디터에 안전 영역 높이를 알려준다.
  // 작성 모드로 돌아오면 null을 보내 빨간 오버플로 배경을 즉시 해제한다.
  useEffect(() => {
    if (!editorReady || !editorRef.current) return;
    editorRef.current.setOverflowProbeConfig(mode === "dividing" ? availableContentHeight : null);
  }, [mode, editorReady, availableContentHeight]);

  // ── 원본 글 연결 핸들러 (dividing article 전용) ───────────────────────────
  const handleSourceArticleSelect = useCallback(
    async (articleId: string, articleTitle: string) => {
      if (!id) return;
      try {
        await updateArticle.mutateAsync({ id, data: { sourceArticleId: articleId } });
        setSourceArticleId(articleId);
        setSourceArticleTitle(articleTitle);
        invalidateArticleDetail(queryClient, id);
      } catch {
        showToast({ message: "답장 대상 편지 연결에 실패했습니다.", type: "error" });
      }
    },
    [id, updateArticle, queryClient, showToast],
  );

  const handleSourceArticleUnlink = useCallback(async () => {
    if (!id) return;
    try {
      await updateArticle.mutateAsync({ id, data: { sourceArticleId: null } });
      setSourceArticleId(null);
      setSourceArticleTitle(null);
      invalidateArticleDetail(queryClient, id);
    } catch {
      showToast({ message: "답장 대상 편지 연결 해제에 실패했습니다.", type: "error" });
    }
  }, [id, updateArticle, queryClient, showToast]);

  const navigateAfterRemovingGuard = useCallback((navigate: () => void) => {
    pendingNavigationRef.current = navigate;
    setShouldPreventRemoval(false);
  }, []);

  // ── 모드 전환: 작성(thought) → 분할(article) ──────────────────────────────
  //
  // flush() 로 최신 내용을 thought 에 저장한 뒤 promoteThought() 를 단 1회 호출한다.
  // 반환된 DIVIDING article 의 id 를 캐시에 저장하고 라우트를 교체한다.
  const enterDividingMode = useCallback(async () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);

    editorRef.current?.blur();
    Keyboard.dismiss();

    // 검토 단계 진입 전: 이미지를 단독 페이지(블록)로 자동 분할한다.
    const splitResult = await editorRef.current?.autoSplitImages();
    if (splitResult?.hadConsecutiveImages) {
      showToast({ message: "사진 사이에 빈 페이지를 추가했어요.", type: "info" });
    }

    // (c) 빠른 타이핑 직후 이동: 진행 중이던 export 디바운스를 취소하고
    //     WebView 에서 최신 마크다운을 직접 추출한다.
    if (exportDebounceTimerRef.current) {
      clearTimeout(exportDebounceTimerRef.current);
      exportDebounceTimerRef.current = null;
    }
    exportPendingRef.current = false;

    // autoSplitImages 가 이미지 분할 트랜잭션을 dispatch 한 경우, WebView JS 이벤트
    // 루프가 완전히 settle 될 때까지 한 틱 기다린다.
    await new Promise<void>((r) => setTimeout(r, 50));

    let cur: string;
    try {
      cur = await getEditorContent();
    } catch {
      await reportAutosaveFailure();
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({ message: "최신 내용을 확인하지 못했습니다. 다시 시도해주세요.", type: "error" });
      return;
    }
    console.log(
      "[enterDividingMode] content acquired len=%d preview=%j",
      cur.length,
      cur.slice(0, 60),
    );
    splitContentToPages(cur).forEach((p) => {
      console.log(
        "[enterDividingMode] page[%d] charCount=%d preview=%j",
        p.pageIndex,
        p.charCount,
        p.content.slice(0, 40),
      );
    });

    const firstLine = cur.split(/\r?\n/, 1)[0]?.trim() ?? "";
    const heading = /^#(?!#)\s+(.+?)\s*$/.exec(firstLine);
    const thoughtTitle = heading?.[1]?.trim() ?? "";
    const thoughtBody = heading ? cur.slice(cur.indexOf("\n") + 1).replace(/^\s*\n/, "") : cur;
    const resolvedTitle = thoughtTitle;
    if (!resolvedTitle || !thoughtBody.trim()) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({
        message: "첫 줄을 제목1로 작성하고, 아래에 본문을 적어주세요.",
        type: "info",
      });
      return;
    }

    // markDirty → flush: flush saves the thought with the full Markdown (including H1).
    markDirty("", cur);
    const flushResult = await flush();
    if (!flushResult.ok) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({ message: "저장이 완료되지 않았습니다. 다시 시도해주세요.", type: "error" });
      return;
    }
    console.log("[enterDividingMode] flush ok — contentLen=%d", cur.length);

    // Promote the thought exactly once.  The server validates the H1 title,
    // creates a fresh DIVIDING article, and returns it.
    let promoted: { id: string; title?: string | null; content?: string | null; status?: string };
    try {
      const thoughtId = thoughtIdRef.current;
      if (!thoughtId) throw new Error("no saved thought");
      promoted = await promoteThought.mutateAsync({ id: thoughtId });
    } catch (e) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({
        message: e instanceof Error ? e.message : "검토 단계로 옮기지 못했어요. 단상은 저장되어 있습니다.",
        type: "error",
      });
      return;
    }

    const promotedContent = promoted.content ?? thoughtBody;
    const promotedTitle = promoted.title ?? resolvedTitle;

    // Seed the article cache with the fresh DIVIDING article.
    queryClient.setQueryData(getGetArticleQueryKey(promoted.id), {
      ...promoted,
      id: promoted.id,
      title: promotedTitle,
      content: promotedContent,
      status: "DIVIDING",
      pages: [],
    });

    // Update editor without remounting.
    titleRef.current = promotedTitle;
    setTitle(promotedTitle);
    contentRef.current = promotedContent;
    articleContentRef.current = promotedContent;
    setContent(promotedContent);
    setDebouncedContent(promotedContent);
    serverContentRef.current = promotedContent;
    serverInjectionPendingRef.current = true;
    editorRef.current?.setTitle(promotedTitle);
    editorRef.current?.setMarkdown(promotedContent);
    setModeBoth("dividing");
    isNavigatingRef.current = false;
    setIsNavigating(false);

    invalidateArticleLists(queryClient);
    queryClient.invalidateQueries({ queryKey: getListThoughtsQueryKey() });
    releaseDirectThoughtDraft();

    // 공간 컨텍스트를 AsyncStorage에 저장 — (tabs)/on.tsx 재개 시 on-01c가 복구할 수 있도록
    if (spaceId) {
      try {
        await AsyncStorage.setItem(
          `space_context:${promoted.id}`,
          JSON.stringify({
            spaceId,
            ...(spaceRoundId ? { spaceRoundId } : {}),
            ...(letterType ? { letterType } : {}),
          }),
        );
      } catch {
        // 저장 실패는 비핵심 — 라우트 파라미터로 컨텍스트가 이미 전달됨
      }
    }

    // Replace route with the new article id so a refresh lands on the real article.
    // This route identity swap is a stage transition, not a user-initiated exit.
    navigateAfterRemovingGuard(() => {
      router.replace({
        pathname: "/on-01a",
        params: {
          id: promoted.id,
          mode: "dividing",
          ...(spaceId ? { spaceId, ...(spaceRoundId ? { spaceRoundId } : {}), ...(letterType ? { letterType } : {}) } : {}),
        },
      });
    });
  }, [getEditorContent, markDirty, flush, queryClient, promoteThought, showToast, setModeBoth, router, releaseDirectThoughtDraft, navigateAfterRemovingGuard, reportAutosaveFailure, spaceId, spaceRoundId, letterType]);

  // ── 분할 → 마감 (on-01c 이동) ──────────────────────────────────────────────
  const handleNextToClosing = useCallback(async () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);

    editorRef.current?.blur();
    Keyboard.dismiss();

    let cur: string;
    try {
      cur = await getEditorContent();
    } catch {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({ message: "최신 내용을 확인하지 못했습니다. 다시 시도해주세요.", type: "error" });
      return;
    }
    console.log(
      "[handleNextToClosing] content len=%d preview=%j",
      cur.length,
      cur.slice(0, 60),
    );

    const pgs = splitContentToPages(cur);
    pgs.forEach((p) => {
      console.log(
        "[handleNextToClosing] page[%d] charCount=%d preview=%j",
        p.pageIndex,
        p.charCount,
        p.content.slice(0, 40),
      );
    });

    const liveBaseWarnings = validatePages(pgs);
    const liveHeightWarnings = pgs
      .filter((p) => {
        const h = pageHeights[p.pageIndex];
        return h !== undefined && h > pageContentHeight;
      })
      .map((p): DivisionWarning => ({
        pageIndex: p.pageIndex,
        paragraphIndex: -1,
        level: "red",
        reason: "이 페이지는 읽기 화면에서 스크롤이 필요할 수 있습니다",
      }));
    const liveHasRedWarnings = [...liveBaseWarnings, ...liveHeightWarnings].some((w) => w.level === "red");
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

    markDirty(titleRef.current, cur);
    const flushResult = await flush();
    if (!flushResult.ok) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({ message: "저장이 완료되지 않았습니다. 다시 시도해주세요.", type: "error" });
      return;
    }

    if (!id) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      return;
    }

    const pagesJson = pgs.map((p) => p.content);
    queryClient.setQueryData(
      getGetArticleQueryKey(id),
      (old: unknown) => {
        if (!old || typeof old !== "object") return old;
        return {
          ...old,
          title: titleRef.current,
          content: cur,
          pages: pagesJson,
          layoutWidth: containerWidth,
          status: "CLOSING",
        };
      },
      { updatedAt: Date.now() },
    );

    router.push({
      pathname: "/on-01c",
      params: {
        id,
        ...(spaceId ? { spaceId, ...(spaceRoundId ? { spaceRoundId } : {}), ...(letterType ? { letterType } : {}) } : {}),
      },
    });
    isNavigatingRef.current = false;
    setIsNavigating(false);

    const layoutWidthAlreadySaved = savedLayoutWidthRef.current === containerWidth;
    const layoutWidthSave = layoutWidthAlreadySaved
      ? Promise.resolve()
      : updateArticle
          .mutateAsync({ id, data: { layoutWidth: containerWidth } })
          .then(() => {
            savedLayoutWidthRef.current = containerWidth;
          })
          .catch((e: unknown) => {
            console.warn("[on-01] background layoutWidth save failed:", e);
          });

    const statusChange =
      article?.status !== "CLOSING"
        ? transitionStatus
            .mutateAsync({ id, data: { targetStatus: TransitionArticleBodyTargetStatus.CLOSING } })
            .catch((e: unknown) => {
              const status = (e as { status?: number } | null)?.status;
              if (status === 400) return;
              console.warn("[on-01] background CLOSING transition failed:", e);
            })
        : Promise.resolve();

    Promise.all([layoutWidthSave, statusChange]).finally(() => {
      invalidateArticleLists(queryClient);
    });
  }, [getEditorContent, markDirty, flush, id, router, updateArticle, transitionStatus, queryClient, containerWidth, article, showToast, pageHeights, pageContentHeight]);

  // ── 작성/분할 모드 뒤로가기 (화면 종료) ───────────────────────────────────
  //
  // Both draft and dividing modes exit the screen via this single handler.
  // There is no "exit dividing back to draft" transition — once promoted to
  // DIVIDING the article stays there.
  const exitToPreviousList = useCallback(() => {
    // Only pop if this screen was pushed from the tab navigator. A restored
    // route or a quote opened from another detail screen can have a different
    // root-stack predecessor; exposing that predecessor is not a "back to
    // list" action, so use the route-specific safe fallback instead.
    const state = navigation.getState();
    const previousRoute = state?.routes[state.index - 1];
    const canPopToList = router.canGoBack() && previousRoute?.name === "(tabs)";

    releaseDirectThoughtDraft();
    isNavigatingRef.current = false;
    setIsNavigating(false);
    navigateAfterRemovingGuard(() => {
      if (canPopToList) {
        router.back();
        return;
      }

      router.replace(source === "quote" ? "/(tabs)/archive" : "/(tabs)/on");
    });
  }, [navigation, releaseDirectThoughtDraft, router, source, navigateAfterRemovingGuard]);

  const handleDraftBack = useCallback(async () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);

    editorRef.current?.blur();
    Keyboard.dismiss();

    // A thought exit uses the same latest-export boundary as keyboard close,
    // app backgrounding, and manual retry. Other editor modes keep their
    // existing validation-before-save flow.
    const thoughtFlush = isThoughtModeRef.current
      ? await flushLatestEditorSnapshot()
      : null;
    if (thoughtFlush && !thoughtFlush.ok) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({ message: "최신 내용을 확인하지 못했습니다. 다시 저장해주세요.", type: "error" });
      return;
    }
    if (!isThoughtModeRef.current) {
      if (exportDebounceTimerRef.current) {
        clearTimeout(exportDebounceTimerRef.current);
        exportDebounceTimerRef.current = null;
      }
      exportPendingRef.current = false;
    }
    let cur: string;
    try {
      cur = thoughtFlush?.content ?? await getEditorContent();
    } catch {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({ message: "최신 내용을 확인하지 못했습니다. 다시 시도해주세요.", type: "error" });
      return;
    }
    console.log(
      "[handleDraftBack] content acquired len=%d preview=%j",
      cur.length,
      cur.slice(0, 60),
    );
    const currentTitle = isThoughtModeRef.current ? "" : titleRef.current.trim();
    const currentContent = cur.trim();
    const hasMeaningfulThought = isThoughtModeRef.current && isMeaningfulThoughtMarkdown(cur);

    if (!isThoughtModeRef.current && source === "quote") {
      if (!currentTitle) {
        isNavigatingRef.current = false;
        setIsNavigating(false);
        showToast({ message: "제목을 입력해주세요.", type: "info" });
        return;
      }
    } else if (isThoughtModeRef.current && !hasMeaningfulThought) {
      localDraftExitedRef.current = isLocalDirectDraft;
      let savedThoughtId = thoughtIdRef.current;
      // The first meaningful autosave may have begun just before the user
      // clears the editor. Wait for it so the resulting record cannot escape
      // this empty-draft cleanup.
      if (!savedThoughtId && createThoughtPromiseRef.current) {
        try {
          savedThoughtId = await createThoughtPromiseRef.current;
        } catch {
          // Creation failed, so there is no server record to remove.
        }
      }
      if (savedThoughtId) {
        try {
          await deleteThought.mutateAsync({ id: savedThoughtId });
        } catch {
          showToast({ message: "빈 단상 삭제에 실패했습니다.", type: "error" });
        }
        invalidateArticleLists(queryClient);
        queryClient.invalidateQueries({ queryKey: getListThoughtsQueryKey() });
      }
      exitToPreviousList();
      return;
    }

    // Thought mode was already flushed from its exact latest export above.
    // Article mode preserves the existing markDirty → flush ordering.
    const flushResult = thoughtFlush ?? await (async () => {
      markDirty(titleRef.current, cur);
      return flush();
    })();
    if (!flushResult.ok) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({ message: "저장에 실패했습니다. 내용을 확인해주세요.", type: "error" });
      return;
    }
    console.log("[handleDraftBack] flush ok — saved title=%j contentLen=%d", titleRef.current, cur.length);

    // Update thought cache after a successful save in draft mode.
    const savedThoughtId = thoughtIdRef.current;
    if (savedThoughtId && isThoughtModeRef.current) {
      queryClient.setQueryData(
        getGetThoughtQueryKey(savedThoughtId),
        (old: unknown) => {
          if (!old || typeof old !== "object") return old;
          return { ...old, content: cur };
        },
        { updatedAt: Date.now() },
      );
    } else if (id) {
      queryClient.setQueryData(
        getGetArticleQueryKey(id),
        (old: unknown) => {
          if (!old || typeof old !== "object") return old;
          return { ...old, title: titleRef.current, content: cur };
        },
        { updatedAt: Date.now() },
      );
    }
    invalidateArticleLists(queryClient);
    if (isThoughtModeRef.current) {
      queryClient.invalidateQueries({ queryKey: getListThoughtsQueryKey() });
    }
    exitToPreviousList();
  }, [flush, queryClient, getEditorContent, markDirty, id, deleteThought, showToast, isLocalDirectDraft, exitToPreviousList, flushLatestEditorSnapshot]);

  // Native lifecycle events have no reliable "before unload" hook.  Export the
  // WebView snapshot while the app is still active and flush it to the thought/article
  // record; useAutoSave keeps a retry snapshot if the network is unavailable.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" || modeRef.current === "dividing" || !initializedRef.current) return;
      void (async () => {
        if (isThoughtModeRef.current) {
          await flushLatestEditorSnapshot();
          return;
        }
        const latest = await getEditorContent();
        markDirty(titleRef.current, latest);
        await flush();
      })();
    });
    return () => sub.remove();
  }, [flushLatestEditorSnapshot, getEditorContent, markDirty, flush]);

  // A direct draft owns the shared composer lock until this writing screen
  // exits. This cleanup also covers auth resets and programmatic navigation;
  // setParams keeps the same screen mounted, so persisting a local draft does
  // not prematurely release the lock.
  useEffect(() => {
    return () => releaseDirectThoughtDraft();
  }, [releaseDirectThoughtDraft]);

  // ── 헤더/하드웨어 뒤로가기 통합 ────────────────────────────────────────────
  const handleHeaderBack = useCallback(() => {
    if (spellTabVisible) {
      editorRef.current?.clearSpellHighlight();
      setSpellTabVisible(false);
      setSpellState({ status: "idle" });
      spellAppliedCountRef.current = {};
      return;
    }
    handleDraftBack();
  }, [spellTabVisible, handleDraftBack]);

  // Keep the native edge-swipe, browser history back, and header button on
  // the same asynchronous save/delete path. usePreventRemove is required for
  // Native Stack: a bare beforeRemove listener is not reliable for iOS edge
  // gestures. A repeat removal while save/delete is in progress stays blocked.
  const handlePreventedRemoval = useCallback(() => {
    if (isNavigatingRef.current) return;
    if (!initializedRef.current) {
      exitToPreviousList();
      return;
    }
    handleHeaderBack();
  }, [handleHeaderBack, exitToPreviousList]);

  usePreventRemove(shouldPreventRemoval, handlePreventedRemoval);

  // usePreventRemove updates the native-stack removal guard after render.
  // Dispatch intentional route changes on the following turn so stage
  // replaces and completed exits are admitted exactly once.
  useEffect(() => {
    if (shouldPreventRemoval || !pendingNavigationRef.current) return;
    const navigate = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    const timer = setTimeout(navigate, 0);
    return () => clearTimeout(timer);
  }, [shouldPreventRemoval]);

  const handleDismissKeyboard = useCallback(() => {
    editorRef.current?.blur();
    Keyboard.dismiss();
    if (
      isThoughtModeRef.current
      && modeRef.current === "draft"
      && initializedRef.current
      && !isNavigatingRef.current
    ) {
      void flushLatestEditorSnapshot();
    }
  }, [flushLatestEditorSnapshot]);

  const handleKeyboardVisibilityChange = useCallback((visible: boolean) => {
    setKeyboardVisible(visible);
    if (
      !visible
      && isThoughtModeRef.current
      && modeRef.current === "draft"
      && initializedRef.current
      && !isNavigatingRef.current
    ) {
      void flushLatestEditorSnapshot();
    }
  }, [flushLatestEditorSnapshot]);

  const handleInsertDivider = useCallback(() => {
    editorRef.current?.insertDivider();
  }, []);

  const handleShiftEnter = useCallback(() => {
    editorRef.current?.insertHardBreak();
  }, []);

  const handleSelectionUpdate = useCallback((payload: OnSelectionUpdatePayload) => {
    setSelectionState(payload);
  }, []);

  // "본문" 버튼 — 블록 타입 인라인 패널 토글 (read.tsx와 동일 동작)
  const handleToolbarFormat = useCallback(() => {
    if (inlineMenuMode === "blockType") {
      closePanelRestoreKeyboard();
      return;
    }
    editorRef.current?.blur();
    Keyboard.dismiss();
    setInlineMenuMode("blockType");
  }, [inlineMenuMode, closePanelRestoreKeyboard]);

  // [+] 버튼 — floating 팝업 토글 (read.tsx와 동일 동작)
  const handleOpenAddMenu = useCallback(() => {
    if (inlineMenuMode === "addMenu") {
      setInlineMenuMode(null);
      return;
    }
    if (inlineMenuMode === "blockType" || inlineMenuMode === "quotePicker") {
      addMenuPendingRef.current = true;
      closePanelRestoreKeyboard();
      return;
    }
    addMenuBtnRef.current?.measure((_x, _y, width, _height, pageX) => {
      setPlusBtnCenterX(pageX + width / 2);
    });
    setInlineMenuMode("addMenu");
  }, [inlineMenuMode, closePanelRestoreKeyboard]);

  const handleSelectQuoteFromAddMenu = useCallback(() => {
    editorRef.current?.blur();
    Keyboard.dismiss();
    setInlineMenuMode("quotePicker");
  }, []);

  const handleSelectQuoteSentence = useCallback((sentence: StoredSentence) => {
    editorRef.current?.insertQuote(sentence.text);
    closePanelRestoreKeyboard();
  }, [closePanelRestoreKeyboard]);

  const handleOnFormat = useCallback((type: FormatType) => {
    if (type === "bold" || type === "italic" || type === "underline") {
      editorRef.current?.toggleMark(type);
    } else if (type === "quote") {
      const isActive = selectionState.activeBlock === "blockquote";
      editorRef.current?.setBlockType(isActive ? "paragraph" : "blockquote");
    }
  }, [selectionState.activeBlock]);

  // ── 분할 조작 (dividing) ───────────────────────────────────────────────────
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
          const bsResult = resolveBSJob(job, heights);
          if (!splitResults[job.paraIdx]) splitResults[job.paraIdx] = [];
          splitResults[job.paraIdx].push({
            wordOffset: job.wordOffset,
            wordCount: bsResult.wordCount,
          });
          if (bsResult.hasRemaining) {
            nextPending.push({
              paraIdx: job.paraIdx,
              allWords: job.allWords,
              wordOffset: bsResult.nextOffset,
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
      flush().catch((err) => {
        console.warn("[on-01] Immediate flush failed after structural change:", err);
      });
    },
    [editorReady, markDirty, flush],
  );

  const handleAutoSplit = useCallback(async () => {
    if (splitting) return;
    if (!hasOverflowPages) return;
    const cur = await getEditorContent();
    const rawPages = cur.split(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "m"));
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
    [splitting, getEditorContent, runDivisionEngine, applyEngineResult, showToast],
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
      flush().catch((err) => {
        console.warn("[on-01] Immediate flush failed after merge:", err);
      });
    },
    [getEditorContent, editorReady, markDirty, flush],
  );

  // ── 맞춤법 검사 (dividing) ─────────────────────────────────────────────────
  const handleRunSpellCheck = useCallback(async () => {
    setSpellTabVisible(true);
    setSpellState({ status: "loading" });
    spellAppliedCountRef.current = {};
    editorRef.current?.blur();
    Keyboard.dismiss();
    try {
      const text = await getEditorContent();
      const result = await apiSpellCheck({ text });
      if (result.error) {
        setSpellState({ status: "error", message: result.error });
        return;
      }
      const changes = result.changes ?? [];
      if (changes.length === 0) {
        setSpellState({ status: "empty" });
      } else {
        const counts: Record<string, number> = {};
        const occurrenceIndices = changes.map((c) => {
          const idx = counts[c.original] ?? 0;
          counts[c.original] = idx + 1;
          return idx;
        });
        setSpellState({ status: "reviewing", items: changes, index: 0, occurrenceIndices });
        editorRef.current?.setSpellHighlight(changes[0].original, changes[0].context ?? "", occurrenceIndices[0]);
      }
    } catch (e: any) {
      setSpellState({ status: "error", message: e?.message ?? "오류가 발생했습니다." });
    }
  }, [getEditorContent]);

  const handleSpellSkip = useCallback(() => {
    setSpellState((prev) => {
      if (prev.status !== "reviewing") return prev;
      const next = prev.index + 1;
      if (next >= prev.items.length) {
        editorRef.current?.clearSpellHighlight();
        return { status: "done" };
      }
      const nextItem = prev.items[next];
      const baseIdx = prev.occurrenceIndices[next];
      const applied = spellAppliedCountRef.current[nextItem.original] ?? 0;
      const effectiveIdx = Math.max(0, baseIdx - applied);
      editorRef.current?.setSpellHighlight(nextItem.original, nextItem.context ?? "", effectiveIdx);
      return { status: "reviewing", items: prev.items, index: next, occurrenceIndices: prev.occurrenceIndices };
    });
  }, []);

  const handleSpellApply = useCallback(() => {
    setSpellState((prev) => {
      if (prev.status !== "reviewing") return prev;
      const item = prev.items[prev.index];
      const baseIdx = prev.occurrenceIndices[prev.index];
      const applied = spellAppliedCountRef.current[item.original] ?? 0;
      const effectiveIdx = Math.max(0, baseIdx - applied);
      editorRef.current?.applySpellFix(item.original, item.replacement, item.context ?? "", effectiveIdx);
      spellAppliedCountRef.current = {
        ...spellAppliedCountRef.current,
        [item.original]: applied + 1,
      };
      const next = prev.index + 1;
      if (next >= prev.items.length) {
        return { status: "done" };
      }
      const nextItem = prev.items[next];
      const nextBase = prev.occurrenceIndices[next];
      const nextApplied = spellAppliedCountRef.current[nextItem.original] ?? 0;
      const nextEffective = Math.max(0, nextBase - nextApplied);
      editorRef.current?.setSpellHighlight(nextItem.original, nextItem.context ?? "", nextEffective);
      return { status: "reviewing", items: prev.items, index: next, occurrenceIndices: prev.occurrenceIndices };
    });
  }, []);

  const handleCloseSpellTab = useCallback(() => {
    editorRef.current?.clearSpellHighlight();
    setSpellTabVisible(false);
    setSpellState({ status: "idle" });
    spellAppliedCountRef.current = {};
  }, []);

  // ── WritingStateBar ────────────────────────────────────────────────────────
  const handleStateBarPress = useCallback(
    (target: WritingStage) => {
      if (modeRef.current === "draft") {
        if (target === "DRAFT") return;
        if (target === "DIVIDING") {
          enterDividingMode();
          return;
        }
        showToast({ message: "검토 단계를 먼저 완료해야 마감 단계로 이동할 수 있어요.", type: "info" });
        return;
      }
      // dividing — DRAFT tap is a no-op: promoted articles cannot go back.
      if (target === "DIVIDING") return;
      if (target === "DRAFT") {
        showToast({ message: "검토 단계로 승격한 글은 작성 단계로 되돌릴 수 없어요.", type: "info" });
        return;
      }
      if (target === "CLOSING") {
        handleNextToClosing();
      }
    },
    [enterDividingMode, handleNextToClosing, showToast],
  );

  useEffect(() => {
    return () => {
      if (exportDebounceTimerRef.current) {
        clearTimeout(exportDebounceTimerRef.current);
        exportDebounceTimerRef.current = null;
      }
    };
  }, []);

  // A direct draft owns the shared composer lock until this writing screen
  // exits. setParams keeps this component mounted, while this cleanup covers
  // auth resets and other programmatic navigation.
  useEffect(() => {
    return () => releaseDirectThoughtDraft();
  }, [releaseDirectThoughtDraft]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!initializedRef.current) {
        exitToPreviousList();
        return true;
      }
      handleHeaderBack();
      return true;
    });
    return () => sub.remove();
  }, [handleHeaderBack, exitToPreviousList]);

  if ((!isLocalDirectDraft && !id) || dataLoading) {
    return (
      <>
        <Stack.Screen options={{ gestureEnabled: true }} />
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.zinc400} />
            <Text style={styles.loadingText}>단상을 준비하고 있어요</Text>
          </View>
        </View>
      </>
    );
  }

  const hasLoadError = !isLocalDirectDraft && (
    isThoughtMode
      ? thoughtQuery.isError || !thought
      : articleQuery.isError || !article
  );

  if (hasLoadError) {
    return (
      <>
        <Stack.Screen options={{ gestureEnabled: true }} />
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={styles.loadingContainer}>
            <Feather name="alert-circle" size={30} color={Colors.zinc500} />
            <Text style={styles.loadErrorTitle}>단상을 열지 못했어요</Text>
            <Text style={styles.loadErrorDescription}>
              잠시 후 다시 시도하거나 이전 화면으로 돌아가세요.
            </Text>
            <View style={styles.loadErrorActions}>
              <ScalePressable
                style={styles.loadRetryButton}
                contentStyle={styles.loadRetryButtonContent}
                onPress={() => {
                  if (isThoughtMode) {
                    thoughtQuery.refetch();
                  } else {
                    articleQuery.refetch();
                  }
                }}
              >
                <Text style={styles.loadRetryButtonText}>다시 시도</Text>
              </ScalePressable>
              <ScalePressable
                style={styles.loadBackButton}
                contentStyle={styles.loadBackButtonContent}
                onPress={exitToPreviousList}
              >
                <Text style={styles.loadBackButtonText}>이전 화면</Text>
              </ScalePressable>
            </View>
          </View>
        </View>
      </>
    );
  }

  const isDividing = mode === "dividing";

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: true }} />
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <ScalePressable onPress={handleHeaderBack} hitSlop={12}>
            <Feather name="arrow-left" size={20} color={Colors.zinc600} />
          </ScalePressable>
          <WritingStateBar
            current={isDividing ? "DIVIDING" : "DRAFT"}
            onPress={handleStateBarPress}
            disabled={isNavigating}
            draftLabel="단상"
          />
          {keyboardVisible ? (
            <ScalePressable onPress={handleDismissKeyboard} hitSlop={12}>
              <MaterialCommunityIcons name="keyboard-off-outline" size={22} color={Colors.zinc600} />
            </ScalePressable>
          ) : isNavigating ? (
            <ActivityIndicator size="small" color={Colors.zinc400} />
          ) : (
            <View style={styles.headerRight} />
          )}
        </View>

        {isDividing && (
          <>
            <View style={styles.toolbar}>
              <Text style={styles.pageCountLabel}>{pages.length}페이지</Text>
              <View style={styles.toolbarSpacer} />
              <ScalePressable
                style={styles.autoSplitButton}
                onPress={handleRunSpellCheck}
                disabled={spellTabVisible || spellState.status === "loading"}
                contentStyle={[styles.autoSplitButtonContent, spellTabVisible && styles.autoSplitButtonDisabled]}
              >
                <Feather name="check-circle" size={14} color={Colors.zinc600} />
                <Text style={styles.autoSplitText}>
                  {spellState.status === "loading" ? "검사 중…" : "맞춤법 검사"}
                </Text>
              </ScalePressable>
              <ScalePressable
                style={styles.autoSplitButton}
                onPress={handleAutoSplit}
                disabled={splitting || !hasOverflowPages}
                accessibilityState={{ disabled: splitting || !hasOverflowPages }}
                accessibilityHint={
                  hasOverflowPages
                    ? "분량을 초과한 페이지만 다시 나눕니다. 다른 페이지 분할은 그대로 유지됩니다."
                    : "초과된 페이지가 없어 자동 분할을 사용할 수 없습니다."
                }
                contentStyle={styles.autoSplitButtonContent}
              >
                <Feather name="scissors" size={14} color={Colors.zinc600} />
                <Text style={styles.autoSplitText}>{splitting ? "분할 중…" : "자동분할"}</Text>
              </ScalePressable>
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
                        <ScalePressable
                          onPress={() => handleMergeWithPrevious(idx)}
                          hitSlop={6}
                          style={styles.chipMergeButton}
                          accessibilityLabel={`페이지 ${idx + 1} 이전 페이지와 합치기`}
                          contentStyle={styles.chipMergeButtonContent}
                        >
                          <Feather name="x" size={12} color={Colors.zinc600} />
                        </ScalePressable>
                      ) : null}
                      <Text style={styles.chipPageNumber}>{idx + 1}쪽</Text>
                      <Text style={styles.chipCharCount}>{p.charCount}자</Text>
                      <ScalePressable
                        onPress={() => handleSplitPage(idx)}
                        disabled={splitting}
                        hitSlop={6}
                        style={styles.chipSplitButton}
                        accessibilityLabel={`페이지 ${idx + 1} 나누기`}
                        contentStyle={[styles.chipSplitButtonContent, splitting && styles.chipSplitButtonDisabled]}
                      >
                        <Feather name="scissors" size={11} color={Colors.zinc600} />
                        <Text style={styles.chipSplitText}>나누기</Text>
                      </ScalePressable>
                    </View>
                  );
                })}
              </ScrollView>
            </View>

            <WebViewMeasureLayer request={warningRequest} onMeasured={handleWarningMeasured} />
            <WebViewMeasureLayer request={engineRequest} onMeasured={handleEngineMeasured} />
          </>
        )}

        <KeyboardAvoidingView
          style={styles.editorOuter}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={[styles.editorInner, { width: containerWidth }]}>
            {/*
              본문 텍스트 컬럼은 4개 화면(작성/분할/마감/읽기)이 동일한 정수 픽셀 폭으로
              줄넘김을 결정해야 한다. textColumnWidth (= Math.round(containerWidth − 2×paddingX))를
              그대로 자식 View의 width로 사용해 Yoga 픽셀 스냅이 부모 위치에 따라
              ±1px 흔들리는 일을 차단한다.
            */}
            <View style={[styles.markdownEditorContainer, { width: textColumnWidth, alignSelf: "center" }]}>
              <WebViewMarkdownEditor
                ref={editorRef}
                initialMarkdown={contentRef.current}
                titleValue={title}
                placeholder="떠오르는 생각을 자유롭게 적어보세요..."
                ensureTrailingParagraph={!isLocalDirectDraft}
                editable
                onReload={handleEditorReload}
                onReady={handleEditorReady}
                onChange={handleEditorChange}
                onExportMarkdown={handleExportMarkdown}
                onError={handleEditorError}
                onTitleChange={isThoughtMode && !isDividing ? undefined : handleTitleChange}
                onKeyboardVisibilityChange={handleKeyboardVisibilityChange}
                onSelectionUpdate={handleSelectionUpdate}
                typography={typography}
                hideTitle={isThoughtMode && !isDividing}
                sourceArticleSlotText={
                  isDividing
                    ? (sourceArticleId
                        ? `⤷ ${sourceArticleTitle ?? "로딩 중..."} 의 답장 ⚙️`
                        : "⤷ 이 편지를 답장으로 설정 ⚙️")
                    : ""
                }
                onSourceArticleSlotTap={isDividing ? () => setPickerVisible(true) : undefined}
              />
            </View>
            <View style={styles.editorFooter}>
              <View style={styles.autoSaveFeedback} />
              <Text style={styles.charCountText}>{charCount}자</Text>
            </View>
          </View>

          {/*
            툴바 자체는 화면 루트에 absolute로 floating한다(read.tsx와 동일 구조).
            여기서는 키보드가 올라온 동안 에디터가 툴바에 가려지지 않도록
            툴바 높이만큼 공간을 확보한다.
          */}
          {keyboardVisible && Platform.OS !== "web" && selectionState.activeBlock !== "horizontalRule" && (
            <View style={styles.toolbarSpacerBottom} />
          )}
        </KeyboardAvoidingView>

        {/* ── 서식 툴바 — 키보드/인라인 패널 위 floating (read.tsx와 동일) ── */}
        {Platform.OS !== "web" && selectionState.activeBlock !== "horizontalRule" &&
          (keyboardVisible || inlineMenuMode !== null || keyboardRestorePending) && (
          <View
            style={[
              styles.memoToolbarWrap,
              { bottom: keyboardVisible ? keyboardHeight : inlinePanelHeight },
            ]}
            pointerEvents="box-none"
          >
            <MemoToolbar
              onDismissKeyboard={() => {
                handleDismissKeyboard();
              }}
              onFormat={handleOnFormat}
              onOpenAddMenu={handleOpenAddMenu}
              onUndo={() => editorRef.current?.undo()}
              onRedo={() => editorRef.current?.redo()}
              canUndo={selectionState.canUndo ?? true}
              canRedo={selectionState.canRedo ?? true}
              selectionState={selectionState}
              onFormatPress={handleToolbarFormat}
              onInsertDivider={handleInsertDivider}
              onShiftEnter={handleShiftEnter}
              inlineMenuMode={inlineMenuMode}
              keyboardVisible={keyboardVisible}
              addMenuBtnRef={addMenuBtnRef}
            />
          </View>
        )}

        {/* ── [+] 팝업 메뉴 (addMenu) ── */}
        {inlineMenuMode === "addMenu" && (
          <AddMenuPopup
            keyboardHeight={keyboardHeight}
            plusBtnCenterX={plusBtnCenterX}
            onDismiss={() => setInlineMenuMode(null)}
            onSelectQuote={handleSelectQuoteFromAddMenu}
          />
        )}

        {/* ── 인라인 메뉴 패널 (본문/문장수집 인용) ── */}
        {inlineMenuMode !== null && inlineMenuMode !== "addMenu" && (
          <InlineMenuPanel
            mode={inlineMenuMode}
            panelHeight={inlinePanelHeight}
            activeBlock={selectionState.activeBlock}
            userId={userId ?? ""}
            onSelectBlock={(blockType) => {
              editorRef.current?.setBlockType(blockType);
              closePanelRestoreKeyboard();
            }}
            onSelectSentence={handleSelectQuoteSentence}
            onSelectQuoteMenu={handleSelectQuoteFromAddMenu}
            onDismiss={closePanelRestoreKeyboard}
          />
        )}

        {isDividing && spellTabVisible && (
          <View style={styles.spellPanel}>
            <View style={styles.spellPanelHeader}>
              <Text style={styles.spellPanelTitle}>
                {spellState.status === "reviewing"
                  ? `맞춤법 검사 (${spellState.index + 1}/${spellState.items.length})`
                  : "맞춤법 검사"}
              </Text>
              <ScalePressable onPress={handleCloseSpellTab} hitSlop={12}>
                <Feather name="x" size={18} color={Colors.zinc500} />
              </ScalePressable>
            </View>

            {spellState.status === "loading" && (
              <View style={styles.spellCenter}>
                <ActivityIndicator size="small" color={Colors.zinc400} />
                <Text style={styles.spellHintText}>검사 중…</Text>
              </View>
            )}

            {spellState.status === "empty" && (
              <View style={styles.spellCenter}>
                <Feather name="check-circle" size={28} color="#22c55e" />
                <Text style={styles.spellHintText}>맞춤법 오류가 없어요.</Text>
              </View>
            )}

            {spellState.status === "done" && (
              <View style={styles.spellCenter}>
                <Feather name="check-circle" size={28} color="#22c55e" />
                <Text style={styles.spellHintText}>검사 완료</Text>
              </View>
            )}

            {spellState.status === "error" && (
              <View style={styles.spellCenter}>
                <Feather name="alert-circle" size={28} color="#ef4444" />
                <Text style={[styles.spellHintText, { color: "#b91c1c" }]}>{spellState.message}</Text>
                <ScalePressable onPress={handleRunSpellCheck} style={styles.spellRetryBtn} contentStyle={styles.spellRetryBtnContent}>
                  <Text style={styles.spellRetryBtnText}>다시 시도</Text>
                </ScalePressable>
              </View>
            )}

            {spellState.status === "reviewing" && (() => {
              const item = spellState.items[spellState.index];
              const ctx = item.context ?? "";
              const origIdx = ctx.indexOf(item.original);
              const ctxBefore = origIdx >= 0 ? ctx.slice(0, origIdx) : ctx;
              const ctxAfter = origIdx >= 0 ? ctx.slice(origIdx + item.original.length) : "";
              const hasCtx = origIdx >= 0;
              return (
                <View style={styles.spellCard}>
                  {ctx.length > 0 && (
                    <View style={styles.spellContextBox}>
                      <Text style={styles.spellContextText} numberOfLines={2}>
                        {hasCtx ? (
                          <>
                            <Text>{ctxBefore}</Text>
                            <Text style={styles.spellContextHighlight}>{item.original}</Text>
                            <Text>{ctxAfter}</Text>
                          </>
                        ) : ctx}
                      </Text>
                    </View>
                  )}
                  <View style={styles.spellTypeBadge}>
                    <Text style={styles.spellTypeBadgeText}>{item.type}</Text>
                  </View>
                  <View style={styles.spellTextRow}>
                    <View style={[styles.spellTextBubble, styles.spellTextBubbleOriginal]}>
                      <Text style={styles.spellOriginalText}>{item.original}</Text>
                    </View>
                    <Feather name="arrow-right" size={14} color={Colors.zinc400} />
                    <View style={[styles.spellTextBubble, styles.spellTextBubbleReplacement]}>
                      <Text style={styles.spellReplacementText}>{item.replacement}</Text>
                    </View>
                  </View>
                  <Text style={styles.spellReasonText} numberOfLines={2}>{item.reason}</Text>
                  <View style={styles.spellActions}>
                    <ScalePressable style={styles.spellSkipButton} contentStyle={styles.spellSkipButtonContent} onPress={handleSpellSkip}>
                      <Text style={styles.spellSkipText}>건너뛰기</Text>
                    </ScalePressable>
                    <ScalePressable style={styles.spellApplyButton} contentStyle={styles.spellApplyButtonContent} onPress={handleSpellApply}>
                      <Text style={styles.spellApplyText}>적용</Text>
                    </ScalePressable>
                  </View>
                </View>
              );
            })()}
          </View>
        )}

        {/* Source article picker — dividing article only */}
        {isDividing && userId && (
          <SourceArticlePickerSheet
            visible={pickerVisible}
            onClose={() => setPickerVisible(false)}
            userId={userId}
            currentSourceArticleId={sourceArticleId}
            currentSourceArticleTitle={sourceArticleTitle}
            onSelect={handleSourceArticleSelect}
            onUnlink={handleSourceArticleUnlink}
          />
        )}

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
    paddingHorizontal: Spacing.screenPx,
    gap: Spacing.md,
  },
  loadingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  loadErrorTitle: {
    ...Typography.bodyMedium,
    color: Colors.zinc800,
    marginTop: Spacing.sm,
  },
  loadErrorDescription: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
    textAlign: "center",
  },
  loadErrorActions: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  loadRetryButton: {
    width: 92,
    height: 40,
    flexGrow: 0,
    flexShrink: 0,
  },
  loadRetryButtonContent: {
    width: "100%",
    height: "100%",
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: 20,
    backgroundColor: Colors.zinc900,
    alignItems: "center",
    justifyContent: "center",
  },
  loadRetryButtonText: {
    ...Typography.captionMedium,
    fontSize: 13,
    color: Colors.white,
  },
  loadBackButton: {
    width: 92,
    height: 40,
    flexGrow: 0,
    flexShrink: 0,
  },
  loadBackButtonContent: {
    width: "100%",
    height: "100%",
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: 20,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  loadBackButtonText: {
    ...Typography.captionMedium,
    fontSize: 13,
    color: Colors.zinc700,
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
  autoSplitButton: {},
  autoSplitButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
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
  sourceArticleRow: {
    paddingBottom: 8,
  },
  sourceArticleRowContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sourceArticleText: {
    flex: 1,
    fontSize: 13,
    color: Colors.zinc500,
    fontFamily: "Pretendard",
  },
  sourceArticleGear: {
    fontSize: 13,
  },
  editorOuter: {
    flex: 1,
    alignItems: "center",
  },
  // floating 툴바가 가리는 만큼 KAV 내부에 확보하는 공간 (툴바 캡슐 44 + 상하 8)
  toolbarSpacerBottom: {
    height: 60,
  },
  memoToolbarWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 53,
    ...Platform.select({ android: { elevation: 8 } }),
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
    justifyContent: "space-between",
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc100,
  },
  autoSaveFeedback: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexGrow: 0,
    flexShrink: 1,
  },
  charCountText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
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
  },
  chipMergeButtonContent: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.zinc200,
    alignItems: "center",
    justifyContent: "center",
  },
  chipPageNumber: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc700,
    fontWeight: "600",
  },
  chipCharCount: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  chipSplitButton: {},
  chipSplitButtonContent: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: Colors.zinc200,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  chipSplitButtonDisabled: {
    opacity: 0.5,
  },
  chipSplitText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc700,
  },
  spellPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc200,
    paddingBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 8,
  },
  spellPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  spellPanelTitle: {
    ...Typography.caption,
    fontSize: 13,
    fontWeight: "600",
    color: Colors.zinc700,
  },
  spellCenter: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    gap: 8,
  },
  spellHintText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
    textAlign: "center",
  },
  spellRetryBtn: {
    marginTop: 10,
  },
  spellRetryBtnContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  spellRetryBtnText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc700,
    fontWeight: "600",
  },
  spellCard: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 14,
    gap: 10,
  },
  spellContextBox: {
    backgroundColor: Colors.zinc50 ?? "#fafafa",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderLeftWidth: 2,
    borderLeftColor: Colors.zinc200,
  },
  spellContextText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
    lineHeight: 20,
  },
  spellContextHighlight: {
    color: "#b91c1c",
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  spellTypeBadge: {
    alignSelf: "flex-start",
    backgroundColor: Colors.zinc100,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  spellTypeBadgeText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc600,
    fontWeight: "600",
  },
  spellTextRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  spellTextBubble: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  spellTextBubbleOriginal: {
    backgroundColor: "#fef2f2",
  },
  spellTextBubbleReplacement: {
    backgroundColor: "#eff6ff",
  },
  spellOriginalText: {
    ...Typography.body,
    fontSize: 14,
    color: "#b91c1c",
    fontWeight: "600",
  },
  spellReplacementText: {
    ...Typography.body,
    fontSize: 14,
    color: "#1d4ed8",
    fontWeight: "600",
  },
  spellReasonText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  spellActions: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    paddingTop: 2,
  },
  spellSkipButton: {},
  spellSkipButtonContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    alignItems: "center",
    justifyContent: "center",
  },
  spellSkipText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc600,
  },
  spellApplyButton: {},
  spellApplyButtonContent: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#3b82f6",
    alignItems: "center",
    justifyContent: "center",
  },
  spellApplyText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.white,
    fontWeight: "600",
  },
});
