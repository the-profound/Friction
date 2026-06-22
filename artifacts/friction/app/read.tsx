import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  ActivityIndicator,
  BackHandler,
  Alert,
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
  withSequence,
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

/* ─── QuestionBlockCard ────────────────────────────────────────────── */
function QuestionBlockCard({
  questionIndex,
  answers,
  onAnswerChange,
  onNext,
  onSkip,
}: {
  questionIndex: number;
  answers: string[];
  onAnswerChange: (index: number, value: string) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const q = QUESTION_BLOCK_QUESTIONS[questionIndex];

  return (
    <View style={qbStyles.card}>
      <View style={qbStyles.headerRow}>
        <Text style={qbStyles.questionText}>{q}</Text>
        {questionIndex === 0 && (
          <Pressable style={qbStyles.iconBtn} hitSlop={8}>
            <Feather name="refresh-cw" size={13} color={Colors.noticeAccent} />
          </Pressable>
        )}
        <Pressable style={qbStyles.iconBtn} onPress={onSkip} hitSlop={8}>
          <Feather name="x" size={13} color={Colors.zinc400} />
        </Pressable>
      </View>
      <TextInput
        style={qbStyles.answerInput}
        value={answers[questionIndex]}
        onChangeText={(t) => onAnswerChange(questionIndex, t)}
        placeholder="생각을 기록하세요..."
        placeholderTextColor={Colors.zinc400}
        multiline
        textAlignVertical="top"
      />
      <View style={qbStyles.checkRow}>
        <Pressable style={qbStyles.checkBtn} onPress={onNext} hitSlop={8}>
          <Feather name="check" size={13} color="#16a34a" />
        </Pressable>
      </View>
    </View>
  );
}

const qbStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    ...Platform.select({
      web: {
        boxShadow: "0 -2px 20px rgba(0,0,0,0.10), 0 4px 16px rgba(0,0,0,0.08)",
      } as object,
      default: {
        elevation: 6,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.10,
        shadowRadius: 12,
      },
    }),
    borderWidth: 1,
    borderColor: Colors.zinc100,
    padding: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginBottom: 10,
  },
  questionText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Pretendard-SemiBold",
    fontWeight: "600",
    color: Colors.zinc700,
    lineHeight: 20,
  },
  iconBtn: {
    padding: 2,
    marginTop: 1,
    flexShrink: 0,
  },
  answerInput: {
    width: "100%",
    borderWidth: 0,
    backgroundColor: Colors.zinc50,
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    fontFamily: "Eulyoo1945-Regular",
    color: Colors.zinc700,
    lineHeight: 22,
    minHeight: 88,
    textAlignVertical: "top",
  },
  checkRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
  },
  checkBtn: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: "rgba(22,163,74,0.10)",
    borderWidth: 1,
    borderColor: "rgba(22,163,74,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
});



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
    ? Math.min(reading.session.position.currentPage, totalPages - 1)
    : reading.session.position.currentPage;
  const isOnCoverPage = currentPage === 0;
  const contentPageIndex = Math.max(0, currentPage - 1);
  const isOnLastPage = totalPages > 0 && currentPage >= totalPages - 1;
  // 모든 글은 표지 페이지를 가진다(명시적 표지가 없으면 기본 표지로 자동 생성).
  // 페이지 0은 항상 표지 슬롯이므로 빈 슬롯/점프 hack/스와이프 차단이 필요 없다.
  const hasCover = !!article;


  const [finishOverlayVisible, setFinishOverlayVisible] = useState(false);
  const [sentencePopupVisible, setSentencePopupVisible] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0);
  const [memoSheetVisible, setMemoSheetVisible] = useState(false);
  const [memoAppendContent, setMemoAppendContent] = useState<string | undefined>(undefined);
  const [questionBlockIndex, setQuestionBlockIndex] = useState(0);
  const [questionBlockAnswers, setQuestionBlockAnswers] = useState<string[]>(
    () => Array(QUESTION_BLOCK_QUESTIONS.length).fill(""),
  );
  const [memoFreeMemo, setMemoFreeMemo] = useState("");
  const [memoTitle, setMemoTitle] = useState("");
  const [collectionPickerMode, setCollectionPickerMode] = useState(false);
  const [pickerTab, setPickerTab] = useState<"list" | "create">("list");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionDesc, setNewCollectionDesc] = useState("");
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  useEffect(() => {
    if (!finishOverlayVisible) {
      setCollectionPickerMode(false);
      setPickerTab("list");
      setNewCollectionName("");
      setNewCollectionDesc("");
    }
  }, [finishOverlayVisible]);
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
        pageListSize.width > 0 ? pageListSize.width : screenWidth,
        pageListSize.height > 0 ? pageListSize.height : screenWidth / ReaderTokens.aspectRatio,
        effectiveLayoutWidth,
      ),
    [pageListSize.width, pageListSize.height, screenWidth, effectiveLayoutWidth],
  );

  // Entry black overlay animation — starts transparent (value=0); on content
  // ready it plays transparent→black→transparent (2s total). No exit overlay.
  const overlayOpacity = useSharedValue(0);
  const overlayAnimStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  // Last-page [ < ] button fade-in
  const lastPageBtnOpacity = useSharedValue(mode === "re_read" ? 1 : 0);
  const lastPageBtnAnimStyle = useAnimatedStyle(() => ({
    opacity: lastPageBtnOpacity.value,
  }));

  // Shared values for layout dimensions — worklets must only read shared values,
  // not capture plain JS objects from the closure (Reanimated 4 restriction).
  const containerHSV = useSharedValue(pageListSize.height);
  const frameHSV = useSharedValue(layout.frameHeight);
  useLayoutEffect(() => {
    containerHSV.value = pageListSize.height;
    frameHSV.value = layout.frameHeight;
  }, [pageListSize.height, layout.frameHeight]);

  const cardAnimStyle = useAnimatedStyle(() => ({
    transform: [],
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

  // Entry animation: once content is ready, play transparent→black(1s)→transparent(1s).
  const hasStartedEntryFadeRef = useRef(false);
  useEffect(() => {
    if (!articleLoading && !reading.isRestoring && reading.isSessionHydrated && !hasStartedEntryFadeRef.current) {
      hasStartedEntryFadeRef.current = true;
      overlayOpacity.value = withSequence(
        withTiming(1, { duration: 1000, easing: Easing.in(Easing.ease) }),
        withTiming(0, { duration: 1000, easing: Easing.out(Easing.ease) }),
      );
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
      setQuestionBlockIndex(0);
      setMemoFreeMemo("");
      setQuestionBlockAnswers(Array(QUESTION_BLOCK_QUESTIONS.length).fill(""));
      setMemoTitle("〈" + (article?.title ?? "") + "〉을 읽고");
      setFinishOverlayVisible(true);
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
  // Individual page-turn animation (replaces shared row translateX).
  // pageTurnSV: 0 = no movement; –W = page fully turned (always moves negative).
  // containerWidthSV: synced copy of layout.containerWidth for worklet reads.
  const pageTurnSV = useSharedValue(0);
  const currentPageSV = useSharedValue(currentPage);
  const containerWidthSV = useSharedValue(layout.containerWidth);

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

  // Reset animation state after every page-turn commit (currentPage or layout change).
  useLayoutEffect(() => {
    currentPageSV.value = currentPage;
    pageTurnSV.value = 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, layout.containerWidth]);

  // Side-by-side pager: prev/current/next are laid out adjacently at
  // left = relPos * W (–W, 0, +W) and ALL slots slide together by pageTurnSV.
  // Because pages never overlap, each WebView (page + background + text) moves
  // as one solid sheet — like a real sheet of paper sliding across.
  //   pageTurnSV  0 → –W : forward turn (next comes into view from the right)
  //   pageTurnSV  0 → +W : backward turn (prev comes into view from the left)
  // z-index is intentionally NOT used: native WebViews do not honour RN z-index
  // when overlapping, which was the root cause of the text-overlap bug.
  const pageSlideAnimStyle = useAnimatedStyle(() => {
    return { transform: [{ translateX: pageTurnSV.value }] };
  });

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
      // pageTurnSV is reset by useLayoutEffect after currentPage changes
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
      // Forward turn: slide everything left so the finish overlay scrolls in.
      pageTurnSV.value = withTiming(-containerWidthRef.current, {
        duration: 240,
        easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
      }, () => {
        runOnJS(handleSwipeLeftRef.current)();
      });
    };
  });

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

      const W = gs.containerWidth || 300;
      if (dx < 0) {
        // Forward swipe: slide the whole strip left (next enters from the right).
        pageTurnSV.value = Math.max(dx, -W);
      } else if (dx > 0) {
        // Backward swipe: slide the whole strip right (prev enters from the left).
        pageTurnSV.value = Math.min(dx, W);
      }
    })
    .onEnd((e) => {
      if (isCommittingRef.current) return;
      if (isDraggingRef.current || isTextSelectingRef.current) {
        pageTurnSV.value = withSpring(0, snapConfig);
        return;
      }

      const gs = gestureState.current;
      const dx = e.translationX;
      const dy = e.translationY;
      const absDx = Math.abs(dx);
      const W = gs.containerWidth || 300;

      // Upward swipe → open memo sheet
      if (dy < -50 && Math.abs(dy) > absDx * 1.5) {
        pageTurnSV.value = withSpring(0, snapConfig);
        runOnJS(openMemoRef.current)();
        return;
      }

      if (!gs.canNavigate) {
        pageTurnSV.value = withSpring(0, snapConfig);
        return;
      }

      const goingNext = dx < 0;

      // Boundary checks
      if (goingNext && gs.isOnLastPage) {
        // Last page extra swipe → animate into finish overlay (forward direction).
        isCommittingRef.current = true;
        pageTurnSV.value = withTiming(-W, {
          duration: 240,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        }, () => {
          runOnJS(handleSwipeLeftRef.current)();
        });
        return;
      }
      if (!goingNext && gs.atBoundaryLeft) {
        pageTurnSV.value = withSpring(0, snapConfig);
        return;
      }

      const THRESHOLD = W * 0.22;
      const VELOCITY_THRESHOLD = 450;
      const shouldCommit = absDx > THRESHOLD || Math.abs(e.velocityX) > VELOCITY_THRESHOLD;

      if (!shouldCommit) {
        pageTurnSV.value = withSpring(0, snapConfig);
        return;
      }

      const direction: -1 | 1 = goingNext ? -1 : 1;
      isCommittingRef.current = true;

      // Forward → slide strip left (–W); backward → slide strip right (+W).
      pageTurnSV.value = withTiming(direction === -1 ? -W : W, {
        duration: 240,
        easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
      }, () => {
        runOnJS(finishPageTurnRef.current)(direction);
      });
    })
    .onFinalize(() => {
      // If gesture is cancelled externally, snap back to rest position.
      if (!isCommittingRef.current) {
        pageTurnSV.value = withSpring(0, snapConfig);
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
          Alert.alert("알림", "완독 기록은 저장했지만 보관함 추가에 실패했습니다.");
        }
      }

      setFinishOverlayVisible(false);
      trackArticleAction({ articleId, action: "save", msSinceComplete: Date.now() - completionTimeRef.current });
      invalidateInbox(queryClient);
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
      setFinishOverlayVisible(false);
      if (result.success) {
        trackArticleAction({ articleId, action: "skip", msSinceComplete: Date.now() - completionTimeRef.current });
        if (!isListEntry) {
          // 수신함 경로: 읽기 완료 후 수신함 목록 갱신
          invalidateInbox(queryClient);
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
            <Animated.View style={cardAnimStyle}>
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
                  overflow: "hidden",
                }}>
                  {/* Windowed page slots — each gets its own Animated.View with
                      direction-aware z-index and translateX for the overlay effect:
                      forward → current on top slides left, next already underneath;
                      backward → prev slides in from left on top, current stays. */}
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
                      const slots: React.ReactNode[] = [];
                      const start = Math.max(0, currentPage - 1);
                      const end = Math.min(totalPages - 1, currentPage + 1);
                      for (let pageIdx = start; pageIdx <= end; pageIdx++) {
                        const isCover = pageIdx === 0;
                        const cIdx = pageIdx - 1;
                        // Side-by-side layout: each slot is parked adjacently at
                        // left = relPos * W (prev –W, current 0, next +W) and the
                        // whole strip slides together via pageSlideAnimStyle, so a
                        // page's background + text always move as one solid sheet.
                        const relPos = pageIdx - currentPage;
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
                          <Animated.View
                            key={`page-${pageIdx}`}
                            style={[
                              {
                                position: "absolute",
                                top: 0,
                                left: relPos * layout.containerWidth,
                                width: layout.containerWidth,
                                height: layout.containerHeight,
                                backgroundColor: ReaderTokens.bodyBg,
                              },
                              pageSlideAnimStyle,
                            ]}
                          >
                            {node}
                          </Animated.View>,
                        );
                      }
                      return slots;
                    })()}
                  </View>
                </View>
              </View>
              </View>
            </Animated.View>

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

      {/* ── Memo FAB — bottom right ─────────────────────────────────────── */}
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

      {/* ── 마무리 화면 — 전체 화면 오버레이 ─────────────────────────── */}
      {finishOverlayVisible && (
        <FinishOverlay
          insets={insets}
          questionBlockIndex={questionBlockIndex}
          questionBlockAnswers={questionBlockAnswers}
          onAnswerChange={(index, value) => {
            setQuestionBlockAnswers(prev => {
              const copy = [...prev];
              copy[index] = value;
              return copy;
            });
          }}
          onNextQuestion={() => setQuestionBlockIndex(i => Math.min(i + 1, QUESTION_BLOCK_QUESTIONS.length - 1))}
          onSkipQuestion={() => setQuestionBlockIndex(i => Math.min(i + 1, QUESTION_BLOCK_QUESTIONS.length - 1))}
          memoTitle={memoTitle}
          onMemoTitleChange={setMemoTitle}
          memoContent={memoFreeMemo}
          onMemoContentChange={setMemoFreeMemo}
          collectionsData={collectionsQuery.data ?? []}
          selectedCollectionId={selectedCollectionId}
          onSelectCollection={(id) => {
            setSelectedCollectionId(id);
            updateRecentCollection.mutate(
              { id: userId, data: { collectionId: id } },
              { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetUserRecentCollectionQueryKey(userId) }) },
            );
          }}
          onPickerModeChange={setCollectionPickerMode}
          pickerMode={collectionPickerMode}
          pickerTab={pickerTab}
          onPickerTabChange={setPickerTab}
          newCollectionName={newCollectionName}
          onNewCollectionNameChange={setNewCollectionName}
          newCollectionDesc={newCollectionDesc}
          onNewCollectionDescChange={setNewCollectionDesc}
          isCreatingCollection={isCreatingCollection}
          onCreateCollection={async () => {
            if (!newCollectionName.trim()) return;
            setIsCreatingCollection(true);
            try {
              const newCol = await createCollection.mutateAsync({
                data: { ownerId: userId, name: newCollectionName.trim(), description: newCollectionDesc.trim() || undefined },
              });
              setSelectedCollectionId(newCol.id);
              invalidateMyCollections(queryClient);
              updateRecentCollection.mutate(
                { id: userId, data: { collectionId: newCol.id } },
                { onSuccess: () => invalidateRecentCollection(queryClient, userId) },
              );
              setNewCollectionName("");
              setNewCollectionDesc("");
              setPickerTab("list");
              setCollectionPickerMode(false);
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : "폴더 생성에 실패했습니다.";
              Alert.alert("생성 실패", msg);
            } finally {
              setIsCreatingCollection(false);
            }
          }}
          isSaving={isSaving}
          isDeleting={isDeleting}
          isCollectionsReady={isCollectionsReady}
          isReRead={mode === "re_read"}
          onSave={handleCommitAndSave}
          onExit={mode === "re_read"
            ? async () => {
                setFinishOverlayVisible(false);
                await readingMemo.cleanup();
                router.back();
              }
            : handleCommitAndSkip}
          onRestartReading={() => {
            setFinishOverlayVisible(false);
            reading.restartReading();
          }}
          dynamicStyles={dynamicStyles}
        />
      )}

      {/* ── 진입/퇴장 검은 오버레이 ──────────────────────────────────── */}
      <Animated.View
        style={[styles.blackOverlay, overlayAnimStyle]}
        pointerEvents="none"
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

