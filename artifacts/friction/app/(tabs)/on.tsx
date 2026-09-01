import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { useFocusEffect, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetArticleQueryKey,
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
  type MyCollection,
  type Thought,
} from "@workspace/api-client-react";
import ActionSheetModal from "@/components/ActionSheetModal/ActionSheetModal";
import DropdownFilter from "@/components/DropdownFilter/DropdownFilter";
import type { DropdownOption } from "@/components/DropdownFilter/DropdownFilter";
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


const KIND_OPTIONS: DropdownOption<RecordKind>[] = [
  { key: "thought", label: "단상" },
  { key: "editing", label: "편집" },
  { key: "letter", label: "편지" },
];
const VIEW_OPTIONS: DropdownOption<RecordView>[] = [
  { key: "card", label: "카드" },
  { key: "content", label: "목록" },
];

type CardRecord = UnifiedRecord & { isQuestion: boolean; questionIndex?: number };
const cardRecordKey = (record: CardRecord) => `${record.kind}:${record.id}`;

function getScreenForStatus(status: ArticleStatus): "/on-01a" | "/on-01b" | "/on-01c" {
  if (status === "DIVIDING") return "/on-01b";
  if (status === "CLOSING") return "/on-01c";
  return "/on-01a";
}

const NON_SELECTABLE_WEB_STYLE =
  Platform.OS === "web" ? ({ userSelect: "none" } as object) : undefined;

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

