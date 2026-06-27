import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  BackHandler,
  AppState,
  Platform,
  ScrollView,
  Pressable,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import {
  trackPageTurn,
  trackReadingStart,
  trackReadingComplete,
  trackArticleAction,
  trackAppBackgroundedDuringReading,
  trackSentenceCollected,
  trackMemoCreatedDuringReading,
} from "@/lib/analytics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  Easing,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import {
  Colors,
  Spacing,
  ReaderTokens,
  readerFontSize,
  readerLetterSpacing,
} from "@/constants/tokens";
import { computeBodyLayout } from "@/lib/bodyLayout";
import ProgressIndicator from "@/components/ProgressIndicator/ProgressIndicator";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import CoverPreview from "@/components/CoverPreview/CoverPreview";
import { resolveArticleCover } from "@/utils/articleCover";
import CoverPage from "@/components/CoverPage/CoverPage";
import WebViewMarkdownReader from "@/components/WebViewMarkdownReader";
import { normalizePageItem } from "@/utils/normalizePageItem";
import { useReadingSession } from "@/lib/useReadingSession";
import { useReadingMemo } from "@/lib/useReadingMemo";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetArticle,
  useGetUser,
  useCreateStoredSentence,
  useListMyCollections,
  useAddArticleToMyCollection,
  useCreateMyCollection,
  useGetUserRecentCollection,
  useUpdateUserRecentCollection,
  useListInbox,
  useMarkInboxOthersRead,
  getGetUserRecentCollectionQueryKey,
  getListInboxQueryKey,
  getListStoredSentencesQueryKey,
} from "@workspace/api-client-react";
import { invalidateInbox, invalidateMyCollections, invalidateRecentCollection } from "@/lib/queryInvalidation";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import { useUser } from "@/contexts/UserContext";
import { useActiveReading } from "@/contexts/ActiveReadingContext";
import type { ReadingMode } from "@/lib/policies";
import { useToast } from "@/contexts/ToastContext";

// Horizontal padding on each side of the reader card so the drop-shadow is
// visible left and right. Must match pageListContainer.paddingHorizontal below.
const READER_SIDE_PAD = 14;

function computeReaderLayout(availableWidth: number, availableHeight: number, overrideContainerWidth?: number): ReaderLayout {
  const widthFromHeight = availableHeight * ReaderTokens.aspectRatio;
  const heightFromWidth = availableWidth / ReaderTokens.aspectRatio;

  const containerWidth = overrideContainerWidth != null
    ? overrideContainerWidth
    : (widthFromHeight <= availableWidth ? widthFromHeight : availableWidth);
  const containerHeight = overrideContainerWidth != null
    ? overrideContainerWidth / ReaderTokens.aspectRatio
    : (heightFromWidth <= availableHeight ? heightFromWidth : availableHeight);

  const scaleFactor = overrideContainerWidth != null
    ? Math.min(availableWidth / containerWidth, availableHeight / containerHeight, 1.0)
    : 1.0;
  const frameWidth = containerWidth * scaleFactor;
  const frameHeight = containerHeight * scaleFactor;

  // 본문(safeArea/padding/textColumnWidth/body 폰트 메트릭)은 lib/bodyLayout.ts의
  // computeBodyLayout이 단일 진입점이다. 작성(on-01a)·분할(on-01b)·마감(on-01c)·
  // 읽기(read.tsx) 4개 화면이 모두 같은 함수를 거치므로 textColumnWidth(정수 픽셀)와
  // body 메트릭이 동일 컨테이너 폭에서 픽셀 단위로 일치한다.
  const body = computeBodyLayout(containerWidth);

  const captionFontSize = readerFontSize(
    ReaderTokens.typeScale.captionCqi,
    containerWidth,
  );
  const metadataFontSize = readerFontSize(
    ReaderTokens.typeScale.metadataCqi,
    containerWidth,
  );

  const titleLineHeight = body.bodyFontSize * ReaderTokens.lineHeight.tight;
  const titleLetterSpacing = readerLetterSpacing(
    ReaderTokens.letterSpacing.tightEm,
    body.bodyFontSize,
  );

  // Reserve space for the title bar overlay at the bottom of the page
  // Formula: paddingTop(8) + captionFontSize * iOS line height factor(~1.3) + paddingBottom(12)
  const titleBarHeight = Math.round(20 + captionFontSize * 1.3);

  return {
    containerWidth,
    containerHeight,
    frameWidth,
    frameHeight,
    scaleFactor,
    paddingX: body.paddingX,
    paddingY: body.paddingY,
    safeAreaWidth: body.safeAreaWidth,
    safeAreaHeight: body.safeAreaHeight,
    textColumnWidth: body.textColumnWidth,
    bodyFontSize: body.bodyFontSize,
    captionFontSize,
    metadataFontSize,
    bodyLineHeight: body.bodyLineHeight,
    bodyLetterSpacing: body.bodyLetterSpacing,
    titleLineHeight,
    titleLetterSpacing,
    titleBarHeight,
  };
}

/* ─── 질문 블록 질문 데이터 ────────────────────────────────────────── */
const QUESTION_BLOCK_QUESTIONS = [
  "작성자가 하고자 하는 말은 무엇이었나요?",
  "이 글을 읽고 떠오르는 다른 글이나 경험이 있다면 무엇인가요?",
  "이 글을 읽기 전과 읽은 후, 당신의 생각이 가장 크게 바뀐 지점은 어디인가요?",
];


