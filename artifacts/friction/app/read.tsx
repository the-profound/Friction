import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  BackHandler,
  Alert,
  Platform,
  PanResponder,
  Animated,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
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
import { useToast } from "@/contexts/ToastContext";
import { useActiveReading } from "@/contexts/ActiveReadingContext";
import type { ReadingMode } from "@/lib/policies";
import MemoBottomSheet from "@/components/MemoBottomSheet/MemoBottomSheet";
import MyCollectionsModal from "@/components/MyCollectionsModal/MyCollectionsModal";
import type { CollectionItem } from "@/components/MyCollectionsModal/MyCollectionsModal";

function computeReaderLayout(availableWidth: number, availableHeight: number): ReaderLayout {
  const widthFromHeight = availableHeight * ReaderTokens.aspectRatio;
  const heightFromWidth = availableWidth / ReaderTokens.aspectRatio;

  const containerWidth =
    widthFromHeight <= availableWidth ? widthFromHeight : availableWidth;
  const containerHeight =
    heightFromWidth <= availableHeight ? heightFromWidth : availableHeight;

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

  return {
    containerWidth,
    containerHeight,
    paddingX,
    paddingY,
    safeAreaWidth,
    safeAreaHeight,
    bodyFontSize,
    captionFontSize,
    metadataFontSize,
    bodyLineHeight,
    bodyLetterSpacing,
    titleLineHeight,
    titleLetterSpacing,
  };
}

