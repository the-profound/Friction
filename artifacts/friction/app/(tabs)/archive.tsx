import React, { useCallback, useState, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TextInput,
  Platform,
  useWindowDimensions,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import HeaderButton from "@/components/shared/HeaderButton";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { AntDesign } from "@expo/vector-icons";
import {
  Colors,
  ReaderTokens,
  Shadows,
  Typography,
  Spacing,
  Sizing,
  readerFontSize,
} from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { PageHeader } from "@/components/NavBar/PageHeader";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/contexts/ToastContext";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import RefreshableEmpty from "@/components/RefreshableEmpty";
import {
  useListMyCollections,
  useListStoredSentences,
  useCreateMyCollection,
  useDeleteStoredSentence,
  getListMyCollectionsQueryKey,
  getListStoredSentencesQueryKey,
} from "@workspace/api-client-react";
import type { MyCollection, StoredSentence } from "@workspace/api-client-react";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import SubmitButton from "@/components/SubmitButton/SubmitButton";
import SwipeableRow, { SwipeableRowHandle } from "@/components/SwipeableRow/SwipeableRow";
import { isQueryStale } from "@/lib/useScreenFocused";
import { useQueryClient } from "@tanstack/react-query";
import { LIST_PERF_PRESET } from "@/lib/listPerf";

type ArchiveSubTab = "personal" | "sentence";
const FILTER_BUTTON_HEIGHT = 36;
const SENTENCE_BADGE_OVERFLOW = 12;

function FavoriteBadge() {
  return (
    <View
      style={styles.favoriteBadge}
      pointerEvents="none"
      accessible={false}
    >
      <AntDesign name="heart" size={16} color={Colors.noticeAccent} />
    </View>
  );
}

export default function ArchiveScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const { userId } = useUser();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [activeSubTab, setActiveSubTab] = useState<ArchiveSubTab>("personal");
  const [createSheetVisible, setCreateSheetVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const [sentenceDeleteTarget, setSentenceDeleteTarget] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [sentenceScrollEnabled, setSentenceScrollEnabled] = useState(true);
  const sentenceOpenRowRef = useRef<SwipeableRowHandle | null>(null);
  const sentenceRowRefs = useRef<Map<string, SwipeableRowHandle>>(new Map());

  const myCollectionsQuery = useListMyCollections({ ownerId: userId });
  const sentencesQuery = useListStoredSentences({ userId });

  const createMyCollection = useCreateMyCollection();
  const deleteSentence = useDeleteStoredSentence();

  const myCollections = (myCollectionsQuery.data ?? []) as MyCollection[];
  const sentences = (sentencesQuery.data ?? []) as StoredSentence[];

  const selectedCount = selectedIds.size;

  const sortedMyCollections = useMemo(() => {
    return [...myCollections].sort((a, b) => {
      if (a.isArchive && !b.isArchive) return -1;
      if (!a.isArchive && b.isArchive) return 1;
      return 0;
    });
  }, [myCollections]);

  const impressionCollection = useMemo(() => {
    return myCollections.find((c) => c.isImpression) ?? null;
  }, [myCollections]);

  const regularCollections = useMemo(() => {
    return sortedMyCollections.filter((c) => !c.isImpression);
  }, [sortedMyCollections]);

  const cardWidth = Math.floor(windowWidth - Spacing.screenPx * 2);
  const sentenceTextSize = readerFontSize(
    ReaderTokens.typeScale.bodyCqi,
    Math.max(1, cardWidth - 32),
  );

  const closeSentenceOpenRow = useCallback(() => {
    if (sentenceOpenRowRef.current) {
      sentenceOpenRowRef.current.close();
      sentenceOpenRowRef.current = null;
    }
  }, []);

  const handleSentenceSwipeOpen = useCallback((id: string) => {
    const currentOpen = sentenceOpenRowRef.current;
    const newRef = sentenceRowRefs.current.get(id) ?? null;
    if (currentOpen && currentOpen !== newRef) {
      currentOpen.close();
    }
    sentenceOpenRowRef.current = newRef;
  }, []);

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
    setIsBulkDeleting(false);
    exitSelectionMode();
    if (failCount === 0) {
      showToast({ message: `${ids.length}개 문장을 삭제했어요.`, type: "success" });
    } else if (failCount < ids.length) {
      showToast({ message: `일부 삭제에 실패했어요. (${failCount}개)`, type: "error" });
    } else {
      showToast({ message: "삭제에 실패했어요.", type: "error" });
    }
  }, [selectedIds, deleteSentence, sentencesQuery, exitSelectionMode, showToast]);

  const handleAdd = useCallback(() => {
    if (activeSubTab === "sentence") {
      router.push("/stored-sentence-create");
      return;
    }
    setNewName("");
    setNewDescription("");
    setCreateSheetVisible(true);
  }, [activeSubTab, router]);

  const isCreating = createMyCollection.isPending;

  const handleCreateConfirm = useCallback(async () => {
    if (!newName.trim()) {
      showToast({ message: "이름을 입력해주세요.", type: "error" });
      return;
    }
    if (isCreating) return;
    try {
      const newMyCollection = await createMyCollection.mutateAsync({
        data: { ownerId: userId, name: newName.trim(), description: newDescription.trim() },
      });
      myCollectionsQuery.refetch();
      setCreateSheetVisible(false);
      router.push({ pathname: "/of-01-detail", params: { id: newMyCollection.id, name: newName.trim() } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "모음 생성에 실패했습니다.";
      showToast({ message: msg, type: "error" });
    }
  }, [newName, newDescription, userId, isCreating, createMyCollection, myCollectionsQuery, router, showToast]);


  const handleSentenceDeleteConfirm = useCallback(async () => {
    if (!sentenceDeleteTarget || deleteSentence.isPending) return;
    const id = sentenceDeleteTarget;
    setSentenceDeleteTarget(null);
    try {
      await deleteSentence.mutateAsync({ id });
      sentencesQuery.refetch();
      showToast({ message: "문장을 삭제했어요.", type: "success" });
    } catch {
      showToast({ message: "삭제에 실패했어요.", type: "error" });
    }
  }, [sentenceDeleteTarget, deleteSentence, sentencesQuery, showToast]);

  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      if (activeSubTab === "personal") await myCollectionsQuery.refetch();
      else await sentencesQuery.refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [activeSubTab, myCollectionsQuery, sentencesQuery]);

  const refetchPersonal = myCollectionsQuery.refetch;
  const refetchSentences = sentencesQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      if (isQueryStale(queryClient, getListMyCollectionsQueryKey({ ownerId: userId }))) {
        refetchPersonal();
      }
      if (isQueryStale(queryClient, getListStoredSentencesQueryKey({ userId }))) {
        refetchSentences();
      }
    }, [refetchPersonal, refetchSentences, queryClient, userId]),
  );

  const isLoading =
    activeSubTab === "personal"
      ? myCollectionsQuery.isLoading
      : sentencesQuery.isLoading;

  const isError =
    activeSubTab === "personal"
      ? myCollectionsQuery.isError
      : sentencesQuery.isError;

  const renderPersonalItem = useCallback(({ item }: { item: MyCollection }) => {
    return (
      <ScalePressable
        style={[styles.cardWrapper, { width: cardWidth }]}
        onPress={() => router.push({ pathname: "/of-01-detail", params: { id: item.id, name: item.name } })}
        contentStyle={styles.card}
        accessibilityRole="button"
        accessibilityLabel={`${item.name} 모음, ${item.articleCount ?? 0}편`}
      >
        <View style={styles.cardContent}>
          <View style={styles.cardTopRow}>
            <View style={styles.cardIconNameGroup}>
              <Feather name="folder" size={18} color={Colors.zinc500} />
              <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
            </View>
          </View>
          {item.description ? (
            <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
          ) : null}
          <View style={styles.cardSpacer} />
          <View style={styles.cardMeta}>
            <Text style={styles.cardMetaText} numberOfLines={1}>{item.articleCount ?? 0}편</Text>
            <View style={styles.cardMetaRight}>
              {item.isPublic && <Feather name="globe" size={14} color={Colors.zinc400} />}
            </View>
          </View>
        </View>
      </ScalePressable>
    );
  }, [cardWidth, router]);

  const renderSentenceItem = useCallback(({ item }: { item: StoredSentence }) => (
    <SwipeableRow
      ref={(r) => {
        if (r) {
          sentenceRowRefs.current.set(item.id, r);
        } else {
          sentenceRowRefs.current.delete(item.id);
        }
      }}
      onDeletePress={() => {
        closeSentenceOpenRow();
        setSentenceDeleteTarget(item.id);
      }}
      onSwipeOpen={() => handleSentenceSwipeOpen(item.id)}
      onScrollLock={(locked) => setSentenceScrollEnabled(!locked)}
      overflowTop={SENTENCE_BADGE_OVERFLOW}
    >
      <ScalePressable
        style={styles.sentenceItem}
        onPress={() => {
          closeSentenceOpenRow();
          router.push({ pathname: "/stored-sentence-detail", params: { id: item.id } });
        }}
        contentStyle={styles.sentenceItemRow}
        accessibilityRole="button"
        accessibilityLabel={`문장 상세 열기${item.isFavorite ? ", 즐겨찾기됨" : ""}`}
      >
        {item.isFavorite ? <FavoriteBadge /> : null}
        <View style={styles.sentenceItemContent}>
          <View style={styles.sentenceMeta}>
            <Text style={styles.sentenceSource} numberOfLines={1}>
              {item.sourceText || item.articleTitle || "출처 없음"}
            </Text>
            <Text style={styles.sentenceDate}>
              {new Date(item.createdAt).toLocaleDateString("ko-KR")}
            </Text>
          </View>
          <Text
            style={[styles.sentenceText, { fontSize: sentenceTextSize, lineHeight: sentenceTextSize * 1.7 }]}
            numberOfLines={3}
            ellipsizeMode="tail"
          >
            {item.text}
          </Text>
        </View>
      </ScalePressable>
    </SwipeableRow>
  ), [closeSentenceOpenRow, handleSentenceSwipeOpen, router, sentenceTextSize]);

  const renderSentenceSelectionItem = useCallback(({ item }: { item: StoredSentence }) => {
    const isSelected = selectedIds.has(item.id);
    return (
      <ScalePressable
        style={styles.selectionRow}
        onPress={() => toggleSelect(item.id)}
        contentStyle={styles.selectionRowContent}
        accessibilityRole="checkbox"
        accessibilityLabel={`문장 선택${item.isFavorite ? ", 즐겨찾기됨" : ""}`}
        accessibilityState={{ checked: isSelected }}
      >
        {item.isFavorite ? <FavoriteBadge /> : null}
        <View style={styles.checkboxTouchTarget}>
          <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
            {isSelected && <Feather name="check" size={14} color={Colors.white} />}
          </View>
        </View>
        <View style={styles.sentenceItemContent}>
          <View style={styles.sentenceMeta}>
            <Text style={styles.sentenceSource} numberOfLines={1}>
              {item.sourceText || item.articleTitle || "출처 없음"}
            </Text>
            <Text style={styles.sentenceDate}>
              {new Date(item.createdAt).toLocaleDateString("ko-KR")}
            </Text>
          </View>
          <Text
            style={[styles.sentenceText, { fontSize: sentenceTextSize, lineHeight: sentenceTextSize * 1.7 }]}
            numberOfLines={3}
            ellipsizeMode="tail"
          >
            {item.text}
          </Text>
        </View>
      </ScalePressable>
    );
  }, [selectedIds, sentenceTextSize, toggleSelect]);

  const renderEmptyPersonal = () => (
    <RefreshableEmpty
      refreshing={isManualRefreshing}
      onRefresh={handleRefresh}
      contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
    >
      <Feather name="folder" size={40} color={Colors.zinc300} />
      <Text style={styles.emptyTitle}>내 모음이 없어요</Text>
      <Text style={styles.emptySubtitle}>완성된 편지를 모아두는 나만의 공간을 만들어보세요</Text>
      <ScalePressable
        style={styles.emptyButton}
        contentStyle={styles.emptyButtonContent}
        onPress={handleAdd}
        accessibilityRole="button"
        accessibilityLabel="새 모음 만들기"
      >
        <Text style={styles.emptyButtonText}>새 모음 만들기</Text>
      </ScalePressable>
    </RefreshableEmpty>
  );

  const renderEmptySentence = () => (
    <RefreshableEmpty
      refreshing={isManualRefreshing}
      onRefresh={handleRefresh}
      contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
    >
      <Feather name="bookmark" size={40} color={Colors.zinc300} />
      <Text style={styles.emptyTitle}>문장이 없어요</Text>
      <Text style={styles.emptySubtitle}>읽기 화면에서 마음에 드는 문장을{"\n"}길게 눌러 수집해보세요</Text>
    </RefreshableEmpty>
  );

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      );
    }

    if (isError) {
      return (
        <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
          <Feather name="alert-circle" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>불러오기에 실패했어요</Text>
          <ScalePressable
            style={styles.emptyButton}
            contentStyle={styles.emptyButtonContent}
            onPress={handleRefresh}
            accessibilityRole="button"
            accessibilityLabel="보관함 다시 불러오기"
          >
            <Text style={styles.emptyButtonText}>다시 시도</Text>
          </ScalePressable>
        </View>
      );
    }

    if (activeSubTab === "personal") {
      const hasContent = impressionCollection !== null || regularCollections.length > 0;
      return !hasContent ? (
        renderEmptyPersonal()
      ) : (
        <FlatList
          {...LIST_PERF_PRESET}
          key="archive-personal-list"
          data={regularCollections}
          keyExtractor={(item) => item.id}
          renderItem={renderPersonalItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: navBottom }]}
          refreshControl={<RefreshControl refreshing={isManualRefreshing} onRefresh={handleRefresh} tintColor={Colors.zinc400} />}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            impressionCollection ? (
              <ScalePressable
                style={[styles.cardWrapper, { width: cardWidth, marginTop: 4 }]}
                onPress={() => router.push({ pathname: "/of-01-detail", params: { id: impressionCollection.id, name: impressionCollection.name } })}
                contentStyle={styles.card}
                accessibilityRole="button"
                accessibilityLabel={`${impressionCollection.name} 모음, ${impressionCollection.articleCount ?? 0}편`}
              >
                <View style={styles.cardContent}>
                  <View style={styles.cardTopRow}>
                    <View style={styles.cardIconNameGroup}>
                      <Feather name="heart" size={18} color={Colors.zinc500} />
                      <Text style={styles.cardName} numberOfLines={1}>{impressionCollection.name}</Text>
                    </View>
                  </View>
                  <View style={styles.cardSpacer} />
                  <View style={styles.cardMeta}>
                    <Text style={styles.cardMetaText} numberOfLines={1}>{impressionCollection.articleCount ?? 0}편</Text>
                    <View style={styles.cardMetaRight}>
                      {impressionCollection.isPublic && <Feather name="globe" size={14} color={Colors.zinc400} />}
                    </View>
                  </View>
                </View>
              </ScalePressable>
            ) : <View style={styles.listTopSpacer} />
          }
        />
      );
    }

    return sentences.length === 0 ? (
      renderEmptySentence()
    ) : (
      <FlatList
        {...LIST_PERF_PRESET}
        key="archive-sentence-list"
        data={sentences}
        keyExtractor={(item) => item.id}
        renderItem={selectionMode ? renderSentenceSelectionItem : renderSentenceItem}
        contentContainerStyle={[
          styles.listContent,
          styles.sentenceListContent,
          { paddingBottom: selectionMode ? insets.bottom + Spacing.navBarBottom + Sizing.navBarHeight + 80 : navBottom },
        ]}
        refreshControl={
          !selectionMode ? (
            <RefreshControl refreshing={isManualRefreshing} onRefresh={handleRefresh} tintColor={Colors.zinc400} />
          ) : undefined
        }
        scrollEnabled={selectionMode || sentenceScrollEnabled}
        showsVerticalScrollIndicator={false}
      />
    );
  };

  const isSentenceSelectionMode = activeSubTab === "sentence" && selectionMode;

  return (
    <View style={[styles.container, isSentenceSelectionMode && { paddingTop: insets.top }]}>
      {isSentenceSelectionMode ? (
        <View style={styles.selectionHeader}>
          <ScalePressable onPress={exitSelectionMode} hitSlop={12}>
            <Text style={styles.selectionCancelText}>취소</Text>
          </ScalePressable>
          <Text style={styles.selectionHeaderTitle}>
            {selectedCount > 0 ? `${selectedCount}개 선택` : "문장 선택"}
          </Text>
          <View style={{ width: 44 }} />
        </View>
      ) : (
        <PageHeader
          title="보관함"
          centeredBrandTitle
        />
      )}

      <View style={styles.filterRow}>
        <View style={styles.filterGroup}>
          <ScalePressable
            style={styles.filterButton}
            contentStyle={[
              styles.filterButtonContent,
              activeSubTab === "personal" && styles.filterButtonContentActive,
            ]}
            onPress={() => {
              setActiveSubTab("personal");
              exitSelectionMode();
            }}
            accessibilityRole="button"
            accessibilityLabel="모음 보기"
            accessibilityState={{ selected: activeSubTab === "personal" }}
          >
            <Text style={[
              styles.filterButtonText,
              activeSubTab === "personal" && styles.filterButtonTextActive,
            ]}>
              모음
            </Text>
          </ScalePressable>
          <ScalePressable
            style={styles.filterButton}
            contentStyle={[
              styles.filterButtonContent,
              activeSubTab === "sentence" && styles.filterButtonContentActive,
            ]}
            onPress={() => setActiveSubTab("sentence")}
            accessibilityRole="button"
            accessibilityLabel="문장 보기"
            accessibilityState={{ selected: activeSubTab === "sentence" }}
          >
            <Text style={[
              styles.filterButtonText,
              activeSubTab === "sentence" && styles.filterButtonTextActive,
            ]}>
              문장
            </Text>
          </ScalePressable>
        </View>
        {activeSubTab === "personal" ? (
          <HeaderButton
            variant="add"
            onPress={handleAdd}
            accessibilityLabel="새 모음 만들기"
          />
        ) : !selectionMode ? (
          <HeaderButton
            variant="add"
            onPress={handleAdd}
            onLongPress={enterSelectionMode}
            accessibilityLabel="문장 추가"
            accessibilityHint="새 문장 추가 화면으로 이동합니다. 길게 누르면 문장 선택 모드가 열립니다"
            accessibilityActions={[
              { name: "activate", label: "문장 추가" },
              { name: "longpress", label: "문장 선택 모드 열기" },
            ]}
            onAccessibilityAction={({ nativeEvent }) => {
              if (nativeEvent.actionName === "longpress") {
                enterSelectionMode();
              } else if (nativeEvent.actionName === "activate") {
                handleAdd();
              }
            }}
          />
        ) : null}
      </View>

      {renderContent()}

      {isSentenceSelectionMode && (
        <View style={[styles.selectionBar, { paddingBottom: insets.bottom + Spacing.navBarBottom + Sizing.navBarHeight + 12 }]}>
          <ScalePressable
            style={styles.bulkDeleteButton}
            onPress={handleBulkDeletePress}
            disabled={selectedCount === 0 || isBulkDeleting}
            contentStyle={[
              styles.bulkDeleteButtonContent,
              (selectedCount === 0 || isBulkDeleting) && styles.bulkDeleteButtonDisabled,
            ]}
          >
            <Text style={styles.bulkDeleteText}>
              {isBulkDeleting
                ? "삭제 중..."
                : selectedCount > 0
                  ? `${selectedCount}개 선택 삭제`
                  : "선택 삭제"}
            </Text>
          </ScalePressable>
        </View>
      )}

      <BottomSheet
        visible={createSheetVisible}
        onClose={() => setCreateSheetVisible(false)}
        title="새 모음"
        snapPoints={[0.65, 0.95]}
        keyboardAware
      >
        <View style={styles.createForm}>
          <TextInput
            style={styles.createInput}
            placeholder="모음 이름"
            placeholderTextColor={Colors.zinc400}
            cursorColor={Colors.cursorAccent}
            value={newName}
            onChangeText={setNewName}
            autoFocus
          />
          <TextInput
            style={[styles.createInput, styles.createInputMulti]}
            placeholder="설명 (선택사항)"
            placeholderTextColor={Colors.zinc400}
            cursorColor={Colors.cursorAccent}
            value={newDescription}
            onChangeText={setNewDescription}
            multiline
            textAlignVertical="top"
          />
          <SubmitButton
            style={styles.createConfirmButton}
            contentStyle={styles.createConfirmButtonContent}
            disabledContentStyle={styles.createConfirmDisabled}
            textStyle={styles.createConfirmText}
            onPress={handleCreateConfirm}
            pending={isCreating}
            disabled={!newName.trim()}
            label="만들기"
            pendingLabel="만드는 중..."
          />
        </View>
      </BottomSheet>

      <ConfirmModal
        visible={sentenceDeleteTarget !== null}
        title="문장 삭제"
        description="이 문장을 삭제하시겠어요?"
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onConfirm={handleSentenceDeleteConfirm}
        onCancel={() => setSentenceDeleteTarget(null)}
      />

      <ConfirmModal
        visible={showBulkDeleteConfirm}
        title="문장 삭제"
        description={`선택한 ${selectedCount}개 문장을 삭제하시겠어요?`}
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
  selectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 50,
    paddingBottom: 20,
    backgroundColor: Colors.white,
  },
  selectionHeaderTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  selectionCancelText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc500,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: FILTER_BUTTON_HEIGHT,
    paddingHorizontal: Spacing.screenPx,
    marginTop: 4,
    marginBottom: 16,
  },
  filterGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
  },
  filterButton: {
    height: FILTER_BUTTON_HEIGHT,
    alignSelf: "flex-start",
    flexGrow: 0,
    flexShrink: 0,
  },
  filterButtonContent: {
    height: FILTER_BUTTON_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: 14,
    borderRadius: FILTER_BUTTON_HEIGHT / 2,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  filterButtonContentActive: {
    borderColor: Colors.noticeAccent,
    backgroundColor: Colors.noticeAccent,
  },
  filterButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.zinc600,
  },
  filterButtonTextActive: {
    color: Colors.white,
  },
  // ─── Card ────────────────────────────────────────────────────────────────────
  listTopSpacer: {
    height: 4,
  },
  cardWrapper: {
    marginHorizontal: Spacing.screenPx,
    marginBottom: 10,
  },
  card: {
    borderRadius: 16,
    backgroundColor: Colors.white,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardContent: {
    padding: 16,
    position: "relative",
    flexDirection: "column",
    justifyContent: "flex-start",
    borderRadius: 16,
    overflow: "hidden",
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
    gap: 8,
  },
  cardIconNameGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
    flex: 1,
    minWidth: 0,
  },
  cardDesc: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc600,
    lineHeight: 16,
    marginTop: 2,
  },
  cardSpacer: {
    flex: 1,
    minHeight: 8,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  cardMetaRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  cardMetaText: {
    ...Typography.captionMedium,
    fontSize: 12,
    color: Colors.zinc500,
    flexShrink: 0,
  },
  listContent: {
    paddingTop: 4,
  },
  sentenceListContent: {
    paddingTop: SENTENCE_BADGE_OVERFLOW,
  },
  sentenceItem: {
    marginHorizontal: Spacing.screenPx,
    marginBottom: Spacing.cardGap,
  },
  sentenceItemRow: {
    position: "relative",
    padding: 16,
    borderRadius: 16,
    backgroundColor: Colors.white,
    ...Shadows.card,
  },
  sentenceItemContent: {
    flex: 1,
    minWidth: 0,
    gap: 7,
  },
  sentenceText: {
    fontFamily: ReaderTokens.fontFamily.serif,
    color: Colors.zinc600,
  },
  sentenceSource: {
    ...Typography.caption,
    color: Colors.zinc500,
    flex: 1,
    minWidth: 0,
    marginRight: 12,
  },
  sentenceMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sentenceDate: {
    ...Typography.caption,
    color: Colors.zinc500,
    flexShrink: 0,
  },
  selectionRow: {
    marginHorizontal: Spacing.screenPx,
    marginBottom: Spacing.cardGap,
  },
  selectionRowContent: {
    position: "relative",
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 16,
    paddingLeft: 10,
    borderRadius: 16,
    backgroundColor: Colors.white,
    ...Shadows.card,
  },
  favoriteBadge: {
    position: "absolute",
    top: -8,
    left: 10,
    zIndex: 1,
  },
  checkboxTouchTarget: {
    width: 44,
    height: 44,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: Colors.zinc300,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: {
    backgroundColor: Colors.zinc900,
    borderColor: Colors.zinc900,
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
  bulkDeleteButton: {},
  bulkDeleteButtonContent: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EF4444",
    borderRadius: 12,
    paddingVertical: 14,
  },
  bulkDeleteButtonDisabled: {
    backgroundColor: Colors.zinc200,
  },
  bulkDeleteText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
    marginTop: 12,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 20,
  },
  emptyButton: {
    height: 40,
    flexGrow: 0,
    flexShrink: 0,
    marginTop: 8,
  },
  emptyButtonContent: {
    height: 40,
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: 20,
    backgroundColor: Colors.primaryAction,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
  loadingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  createForm: {
    paddingVertical: 12,
    gap: 12,
  },
  createInput: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc900,
    backgroundColor: Colors.zinc50,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  createInputMulti: {
    minHeight: 80,
    lineHeight: 22,
  },
  createConfirmButton: {
    width: "100%",
    height: 48,
    flexGrow: 0,
    flexShrink: 0,
    marginTop: 4,
  },
  createConfirmButtonContent: {
    width: "100%",
    height: 48,
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: Colors.primaryAction,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  createConfirmDisabled: {
    backgroundColor: Colors.primaryActionDisabled,
  },
  createConfirmText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.primaryActionForeground,
  },
});
