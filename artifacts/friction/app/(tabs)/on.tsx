// hint: Logic changed on both sides. Requires understanding intent of each change.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetArticleQueryKey,
  getGetThoughtQuestionQueueQueryKey,
  getListArticlesQueryKey,
  getListThoughtsQueryKey,
  getListUserSpaceLettersQueryKey,
  useAddArticleToMyCollection,
  useDeleteArticle,
  useDeleteThought,
  useGetThoughtQuestionQueue,
  useListArticles,
  useListMyCollections,
  useListThoughts,
  useListUserSpaceLetters,
  useUpdateSpaceLetterVisibility,
  useActivateThoughtQuestion,
  useRefreshThoughtQuestionQueue,
  SpaceLetterVisibility,
  type Article,
  type MyCollection,
  type SpaceLetter,
  type Thought,
} from "@workspace/api-client-react";
import ActionSheetModal from "@/components/ActionSheetModal/ActionSheetModal";
import CardSelectOverlay, { type ChainArticleMeta, type OriginLayout } from "@/components/CardSelectOverlay/CardSelectOverlay";
import AnimatedSearchBar from "@/components/AnimatedSearchBar/AnimatedSearchBar";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import { DateGroupCarousel } from "@/components/DateGroupCarousel/DateGroupCarousel";
import { PageHeader } from "@/components/NavBar/PageHeader";
import RefreshableEmpty from "@/components/RefreshableEmpty";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, ReaderTokens, Shadows, Sizing, Spacing, Typography, readerFontSize } from "@/constants/tokens";
import { useReaderTransition } from "@/contexts/ReaderTransitionContext";
import { useThoughtComposer } from "@/contexts/ThoughtComposerContext";
import { useToast } from "@/contexts/ToastContext";
import { useUser } from "@/contexts/UserContext";
import { useNavigation } from "@/contexts/NavigationContext";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import {
  invalidateArticleLists,
  invalidateMyCollections,
  removeRecordFromCache,
  restoreRecordDeletion,
  restoreRecordListCaches,
  setThoughtQuestionQueueCache,
  snapshotRecordDeletion,
  snapshotRecordListCaches,
  upsertThoughtInRecordCaches,
} from "@/lib/queryInvalidation";
import { computeBodyLayout } from "@/lib/bodyLayout";
import {
  buildMixedRecordGroups,
  buildUnifiedRecords,
  filterRecords,
  getQueuedThoughtIds,
  getQueuedThoughts,
  getRecordCardBodyLineCount,
  getRecordCardContent,
  getRecordCardTitleLineCount,
  getRecordPreview,
  recordMatchesQuery,
  resolveQuestionPlacementAnchors,
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
const FILTER_BUTTON_HEIGHT = 36;
const VIEW_BUTTON_SIZE = 40;
const FILTER_GRADIENT_HEIGHT = 64;
const FILTER_GRADIENT_OVERLAP = 20;
const FILTER_BAR_HEIGHT = 52;
const CONTROL_VISIBILITY_SCROLL_THRESHOLD = 6;

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

function relativeDate(value: string): string {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}일 전`;
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// hint: Structural and logic conflict. Both design and behavior differ.
// hint: Structural and logic conflict. Both design and behavior differ.
function RecordSourceCard({
  record,
  question = false,
  questionIndex,
  width,
  height: suppliedHeight,
  letterVisibility,
  onPress,
  onLongPress,
}: {
  record: UnifiedRecord;
  question?: boolean;
  questionIndex?: number;
  width: number;
  height?: number;
  letterVisibility?: string | null;
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
          collectionName={record.article.collectionName}
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
      contentStyle={[
        styles.thoughtCardContent,
        NON_SELECTABLE_WEB_STYLE,
        {
          paddingHorizontal: layout.paddingX,
          paddingVertical: layout.paddingY,
        },
        question && styles.questionCardContent,
      ]}
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
        <RecordListText
          style={[
            styles.thoughtCardBody,
            textStyle,
            {
              fontSize: bodySize,
              lineHeight: bodyLineHeight,
              letterSpacing: layout.bodyLetterSpacing,
              marginTop: content.hasTitle ? Spacing.md : 0,
              color: question ? Colors.white : Colors.zinc800,
            },
          ]}
          numberOfLines={bodyLines}
          ellipsizeMode="tail"
        >
          {content.body || "아직 적힌 내용이 없어요."}
        </RecordListText>
      </View>
    </ScalePressable>
  );
}
function RecordRow({
  record,
  isQuestion = false,
  onPress,
  onLongPress,
  onSend,
  onArchive,
}: {
  record: UnifiedRecord;
  isQuestion?: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onSend?: () => void;
  onArchive?: () => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const [textFrameWidth, setTextFrameWidth] = useState(0);
  const preview = getRecordPreview(record);
  const title = preview.titleDisplay || preview.body || "제목 없음";
  const showsTitle = preview.hasTitle || record.kind !== "thought";
  const bodyLines = preview.hasTitle || record.kind !== "thought" ? 3 : 5;
  const fallbackTextWidth = Math.max(1, windowWidth - Spacing.screenPx * 2);
  const contentWidth = textFrameWidth || fallbackTextWidth;
  const titleSize = readerFontSize(ReaderTokens.typeScale.titleCqi, contentWidth);
  const bodySize = readerFontSize(ReaderTokens.typeScale.bodyCqi, contentWidth);

  return (
    <ScalePressable
      style={styles.row}
      contentStyle={[styles.rowContent, isQuestion && styles.questionRowContent, NON_SELECTABLE_WEB_STYLE]}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityLabel={isQuestion ? "대기 중인 질문 열기" : `${record.kind === "thought" ? "단상" : record.kind === "editing" ? "편집 글" : "편지"} 열기`}
      accessibilityHint={isQuestion ? "누르면 이 질문에 답하는 단상을 시작합니다." : "길게 눌러 삭제"}
    >
      <View
        style={styles.rowTextFrame}
        onLayout={(event) => {
          const nextWidth = Math.round(event.nativeEvent.layout.width);
          if (nextWidth !== textFrameWidth) setTextFrameWidth(nextWidth);
        }}
      >
        {!isQuestion ? (
          <View style={[styles.rowMeta, record.kind === "thought" && styles.rowMetaThought]}>
            {record.kind !== "thought" ? (
              <RecordListText style={styles.rowKind}>{record.kind === "editing" ? "편집" : "편지"}</RecordListText>
            ) : null}
            <RecordListText style={styles.rowDate}>{relativeDate(record.updatedAt)}</RecordListText>
          </View>
        ) : null}
        {showsTitle ? (
          <RecordListText
            style={[styles.rowTitle, isQuestion && styles.questionRowText, { fontSize: titleSize, lineHeight: titleSize * 1.28 }]}
          >
            {title}
          </RecordListText>
        ) : null}
        <RecordListText
          style={[styles.rowBody, isQuestion && styles.questionRowText, { fontSize: bodySize, lineHeight: bodySize * 1.7 }]}
          numberOfLines={bodyLines}
        >
          {preview.body || "아직 적힌 내용이 없어요."}
        </RecordListText>
      </View>
      {record.kind === "letter" && onSend && onArchive ? (
        <View style={styles.rowLetterActions}>
          <ScalePressable style={styles.rowLetterAction} contentStyle={styles.rowLetterActionContent} onPress={(event) => { event.stopPropagation(); onSend(); }}>
            <Feather name="send" size={14} color={Colors.zinc600} />
            <RecordListText style={styles.rowLetterActionText}>보내기</RecordListText>
          </ScalePressable>
          <ScalePressable style={styles.rowLetterAction} contentStyle={styles.rowLetterActionContent} onPress={(event) => { event.stopPropagation(); onArchive(); }}>
            <Feather name="folder" size={14} color={Colors.zinc600} />
            <RecordListText style={styles.rowLetterActionText}>보관</RecordListText>
          </ScalePressable>
        </View>
      ) : null}
    </ScalePressable>
  );
}

// hint: Logic changed on both sides. Requires understanding intent of each change.
// hint: Logic changed on both sides. Requires understanding intent of each change.
// hint: Logic changed on both sides. Requires understanding intent of each change.
// hint: Logic changed on both sides. Requires understanding intent of each change.
// hint: Logic changed on both sides. Requires understanding intent of each change.
// hint: Logic changed on both sides. Requires understanding intent of each change.
// hint: Logic changed on both sides. Requires understanding intent of each change.
// hint: Logic changed on both sides. Requires understanding intent of each change.
// hint: Logic changed on both sides. Requires understanding intent of each change.
// hint: Logic changed on both sides. Requires understanding intent of each change.
// hint: Logic changed on both sides. Requires understanding intent of each change.
export default function OnScreen() {
  const router = useRouter();
  const { tabReselectVersion } = useNavigation();
  const queryClient = useQueryClient();
  const { startFadeToBlack } = useReaderTransition();
  const { userId } = useUser();
  const { showToast } = useToast();
  const { createDirectThought, isCreatingThought } = useThoughtComposer();
  const navBottom = useNavBarBottomSafeArea();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - Spacing.screenPx * 2, Sizing.cardSlotW);
  const [kind, setKind] = useState<RecordKind>("thought");
  const [view, setView] = useState<RecordView>("card");
  const [recordResetVersion, setRecordResetVersion] = useState(tabReselectVersion.ON);
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [controlsVisible, setControlsVisible] = useState(true);
  const [cardMixSeed, setCardMixSeed] = useState(() => `${Date.now()}-${Math.random()}`);
  const [deleteTarget, setDeleteTarget] = useState<UnifiedRecord | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<ReadonlySet<string>>(() => new Set());
  const deletePendingIdsRef = useRef(new Set<string>());
  const [letterActionTarget, setLetterActionTarget] = useState<UnifiedRecord | null>(null);
  const [archiveArticleId, setArchiveArticleId] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  // Letter overlay — opened when the user taps a letter card.
  const [overlayLetter, setOverlayLetter] = useState<Article | null>(null);
  const [overlayOriginLayout, setOverlayOriginLayout] = useState<OriginLayout | null>(null);
  const [isOverlaySourceHidden, setIsOverlaySourceHidden] = useState(false);
  // Pending visibility change waiting for user confirmation.
  const [visibilityConfirmTarget, setVisibilityConfirmTarget] = useState<{
    spaceId: string;
    spaceLetterId: string;
    newVisibility: "PUBLIC" | "RECIPIENT_ONLY";
  } | null>(null);
  const [isChangingVisibility, setIsChangingVisibility] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  // Refresh and activation mutate the same server-owned FIFO queue. Keep one
  // synchronous guard so a late response can never replace a newer snapshot.
  const questionQueueMutationPendingRef = useRef(false);
  const hasFocusedRecordScreenRef = useRef(false);
  const questionPlacementRef = useRef<{
    seed: string;
    anchors: QuestionPlacementAnchors;
  } | null>(null);
  const controlsVisibleRef = useRef(true);
  const controlsAnimation = useRef(new Animated.Value(1)).current;
  const lastScrollOffsetRef = useRef(0);

  useEffect(() => {
    setKind("thought");
    setView("card");
    setRecordResetVersion(tabReselectVersion.ON);
    if (!questionQuery.isLoading) {
      questionQuery.refetch();
    }
  }, [tabReselectVersion.ON]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setOverlayLetter(null);
    setOverlayOriginLayout(null);
    setIsOverlaySourceHidden(false);
    lastScrollOffsetRef.current = 0;
    if (!controlsVisibleRef.current) {
      controlsVisibleRef.current = true;
      setControlsVisible(true);
    }
  }, [kind, view]);

  useEffect(() => {
    Animated.timing(controlsAnimation, {
      toValue: controlsVisible ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [controlsAnimation, controlsVisible]);

  useFocusEffect(
    useCallback(() => {
      // Tab screens stay mounted. A focus transition is the screen-level
      // boundary at which a new question placement is allowed.
      if (hasFocusedRecordScreenRef.current) {
        setCardMixSeed(`${Date.now()}-${Math.random()}`);
      } else {
        hasFocusedRecordScreenRef.current = true;
      }
    }, []),
  );

  const articlesQuery = useListArticles({ authorId: userId });
  const thoughtsQuery = useListThoughts();
  const questionQuery = useGetThoughtQuestionQueue({ query: { enabled: Boolean(userId) } });
  const collectionsQuery = useListMyCollections({ ownerId: userId });
  const deleteArticle = useDeleteArticle();
  const deleteThought = useDeleteThought();
  const activateQuestion = useActivateThoughtQuestion();
  const refreshQuestion = useRefreshThoughtQuestionQueue();
  const addToCollection = useAddArticleToMyCollection();
  const spaceLettersQuery = useListUserSpaceLetters(userId ?? "", {
    query: { enabled: Boolean(userId) },
  });
  const updateVisibility = useUpdateSpaceLetterVisibility();

  useEffect(() => {
    for (const article of articlesQuery.data ?? []) {
      queryClient.setQueryData(getGetArticleQueryKey(article.id), article);
    }
  }, [articlesQuery.data, queryClient]);

  const spaceLetterByArticleId = useMemo<Map<string, SpaceLetter>>(() => {
    const map = new Map<string, SpaceLetter>();
    for (const sl of (spaceLettersQuery.data ?? []) as SpaceLetter[]) {
      if (sl.sourceArticleId) map.set(sl.sourceArticleId, sl);
    }
    return map;
  }, [spaceLettersQuery.data]);

  const queuedIds = useMemo(
    () => getQueuedThoughtIds(
      questionQuery.data?.queue,
      questionQuery.data?.current,
      questionQuery.data?.next,
    ),
    [questionQuery.data?.current, questionQuery.data?.next, questionQuery.data?.queue],
  );
  const listedThoughts = (thoughtsQuery.data ?? []) as Thought[];
  const allRecords = useMemo(
    () => filterRecords(
      buildUnifiedRecords(
        listedThoughts.filter((thought: Thought) => !queuedIds.has(thought.id)),
        articlesQuery.data,
      ),
      kind,
    ).filter((record) => !pendingDeleteIds.has(record.id)),
    [articlesQuery.data, kind, listedThoughts, pendingDeleteIds, queuedIds],
  );
  const records = useMemo(
    () => allRecords.filter((record) => recordMatchesQuery(record, searchQuery)),
    [allRecords, searchQuery],
  );
  const queuedQuestionRecords = useMemo<CardRecord[]>(
    () => kind === "thought"
      ? getQueuedThoughts(
          questionQuery.data?.queue,
          questionQuery.data?.current,
          questionQuery.data?.next,
        ).map((thought, index) => ({
          id: thought.id,
          kind: "thought" as const,
          updatedAt: thought.updatedAt,
          thought,
          isQuestion: true,
          questionIndex: index + 1,
        }))
      : [],
    [kind, questionQuery.data?.current, questionQuery.data?.next, questionQuery.data?.queue],
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
    () => kind === "thought" && view !== "card" && questionQuery.data?.current
      ? [{
          id: questionQuery.data.current.id,
          kind: "thought" as const,
          updatedAt: questionQuery.data.current.updatedAt,
          thought: questionQuery.data.current,
          isQuestion: true,
        }, ...records.map((record) => ({ ...record, isQuestion: false }))]
      : records.map((record) => ({ ...record, isQuestion: false })),
    [kind, questionQuery.data?.current, records, view],
  );
  const cardGroups = useMemo(
    () => buildMixedRecordGroups(
      cardRecords,
      queuedQuestionRecords,
      cardMixSeed,
      questionPlacementAnchors,
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
  });
  const handleRecordScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      verticalDateSnap.onScroll(event);
      scrollPressGuard.onScroll();
      const offset = Math.max(0, event.nativeEvent.contentOffset.y);
      const delta = offset - lastScrollOffsetRef.current;
      lastScrollOffsetRef.current = offset;
      if (Math.abs(delta) < CONTROL_VISIBILITY_SCROLL_THRESHOLD) return;

      const nextVisible = offset <= 0 || delta < 0;
      if (nextVisible === controlsVisibleRef.current) return;
      controlsVisibleRef.current = nextVisible;
      setControlsVisible(nextVisible);
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
    setIsManualRefreshing(true);
    try {
      await refreshAll(kind === "thought");
    } finally {
      setIsManualRefreshing(false);
    }
  }, [isManualRefreshing, kind, refreshAll]);

  const openRecord = useCallback((record: UnifiedRecord) => {
    if (record.kind === "thought") {
      router.push({ pathname: "/on-01a", params: { id: record.thought.id } });
    } else if (record.kind === "editing") {
      router.push({ pathname: getScreenForStatus(record.article.status as ArticleStatus), params: { id: record.article.id } });
    } else {
      startFadeToBlack(() => router.push({ pathname: "/read", params: { articleId: record.article.id, mode: "re_read" } }));
    }
  }, [router, startFadeToBlack]);

  const requestRecordDeletion = useCallback((record: UnifiedRecord) => {
    if (!deletePendingIdsRef.current.has(record.id)) setDeleteTarget(record);
  }, []);

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
    if (deletePendingIdsRef.current.has(target.id)) {
      setDeleteTarget(null);
      return;
    }
    deletePendingIdsRef.current.add(target.id);
    setPendingDeleteIds(new Set(deletePendingIdsRef.current));
    setDeleteTarget(null);

    void (async () => {
      try {
        const rollback = snapshotRecordDeletion(queryClient, target);
        removeRecordFromCache(queryClient, target);
        // Cancelling older reads protects the optimistic snapshot, but waiting
        // for cancellation must not delay removing the confirmed target.
        await Promise.allSettled([
          queryClient.cancelQueries({ queryKey: getListThoughtsQueryKey() }),
          queryClient.cancelQueries({ queryKey: getListArticlesQueryKey() }),
        ]);
        try {
          if (target.kind === "thought") await deleteThought.mutateAsync({ id: target.thought.id });
          else await deleteArticle.mutateAsync({ id: target.article.id });
        } catch {
          restoreRecordDeletion(queryClient, rollback, deletePendingIdsRef.current);
          void (target.kind === "thought"
            ? queryClient.invalidateQueries({ queryKey: getListThoughtsQueryKey() })
            : invalidateArticleLists(queryClient)).catch(() => {});
          showToast({ message: "삭제에 실패했습니다. 다시 시도해주세요.", type: "error" });
          return;
        }
        try {
          if (target.kind === "thought") {
            await queryClient.invalidateQueries({ queryKey: getListThoughtsQueryKey() });
          } else {
            await invalidateArticleLists(queryClient);
          }
        } catch {
          // The query remains stale and can retry on focus; the server delete already succeeded.
        }
        showToast({ message: "삭제했어요.", type: "success" });
      } finally {
        deletePendingIdsRef.current.delete(target.id);
        setPendingDeleteIds(new Set(deletePendingIdsRef.current));
      }
    })();
  }, [deleteArticle, deleteTarget, deleteThought, queryClient, showToast]);

  const archiveArticle = useCallback(async () => {
    if (!archiveArticleId || !selectedCollectionId || isArchiving) return;
    setIsArchiving(true);
    try {
      await addToCollection.mutateAsync({ id: selectedCollectionId, data: { articleId: archiveArticleId } });
      invalidateMyCollections(queryClient);
      invalidateArticleLists(queryClient);
      const collectionName = sortedCollections.find((collection) => collection.id === selectedCollectionId)?.name ?? "폴더";
      setArchiveArticleId(null);
      setSelectedCollectionId(null);
      showToast({
        message: "보관했어요.",
        type: "success",
        duration: 4000,
        action: {
          label: "폴더 보기",
          onPress: () => router.push({ pathname: "/of-01-detail", params: { id: selectedCollectionId, name: collectionName } }),
        },
      });
    } catch {
      showToast({ message: "보관에 실패했습니다.", type: "error" });
    } finally {
      setIsArchiving(false);
    }
  }, [addToCollection, archiveArticleId, isArchiving, queryClient, router, selectedCollectionId, showToast, sortedCollections]);

  const handleVisibilityToggle = useCallback((articleId: string) => {
    const sl = spaceLetterByArticleId.get(articleId);
    if (!sl) return;
    const newVisibility = sl.visibility === SpaceLetterVisibility.PUBLIC
      ? SpaceLetterVisibility.RECIPIENT_ONLY
      : SpaceLetterVisibility.PUBLIC;
    setVisibilityConfirmTarget({ spaceId: sl.spaceId, spaceLetterId: sl.id, newVisibility });
  }, [spaceLetterByArticleId]);

  const confirmVisibilityChange = useCallback(async () => {
    if (!visibilityConfirmTarget || isChangingVisibility) return;
    setIsChangingVisibility(true);
    const { spaceId, spaceLetterId, newVisibility } = visibilityConfirmTarget;
    try {
      await updateVisibility.mutateAsync({ id: spaceId, letterId: spaceLetterId, data: { visibility: newVisibility } });
      if (userId) await queryClient.invalidateQueries({ queryKey: getListUserSpaceLettersQueryKey(userId) });
      invalidateArticleLists(queryClient);
      setVisibilityConfirmTarget(null);
      showToast({
        message: newVisibility === SpaceLetterVisibility.PUBLIC
          ? "전체 공개로 변경했어요."
          : "수신자 공개로 변경했어요. 프로필 페이지에서 사라집니다.",
        type: "success",
      });
    } catch {
      showToast({ message: "변경에 실패했습니다. 다시 시도해주세요.", type: "error" });
    } finally {
      setIsChangingVisibility(false);
    }
  }, [visibilityConfirmTarget, isChangingVisibility, updateVisibility, queryClient, userId, showToast]);

  const isLoading =
    (articlesQuery.isLoading && !articlesQuery.data) ||
    (thoughtsQuery.isLoading && !thoughtsQuery.data) ||
    (questionQuery.isLoading && !questionQuery.data);
  const emptyTitle = kind === "thought" ? "첫 단상을 남겨보세요" : kind === "editing" ? "편집 중인 글이 없어요" : "아직 내보낸 편지가 없어요";
  const overlayLetterChain = useMemo<(Article | null)[]>(
    () => (overlayLetter ? [overlayLetter] : []),
    [overlayLetter],
  );
  const overlayMetaChain = useMemo<ChainArticleMeta[]>(
    () => overlayLetter ? [{
      authorName: overlayLetter.authorNickname ?? null,
      authorId: overlayLetter.authorId ?? null,
      collectionName: overlayLetter.collectionName ?? null,
      collectionId: overlayLetter.collectionId ?? null,
      date: overlayLetter.letterAt ?? overlayLetter.createdAt ?? null,
    }] : [],
    [overlayLetter],
  );
  const handleOverlayRead = useCallback((_index: number) => {
    if (!overlayLetter) return;
    const articleId = overlayLetter.id;
    setIsOverlaySourceHidden(false);
    setOverlayLetter(null);
    setOverlayOriginLayout(null);
    startFadeToBlack(() => router.push({ pathname: "/read", params: { articleId, mode: "re_read" } }));
  }, [overlayLetter, startFadeToBlack, router]);

  const renderRecordCard = useCallback((
    record: CardRecord,
    shouldIgnorePress: () => boolean,
    measureOrigin: (cb: (layout: OriginLayout) => void) => void,
    cardHeight: number,
  ) => {
    const letterSpaceLetter = record.kind === "letter" ? spaceLetterByArticleId.get(record.article.id) : undefined;
    const letterVisibility = letterSpaceLetter?.visibility ?? undefined;
    const isOverlaySource = record.kind === "letter" && record.article.id === overlayLetter?.id;
    return (
      <View style={[styles.recordCardFrame, isOverlaySource && isOverlaySourceHidden && styles.recordCardHidden]}>
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
            onLongPress={record.isQuestion ? undefined : () => {
              if (!shouldIgnorePress()) requestRecordDeletion(record);
            }}
          />
        ) : (
          <RecordSourceCard
            record={record}
            width={cardWidth}
            height={cardHeight}
            letterVisibility={letterVisibility}
            onPress={() => {
              if (!shouldIgnorePress()) {
                if (record.kind === "letter") {
                  measureOrigin((layout) => {
                    setOverlayOriginLayout(layout);
                    setOverlayLetter(record.article);
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
    overlayLetter, isOverlaySourceHidden, spaceLetterByArticleId,
  ]);

  return (
    <View style={styles.container}>
      <PageHeader
        title="기록"
        titleImage={require("@/assets/images/wordmark_maroon.png")}
        showSearch
        searchActive={searchActive}
        onSearchPress={() => {
          setSearchActive((active) => !active);
          setSearchQuery("");
        }}
        searchLast
      />
      <AnimatedSearchBar active={searchActive} value={searchQuery} onChangeText={setSearchQuery} placeholder="제목과 내용으로 검색" />
      <Animated.View
        pointerEvents={controlsVisible ? "box-none" : "none"}
        style={[
          styles.filtersAnimated,
          {
            height: controlsAnimation.interpolate({
              inputRange: [0, 1],
              outputRange: [0, FILTER_BAR_HEIGHT],
            }),
            marginBottom: controlsAnimation.interpolate({
              inputRange: [0, 1],
              outputRange: [0, -FILTER_GRADIENT_OVERLAP],
            }),
            opacity: controlsAnimation,
          },
        ]}
      >
        <Gradient
          colors={["rgba(255,255,255,1)", "rgba(255,255,255,0)"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.filterGradient}
          pointerEvents="none"
        />
        <View style={styles.filterControls} pointerEvents="box-none">
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
        </View>
      </Animated.View>

      {isLoading ? (
        <View style={styles.center}><RecordListText style={styles.muted}>불러오는 중...</RecordListText></View>
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
            extraData={`${recordResetVersion}:${overlayLetter?.id ?? ""}:${isOverlaySourceHidden ? "1" : "0"}:${spaceLetterByArticleId.size}`}
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
        <FlatList
          data={visibleRecords}
          keyExtractor={(record) => `${record.kind}-${record.id}`}
          renderItem={({ item }) => {
            const isCurrentQuestion = item.kind === "thought" && item.isQuestion;
            return (
              <RecordRow
                record={item}
                isQuestion={isCurrentQuestion}
                onPress={() => isCurrentQuestion ? openQuestion(item.thought) : openRecord(item)}
                onLongPress={() => { if (!isCurrentQuestion) requestRecordDeletion(item); }}
                onSend={item.kind === "letter" ? () => router.push({ pathname: "/to-send", params: { prefillArticleId: item.article.id } }) : undefined}
                onArchive={item.kind === "letter" ? () => { setArchiveArticleId(item.article.id); setSelectedCollectionId(null); } : undefined}
              />
            );
          }}
          refreshControl={<RefreshControl refreshing={isManualRefreshing} onRefresh={handleRefresh} />}
          onScroll={handleRecordScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: navBottom + 16 }}
        />
      ) : (
        <RefreshableEmpty refreshing={isManualRefreshing} onRefresh={handleRefresh} contentContainerStyle={[styles.center, { paddingBottom: navBottom }]}>
          <Feather name={kind === "letter" ? "mail" : "edit-3"} size={40} color={Colors.zinc300} />
          <RecordListText style={styles.emptyTitle}>{searchQuery.trim() ? "검색 결과가 없습니다" : emptyTitle}</RecordListText>
          {!searchQuery.trim() && kind === "thought" ? (
            <ScalePressable
              style={styles.createButton}
              contentStyle={styles.createButtonContent}
              onPress={createDirectThought}
              disabled={isCreatingThought}
            >
              <RecordListText style={styles.createButtonText}>단상 쓰기</RecordListText>
            </ScalePressable>
          ) : null}
        </RefreshableEmpty>
      )}

      {(() => {
        const sl = overlayLetter ? spaceLetterByArticleId.get(overlayLetter.id) : undefined;
        const isAnon = sl?.displayName != null;
        const isPub = sl ? sl.visibility === SpaceLetterVisibility.PUBLIC : true;
        const disabled = isAnon || sl == null;
        return (
          <CardSelectOverlay
            articles={overlayLetterChain}
            metas={overlayMetaChain}
            initialIndex={0}
            originLayout={overlayOriginLayout}
            onClose={() => {
              setIsOverlaySourceHidden(false);
              setOverlayLetter(null);
              setOverlayOriginLayout(null);
            }}
            onRead={handleOverlayRead}
            onReady={() => setIsOverlaySourceHidden(true)}
            visibilityButton={overlayLetter ? {
              icon: (disabled || !isPub ? "users" : "globe") as React.ComponentProps<typeof Feather>["name"],
              label: isAnon ? "수신자 공개" : isPub ? "전체 공개" : "수신자 공개",
              disabled,
              onPress: () => { if (overlayLetter) handleVisibilityToggle(overlayLetter.id); },
            } : null}
          />
        );
      })()}
      <ConfirmModal
        visible={Boolean(visibilityConfirmTarget)}
        title={visibilityConfirmTarget?.newVisibility === SpaceLetterVisibility.RECIPIENT_ONLY
          ? "수신자 공개로 변경하시겠습니까?"
          : "전체 공개로 변경하시겠습니까?"}
        description={visibilityConfirmTarget?.newVisibility === SpaceLetterVisibility.RECIPIENT_ONLY
          ? "변경하면 이 편지가 프로필 페이지에서 사라집니다."
          : "변경하면 이 편지가 프로필 페이지에 다시 표시됩니다."}
        confirmLabel="변경"
        cancelLabel="취소"
        confirmDisabled={isChangingVisibility}
        cancelDisabled={isChangingVisibility}
        onConfirm={confirmVisibilityChange}
        onCancel={() => { if (!isChangingVisibility) setVisibilityConfirmTarget(null); }}
      />
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
        description={deleteTarget?.kind === "thought" ? "이 단상은 영구적으로 삭제됩니다." : "이 글은 영구적으로 삭제됩니다."}
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <BottomSheet visible={Boolean(archiveArticleId)} onClose={() => { setArchiveArticleId(null); setSelectedCollectionId(null); }} snapPoints={[0.6]} enableDragDown dismissable>
        <View style={styles.archive}>
          <RecordListText style={styles.archiveTitle}>보관할 폴더 선택</RecordListText>
          <FlatList
            data={sortedCollections}
            keyExtractor={(collection) => collection.id}
            renderItem={({ item }) => <ScalePressable style={styles.collectionRow} contentStyle={[styles.collectionRowContent, selectedCollectionId === item.id && styles.collectionSelected]} onPress={() => setSelectedCollectionId(item.id)}><RecordListText style={styles.collectionName}>{item.name}</RecordListText>{selectedCollectionId === item.id ? <Feather name="check" size={16} color={Colors.zinc900} /> : null}</ScalePressable>}
            ListEmptyComponent={<RecordListText style={styles.muted}>보관할 폴더가 없어요</RecordListText>}
          />
          <ScalePressable style={styles.archiveButton} contentStyle={[styles.archiveButtonContent, (!selectedCollectionId || isArchiving) && styles.disabled]} onPress={archiveArticle} disabled={!selectedCollectionId || isArchiving}><RecordListText style={styles.createButtonText}>{isArchiving ? "보관 중..." : "보관하기"}</RecordListText></ScalePressable>
        </View>
      </BottomSheet>
    </View>
  );
}

// hint: Logic changed on both sides. Requires understanding intent of each change.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.white },
  filtersAnimated: { height: FILTER_BAR_HEIGHT, overflow: "visible", zIndex: 5, backgroundColor: "transparent" },
  filterGradient: { position: "absolute", top: 0, left: 0, right: 0, height: FILTER_GRADIENT_HEIGHT, backgroundColor: "transparent" },
  filterControls: { height: FILTER_BAR_HEIGHT, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.screenPx, backgroundColor: "transparent" },
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
  // Keep the press wrapper transparent: only the animated content surface
  // should own the card geometry and shadow, so the shadow scales with it.
  thoughtCard: { flexGrow: 0, flexShrink: 0 },
  thoughtCardContent: { flex: 1, backgroundColor: Colors.zinc50, borderRadius: 16, overflow: "hidden", ...Shadows.carouselCard },
  questionCardContent: { backgroundColor: Colors.noticeAccent },
  thoughtCardBodyWrap: { flex: 1, justifyContent: "flex-start" },
  thoughtCardTitle: { fontFamily: ReaderTokens.fontFamily.serifBold, color: Colors.zinc900 },
  thoughtCardBody: { fontFamily: ReaderTokens.fontFamily.serif, color: Colors.zinc800 },
  row: { marginHorizontal: Spacing.screenPx, marginBottom: Spacing.cardGap },
  rowContent: { padding: 16, gap: 7, borderRadius: 16, backgroundColor: Colors.white, ...Shadows.card },
  questionRowContent: { backgroundColor: Colors.noticeAccent },
  rowMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowMetaThought: { justifyContent: "flex-end" },
  rowKind: { ...Typography.caption, color: Colors.zinc500, fontWeight: "600" },
  rowDate: { ...Typography.caption, color: Colors.zinc500 },
  rowTextFrame: { width: "100%" },
  rowTitle: { fontFamily: ReaderTokens.fontFamily.serifBold, color: Colors.zinc900 },
  rowBody: { fontFamily: ReaderTokens.fontFamily.serif, color: Colors.zinc600 },
  questionRowText: { color: Colors.white },
  rowLetterActions: { flexDirection: "row", gap: 6, marginTop: 2 },
  rowLetterAction: { height: 32, flexGrow: 0, flexShrink: 0 },
  rowLetterActionContent: { height: 32, flexGrow: 0, flexShrink: 0, paddingHorizontal: 10, borderRadius: 16, backgroundColor: Colors.zinc100, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  rowLetterActionText: { ...Typography.caption, color: Colors.zinc600, fontWeight: "600" },
  createButton: { height: 48, flexGrow: 0, flexShrink: 0 },
  createButtonContent: { height: 48, flexGrow: 0, flexShrink: 0, paddingHorizontal: 20, backgroundColor: Colors.zinc900, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  createButtonText: { ...Typography.bodySemiBold, color: Colors.white, fontSize: 15 },
  archive: { flex: 1, paddingHorizontal: Spacing.screenPx, paddingBottom: 16 },
  archiveTitle: { ...Typography.bodySemiBold, fontSize: 16, color: Colors.zinc900, textAlign: "center", paddingVertical: 12 },
  collectionRow: {},
  collectionRowContent: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, paddingHorizontal: 8, borderRadius: 8 },
  collectionSelected: { backgroundColor: Colors.zinc50 },
  collectionName: { ...Typography.body, color: Colors.zinc700 },
  archiveButton: { height: 48, marginTop: 12 },
  archiveButtonContent: { height: 48, borderRadius: 12, backgroundColor: Colors.zinc900, alignItems: "center", justifyContent: "center" },
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