export default function ReadScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const queryClient = useQueryClient();
  const { userId } = useUser();
  const { showToast } = useToast();
  const { setActiveSession, clearActiveSession } = useActiveReading();
  const params = useLocalSearchParams<{
    articleId: string;
    inboxId?: string;
    mode?: string;
  }>();

  const articleId = params.articleId ?? "";
  const inboxId = params.inboxId;
  const mode: ReadingMode = (params.mode as ReadingMode) ?? "basic";

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
      return article.pages;
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
  const [memoSheetVisible, setMemoSheetVisible] = useState(false);
  const [memoAppendContent, setMemoAppendContent] = useState<string | undefined>(undefined);
  const [myCollectionsModalVisible, setMyCollectionsModalVisible] = useState(false);

  const [selectedCollectionId, setSelectedCollectionId] = useState<string | undefined>(undefined);
  const [pageListSize, setPageListSize] = useState({ width: 0, height: 0 });
  const handlePageListLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setPageListSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  }, []);

  const layout = useMemo(
    () =>
      computeReaderLayout(
        pageListSize.width > 0 ? pageListSize.width : screenWidth,
        pageListSize.height > 0 ? pageListSize.height : screenWidth / ReaderTokens.aspectRatio,
      ),
    [pageListSize.width, pageListSize.height, screenWidth],
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

  const readingMemo = useReadingMemo({
    userId,
    sourceArticleId: articleId,
    enabled: !!userId && !!articleId,
  });

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
        Alert.alert("읽기 중", "완독 후 보관/삭제를 선택해주세요.");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [mode, reading.canExit]);


  const handleBack = useCallback(async () => {
    if (mode === "basic" && !reading.canExit) {
      Alert.alert("읽기 중", "완독 후 보관/삭제를 선택해주세요.");
      return;
    }
    if (reading.session.state === "READING" || reading.session.state === "PAUSED") {
      reading.pause();
    }
    await readingMemo.cleanup();
    router.back();
  }, [mode, reading, router, readingMemo]);

  const canNavigate = mode === "re_read" || reading.session.state === "READING";

  const articleCover = useMemo(
    () => (article?.cover ? resolveArticleCover(article.cover) : null),
    [article?.cover],
  );
  const hasCover = articleCover !== null && articleCover.type !== "default";
  const showingCover = hasCover && !coverDismissed && currentPage === 0;

  useEffect(() => {
    if (currentPage === 0 && hasCover) {
      setCoverDismissed(false);
    }
  }, [currentPage, hasCover]);

  const handleSwipeLeft = useCallback(() => {
    if (!canNavigate) return;
    if (showingCover) {
      setCoverDismissed(true);
      reading.nextPage();
      return;
    }
    reading.nextPage();
  }, [canNavigate, showingCover, reading]);

  const handleSwipeRight = useCallback(() => {
    if (!canNavigate) return;
    if (showingCover) return;
    reading.prevPage();
  }, [canNavigate, showingCover, reading]);

  const SWIPE_MIN_DISTANCE = 40;
  const SWIPE_MIN_RATIO = 1.5;

  const handleSwipeLeftRef = useRef(handleSwipeLeft);
  const handleSwipeRightRef = useRef(handleSwipeRight);
  useEffect(() => { handleSwipeLeftRef.current = handleSwipeLeft; }, [handleSwipeLeft]);
  useEffect(() => { handleSwipeRightRef.current = handleSwipeRight; }, [handleSwipeRight]);

  const setMemoSheetVisibleRef = useRef(setMemoSheetVisible);

  const isTextSelectingRef = useRef(false);

  const outX = useRef(new Animated.Value(0)).current;
  const inX = useRef(new Animated.Value(0)).current;
  const [isCommitting, setIsCommitting] = useState(false);
  const isCommittingRef = useRef(false);
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
  const outgoingPageRef = useRef<{ page: number; showingCover: boolean }>({ page: 0, showingCover: false });

  const swipePanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => {
        if (isTextSelectingRef.current) return false;
        if (isCommittingRef.current) return false;
        const absDx = Math.abs(g.dx);
        const absDy = Math.abs(g.dy);
        const isHorizontalSwipe = absDx > absDy * SWIPE_MIN_RATIO && absDx > SWIPE_MIN_DISTANCE / 2;
        const isUpwardSwipe = g.dy < -20 && absDy > absDx;
        return isHorizontalSwipe || isUpwardSwipe;
      },
      onMoveShouldSetPanResponderCapture: (_, g) => {
        if (isTextSelectingRef.current) return false;
        if (isCommittingRef.current) return false;
        const absDx = Math.abs(g.dx);
        const absDy = Math.abs(g.dy);
        const isHorizontalSwipe = absDx > absDy * SWIPE_MIN_RATIO && absDx > SWIPE_MIN_DISTANCE / 2;
        const isUpwardSwipe = g.dy < -20 && absDy > absDx;
        return isHorizontalSwipe || isUpwardSwipe;
      },
      onPanResponderMove: (_, g) => {
        if (!isCommittingRef.current) {
          const swipingLeftOnLastPage = isOnLastPageRef.current && g.dx < 0;
          if (!swipingLeftOnLastPage) {
            outX.setValue(g.dx);
          }
        }
      },
      onPanResponderRelease: (_, g) => {
        if (isCommittingRef.current) return;
        const dx = g.dx;
        const dy = g.dy;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        // 위로 스와이프: 수직 우세, dy < -40 → 메모 바텀시트 열기
        if (dy < -40 && absDy > absDx) {
          setMemoSheetVisibleRef.current(true);
          return;
        }

        const width = containerWidthRef.current || 300;
        const swipeDir = dx < 0 ? -1 : 1; // -1 = left swipe (next), +1 = right swipe (prev)

        const swipingBack = swipeDir === 1;
        const isAtBoundary = swipingBack
          ? (showingCoverRef.current || currentPageRef.current === 0)
          : false;

        if (!canNavigateRef.current || absDx < SWIPE_MIN_DISTANCE || isAtBoundary) {
          Animated.spring(outX, {
            toValue: 0,
            tension: 120,
            friction: 14,
            useNativeDriver: true,
          }).start();
          return;
        }

        // 마지막 페이지에서 왼쪽 스와이프: 슬라이드 애니메이션 없이 바텀시트만 표시
        if (isOnLastPageRef.current && swipeDir === -1) {
          handleSwipeLeftRef.current();
          return;
        }

        isCommittingRef.current = true;
        outgoingPageRef.current = { page: currentPageRef.current, showingCover: showingCoverRef.current };
        inX.setValue(-swipeDir * width);

        if (swipeDir === -1) {
          handleSwipeLeftRef.current();
        } else {
          handleSwipeRightRef.current();
        }
        setIsCommitting(true);

        Animated.parallel([
          Animated.timing(outX, {
            toValue: swipeDir * width,
            duration: 240,
            useNativeDriver: true,
          }),
          Animated.spring(inX, {
            toValue: 0,
            tension: 100,
            friction: 16,
            useNativeDriver: true,
          }),
        ]).start(() => {
          outX.setValue(0);
          inX.setValue(0);
          isCommittingRef.current = false;
          setIsCommitting(false);
        });
      },
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

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
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      clearActiveSession();
      await readingMemo.cleanup();
      router.back();
      showToast({ message: "보관함에 저장됐어요", type: "success", duration: 3000, position: "bottom" });
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, isCollectionsReady, reading, selectedCollectionId, collectionsQuery.data, articleId, userId, createCollection, addToCollection, updateRecentCollection, queryClient, clearActiveSession, router, readingMemo, showToast]);

  const handleCommitAndSkip = useCallback(async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      const result = await reading.commitCompletion();
      setCompletionSheetVisible(false);
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
        clearActiveSession();
        await readingMemo.cleanup();
        router.back();
        showToast({ message: "편지를 삭제했어요", type: "success", duration: 3000, position: "bottom" });
      } else {
        Alert.alert("오류", result.error ?? "완독 처리에 실패했습니다.");
      }
    } finally {
      setIsDeleting(false);
    }
  }, [isDeleting, reading, router, clearActiveSession, queryClient, readingMemo, showToast]);

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
    setMemoAppendContent(quoteBlock);
    setMemoSheetVisible(true);
  }, [currentPage, authorName, article?.title]);

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
      setSentencePopupVisible(false);
      setSelectedText("");
      Alert.alert("저장 완료", "문장이 저장되었습니다.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "문장 저장에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [selectedText, userId, articleId, contentPageIndex, createSentence, queryClient]);


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
          gestureEnabled: mode !== "basic" || reading.canExit,
        }}
      />
      {mode === "re_read" && (
        <View style={styles.header}>
          <Pressable onPress={handleBack} hitSlop={12} style={styles.backButton}>
            <Feather name="arrow-left" size={20} color={Colors.zinc600} />
          </Pressable>
        </View>
      )}

      {totalPages > 0 ? (
        <View
          style={[styles.pageListContainer, Platform.OS === "web" ? { touchAction: "none" } as object : undefined]}
          onLayout={handlePageListLayout}
          {...swipePanResponder.panHandlers}
        >
          <View
            style={[
              styles.readerFrame,
              {
                width: layout.containerWidth,
                height: layout.containerHeight,
                backgroundColor: ReaderTokens.bodyBg,
              },
            ]}
          >
            {isCommitting ? (
              <>
                <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: outX }] }]}>
                  {outgoingPageRef.current.showingCover ? (
                    <CoverPage
                      cover={cover}
                      title={article?.title ?? ""}
                      authorName={authorName}
                      containerWidth={layout.containerWidth}
                      containerHeight={layout.containerHeight}
                    />
                  ) : (
                    <>
                      <PageView
                        content={contentPages[Math.max(0, outgoingPageRef.current.page - 1)] ?? ""}
                        pageIndex={Math.max(0, outgoingPageRef.current.page - 1)}
                        onCollectSentence={handleCollectSentence}
                        onMemoSentence={handleMemoSentence}
                        onSelectionStateChange={(isSelecting) => { isTextSelectingRef.current = isSelecting; }}
                        bottomInset={insets.bottom}
                        layout={layout}
                      />
                      {outgoingPageRef.current.page > 0 && article && (
                        <View style={styles.titleBar}>
                          <Text style={dynamicStyles.articleTitle} numberOfLines={1}>{article.title}</Text>
                          {mode === "re_read" && (
                            <View style={styles.modeBadge}>
                              <Text style={dynamicStyles.modeBadgeText}>다시읽기</Text>
                            </View>
                          )}
                        </View>
                      )}
                    </>
                  )}
                </Animated.View>
                <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: inX }] }]}>
                  {showingCover ? (
                    <CoverPage
                      cover={cover}
                      title={article?.title ?? ""}
                      authorName={authorName}
                      containerWidth={layout.containerWidth}
                      containerHeight={layout.containerHeight}
                    />
                  ) : (
                    <>
                      <PageView
                        content={currentPageContent}
                        pageIndex={contentPageIndex}
                        onCollectSentence={handleCollectSentence}
                        onMemoSentence={handleMemoSentence}
                        onSelectionStateChange={(isSelecting) => { isTextSelectingRef.current = isSelecting; }}
                        bottomInset={insets.bottom}
                        layout={layout}
                      />
                      {!isOnCoverPage && article && (
                        <View style={styles.titleBar}>
                          <Text style={dynamicStyles.articleTitle} numberOfLines={1}>{article.title}</Text>
                          {mode === "re_read" && (
                            <View style={styles.modeBadge}>
                              <Text style={dynamicStyles.modeBadgeText}>다시읽기</Text>
                            </View>
                          )}
                        </View>
                      )}
                    </>
                  )}
                </Animated.View>
              </>
            ) : (
              <Animated.View style={{ flex: 1, transform: [{ translateX: outX }] }}>
                {showingCover ? (
                  <CoverPage
                    cover={cover}
                    title={article?.title ?? ""}
                    authorName={authorName}
                    containerWidth={layout.containerWidth}
                    containerHeight={layout.containerHeight}
                  />
                ) : (
                  <>
                    <PageView
                      content={currentPageContent}
                      pageIndex={contentPageIndex}
                      onCollectSentence={handleCollectSentence}
                      onMemoSentence={handleMemoSentence}
                      onSelectionStateChange={(isSelecting) => { isTextSelectingRef.current = isSelecting; }}
                      bottomInset={insets.bottom}
                      layout={layout}
                    />
                    {!isOnCoverPage && article && (
                      <View style={styles.titleBar}>
                        <Text style={dynamicStyles.articleTitle} numberOfLines={1}>{article.title}</Text>
                        {mode === "re_read" && (
                          <View style={styles.modeBadge}>
                            <Text style={dynamicStyles.modeBadgeText}>다시읽기</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </>
                )}
              </Animated.View>
            )}
          </View>

        </View>
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>페이지가 없습니다</Text>
        </View>
      )}

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.bottomProgressContainer}>
          <ProgressIndicator type="linear" progress={reading.progress} size="small" />
        </View>
        <Pressable
          onPress={() => setMemoSheetVisible(true)}
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
        snapPoints={mode === "re_read" ? [0.28] : [0.42]}
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
                style={[styles.completionButton, styles.completionButtonSecondary, isDeleting && styles.completionButtonDisabled]}
                onPress={handleCommitAndSkip}
                disabled={isDeleting}
              >
                <Text style={dynamicStyles.completionButtonSecondaryText}>{isDeleting ? "삭제 중..." : "삭제하기"}</Text>
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

              <View style={styles.completionSecondaryRow}>
                <Pressable
                  style={[styles.completionButton, styles.completionButtonSecondary, styles.completionButtonReread]}
                  onPress={() => {
                    setCompletionSheetVisible(false);
                    reading.restartReading();
                  }}
                >
                  <Text style={dynamicStyles.completionButtonSecondaryText}>다시 읽기</Text>
                </Pressable>
                <Pressable
                  style={[styles.completionButton, styles.completionButtonSecondary, styles.completionButtonDelete, isDeleting && styles.completionButtonDisabled]}
                  onPress={handleCommitAndSkip}
                  disabled={isDeleting}
                >
                  <Text style={dynamicStyles.completionButtonSecondaryText}>{isDeleting ? "삭제 중..." : "삭제하기"}</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </BottomSheet>

      <BottomSheet
        visible={sentencePopupVisible}
        onClose={() => setSentencePopupVisible(false)}
        title="문장 저장"
        titleStyle={dynamicStyles.sheetTitle}
        snapPoints={[0.3]}
      >
        <View style={styles.sentenceContent}>
          <Text style={dynamicStyles.sentencePreview} numberOfLines={3}>
            &ldquo;{selectedText}&rdquo;
          </Text>
          <View style={styles.sentenceActions}>
            <Pressable
              style={[styles.sentenceButton, styles.sentenceButtonCancel]}
              onPress={() => setSentencePopupVisible(false)}
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
        key={readingMemo.memoArticleId ?? "memo-loading"}
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
          (collectionsQuery.data ?? []).map((c: { id: string; name: string; articleCount?: number }) => ({
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
        isLoading={collectionsQuery.isLoading}
      />
    </View>
  );
}

interface ReaderLayout {
  containerWidth: number;
  containerHeight: number;
  paddingX: number;
  paddingY: number;
  safeAreaWidth: number;
  safeAreaHeight: number;
  bodyFontSize: number;
  captionFontSize: number;
  metadataFontSize: number;
  bodyLineHeight: number;
  bodyLetterSpacing: number;
  titleLineHeight: number;
  titleLetterSpacing: number;
}

function PageView({
  content,
  pageIndex,
  onCollectSentence,
  onMemoSentence,
  onSelectionStateChange,
  bottomInset,
  layout,
}: {
  content: string;
  pageIndex: number;
  onCollectSentence: (text: string) => void;
  onMemoSentence: (text: string) => void;
  onSelectionStateChange?: (isSelecting: boolean) => void;
  bottomInset: number;
  layout: ReaderLayout;
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
          paddingBottom: bottomInset + layout.paddingY,
        },
        blockWrapper: {
          marginBottom: layout.bodyLineHeight * 0.6,
        },
      }),
    [layout.safeAreaWidth, layout.paddingX, layout.paddingY, layout.bodyLineHeight, bottomInset],
  );

  return (
    <View style={[styles.pageContainer, { flex: 1 }]}>
      <View style={[dynamicPageStyles.safeAreaBox, { flex: 1 }]}>
        <View style={[dynamicPageStyles.pageContent, { flex: 1 }]}>
          {blocks.map((block, idx) => (
            <View key={`${pageIndex}-b-${idx}`} style={dynamicPageStyles.blockWrapper}>
              <MarkdownBlock
                block={block}
                onCollect={onCollectSentence}
                onMemo={onMemoSentence}
                onSelectionStateChange={onSelectionStateChange}
                fontSize={layout.bodyFontSize}
                lineHeight={layout.bodyLineHeight}
                letterSpacing={layout.bodyLetterSpacing}
              />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ReaderTokens.bodyBg,
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
  completionSecondaryRow: {
    flexDirection: "row",
    gap: 8,
    width: "100%",
  },
  completionButtonReread: {
    flex: 7,
  },
  completionButtonDelete: {
    flex: 3,
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
