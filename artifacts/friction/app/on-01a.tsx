import React, { useState, useCallback, useMemo, useEffect, useRef, useReducer } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
  AppState,
  useWindowDimensions,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Stack, useNavigation, useFocusEffect } from "expo-router";
import { usePreventRemove } from "expo-router/build/react-navigation/core";
import type { NavigationAction } from "expo-router/build/react-navigation/routers";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Shadows, Sizing } from "@/constants/tokens";
import { useAutoSave, type AutoSaveRestoreContext } from "@/lib/useAutoSave";
import {
  resolveDetailEntity,
  shouldRetryDetailQuery,
  detailQueryRetryDelayMs,
  isRetryableDetailError,
  isConfirmedGoneError,
  type DetailErrorReason,
} from "@/lib/detailEntityResolution";
import { GuardedReturnSession } from "@/lib/guardedReturnSession";
import {
  WritingLifecycleFlushCoordinator,
  type WritingAppState,
} from "@/lib/writingLifecycle";
import {
  createClosingTransitionSuppressionController,
  type ClosingTransitionSuppressionController,
} from "@/lib/closingTransitionSuppression";
import { useEditorLayout } from "@/lib/useEditorLayout";
import { bodyTypographyMetrics, getBodyContentHeight } from "@/lib/bodyLayout";
import {
  getNativeBodyFontMode,
  subscribeNativeBodyFontMode,
} from "@/lib/nativeBodyFontMode";
import {
  splitContentToPages,
  splitPageContentsLosslessly,
  splitPageContentForDivision,
  validatePages,
  simulateGreedyJobs,
  resolveBSJob,
  runGreedy,
  bsCandidateKey,
  bsCandidatesForJob,
  formatBsCandidateForMeasurement,
  type BSJob,
  type BSResult,
  type DivisionWarning,
} from "@/lib/pageDivision";
import {
  parseMarkdownBlocks,
  type MarkdownBlockType,
} from "@/utils/markdownParser";
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
  useRevertArticleToThought,
  useActivateThoughtQuestion,
  getGetThoughtQuestionQueueQueryKey,
  type Article,
  type Thought,
  type ThoughtArticleTransitionBody,
  type StoredSentence,
  type SpellChange,
  spellCheck as apiSpellCheck,
} from "@workspace/api-client-react";
import {
  createThoughtDocumentSnapshot,
  isMeaningfulThoughtMarkdown,
} from "@workspace/api-zod";
import { useQueryClient } from "@tanstack/react-query";
import { buildStoredSentenceQuote } from "@/lib/storedSentenceQuote";
import {
  invalidateArticleLists,
  invalidateThoughtLists,
  invalidateArticleDetail,
  invalidateDirectThoughtCreation,
  insertThoughtInRecordCache,
  patchArticleInRecordCaches,
  upsertArticleInRecordCaches,
  patchThoughtInRecordCaches,
  removeRecordFromCache,
  restoreRecordListCaches,
  stageArticleTransitionSnapshot,
  getProtectedArticleDetailSnapshot,
  snapshotRecordListCaches,
  upsertThoughtInRecordCaches,
  setThoughtQuestionQueueCache,
  removeThoughtQuestionFromQueueCache,
} from "@/lib/queryInvalidation";
import { useUser } from "@/contexts/UserContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { useThoughtComposer } from "@/contexts/ThoughtComposerContext";
import { useNavigation as useAppNavigation } from "@/contexts/NavigationContext";
import WritingStateBar, {
  type WritingStageAction,
} from "@/components/WritingStateBar/WritingStateBar";
import MemoToolbar, { type FormatType } from "@/components/MemoToolbar/MemoToolbar";
import AddMenuPopup from "@/components/MemoToolbar/AddMenuPopup";
import InlineMenuPanel, { type InlineMenuMode } from "@/components/InlineMenuPanel/InlineMenuPanel";
import HeaderButton from "@/components/shared/HeaderButton";
import {
  createEditorTransitionSnapshot,
  exportEditorTransitionSnapshot,
  type EditorTransitionSnapshot,
} from "@/lib/editorTransitionSnapshot";
import {
  dismissEditorKeyboard,
  INITIAL_EDITOR_KEYBOARD_STATE,
  reduceEditorKeyboardState,
  resolveMemoToolbarRenderContract,
} from "@/lib/readingMemoToolbar";
import { resolveFloatingChromeOffset } from "@/lib/floatingChromeOffset";
import {
  trackDraftSaved,
  trackWritingStarted,
} from "@/lib/analytics";
import {
  MEMO_TOOLBAR_OCCUPIED_HEIGHT,
  resolveEditorBottomVisibility,
} from "@/lib/editorViewport";

const PAGE_DIVIDER = MarkdownPolicy.PAGE_DIVIDER;

const DEFAULT_SELECTION: OnSelectionUpdatePayload = {
  activeBlock: "paragraph",
  isBold: false,
  isItalic: false,
  isUnderline: false,
};

const PAGE_KEY_PREFIX = "page_";
const EXPORT_DEBOUNCE_MS = 1200;
const DIRECT_THOUGHT_INITIAL_MARKDOWN = "# ";

const WRITING_EDITOR_BOTTOM_PADDING = 24;
const WRITING_HEADER_HEIGHT = 68;
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
  resolve: (snapshot: EditorTransitionSnapshot) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingStageTransition {
  entityId: string;
  title: string;
  content: string;
  titleMarkdown: string;
  markdown: string;
  docVersion: number;
  editorSessionId: string;
  expectedUpdatedAt: string;
  requestId: string;
}

