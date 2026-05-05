import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  TextInput,
  ActivityIndicator,
  BackHandler,
  Alert,
  AppState,
  Platform,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
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
  cqiToPx,
  readerFontSize,
  readerLetterSpacing,
} from "@/constants/tokens";
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
} from "@workspace/api-client-react";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import { useUser } from "@/contexts/UserContext";
import { useActiveReading } from "@/contexts/ActiveReadingContext";
import type { ReadingMode } from "@/lib/policies";
import MemoBottomSheet from "@/components/MemoBottomSheet/MemoBottomSheet";

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

  const paddingX = cqiToPx(ReaderTokens.padding.xCqi, containerWidth);
  const paddingY = cqiToPx(ReaderTokens.padding.yCqi, containerWidth);

  const safeAreaWidth = cqiToPx(
    ReaderTokens.safeArea.widthCqi,
    containerWidth,
  );
  const safeAreaHeight = cqiToPx(
    ReaderTokens.safeArea.heightCqi,
    containerWidth,
  );

  const bodyFontSize = readerFontSize(
    ReaderTokens.typeScale.bodyCqi,
    containerWidth,
  );
  const captionFontSize = readerFontSize(
    ReaderTokens.typeScale.captionCqi,
    containerWidth,
  );
  const metadataFontSize = readerFontSize(
    ReaderTokens.typeScale.metadataCqi,
    containerWidth,
  );

  const bodyLineHeight = bodyFontSize * ReaderTokens.lineHeight.relaxed;
  const bodyLetterSpacing = readerLetterSpacing(
    ReaderTokens.letterSpacing.relaxedEm,
    bodyFontSize,
  );

  const titleLineHeight = bodyFontSize * ReaderTokens.lineHeight.tight;
  const titleLetterSpacing = readerLetterSpacing(
    ReaderTokens.letterSpacing.tightEm,
    bodyFontSize,
  );

  // Reserve space for the title bar overlay at the bottom of the page
  // Formula: paddingTop(8) + captionFontSize * iOS line height factor(~1.3) + paddingBottom(12)
  const titleBarHeight = Math.round(20 + captionFontSize * 1.3);

  // Explicit integer pixel width of the text column.
  // Computed once here so every consumer (PageView, PretextMeasureLayer, on-01c preview)
  // uses the same integer and Yoga pixel-snapping cannot diverge across different parent positions.
  const textColumnWidth = Math.round(safeAreaWidth - 2 * paddingX);

  return {
    containerWidth,
    containerHeight,
    frameWidth,
    frameHeight,
    scaleFactor,
    paddingX,
    paddingY,
    safeAreaWidth,
    safeAreaHeight,
    textColumnWidth,
    bodyFontSize,
    captionFontSize,
    metadataFontSize,
    bodyLineHeight,
    bodyLetterSpacing,
    titleLineHeight,
    titleLetterSpacing,
    titleBarHeight,
  };
}