/* ─── FinishOverlay — 마무리 화면 (그림자 없는 전체 화면) ──────────── */
interface FinishOverlayProps {
  insets: { top: number; bottom: number; left: number; right: number };
  questionBlockIndex: number;
  questionBlockAnswers: string[];
  onAnswerChange: (index: number, value: string) => void;
  onNextQuestion: () => void;
  onSkipQuestion: () => void;
  memoTitle: string;
  onMemoTitleChange: (v: string) => void;
  memoContent: string;
  onMemoContentChange: (v: string) => void;
  collectionsData: { id: string; name: string; articleCount?: number; isImpression?: boolean; isArchive?: boolean }[];
  selectedCollectionId: string | undefined;
  onSelectCollection: (id: string) => void;
  onPickerModeChange: (v: boolean) => void;
  pickerMode: boolean;
  pickerTab: "list" | "create";
  onPickerTabChange: (v: "list" | "create") => void;
  newCollectionName: string;
  onNewCollectionNameChange: (v: string) => void;
  newCollectionDesc: string;
  onNewCollectionDescChange: (v: string) => void;
  isCreatingCollection: boolean;
  onCreateCollection: () => void;
  isSaving: boolean;
  isDeleting: boolean;
  isCollectionsReady: boolean;
  isReRead: boolean;
  onSave: () => void;
  onExit: () => void;
  onRestartReading: () => void;
  dynamicStyles: {
    completionButtonText: object;
    completionButtonSecondaryText: object;
    completionButtonTertiaryText: object;
    [key: string]: object;
  };
}