export default function ReadScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const queryClient = useQueryClient();
  const { userId } = useUser();
  const { setActiveSession, clearActiveSession } = useActiveReading();
  const { showToast } = useToast();
  const params = useLocalSearchParams<{
    articleId: string;
    inboxId?: string;
    mode?: string;
    entrySource?: string;
    teamCollectionId?: string;
  }>();

  const articleId = params.articleId ?? "";
  const inboxId = params.inboxId;
  const mode: ReadingMode = (params.mode as ReadingMode) ?? "basic";
  const entrySource = params.entrySource as "list" | "inbox" | undefined;
  const teamCollectionId = params.teamCollectionId;
  // True when the user opens an article via a collection article list rather
  // than via the inbox. Used in handleCommitAndSkip to determine whether to
  // invalidate the inbox query after skipping (inbox path only).
  const isListEntry =
    entrySource === "list" ||
    (mode === "basic" && !inboxId && entrySource !== "inbox");

  const articleQuery = useGetArticle(articleId);
  const article = articleId ? articleQuery.data : undefined;
  const articleLoading = articleId ? articleQuery.isLoading : false;

  const authorId = article?.authorId ?? "";
  const authorQuery = useGetUser(authorId);
  const authorName = authorId ? (authorQuery.data?.nickname ?? authorQuery.data?.email ?? undefined) : undefined;

  const cover = useMemo(
    () => resolveArticleCover(article?.cover),
    [article?.cover],
  );

  useEffect(() => {
    if (articleId && articleQuery.isError) {
      clearActiveSession();
      router.back();
    }
  }, [articleId, articleQuery.isError, clearActiveSession, router]);

  const contentPages: string[] = useMemo(() => {
    if (!article) return [];
    if (article.pages && Array.isArray(article.pages) && article.pages.length > 0) {
      return article.pages.map(normalizePageItem);
    }
    if (article.content) return [article.content];
    return [];
  }, [article]);

  const totalPages = article ? 1 + contentPages.length : 0;

  const reading = useReadingSession({
    articleId,
    mode,
    totalPages,
    userId,
    inboxId,
    teamCollectionId,
  });

  const currentPage = totalPages > 0
    ? Math.min(reading.session.position.currentPage, totalPages)
    : reading.session.position.currentPage;
  const isOnCoverPage = currentPage === 0;
  const contentPageIndex = Math.max(0, currentPage - 1);
  const isOnLastPage = totalPages > 0 && currentPage >= totalPages - 1;
  // 모든 글은 표지 페이지를 가진다(명시적 표지가 없으면 기본 표지로 자동 생성).
  // 페이지 0은 항상 표지 슬롯이므로 빈 슬롯/점프 hack/스와이프 차단이 필요 없다.
  const hasCover = !!article;


  const [finishOverlayVisible, setFinishOverlayVisible] = useState(false);
  const [exitConfirmVisible, setExitConfirmVisible] = useState(false);
  const [sentencePopupVisible, setSentencePopupVisible] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0);
  const [memoSheetVisible, setMemoSheetVisible] = useState(false);
  const [memoAppendContent, setMemoAppendContent] = useState<string | undefined>(undefined);
  const [memoFreeMemo, setMemoFreeMemo] = useState("");
  const [memoTitle, setMemoTitle] = useState("");
  const [finishSheetVisible, setFinishSheetVisible] = useState(false);
  // ── 질문 카드 스와이프 상태 (목업 ReaderSwipeNextPreview 로직) ──────────────
  const [cardPtr, setCardPtr] = useState(0);
  const [cardSaved, setCardSaved] = useState<{ qIdx: number; answer: string }[]>([]);
  const [cardSeq, setCardSeq] = useState(0);
  const [cardNewAnswer, setCardNewAnswer] = useState("");
  const [cardAnimating, setCardAnimating] = useState(false);
  const [cardExitDir, setCardExitDir] = useState<"left-slide" | "fly" | "right-slide" | null>(null);
  const [cardIncoming, setCardIncoming] = useState<{ question: string; answer: string; fromLeft: boolean } | null>(null);
  const [showSelectionPill, setShowSelectionPill] = useState(false);
  const showSelectionPillRef = useRef(false);
  const selectionPillDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectionPillText, setSelectionPillText] = useState("");

  const [selectedCollectionId, setSelectedCollectionId] = useState<string | undefined>(undefined);
  const [pageListSize, setPageListSize] = useState({ width: 0, height: 0 });
  const handlePageListLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setPageListSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  }, []);

  const storedLayoutWidth = (article?.layoutWidth != null && article.layoutWidth > 0)
    ? article.layoutWidth
    : undefined;
  // 구형 글 fallback — `layoutWidth`가 저장되지 않은 글은 작성/분할 화면이 사용한
  // 컨테이너 폭(useEditorLayout과 동일하게 `screenHeight × aspectRatio`)을
  // override로 넘겨, 폰트 크기와 줄넘김이 작성·분할 단계와 일치하도록 한다.
  // (그 전에는 `pageListSize.height`가 화면 chrome만큼 줄어들어 폰트가 미세하게 작아졌다.)
  const fallbackContainerWidth = useMemo(() => {
    const widthFromHeight = screenHeight * ReaderTokens.aspectRatio;
    return widthFromHeight <= screenWidth ? widthFromHeight : screenWidth;
  }, [screenWidth, screenHeight]);
  const effectiveLayoutWidth = storedLayoutWidth ?? fallbackContainerWidth;
  const layout = useMemo(
    () =>
      computeReaderLayout(
        // Subtract side padding so the card is narrower than the container,
        // leaving READER_SIDE_PAD px on each side for the shadow to show.
        (pageListSize.width > 0 ? pageListSize.width : screenWidth) - 2 * READER_SIDE_PAD,
        pageListSize.height > 0 ? pageListSize.height : screenWidth / ReaderTokens.aspectRatio,
        effectiveLayoutWidth,
      ),
    [pageListSize.width, pageListSize.height, screenWidth, effectiveLayoutWidth],
  );

  // Entry/exit black overlay animation — starts opaque (value=1) so the
  // reader "fades in" on mount, and fades back to opaque when exiting.
  const overlayOpacity = useSharedValue(1);
  const overlayAnimStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  // Last-page [ < ] button fade-in
  const lastPageBtnOpacity = useSharedValue(mode === "re_read" ? 1 : 0);
  const lastPageBtnAnimStyle = useAnimatedStyle(() => ({
    opacity: lastPageBtnOpacity.value,
  }));


  const createSentence = useCreateStoredSentence();
  const collectionsQuery = useListMyCollections({ ownerId: userId });
  const addToCollection = useAddArticleToMyCollection();
  const createCollection = useCreateMyCollection();
  const recentCollectionQuery = useGetUserRecentCollection(userId, {
    query: {
      queryKey: getGetUserRecentCollectionQueryKey(userId),
      enabled: !!userId,
    },
  });
  const updateRecentCollection = useUpdateUserRecentCollection();
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Detect other unread inbox copies of the same article (same article delivered
  // through multiple team collections). After the user finishes one, we offer
  // to bulk-mark the rest as read so they don't re-read duplicates.
  const inboxListQuery = useListInbox(
    { recipientId: userId, isRead: false } as Parameters<typeof useListInbox>[0],
    {
      query: {
        queryKey: getListInboxQueryKey({ recipientId: userId, isRead: false } as Parameters<typeof getListInboxQueryKey>[0]),
        enabled: !!userId && !!articleId,
      },
    },
  );
  const markOthersRead = useMarkInboxOthersRead();
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    count: number;
    onResolved: () => void;
  } | null>(null);
  const [isMarkingOthers, setIsMarkingOthers] = useState(false);

  const countOtherUnreadDuplicates = useCallback((): number => {
    const items = inboxListQuery.data;
    if (!items || !articleId) return 0;
    return items.filter(
      (it) => it.articleId === articleId && !it.isRead && (!inboxId || it.id !== inboxId),
    ).length;
  }, [inboxListQuery.data, articleId, inboxId]);

  const isInboxEntry = entrySource === "inbox" || !!inboxId;

  const promptOrContinue = useCallback(
    (afterDecision: () => void) => {
      if (!isInboxEntry) {
        afterDecision();
        return;
      }
      const count = countOtherUnreadDuplicates();
      if (count > 0) {
        setDuplicatePrompt({ count, onResolved: afterDecision });
      } else {
        afterDecision();
      }
    },
    [countOtherUnreadDuplicates, isInboxEntry],
  );

  const handleConfirmMarkOthers = useCallback(async () => {
    if (!duplicatePrompt || isMarkingOthers) return;
    const next = duplicatePrompt.onResolved;
    setIsMarkingOthers(true);
    try {
      await markOthersRead.mutateAsync({
        articleId,
        params: { recipientId: userId, ...(inboxId ? { exceptInboxId: inboxId } : {}) },
      });
      // unread 필터로 분기된 캐시 + 전체 inbox 캐시 모두 한 번에 무효화.
      invalidateInbox(queryClient);
    } catch (e) {
      console.warn("[markInboxOthersRead] failed (non-fatal):", e);
    } finally {
      setIsMarkingOthers(false);
      setDuplicatePrompt(null);
      next();
    }
  }, [duplicatePrompt, isMarkingOthers, markOthersRead, articleId, userId, inboxId, queryClient]);

  const handleCancelMarkOthers = useCallback(() => {
    if (!duplicatePrompt) return;
    const next = duplicatePrompt.onResolved;
    setDuplicatePrompt(null);
    next();
  }, [duplicatePrompt]);

  // ── Analytics tracking refs ────────────────────────────────────────────────
  const pageEnterTimeRef = useRef<number>(Date.now());
  const readingStartTimeRef = useRef<number>(0);
  const completionTimeRef = useRef<number>(0);
  const hasTrackedReadingStartRef = useRef(false);

  const readingMemo = useReadingMemo({
    userId,
    sourceArticleId: articleId,
    sourceArticleTitle: article?.title,
    onSaveError: useCallback(
      (retry: () => void) => {
        showToast({
          message: "메모 저장에 실패했어요. 다시 시도할까요?",
          type: "error",
          duration: 15000,
          action: { label: "다시 저장", onPress: retry },
        });
      },
      [showToast],
    ),
    onSnapshotRecovered: useCallback(() => {
      showToast({
        message: "이전에 저장하지 못한 메모를 복구했어요.",
        type: "info",
        duration: 4000,
      });
    }, [showToast]),
  });

  const memoContentRef = useRef(readingMemo.memoContent);
  useEffect(() => { memoContentRef.current = readingMemo.memoContent; }, [readingMemo.memoContent]);

  const handleOpenMemo = useCallback(() => {
    setMemoSheetVisible(true);
  }, []);

  // Entry animation: fade in reader only once, when content is actually ready.
  // Using [] would fire immediately during the loading state (before the overlay
  // is rendered), so the 400ms animation finishes before content appears.
  const hasStartedEntryFadeRef = useRef(false);
  useEffect(() => {
    if (!articleLoading && !reading.isRestoring && reading.isSessionHydrated && !hasStartedEntryFadeRef.current) {
      hasStartedEntryFadeRef.current = true;
      overlayOpacity.value = withTiming(0, { duration: 400, easing: Easing.out(Easing.ease) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleLoading, reading.isRestoring, reading.isSessionHydrated]);

  // Last-page [ < ] button: fade in when last page reached; re_read always shows
  useEffect(() => {
    if (mode === "re_read") {
      lastPageBtnOpacity.value = 1;
      return;
    }
    lastPageBtnOpacity.value = withTiming(isOnLastPage ? 1 : 0, { duration: 300, easing: Easing.out(Easing.ease) });
  }, [isOnLastPage, mode]);

  useEffect(() => {
    if (mode === "basic" && articleId) {
      setActiveSession({ articleId, inboxId, mode });
    }
    return () => {};
  }, [articleId, inboxId, mode, setActiveSession]);

  useEffect(() => {
    if (!reading.isRestoring && reading.isSessionHydrated && reading.session.state === "IDLE" && totalPages > 0) {
      reading.startReading();
    }
  }, [reading.isRestoring, reading.isSessionHydrated, reading.session.state, totalPages]);

  // Reset page-enter clock whenever the current page changes
  useEffect(() => {
    pageEnterTimeRef.current = Date.now();
  }, [currentPage]);

  // Fire reading_start once when the session enters READING state
  useEffect(() => {
    if (reading.session.state === "READING" && !hasTrackedReadingStartRef.current) {
      hasTrackedReadingStartRef.current = true;
      readingStartTimeRef.current = Date.now();
      trackReadingStart({
        articleId,
        totalPages,
        resumedFromPage: reading.session.position.currentPage,
      });
    }
  }, [reading.session.state, articleId, totalPages, reading.session.position.currentPage]);

  // Fire reading_complete and record completion time when the sheet opens
  useEffect(() => {
    if (reading.session.state === "COMPLETED_READY" && completionTimeRef.current === 0) {
      completionTimeRef.current = Date.now();
      trackReadingComplete({
        articleId,
        totalPages,
        totalReadMs: readingStartTimeRef.current > 0
          ? Date.now() - readingStartTimeRef.current
          : 0,
      });
    }
  }, [reading.session.state, articleId, totalPages]);

  // Fire app_backgrounded_during_reading when OS suspends the app mid-read.
  // Verbose analytics logs gated behind __DEV__ so production builds stay quiet
  // and avoid string-formatting cost on every AppState transition.
  useEffect(() => {
    if (__DEV__) console.log("[Analytics] AppState listener registered — articleId:", articleId, "state:", reading.session.state);
    const sub = AppState.addEventListener("change", (nextState) => {
      if (__DEV__) console.log("[Analytics] AppState changed →", nextState, "| session:", reading.session.state, "| page:", currentPage, "/", totalPages);
      if (
        nextState === "background" &&
        (reading.session.state === "READING" || reading.session.state === "PAUSED")
      ) {
        if (__DEV__) console.log("[Analytics] Firing app_backgrounded_during_reading, flushing PostHog…");
        trackAppBackgroundedDuringReading({ articleId, currentPage, totalPages });
      }
    });
    return () => {
      if (__DEV__) console.log("[Analytics] AppState listener removed — articleId:", articleId);
      sub.remove();
    };
  }, [articleId, currentPage, totalPages, reading.session.state]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    if (reading.session.state === "COMPLETED_READY") {
      const recentId = recentCollectionQuery.data?.recentSavedCollectionId;
      const collections = collectionsQuery.data;
      const impressionCol = collections?.find((c: { isImpression?: boolean }) => c.isImpression);
      if (impressionCol) {
        setSelectedCollectionId(impressionCol.id);
      } else if (recentId && collections?.some((c: { id: string }) => c.id === recentId)) {
        setSelectedCollectionId(recentId);
      } else if (collections && collections.length > 0) {
        setSelectedCollectionId(collections[0].id);
      } else {
        setSelectedCollectionId(undefined);
      }
      setCardPtr(0);
      setCardSaved([]);
      setCardSeq(0);
      setCardNewAnswer("");
      setCardExitDir(null);
      setCardIncoming(null);
      const restTX = cardRestTX;
      cardTX.value = restTX;
      cardTY.value = 0;
      cardRotation.value = 0;
      cardAlpha.value = 1;
      incomingCardTX.value = 0;
      setCardAnimating(true);
      setFinishOverlayVisible(true);
      setTimeout(() => {
        // 목업 SNAP: 0.48s cubic-bezier(0.25,0.46,0.45,0.94) — 부드러운 슬라이드 인
        cardTX.value = withTiming(0, {
          duration: 480,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        }, () => {
          runOnJS(setCardAnimating)(false);
        });
      }, 16);
    }
  }, [reading.session.state, recentCollectionQuery.data, collectionsQuery.data]);

  useEffect(() => {
    if (reading.session.state === "COMPLETED_COMMITTED") {
      clearActiveSession();
    }
  }, [reading.session.state, clearActiveSession]);

  useEffect(() => {
    if (mode !== "basic") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!reading.canExit) {
        setExitConfirmVisible(true);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [mode, reading.canExit, isListEntry]);


  const handleBack = useCallback(async () => {
    if (mode === "basic" && !reading.canExit) {
      setExitConfirmVisible(true);
      return;
    }
    if (reading.session.state === "READING" || reading.session.state === "PAUSED") {
      reading.pause();
    }
    await readingMemo.cleanup();
    overlayOpacity.value = withTiming(1, { duration: 350, easing: Easing.in(Easing.ease) }, (finished) => {
      if (finished) runOnJS(router.back)();
    });
  }, [mode, isListEntry, reading, router, readingMemo, overlayOpacity]);

  const canNavigate = mode === "re_read" || reading.session.state === "READING" || reading.session.state === "COMPLETED_READY";

  const showingCover = hasCover && currentPage === 0;

  const handleSwipeLeft = useCallback(() => {
    if (!canNavigate) return;
    const dwellMs = Date.now() - pageEnterTimeRef.current;
    if (showingCover) {
      reading.nextPage();
      return;
    }
    trackPageTurn({
      articleId,
      fromPage: currentPage,
      toPage: currentPage + 1,
      direction: "forward",
      dwellMs,
      totalPages,
      pageCharCount: contentPages[contentPageIndex]?.length,
    });
    reading.nextPage();
  }, [canNavigate, showingCover, reading, articleId, currentPage, totalPages, contentPages, contentPageIndex]);

  const handleSwipeRight = useCallback(() => {
    if (!canNavigate) return;
    const dwellMs = Date.now() - pageEnterTimeRef.current;
    trackPageTurn({
      articleId,
      fromPage: currentPage,
      toPage: currentPage - 1,
      direction: "backward",
      dwellMs,
      totalPages,
      pageCharCount: contentPages[contentPageIndex]?.length,
    });
    reading.prevPage();
  }, [canNavigate, hasCover, currentPage, reading, articleId, totalPages, contentPages, contentPageIndex]);

  const handleSwipeLeftRef = useRef(handleSwipeLeft);
  const handleSwipeRightRef = useRef(handleSwipeRight);
  useEffect(() => { handleSwipeLeftRef.current = handleSwipeLeft; }, [handleSwipeLeft]);
  useEffect(() => { handleSwipeRightRef.current = handleSwipeRight; }, [handleSwipeRight]);

  const isTextSelectingRef = useRef(false);
  const isDraggingRef = useRef(false);

  const handleDragStateChange = useCallback((isDragging: boolean) => {
    isDraggingRef.current = isDragging;
    // Also mutate gestureState.current directly so panGesture handlers
    // see the fresh value without waiting for the next render snapshot.
    gestureState.current.isDragging = isDragging;
  }, []);

  // ── Reanimated shared values ──────────────────────────────────────────────
  // Overlay-style pager: each slot has its own translateX SV so only the
  // moving page animates; the stationary page stays at 0.
  //
  // Render order (bottom → top): [next, current, prev]
  //   Forward swipe (dx < 0): current slides 0 → –W (out left), next stays at 0 below.
  //   Backward swipe (dx > 0): prev slides –W → 0 (in from left on top), current stays at 0.
  //
  // Overlay SVs block underlying WebView bleed-through while the bottom slot is
  // exposed. z-index is NOT used (native WebViews ignore RN z-index).
  const currentSlotSV = useSharedValue(0);
  const prevSlotSV = useSharedValue(0); // reset to -W in useLayoutEffect
  const currentPageSV = useSharedValue(currentPage);
  const containerWidthSV = useSharedValue(layout.containerWidth);
  // ── 질문 카드 레이아웃 (목업 84% 너비, 8:5 비율) ─────────────────────────────
  const cardSmallW = Math.round(screenWidth * 0.84);
  const cardFullH = Math.round(screenWidth * (8 / 5));
  const cardSmallH = Math.round(cardFullH * 0.84);
  const cardSmallLeft = Math.round((screenWidth - cardSmallW) / 2);
  const cardRestTX = Math.round((screenWidth + cardSmallW) / 2);
  const cardTX = useSharedValue(0);
  const cardTY = useSharedValue(0);
  const cardRotation = useSharedValue(0);
  const cardAlpha = useSharedValue(1);
  const incomingCardTX = useSharedValue(0);

  // Tracks which direction the active swipe is going (JS-thread safe, runOnJS:true).
  const activeSwipeRef = useRef<'forward' | 'backward' | null>(null);

  const containerWidthRef = useRef(layout.containerWidth);
  useEffect(() => {
    containerWidthRef.current = layout.containerWidth;
    containerWidthSV.value = layout.containerWidth;
  }, [layout.containerWidth, containerWidthSV]);
  const canNavigateRef = useRef(canNavigate);
  useEffect(() => { canNavigateRef.current = canNavigate; }, [canNavigate]);
  const currentPageRef = useRef(currentPage);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  const isOnLastPageRef = useRef(isOnLastPage);
  useEffect(() => { isOnLastPageRef.current = isOnLastPage; }, [isOnLastPage]);
  const hasCoverRef = useRef(hasCover);
  useEffect(() => { hasCoverRef.current = hasCover; }, [hasCover]);
  const finishOverlayVisibleRef = useRef(false);
  useEffect(() => { finishOverlayVisibleRef.current = finishOverlayVisible; }, [finishOverlayVisible]);
  const cardAnimatingRef = useRef(false);
  useEffect(() => { cardAnimatingRef.current = cardAnimating; }, [cardAnimating]);
  const cardPtrRef = useRef(0);
  useEffect(() => { cardPtrRef.current = cardPtr; }, [cardPtr]);
  const cardSavedRef = useRef<{ qIdx: number; answer: string }[]>([]);
  useEffect(() => { cardSavedRef.current = cardSaved; }, [cardSaved]);
  const cardSeqRef = useRef(0);
  useEffect(() => { cardSeqRef.current = cardSeq; }, [cardSeq]);
  const cardNewAnswerRef = useRef("");
  useEffect(() => { cardNewAnswerRef.current = cardNewAnswer; }, [cardNewAnswer]);
  const cardRestTXRef = useRef(0);
  useEffect(() => { cardRestTXRef.current = cardRestTX; }, [cardRestTX]);
  const screenWidthRef = useRef(screenWidth);
  useEffect(() => { screenWidthRef.current = screenWidth; }, [screenWidth]);
  const screenHeightRef = useRef(screenHeight);
  useEffect(() => { screenHeightRef.current = screenHeight; }, [screenHeight]);

  // Reset all slot SVs after every page-turn commit (currentPage or layout change).
  useLayoutEffect(() => {
    currentPageSV.value = currentPage;
    currentSlotSV.value = 0;
    prevSlotSV.value = -(layout.containerWidth + PARK_EXTRA); // park prev far off-screen left
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, layout.containerWidth]);

  // Forward swipe: current slides left and tilts slightly clockwise (positive rotateZ).
  // Backward swipe: prev slides in from left, starting tilted and settling to flat.
  const MAX_ROTATE_DEG = 4;
  // Park prev slot this many px BEYOND -W so the bottom corner (which protrudes
  // inward under CCW rotation) stays fully off-screen.
  // Geometry: with -4° rotation the bottom-right corner protrudes ~H*sin(4°) ≈ H*0.07
  // inward, PLUS the container is offset 14px from the screen edge.
  // 120 px covers any phone in typical portrait use.
  const PARK_EXTRA = 120;
  const currentSlotAnimStyle = useAnimatedStyle(() => {
    const W = containerWidthSV.value || 300;
    // Only rotate while actually sliding out (not at rest position 0).
    const slideOut = -currentSlotSV.value; // 0 at rest, W when fully out
    const rotation = slideOut > 0.5 ? -(Math.min(1, slideOut / W) * MAX_ROTATE_DEG) : 0;
    return {
      transform: [
        { translateX: currentSlotSV.value },
        { rotateZ: `${rotation}deg` },
      ],
    };
  });
  const prevSlotAnimStyle = useAnimatedStyle(() => {
    const W = containerWidthSV.value || 300;
    // Continuous rotation, no guard. Card is parked at -(W + PARK_EXTRA) — far
    // enough off-screen that the bottom-right corner (most protruding corner under
    // CCW rotation) stays invisible. As the card enters the viewport (slideIn→0)
    // rotation is near -4°; by the time it is fully in (slideIn=W) rotation is 0°.
    const slideIn = prevSlotSV.value + W; // –PARK_EXTRA when parked, W when fully in
    const rotation = (slideIn / W - 1) * MAX_ROTATE_DEG;
    // (slideIn/W − 1): parked ≈ −1.4 → screen-entry ≈ −1 → fully in = 0
    return {
      transform: [
        { translateX: prevSlotSV.value },
        { rotateZ: `${rotation}deg` },
      ],
    };
  });
  // Shadow opacity for the CURRENT card: 0 at rest (only `next` casts a shadow,
  // so the resting stack shows exactly one shadow), growing to 1 as the card is
  // swiped out — proportional to the same factor that drives its 0°→-4° rotation.
  // Mimics lifting a sheet of paper: the more it lifts, the darker its shadow.
  const currentShadowStyle = useAnimatedStyle(() => {
    const W = containerWidthSV.value || 300;
    const slideOut = -currentSlotSV.value; // 0 at rest, W when fully out
    const progress = Math.min(1, Math.max(0, slideOut / W));
    return { opacity: progress };
  });
  // Shadow opacity for the PREV card (backward swipe): strong while it is lifted
  // off-screen / sliding in, fading to 0 as it settles flat at rest — so once it
  // becomes the new resting page it adds no second shadow over `next`.
  const prevShadowStyle = useAnimatedStyle(() => {
    const W = containerWidthSV.value || 300;
    const slideIn = prevSlotSV.value + W; // –PARK_EXTRA parked → W fully in
    const progress = Math.min(1, Math.max(0, 1 - slideIn / W));
    return { opacity: progress };
  });
  const cardAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: cardTX.value },
      { translateY: cardTY.value },
      { rotate: `${cardRotation.value}deg` },
    ],
    opacity: cardAlpha.value,
  }));
  const incomingCardAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: incomingCardTX.value }],
  }));


  // ── Gesture state ref (always fresh, avoids stale closure in useMemo) ────
  const isAtEnd = currentPage >= totalPages; // on the completion card (past all real pages)


  const gestureState = useRef({
    canNavigate: false,
    isOnLastPage: false,
    isAtEnd: false,
    atBoundaryLeft: true,
    containerWidth: 300,
    isTextSelecting: false,
    isDragging: false,
    isCommitting: false,
  });
  gestureState.current = {
    canNavigate,
    isOnLastPage,
    isAtEnd,
    atBoundaryLeft: currentPage === 0,
    containerWidth: layout.containerWidth,
    isTextSelecting: isTextSelectingRef.current,
    isDragging: isDraggingRef.current,
    isCommitting: false, // updated inline
  };
  const isCommittingRef = useRef(false);

  // Callbacks invoked via runOnJS after UI-thread animation completes
  const finishPageTurnRef = useRef((_direction: -1 | 1) => {});
  const openMemoRef = useRef(() => {});
  useEffect(() => {
    finishPageTurnRef.current = (direction: -1 | 1) => {
      isCommittingRef.current = false;
      activeSwipeRef.current = null;
      // Slot SVs are reset by useLayoutEffect after currentPage changes
      if (direction === -1) handleSwipeLeftRef.current();
      else handleSwipeRightRef.current();
    };
  }, []);
  useEffect(() => {
    openMemoRef.current = () => handleOpenMemo();
  }, [handleOpenMemo]);

  // Trigger the leftward page-turn animation then call reading.nextPage()
  // Used by both the gesture handler (extra left swipe on last page) and
  // the floating [ < ] button on last page in normal read mode.
  const triggerLastPageTransitionRef = useRef(() => {});
  useEffect(() => {
    triggerLastPageTransitionRef.current = () => {
      // Last page: immediately show floating question card (no animation).
      handleSwipeLeftRef.current();
    };
  });

  // ── 질문 카드 내비게이션 함수 (목업 triggerAdvance/triggerBack 이식) ───────────
  const afterCardTransition = useCallback((restTX: number) => {
    setCardExitDir(null);
    setCardIncoming(null);
    cardTX.value = 0;
    cardTY.value = 0;
    cardRotation.value = 0;
    incomingCardTX.value = 0;
    cardAlpha.value = 1;
    setCardAnimating(false);
  }, [cardTX, cardTY, cardRotation, incomingCardTX, cardAlpha]);

  const afterCardTransitionRef = useRef(afterCardTransition);
  useEffect(() => { afterCardTransitionRef.current = afterCardTransition; }, [afterCardTransition]);

  const triggerCardAdvance = useCallback((hasAnswer: boolean) => {
    const ptr = cardPtrRef.current;
    const saved = cardSavedRef.current;
    const seq = cardSeqRef.current;
    const newAns = cardNewAnswerRef.current;
    const restTX = cardRestTXRef.current;
    const isNewCard = ptr === saved.length;

    let nextSaved = saved;
    let nextPtr: number;
    let exitMode: "left-slide" | "fly";
    let nextSeq = seq;

    if (isNewCard) {
      nextSeq = seq + 1;
      if (hasAnswer) {
        const entry = { qIdx: seq % QUESTION_BLOCK_QUESTIONS.length, answer: newAns };
        nextSaved = [...saved, entry];
        nextPtr = nextSaved.length;
        exitMode = "left-slide";
      } else {
        nextPtr = saved.length;
        exitMode = "fly";
      }
    } else {
      nextPtr = ptr + 1;
      exitMode = "left-slide";
    }

    const nextQ = nextPtr < nextSaved.length
      ? QUESTION_BLOCK_QUESTIONS[nextSaved[nextPtr].qIdx]
      : QUESTION_BLOCK_QUESTIONS[nextSeq % QUESTION_BLOCK_QUESTIONS.length];
    const nextAns = nextPtr < nextSaved.length ? nextSaved[nextPtr].answer : "";

    setCardAnimating(true);
    cardAnimatingRef.current = true;
    setCardExitDir(exitMode);
    setCardIncoming({ question: nextQ, answer: nextAns, fromLeft: false });

    if (exitMode === "left-slide") {
      incomingCardTX.value = restTX;
      requestAnimationFrame(() => {
        setCardSaved(nextSaved);
        cardSavedRef.current = nextSaved;
        setCardPtr(nextPtr);
        cardPtrRef.current = nextPtr;
        setCardSeq(nextSeq);
        cardSeqRef.current = nextSeq;
        if (isNewCard) { setCardNewAnswer(""); cardNewAnswerRef.current = ""; }

        cardTX.value = withTiming(-restTX, {
          duration: 420,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        });
        incomingCardTX.value = withTiming(0, {
          duration: 420,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        }, () => {
          runOnJS(afterCardTransitionRef.current)(restTX);
        });
      });
    } else {
      // 목업 fly-away: translateX(-200) translateY(-380) rotate(22deg) + fade
      // 비율로 환산해 화면 크기에 무관하게 동일한 느낌을 유지한다
      const flyX = -Math.round(screenWidthRef.current * (200 / 390));
      const flyY = -Math.round(screenHeightRef.current * (380 / 844));
      const flyEasing = Easing.bezier(0.4, 0, 1, 0.55);
      cardTX.value = withTiming(flyX, { duration: 460, easing: flyEasing });
      cardTY.value = withTiming(flyY, { duration: 460, easing: flyEasing });
      cardRotation.value = withTiming(22, { duration: 460, easing: flyEasing });
      cardAlpha.value = withTiming(0, { duration: 320, easing: flyEasing });
      setTimeout(() => {
        setCardSaved(nextSaved);
        cardSavedRef.current = nextSaved;
        setCardPtr(nextPtr);
        cardPtrRef.current = nextPtr;
        setCardSeq(nextSeq);
        cardSeqRef.current = nextSeq;
        setCardNewAnswer("");
        cardNewAnswerRef.current = "";
        // 현재 카드는 alpha=0(비가시) 상태 유지 — afterCardTransition에서
        // cardTX=0, cardAlpha=1을 동시에 적용해 seamless swap
        cardTX.value = restTX;
        cardTY.value = 0;
        cardRotation.value = 0;
        incomingCardTX.value = restTX;
        requestAnimationFrame(() => {
          // 목업 ENTER_GRID: 0.42s cubic-bezier(0.25,0.46,0.45,0.94)
          incomingCardTX.value = withTiming(0, {
            duration: 420,
            easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
          }, () => {
            runOnJS(afterCardTransitionRef.current)(restTX);
          });
        });
      }, 360);
    }
  }, [afterCardTransitionRef, cardTX, cardTY, cardRotation, cardAlpha, incomingCardTX]);

  const triggerCardBack = useCallback(() => {
    const ptr = cardPtrRef.current;
    const saved = cardSavedRef.current;
    const restTX = cardRestTXRef.current;

    if (ptr <= 0) {
      if (ptr === 0) {
        // 첫 번째 카드에서 오른쪽 스와이프 → 원 글(article)로 돌아가기
        // 카드가 오른쪽으로 슬라이드 아웃 후 finishOverlay 닫기
        setCardAnimating(true);
        cardAnimatingRef.current = true;
        cardTX.value = withTiming(restTX, {
          duration: 420,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        });
        setTimeout(() => {
          setFinishOverlayVisible(false);
          setCardAnimating(false);
          cardAnimatingRef.current = false;
          cardTX.value = 0;
        }, 440);
      } else {
        cardTX.value = withSpring(0, { damping: 12, stiffness: 180 });
      }
      return;
    }

    setCardAnimating(true);
    cardAnimatingRef.current = true;
    setCardExitDir("right-slide");

    const prevCard = saved[ptr - 1];
    const prevQ = QUESTION_BLOCK_QUESTIONS[prevCard.qIdx];
    setCardIncoming({ question: prevQ, answer: prevCard.answer, fromLeft: true });
    incomingCardTX.value = -restTX;

    requestAnimationFrame(() => {
      setCardPtr(ptr - 1);
      cardPtrRef.current = ptr - 1;
      cardTX.value = withTiming(restTX, {
        duration: 420,
        easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
      });
      incomingCardTX.value = withTiming(0, {
        duration: 420,
        easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
      }, () => {
        runOnJS(afterCardTransitionRef.current)(restTX);
      });
    });
  }, [afterCardTransitionRef, cardTX, incomingCardTX]);

  const triggerCardAdvanceRef = useRef(triggerCardAdvance);
  useEffect(() => { triggerCardAdvanceRef.current = triggerCardAdvance; }, [triggerCardAdvance]);
  const triggerCardBackRef = useRef(triggerCardBack);
  useEffect(() => { triggerCardBackRef.current = triggerCardBack; }, [triggerCardBack]);

  const cardPanGesture = useMemo(() =>
    Gesture.Pan()
      .runOnJS(true)
      .minDistance(8)
      .onBegin(() => { /* capture start */ })
      .onUpdate((e) => {
        if (cardAnimatingRef.current) return;
        const dx = e.translationX;
        if (dx < 0) {
          cardTX.value = dx * 0.14;
        } else {
          const ptr = cardPtrRef.current;
          if (ptr > 0) {
            cardTX.value = dx * 0.14;
          } else {
            cardTX.value = Math.min(dx * 0.25, cardRestTXRef.current * 0.3);
          }
        }
      })
      .onEnd((e) => {
        if (cardAnimatingRef.current) return;
        const dx = e.translationX;
        const THRESHOLD = 80;
        if (dx < -THRESHOLD) {
          const isNewCard = cardPtrRef.current === cardSavedRef.current.length;
          const hasAnswer = isNewCard ? cardNewAnswerRef.current.trim().length > 0 : true;
          triggerCardAdvanceRef.current(hasAnswer);
        } else if (dx > THRESHOLD) {
          triggerCardBackRef.current();
        } else {
          // 목업 SPRING: cubic-bezier(0.34,1.36,0.64,1) 바운스 snap-back
          cardTX.value = withSpring(0, { damping: 12, stiffness: 180 });
        }
      }),
    [],
  );

  // Floating [ < ] button handler:
  //   - re_read mode or finish overlay visible → fade out and go back
  //   - normal read mode, last page → left-slide into finish overlay
  const handleFloatingBackBtn = useCallback(() => {
    if (mode === "re_read" || reading.session.state !== "READING" || !isOnLastPage) {
      handleBack();
      return;
    }
    triggerLastPageTransitionRef.current();
  }, [mode, reading.session.state, isOnLastPage, handleBack]);

  const snapConfig = { damping: 18, stiffness: 280, mass: 0.8 };

  // Android 10+ 제스처 내비게이션 모드에서 시스템 좌/우 엣지 스와이프(뒤로가기)와
  // 페이지 넘기기 Pan 제스처가 충돌하지 않도록, Android에서만 좌·우 엣지 24dp를
  // Pan 활성 영역에서 제외한다. iOS는 시스템 엣지 스와이프와 다르게 동작하므로
  // 기존 감도(minDistance: 8)와 활성 영역을 그대로 유지한다.
  const ANDROID_EDGE_EXCLUSION = 24;
  const panHitSlop = Platform.OS === "android"
    ? { left: -ANDROID_EDGE_EXCLUSION, right: -ANDROID_EDGE_EXCLUSION }
    : undefined;

  // Gesture.Pan runs on JS thread (runOnJS:true) for gesture recognition,
  // but withTiming / withSpring animate purely on the UI thread.
  const panGesture = useMemo(() => {
    const g = Gesture.Pan()
      .minDistance(8)
      .runOnJS(true);
    if (panHitSlop) {
      g.hitSlop(panHitSlop);
    }
    return g
    .onBegin(() => {
      if (finishOverlayVisibleRef.current) return;
      if (isDraggingRef.current || isTextSelectingRef.current) return;
    })
    .onUpdate((e) => {
      if (finishOverlayVisibleRef.current) return;
      if (isDraggingRef.current || isTextSelectingRef.current || isCommittingRef.current) return;
      const gs = gestureState.current;

      const dx = e.translationX;
      const dy = e.translationY;
      // Only track horizontal movement for page sliding
      if (Math.abs(dy) > Math.abs(dx) * 1.8) return;

      if (dx < 0 && gs.isAtEnd) return;  // no next after completion card
      if (dx > 0 && gs.atBoundaryLeft) return; // no prev at start

      const W = gs.containerWidth || 300;
      if (dx < 0) {
        // Forward: current slides left (0 → –(W + PARK_EXTRA)), next slot stays
        // at 0 below. Clamp at -(W + PARK_EXTRA) so the rotated corner can drag
        // fully off-screen instead of stopping with the corner still poking out.
        activeSwipeRef.current = 'forward';
        currentSlotSV.value = Math.max(dx, -(W + PARK_EXTRA));
      } else if (dx > 0) {
        // Backward: prev slides from –W toward 0 on top, current stays at 0.
        activeSwipeRef.current = 'backward';
        prevSlotSV.value = Math.max(-(W + PARK_EXTRA), dx - W);
      }
    })
    .onEnd((e) => {
      if (finishOverlayVisibleRef.current) return;
      if (isCommittingRef.current) return;

      const gs = gestureState.current;
      const W = gs.containerWidth || 300;

      const snapForward = () => {
        currentSlotSV.value = withSpring(0, snapConfig);
        activeSwipeRef.current = null;
      };
      const snapBackward = () => {
        prevSlotSV.value = withSpring(-(W + PARK_EXTRA), snapConfig);
        activeSwipeRef.current = null;
      };

      if (isDraggingRef.current || isTextSelectingRef.current) {
        if (activeSwipeRef.current === 'forward') snapForward();
        else snapBackward();
        return;
      }

      const dx = e.translationX;
      const dy = e.translationY;
      const absDx = Math.abs(dx);

      // Upward swipe → open memo sheet
      if (dy < -50 && Math.abs(dy) > absDx * 1.5) {
        if (activeSwipeRef.current === 'forward') snapForward();
        else snapBackward();
        runOnJS(openMemoRef.current)();
        return;
      }

      if (!gs.canNavigate) {
        if (activeSwipeRef.current === 'forward') snapForward();
        else snapBackward();
        return;
      }

      const goingNext = dx < 0;

      // Boundary checks
      if (!goingNext && gs.atBoundaryLeft) {
        snapBackward();
        return;
      }
      if (goingNext && gs.isOnLastPage) {
        // Last page extra swipe → show floating question card.
        runOnJS(handleSwipeLeftRef.current)();
        return;
      }
      if (goingNext && gs.isAtEnd) {
        snapForward();
        return;
      }

      const THRESHOLD = W * 0.22;
      const VELOCITY_THRESHOLD = 450;
      const shouldCommit = absDx > THRESHOLD || Math.abs(e.velocityX) > VELOCITY_THRESHOLD;

      if (!shouldCommit) {
        if (goingNext) snapForward();
        else snapBackward();
        return;
      }

      const direction: -1 | 1 = goingNext ? -1 : 1;
      isCommittingRef.current = true;

      if (direction === -1) {
        // Forward: slide current slot fully out to the left, parking at
        // -(W + PARK_EXTRA) so the rotated corner clears the screen edge.
        currentSlotSV.value = withTiming(-(W + PARK_EXTRA), {
          duration: 240,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        }, () => {
          runOnJS(finishPageTurnRef.current)(direction);
        });
      } else {
        // Backward: slide prev slot fully into position.
        prevSlotSV.value = withTiming(0, {
          duration: 240,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        }, () => {
          runOnJS(finishPageTurnRef.current)(direction);
        });
      }
    })
    .onFinalize(() => {
      // If gesture is cancelled externally, snap back to rest position.
      if (!isCommittingRef.current) {
        const W = containerWidthRef.current || 300;
        if (activeSwipeRef.current === 'forward') {
          currentSlotSV.value = withSpring(0, snapConfig);
        } else if (activeSwipeRef.current === 'backward') {
          prevSlotSV.value = withSpring(-(W + PARK_EXTRA), snapConfig);
        }
        activeSwipeRef.current = null;
      }
    });
  }, []);

  const tapGesture = useMemo(() => Gesture.Tap()
    .runOnJS(true)
    .onEnd((_e, success) => {
      if (success && isTextSelectingRef.current && !showSelectionPillRef.current) {
        setClearSelectionSignal((n) => n + 1);
      }
    }), []);

  const combinedGesture = useMemo(
    () => Gesture.Simultaneous(panGesture, tapGesture),
    [panGesture, tapGesture],
  );

  const isCollectionsReady = !collectionsQuery.isLoading && !collectionsQuery.isError;

  const handleCommitAndSave = useCallback(async () => {
    if (isSaving) return;
    if (!isCollectionsReady) {
      showToast({ message: "보관함 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.", type: "info" });
      return;
    }
    setIsSaving(true);
    try {
      const result = await reading.commitCompletion();
      if (!result.success) {
        showToast({ message: result.error ?? "완독 처리에 실패했습니다.", type: "error" });
        return;
      }

      let targetCollectionId: string | undefined = selectedCollectionId;
      if (!targetCollectionId) {
        const collections = collectionsQuery.data;
        const impressionCol = collections?.find((c: { isImpression?: boolean }) => c.isImpression);
        if (impressionCol) {
          targetCollectionId = impressionCol.id;
        } else if (collections && collections.length > 0) {
          targetCollectionId = collections[0].id;
        } else {
          try {
            const newCol = await createCollection.mutateAsync({
              data: { ownerId: userId, name: "인상깊은 편지", isImpression: true },
            });
            targetCollectionId = newCol.id;
          } catch {
            showToast({ message: "완독 기록은 저장했지만 보관함 생성에 실패했습니다.", type: "info" });
          }
        }
      }

      if (targetCollectionId && articleId) {
        try {
          await addToCollection.mutateAsync({
            id: targetCollectionId,
            data: { articleId },
          });
          invalidateMyCollections(queryClient);
          try {
            await updateRecentCollection.mutateAsync({
              id: userId,
              data: { collectionId: targetCollectionId },
            });
            invalidateRecentCollection(queryClient, userId);
          } catch (e) {
            console.warn("[handleCommitAndSave] recent collection update failed (non-fatal):", e);
          }
        } catch {
          showToast({ message: "완독 기록은 저장했지만 보관함 추가에 실패했습니다.", type: "info" });
        }
      }

      setFinishOverlayVisible(false);
      setFinishSheetVisible(false);
      trackArticleAction({ articleId, action: "save", msSinceComplete: Date.now() - completionTimeRef.current });
      invalidateInbox(queryClient);
      clearActiveSession();
      await readingMemo.cleanup();
      overlayOpacity.value = withTiming(1, { duration: 350, easing: Easing.in(Easing.ease) }, (finished) => {
        if (finished) runOnJS(router.back)();
      });
      showToast({ message: "보관함에 저장됐어요.", type: "success" });
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, isCollectionsReady, reading, selectedCollectionId, collectionsQuery.data, articleId, userId, createCollection, addToCollection, updateRecentCollection, queryClient, clearActiveSession, router, readingMemo]);

  const handleCommitAndSkip = useCallback(async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      const result = await reading.commitCompletion();
      setFinishOverlayVisible(false);
      setFinishSheetVisible(false);
      if (result.success) {
        trackArticleAction({ articleId, action: "skip", msSinceComplete: Date.now() - completionTimeRef.current });
        if (!isListEntry) {
          // 수신함 경로: 읽기 완료 후 수신함 목록 갱신
          invalidateInbox(queryClient);
        }
        clearActiveSession();
        await readingMemo.cleanup();
        promptOrContinue(() => {
          overlayOpacity.value = withTiming(1, { duration: 350, easing: Easing.in(Easing.ease) }, (finished) => {
            if (finished) runOnJS(router.back)();
          });
          showToast({ message: "읽기를 완료했어요.", type: "success" });
        });
      } else {
        showToast({ message: result.error ?? "완독 처리에 실패했습니다.", type: "error" });
      }
    } finally {
      setIsDeleting(false);
    }
  }, [isDeleting, isListEntry, reading, router, clearActiveSession, queryClient, readingMemo, articleId, promptOrContinue]);

  const handleTextSelect = useCallback((text: string, isEmpty: boolean) => {
    if (!isEmpty && text) {
      if (selectionPillDismissTimer.current) {
        clearTimeout(selectionPillDismissTimer.current);
        selectionPillDismissTimer.current = null;
      }
      isTextSelectingRef.current = true;
      showSelectionPillRef.current = true;
      setSelectionPillText(text);
      setShowSelectionPill(true);
    } else {
      if (showSelectionPillRef.current) {
        if (selectionPillDismissTimer.current) {
          clearTimeout(selectionPillDismissTimer.current);
        }
        selectionPillDismissTimer.current = setTimeout(() => {
          selectionPillDismissTimer.current = null;
          isTextSelectingRef.current = false;
          showSelectionPillRef.current = false;
          setShowSelectionPill(false);
        }, 400);
      } else {
        isTextSelectingRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      if (selectionPillDismissTimer.current) {
        clearTimeout(selectionPillDismissTimer.current);
      }
    };
  }, []);

  const handleCollectSentence = useCallback((text: string) => {
    if (text.trim().length > 0) {
      setSelectedText(text.trim());
      setSentencePopupVisible(true);
    }
  }, []);

  const handleMemoSentence = useCallback((text: string) => {
    if (text.trim().length === 0) return;
    const pageNum = currentPage;
    const author = authorName ?? "";
    const title = article?.title ?? "";
    const quoteBlock = `> ${text.trim()}\n>\n> ${author}, <${title}>, ${pageNum}면`;
    const base = readingMemo.memoContent;
    // 인용구 뒤에 빈 줄(\n\n)을 두어 blockquote를 종료하고, 사용자가 인용구 아래
    // 빈 영역을 탭했을 때 본문 단락에 커서가 잡히도록 한다.
    const combined = base ? `${base}\n\n${quoteBlock}\n\n` : `${quoteBlock}\n\n`;
    readingMemo.updateMemoContent(combined);
    setMemoAppendContent(combined);
    setMemoSheetVisible(true);
    trackMemoCreatedDuringReading({ articleId, page: currentPage });
  }, [currentPage, authorName, article?.title, readingMemo, articleId]);

  const handleSaveSentence = useCallback(async () => {
    if (!selectedText) return;
    try {
      await createSentence.mutateAsync({
        data: {
          userId,
          articleId,
          text: selectedText,
          position: {
            page: contentPageIndex,
          },
        },
      });
      queryClient.invalidateQueries({ queryKey: getListStoredSentencesQueryKey({ userId }) });
      trackSentenceCollected({ articleId, page: contentPageIndex, textLength: selectedText.length });
      setSentencePopupVisible(false);
      setSelectedText("");
      showToast({ message: "문장이 저장되었습니다.", type: "success" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "문장 저장에 실패했습니다.";
      showToast({ message: msg, type: "error" });
    }
  }, [selectedText, userId, articleId, contentPageIndex, createSentence, queryClient]);

  const handleCancelSentence = useCallback(() => {
    setSentencePopupVisible(false);
    setSelectedText("");
    setClearSelectionSignal((n) => n + 1);
  }, []);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        articleTitle: {
          fontSize: layout.captionFontSize,
          fontFamily: ReaderTokens.fontFamily.sans,
          letterSpacing: layout.titleLetterSpacing,
          color: Colors.zinc400,
          textAlign: "center" as const,
        },
        modeBadgeText: {
          fontSize: layout.metadataFontSize,
          fontFamily: ReaderTokens.fontFamily.sans,
          color: Colors.zinc500,
        },
        completionText: {
          fontSize: layout.bodyFontSize * 1.125,
          fontWeight: "600" as const,
          fontFamily: ReaderTokens.fontFamily.sansSemiBold,
          color: Colors.zinc900,
          textAlign: "center",
          marginBottom: 8,
        },
        completionButtonText: {
          fontSize: layout.bodyFontSize,
          fontWeight: "600" as const,
          fontFamily: ReaderTokens.fontFamily.sansSemiBold,
          color: Colors.white,
        },
        completionButtonSecondaryText: {
          fontSize: layout.bodyFontSize,
          fontWeight: "600" as const,
          fontFamily: ReaderTokens.fontFamily.sansSemiBold,
          color: Colors.zinc600,
        },
        completionButtonTertiaryText: {
          fontSize: layout.bodyFontSize * 0.9,
          fontFamily: ReaderTokens.fontFamily.sans,
          color: Colors.zinc600,
        },
        sentencePreview: {
          fontSize: layout.bodyFontSize,
          fontFamily: ReaderTokens.fontFamily.serif,
          color: Colors.zinc700,
          fontStyle: "italic" as const,
          lineHeight: layout.bodyLineHeight,
        },
        sentenceButtonText: {
          fontSize: layout.captionFontSize,
          fontWeight: "600" as const,
          fontFamily: ReaderTokens.fontFamily.sansSemiBold,
          color: Colors.white,
        },
        sentenceButtonCancelText: {
          fontSize: layout.captionFontSize,
          fontWeight: "600" as const,
          fontFamily: ReaderTokens.fontFamily.sansSemiBold,
          color: Colors.zinc600,
        },
        memoInput: {
          fontSize: layout.bodyFontSize,
          fontFamily: ReaderTokens.fontFamily.sans,
          color: Colors.zinc800,
          backgroundColor: Colors.zinc50,
          borderRadius: 10,
          padding: 14,
          minHeight: 120,
          lineHeight: layout.bodyLineHeight,
        },
        memoPageInfo: {
          fontSize: layout.captionFontSize,
          fontFamily: ReaderTokens.fontFamily.sans,
          color: Colors.zinc400,
          textAlign: "right" as const,
        },
        completeButtonText: {
          fontSize: layout.bodyFontSize,
          fontWeight: "600" as const,
          fontFamily: ReaderTokens.fontFamily.sansSemiBold,
          color: Colors.white,
        },
        sheetTitle: {
          fontSize: layout.bodyFontSize,
          fontWeight: "600" as const,
          fontFamily: ReaderTokens.fontFamily.sansSemiBold,
          color: Colors.zinc900,
        },
      }),
    [layout],
  );

  if (!articleId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>편지를 선택해주세요</Text>
        </View>
      </View>
    );
  }

  if (articleLoading || reading.isRestoring || !reading.isSessionHydrated) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.emptyContainer}>
          <ProgressIndicator type="spinner" size="large" />
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
        {/* Keep black overlay visible while loading so there's no background flash */}
        <Animated.View style={[styles.blackOverlay, overlayAnimStyle]} pointerEvents="none" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: false,
          gestureEnabled: false,
        }}
      />

      {totalPages > 0 ? (
        <GestureDetector gesture={combinedGesture}>
          <View
            style={[styles.pageListContainer, Platform.OS === "web" ? { touchAction: "none" } as object : undefined]}
            onLayout={handlePageListLayout}
          >
            {/* Card: shadow wrapper gives floating-paper feel */}
            <View>
              <View
                style={[
                  styles.readerShadowWrapper,
                  {
                    width: layout.frameWidth,
                    height: layout.frameHeight,
                  },
                ]}
              >
              <View
                style={[
                  styles.readerFrame,
                  {
                    width: layout.frameWidth,
                    height: layout.frameHeight,
                  },
                ]}
              >
                {/* Scale-transform wrapper */}
                <View style={{
                  position: "absolute",
                  left: (layout.frameWidth - layout.containerWidth) / 2,
                  top: (layout.frameHeight - layout.containerHeight) / 2,
                  width: layout.containerWidth,
                  height: layout.containerHeight,
                  transform: [{ scale: layout.scaleFactor }],
                }}>
                  {/* Overlay-style page slots — render order is [next, current, prev]
                      (last rendered = topmost layer). Each slot sits at left:0 and
                      moves independently:
                        forward  → current slides 0→–W out left, next stays at 0 below.
                        backward → prev slides –W→0 in from left on top, current stays.
                      Opaque overlay Views on the bottom slot block WebView bleed-through
                      while the moving card exposes what is underneath. */}
                  <View
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: layout.containerWidth,
                      height: layout.containerHeight,
                    }}
                    pointerEvents="box-none"
                  >
                    {(() => {
                      const W = layout.containerWidth;
                      const H = layout.containerHeight;
                      // Positioning-only base, no shadow. Used by the `next` slot,
                      // which always sits directly beneath `current` at rest — giving
                      // it a shadow would stack a second shadow under the top card and
                      // make the combined shadow visibly darker once a slide settles.
                      const slotBase: object = {
                        position: "absolute" as const,
                        top: 0,
                        left: 0,
                        width: W,
                        height: H,
                      };
                      // Shadow-only layer placed BEHIND each slot's content. Uses
                      // boxShadow (not elevation) so it never reorders siblings on
                      // Android — render order [next, current, prev] is preserved.
                      // backgroundColor matches the page so the box casts a shadow;
                      // the opaque slotContent on top hides the box interior, leaving
                      // only the shadow that radiates past the card edges. Its opacity
                      // is animated per slot (static 1 for `next`).
                      const shadowLayer: object = {
                        position: "absolute" as const,
                        top: 0,
                        left: 0,
                        width: W,
                        height: H,
                        backgroundColor: ReaderTokens.bodyBg,
                        boxShadow: "0px 2px 10px rgba(0,0,0,0.13), 0px 8px 24px rgba(0,0,0,0.09)",
                      };
                      // Inner wrapper clips text/WebView content to card bounds.
                      const slotContent = {
                        width: W,
                        height: H,
                        overflow: "hidden" as const,
                        backgroundColor: ReaderTokens.bodyBg,
                      };

                      const makeNode = (pageIdx: number) => {
                        // Virtual page one past the last: floating overlay handles this instead.
                        if (pageIdx === totalPages) return null;
                        if (pageIdx < 0 || pageIdx >= totalPages) return null;
                        const isCover = pageIdx === 0;
                        const cIdx = pageIdx - 1;
                        if (isCover) {
                          return (
                            <CoverPage
                              cover={cover}
                              title={article?.title ?? ""}
                              authorName={authorName}
                              containerWidth={layout.containerWidth}
                              containerHeight={layout.containerHeight}
                            />
                          );
                        }
                        if (cIdx >= 0 && cIdx < contentPages.length) {
                          return (
                            <PageView
                              content={contentPages[cIdx]}
                              onTextSelect={handleTextSelect}
                              onDragStateChange={handleDragStateChange}
                              bottomInset={insets.bottom}
                              layout={layout}
                              clearSignal={clearSelectionSignal}
                            />
                          );
                        }
                        return null;
                      };

                      const nextNode = makeNode(currentPage + 1);
                      const currentNode = makeNode(currentPage);
                      const prevNode = makeNode(currentPage - 1);

                      return (
                        <>
                          {/* next — bottom layer, always carries the base shadow
                              (static, full opacity) so the resting page always casts
                              exactly one shadow. Rendered even when there is no next
                              real page so the completion card keeps its shadow. */}
                          <View key={`page-${currentPage + 1}`} style={slotBase}>
                            <View style={shadowLayer} />
                            {nextNode != null && (
                              <View style={slotContent}>{nextNode}</View>
                            )}
                          </View>

                          {/* current — middle layer, slides left + rotates during
                              forward swipe. Its shadow fades in as it lifts/slides. */}
                          {currentNode != null && (
                            <Animated.View key={`page-${currentPage}`} style={[slotBase, currentSlotAnimStyle]}>
                              <Animated.View style={[shadowLayer, currentShadowStyle]} />
                              <View style={slotContent}>{currentNode}</View>
                            </Animated.View>
                          )}

                          {/* prev — top layer, slides in from left + rotates to flat
                              during backward swipe. Its shadow fades out as it settles. */}
                          {prevNode != null && (
                            <Animated.View key={`page-${currentPage - 1}`} style={[slotBase, prevSlotAnimStyle]}>
                              <Animated.View style={[shadowLayer, prevShadowStyle]} />
                              <View style={slotContent}>{prevNode}</View>
                            </Animated.View>
                          )}
                        </>
                      );
                    })()}
                  </View>
                </View>
              </View>
              </View>
            </View>

            {/* Progress bar below card */}
            <View style={styles.progressBarContainer}>
              <ProgressIndicator type="linear" progress={reading.progress} size="small" />
            </View>
          </View>
        </GestureDetector>
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>페이지가 없습니다</Text>
        </View>
      )}

      {/* ── Floating chevron-left button — top left ──────────────────────── */}
      <Animated.View
        style={[styles.floatingBackBtn, { top: insets.top + 12 }, lastPageBtnAnimStyle]}
        pointerEvents={isOnLastPage || mode === "re_read" ? "auto" : "none"}
      >
        <Pressable onPress={handleFloatingBackBtn} hitSlop={16}>
          <Feather name="chevron-left" size={28} color={Colors.zinc700} />
        </Pressable>
      </Animated.View>

      {/* ── Memo FAB — bottom right (읽기 중에만 표시) ─────────────────── */}
      {!finishOverlayVisible && (
        <ScalePressable
          onPress={handleOpenMemo}
          hitSlop={8}
          style={[styles.memoFab, { bottom: insets.bottom + 24 }]}
          contentStyle={styles.memoFabContent}
        >
          <Feather name="edit-3" size={20} color={Colors.zinc600} />
        </ScalePressable>
      )}

      {/* ── Selection pill overlay ─────────────────────────────────────── */}
      {showSelectionPill && (
        <View
          style={[
            styles.selectionPillWrap,
            { bottom: insets.bottom + 80 + Math.max(0, (pageListSize.height - layout.frameHeight) / 2) },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.selectionPill}>
            <ScalePressable
              style={styles.selectionPillButton}
              onPress={() => {
                if (selectionPillDismissTimer.current) {
                  clearTimeout(selectionPillDismissTimer.current);
                  selectionPillDismissTimer.current = null;
                }
                showSelectionPillRef.current = false;
                isTextSelectingRef.current = false;
                const t = selectionPillText;
                setShowSelectionPill(false);
                setSelectionPillText("");
                handleCollectSentence(t);
                setClearSelectionSignal((n) => n + 1);
              }}
            contentStyle={styles.selectionPillButtonContent}
            >
              <Feather name="bookmark" size={14} color={Colors.zinc200} />
              <Text style={styles.selectionPillButtonText}>수집</Text>
            </ScalePressable>
            <ScalePressable
              style={styles.selectionPillButton}
              onPress={() => {
                if (selectionPillDismissTimer.current) {
                  clearTimeout(selectionPillDismissTimer.current);
                  selectionPillDismissTimer.current = null;
                }
                showSelectionPillRef.current = false;
                isTextSelectingRef.current = false;
                const t = selectionPillText;
                setShowSelectionPill(false);
                setSelectionPillText("");
                handleMemoSentence(t);
                setClearSelectionSignal((n) => n + 1);
              }}
            contentStyle={styles.selectionPillButtonContent}
            >
              <Feather name="edit-3" size={14} color={Colors.zinc200} />
              <Text style={styles.selectionPillButtonText}>메모</Text>
            </ScalePressable>
          </View>
        </View>
      )}

      <BottomSheet
        visible={sentencePopupVisible}
        onClose={handleCancelSentence}
        title="문장 저장"
        titleStyle={dynamicStyles.sheetTitle}
        snapPoints={[0.3]}
        dismissable={false}
        closeButton
      >
        <View style={styles.sentenceContent}>
          <Text style={dynamicStyles.sentencePreview} numberOfLines={3}>
            &ldquo;{selectedText}&rdquo;
          </Text>
          <View style={styles.sentenceActions}>
            <ScalePressable
              style={[styles.sentenceButton, styles.sentenceButtonCancel]}
              onPress={handleCancelSentence}
            contentStyle={styles.sentenceButtonContent}
            >
              <Text style={dynamicStyles.sentenceButtonCancelText}>취소</Text>
            </ScalePressable>
            <ScalePressable style={styles.sentenceButton} onPress={handleSaveSentence}
            contentStyle={styles.sentenceButtonContent}
            >
              <Feather name="bookmark" size={16} color={Colors.white} />
              <Text style={dynamicStyles.sentenceButtonText}>저장</Text>
            </ScalePressable>
          </View>
        </View>
      </BottomSheet>

      {/* ── 읽기 중 메모 시트 (스와이프업 / FAB으로 열림) ─── */}
      <BottomSheet
        visible={memoSheetVisible}
        onClose={() => {
          setMemoSheetVisible(false);
          setMemoAppendContent(undefined);
          readingMemo.closeWithBackgroundSave();
        }}
        snapPoints={[0.82]}
        enableDragDown={false}
        dismissable={false}
        keyboardAware
      >
        <View style={newMemoStyles.titleRow}>
          <TextInput
            style={newMemoStyles.titleInput}
            value={memoTitle}
            onChangeText={setMemoTitle}
            placeholder="제목"
            placeholderTextColor={Colors.zinc400}
            returnKeyType="done"
          />
          <Pressable
            onPress={() => {
              setMemoSheetVisible(false);
              setMemoAppendContent(undefined);
              readingMemo.closeWithBackgroundSave();
            }}
            hitSlop={8}
          >
            <Text style={newMemoStyles.closeText}>닫기</Text>
          </Pressable>
        </View>
        <View style={newMemoStyles.divider} />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={newMemoStyles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TextInput
            style={newMemoStyles.freeMemoInput}
            value={memoFreeMemo}
            onChangeText={setMemoFreeMemo}
            placeholder="자유롭게 메모하세요..."
            placeholderTextColor={Colors.zinc400}
            multiline
            textAlignVertical="top"
          />
        </ScrollView>
      </BottomSheet>

      {/* ── 질문 카드 플로팅 UI ──────────────────────────────────────── */}
      {finishOverlayVisible && (() => {
        const isCardNewCard = cardPtr === cardSaved.length;
        const cardCurrentQIdx = isCardNewCard
          ? cardSeq % QUESTION_BLOCK_QUESTIONS.length
          : (cardSaved[cardPtr]?.qIdx ?? 0);
        const cardCurrentQ = QUESTION_BLOCK_QUESTIONS[cardCurrentQIdx];
        const cardCurrentAnswer = isCardNewCard ? cardNewAnswer : (cardSaved[cardPtr]?.answer ?? "");

        const cardStyle: object = {
          position: "absolute" as const,
          top: "50%" as any,
          marginTop: -(cardSmallH / 2),
          left: cardSmallLeft,
          width: cardSmallW,
          height: cardSmallH,
          borderRadius: 20,
          backgroundColor: Colors.white,
          overflow: "hidden" as const,
          zIndex: 10,
          ...Platform.select({
            web: { boxShadow: "0 4px 40px rgba(0,0,0,0.16), 0 1px 8px rgba(0,0,0,0.08)" } as object,
            default: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.16, shadowRadius: 20, elevation: 10 },
          }),
        };

        return (
          <>
            <View style={floatingCardStyles.dim} pointerEvents="none" />
            <GestureDetector gesture={cardPanGesture}>
              <View style={floatingCardStyles.gestureLayer}>
                {/* 현재 카드 */}
                <Animated.View style={[cardStyle, cardAnimStyle]}>
                  <View style={floatingCardStyles.cardInner}>
                    <Text style={floatingCardStyles.questionText}>{cardCurrentQ}</Text>
                    <TextInput
                      style={floatingCardStyles.answerInput}
                      value={cardCurrentAnswer}
                      onChangeText={(v) => {
                        if (isCardNewCard) {
                          setCardNewAnswer(v);
                          cardNewAnswerRef.current = v;
                        } else {
                          setCardSaved((prev) =>
                            prev.map((c, i) => (i === cardPtr ? { ...c, answer: v } : c)),
                          );
                        }
                      }}
                      placeholder="생각을 자유롭게 적어보세요..."
                      placeholderTextColor={Colors.zinc400}
                      multiline
                      textAlignVertical="top"
                    />
                  </View>
                </Animated.View>
                {/* 전환 중 들어오는 카드 */}
                {cardIncoming !== null && (
                  <Animated.View style={[cardStyle, { zIndex: 9 }, incomingCardAnimStyle]}>
                    <View style={floatingCardStyles.cardInner}>
                      <Text style={floatingCardStyles.questionText}>{cardIncoming.question}</Text>
                      <TextInput
                        style={floatingCardStyles.answerInput}
                        value={cardIncoming.answer}
                        editable={false}
                        placeholder="생각을 자유롭게 적어보세요..."
                        placeholderTextColor={Colors.zinc400}
                        multiline
                        textAlignVertical="top"
                      />
                    </View>
                  </Animated.View>
                )}
              </View>
            </GestureDetector>
            {/* ── 마침 버튼 — 카드 레이어 위에 렌더링 ──────────────────── */}
            <Pressable
              onPress={() => {
                setFinishOverlayVisible(false);
                setFinishSheetVisible(true);
              }}
              hitSlop={8}
              style={[styles.finishBtn, { bottom: insets.bottom + 24, zIndex: 50 }]}
            >
              <Text style={styles.finishBtnText}>마침</Text>
            </Pressable>
          </>
        );
      })()}

      {/* ── 마침 BottomSheet — 저장 / 나가기 ──────────────────────────── */}
      <BottomSheet
        visible={finishSheetVisible}
        onClose={() => {
          setFinishSheetVisible(false);
          setFinishOverlayVisible(true);
        }}
        title="읽기 완료"
        titleStyle={dynamicStyles.sheetTitle}
        snapPoints={[0.3]}
        dismissable={false}
      >
        <View style={finishSheetStyles.content}>
          <ScalePressable
            style={[styles.completionButton, (isSaving || !isCollectionsReady) && styles.completionButtonDisabled]}
            onPress={handleCommitAndSave}
            disabled={isSaving}
            contentStyle={styles.completionButtonContent}
          >
            <Text style={dynamicStyles.completionButtonText}>
              {isSaving ? "저장 중..." : !isCollectionsReady ? "불러오는 중..." : "보관함에 저장"}
            </Text>
          </ScalePressable>
          <ScalePressable
            style={[styles.completionButton, styles.completionButtonSecondary, isDeleting && styles.completionButtonDisabled]}
            onPress={mode === "re_read"
              ? async () => {
                  setFinishSheetVisible(false);
                  await readingMemo.cleanup();
                  overlayOpacity.value = withTiming(1, { duration: 350, easing: Easing.in(Easing.ease) }, (finished) => {
                    if (finished) runOnJS(router.back)();
                  });
                }
              : handleCommitAndSkip}
            disabled={!mode || (mode !== "re_read" && isDeleting)}
            contentStyle={styles.completionButtonContent}
          >
            <Text style={dynamicStyles.completionButtonSecondaryText}>
              {mode !== "re_read" && isDeleting ? "처리 중..." : "저장 없이 나가기"}
            </Text>
          </ScalePressable>
        </View>
      </BottomSheet>

      {/* ── 진입/퇴장 검은 오버레이 ──────────────────────────────────── */}
      <Animated.View
        style={[styles.blackOverlay, overlayAnimStyle]}
        pointerEvents="none"
      />

      <ConfirmModal
        visible={exitConfirmVisible}
        title="읽기 중"
        description="완독 후 보관 여부를 선택해주세요."
        confirmLabel="확인"
        onConfirm={() => setExitConfirmVisible(false)}
        onCancel={() => setExitConfirmVisible(false)}
      />

      <ConfirmModal
        visible={!!duplicatePrompt}
        title="같은 편지가 더 있어요"
        description={
          duplicatePrompt
            ? `수신함에 같은 편지가 ${duplicatePrompt.count}개 더 있어요. 모두 미보관 읽음 처리할까요?`
            : ""
        }
        confirmLabel={isMarkingOthers ? "처리 중..." : "네, 모두 읽음"}
        cancelLabel="아니요"
        onConfirm={handleConfirmMarkOthers}
        onCancel={handleCancelMarkOthers}
        onBackdropPress={handleCancelMarkOthers}
      />
    </View>
  );
}

