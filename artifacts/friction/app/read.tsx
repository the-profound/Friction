import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Image,
  BackHandler,
  AppState,
  Platform,
  ScrollView,
  Pressable,
  Keyboard,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import MemoWebEditor, {
  type MemoWebEditorRef,
  type FormatType,
  type MemoOverflowSplitPayload,
} from "@/components/MemoWebEditor/MemoWebEditor";
import MemoToolbar, { type AttachMenuAnchor } from "@/components/MemoToolbar/MemoToolbar";
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
  type SharedValue,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import QuestionCardCurl, { type QuestionCardCurlHandle } from "@/components/QuestionCardCurl/QuestionCardCurl";
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
import QuoteSentencePickerBottomSheet from "@/components/QuoteSentencePickerBottomSheet/QuoteSentencePickerBottomSheet";
import type { StoredSentence } from "@workspace/api-client-react";
import CoverPreview from "@/components/CoverPreview/CoverPreview";
import { resolveArticleCover } from "@/utils/articleCover";
import CoverPage from "@/components/CoverPage/CoverPage";
import WebViewMarkdownReader from "@/components/WebViewMarkdownReader";
import { normalizePageItem } from "@/utils/normalizePageItem";
import { parseMemoPages, serializeMemoPages, buildReplyContent } from "@/utils/memoPages";
import { parseMarkdownBlocks, type MarkdownBlockType } from "@/utils/markdownParser";
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
  useGetArticleQuestions,
  getGetArticleQuestionsQueryKey,
  getGetUserRecentCollectionQueryKey,
  getListInboxQueryKey,
  getListStoredSentencesQueryKey,
} from "@workspace/api-client-react";
import { invalidateInbox, invalidateMyCollections, invalidateRecentCollection } from "@/lib/queryInvalidation";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import ActionSheetModal from "@/components/ActionSheetModal/ActionSheetModal";
import { useUser } from "@/contexts/UserContext";
import { useActiveReading } from "@/contexts/ActiveReadingContext";
import type { ReadingMode } from "@/lib/policies";
import { useToast } from "@/contexts/ToastContext";

