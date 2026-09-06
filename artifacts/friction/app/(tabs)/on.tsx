// hint: Logic changed on both sides. Requires understanding intent of each change.
// hint: Logic changed on both sides. Requires understanding intent of each change.
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { QueryClientContext, useQueryClient } from "@tanstack/react-query";
import {
  getGetThoughtQuestionQueueQueryKey,
  getListArticlesQueryKey,
  getListThoughtsQueryKey,
  useAddArticleToMyCollection,
  useDeleteArticle,
  useDeleteThought,
  useGetThoughtQuestionQueue,
  useListArticles,
  useListMyCollections,
  useListThoughts,
  useActivateThoughtQuestion,
  useRefreshThoughtQuestionQueue,
  type Article,
  type MyCollection,
  type SpaceLetter,
  type Thought,
} from "@workspace/api-client-react";
import ActionSheetModal from "@/components/ActionSheetModal/ActionSheetModal";
import type { OriginLayout } from "@/components/CardSelectOverlay/CardSelectOverlay";
import { useLetterSelectionOverlay } from "@/hooks/useLetterSelectionOverlay";
import { recordArticleToViewModel } from "@/hooks/useRecordLetterCards";
import RecordRow from "@/components/RecordRow/RecordRow";
import SwipeableRow, { type SwipeableRowHandle } from "@/components/SwipeableRow/SwipeableRow";
import RecordCardMarkdownPreview from "@/components/RecordCardMarkdownPreview/RecordCardMarkdownPreview";
import AnimatedSearchBar from "@/components/AnimatedSearchBar/AnimatedSearchBar";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import { DateGroupCarousel } from "@/components/DateGroupCarousel/DateGroupCarousel";
import { PageHeader, HEADER_FADE_HEIGHT } from "@/components/NavBar/PageHeader";
import RefreshableEmpty from "@/components/RefreshableEmpty";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, ReaderTokens, Shadows, Sizing, Spacing, Typography, readerFontSize } from "@/constants/tokens";
import { useReaderTransition } from "@/contexts/ReaderTransitionContext";
import { useThoughtComposer } from "@/contexts/ThoughtComposerContext";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import { useUser } from "@/contexts/UserContext";
import { useNavigation } from "@/contexts/NavigationContext";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import {
  invalidateArticleLists,
  invalidateMyCollections,
  removeRecordFromCache,
  removeThoughtQuestionFromQueueCache,
  restoreRecordDeletion,
  restoreRecordListCaches,
  seedRecordDetailCaches,
  setThoughtQuestionQueueCache,
  snapshotRecordDeletion,
  snapshotRecordListCaches,
  upsertThoughtInRecordCaches,
} from "@/lib/queryInvalidation";
import { computeBodyLayout } from "@/lib/bodyLayout";
import {
  buildMixedRecordGroups,
  buildUnifiedRecords,
  classifyQuestionError,
  filterRecords,
  getQueuedThoughtIds,
  getQueuedThoughts,
  getQuestionUnavailableMessage,
  getRecordCardBodyLineCount,
  getRecordCardContent,
  getRecordCardTitleLineCount,
  isPendingQueueQuestionThought,
  mergeRecordSession,
  recordMatchesQuery,
  resolveQuestionPlacementAnchors,
  shouldRefetchQuestionQueue,
  shouldShowQuestionErrorToast,
  type QuestionErrorKind,
  type QuestionPlacementAnchors,
  type RecordDateGroup,
  type RecordKind,
  type RecordView,
  type UnifiedRecord,
} from "@/lib/recordList";
import type { ArticleStatus } from "@/lib/policies";
import { useScrollPressGuard } from "@/hooks/useScrollPressGuard";
import { useDateGroupVerticalSnap } from "@/hooks/useDateGroupVerticalSnap";
import { getDateGroupCarouselHeight } from "@/lib/dateGroupCarousel";
import { isListSearchBoundaryGesture } from "@/lib/dateGroupVerticalSnap";
import { useIsOnline } from "@/lib/useIsOnline";
const FILTER_BUTTON_HEIGHT = 36;
const VIEW_BUTTON_SIZE = FILTER_BUTTON_HEIGHT;
// Shared with the other tab headers so every screen's fade/overlap band feels
// the same size (see components/NavBar/PageHeader.tsx: HeaderFadeTail).
const FILTER_GRADIENT_OVERLAP = HEADER_FADE_HEIGHT;
const FILTER_BAR_HEIGHT = VIEW_BUTTON_SIZE + 32;

type CardRecord = UnifiedRecord & { isQuestion: boolean; questionIndex?: number };
const cardRecordKey = (record: CardRecord) => `${record.kind}:${record.id}`;

function getScreenForStatus(status: ArticleStatus): "/on-01a" | "/on-01b" | "/on-01c" {
  if (status === "DIVIDING") return "/on-01b";
  if (status === "CLOSING") return "/on-01c";
  return "/on-01a";
}

const NON_SELECTABLE_WEB_STYLE =
  Platform.OS === "web" ? ({ userSelect: "none" } as object) : undefined;
const Gradient = LinearGradient as unknown as React.ComponentType<any>;

function RecordListText({
  style,
  ...props
}: React.ComponentProps<typeof Text>) {
  return (
    <Text
      {...props}
      selectable={false}
      style={[NON_SELECTABLE_WEB_STYLE, style]}
    />
  );
}

function RecordKindButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <ScalePressable
      style={styles.kindButton}
      contentStyle={[styles.kindButtonContent, active && styles.kindButtonContentActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} 기록 보기`}
      accessibilityState={{ selected: active }}
    >
      <RecordListText style={[styles.kindButtonText, active && styles.kindButtonTextActive]}>
        {label}
      </RecordListText>
    </ScalePressable>
  );
}

function RecordViewButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <ScalePressable
      style={styles.viewButton}
      contentStyle={[styles.viewButtonContent, active && styles.viewButtonContentActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      <Feather name={icon} size={18} color={active ? Colors.noticeAccent : Colors.zinc600} />
    </ScalePressable>
  );
}

function RecordSourceCard({
  record,
  question = false,
  questionIndex,
  width,
  height: suppliedHeight,
  letterVisibility,
  spaceNameFallback,
  onPress,
  onLongPress,
}: {
  record: UnifiedRecord;
  question?: boolean;
  questionIndex?: number;
  width: number;
  height?: number;
  letterVisibility?: string | null;
  /** Shown as the cover label when the article has no collectionName (e.g. space-only sends). */
  spaceNameFallback?: string | null;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const content = getRecordCardContent(record);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchMovedRef = useRef(false);
  const height = suppliedHeight ?? getRecordCardHeight(record, width);
  const layout = computeBodyLayout(width);
  // Font scale remains relative to the full card width; safe-area padding only
  // constrains the text column, matching the writing and reader calculations.
  const titleSize = readerFontSize(ReaderTokens.typeScale.titleCqi, width);
  const bodySize = readerFontSize(ReaderTokens.typeScale.bodyCqi, width);
  const titleLineHeight = titleSize * ReaderTokens.lineHeight.tight;
  const bodyLineHeight = bodySize * ReaderTokens.lineHeight.relaxed;
  const titleLineCount = content.hasTitle
    ? getRecordCardTitleLineCount(
        content.title,
        titleSize,
        layout.textColumnWidth,
        question ? Number.MAX_SAFE_INTEGER : undefined,
      )
    : 0;
  const bodyLines = getRecordCardBodyLineCount({
    cardHeight: height,
    paddingY: layout.paddingY,
    titleLineCount,
    titleLineHeight,
    titleGap: content.hasTitle ? Spacing.md : 0,
    bodyLineHeight,
  });
  const textStyle = Platform.OS === "web" ? ({ whiteSpace: "pre-wrap" } as object) : undefined;

  if (record.kind === "letter") {
    return (
      <View style={NON_SELECTABLE_WEB_STYLE}>
        <ArticleCardItem
          title={record.article.title || "제목 없음"}
          authorName={record.article.authorNickname ?? undefined}
          collectionName={record.article.collectionName ?? null}
              spaceName={spaceNameFallback ?? null}
          cover={record.article.cover}
          cardWidth={width}
          carouselShadow={true}
          visibility={letterVisibility}
          onPress={onPress}
          onLongPress={onLongPress}
        />
      </View>
    );
  }

  return (
    <ScalePressable
      style={[styles.thoughtCard, { width, height }]}
      contentStyle={[styles.thoughtCardContent, NON_SELECTABLE_WEB_STYLE]}
      onPress={() => {
        if (!touchMovedRef.current) onPress();
      }}
      onTouchStart={(event) => {
        touchStartRef.current = {
          x: event.nativeEvent.locationX,
          y: event.nativeEvent.locationY,
        };
        touchMovedRef.current = false;
      }}
      onTouchMove={(event) => {
        const start = touchStartRef.current;
        if (!start) return;
        const dx = event.nativeEvent.locationX - start.x;
        const dy = event.nativeEvent.locationY - start.y;
        if (Math.hypot(dx, dy) > 8) touchMovedRef.current = true;
      }}
      onLongPress={() => {
        if (!touchMovedRef.current) onLongPress?.();
      }}
      accessibilityLabel={question
        ? `대기 중인 질문${questionIndex ? ` ${questionIndex}` : ""} 열기`
        : record.kind === "thought" ? "단상 열기" : "편집 글 열기"}
      accessibilityHint={question ? "누르면 이 질문에 답하는 단상을 시작합니다." : undefined}
    >
      <View
        style={[
          styles.thoughtCardSurface,
          {
            paddingHorizontal: layout.paddingX,
            paddingVertical: layout.paddingY,
          },
          question && styles.questionCardSurface,
        ]}
      >
        <View style={styles.thoughtCardBodyWrap}>
          {content.hasTitle ? (
            <RecordListText
              style={[
                styles.thoughtCardTitle,
                textStyle,
                {
                  fontSize: titleSize,
                  lineHeight: titleLineHeight,
                  color: question ? Colors.white : Colors.zinc900,
                },
              ]}
              numberOfLines={question ? undefined : 2}
              ellipsizeMode={question ? undefined : "tail"}
            >
              {content.title}
            </RecordListText>
          ) : null}
          {question ? (
            <RecordListText
              style={[
                styles.thoughtCardBody,
                textStyle,
                {
                  fontSize: bodySize,
                  lineHeight: bodyLineHeight,
                  letterSpacing: layout.bodyLetterSpacing,
                  marginTop: content.hasTitle ? Spacing.md : 0,
                  color: Colors.white,
                },
              ]}
              numberOfLines={bodyLines}
              ellipsizeMode="tail"
            >
              {content.body || "아직 적힌 내용이 없어요."}
            </RecordListText>
          ) : (
            <View style={{ marginTop: content.hasTitle ? Spacing.md : 0 }}>
              <RecordCardMarkdownPreview
                blocks={content.bodyBlocks}
                fallback="아직 적힌 내용이 없어요."
                fontSize={bodySize}
                lineHeight={bodyLineHeight}
                letterSpacing={layout.bodyLetterSpacing}
                maxLines={bodyLines}
              />
            </View>
          )}
        </View>
      </View>
    </ScalePressable>
  );
}
function OnScreenContent() {
  const router = useRouter();
  const { tabReselectVersion } = useNavigation();
  const queryClient = useQueryClient();
  const { startFadeToBlack } = useReaderTransition();
  const { userId } = useUser();
  const { isLoading: authIsLoading } = useAuth();
  const { showToast } = useToast();
  const isOnline = useIsOnline();
  // ── Letter overlay (shared 편지 선택 모드) ─────────────────────────────────
  // One hook replaces the previous inline CardSelectOverlay + visibility-toggle
  // confirm modal. spaceLetterByArticleId is re-used for card badges.
  const {
    isSourceHidden,
    isOverlayActive,
    selectedArticleId,
    openLetterOverlay,
    closeOverlay,
    renderLetterOverlay,
    spaceLetterByArticleId,
  } = useLetterSelectionOverlay(userId, {
    onRead: (article) => {
      startFadeToBlack(() =>
        router.push({ pathname: "/read", params: { articleId: article.id, mode: "re_read" } }),
      );
    },
  });
  const { createDirectThought, isCreatingThought } = useThoughtComposer();
  const navBottom = useNavBarBottomSafeArea();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - Spacing.screenPx * 2, Sizing.cardSlotW);
  const [kind, setKind] = useState<RecordKind>("thought");
  const [view, setView] = useState<RecordView>("card");
  const [recordResetVersion, setRecordResetVersion] = useState(tabReselectVersion.ON);
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // The filter/view menu bar stays visible at all times; the only exception
  // is while search is active (an explicit user action, not scroll/inactivity).
  const controlsVisible = !searchActive;
  const [cardMixSeed, setCardMixSeed] = useState(() => `${Date.now()}-${Math.random()}`);
  const recordSessionRef = useRef<UnifiedRecord[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<UnifiedRecord | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<ReadonlySet<string>>(() => new Set());
  const deletePendingIdsRef = useRef(new Set<string>());
  const [recordListScrollEnabled, setRecordListScrollEnabled] = useState(true);
  const openRecordRowRef = useRef<SwipeableRowHandle | null>(null);
  const recordRowRefs = useRef<Map<string, SwipeableRowHandle>>(new Map());
  const [letterActionTarget, setLetterActionTarget] = useState<UnifiedRecord | null>(null);
  const [archiveArticleId, setArchiveArticleId] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const isArchivingRef = useRef(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  // Refresh and activation mutate the same server-owned FIFO queue. Keep one
  // synchronous guard so a late response can never replace a newer snapshot.
  const questionQueueMutationPendingRef = useRef(false);
  // Suppresses duplicate failure toasts while the same error kind keeps
  // recurring across retries/refetches; a success resets it to null.
  const lastShownQuestionErrorKindRef = useRef<QuestionErrorKind | null>(null);
  const hasFocusedRecordScreenRef = useRef(false);
  const questionPlacementRef = useRef<{
    seed: string;
    anchors: QuestionPlacementAnchors;
  } | null>(null);
  const controlsAnimation = useRef(new Animated.Value(1)).current;
  const lastScrollOffsetRef = useRef(0);
  const listDragStartOffsetRef = useRef(0);
  const listPointerStartYRef = useRef<number | null>(null);
  const listPointerStartOffsetRef = useRef(0);
  const searchActiveRef = useRef(false);

  searchActiveRef.current = searchActive;

  const closeOpenRecordRow = useCallback(() => {
    openRecordRowRef.current?.close();
    openRecordRowRef.current = null;
    setRecordListScrollEnabled(true);
  }, []);

  const handleRecordSwipeOpen = useCallback((recordKey: string) => {
    const next = recordRowRefs.current.get(recordKey) ?? null;
    if (openRecordRowRef.current && openRecordRowRef.current !== next) {
      openRecordRowRef.current.close();
    }
    openRecordRowRef.current = next;
  }, []);

  const closeSearch = useCallback(() => {
    closeOpenRecordRow();
    searchActiveRef.current = false;
    setSearchActive(false);
    setSearchQuery("");
  }, [closeOpenRecordRow]);

  const openSearch = useCallback(() => {
    closeOpenRecordRow();
    searchActiveRef.current = true;
    setSearchActive(true);
  }, [closeOpenRecordRow]);

  const tryOpenListSearch = useCallback((
    startOffset: number,
    distanceY: number,
    velocityY = 0,
  ) => {
    const shouldOpen = isListSearchBoundaryGesture(
      startOffset,
      distanceY,
      Sizing.swipeThreshold,
      velocityY,
      0.5,
    );
    if (shouldOpen) openSearch();
    return shouldOpen;
  }, [openSearch]);

  useEffect(() => {
    closeOpenRecordRow();
    closeOverlay();
    lastScrollOffsetRef.current = 0;
  }, [kind, view, closeOpenRecordRow, closeOverlay]);

  useEffect(() => {
    closeOpenRecordRow();
  }, [searchQuery, closeOpenRecordRow]);

  useEffect(() => {
    Animated.timing(controlsAnimation, {
      toValue: controlsVisible ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [controlsAnimation, controlsVisible]);

  const articlesQuery = useListArticles({ authorId: userId });
  const thoughtsQuery = useListThoughts();
  const questionQuery = useGetThoughtQuestionQueue({
    query: {
      queryKey: getGetThoughtQuestionQueueQueryKey(),
      // Wait for auth restore to complete before firing so the request always
      // has a valid bearer token in memory. On native, SecureStore restore can
      // lag several seconds; firing without a token causes a 401 whose internal
      // retry races the same timeout budget. React Query re-enables
      // automatically when authIsLoading goes false → triggers the initial fetch.
      enabled: Boolean(userId) && !authIsLoading,
      retry: 2,
      refetchOnMount: "always",
    },
    // Give the question-queue endpoint a longer window than the global 15 s
    // default. Generation can take a few seconds server-side on first visit,
    // and the 401-refresh retry now gets its own fresh timeout budget.
    request: { timeoutMs: 30_000 },
  });
  const questionQueryStateRef = useRef({
    isLoading: questionQuery.isLoading,
    isFetching: questionQuery.isFetching,
    refetch: questionQuery.refetch,
  });
  questionQueryStateRef.current = {
    isLoading: questionQuery.isLoading,
    isFetching: questionQuery.isFetching,
    refetch: questionQuery.refetch,
  };
  const collectionsQuery = useListMyCollections({ ownerId: userId });
  const deleteArticle = useDeleteArticle();
  const deleteThought = useDeleteThought();
  const activateQuestion = useActivateThoughtQuestion();
  const refreshQuestion = useRefreshThoughtQuestionQueue();
  const addToCollection = useAddArticleToMyCollection();

  useEffect(() => {
    setKind("thought");
    setView("card");
    setRecordResetVersion(tabReselectVersion.ON);
    closeSearch();
    if (shouldRefetchQuestionQueue({
      userId,
      authIsLoading,
      isLoading: questionQuery.isLoading,
      isFetching: questionQuery.isFetching,
      mutationPending: questionQueueMutationPendingRef.current,
    })) {
      void questionQuery.refetch();
    }
  }, [tabReselectVersion.ON]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(
    useCallback(() => {
      // Tab screens stay mounted. Focus is both a placement-session boundary
      // and a recovery path for a queue request that failed while auth loaded.
      if (hasFocusedRecordScreenRef.current) {
        recordSessionRef.current = [];
        setCardMixSeed(`${Date.now()}-${Math.random()}`);
        const queryState = questionQueryStateRef.current;
        if (shouldRefetchQuestionQueue({
          userId,
          authIsLoading,
          isLoading: queryState.isLoading,
          isFetching: queryState.isFetching,
          mutationPending: questionQueueMutationPendingRef.current,
        })) {
          void queryState.refetch();
        }
      } else {
        hasFocusedRecordScreenRef.current = true;
      }
    }, [userId]),
  );

  useFocusEffect(
    useCallback(() => {
      closeSearch();
      return () => {
        setSearchActive(false);
        setSearchQuery("");
      };
    }, [closeSearch]),
  );

  useEffect(() => {
    // A fresh success clears the suppression so a later failure — even the
    // same kind — is allowed to toast again.
    if (questionQuery.isSuccess) {
      lastShownQuestionErrorKindRef.current = null;
      return;
    }
    if (!questionQuery.isError) return;
    // Auth restore is still in progress — this error is transient. Suppress
    // the toast so the user does not see a false alarm; the query will
    // automatically re-fire once authIsLoading becomes false.
    if (authIsLoading) return;
    // The question queue is supplemental to the record feed. If primary
    // records are already available, keep the feed usable without repeatedly
    // interrupting the user for a secondary request failure.
    if ((articlesQuery.data?.length ?? 0) + (thoughtsQuery.data?.length ?? 0) > 0) return;
    const errorKind = classifyQuestionError(questionQuery.error);
    if (!shouldShowQuestionErrorToast(errorKind, lastShownQuestionErrorKindRef.current)) return;
    lastShownQuestionErrorKindRef.current = errorKind;
    showToast({ message: getQuestionUnavailableMessage(errorKind), type: "error" });
  }, [
    articlesQuery.data,
    thoughtsQuery.data,
    questionQuery.errorUpdatedAt,
    questionQuery.isError,
    questionQuery.isSuccess,
    authIsLoading,
    showToast,
  ]);

  useEffect(() => {
    seedRecordDetailCaches(queryClient, {
      articles: articlesQuery.data,
      thoughts: thoughtsQuery.data,
    });
  }, [articlesQuery.data, queryClient, thoughtsQuery.data]);


  const queuedThoughts = useMemo(
    () => getQueuedThoughts(
      questionQuery.data?.queue,
      questionQuery.data?.current,
      questionQuery.data?.next,
    ),
    [questionQuery.data?.current, questionQuery.data?.next, questionQuery.data?.queue],
  );
  const queuedIds = useMemo(
    () => new Set(queuedThoughts.map((thought) => thought.id)),
    [queuedThoughts],
  );
  const listedThoughts = (thoughtsQuery.data ?? []) as Thought[];
  const allRecords = useMemo(
    () => {
      const incoming = buildUnifiedRecords(
        // The queue ID set only exists after a successful queue fetch; a
        // still-queued question must stay hidden from the ordinary list even
        // when that fetch fails, so isPendingQueueQuestionThought is checked
        // independently rather than relying solely on queuedIds.
        listedThoughts.filter((thought: Thought) =>
          !queuedIds.has(thought.id) && !isPendingQueueQuestionThought(thought)),
        articlesQuery.data,
      );
      const merged = mergeRecordSession(recordSessionRef.current, incoming);
      recordSessionRef.current = merged;
      return filterRecords(
        merged,
      kind,
      ).filter((record) => !pendingDeleteIds.has(record.id));
    },
    [articlesQuery.data, cardMixSeed, kind, listedThoughts, pendingDeleteIds, queuedIds],
  );
  const records = useMemo(
    () => allRecords.filter((record) => recordMatchesQuery(record, searchQuery)),
    [allRecords, searchQuery],
  );
  const queuedQuestionRecords = useMemo<CardRecord[]>(
    () => kind === "thought"
      ? queuedThoughts.map((thought, index) => ({
          id: thought.id,
          kind: "thought" as const,
          updatedAt: thought.updatedAt,
          thought,
          isQuestion: true,
          questionIndex: index + 1,
        }))
      : [],
    [kind, queuedThoughts],
  );
  const cardRecords = useMemo<CardRecord[]>(
    () => records.map((record) => ({ ...record, isQuestion: false })),
    [records],
  );
  const allCardRecords = useMemo<CardRecord[]>(
    () => allRecords.map((record) => ({ ...record, isQuestion: false })),
    [allRecords],
  );
  const questionPlacementAnchors = useMemo(() => {
    const previousAnchors = questionPlacementRef.current?.seed === cardMixSeed
      ? questionPlacementRef.current.anchors
      : undefined;
    const anchors = resolveQuestionPlacementAnchors(
      allCardRecords,
      queuedQuestionRecords,
      cardMixSeed,
      previousAnchors,
    );
    questionPlacementRef.current = { seed: cardMixSeed, anchors };
    return anchors;
  }, [allCardRecords, cardMixSeed, queuedQuestionRecords]);
  const visibleRecords = useMemo<CardRecord[]>(
    () => kind === "thought" && view !== "card" && queuedThoughts[0]
      ? [{
          id: queuedThoughts[0].id,
          kind: "thought" as const,
          updatedAt: queuedThoughts[0].updatedAt,
          thought: queuedThoughts[0],
          isQuestion: true,
        }, ...records.map((record) => ({ ...record, isQuestion: false }))]
      : records.map((record) => ({ ...record, isQuestion: false })),
    [kind, queuedThoughts, records, view],
  );
  const cardGroups = useMemo(
    () => buildMixedRecordGroups(
      cardRecords,
      queuedQuestionRecords,
      cardMixSeed,
      questionPlacementAnchors,
      { preserveRecordOrder: true },
    ),
    [cardMixSeed, cardRecords, questionPlacementAnchors, queuedQuestionRecords],
  );
  const scrollPressGuard = useScrollPressGuard();
  const recordListRef = useRef<FlatList<RecordDateGroup<CardRecord>>>(null);
  const cardGroupKeys = useMemo(
    () => cardGroups.map((group) => group.dateKey),
    [cardGroups],
  );
  const cardGroupSignature = useMemo(
    () => cardGroups
      .map((group) => `${group.dateKey}:${group.records.map((record) => record.id).join(",")}`)
      .join("|"),
    [cardGroups],
  );
  const estimatedGroupHeight = useMemo(
    () => getDateGroupCarouselHeight(
      cardWidth * Sizing.cardRatio,
      0,
      Sizing.dateHeaderH
        + Sizing.carouselShadowInsetTop
        + Sizing.carouselShadowInsetBottom
        + Sizing.dotsH
        + Spacing.carouselGroupBottom,
    ),
    [cardWidth],
  );
  const verticalDateSnap = useDateGroupVerticalSnap({
    groupKeys: cardGroupKeys,
    groupSignature: cardGroupSignature,
    listRef: recordListRef,
    enabled: view === "card",
    resetKey: recordResetVersion,
    estimatedGroupHeight,
    onPageGestureStart: scrollPressGuard.onScroll,
    onSearchBoundaryGesture: openSearch,
  });
  const handleRecordScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      verticalDateSnap.onScroll(event);
      scrollPressGuard.onScroll();
      // Offset tracking still feeds the search-boundary gesture below; the
      // filter/view menu bar itself no longer hides on scroll.
      lastScrollOffsetRef.current = Math.max(0, event.nativeEvent.contentOffset.y);
    },
    [scrollPressGuard, verticalDateSnap.onScroll],
  );
  const sortedCollections = useMemo(() => [...((collectionsQuery.data ?? []) as MyCollection[])]
    .filter((collection) => !collection.isArchive)
    .sort((a, b) => Number(Boolean(b.isImpression)) - Number(Boolean(a.isImpression)) || (b.articleCount ?? 0) - (a.articleCount ?? 0)), [collectionsQuery.data]);
  const refreshAll = useCallback(async (replaceQuestion = false) => {
    if (replaceQuestion) {
      if (questionQueueMutationPendingRef.current) return;
      questionQueueMutationPendingRef.current = true;
      const cacheSnapshot = snapshotRecordListCaches(queryClient);
      try {
        const currentQuestion = questionQuery.data?.current;
        if (!currentQuestion) {
          await questionQuery.refetch();
          setCardMixSeed(`${Date.now()}-${Math.random()}`);
          return;
        }
        await queryClient.cancelQueries({ queryKey: getGetThoughtQuestionQueueQueryKey() });
        const result = await refreshQuestion.mutateAsync({
          data: { currentThoughtId: currentQuestion.id },
        });
        setThoughtQuestionQueueCache(queryClient, result);
        setCardMixSeed(`${Date.now()}-${Math.random()}`);
      } catch {
        restoreRecordListCaches(queryClient, cacheSnapshot);
        showToast({ message: "질문을 바꾸지 못했습니다. 다시 시도해주세요.", type: "error" });
      } finally {
        questionQueueMutationPendingRef.current = false;
      }
      return;
    }

    try {
      await Promise.all([articlesQuery.refetch(), thoughtsQuery.refetch(), questionQuery.refetch()]);
      setCardMixSeed(`${Date.now()}-${Math.random()}`);
    } catch {
      showToast({ message: "기록을 불러오지 못했습니다.", type: "error" });
    }
  }, [articlesQuery, queryClient, questionQuery, refreshQuestion, showToast, thoughtsQuery]);

  const handleRefresh = useCallback(async () => {
    if (isManualRefreshing) return;
    // Offline: a refetch would just sit paused with no visible feedback —
    // tell the user why instead of spinning the RefreshControl indefinitely
    // (same pattern as the 마이 탭's handleManualRefresh).
    if (!isOnline) {
      showToast({ message: "오프라인 상태예요. 네트워크 연결 후 다시 시도해주세요.", type: "info" });
      return;
    }
    setIsManualRefreshing(true);
    try {
      await refreshAll(kind === "thought");
    } finally {
      setIsManualRefreshing(false);
    }
  }, [isManualRefreshing, isOnline, kind, refreshAll, showToast]);

  const openRecord = useCallback((record: UnifiedRecord) => {
    if (record.kind === "thought") {
      router.push({
        pathname: "/on-01a",
        params: { id: record.thought.id, editorContext: "record" },
      });
    } else if (record.kind === "editing") {
      router.push({ pathname: getScreenForStatus(record.article.status as ArticleStatus), params: { id: record.article.id } });
    } else {
      startFadeToBlack(() => router.push({ pathname: "/read", params: { articleId: record.article.id, mode: "re_read" } }));
    }
  }, [router, startFadeToBlack]);

  const requestRecordDeletion = useCallback((record: UnifiedRecord) => {
    closeOpenRecordRow();
    if (!deletePendingIdsRef.current.has(record.id)) setDeleteTarget(record);
  }, [closeOpenRecordRow]);

  const openQuestion = useCallback(async (thought: Thought) => {
    if (activateQuestion.isPending || questionQueueMutationPendingRef.current) return;
    questionQueueMutationPendingRef.current = true;
    const cacheSnapshot = snapshotRecordListCaches(queryClient);
    try {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: getListThoughtsQueryKey() }),
        queryClient.cancelQueries({ queryKey: getGetThoughtQuestionQueueQueryKey() }),
      ]);
      const result = await activateQuestion.mutateAsync({ id: thought.id });
      setThoughtQuestionQueueCache(queryClient, result);
      upsertThoughtInRecordCaches(queryClient, result.activatedThought);
      router.push({ pathname: "/on-01a", params: { id: result.activatedThought.id } });
    } catch {
      restoreRecordListCaches(queryClient, cacheSnapshot);
      showToast({ message: "질문을 시작하지 못했습니다. 다시 시도해주세요.", type: "error" });
    } finally {
      questionQueueMutationPendingRef.current = false;
    }
  }, [activateQuestion, queryClient, router, showToast]);

  const confirmDelete = useCallback(() => {
    const target = deleteTarget;
    if (!target) return;
    const isQueuedQuestion = target.kind === "thought" && queuedIds.has(target.id);
    if (isQueuedQuestion && questionQueueMutationPendingRef.current) {
      setDeleteTarget(null);
      return;
    }
    if (deletePendingIdsRef.current.has(target.id)) {
      setDeleteTarget(null);
      return;
    }
    if (isQueuedQuestion) questionQueueMutationPendingRef.current = true;
    deletePendingIdsRef.current.add(target.id);
    setPendingDeleteIds(new Set(deletePendingIdsRef.current));
    setDeleteTarget(null);

    void (async () => {
      try {
        const rollback = snapshotRecordDeletion(queryClient, target);
        const questionQueueRollback = isQueuedQuestion
          ? queryClient.getQueryData(getGetThoughtQuestionQueueQueryKey())
          : undefined;
        const cancellation = Promise.allSettled([
          queryClient.cancelQueries({ queryKey: getListThoughtsQueryKey() }),
          queryClient.cancelQueries({ queryKey: getListArticlesQueryKey() }),
          ...(isQueuedQuestion
            ? [queryClient.cancelQueries({ queryKey: getGetThoughtQuestionQueueQueryKey() })]
            : []),
        ]);
        removeRecordFromCache(queryClient, target);
        if (isQueuedQuestion) {
          removeThoughtQuestionFromQueueCache(queryClient, target.id);
        }
        // Cancelling older reads protects the optimistic snapshot, but waiting
        // for cancellation must not delay removing the confirmed target.
        await cancellation;
        try {
          if (target.kind === "thought") await deleteThought.mutateAsync({ id: target.thought.id });
          else await deleteArticle.mutateAsync({ id: target.article.id });
        } catch {
          restoreRecordDeletion(queryClient, rollback, deletePendingIdsRef.current);
          if (isQueuedQuestion) {
            queryClient.setQueryData(
              getGetThoughtQuestionQueueQueryKey(),
              questionQueueRollback,
            );
          }
          void (target.kind === "thought"
            ? queryClient.invalidateQueries({ queryKey: getListThoughtsQueryKey() })
            : invalidateArticleLists(queryClient)).catch(() => {});
          showToast({ message: "삭제에 실패했습니다. 다시 시도해주세요.", type: "error" });
          return;
        }
        try {
          if (target.kind === "thought") {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: getListThoughtsQueryKey() }),
              ...(isQueuedQuestion
                ? [queryClient.invalidateQueries({ queryKey: getGetThoughtQuestionQueueQueryKey() })]
                : []),
            ]);
          } else {
            await invalidateArticleLists(queryClient);
          }
        } catch {
          // The query remains stale and can retry on focus; the server delete already succeeded.
        }
        showToast({ message: "삭제했어요.", type: "success" });
      } finally {
        if (isQueuedQuestion) questionQueueMutationPendingRef.current = false;
        deletePendingIdsRef.current.delete(target.id);
        setPendingDeleteIds(new Set(deletePendingIdsRef.current));
      }
    })();
  }, [deleteArticle, deleteTarget, deleteThought, queryClient, queuedIds, showToast]);

  const archiveArticle = useCallback(async () => {
    if (!archiveArticleId || !selectedCollectionId || isArchivingRef.current) return;
    isArchivingRef.current = true;
    setIsArchiving(true);
    try {
      await addToCollection.mutateAsync({ id: selectedCollectionId, data: { articleId: archiveArticleId } });
      invalidateMyCollections(queryClient);
      invalidateArticleLists(queryClient);
      const collectionName = sortedCollections.find((collection) => collection.id === selectedCollectionId)?.name ?? "모음";
      setArchiveArticleId(null);
      setSelectedCollectionId(null);
      showToast({
        message: "보관했어요.",
        type: "success",
        duration: 4000,
        action: {
          label: "모음 보기",
          onPress: () => router.push({ pathname: "/of-01-detail", params: { id: selectedCollectionId, name: collectionName } }),
        },
      });
    } catch {
      showToast({ message: "보관에 실패했습니다.", type: "error" });
    } finally {
      isArchivingRef.current = false;
      setIsArchiving(false);
    }
  }, [addToCollection, archiveArticleId, queryClient, router, selectedCollectionId, showToast, sortedCollections]);


  // Question queue is a supplemental query (records already tolerate it
  // failing/being slow — see questionLoadFailed/emptyTitle below), so it is
  // deliberately excluded from the full-screen loading gate: a slow or
  // still-generating queue must never keep the whole record feed spinning
  // once the primary 단상/편지 lists are in.
  const isLoading =
    (articlesQuery.isLoading && !articlesQuery.data) ||
    (thoughtsQuery.isLoading && !thoughtsQuery.data);
  // Offline with nothing ever cached for the primary lists (e.g. very first
  // launch offline) — say so explicitly instead of falling through to the
  // ordinary "아직 없어요" empty copy, which reads as a permanent empty result.
  const isOfflineWithoutCache =
    !isOnline && (articlesQuery.isPending || thoughtsQuery.isPending);
  const questionLoadFailed =
    kind === "thought" &&
    questionQuery.isError &&
    // Auth restore is still in progress — the error is a pre-auth transient
    // failure, not a real one. Keep the error state hidden so the user sees
    // loading instead of an error message they cannot act on.
    !authIsLoading &&
    queuedThoughts.length === 0;
  const questionErrorKind = questionLoadFailed
    ? classifyQuestionError(questionQuery.error)
    : null;
  // Shares the exact same copy the failure toast uses (getQuestionUnavailableMessage)
  // so the empty state and the toast can never disagree about the same cause.
  const emptyTitle = questionLoadFailed && questionErrorKind
    ? getQuestionUnavailableMessage(questionErrorKind)
    : kind === "thought" ? "첫 단상을 남겨보세요" : kind === "editing" ? "편집 중인 글이 없어요" : "아직 내보낸 편지가 없어요";

  const renderRecordCard = useCallback((
    record: CardRecord,
    shouldIgnorePress: () => boolean,
    measureOrigin: (cb: (layout: OriginLayout) => void) => void,
    cardHeight: number,
  ) => {
    const letterSpaceLetter = record.kind === "letter" ? spaceLetterByArticleId.get(record.article.id) : undefined;
    // Convert raw API response → LetterCardViewModel so card props and overlay
    // meta use separated spaceName / collectionName fields consistently.
    const letterViewModel = record.kind === "letter"
      ? recordArticleToViewModel(record.article, letterSpaceLetter ?? null)
      : null;
    const letterVisibility = letterViewModel?.visibility ?? undefined;
    return (
      <View style={[styles.recordCardFrame, record.kind === "letter" && isSourceHidden(record.article.id) && styles.recordCardHidden]}>
        {record.kind === "thought" ? (
          <RecordSourceCard
            record={record}
            question={record.isQuestion}
            questionIndex={record.questionIndex}
            width={cardWidth}
            height={cardHeight}
            onPress={() => {
              if (!shouldIgnorePress()) {
                record.isQuestion ? openQuestion(record.thought) : openRecord(record);
              }
            }}
            onLongPress={() => {
              if (!shouldIgnorePress()) {
                requestRecordDeletion(record);
              }
            }}
          />
        ) : (
          <RecordSourceCard
            record={record}
            width={cardWidth}
            height={cardHeight}
            letterVisibility={letterVisibility}
            spaceNameFallback={letterViewModel?.spaceName ?? null}
            onPress={() => {
              if (!shouldIgnorePress()) {
                if (record.kind === "letter") {
                  measureOrigin((layout) => {
                    openLetterOverlay(record.article, {
                      fallbackOrigin: layout,
                      meta: {
                        // Overlay header shows spaceName for space letters; falls
                        // back to collectionName (personal folder) otherwise.
                        collectionName: letterViewModel?.spaceName ?? letterViewModel?.collectionName ?? null,
                        collectionId: letterViewModel?.collectionId ?? null,
                        spaceId: letterViewModel?.spaceId ?? null,
                        date: letterViewModel?.date ?? null,
                        authorName: letterViewModel?.authorName ?? null,
                        authorId: letterViewModel?.authorId ?? null,
                      },
                    });
                  });
                } else {
                  openRecord(record);
                }
              }
            }}
            onLongPress={() => {
              if (!shouldIgnorePress()) {
                if (record.kind === "letter") {
                  setLetterActionTarget(record);
                } else {
                  requestRecordDeletion(record);
                }
              }
            }}
          />
        )}
      </View>
    );
  }, [
    cardWidth, openQuestion, openRecord, requestRecordDeletion,
    isSourceHidden, openLetterOverlay, spaceLetterByArticleId,
  ]);

  return (
    <View style={styles.container}>
      <PageHeader
        title="기록함"
        centeredBrandTitle
      />
      <AnimatedSearchBar
        active={searchActive}
        value={searchQuery}
        onChangeText={setSearchQuery}
        onDismiss={closeSearch}
        placeholder="제목과 내용으로 검색"
        backgroundColor={Colors.recordSearchBarBg}
        removeFocusOutline
      />
      <View style={styles.filtersAnimated}>
        <Gradient
          colors={["rgba(255,255,255,1)", "rgba(255,255,255,0)"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.filters}
          pointerEvents="box-none"
        >
          <Animated.View
            pointerEvents={controlsVisible && !searchActive ? "box-none" : "none"}
            style={[styles.filterControls, { opacity: controlsAnimation }]}
          >
            <View style={styles.kindFilterGroup}>
              <RecordKindButton label="단상" active={kind === "thought"} onPress={() => setKind("thought")} />
              <RecordKindButton label="편집" active={kind === "editing"} onPress={() => setKind("editing")} />
              <RecordKindButton label="편지" active={kind === "letter"} onPress={() => setKind("letter")} />
            </View>
            <View style={styles.viewFilterGroup}>
              <RecordViewButton
                icon="list"
                label="목록형으로 보기"
                active={view === "content"}
                onPress={() => setView("content")}
              />
              <RecordViewButton
                icon="layers"
                label="하나씩 보기"
                active={view === "card"}
                onPress={() => setView("card")}
              />
            </View>
          </Animated.View>
        </Gradient>
      </View>

      {isLoading ? (
        <View style={styles.center}><RecordListText style={styles.muted}>불러오는 중...</RecordListText></View>
      ) : isOfflineWithoutCache ? (
        <RefreshableEmpty refreshing={isManualRefreshing} onRefresh={handleRefresh} contentContainerStyle={[styles.center, { paddingBottom: navBottom }]}>
          <Feather name="wifi-off" size={22} color={Colors.zinc400} />
          <RecordListText style={styles.emptyTitle}>오프라인 상태예요</RecordListText>
          <RecordListText style={styles.muted}>네트워크에 연결하면 데이터를 불러올 수 있어요</RecordListText>
        </RefreshableEmpty>
      ) : view === "card" && cardGroups.length > 0 ? (
        <View
          style={styles.recordListViewport}
          onLayout={verticalDateSnap.onLayout}
          {...verticalDateSnap.panHandlers}
          {...({ onWheel: verticalDateSnap.onWheel } as object)}
        >
          <FlatList
            ref={recordListRef}
            data={cardGroups}
            extraData={`${recordResetVersion}:${selectedArticleId ?? ""}:${spaceLetterByArticleId.size}`}
            nestedScrollEnabled
            keyExtractor={(group) => group.dateKey}
            renderItem={({ item, index }) => {
              const cardHeight = getRecordGroupCardHeight(item.records, cardWidth);
              return (
                <View style={NON_SELECTABLE_WEB_STYLE}>
                  <DateGroupCarousel
                    dateLabel={item.label}
                    countLabel={`${item.records.length}개`}
                    items={item.records}
                    itemKey={cardRecordKey}
                    cardWidth={cardWidth}
                    cardHeight={cardHeight}
                    resetKey={index === 0 ? `${cardMixSeed}:${recordResetVersion}${queuedQuestionRecords.length > 0 ? ":q" : ""}` : cardMixSeed}
                    renderCard={(record, context) => renderRecordCard(record, context.shouldIgnorePress, context.measureOrigin, cardHeight)}
                    shouldIgnoreVerticalPress={scrollPressGuard.shouldIgnoreVerticalPress}
                  />
                </View>
              );
            }}
            refreshControl={<RefreshControl refreshing={isManualRefreshing} onRefresh={handleRefresh} />}
            onScroll={handleRecordScroll}
            onScrollBeginDrag={verticalDateSnap.onScrollBeginDrag}
            onScrollEndDrag={verticalDateSnap.onScrollEndDrag}
            scrollEventThrottle={16}
            snapToInterval={estimatedGroupHeight}
            snapToAlignment="start"
            decelerationRate="fast"
            contentContainerStyle={[styles.recordGroupList, { paddingBottom: navBottom }]}
            showsVerticalScrollIndicator={false}
            scrollEnabled={Platform.OS !== "web"}
          />
        </View>
      ) : visibleRecords.length > 0 ? (
        <View
          style={styles.recordListViewport}
          {...(Platform.OS === "web" ? {
            onPointerDown: (event: { nativeEvent?: { clientY?: number } }) => {
              listPointerStartYRef.current = event.nativeEvent?.clientY ?? null;
              listPointerStartOffsetRef.current = lastScrollOffsetRef.current;
            },
            onPointerUp: (event: { nativeEvent?: { clientY?: number } }) => {
              const startY = listPointerStartYRef.current;
              listPointerStartYRef.current = null;
              const endY = event.nativeEvent?.clientY;
              if (startY !== null && endY !== undefined) {
                tryOpenListSearch(listPointerStartOffsetRef.current, endY - startY);
              }
            },
            onPointerCancel: () => {
              listPointerStartYRef.current = null;
            },
            onWheel: (event: { deltaY?: number }) => {
              tryOpenListSearch(lastScrollOffsetRef.current, -(event.deltaY ?? 0));
            },
          } : {})}
        >
          <FlatList
            data={visibleRecords}
            keyExtractor={(record) => `${record.kind}-${record.id}`}
            renderItem={({ item }) => {
              const isCurrentQuestion = item.kind === "thought" && item.isQuestion;
              const row = (
                <RecordRow
                  record={item}
                  isQuestion={isCurrentQuestion}
                  onPress={() => isCurrentQuestion ? openQuestion(item.thought) : openRecord(item)}
                  onLongPress={() => {
                    if (scrollPressGuard.shouldIgnoreVerticalPress()) return;
                    if (isCurrentQuestion) {
                      requestRecordDeletion(item);
                      return;
                    }
                    if (item.kind === "letter") setLetterActionTarget(item);
                    else requestRecordDeletion(item);
                  }}
                />
              );
              if (isCurrentQuestion) return row;
              const recordKey = `${item.kind}-${item.id}`;
              const deletePending = deletePendingIdsRef.current.has(item.id);
              return (
                <SwipeableRow
                  ref={(handle) => {
                    if (handle) recordRowRefs.current.set(recordKey, handle);
                    else recordRowRefs.current.delete(recordKey);
                  }}
                  actions={[{
                    label: deletePending ? "삭제 중" : "삭제",
                    color: Colors.primaryAction,
                    disabled: deletePending,
                    busy: deletePending,
                    onPress: () => requestRecordDeletion(item),
                  }]}
                  onSwipeOpen={() => handleRecordSwipeOpen(recordKey)}
                  onScrollLock={(locked) => setRecordListScrollEnabled(!locked)}
                  actionRightInset={Spacing.screenPx}
                  actionBottomInset={Spacing.cardGap}
                >
                  {row}
                </SwipeableRow>
              );
            }}
            refreshControl={<RefreshControl refreshing={isManualRefreshing} onRefresh={handleRefresh} />}
            onScroll={handleRecordScroll}
            onScrollBeginDrag={(event) => {
              closeOpenRecordRow();
              listDragStartOffsetRef.current = Math.max(0, event.nativeEvent.contentOffset.y);
            }}
            onScrollEndDrag={(event) => {
              const endOffset = Math.max(0, event.nativeEvent.contentOffset.y);
              const upwardDistance = endOffset - listDragStartOffsetRef.current;
              tryOpenListSearch(
                listDragStartOffsetRef.current,
                -upwardDistance,
                -(event.nativeEvent.velocity?.y ?? 0),
              );
            }}
            scrollEventThrottle={16}
            scrollEnabled={recordListScrollEnabled}
            contentContainerStyle={{ paddingBottom: navBottom + 16 }}
          />
        </View>
      ) : (
        <RefreshableEmpty refreshing={isManualRefreshing} onRefresh={handleRefresh} contentContainerStyle={[styles.center, { paddingBottom: navBottom }]}>
          <Feather name={kind === "letter" ? "mail" : "edit-3"} size={40} color={Colors.zinc300} />
          <RecordListText style={styles.emptyTitle}>{searchQuery.trim() ? "검색 결과가 없습니다" : emptyTitle}</RecordListText>
          {!searchQuery.trim() && kind === "thought" && !questionLoadFailed ? (
            <ScalePressable
              style={styles.createButton}
              contentStyle={styles.createButtonContent}
              onPress={createDirectThought}
              disabled={isCreatingThought}
              accessibilityRole="button"
              accessibilityLabel="단상 쓰기"
              accessibilityState={{ disabled: isCreatingThought, busy: isCreatingThought }}
            >
              <RecordListText style={styles.createButtonText}>단상 쓰기</RecordListText>
            </ScalePressable>
          ) : null}
        </RefreshableEmpty>
      )}

      {renderLetterOverlay()}
      <ActionSheetModal
        visible={Boolean(letterActionTarget)}
        actions={[
          {
            label: "보내기",
            style: "default",
            onPress: () => {
              if (letterActionTarget?.kind === "letter") {
                router.push({ pathname: "/to-send", params: { prefillArticleId: letterActionTarget.article.id } });
              }
            },
          },
          {
            label: "보관",
            style: "default",
            onPress: () => {
              if (letterActionTarget?.kind === "letter") {
                setArchiveArticleId(letterActionTarget.article.id);
                setSelectedCollectionId(null);
              }
            },
          },
          {
            label: "삭제",
            style: "destructive",
            onPress: () => {
              if (letterActionTarget) setDeleteTarget(letterActionTarget);
            },
          },
          { label: "취소", style: "cancel", onPress: () => {} },
        ]}
        onClose={() => setLetterActionTarget(null)}
      />
      <ConfirmModal
        visible={Boolean(deleteTarget)}
        title="삭제하시겠습니까?"
        description={deleteTarget?.kind === "thought" && queuedIds.has(deleteTarget.id)
          ? "이 질문이 영구적으로 삭제됩니다."
          : deleteTarget?.kind === "thought"
            ? "이 단상은 영구적으로 삭제됩니다."
            : "이 글은 영구적으로 삭제됩니다."}
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        destructiveFilled
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <BottomSheet visible={Boolean(archiveArticleId)} onClose={() => { setArchiveArticleId(null); setSelectedCollectionId(null); }} snapPoints={[0.6]} enableDragDown dismissable>
        <View style={styles.archive}>
          <RecordListText style={styles.archiveTitle}>보관할 모음 선택</RecordListText>
          <FlatList
            data={sortedCollections}
            keyExtractor={(collection) => collection.id}
            renderItem={({ item }) => <ScalePressable style={styles.collectionRow} contentStyle={[styles.collectionRowContent, selectedCollectionId === item.id && styles.collectionSelected]} onPress={() => setSelectedCollectionId(item.id)}><RecordListText style={styles.collectionName}>{item.name}</RecordListText>{selectedCollectionId === item.id ? <Feather name="check" size={16} color={Colors.zinc900} /> : null}</ScalePressable>}
            ListEmptyComponent={<RecordListText style={styles.muted}>보관할 모음이 없어요</RecordListText>}
          />
          <ScalePressable
            style={styles.archiveButton}
            contentStyle={[styles.archiveButtonContent, (!selectedCollectionId || isArchiving) && styles.disabled]}
            onPress={archiveArticle}
            disabled={!selectedCollectionId || isArchiving}
            accessibilityRole="button"
            accessibilityLabel="보관하기"
            accessibilityState={{ disabled: !selectedCollectionId || isArchiving, busy: isArchiving }}
          >
            <RecordListText style={styles.createButtonText}>{isArchiving ? "보관 중..." : "보관하기"}</RecordListText>
          </ScalePressable>
        </View>
      </BottomSheet>
    </View>
  );
}

/**
 * react-native-screens can pre-render a tab during a native transition outside
 * the app-level QueryClientProvider tree. Never run generated query hooks in
 * that detached preview; the real mounted screen renders as soon as context is
 * available.
 */
export default function OnScreen() {
  const queryClient = useContext(QueryClientContext);
  if (!queryClient) return null;
  return <OnScreenContent />;
}

// hint: Logic changed on both sides. Requires understanding intent of each change.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.white },
  filtersAnimated: {
    height: FILTER_BAR_HEIGHT,
    marginBottom: -FILTER_GRADIENT_OVERLAP,
    overflow: "hidden",
    zIndex: 5,
  },
  filters: { height: FILTER_BAR_HEIGHT, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.screenPx, paddingTop: 4, paddingBottom: 28 },
  filterControls: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kindFilterGroup: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  kindButton: { height: FILTER_BUTTON_HEIGHT, alignSelf: "flex-start", flexGrow: 0, flexShrink: 0 },
  kindButtonContent: { height: FILTER_BUTTON_HEIGHT, flexGrow: 0, flexShrink: 0, paddingHorizontal: 14, borderRadius: FILTER_BUTTON_HEIGHT / 2, borderWidth: 1, borderColor: Colors.zinc200, backgroundColor: Colors.white, alignItems: "center", justifyContent: "center" },
  kindButtonContentActive: { borderColor: Colors.noticeAccent, backgroundColor: Colors.noticeAccent },
  kindButtonText: { ...Typography.bodySemiBold, fontSize: 13, lineHeight: 18, color: Colors.zinc600 },
  kindButtonTextActive: { color: Colors.white },
  viewFilterGroup: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: 8, flexGrow: 0, flexShrink: 0 },
  viewButton: { width: VIEW_BUTTON_SIZE, height: VIEW_BUTTON_SIZE, flexGrow: 0, flexShrink: 0 },
  viewButtonContent: { width: VIEW_BUTTON_SIZE, height: VIEW_BUTTON_SIZE, flexGrow: 0, flexShrink: 0, borderRadius: VIEW_BUTTON_SIZE / 2, backgroundColor: "transparent", alignItems: "center", justifyContent: "center" },
  viewButtonContentActive: { backgroundColor: "transparent" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: Spacing.screenPx },
  muted: { ...Typography.body, color: Colors.zinc500, textAlign: "center" },
  emptyTitle: { ...Typography.bodySemiBold, color: Colors.zinc900, fontSize: 17, textAlign: "center" },
  recordGroupList: {},
  recordListViewport: { flex: 1 },
  recordCardFrame: { flex: 1, alignItems: "center" },
  recordCardHidden: { opacity: 0 },
  // The animated wrapper owns elevation while the nested surface owns clipping.
  // Keeping those responsibilities separate prevents the card shadow from being clipped.
  thoughtCard: { flexGrow: 0, flexShrink: 0 },
  thoughtCardContent: { flex: 1, backgroundColor: Colors.white, borderRadius: 16, ...Shadows.carouselCard },
  thoughtCardSurface: { flex: 1, backgroundColor: Colors.white, borderRadius: 16, overflow: "hidden" },
  questionCardSurface: { backgroundColor: Colors.noticeAccent },
  thoughtCardBodyWrap: { flex: 1, justifyContent: "flex-start" },
  thoughtCardTitle: { fontFamily: ReaderTokens.fontFamily.serifBold, color: Colors.zinc900 },
  thoughtCardBody: { fontFamily: ReaderTokens.fontFamily.serif, color: Colors.zinc800 },
  createButton: { height: 48, flexGrow: 0, flexShrink: 0 },
  createButtonContent: { height: 48, flexGrow: 0, flexShrink: 0, paddingHorizontal: 20, backgroundColor: Colors.primaryAction, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  createButtonText: { ...Typography.bodySemiBold, color: Colors.white, fontSize: 15 },
  archive: { flex: 1, paddingHorizontal: Spacing.screenPx, paddingBottom: 16 },
  archiveTitle: { ...Typography.bodySemiBold, fontSize: 16, color: Colors.zinc900, textAlign: "center", paddingVertical: 12 },
  collectionRow: {},
  collectionRowContent: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, paddingHorizontal: 8, borderRadius: 8 },
  collectionSelected: { backgroundColor: Colors.zinc50 },
  collectionName: { ...Typography.body, color: Colors.zinc700 },
  archiveButton: { height: 48, flexGrow: 0, flexShrink: 0, marginTop: 12 },
  archiveButtonContent: { height: 48, flexGrow: 0, flexShrink: 0, borderRadius: 12, backgroundColor: Colors.primaryAction, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.4 },
  // Letter selection mode
  cardSelectedBorder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.zinc900,
  },
  letterActionContentDisabled: {
    opacity: 0.45,
  },
  letterActionTextDisabled: {
    color: Colors.zinc400,
  },
});

function getRecordCardHeight(_record: UnifiedRecord, width: number): number {
  const baseHeight = width * Sizing.cardRatio;
  return baseHeight;
}

function getRecordGroupCardHeight(records: readonly UnifiedRecord[], width: number): number {
  return records.length > 0 ? getRecordCardHeight(records[0], width) : width * Sizing.cardRatio;
}