const newMemoStyles = StyleSheet.create({
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 8,
  },
  titleInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Pretendard-SemiBold",
    fontWeight: "700",
    color: Colors.zinc800,
    marginRight: 12,
    padding: 0,
  },
  closeText: {
    fontSize: 14,
    fontFamily: "Pretendard",
    color: Colors.zinc400,
    flexShrink: 0,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.zinc100,
    marginHorizontal: 16,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  freeMemoContainer: {
    marginTop: 12,
  },
  freeMemoSeparator: {
    height: 1,
    backgroundColor: Colors.zinc100,
    marginBottom: 12,
  },
  freeMemoInput: {
    fontSize: 14,
    fontFamily: "Eulyoo1945-Regular",
    color: Colors.zinc700,
    lineHeight: 26,
    minHeight: 80,
    textAlignVertical: "top",
    backgroundColor: "transparent",
    padding: 0,
  },
});


const floatingCardStyles = StyleSheet.create({
  dim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.28)",
    zIndex: 40,
  },
  gestureLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 41,
  },
  cardInner: {
    flex: 1,
    padding: 28,
    paddingBottom: 24,
  },
  questionText: {
    fontSize: 18,
    fontFamily: ReaderTokens.fontFamily.serif,
    fontWeight: "400",
    color: Colors.zinc900,
    lineHeight: 28,
    letterSpacing: 0.3,
    marginBottom: 20,
  },
  answerInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: ReaderTokens.fontFamily.serif,
    color: Colors.zinc700,
    lineHeight: 28,
    letterSpacing: 0.5,
    textAlignVertical: "top",
    padding: 0,
    backgroundColor: "transparent",
    borderWidth: 0,
  },
});