function relativeDate(value: string): string {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}일 전`;
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function RecordSourceCard({
  record,
  question = false,
  questionIndex,
  width,
  height: suppliedHeight,
  onPress,
  onLongPress,
}: {
  record: UnifiedRecord;
  question?: boolean;
  questionIndex?: number;
  width: number;
  height?: number;
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
  const [cardMixSeed, setCardMixSeed] = useState(() => `${Date.now()}-${Math.random()}`);
  const [deleteTarget, setDeleteTarget] = useState<UnifiedRecord | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<ReadonlySet<string>>(() => new Set());
  const deletePendingIdsRef = useRef(new Set<string>());
  const [letterActionTarget, setLetterActionTarget] = useState<UnifiedRecord | null>(null);
  const [archiveArticleId, setArchiveArticleId] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  // Refresh and activation mutate the same server-owned FIFO queue. Keep one
  // synchronous guard so a late response can never replace a newer snapshot.
  const questionQueueMutationPendingRef = useRef(false);
  const hasFocusedRecordScreenRef = useRef(false);
  const questionPlacementRef = useRef<{
    seed: string;
    anchors: QuestionPlacementAnchors;
  } | null>(null);

  useEffect(() => {
    setKind("thought");
    setView("card");
    setRecordResetVersion(tabReselectVersion.ON);
  }, [tabReselectVersion.ON]);

  useEffect(() => {
  }, [kind, view]);

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

  useEffect(() => {
    for (const article of articlesQuery.data ?? []) {
      queryClient.setQueryData(getGetArticleQueryKey(article.id), article);
    }
  }, [articlesQuery.data, queryClient]);

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
  const recordListViewportRef = useRef<View>(null);
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
  const estimatedRecordGroupHeights = useMemo(() => {
    const heights = new Map<string, number>();
    for (const group of cardGroups) {
      heights.set(
        group.dateKey,
        getDateGroupCarouselHeight(
          getRecordGroupCardHeight(group.records, cardWidth),
          0,
          Sizing.dateHeaderH
            + Sizing.carouselShadowInsetTop
            + Sizing.carouselShadowInsetBottom
            + Sizing.dotsH
            + Spacing.carouselGroupBottom,
        ),
      );
    }
    return heights;
  }, [cardGroups, cardWidth]);
  const verticalDateSnap = useDateGroupVerticalSnap({
    groupKeys: cardGroupKeys,
    groupSignature: cardGroupSignature,
    listRef: recordListRef,
    enabled: view === "card",
    resetKey: recordResetVersion,
    estimatedGroupHeights: estimatedRecordGroupHeights,
    viewportRef: recordListViewportRef,
    onPageGestureStart: scrollPressGuard.onScroll,
  });
  const handleRecordScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      verticalDateSnap.onScroll(event);
      scrollPressGuard.onScroll();
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
        await Promise.allSettled([
          queryClient.cancelQueries({ queryKey: getListThoughtsQueryKey() }),
          queryClient.cancelQueries({ queryKey: getListArticlesQueryKey() }),
        ]);
        const rollback = snapshotRecordDeletion(queryClient, target);
        removeRecordFromCache(queryClient, target);
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

  const isLoading =
    (articlesQuery.isLoading && !articlesQuery.data) ||
    (thoughtsQuery.isLoading && !thoughtsQuery.data) ||
    (questionQuery.isLoading && !questionQuery.data);
  const emptyTitle = kind === "thought" ? "첫 단상을 남겨보세요" : kind === "editing" ? "편집 중인 글이 없어요" : "아직 내보낸 편지가 없어요";
  const renderRecordCard = useCallback((record: CardRecord, shouldIgnorePress: () => boolean, cardHeight: number) => (
    <View style={styles.recordCardFrame}>
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
          onPress={() => {
            if (!shouldIgnorePress()) openRecord(record);
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
  ), [cardWidth, openQuestion, openRecord, requestRecordDeletion]);

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
      <View style={styles.filterRow}>
        <DropdownFilter
          label="단상"
          value={kind}
          defaultValue="thought"
          options={KIND_OPTIONS}
          onChange={setKind}
          showDefaultOptionLabel
          activeVariant="outline"
          accessibilityLabel="기록 종류 필터"
        />
        <DropdownFilter
          label="카드"
          value={view}
          defaultValue="card"
          options={VIEW_OPTIONS}
          onChange={setView}
          showDefaultOptionLabel
          activeVariant="outline"
          accessibilityLabel="보기 방식 필터"
        />
      </View>

      {isLoading ? (
        <View style={styles.center}><RecordListText style={styles.muted}>불러오는 중...</RecordListText></View>
      ) : view === "card" && cardGroups.length > 0 ? (
        <View
          ref={recordListViewportRef}
          style={styles.recordListViewport}
          onLayout={verticalDateSnap.onLayout}
          {...verticalDateSnap.panHandlers}
          {...({ onWheel: verticalDateSnap.onWheel } as object)}
        >
          <FlatList
            ref={recordListRef}
            data={cardGroups}
            extraData={recordResetVersion}
            nestedScrollEnabled
            keyExtractor={(group) => group.dateKey}
            renderItem={({ item, index }) => {
              const cardHeight = getRecordGroupCardHeight(item.records, cardWidth);
              return (
                <View
                  ref={(node) => verticalDateSnap.setGroupRef(item.dateKey, node)}
                  style={NON_SELECTABLE_WEB_STYLE}
                  onLayout={(event) => verticalDateSnap.onGroupLayout(item.dateKey, event)}
                >
                  <DateGroupCarousel
                    dateLabel={item.label}
                    countLabel={`${item.records.length}개`}
                    items={item.records}
                    itemKey={cardRecordKey}
                    cardWidth={cardWidth}
                    cardHeight={cardHeight}
                    resetKey={index === 0 ? `${cardMixSeed}:${recordResetVersion}` : cardMixSeed}
                    renderCard={(record, context) => renderRecordCard(record, context.shouldIgnorePress, cardHeight)}
                    shouldIgnoreVerticalPress={scrollPressGuard.shouldIgnoreVerticalPress}
                  />
                </View>
              );
            }}
            refreshControl={<RefreshControl refreshing={articlesQuery.isRefetching || thoughtsQuery.isRefetching || questionQuery.isRefetching || refreshQuestion.isPending} onRefresh={() => refreshAll(kind === "thought")} />}
            onScroll={handleRecordScroll}
            onScrollBeginDrag={verticalDateSnap.onScrollBeginDrag}
            onScrollEndDrag={verticalDateSnap.onScrollEndDrag}
            scrollEventThrottle={16}
            contentContainerStyle={[styles.recordGroupList, { paddingBottom: navBottom }]}
            showsVerticalScrollIndicator={false}
            scrollEnabled={Platform.OS !== "web" && !verticalDateSnap.pageLocked}
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
          refreshControl={<RefreshControl refreshing={articlesQuery.isRefetching || thoughtsQuery.isRefetching || questionQuery.isRefetching || refreshQuestion.isPending} onRefresh={() => refreshAll(kind === "thought")} />}
          onScroll={handleRecordScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: navBottom + 16 }}
        />
      ) : (
        <RefreshableEmpty refreshing={articlesQuery.isRefetching || thoughtsQuery.isRefetching || questionQuery.isRefetching || refreshQuestion.isPending} onRefresh={() => refreshAll(kind === "thought")} contentContainerStyle={[styles.center, { paddingBottom: navBottom }]}>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.white },
  filterRow: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: Spacing.screenPx, gap: 8, paddingTop: 6, paddingBottom: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: Spacing.screenPx },
  muted: { ...Typography.body, color: Colors.zinc500, textAlign: "center" },
  emptyTitle: { ...Typography.bodySemiBold, color: Colors.zinc900, fontSize: 17, textAlign: "center" },
  recordGroupList: {},
  recordListViewport: { flex: 1 },
  recordCardFrame: { flex: 1, alignItems: "center" },
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
});

function getRecordCardHeight(record: UnifiedRecord, width: number): number {
  const baseHeight = width * Sizing.cardRatio;
  if (record.kind === "letter") return baseHeight;
  return baseHeight;
}

function getRecordGroupCardHeight(records: readonly UnifiedRecord[], width: number): number {
  return records.length > 0 ? getRecordCardHeight(records[0], width) : width * Sizing.cardRatio;
}

function getRecordGroupActionAreaHeight(_records: readonly UnifiedRecord[]): number {
  return 0;
}