const DETAIL_ERROR_COPY: Record<DetailErrorReason, { title: string; description: string }> = {
  "not-found": {
    title: "글을 찾을 수 없어요",
    description: "삭제되었거나 존재하지 않는 기록이에요.",
  },
  "not-dividing": {
    title: "글을 찾을 수 없어요",
    description: "삭제되었거나 존재하지 않는 기록이에요.",
  },
  auth: {
    title: "로그인이 만료됐어요",
    description: "다시 로그인한 뒤 시도해주세요.",
  },
  "not-implemented": {
    title: "아직 지원하지 않는 기능이에요",
    description: "앱을 최신 버전으로 업데이트한 뒤 다시 시도해주세요.",
  },
  connection: {
    title: "단상을 열지 못했어요",
    description: "네트워크 연결을 확인하고 다시 시도해주세요.",
  },
};
export default function WritingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const { setRecordKindIntent } = useAppNavigation();
  const queryClient = useQueryClient();
  const { id, source, mode: modeParam, editorContext, returnPage, returnBlock, spaceId, spaceRoundId, letterType } = useLocalSearchParams<{
    id?: string;
    source?: string;
    mode?: string;
    editorContext?: "readingMemo" | "record";
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
  const { isLoading: authIsLoading } = useAuth();
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

  // Suppresses the false-positive "not-dividing" detail error for the
  // render(s) between staging this screen's own optimistic "review →
  // closing" status patch and the route actually leaving this screen. The
  // flag itself is a plain (non-state) controller so `begin()` takes effect
  // synchronously on the very render the optimistic cache patch triggers,
  // not one tick later. On every focus (a failed/aborted transition, or the
  // user returning here) the controller is cleared, and — since clearing a
  // plain flag would not itself trigger a re-render — a version bump forces
  // one, so a genuine error is detected normally again immediately.
  const closingTransitionSuppressionRef = useRef<ClosingTransitionSuppressionController>(
    createClosingTransitionSuppressionController(),
  );
  const [, forceDetailResolutionRecheck] = useReducer((n: number) => n + 1, 0);
  useFocusEffect(
    useCallback(() => {
      if (closingTransitionSuppressionRef.current.handleFocus()) {
        forceDetailResolutionRecheck();
      }
    }, []),
  );

  // ── 데이터 fetching ─────────────────────────────────────────────────────────
  //
  // Routes identify their entity type: draft routes fetch only their thought,
  // dividing routes fetch only their article. A direct local draft has neither
  // until its first meaningful save.

  // Auth restoration can take a moment on native (SecureStore session read).
  // Starting these queries during that window would surface a false failure
  // screen before the session even had a chance to attach; gate on it so the
  // request simply waits and fires automatically once auth resolves.
  const thoughtQuery = useGetThought(id ?? "", {
    query: {
      queryKey: getGetThoughtQueryKey(id ?? ""),
      enabled: !!id && !isLocalDirectDraft && modeParam !== "dividing" && !authIsLoading,
      retry: shouldRetryDetailQuery,
      retryDelay: detailQueryRetryDelayMs,
    },
  });

  const articleQuery = useGetArticle(id ?? "", {
    query: {
      queryKey: getGetArticleQueryKey(id ?? ""),
      enabled: !!id && !isLocalDirectDraft && !authIsLoading,
      retry: shouldRetryDetailQuery,
      retryDelay: detailQueryRetryDelayMs,
    },
  });

  // Determine active entity.
  // A thought is active when its query succeeded (status PRELIMINARY).
  // An article is active when its query succeeds after a promotion.
  const thought = thoughtQuery.data;
  const article = getProtectedArticleDetailSnapshot(queryClient, id ?? "", articleQuery.data);
  const detailResolution = resolveDetailEntity({
    requestMode: modeParam === "dividing" ? "dividing" : "thought",
    thought: thoughtQuery,
    article: { ...articleQuery, data: article },
    suppressNotDividingError: closingTransitionSuppressionRef.current.isPending(),
  });

  // isThoughtMode: the id refers to a thought (draft writing stage).
  // A non-dividing writing route is always a thought route. Decide this from
  // the URL before data arrives so a restored persisted thought can never
  // briefly autosave against the article endpoint during its first render.
  const isThoughtMode = isLocalDirectDraft || (
    modeParam !== "dividing"
    && !(
      detailResolution.kind === "success"
      && detailResolution.entity === "article"
    )
  );

  // Active article for dividing mode.
  const dividingArticle = article && article.status === "DIVIDING" ? article : undefined;

  const isThoughtModeRef = useRef(false);
  isThoughtModeRef.current = isThoughtMode;

  const dataLoading = !!id && !isLocalDirectDraft && detailResolution.kind === "loading";
  const isReadingMemoContext = isThoughtMode && editorContext === "readingMemo";

  // A question-queue thought is created with status PRELIMINARY and only the
  // POST /thoughts/:id/activate route ever moves it to NORMAL; nothing else
  // produces this exact combination. This lets a direct on-01a entry (deep
  // link, stale state, etc.) reliably detect "this is still a queued
  // question" without a separate queue-membership fetch, and route it
  // through the same activation flow the queue screen already uses instead
  // of opening it as a plain thought edit.
  const isUnactivatedQuestion =
    isThoughtMode
    && detailResolution.kind === "success"
    && detailResolution.entity === "thought"
    && thought?.createdFrom === "question"
    && thought?.status === "PRELIMINARY";

  // Mutations
  const updateArticle = useUpdateArticle();
  const updateThought = useUpdateThought();
  const createThought = useCreateThought();
  const deleteThought = useDeleteThought();
  const promoteThought = usePromoteThought();
  const revertArticleToThought = useRevertArticleToThought();
  const transitionStatus = useTransitionArticleStatus();
  const activateThoughtQuestion = useActivateThoughtQuestion();
  const questionActivationRef = useRef<string | null>(null);

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

  useEffect(() => {
    setRecordKindIntent(mode === "draft" ? "thought" : "editing");
  }, [mode, setRecordKindIntent]);

  // ── 공통 상태 ─────────────────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [editorKeyboardState, setEditorKeyboardState] = useState(
    INITIAL_EDITOR_KEYBOARD_STATE,
  );
  const [editorReady, setEditorReady] = useState(false);
  const editorReadyRef = useRef(false);
  const shouldFocusInitialH1Ref = useRef(isLocalDirectDraft);
  const initialH1FocusedSessionRef = useRef<string | undefined>(undefined);
  const [initialized, setInitialized] = useState(false);
  const [selectionState, setSelectionState] = useState<OnSelectionUpdatePayload>(DEFAULT_SELECTION);
  const [isNavigating, setIsNavigating] = useState(false);
  const splittingRef = useRef(false);

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
      setKeyboardVisible(true);
      setEditorKeyboardState((current) =>
        reduceEditorKeyboardState(current, { type: "nativeKeyboard", visible: true }),
      );
      setKeyboardRestorePending(false); // 키보드가 실제로 올라오면 플래그 해제
      if (addMenuPendingRef.current) {
        addMenuPendingRef.current = false;
        setInlineMenuMode("addMenu");
      }
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
      setKeyboardVisible(false);
      setEditorKeyboardState((current) =>
        reduceEditorKeyboardState(current, { type: "nativeKeyboard", visible: false }),
      );
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

  useEffect(() => {
    if (!isReadingMemoContext) return;
    addMenuPendingRef.current = false;
    setInlineMenuMode(null);
    setKeyboardRestorePending(false);
  }, [isReadingMemoContext]);

  // 키보드/인라인 패널/플로팅 메뉴가 공유하는 단일 bottom 오프셋.
  // 세 표면(툴바·InlineMenuPanel·AddMenuPopup)이 각자 오프셋을 계산하면
  // Keyboard.dismiss() 직후처럼 keyboardVisible이 false로 바뀌는 전환에서
  // 서로 다른 값을 잠깐 쓰는 이중 점프가 생긴다 — 반드시 이 값 하나만 쓴다.
  const floatingChromeOffset = resolveFloatingChromeOffset({
    keyboardVisible,
    keyboardHeight,
    lastKnownKeyboardHeight: lastKeyboardHeightRef.current,
    screenHeight,
  });
  // InlineMenuPanel의 panelHeight prop 이름은 유지하되 동일한 오프셋을 참조한다.
  const inlinePanelHeight = floatingChromeOffset;

  const contentRef = useRef("");
  const titleRef = useRef("");
  const initializedRef = useRef(false);
  const articleContentRef = useRef("");
  // 마지막으로 서버에서 본 content. 사용자 편집 발생 여부 감지에 사용.
  const serverContentRef = useRef("");
  const isNavigatingRef = useRef(false);
  const pendingReverseSnapshotRef = useRef<{
    articleId: string;
    title: string;
    content: string;
    expectedUpdatedAt: string;
    requestId: string;
  } | null>(null);
  const pendingPromotionSnapshotRef = useRef<PendingStageTransition | null>(null);
  const retryPromotionRef = useRef<(() => void) | null>(null);
  // Native Stack requires usePreventRemove instead of a bare beforeRemove
  // listener for reliable interactive iOS swipe cancellation. One session owns
  // either the exact intercepted action or one explicit app navigation.
  const [shouldPreventRemoval, setShouldPreventRemoval] = useState(true);
  const returnSessionRef = useRef(new GuardedReturnSession<NavigationAction>());
  const pendingExplicitRef = useRef<{
    generation: number;
    resumeGuardAfterRouteChange: boolean;
  } | null>(null);
  const thoughtIdRef = useRef<string | undefined>(id);
  const thoughtCreationIdRef = useRef<string | undefined>(
    isLocalDirectDraft ? createThoughtClientId() : undefined,
  );
  const thoughtCreationGenerationRef = useRef(1);
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
  const writingStartedRef = useRef(false);
  const writingSessionIdRef = useRef(
    `writing_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  );

  const trackFirstMeaningfulEdit = useCallback(() => {
    if (writingStartedRef.current) return;
    writingStartedRef.current = true;
    trackWritingStarted({
      writingSessionId: writingSessionIdRef.current,
      entityId: thoughtIdRef.current ?? id,
      entityMode: isThoughtModeRef.current ? "draft" : "dividing",
    });
  }, [id]);

  const nextExportRequestId = useCallback((kind: "export" | "autosave") => {
    exportRequestSeqRef.current += 1;
    return `${kind}_${Date.now()}_${exportRequestSeqRef.current}`;
  }, []);

  // ── 분할 상태 (dividing) ───────────────────────────────────────────────────
  const [splitting, setSplitting] = useState(false);
  const [nativeBodyFontMode, setNativeBodyFontMode] = useState(getNativeBodyFontMode);

  useEffect(
    () => subscribeNativeBodyFontMode(setNativeBodyFontMode),
    [],
  );

  type SpellState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "reviewing"; items: SpellChange[]; index: number; occurrenceIndices: number[] }
    // hadFailures: true when at least one item in this review session could
    // not be located in the document and was silently un-applied (task #912)
    // — the panel must not present that as a clean "검토 완료".
    | { status: "done"; hadFailures: boolean }
    | { status: "empty" }
    | { status: "error"; message: string };
  const [spellState, setSpellState] = useState<SpellState>({ status: "idle" });
  const spellAppliedCountRef = useRef<Record<string, number>>({});
  // Counts items in the current review session whose applySpellFix() round
  // trip resolved false (WebView could not find/apply the match).
  const spellFailureCountRef = useRef(0);
  // Guards against a second "적용" tap firing another applySpellFix while one
  // is still in flight (would race occurrence bookkeeping / doc mutations).
  const spellApplyInFlightRef = useRef(false);
  const [spellApplyBusy, setSpellApplyBusy] = useState(false);
  const spellCheckInFlightRef = useRef(false);
  const [spellTabVisible, setSpellTabVisible] = useState(false);
  const returnBlockScrollDoneRef = useRef(false);

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
    // Promotion renders the review surface before the article response arrives.
    // Keep that exact snapshot authoritative until the identity handoff finishes;
    // a late thought/article query must not temporarily replace it with "".
    const promotionTitle = pendingPromotionSnapshotRef.current?.title;
    const activeTitle = promotionTitle
      ?? (isThoughtMode ? "" : article?.title ?? titleRef.current);

    if (!isThoughtMode && !article) return;
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
      // 초기 모드 결정: mode 파라미터 또는 서버 status(DIVIDING) 기준.
      const initialMode: EditorMode =
        modeParam === "dividing" || (!isThoughtMode && article?.status === "DIVIDING") ? "dividing" : "draft";
      setModeBoth(initialMode);
      if (editorReady) {
        serverInjectionPendingRef.current = true;
        const shouldFocusAtStart =
          shouldFocusInitialH1Ref.current
          && currentEditorSessionIdRef.current !== initialH1FocusedSessionRef.current;
        editorRef.current?.setMarkdown(c, { focusAtStart: shouldFocusAtStart });
        editorRef.current?.setTitle(t);
        if (shouldFocusAtStart) {
          initialH1FocusedSessionRef.current = currentEditorSessionIdRef.current;
        }
      }
      console.log("[on-01 init] cached?=true dirty?=false injected:", JSON.stringify(c.slice(0, 60)));
    } else if (contentRef.current === serverContentRef.current) {
      // 백그라운드 refetch: 사용자가 편집하지 않았을 때만 서버 값 재주입.
      const c = activeContent;
      const t = activeTitle || titleRef.current;
      if (c !== serverContentRef.current || t !== titleRef.current) {
        const contentChanged = c !== serverContentRef.current;
        serverContentRef.current = c;
        contentRef.current = c;
        articleContentRef.current = c;
        setContent(c);
        setTitle(t);
        titleRef.current = t;
        if (editorReady) {
          serverInjectionPendingRef.current = true;
          if (contentChanged) editorRef.current?.setMarkdown(c);
          editorRef.current?.setTitle(t);
        }
        console.log("[on-01 init] re-inject from server dirty?=false injected:", JSON.stringify(c.slice(0, 60)));
      }
    }
  }, [thought, article, isThoughtMode, isLocalDirectDraft, editorReady, modeParam, setModeBoth]);

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
    const focusSessionId =
      editorSessionId ?? currentEditorSessionIdRef.current ?? "editor-ready";
    lastSeenDocVersionRef.current = -1;
    editorReadyRef.current = true;
    setEditorReady(true);
    console.log("[handleEditorReady] editorReady=true, lastSeenDocVersion reset to -1, initializedRef=", initializedRef.current);
    if (initializedRef.current) {
      serverInjectionPendingRef.current = true;
      // A reload must hydrate from the newest snapshot acknowledged by RN,
      // not from the older server snapshot that originally opened the screen.
      const shouldFocusAtStart =
        shouldFocusInitialH1Ref.current
        && focusSessionId !== initialH1FocusedSessionRef.current;
      editorRef.current?.setMarkdown(
        contentRef.current || articleContentRef.current,
        { focusAtStart: shouldFocusAtStart },
      );
      editorRef.current?.setTitle(titleRef.current);
      if (shouldFocusAtStart) {
        initialH1FocusedSessionRef.current = focusSessionId;
      }
    }
  }, []);

  const requestCurrentEditorSnapshot = useCallback((): Promise<EditorTransitionSnapshot> => {
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

  const getEditorSnapshot = useCallback(async (): Promise<EditorTransitionSnapshot> => {
    // A native WebView reload rejects the request that belonged to the old
    // session. That is not an export failure: onReady rehydrates the newest RN
    // snapshot, so wait for the replacement session and request once more.
    return exportEditorTransitionSnapshot(requestCurrentEditorSnapshot);
  }, [requestCurrentEditorSnapshot]);

  const getEditorContent = useCallback(async (): Promise<string> => {
    const snapshot = await getEditorSnapshot();
    return snapshot.content;
  }, [getEditorSnapshot]);

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
      pending.resolve(createEditorTransitionSnapshot(
        persistableMarkdown,
        payload.title ?? titleRef.current,
        {
          docVersion: payload.docVersion,
          editorSessionId: payload.editorSessionId,
        },
      ));
    }
  }, [acceptEditorSnapshot]);

  const handleSave = useCallback(
    async (data: {
      title: string;
      content: string;
      expectedServerContent?: string;
      creationGeneration?: number;
    }) => {
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
              status: "NORMAL",
              createdAt: now,
              updatedAt: now,
            };
            const recordListSnapshot = snapshotRecordListCaches(queryClient);
            insertThoughtInRecordCache(queryClient, optimisticThought);
            const creatingThought = createThought
              .mutateAsync({
                data: {
                  clientId: thoughtCreationIdRef.current ?? createThoughtClientId(),
                  requestGeneration:
                    data.creationGeneration
                    ?? thoughtCreationGenerationRef.current,
                  content: data.content,
                  createdFrom: "direct",
                },
              })
              .then(async (created: Thought) => {
                if (!created.id) {
                  throw new Error("Thought creation did not return an id");
                }
                thoughtIdRef.current = created.id;
                if (localDraftExitedRef.current) {
                  await bindAutosaveEntityRef.current(created.id, `draft_${created.id}`);
                  return created.id;
                }
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
          const savedThought = await updateThought.mutateAsync({
            id: thoughtId,
            data: { content: data.content },
          });
          queryClient.setQueryData(
            getGetThoughtQueryKey(thoughtId),
            savedThought,
            { updatedAt: Date.now() },
          );
          if (
            savedThought.createdFrom === "question"
            && savedThought.status === "NORMAL"
          ) {
            upsertThoughtInRecordCaches(queryClient, savedThought);
            removeThoughtQuestionFromQueueCache(queryClient, thoughtId);
          } else {
            patchThoughtInRecordCaches(queryClient, thoughtId, savedThought);
          }
          void invalidateDirectThoughtCreation(queryClient);
          return {
            serverUpdatedAt: savedThought.updatedAt,
            serverContent: savedThought.content,
          };
        }
        const savedThought = queryClient.getQueryData<Thought>(
          getGetThoughtQueryKey(thoughtId),
        );
        return {
          serverUpdatedAt: savedThought?.updatedAt,
          serverContent: savedThought?.content ?? data.content,
        };
      } else if (modeRef.current === "dividing") {
        if (!id) return;
        if (!data.title.trim()) return;
        if (!data.content.trim()) {
          const error = new Error("A review article cannot be saved with an empty body");
          (error as Error & { autosaveConflict?: boolean }).autosaveConflict = true;
          throw error;
        }
        const pgs = splitContentToPages(data.content).map((p) => p.content);
        const savedArticle = await updateArticle.mutateAsync({
          id,
          data: {
            title: data.title,
            content: data.content,
            pages: pgs,
            expectedContent: data.expectedServerContent,
          },
        });
        queryClient.setQueryData(getGetArticleQueryKey(id), savedArticle, {
          updatedAt: Date.now(),
        });
        serverContentRef.current = savedArticle.content ?? data.content;
        patchArticleInRecordCaches(queryClient, id, {
          title: data.title,
          content: data.content,
          pages: pgs,
        });
        void invalidateArticleLists(queryClient);
        return {
          serverUpdatedAt: savedArticle.updatedAt,
          serverContent: savedArticle.content ?? data.content,
        };
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
    creationGeneration?: number;
  }) => {
    if (data.creationId) thoughtCreationIdRef.current = data.creationId;
    if (data.creationGeneration) {
      thoughtCreationGenerationRef.current = data.creationGeneration;
    }
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
    if (editorReadyRef.current) {
      editorRef.current?.setTitle(data.title);
      editorRef.current?.setMarkdown(data.content);
    }
  }, [isLocalDirectDraft, router]);

  const reviewRestoreContext = useMemo<AutoSaveRestoreContext | undefined>(() => {
    if (isLocalDirectDraft || !id) return undefined;
    if (detailResolution.kind !== "success") {
      return {
        ready: false,
        entityId: id,
        entityMode: "dividing",
        serverUpdatedAt: "",
        serverContent: "",
      };
    }
    if (detailResolution.entity === "thought") return undefined;
    return {
      ready: !!dividingArticle,
      entityId: id,
      entityMode: "dividing",
      serverUpdatedAt: dividingArticle?.updatedAt
        ? new Date(dividingArticle.updatedAt).toISOString()
        : "",
      serverContent: dividingArticle?.content ?? "",
    };
  }, [detailResolution, dividingArticle, id, isLocalDirectDraft]);

  const {
    markDirty,
    markTitleDirty,
    flush,
    retry: retryAutosave,
    reportFailure: reportAutosaveFailure,
    discard: discardAutosave,
    bindEntity: bindAutosaveEntity,
    persistLatest: persistLatestAutosave,
    prepareTransition: prepareAutosaveTransition,
    abortTransition: abortAutosaveTransition,
    commitTransition: commitAutosaveTransition,
    stageCleanup,
    runPendingCleanup,
  } = useAutoSave({
    onSave: handleSave,
    onCleanup: async (entityId) => {
      await deleteThought.mutateAsync({ id: entityId });
      void invalidateArticleLists(queryClient);
      void queryClient.invalidateQueries({ queryKey: getListThoughtsQueryKey() });
    },
    onRestore: handleAutosaveRestore,
    onRestoreConflict: () => {
      showToast({
        message: "기기에 남은 편집 내용과 서버 글의 기준이 달라 자동 복원을 멈췄습니다.",
        type: "error",
      });
    },
    onSaveSuccess: ({ entityId, entityMode, revision }) => {
      if (!entityId || !entityMode || !revision) return;
      trackDraftSaved({ entityId, entityMode, revision });
    },
    isRetryableError: (error) => {
      if ((error as { autosaveConflict?: unknown })?.autosaveConflict === true) {
        return false;
      }
      return (error as { status?: unknown })?.status !== 409;
    },
    creationId: thoughtCreationIdRef.current,
    creationGeneration: thoughtCreationGenerationRef.current,
    entityId: !isLocalDirectDraft ? id : undefined,
    entityMode: isThoughtMode ? "draft" : "dividing",
    restoreContext: reviewRestoreContext,
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
      const documentSnapshot = isThoughtModeRef.current
        ? createThoughtDocumentSnapshot(md, {
            docVersion: lastSeenDocVersionRef.current,
            editorSessionId: currentEditorSessionIdRef.current,
          }) ?? undefined
        : undefined;
      if (!isThoughtModeRef.current || isMeaningfulThoughtMarkdown(md)) {
        trackFirstMeaningfulEdit();
        markDirty(titleRef.current, md, documentSnapshot);
      } else {
        void discardAutosave();
      }
    },
    [discardAutosave, markDirty, trackFirstMeaningfulEdit],
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
      if (!_payload.isDirty) return;
      shouldFocusInitialH1Ref.current = false;

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
          resolve: (snapshot) => handleAutosaveExport(snapshot.content),
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
          resolve: (snapshot) => handleAutosaveExport(snapshot.content),
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

      markDirty(
        isThoughtModeRef.current ? "" : titleRef.current,
        latest,
        isThoughtModeRef.current
          ? createThoughtDocumentSnapshot(latest, {
              docVersion: lastSeenDocVersionRef.current,
              editorSessionId: currentEditorSessionIdRef.current,
            }) ?? undefined
          : undefined,
      );
      // The lifecycle boundary may outlive the short iOS suspension window.
      // Make the newest snapshot locally durable before waiting for network.
      await persistLatestAutosave();
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
  }, [
    discardAutosave,
    flush,
    getEditorContent,
    markDirty,
    persistLatestAutosave,
    reportAutosaveFailure,
  ]);

  const lifecycleFlushHandlerRef = useRef<(reason: "suspend" | "editor-blur") => void>(
    () => undefined,
  );
  lifecycleFlushHandlerRef.current = (reason) => {
    if (
      modeRef.current === "dividing"
      || !initializedRef.current
      || isNavigatingRef.current
    ) {
      return;
    }
    if (isThoughtModeRef.current) {
      void flushLatestEditorSnapshot();
      return;
    }
    if (reason !== "suspend") return;
    void (async () => {
      const latest = await getEditorContent();
      markDirty(titleRef.current, latest);
      await persistLatestAutosave();
      await flush();
    })();
  };
  const writingLifecycleRef = useRef<WritingLifecycleFlushCoordinator | null>(null);
  if (!writingLifecycleRef.current) {
    writingLifecycleRef.current = new WritingLifecycleFlushCoordinator(
      AppState.currentState as WritingAppState,
      (reason) => lifecycleFlushHandlerRef.current(reason),
    );
  }

  const handleTitleChange = useCallback(
    (text: string) => {
      trackFirstMeaningfulEdit();
      setTitle(text);
      titleRef.current = text;
      markTitleDirty(text, contentRef.current);
    },
    [markTitleDirty, trackFirstMeaningfulEdit],
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
          // Prefix measurements preserve the browser's real adjacent-margin
          // collapse and grouped list/quote DOM. Independent block boxes cannot
          // be summed to reproduce the visible document.
          blocks: blocks.slice(0, bi + 1),
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
      const prefixHeights: number[] = [];
      let allMeasured = true;
      for (let bi = 0; bi < blocks.length; bi++) {
        const h = blockHeights[`${PAGE_KEY_PREFIX}${p.pageIndex}_b_${bi}`];
        if (h === undefined) {
          allMeasured = false;
          break;
        }
        prefixHeights.push(h);
      }
      if (!allMeasured) {
        anyPending = true;
        continue;
      }
      const renderedHeight = prefixHeights.at(-1) ?? 0;
      const totalHeight = renderedHeight + pageContentHeight - availableContentHeight;
      const overflowBlockIdx = prefixHeights.findIndex(
        (height) => height > availableContentHeight + bodyLineHeight,
      );
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
  const engineMeasurementContextRef = useRef({
    typography,
    fontMode: nativeBodyFontMode,
  });
  engineMeasurementContextRef.current = {
    typography,
    fontMode: nativeBodyFontMode,
  };
  const engineResolveRef = useRef<{
    request: MeasureRequest;
    resolve: (heights: Record<string, number>) => void;
    reject: (error: Error) => void;
  } | null>(null);

  const measureEngine = useCallback(
    (candidates: MeasureCandidate[]): Promise<Record<string, number>> => {
      return new Promise((resolve, reject) => {
        const context = engineMeasurementContextRef.current;
        const request: MeasureRequest = {
          candidates,
          typography: context.typography,
          fontMode: context.fontMode,
        };
        engineResolveRef.current = { request, resolve, reject };
        setEngineRequest(request);
      });
    },
    [],
  );

  useEffect(() => {
    const pending = engineResolveRef.current;
    if (
      !pending
      || (
        pending.request.fontMode === nativeBodyFontMode
        && pending.request.typography === typography
      )
    ) return;
    engineResolveRef.current = null;
    setEngineRequest(null);
    pending.reject(new Error("DIVISION_MEASUREMENT_CONTEXT_CHANGED"));
  }, [nativeBodyFontMode, typography]);

  const handleEngineMeasured = useCallback((
    heights: Record<string, number>,
    measuredRequest: MeasureRequest,
  ) => {
    const pending = engineResolveRef.current;
    if (
      !pending ||
      pending.request !== measuredRequest ||
      measuredRequest.fontMode !== getNativeBodyFontMode()
    ) {
      if (pending?.request === measuredRequest) {
        engineResolveRef.current = null;
        setEngineRequest(null);
        pending.reject(new Error("DIVISION_MEASUREMENT_CONTEXT_CHANGED"));
      }
      return;
    }
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

  const navigateAfterRemovingGuard = useCallback((
    navigate: () => void,
    options?: { resumeGuardAfterRouteChange?: boolean },
  ) => {
    const generation = returnSessionRef.current.prepareExplicit(navigate);
    if (generation === null) return;
    pendingExplicitRef.current = {
      generation,
      resumeGuardAfterRouteChange: options?.resumeGuardAfterRouteChange === true,
    };
    setShouldPreventRemoval(false);
  }, []);

  // ── 모드 전환: 작성(thought) → 분할(article) ──────────────────────────────
  //
  // A saved thought needs one create response to obtain its id. After that,
  // promotion carries the current editor snapshot itself; it must not first
  // PATCH the thought and then wait for a second save round trip.
  const enterDividingMode = useCallback(async () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);

    editorRef.current?.blur();
    Keyboard.dismiss();
    setInlineMenuMode(null);
    addMenuPendingRef.current = false;

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

    let latestEditorSnapshot: EditorTransitionSnapshot;
    try {
      latestEditorSnapshot = await getEditorSnapshot();
    } catch {
      await reportAutosaveFailure();
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({ message: "최신 내용을 확인하지 못했습니다. 다시 시도해주세요.", type: "error" });
      return;
    }
    const cur = latestEditorSnapshot.markdown ?? latestEditorSnapshot.content;
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

    const thoughtSnapshot = createThoughtDocumentSnapshot(cur, {
      docVersion: latestEditorSnapshot.docVersion,
      editorSessionId: latestEditorSnapshot.editorSessionId,
    });
    const thoughtBody = thoughtSnapshot?.bodyMarkdown ?? "";
    const resolvedTitle = thoughtSnapshot?.title ?? "";
    if (!resolvedTitle || !thoughtBody.trim()) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({
        message: "첫 줄을 제목1로 작성하고, 아래에 본문을 적어주세요.",
        type: "info",
      });
      return;
    }

    let thoughtId = thoughtIdRef.current;
    if (!thoughtId) {
      // A direct local draft has no entity until its first meaningful save.
      // This is the only required preliminary round trip; promotion itself
      // still receives the exact snapshot exported above.
       markDirty("", cur, thoughtSnapshot ?? undefined);
      const createResult = await flush();
      if (!createResult.ok) {
        isNavigatingRef.current = false;
        setIsNavigating(false);
        showToast({ message: "저장이 완료되지 않았습니다. 다시 시도해주세요.", type: "error" });
        return;
      }
      thoughtId = thoughtIdRef.current;
    }
    if (!thoughtId) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({ message: "단상 ID를 확인하지 못했습니다. 다시 시도해주세요.", type: "error" });
      return;
    }

    const persistedThought = queryClient.getQueryData<Thought>(
      getGetThoughtQueryKey(thoughtId),
    );
    const previousPromotion = pendingPromotionSnapshotRef.current;
    const canRetryPromotion =
      previousPromotion?.entityId === thoughtId
      && previousPromotion.title === resolvedTitle
      && previousPromotion.content === thoughtBody;
    const prepared = await prepareAutosaveTransition({
      title: resolvedTitle,
      content: thoughtBody,
      documentSnapshot: thoughtSnapshot ?? undefined,
      serverUpdatedAt:
        (canRetryPromotion ? previousPromotion.expectedUpdatedAt : undefined)
        ?? persistedThought?.updatedAt
        ?? thought?.updatedAt,
      serverContent: persistedThought?.content ?? thought?.content ?? cur,
    });
    if (!prepared.ok) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({ message: "최신 내용을 안전하게 준비하지 못했습니다. 다시 시도해주세요.", type: "error" });
      return;
    }
    let transitionSnapshot: PendingStageTransition;
    if (canRetryPromotion) {
      transitionSnapshot = previousPromotion;
    } else {
      transitionSnapshot = {
        entityId: thoughtId,
        title: resolvedTitle,
        content: thoughtBody,
        titleMarkdown: thoughtSnapshot?.titleMarkdown ?? "",
        markdown: thoughtSnapshot?.markdown ?? cur,
        docVersion: thoughtSnapshot?.docVersion ?? 0,
        editorSessionId: thoughtSnapshot?.editorSessionId ?? "",
        expectedUpdatedAt: prepared.expectedServerUpdatedAt,
        requestId: createThoughtClientId(),
      };
      pendingPromotionSnapshotRef.current = transitionSnapshot;
    }

    // The recovery snapshot is durable now, so show the review surface before
    // waiting for the atomic promotion response. Keep the editor read-only
    // during this short identity handoff: autosave is still bound to the
    // thought id until the server returns the article id.
    titleRef.current = transitionSnapshot.title;
    setTitle(transitionSnapshot.title);
    contentRef.current = transitionSnapshot.content;
    articleContentRef.current = transitionSnapshot.content;
    setContent(transitionSnapshot.content);
    setDebouncedContent(transitionSnapshot.content);
    serverInjectionPendingRef.current = true;
    editorRef.current?.setTitle(transitionSnapshot.title);
    editorRef.current?.setOverflowProbeConfig(availableContentHeight);
    editorRef.current?.setMarkdown(transitionSnapshot.content);
    setRecordKindIntent("editing");
    setModeBoth("dividing");

    // The server validates and commits the title/body snapshot atomically.
    let promoted: Article;
    try {
      promoted = await promoteThought.mutateAsync({
        id: thoughtId,
        data: {
          title: transitionSnapshot.title,
          content: transitionSnapshot.content,
          expectedUpdatedAt: transitionSnapshot.expectedUpdatedAt,
          requestId: transitionSnapshot.requestId,
        } satisfies ThoughtArticleTransitionBody,
      });
    } catch (e) {
      abortAutosaveTransition();
      // The server still owns a thought, so restore the exact pre-transition
      // editor shape. The toast action retries through the same idempotent
      // request snapshot.
      titleRef.current = "";
      setTitle("");
      contentRef.current = cur;
      articleContentRef.current = "";
      setContent(cur);
      setDebouncedContent(cur);
      serverInjectionPendingRef.current = true;
      editorRef.current?.setTitle("");
      editorRef.current?.setMarkdown(cur);
      setRecordKindIntent("thought");
      setModeBoth("draft");
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({
        message: e instanceof Error ? e.message : "검토 단계로 옮기지 못했어요. 단상은 저장되어 있습니다.",
        type: "error",
        duration: 7000,
        action: {
          label: "다시 시도",
          onPress: () => retryPromotionRef.current?.(),
        },
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
    removeRecordFromCache(queryClient, { id: thoughtId, kind: "thought" });
    upsertArticleInRecordCaches(queryClient, {
      ...promoted,
      title: promotedTitle,
      content: promotedContent,
      status: "DIVIDING",
      pages: promoted.pages ?? [],
    });
    setRecordKindIntent("editing", { focusRecordId: promoted.id });

    // Update editor without remounting. The response is authoritative, but
    // normally matches the submitted snapshot exactly.
    titleRef.current = promotedTitle;
    setTitle(promotedTitle);
    contentRef.current = promotedContent;
    articleContentRef.current = promotedContent;
    setContent(promotedContent);
    setDebouncedContent(promotedContent);
    serverContentRef.current = promotedContent;
    isThoughtModeRef.current = false;
    serverInjectionPendingRef.current = true;
    editorRef.current?.setTitle(promotedTitle);
    editorRef.current?.setMarkdown(promotedContent);
    setModeBoth("dividing");
    await commitAutosaveTransition({
      entityId: promoted.id,
      storageKey: `draft_${promoted.id}`,
      entityMode: "dividing",
      title: promotedTitle,
      content: promotedContent,
      serverUpdatedAt: promoted.updatedAt,
      serverContent: promotedContent,
    });
    pendingPromotionSnapshotRef.current = null;
    isNavigatingRef.current = false;
    setIsNavigating(false);

    invalidateArticleLists(queryClient);
    queryClient.invalidateQueries({ queryKey: getListThoughtsQueryKey() });
    releaseDirectThoughtDraft();

    // 공간 컨텍스트를 AsyncStorage에 저장 — (tabs)/on.tsx 재개 시 on-01c가 복구할 수 있도록
    if (spaceId) {
      void AsyncStorage.setItem(
          `space_context:${promoted.id}`,
          JSON.stringify({
            spaceId,
            ...(spaceRoundId ? { spaceRoundId } : {}),
            ...(letterType ? { letterType } : {}),
          }),
        ).catch(() => undefined);
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
    }, { resumeGuardAfterRouteChange: true });
  }, [abortAutosaveTransition, commitAutosaveTransition, flush, getEditorContent, markDirty, prepareAutosaveTransition, promoteThought, queryClient, releaseDirectThoughtDraft, reportAutosaveFailure, router, setModeBoth, setRecordKindIntent, showToast, spaceId, spaceRoundId, thought, letterType, navigateAfterRemovingGuard]);
  retryPromotionRef.current = () => {
    void enterDividingMode();
  };

  // ── 검토(article) → 단상(thought) 역승격 ──────────────────────────────────
  const returnToThoughtMode = useCallback(async () => {
    if (isNavigatingRef.current) return;
    const articleId = id;
    if (!articleId || modeRef.current !== "dividing") return;

    isNavigatingRef.current = true;
    setIsNavigating(true);
    editorRef.current?.blur();
    Keyboard.dismiss();

    if (exportDebounceTimerRef.current) {
      clearTimeout(exportDebounceTimerRef.current);
      exportDebounceTimerRef.current = null;
    }
    exportPendingRef.current = false;

    let latestSnapshot: EditorTransitionSnapshot;
    try {
      latestSnapshot = await getEditorSnapshot();
    } catch {
      await reportAutosaveFailure();
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({ message: "최신 내용을 확인하지 못했습니다. 다시 시도해주세요.", type: "error" });
      return;
    }

    const latestTitle = latestSnapshot.title;
    const latestContent = latestSnapshot.content;
    const pendingSnapshot = pendingReverseSnapshotRef.current;
    const canRetryCommittedSnapshot =
      pendingSnapshot?.articleId === articleId &&
      pendingSnapshot.title === latestTitle &&
      pendingSnapshot.content === latestContent;

    const persistedArticle = queryClient.getQueryData<Article>(
      getGetArticleQueryKey(articleId),
    );
    // An unchanged retry reuses both the snapshot and request id so a response
    // lost after commit converges through the idempotent POST without PATCH.
    if (!canRetryCommittedSnapshot) {
      const prepared = await prepareAutosaveTransition({
        title: latestTitle,
        content: latestContent,
        serverUpdatedAt: persistedArticle?.updatedAt ?? dividingArticle?.updatedAt,
        serverContent: persistedArticle?.content ?? dividingArticle?.content ?? latestContent,
      });
      if (!prepared.ok) {
        isNavigatingRef.current = false;
        setIsNavigating(false);
        showToast({ message: "최신 내용을 안전하게 준비하지 못했습니다. 다시 시도해주세요.", type: "error" });
        return;
      }
      pendingReverseSnapshotRef.current = {
        articleId,
        title: latestTitle,
        content: latestContent,
        expectedUpdatedAt: prepared.expectedServerUpdatedAt,
        requestId: createThoughtClientId(),
      };
    } else {
      const prepared = await prepareAutosaveTransition({
        title: pendingSnapshot?.title ?? latestTitle,
        content: pendingSnapshot?.content ?? latestContent,
        serverUpdatedAt: pendingSnapshot?.expectedUpdatedAt,
        serverContent: persistedArticle?.content ?? dividingArticle?.content ?? latestContent,
      });
      if (!prepared.ok) {
        isNavigatingRef.current = false;
        setIsNavigating(false);
        showToast({ message: "최신 내용을 안전하게 준비하지 못했습니다. 다시 시도해주세요.", type: "error" });
        return;
      }
    }
    const transitionSnapshot = pendingReverseSnapshotRef.current;
    if (!transitionSnapshot) {
      abortAutosaveTransition();
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({ message: "전환 스냅샷을 확인하지 못했습니다. 다시 시도해주세요.", type: "error" });
      return;
    }
    stageArticleTransitionSnapshot(
      queryClient,
      articleId,
      {
        title: transitionSnapshot.title,
        content: transitionSnapshot.content,
        updatedAt:
          persistedArticle?.updatedAt
          ?? dividingArticle?.updatedAt
          ?? transitionSnapshot.expectedUpdatedAt,
      },
      persistedArticle ?? dividingArticle,
    );

    let restoredThought: Thought;
    try {
      restoredThought = await revertArticleToThought.mutateAsync({
        id: articleId,
        data: {
          title: transitionSnapshot.title,
          content: transitionSnapshot.content,
          expectedUpdatedAt: transitionSnapshot.expectedUpdatedAt,
          requestId: transitionSnapshot.requestId,
        } satisfies ThoughtArticleTransitionBody,
      });
    } catch (error) {
      abortAutosaveTransition();
      // The server may have committed before the response was lost. Keep the
      // exact snapshot so an unchanged retry calls the same idempotent POST.
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({
        message: error instanceof Error
          ? error.message
          : "단상으로 되돌리지 못했어요. 검토 내용은 그대로 저장되어 있습니다.",
        type: "error",
      });
      return;
    }

    pendingReverseSnapshotRef.current = null;
    await Promise.allSettled([
      queryClient.cancelQueries({ queryKey: getGetArticleQueryKey(articleId), exact: true }),
      queryClient.cancelQueries({ queryKey: getListThoughtsQueryKey() }),
    ]);
    queryClient.removeQueries({ queryKey: getGetArticleQueryKey(articleId), exact: true });
    removeRecordFromCache(queryClient, { id: articleId, kind: "editing" });
    queryClient.setQueryData(getGetThoughtQueryKey(restoredThought.id), restoredThought);
    insertThoughtInRecordCache(queryClient, restoredThought);
    titleRef.current = "";
    setTitle("");
    contentRef.current = restoredThought.content;
    setContent(restoredThought.content);
    setDebouncedContent(restoredThought.content);
    serverContentRef.current = restoredThought.content;
    articleContentRef.current = "";
    isThoughtModeRef.current = true;
    serverInjectionPendingRef.current = true;
    editorRef.current?.setTitle("");
    editorRef.current?.setMarkdown(restoredThought.content);
    setRecordKindIntent("thought");
    setModeBoth("draft");
    await commitAutosaveTransition({
      entityId: restoredThought.id,
      storageKey: `draft_${restoredThought.id}`,
      entityMode: "draft",
      title: "",
      content: restoredThought.content,
      serverUpdatedAt: restoredThought.updatedAt,
      serverContent: restoredThought.content,
    });

    thoughtIdRef.current = restoredThought.id;
    thoughtCreationIdRef.current = undefined;
    thoughtCreationGenerationRef.current = 1;
    isNavigatingRef.current = false;
    setIsNavigating(false);

    void Promise.allSettled([
      invalidateArticleLists(queryClient),
      invalidateThoughtLists(queryClient),
    ]);

    // Replacing the entity identity is an in-screen stage transition, not the
    // user's header/system-back intent.
    navigateAfterRemovingGuard(() => {
      router.replace({
        pathname: "/on-01a",
        params: {
          id: restoredThought.id,
          ...(source ? { source } : {}),
          ...(spaceId ? { spaceId, ...(spaceRoundId ? { spaceRoundId } : {}), ...(letterType ? { letterType } : {}) } : {}),
        },
      });
    }, { resumeGuardAfterRouteChange: true });
  }, [
    abortAutosaveTransition,
    commitAutosaveTransition,
    prepareAutosaveTransition,
    dividingArticle,
    getEditorSnapshot,
    id,
    letterType,
    navigateAfterRemovingGuard,
    queryClient,
    reportAutosaveFailure,
    revertArticleToThought,
    router,
    setModeBoth,
    setRecordKindIntent,
    showToast,
    source,
    spaceId,
    spaceRoundId,
  ]);

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
    try {
      // The local queue is the recovery boundary for this transition. Once it
      // is durable, the destination can open without waiting for the network.
      await persistLatestAutosave();
    } catch {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({ message: "최신 내용을 안전하게 보관하지 못했습니다. 다시 시도해주세요.", type: "error" });
      return;
    }

    if (!id) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      return;
    }

    const pagesJson = pgs.map((p) => p.content);
    // Mark this transition as self-initiated before the optimistic patch
    // below can trigger a re-render, so the very next render already
    // suppresses the "not-dividing" detail error the patch would otherwise
    // cause (this screen no longer sees its own article as DIVIDING).
    closingTransitionSuppressionRef.current.begin();
    stageArticleTransitionSnapshot(queryClient, id, {
      title: titleRef.current,
      content: cur,
      pages: pagesJson,
      layoutWidth: containerWidth,
      status: "CLOSING",
    }, article);

    setRecordKindIntent("editing");
    router.push({
      pathname: "/on-01c",
      params: {
        id,
        ...(spaceId ? { spaceId, ...(spaceRoundId ? { spaceRoundId } : {}), ...(letterType ? { letterType } : {}) } : {}),
      },
    });
    isNavigatingRef.current = false;
    setIsNavigating(false);

    // Save and status transition retain their server-side order, but both
    // continue after the closing screen is visible. A failure leaves the
    // optimistic CLOSING snapshot and the recovery queue intact for retry.
    void (async () => {
      let saved = false;
      try {
        const flushResult = await flush();
        saved = flushResult.ok;
      } catch (e: unknown) {
        console.warn("[on-01] background review save failed:", e);
      }
      if (!saved) {
        showToast({
          message: "최신 검토 내용을 저장하지 못했어요. 잠시 후 다시 시도해주세요.",
          type: "error",
          duration: 7000,
          action: {
            label: "다시 시도",
            onPress: () => {
              void retryAutosave();
            },
          },
        });
        return;
      }

      try {
        const layoutWidthAlreadySaved = savedLayoutWidthRef.current === containerWidth;
        if (!layoutWidthAlreadySaved) {
          await updateArticle.mutateAsync({ id, data: { layoutWidth: containerWidth } });
          savedLayoutWidthRef.current = containerWidth;
        }
        if (article?.status !== "CLOSING") {
          const transitioned = await transitionStatus.mutateAsync({
            id,
            data: { targetStatus: TransitionArticleBodyTargetStatus.CLOSING },
          });
          queryClient.setQueryData(getGetArticleQueryKey(id), (previous: unknown) => {
            if (!previous || typeof previous !== "object") return transitioned;
            return { ...previous, ...transitioned, status: "CLOSING" };
          });
          patchArticleInRecordCaches(queryClient, id, { status: "CLOSING" });
        }
        void invalidateArticleLists(queryClient);
      } catch (e: unknown) {
        const status = (e as { status?: number } | null)?.status;
        if (status !== 400) {
          console.warn("[on-01] background CLOSING transition failed:", e);
          showToast({
            message: "마감 단계 저장은 완료했지만 상태 전환에 실패했어요. 다시 시도해주세요.",
            type: "error",
            duration: 7000,
            action: {
              label: "다시 시도",
              onPress: () => {
                void transitionStatus.mutateAsync({
                  id,
                  data: { targetStatus: TransitionArticleBodyTargetStatus.CLOSING },
                }).then((transitioned) => {
                  queryClient.setQueryData(getGetArticleQueryKey(id), (previous: unknown) => {
                    if (!previous || typeof previous !== "object") return transitioned;
                    return { ...previous, ...transitioned, status: "CLOSING" };
                  });
                  patchArticleInRecordCaches(queryClient, id, { status: "CLOSING" });
                  void invalidateArticleLists(queryClient);
                }).catch(() => undefined);
              },
            },
          });
        }
      }
    })();
  }, [getEditorContent, markDirty, flush, persistLatestAutosave, retryAutosave, id, router, updateArticle, transitionStatus, queryClient, containerWidth, article, setRecordKindIntent, showToast, pageHeights, pageContentHeight]);

  // ── 작성/분할 모드 뒤로가기 (화면 종료) ───────────────────────────────────
  //
  // Both draft and dividing modes exit the screen via this single handler.
  // There is no "exit dividing back to draft" transition — once promoted to
  // DIVIDING the article stays there.
  const exitToPreviousList = useCallback((removalAction?: NavigationAction) => {
    isNavigatingRef.current = true;
    setIsNavigating(true);
    // Only pop if this screen was pushed from the tab navigator. A restored
    // route or a quote opened from another detail screen can have a different
    // root-stack predecessor; exposing that predecessor is not a "back to
    // list" action, so use the route-specific safe fallback instead.
    const state = navigation.getState();
    const previousRoute = state?.routes[state.index - 1];
    const canPopToList = router.canGoBack() && previousRoute?.name === "(tabs)";

    releaseDirectThoughtDraft();
    if (canPopToList && removalAction) {
      // usePreventRemove annotates the prevented action with the route it has
      // already visited. Replaying that exact action admits the completed iOS
      // gesture once without disabling the guard or scheduling a second pop.
      returnSessionRef.current.commitIntercepted(removalAction, (action) => {
        navigation.dispatch(action);
      });
      return;
    }

    navigateAfterRemovingGuard(() => {
      if (canPopToList) {
        router.back();
        return;
      }

      router.replace(source === "quote" ? "/(tabs)/archive" : "/(tabs)/on");
    });
  }, [navigation, releaseDirectThoughtDraft, router, source, navigateAfterRemovingGuard]);

  const handleDraftBack = useCallback(async (removalAction?: NavigationAction) => {
    if (isNavigatingRef.current || !returnSessionRef.current.begin()) return;
    setRecordKindIntent(modeRef.current === "draft" ? "thought" : "editing");
    isNavigatingRef.current = true;
    setIsNavigating(true);

    editorRef.current?.blur();
    Keyboard.dismiss();

    if (exportDebounceTimerRef.current) {
      clearTimeout(exportDebounceTimerRef.current);
      exportDebounceTimerRef.current = null;
    }
    exportPendingRef.current = false;
    let cur: string;
    try {
      cur = await getEditorContent();
    } catch {
      returnSessionRef.current.retry();
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
    const hasMeaningfulThought = isThoughtModeRef.current && isMeaningfulThoughtMarkdown(cur);

    if (isThoughtModeRef.current && !hasMeaningfulThought) {
      localDraftExitedRef.current = isLocalDirectDraft;
      try {
        // Keep an empty, entity-bound recovery snapshot until server cleanup
        // succeeds. This prevents a failed fire-and-forget DELETE from becoming
        // an unrecoverable orphan after the screen unmounts.
        await stageCleanup(thoughtIdRef.current ?? id);
      } catch {
        returnSessionRef.current.retry();
        isNavigatingRef.current = false;
        setIsNavigating(false);
        showToast({ message: "빈 단상 정리 상태를 보관하지 못했습니다. 다시 시도해주세요.", type: "error" });
        return;
      }
      const deleteSavedThought = async (savedThoughtId: string | undefined) => {
        if (!savedThoughtId) return;
        const result = await runPendingCleanup(savedThoughtId);
        if (!result.ok) {
          showToast({ message: "빈 단상 삭제에 실패했습니다. 다음에 다시 정리할 수 있도록 보관했어요.", type: "error" });
        }
      };
      const pendingCreate = createThoughtPromiseRef.current;
      if (pendingCreate) {
        void pendingCreate.then(deleteSavedThought, () => undefined);
      } else {
        void deleteSavedThought(thoughtIdRef.current);
      }
      exitToPreviousList(removalAction);
      return;
    }

    markDirty(isThoughtModeRef.current ? "" : titleRef.current, cur);
    try {
      await persistLatestAutosave();
    } catch {
      returnSessionRef.current.retry();
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({ message: "최신 내용을 안전하게 보관하지 못했습니다. 다시 시도해주세요.", type: "error" });
      return;
    }
    void flush().then((result) => {
      if (!result.ok) {
        showToast({ message: "저장에 실패했습니다. 다시 시도할 수 있도록 내용을 보관했어요.", type: "error" });
      }
    });

    // Update list/detail caches immediately from the locally durable snapshot.
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
    void invalidateArticleLists(queryClient);
    if (isThoughtModeRef.current) {
      void queryClient.invalidateQueries({ queryKey: getListThoughtsQueryKey() });
    }
    exitToPreviousList(removalAction);
  }, [flush, queryClient, getEditorContent, markDirty, id, setRecordKindIntent, showToast, isLocalDirectDraft, exitToPreviousList, persistLatestAutosave, stageCleanup, runPendingCleanup]);

  // Native lifecycle events only persist the editor. They never begin or
  // commit a guarded return session, so app switching and system overlays
  // cannot approve a native removal action.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      writingLifecycleRef.current?.handleAppStateChange(
        nextState as WritingAppState,
      );
    });
    return () => {
      sub.remove();
      writingLifecycleRef.current?.dispose();
    };
  }, []);

  // A direct draft owns the shared composer lock until this writing screen
  // exits. This cleanup also covers auth resets and programmatic navigation;
  // setParams keeps the same screen mounted, so persisting a local draft does
  // not prematurely release the lock.
  useEffect(() => {
    return () => releaseDirectThoughtDraft();
  }, [releaseDirectThoughtDraft]);

  // ── 헤더/하드웨어 뒤로가기 통합 ────────────────────────────────────────────
  const handleHeaderBack = useCallback((removalAction?: NavigationAction) => {
    if (spellTabVisible) {
      // An apply round trip in flight must finish (and its state advance
      // must land) before back/close is allowed to reset spell review state
      // out from under it — see handleCloseSpellTab.
      if (spellApplyInFlightRef.current) return;
      editorRef.current?.clearSpellHighlight();
      setSpellTabVisible(false);
      setSpellState({ status: "idle" });
      spellAppliedCountRef.current = {};
      spellFailureCountRef.current = 0;
      return;
    }
    handleDraftBack(removalAction);
  }, [spellTabVisible, handleDraftBack]);

  // Keep the native edge-swipe, browser history back, and header button on
  // the same asynchronous save/delete path. usePreventRemove is required for
  // Native Stack: a bare beforeRemove listener is not reliable for iOS edge
  // gestures. A repeat removal while save/delete is in progress stays blocked.
  const handlePreventedRemoval = useCallback(({ data }: { data: { action: NavigationAction } }) => {
    if (!initializedRef.current) {
      if (!returnSessionRef.current.begin()) return;
      exitToPreviousList(data.action);
      return;
    }
    handleHeaderBack(data.action);
  }, [handleHeaderBack, exitToPreviousList]);

  usePreventRemove(shouldPreventRemoval, handlePreventedRemoval);

  // usePreventRemove updates the native-stack removal guard after render.
  // Dispatch intentional route changes on the following turn so stage
  // replaces and completed exits are admitted exactly once.
  useEffect(() => {
    const pending = pendingExplicitRef.current;
    if (shouldPreventRemoval || !pending) return;
    pendingExplicitRef.current = null;
    const timer = setTimeout(() => {
      const consumed = returnSessionRef.current.consumeExplicit(pending.generation);
      if (
        consumed
        && pending.resumeGuardAfterRouteChange
        && returnSessionRef.current.resetAfterRouteChange()
      ) {
        isNavigatingRef.current = false;
        setIsNavigating(false);
        setShouldPreventRemoval(true);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [shouldPreventRemoval]);

  useEffect(() => {
    return () => {
      returnSessionRef.current.dispose();
      pendingExplicitRef.current = null;
    };
  }, []);

  const handleDismissKeyboard = useCallback(() => {
    dismissEditorKeyboard({
      blurEditor: () => editorRef.current?.blur(),
      dismissNativeKeyboard: () => Keyboard.dismiss(),
    });
    if (
      isThoughtModeRef.current
      && modeRef.current === "draft"
      && initializedRef.current
      && !isNavigatingRef.current
    ) {
      writingLifecycleRef.current?.handleEditorBlur();
    }
  }, []);

  const handleKeyboardVisibilityChange = useCallback((visible: boolean) => {
    setEditorKeyboardState((current) =>
      reduceEditorKeyboardState(current, { type: "editorFocus", focused: visible }),
    );
    // Native keyboard events above remain authoritative for closing. A
    // transient WKWebView focusout must not hide a toolbar while the keyboard
    // is still visible.
    if (visible) {
      writingLifecycleRef.current?.handleEditorFocus();
    } else if (
      isThoughtModeRef.current
      && modeRef.current === "draft"
      && initializedRef.current
      && !isNavigatingRef.current
    ) {
      writingLifecycleRef.current?.handleEditorBlur();
    }
  }, []);

  const handleInsertDivider = useCallback(() => {
    if (isNavigatingRef.current) return;
    editorRef.current?.insertDivider();
  }, []);

  const handleShiftEnter = useCallback(() => {
    if (isNavigatingRef.current) return;
    editorRef.current?.insertHardBreak();
  }, []);

  const handleSelectionUpdate = useCallback((payload: OnSelectionUpdatePayload) => {
    setSelectionState(payload);
  }, []);

  // "본문" 버튼 — 블록 타입 인라인 패널 토글 (read.tsx와 동일 동작)
  const handleToolbarFormat = useCallback(() => {
    if (isNavigatingRef.current) return;
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
    if (isNavigatingRef.current) return;
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
    if (isNavigatingRef.current) return;
    editorRef.current?.blur();
    Keyboard.dismiss();
    setInlineMenuMode("quotePicker");
  }, []);

  const handleSelectQuoteSentence = useCallback((sentence: StoredSentence) => {
    if (isNavigatingRef.current) return;
    const quote = buildStoredSentenceQuote(sentence);
    editorRef.current?.insertQuote(quote.text, quote.attribution);
    closePanelRestoreKeyboard();
  }, [closePanelRestoreKeyboard]);

  const handleOnFormat = useCallback((type: FormatType) => {
    if (isNavigatingRef.current) return;
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

      const divideAndVerify = async (
        units: string[],
        threshold: number,
        correctionDepth: number,
      ): Promise<string[]> => {
        // Division units preserve an entire list/quote block and every authored
        // blank paragraph. Ordinary paragraphs have zero top margin, while
        // headings and blockquotes are force-started on a new page by runGreedy.
        const paraCandidates: MeasureCandidate[] = units.map((p, i) => ({
          key: `para_${correctionDepth}_${i}`,
          content: p,
        }));
        const paraHeightMap = await measureEngine(paraCandidates);
        const paraHeights: Record<number, number> = {};
        units.forEach((_, i) => {
          paraHeights[i] = paraHeightMap[`para_${correctionDepth}_${i}`] ?? 0;
        });

        const initialJobs = simulateGreedyJobs(units, paraHeights, threshold);
        const splitResults: Record<number, BSResult[]> = {};
        let pendingJobs: BSJob[] = initialJobs;

        while (pendingJobs.length > 0) {
          const candidates: MeasureCandidate[] = [];
          for (const job of pendingJobs) {
            for (const c of bsCandidatesForJob(job)) {
              candidates.push({
                key: bsCandidateKey(job.paraIdx, job.wordOffset, c.count),
                content: formatBsCandidateForMeasurement(
                  units[job.paraIdx] ?? "",
                  job.wordOffset,
                  c.content,
                ),
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
                targetH: threshold,
              });
            }
          }
          pendingJobs = nextPending;
        }

        const output = runGreedy(units, paraHeights, splitResults, threshold);
        const finalCandidates = output.map((content, index) => ({
          key: `final_${correctionDepth}_${index}`,
          content,
        }));
        const finalHeights = await measureEngine(finalCandidates);
        const corrected: string[] = [];

        for (let index = 0; index < output.length; index++) {
          const page = output[index];
          const actualHeight =
            finalHeights[`final_${correctionDepth}_${index}`] ?? 0;
          if (actualHeight <= splitThreshold + 0.5) {
            corrected.push(page);
            continue;
          }
          if (correctionDepth >= 4) {
            throw new Error("DIVISION_UNSPLITTABLE_OVERFLOW");
          }

          // Candidate chunks can change height after emphasis balancing and
          // final Markdown recomposition. Re-run only the overflowing page with
          // a reduced budget based on its measured excess, then verify again.
          const excess = actualHeight - splitThreshold;
          const nextThreshold = Math.max(
            splitThreshold * 0.5,
            threshold - Math.max(excess + 1, threshold * 0.05),
          );
          const pageUnits = splitPageContentForDivision(page);
          const splitPages = await divideAndVerify(
            pageUnits,
            nextThreshold,
            correctionDepth + 1,
          );
          corrected.push(...splitPages);
        }
        return corrected;
      };

      return divideAndVerify(paragraphs, splitThreshold, 0);
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
    if (splittingRef.current) return;
    splittingRef.current = true;
    setSplitting(true);
    editorRef.current?.setEditable(false);
    try {
      const cur = await getEditorContent();
      const rawPages = splitPageContentsLosslessly(cur);
      const targets = [...overflowPageIndices]
        .filter((i) => i >= 0 && i < rawPages.length)
        .sort((a, b) => b - a);
      if (targets.length === 0) {
        showToast({ message: "분량을 초과하는 페이지가 없어요.", type: "info" });
        return;
      }
      const next = [...rawPages];
      let appliedAny = false;
      for (const idx of targets) {
        const paragraphs = splitPageContentForDivision(next[idx]);
        if (paragraphs.length < 1) continue;
        const out = await runDivisionEngine(paragraphs);
        if (
          out
          && out.length > 0
          && (out.length > 1 || out[0].trim() !== next[idx].trim())
        ) {
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
      const latest = await getEditorContent();
      if (latest !== cur) {
        showToast({
          message: "분할 중 본문이 바뀌어 결과를 적용하지 않았어요. 다시 시도해 주세요.",
          type: "info",
        });
        return;
      }
      applyEngineResult(next);
    } catch (error) {
      if (
        error instanceof Error
        && (
          error.message === "DIVISION_UNSPLITTABLE_OVERFLOW"
          || error.message === "DIVISION_MEASUREMENT_CONTEXT_CHANGED"
        )
      ) {
        showToast({
          message: error.message === "DIVISION_MEASUREMENT_CONTEXT_CHANGED"
            ? "글꼴 준비 상태가 바뀌어 분할을 중단했어요. 다시 시도해 주세요."
            : "이 페이지는 자동으로 안전하게 나눌 수 없어요. 본문을 직접 편집해 주세요.",
          type: "info",
        });
        return;
      }
      throw error;
    } finally {
      splittingRef.current = false;
      setSplitting(false);
    }
  }, [overflowPageIndices, getEditorContent, runDivisionEngine, applyEngineResult, showToast]);

  const handleSplitPage = useCallback(
    async (pageIndex: number) => {
      if (splittingRef.current) return;
      splittingRef.current = true;
      setSplitting(true);
      editorRef.current?.setEditable(false);
      try {
        const cur = await getEditorContent();
        const rawPages = splitPageContentsLosslessly(cur);
        if (pageIndex < 0 || pageIndex >= rawPages.length) return;
        const paragraphs = splitPageContentForDivision(rawPages[pageIndex]);
        if (paragraphs.length < 2) {
          showToast({ message: "이 페이지에는 나눌 수 있는 단락이 부족해요.", type: "info" });
          return;
        }
        const out = await runDivisionEngine(paragraphs);
        if (out) {
          const latest = await getEditorContent();
          if (latest !== cur) {
            showToast({
              message: "분할 중 본문이 바뀌어 결과를 적용하지 않았어요. 다시 시도해 주세요.",
              type: "info",
            });
            return;
          }
          const before = rawPages.slice(0, pageIndex);
          const after = rawPages.slice(pageIndex + 1);
          const newPages = [...before, ...out, ...after];
          applyEngineResult(newPages);
        }
      } catch (error) {
        if (
          error instanceof Error
          && (
            error.message === "DIVISION_UNSPLITTABLE_OVERFLOW"
            || error.message === "DIVISION_MEASUREMENT_CONTEXT_CHANGED"
          )
        ) {
          showToast({
            message: error.message === "DIVISION_MEASUREMENT_CONTEXT_CHANGED"
              ? "글꼴 준비 상태가 바뀌어 분할을 중단했어요. 다시 시도해 주세요."
              : "이 페이지는 자동으로 안전하게 나눌 수 없어요. 본문을 직접 편집해 주세요.",
            type: "info",
          });
          return;
        }
        throw error;
      } finally {
        splittingRef.current = false;
        setSplitting(false);
      }
    },
    [getEditorContent, runDivisionEngine, applyEngineResult, showToast],
  );

  const handleMergeWithPrevious = useCallback(
    async (pageIndex: number) => {
      if (pageIndex <= 0) return;
      const cur = await getEditorContent();
      const parts = splitPageContentsLosslessly(cur);
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
    if (spellCheckInFlightRef.current) return;
    spellCheckInFlightRef.current = true;
    setSpellTabVisible(true);
    setSpellState({ status: "loading" });
    spellAppliedCountRef.current = {};
    spellFailureCountRef.current = 0;
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
    } finally {
      spellCheckInFlightRef.current = false;
    }
  }, [getEditorContent]);

  const handleSpellSkip = useCallback(() => {
    if (spellApplyInFlightRef.current) return;
    setSpellState((prev) => {
      if (prev.status !== "reviewing") return prev;
      const next = prev.index + 1;
      if (next >= prev.items.length) {
        editorRef.current?.clearSpellHighlight();
        return { status: "done", hadFailures: spellFailureCountRef.current > 0 };
      }
      const nextItem = prev.items[next];
      const baseIdx = prev.occurrenceIndices[next];
      const applied = spellAppliedCountRef.current[nextItem.original] ?? 0;
      const effectiveIdx = Math.max(0, baseIdx - applied);
      editorRef.current?.setSpellHighlight(nextItem.original, nextItem.context ?? "", effectiveIdx);
      return { status: "reviewing", items: prev.items, index: next, occurrenceIndices: prev.occurrenceIndices };
    });
  }, []);

  // applySpellFix() is a real WebView round trip (task #912): the fix is only
  // real once the WebView confirms it found and replaced the match. A resolved
  // false must not be treated like a success — occurrence bookkeeping must not
  // advance, and the user needs to know that item still needs a manual edit.
  const handleSpellApply = useCallback(async () => {
    if (spellApplyInFlightRef.current) return;
    if (spellState.status !== "reviewing") return;
    const { items, index, occurrenceIndices } = spellState;
    const item = items[index];
    const appliedSoFar = spellAppliedCountRef.current[item.original] ?? 0;
    const baseIdx = occurrenceIndices[index];
    const effectiveIdx = Math.max(0, baseIdx - appliedSoFar);

    // The lock/busy flag must stay held through the WebView round trip, the
    // post-apply content sync, AND the state advance below — releasing it
    // right after the round trip (as an earlier version of this fix did)
    // re-enables "적용" while this closure still targets the just-reviewed
    // item, so a fast second tap can land on — and corrupt — the NEXT
    // occurrence of the same original text before this one finishes.
    spellApplyInFlightRef.current = true;
    setSpellApplyBusy(true);
    try {
      const applied = (await editorRef.current?.applySpellFix(
        item.original,
        item.replacement,
        item.context ?? "",
        effectiveIdx,
      )) ?? false;

      if (applied) {
        spellAppliedCountRef.current = {
          ...spellAppliedCountRef.current,
          [item.original]: appliedSoFar + 1,
        };
        // Sync contentRef right away instead of trusting only the WebView's own
        // debounced onChange export — a "검토 완료" followed immediately by
        // leaving/saving the screen must not race that debounce and lose the
        // fix that was just applied.
        try {
          const latest = await getEditorContent();
          markDirty(titleRef.current, latest);
        } catch {
          // Ignored here — flushLatestEditorSnapshot() retries on the next
          // save/navigation boundary.
        }
      } else {
        spellFailureCountRef.current += 1;
        showToast({
          message: "이 항목은 자동으로 반영하지 못했어요. 직접 고쳐주세요.",
          type: "error",
        });
      }

      setSpellState((prev) => {
        if (prev.status !== "reviewing" || prev.items !== items || prev.index !== index) {
          return prev;
        }
        const next = prev.index + 1;
        if (next >= prev.items.length) {
          editorRef.current?.clearSpellHighlight();
          return { status: "done", hadFailures: spellFailureCountRef.current > 0 };
        }
        const nextItem = prev.items[next];
        const nextBase = prev.occurrenceIndices[next];
        const nextApplied = spellAppliedCountRef.current[nextItem.original] ?? 0;
        const nextEffective = Math.max(0, nextBase - nextApplied);
        editorRef.current?.setSpellHighlight(nextItem.original, nextItem.context ?? "", nextEffective);
        return { status: "reviewing", items: prev.items, index: next, occurrenceIndices: prev.occurrenceIndices };
      });
    } finally {
      spellApplyInFlightRef.current = false;
      setSpellApplyBusy(false);
    }
  }, [spellState, getEditorContent, markDirty, showToast]);

  const handleCloseSpellTab = useCallback(() => {
    // Also block while an apply round trip is in flight — closing mid-apply
    // would let its eventual resolution mutate state for a review session
    // that the user already dismissed.
    if (spellCheckInFlightRef.current || spellApplyInFlightRef.current) return;
    editorRef.current?.clearSpellHighlight();
    setSpellTabVisible(false);
    setSpellState({ status: "idle" });
    spellAppliedCountRef.current = {};
    spellFailureCountRef.current = 0;
  }, []);

  const stageMenuDisabled =
    isNavigating || splitting || spellState.status === "loading";
  // Stage transitions keep their synchronous duplicate-input lock, but route
  // changes must not turn the stage label into a network progress spinner.
  // Only work that intentionally stays on this screen (split/spellcheck) is
  // represented as busy.
  const stageMenuBusy = splitting || spellState.status === "loading";
  const stageMenuActions: WritingStageAction[] = mode === "dividing"
    ? [
        {
          label: "단상 단계로",
          onPress: () => void returnToThoughtMode(),
          disabled: isNavigating,
          directionIcon: "leading",
        },
        {
          label: "자동 분할",
          onPress: () => void handleAutoSplit(),
          disabled: isNavigating || splitting,
          busy: splitting,
        },
        {
          label: "맞춤법 검사",
          onPress: () => void handleRunSpellCheck(),
          disabled: isNavigating || spellCheckInFlightRef.current,
          busy: spellState.status === "loading",
        },
        {
          label: "마감 단계로",
          onPress: () => void handleNextToClosing(),
          disabled: isNavigating || splitting || spellCheckInFlightRef.current,
          directionIcon: "trailing",
        },
      ]
    : [
        {
          label: "검토 단계로",
          onPress: () => void enterDividingMode(),
          disabled: isNavigating,
          directionIcon: "trailing",
        },
      ];

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

  // A direct entry into an unactivated queued question is redirected through
  // the same activation the question-queue screen uses (never opened as a
  // plain thought edit). The endpoint is idempotent for an already-activated
  // thought, so a race with the queue screen's own activation is harmless.
  //
  // Only a *confirmed* 404/409 from the activate endpoint means the question
  // genuinely no longer exists / isn't queued anymore — that's the only case
  // honest enough to tell the user it's gone and send them back to the list.
  // A network blip, timeout, 5xx, or expired session is not that: those get
  // a few bounded auto-retries (matching the detail-query policy), and if
  // still failing, a retry-capable error state instead of a false "it's
  // gone" message.
  const runQuestionActivationRef = useRef<() => void>(() => {});
  const [questionActivationFailed, setQuestionActivationFailed] = useState(false);
  const isRunningQuestionActivationRef = useRef(false);

  runQuestionActivationRef.current = () => {
    if (!id || isRunningQuestionActivationRef.current) return;
    isRunningQuestionActivationRef.current = true;
    questionActivationRef.current = id;
    setQuestionActivationFailed(false);

    (async () => {
      let attempt = 0;
      for (;;) {
        const cacheSnapshot = snapshotRecordListCaches(queryClient);
        try {
          await Promise.all([
            queryClient.cancelQueries({ queryKey: getListThoughtsQueryKey() }),
            queryClient.cancelQueries({ queryKey: getGetThoughtQuestionQueueQueryKey() }),
          ]);
          const result = await activateThoughtQuestion.mutateAsync({ id });
          setThoughtQuestionQueueCache(queryClient, result);
          upsertThoughtInRecordCaches(queryClient, result.activatedThought);
          queryClient.setQueryData(getGetThoughtQueryKey(id), result.activatedThought);
          isRunningQuestionActivationRef.current = false;
          return;
        } catch (error) {
          restoreRecordListCaches(queryClient, cacheSnapshot);

          if (isConfirmedGoneError(error)) {
            isRunningQuestionActivationRef.current = false;
            showToast({ message: "이미 사라진 질문이에요. 목록으로 돌아갈게요.", type: "error" });
            if (returnSessionRef.current.begin()) {
              exitToPreviousList();
            }
            return;
          }

          if (attempt < 2 && isRetryableDetailError(error)) {
            const delay = detailQueryRetryDelayMs(attempt);
            attempt += 1;
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          // Terminal, but not confirmed-gone (connection problem or expired
          // session): let the user retry instead of bouncing them away.
          isRunningQuestionActivationRef.current = false;
          questionActivationRef.current = null;
          setQuestionActivationFailed(true);
          return;
        }
      }
    })();
  };

  useEffect(() => {
    if (!isUnactivatedQuestion || !id) return;
    if (questionActivationRef.current === id) return;
    runQuestionActivationRef.current();
  }, [isUnactivatedQuestion, id]);

  if (isUnactivatedQuestion) {
    return (
      <>
        <Stack.Screen options={{ gestureEnabled: true }} />
        <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
          <View style={styles.loadingContainer}>
            {questionActivationFailed ? (
              <>
                <Feather name="alert-circle" size={30} color={Colors.zinc500} />
                <Text style={styles.loadErrorTitle}>질문을 여는 데 문제가 있어요</Text>
                <Text style={styles.loadErrorDescription}>
                  네트워크 연결을 확인하거나 로그인 상태를 확인한 뒤 다시 시도해주세요.
                </Text>
                <View style={styles.loadErrorActions}>
                  <ScalePressable
                    style={styles.loadRetryButton}
                    contentStyle={styles.loadRetryButtonContent}
                    onPress={() => runQuestionActivationRef.current()}
                  >
                    <Text style={styles.loadRetryButtonText}>다시 시도</Text>
                  </ScalePressable>
                  <ScalePressable
                    style={styles.loadBackButton}
                    contentStyle={styles.loadBackButtonContent}
                    onPress={() => {
                      if (!returnSessionRef.current.begin()) return;
                      exitToPreviousList();
                    }}
                  >
                    <Text style={styles.loadBackButtonText}>이전 화면</Text>
                  </ScalePressable>
                </View>
              </>
            ) : (
              <>
                <ActivityIndicator size="large" color={Colors.zinc400} />
                <Text style={styles.loadingText}>질문을 준비하고 있어요</Text>
              </>
            )}
          </View>
        </View>
      </>
    );
  }

  if ((!isLocalDirectDraft && !id) || dataLoading) {
    return (
      <>
        <Stack.Screen options={{ gestureEnabled: true }} />
        <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.zinc400} />
            <Text style={styles.loadingText}>단상을 준비하고 있어요</Text>
          </View>
        </View>
      </>
    );
  }

  const detailError = !isLocalDirectDraft && detailResolution.kind === "error" ? detailResolution : null;

  if (detailError) {
    const errorCopy = DETAIL_ERROR_COPY[detailError.reason];
    return (
      <>
        <Stack.Screen options={{ gestureEnabled: true }} />
        <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
          <View style={styles.loadingContainer}>
            <Feather name="alert-circle" size={30} color={Colors.zinc500} />
            <Text style={styles.loadErrorTitle}>{errorCopy.title}</Text>
            <Text style={styles.loadErrorDescription}>{errorCopy.description}</Text>
            <View style={styles.loadErrorActions}>
              <ScalePressable
                style={styles.loadRetryButton}
                contentStyle={styles.loadRetryButtonContent}
                onPress={() => {
                  if (detailError.retryEntity === "thought") {
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
                onPress={() => {
                  if (!returnSessionRef.current.begin()) return;
                  exitToPreviousList();
                }}
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
  const toolbarContract = resolveMemoToolbarRenderContract({
    platform: Platform.OS,
    isNavigating,
    editorContext: isReadingMemoContext ? "readingMemo" : "record",
    selectionIsHorizontalRule: selectionState.activeBlock === "horizontalRule",
    keyboard: editorKeyboardState,
    inlineMenuOpen: inlineMenuMode !== null,
    keyboardRestorePending,
  });
  const editorBottomVisibility = resolveEditorBottomVisibility({
    basePadding: WRITING_EDITOR_BOTTOM_PADDING,
    toolbarVisible:
      toolbarContract.visible && toolbarContract.placement === "floating",
    toolbarOccupiedHeight: MEMO_TOOLBAR_OCCUPIED_HEIGHT,
  });

  const memoToolbar = (
    <MemoToolbar
      mode={toolbarContract.mode}
      onDismissKeyboard={handleDismissKeyboard}
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
  );

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: true }} />
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
        <View style={styles.header} pointerEvents="box-none">
          <HeaderButton
            variant="back"
            onPress={() => handleHeaderBack()}
            disabled={isNavigating}
            accessibilityLabel="기록 목록으로 돌아가기"
          />
          <View style={styles.headerRight}>
            <WritingStateBar
              current={isDividing ? "DIVIDING" : "DRAFT"}
              actions={stageMenuActions}
              disabled={stageMenuDisabled}
              busy={stageMenuBusy}
            />
          </View>
        </View>

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
                editable={!isNavigating && !splitting}
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
                contentBottomPadding={editorBottomVisibility.contentBottomPadding}
                obscuredBottomPx={editorBottomVisibility.obscuredBottomPx}
              />
            </View>
          </View>
            {toolbarContract.visible &&
              toolbarContract.placement === "keyboardAvoidingFlow" && (
                <View style={styles.readingMemoToolbarWrap} pointerEvents="box-none">
                  {memoToolbar}
                </View>
              )}

        </KeyboardAvoidingView>

        {/* 분할 계산용 WebView는 화면 크롬에 영향을 주지 않는 측정 레이어다. */}
        {isDividing && (
          <>
            <WebViewMeasureLayer request={warningRequest} onMeasured={handleWarningMeasured} />
            <WebViewMeasureLayer request={engineRequest} onMeasured={handleEngineMeasured} />
          </>
        )}

        {/* ── 서식 툴바 — 키보드/인라인 패널 위 floating (read.tsx와 동일) ── */}
        {toolbarContract.visible && toolbarContract.placement === "floating" && (
          <View
            style={[
              styles.memoToolbarWrap,
              { bottom: floatingChromeOffset },
            ]}
            pointerEvents="box-none"
          >
            {memoToolbar}
          </View>
        )}

        {/* ── [+] 팝업 메뉴 (addMenu) ── */}
        {!isNavigating && !isReadingMemoContext && inlineMenuMode === "addMenu" && (
          <AddMenuPopup
            chromeOffset={floatingChromeOffset}
            plusBtnCenterX={plusBtnCenterX}
            onDismiss={() => setInlineMenuMode(null)}
            onSelectQuote={handleSelectQuoteFromAddMenu}
          />
        )}

        {/* ── 인라인 메뉴 패널 (본문/문장수집 인용) ── */}
        {!isNavigating && !isReadingMemoContext && inlineMenuMode !== null && inlineMenuMode !== "addMenu" && (
          <InlineMenuPanel
            mode={inlineMenuMode}
            panelHeight={inlinePanelHeight}
            activeBlock={selectionState.activeBlock}
            userId={userId ?? ""}
            onSelectBlock={(blockType) => {
              if (isNavigatingRef.current) return;
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
                {spellState.hadFailures ? (
                  <>
                    <Feather name="alert-circle" size={28} color="#f59e0b" />
                    <Text style={styles.spellHintText}>
                      검사 완료 — 일부 항목은 자동으로 반영하지 못했어요. 직접 확인해주세요.
                    </Text>
                  </>
                ) : (
                  <>
                    <Feather name="check-circle" size={28} color="#22c55e" />
                    <Text style={styles.spellHintText}>검사 완료</Text>
                  </>
                )}
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
                    <ScalePressable
                      style={styles.spellSkipButton}
                      contentStyle={styles.spellSkipButtonContent}
                      onPress={handleSpellSkip}
                      disabled={spellApplyBusy}
                    >
                      <Text style={styles.spellSkipText}>건너뛰기</Text>
                    </ScalePressable>
                    <ScalePressable
                      style={styles.spellApplyButton}
                      contentStyle={[styles.spellApplyButtonContent, spellApplyBusy && styles.spellApplyButtonContentBusy]}
                      onPress={handleSpellApply}
                      disabled={spellApplyBusy}
                    >
                      {spellApplyBusy ? (
                        <ActivityIndicator size="small" color={Colors.white} />
                      ) : (
                        <Text style={styles.spellApplyText}>적용</Text>
                      )}
                    </ScalePressable>
                  </View>
                </View>
              );
            })()}
          </View>
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
    height: WRITING_HEADER_HEIGHT,
    minHeight: WRITING_HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 12,
    backgroundColor: Colors.white,
    zIndex: 5,
  },
  headerRight: {
    width: Sizing.headerButtonTouchSize,
    height: Sizing.headerButtonTouchSize,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  editorOuter: {
    flex: 1,
    alignItems: "center",
  },
  memoToolbarWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: "transparent",
    zIndex: 53,
    ...Platform.select({ android: { elevation: 8 } }),
  },
  readingMemoToolbarWrap: {
    width: "100%",
    backgroundColor: "transparent",
    zIndex: 53,
    ...Platform.select({ android: { elevation: 8 }, default: {} }),
  },
  editorInner: {
    flex: 1,
  },
  markdownEditorContainer: {
    flex: 1,
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
  spellApplyButtonContentBusy: {
    backgroundColor: "#93c5fd",
  },
  spellApplyText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.white,
    fontWeight: "600",
  },
});
