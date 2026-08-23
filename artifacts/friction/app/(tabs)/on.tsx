import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetArticleQueryKey,
  getListThoughtsQueryKey,
  useAddArticleToMyCollection,
  useCreateThought,
  useDeleteArticle,
  useDeleteThought,
  useGetThoughtQuestionQueue,
  useListArticles,
  useListMyCollections,
  useListSendRecords,
  useListThoughts,
  useActivateThoughtQuestion,
  useRefreshThoughtQuestionQueue,
  type Article,
  type MyCollection,
  type Thought,
} from "@workspace/api-client-react";
import AnimatedSearchBar from "@/components/AnimatedSearchBar/AnimatedSearchBar";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import DropdownFilter from "@/components/DropdownFilter/DropdownFilter";
import { PageHeader } from "@/components/NavBar/PageHeader";
import RefreshableEmpty from "@/components/RefreshableEmpty";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, ReaderTokens, Sizing, Spacing, Typography, readerFontSize } from "@/constants/tokens";
import { useNavigation } from "@/contexts/NavigationContext";
import { useReaderTransition } from "@/contexts/ReaderTransitionContext";
import { useToast } from "@/contexts/ToastContext";
import { useUser } from "@/contexts/UserContext";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { invalidateArticleLists } from "@/lib/queryInvalidation";
import {
  buildUnifiedRecords,
  filterRecords,
  getRecordPreview,
  recordMatchesQuery,
  type RecordKind,
  type RecordView,
  type UnifiedRecord,
} from "@/lib/recordList";
import type { ArticleStatus } from "@/lib/policies";

const KIND_OPTIONS: { key: RecordKind; label: string }[] = [
  { key: "thought", label: "단상" },
  { key: "editing", label: "편집" },
  { key: "letter", label: "편지" },
];
const VIEW_OPTIONS: { key: RecordView; label: string }[] = [
  { key: "card", label: "하나씩" },
  { key: "content", label: "내용도" },
  { key: "title", label: "제목만" },
];