// Horizontal padding on each side of the reader card so the drop-shadow is
// visible left and right. Must match pageListContainer.paddingHorizontal below.
const READER_SIDE_PAD = 14;
const ATTACH_MENU_WIDTH = 120;
const ATTACH_MENU_GAP = 8;

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

  const articleQuestionsQuery = useGetArticleQuestions(articleId, {
    query: { queryKey: getGetArticleQuestionsQueryKey(articleId), enabled: !!articleId },
  });
  const questionCardQuestions = articleQuestionsQuery.data?.questions;

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
  const questionCardRef = useRef<QuestionCardCurlHandle>(null);
  const [exitConfirmVisible, setExitConfirmVisible] = useState(false);
  const [sentencePopupVisible, setSentencePopupVisible] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0);
  const [readingCompleteVisible, setReadingCompleteVisible] = useState(false);
  // 읽기 완료 화면 caseType (QuestionCardCurl 콜백에서 결정됨)
  const [readingCompleteCaseType, setReadingCompleteCaseType] = useState<"answered" | "read">("read");
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

  // 완료 커밋(보관/건너뛰기/재읽기 종료) 직전에 호출된다. 질문 카드에
  // 한 글자 이상 답한 카드가 있으면, 읽기 중 메모 내용과 합쳐 최종 답장 글
  // 본문을 만들고 이를 readingMemo의 최신 저장 대상 내용으로 동기적으로
  // 반영한다 — 뒤이은 readingMemo.cleanup() 이 이 합쳐진 내용을 커밋한다.
  // 답한 카드가 하나도 없으면 기존 메모 단독 흐름을 그대로 둔다.
  const applyAnsweredQuestionCardsToMemo = useCallback(() => {
    const answeredCards = questionCardRef.current?.getAnsweredCards() ?? [];
    if (answeredCards.length === 0) return;
    const finalContent = buildReplyContent(readingMemo.memoContent, answeredCards);
    if (finalContent.trim()) {
      readingMemo.updateMemoContent(finalContent);
    }
  }, [readingMemo]);

  const memoContentRef = useRef(readingMemo.memoContent);
  useEffect(() => { memoContentRef.current = readingMemo.memoContent; }, [readingMemo.memoContent]);

  // ── 메모 모드 (페이지네이션) ──────────────────────────────────────────────
  const [isMemoMode, setIsMemoMode] = useState(false);
  const [memoPages, setMemoPages] = useState<string[]>([""]);
  const [memoPageIndex, setMemoPageIndex] = useState(0);
  // 현재(회전 중인) 페이지 콘텐츠의 정적 블록. WebView가 숨겨지는 애니메이션
  // 구간 동안 대신 렌더된다 — memoPages/memoPageIndex 가 바뀌면 자동으로
  // 최신 콘텐츠를 반영한다.
  const memoFrontBlocks = useMemo(
    () => parseMarkdownBlocks(memoPages[memoPageIndex] ?? ""),
    [memoPages, memoPageIndex],
  );
  const [memoActiveFormats, setMemoActiveFormats] = useState<Set<FormatType>>(new Set());
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const isMemoModeRef = useRef(false);
  const memoPageIndexRef = useRef(0);
  const memoWebRef = useRef<MemoWebEditorRef>(null);
  const memoPagesRef = useRef<string[]>([""]);
  const keyboardVisibleRef = useRef(false);
  const memoSlideX = useSharedValue(layout.containerWidth + 40);
  // 키보드가 열려 있는 동안 위/아래 드래그로 메모 카드 자체를 이동시키는
  // (WebView 내부 스크롤이 아닌) translateY 값. 키보드가 닫히면 0으로
  // 애니메이션 복귀한 뒤에만 다시 페이지 플립 제스처가 활성화된다.
  const memoEditScrollY = useSharedValue(0);
  // 카드를 위로 끌어올릴 수 있는 최대치(px). 키보드 높이에 맞춰 갱신된다.
  const memoEditScrollMaxRef = useRef(0);
  // 편집-스크롤 드래그가 시작될 때 카드의 현재 오프셋을 기록해 둔다.
  // translationY 는 매 제스처마다 0에서 다시 시작하므로, 이전 드래그가
  // 남겨둔 오프셋 위에 새 드래그를 이어 붙이려면 시작점을 더해야 한다
  // (그렇지 않으면 새 드래그가 시작될 때마다 카드가 0으로 스냅했다가
  // 다시 움직이는 것처럼 보인다).
  const memoEditScrollStartRef = useRef(0);
  // 키보드가 닫혀 카드가 중앙으로 복귀 애니메이션 중인 동안 true — 이 구간
  // 에는 드래그를 무시해 플립 제스처가 섣불리 활성화되지 않게 막는다.
  const memoReturningRef = useRef(false);
  // 메모 모드 진입/종료와 동기화되어 편지 페이지 pager를 좌우로 밀어내는
  // 공유 애니메이션 값. 메모가 우측(W+40)→중앙으로 들어올 때 0→-(W+40)으로,
  // 메모가 중앙→우측으로 나갈 때 -(W+40)→0으로 memoSlideX와 같은
  // 지속시간/이징으로 움직인다 — 이동 내내 두 페이지 사이 40px 간격이 유지되고
  // 밀려난 편지는 좌측 패딩·그림자까지 포함해 완전히 화면 밖으로 사라진다.
  const letterSlideX = useSharedValue(0);
  const handleNextMemoPageRef = useRef<() => void>(() => {});
  const handlePrevMemoPageRef = useRef<() => void>(() => {});

  // 3D flip animation state (버튼 + 스와이프 공용)
  const memoFlipAngle = useSharedValue(0);
  // 현재 페이지가 들리기 시작하는 순간부터 그 뒤에 "이미 놓여 있는" 다음/이전
  // 페이지를 정적으로 렌더링하기 위한 미리보기 블록. null이면 미리보기 레이어를
  // 렌더링하지 않는다.
  const [memoPreviewBlocks, setMemoPreviewBlocks] = useState<MarkdownBlockType[] | null>(null);
  const memoPreviewIdxRef = useRef<number | null>(null);
  // 드래그/플립 애니메이션 진행 중에는 실제 편집용 WebView를 숨기고(3D 회전 중
  // 흰 화면 깜빡임/갱신 지연 문제가 있음) 즉시 렌더되는 정적 블록을 대신
  // 보여준다. 각도가 0(정지)으로 돌아오면 다시 WebView를 드러낸다.
  const [memoIsFlipping, setMemoIsFlipping] = useState(false);
  const memoIsFlippingRef = useRef(false);
  const markMemoFlipActive = useCallback(() => {
    if (!memoIsFlippingRef.current) {
      memoIsFlippingRef.current = true;
      setMemoIsFlipping(true);
    }
  }, []);
  const markMemoFlipIdle = useCallback(() => {
    memoIsFlippingRef.current = false;
    setMemoIsFlipping(false);
  }, []);
  const memoPagesTotalRef = useRef(1);
  const memoContainerHeightRef = useRef(600);
  const memoContainerWidthRef = useRef(300);
  const memoFlipAnimRunning = useRef(false);
  // 페이지 전환 대기 상태: export(현재 페이지 저장) 완료 후 실제 플립 실행
  const pendingTurnRef = useRef<number | null>(null);
  const memoTurnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 메모 에디터 선택 핸들 드래그 중에는 스와이프 플립 제스처를 비활성화한다.
  const memoTextSelectingRef = useRef(false);
  const handleMemoSelectionActiveChange = useCallback((active: boolean) => {
    memoTextSelectingRef.current = active;
  }, []);

  // MemoWebEditor 내부 레이아웃(hintRow + editorWrap)과 동일한 공식으로 계산한
  // 실제 편집 가능 높이 — 오버플로 자동 분할 감지에 사용된다.
  const memoAvailableContentHeightPx = useMemo(() => {
    const hintRowH = layout.bodyFontSize * 0.78 + layout.paddingY * 0.6;
    return Math.max(0, layout.containerHeight - hintRowH - insets.bottom);
  }, [layout.containerHeight, layout.bodyFontSize, layout.paddingY, insets.bottom]);

  const memoAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: memoSlideX.value },
      { translateY: memoEditScrollY.value },
    ],
  }));

  const letterAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: letterSlideX.value }],
  }));

  // 메모 모드 진입/종료에 맞춰 하단 진행률 바를 fade out/in 한다.
  const progressBarOpacity = useSharedValue(1);
  useEffect(() => {
    progressBarOpacity.value = withTiming(isMemoMode ? 0 : 1, {
      duration: 240,
      easing: isMemoMode ? Easing.out(Easing.ease) : Easing.in(Easing.ease),
    });
  }, [isMemoMode, progressBarOpacity]);
  const progressBarAnimStyle = useAnimatedStyle(() => ({
    opacity: progressBarOpacity.value,
  }));

  useEffect(() => { isMemoModeRef.current = isMemoMode; }, [isMemoMode]);
  useEffect(() => { memoPageIndexRef.current = memoPageIndex; }, [memoPageIndex]);
  useEffect(() => { memoPagesTotalRef.current = memoPages.length; }, [memoPages.length]);
  useEffect(() => { memoContainerHeightRef.current = layout.containerHeight; }, [layout.containerHeight]);
  useEffect(() => { memoContainerWidthRef.current = layout.containerWidth; }, [layout.containerWidth]);

  // Keyboard height tracking for toolbar
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      setKeyboardVisible(true);
      keyboardVisibleRef.current = true;
      memoEditScrollMaxRef.current = Math.min(
        e.endCoordinates.height,
        memoContainerHeightRef.current * 0.45,
      );
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
      setKeyboardVisible(false);
      keyboardVisibleRef.current = false;
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // 키보드가 닫히면 (열려 있는 동안 드래그로 이동했던) 메모 카드를 중앙으로
  // 부드럽게 복귀시킨다. 복귀 애니메이션이 끝나기 전까지는 스와이프 플립
  // 제스처가 재활성화되지 않도록 memoReturningRef 로 막는다.
  const clearMemoReturning = useCallback(() => {
    memoReturningRef.current = false;
  }, []);
  useEffect(() => {
    if (keyboardVisible) return;
    if (memoEditScrollY.value === 0) return;
    memoReturningRef.current = true;
    // 키보드가 빠르게 열고 닫히며 이 이펙트가 다시 실행되면 위 withTiming이
    // 취소(finished=false)될 수 있다. `finished` 여부와 무관하게 항상
    // clearMemoReturning을 호출해야 memoReturningRef가 true로 멈춰
    // 스와이프 플립 제스처가 영구히 막히는 것을 방지한다.
    memoEditScrollY.value = withTiming(
      0,
      { duration: 220, easing: Easing.inOut(Easing.ease) },
      () => {
        runOnJS(clearMemoReturning)();
      },
    );
  }, [keyboardVisible, clearMemoReturning, memoEditScrollY]);

  // Sync memo pages from readingMemo.memoContent when not in memo mode
  useEffect(() => {
    if (isMemoModeRef.current) return;
    const pages = parseMemoPages(readingMemo.memoContent);
    memoPagesRef.current = pages;
    setMemoPages(pages);
  }, [readingMemo.memoContent]);

  const enterMemoMode = useCallback((appendText?: string) => {
    const currentContent = memoContentRef.current;
    const pages = parseMemoPages(currentContent);
    if (appendText) {
      // Append text to last page and immediately persist so the quote isn't lost
      const lastIdx = pages.length - 1;
      const base = pages[lastIdx] ?? "";
      pages[lastIdx] = base ? `${base}\n\n${appendText}` : appendText;
      readingMemo.updateMemoContent(serializeMemoPages(pages));
    }
    memoPagesRef.current = pages;
    setMemoPages(pages);
    setMemoPageIndex(pages.length - 1);
    memoPageIndexRef.current = pages.length - 1;
    memoFlipAngle.value = 0;
    memoPreviewIdxRef.current = null;
    setMemoPreviewBlocks(null);
    memoFlipAnimRunning.current = false;
    memoIsFlippingRef.current = false;
    setMemoIsFlipping(false);
    pendingTurnRef.current = null;
    setMemoActiveFormats(new Set());
    setIsMemoMode(true);
    memoSlideX.value = (layout.containerWidth + 40);
    letterSlideX.value = 0;
    requestAnimationFrame(() => {
      memoSlideX.value = withTiming(0, { duration: 320, easing: Easing.bezier(0.25, 0.46, 0.45, 0.94) });
      // 메모(우측 W+40에서 시작)와 대칭으로 편지도 -(W+40)까지 밀어내야
      // 두 페이지 사이 40px 간격이 유지되고, 화면 좌측 패딩/그림자까지 포함해
      // 편지가 완전히 화면 밖으로 사라진다.
      letterSlideX.value = withTiming(-(layout.containerWidth + 40), { duration: 320, easing: Easing.bezier(0.25, 0.46, 0.45, 0.94) });
    });
  }, [layout.containerWidth, memoSlideX, letterSlideX, memoFlipAngle, readingMemo]);

  const exitMemoMode = useCallback(() => {
    // 현재 페이지의 최신 편집 내용을 저장한 뒤 슬라이드 아웃한다.
    memoWebRef.current?.requestExport("exit");
    memoWebRef.current?.blur();
    Keyboard.dismiss();
    memoSlideX.value = withTiming(layout.containerWidth + 40, {
      duration: 280,
      easing: Easing.in(Easing.ease),
    }, () => {
      runOnJS(setIsMemoMode)(false);
    });
    letterSlideX.value = withTiming(0, {
      duration: 280,
      easing: Easing.in(Easing.ease),
    });
  }, [layout.containerWidth, memoSlideX, letterSlideX]);

  // 특정 인덱스의 페이지 내용을 저장 + 영속화
  const saveMemoPage = useCallback((idx: number, markdown: string) => {
    setMemoPages((prev) => {
      if (idx < 0 || idx >= prev.length || prev[idx] === markdown) return prev;
      const next = [...prev];
      next[idx] = markdown;
      memoPagesRef.current = next;
      readingMemo.updateMemoContent(serializeMemoPages(next));
      return next;
    });
  }, [readingMemo]);

  const finishFlip = useCallback(() => {
    memoFlipAnimRunning.current = false;
  }, []);

  // targetIdx 페이지를 "뒤에 이미 놓여 있는" 정적 미리보기로 표시한다. 같은
  // 페이지가 이미 표시 중이면 다시 파싱/렌더하지 않는다.
  const showMemoPreview = useCallback((targetIdx: number) => {
    if (memoPreviewIdxRef.current === targetIdx) return;
    memoPreviewIdxRef.current = targetIdx;
    setMemoPreviewBlocks(parseMarkdownBlocks(memoPagesRef.current[targetIdx] ?? ""));
  }, []);

  const clearMemoPreview = useCallback(() => {
    memoPreviewIdxRef.current = null;
    setMemoPreviewBlocks(null);
  }, []);

  // 플립 후반부: edge-on(±90°) 상태에서 콘텐츠를 다음 페이지로 교체한 뒤
  // 반대편에서 원위치(0°)로 회전시킨다. 다음 페이지는 정적 미리보기 레이어로
  // 이미 뒤에 놓여 있었으므로, 여기서는 그 위를 덮던 (지금은 콘텐츠가 같아진)
  // 카드를 제자리로 되돌리기만 하면 된다 — 별도의 가림막이 필요 없다.
  // 아래 두 애니메이션 콜백은 의도적으로 `finished` 플래그를 무시하고 항상
  // 정리(클린업) 로직을 실행한다. Reanimated의 withTiming 콜백은 새 값
  // 대입 등으로 애니메이션이 중간에 취소되면 finished=false 로 호출되는데,
  // 과거에는 `if (finished)` 로 감싸 두어 취소된 경우 markMemoFlipIdle 등이
  // 전혀 호출되지 않았다. 그 결과 카드가 edge-on(±90°)으로 멈춘 채 실제
  // WebView(페이지 수/힌트/placeholder 포함)는 opacity:0으로 계속 숨겨지고,
  // 텍스트가 없는 previewBlocks 레이어만 남아 완전한 백지 카드로 보이는
  // 버그가 있었다. 취소 여부와 무관하게 항상 idle 상태로 수렴시켜야
  // 이런 교착을 방지할 수 있다.
  const afterFlipHalf = useCallback((targetIdx: number, dir: number) => {
    setMemoPageIndex(targetIdx);
    memoPageIndexRef.current = targetIdx;
    memoWebRef.current?.setMarkdown(memoPagesRef.current[targetIdx] ?? "");
    setMemoActiveFormats(new Set());
    memoFlipAngle.value = -dir * 90;
    memoFlipAngle.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.ease) }, () => {
      runOnJS(clearMemoPreview)();
      runOnJS(finishFlip)();
      runOnJS(markMemoFlipIdle)();
    });
  }, [memoFlipAngle, finishFlip, clearMemoPreview, markMemoFlipIdle]);

  // 플립 전반부: 현재 페이지를 edge-on(±90°)까지 회전시켜 사라지게 함.
  // 회전이 시작되는 순간부터 목표 페이지를 정적 미리보기로 뒤에 깔아 둔다.
  const runFlip = useCallback((targetIdx: number) => {
    markMemoFlipActive();
    showMemoPreview(targetIdx);
    const dir = targetIdx > memoPageIndexRef.current ? 1 : -1;
    memoFlipAngle.value = withTiming(dir * 90, { duration: 160, easing: Easing.in(Easing.ease) }, () => {
      runOnJS(afterFlipHalf)(targetIdx, dir);
    });
  }, [memoFlipAngle, afterFlipHalf, showMemoPreview, markMemoFlipActive]);

  // 페이지 전환: 현재 페이지를 export(저장)한 뒤 플립 실행
  const flipToPage = useCallback((targetIdx: number) => {
    if (memoFlipAnimRunning.current) return;
    const curIdx = memoPageIndexRef.current;
    if (targetIdx === curIdx || targetIdx < 0 || targetIdx >= memoPagesRef.current.length) return;
    memoFlipAnimRunning.current = true;
    pendingTurnRef.current = targetIdx;
    memoWebRef.current?.requestExport(`turn:${targetIdx}`);
    // export 이벤트가 오지 않는 경우(에디터 미준비 등) 대비 fallback
    if (memoTurnTimerRef.current) clearTimeout(memoTurnTimerRef.current);
    memoTurnTimerRef.current = setTimeout(() => {
      if (pendingTurnRef.current === targetIdx) {
        pendingTurnRef.current = null;
        runFlip(targetIdx);
      }
    }, 220);
  }, [runFlip]);

  // WebView 에디터의 export 결과 수신 → 현재 페이지 저장 + (turn 요청이면) 플립 실행
  const handleMemoExport = useCallback((markdown: string, requestId: string) => {
    const savedIdx = memoPageIndexRef.current;
    saveMemoPage(savedIdx, markdown);
    if (requestId.startsWith("turn:")) {
      const target = pendingTurnRef.current;
      pendingTurnRef.current = null;
      if (memoTurnTimerRef.current) { clearTimeout(memoTurnTimerRef.current); memoTurnTimerRef.current = null; }
      if (target != null && target !== savedIdx) {
        runFlip(target);
      } else {
        memoFlipAnimRunning.current = false;
      }
    }
  }, [saveMemoPage, runFlip]);

  // 타이핑 중 현재 페이지가 넘칠 때 WebView 가 보고하는 분할 이벤트 처리:
  // 넘치기 전 내용은 현재 페이지에 남기고, 넘친 내용은 다음 페이지 맨
  // 앞에 이어붙인 뒤(다음 페이지가 없으면 새로 만든다) 기존 플립
  // 애니메이션으로 자연스럽게 넘어간다.
  const handleMemoOverflowSplit = useCallback((payload: MemoOverflowSplitPayload) => {
    if (memoFlipAnimRunning.current) return;
    const idx = memoPageIndexRef.current;
    const pages = memoPagesRef.current;
    const { beforeMarkdown, afterMarkdown } = payload;

    const hasNext = idx < pages.length - 1;
    const mergedNext = hasNext
      ? `${afterMarkdown}\n\n${pages[idx + 1] ?? ""}`.replace(/\n{3,}/g, "\n\n")
      : afterMarkdown;

    const nextPages = pages.slice();
    nextPages[idx] = beforeMarkdown;
    if (hasNext) {
      nextPages[idx + 1] = mergedNext;
    } else {
      nextPages.push(mergedNext);
    }
    memoPagesRef.current = nextPages;
    setMemoPages(nextPages);
    readingMemo.updateMemoContent(serializeMemoPages(nextPages));
    memoWebRef.current?.setMarkdown(beforeMarkdown);

    memoFlipAnimRunning.current = true;
    runFlip(idx + 1);
  }, [readingMemo, runFlip]);

  const handleNextMemoPage = useCallback(() => {
    if (memoFlipAnimRunning.current) return;
    const idx = memoPageIndexRef.current;
    const pages = memoPagesRef.current;
    if (idx < pages.length - 1) {
      flipToPage(idx + 1);
    } else {
      // 마지막 페이지에서 새 빈 페이지 추가 후 이동
      const next = [...pages, ""];
      memoPagesRef.current = next;
      setMemoPages(next);
      readingMemo.updateMemoContent(serializeMemoPages(next));
      flipToPage(next.length - 1);
    }
  }, [flipToPage, readingMemo]);

  const handlePrevMemoPage = useCallback(() => {
    const idx = memoPageIndexRef.current;
    if (idx > 0) flipToPage(idx - 1);
  }, [flipToPage]);

  // 스와이프 제스처에서도 버튼과 동일한 export→플립 흐름을 재사용하기 위한 ref.
  // (Gesture.Pan은 useMemo(deps=[])로 한 번만 생성되므로 최신 콜백은 ref로 참조한다.)
  const flipToPageRef = useRef(flipToPage);
  useEffect(() => { flipToPageRef.current = flipToPage; }, [flipToPage]);

  // 메모 모드 스와이프 3D 플립 제스처.
  // rotateX 는 가로축을 기준으로 앞/뒤로 넘어가는 회전이므로, 손가락도 상하(수직)로
  // 움직인 양에 비례해 memoFlipAngle 을 실시간으로 갱신한다(rotateX 입체 효과).
  // 임계값을 넘겨 손을 떼면 flipToPage 로 커밋(export→edge-on→콘텐츠 교체→복귀),
  // 못 넘기면 0도로 스냅백한다. 더 넘길 페이지가 없는 경계에서는 살짝만 젖혀졌다가
  // 스냅백되는 저항 효과를 준다. (위로 스와이프 = 다음 페이지, 아래로 스와이프 = 이전 페이지)
  const memoPanGesture = useMemo(() => Gesture.Pan()
    .runOnJS(true)
    .minDistance(6)
    .activeOffsetY([-10, 10])
    .failOffsetX([-14, 14])
    .onBegin(() => {
      // 편집-스크롤 드래그가 이어질 경우를 대비해 카드의 현재 오프셋을
      // 시작점으로 기록해 둔다(플립 모드에서는 사용되지 않아도 무해하다).
      memoEditScrollStartRef.current = memoEditScrollY.value;
    })
    .onUpdate((e) => {
      if (memoTextSelectingRef.current || memoReturningRef.current) return;
      const dx = e.translationX;
      const dy = e.translationY;
      if (Math.abs(dx) > Math.abs(dy) * 1.2) return;

      // 키보드가 열려 편집 중일 때는 페이지를 넘기지 않고, 카드 자체를
      // 위/아래로 이동시켜 키보드에 가려진 텍스트를 볼 수 있게 한다
      // (WebView 내부 스크롤이 아니라 카드 translateY). translationY 는
      // 매 제스처마다 0부터 다시 시작하므로 이전 드래그가 남긴 오프셋
      // (memoEditScrollStartRef)에 이어 붙여야 새 드래그 시작 시 카드가
      // 0으로 스냅했다가 움직이는 점프가 생기지 않는다.
      if (keyboardVisibleRef.current) {
        const max = memoEditScrollMaxRef.current;
        let next = memoEditScrollStartRef.current + dy;
        if (next < -max) next = -max;
        if (next > max * 0.15) next = max * 0.15;
        memoEditScrollY.value = next;
        return;
      }

      if (memoFlipAnimRunning.current) return;

      const H = memoContainerHeightRef.current || 600;
      const idx = memoPageIndexRef.current;
      const total = memoPagesTotalRef.current;
      const isForward = dy < 0;
      const atLast = idx >= total - 1;
      const atFirst = idx <= 0;
      const boundary = (isForward && atLast) || (!isForward && atFirst);

      // 드래그가 시작되는 즉시 실제 WebView를 숨기고(회전 중 흰 화면 깜빡임
      // 방지) 현재 페이지의 정적 렌더로 전환한다.
      markMemoFlipActive();

      // 현재 페이지가 들리기 시작하는 즉시, 그 뒤에 놓일 다음/이전 페이지를
      // 정적 미리보기로 표시한다 (경계에서는 넘어갈 페이지가 없으므로 생략).
      if (!boundary) {
        showMemoPreview(isForward ? idx + 1 : idx - 1);
      }

      const RATIO = boundary ? 30 : 115;
      const MAX = boundary ? 16 : 90;
      let angle = (-dy / H) * RATIO;
      angle = Math.max(-MAX, Math.min(MAX, angle));
      memoFlipAngle.value = angle;
    })
    .onEnd((e) => {
      if (memoTextSelectingRef.current || memoReturningRef.current) {
        return;
      }
      if (keyboardVisibleRef.current) {
        // 편집 중 카드 이동은 별도 스냅이 필요 없다 — 사용자가 놓은 위치에
        // 그대로 머문다(키보드가 닫힐 때 중앙 복귀 애니메이션이 처리).
        return;
      }
      if (memoFlipAnimRunning.current) {
        return;
      }
      const dy = e.translationY;
      const vy = e.velocityY;
      const idx = memoPageIndexRef.current;
      const total = memoPagesTotalRef.current;
      const isForward = dy < 0;
      const atLast = idx >= total - 1;
      const atFirst = idx <= 0;
      const boundary = (isForward && atLast) || (!isForward && atFirst);

      // `finished` 여부와 무관하게 항상 정리한다 (위 afterFlipHalf/runFlip
      // 주석 참고) — 애니메이션이 새 제스처 등으로 취소되어도 idle 상태로
      // 수렴시켜 카드가 edge-on/숨김 상태로 멈추지 않게 한다.
      const snapBack = () => {
        memoFlipAngle.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.ease) }, () => {
          runOnJS(clearMemoPreview)();
          runOnJS(markMemoFlipIdle)();
        });
      };

      if (boundary) {
        snapBack();
        return;
      }

      const H = memoContainerHeightRef.current || 600;
      const THRESHOLD_PX = H * 0.22;
      const VELOCITY_THRESHOLD = 500;
      const shouldCommit = Math.abs(dy) > THRESHOLD_PX || Math.abs(vy) > VELOCITY_THRESHOLD;

      if (!shouldCommit) {
        snapBack();
        return;
      }

      const targetIdx = isForward ? idx + 1 : idx - 1;
      flipToPageRef.current(targetIdx);
    })
    .onFinalize(() => {
      if (keyboardVisibleRef.current || memoReturningRef.current) return;
      if (!memoFlipAnimRunning.current) {
        // 여기서도 `finished` 여부와 무관하게 항상 정리한다.
        memoFlipAngle.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.ease) }, () => {
          runOnJS(clearMemoPreview)();
          runOnJS(markMemoFlipIdle)();
        });
      }
    }),
  []);

  // 툴바 서식 버튼 → WebView 에디터 명령
  const handleMemoFormat = useCallback((type: FormatType) => {
    if (type === "quote") {
      const isQuote = memoActiveFormats.has("quote");
      memoWebRef.current?.setBlockType(isQuote ? "paragraph" : "blockquote");
    } else {
      memoWebRef.current?.toggleMark(type);
    }
  }, [memoActiveFormats]);

  const [quotePickerVisible, setQuotePickerVisible] = useState(false);
  const [attachMenuVisible, setAttachMenuVisible] = useState(false);
  const [attachMenuAnchor, setAttachMenuAnchor] = useState<AttachMenuAnchor | null>(null);

  const handleOpenAttachMenu = useCallback((anchor: AttachMenuAnchor) => {
    setAttachMenuAnchor(anchor);
    setAttachMenuVisible(true);
  }, []);

  const handleOpenQuotePicker = useCallback(() => {
    setQuotePickerVisible(true);
  }, []);

  const handleSelectQuoteSentence = useCallback((sentence: StoredSentence) => {
    setQuotePickerVisible(false);
    memoWebRef.current?.insertQuote(sentence.text);
  }, []);

  useEffect(() => { handleNextMemoPageRef.current = handleNextMemoPage; }, [handleNextMemoPage]);
  useEffect(() => { handlePrevMemoPageRef.current = handlePrevMemoPage; }, [handlePrevMemoPage]);

  const handleOpenMemo = useCallback(() => {
    enterMemoMode();
  }, [enterMemoMode]);

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
  // Last page → question card is a special transition: no lift/rotate/shadow,
  // pure flat slide (unlike every other forward page-turn). Set to 1 for the
  // duration of that specific transition only; normal page turns leave it 0.
  // Also gates rotation for the card→last-page dismiss reveal (see prevSlotAnimStyle).
  const flatTransitionSV = useSharedValue(0);
  // Live-linked absolute translateX for the floating question card while it is
  // arriving from the last page (A) or resting/exiting (B/C). W = fully hidden
  // to the right, 0 = fully in place, -W = fully exited to the left.
  const cardEntranceX = useSharedValue(0);
  // Live-linked absolute translateX for the reading-complete screen. Same
  // convention as cardEntranceX. Doubles as its controlled `tx` (also driven by
  // ReadingCompleteScreen's own back-swipe gesture, D).
  const completeEntranceX = useSharedValue(0);
  // Question card's own live drag translateX, lifted out of QuestionCardCurl
  // so both C (card→complete) and D (complete→card) can drive it in lockstep
  // with completeEntranceX (cardTX = completeEntranceX - W always holds).
  // Without this, D only moved completeEntranceX, leaving the card statically
  // in place behind the completion overlay — looking like the completion
  // screen slides "in front of" the card instead of a true side-by-side swap.
  const cardTX = useSharedValue(0);
  // True while a forward drag on the last page is live-driving the card's
  // entrance (A) — lets onUpdate/onEnd keep tracking this same gesture even
  // after finishOverlayVisible flips true mid-drag.
  const lastPageEntranceActiveRef = useRef(false);
  // Guards the one-time "mount the card" side effect per forward-drag gesture.
  const cardEntranceMountedRef = useRef(false);

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

  // When dismissing the question card back to the article's last page, we want
  // that page to slide in from the left in sync with the card sliding out to
  // the right (instead of instantly snapping into place). Setting this ref
  // just before calling reading.prevPage() tells the layout effect below to
  // animate the reveal instead of resetting instantly.
  const suppressNextSlotResetRef = useRef<
    { skip: true } | { skip?: false; from: number; duration: number } | null
  >(null);

  // (B) 카드→마지막 페이지 복귀 커밋 순간, onDismissOverlay가 currentPage를
  // 먼저 감소시킨다. 하지만 "prev" 슬롯은 이 감소 *이전의* currentPage-1
  // (=실제 마지막 페이지)을 라이브 드래그 내내 보여주고 있었다 — 감소가
  // 일어나는 순간 prevNode/key를 즉시 새 currentPage-1(=마지막에서 2번째
  // 페이지)로 재계산해버리면, 아직 화면에 슬라이드 중인 "prev" 슬롯의
  // React key가 바뀌어 즉시 언마운트→새 내용으로 리마운트되고 — 카드가
  // 빠져나가는 동안 실제 마지막 페이지가 갑자기 마지막에서 2번째 페이지로
  // 뒤바뀌어 보이는 겹침/번쩍임 현상이 생긴다. 이 ref에 감소 *직전* 값을
  // 고정해 두면, 새틀 애니메이션이 끝나 prev가 파크되어 화면 밖으로 사라질
  // 때까지 같은 내용/키를 유지한다.
  const pinnedPrevPageIdxRef = useRef<number | null>(null);

  // Reset all slot SVs after every page-turn commit (currentPage or layout change).
  useLayoutEffect(() => {
    currentPageSV.value = currentPage;
    const suppressed = suppressNextSlotResetRef.current;
    if (suppressed?.skip) {
      // (B commit) QuestionCardCurl is still live-animating prevSlotSV → 0
      // itself; don't touch either slot value here or we'd cut that off.
      suppressNextSlotResetRef.current = null;
      return;
    }
    if (suppressed) {
      suppressNextSlotResetRef.current = null;
      currentSlotSV.value = suppressed.from;
      currentSlotSV.value = withTiming(0, {
        duration: suppressed.duration,
        easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
      });
    } else {
      currentSlotSV.value = 0;
    }
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
    const rotation = flatTransitionSV.value
      ? 0
      : slideOut > 0.5 ? -(Math.min(1, slideOut / W) * MAX_ROTATE_DEG) : 0;
    return {
      transform: [
        { translateX: currentSlotSV.value },
        { rotateZ: `${rotation}deg` },
      ],
    };
  });
  const prevSlotAnimStyle = useAnimatedStyle(() => {
    const W = containerWidthSV.value || 300;
    // Continuous rotation, no guard (except flatTransitionSV — used when the
    // question card's own right-swipe is live-revealing this slot as the last
    // page, which must stay perfectly flat like every other card→screen
    // transition). Card is parked at -(W + PARK_EXTRA) — far enough off-screen
    // that the bottom-right corner (most protruding corner under CCW rotation)
    // stays invisible. As the card enters the viewport (slideIn→0) rotation is
    // near -4°; by the time it is fully in (slideIn=W) rotation is 0°.
    const slideIn = prevSlotSV.value + W; // –PARK_EXTRA when parked, W when fully in
    const rotation = flatTransitionSV.value ? 0 : (slideIn / W - 1) * MAX_ROTATE_DEG;
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
    if (flatTransitionSV.value) return { opacity: 0 };
    const W = containerWidthSV.value || 300;
    const slideOut = -currentSlotSV.value; // 0 at rest, W when fully out
    const progress = Math.min(1, Math.max(0, slideOut / W));
    return { opacity: progress };
  });
  // Shadow opacity for the PREV card (backward swipe): strong while it is lifted
  // off-screen / sliding in, fading to 0 as it settles flat at rest — so once it
  // becomes the new resting page it adds no second shadow over `next`.
  const prevShadowStyle = useAnimatedStyle(() => {
    if (flatTransitionSV.value) return { opacity: 0 };
    const W = containerWidthSV.value || 300;
    const slideIn = prevSlotSV.value + W; // –PARK_EXTRA parked → W fully in
    const progress = Math.min(1, Math.max(0, 1 - slideIn / W));
    return { opacity: progress };
  });


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

  // Duration/easing the floating question card uses for its own mount-in
  // slide (see QuestionCardCurl's ENTRANCE_DURATION) — kept in sync here so
  // the outgoing last page and the incoming card move as one connected slide.
  const LAST_PAGE_TRANSITION_DURATION = 380;

  // Called via runOnJS once the last page has finished sliding fully off
  // screen (see the `goingNext && gs.isOnLastPage` branch below).
  const finishLastPageTransitionRef = useRef(() => {});
  useEffect(() => {
    finishLastPageTransitionRef.current = () => {
      isCommittingRef.current = false;
      activeSwipeRef.current = null;
      handleSwipeLeftRef.current();
    };
  }, []);

  // Trigger the leftward page-turn animation then call reading.nextPage()
  // Used by both the gesture handler (extra left swipe on last page) and
  // the floating [ < ] button on last page in normal read mode.
  const triggerLastPageTransitionRef = useRef(() => {});
  useEffect(() => {
    triggerLastPageTransitionRef.current = () => {
      // Last page: mount the floating question card immediately (it slides
      // in from the right in lockstep), while this page slides fully off to
      // the left — reads as one continuous connected slide instead of an
      // abrupt cut. Same flat A transition as the drag path, just driven by
      // a timing animation instead of a live finger.
      const W = containerWidthRef.current || 300;
      isCommittingRef.current = true;
      cardEntranceMountedRef.current = true;
      setFinishOverlayVisible(true);
      flatTransitionSV.value = 1;
      cardEntranceX.value = W;
      // cardTX now lives in read.tsx (lifted for the D transition) and
      // persists across QuestionCardCurl mount/unmount — unlike before, it no
      // longer auto-resets to 0 just because a fresh card instance mounts.
      // If a previous dwell left it parked off-screen (e.g. a C-commit
      // followed by "다시 읽기", which unmounts the card without ever
      // resetting cardTX), a newly-mounted card here would silently render
      // shifted by that stale leftover offset ON TOP OF this fresh
      // cardEntranceX animation — a real bug/flicker candidate. Always
      // reset it at the start of every fresh A entrance.
      cardTX.value = 0;
      currentSlotSV.value = withTiming(-W, {
        duration: LAST_PAGE_TRANSITION_DURATION,
        easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
      });
      cardEntranceX.value = withTiming(0, {
        duration: LAST_PAGE_TRANSITION_DURATION,
        easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
      }, (finished) => {
        if (finished) {
          flatTransitionSV.value = 0;
          // See matching comment in panGesture's onEnd A-commit branch: this
          // guard must clear once the entrance finishes, or the next A
          // attempt (drag or button) silently no-ops.
          cardEntranceMountedRef.current = false;
          runOnJS(finishLastPageTransitionRef.current)();
        }
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
      if (finishOverlayVisibleRef.current && !lastPageEntranceActiveRef.current) return;
      if (isDraggingRef.current || isTextSelectingRef.current) return;
    })
    .onUpdate((e) => {
      if (finishOverlayVisibleRef.current && !lastPageEntranceActiveRef.current) return;
      if (isMemoModeRef.current) {
        // 메모 모드 에디터는 WebView(TipTap) 라 터치를 자체적으로 가로챈다.
        // 제스처로 플립 각도를 추적하지 않고, 페이지 전환은 툴바의 이전/다음
        // 버튼으로만 처리한다.
        return;
      }
      if (isDraggingRef.current || isTextSelectingRef.current || isCommittingRef.current) return;
      const gs = gestureState.current;

      const dx = e.translationX;
      const dy = e.translationY;
      // Only track horizontal movement for page sliding
      if (Math.abs(dy) > Math.abs(dx) * 1.8) return;

      if (dx < 0 && gs.isAtEnd) return;  // no next after completion card
      if (dx > 0 && gs.atBoundaryLeft) return; // no prev at start

      const W = gs.containerWidth || 300;
      if (dx < 0 && gs.isOnLastPage) {
        // Special case (A): last page → question card. Pure flat 1:1 slide,
        // no lift/rotate — the card is mounted immediately and live-tracks the
        // same drag so it arrives in lockstep with the page leaving, revealed
        // proportionally underneath exactly like the normal pager's slots.
        activeSwipeRef.current = 'forward';
        if (!cardEntranceMountedRef.current) {
          cardEntranceMountedRef.current = true;
          lastPageEntranceActiveRef.current = true;
          flatTransitionSV.value = 1;
          cardEntranceX.value = W;
          // See matching comment in the button-driven A entrance above:
          // cardTX is now lifted to read.tsx and persists across
          // QuestionCardCurl mount/unmount, so it must be explicitly reset
          // here too whenever a fresh card mount begins.
          cardTX.value = 0;
          runOnJS(setFinishOverlayVisible)(true);
        }
        const clamped = Math.max(dx, -W);
        currentSlotSV.value = clamped;
        cardEntranceX.value = W + clamped;
      } else if (dx < 0) {
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
      if (finishOverlayVisibleRef.current && !lastPageEntranceActiveRef.current) return;
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

      // 메모 모드: 페이지 전환은 툴바의 이전/다음 버튼으로만 처리한다.
      // (에디터가 WebView 라 제스처를 자체 처리하므로 여기서는 무시한다.)
      if (isMemoModeRef.current) {
        return;
      }

      // Upward swipe → enter memo mode (skip if already in memo mode or finish overlay)
      if (dy < -50 && Math.abs(dy) > absDx * 1.5 && !isMemoModeRef.current) {
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
      if (goingNext && gs.isOnLastPage && lastPageEntranceActiveRef.current) {
        // (A) The card has been live-tracking this drag since it began (see
        // onUpdate). Decide commit/cancel using the same threshold feel as a
        // normal page turn, then finish the flat slide in perfect lockstep.
        lastPageEntranceActiveRef.current = false;
        const commit = absDx > W * 0.22 || Math.abs(e.velocityX) > 450;
        if (!commit) {
          currentSlotSV.value = withSpring(0, snapConfig);
          cardEntranceX.value = withSpring(W, snapConfig, (finished) => {
            if (finished) {
              flatTransitionSV.value = 0;
              cardEntranceMountedRef.current = false;
              runOnJS(setFinishOverlayVisible)(false);
            }
          });
          activeSwipeRef.current = null;
          return;
        }
        isCommittingRef.current = true;
        currentSlotSV.value = withTiming(-W, {
          duration: LAST_PAGE_TRANSITION_DURATION,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        });
        cardEntranceX.value = withTiming(0, {
          duration: LAST_PAGE_TRANSITION_DURATION,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        }, (finished) => {
          if (finished) {
            flatTransitionSV.value = 0;
            // Card has fully arrived — this gesture's entrance is done, so
            // clear the mount guard now. Otherwise the NEXT time the card is
            // dismissed and re-approached (A again), onUpdate's
            // `if (!cardEntranceMountedRef.current)` check silently skips the
            // mount/flatTransitionSV/lastPageEntranceActiveRef setup and the
            // drag falls through to the plain page-turn branch instead —
            // exactly the "works once, then reverts to old behavior" bug.
            cardEntranceMountedRef.current = false;
            runOnJS(finishLastPageTransitionRef.current)();
          }
        });
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
        if (lastPageEntranceActiveRef.current) {
          // (A) cancelled externally (e.g. another gesture stole recognition)
          // — snap the page back and unmount the card exactly like a normal
          // below-threshold release.
          lastPageEntranceActiveRef.current = false;
          currentSlotSV.value = withSpring(0, snapConfig);
          cardEntranceX.value = withSpring(W, snapConfig, (finished) => {
            if (finished) {
              flatTransitionSV.value = 0;
              cardEntranceMountedRef.current = false;
              runOnJS(setFinishOverlayVisible)(false);
            }
          });
        } else if (activeSwipeRef.current === 'forward') {
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
      setReadingCompleteVisible(false);
      trackArticleAction({ articleId, action: "save", msSinceComplete: Date.now() - completionTimeRef.current });
      invalidateInbox(queryClient);
      clearActiveSession();
      applyAnsweredQuestionCardsToMemo();
      await readingMemo.cleanup();
      overlayOpacity.value = withTiming(1, { duration: 350, easing: Easing.in(Easing.ease) }, (finished) => {
        if (finished) runOnJS(router.back)();
      });
      showToast({ message: "보관함에 저장됐어요.", type: "success" });
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, isCollectionsReady, reading, selectedCollectionId, collectionsQuery.data, articleId, userId, createCollection, addToCollection, updateRecentCollection, queryClient, clearActiveSession, router, readingMemo, applyAnsweredQuestionCardsToMemo]);

  const handleCommitAndSkip = useCallback(async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      const result = await reading.commitCompletion();
      setFinishOverlayVisible(false);
      setReadingCompleteVisible(false);
      if (result.success) {
        trackArticleAction({ articleId, action: "skip", msSinceComplete: Date.now() - completionTimeRef.current });
        if (!isListEntry) {
          // 수신함 경로: 읽기 완료 후 수신함 목록 갱신
          invalidateInbox(queryClient);
        }
        clearActiveSession();
        applyAnsweredQuestionCardsToMemo();
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
  }, [isDeleting, isListEntry, reading, router, clearActiveSession, queryClient, readingMemo, articleId, promptOrContinue, applyAnsweredQuestionCardsToMemo]);

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
    enterMemoMode(quoteBlock);
    trackMemoCreatedDuringReading({ articleId, page: currentPage });
  }, [currentPage, authorName, article?.title, enterMemoMode, articleId]);

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
                  <Animated.View
                    style={[
                      {
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: layout.containerWidth,
                        height: layout.containerHeight,
                      },
                      letterAnimStyle,
                    ]}
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
                      // currentPage === totalPages는 "카드가 떠 있는 중"을 뜻하는
                      // 가상 인덱스다 — 이때 그대로 makeNode(currentPage)를 쓰면
                      // currentNode가 null이 되어 "current" 슬롯(마지막 실제
                      // 페이지, 화면 밖 -W에 파킹됨)이 통째로 언마운트된다. 그러면
                      // 카드에 머무는 동안 그 WebView 인스턴스가 사라졌다가, B
                      // 커밋 시점에 다시 새로 마운트되어 새틀 애니메이션(360ms)
                      // 안에 로드를 마쳐야 하는 경주가 생기고, 못 마치면 마지막
                      // 페이지가 드러나는 순간 빈 화면이 잠깐 번쩍인다. 카드가
                      // 떠 있는 동안에도 실제 마지막 페이지 인덱스로 clamp해
                      // 같은 인스턴스를 계속 마운트 상태로 유지 — B 시점엔 이미
                      // 충분히 로드가 끝나 있어 번쩍임 없이 그대로 드러난다.
                      const currentPageIdx =
                        currentPage >= totalPages ? totalPages - 1 : currentPage;
                      const currentNode = makeNode(currentPageIdx);
                      // (B) 새틀 애니메이션이 진행 중인 동안엔 감소 직전 값을
                      // 그대로 써서 콘텐츠/React key가 흔들리지 않게 한다.
                      const prevPageIdx =
                        pinnedPrevPageIdxRef.current ?? currentPage - 1;
                      const prevNode = makeNode(prevPageIdx);

                      return (
                        <>
                          {/* next — bottom layer, always carries the base shadow
                              (static, full opacity) so the resting page always casts
                              exactly one shadow. Rendered even when there is no next
                              real page so the completion card keeps its shadow. */}
                          <View key={`page-${currentPage + 1}-next`} style={slotBase}>
                            <View style={shadowLayer} />
                            {nextNode != null && (
                              <View style={slotContent}>{nextNode}</View>
                            )}
                          </View>

                          {/* current — middle layer, slides left + rotates during
                              forward swipe. Its shadow fades in as it lifts/slides.
                              키에 역할 접미사(-current)를 붙이는 이유: 카드가 떠
                              있는 동안(currentPage가 totalPages를 가리키는 가상
                              인덱스)에는 currentPageIdx와 prevPageIdx가 둘 다
                              totalPages-1로 같아져, 접미사 없이는 "current"와
                              "prev" 두 형제 엘리먼트가 완전히 같은 key(예:
                              `page-11`)를 갖게 되어 React가 "Encountered two
                              children with the same key" 경고를 낸다. 페이지
                              인덱스가 바뀔 때 슬롯을 리마운트시키는 기존 동작은
                              그대로 유지된다(역할 접미사는 상수라 키의 이 부분은
                              달라지지 않음). */}
                          {currentNode != null && (
                            <Animated.View key={`page-${currentPageIdx}-current`} style={[slotBase, currentSlotAnimStyle]}>
                              <Animated.View style={[shadowLayer, currentShadowStyle]} />
                              <View style={slotContent}>{currentNode}</View>
                            </Animated.View>
                          )}

                          {/* prev — top layer, slides in from left + rotates to flat
                              during backward swipe. Its shadow fades out as it settles. */}
                          {prevNode != null && (
                            <Animated.View key={`page-${prevPageIdx}-prev`} style={[slotBase, prevSlotAnimStyle]}>
                              <Animated.View style={[shadowLayer, prevShadowStyle]} />
                              <View style={slotContent}>{prevNode}</View>
                            </Animated.View>
                          )}
                        </>
                      );
                    })()}
                  </Animated.View>

                  {/* ── 질문 카드 (읽기 완료) — 마지막 페이지와 같은 프레임 안에서
                      오른쪽에서 슬라이드인, 페이지와 거의 동일한 크기 ──────── */}
                  {finishOverlayVisible && (
                    <QuestionCardCurl
                      ref={questionCardRef}
                      questions={questionCardQuestions}
                      containerWidth={layout.containerWidth}
                      containerHeight={layout.containerHeight}
                      entranceX={cardEntranceX}
                      dismissPrevSlotSV={prevSlotSV}
                      currentSlotSV={currentSlotSV}
                      flatTransitionSV={flatTransitionSV}
                      completeEntranceX={completeEntranceX}
                      cardTX={cardTX}
                      onDismissOverlay={() => {
                        // (B) 우 스와이프 커밋이 확정된 시점(release)에 호출됨.
                        // 실제 화면 이동은 드래그 내내 prevSlotSV로 이미 라이브
                        // 추적되어 왔으므로, 여기서는 currentPage 상태만 되돌린다
                        // (레이아웃 이펙트의 슬롯 리셋은 완전히 건너뛴다 — 카드가
                        // 스스로 prevSlotSV를 0까지 애니메이션하는 중이므로).
                        suppressNextSlotResetRef.current = { skip: true };
                        // currentPage를 감소시키기 *직전* 값을 고정해, 새틀
                        // 애니메이션이 끝날 때까지 "prev" 슬롯 콘텐츠/키가
                        // 바뀌지 않게 한다 (겹침/번쩍임 방지).
                        pinnedPrevPageIdxRef.current = currentPage - 1;
                        reading.prevPage();
                      }}
                      onDismissOverlayComplete={() => {
                        // 카드가 화면 밖으로 완전히 빠져나간 뒤 언마운트.
                        cardEntranceMountedRef.current = false;
                        setFinishOverlayVisible(false);
                        // 새틀 애니메이션이 끝나 prev가 파크된 뒤에는 고정을
                        // 풀어 다음 렌더부터 정상적으로 currentPage-1을 따르게 한다.
                        pinnedPrevPageIdxRef.current = null;
                      }}
                      onReadingCompleteBegin={(hasSubstantialAnswer) => {
                        // (C) 좌 스와이프가 시작된 첫 프레임에 호출됨 — 아직 커밋
                        // 여부는 미정이지만, 완료 화면을 즉시 마운트해 드래그 내내
                        // completeEntranceX로 라이브 추적할 수 있게 한다.
                        setReadingCompleteCaseType(hasSubstantialAnswer ? "answered" : "read");
                        setReadingCompleteVisible(true);
                      }}
                      onReadingCompleteCancel={() => {
                        // (C) 취소: 완료 화면을 다시 언마운트한다.
                        setReadingCompleteVisible(false);
                      }}
                    />
                  )}

                  {/* ── 메모 모드 오버레이 — 오른쪽에서 슬라이드인 ──────── */}
                  {isMemoMode && (
                    <GestureDetector gesture={memoPanGesture}>
                      <Animated.View
                        style={[
                          {
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: layout.containerWidth,
                            height: layout.containerHeight,
                            zIndex: 20,
                          },
                          memoAnimStyle,
                        ]}
                      >
                        {/* 메모 에디터: 기록 탭과 동일한 WebView(TipTap) 엔진.
                            한 번에 한 페이지를 표시하고, 페이지 전환은 좌우 스와이프
                            (드래그 비례 3D 플립) 또는 툴바 이전/다음 버튼으로 처리한다. */}
                        <MemoWebEditor
                          ref={memoWebRef}
                          flipAngle={memoFlipAngle}
                          previewBlocks={memoPreviewBlocks}
                          frontBlocks={memoFrontBlocks}
                          isFlipping={memoIsFlipping}
                          initialContent={memoPages[memoPageIndex] ?? ""}
                          pageIndex={memoPageIndex}
                          totalPages={memoPages.length}
                          onExportMarkdown={handleMemoExport}
                          onActiveFormatsChange={setMemoActiveFormats}
                          onTextSelectionActiveChange={handleMemoSelectionActiveChange}
                          onOverflowSplit={handleMemoOverflowSplit}
                          availableContentHeightPx={memoAvailableContentHeightPx}
                          containerWidth={layout.containerWidth}
                          containerHeight={layout.containerHeight}
                          paddingX={layout.paddingX}
                          paddingY={layout.paddingY}
                          bodyFontSize={layout.bodyFontSize}
                          keyboardVisible={keyboardVisible}
                          bottomInset={insets.bottom}
                        />
                      </Animated.View>
                    </GestureDetector>
                  )}
                </View>
              </View>
              </View>
            </View>

            {/* Progress bar below card — 메모 모드 진입/종료에 맞춰 fade in/out */}
            <Animated.View
              style={[styles.progressBarContainer, progressBarAnimStyle]}
              pointerEvents={isMemoMode ? "none" : "auto"}
            >
              <ProgressIndicator type="linear" progress={reading.progress} size="small" />
            </Animated.View>
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
          onPress={isMemoMode ? exitMemoMode : handleOpenMemo}
          hitSlop={8}
          style={[
            styles.memoFab,
            { bottom: insets.bottom + 24 },
            isMemoMode && styles.memoFabActive,
          ]}
          contentStyle={styles.memoFabContent}
        >
          <Feather
            name={isMemoMode ? "x" : "edit-3"}
            size={20}
            color={isMemoMode ? Colors.zinc800 : Colors.zinc600}
          />
        </ScalePressable>
      )}

      {/* ── 메모 모드 키보드 툴바 ──────────────────────────────────────── */}
      {isMemoMode && keyboardVisible && keyboardHeight > 0 && (
        <View
          style={[
            styles.memoToolbarWrap,
            { bottom: keyboardHeight },
          ]}
          pointerEvents="box-none"
        >
          <MemoToolbar
            currentPage={memoPageIndex}
            totalPages={memoPages.length}
            onPrevPage={handlePrevMemoPage}
            onNextPage={handleNextMemoPage}
            onDismissKeyboard={() => {
              // 키보드는 WebView 내부에 떠 있으므로 RN Keyboard.dismiss() 만으로는
              // 닫히지 않는다. WebView 에디터의 포커스를 먼저 해제해야 한다.
              memoWebRef.current?.blur();
              Keyboard.dismiss();
            }}
            onFormat={handleMemoFormat}
            activeFormats={memoActiveFormats}
            onOpenAttachMenu={handleOpenAttachMenu}
          />
        </View>
      )}

      {/* ── 첨부(클립) 메뉴 오버레이 ───────────────────────────────────────
          RN Modal 은 새 네이티브 윈도우를 만들어 WebView 포커스를 잃게 하므로
          키보드가 닫힌다. 그래서 Modal 대신 같은 화면 트리 안에 절대배치
          오버레이로 렌더링해 키보드를 유지한다. */}
      {isMemoMode && attachMenuVisible && attachMenuAnchor && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setAttachMenuVisible(false)}
          />
          <View
            style={[
              styles.attachMenu,
              {
                left: Math.min(
                  Math.max(8, attachMenuAnchor.x + attachMenuAnchor.width / 2 - ATTACH_MENU_WIDTH / 2),
                  screenWidth - ATTACH_MENU_WIDTH - 8,
                ),
                bottom: Math.max(8, screenHeight - attachMenuAnchor.y + ATTACH_MENU_GAP),
              },
            ]}
          >
            <ScalePressable
              style={styles.attachMenuRow}
              contentStyle={styles.attachMenuRowContent}
              onPress={() => setAttachMenuVisible(false)}
            >
              <Feather name="image" size={15} color={Colors.zinc600} />
              <Text style={styles.attachMenuLabel}>사진</Text>
            </ScalePressable>
            <View style={styles.attachMenuDivider} />
            <ScalePressable
              style={styles.attachMenuRow}
              contentStyle={styles.attachMenuRowContent}
              onPress={() => {
                setAttachMenuVisible(false);
                handleOpenQuotePicker();
              }}
            >
              <Feather name="message-square" size={15} color={Colors.zinc600} />
              <Text style={styles.attachMenuLabel}>인용</Text>
            </ScalePressable>
          </View>
        </View>
      )}

      <QuoteSentencePickerBottomSheet
        visible={quotePickerVisible}
        onClose={() => setQuotePickerVisible(false)}
        userId={userId}
        onSelect={handleSelectQuoteSentence}
      />

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


      {/* ── 읽기 완료 전체화면 오버레이 ────────────────────────────────── */}
      {readingCompleteVisible && (
        <ReadingCompleteScreen
          caseType={readingCompleteCaseType}
          isSaving={isSaving}
          isDeleting={isDeleting}
          isCollectionsReady={isCollectionsReady}
          tx={completeEntranceX}
          cardTX={cardTX}
          onSave={handleCommitAndSave}
          onSkip={mode === "re_read"
            ? async () => {
                setReadingCompleteVisible(false);
                applyAnsweredQuestionCardsToMemo();
                await readingMemo.cleanup();
                overlayOpacity.value = withTiming(1, { duration: 350, easing: Easing.in(Easing.ease) }, (finished) => {
                  if (finished) runOnJS(router.back)();
                });
              }
            : handleCommitAndSkip}
          onReread={() => {
            setReadingCompleteVisible(false);
            setFinishOverlayVisible(false);
          }}
          onBack={() => {
            setReadingCompleteVisible(false);
          }}
        />
      )}

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
    paddingHorizontal: 28,
    paddingTop: 20,
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
  answerGhost: {
    flex: 1,
    fontSize: 15,
    fontFamily: ReaderTokens.fontFamily.serif,
    color: Colors.zinc400,
    lineHeight: 28,
    letterSpacing: 0.5,
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
  memoFabActive: {
    backgroundColor: Colors.zinc100,
    borderColor: Colors.zinc300,
  },
  memoFabContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  memoToolbarWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 50,
  },
  attachMenu: {
    position: "absolute",
    width: ATTACH_MENU_WIDTH,
    backgroundColor: Colors.white,
    borderRadius: 14,
    overflow: "hidden",
    zIndex: 60,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.16,
        shadowRadius: 12,
      },
      android: {
        elevation: 10,
      },
      default: {},
    }),
  },
  attachMenuRow: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  attachMenuRowContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  attachMenuLabel: {
    fontSize: 14,
    color: Colors.zinc700,
    fontFamily: ReaderTokens.fontFamily.sans,
  },
  attachMenuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.zinc200,
    marginHorizontal: 12,
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
    justifyContent: "flex-start",
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
});

