import React, { useState, useCallback, useRef } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Switch, Alert, TextInput } from "react-native";
import { useToast } from "@/contexts/ToastContext";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import {
  useGetMyCollection,
  useUpdateMyCollection,
  useDeleteMyCollection,
  useListMyCollectionArticles,
  useAddArticleToMyCollection,
  useRemoveArticleFromMyCollection,
  useListArticles,
  useListMyCollections,
  getListMyCollectionArticlesQueryKey,
  getGetMyCollectionQueryKey,
} from "@workspace/api-client-react";
import type { MyCollectionArticleWithDetails, MyCollection } from "@workspace/api-client-react";
import { MyArticlesPickerBottomSheet } from "@/components/MyArticlesPickerBottomSheet/MyArticlesPickerBottomSheet";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import SwipeableRow, { SwipeableRowHandle } from "@/components/SwipeableRow/SwipeableRow";

export default function PersonalCollectionDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId } = useUser();
  const { showToast } = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [showPicker, setShowPicker] = useState(false);
  const [editSheetVisible, setEditSheetVisible] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [articleActionTarget, setArticleActionTarget] = useState<MyCollectionArticleWithDetails | null>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [moveTargetArticle, setMoveTargetArticle] = useState<MyCollectionArticleWithDetails | null>(null);
  const [isMoveSheetVisible, setIsMoveSheetVisible] = useState(false);

  const openRowRef = useRef<SwipeableRowHandle | null>(null);
  const rowRefs = useRef<Map<string, SwipeableRowHandle>>(new Map());

  const collectionQuery = useGetMyCollection(id ?? "");
  const collection = collectionQuery.data;

  const articlesQuery = useListMyCollectionArticles(id ?? "");
  const articles = (articlesQuery.data ?? []) as MyCollectionArticleWithDetails[];

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
    await queryClient.invalidateQueries({ queryKey: getListMyCollectionArticlesQueryKey(id) });
    await queryClient.invalidateQueries({ queryKey: getGetMyCollectionQueryKey(id) });
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

  const handleTogglePublic = useCallback(
    async (value: boolean) => {
      if (!id) return;
      try {
        await updateCollection.mutateAsync({ id, data: { isPublic: value } });
        collectionQuery.refetch();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "설정 변경에 실패했습니다.";
        Alert.alert("오류", msg);
      }
    },
    [id, updateCollection, collectionQuery],
  );

  const handleOpenEdit = useCallback(() => {
    if (!collection) return;
    setEditName(collection.name);
    setEditDescription(collection.description ?? "");
    setEditSheetVisible(true);
  }, [collection]);

  const handleSaveEdit = useCallback(async () => {
    if (!id || !editName.trim()) {
      Alert.alert("오류", "이름을 입력해주세요.");
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
      Alert.alert("오류", msg);
    }
  }, [id, editName, editDescription, updateCollection, collectionQuery]);

  const handleDeleteCollection = useCallback(async () => {
    if (!id) return;
    try {
      await deleteCollection.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ["/api/my-collections"] });
      router.back();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "삭제에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [id, deleteCollection, router, queryClient]);

  const handleAddArticles = useCallback(
    async (articleIds: string[]) => {
      if (!id || articleIds.length === 0) return;
      try {
        for (const articleId of articleIds) {
          await addArticle.mutateAsync({ id, data: { articleId } });
        }
        await queryClient.invalidateQueries({ queryKey: getListMyCollectionArticlesQueryKey(id) });
        await queryClient.invalidateQueries({ queryKey: getGetMyCollectionQueryKey(id) });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "글 추가에 실패했습니다.";
        Alert.alert("오류", msg);
      }
    },
    [id, addArticle, queryClient],
  );

  const handleRemoveArticle = useCallback(
    async (articleId: string) => {
      if (!id) return;
      try {
        await removeArticle.mutateAsync({ collectionId: id, articleId });
        articlesQuery.refetch();
        collectionQuery.refetch();
        showToast({ message: "글을 제거했어요.", type: "success" });
      } catch {
        showToast({ message: "글 제거에 실패했습니다.", type: "error" });
      }
    },
    [id, removeArticle, articlesQuery, collectionQuery, showToast],
  );

  const handleMoveArticle = useCallback(
    async (targetCollectionId: string) => {
      if (!id || !moveTargetArticle) return;
      const articleId = moveTargetArticle.articleId;
      setIsMoveSheetVisible(false);
      setMoveTargetArticle(null);
      try {
        await removeArticle.mutateAsync({ collectionId: id, articleId });
        await addArticle.mutateAsync({ id: targetCollectionId, data: { articleId } });
        await queryClient.invalidateQueries({ queryKey: getListMyCollectionArticlesQueryKey(id) });
        await queryClient.invalidateQueries({ queryKey: getGetMyCollectionQueryKey(id) });
        showToast({ message: "글을 이동했어요.", type: "success" });
      } catch {
        showToast({ message: "글 이동에 실패했습니다.", type: "error" });
        articlesQuery.refetch();
      }
    },
    [id, moveTargetArticle, removeArticle, addArticle, queryClient, articlesQuery, showToast],
  );

  const handleArticleActionRead = useCallback(() => {
    if (!articleActionTarget) return;
    const item = articleActionTarget;
    setArticleActionTarget(null);
    router.push({
      pathname: "/read",
      params: { articleId: item.articleId, mode: "re_read" },
    });
  }, [articleActionTarget, router]);

  const handleArticleActionDelete = useCallback(async () => {
    if (!articleActionTarget) return;
    const item = articleActionTarget;
    setArticleActionTarget(null);
    await handleRemoveArticle(item.articleId);
  }, [articleActionTarget, handleRemoveArticle]);

  const handleKebabPress = useCallback(() => {
    const isArchive = collection?.isArchive ?? false;
    if (isArchive) {
      Alert.alert("글 관리", undefined, [
        { text: "글 선택 삭제", onPress: enterSelectionMode },
        { text: "닫기", style: "cancel" },
      ]);
    } else {
      Alert.alert("모음 관리", undefined, [
        { text: "글 선택 삭제", onPress: enterSelectionMode },
        { text: "이름/설명 수정", onPress: handleOpenEdit },
        { text: "삭제", style: "destructive", onPress: () => setDeleteConfirmVisible(true) },
        { text: "닫기", style: "cancel" },
      ]);
    }
  }, [collection, enterSelectionMode, handleOpenEdit]);

  const alreadyAddedIds = articles.map((a) => a.articleId);

  const pickerArticles = myArticles.map((a) => ({
    id: a.id,
    title: a.title ?? "제목 없음",
    status: a.status,
    excerpt: a.content?.substring(0, 60),
  }));

  const selectedCount = selectedIds.size;
  const isArchive = collection?.isArchive ?? false;

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
      >
        <Pressable
          style={styles.articleItem}
          onPress={() => setArticleActionTarget(item)}
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
        </Pressable>
      </SwipeableRow>
    ),
    [closeOpenRow, handleRemoveArticle, handleSwipeOpen],
  );

  const renderSelectionItem = useCallback(
    ({ item }: { item: MyCollectionArticleWithDetails }) => {
      const isSelected = selectedIds.has(item.articleId);
      return (
        <Pressable
          style={styles.selectionRow}
          onPress={() => toggleSelect(item.articleId)}
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
        </Pressable>
      );
    },
    [selectedIds, toggleSelect],
  );

  if (!id) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>모음을 찾을 수 없어요</Text>
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
            <Pressable hitSlop={12} onPress={exitSelectionMode}>
              <Text style={styles.cancelText}>취소</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Feather name="arrow-left" size={20} color={Colors.zinc600} />
            </Pressable>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {collection?.name ?? "개인 모음"}
            </Text>
            <Pressable hitSlop={12} onPress={handleKebabPress}>
              <Feather name="more-horizontal" size={20} color={Colors.zinc600} />
            </Pressable>
          </>
        )}
      </View>

      {!selectionMode && collection?.description ? (
        <View style={styles.descSection}>
          <Text style={styles.descText}>{collection.description}</Text>
        </View>
      ) : null}

      {!selectionMode && !isArchive && (
        <View style={styles.metaSection}>
          <View style={styles.visibilityRow}>
            <Text style={styles.visibilityLabel}>공개 설정</Text>
            <Switch
              value={collection?.isPublic ?? false}
              onValueChange={handleTogglePublic}
              trackColor={{ false: Colors.zinc200, true: Colors.zinc900 }}
            />
          </View>
          <Text style={styles.visibilityHint}>
            {collection?.isPublic
              ? "다른 사람이 이 모음을 구독할 수 있어요"
              : "나만 볼 수 있는 모음이에요"}
          </Text>
        </View>
      )}

      {!selectionMode && (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            글 목록 ({articles.length})
          </Text>
          {!isArchive && (
            <Pressable style={styles.addArticleButton} onPress={() => setShowPicker(true)}>
              <Feather name="plus" size={16} color={Colors.zinc600} />
              <Text style={styles.addArticleText}>글 추가</Text>
            </Pressable>
          )}
        </View>
      )}

      {articlesQuery.isError ? (
        <View style={styles.emptyContainer}>
          <Feather name="alert-circle" size={36} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>글 목록을 불러오지 못했어요</Text>
          <Pressable style={styles.retryButton} onPress={() => articlesQuery.refetch()}>
            <Text style={styles.retryButtonText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : articles.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Feather name="file-text" size={36} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>아직 추가된 글이 없어요</Text>
          <Text style={styles.emptySubtitle}>완성된 편지를 이 모음에 추가해보세요</Text>
        </View>
      ) : (
        <FlatList
          data={articles}
          keyExtractor={(item) => item.articleId}
          renderItem={selectionMode ? renderSelectionItem : renderNormalItem}
          contentContainerStyle={[
            styles.listContent,
            selectionMode && { paddingBottom: insets.bottom + 80 + 24 },
          ]}
          onScrollBeginDrag={selectionMode ? undefined : closeOpenRow}
          showsVerticalScrollIndicator={false}
        />
      )}

      {selectionMode && (
        <View style={[styles.selectionBar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            style={[styles.bulkDeleteButton, selectedCount === 0 && styles.bulkDeleteButtonDisabled]}
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
        title="모음 수정"
        snapPoints={[0.45]}
      >
        <View style={styles.editForm}>
          <TextInput
            style={styles.editInput}
            placeholder="모음 이름"
            placeholderTextColor={Colors.zinc400}
            value={editName}
            onChangeText={setEditName}
            autoFocus
          />
          <TextInput
            style={[styles.editInput, styles.editInputMulti]}
            placeholder="설명 (선택사항)"
            placeholderTextColor={Colors.zinc400}
            value={editDescription}
            onChangeText={setEditDescription}
            multiline
            textAlignVertical="top"
          />
          <Pressable
            style={[styles.editConfirmButton, !editName.trim() && styles.editConfirmDisabled]}
            onPress={handleSaveEdit}
            disabled={!editName.trim()}
          >
            <Text style={styles.editConfirmText}>저장</Text>
          </Pressable>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={isMoveSheetVisible}
        onClose={() => { setIsMoveSheetVisible(false); setMoveTargetArticle(null); }}
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
                <Pressable
                  style={styles.moveCollectionItem}
                  onPress={() => handleMoveArticle(coll.id)}
                >
                  <View style={styles.moveCollectionIcon}>
                    <Feather name="folder" size={18} color={Colors.zinc500} />
                  </View>
                  <Text style={styles.moveCollectionName} numberOfLines={1}>
                    {coll.name}
                  </Text>
                  <Feather name="chevron-right" size={16} color={Colors.zinc300} />
                </Pressable>
              )}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </BottomSheet>

      <ConfirmModal
        visible={deleteConfirmVisible}
        title="모음 삭제"
        description={`'${collection?.name ?? ""}'을(를) 삭제하시겠어요?`}
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onConfirm={() => {
          setDeleteConfirmVisible(false);
          handleDeleteCollection();
        }}
        onCancel={() => setDeleteConfirmVisible(false)}
      />

      <ConfirmModal
        visible={articleActionTarget !== null}
        title={articleActionTarget?.article?.title ?? "제목 없음"}
        onCancel={() => setArticleActionTarget(null)}
        actionButton={{
          emoji: "📖",
          label: "읽기",
          onPress: handleArticleActionRead,
        }}
        deleteButton={{
          onPress: handleArticleActionDelete,
        }}
      />

      <ConfirmModal
        visible={showBulkDeleteConfirm}
        title={`${selectedCount}개를 삭제할까요?`}
        description="선택한 글이 이 보관함에서 제거됩니다."
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onConfirm={handleBulkDeleteConfirm}
        onCancel={() => setShowBulkDeleteConfirm(false)}
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
  metaSection: {
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  visibilityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  visibilityLabel: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  visibilityHint: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
    marginTop: 4,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 14,
  },
  sectionTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
  },
  addArticleButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.zinc50,
    borderRadius: 8,
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
  articleItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    backgroundColor: Colors.white,
  },
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
    color: Colors.zinc400,
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
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Colors.zinc900,
    borderRadius: 10,
  },
  retryButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
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
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: Spacing.screenPx,
    backgroundColor: Colors.white,
  },
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
  bulkDeleteButton: {
    height: 52,
    backgroundColor: "#DC2626",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  bulkDeleteButtonDisabled: {
    backgroundColor: Colors.zinc200,
  },
  bulkDeleteText: {
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
    color: Colors.zinc400,
  },
  moveCollectionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    gap: 12,
  },
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
