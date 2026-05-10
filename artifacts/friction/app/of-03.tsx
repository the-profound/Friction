import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  Platform,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import {
  useListStoredSentences,
  useDeleteStoredSentence,
  useToggleStoredSentenceFavorite,
  useCreateArticle,
} from "@workspace/api-client-react";
import type { StoredSentence } from "@workspace/api-client-react";

type FilterMode = "all" | "favorites";

function getSentencePage(item: StoredSentence): number | undefined {
  if (item.position && typeof item.position === "object" && "page" in item.position) {
    return (item.position as { page: number }).page;
  }
  return undefined;
}

export default function SentenceCollectionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useUser();
  const [filter, setFilter] = useState<FilterMode>("all");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [selectedSentence, setSelectedSentence] = useState<StoredSentence | null>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const allSentencesQuery = useListStoredSentences({ userId });
  const allSentences = (allSentencesQuery.data ?? []) as StoredSentence[];

  const totalCount = allSentences.length;
  const favCount = useMemo(
    () => allSentences.filter((s) => s.isFavorite).length,
    [allSentences],
  );

  const sentencesQuery = useListStoredSentences({
    userId,
    ...(filter === "favorites" ? { favorite: true } : {}),
  });
  const sentences = (sentencesQuery.data ?? []) as StoredSentence[];

  const deleteSentence = useDeleteStoredSentence();
  const toggleFavorite = useToggleStoredSentenceFavorite();
  const createArticle = useCreateArticle();

  const selectedCount = selectedIds.size;

  const enterSelectionMode = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionMode(true);
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleBulkDeletePress = useCallback(() => {
    if (selectedIds.size === 0) return;
    setShowBulkDeleteConfirm(true);
  }, [selectedIds]);

  const handleBulkDeleteConfirm = useCallback(async () => {
    setShowBulkDeleteConfirm(false);
    setIsBulkDeleting(true);
    const ids = Array.from(selectedIds);
    let failCount = 0;
    for (const id of ids) {
      try {
        await deleteSentence.mutateAsync({ id });
      } catch {
        failCount++;
      }
    }
    await sentencesQuery.refetch();
    await allSentencesQuery.refetch();
    setIsBulkDeleting(false);
    exitSelectionMode();
    if (failCount === 0) {
      Alert.alert("완료", `${ids.length}개 문장을 삭제했어요.`);
    } else if (failCount < ids.length) {
      Alert.alert("오류", `일부 삭제에 실패했어요. (${failCount}개)`);
    } else {
      Alert.alert("오류", "삭제에 실패했어요.");
    }
  }, [selectedIds, deleteSentence, sentencesQuery, allSentencesQuery, exitSelectionMode]);

  const handleBulkDeleteCancel = useCallback(() => {
    setShowBulkDeleteConfirm(false);
  }, []);

  const handleToggleFavorite = useCallback(
    async (id: string, currentFav: boolean) => {
      try {
        await toggleFavorite.mutateAsync({ id, data: { isFavorite: !currentFav } });
        sentencesQuery.refetch();
        allSentencesQuery.refetch();
        if (selectedSentence?.id === id) {
          setSelectedSentence((prev) =>
            prev ? { ...prev, isFavorite: !currentFav } : null,
          );
        }
        Alert.alert("완료", currentFav ? "즐겨찾기를 해제했어요" : "즐겨찾기에 추가했어요");
      } catch {
        Alert.alert("오류", "즐겨찾기 변경에 실패했어요");
      }
    },
    [toggleFavorite, sentencesQuery, allSentencesQuery, selectedSentence],
  );

  const handleCopy = useCallback(
    async (text: string) => {
      try {
        if (Platform.OS === "web") {
          await navigator.clipboard.writeText(text);
        } else {
          await Clipboard.setStringAsync(text);
        }
        Alert.alert("완료", "문장을 복사했어요");
        setSelectedSentence(null);
      } catch {
        Alert.alert("오류", "복사에 실패했어요");
      }
    },
    [],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteSentence.mutateAsync({ id });
        sentencesQuery.refetch();
        allSentencesQuery.refetch();
        setSelectedSentence(null);
        Alert.alert("완료", "문장을 삭제했어요");
      } catch {
        Alert.alert("오류", "삭제에 실패했어요");
      }
    },
    [deleteSentence, sentencesQuery, allSentencesQuery],
  );

  const handleQuoteAsMemo = useCallback(
    async (sentence: StoredSentence) => {
      const page = getSentencePage(sentence);
      const quoteBlock = sentence.articleTitle
        ? `> ${sentence.text.trim()}\n>\n> <${sentence.articleTitle}>${page !== undefined ? `, ${page + 1}면` : ""}`
        : `> ${sentence.text.trim()}\n`;
      try {
        const article = await createArticle.mutateAsync({
          data: { authorId: userId, title: "", content: quoteBlock },
        });
        setSelectedSentence(null);
        router.push({ pathname: "/on-01a", params: { id: article.id } });
      } catch {
        Alert.alert("오류", "메모 생성에 실패했습니다.");
      }
    },
    [createArticle, userId, router],
  );

  const renderNormalItem = useCallback(
    ({ item }: { item: StoredSentence }) => {
      const page = getSentencePage(item);
      return (
        <Pressable
          style={styles.sentenceItem}
          onPress={() => setSelectedSentence(item)}
          onLongPress={() => handleCopy(item.text)}
          delayLongPress={1000}
        >
          <View style={styles.sentenceContent}>
            <Text style={styles.sentenceText} numberOfLines={3}>
              &ldquo;{item.text}&rdquo;
            </Text>
            <View style={styles.sentenceMeta}>
              <Text style={styles.sentenceDate}>
                {new Date(item.createdAt).toLocaleDateString("ko-KR")}
              </Text>
              {page !== undefined && (
                <Text style={styles.sentencePage}>{page + 1}페이지</Text>
              )}
            </View>
          </View>
          <View style={styles.rightActions}>
            <Pressable
              style={styles.actionBtn}
              onPress={() => handleCopy(item.text)}
              hitSlop={8}
            >
              <Feather name="copy" size={16} color={Colors.zinc400} />
            </Pressable>
            <Pressable
              style={styles.actionBtn}
              onPress={() => handleToggleFavorite(item.id, item.isFavorite)}
              hitSlop={8}
            >
              <Feather
                name="star"
                size={18}
                color={item.isFavorite ? "#F59E0B" : Colors.zinc300}
              />
            </Pressable>
          </View>
        </Pressable>
      );
    },
    [handleCopy, handleToggleFavorite],
  );

  const renderSelectionItem = useCallback(
    ({ item }: { item: StoredSentence }) => {
      const isSelected = selectedIds.has(item.id);
      const page = getSentencePage(item);
      return (
        <Pressable
          style={styles.selectionRow}
          onPress={() => toggleSelect(item.id)}
        >
          <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
            {isSelected && <Feather name="check" size={14} color={Colors.white} />}
          </View>
          <View style={styles.sentenceContent}>
            <Text style={styles.sentenceText} numberOfLines={3}>
              &ldquo;{item.text}&rdquo;
            </Text>
            <View style={styles.sentenceMeta}>
              <Text style={styles.sentenceDate}>
                {new Date(item.createdAt).toLocaleDateString("ko-KR")}
              </Text>
              {page !== undefined && (
                <Text style={styles.sentencePage}>{page + 1}페이지</Text>
              )}
            </View>
          </View>
        </Pressable>
      );
    },
    [selectedIds, toggleSelect],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {selectionMode ? (
          <>
            <Pressable onPress={exitSelectionMode} hitSlop={12}>
              <Text style={styles.cancelText}>취소</Text>
            </Pressable>
            <Text style={styles.headerTitle}>
              {selectedCount > 0 ? `${selectedCount}개 선택` : "문장 선택"}
            </Text>
            <View style={{ width: 44 }} />
          </>
        ) : (
          <>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Feather name="arrow-left" size={20} color={Colors.zinc600} />
            </Pressable>
            <Text style={styles.headerTitle}>수집한 문장</Text>
            <Pressable onPress={enterSelectionMode} hitSlop={12}>
              <Feather name="more-vertical" size={20} color={Colors.zinc600} />
            </Pressable>
          </>
        )}
      </View>

      {!selectionMode && (
        <View style={styles.filterBar}>
          <Pressable
            style={[styles.filterChip, filter === "all" && styles.filterChipActive]}
            onPress={() => setFilter("all")}
          >
            <Text
              style={[
                styles.filterChipText,
                filter === "all" && styles.filterChipTextActive,
              ]}
            >
              전체 ({totalCount})
            </Text>
          </Pressable>
          <Pressable
            style={[styles.filterChip, filter === "favorites" && styles.filterChipActive]}
            onPress={() => setFilter("favorites")}
          >
            <Feather
              name="star"
              size={12}
              color={filter === "favorites" ? Colors.white : Colors.zinc500}
            />
            <Text
              style={[
                styles.filterChipText,
                filter === "favorites" && styles.filterChipTextActive,
              ]}
            >
              즐겨찾기 ({favCount})
            </Text>
          </Pressable>
        </View>
      )}

      {sentencesQuery.isLoading ? (
        <View style={styles.centerContainer}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      ) : sentencesQuery.isError ? (
        <View style={styles.centerContainer}>
          <Feather name="alert-circle" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>불러오기에 실패했어요</Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => sentencesQuery.refetch()}
          >
            <Text style={styles.retryButtonText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : sentences.length === 0 ? (
        <View style={styles.centerContainer}>
          <Feather name="bookmark" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>
            {filter === "favorites" ? "즐겨찾기한 문장이 없어요" : "수집한 문장이 없어요"}
          </Text>
          <Text style={styles.emptySubtitle}>
            {filter === "favorites"
              ? "별표를 눌러 즐겨찾기에 추가해보세요"
              : "읽기 화면에서 마음에 드는 문장을\n길게 눌러 수집해보세요"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={sentences}
          keyExtractor={(item) => item.id}
          renderItem={selectionMode ? renderSelectionItem : renderNormalItem}
          contentContainerStyle={[
            styles.listContent,
            selectionMode && { paddingBottom: insets.bottom + 80 + 24 },
          ]}
          refreshControl={
            !selectionMode ? (
              <RefreshControl
                refreshing={sentencesQuery.isRefetching}
                onRefresh={() => sentencesQuery.refetch()}
                tintColor={Colors.zinc400}
              />
            ) : undefined
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {selectionMode && (
        <View style={[styles.selectionBar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            style={[
              styles.bulkDeleteButton,
              (selectedCount === 0 || isBulkDeleting) && styles.bulkDeleteButtonDisabled,
            ]}
            onPress={handleBulkDeletePress}
            disabled={selectedCount === 0 || isBulkDeleting}
          >
            {isBulkDeleting ? (
              <Text style={styles.bulkDeleteText}>삭제 중...</Text>
            ) : (
              <Text style={styles.bulkDeleteText}>
                {selectedCount > 0 ? `${selectedCount}개 선택 삭제` : "선택 삭제"}
              </Text>
            )}
          </Pressable>
        </View>
      )}

      <ConfirmModal
        visible={deleteTarget !== null}
        title="문장 삭제"
        description="이 문장을 삭제하시겠어요?"
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onConfirm={() => {
          if (deleteTarget) handleDelete(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmModal
        visible={showBulkDeleteConfirm}
        title="문장 삭제"
        description={`선택한 ${selectedCount}개 문장을 삭제하시겠어요?`}
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onConfirm={handleBulkDeleteConfirm}
        onCancel={handleBulkDeleteCancel}
      />

      <BottomSheet
        visible={selectedSentence !== null}
        onClose={() => setSelectedSentence(null)}
        snapPoints={[0.55]}
      >
        {selectedSentence && (
          <SentenceDetailSheet
            sentence={selectedSentence}
            onCopy={() => handleCopy(selectedSentence.text)}
            onToggleFavorite={() =>
              handleToggleFavorite(selectedSentence.id, selectedSentence.isFavorite)
            }
            onQuoteAsMemo={() => handleQuoteAsMemo(selectedSentence)}
            onDelete={() => {
              setDeleteTarget(selectedSentence.id);
              setSelectedSentence(null);
            }}
            onGoToSource={() => {
              setSelectedSentence(null);
              router.push({
                pathname: "/read",
                params: { articleId: selectedSentence.articleId, mode: "re_read" },
              });
            }}
          />
        )}
      </BottomSheet>
    </View>
  );
}

interface SentenceDetailSheetProps {
  sentence: StoredSentence;
  onCopy: () => void;
  onToggleFavorite: () => void;
  onQuoteAsMemo: () => void;
  onDelete: () => void;
  onGoToSource: () => void;
}

function SentenceDetailSheet({
  sentence,
  onCopy,
  onToggleFavorite,
  onQuoteAsMemo,
  onDelete,
  onGoToSource,
}: SentenceDetailSheetProps) {
  const page = getSentencePage(sentence);

  return (
    <View style={sheet.container}>
      <Text style={sheet.quoteText}>&ldquo;{sentence.text}&rdquo;</Text>

      <View style={sheet.metaRow}>
        <Text style={sheet.metaDate}>
          {new Date(sentence.createdAt).toLocaleDateString("ko-KR")}
        </Text>
        {page !== undefined && (
          <Text style={sheet.metaPage}>{page + 1}페이지</Text>
        )}
      </View>

      <View style={sheet.divider} />

      <View style={sheet.actions}>
        <Pressable style={sheet.actionRow} onPress={onCopy}>
          <Feather name="copy" size={18} color={Colors.zinc700} />
          <Text style={sheet.actionLabel}>복사하기</Text>
        </Pressable>

        <Pressable style={sheet.actionRow} onPress={onToggleFavorite}>
          <Feather
            name="star"
            size={18}
            color={sentence.isFavorite ? "#F59E0B" : Colors.zinc700}
          />
          <Text style={[sheet.actionLabel, sentence.isFavorite && { color: "#F59E0B" }]}>
            {sentence.isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
          </Text>
        </Pressable>

        <Pressable style={sheet.actionRow} onPress={onQuoteAsMemo}>
          <Feather name="edit" size={18} color={Colors.zinc700} />
          <Text style={sheet.actionLabel}>인용해서 메모 작성</Text>
        </Pressable>

        {sentence.articleId && (
          <Pressable style={sheet.actionRow} onPress={onGoToSource}>
            <Feather name="external-link" size={18} color={Colors.zinc700} />
            <Text style={sheet.actionLabel}>
              {page !== undefined ? `원본으로 이동 (${page + 1}페이지)` : "원본으로 이동"}
            </Text>
          </Pressable>
        )}

        <Pressable style={sheet.actionRow} onPress={onDelete}>
          <Feather name="trash-2" size={18} color="#DC2626" />
          <Text style={[sheet.actionLabel, { color: "#DC2626" }]}>삭제</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 12,
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  cancelText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc500,
  },
  filterBar: {
    flexDirection: "row",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
    marginBottom: 8,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.zinc50,
  },
  filterChipActive: {
    backgroundColor: Colors.zinc900,
  },
  filterChipText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
  },
  filterChipTextActive: {
    color: Colors.white,
    fontWeight: "600",
  },
  listContent: {
    paddingBottom: 40,
  },
  sentenceItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 16,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    gap: 8,
  },
  selectionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 16,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: Colors.zinc300,
    backgroundColor: Colors.white,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    flexShrink: 0,
  },
  checkboxSelected: {
    backgroundColor: Colors.zinc900,
    borderColor: Colors.zinc900,
  },
  sentenceContent: {
    flex: 1,
    gap: 6,
  },
  sentenceText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc700,
    fontStyle: "italic",
    lineHeight: 24,
  },
  sentenceMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sentenceDate: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  sentencePage: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  rightActions: {
    gap: 8,
    alignItems: "center",
    paddingTop: 2,
  },
  actionBtn: {
    padding: 4,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.zinc900,
    marginTop: 12,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 22,
  },
  loadingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
  },
  retryButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
  selectionBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    backgroundColor: Colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc100,
  },
  bulkDeleteButton: {
    backgroundColor: "#EF4444",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  bulkDeleteButtonDisabled: {
    opacity: 0.4,
  },
  bulkDeleteText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
});

const sheet = StyleSheet.create({
  container: {
    paddingTop: 4,
    paddingBottom: 16,
  },
  quoteText: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc800,
    fontStyle: "italic",
    lineHeight: 26,
    paddingHorizontal: Spacing.screenPx,
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: Spacing.screenPx,
    marginBottom: 12,
  },
  metaDate: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  metaPage: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.zinc100,
    marginBottom: 8,
  },
  actions: {
    gap: 0,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 14,
  },
  actionLabel: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc800,
  },
});