// ─────────────────────────────────────────────────────────────────────────────
// ReadingCompleteScreen: 읽기 완료 전체화면 오버레이 (목업 ReadingCompletePreview 이식)
// ─────────────────────────────────────────────────────────────────────────────
const READ_ALL_IMG = require("@/assets/images/read-all.png");
const READ_ALL_ANSWERED_IMG = require("@/assets/images/read-all-answered.png");
// Matches the pager's own snap-back feel (see `snapConfig` in the main
// component above). Module-level so it's a stable reference for useMemo deps.
const COMPLETE_BACK_SNAP_CONFIG = { damping: 18, stiffness: 280, mass: 0.8 };

interface ReadingCompleteScreenProps {
  caseType: "read" | "answered";
  isSaving: boolean;
  isDeleting: boolean;
  isCollectionsReady: boolean;
  onSave: () => void;
  onSkip: () => void;
  onReread: () => void;
  onBack: () => void;
  /** read.tsx가 소유한 절대 translateX (C: 카드→완료 진입, D: 완료→카드
   *  복귀 모두 이 값을 라이브로 읽고 쓴다 — 두 방향 모두 항상 인접 화면이
   *  1:1로 함께 드러나도록 하나의 값을 공유). */
  tx: SharedValue<number>;
  /** QuestionCardCurl이 소유했던 카드의 라이브 드래그 translateX를 read.tsx로
   *  끌어올린 값. C(카드→완료)는 이미 이 값과 tx를 함께 움직여 카드가
   *  왼쪽으로 나가는 동안 완료 화면이 1:1로 따라 들어오게 한다. D(완료→카드)
   *  는 정반대 방향 — 이 컴포넌트의 자체 제스처가 tx만 움직이고 카드는
   *  건드리지 않으면, 카드는 이미 제자리(cardTX=0)에 조용히 숨어 있다가
   *  완료 화면이 걷히기만 하는 것처럼 보여 "완료 화면이 카드 앞에 있는"
   *  느낌을 준다. 여기서도 cardTX = tx - W 공식으로 동시에 구동해야 카드가
   *  화면 밖(-W)에서 함께 슬라이드 인 하는 자연스러운 페이저 느낌이 난다. */
  cardTX: SharedValue<number>;
}