const finishSheetStyles = StyleSheet.create({
  content: {
    paddingVertical: 12,
    gap: 10,
  },
});

interface ReaderLayout {
  containerWidth: number;
  containerHeight: number;
  frameWidth: number;
  frameHeight: number;
  scaleFactor: number;
  paddingX: number;
  paddingY: number;
  safeAreaWidth: number;
  safeAreaHeight: number;
  /** Explicit integer pixel width for the text column (safeAreaWidth - 2*paddingX, rounded).
   *  Use this as the width constraint for text containers instead of relying on
   *  paddingHorizontal, so Yoga pixel-snapping is consistent across different parent positions. */
  textColumnWidth: number;
  bodyFontSize: number;
  captionFontSize: number;
  metadataFontSize: number;
  bodyLineHeight: number;
  bodyLetterSpacing: number;
  titleLineHeight: number;
  titleLetterSpacing: number;
  titleBarHeight: number;
}

const PageView = React.memo(function PageView({
  content,
  onTextSelect,
  onDragStateChange,
  bottomInset,
  layout,
  clearSignal,
}: {
  content: string;
  onTextSelect?: (text: string, isEmpty: boolean) => void;
  onDragStateChange?: (isDragging: boolean) => void;
  bottomInset: number;
  layout: ReaderLayout;
  clearSignal?: number;
}) {
  const dynamicPageStyles = useMemo(
    () =>
      StyleSheet.create({
        safeAreaBox: {
          width: layout.safeAreaWidth,
          alignSelf: "center" as const,
          flex: 1,
        },
        pageContent: {
          flex: 1,
          paddingHorizontal: layout.paddingX,
          paddingTop: layout.paddingY,
          paddingBottom: bottomInset + layout.paddingY + layout.titleBarHeight,
        },
        textColumn: {
          width: layout.textColumnWidth,
          flex: 1,
        },
      }),
    [layout.safeAreaWidth, layout.paddingX, layout.paddingY, layout.titleBarHeight, layout.textColumnWidth, bottomInset],
  );

  return (
    <View style={[styles.pageContainer, { flex: 1 }]}>
      <View style={dynamicPageStyles.safeAreaBox}>
        <View style={dynamicPageStyles.pageContent}>
          <View style={dynamicPageStyles.textColumn}>
            <WebViewMarkdownReader
              markdown={content}
              bodyFontSize={layout.bodyFontSize}
              bodyLetterSpacing={layout.bodyLetterSpacing}
              onTextSelect={onTextSelect}
              onDragStateChange={onDragStateChange}
              clearSelectionSignal={clearSignal}
            />
          </View>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ReaderTokens.bodyBg,
    overflow: "hidden",
  },
  floatingBackBtn: {
    position: "absolute",
    left: Spacing.screenPx,
    zIndex: 30,
  },
  memoFab: {
    position: "absolute",
    right: 20,
    zIndex: 30,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.10,
        shadowRadius: 8,
      },
      android: { elevation: 3 },
      default: {},
    }),
  },
  memoFabContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  progressBarContainer: {
    width: "90%",
    alignSelf: "center",
    marginTop: 14,
  },
  blackOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#000",
    zIndex: 999,
    pointerEvents: "none",
  },
  pageContainer: {
    overflow: "hidden",
    justifyContent: "center",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600" as const,
    fontFamily: ReaderTokens.fontFamily.sansSemiBold,
    color: Colors.zinc900,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: ReaderTokens.fontFamily.sans,
    color: Colors.zinc500,
    marginTop: 8,
  },
  completionContent: {
    paddingVertical: 16,
    gap: 12,
  },
  completionIcon: {
    marginBottom: 4,
  },
  completionButton: {
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: "100%",
  },
  completionButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flexGrow: 0,
  },
  completionButtonSecondary: {
    backgroundColor: Colors.zinc100,
  },
  completionButtonDisabled: {
    opacity: 0.6,
  },
  sentenceContent: {
    paddingVertical: 12,
    gap: 16,
  },
  sentenceActions: {
    flexDirection: "row",
    gap: 12,
  },
  sentenceButton: {
    flex: 1,
    backgroundColor: Colors.zinc900,
    borderRadius: 10,
    paddingVertical: 12,
  },
  sentenceButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,},
  sentenceButtonCancel: {
    backgroundColor: Colors.zinc100,
  },
  memoContent: {
    paddingVertical: 12,
    gap: 12,
  },
  collectionSelector: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.zinc50,
  },
  collectionSelectorContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexGrow: 0,
  },
  collectionSelectorText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Pretendard",
    color: Colors.zinc700,
  },
  completionButtonTertiary: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.zinc200,
  },
  completionButtonTertiaryContent: {
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 0,
  },
  coverPageContainer: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 16,
  },
  pageListContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  readerShadowWrapper: {
    alignSelf: "center",
  },
  readerFrame: {
    alignSelf: "center",
    backgroundColor: ReaderTokens.bodyBg,
  },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 14,
    gap: 14,
    backgroundColor: ReaderTokens.bodyBg,
  },
  bottomProgressContainer: {
    flex: 1,
  },
  bottomMemoButton: {
    width: 40,
    height: 40,
  },
  bottomMemoButtonContent: {
    alignItems: "center",
    justifyContent: "center",},
  selectionPillWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 200,
  },
  selectionPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.zinc800,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    marginBottom: 8,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
      default: {},
    }),
  },
  selectionPillButton: {
    backgroundColor: Colors.zinc700,
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  selectionPillButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,},
  selectionPillButtonText: {
    fontSize: 12,
    fontFamily: ReaderTokens.fontFamily.sansSemiBold,
    color: Colors.zinc200,
    fontWeight: "600",
  },
  completeButtonContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: 20,
  },
  completeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    gap: 8,
    width: "100%",
  },
  finishBtn: {
    position: "absolute",
    right: 20,
    zIndex: 42,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: Colors.zinc800,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 8,
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  finishBtnText: {
    fontSize: 15,
    fontFamily: ReaderTokens.fontFamily.sansSemiBold,
    fontWeight: "600",
    color: Colors.white,
    letterSpacing: 0.3,
  },
});
