import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
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
import MarkdownBlock from "@/components/MarkdownBlock/MarkdownBlock";
import { parseMarkdownBlocks } from "@/utils/markdownParser";
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
  getGetUserRecentCollectionQueryKey,
} from "@workspace/api-client-react";
import { useUser } from "@/contexts/UserContext";
import { useActiveReading } from "@/contexts/ActiveReadingContext";
import type { ReadingMode } from "@/lib/policies";
import MemoBottomSheet from "@/components/MemoBottomSheet/MemoBottomSheet";
import MyCollectionsModal from "@/components/MyCollectionsModal/MyCollectionsModal";
import type { CollectionItem } from "@/components/MyCollectionsModal/MyCollectionsModal";

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
  }>();

  const articleId = params.articleId ?? "";
  const inboxId = params.inboxId;
  const mode: ReadingMode = (params.mode as ReadingMode) ?? "basic";
  const entrySource = params.entrySource as "list" | "inbox" | undefined;
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
  });

  const currentPage = totalPages > 0
    ? Math.min(reading.session.position.currentPage, totalPages - 1)
    : reading.session.position.currentPage;
  const isOnCoverPage = currentPage === 0;
  const contentPageIndex = Math.max(0, currentPage - 1);
  const isOnLastPage = totalPages > 0 && currentPage >= totalPages - 1;

  const [coverDismissed, setCoverDismissed] = useState(false);

  useEffect(() => {
    setCoverDismissed(false);
  }, [articleId]);

  const [completionSheetVisible, setCompletionSheetVisible] = useState(false);
  const [sentencePopupVisible, setSentencePopupVisible] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0);
  const [memoSheetVisible, setMemoSheetVisible] = useState(false);
  const [memoAppendContent, setMemoAppendContent] = useState<string | undefined>(undefined);
  const [myCollectionsModalVisible, setMyCollectionsModalVisible] = useState(false);
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

  // ── Analytics tracking refs ────────────────────────────────────────────────
  const pageEnterTimeRef = useRef<number>(Date.now());
  const readingStartTimeRef = useRef<number>(0);
  const completionTimeRef = useRef<number>(0);
  const hasTrackedReadingStartRef = useRef(false);

  const readingMemo = useReadingMemo({
    userId,
    sourceArticleId: articleId,
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
    const sub = AppState.addEventListener("change", (nextState) => {
      if (
        nextState === "background" &&
        (reading.session.state === "READING" || reading.session.state === "PAUSED")
      ) {
        trackAppBackgroundedDuringReading({ articleId, currentPage, totalPages });
      }
    });
    return () => sub.remove();
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
  const showingCover = hasCover && !coverDismissed && currentPage === 0;
  // Whether the current slot shows the title bar at the bottom
  const showTitleBar = !isOnCoverPage && !showingCover && !!article;

  useEffect(() => {
    if (currentPage === 0 && hasCover) {
      setCoverDismissed(false);
    }
  }, [currentPage, hasCover]);

  useLayoutEffect(() => {
    if (!hasCover && currentPage === 0 && reading.isSessionHydrated && !reading.isRestoring && totalPages > 1) {
      reading.jumpToPage(1);
    }
  }, [hasCover, currentPage, reading.isSessionHydrated, reading.isRestoring, totalPages, reading.jumpToPage]);

  const handleSwipeLeft = useCallback(() => {
    if (!canNavigate) return;
    const dwellMs = Date.now() - pageEnterTimeRef.current;
    if (showingCover) {
      setCoverDismissed(true);
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
    if (showingCover) return;
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
  }, [canNavigate, showingCover, hasCover, currentPage, reading, articleId, totalPages, contentPages, contentPageIndex]);

  const handleSwipeLeftRef = useRef(handleSwipeLeft);
  const handleSwipeRightRef = useRef(handleSwipeRight);
  useEffect(() => { handleSwipeLeftRef.current = handleSwipeLeft; }, [handleSwipeLeft]);
  useEffect(() => { handleSwipeRightRef.current = handleSwipeRight; }, [handleSwipeRight]);

  const isTextSelectingRef = useRef(false);

  // ── Reanimated shared values ──────────────────────────────────────────────
  // Single translateX drives the 3-slot pre-rendered row (prev | current | next).
  // All animation runs on the UI thread; no JS-bridge latency.
  const translateXSV = useSharedValue(0);

  const containerWidthRef = useRef(layout.containerWidth);
  useEffect(() => { containerWidthRef.current = layout.containerWidth; }, [layout.containerWidth]);
  const canNavigateRef = useRef(canNavigate);
  useEffect(() => { canNavigateRef.current = canNavigate; }, [canNavigate]);
  const showingCoverRef = useRef(showingCover);
  useEffect(() => { showingCoverRef.current = showingCover; }, [showingCover]);
  const currentPageRef = useRef(currentPage);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  const isOnLastPageRef = useRef(isOnLastPage);
  useEffect(() => { isOnLastPageRef.current = isOnLastPage; }, [isOnLastPage]);
  const hasCoverRef = useRef(hasCover);
  useEffect(() => { hasCoverRef.current = hasCover; }, [hasCover]);

  // Animated style for the row container
  const rowAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateXSV.value }],
  }));

  // After a page turn completes and React re-renders with the new currentPage,
  // snap the row back to center before the next paint (Fabric: synchronous via JSI).
  useLayoutEffect(() => {
    translateXSV.value = 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, showingCover]);

  // ── Gesture state ref (always fresh, avoids stale closure in useMemo) ────
  const gestureState = useRef({
    canNavigate: false,
    isOnLastPage: false,
    atBoundaryLeft: true,
    containerWidth: 300,
    isTextSelecting: false,
    isCommitting: false,
  });
  gestureState.current = {
    canNavigate,
    isOnLastPage,
    atBoundaryLeft: showingCover || currentPage === 0 || (!hasCover && currentPage <= 1),
    containerWidth: layout.containerWidth,
    isTextSelecting: isTextSelectingRef.current,
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

  // Gesture.Pan runs on JS thread (runOnJS:true) for gesture recognition,
  // but withTiming / withSpring animate purely on the UI thread.
  const panGesture = useMemo(() => Gesture.Pan()
    .minDistance(8)
    .runOnJS(true)
    .onBegin(() => {
      // nothing
    })
    .onUpdate((e) => {
      const gs = gestureState.current;
      if (gs.isTextSelecting || isCommittingRef.current) return;

      const dx = e.translationX;
      const dy = e.translationY;
      // Only track horizontal movement for page sliding
      if (Math.abs(dy) > Math.abs(dx) * 1.8) return;

      if (dx < 0 && gs.isOnLastPage) return;  // no next on last page
      if (dx > 0 && gs.atBoundaryLeft) return; // no prev at start

      translateXSV.value = dx;
    })
    .onEnd((e) => {
      if (isCommittingRef.current) return;

      const gs = gestureState.current;
      const dx = e.translationX;
      const dy = e.translationY;
      const absDx = Math.abs(dx);
      const W = gs.containerWidth || 300;

      // Upward swipe → open memo sheet
      if (dy < -50 && Math.abs(dy) > absDx * 1.5) {
        translateXSV.value = withSpring(0, snapConfig);
        runOnJS(openMemoRef.current)();
        return;
      }

      if (!gs.canNavigate) {
        translateXSV.value = withSpring(0, snapConfig);
        return;
      }

      const goingNext = dx < 0;

      // Boundary checks
      if (goingNext && gs.isOnLastPage) {
        translateXSV.value = withSpring(0, snapConfig);
        // Trigger completion (no swipe animation needed)
        runOnJS(handleSwipeLeftRef.current)();
        return;
      }
      if (!goingNext && gs.atBoundaryLeft) {
        translateXSV.value = withSpring(0, snapConfig);
        return;
      }

      const THRESHOLD = W * 0.22;
      const VELOCITY_THRESHOLD = 450;
      const shouldCommit = absDx > THRESHOLD || Math.abs(e.velocityX) > VELOCITY_THRESHOLD;

      if (!shouldCommit) {
        translateXSV.value = withSpring(0, snapConfig);
        return;
      }

      const direction: -1 | 1 = goingNext ? -1 : 1;
      isCommittingRef.current = true;

      // Animate the row to the committed position, then update React state
      translateXSV.value = withTiming(direction * W, {
        duration: 240,
        easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
      }, () => {
        runOnJS(finishPageTurnRef.current)(direction);
      });
    })
    .onFinalize(() => {
      // If gesture is cancelled externally, snap back
      if (!isCommittingRef.current) {
        translateXSV.value = withSpring(0, snapConfig);
      }
    }), []);

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
        router.back();
        Alert.alert("완료", "읽기를 완료했어요");
      } else {
        Alert.alert("오류", result.error ?? "완독 처리에 실패했습니다.");
      }
    } finally {
      setIsDeleting(false);
    }
  }, [isDeleting, isListEntry, reading, router, clearActiveSession, queryClient, readingMemo]);

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
    const combined = base ? `${base}\n\n${quoteBlock}\n` : `${quoteBlock}\n`;
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

  const currentPageContent = !isOnCoverPage && contentPages.length > 0
    ? contentPages[Math.min(contentPageIndex, contentPages.length - 1)]
    : "";

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
                {/* 3-slot pre-rendered row: [prev | current | next]
                    Row starts at left:-containerWidth so "current" sits at screen-x=0.
                    translateXSV slides the entire row; useLayoutEffect resets to 0
                    after each page change (Fabric JSI = synchronous, no flash). */}
                <Animated.View style={[{
                  position: "absolute",
                  top: 0,
                  left: -layout.containerWidth,
                  width: layout.containerWidth * 3,
                  height: layout.containerHeight,
                  flexDirection: "row",
                }, rowAnimStyle]}>

                  {/* ── PREV SLOT ─────────────────────────────────────── */}
                  <View style={{ width: layout.containerWidth, height: layout.containerHeight }}>
                    {(() => {
                      const canGoBack = !showingCover && !(currentPage <= 1 && !hasCover);
                      if (!canGoBack) return null;
                      if (currentPage === 1 && hasCover) {
                        // prev of first content page = cover
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
                      const prevIdx = contentPageIndex - 1;
                      if (prevIdx < 0 || !contentPages[prevIdx]) return null;
                      return (
                        <PageView
                          content={contentPages[prevIdx]}
                          pageIndex={prevIdx}
                          onCollectSentence={handleCollectSentence}
                          onMemoSentence={handleMemoSentence}
                          onSelectionStateChange={(isSelecting, text) => {
                            isTextSelectingRef.current = isSelecting;
                            if (isSelecting && text) {
                              setSelectionPillText(text);
                              setShowSelectionPill(true);
                            } else {
                              setShowSelectionPill(false);
                            }
                          }}
                          bottomInset={insets.bottom}
                          layout={layout}
                          clearSignal={clearSelectionSignal}
                        />
                      );
                    })()}
                  </View>

                  {/* ── CURRENT SLOT ──────────────────────────────────── */}
                  <View style={{ width: layout.containerWidth, height: layout.containerHeight }}>
                    {showingCover ? (
                      <CoverPage
                        cover={cover}
                        title={article?.title ?? ""}
                        authorName={authorName}
                        containerWidth={layout.containerWidth}
                        containerHeight={layout.containerHeight}
                      />
                    ) : (
                      <PageView
                        content={currentPageContent}
                        pageIndex={contentPageIndex}
                        onCollectSentence={handleCollectSentence}
                        onMemoSentence={handleMemoSentence}
                        onSelectionStateChange={(isSelecting, text) => {
                          isTextSelectingRef.current = isSelecting;
                          if (isSelecting && text) {
                            setSelectionPillText(text);
                            setShowSelectionPill(true);
                          } else {
                            setShowSelectionPill(false);
                          }
                        }}
                        bottomInset={insets.bottom}
                        layout={layout}
                        clearSignal={clearSelectionSignal}
                      />
                    )}
                  </View>

                  {/* ── NEXT SLOT ─────────────────────────────────────── */}
                  <View style={{ width: layout.containerWidth, height: layout.containerHeight }}>
                    {(() => {
                      if (isOnLastPage) return null;
                      if (showingCover) {
                        // next of cover = first content page
                        if (!contentPages[0]) return null;
                        return (
                          <PageView
                            content={contentPages[0]}
                            pageIndex={0}
                            onCollectSentence={handleCollectSentence}
                            onMemoSentence={handleMemoSentence}
                            onSelectionStateChange={(isSelecting, text) => {
                              isTextSelectingRef.current = isSelecting;
                              if (isSelecting && text) {
                                setSelectionPillText(text);
                                setShowSelectionPill(true);
                              } else {
                                setShowSelectionPill(false);
                              }
                            }}
                            bottomInset={insets.bottom}
                            layout={layout}
                            clearSignal={clearSelectionSignal}
                          />
                        );
                      }
                      const nextIdx = contentPageIndex + 1;
                      if (nextIdx >= contentPages.length) return null;
                      return (
                        <PageView
                          content={contentPages[nextIdx]}
                          pageIndex={nextIdx}
                          onCollectSentence={handleCollectSentence}
                          onMemoSentence={handleMemoSentence}
                          onSelectionStateChange={(isSelecting, text) => {
                            isTextSelectingRef.current = isSelecting;
                            if (isSelecting && text) {
                              setSelectionPillText(text);
                              setShowSelectionPill(true);
                            } else {
                              setShowSelectionPill(false);
                            }
                          }}
                          bottomInset={insets.bottom}
                          layout={layout}
                          clearSignal={clearSelectionSignal}
                        />
                      );
                    })()}
                  </View>

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
          if (mode === "re_read") {
            setCompletionSheetVisible(false);
          } else {
            reading.continueReading();
            setCompletionSheetVisible(false);
          }
        }}
        snapPoints={mode === "re_read" ? [0.28] : [0.5]}
        enableDragDown={mode === "re_read"}
        dismissable={true}
      >
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
                onPress={() => setMyCollectionsModalVisible(true)}
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
        articleTitle={article?.title ?? ""}
        initialContent={readingMemo.memoContent}
        appendContent={memoAppendContent}
        saveState={readingMemo.saveState}
        onContentChange={readingMemo.updateMemoContent}
      />

      <MyCollectionsModal
        visible={myCollectionsModalVisible}
        onClose={() => setMyCollectionsModalVisible(false)}
        collections={
          (collectionsQuery.data ?? [])
            .filter((c: { id: string; name: string; articleCount?: number; isArchive?: boolean }) => !c.isArchive)
            .map((c: { id: string; name: string; articleCount?: number }) => ({
              id: c.id,
              name: c.name,
              articleCount: c.articleCount,
            })) as CollectionItem[]
        }
        selectedCollectionId={selectedCollectionId}
        onSelect={(collection) => {
          setSelectedCollectionId(collection.id);
          updateRecentCollection.mutate(
            { id: userId, data: { collectionId: collection.id } },
            {
              onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetUserRecentCollectionQueryKey(userId) }),
              onError: (e) => console.warn("[MyCollectionsModal] recent collection update failed (non-fatal):", e),
            },
          );
        }}
        onCreateAndSelect={async (name, description) => {
          let newCol: { id: string };
          try {
            newCol = await createCollection.mutateAsync({
              data: { ownerId: userId, name, description: description || undefined },
            });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "모음 생성에 실패했습니다.";
            Alert.alert("생성 실패", msg);
            return;
          }
          setSelectedCollectionId(newCol.id);
          setMyCollectionsModalVisible(false);
          queryClient.invalidateQueries({ queryKey: ["/api/my-collections"] });
          try {
            await updateRecentCollection.mutateAsync(
              { id: userId, data: { collectionId: newCol.id } },
            );
            queryClient.invalidateQueries({ queryKey: getGetUserRecentCollectionQueryKey(userId) });
          } catch (e) {
            console.warn("[MyCollectionsModal] recent collection update failed (non-fatal):", e);
          }
        }}
        isLoading={collectionsQuery.isLoading}
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
  pageIndex,
  onCollectSentence,
  onMemoSentence,
  onSelectionStateChange,
  bottomInset,
  layout,
  clearSignal,
}: {
  content: string;
  pageIndex: number;
  onCollectSentence: (text: string) => void;
  onMemoSentence: (text: string) => void;
  onSelectionStateChange?: (isSelecting: boolean, selectedText?: string) => void;
  bottomInset: number;
  layout: ReaderLayout;
  clearSignal?: number;
}) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);

  const dynamicPageStyles = useMemo(
    () =>
      StyleSheet.create({
        safeAreaBox: {
          width: layout.safeAreaWidth,
          alignSelf: "center",
        },
        pageContent: {
          flexGrow: 1,
          justifyContent: "center" as const,
          paddingHorizontal: layout.paddingX,
          paddingTop: layout.paddingY,
          // Reserve space below text for the absolute-positioned title bar overlay
          paddingBottom: bottomInset + layout.paddingY + layout.titleBarHeight,
        },
        // Explicit integer-pixel width column — prevents Yoga from pixel-snapping
        // the available text width differently depending on the parent's position.
        // Must match the width used by PretextMeasureLayer for line-break consistency.
        textColumn: {
          width: layout.textColumnWidth,
        },
      }),
    [layout.safeAreaWidth, layout.paddingX, layout.paddingY, layout.textColumnWidth, bottomInset],
  );

  return (
    <View style={[styles.pageContainer, { flex: 1 }]}>
      <View style={[dynamicPageStyles.safeAreaBox, { flex: 1 }]}>
        <View style={[dynamicPageStyles.pageContent, { flex: 1 }]}>
          <View style={dynamicPageStyles.textColumn}>
            {blocks.map((block, idx) => {
              const fs = layout.bodyFontSize;
              const nextBlock = blocks[idx + 1];
              let wrapperStyle: { marginTop?: number; marginBottom?: number; marginVertical?: number } = {};
              if (block.type === "paragraph") {
                wrapperStyle = { marginBottom: fs * 1.0 };
              } else if (block.type === "h1") {
                const sz = fs * 1.6;
                wrapperStyle = { marginTop: sz * 1.0, marginBottom: sz * 0.4 };
              } else if (block.type === "h2") {
                const sz = fs * 1.3;
                wrapperStyle = { marginTop: sz * 0.8, marginBottom: sz * 0.3 };
              } else if (block.type === "h3") {
                const sz = fs * 1.1;
                wrapperStyle = { marginTop: sz * 0.6, marginBottom: sz * 0.3 };
              } else if (block.type === "blockquote") {
                wrapperStyle = { marginVertical: fs * 0.5 };
              } else if (block.type === "ul_item" || block.type === "ol_item") {
                const isLastInList = !nextBlock || (nextBlock.type !== "ul_item" && nextBlock.type !== "ol_item");
                wrapperStyle = { marginBottom: isLastInList ? fs * 1.0 : fs * 0.2 };
              }
              return (
                <View key={`${pageIndex}-b-${idx}`} style={wrapperStyle}>
                  <MarkdownBlock
                    block={block}
                    onCollect={onCollectSentence}
                    onMemo={onMemoSentence}
                    onSelectionStateChange={onSelectionStateChange}
                    fontSize={layout.bodyFontSize}
                    lineHeight={layout.bodyLineHeight}
                    letterSpacing={layout.bodyLetterSpacing}
                    clearSignal={clearSignal}
                  />
                </View>
              );
            })}
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
  readerFrame: {
    alignSelf: "center",
    overflow: "hidden",
    backgroundColor: ReaderTokens.bodyBg,
    ...Platform.select({
      web: {
        boxShadow: "0 -6px 18px rgba(0,0,0,0.045), 0 6px 18px rgba(0,0,0,0.045)",
      },
      default: {
        elevation: 4,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.06,
        shadowRadius: 18,
      },
    }),
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
});