function ReadingCompleteScreen({
  caseType,
  isSaving,
  isDeleting,
  isCollectionsReady,
  onSave,
  onSkip,
  onReread,
  onBack,
  tx,
  cardTX,
}: ReadingCompleteScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const message = caseType === "read"
    ? "마지막 장까지\n온전히 닿았습니다."
    : "마지막 장을\n직접 완성했습니다.";

  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));

  // 완료 화면 → 질문 카드로 되돌아가기: 왼쪽에서 오른쪽으로 스와이프 (페이지
  // 순서상 뒤로 이동하는 방향과 동일한 규칙). 손가락 이동량에 실시간으로
  // 카드를 따라 움직이게 하고(pager의 forward/backward 스와이프와 동일한
  // 손맛), 뗀 시점의 거리/속도로 완료(퇴장)/스냅백을 판정한다.
  const dragStartX = useSharedValue(0);
  const isCommittingBackRef = useRef(false);
  const backGesture = useMemo(() =>
    Gesture.Pan()
      .runOnJS(true)
      .minDistance(8)
      .onBegin(() => {
        if (isCommittingBackRef.current) return;
        dragStartX.value = tx.value;
      })
      .onUpdate((e) => {
        if (isCommittingBackRef.current) return;
        // 왼쪽으로는(뒤로 갈 수 없으므로) 드래그되지 않도록 0에서 클램프.
        tx.value = Math.max(0, dragStartX.value + e.translationX);
        // 카드가 화면 밖(-W)에서 완료 화면과 정확히 반대로 함께 슬라이드 인
        // 하도록 항상 cardTX = tx - W 로 동기화 (C의 completeEntranceX = W+dx
        // 공식을 그대로 뒤집은 것). 이게 없으면 카드는 tx와 무관하게 이미
        // 제자리(0)에 조용히 있다가 완료 화면만 걷히는 것처럼 보여, 두 화면이
        // 나란히 미끄러지는 대신 완료 화면이 카드 "앞"에 떠 있는 것처럼 보인다.
        cardTX.value = tx.value - screenWidth;
      })
      .onEnd((e) => {
        if (isCommittingBackRef.current) return;
        const THRESHOLD = screenWidth * 0.22;
        const VELOCITY_THRESHOLD = 450;
        const isHorizontal = Math.abs(e.translationX) > Math.abs(e.translationY);
        const shouldCommit =
          isHorizontal &&
          e.translationX > 0 &&
          (e.translationX > THRESHOLD || e.velocityX > VELOCITY_THRESHOLD);

        if (shouldCommit) {
          isCommittingBackRef.current = true;
          cardTX.value = withTiming(0, {
            duration: 300,
            easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
          });
          tx.value = withTiming(screenWidth, {
            duration: 300,
            easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
          }, (finished) => {
            if (finished) runOnJS(onBack)();
          });
        } else {
          cardTX.value = withSpring(-screenWidth, COMPLETE_BACK_SNAP_CONFIG);
          tx.value = withSpring(0, COMPLETE_BACK_SNAP_CONFIG);
        }
      })
      .onFinalize(() => {
        // 제스처가 onEnd 없이 외부 요인으로 취소된 경우, 커밋 중이 아니라면
        // 안전하게 원위치로 스냅백한다.
        if (!isCommittingBackRef.current) {
          cardTX.value = withSpring(-screenWidth, COMPLETE_BACK_SNAP_CONFIG);
          tx.value = withSpring(0, COMPLETE_BACK_SNAP_CONFIG);
        }
      }),
    [onBack, tx, cardTX, dragStartX, screenWidth],
  );

  return (
    <GestureDetector gesture={backGesture}>
    <Animated.View style={[readingCompleteStyles.overlay, slideStyle]}>
      {/* 아이콘 + 메시지 */}
      <View style={readingCompleteStyles.center}>
        <Image
          source={caseType === "answered" ? READ_ALL_ANSWERED_IMG : READ_ALL_IMG}
          style={readingCompleteStyles.icon}
          resizeMode="contain"
        />
        <Text style={readingCompleteStyles.message}>{message}</Text>
      </View>

      {/* 하단 버튼 영역 */}
      <View style={[readingCompleteStyles.bottom, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        {/* 보관하기 (primary) */}
        <Pressable
          style={[readingCompleteStyles.saveBtn, (isSaving || !isCollectionsReady) && readingCompleteStyles.btnDisabled]}
          onPress={onSave}
          disabled={isSaving || !isCollectionsReady}
        >
          <Text style={readingCompleteStyles.saveBtnText}>
            {isSaving ? "저장 중..." : !isCollectionsReady ? "불러오는 중..." : "보관하기"}
          </Text>
        </Pressable>

        {/* 나가기 (secondary) */}
        <Pressable
          style={[readingCompleteStyles.skipBtn, isDeleting && readingCompleteStyles.btnDisabled]}
          onPress={onSkip}
          disabled={isDeleting}
        >
          <Text style={readingCompleteStyles.skipBtnText}>
            {isDeleting ? "처리 중..." : "나가기"}
          </Text>
        </Pressable>

        {/* 다시 읽기 (tertiary) */}
        <Pressable style={readingCompleteStyles.rereadBtn} onPress={onReread}>
          <Text style={readingCompleteStyles.rereadBtnText}>다시 읽기</Text>
        </Pressable>
      </View>
    </Animated.View>
    </GestureDetector>
  );
}

const readingCompleteStyles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.white,
    zIndex: 100,
    flexDirection: "column",
    justifyContent: "space-between",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 28,
    paddingHorizontal: 36,
  },
  icon: {
    width: 130,
    height: 130,
  },
  message: {
    fontSize: 21,
    fontFamily: ReaderTokens.fontFamily.serif,
    fontWeight: "400",
    color: Colors.zinc800,
    lineHeight: 36,
    letterSpacing: 0.4,
    textAlign: "center",
  },
  bottom: {
    paddingHorizontal: 24,
    paddingTop: 8,
    gap: 10,
  },
  saveBtn: {
    width: "100%",
    paddingVertical: 15,
    backgroundColor: Colors.zinc900,
    borderRadius: 14,
    alignItems: "center",
  },
  saveBtnText: {
    fontSize: 15,
    fontFamily: ReaderTokens.fontFamily.sansSemiBold,
    fontWeight: "600",
    color: Colors.white,
    letterSpacing: 0.1,
  },
  skipBtn: {
    width: "100%",
    paddingVertical: 15,
    backgroundColor: "transparent",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.zinc200,
    alignItems: "center",
  },
  skipBtnText: {
    fontSize: 15,
    fontFamily: ReaderTokens.fontFamily.sans,
    fontWeight: "500",
    color: Colors.zinc600,
    letterSpacing: 0.1,
  },
  rereadBtn: {
    width: "100%",
    paddingVertical: 12,
    alignItems: "center",
  },
  rereadBtnText: {
    fontSize: 14,
    fontFamily: ReaderTokens.fontFamily.sans,
    fontWeight: "400",
    color: Colors.zinc400,
    textDecorationLine: "underline",
  },
  btnDisabled: {
    opacity: 0.5,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// SpringCoil: 노트 스프링 바인딩 시각 요소
// ─────────────────────────────────────────────────────────────────────────────
function SpringCoil({ width }: { width: number }) {
  const RING_W = 13;
  const RING_H = 22;
  const PADDING = 22;
  const usable = width - PADDING * 2;
  const count = Math.max(4, Math.floor(usable / (RING_W + 10)));
  const gap = (usable - count * RING_W) / (count - 1);

  return (
    <View style={springCoilStyles.bar}>
      {/* 가로 와이어 라인 */}
      <View style={[springCoilStyles.wire, { left: PADDING, right: PADDING }]} />
      {/* 링 목록 */}
      <View style={[springCoilStyles.rings, { paddingHorizontal: PADDING, gap }]}>
        {Array.from({ length: count }).map((_, i) => (
          <View key={i} style={{ width: RING_W, height: RING_H, borderRadius: RING_W / 2, borderWidth: 2, borderColor: "#94a3b8", backgroundColor: Colors.white }} />
        ))}
      </View>
    </View>
  );
}

const springCoilStyles = StyleSheet.create({
  bar: {
    width: "100%",
    height: 32,
    backgroundColor: "#f1f5f9",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e8f0",
    justifyContent: "center",
  },
  wire: {
    position: "absolute",
    height: 2,
    backgroundColor: "#94a3b8",
    top: "50%",
    marginTop: -1,
  },
  rings: {
    flexDirection: "row",
    alignItems: "center",
    height: "100%",
  },
});