function FinishOverlay({
  insets,
  questionBlockIndex,
  questionBlockAnswers,
  onAnswerChange,
  onNextQuestion,
  onSkipQuestion,
  memoTitle,
  onMemoTitleChange,
  memoContent,
  onMemoContentChange,
  collectionsData,
  selectedCollectionId,
  onSelectCollection,
  onPickerModeChange,
  pickerMode,
  pickerTab,
  onPickerTabChange,
  newCollectionName,
  onNewCollectionNameChange,
  newCollectionDesc,
  onNewCollectionDescChange,
  isCreatingCollection,
  onCreateCollection,
  isSaving,
  isDeleting,
  isCollectionsReady,
  isReRead,
  onSave,
  onExit,
  onRestartReading,
  dynamicStyles,
}: FinishOverlayProps) {
  const selectedColName = collectionsData.find(c => c.id === selectedCollectionId)?.name ?? "보관함";
  const visibleCollections = collectionsData
    .filter(c => !c.isArchive)
    .map(c => ({ id: c.id, name: c.name, articleCount: c.articleCount, isImpression: c.isImpression ?? false }))
    .sort((a, b) => {
      if (a.isImpression !== b.isImpression) return a.isImpression ? -1 : 1;
      return (b.articleCount ?? 0) - (a.articleCount ?? 0);
    });

  return (
    <View style={[finishStyles.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {pickerMode ? (
        /* ── 폴더 선택 모드 ── */
        <View style={finishStyles.pickerContainer}>
          <ScalePressable
            style={styles.pickerBackRow}
            onPress={() => {
              if (pickerTab === "create") {
                onPickerTabChange("list");
                onNewCollectionNameChange("");
                onNewCollectionDescChange("");
              } else {
                onPickerModeChange(false);
              }
            }}
            contentStyle={styles.pickerBackRowContent}
          >
            <Feather name="chevron-left" size={18} color={Colors.zinc600} />
            <Text style={styles.pickerBackText}>보관할 폴더 선택</Text>
          </ScalePressable>

          <View style={styles.pickerTabBar}>
            <ScalePressable
              style={[styles.pickerTab, pickerTab === "list" && styles.pickerTabActive]}
              onPress={() => onPickerTabChange("list")}
            >
              <Text style={[styles.pickerTabText, pickerTab === "list" && styles.pickerTabTextActive]}>내 폴더</Text>
            </ScalePressable>
            <ScalePressable
              style={[styles.pickerTab, pickerTab === "create" && styles.pickerTabActive]}
              onPress={() => onPickerTabChange("create")}
            >
              <Text style={[styles.pickerTabText, pickerTab === "create" && styles.pickerTabTextActive]}>새 폴더에 추가</Text>
            </ScalePressable>
          </View>

          {pickerTab === "list" ? (
            <FlatList
              data={visibleCollections}
              keyExtractor={item => item.id}
              renderItem={({ item }) => {
                const isSelected = item.id === selectedCollectionId;
                return (
                  <ScalePressable
                    style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                    onPress={() => { onSelectCollection(item.id); onPickerModeChange(false); }}
                    contentStyle={styles.pickerItemContent}
                  >
                    <View style={styles.pickerItemLeft}>
                      <Feather name={item.isImpression ? "heart" : "folder"} size={18} color={isSelected ? Colors.zinc900 : Colors.zinc500} />
                      <Text style={[styles.pickerItemName, isSelected && styles.pickerItemNameSelected]} numberOfLines={1}>{item.name}</Text>
                    </View>
                    <View style={styles.pickerItemRight}>
                      {item.articleCount !== undefined && <Text style={styles.pickerItemCount}>{item.articleCount}편</Text>}
                      {isSelected && <Feather name="check" size={16} color={Colors.zinc900} />}
                    </View>
                  </ScalePressable>
                );
              }}
              ItemSeparatorComponent={() => <View style={styles.pickerSeparator} />}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.pickerListContent}
              ListEmptyComponent={
                <View style={styles.pickerEmpty}>
                  <Text style={styles.pickerEmptyText}>보관할 폴더가 없어요</Text>
                  <Text style={styles.pickerEmptySubtext}>새 폴더에 추가 탭에서 만들어보세요</Text>
                </View>
              }
            />
          ) : (
            <View style={styles.pickerCreateForm}>
              <TextInput
                style={styles.pickerCreateInput}
                placeholder="폴더 이름"
                placeholderTextColor={Colors.zinc400}
                value={newCollectionName}
                onChangeText={onNewCollectionNameChange}
                autoFocus
              />
              <TextInput
                style={[styles.pickerCreateInput, styles.pickerCreateInputMulti]}
                placeholder="설명 (선택사항)"
                placeholderTextColor={Colors.zinc400}
                value={newCollectionDesc}
                onChangeText={onNewCollectionDescChange}
                multiline
                textAlignVertical="top"
              />
              <ScalePressable
                style={[styles.pickerCreateButton, (!newCollectionName.trim() || isCreatingCollection) && styles.pickerCreateButtonDisabled]}
                onPress={onCreateCollection}
                disabled={!newCollectionName.trim() || isCreatingCollection}
                contentStyle={styles.pickerCreateButtonContent}
              >
                {isCreatingCollection
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={styles.pickerCreateButtonText}>만들기</Text>
                }
              </ScalePressable>
            </View>
          )}
        </View>
      ) : (
        /* ── 마무리 화면 메인 ── */
        <ScrollView
          style={finishStyles.scrollArea}
          contentContainerStyle={finishStyles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* 질문 블록 */}
          <QuestionBlockCard
            questionIndex={questionBlockIndex}
            answers={questionBlockAnswers}
            onAnswerChange={onAnswerChange}
            onNext={onNextQuestion}
            onSkip={onSkipQuestion}
          />

          {/* 메모 쓰기 영역 */}
          <View style={finishStyles.memoSection}>
            <TextInput
              style={finishStyles.memoTitleInput}
              value={memoTitle}
              onChangeText={onMemoTitleChange}
              placeholder="메모 제목"
              placeholderTextColor={Colors.zinc400}
              returnKeyType="done"
            />
            <View style={finishStyles.memoDivider} />
            <TextInput
              style={finishStyles.memoBodyInput}
              value={memoContent}
              onChangeText={onMemoContentChange}
              placeholder="자유롭게 메모하세요..."
              placeholderTextColor={Colors.zinc400}
              multiline
              textAlignVertical="top"
            />
          </View>

          {/* 액션 버튼들 */}
          <View style={finishStyles.actionSection}>
            {/* 폴더 선택 */}
            <ScalePressable
              style={styles.collectionSelector}
              onPress={() => onPickerModeChange(true)}
              disabled={isSaving}
              contentStyle={styles.collectionSelectorContent}
            >
              <Feather name="folder" size={16} color={Colors.zinc500} />
              <Text style={styles.collectionSelectorText} numberOfLines={1}>{selectedColName}</Text>
              <Feather name="chevron-right" size={16} color={Colors.zinc400} />
            </ScalePressable>

            <ScalePressable
              style={[styles.completionButton, (isSaving || !isCollectionsReady) && styles.completionButtonDisabled]}
              onPress={onSave}
              disabled={isSaving}
              contentStyle={styles.completionButtonContent}
            >
              <Text style={dynamicStyles.completionButtonText}>
                {isSaving ? "저장 중..." : !isCollectionsReady ? "불러오는 중..." : "보관"}
              </Text>
            </ScalePressable>

            <ScalePressable
              style={[styles.completionButton, styles.completionButtonSecondary, isDeleting && styles.completionButtonDisabled]}
              onPress={onExit}
              disabled={!isReRead && isDeleting}
              contentStyle={styles.completionButtonContent}
            >
              <Text style={dynamicStyles.completionButtonSecondaryText}>
                {!isReRead && isDeleting ? "처리 중..." : "나가기"}
              </Text>
            </ScalePressable>

            <ScalePressable
              style={styles.completionButtonTertiary}
              onPress={onRestartReading}
              contentStyle={styles.completionButtonTertiaryContent}
            >
              <Text style={dynamicStyles.completionButtonTertiaryText}>다시 읽기</Text>
            </ScalePressable>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const finishStyles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: ReaderTokens.bodyBg,
    zIndex: 50,
  },
  pickerContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 20,
  },
  memoSection: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.zinc100,
    padding: 14,
  },
  memoTitleInput: {
    fontSize: 15,
    fontFamily: "Pretendard-SemiBold",
    fontWeight: "700",
    color: Colors.zinc800,
    padding: 0,
    marginBottom: 8,
  },
  memoDivider: {
    height: 1,
    backgroundColor: Colors.zinc100,
    marginBottom: 10,
  },
  memoBodyInput: {
    fontSize: 14,
    fontFamily: "Eulyoo1945-Regular",
    color: Colors.zinc700,
    lineHeight: 26,
    minHeight: 120,
    textAlignVertical: "top",
    padding: 0,
  },
  actionSection: {
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
    width: "80%",
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
  pickerContainer: {
    flex: 1,
  },
  pickerBackRow: {
    paddingBottom: 12,
    marginBottom: 4,
  },
  pickerBackRowContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,},
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
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  pickerItemContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",},
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
    marginTop: 4,
  },
  pickerCreateButtonContent: {
    alignItems: "center",},
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