function getScreenForStatus(status: ArticleStatus): "/on-01a" | "/on-01b" | "/on-01c" {
  if (status === "DIVIDING") return "/on-01b";
  if (status === "CLOSING") return "/on-01c";
  return "/on-01a";
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

function ThoughtRecordCard({
  thought,
  question = false,
  width,
  onPress,
  onLongPress,
}: {
  thought: Thought;
  question?: boolean;
  width: number;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const preview = getRecordPreview({
    id: thought.id,
    kind: "thought",
    updatedAt: thought.updatedAt,
    thought,
  });
  const height = width * Sizing.cardRatio;
  const body = preview.hasTitle ? [preview.title, preview.body].filter(Boolean).join("\n\n") : preview.body;
  const bodyLineHeight = 31;
  const maxBodyLines = Math.max(1, Math.floor((height - 72) / bodyLineHeight));
  const [overflowed, setOverflowed] = useState(false);

  return (
    <ScalePressable
      style={[styles.thoughtCard, { width, height }, question && styles.questionCardShadow]}
      contentStyle={styles.thoughtCardContent}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityLabel={`${question ? "현재 질문 단상" : "단상 열기"}${overflowed ? ", 내용 일부 생략" : ""}`}
    >
      {question ? <Text style={styles.questionLabel}>현재 질문</Text> : null}
      <View style={styles.thoughtCardBodyWrap}>
        <Text
          // The invisible source text gives us the platform's real wrapped-line
          // count, not an unreliable character estimate.
          style={styles.thoughtCardMeasure}
          onTextLayout={(event) => setOverflowed(event.nativeEvent.lines.length > maxBodyLines)}
        >
          {body || "아직 적힌 내용이 없어요."}
        </Text>
        <Text
          style={styles.thoughtCardBody}
          numberOfLines={maxBodyLines}
          ellipsizeMode="tail"
        >
          {body || "아직 적힌 내용이 없어요."}
        </Text>
      </View>
    </ScalePressable>
  );
}

function RecordRow({
  record,
  view,
  onPress,
  onLongPress,
  onSend,
  onArchive,
}: {
  record: UnifiedRecord;
  view: Exclude<RecordView, "card">;
  onPress: () => void;
  onLongPress: () => void;
  onSend?: () => void;
  onArchive?: () => void;
}) {
  const { width } = useWindowDimensions();
  const preview = getRecordPreview(record);
  const title = (view === "content" ? preview.titleDisplay : preview.title) || preview.body || "제목 없음";
  const showsTitle = view === "title" || preview.hasTitle || record.kind !== "thought";
  const bodyLines = preview.hasTitle || record.kind !== "thought" ? 3 : 5;
  const titleSize = readerFontSize(6.9, width - Spacing.screenPx * 2);
  const bodySize = readerFontSize(4, width - Spacing.screenPx * 2);

  return (
    <ScalePressable
      style={styles.row}
      contentStyle={styles.rowContent}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityLabel={`${record.kind === "thought" ? "단상" : record.kind === "editing" ? "편집 글" : "편지"} 열기`}
      accessibilityHint="길게 눌러 삭제"
    >
      <View style={styles.rowMeta}>
        <Text style={styles.rowKind}>{record.kind === "thought" ? "단상" : record.kind === "editing" ? "편집" : "편지"}</Text>
        <Text style={styles.rowDate}>{relativeDate(record.updatedAt)}</Text>
      </View>
      {showsTitle ? (
        <Text
          style={[styles.rowTitle, { fontSize: titleSize, lineHeight: titleSize * 1.28 }]}
          numberOfLines={view === "title" ? 1 : undefined}
        >
          {title}
        </Text>
      ) : null}
      {view === "content" ? (
        <Text
          style={[styles.rowBody, { fontSize: bodySize, lineHeight: bodySize * 1.7 }]}
          numberOfLines={bodyLines}
        >
          {preview.body || "아직 적힌 내용이 없어요."}
        </Text>
      ) : null}
      {record.kind === "letter" && onSend && onArchive ? (
        <View style={styles.rowLetterActions}>
          <ScalePressable style={styles.rowLetterAction} contentStyle={styles.rowLetterActionContent} onPress={(event) => { event.stopPropagation(); onSend(); }}>
            <Feather name="send" size={14} color={Colors.zinc600} />
            <Text style={styles.rowLetterActionText}>보내기</Text>
          </ScalePressable>
          <ScalePressable style={styles.rowLetterAction} contentStyle={styles.rowLetterActionContent} onPress={(event) => { event.stopPropagation(); onArchive(); }}>
            <Feather name="folder" size={14} color={Colors.zinc600} />
            <Text style={styles.rowLetterActionText}>보관</Text>
          </ScalePressable>
        </View>
      ) : null}
    </ScalePressable>
  );
}

export default function OnScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { startFadeToBlack } = useReaderTransition();
  const { userId } = useUser();
  const { showToast } = useToast();
  const { setShowRecordFab } = useNavigation();
  const navBottom = useNavBarBottomSafeArea();
  const { width } = useWindowDimensions();
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const initialKind: RecordKind = tab === "my_article" ? "letter" : tab === "memo" ? "editing" : "thought";
  const [kind, setKind] = useState<RecordKind>(initialKind);
  const [view, setView] = useState<RecordView>("card");
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [cardIndex, setCardIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<UnifiedRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const deletePendingRef = useRef(false);
  const [archiveArticleId, setArchiveArticleId] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  const articlesQuery = useListArticles({ authorId: userId });
  const thoughtsQuery = useListThoughts();
  const questionQuery = useGetThoughtQuestionQueue({ query: { enabled: Boolean(userId) } });
  const sendRecordsQuery = useListSendRecords({ senderId: userId });
  const collectionsQuery = useListMyCollections({ ownerId: userId });
  const createThought = useCreateThought();
  const deleteArticle = useDeleteArticle();
  const deleteThought = useDeleteThought();
  const activateQuestion = useActivateThoughtQuestion();
  const refreshQuestion = useRefreshThoughtQuestionQueue();
  const addToCollection = useAddArticleToMyCollection();

  useFocusEffect(useCallback(() => {
    setShowRecordFab(false);
    return () => setShowRecordFab(false);
  }, [setShowRecordFab]));

  useEffect(() => {
    for (const article of articlesQuery.data ?? []) {
      queryClient.setQueryData(getGetArticleQueryKey(article.id), article);
    }
  }, [articlesQuery.data, queryClient]);

  useEffect(() => {
    setCardIndex(0);
  }, [kind, searchQuery]);

  useEffect(() => {
    if (tab === "my_article") setKind("letter");
    else if (tab === "memo") setKind("editing");
    else if (tab === "thought") setKind("thought");
  }, [tab]);

  const queuedIds = useMemo(
    () => new Set([questionQuery.data?.current?.id, questionQuery.data?.next?.id].filter(Boolean)),
    [questionQuery.data?.current?.id, questionQuery.data?.next?.id],
  );
  const listedThoughts = (thoughtsQuery.data ?? []) as Thought[];
  const records = useMemo(
    () => filterRecords(
      buildUnifiedRecords(
        listedThoughts.filter((thought: Thought) => !queuedIds.has(thought.id)),
        articlesQuery.data,
      ),
      kind,
    ).filter((record) => recordMatchesQuery(record, searchQuery)),
    [articlesQuery.data, kind, listedThoughts, queuedIds, searchQuery],
  );
  const visibleRecords = useMemo(
    () => kind === "thought" && questionQuery.data?.current
      ? [{
          id: questionQuery.data.current.id,
          kind: "thought" as const,
          updatedAt: questionQuery.data.current.updatedAt,
          thought: questionQuery.data.current,
          isQuestion: true,
        }, ...records.map((record) => ({ ...record, isQuestion: false }))]
      : records.map((record) => ({ ...record, isQuestion: false })),
    [kind, questionQuery.data?.current, records],
  );
  const selectedCard = visibleRecords[Math.min(cardIndex, Math.max(0, visibleRecords.length - 1))];
  const sortedCollections = useMemo(() => [...((collectionsQuery.data ?? []) as MyCollection[])]
    .filter((collection) => !collection.isArchive)
    .sort((a, b) => Number(Boolean(b.isImpression)) - Number(Boolean(a.isImpression)) || (b.articleCount ?? 0) - (a.articleCount ?? 0)), [collectionsQuery.data]);
  const deliveryMap = useMemo(() => {
    const result = new Map<string, "sent" | "scheduled">();
    for (const item of sendRecordsQuery.data ?? []) {
      if (item.isDelivered) result.set(item.articleId, "sent");
      else if (!result.has(item.articleId)) result.set(item.articleId, "scheduled");
    }
    return result;
  }, [sendRecordsQuery.data]);

  const refreshAll = useCallback(async (replaceQuestion = false) => {
    try {
      if (replaceQuestion && questionQuery.data?.current) {
        await refreshQuestion.mutateAsync({ data: { currentThoughtId: questionQuery.data.current.id } });
      }
      await Promise.all([articlesQuery.refetch(), thoughtsQuery.refetch(), questionQuery.refetch()]);
    } catch {
      showToast({ message: replaceQuestion ? "질문을 바꾸지 못했습니다. 다시 시도해주세요." : "기록을 불러오지 못했습니다.", type: "error" });
    }
  }, [articlesQuery, questionQuery, refreshQuestion, showToast, thoughtsQuery]);

  const openRecord = useCallback((record: UnifiedRecord) => {
    if (record.kind === "thought") {
      router.push({ pathname: "/on-01a", params: { id: record.thought.id } });
    } else if (record.kind === "editing") {
      router.push({ pathname: getScreenForStatus(record.article.status as ArticleStatus), params: { id: record.article.id } });
    } else {
      startFadeToBlack(() => router.push({ pathname: "/read", params: { articleId: record.article.id, mode: "re_read" } }));
    }
  }, [router, startFadeToBlack]);

  const openQuestion = useCallback(async (thought: Thought) => {
    if (activateQuestion.isPending) return;
    try {
      const result = await activateQuestion.mutateAsync({ id: thought.id });
      await Promise.all([thoughtsQuery.refetch(), questionQuery.refetch()]);
      router.push({ pathname: "/on-01a", params: { id: result.activatedThought.id } });
    } catch {
      showToast({ message: "질문을 시작하지 못했습니다. 다시 시도해주세요.", type: "error" });
    }
  }, [activateQuestion, questionQuery, router, showToast, thoughtsQuery]);

  const createNewThought = useCallback(async () => {
    if (createThought.isPending) return;
    try {
      const thought = await createThought.mutateAsync({ data: { content: "# \n\n", createdFrom: "direct", status: "PRELIMINARY" } });
      await thoughtsQuery.refetch();
      router.push({ pathname: "/on-01a", params: { id: thought.id } });
    } catch {
      showToast({ message: "단상 생성에 실패했습니다.", type: "error" });
    }
  }, [createThought, router, showToast, thoughtsQuery]);

  const confirmDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target || deletePendingRef.current) return;
    deletePendingRef.current = true;
    setIsDeleting(true);
    try {
      if (target.kind === "thought") {
        await deleteThought.mutateAsync({ id: target.thought.id });
        await queryClient.invalidateQueries({ queryKey: getListThoughtsQueryKey() });
      } else {
        await deleteArticle.mutateAsync({ id: target.article.id });
        await invalidateArticleLists(queryClient);
      }
      setDeleteTarget(null);
      showToast({ message: "삭제했어요.", type: "success" });
    } catch {
      // Keep the row and dialog visible: a failed mutation must never look successful.
      showToast({ message: "삭제에 실패했습니다. 다시 시도해주세요.", type: "error" });
    } finally {
      deletePendingRef.current = false;
      setIsDeleting(false);
    }
  }, [deleteArticle, deleteTarget, deleteThought, queryClient, showToast]);

  const archiveArticle = useCallback(async () => {
    if (!archiveArticleId || !selectedCollectionId || isArchiving) return;
    setIsArchiving(true);
    try {
      await addToCollection.mutateAsync({ id: selectedCollectionId, data: { articleId: archiveArticleId } });
      await collectionsQuery.refetch();
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
  }, [addToCollection, archiveArticleId, collectionsQuery, isArchiving, router, selectedCollectionId, showToast, sortedCollections]);

  const isLoading = articlesQuery.isLoading || thoughtsQuery.isLoading || questionQuery.isLoading;
  const emptyTitle = kind === "thought" ? "첫 단상을 남겨보세요" : kind === "editing" ? "편집 중인 글이 없어요" : "아직 내보낸 편지가 없어요";

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
      <View style={styles.filters}>
        <DropdownFilter label="종류" value={kind} defaultValue="thought" options={KIND_OPTIONS} onChange={setKind} selectedLabel={`종류: ${KIND_OPTIONS.find((option) => option.key === kind)?.label ?? ""}`} />
        <DropdownFilter label="보기" value={view} defaultValue="card" options={VIEW_OPTIONS} onChange={setView} selectedLabel={`보기: ${VIEW_OPTIONS.find((option) => option.key === view)?.label ?? ""}`} />
      </View>

      {isLoading ? (
        <View style={styles.center}><Text style={styles.muted}>불러오는 중...</Text></View>
      ) : view === "card" && selectedCard ? (
        <ScrollView
          style={styles.cardScroll}
          contentContainerStyle={[styles.cardStage, { paddingBottom: navBottom }]}
          refreshControl={<RefreshControl refreshing={articlesQuery.isRefetching || thoughtsQuery.isRefetching || refreshQuestion.isPending} onRefresh={() => refreshAll(kind === "thought")} />}
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical
        >
          {selectedCard.kind === "thought" ? (
            <ThoughtRecordCard
              thought={selectedCard.thought}
              question={selectedCard.isQuestion}
              width={Math.min(width - Spacing.screenPx * 2, Sizing.cardSlotW)}
              onPress={() => selectedCard.isQuestion ? openQuestion(selectedCard.thought) : openRecord(selectedCard)}
              onLongPress={selectedCard.isQuestion ? undefined : () => setDeleteTarget(selectedCard)}
            />
          ) : (
            <ArticleCardItem
              title={selectedCard.article.title || "제목 없음"}
              cover={selectedCard.article.cover}
              onPress={() => openRecord(selectedCard)}
              onLongPress={() => setDeleteTarget(selectedCard)}
              cardWidth={Math.min(width - Spacing.screenPx * 2, Sizing.cardSlotW)}
              letterTypeBadge={selectedCard.kind === "letter" ? deliveryMap.get(selectedCard.article.id) === "sent" ? "발신됨" : "편지" : "편집"}
            />
          )}
          <View style={styles.cardNav}>
            <ScalePressable style={styles.cardNavButton} contentStyle={styles.cardNavButtonContent} onPress={() => setCardIndex((index) => Math.max(0, index - 1))} disabled={cardIndex === 0}>
              <Feather name="chevron-left" size={20} color={cardIndex === 0 ? Colors.zinc300 : Colors.zinc700} />
            </ScalePressable>
            <Text style={styles.cardCount}>{cardIndex + 1} / {visibleRecords.length}</Text>
            <ScalePressable style={styles.cardNavButton} contentStyle={styles.cardNavButtonContent} onPress={() => setCardIndex((index) => Math.min(visibleRecords.length - 1, index + 1))} disabled={cardIndex >= visibleRecords.length - 1}>
              <Feather name="chevron-right" size={20} color={cardIndex >= visibleRecords.length - 1 ? Colors.zinc300 : Colors.zinc700} />
            </ScalePressable>
          </View>
          {selectedCard.kind === "letter" ? (
            <View style={styles.letterActions}>
              <ScalePressable
                style={styles.letterAction}
                contentStyle={styles.letterActionContent}
                onPress={() => router.push({ pathname: "/to-send", params: { prefillArticleId: selectedCard.article.id } })}
              >
                <Feather name="send" size={16} color={Colors.zinc700} />
                <Text style={styles.letterActionText}>보내기</Text>
              </ScalePressable>
              <ScalePressable
                style={styles.letterAction}
                contentStyle={styles.letterActionContent}
                onPress={() => {
                  setArchiveArticleId(selectedCard.article.id);
                  setSelectedCollectionId(null);
                }}
              >
                <Feather name="folder" size={16} color={Colors.zinc700} />
                <Text style={styles.letterActionText}>보관</Text>
              </ScalePressable>
            </View>
          ) : null}
        </ScrollView>
      ) : visibleRecords.length > 0 ? (
        <FlatList
          data={visibleRecords}
          keyExtractor={(record) => `${record.kind}-${record.id}`}
          renderItem={({ item }) => {
            const isCurrentQuestion = item.kind === "thought" && item.isQuestion;
            return (
              <RecordRow
                record={item}
                view={view === "title" ? "title" : "content"}
                onPress={() => isCurrentQuestion ? openQuestion(item.thought) : openRecord(item)}
                onLongPress={() => { if (!isCurrentQuestion) setDeleteTarget(item); }}
                onSend={item.kind === "letter" ? () => router.push({ pathname: "/to-send", params: { prefillArticleId: item.article.id } }) : undefined}
                onArchive={item.kind === "letter" ? () => { setArchiveArticleId(item.article.id); setSelectedCollectionId(null); } : undefined}
              />
            );
          }}
          refreshControl={<RefreshControl refreshing={articlesQuery.isRefetching || thoughtsQuery.isRefetching} onRefresh={() => refreshAll(kind === "thought")} />}
          contentContainerStyle={{ paddingBottom: navBottom + 16 }}
        />
      ) : (
        <RefreshableEmpty refreshing={articlesQuery.isRefetching || thoughtsQuery.isRefetching} onRefresh={() => refreshAll(kind === "thought")} contentContainerStyle={[styles.center, { paddingBottom: navBottom }]}>
          <Feather name={kind === "letter" ? "mail" : "edit-3"} size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>{searchQuery.trim() ? "검색 결과가 없습니다" : emptyTitle}</Text>
          {!searchQuery.trim() && kind === "thought" ? <ScalePressable style={styles.createButton} contentStyle={styles.createButtonContent} onPress={createNewThought}><Text style={styles.createButtonText}>단상 쓰기</Text></ScalePressable> : null}
        </RefreshableEmpty>
      )}

      {kind === "thought" ? (
        <ScalePressable style={[styles.fab, { bottom: navBottom }]} contentStyle={styles.fabContent} onPress={createNewThought} accessibilityLabel="단상 추가">
          <Feather name="plus" size={22} color={Colors.white} />
        </ScalePressable>
      ) : null}

      <ConfirmModal
        visible={Boolean(deleteTarget)}
        title="삭제하시겠습니까?"
        description={deleteTarget?.kind === "thought" ? "이 단상은 영구적으로 삭제됩니다." : "이 글은 영구적으로 삭제됩니다."}
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        confirmDisabled={isDeleting}
        cancelDisabled={isDeleting}
        onConfirm={confirmDelete}
        onCancel={() => { if (!isDeleting) setDeleteTarget(null); }}
      />
      <BottomSheet visible={Boolean(archiveArticleId)} onClose={() => { setArchiveArticleId(null); setSelectedCollectionId(null); }} snapPoints={[0.6]} enableDragDown dismissable>
        <View style={styles.archive}>
          <Text style={styles.archiveTitle}>보관할 폴더 선택</Text>
          <FlatList
            data={sortedCollections}
            keyExtractor={(collection) => collection.id}
            renderItem={({ item }) => <ScalePressable style={styles.collectionRow} contentStyle={[styles.collectionRowContent, selectedCollectionId === item.id && styles.collectionSelected]} onPress={() => setSelectedCollectionId(item.id)}><Text style={styles.collectionName}>{item.name}</Text>{selectedCollectionId === item.id ? <Feather name="check" size={16} color={Colors.zinc900} /> : null}</ScalePressable>}
            ListEmptyComponent={<Text style={styles.muted}>보관할 폴더가 없어요</Text>}
          />
          <ScalePressable style={styles.archiveButton} contentStyle={[styles.archiveButtonContent, (!selectedCollectionId || isArchiving) && styles.disabled]} onPress={archiveArticle} disabled={!selectedCollectionId || isArchiving}><Text style={styles.createButtonText}>{isArchiving ? "보관 중..." : "보관하기"}</Text></ScalePressable>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.white },
  filters: { flexDirection: "row", gap: 8, paddingHorizontal: Spacing.screenPx, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.zinc100 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: Spacing.screenPx },
  muted: { ...Typography.body, color: Colors.zinc500, textAlign: "center" },
  emptyTitle: { ...Typography.bodySemiBold, color: Colors.zinc900, fontSize: 17, textAlign: "center" },
  cardStage: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, paddingHorizontal: Spacing.screenPx, paddingTop: 18 },
  cardScroll: { flex: 1 },
  thoughtCard: { flexGrow: 0, flexShrink: 0, borderRadius: 16 },
  thoughtCardContent: { flex: 1, backgroundColor: Colors.zinc50, borderRadius: 16, padding: 24 },
  questionCardShadow: { ...Platform.select({ ios: { shadowColor: "#8F1D2C", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.34, shadowRadius: 16 }, android: { elevation: 9 }, default: { boxShadow: "0 8px 20px rgba(143,29,44,0.34)" } as object }) },
  questionLabel: { position: "absolute", top: 18, right: 20, ...Typography.caption, color: Colors.zinc500, fontWeight: "600" },
  thoughtCardBodyWrap: { flex: 1, justifyContent: "center" },
  thoughtCardBody: { fontFamily: ReaderTokens.fontFamily.serif, color: Colors.zinc800, fontSize: 18, lineHeight: 31 },
  thoughtCardMeasure: { position: "absolute", opacity: 0, width: "100%", fontFamily: ReaderTokens.fontFamily.serif, color: Colors.zinc800, fontSize: 18, lineHeight: 31, pointerEvents: "none" },
  cardNav: { flexDirection: "row", alignItems: "center", gap: 16 },
  cardNavButton: { width: 42, height: 42, flexGrow: 0, flexShrink: 0 },
  cardNavButtonContent: { width: 42, height: 42, flexGrow: 0, flexShrink: 0, borderRadius: 21, borderWidth: 1, borderColor: Colors.zinc200, alignItems: "center", justifyContent: "center" },
  cardCount: { ...Typography.caption, color: Colors.zinc500, minWidth: 48, textAlign: "center" },
  letterActions: { flexDirection: "row", gap: 8 },
  letterAction: { height: 40, flexGrow: 0, flexShrink: 0 },
  letterActionContent: { height: 40, flexGrow: 0, flexShrink: 0, paddingHorizontal: 14, borderRadius: 20, backgroundColor: Colors.zinc100, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  letterActionText: { ...Typography.caption, color: Colors.zinc700, fontWeight: "600" },
  row: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.zinc100 },
  rowContent: { paddingHorizontal: Spacing.screenPx, paddingVertical: 16, gap: 7, backgroundColor: Colors.white },
  rowMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowKind: { ...Typography.caption, color: Colors.zinc500, fontWeight: "600" },
  rowDate: { ...Typography.caption, color: Colors.zinc500 },
  rowTitle: { fontFamily: ReaderTokens.fontFamily.serif, color: Colors.zinc900 },
  rowBody: { fontFamily: ReaderTokens.fontFamily.serif, color: Colors.zinc600 },
  rowLetterActions: { flexDirection: "row", gap: 6, marginTop: 2 },
  rowLetterAction: { height: 32, flexGrow: 0, flexShrink: 0 },
  rowLetterActionContent: { height: 32, flexGrow: 0, flexShrink: 0, paddingHorizontal: 10, borderRadius: 16, backgroundColor: Colors.zinc100, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  rowLetterActionText: { ...Typography.caption, color: Colors.zinc600, fontWeight: "600" },
  createButton: { height: 48, flexGrow: 0, flexShrink: 0 },
  createButtonContent: { height: 48, flexGrow: 0, flexShrink: 0, paddingHorizontal: 20, backgroundColor: Colors.zinc900, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  createButtonText: { ...Typography.bodySemiBold, color: Colors.white, fontSize: 15 },
  fab: { position: "absolute", right: Spacing.screenPx, width: 52, height: 52, flexGrow: 0, flexShrink: 0 },
  fabContent: { width: 52, height: 52, flexGrow: 0, flexShrink: 0, borderRadius: 26, backgroundColor: Colors.zinc900, alignItems: "center", justifyContent: "center", ...Platform.select({ ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 6 }, android: { elevation: 4 }, default: {} }) },
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