export default function ReadScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const queryClient = useQueryClient();
  const { userId } = useUser();
  const { setActiveSession, clearActiveSession } = useActiveReading();
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
  // True when the user opens an article for the first time via a collection
  // article list rather than via the inbox. In this case the completion CTA's
  // secondary action is labeled "보관 안 함"; via the inbox path it is "나가기".
  // In both cases the underlying action is non-destructive (no permanent delete).
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
    ? Math.min(reading.session.position.currentPage, totalPages - 1)
    : reading.session.position.currentPage;
  const isOnCoverPage = currentPage === 0;
  const contentPageIndex = Math.max(0, currentPage - 1);
  const isOnLastPage = totalPages > 0 && currentPage >= totalPages - 1;


  const [completionSheetVisible, setCompletionSheetVisible] = useState(false);
  const [sentencePopupVisible, setSentencePopupVisible] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0);
  const [memoSheetVisible, setMemoSheetVisible] = useState(false);
  const [memoAppendContent, setMemoAppendContent] = useState<string | undefined>(undefined);
  const [collectionPickerMode, setCollectionPickerMode] = useState(false);
  const [pickerTab, setPickerTab] = useState<"list" | "create">("list");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionDesc, setNewCollectionDesc] = useState("");
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  useEffect(() => {
    if (!completionSheetVisible) {
      setCollectionPickerMode(false);
      setPickerTab("list");
      setNewCollectionName("");
      setNewCollectionDesc("");
    }
  }, [completionSheetVisible]);
  const [showSelectionPill, setShowSelectionPill] = useState(false);
  const [selectionPillText, setSelectionPillText] = useState("");
  const [bottomBarHeight, setBottomBarHeight] = useState(70);

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
        pageListSize.width > 0 ? pageListSize.width : screenWidth,
        pageListSize.height > 0 ? pageListSize.height : screenWidth / ReaderTokens.aspectRatio,
        effectiveLayoutWidth,
      ),
    [pageListSize.width, pageListSize.height, screenWidth, effectiveLayoutWidth],
  );
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
      queryClient.invalidateQueries({
        queryKey: getListInboxQueryKey({ recipientId: userId, isRead: false } as Parameters<typeof getListInboxQueryKey>[0]),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
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
  });

  const handleOpenMemo = useCallback(() => {
    setMemoSheetVisible(true);
  }, []);

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

  // Fire app_backgrounded_during_reading when OS suspends the app mid-read
  useEffect(() => {
    console.log("[Analytics] AppState listener registered — articleId:", articleId, "state:", reading.session.state);
    const sub = AppState.addEventListener("change", (nextState) => {
      console.log("[Analytics] AppState changed →", nextState, "| session:", reading.session.state, "| page:", currentPage, "/", totalPages);
      if (
        nextState === "background" &&
        (reading.session.state === "READING" || reading.session.state === "PAUSED")
      ) {
        console.log("[Analytics] Firing app_backgrounded_during_reading, flushing PostHog…");
        trackAppBackgroundedDuringReading({ articleId, currentPage, totalPages });
      }
    });
    return () => {
      console.log("[Analytics] AppState listener removed — articleId:", articleId);
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
      if (recentId && collections?.some((c: { id: string }) => c.id === recentId)) {
        setSelectedCollectionId(recentId);
      } else if (collections && collections.length > 0) {
        setSelectedCollectionId(collections[0].id);
      } else {
        setSelectedCollectionId(undefined);
      }
      setCompletionSheetVisible(true);
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
        Alert.alert("읽기 중", "완독 후 보관 여부를 선택해주세요.");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [mode, reading.canExit, isListEntry]);


  const handleBack = useCallback(async () => {
    if (mode === "basic" && !reading.canExit) {
      Alert.alert("읽기 중", "완독 후 보관 여부를 선택해주세요.");
      return;
    }
    if (reading.session.state === "READING" || reading.session.state === "PAUSED") {
      reading.pause();
    }
    await readingMemo.cleanup();
    router.back();
  }, [mode, isListEntry, reading, router, readingMemo]);

  const canNavigate = mode === "re_read" || reading.session.state === "READING";

  const articleCover = useMemo(
    () => (article?.cover ? resolveArticleCover(article.cover) : null),
    [article?.cover],
  );
  const hasCover = articleCover !== null && articleCover.type !== "default";
  const showingCover = hasCover && currentPage === 0;
  // Whether the current slot shows the title bar at the bottom
  const showTitleBar = !isOnCoverPage && !showingCover && !!article;

  useLayoutEffect(() => {
    if (!articleLoading && !hasCover && currentPage === 0 && reading.isSessionHydrated && !reading.isRestoring && totalPages > 1) {
      jumpToPageRef.current(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleLoading, hasCover, currentPage, reading.isSessionHydrated, reading.isRestoring, totalPages]);

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
    // When there is no cover, page 0 is an empty slot — block navigation back to it
    if (!hasCover && currentPage <= 1) return;
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
  // translateXSV positions the row of absolute-positioned page slots so that
  // `currentPage` sits at viewport center. Baseline = -currentPage * W; gesture
  // adds a delta on top. Because each slot is keyed by its absolute page index
  // (and absolutely positioned at left = pageIndex * W), the WebView that the
  // user is actually looking at during a swipe is the *same* React instance
  // before and after the page turn — no re-injection, no snap-back, no flash.
  const translateXSV = useSharedValue(-currentPage * layout.containerWidth);
  // baselineXSV mirrors -currentPage * W so the gesture worklet can compute
  // absolute targets without reading JS-side state.
  const baselineXSV = useSharedValue(-currentPage * layout.containerWidth);

  const containerWidthRef = useRef(layout.containerWidth);
  useEffect(() => { containerWidthRef.current = layout.containerWidth; }, [layout.containerWidth]);
  const canNavigateRef = useRef(canNavigate);
  useEffect(() => { canNavigateRef.current = canNavigate; }, [canNavigate]);
  const currentPageRef = useRef(currentPage);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  const isOnLastPageRef = useRef(isOnLastPage);
  useEffect(() => { isOnLastPageRef.current = isOnLastPage; }, [isOnLastPage]);
  const hasCoverRef = useRef(hasCover);
  useEffect(() => { hasCoverRef.current = hasCover; }, [hasCover]);
  const jumpToPageRef = useRef(reading.jumpToPage);
  useLayoutEffect(() => { jumpToPageRef.current = reading.jumpToPage; });

  // Animated style for the row container
  const rowAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateXSV.value }],
  }));

  // Sync baseline + translateX whenever currentPage / W changes externally
  // (e.g. jumpToPage, layout change). After a successful gesture commit the
  // animation already lands on the new baseline so this is a no-op there.
  useLayoutEffect(() => {
    const W = layout.containerWidth;
    const target = -currentPage * W;
    baselineXSV.value = target;
    translateXSV.value = target;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, layout.containerWidth]);

  // ── Gesture state ref (always fresh, avoids stale closure in useMemo) ────
  const gestureState = useRef({
    canNavigate: false,
    isOnLastPage: false,
    atBoundaryLeft: true,
    containerWidth: 300,
    isTextSelecting: false,
    isDragging: false,
    isCommitting: false,
  });
  gestureState.current = {
    canNavigate,
    isOnLastPage,
    atBoundaryLeft: currentPage === 0 || (!hasCover && currentPage <= 1),
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
      if (direction === -1) handleSwipeLeftRef.current();
      else handleSwipeRightRef.current();
      // translateXSV resets in useLayoutEffect after currentPage changes
    };
  }, []);
  useEffect(() => {
    openMemoRef.current = () => handleOpenMemo();
  }, [handleOpenMemo]);

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
      if (isDraggingRef.current || isTextSelectingRef.current) return;
    })
    .onUpdate((e) => {
      if (isDraggingRef.current || isTextSelectingRef.current || isCommittingRef.current) return;
      const gs = gestureState.current;

      const dx = e.translationX;
      const dy = e.translationY;
      // Only track horizontal movement for page sliding
      if (Math.abs(dy) > Math.abs(dx) * 1.8) return;

      if (dx < 0 && gs.isOnLastPage) return;  // no next on last page
      if (dx > 0 && gs.atBoundaryLeft) return; // no prev at start

      translateXSV.value = baselineXSV.value + dx;
    })
    .onEnd((e) => {
      if (isCommittingRef.current) return;
      if (isDraggingRef.current || isTextSelectingRef.current) {
        translateXSV.value = withSpring(baselineXSV.value, snapConfig);
        return;
      }

      const gs = gestureState.current;
      const dx = e.translationX;
      const dy = e.translationY;
      const absDx = Math.abs(dx);
      const W = gs.containerWidth || 300;
      const baseline = baselineXSV.value;

      // Upward swipe → open memo sheet
      if (dy < -50 && Math.abs(dy) > absDx * 1.5) {
        translateXSV.value = withSpring(baseline, snapConfig);
        runOnJS(openMemoRef.current)();
        return;
      }

      if (!gs.canNavigate) {
        translateXSV.value = withSpring(baseline, snapConfig);
        return;
      }

      const goingNext = dx < 0;

      // Boundary checks
      if (goingNext && gs.isOnLastPage) {
        translateXSV.value = withSpring(baseline, snapConfig);
        // Trigger completion (no swipe animation needed)
        runOnJS(handleSwipeLeftRef.current)();
        return;
      }
      if (!goingNext && gs.atBoundaryLeft) {
        translateXSV.value = withSpring(baseline, snapConfig);
        return;
      }

      const THRESHOLD = W * 0.22;
      const VELOCITY_THRESHOLD = 450;
      const shouldCommit = absDx > THRESHOLD || Math.abs(e.velocityX) > VELOCITY_THRESHOLD;

      if (!shouldCommit) {
        translateXSV.value = withSpring(baseline, snapConfig);
        return;
      }

      const direction: -1 | 1 = goingNext ? -1 : 1;
      isCommittingRef.current = true;

      // Animate the row to the new page's absolute baseline. After this lands,
      // useLayoutEffect (currentPage dep) will re-set translateX to the same
      // value, so there is no visible snap when React commits the new window.
      translateXSV.value = withTiming(baseline + direction * W, {
        duration: 240,
        easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
      }, () => {
        runOnJS(finishPageTurnRef.current)(direction);
      });
    })
    .onFinalize(() => {
      // If gesture is cancelled externally, snap back to baseline
      if (!isCommittingRef.current) {
        translateXSV.value = withSpring(baselineXSV.value, snapConfig);
      }
    });
  }, []);

  const tapGesture = useMemo(() => Gesture.Tap()
    .runOnJS(true)
    .onEnd((_e, success) => {
      if (success && isTextSelectingRef.current) {
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
      Alert.alert("알림", "보관함 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    setIsSaving(true);
    try {
      const result = await reading.commitCompletion();
      if (!result.success) {
        Alert.alert("오류", result.error ?? "완독 처리에 실패했습니다.");
        return;
      }

      let targetCollectionId: string | undefined = selectedCollectionId;
      if (!targetCollectionId) {
        const collections = collectionsQuery.data;
        if (collections && collections.length > 0) {
          targetCollectionId = collections[0].id;
        } else {
          try {
            const newCol = await createCollection.mutateAsync({
              data: { ownerId: userId, name: "보관함" },
            });
            targetCollectionId = newCol.id;
          } catch {
            Alert.alert("알림", "완독 기록은 저장했지만 보관함 생성에 실패했습니다.");
          }
        }
      }

      if (targetCollectionId && articleId) {
        try {
          await addToCollection.mutateAsync({
            id: targetCollectionId,
            data: { articleId },
          });
          queryClient.invalidateQueries({ queryKey: ["/api/my-collections"] });
          try {
            await updateRecentCollection.mutateAsync({
              id: userId,
              data: { collectionId: targetCollectionId },
            });
            queryClient.invalidateQueries({
              queryKey: getGetUserRecentCollectionQueryKey(userId),
            });
          } catch (e) {
            console.warn("[handleCommitAndSave] recent collection update failed (non-fatal):", e);
          }
        } catch {
          Alert.alert("알림", "완독 기록은 저장했지만 보관함 추가에 실패했습니다.");
        }
      }

      setCompletionSheetVisible(false);
      trackArticleAction({ articleId, action: "save", msSinceComplete: Date.now() - completionTimeRef.current });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      clearActiveSession();
      await readingMemo.cleanup();
      router.back();
      Alert.alert("완료", "보관함에 저장됐어요");
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, isCollectionsReady, reading, selectedCollectionId, collectionsQuery.data, articleId, userId, createCollection, addToCollection, updateRecentCollection, queryClient, clearActiveSession, router, readingMemo]);

  const handleCommitAndSkip = useCallback(async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      const result = await reading.commitCompletion();
      setCompletionSheetVisible(false);
      if (result.success) {
        trackArticleAction({ articleId, action: "skip", msSinceComplete: Date.now() - completionTimeRef.current });
        if (!isListEntry) {
          // 수신함 경로: 읽기 완료 후 수신함 목록 갱신
          queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
        }
        clearActiveSession();
        await readingMemo.cleanup();
        promptOrContinue(() => {
          router.back();
          Alert.alert("완료", "읽기를 완료했어요");
        });
      } else {
        Alert.alert("오류", result.error ?? "완독 처리에 실패했습니다.");
      }
    } finally {
      setIsDeleting(false);
    }
  }, [isDeleting, isListEntry, reading, router, clearActiveSession, queryClient, readingMemo, articleId, promptOrContinue]);

  const handleTextSelect = useCallback((text: string, isEmpty: boolean) => {
    isTextSelectingRef.current = !isEmpty;
    if (!isEmpty && text) {
      setSelectionPillText(text);
      setShowSelectionPill(true);
    } else {
      setShowSelectionPill(false);
    }
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
      queryClient.invalidateQueries({ queryKey: ["/api/stored-sentences"] });
      trackSentenceCollected({ articleId, page: contentPageIndex, textLength: selectedText.length });
      setSentencePopupVisible(false);
      setSelectedText("");
      Alert.alert("저장 완료", "문장이 저장되었습니다.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "문장 저장에 실패했습니다.";
      Alert.alert("오류", msg);
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
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen
        options={{
          headerShown: false,
          gestureEnabled: false,
        }}
      />
      {(mode === "re_read" || (mode === "basic" && reading.canExit)) && (
        <View style={styles.header}>
          <Pressable onPress={handleBack} hitSlop={12} style={styles.backButton}>
            <Feather name="arrow-left" size={20} color={Colors.zinc600} />
          </Pressable>
        </View>
      )}

      {totalPages > 0 ? (
        <GestureDetector gesture={combinedGesture}>
          <View
            style={[styles.pageListContainer, Platform.OS === "web" ? { touchAction: "none" } as object : undefined]}
            onLayout={handlePageListLayout}
          >
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
                  backgroundColor: ReaderTokens.bodyBg,
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
                overflow: "hidden",
              }}>
                {/* Windowed page slots, absolutely positioned at left = pageIndex * W.
                    Each slot is keyed by its absolute page index, so when currentPage
                    changes from N to N+1 the WebView the user is looking at keeps
                    the same React identity (and the same DOM content) — only the
                    off-screen edge slot is mounted/unmounted. translateX slides the
                    whole row; baseline = -currentPage * W so no snap-back is needed
                    after a page turn (the animation lands exactly on the new
                    baseline). This eliminates the flicker that happened when the
                    "current slot" WebView received a new markdown prop and had to
                    re-inject content via the JS bridge. */}
                <Animated.View
                  style={[
                    {
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: layout.containerWidth,
                      height: layout.containerHeight,
                    },
                    rowAnimStyle,
                  ]}
                  pointerEvents="box-none"
                >
                  {(() => {
                    const slots: React.ReactNode[] = [];
                    // Render a small window around currentPage. We keep the
                    // immediate neighbours mounted so swipes show pre-rendered
                    // content, and unmount everything else to bound memory.
                    const minIdx = hasCover ? 0 : 1;
                    const start = Math.max(minIdx, currentPage - 1);
                    const end = Math.min(totalPages - 1, currentPage + 1);
                    for (let pageIdx = start; pageIdx <= end; pageIdx++) {
                      const isCover = pageIdx === 0 && hasCover;
                      const cIdx = pageIdx - 1;
                      const node = isCover ? (
                        <CoverPage
                          cover={cover}
                          title={article?.title ?? ""}
                          authorName={authorName}
                          containerWidth={layout.containerWidth}
                          containerHeight={layout.containerHeight}
                        />
                      ) : (cIdx >= 0 && cIdx < contentPages.length ? (
                        <PageView
                          content={contentPages[cIdx]}
                          onTextSelect={handleTextSelect}
                          onDragStateChange={handleDragStateChange}
                          bottomInset={insets.bottom}
                          layout={layout}
                          clearSignal={clearSelectionSignal}
                        />
                      ) : null);
                      if (!node) continue;
                      slots.push(
                        <View
                          key={`page-${pageIdx}`}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: pageIdx * layout.containerWidth,
                            width: layout.containerWidth,
                            height: layout.containerHeight,
                          }}
                        >
                          {node}
                        </View>,
                      );
                    }
                    return slots;
                  })()}
                </Animated.View>

                {/* Title bar: fixed overlay at bottom of scale wrapper.
                    Lives OUTSIDE the 3-slot animated row so it never causes
                    layout shifts when article data loads or page changes. */}
                {showTitleBar && (
                  <View style={[styles.titleBar, { position: "absolute", bottom: 0, left: 0, right: 0 }]} pointerEvents="none">
                    <Text style={dynamicStyles.articleTitle} numberOfLines={1}>{article!.title}</Text>
                    {mode === "re_read" && (
                      <View style={styles.modeBadge}>
                        <Text style={dynamicStyles.modeBadgeText}>다시읽기</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            </View>
            </View>
          </View>
        </GestureDetector>
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>페이지가 없습니다</Text>
        </View>
      )}

      {/* ── Selection pill overlay — fixed above the bottom bar ─────────── */}
      {showSelectionPill && (
        <View
          style={[
            styles.selectionPillWrap,
            { bottom: insets.bottom + bottomBarHeight + Math.max(0, (pageListSize.height - layout.frameHeight) / 2) + layout.titleBarHeight + 12 },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.selectionPill}>
            <Pressable
              style={styles.selectionPillButton}
              onPress={() => {
                const t = selectionPillText;
                setShowSelectionPill(false);
                setSelectionPillText("");
                handleCollectSentence(t);
                setClearSelectionSignal((n) => n + 1);
              }}
            >
              <Feather name="bookmark" size={14} color={Colors.zinc200} />
              <Text style={styles.selectionPillButtonText}>수집</Text>
            </Pressable>
            <Pressable
              style={styles.selectionPillButton}
              onPress={() => {
                const t = selectionPillText;
                setShowSelectionPill(false);
                setSelectionPillText("");
                handleMemoSentence(t);
                setClearSelectionSignal((n) => n + 1);
              }}
            >
              <Feather name="edit-3" size={14} color={Colors.zinc200} />
              <Text style={styles.selectionPillButtonText}>메모</Text>
            </Pressable>
          </View>
        </View>
      )}

      <View
        style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          setBottomBarHeight((prev) => (prev === h ? prev : h));
        }}
      >
        <View style={styles.bottomProgressContainer}>
          <ProgressIndicator type="linear" progress={reading.progress} size="small" />
        </View>
        <Pressable
          onPress={handleOpenMemo}
          hitSlop={16}
          style={styles.bottomMemoButton}
        >
          <Feather name="edit-3" size={20} color={Colors.zinc600} />
        </Pressable>
      </View>

      <BottomSheet
        visible={completionSheetVisible}
        onClose={() => {
          if (collectionPickerMode) {
            setCollectionPickerMode(false);
            return;
          }
          if (mode === "re_read") {
            setCompletionSheetVisible(false);
          } else {
            reading.continueReading();
            setCompletionSheetVisible(false);
          }
        }}
        snapPoints={collectionPickerMode ? [0.75] : (mode === "re_read" ? [0.28] : [0.5])}
        enableDragDown={mode === "re_read" && !collectionPickerMode}
        dismissable={true}
        keyboardAware={collectionPickerMode && pickerTab === "create"}
      >
        {collectionPickerMode ? (
          <View style={styles.pickerContainer}>
            <Pressable
              style={styles.pickerBackRow}
              onPress={() => {
                if (pickerTab === "create") {
                  setPickerTab("list");
                  setNewCollectionName("");
                  setNewCollectionDesc("");
                } else {
                  setCollectionPickerMode(false);
                }
              }}
            >
              <Feather name="chevron-left" size={18} color={Colors.zinc600} />
              <Text style={styles.pickerBackText}>보관할 모음 선택</Text>
            </Pressable>

            <View style={styles.pickerTabBar}>
              <Pressable
                style={[styles.pickerTab, pickerTab === "list" && styles.pickerTabActive]}
                onPress={() => setPickerTab("list")}
              >
                <Text style={[styles.pickerTabText, pickerTab === "list" && styles.pickerTabTextActive]}>
                  내 모음
                </Text>
              </Pressable>
              <Pressable
                style={[styles.pickerTab, pickerTab === "create" && styles.pickerTabActive]}
                onPress={() => setPickerTab("create")}
              >
                <Text style={[styles.pickerTabText, pickerTab === "create" && styles.pickerTabTextActive]}>
                  새 모음에 추가
                </Text>
              </Pressable>
            </View>

            {pickerTab === "list" ? (
              <FlatList
                data={
                  (collectionsQuery.data ?? [])
                    .filter((c: { id: string; name: string; isArchive?: boolean }) => !c.isArchive)
                    .map((c: { id: string; name: string; articleCount?: number }) => ({
                      id: c.id, name: c.name, articleCount: c.articleCount,
                    }))
                }
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => {
                  const isSelected = item.id === selectedCollectionId;
                  return (
                    <Pressable
                      style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                      onPress={() => {
                        setSelectedCollectionId(item.id);
                        updateRecentCollection.mutate(
                          { id: userId, data: { collectionId: item.id } },
                          {
                            onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetUserRecentCollectionQueryKey(userId) }),
                          },
                        );
                        setCollectionPickerMode(false);
                      }}
                    >
                      <View style={styles.pickerItemLeft}>
                        <Feather name="folder" size={18} color={isSelected ? Colors.zinc900 : Colors.zinc500} />
                        <Text style={[styles.pickerItemName, isSelected && styles.pickerItemNameSelected]} numberOfLines={1}>
                          {item.name}
                        </Text>
                      </View>
                      <View style={styles.pickerItemRight}>
                        {item.articleCount !== undefined && (
                          <Text style={styles.pickerItemCount}>{item.articleCount}편</Text>
                        )}
                        {isSelected && <Feather name="check" size={16} color={Colors.zinc900} />}
                      </View>
                    </Pressable>
                  );
                }}
                ItemSeparatorComponent={() => <View style={styles.pickerSeparator} />}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.pickerListContent}
                ListEmptyComponent={
                  <View style={styles.pickerEmpty}>
                    <Text style={styles.pickerEmptyText}>보관할 모음이 없어요</Text>
                    <Text style={styles.pickerEmptySubtext}>새 모음에 추가 탭에서 만들어보세요</Text>
                  </View>
                }
              />
            ) : (
              <View style={styles.pickerCreateForm}>
                <TextInput
                  style={styles.pickerCreateInput}
                  placeholder="모음 이름"
                  placeholderTextColor={Colors.zinc400}
                  value={newCollectionName}
                  onChangeText={setNewCollectionName}
                  autoFocus
                />
                <TextInput
                  style={[styles.pickerCreateInput, styles.pickerCreateInputMulti]}
                  placeholder="설명 (선택사항)"
                  placeholderTextColor={Colors.zinc400}
                  value={newCollectionDesc}
                  onChangeText={setNewCollectionDesc}
                  multiline
                  textAlignVertical="top"
                />
                <Pressable
                  style={[styles.pickerCreateButton, (!newCollectionName.trim() || isCreatingCollection) && styles.pickerCreateButtonDisabled]}
                  onPress={async () => {
                    if (!newCollectionName.trim()) return;
                    setIsCreatingCollection(true);
                    try {
                      const newCol = await createCollection.mutateAsync({
                        data: { ownerId: userId, name: newCollectionName.trim(), description: newCollectionDesc.trim() || undefined },
                      });
                      setSelectedCollectionId(newCol.id);
                      queryClient.invalidateQueries({ queryKey: ["/api/my-collections"] });
                      updateRecentCollection.mutate(
                        { id: userId, data: { collectionId: newCol.id } },
                        {
                          onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetUserRecentCollectionQueryKey(userId) }),
                        },
                      );
                      setNewCollectionName("");
                      setNewCollectionDesc("");
                      setPickerTab("list");
                      setCollectionPickerMode(false);
                    } catch (e: unknown) {
                      const msg = e instanceof Error ? e.message : "모음 생성에 실패했습니다.";
                      Alert.alert("생성 실패", msg);
                    } finally {
                      setIsCreatingCollection(false);
                    }
                  }}
                  disabled={!newCollectionName.trim() || isCreatingCollection}
                >
                  {isCreatingCollection ? (
                    <ActivityIndicator size="small" color={Colors.white} />
                  ) : (
                    <Text style={styles.pickerCreateButtonText}>만들기</Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>
        ) : (
        <View style={styles.completionContent}>
          <Text style={dynamicStyles.completionText}>글을 끝까지 다 읽었습니다.</Text>

          {mode === "re_read" ? (
            <>
              <Pressable
                style={[styles.completionButton, styles.completionButtonSecondary]}
                onPress={() => {
                  setCompletionSheetVisible(false);
                  reading.restartReading();
                }}
              >
                <Text style={dynamicStyles.completionButtonSecondaryText}>다시 읽기</Text>
              </Pressable>
              <Pressable
                style={[styles.completionButton, styles.completionButtonSecondary]}
                onPress={async () => {
                  setCompletionSheetVisible(false);
                  await readingMemo.cleanup();
                  router.back();
                }}
              >
                <Text style={dynamicStyles.completionButtonSecondaryText}>나가기</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={styles.collectionSelector}
                onPress={() => setCollectionPickerMode(true)}
                disabled={isSaving}
              >
                <Feather name="folder" size={16} color={Colors.zinc500} />
                <Text style={styles.collectionSelectorText} numberOfLines={1}>
                  {(collectionsQuery.data ?? []).find((c: { id: string; name: string }) => c.id === selectedCollectionId)?.name ?? "보관함"}
                </Text>
                <Feather name="chevron-right" size={16} color={Colors.zinc400} />
              </Pressable>

              <Pressable
                style={[styles.completionButton, (isSaving || !isCollectionsReady) && styles.completionButtonDisabled]}
                onPress={handleCommitAndSave}
                disabled={isSaving}
              >
                <Text style={dynamicStyles.completionButtonText}>
                  {isSaving ? "저장 중..." : !isCollectionsReady ? "불러오는 중..." : "보관하기"}
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.completionButton,
                  styles.completionButtonSecondary,
                  isDeleting && styles.completionButtonDisabled,
                ]}
                onPress={handleCommitAndSkip}
                disabled={isDeleting}
              >
                <Text style={dynamicStyles.completionButtonSecondaryText}>
                  {isDeleting
                    ? "처리 중..."
                    : (isListEntry ? "보관 안 함" : "나가기")}
                </Text>
              </Pressable>

              <Pressable
                style={styles.completionButtonTertiary}
                onPress={() => {
                  setCompletionSheetVisible(false);
                  reading.restartReading();
                }}
              >
                <Text style={dynamicStyles.completionButtonTertiaryText}>다시 읽기</Text>
              </Pressable>
            </>
          )}
        </View>
        )}
      </BottomSheet>

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
            <Pressable
              style={[styles.sentenceButton, styles.sentenceButtonCancel]}
              onPress={handleCancelSentence}
            >
              <Text style={dynamicStyles.sentenceButtonCancelText}>취소</Text>
            </Pressable>
            <Pressable style={styles.sentenceButton} onPress={handleSaveSentence}>
              <Feather name="bookmark" size={16} color={Colors.white} />
              <Text style={dynamicStyles.sentenceButtonText}>저장</Text>
            </Pressable>
          </View>
        </View>
      </BottomSheet>

      <MemoBottomSheet
        visible={memoSheetVisible}
        onClose={async () => {
          await readingMemo.flushSave();
          setMemoSheetVisible(false);
          setMemoAppendContent(undefined);
        }}
        initialContent={readingMemo.memoContent}
        appendContent={memoAppendContent}
        initialTitle={readingMemo.memoTitle}
        defaultTitlePlaceholder={readingMemo.defaultMemoTitle}
        onTitleChange={readingMemo.updateMemoTitle}
        saveState={readingMemo.saveState}
        onContentChange={readingMemo.updateMemoContent}
      />

      <ConfirmModal
        visible={!!duplicatePrompt}
        title="같은 글이 더 있어요"
        description={
          duplicatePrompt
            ? `수신함에 같은 글이 ${duplicatePrompt.count}개 더 있어요. 모두 미보관 읽음 처리할까요?`
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 12,
    gap: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  titleBar: {
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 12,
    paddingTop: 8,
    width: "100%",
  },
  modeBadge: {
    backgroundColor: Colors.zinc100,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
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
    alignItems: "center",
    paddingVertical: 16,
    gap: 12,
  },
  completionIcon: {
    marginBottom: 4,
  },
  completionButton: {
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.zinc900,
    borderRadius: 10,
    paddingVertical: 12,
    gap: 6,
  },
  sentenceButtonCancel: {
    backgroundColor: Colors.zinc100,
  },
  memoContent: {
    paddingVertical: 12,
    gap: 12,
  },
  collectionSelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.zinc50,
    marginBottom: 4,
  },
  collectionSelectorText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Pretendard",
    color: Colors.zinc700,
  },
  completionButtonTertiary: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.zinc200,
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
  },
  readerShadowWrapper: {
    alignSelf: "center",
    ...Platform.select({
      web: {
        boxShadow: "0 -10px 24px rgba(0,0,0,0.07), 0 10px 24px rgba(0,0,0,0.07)",
      },
      default: {
        elevation: 8,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.12,
        shadowRadius: 20,
      },
    }),
  },
  readerFrame: {
    alignSelf: "center",
    overflow: "hidden",
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
    alignItems: "center",
    justifyContent: "center",
  },
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
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.zinc700,
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
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
  pickerContainer: {
    flex: 1,
  },
  pickerBackRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingBottom: 12,
    marginBottom: 4,
  },
  pickerBackText: {
    fontSize: 15,
    fontFamily: "Pretendard",
    fontWeight: "600",
    color: Colors.zinc700,
  },
  pickerTabBar: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  pickerTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.zinc50,
  },
  pickerTabActive: {
    backgroundColor: Colors.zinc900,
  },
  pickerTabText: {
    fontSize: 13,
    fontFamily: "Pretendard",
    color: Colors.zinc500,
  },
  pickerTabTextActive: {
    color: Colors.white,
    fontWeight: "600",
  },
  pickerListContent: {
    paddingVertical: 4,
  },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  pickerItemSelected: {
    backgroundColor: Colors.zinc50,
  },
  pickerItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  pickerItemRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pickerItemName: {
    fontSize: 15,
    fontFamily: "Pretendard",
    color: Colors.zinc700,
    flex: 1,
  },
  pickerItemNameSelected: {
    fontWeight: "600",
    color: Colors.zinc900,
  },
  pickerItemCount: {
    fontSize: 13,
    fontFamily: "Pretendard",
    color: Colors.zinc400,
  },
  pickerSeparator: {
    height: 1,
    backgroundColor: Colors.zinc100,
  },
  pickerEmpty: {
    paddingVertical: 40,
    alignItems: "center",
    gap: 6,
  },
  pickerEmptyText: {
    fontSize: 14,
    fontFamily: "Pretendard",
    color: Colors.zinc500,
  },
  pickerEmptySubtext: {
    fontSize: 13,
    fontFamily: "Pretendard",
    color: Colors.zinc400,
  },
  pickerCreateForm: {
    paddingTop: 4,
    gap: 12,
  },
  pickerCreateInput: {
    fontSize: 15,
    fontFamily: "Pretendard",
    color: Colors.zinc900,
    backgroundColor: Colors.zinc50,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerCreateInputMulti: {
    minHeight: 72,
    lineHeight: 22,
  },
  pickerCreateButton: {
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  pickerCreateButtonDisabled: {
    backgroundColor: Colors.zinc300,
  },
  pickerCreateButtonText: {
    fontSize: 16,
    fontFamily: "Pretendard",
    fontWeight: "600",
    color: Colors.white,
  },
});
