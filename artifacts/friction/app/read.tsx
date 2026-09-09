import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  Animated as RNAnimated,
  View,
  Text,
  StyleSheet,
  Image,
  BackHandler,
  AppState,
  Platform,
  Pressable,
  Keyboard,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import ThoughtsBottomSheet from "@/components/ThoughtsBottomSheet/ThoughtsBottomSheet";
import ScalePressable from "@/components/shared/ScalePressable";
import HeaderButton from "@/components/shared/HeaderButton";
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
  withDelay,
  runOnJS,
  Easing,
  type SharedValue,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import QuestionCardCurl, { type QuestionCardCurlHandle } from "@/components/QuestionCardCurl/QuestionCardCurl";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  Colors,
  Spacing,
  ReaderTokens,
  Shadows,
  readerFontSize,
  readerLetterSpacing,
} from "@/constants/tokens";
import { bodyTypographyMetrics, computeBodyLayout } from "@/lib/bodyLayout";
import ProgressIndicator from "@/components/ProgressIndicator/ProgressIndicator";
import type { StoredSentence, Thought } from "@workspace/api-client-react";
import CoverPreview from "@/components/CoverPreview/CoverPreview";
import { resolveArticleCover } from "@/utils/articleCover";
import CoverPage from "@/components/CoverPage/CoverPage";
import WebViewMarkdownReader from "@/components/WebViewMarkdownReader";
import { normalizePageItem } from "@/utils/normalizePageItem";
import { useReadingSession } from "@/lib/useReadingSession";
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
  useCreateThought,
  getGetArticleQuestionsQueryKey,
  getGetUserRecentCollectionQueryKey,
  getListInboxQueryKey,
  getListStoredSentencesQueryKey,
  getListThoughtsQueryKey,
} from "@workspace/api-client-react";
import {
  invalidateInbox,
  invalidateMyCollections,
  invalidateRecentCollection,
  invalidateThoughtLists,
  upsertThoughtInRecordCaches,
} from "@/lib/queryInvalidation";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import ActionSheetModal from "@/components/ActionSheetModal/ActionSheetModal";
import { useUser } from "@/contexts/UserContext";
import { useActiveReading } from "@/contexts/ActiveReadingContext";
import { shouldCommitCompletionForEntry, type ReadingMode } from "@/lib/policies";
import {
  clampReadingPage,
  getVisualReadingPage,
  isCurrentReadingPagerTransition,
} from "@/lib/readingPersistence";
import { useToast } from "@/contexts/ToastContext";
import { formatReadingThoughtQuote } from "@/lib/thoughtInlineEditor";

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

  // 본문(페이지 프레임/padding/textColumnWidth/body 폰트 메트릭)은 lib/bodyLayout.ts의
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
  const titleBarHeight = body.titleBarHeight;

  return {
    containerWidth,
    containerHeight,
    frameWidth,
    frameHeight,
    scaleFactor,
    paddingX: body.paddingX,
    paddingY: body.paddingY,
    textColumnWidth: body.textColumnWidth,
    bodyFontSize: body.bodyFontSize,
    bodyParagraphGap: body.bodyParagraphGap,
    titleFontSize: body.titleFontSize,
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
  const articleLoading = articleId ? articleQuery.isLoading && !article : false;

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
    if (articleId && articleQuery.isError && !article) {
      clearActiveSession();
      router.back();
    }
  }, [article, articleId, articleQuery.isError, clearActiveSession, router]);

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

  // `totalPages` is the question-card virtual page. Never let a stale saved
  // value fall outside [0, totalPages] and reach the pager slot calculations.
  const currentPage = clampReadingPage(reading.session.position.currentPage, totalPages);
  const isOnCoverPage = currentPage === 0;
  const contentPageIndex = Math.min(
    Math.max(0, currentPage - 1),
    Math.max(0, contentPages.length - 1),
  );
  // completeScreenVisible: true = 읽기 완료 화면이 슬롯으로 열려 있음
  // (visualPage 계산보다 먼저 선언해야 참조 오류가 생기지 않는다)
  const [completeScreenVisible, setCompleteScreenVisible] = useState(false);
  // Backward 커밋 직후 1커밋 동안 prev 슬롯을 감춘다.
  // 리매핑 시점에 prevSlotSV가 아직 0(중앙)인 채로 새로 들어온 페이지가
  // 그려지면 한 프레임 동안 현재 페이지를 덮어 번쩍임이 생기기 때문 —
  // layout effect가 prevSlotSV를 파킹한 뒤(다음 커밋)에 다시 보여준다.
  // ⚠️ 언마운트가 아니라 opacity로만 가린다. 언마운트하면 재사용 중인
  //    WebView 리더 인스턴스가 사라져 되돌아올 때 재로딩 번쩍임이 생긴다.
  const [deferPrevMount, setDeferPrevMount] = useState(false);
  useEffect(() => {
    if (deferPrevMount) setDeferPrevMount(false);
  }, [deferPrevMount]);
  const [readingCompleteCaseType, setReadingCompleteCaseType] = useState<"answered" | "read">("read");
  // 단일 페이저: letter pages [0..totalPages-1], Q카드 [totalPages], 완독화면 [totalPages+1]
  const visualPage = getVisualReadingPage(currentPage, totalPages, completeScreenVisible);
  const isOnLastLetterPage = totalPages > 0 && visualPage === totalPages - 1;
  // 모든 글은 표지 페이지를 가진다(명시적 표지가 없으면 기본 표지로 자동 생성).
  // 페이지 0은 항상 표지 슬롯이므로 빈 슬롯/점프 hack/스와이프 차단이 필요 없다.
  const hasCover = !!article;


  const questionCardRef = useRef<QuestionCardCurlHandle>(null);
  const [exitConfirmVisible, setExitConfirmVisible] = useState(false);
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0);
  const [showSelectionPill, setShowSelectionPill] = useState(false);
  const showSelectionPillRef = useRef(false);
  const selectionPillDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectionPillText, setSelectionPillText] = useState("");

  const [selectedCollectionId, setSelectedCollectionId] = useState<string | undefined>(undefined);
  const [pageListSize, setPageListSize] = useState({ width: 0, height: 0 });
  // 카드 래퍼의 실제 윈도우 Y 좌표(측정값). 수식 유도 대신 measureInWindow로
  // 실측해 시트 축소 애니메이션의 기준점으로 사용한다.
  const cardWrapRef = useRef<View>(null);
  const [cardWindowTop, setCardWindowTop] = useState<number | null>(null);
  const handleCardWrapLayout = useCallback(() => {
    // onLayout 직후 measureInWindow로 윈도우 절대좌표를 얻는다.
    // (transform은 부모 RNAnimated.View 바깥이므로 측정에 영향 없음)
    cardWrapRef.current?.measureInWindow((_x, y) => {
      if (typeof y === "number" && !Number.isNaN(y)) {
        setCardWindowTop((prev) =>
          prev !== null && Math.abs(prev - y) < 0.5 ? prev : y,
        );
      }
    });
  }, []);
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

  // ── 단상 시트 연동 편지 페이지 축소 ────────────────────────────────────────
  // 목표: 시트가 열리면 편지가 "시트 위에 남은 가용 영역"을 채우도록
  //       위로 이동하며 축소된다 (fit & center).
  //
  //   가용 영역 = [insets.top + 8, sheetTop - 12]  (상단 안전영역 아래 ~ 시트 위)
  //   smallScale = min(1, 가용높이 / frameHeight)
  //   translateY = 가용영역 중앙 Y - 카드 원래 중앙 Y  (부모 좌표계)
  //
  // transform 순서는 [translateY, scale]:
  //   translateY가 먼저 적용되어야 부모(비스케일) 좌표계에서 정확한 픽셀만큼
  //   이동한 뒤, 그 위치의 중심을 기준으로 축소된다.
  // 카드 원래 위치는 가정하지 않고 measureInWindow 실측값(cardWindowTop)을 쓴다.
  // 카드 애니메이션 단일 소스(race condition 방지):
  //   0    = 시트 닫힘
  //   midH = 50% (normal open)
  //   kbH  = 65% (keyboard open at mid)
  // 수동 스와이프는 이 값을 변경하지 않아 카드가 scale50/ty50 에 고정된다.
  const cardSheetHAnim = useRef(new RNAnimated.Value(0)).current;

  // ── Reanimated SharedValues for card transform (UI-thread, no JS→bridge) ──
  // cardSheetHAnim is non-native (single source of truth for card position).
  // The addListener fires on the JS thread, but setting a SharedValue from JS
  // is cheap and the actual Core Animation update happens on the UI thread via
  // useAnimatedStyle — bypassing the JS→bridge hop that caused blurry WebViews.
  const cardScaleSV = useSharedValue(1);
  const cardTranslateYSV = useSharedValue(0);

  // ── shouldRasterize: captures a full-res snapshot before scale-down begins ──
  // Enabled the moment the sheet starts opening (value > 0), disabled once the
  // sheet is fully closed and scale has returned to 1. A ref tracks the current
  // rasterize state so we don't call setShouldRasterize on every animation frame.
  const [shouldRasterize, setShouldRasterize] = useState(false);
  const isRasterizingRef = useRef(false);

  // Refs so the addListener closure always sees the latest layout params
  // without needing to recreate the listener on every layout change.
  // 리스너에서 항상 최신 레이아웃 값을 읽을 수 있도록 ref에 유지
  const cardAnimParamsRef = useRef({
    availTop: insets.top + 8,
    frameHeight: layout.frameHeight,
    cardCenterY: (cardWindowTop ?? 0) + layout.frameHeight / 2,
    screenHeight,
    // 50% 스냅 기준으로 미리 계산된 목표값
    scale50: 1,
    ty50: 0,
    midH: screenHeight * 0.5,
  });

  // 레이아웃·위치가 바뀔 때마다 ref 갱신 + 50% 기준 목표값 선계산
  useEffect(() => {
    const cardTop     = cardWindowTop ?? (screenHeight - layout.frameHeight) / 2;
    const availTop    = insets.top + 8;
    const frameHeight = layout.frameHeight;
    const cardCenterY = cardTop + layout.frameHeight / 2;
    const midH        = screenHeight * 0.5;

    // 50% 스냅 시점의 가용 영역
    const availBottom50 = screenHeight - midH - 12;
    const availHeight50 = Math.max(0, availBottom50 - availTop);
    const restBottom    = cardCenterY + frameHeight / 2;

    let scale50: number;
    let ty50: number;
    if (frameHeight <= 0 || availHeight50 >= frameHeight) {
      // 카드가 축소 없이 들어감 — 겹치는 만큼만 위로
      scale50 = 1;
      ty50    = -Math.max(0, restBottom - availBottom50);
    } else {
      // 가용 영역에 맞게 축소 + 중앙 정렬
      scale50 = availHeight50 / frameHeight;
      ty50    = (availTop + availBottom50) / 2 - cardCenterY;
    }

    cardAnimParamsRef.current = {
      availTop,
      frameHeight,
      cardCenterY,
      screenHeight,
      scale50,
      ty50,
      midH,
    };
  }, [screenHeight, insets.top, layout.frameHeight, cardWindowTop]);

  // cardSheetHAnim 단일 리스너 (race condition 없음):
  //   0    → midH : (1, 0) → (scale50, ty50) 선형 보간 [시트 열림·닫힘]
  //   midH → kbH  : 상단 면 고정 + 추가 축소           [키보드 열림]
  // 수동 스와이프(full)는 이 값을 변경하지 않으므로 카드가 scale50/ty50 에 고정된다.
  useEffect(() => {
    const sub = cardSheetHAnim.addListener(({ value }) => {
      const { availTop, frameHeight, cardCenterY, screenHeight, scale50, ty50, midH } = cardAnimParamsRef.current;
      const kbH = screenHeight * 0.65;

      if (value <= 0 || frameHeight <= 0) {
        cardScaleSV.value = 1;
        cardTranslateYSV.value = 0;
        // Sheet fully closed — disable rasterization so WebView returns to live
        if (isRasterizingRef.current) {
          isRasterizingRef.current = false;
          setShouldRasterize(false);
        }
        return;
      }

      // Sheet is opening — enable rasterization before scale-down begins so iOS
      // captures a full-resolution snapshot rather than compositing at lower res
      if (!isRasterizingRef.current) {
        isRasterizingRef.current = true;
        setShouldRasterize(true);
      }

      if (value <= midH) {
        // 0 → 50%: scale50·ty50 로 선형 보간
        const t = value / midH;
        cardScaleSV.value = 1 + (scale50 - 1) * t;
        cardTranslateYSV.value = ty50 * t;
      } else {
        // 50% → 65% (키보드 열림): 상단 면 고정 + 추가 축소
        const clamped = Math.min(value, kbH);
        const newScale = Math.max(0, (screenHeight - clamped - 12 - availTop) / frameHeight);
        const ty = availTop + (frameHeight * newScale) / 2 - cardCenterY;
        cardScaleSV.value = newScale;
        cardTranslateYSV.value = ty;
      }
    });
    return () => cardSheetHAnim.removeListener(sub);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardSheetHAnim]);

  // useAnimatedStyle → UI 스레드에서 직접 Core Animation에 반영
  // (JS→bridge 경유 없이 GPU composite — WebView 래스터화 해상도 유지)
  const pageSheetAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: cardTranslateYSV.value },
      { scale: cardScaleSV.value },
    ],
  }));

  // Entry/exit black overlay animation — starts opaque (value=1) so the loading
  // state is hidden. On content ready: hold 300ms → brighten 700ms. On exit:
  // darken 700ms → hold 300ms → navigate back.
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
  const sentenceSaveKeysRef = useRef(new Set<string>());
  const createThought = useCreateThought();
  const collectionsQuery = useListMyCollections(
    { ownerId: userId, ...(articleId ? { articleId } : {}) },
    { query: { enabled: !!userId && !!articleId } },
  );
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

  // 완료 커밋(보관/건너뛰기/재읽기 종료) 직전에 호출된다. 질문 카드에
  // 한 글자 이상 답한 카드가 있으면, 단상으로 저장한다.
  const answeredQuestionBatchClaimedRef = useRef(false);
  useEffect(() => {
    answeredQuestionBatchClaimedRef.current = false;
  }, [articleId]);
  const applyAnsweredQuestionCardsToMemo = useCallback(() => {
    if (answeredQuestionBatchClaimedRef.current) return;
    const answeredCards = questionCardRef.current?.getAnsweredCards() ?? [];
    const cardsToSave = answeredCards.filter((card) => card.answer.trim().length > 0);
    if (cardsToSave.length === 0) return;
    // Claim synchronously before the first await. Save/skip/reread exit can
    // overlap, but only one path may create this reading session's answers.
    answeredQuestionBatchClaimedRef.current = true;

    void (async () => {
      await queryClient.cancelQueries({ queryKey: getListThoughtsQueryKey() });
      const results = await Promise.allSettled(cardsToSave.map((card) =>
        createThought.mutateAsync({
            data: {
              content: `> ${card.question}\n\n${card.answer.trim()}`,
              createdFrom: "question",
              sourceArticleId: articleId,
            },
          }) as Promise<Thought>
      ));

      // Apply successful responses in authored order, not network completion
      // order, then perform one refresh after the entire creation batch settles.
      for (const result of results) {
        if (result.status === "fulfilled") {
          upsertThoughtInRecordCaches(queryClient, result.value);
        } else {
          console.warn("[thought] question creation failed:", result.reason);
        }
      }
      await invalidateThoughtLists(queryClient);
    })();
  }, [articleId, createThought, queryClient]);

  // ── 단상 바텀시트 ────────────────────────────────────────────────────────
  const [isThoughtsOpen, setIsThoughtsOpen] = useState(false);
  // 컴포넌트 마운트 제어용 — close 애니메이션이 끝날 때까지 true 유지
  const [isThoughtsVisible, setIsThoughtsVisible] = useState(false);
  // 열기 요청마다 증가 — close 애니메이션 중 재오픈을 시트에 전달한다
  const [thoughtsOpenNonce, setThoughtsOpenNonce] = useState(0);
  const [thoughtsQuote, setThoughtsQuote] = useState<string | undefined>(undefined);
  const isThoughtsOpenRef = useRef(false);
  // 배경 탭 시 ThoughtsBottomSheet 내부의 doClose(애니메이션 포함)를 호출하기 위한 ref
  const thoughtsCloseHandleRef = useRef<(() => void) | null>(null);
  // Reanimated SV mirroring isThoughtsOpen — used in PagerSlot's prev style to hide the
  // prev slot while the sheet is open (outer scale shrinks the card and can reveal
  // the parked prev slot in the strip between the scaled card and the screen edge).
  const thoughtsOpenSV = useSharedValue(0);

  // QuestionCardCurl에서 키보드 가시 여부를 확인하기 위한 ref
  const keyboardVisibleRef = useRef(false);
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () => { keyboardVisibleRef.current = true; });
    const hideSub = Keyboard.addListener(hideEvent, () => { keyboardVisibleRef.current = false; });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // Q-card·완독화면 단계에서는 단상 시트 기반 프레임 축소를 적용하지 않는다.
  // (질문 카드 답변 입력 키보드가 프레임 전체를 축소시키던 문제 방지 — 키보드
  //  회피는 QuestionCardCurl 내부에서 덱을 위로 이동시켜 처리한다.)
  useEffect(() => {
    if (totalPages > 0 && visualPage >= totalPages) {
      cardSheetHAnim.setValue(0);
    }
  }, [visualPage, totalPages, cardSheetHAnim]);

  // 메모 모드 진입/종료, 또는 Q-card·완독화면 진입 시 하단 진행률 바를 fade out/in 한다.
  const progressBarOpacity = useSharedValue(1);
  useEffect(() => {
    const shouldHide = isThoughtsOpen || visualPage >= totalPages;
    progressBarOpacity.value = withTiming(shouldHide ? 0 : 1, {
      duration: 180,
      easing: shouldHide ? Easing.out(Easing.ease) : Easing.in(Easing.ease),
    });
  }, [isThoughtsOpen, visualPage, totalPages, progressBarOpacity]);
  const progressBarAnimStyle = useAnimatedStyle(() => ({
    opacity: progressBarOpacity.value,
  }));

  useEffect(() => { isThoughtsOpenRef.current = isThoughtsOpen; }, [isThoughtsOpen]);
  // thoughtsOpenSV는 isThoughtsVisible 기준으로 구동: close 애니메이션이 끝날 때까지
  // prev 슬롯 숨김을 유지해 카드가 완전히 확대되기 전에 prev 슬롯이 노출되는 아티팩트를 방지한다.
  useEffect(() => { thoughtsOpenSV.value = isThoughtsVisible ? 1 : 0; }, [isThoughtsVisible, thoughtsOpenSV]);

  const handleOpenThoughts = useCallback((quote?: string) => {
    setThoughtsQuote(quote);
    setIsThoughtsOpen(true);
    setIsThoughtsVisible(true);
    // close 애니메이션 도중 재오픈하면 isThoughtsVisible이 이미 true라
    // 시트의 visible 전이가 없다. nonce를 올려 open 시퀀스를 확실히 재구동한다.
    setThoughtsOpenNonce((n) => n + 1);
  }, []);

  /**
   * onWillClose 핸들러: 애니메이션 시작 직후 즉시 상호작용 잠금을 해제한다.
   * 잠금 해제 state 하나만 갱신한다 — panGesture가 runOnJS(true)라서 이 시점에
   * 추가 리렌더(예: thoughtsQuote 초기화 → 시트 전체 리렌더)를 유발하면
   * JS 스레드가 막혀 스와이프·FAB가 씹히는 공백 시간이 다시 생긴다.
   */
  const handleWillCloseThoughts = useCallback(() => {
    setIsThoughtsOpen(false);
  }, []);

  /** onClose 핸들러: 애니메이션 완료 후 마운트 해제 + 나머지 상태를 일괄 초기화한다. */
  const handleCloseThoughts = useCallback(() => {
    setIsThoughtsVisible(false);
    setThoughtsQuote(undefined);
    cardSheetHAnim.setValue(0);
  }, [cardSheetHAnim]);

  const handleOpenMemo = useCallback(() => {
    handleOpenThoughts();
  }, [handleOpenThoughts]);

  // Entry animation: fixed 300ms hold → 700ms fade, independent of load state.
  // Fades to HOLD_OPACITY (0.01) — nearly transparent — as the safe hold point.
  // A separate effect snaps to 0 once content is ready, but ONLY after the
  // full 1000ms entry timeline has elapsed, preventing early cancellation on
  // fast/cached loads and ensuring the fixed timing is always respected.
  const HOLD_OPACITY = 0.01;
  const ENTRY_TIMELINE_MS = 1000; // 300ms delay + 700ms fade
  const hasStartedEntryFadeRef = useRef(false);
  const entryTimelineDoneRef = useRef(false);
  const contentReadyRef = useRef(false);

  useEffect(() => {
    if (hasStartedEntryFadeRef.current) return;
    hasStartedEntryFadeRef.current = true;
    overlayOpacity.value = withDelay(300, withTiming(HOLD_OPACITY, { duration: 700, easing: Easing.out(Easing.ease) }));
    const timer = setTimeout(() => {
      entryTimelineDoneRef.current = true;
      // Snap to 0 if content was already ready before the timeline finished.
      if (contentReadyRef.current && overlayOpacity.value > 0) {
        overlayOpacity.value = withTiming(0, { duration: 0 });
      }
    }, ENTRY_TIMELINE_MS);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snap overlay to 0 when content is ready — but only after the entry
  // timeline has run to completion, so the fixed fade is never cut short.
  useEffect(() => {
    if (!articleLoading && !reading.isRestoring && reading.isSessionHydrated) {
      contentReadyRef.current = true;
      if (entryTimelineDoneRef.current && overlayOpacity.value > 0) {
        overlayOpacity.value = withTiming(0, { duration: 0 });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleLoading, reading.isRestoring, reading.isSessionHydrated]);

  // Last-page [ < ] button: fade in only on the last LETTER page; re_read always shows
  useEffect(() => {
    if (mode === "re_read") {
      lastPageBtnOpacity.value = 1;
      return;
    }
    lastPageBtnOpacity.value = withTiming(isOnLastLetterPage ? 1 : 0, { duration: 300, easing: Easing.out(Easing.ease) });
  }, [isOnLastLetterPage, mode]);

  useEffect(() => {
    if (mode === "basic" && articleId) {
      setActiveSession({ articleId, inboxId, mode, userId });
    }
    return () => {};
  }, [articleId, inboxId, mode, setActiveSession, userId]);

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
      // Q-card에서 완독 버튼 누르면 completeScreenVisible=true가 되어 슬롯으로 전환됨
      // (별도 버튼 콜백에서 처리 — 여기서는 컬렉션 선택만 초기화)
    }
  }, [reading.session.state, recentCollectionQuery.data, collectionsQuery.data]);

  useEffect(() => {
    if (reading.session.state === "COMPLETED_COMMITTED") {
      clearActiveSession();
    }
  }, [reading.session.state, clearActiveSession]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (isThoughtsOpenRef.current) {
        thoughtsCloseHandleRef.current?.();
        return true;
      }
      if (mode !== "basic") return false;
      if (!reading.canExit) {
        setExitConfirmVisible(true);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [mode, reading.canExit, isListEntry]);


  const navigateBackDelayed = useCallback(() => {
    setTimeout(() => router.back(), 300);
  }, [router]);

  const handleBack = useCallback(async () => {
    if (isThoughtsOpenRef.current) {
      thoughtsCloseHandleRef.current?.();
      return;
    }
    if (mode === "basic" && !reading.canExit) {
      setExitConfirmVisible(true);
      return;
    }
    if (reading.session.state === "READING" || reading.session.state === "PAUSED") {
      reading.pause();
    }
    overlayOpacity.value = withTiming(1, { duration: 700, easing: Easing.in(Easing.ease) }, (finished) => {
      if (finished) runOnJS(navigateBackDelayed)();
    });
  }, [mode, reading, navigateBackDelayed, overlayOpacity]);

  const canNavigate = mode === "re_read" || reading.session.state === "READING" || reading.session.state === "COMPLETED_READY";

  const showingCover = hasCover && currentPage === 0;

  const handleSwipeLeft = useCallback(() => {
    // Only actual letter pages may advance the reading session. The question
    // card and completion screen have their own virtual-page transitions.
    if (!canNavigate || currentPage < 0 || currentPage >= totalPages) return;
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
    if (!canNavigate || currentPage <= 0 || currentPage > totalPages) return;
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
  }, [canNavigate, currentPage, reading, articleId, totalPages, contentPages, contentPageIndex]);

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
  // nextSlotSV: 0 when overlay/tilt mode (behind current), +W when carousel mode (right of current)
  const nextSlotSV = useSharedValue(0);
  const containerWidthSV = useSharedValue(layout.containerWidth);
  // UI-thread flags for animation styles: 1 = carousel, 0 = tilt/overlay
  // isCarouselForwardSV: true when the NEXT page is Q-card or complete (visualPage >= totalPages-1)
  // isCarouselBackwardSV: true when the CURRENT page is Q-card or complete (visualPage >= totalPages)
  const isCarouselForwardSV = useSharedValue(0);
  const isCarouselBackwardSV = useSharedValue(0);
  // qCardOpacitySV — Q-카드 "유령" 방지 게이트.
  // 슬롯 리매핑 시 Q-카드 뷰는 key를 유지한 채 current 슬롯 → next 슬롯으로
  // 역할만 바뀐다(PagerSlot이 인스턴스를 살려둔다). 역할 전환 프레임에
  // 위치가 아직 갱신되지 않아 중앙(translateX=0)으로 그려질 수 있으므로,
  // 슬롯 위치와 무관하게 opacity로 한 번 더 확실히 차단한다.
  // 1 = Q-카드 섹션이 화면에 관여함(질문카드/완독화면 or 전진 드래그 중)
  // 0 = 편지 페이지에 머무는 중 (Q-카드는 어차피 화면 밖에 주차되어 있음)
  const qCardOpacitySV = useSharedValue(0);

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
  const hasCoverRef = useRef(hasCover);
  useEffect(() => { hasCoverRef.current = hasCover; }, [hasCover]);
  // stale-closure-safe refs for gesture handler
  const visualPageRef = useRef(visualPage);
  useLayoutEffect(() => { visualPageRef.current = visualPage; }, [visualPage]);
  const totalPagesRef = useRef(totalPages);
  useLayoutEffect(() => { totalPagesRef.current = totalPages; }, [totalPages]);
  const completeScreenVisibleRef = useRef(completeScreenVisible);
  useEffect(() => { completeScreenVisibleRef.current = completeScreenVisible; }, [completeScreenVisible]);

  // 단일 페이저: visualPage(=completeScreenVisible ? totalPages+1 : currentPage)가
  // 바뀔 때마다 슬롯을 초기 위치로 리셋한다.
  // Forward/backward 커밋 모두 key 매핑이 자연스럽게 유지되어 팝이 없다
  // (분석은 .local/session_plan.md 참조).
  useLayoutEffect(() => {
    const isCarouselFwd = visualPage >= totalPages - 1;
    const isCarouselBwd = visualPage >= totalPages;
    isCarouselForwardSV.value = isCarouselFwd ? 1 : 0;
    isCarouselBackwardSV.value = isCarouselBwd ? 1 : 0;
    currentSlotSV.value = 0;
    // Carousel backward mode: prev parked with the carousel gap so gesture
    // formulas (park + dx) start exactly from the parked value — no jump/flash.
    prevSlotSV.value = isCarouselBwd
      ? -(layout.containerWidth + CAROUSEL_GAP)
      : -(layout.containerWidth + PARK_EXTRA);
    // Tilt mode: next sits behind current at 0 (overlay reveal).
    // Carousel mode: next parked at +(W + GAP), slides in from the right.
    nextSlotSV.value = isCarouselFwd ? layout.containerWidth + CAROUSEL_GAP : 0;
    // Q-카드 게이트: Q-카드(totalPages)/완독화면(totalPages+1) 구간에서만 보인다.
    // 편지 페이지로 되돌아온 순간 0이 되므로, 스타일 교체 프레임에 중앙으로
    // 잘못 그려지더라도 화면에는 나타나지 않는다.
    qCardOpacitySV.value = isCarouselBwd ? 1 : 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualPage, totalPages, layout.containerWidth]);

  const PARK_EXTRA = 120;
  // Constant visual gap between adjacent sections (letter / Q-card / complete)
  // during carousel slides. Both slots always displace by identical amounts
  // (drag, snap, commit), so the gap never collapses — sections never touch.
  // Also parks neighbors fully off-screen at rest (READER_SIDE_PAD is only 14).
  const CAROUSEL_GAP = 60;
  // 슬롯 애니메이션 스타일은 PagerSlot 내부에서 role별로 계산한다(모듈 하단 참조).
  // 슬롯 뷰마다 "하나의" useAnimatedStyle이 평생 붙어 있고 role만 바뀌므로,
  // 역할이 바뀔 때 스타일 객체가 detach/attach 되며 생기던 유령 프레임이 없다.
  const pagerSV = useMemo(
    () => ({
      prevSlotSV,
      currentSlotSV,
      nextSlotSV,
      containerWidthSV,
      isCarouselForwardSV,
      isCarouselBackwardSV,
      thoughtsOpenSV,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // Q-카드 전용 가시성 게이트 (위 qCardOpacitySV 주석 참조)
  const qCardGateStyle = useAnimatedStyle(() => ({
    opacity: qCardOpacitySV.value,
  }));
  // Memo FAB: hide while on Q-card or complete screen (visualPage >= totalPages)
  const fabOpacitySV = useSharedValue(1);
  useEffect(() => {
    fabOpacitySV.value = withTiming(visualPage >= totalPages ? 0 : 1, { duration: 180 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualPage, totalPages]);
  const fabAnimStyle = useAnimatedStyle(() => ({ opacity: fabOpacitySV.value }));


  // ── Gesture state ref (always fresh, avoids stale closure in useMemo) ────
  // isAtEnd: cannot swipe forward past the complete screen (visualPage totalPages+1)
  const isAtEnd = visualPage >= totalPages + 1;

  const gestureState = useRef({
    canNavigate: false,
    isOnLastLetterPage: false,
    isAtEnd: false,
    atBoundaryLeft: true,
    containerWidth: 300,
    totalPages: 0,
    isTextSelecting: false,
    isDragging: false,
    isCommitting: false,
    isCarouselForward: false,
    isCarouselBackward: false,
  });
  gestureState.current = {
    canNavigate,
    isOnLastLetterPage,
    isAtEnd,
    atBoundaryLeft: visualPage === 0,
    containerWidth: layout.containerWidth,
    totalPages,
    isTextSelecting: isTextSelectingRef.current,
    isDragging: isDraggingRef.current,
    isCommitting: false, // updated inline
    // Carousel vs. tilt mode per direction:
    //   isCarouselForward : next page is Q-card or complete (visualPage >= totalPages-1)
    //   isCarouselBackward: current page is Q-card or complete (visualPage >= totalPages)
    isCarouselForward: visualPage >= totalPages - 1,
    isCarouselBackward: visualPage >= totalPages,
  };
  const isCommittingRef = useRef(false);
  const pageTurnGenerationRef = useRef(0);
  const committedTotalPagesRef = useRef(totalPages);
  useLayoutEffect(() => {
    if (committedTotalPagesRef.current === totalPages) return;

    committedTotalPagesRef.current = totalPages;
    // The existing slot-reset layout effect restores the visual positions.
    // Invalidate the old callback so it cannot reinterpret a new page topology.
    pageTurnGenerationRef.current += 1;
    isCommittingRef.current = false;
    activeSwipeRef.current = null;
  }, [totalPages]);

  // Callbacks invoked via runOnJS after UI-thread animation completes
  const finishPageTurnRef = useRef((
    _direction: -1 | 1,
    _sourceVisualPage: number,
    _sourceTotalPages: number,
    _generation: number,
  ) => {});
  const openMemoRef = useRef(() => {});
  useEffect(() => {
    finishPageTurnRef.current = (
      direction: -1 | 1,
      sourceVisualPage: number,
      sourceTotalPages: number,
      generation: number,
    ) => {
      // A newer gesture or a data-driven page-count change owns the pager now.
      if (generation !== pageTurnGenerationRef.current) return;
      isCommittingRef.current = false;
      activeSwipeRef.current = null;
      const vp = visualPageRef.current;
      const tp = totalPagesRef.current;
      if (!isCurrentReadingPagerTransition(sourceVisualPage, sourceTotalPages, vp, tp)) {
        return;
      }

      if (direction === -1) {
        if (sourceVisualPage === sourceTotalPages - 1) {
          // last letter page → Q-card: advance reading session
          handleSwipeLeftRef.current();
        } else if (sourceVisualPage === sourceTotalPages) {
          // Q-card → complete screen: determine case type from answered cards
          const answeredCards = questionCardRef.current?.getAnsweredCards() ?? [];
          const hasSubstantialAnswer = answeredCards.some((c) => c.answer.trim().length > 0);
          setReadingCompleteCaseType(hasSubstantialAnswer ? "answered" : "read");
          setCompleteScreenVisible(true);
        } else if (sourceVisualPage >= 0 && sourceVisualPage < sourceTotalPages - 1) {
          handleSwipeLeftRef.current();
        }
      } else {
        // Backward: 리매핑 커밋에서 새 prev 콘텐츠 마운트를 1커밋 지연 (번쩍임 방지)
        setDeferPrevMount(true);
        if (sourceVisualPage === sourceTotalPages + 1) {
          // complete screen → Q-card
          setCompleteScreenVisible(false);
        } else if (sourceVisualPage === sourceTotalPages) {
          // Q-card → last letter page: go back in reading session
          handleSwipeRightRef.current();
        } else if (sourceVisualPage > 0 && sourceVisualPage < sourceTotalPages) {
          handleSwipeRightRef.current();
        }
      }
    };
  }, []);
  useEffect(() => {
    openMemoRef.current = () => handleOpenMemo();
  }, [handleOpenMemo]);

  // 단일 페이저용 프로그래매틱 전진: 마지막 편지 페이지의 [ < ] 버튼이 누를 때
  // 사용. Q-card가 이미 next 슬롯에 있으므로 currentSlotSV만 좌측으로 내보내면 된다.
  const triggerProgrammaticForwardRef = useRef(() => {});
  useEffect(() => {
    triggerProgrammaticForwardRef.current = () => {
      if (isCommittingRef.current) return;
      const currentVisualPage = visualPageRef.current;
      const currentTotalPages = totalPagesRef.current;
      if (
        currentTotalPages <= 0
        || currentVisualPage !== currentTotalPages - 1
      ) {
        return;
      }
      const W = containerWidthRef.current || 300;
      isCommittingRef.current = true;
      const generation = pageTurnGenerationRef.current + 1;
      pageTurnGenerationRef.current = generation;
      const easing = Easing.bezier(0.25, 0.46, 0.45, 0.94);
      // 프로그래매틱 전진: Q-카드가 우측에서 들어오므로 게이트 오픈
      qCardOpacitySV.value = 1;
      // Same displacement (W+GAP) for both slots ⇒ constant carousel gap.
      nextSlotSV.value = withTiming(0, { duration: 320, easing });
      currentSlotSV.value = withTiming(-(W + CAROUSEL_GAP), { duration: 320, easing }, () => {
        runOnJS(finishPageTurnRef.current)(
          -1,
          currentVisualPage,
          currentTotalPages,
          generation,
        );
      });
    };
  });

  // Floating [ < ] button handler:
  //   - re_read mode → go back
  //   - normal read mode, last letter page → slide Q-card in (programmatic)
  //   - otherwise → go back
  const handleFloatingBackBtn = useCallback(() => {
    if (mode !== "re_read" && reading.session.state === "READING" && isOnLastLetterPage) {
      triggerProgrammaticForwardRef.current();
      return;
    }
    handleBack();
  }, [mode, reading.session.state, isOnLastLetterPage, handleBack]);

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
  // 단일 페이저: letter pages, Q-card, 완독화면 모두 같은 슬롯 시스템으로 처리.
  // 특수 케이스(A/B/C/D)나 cardEntranceX 없이 완전히 동일한 forward/backward 로직.
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
      if (isThoughtsOpenRef.current) return;
      if (isCommittingRef.current) return;
      // 드래그 도중 손가락을 잠깐 멈추면 WebView가 롱프레스로 판단해 텍스트 선택
      // (onTextSelect) 또는 onDragStart를 올린다. 그때 여기서 무조건 return 하면
      // 카드가 손가락을 놓친 채 그 자리에 얼어붙는다("틱 걸림").
      // 이미 스와이프가 시작된 뒤라면(activeSwipeRef 존재) 손가락을 뗄 때까지
      // 계속 따라오도록, 이 가드는 "스와이프 시작 전"에만 적용한다.
      // (바로 아래 dy 가드가 쓰는 것과 동일한 규칙)
      if (!activeSwipeRef.current && (isDraggingRef.current || isTextSelectingRef.current)) return;
      const gs = gestureState.current;

      const dx = e.translationX;
      const dy = e.translationY;
      if (!activeSwipeRef.current && Math.abs(dy) > Math.abs(dx) * 1.8) return;

      if (dx < 0 && gs.isAtEnd) return;
      if (dx > 0 && gs.atBoundaryLeft) return;

      const W = gs.containerWidth || 300;
      if (dx < 0) {
        activeSwipeRef.current = 'forward';
        // current always slides left
        currentSlotSV.value = Math.max(dx, -(W + PARK_EXTRA));
        // Carousel only: next slides in from right simultaneously, keeping a
        // constant CAROUSEL_GAP from current (both displace by exactly dx).
        // Tilt/overlay: next stays behind current at 0 — revealed as current moves away.
        if (gs.isCarouselForward) {
          // 전진 드래그로 Q-카드가 우측에서 들어오기 시작 → 게이트 오픈
          qCardOpacitySV.value = 1;
          nextSlotSV.value = W + CAROUSEL_GAP + dx;
        }
      } else if (dx > 0) {
        activeSwipeRef.current = 'backward';
        if (gs.isCarouselBackward) {
          // Carousel: prev enters from its parked position -(W+GAP) and current
          // slides right by the same dx — constant gap, and NO jump at dx≈0
          // (previously dx-W caused the parked letter card to flash into view).
          prevSlotSV.value = Math.min(0, dx - (W + CAROUSEL_GAP));
          currentSlotSV.value = Math.min(dx, W + CAROUSEL_GAP);
        } else {
          // Tilt/overlay: prev slides in on top; current stays at 0.
          prevSlotSV.value = Math.max(-(W + PARK_EXTRA), dx - W);
        }
      }
    })
    .onEnd((e) => {
      if (isCommittingRef.current) return;

      const gs = gestureState.current;
      const W = gs.containerWidth || 300;

      const snapForward = () => {
        currentSlotSV.value = withSpring(0, snapConfig);
        // Carousel only: snap next back to its parked position (+W+GAP).
        // Tilt: next is already at 0 (never moved), no action needed.
        if (gs.isCarouselForward) nextSlotSV.value = withSpring(W + CAROUSEL_GAP, snapConfig);
        activeSwipeRef.current = null;
      };
      const snapBackward = () => {
        prevSlotSV.value = withSpring(
          gs.isCarouselBackward ? -(W + CAROUSEL_GAP) : -(W + PARK_EXTRA),
          snapConfig,
        );
        // Carousel only: snap current back to center.
        // Tilt: current never moved during backward, already at 0.
        if (gs.isCarouselBackward) currentSlotSV.value = withSpring(0, snapConfig);
        activeSwipeRef.current = null;
      };

      // onUpdate와 동일 규칙 — 스와이프가 시작되기 "전"에 텍스트 선택/드래그가
      // 잡힌 경우에만 취소한다. 이미 손가락을 따라오던 스와이프는 아래 정상
      // 커밋 로직으로 넘겨 거리/속도 판정을 그대로 받게 한다. (그렇지 않으면
      // 드래그 중 멈칫해서 선택이 켜졌을 때 충분히 끌었어도 항상 스냅백된다.)
      if (!activeSwipeRef.current && (isDraggingRef.current || isTextSelectingRef.current)) {
        snapBackward();
        return;
      }

      const dx = e.translationX;
      const dy = e.translationY;
      const absDx = Math.abs(dx);

      if (isThoughtsOpenRef.current) return;

      // Upward swipe → open thoughts sheet only on letter pages, not Q-card/complete
      if (dy < -50 && Math.abs(dy) > absDx * 1.5 && !isThoughtsOpenRef.current
          && visualPageRef.current < gs.totalPages) {
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

      if (!goingNext && gs.atBoundaryLeft) {
        snapBackward();
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
      const sourceVisualPage = visualPageRef.current;
      const sourceTotalPages = totalPagesRef.current;
      if (
        !isCurrentReadingPagerTransition(
          sourceVisualPage,
          sourceTotalPages,
          sourceVisualPage,
          sourceTotalPages,
        )
      ) {
        if (goingNext) snapForward();
        else snapBackward();
        return;
      }
      isCommittingRef.current = true;
      const generation = pageTurnGenerationRef.current + 1;
      pageTurnGenerationRef.current = generation;

      const SLIDE_EASING = Easing.bezier(0.25, 0.46, 0.45, 0.94);
      if (direction === -1) {
        // Forward commit: current always exits left.
        // Carousel: next enters center simultaneously (linked).
        // Tilt: next already at 0 behind current — naturally revealed as current slides away.
        if (gs.isCarouselForward) {
          // Carousel: next → 0 and current → -(W+GAP): identical remaining
          // displacement + same duration/easing ⇒ gap stays constant, never touches.
          nextSlotSV.value = withTiming(0, { duration: 240, easing: SLIDE_EASING });
          currentSlotSV.value = withTiming(-(W + CAROUSEL_GAP), { duration: 240, easing: SLIDE_EASING },
            () => {
              runOnJS(finishPageTurnRef.current)(
                direction,
                sourceVisualPage,
                sourceTotalPages,
                generation,
              );
            });
        } else {
          currentSlotSV.value = withTiming(-(W + PARK_EXTRA), { duration: 240, easing: SLIDE_EASING },
            () => {
              runOnJS(finishPageTurnRef.current)(
                direction,
                sourceVisualPage,
                sourceTotalPages,
                generation,
              );
            });
        }
      } else {
        // Backward commit: prev always enters center.
        // Carousel: current exits right by the same displacement (constant gap).
        // Tilt: current stays at 0 — prev slides on top.
        if (gs.isCarouselBackward) {
          currentSlotSV.value = withTiming(W + CAROUSEL_GAP, { duration: 240, easing: SLIDE_EASING });
          // ⚠️ currentSlotSV 콜백에서 직접 0으로 리셋하지 않는다.
          // 두 withTiming이 "같은 240ms"여도 currentSlotSV 콜백이 먼저 실행되는 경우
          // prevSlotSV가 아직 0에 도달하지 못한 상태에서 Q-카드가 중앙(0)으로 스냅돼
          // 잠깐 노출되는 유령 현상이 발생한다.
          // 대신 prevSlotSV 콜백(편지 페이지가 완전히 중앙에 도달한 시점)에서 리셋한다.
        }
        const isCarouselBwd = gs.isCarouselBackward;
        // 편지 페이지로 되돌아가는 커밋이면(Q-카드 → 마지막 편지 페이지),
        // 리매핑이 일어나기 전에 UI 스레드에서 미리 Q-카드를 감춘다.
        const hidesQCard = isCarouselBwd && sourceVisualPage === sourceTotalPages;
        prevSlotSV.value = withTiming(0, { duration: 240, easing: SLIDE_EASING }, () => {
          // 편지 페이지(top layer)가 중앙에 완전히 도달한 뒤에 currentSlotSV를 0으로 리셋.
          // 이 순서를 지키면 Q-카드가 편지 페이지 아래에 가려진 채로 스냅되므로
          // 유령처럼 순간 보이는 현상이 사라진다.
          if (isCarouselBwd) currentSlotSV.value = 0;
          // 리매핑(스타일 교체) 전에 게이트를 닫아 두면, detach/attach 프레임에
          // Q-카드가 중앙으로 그려지더라도 투명해서 보이지 않는다.
          if (hidesQCard) qCardOpacitySV.value = 0;
          runOnJS(finishPageTurnRef.current)(
            direction,
            sourceVisualPage,
            sourceTotalPages,
            generation,
          );
        });
      }
    })
    .onFinalize(() => {
      if (!isCommittingRef.current) {
        const W = containerWidthRef.current || 300;
        const gs = gestureState.current;
        currentSlotSV.value = withSpring(0, snapConfig);
        prevSlotSV.value = withSpring(
          gs.isCarouselBackward ? -(W + CAROUSEL_GAP) : -(W + PARK_EXTRA),
          snapConfig,
        );
        // Tilt mode: next is parked at 0 (behind current).
        // Carousel mode: next is parked at +(W+GAP) (right of screen).
        nextSlotSV.value = withSpring(gs.isCarouselForward ? W + CAROUSEL_GAP : 0, snapConfig);
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

  const isCollectionsReady = !!userId && !!articleId && !collectionsQuery.isLoading && !collectionsQuery.isError;
  const isAlreadySaved = collectionsQuery.data?.some((collection) => collection.containsArticle) ?? false;

  const handleCommitAndSave = useCallback(async () => {
    if (isSaving) return;
    if (!isCollectionsReady) {
      showToast({ message: "보관함 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.", type: "info" });
      return;
    }
    if (isAlreadySaved) return;
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

      // 완독 화면을 유지한 채 fade-out — 슬롯을 되돌리면 편지 페이지가
      // 잠깐 보이는 점프가 생기므로 completeScreenVisible은 건드리지 않는다.
      // (화면을 떠나므로 되돌릴 필요 없음)
      trackArticleAction({ articleId, action: "save", msSinceComplete: Date.now() - completionTimeRef.current });
      invalidateInbox(queryClient);
      clearActiveSession();
      applyAnsweredQuestionCardsToMemo();
      overlayOpacity.value = withTiming(1, { duration: 700, easing: Easing.in(Easing.ease) }, (finished) => {
        if (finished) runOnJS(navigateBackDelayed)();
      });
      showToast({ message: "보관함에 저장됐어요.", type: "success" });
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, isCollectionsReady, isAlreadySaved, reading, selectedCollectionId, collectionsQuery.data, articleId, userId, createCollection, addToCollection, updateRecentCollection, queryClient, clearActiveSession, router, applyAnsweredQuestionCardsToMemo]);

  const handleCommitAndSkip = useCallback(async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      const result = await reading.commitCompletion();
      // 완독 화면을 유지한 채 fade-out — 슬롯을 되돌리면 편지 페이지가
      // 잠깐 보이는 점프가 생긴다. 실패 시에도 완독 화면에 남아 재시도한다.
      if (result.success) {
        trackArticleAction({ articleId, action: "skip", msSinceComplete: Date.now() - completionTimeRef.current });
        if (!isListEntry) {
          // 수신함 경로: 읽기 완료 후 수신함 목록 갱신
          invalidateInbox(queryClient);
        }
        clearActiveSession();
        applyAnsweredQuestionCardsToMemo();
        promptOrContinue(() => {
          overlayOpacity.value = withTiming(1, { duration: 700, easing: Easing.in(Easing.ease) }, (finished) => {
            if (finished) runOnJS(navigateBackDelayed)();
          });
          showToast({ message: "읽기를 완료했어요.", type: "success" });
        });
      } else {
        showToast({ message: result.error ?? "완독 처리에 실패했습니다.", type: "error" });
      }
    } finally {
      setIsDeleting(false);
    }
  }, [isDeleting, isListEntry, reading, router, clearActiveSession, queryClient, articleId, promptOrContinue, applyAnsweredQuestionCardsToMemo]);

  const handleRereadExit = useCallback(async () => {
    if (shouldCommitCompletionForEntry(mode, inboxId)) {
      // Inbox rereads must use the same completion path as first reads. This
      // commits the current delivery, updates its cache entry, and preserves
      // the duplicate-delivery prompt before navigating away.
      await handleCommitAndSkip();
      return;
    }

    // Collection/record rereads have no inbox delivery to acknowledge.
    // Keep their existing completion-screen fade and navigation behavior.
    applyAnsweredQuestionCardsToMemo();
    overlayOpacity.value = withTiming(1, { duration: 700, easing: Easing.in(Easing.ease) }, (finished) => {
      if (finished) runOnJS(navigateBackDelayed)();
    });
  }, [mode, inboxId, handleCommitAndSkip, applyAnsweredQuestionCardsToMemo, overlayOpacity, navigateBackDelayed]);

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
    const sentence = text.trim();
    if (!sentence) return;

    const page = contentPageIndex;
    const saveKey = `${articleId}:${page}:${sentence}`;
    if (sentenceSaveKeysRef.current.has(saveKey)) return;
    sentenceSaveKeysRef.current.add(saveKey);

    void createSentence.mutateAsync({
      data: {
        userId,
        articleId,
        text: sentence,
        position: { page },
      },
    }).then(() => {
      void queryClient.invalidateQueries({
        queryKey: getListStoredSentencesQueryKey({ userId }),
      });
      trackSentenceCollected({ articleId, page, textLength: sentence.length });
      showToast({ message: "문장이 저장되었습니다.", type: "success" });
    }).catch((error: unknown) => {
      const message = error instanceof Error
        ? error.message
        : "문장 저장에 실패했습니다. 다시 수집해주세요.";
      showToast({ message, type: "error" });
    }).finally(() => {
      sentenceSaveKeysRef.current.delete(saveKey);
    });
  }, [
    articleId,
    contentPageIndex,
    createSentence,
    queryClient,
    showToast,
    userId,
  ]);

  const handleMemoSentence = useCallback((text: string) => {
    if (text.trim().length === 0) return;
    const pageNum = currentPage;
    const author = authorName ?? "";
    const title = article?.title ?? "";
    trackMemoCreatedDuringReading({ articleId, page: currentPage });
    // Route quote text into the thoughts sheet's compose field via pendingQuote.
    // The user can edit/augment the quote before saving — no immediate creation.
    const meta = [author, title].filter(Boolean).join(", ");
    const quoteText = formatReadingThoughtQuote(
      text,
      meta ? `${meta}, ${pageNum}면` : undefined,
    );
    handleOpenThoughts(quoteText);
  }, [currentPage, authorName, article?.title, handleOpenThoughts, articleId]);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        articleTitle: {
          fontSize: layout.captionFontSize,
          fontFamily: ReaderTokens.fontFamily.sans,
          letterSpacing: layout.titleLetterSpacing,
          color: Colors.zinc500,
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
          color: Colors.zinc500,
          textAlign: "right" as const,
        },
        completeButtonText: {
          fontSize: layout.bodyFontSize,
          fontWeight: "600" as const,
          fontFamily: ReaderTokens.fontFamily.sansSemiBold,
          color: Colors.white,
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
            {/* 측정용 래퍼 — transform 바깥이므로 measureInWindow가 원래 위치를 반환 */}
            <View ref={cardWrapRef} collapsable={false} onLayout={handleCardWrapLayout}>
            {/* 래스터 힌트는 단상 시트 축소 구간에서만 켠다. 질문 카드 단계에서는
                카드 자체가 0.88배로 연속 축소되므로, 여기서 래스터화가 켜져 있으면
                축소 스냅샷 위에 또 축소가 겹쳐 텍스트 해상도가 깨진다. */}
            <Animated.View
              style={pageSheetAnimStyle}
              shouldRasterizeIOS={shouldRasterize && visualPage < totalPages}
              renderToHardwareTextureAndroid={shouldRasterize && visualPage < totalPages}
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
                  {/* Carousel page slots — three slots positioned side-by-side.
                      prev at –W (left, off-screen), current at 0 (center),
                      next at +W (right, off-screen). Both linked slots move
                      simultaneously during gestures and commit animations. */}
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
                      const slotBase: object = {
                        position: "absolute" as const,
                        top: 0,
                        left: 0,
                        width: W,
                        height: H,
                      };
                      // Shadow layer placed BEHIND each slot's content.
                      // backgroundColor matches the page background so only the
                      // shadow radiates past the card edges.
                      // Only rendered for letter pages (not Q-card / complete screen).
                      // boxShadow = React Native Web (Expo Web).
                      // shadowColor/shadowRadius/elevation = native iOS & Android.
                      // Both sets must coexist — boxShadow is silently ignored on native,
                      // native props are silently ignored on web.
                      const shadowLayer: object = {
                        position: "absolute" as const,
                        top: 0,
                        left: 0,
                        width: W,
                        height: H,
                        backgroundColor: ReaderTokens.bodyBg,
                        // iOS/Android/Web shadow from token — Platform.select ensures each
                        // platform gets only its own props (boxShadow on web, native shadow
                        // props on iOS, elevation on Android).
                        ...Shadows.previewPage,
                      };
                      // Inner wrapper clips text/WebView content to card bounds.
                      // overflow:"hidden" 제거 — slotContent가 WebView와 정확히
                      // 같은 크기이므로 실질적 클리핑이 없다. scale transform 조상에
                      // overflow:hidden(masksToBounds)이 걸리면 iOS가 합성 레이어를
                      // 현재 시각적 크기(축소 비율) 기준으로 래스터화해 해상도가
                      // 깨지는 원인이 된다 — 해당 속성을 제거해 이를 방지한다.
                      const slotContent = {
                        width: W,
                        height: H,
                        backgroundColor: ReaderTokens.bodyBg,
                      };

                      // 단일 페이저: letter pages [0..totalPages-1], Q-card [totalPages],
                      // 완독화면 [totalPages+1]. visualPage가 슬롯 인덱스로 쓰인다.
                      const makeNode = (pageIdx: number): React.ReactNode => {
                        if (pageIdx === totalPages) {
                          // Q-card 슬롯 — 제스처로 왼쪽 스와이프하면 완독화면으로 이동.
                          // qCardGateStyle: 슬롯 리매핑 중 스타일 detach/attach 프레임에
                          // 중앙으로 잘못 그려지는 "유령" 노출을 opacity로 차단한다.
                          return (
                            <Animated.View style={[StyleSheet.absoluteFill, qCardGateStyle]}>
                              <QuestionCardCurl
                                ref={questionCardRef}
                                questions={questionCardQuestions}
                                containerWidth={layout.containerWidth}
                                containerHeight={layout.containerHeight}
                                keyboardVisibleRef={keyboardVisibleRef}
                              />
                            </Animated.View>
                          );
                        }
                        if (pageIdx === totalPages + 1) {
                          // 완독화면 슬롯
                          return (
                            <ReadingCompleteScreen
                              caseType={readingCompleteCaseType}
                              isSaving={isSaving}
                              isDeleting={isDeleting}
                              isCollectionsReady={isCollectionsReady}
                              isAlreadySaved={isAlreadySaved}
                              onSave={handleCommitAndSave}
                              onSkip={mode === "re_read" ? handleRereadExit : handleCommitAndSkip}
                              onReread={() => {
                                setCompleteScreenVisible(false);
                              }}
                            />
                          );
                        }
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

                      // 슬롯 인덱스는 visualPage 기준 (currentPage 대신).
                      const nextPageIdx = visualPage + 1;
                      const currentPageIdx = visualPage;
                      const prevPageIdx = visualPage - 1;

                      // Letter pages (idx 0..totalPages-1) get the card shadow.
                      // Q-card (totalPages) and complete screen (totalPages+1) do not —
                      // they are full-screen sections, not letter-page cards.
                      const isLetterPageIdx = (idx: number) => idx >= 0 && idx < totalPages;

                      // 슬롯을 "키 배열"로 렌더한다. 정적 JSX 자식으로 두면 React가
                      // 위치 기준으로 재조정하기 때문에, 같은 페이지가 current →
                      // next 슬롯으로 옮겨갈 때 key가 달라진 위치로 인식돼
                      // 언마운트/재마운트된다(= WebView 리더가 새로 로드되며 번쩍임).
                      // 배열 + key로 렌더하면 React가 인스턴스를 "이동"시키므로
                      // 마지막 편지 페이지 ↔ 질문 카드를 오가도 살아 있는다.
                      // 배열 순서(next → current → prev)가 곧 z-order다.
                      const slots: Array<{
                        pageIdx: number;
                        role: PagerSlotRole;
                        hidden: boolean;
                      }> = [
                        { pageIdx: nextPageIdx, role: "next", hidden: false },
                        { pageIdx: currentPageIdx, role: "current", hidden: false },
                        // Backward 리매핑 직후 1커밋 동안 prev 슬롯을 감춘다
                        // (prevSlotSV가 파킹되기 전 새로 들어온 페이지가 중앙에
                        //  그려지는 것 방지). 언마운트가 아니라 opacity로만 가려서
                        //  재사용 중인 인스턴스가 사라지지 않게 한다.
                        { pageIdx: prevPageIdx, role: "prev", hidden: deferPrevMount },
                      ];

                      return (
                        <>
                          {slots.map((slot) => (
                            <PagerSlot
                              key={`page-${slot.pageIdx}`}
                              role={slot.role}
                              sv={pagerSV}
                              slotBase={slotBase}
                              shadowLayer={shadowLayer}
                              slotContent={slotContent}
                              showShadow={isLetterPageIdx(slot.pageIdx)}
                              hidden={slot.hidden}
                            >
                              {makeNode(slot.pageIdx)}
                            </PagerSlot>
                          ))}
                        </>
                      );
                    })()}
                  </View>

                </View>
              </View>
              </View>
            </Animated.View>
            </View>

            {/* Progress bar below card — 메모 모드·Q-card·완독화면 진입 시 fade out */}
            <Animated.View
              style={[styles.progressBarContainer, progressBarAnimStyle]}
              pointerEvents={isThoughtsOpen || visualPage >= totalPages ? "none" : "auto"}
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
        pointerEvents={isOnLastLetterPage || mode === "re_read" ? "auto" : "none"}
      >
        {mode === "re_read" ? (
          <HeaderButton
            variant="back"
            onPress={handleFloatingBackBtn}
            accessibilityLabel="읽기 화면에서 돌아가기"
          />
        ) : (
          <Pressable onPress={handleFloatingBackBtn} hitSlop={16}>
            <Feather name="chevron-left" size={28} color={Colors.zinc700} />
          </Pressable>
        )}
      </Animated.View>

      {/* ── Memo FAB — bottom right (편지 페이지에서만 표시, Q-card/완독화면에서는 숨김) */}
      <Animated.View
        style={[fabAnimStyle, { position: "absolute", bottom: insets.bottom + 24, right: 20 }]}
        pointerEvents={visualPage >= totalPages || isThoughtsOpen ? "none" : "box-none"}
      >
        <ScalePressable
          onPress={handleOpenMemo}
          hitSlop={8}
          scaleTo={0.9}
          style={{ width: 48, height: 48 }}
          contentStyle={styles.memoFabContent}
        >
          <Feather name="edit-3" size={20} color={Colors.zinc600} />
        </ScalePressable>
      </Animated.View>

      {/* ── 단상 시트 배경 탭 해제 ─────────────────────────────────────── */}
      {/* thoughtsCloseHandleRef.current → 시트 내부 doClose(슬라이드+스프링 후 onClose) */}
      {/* 완전 투명(시각 요소 없음)이라 isThoughtsOpen 기준으로 즉시 언마운트해도
          닫기 애니메이션에 영향이 없다. 이렇게 해야 해제 즉시 리더 컨트롤이
          터치를 받는다 — 마운트를 유지하면 전면 Pressable이 탭을 가로챈다. */}
      {isThoughtsOpen && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => thoughtsCloseHandleRef.current?.()}
        />
      )}

      {/* ── 단상 바텀시트 ──────────────────────────────────────────────── */}
      {articleId ? (
        <ThoughtsBottomSheet
          visible={isThoughtsVisible}
          onClose={handleCloseThoughts}
          onWillClose={handleWillCloseThoughts}
          openNonce={thoughtsOpenNonce}
          interactive={isThoughtsOpen}
          articleId={articleId}
          pendingQuote={thoughtsQuote}
          cardSheetHAnim={cardSheetHAnim}
          closeHandleRef={thoughtsCloseHandleRef}
        />
      ) : null}

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
    color: Colors.zinc500,
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
    color: Colors.zinc400, // typography-ok: ghost/placeholder answer text
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
  /** Explicit integer pixel width for the text column (pageWidth - 2*paddingX, rounded).
   *  Use this as the width constraint for text containers instead of relying on
   *  paddingHorizontal, so Yoga pixel-snapping is consistent across different parent positions. */
  textColumnWidth: number;
  bodyFontSize: number;
  bodyParagraphGap: number;
  titleFontSize: number;
  captionFontSize: number;
  metadataFontSize: number;
  bodyLineHeight: number;
  bodyLetterSpacing: number;
  titleLineHeight: number;
  titleLetterSpacing: number;
  titleBarHeight: number;
}

/* ════════════════════════════════════════════════════════════════════════
 * PagerSlot — 3슬롯 페이저의 개별 슬롯
 *
 * 핵심: 슬롯 뷰는 페이지 인덱스(key)로 식별되고, 역할(prev/current/next)은
 * prop으로만 바뀐다. 애니메이티드 스타일은 뷰당 하나만 만들어 평생 붙어
 * 있으므로, 역할이 바뀌어도
 *   1) 컴포넌트(WebView 리더 / 질문 카드 덱)가 언마운트되지 않고,
 *   2) 스타일 객체가 detach/attach 되며 transform이 비는 유령 프레임도 없다.
 * ════════════════════════════════════════════════════════════════════════ */
type PagerSlotRole = "prev" | "current" | "next";
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
    [layout.paddingX, layout.paddingY, layout.titleBarHeight, layout.textColumnWidth, bottomInset],
  );

  return (
    <View style={[styles.pageContainer, { flex: 1 }]}>
      <View style={dynamicPageStyles.pageContent}>
        <View style={dynamicPageStyles.textColumn}>
            <WebViewMarkdownReader
              markdown={content}
              typography={bodyTypographyMetrics({
                pageWidth: layout.containerWidth, pageHeight: layout.containerHeight,
                paddingX: layout.paddingX, paddingY: layout.paddingY, textColumnWidth: layout.textColumnWidth,
                bodyFontSize: layout.bodyFontSize, bodyLineHeight: layout.bodyLineHeight,
                 bodyParagraphGap: layout.bodyParagraphGap,
                bodyLetterSpacing: layout.bodyLetterSpacing, titleFontSize: layout.titleFontSize,
                titleBarHeight: layout.titleBarHeight,
              })}
              onTextSelect={onTextSelect}
              onDragStateChange={onDragStateChange}
              clearSelectionSignal={clearSignal}
            />
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ReaderTokens.bodyBg,
  },
  floatingBackBtn: {
    position: "absolute",
    left: Spacing.screenPx,
    zIndex: 30,
  },
  memoFabContent: {
    alignSelf: "flex-start",
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    alignItems: "center",
    justifyContent: "center",
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
  memoToolbarWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 53,
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
  selectionPillButton: {},
  selectionPillButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
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

// ─────────────────────────────────────────────────────────────────────────────
// ReadingCompleteScreen: 읽기 완료 전체화면 오버레이 (목업 ReadingCompletePreview 이식)
// ─────────────────────────────────────────────────────────────────────────────
const READ_ALL_IMG = require("@/assets/images/splash-icon.png");
// Matches the pager's own snap-back feel (see `snapConfig` in the main
// component above). Module-level so it's a stable reference for useMemo deps.

interface ReadingCompleteScreenProps {
  caseType: "read" | "answered";
  isSaving: boolean;
  isDeleting: boolean;
  isCollectionsReady: boolean;
  isAlreadySaved: boolean;
  onSave: () => void;
  onSkip: () => void;
  onReread: () => void;
}

function ReadingCompleteScreen({
  caseType,
  isSaving,
  isDeleting,
  isCollectionsReady,
  isAlreadySaved,
  onSave,
  onSkip,
  onReread,
}: ReadingCompleteScreenProps) {
  const insets = useSafeAreaInsets();
  const message = caseType === "read"
    ? "마지막 장까지\n온전히 닿았습니다."
    : "마지막 장을\n직접 완성했습니다.";

  return (
    <View style={readingCompleteStyles.container}>
      {/* 아이콘 + 메시지 */}
      <View style={readingCompleteStyles.center}>
        <Image
          source={READ_ALL_IMG}
          style={readingCompleteStyles.icon}
          resizeMode="contain"
        />
        <Text style={readingCompleteStyles.message}>{message}</Text>
      </View>

      {/* 하단 버튼 영역 */}
      <View style={[readingCompleteStyles.bottom, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        {/* 보관하기 (primary) */}
        <Pressable
          style={[readingCompleteStyles.saveBtn, (isSaving || !isCollectionsReady || isAlreadySaved) && readingCompleteStyles.btnDisabled]}
          onPress={onSave}
          disabled={isSaving || !isCollectionsReady || isAlreadySaved}
        >
          <Text style={readingCompleteStyles.saveBtnText}>
            {isSaving ? "저장 중..." : !isCollectionsReady ? "불러오는 중..." : isAlreadySaved ? "이미 보관된 글이에요" : "보관하기"}
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
    </View>
  );
}

const readingCompleteStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
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
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  saveBtn: {
    width: "100%",
    paddingVertical: 15,
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    alignItems: "center",
  },
  saveBtnText: {
    fontSize: 16,
    fontFamily: ReaderTokens.fontFamily.sansSemiBold,
    fontWeight: "600",
    color: Colors.white,
  },
  skipBtn: {
    width: "100%",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.zinc200,
    alignItems: "center",
  },
  skipBtnText: {
    fontSize: 15,
    fontFamily: ReaderTokens.fontFamily.sans,
    color: Colors.zinc500,
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
    color: Colors.zinc500,
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

const SLOT_MAX_ROTATE_DEG = 4;

function PagerSlot({
  role,
  sv,
  slotBase,
  shadowLayer,
  slotContent,
  showShadow,
  hidden,
  children,
}: {
  role: PagerSlotRole;
  sv: PagerSlotSharedValues;
  slotBase: object;
  shadowLayer: object;
  slotContent: object;
  showShadow: boolean;
  hidden: boolean;
  children: React.ReactNode;
}) {
  const slotAnimStyle = useAnimatedStyle(() => {
    const W = sv.containerWidthSV.value || 300;
    if (role === "next") {
      // Tilt mode: parked at 0 behind current. Carousel: parked at +(W+GAP).
      return { transform: [{ translateX: sv.nextSlotSV.value }, { rotateZ: "0deg" }], opacity: 1 };
    }
    if (role === "current") {
      // Letter pages: tilts (negative rotateZ) as it slides left.
      // Q-card / complete: pure carousel translateX, no rotation.
      const tx = sv.currentSlotSV.value;
      const slideOut = -tx; // 0 at rest, W when fully out left
      const isFwdCarousel = sv.isCarouselForwardSV.value > 0.5;
      const rotation = (!isFwdCarousel && slideOut > 0.5)
        ? -(Math.min(1, slideOut / W) * SLOT_MAX_ROTATE_DEG)
        : 0;
      return { transform: [{ translateX: tx }, { rotateZ: `${rotation}deg` }], opacity: 1 };
    }
    // prev — letter pages tilt CCW as they slide in; carousel sections don't.
    const tx = sv.prevSlotSV.value;
    const slideIn = tx + W; // 0 when parked, W when fully in center
    const isBwdCarousel = sv.isCarouselBackwardSV.value > 0.5;
    const rotation = !isBwdCarousel ? (slideIn / W - 1) * SLOT_MAX_ROTATE_DEG : 0;
    return {
      transform: [{ translateX: tx }, { rotateZ: `${rotation}deg` }],
      opacity: sv.thoughtsOpenSV.value ? 0 : 1,
    };
  }, [role]);

  const shadowAnimStyle = useAnimatedStyle(() => {
    const W = sv.containerWidthSV.value || 300;
    if (role === "next") return { opacity: 1 };
    if (role === "current") {
      // 0 at rest (tilt mode), 1 always (carousel mode)
      const slideOut = -sv.currentSlotSV.value;
      const isFwdCarousel = sv.isCarouselForwardSV.value > 0.5;
      return { opacity: isFwdCarousel ? 1 : Math.min(1, Math.max(0, slideOut / W)) };
    }
    // prev — strong while sliding in (tilt), constant (carousel)
    const slideIn = sv.prevSlotSV.value + W;
    const isBwdCarousel = sv.isCarouselBackwardSV.value > 0.5;
    return { opacity: isBwdCarousel ? 1 : Math.min(1, Math.max(0, 1 - slideIn / W)) };
  }, [role]);

  return (
    <Animated.View
      style={hidden ? [slotBase, slotAnimStyle, SLOT_HIDDEN_STYLE] : [slotBase, slotAnimStyle]}
      pointerEvents={hidden ? "none" : "auto"}
    >
      {showShadow && <Animated.View style={[shadowLayer, shadowAnimStyle]} />}
      {children != null && <View style={slotContent}>{children}</View>}
    </Animated.View>
  );
}

interface PagerSlotSharedValues {
  prevSlotSV: SharedValue<number>;
  currentSlotSV: SharedValue<number>;
  nextSlotSV: SharedValue<number>;
  containerWidthSV: SharedValue<number>;
  isCarouselForwardSV: SharedValue<number>;
  isCarouselBackwardSV: SharedValue<number>;
  thoughtsOpenSV: SharedValue<number>;
}

const SLOT_HIDDEN_STYLE = { opacity: 0 } as const;
