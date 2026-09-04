import React, { useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  useWindowDimensions,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { NavBar } from "@/components/NavBar/NavBar";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/contexts/ToastContext";
import ActionSheetModal from "@/components/ActionSheetModal/ActionSheetModal";
import { LIST_PERF_PRESET } from "@/lib/listPerf";
import {
  useGetMyCollection,
  useUpdateMyCollection,
  useDeleteMyCollection,
  useListMyCollectionArticles,
  useAddArticleToMyCollection,
  useRemoveArticleFromMyCollection,
  useListArticles,
  useListMyCollections,
} from "@workspace/api-client-react";
import {
  invalidateMyCollections,
  invalidateMyCollectionDetail,
} from "@/lib/queryInvalidation";
import type { MyCollectionArticleWithDetails, MyCollection, Article } from "@workspace/api-client-react";
import { MyArticlesPickerBottomSheet } from "@/components/MyArticlesPickerBottomSheet/MyArticlesPickerBottomSheet";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import SubmitButton from "@/components/SubmitButton/SubmitButton";
import HeaderButton from "@/components/shared/HeaderButton";
import DropdownFilter from "@/components/DropdownFilter/DropdownFilter";
import type { DropdownOption } from "@/components/DropdownFilter/DropdownFilter";
import CanonicalCardSlot from "@/components/ArticleCardItem/CanonicalCardSlot";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";

import { useLetterSelectionOverlay } from "@/hooks/useLetterSelectionOverlay";
import SwipeableRow, { SwipeableRowHandle } from "@/components/SwipeableRow/SwipeableRow";

type FolderView = "card" | "content";
const VIEW_OPTIONS: DropdownOption<FolderView>[] = [
  { key: "card", label: "카드" },
  { key: "content", label: "목록" },
];
const GRID_PAD = 12;
const GRID_GAP = 4;
const GRID_COLS = 3;

export default function PersonalCollectionDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId } = useUser();
  const { id, name: initialName } = useLocalSearchParams<{ id: string; name?: string }>();

  const [showPicker, setShowPicker] = useState(false);
  const [editSheetVisible, setEditSheetVisible] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [moveTargetArticle, setMoveTargetArticle] = useState<MyCollectionArticleWithDetails | null>(null);
  const [isMoveSheetVisible, setIsMoveSheetVisible] = useState(false);
  const [isBulkMoveMode, setIsBulkMoveMode] = useState(false);
  const [isBulkMoving, setIsBulkMoving] = useState(false);

  const [isDeletingCollection, setIsDeletingCollection] = useState(false);
  const [moreSheetVisible, setMoreSheetVisible] = useState(false);
  const { showToast } = useToast();

  const [view, setView] = useState<FolderView>("card");
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const { openLetterOverlay, renderLetterOverlay } = useLetterSelectionOverlay(userId);

  const { width: windowWidth } = useWindowDimensions();
  const openRowRef = useRef<SwipeableRowHandle | null>(null);
  const rowRefs = useRef<Map<string, SwipeableRowHandle>>(new Map());

  const collectionQuery = useGetMyCollection(id ?? "");
  const collection = collectionQuery.data;
  const isImpression = collection?.isImpression ?? false;

  const articlesQuery = useListMyCollectionArticles(id ?? "");
  const articles = (articlesQuery.data ?? []) as MyCollectionArticleWithDetails[];

  const cellWidth = Math.floor((windowWidth - GRID_PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS);
  const cellHeight = cellWidth * Sizing.cardRatio;
  const sortedArticles = useMemo(
    () => [...articles].sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()),
    [articles],
  );
  const gridRows = useMemo<MyCollectionArticleWithDetails[][]>(() => {
    const rows: MyCollectionArticleWithDetails[][] = [];
    for (let i = 0; i < sortedArticles.length; i += GRID_COLS) {
      rows.push(sortedArticles.slice(i, i + GRID_COLS));
    }
    return rows;
  }, [sortedArticles]);

  const myArticlesQuery = useListArticles({ authorId: userId, status: "LETTER" as const });
  const myArticles = (myArticlesQuery.data ?? []) as Array<{ id: string; title: string; status: string; content?: string }>;

  const allCollectionsQuery = useListMyCollections({ ownerId: userId });
  const otherCollections = ((allCollectionsQuery.data ?? []) as MyCollection[]).filter(
    (c) => c.id !== id && !c.isArchive
  );

  const updateCollection = useUpdateMyCollection();
  const deleteCollection = useDeleteMyCollection();
  const addArticle = useAddArticleToMyCollection();
  const removeArticle = useRemoveArticleFromMyCollection();

  const closeOpenRow = useCallback(() => {
    if (openRowRef.current) {
      openRowRef.current.close();
      openRowRef.current = null;
    }
  }, []);

  const handleSwipeOpen = useCallback((articleId: string) => {
    const currentOpen = openRowRef.current;
    const newRef = rowRefs.current.get(articleId) ?? null;
    if (currentOpen && currentOpen !== newRef) {
      currentOpen.close();
    }
    openRowRef.current = newRef;
  }, []);

  const enterSelectionMode = useCallback(() => {
    closeOpenRow();
    setSelectedIds(new Set());
    setSelectionMode(true);
  }, [closeOpenRow]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((entryId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }, []);

  const handleBulkDeletePress = useCallback(() => {
    if (selectedIds.size === 0) return;
    setShowBulkDeleteConfirm(true);
  }, [selectedIds]);

  const handleBulkDeleteConfirm = useCallback(async () => {
    if (!id) return;
    setShowBulkDeleteConfirm(false);
    setIsBulkDeleting(true);
    const ids = Array.from(selectedIds);
    let failCount = 0;
    for (const articleId of ids) {
      try {
        await removeArticle.mutateAsync({ collectionId: id, articleId });
      } catch {
        failCount++;
      }
    }
    await invalidateMyCollectionDetail(queryClient, id);
    setIsBulkDeleting(false);
    exitSelectionMode();
    if (failCount === 0) {
      showToast({ message: "삭제했어요.", type: "success" });
    } else if (failCount < ids.length) {
      showToast({ message: `일부 삭제에 실패했습니다. (${failCount}개)`, type: "error" });
    } else {
      showToast({ message: "삭제에 실패했습니다.", type: "error" });
    }
  }, [id, selectedIds, removeArticle, queryClient, exitSelectionMode, showToast]);

  const handleOpenEdit = useCallback(() => {
    if (!collection) return;
    setEditName(collection.name);
    setEditDescription(collection.description ?? "");
    setEditSheetVisible(true);
  }, [collection]);

  const handleSaveEdit = useCallback(async () => {
    if (!id || !editName.trim()) {
      showToast({ message: "이름을 입력해주세요.", type: "error" });
      return;
    }
    try {
      await updateCollection.mutateAsync({
        id,
        data: { name: editName.trim(), description: editDescription.trim() || undefined },
      });
      setEditSheetVisible(false);
      collectionQuery.refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "수정에 실패했습니다.";
      showToast({ message: msg, type: "error" });
    }
  }, [id, editName, editDescription, updateCollection, collectionQuery, showToast]);

  const handleDeleteCollection = useCallback(async () => {
    if (!id || isDeletingCollection) return;
    setIsDeletingCollection(true);
    try {
      await deleteCollection.mutateAsync({ id });
      setDeleteConfirmVisible(false);
      invalidateMyCollections(queryClient);
      router.back();
      showToast({ message: "폴더를 삭제했어요.", type: "success" });
    } catch (e: unknown) {
      setDeleteConfirmVisible(false);
      const msg = e instanceof Error ? e.message : "삭제에 실패했습니다.";
      showToast({ message: msg, type: "error" });
    } finally {
      setIsDeletingCollection(false);
    }
  }, [id, isDeletingCollection, deleteCollection, router, queryClient, showToast]);

  const handleAddArticles = useCallback(
    async (articleIds: string[]) => {
      if (!id || articleIds.length === 0) return;
      try {
        for (const articleId of articleIds) {
          await addArticle.mutateAsync({ id, data: { articleId } });
        }
        await invalidateMyCollectionDetail(queryClient, id);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "편지 추가에 실패했습니다.";
        showToast({ message: msg, type: "error" });
      }
    },
    [id, addArticle, queryClient, showToast],
  );

  const handleRemoveArticle = useCallback(
    async (articleId: string) => {
      if (!id || removeArticle.isPending) return;
      try {
        await removeArticle.mutateAsync({ collectionId: id, articleId });
        articlesQuery.refetch();
        collectionQuery.refetch();
        showToast({ message: "편지를 제거했어요.", type: "success" });
      } catch {
        showToast({ message: "편지 제거에 실패했습니다.", type: "error" });
      }
    },
    [id, removeArticle, articlesQuery, collectionQuery, showToast],
  );

  const handleMoveArticle = useCallback(
    async (targetCollectionId: string) => {
      if (!id || removeArticle.isPending || addArticle.isPending) return;

      if (isBulkMoveMode) {
        setIsMoveSheetVisible(false);
        setIsBulkMoving(true);
        const ids = Array.from(selectedIds);
        let failCount = 0;
        for (const articleId of ids) {
          try {
            await removeArticle.mutateAsync({ collectionId: id, articleId });
            await addArticle.mutateAsync({ id: targetCollectionId, data: { articleId } });
          } catch {
            failCount++;
          }
        }
        await invalidateMyCollectionDetail(queryClient, id);
        setIsBulkMoving(false);
        setIsBulkMoveMode(false);
        exitSelectionMode();
        if (failCount === 0) {
          showToast({ message: "편지를 이동했어요.", type: "success" });
        } else if (failCount < ids.length) {
          showToast({ message: `일부 이동에 실패했습니다. (${failCount}개)`, type: "error" });
        } else {
          showToast({ message: "편지 이동에 실패했습니다.", type: "error" });
        }
        return;
      }

      if (!moveTargetArticle) return;
      const articleId = moveTargetArticle.articleId;
      setIsMoveSheetVisible(false);
      setMoveTargetArticle(null);
      try {
        await removeArticle.mutateAsync({ collectionId: id, articleId });
        await addArticle.mutateAsync({ id: targetCollectionId, data: { articleId } });
        await invalidateMyCollectionDetail(queryClient, id);
        showToast({ message: "편지를 이동했어요.", type: "success" });
      } catch {
        showToast({ message: "편지 이동에 실패했습니다.", type: "error" });
        articlesQuery.refetch();
      }
    },
    [id, isBulkMoveMode, selectedIds, moveTargetArticle, removeArticle, addArticle, queryClient, articlesQuery, exitSelectionMode, showToast],
  );

  const handleBulkMovePress = useCallback(() => {
    if (selectedIds.size === 0) return;
    setIsBulkMoveMode(true);
    setIsMoveSheetVisible(true);
  }, [selectedIds]);

  const handleMorePress = useCallback(() => {
    setMoreSheetVisible(true);
  }, []);

  const alreadyAddedIds = articles.map((a) => a.articleId);

  const pickerArticles = myArticles.map((a) => ({
    id: a.id,
    title: a.title ?? "제목 없음",
    status: a.status,
    excerpt: a.content?.substring(0, 60),
  }));

  const selectedCount = selectedIds.size;
  const isArchive = collection?.isArchive ?? false;

  const renderGridRow = useCallback(
    ({ item: rowItems }: { item: MyCollectionArticleWithDetails[] }) => (
      <View style={styles.gridRow}>
        {rowItems.map((entry) => (
          <View key={entry.articleId} style={[styles.gridCell, { width: cellWidth }]}>
            <CanonicalCardSlot width={cellWidth} height={cellHeight}>
              <ArticleCardItem
                title={entry.article?.title ?? "제목 없음"}
                cover={entry.article?.cover}
                carouselShadow
                onPress={() => {
                  if (entry.article && entry.article.authorId === userId) {
                    openLetterOverlay(entry.article, {
                      meta: {
                        collectionName: collection?.name ?? null,
                        collectionId: id ?? null,
                        date: entry.addedAt,
                      },
                      currentCollectionId: id,
                    });
                  } else if (entry.article) {
                    router.push({ pathname: "/read" as never, params: { articleId: entry.article.id, mode: "re_read" } });
                  }
                }}
              />
            </CanonicalCardSlot>
          </View>
        ))}
        {Array.from({ length: GRID_COLS - rowItems.length }).map((_, i) => (
          <View key={`filler-${i}`} style={{ width: cellWidth }} />
        ))}
      </View>
    ),
    [cellWidth, cellHeight, userId, openLetterOverlay, collection?.name, id, router],
  );

  const renderSelectionItem = useCallback(
    ({ item }: { item: MyCollectionArticleWithDetails }) => {
      const isSelected = selectedIds.has(item.articleId);
      return (
        <ScalePressable
          style={styles.selectionRow}
          onPress={() => toggleSelect(item.articleId)}
          contentStyle={styles.selectionRowContent}
        >
          <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
            {isSelected && <Feather name="check" size={14} color={Colors.white} />}
          </View>
          <View style={styles.selectionItemContent}>
            <View style={styles.articleItem}>
              <View style={styles.articleInfo}>
                <Text style={styles.articleTitle} numberOfLines={1}>
                  {item.article?.title ?? "제목 없음"}
                </Text>
                <Text style={styles.articleDate}>
                  {new Date(item.addedAt).toLocaleDateString("ko-KR")}에 추가
                </Text>
              </View>
            </View>
          </View>
        </ScalePressable>
      );
    },
    [selectedIds, toggleSelect],
  );

  const renderNormalItem = useCallback(
    ({ item }: { item: MyCollectionArticleWithDetails }) => (
      <SwipeableRow
        ref={(r) => {
          if (r) {
            rowRefs.current.set(item.articleId, r);
          } else {
            rowRefs.current.delete(item.articleId);
          }
        }}
        actions={[
          ...(item.article?.authorId === userId
            ? [
                {
                  label: "보내기",
                  color: Colors.zinc900,
                  onPress: () => {
                    closeOpenRow();
                    router.push({
                      pathname: "/to-send",
                      params: { articleId: item.articleId },
                    });
                  },
                },
              ]
            : []),
          {
            label: "이동",
            color: Colors.zinc500,
            onPress: () => {
              closeOpenRow();
              setMoveTargetArticle(item);
              setIsMoveSheetVisible(true);
            },
          },
          {
            label: "삭제",
            color: "#EF4444",
            onPress: () => {
              closeOpenRow();
              handleRemoveArticle(item.articleId);
            },
          },
        ]}
        onSwipeOpen={() => handleSwipeOpen(item.articleId)}
        onScrollLock={(locked) => setScrollEnabled(!locked)}
      >
        <ScalePressable
          style={styles.articleItemOuter}
          onPress={() => {
            closeOpenRow();
            if (item.article) {
              openLetterOverlay(item.article, {
                meta: {
                  collectionName: collection?.name ?? null,
                  collectionId: id ?? null,
                  date: item.addedAt,
                },
                currentCollectionId: id,
              });
            }
          }}
          delayLongPress={400}
          contentStyle={styles.articleItemContent}
        >
          <View style={styles.articleInfo}>
            <Text style={styles.articleTitle} numberOfLines={1}>
              {item.article?.title ?? "제목 없음"}
            </Text>
            <Text style={styles.articleDate}>
              {new Date(item.addedAt).toLocaleDateString("ko-KR")}에 추가
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={Colors.zinc300} />
        </ScalePressable>
      </SwipeableRow>
    ),
    [closeOpenRow, handleRemoveArticle, handleSwipeOpen, router, userId, id, openLetterOverlay, collection?.name],
  );

  if (!id) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>폴더를 찾을 수 없어요</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {selectionMode ? (
          <>
            <View style={{ width: 32 }} />
            <Text style={styles.headerTitle} numberOfLines={1}>
              {selectedCount > 0 ? `${selectedCount}개 선택됨` : "선택"}
            </Text>
            <ScalePressable hitSlop={12} onPress={exitSelectionMode}>
              <Text style={styles.cancelText}>취소</Text>
            </ScalePressable>
          </>
        ) : (
          <>
            <HeaderButton
              variant="back"
              onPress={() => router.back()}
              accessibilityLabel="폴더에서 돌아가기"
            />
            <Text style={styles.headerTitle} numberOfLines={1}>
              {collection?.name ?? initialName ?? "폴더"}
            </Text>
            <View style={styles.headerRight}>
              <HeaderButton
                variant="menu"
                onPress={isArchive ? enterSelectionMode : handleMorePress}
                accessibilityLabel={isArchive ? "보관된 편지 선택 모드 열기" : "폴더 메뉴 열기"}
              />
            </View>
          </>
        )}
      </View>

      {!selectionMode && collection?.description ? (
        <View style={styles.descSection}>
          <Text style={styles.descText}>{collection.description}</Text>
        </View>
      ) : null}

      {!selectionMode && (
        <View style={styles.sectionHeader}>
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
          {!isArchive && (
            <ScalePressable onPress={() => setShowPicker(true)}
              contentStyle={styles.addArticleButtonContent}
            >
              <Feather name="plus" size={16} color={Colors.zinc600} />
              <Text style={styles.addArticleText}>편지 추가</Text>
            </ScalePressable>
          )}
        </View>
      )}

      {articlesQuery.isError ? (
        <View style={[styles.emptyContainer, { paddingBottom: Spacing.navBarPaddingBottom + insets.bottom }]}>
          <Feather name="alert-circle" size={36} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>편지 목록을 불러오지 못했어요</Text>
          <ScalePressable style={styles.retryButtonOuter} contentStyle={styles.retryButton} onPress={() => articlesQuery.refetch()}>
            <Text style={styles.retryButtonText}>다시 시도</Text>
          </ScalePressable>
        </View>
      ) : articles.length === 0 ? (
        <View style={[styles.emptyContainer, { paddingBottom: Spacing.navBarPaddingBottom + insets.bottom }]}>
          <Feather name="file-text" size={36} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>아직 추가된 편지가 없어요</Text>
          <Text style={styles.emptySubtitle}>완성된 편지를 이 폴더에 추가해보세요</Text>
        </View>
      ) : selectionMode ? (
        <FlatList
          {...LIST_PERF_PRESET}
          data={articles}
          keyExtractor={(item) => item.articleId}
          renderItem={renderSelectionItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 80 + 24 }]}
          showsVerticalScrollIndicator={false}
        />
      ) : view === "card" ? (
        <FlatList
          {...LIST_PERF_PRESET}
          data={gridRows}
          keyExtractor={(_, idx) => `grid-row-${idx}`}
          renderItem={renderGridRow}
          contentContainerStyle={[styles.gridContent, { paddingBottom: Spacing.navBarPaddingBottom + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlatList
          {...LIST_PERF_PRESET}
          data={sortedArticles}
          keyExtractor={(item) => item.articleId}
          renderItem={renderNormalItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: Spacing.navBarPaddingBottom + insets.bottom }]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={scrollEnabled}
          onScrollBeginDrag={closeOpenRow}
        />
      )}

      {selectionMode && (
        <View style={[styles.selectionBar, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.selectionBarButtons}>
            <ScalePressable
              style={styles.bulkActionButton}
              onPress={handleBulkDeletePress}
              disabled={selectedCount === 0 || isBulkDeleting || isBulkMoving}
              contentStyle={[styles.bulkActionButtonContent, styles.bulkDeleteButtonContent, (selectedCount === 0 || isBulkDeleting || isBulkMoving) && styles.bulkActionButtonDisabledContent]}
            >
              <Text style={styles.bulkDeleteText}>
                {isBulkDeleting ? "삭제 중..." : "삭제"}
              </Text>
            </ScalePressable>
            <ScalePressable
              style={styles.bulkActionButton}
              onPress={handleBulkMovePress}
              disabled={selectedCount === 0 || isBulkDeleting || isBulkMoving}
              contentStyle={[styles.bulkActionButtonContent, styles.bulkMoveButtonContent, (selectedCount === 0 || isBulkDeleting || isBulkMoving) && styles.bulkActionButtonDisabledContent]}
            >
              <Text style={styles.bulkMoveText}>
                {isBulkMoving ? "이동 중..." : "이동"}
              </Text>
            </ScalePressable>
          </View>
        </View>
      )}

      <MyArticlesPickerBottomSheet
        visible={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={handleAddArticles}
        articles={pickerArticles}
        alreadyAdded={alreadyAddedIds}
      />

      <BottomSheet
        visible={editSheetVisible}
        onClose={() => setEditSheetVisible(false)}
        title="폴더 수정"
        snapPoints={[0.45]}
        keyboardAware
      >
        <View style={styles.editForm}>
          <TextInput
            style={styles.editInput}
            placeholder="폴더 이름"
            placeholderTextColor={Colors.zinc400}
            cursorColor={Colors.cursorAccent}
            value={editName}
            onChangeText={setEditName}
            autoFocus
          />
          <TextInput
            style={[styles.editInput, styles.editInputMulti]}
            placeholder="설명 (선택사항)"
            placeholderTextColor={Colors.zinc400}
            cursorColor={Colors.cursorAccent}
            value={editDescription}
            onChangeText={setEditDescription}
            multiline
            textAlignVertical="top"
          />
          <SubmitButton
            style={styles.editConfirmButton}
            disabledStyle={styles.editConfirmDisabled}
            textStyle={styles.editConfirmText}
            onPress={handleSaveEdit}
            pending={updateCollection.isPending}
            disabled={!editName.trim()}
            label="저장"
            pendingLabel="저장 중..."
          />
        </View>
      </BottomSheet>

      <BottomSheet
        visible={isMoveSheetVisible}
        onClose={() => { setIsMoveSheetVisible(false); setMoveTargetArticle(null); setIsBulkMoveMode(false); }}
        title="이동할 보관함 선택"
        snapPoints={[0.5]}
      >
        <View style={styles.moveSheetContent}>
          {otherCollections.length === 0 ? (
            <View style={styles.moveEmptyContainer}>
              <Text style={styles.moveEmptyText}>이동 가능한 다른 보관함이 없어요</Text>
            </View>
          ) : (
            <FlatList
              data={otherCollections}
              keyExtractor={(c) => c.id}
              renderItem={({ item: coll }) => (
                <ScalePressable
                  style={styles.moveCollectionItem}
                  onPress={() => handleMoveArticle(coll.id)}
                  contentStyle={styles.moveCollectionItemContent}
                >
                  <View style={styles.moveCollectionIcon}>
                    <Feather name="folder" size={18} color={Colors.zinc500} />
                  </View>
                  <Text style={styles.moveCollectionName} numberOfLines={1}>
                    {coll.name}
                  </Text>
                  <Feather name="chevron-right" size={16} color={Colors.zinc300} />
                </ScalePressable>
              )}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </BottomSheet>

      <ConfirmModal
        visible={deleteConfirmVisible}
        title="폴더 삭제"
        description={`'${collection?.name ?? ""}'을(를) 삭제할까요?
폴더 안의 편지는 삭제되지 않아요.`}
        confirmLabel={isDeletingCollection ? "삭제 중..." : "삭제"}
        cancelLabel="취소"
        destructive
        onConfirm={handleDeleteCollection}
        onCancel={() => { if (!isDeletingCollection) setDeleteConfirmVisible(false); }}
      />

      <ConfirmModal
        visible={showBulkDeleteConfirm}
        title={`${selectedCount}개를 삭제할까요?`}
        description="선택한 편지가 이 보관함에서 제거됩니다."
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onConfirm={handleBulkDeleteConfirm}
        onCancel={() => setShowBulkDeleteConfirm(false)}
      />

      {renderLetterOverlay()}

      {!selectionMode && <NavBar />}

      <ActionSheetModal
        visible={moreSheetVisible}
        title="폴더 관리"
        onClose={() => setMoreSheetVisible(false)}
        actions={[
          { label: "선택", onPress: () => { setMoreSheetVisible(false); enterSelectionMode(); } },
          ...(!isImpression ? [
            { label: "폴더 이름 변경", onPress: () => { setMoreSheetVisible(false); handleOpenEdit(); } },
            { label: "폴더 삭제", style: "destructive" as const, onPress: () => { setMoreSheetVisible(false); setDeleteConfirmVisible(true); } },
          ] : []),
          { label: "취소", style: "cancel" as const, onPress: () => setMoreSheetVisible(false) },
        ]}
      />
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
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
    flex: 1,
    textAlign: "center",
    marginHorizontal: 8,
  },
  cancelText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc600,
  },
  descSection: {
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 12,
  },
  descText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    lineHeight: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 14,
  },
  addArticleButtonContent: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.zinc50,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  addArticleText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc600,
    fontWeight: "600",
  },
  listContent: {
    paddingBottom: 40,
  },
  articlesContent: {
    flex: 1,
  },
  articlesList: {
    flex: 1,
  },
  gridRow: {
    flexDirection: "row",
    paddingHorizontal: GRID_PAD,
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
  },
  gridCell: {
    flexShrink: 0,
    flexGrow: 0,
  },
  gridContent: {
    paddingTop: 8,
  },
  articleItem: {
    paddingVertical: 14,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    backgroundColor: Colors.white,
  },
  articleItemOuter: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  articleItemContent: {
    paddingVertical: 14,
    paddingHorizontal: Spacing.screenPx,
    backgroundColor: Colors.white,
    flexDirection: "row",
    alignItems: "center",},
  articleInfo: {
    flex: 1,
    gap: 2,
  },
  articleTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  articleDate: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
    marginTop: 8,
  },
  loadingTitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    marginTop: 12,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
  },
  retryButtonOuter: {
    marginTop: 12,
    height: 40,
    alignSelf: "center",
    flexGrow: 0,
    flexShrink: 0,
  },
  retryButton: {
    height: 40,
    minWidth: 104,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    backgroundColor: Colors.zinc900,
    borderRadius: 10,
  },
  retryButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
  refreshStatus: {
    minHeight: 42,
    paddingHorizontal: Spacing.screenPx,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.zinc50,
  },
  refreshStatusText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc600,
  },
  inlineRetryButtonOuter: {
    height: 32,
    flexGrow: 0,
    flexShrink: 0,
  },
  inlineRetryButton: {
    height: 32,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    backgroundColor: Colors.white,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
  },
  inlineRetryButtonText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc700,
    fontWeight: "600",
  },
  moveLoadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 40,
  },
  moveLoadingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  editForm: {
    paddingVertical: 12,
    gap: 12,
  },
  editInput: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc900,
    backgroundColor: Colors.zinc50,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  editInputMulti: {
    minHeight: 80,
    lineHeight: 22,
  },
  editConfirmButton: {
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  editConfirmDisabled: {
    backgroundColor: Colors.zinc300,
  },
  editConfirmText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
  selectionRow: {
  },
  selectionRowContent: {
    paddingLeft: Spacing.screenPx,
    backgroundColor: Colors.white,
    flexDirection: "row",
    alignItems: "center",},
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: Colors.zinc300,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.white,
    marginRight: 12,
    flexShrink: 0,
  },
  checkboxSelected: {
    backgroundColor: Colors.zinc900,
    borderColor: Colors.zinc900,
  },
  selectionItemContent: {
    flex: 1,
  },
  selectionBar: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.zinc100,
    backgroundColor: Colors.white,
  },
  selectionBarButtons: {
    flexDirection: "row",
    gap: 10,
  },
  bulkActionButton: {
    flex: 1,
    height: 52,
  },
  bulkActionButtonContent: {
    height: "100%",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",},
  bulkActionButtonDisabledContent: {
    backgroundColor: Colors.zinc200,
  },
  bulkDeleteButtonContent: {
    backgroundColor: "#DC2626",
  },
  bulkDeleteText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
  bulkMoveButtonContent: {
    backgroundColor: Colors.zinc800,
  },
  bulkMoveText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
  moveSheetContent: {
    flex: 1,
    paddingTop: 4,
  },
  moveEmptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  moveEmptyText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  moveCollectionItem: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  moveCollectionItemContent: {
    paddingVertical: 16,
    paddingHorizontal: Spacing.screenPx,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,},
  moveCollectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: Colors.zinc50,
    alignItems: "center",
    justifyContent: "center",
  },
  moveCollectionName: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc900,
    flex: 1,
  },
});
